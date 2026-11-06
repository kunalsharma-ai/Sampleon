/**
 * Soft and full launch, batches (manual and automatic), and invitation orchestration.
 * SAMPLEON decides who is invited and when; SUPPLY360 selects reachable respondents and
 * delivers the survey cards and permitted e-mail.
 */
import { opaqueToken, prefixedId } from '@sampledge/contracts';
import { z } from 'zod';
import type { Config } from '../config';
import { many, one, tx, type Db, type Queryable } from '../db';
import { actorId, conflict, forbidden, parse, type Actor } from '../http';
import type { Supply360Client } from '../supply360';
import { emit } from './events';
import { apportion, assertSee, audit, loadRequest, type Feasibility, type RequestRow } from './requests';

const LaunchBody = z.object({
  mode: z.enum(['soft', 'full']),
  softLaunchCompletes: z.number().int().min(1).max(100_000).optional(),
  batches: z.array(z.object({ size: z.number().int().min(1).max(1_000_000), at: z.string().datetime().optional() })).max(100).optional(),
  auto: z.boolean().optional(),
});

async function latestFeasibility(q: Queryable, id: string) {
  return (await one<{ result: Feasibility }>(q, 'SELECT result FROM feasibility_snapshots WHERE request_id=$1 ORDER BY id DESC LIMIT 1', [id]))?.result ?? null;
}

/** Invitations needed for `completes` more completes, from the latest feasibility response rate. */
async function invitesFor(q: Queryable, cfg: Config, r: RequestRow, completes: number) {
  const f = await latestFeasibility(q, r.id);
  const rates = f ? Object.values(f.byCountry).map((c) => c.responseRate) : [];
  const rr = rates.length ? rates.reduce((s, n) => s + n, 0) / rates.length : cfg.defaultResponseRate;
  return Math.ceil(completes / Math.max(0.0001, rr * r.spec.expectedIncidence));
}

async function insertBatch(q: Queryable, r: RequestRow, mode: 'soft' | 'full', size: number, at: Date, auto: boolean) {
  const id = prefixedId('bat');
  await q.query('INSERT INTO batches (id, request_id, mode, size, scheduled_at, auto) VALUES ($1,$2,$3,$4,$5,$6)', [id, r.id, mode, size, at, auto]);
  await emit(q, r, 'batch.scheduled', { batchId: id, size, scheduledAt: at.toISOString(), mode });
  return id;
}

export async function launch(db: Db, cfg: Config, actor: Actor, id: string, body: unknown) {
  if (actor.kind !== 'user' || !['supply_admin', 'supply_manager'].includes(actor.role)) throw forbidden('Launching needs a supply_manager');
  const b = parse(LaunchBody, body);
  return tx(db, async (c) => {
    const r = await loadRequest(c, id, true);
    assertSee(actor, r);
    const allowed = b.mode === 'soft' ? ['approved'] : ['approved', 'soft_launch', 'paused'];
    if (!allowed.includes(r.status)) throw conflict(r.status === 'feasibility_ready' || r.status === 'submitted' ? 'A person must approve the audience before launch' : `A ${r.status} request cannot start a ${b.mode} launch`);
    const softTarget = b.mode === 'soft' ? b.softLaunchCompletes ?? Math.max(10, Math.ceil(r.required_completes * 0.1)) : null;
    const status = b.mode === 'soft' ? 'soft_launch' : 'live';
    await c.query('UPDATE audience_requests SET status=$2, launch_mode=$3, soft_launch_target=COALESCE($4, soft_launch_target), auto_batches=$5, updated_at=now() WHERE id=$1',
      [id, status, b.mode, softTarget, b.auto ?? !b.batches]);
    await c.query("UPDATE batches SET status='cancelled' WHERE request_id=$1 AND status='scheduled'", [id]);
    const fresh = await loadRequest(c, id);
    const batchIds: string[] = [];
    if (b.batches?.length) {
      for (const x of b.batches) batchIds.push(await insertBatch(c, fresh, b.mode, x.size, x.at ? new Date(x.at) : new Date(), false));
    } else {
      const goal = b.mode === 'soft' ? softTarget! : Math.max(0, r.required_completes - r.completes);
      const size = Math.min(cfg.maxBatchSize, await invitesFor(c, cfg, fresh, goal));
      if (size > 0) batchIds.push(await insertBatch(c, fresh, b.mode, size, new Date(), true));
    }
    await audit(c, actorId(actor), `request.launch.${b.mode}`, id, { batches: batchIds, softTarget });
    return { status, batches: batchIds, softLaunchTarget: softTarget };
  });
}

