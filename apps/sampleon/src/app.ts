import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { checkAgainstCatalogue } from '@sampledge/contracts';
import { installAuth } from './auth';
import type { Config } from './config';
import { one, type Db } from './db';
import { actorOf, forbidden, HttpError, parse, requireRole, type Actor } from './http';
import { Supply360Client } from './supply360';
import { failures, listRequests, replay, requestDetail, summary } from './modules/dashboard';
import { browserReturn, enter, verifiedOutcome, type FlowResult } from './modules/entry';
import { receiveEvent } from './modules/inbound';
import { launch, scheduleBatch } from './modules/launch';
import { assertSee, changeRequest, createRequest, decide, loadRequest, requestView, runFeasibility, setStatus } from './modules/requests';
import { parseTargeting } from './modules/targeting';

const STAFF = ['supply_admin', 'supply_approver', 'supply_manager', 'viewer', 'org_viewer'] as const;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (title: string, message: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;color:#16181d}main{max-width:28rem;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 1px 3px #0002;margin:1rem}h1{font-size:1.25rem;margin:0 0 .5rem}@media(prefers-color-scheme:dark){body{background:#111317;color:#e8eaee}main{background:#1b1e24}}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;

function sendFlow(reply: FastifyReply, r: FlowResult) {
  reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
  if ('redirect' in r) return reply.redirect(r.redirect, 302);
  return reply.code(r.page.status).type('text/html; charset=utf-8').send(page(r.page.title, r.page.message));
}

/** Replays of a client write with the same Idempotency-Key return the first response. */
async function idempotent(db: Db, req: FastifyRequest, reply: FastifyReply, fn: () => Promise<unknown>, okStatus = 200) {
  const key = req.headers['idempotency-key'];
  const actor = actorOf(req);
  if (typeof key !== 'string' || !key || actor.kind !== 'client') return reply.code(okStatus).send(await fn());
  const prior = await one<{ status: number; response: unknown }>(db, 'SELECT status, response FROM idempotency_keys WHERE client_id=$1 AND key=$2', [actor.id, key]);
  if (prior) return reply.code(prior.status).header('idempotent-replay', 'true').send(prior.response);
  const out = await fn();
  await db.query('INSERT INTO idempotency_keys (client_id, key, status, response) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [actor.id, key.slice(0, 200), okStatus, JSON.stringify(out)]);
  return reply.code(okStatus).send(out);
}

const staff = (a: Actor) => { requireRole(a, [...STAFF]); return a; };

export function buildApp(db: Db, cfg: Config) {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: process.env.TRUST_PROXY === 'true' });
  const supply = new Supply360Client(cfg, db);
  installAuth(app, db);

  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof HttpError) return reply.code(e.status).send({ error: e.message, details: e.details });
    const err = e as { statusCode?: number; message: string; name?: string };
    if (err.name === 'Supply360Error') return reply.code(502).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    reply.log.error(e);
    return reply.code(500).send({ error: 'Internal error' });
  });
  app.addHook('onSend', async (_req, reply) => { reply.header('x-content-type-options', 'nosniff').header('x-frame-options', 'DENY'); });

  app.get('/health', async () => {
    const r = await one<{ pending: string; dead: string }>(db, "SELECT count(*) FILTER (WHERE status='pending') AS pending, count(*) FILTER (WHERE status='dead') AS dead FROM outbox");
    return { ok: true, supply360: supply.connected ? 'configured' : 'not connected', outboxPending: Number(r?.pending ?? 0), outboxDead: Number(r?.dead ?? 0) };
  });

  // ---- Audience requests
  app.post('/api/v1/audience-requests', async (req, reply) =>
    idempotent(db, req, reply, async () => {
      const r = await createRequest(db, cfg, actorOf(req), req.body, async (text) => {
        const catalogue = await supply.attributes();
        const parsed = await parseTargeting(cfg, text, catalogue);
        return { ...parsed, problems: checkAgainstCatalogue(parsed.criteria, catalogue) };
      });
      return requestView(db, actorOf(req), r);
    }, 201));
  app.get('/api/v1/audience-requests', async (req) => {
    const a = actorOf(req);
    const q = req.query as Record<string, string | undefined>;
    if (a.kind === 'client') return { data: await listRequests(db, a, { platform: a.system === 'SUPPLY360' ? q.platform : a.system, status: q.status, country: q.country }) };
    return { data: await listRequests(db, staff(a), { platform: q.platform, status: q.status, country: q.country }) };
  });
  app.get<{ Params: { id: string } }>('/api/v1/audience-requests/:id', async (req) => {
    const a = actorOf(req);
    const r = await loadRequest(db, req.params.id);
    assertSee(a, r);
    return requestView(db, a, r);
  });
  app.patch<{ Params: { id: string } }>('/api/v1/audience-requests/:id', async (req, reply) =>
    idempotent(db, req, reply, async () => requestView(db, actorOf(req), await changeRequest(db, actorOf(req), req.params.id, req.body))));
  app.post<{ Params: { id: string } }>('/api/v1/audience-requests/:id/feasibility', async (req) => {
    const a = actorOf(req);
    if (a.kind === 'user') requireRole(a, ['supply_admin', 'supply_manager', 'supply_approver']);
    return runFeasibility(db, cfg, supply, a, req.params.id);
  });
  app.post<{ Params: { id: string }; Body: { note?: string; allocation?: Record<string, Record<string, number>> } }>('/api/v1/audience-requests/:id/approve', async (req) =>
    requestView(db, actorOf(req), await decide(db, actorOf(req), req.params.id, true, req.body ?? {})));
  app.post<{ Params: { id: string }; Body: { note?: string } }>('/api/v1/audience-requests/:id/reject', async (req) =>
    requestView(db, actorOf(req), await decide(db, actorOf(req), req.params.id, false, req.body ?? {})));
  app.post<{ Params: { id: string } }>('/api/v1/audience-requests/:id/launch', async (req) => launch(db, cfg, actorOf(req), req.params.id, req.body));
  app.post<{ Params: { id: string } }>('/api/v1/audience-requests/:id/batches', async (req) => scheduleBatch(db, actorOf(req), req.params.id, req.body));
  for (const [path, to] of [['pause', 'paused'], ['resume', 'resume'], ['close', 'closed'], ['cancel', 'cancelled']] as const) {
    app.post<{ Params: { id: string }; Body: { reason?: string } }>(`/api/v1/audience-requests/:id/${path}`, async (req, reply) =>
      idempotent(db, req, reply, async () => requestView(db, actorOf(req), await setStatus(db, actorOf(req), req.params.id, to, req.body?.reason))));
  }
  app.get<{ Params: { id: string } }>('/api/v1/audience-requests/:id/report', async (req) => {
    const a = actorOf(req);
    const r = await loadRequest(db, req.params.id);
    assertSee(a, r);
    const v = await requestView(db, a, r);
    const started = Object.values(v.outcomes).reduce((s, n) => s + n, 0);
    return {
      audienceRequestId: v.audienceRequestId, status: v.status, source: v.source,
      delivery: { batches: v.batches.length, invitationsDelivered: v.batches.reduce((s: number, b: Record<string, unknown>) => s + Number(b.delivered ?? 0), 0) },
      participation: { started, outcomes: v.outcomes, completes: v.completes, required: v.requiredCompletes, remaining: v.remaining },
      completionRate: started ? Math.round(((v.outcomes.complete ?? 0) / started) * 1000) / 10 : null,
      quotas: v.quotas, routing: v.routing,
    };
  });

  // ---- Targeting
  app.post('/api/v1/targeting/parse', async (req) => {
    const a = actorOf(req);
    if (a.kind === 'user') requireRole(a, ['supply_admin', 'supply_manager', 'supply_approver', 'viewer']);
    const { text } = parse(z.object({ text: z.string().min(3).max(2000) }), req.body);
    const catalogue = await supply.attributes();
    const parsed = await parseTargeting(cfg, text, catalogue);
    return { ...parsed, problems: checkAgainstCatalogue(parsed.criteria, catalogue) };
  });
  // Staff and the source systems (PROJEXA maps its quota questions onto these attributes).
  app.get('/api/v1/attributes', async (req) => {
    const a = actorOf(req);
    if (a.kind === 'user') staff(a);
    return { attributes: await supply.attributes() };
  });

  // ---- Events in
  app.post('/api/v1/events', async (req) => receiveEvent(db, actorOf(req), req.body));

  // ---- Respondent flow (public) and the host's signed outcome
  app.get<{ Params: { token: string } }>('/go/:token', async (req, reply) => sendFlow(reply, await enter(db, cfg, supply, req.params.token)));
  app.get<{ Params: { status: string }; Querystring: { token?: string; rid?: string } }>('/r/:status', async (req, reply) =>
    sendFlow(reply, await browserReturn(db, cfg, supply, req.params.status, req.query.token ?? req.query.rid)));
  app.post('/api/v1/s2s/outcome', async (req) => verifiedOutcome(db, (req.body ?? {}) as Record<string, unknown>));

  // ---- Dashboard
  app.get('/api/v1/dashboard/summary', async (req) => summary(db, staff(actorOf(req))));
  app.get('/api/v1/dashboard/requests', async (req) => ({ data: await listRequests(db, staff(actorOf(req)), req.query as Record<string, string>) }));
  app.get<{ Params: { id: string } }>('/api/v1/dashboard/requests/:id', async (req) => requestDetail(db, staff(actorOf(req)), req.params.id));
  app.get('/api/v1/dashboard/failures', async (req) => {
    const a = staff(actorOf(req));
    if (a.role === 'org_viewer') throw forbidden();
    return failures(db);
  });
  app.post<{ Params: { id: string } }>('/api/v1/dashboard/failures/:id/replay', async (req) => {
    requireRole(actorOf(req), ['supply_admin', 'supply_manager']);
    return replay(db, Number(req.params.id));
  });
  app.get('/api/v1/me', async (req) => actorOf(req));

  const consoleHtml = readFileSync(join(__dirname, '..', '..', 'public', 'console.html'), 'utf8');
  app.get('/console', async (_req, reply) => reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(consoleHtml));
  app.get('/', async (_req, reply) => reply.redirect('/console'));

  return { app, supply };
}
