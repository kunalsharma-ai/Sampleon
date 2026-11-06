/**
 * Respondent flow and the one routing engine (§5.3, §7).
 *
 *   survey card → GET /go/{invitationToken} → session → survey host (launchUrl with token)
 *   host → GET /r/{status}?token=   (browser; routing on terminate / quota full)
 *   host → POST /api/v1/s2s/outcome (signed; a complete counts and earns a reward only here)
 */
import { outcomeSignature, opaqueToken, parseOutcome, prefixedId, ROUTABLE, safeEqualHex, unixSeconds, type Outcome } from '@sampledge/contracts';
import type { Config } from '../config';
import { many, one, tx, type Db, type Queryable } from '../db';
import { HttpError } from '../http';
import type { Supply360Client } from '../supply360';
import { emit } from './events';
import { emitQuotaUpdate, loadRequest, type RequestRow } from './requests';

interface SessionRow {
  id: string; token: string; request_id: string; invitation_id: string | null; respondent_ref: string; panel: string; country: string;
  chain_id: string; hop: number; routed_from: string | null; quota_ids: string[]; status: string; browser_outcome: string | null;
  verified_outcome: string | null; counted: boolean; overquota: boolean; started_at: Date;
}

export type FlowResult = { redirect: string } | { page: { title: string; message: string; status: number } };

const endPage = (title: string, message: string, status = 200): FlowResult => ({ page: { title, message, status } });