/** Send every due batch: select reachable respondents per country and panel, record invitations, deliver. */
export async function runDueBatches(db: Db, cfg: Config, supply: Supply360Client): Promise<number> {
  const due = await many<{ id: string; request_id: string; size: number; mode: string }>(
    db,
    `UPDATE batches SET status='sending' WHERE id IN (
       SELECT b.id FROM batches b JOIN audience_requests r ON r.id = b.request_id
       WHERE b.status='scheduled' AND b.scheduled_at <= now() AND r.status IN ('soft_launch','live')
       ORDER BY b.scheduled_at LIMIT 5 FOR UPDATE OF b SKIP LOCKED)
     RETURNING id, request_id, size, mode`,
  );
  for (const b of due) {
    try {
      await sendBatch(db, cfg, supply, b);
    } catch (e) {
      await db.query("UPDATE batches SET status='failed', error=$2 WHERE id=$1", [b.id, (e as Error).message.slice(0, 500)]);
    }
  }
  return due.length;
}

async function sendBatch(db: Db, cfg: Config, supply: Supply360Client, b: { id: string; request_id: string; size: number }) {
  const r = await loadRequest(db, b.request_id);
  const alloc = await many<{ country: string; panel: string; target: number }>(db, 'SELECT country, panel, target FROM allocations WHERE request_id=$1 AND target > 0', [r.id]);
  const cells = await many<{ country: string; target: number; count: number }>(db, "SELECT country, target, count FROM quota_cells WHERE request_id=$1 AND quota_key LIKE 'country:%'", [r.id]);
  // Countries still needing completes share the batch in proportion to what they still need.
  const need = Object.fromEntries(cells.map((c) => [c.country, Math.max(0, c.target - c.count)]));
  const perCountry = apportion(b.size, need);
  const exclude = { audienceRequestIds: [r.id, ...r.spec.exclusions.audienceRequestIds], surveyIds: [r.survey_id, ...r.spec.exclusions.surveyIds] };
  const fatigue = { maxInvites: cfg.fatigueMaxInvites, windowDays: cfg.fatigueWindowDays };
  const expiresAt = new Date(Date.parse(r.spec.fieldwork.end) + 86_400_000).toISOString();
  let selected = 0, delivered = 0, suppressed = 0;
  for (const [country, n] of Object.entries(perCountry)) {
    if (n <= 0) continue;
    const panels = alloc.filter((a) => a.country === country);
    const perPanel = panels.length ? apportion(n, Object.fromEntries(panels.map((p) => [p.panel, p.target]))) : { '': n };
    for (const [panel, k] of Object.entries(perPanel)) {
      if (k <= 0) continue;
      const sel = await supply.select({ country, criteria: r.spec.targeting.criteria, exclude, fatigue, activeWithinDays: cfg.activeWithinDays, limit: k, ...(panel ? { panel } : {}) }, r.id);
      if (!sel.respondents.length) continue;
      const invites: { id: string; token: string; respondentRef: string; panel: string }[] = [];
      await tx(db, async (c) => {
        for (const p of sel.respondents) {
          const id = prefixedId('inv');
          const token = opaqueToken();
          const ins = await one<{ id: string }>(c,
            'INSERT INTO invitations (id, request_id, batch_id, respondent_ref, panel, country, token) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (request_id, respondent_ref) DO NOTHING RETURNING id',
            [id, r.id, b.id, p.respondentRef, p.panel, p.country, token]);
          if (ins) invites.push({ id, token, respondentRef: p.respondentRef, panel: p.panel });
        }
      });
      selected += invites.length;
      if (!invites.length) continue;
      const result = await supply.deliver(r.id, r.survey_id, invites.map((i) => ({
        invitationId: i.id, respondentRef: i.respondentRef, panel: i.panel, cardUrl: `${cfg.publicUrl}/go/${i.token}`,
        title: r.title ?? 'New survey for you', loiMinutes: r.spec.loiMinutes, rewardPoints: r.spec.reward.points, expiresAt, channels: ['card', 'email'],
      })));
      await tx(db, async (c) => {
        for (const res of result.results) {
          await c.query('UPDATE invitations SET status=$2, suppress_reason=$3 WHERE id=$1 AND request_id=$4', [res.invitationId, res.status, res.reason ?? null, r.id]);
          if (res.status === 'delivered') delivered++; else suppressed++;
        }
      });
    }
  }
  await tx(db, async (c) => {
    await c.query("UPDATE batches SET status='sent', selected=$2, delivered=$3, suppressed=$4, sent_at=now() WHERE id=$1", [b.id, selected, delivered, suppressed]);
    await emit(c, r, 'invitation.delivered', { batchId: b.id, delivered, suppressed });
  });
}

