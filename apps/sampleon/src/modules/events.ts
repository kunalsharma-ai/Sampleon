/**
 * Outbound events: transactional outbox, at-least-once delivery with backoff and dead letter
 * (§6.3). Inbound events: signature checked by auth, envelope and payload validated, deduped on
 * eventId in the inbox table, applied in the same transaction as the inbox insert.
 */
import {
  makeEvent, signRequest, withoutRespondent, type EventEnvelope, type EventType, type SystemName,
} from '@sampledge/contracts';
import type { z } from 'zod';
import type { EVENT_PAYLOADS } from '@sampledge/contracts';
import { many, one, type Db, type Queryable } from '../db';

export interface RequestRef {
  id: string;
  source_platform: string;
  source_project_id: string;
  survey_id: string;
  organization_id: string;
  spec?: { callbackUrl?: string };
}

/** Event types that concern the respondent and therefore go to SUPPLY360 with respondent fields. */
const TO_SUPPLY360: EventType[] = ['audience_request.submitted', 'audience.approved', 'survey.started', 'survey.completed', 'survey.screenout', 'quality.failed', 'project.closed'];

interface Destination { id: string; url: string; respondentLevel: boolean }

async function destinations(q: Queryable, req: RequestRef, type: EventType): Promise<Destination[]> {
  const clients = await many<{ id: string; system: string; webhook_url: string | null }>(q, "SELECT id, system, webhook_url FROM service_clients WHERE active AND webhook_url IS NOT NULL AND system IN ($1, 'SUPPLY360')", [req.source_platform]);
  const out: Destination[] = [];
  const source = clients.find((c) => c.system === req.source_platform);
  const sourceUrl = req.spec?.callbackUrl ?? source?.webhook_url ?? null;
  if (sourceUrl && type !== 'reward.eligibility_confirmed') out.push({ id: source?.id ?? `callback:${req.source_platform}`, url: sourceUrl, respondentLevel: false });
  if (TO_SUPPLY360.includes(type)) for (const c of clients.filter((c) => c.system === 'SUPPLY360')) out.push({ id: c.id, url: c.webhook_url!, respondentLevel: true });
  return out;
}

/** Write an event to the outbox in the caller's transaction. Returns the envelope. */
export async function emit<T extends EventType>(
  q: Queryable,
  req: RequestRef,
  type: T,
  payload: z.input<(typeof EVENT_PAYLOADS)[T]>,
  causationId?: string | null,
): Promise<EventEnvelope> {
  const env = makeEvent({
    type,
    source: 'SAMPLEON',
    correlationId: req.id,
    causationId,
    subject: { sourcePlatform: req.source_platform as never, sourceProjectId: req.source_project_id, surveyId: req.survey_id, organizationId: req.organization_id },
    payload,
  });
  for (const d of await destinations(q, req, type)) {
    const body = d.respondentLevel ? env : withoutRespondent(env);
    await q.query(
      'INSERT INTO outbox (event_id, type, correlation_id, destination, url, envelope) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [env.eventId, type, req.id, d.id, d.url, JSON.stringify(body)],
    );
  }
  return env;
}

export const MAX_ATTEMPTS = 8;
export const retryDelayMs = (attempt: number, random = Math.random) =>
  Math.round(Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempt - 1)) * (1 + 0.2 * (random() * 2 - 1)));

/** Deliver due outbox rows. Safe with several workers (SKIP LOCKED + lease). */
export async function deliverOutbox(db: Db, secretFor: (clientId: string) => Promise<{ clientId: string; secret: string } | null>, limit = 50): Promise<number> {
  const rows = await many<{ id: string; destination: string; url: string; envelope: EventEnvelope; attempts: number; event_id: string }>(
    db,
    `UPDATE outbox SET locked_until = now() + interval '30 seconds'
     WHERE id IN (SELECT id FROM outbox WHERE status = 'pending' AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
                  ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, destination, url, envelope, attempts, event_id`,
    [limit],
  );
  for (const r of rows) {
    const body = JSON.stringify(r.envelope);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const signer = await secretFor(r.destination);
      const u = new URL(r.url);
      const headers: Record<string, string> = { 'content-type': 'application/json', 'Idempotency-Key': r.event_id };
      if (signer) Object.assign(headers, signRequest({ clientId: signer.clientId, secret: signer.secret, method: 'POST', path: u.pathname + u.search, body }));
      const res = await fetch(r.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000), redirect: 'manual' });
      status = res.status;
      if (!res.ok) error = (await res.text()).slice(0, 500);
    } catch (e) {
      error = (e as Error).message;
    }
    const attempts = r.attempts + 1;
    if (status !== null && status >= 200 && status < 300) {
      await db.query("UPDATE outbox SET status='delivered', attempts=$2, last_status=$3, last_error=NULL, delivered_at=now(), locked_until=NULL WHERE id=$1", [r.id, attempts, status]);
      continue;
    }
    const permanent = status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
    const dead = permanent || attempts >= MAX_ATTEMPTS;
    await db.query(
      `UPDATE outbox SET status=$2, attempts=$3, last_status=$4, last_error=$5, locked_until=NULL,
         next_attempt_at = now() + ($6::text || ' milliseconds')::interval WHERE id=$1`,
      [r.id, dead ? 'dead' : 'pending', attempts, status, error ?? `HTTP ${status}`, String(retryDelayMs(attempts))],
    );
  }
  return rows.length;
}

/** Record an inbound event once. Returns false when it was already processed. */
export async function claimInbound(q: Queryable, e: EventEnvelope): Promise<boolean> {
  const r = await one<{ event_id: string }>(q, 'INSERT INTO inbox (event_id, source, type, correlation_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING event_id', [e.eventId, e.source, e.type, e.correlationId]);
  return r !== null;
}

export type { SystemName };
