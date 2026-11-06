/** Inbound events from PROJEXA, ZAPX and SUPPLY360 (§6). Deduped on eventId; applied once. */
import { parseEvent } from '@sampledge/contracts';
import { one, tx, type Db } from '../db';
import { badRequest, forbidden, type Actor } from '../http';
import { claimInbound, emit } from './events';
import { audit, type RequestRow } from './requests';

export async function receiveEvent(db: Db, actor: Actor, body: unknown) {
  if (actor.kind !== 'client') throw forbidden('Events come from signed service clients');
  const parsed = parseEvent(body);
  if (!parsed.ok) throw badRequest(`Invalid event: ${parsed.error}`);
  const e = parsed.event;
  if (e.source !== actor.system) throw forbidden(`Client ${actor.id} cannot send ${e.source} events`);
  return tx(db, async (c) => {
    if (!(await claimInbound(c, e))) return { status: 'duplicate', eventId: e.eventId };
    if (!parsed.known) return { status: 'ignored', eventId: e.eventId };
    const p = e.payload as Record<string, unknown>;
    switch (parsed.type) {
      case 'reward.eligibility_confirmed': {
        if (actor.system !== 'SUPPLY360') throw forbidden('Only SUPPLY360 confirms rewards');
        await c.query("UPDATE rewards SET status='confirmed', ledger_entry_id=$2, points=$3, updated_at=now() WHERE session_id=$1 AND status <> 'cancelled'", [p.sessionId, p.ledgerEntryId, p.points]);
        break;
      }
      case 'project.created': {
        await c.query(
          `INSERT INTO source_projects (source_platform, project_id, name, countries) VALUES ($1,$2,$3,$4)
           ON CONFLICT (source_platform, project_id) DO UPDATE SET name=EXCLUDED.name, countries=EXCLUDED.countries`,
          [actor.system, p.projectId, p.name, p.countries ?? []]);
        break;
      }
      case 'project.closed': {
        // Closing a project closes its open audience requests (by correlation id or project id).
        const projectId = e.subject.sourceProjectId ?? null;
        const rows = await c.query<RequestRow>(
          `UPDATE audience_requests SET status = CASE WHEN status IN ('submitted','feasibility_ready','approved') THEN 'cancelled' ELSE 'closed' END, updated_at=now()
           WHERE source_platform=$1 AND (id=$2 OR source_project_id=$3) AND status NOT IN ('closed','rejected','cancelled') RETURNING *`,
          [actor.system, e.correlationId, projectId]);
        await c.query("UPDATE source_projects SET closed_at=now() WHERE source_platform=$1 AND project_id=$2", [actor.system, projectId]);
        for (const r of rows.rows) {
          await c.query("UPDATE batches SET status='cancelled' WHERE request_id=$1 AND status='scheduled'", [r.id]);
          await audit(c, `client:${actor.id}`, 'request.closed_by_source', r.id, { eventId: e.eventId });
          if (r.status === 'closed') await emit(c, r, 'project.closed', { reason: (p.reason as string) ?? 'closed by source', progress: { required: r.required_completes, completes: r.completes, remaining: Math.max(0, r.required_completes - r.completes) } }, e.eventId);
        }
        break;
      }
      default:
        // Other known events (e.g. project.quota_updated) are outbound from SAMPLEON; changes come by PATCH.
        return { status: 'ignored', eventId: e.eventId };
    }
    return { status: 'processed', eventId: e.eventId };
  });
}

export async function outboxSigner(db: Db, clientId: string) {
  const c = await one<{ secrets: string[] }>(db, 'SELECT secrets FROM service_clients WHERE id=$1', [clientId]);
  return c?.secrets[0] ? { clientId: 'sampleon', secret: c.secrets[0] } : null;
}