/**
 * Automatic scheduling: for live or soft-launch requests with auto batches, add the next batch
 * when the last one went out more than AUTO_BATCH_INTERVAL_MINUTES ago and completes are still
 * needed. Stops on its own at the soft-launch target or the full target.
 */
export async function scheduleAutoBatches(db: Db, cfg: Config): Promise<number> {
  const rows = await many<RequestRow & { last_sent: Date | null; pending: string; open_sessions: string }>(
    db,
    `SELECT r.*, (SELECT max(sent_at) FROM batches b WHERE b.request_id=r.id) AS last_sent,
            (SELECT count(*) FROM batches b WHERE b.request_id=r.id AND b.status IN ('scheduled','sending')) AS pending,
            (SELECT count(*) FROM sessions s WHERE s.request_id=r.id AND s.status IN ('started','pending_verification')) AS open_sessions
     FROM audience_requests r WHERE r.status IN ('soft_launch','live') AND r.auto_batches`,
  );
  let created = 0;
  for (const r of rows) {
    if (Number(r.pending) > 0) continue;
    if (r.last_sent && Date.now() - new Date(r.last_sent).getTime() < cfg.autoBatchIntervalMinutes * 60_000) continue;
    const goal = r.status === 'soft_launch' ? (r.soft_launch_target ?? 0) : r.required_completes;
    const missing = goal - r.completes - Number(r.open_sessions) * r.spec.expectedIncidence;
    if (missing <= 0) continue;
    const size = Math.min(cfg.maxBatchSize, await invitesFor(db, cfg, r, Math.ceil(missing)));
    if (size <= 0) continue;
    await tx(db, async (c) => { await insertBatch(c, r, r.status === 'soft_launch' ? 'soft' : 'full', size, new Date(), true); });
    created++;
  }
  return created;
}

export async function scheduleBatch(db: Db, actor: Actor, id: string, body: unknown) {
  if (actor.kind !== 'user' || !['supply_admin', 'supply_manager'].includes(actor.role)) throw forbidden('Needs supply_manager');
  const b = parse(z.object({ size: z.number().int().min(1).max(1_000_000), at: z.string().datetime().optional() }), body);
  return tx(db, async (c) => {
    const r = await loadRequest(c, id, true);
    if (!['soft_launch', 'live'].includes(r.status)) throw conflict('Batches can only be scheduled for a launched request');
    const batchId = await insertBatch(c, r, r.status === 'soft_launch' ? 'soft' : 'full', b.size, b.at ? new Date(b.at) : new Date(), false);
    await audit(c, actorId(actor), 'batch.scheduled', id, { batchId, size: b.size });
    return { batchId };
  });
}