export function launchUrlFor(r: RequestRow, token: string) {
  const url = r.spec.survey.launchUrl;
  if (/\{token\}/i.test(url)) return url.replace(/\{token\}/gi, encodeURIComponent(token));
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

function endUrl(cfg: Config, r: RequestRow | null, status: string): FlowResult {
  const target = r?.spec.redirects.endUrl ?? cfg.panelEndUrl;
  if (target) return { redirect: `${target}${target.includes('?') ? '&' : '?'}status=${encodeURIComponent(status)}` };
  const messages: Record<string, string> = {
    complete: 'Thank you for completing the survey. Your reward is on its way once the answers are checked.',
    none: 'Thank you for your time. There is no other survey for you right now; we will let you know when there is.',
  };
  return endPage('Thank you', messages[status] ?? messages.none!);
}

const isActive = (r: RequestRow) => (r.status === 'live' || (r.status === 'soft_launch' && r.completes < (r.soft_launch_target ?? Infinity)));
const inFieldwork = (r: RequestRow, now = Date.now()) => Date.parse(r.spec.fieldwork.start) <= now && now <= Date.parse(r.spec.fieldwork.end) + 86_400_000;

/** Quota cells the respondent would fill in this request, and whether any hard one is full. */
async function quotaFit(q: Queryable, r: RequestRow, country: string, matchedQuotaIds: string[]) {
  const cells = await many<{ quota_key: string; country: string | null; target: number; count: number; hard: boolean }>(
    q, 'SELECT quota_key, country, target, count, hard FROM quota_cells WHERE request_id=$1 AND (quota_key = $2 OR quota_key = ANY($3))',
    [r.id, `country:${country}`, matchedQuotaIds]);
  const relevant = cells.filter((c) => c.country === null || c.country === country);
  const full = relevant.filter((c) => c.hard && c.count >= c.target).map((c) => c.quota_key);
  return { keys: relevant.map((c) => c.quota_key), full };
}

/** Eligibility and quota membership for one respondent and request, from SUPPLY360. */
async function admit(db: Db, supply: Supply360Client, r: RequestRow, respondentRef: string, country: string) {
  if (!r.countries.includes(country)) return { ok: false as const, reason: 'country' };
  const quotaDefs = r.spec.quotas.filter((qd) => !qd.country || qd.country === country).map((qd) => ({ id: qd.id, conditions: qd.conditions }));
  const check = await supply.check({ respondentRef, criteria: r.spec.targeting.criteria, quotas: quotaDefs }, r.id);
  if (!check.consented) return { ok: false as const, reason: 'consent' };
  if (!check.eligible) return { ok: false as const, reason: 'ineligible' };
  const fit = await quotaFit(db, r, country, check.quotaIds);
  if (fit.full.length) return { ok: false as const, reason: 'quota_full' };
  return { ok: true as const, quotaKeys: fit.keys };
}

async function startSession(q: Queryable, r: RequestRow, p: { respondentRef: string; panel: string; country: string; invitationId: string | null; chainId: string; hop: number; routedFrom: string | null; quotaKeys: string[] }) {
  const id = prefixedId('ses');
  const token = opaqueToken();
  await q.query(
    'INSERT INTO sessions (id, token, request_id, invitation_id, respondent_ref, panel, country, chain_id, hop, routed_from, quota_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [id, token, r.id, p.invitationId, p.respondentRef, p.panel, p.country, p.chainId, p.hop, p.routedFrom, p.quotaKeys]);
  await emit(q, r, 'survey.started', { sessionId: id, country: p.country, quotaIds: p.quotaKeys, respondentRef: p.respondentRef, panel: p.panel, routedFrom: p.routedFrom });
  return { id, token };
}

// ---- Routing ----------------------------------------------------------------------------------

export interface RouteFrom {
  chainId: string; hop: number; respondentRef: string; panel: string; country: string;
  fromSession: string; fromRequest: RequestRow; trigger: 'terminate' | 'quota_full' | 'closed' | 'full_on_entry' | 'ineligible';
}

/**
 * Find the next suitable survey for a respondent, or end the chain. Prevents repeat surveys,
 * loops (each survey once per chain, at most MAX_ROUTE_HOPS hops) and routing where the source
 * request, the candidate or consent does not allow it.
 */
export async function route(db: Db, cfg: Config, supply: Supply360Client, from: RouteFrom): Promise<{ requestId: string; url: string } | null> {
  const reasons: Record<string, string> = {};
  const record = async (toRequest: string | null, toSession: string | null, considered: number) => {
    await db.query('INSERT INTO routing_decisions (chain_id, from_session, from_request, to_request, to_session, trigger, considered, reasons) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [from.chainId, from.fromSession, from.fromRequest.id, toRequest, toSession, from.trigger, considered, JSON.stringify(reasons)]);
  };
  if (from.fromRequest.spec.redirects.allowRouting === false) { reasons._ = 'source request does not allow routing'; await record(null, null, 0); return null; }
  if (from.hop + 1 > cfg.maxRouteHops) { reasons._ = `hop limit ${cfg.maxRouteHops} reached`; await record(null, null, 0); return null; }

  const seenSurveys = new Set((await many<{ survey_id: string }>(db,
    `SELECT DISTINCT r.survey_id FROM audience_requests r WHERE r.id IN (
       SELECT request_id FROM sessions WHERE respondent_ref=$1 UNION SELECT request_id FROM invitations WHERE respondent_ref=$1 AND status <> 'suppressed')`,
    [from.respondentRef])).map((x) => x.survey_id));
  const chainRequests = new Set((await many<{ request_id: string }>(db, 'SELECT request_id FROM sessions WHERE chain_id=$1', [from.chainId])).map((x) => x.request_id));

  const candidates = (await many<RequestRow>(db,
    `SELECT r.* FROM audience_requests r JOIN service_clients h ON h.id = r.host_client_id AND h.active
     WHERE r.status IN ('soft_launch','live') AND $1 = ANY(r.countries) AND r.id <> $2`, [from.country, from.fromRequest.id]))
    .filter((r) => {
      if (r.spec.redirects.allowRouting === false) { reasons[r.id] = 'does not accept routed respondents'; return false; }
      if (!isActive(r)) { reasons[r.id] = 'soft launch target reached'; return false; }
      if (!inFieldwork(r)) { reasons[r.id] = 'outside fieldwork dates'; return false; }
      if (chainRequests.has(r.id)) { reasons[r.id] = 'already in this chain'; return false; }
      if (seenSurveys.has(r.survey_id)) { reasons[r.id] = 'respondent already invited to or took this survey'; return false; }
      if (r.spec.exclusions.surveyIds.some((s) => seenSurveys.has(s))) { reasons[r.id] = 'respondent took an excluded survey'; return false; }
      return true;
    })
    .sort((a, b) => (b.required_completes - b.completes) * b.spec.expectedIncidence - (a.required_completes - a.completes) * a.spec.expectedIncidence || a.spec.loiMinutes - b.spec.loiMinutes);

  let considered = 0;
  for (const c of candidates.slice(0, 5)) {
    considered++;
    let a: Awaited<ReturnType<typeof admit>>;
    try { a = await admit(db, supply, c, from.respondentRef, from.country); } catch (e) { reasons[c.id] = `eligibility check failed: ${(e as Error).message.slice(0, 100)}`; continue; }
    if (!a.ok) { reasons[c.id] = a.reason; continue; }
    const s = await tx(db, async (q) => {
      const fresh = await loadRequest(q, c.id, true);
      if (!isActive(fresh)) return null;
      return startSession(q, fresh, { respondentRef: from.respondentRef, panel: from.panel, country: from.country, invitationId: null, chainId: from.chainId, hop: from.hop + 1, routedFrom: from.fromSession, quotaKeys: a.quotaKeys });
    });
    if (!s) { reasons[c.id] = 'closed while routing'; continue; }
    reasons[c.id] = 'routed';
    await record(c.id, s.id, considered);
    return { requestId: c.id, url: launchUrlFor(c, s.token) };
  }
  if (!candidates.length) reasons._ = reasons._ ?? 'no active survey for this respondent';
  await record(null, null, considered);
  return null;
}

// ---- Entry ----------------------------------------------------------------------------------

export async function enter(db: Db, cfg: Config, supply: Supply360Client, invitationToken: string): Promise<FlowResult> {
  const inv = await one<{ id: string; request_id: string; respondent_ref: string; panel: string; country: string; status: string }>(
    db, 'SELECT id, request_id, respondent_ref, panel, country, status FROM invitations WHERE token=$1', [invitationToken]);
  if (!inv || inv.status === 'withdrawn' || inv.status === 'suppressed') return endPage('Link not valid', 'This survey link is not valid any more.', 404);
  const r = await loadRequest(db, inv.request_id);

  const existing = await one<SessionRow>(db, 'SELECT * FROM sessions WHERE request_id=$1 AND respondent_ref=$2 ORDER BY started_at DESC LIMIT 1', [r.id, inv.respondent_ref]);
  if (existing) {
    if (existing.status === 'started' && isActive(r)) return { redirect: launchUrlFor(r, existing.token) };
    return endPage('Already taken', 'You have already taken part in this survey. Thank you!');
  }
  await db.query("UPDATE invitations SET status='opened', opened_at=COALESCE(opened_at, now()) WHERE id=$1", [inv.id]);

  const chainId = prefixedId('chn');
  const placeholder = `entry:${inv.id}`;
  const goElsewhere = async (trigger: RouteFrom['trigger']) => {
    const next = await route(db, cfg, supply, { chainId, hop: 0, respondentRef: inv.respondent_ref, panel: inv.panel, country: inv.country, fromSession: placeholder, fromRequest: r, trigger });
    return next ? { redirect: next.url } : endUrl(cfg, r, 'none');
  };
  if (!isActive(r) || !inFieldwork(r)) return goElsewhere('closed');
  const a = await admit(db, supply, r, inv.respondent_ref, inv.country);
  if (!a.ok) return goElsewhere(a.reason === 'quota_full' ? 'full_on_entry' : 'ineligible');
  const s = await tx(db, async (q) => {
    const fresh = await loadRequest(q, r.id, true);
    if (!isActive(fresh)) return null;
    return startSession(q, fresh, { respondentRef: inv.respondent_ref, panel: inv.panel, country: inv.country, invitationId: inv.id, chainId, hop: 0, routedFrom: null, quotaKeys: a.quotaKeys });
  });
  if (!s) return goElsewhere('closed');
  return { redirect: launchUrlFor(r, s.token) };
}

// ---- Browser return -------------------------------------------------------------------------

export async function browserReturn(db: Db, cfg: Config, supply: Supply360Client, slug: string, token: string | undefined): Promise<FlowResult> {
  const outcome = parseOutcome(slug);
  const s = token ? await one<SessionRow>(db, 'SELECT * FROM sessions WHERE token=$1', [token]) : null;
  if (!s || !outcome) return endPage('Thank you', 'Thank you for your time.');
  const r = await loadRequest(db, s.request_id);
  const first = await one<{ id: string }>(db,
    `UPDATE sessions SET browser_outcome=$2, ended_at=COALESCE(ended_at, now()),
       status = CASE WHEN verified_outcome IS NOT NULL THEN status WHEN $2 = 'complete' THEN 'pending_verification' ELSE $2 END
     WHERE id=$1 AND browser_outcome IS NULL RETURNING id`, [s.id, outcome]);
  const recorded = (s.verified_outcome ?? s.browser_outcome ?? outcome) as Outcome;
  if (first && ROUTABLE.includes(outcome) && !s.verified_outcome) {
    const next = await route(db, cfg, supply, { chainId: s.chain_id, hop: s.hop, respondentRef: s.respondent_ref, panel: s.panel, country: s.country, fromSession: s.id, fromRequest: r, trigger: outcome as 'terminate' | 'quota_full' });
    if (next) return { redirect: next.url };
    return endUrl(cfg, r, 'none');
  }
  if (!first) {
    // A repeat of the browser return: send them to where the first one went, without routing again.
    const prior = await one<{ to_session: string | null }>(db, 'SELECT to_session FROM routing_decisions WHERE from_session=$1 ORDER BY id DESC LIMIT 1', [s.id]);
    if (prior?.to_session) {
      const next = await one<{ token: string; request_id: string; status: string }>(db, 'SELECT token, request_id, status FROM sessions WHERE id=$1', [prior.to_session]);
      if (next && next.status === 'started') return { redirect: launchUrlFor(await loadRequest(db, next.request_id), next.token) };
    }
  }
  return endUrl(cfg, r, recorded === 'complete' ? 'complete' : 'none');
}

// ---- Verified outcome (server to server) ----------------------------------------------------

export async function verifiedOutcome(db: Db, body: { token?: unknown; status?: unknown; timestamp?: unknown; signature?: unknown }, nowMs = Date.now()) {
  const token = typeof body.token === 'string' ? body.token : '';
  const slug = typeof body.status === 'string' ? body.status : '';
  const ts = Number(body.timestamp);
  const signature = typeof body.signature === 'string' ? body.signature : '';
  const outcome = parseOutcome(slug);
  if (!token || !outcome || !Number.isInteger(ts)) throw new HttpError(400, 'token, status and timestamp are required');
  const found = await one<SessionRow & { outcome_secret: string | null }>(db,
    'SELECT s.*, h.outcome_secret FROM sessions s JOIN audience_requests r ON r.id=s.request_id JOIN service_clients h ON h.id=r.host_client_id WHERE s.token=$1', [token]);
  if (!found) throw new HttpError(404, 'Unknown token');
  if (!found.outcome_secret || Math.abs(unixSeconds(nowMs) - ts) > 300 || !safeEqualHex(outcomeSignature(found.outcome_secret, token, slug, ts), signature)) {
    throw new HttpError(401, 'Bad signature or timestamp');
  }

  return tx(db, async (c) => {
    const s = (await one<SessionRow>(c, 'SELECT * FROM sessions WHERE id=$1 FOR UPDATE', [found.id]))!;
    const r = await loadRequest(c, s.request_id, true);
    if (s.verified_outcome) {
      if (s.verified_outcome === outcome) return { recorded: false, status: s.status };
      if (!(s.verified_outcome === 'complete' && outcome === 'quality_fail')) throw new HttpError(409, `A different outcome (${s.verified_outcome}) is already recorded`);
    }
    const base = { sessionId: s.id, country: s.country, quotaIds: s.quota_ids, respondentRef: s.respondent_ref, panel: s.panel };

    if (outcome === 'complete') {
      const cells = await many<{ quota_key: string; target: number; count: number; hard: boolean }>(c,
        'SELECT quota_key, target, count, hard FROM quota_cells WHERE request_id=$1 AND quota_key = ANY($2) FOR UPDATE', [r.id, s.quota_ids]);
      if (cells.some((x) => x.hard && x.count >= x.target)) {
        await c.query("UPDATE sessions SET verified_outcome='quota_full', verified_at=now(), status='quota_full', overquota=true, ended_at=COALESCE(ended_at, now()) WHERE id=$1", [s.id]);
        await emit(c, r, 'survey.screenout', { ...base, outcome: 'quota_full', routedTo: null });
        return { recorded: true, status: 'quota_full', overquota: true };
      }
      await c.query('UPDATE quota_cells SET count = count + 1 WHERE request_id=$1 AND quota_key = ANY($2)', [r.id, s.quota_ids]);
      await c.query("UPDATE sessions SET verified_outcome='complete', verified_at=now(), status='complete', counted=true, ended_at=COALESCE(ended_at, now()) WHERE id=$1", [s.id]);
      const upd = (await one<{ completes: number }>(c, 'UPDATE audience_requests SET completes = completes + 1, updated_at=now() WHERE id=$1 RETURNING completes', [r.id]))!;
      await c.query('INSERT INTO rewards (session_id, request_id, respondent_ref, points, value) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (session_id) DO UPDATE SET status=\'pending\', updated_at=now()',
        [s.id, r.id, s.respondent_ref, r.spec.reward.points, r.spec.reward.value ?? null]);
      const loi = Math.round(((Date.now() - new Date(s.started_at).getTime()) / 60_000) * 10) / 10;
      const ev = await emit(c, r, 'survey.completed', {
        ...base, loiMinutes: loi, rewardPoints: r.spec.reward.points, verified: true,
        progress: { required: r.required_completes, completes: upd.completes, remaining: Math.max(0, r.required_completes - upd.completes) },
      });
      for (const cell of await many<{ quota_key: string; country: string | null; target: number }>(c,
        'UPDATE quota_cells SET full_announced=true WHERE request_id=$1 AND quota_key = ANY($2) AND count >= target AND NOT full_announced RETURNING quota_key, country, target', [r.id, s.quota_ids])) {
        await emit(c, r, 'quota.full', { quotaId: cell.quota_key, country: cell.country, target: cell.target }, ev.eventId);
      }
      await emitQuotaUpdate(c, r, ev.eventId);
      if (upd.completes >= r.required_completes && r.status !== 'closed') {
        await c.query("UPDATE audience_requests SET status='closed', updated_at=now() WHERE id=$1", [r.id]);
        await c.query("UPDATE batches SET status='cancelled' WHERE request_id=$1 AND status='scheduled'", [r.id]);
        await emit(c, r, 'project.closed', { reason: 'target reached', progress: { required: r.required_completes, completes: upd.completes, remaining: 0 } }, ev.eventId);
      }
      return { recorded: true, status: 'complete' };
    }

    if (outcome === 'quality_fail') {
      if (s.counted) {
        await c.query('UPDATE quota_cells SET count = greatest(0, count - 1), full_announced = false WHERE request_id=$1 AND quota_key = ANY($2)', [r.id, s.quota_ids]);
        await c.query('UPDATE audience_requests SET completes = greatest(0, completes - 1), updated_at=now() WHERE id=$1', [r.id]);
        await c.query("UPDATE rewards SET status='cancelled', updated_at=now() WHERE session_id=$1", [s.id]);
        if (r.status === 'closed') await c.query("UPDATE audience_requests SET status='live' WHERE id=$1 AND completes < required_completes", [r.id]);
      }
      await c.query("UPDATE sessions SET verified_outcome='quality_fail', verified_at=now(), status='quality_fail', counted=false, ended_at=COALESCE(ended_at, now()) WHERE id=$1", [s.id]);
      const ev = await emit(c, r, 'quality.failed', { ...base, reason: s.counted ? 'Rejected by the survey host after review' : 'Quality check failed in the survey' });
      if (s.counted) await emitQuotaUpdate(c, r, ev.eventId);
      return { recorded: true, status: 'quality_fail' };
    }

    await c.query('UPDATE sessions SET verified_outcome=$2, verified_at=now(), status=$2, ended_at=COALESCE(ended_at, now()) WHERE id=$1', [s.id, outcome]);
    const routed = await one<{ to_request: string | null }>(c, 'SELECT to_request FROM routing_decisions WHERE from_session=$1 ORDER BY id DESC LIMIT 1', [s.id]);
    await emit(c, r, 'survey.screenout', { ...base, outcome, routedTo: routed?.to_request ?? null });
    return { recorded: true, status: outcome };
  });
}
