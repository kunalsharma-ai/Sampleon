/** Audience Requests: create, read, change, feasibility, approval, lifecycle (§3–§4). */
import {
  AudienceRequestChange, AudienceRequestInput, newAudienceRequestId, type AudienceRequestSpec, type RequestStatus,
} from '@sampledge/contracts';
import type { Config } from '../config';
import { many, one, tx, type Db, type Queryable } from '../db';
import { actorId, badRequest, conflict, forbidden, notFound, parse, type Actor } from '../http';
import type { Supply360Client } from '../supply360';
import { emit, type RequestRef } from './events';

export interface RequestRow extends RequestRef {
  status: RequestStatus;
  organization_name: string;
  title: string | null;
  spec: AudienceRequestSpec;
  countries: string[];
  required_completes: number;
  completes: number;
  host_client_id: string;
  created_by: string;
  created_via: string;
  approved_by: string | null;
  approved_at: Date | null;
  decision_note: string | null;
  launch_mode: string | null;
  soft_launch_target: number | null;
  auto_batches: boolean;
  quota_sequence: number;
  created_at: Date;
  updated_at: Date;
}

export async function audit(q: Queryable, actor: string, action: string, requestId: string | null, detail: unknown = {}) {
  await q.query('INSERT INTO audit_log (actor, action, request_id, detail) VALUES ($1,$2,$3,$4)', [actor, action, requestId, JSON.stringify(detail)]);
}

export async function loadRequest(q: Queryable, id: string, lock = false): Promise<RequestRow> {
  const r = await one<RequestRow>(q, `SELECT * FROM audience_requests WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!r) throw notFound('Unknown audience request');
  return r;
}

/** Who may see a request: staff (org_viewer only its organisation), and the client of its source system. */
export function canSee(a: Actor, r: Pick<RequestRow, 'source_platform' | 'organization_id' | 'created_by'>) {
  if (a.kind === 'user') return a.role !== 'org_viewer' || a.organizationId === r.organization_id;
  if (a.system === 'SUPPLY360') return true;
  return a.system === r.source_platform || r.created_by === `client:${a.id}`;
}

export function assertSee(a: Actor, r: RequestRow) {
  if (!canSee(a, r)) throw notFound('Unknown audience request');
}

/** Turns a plain-language audience description into criteria checked against SUPPLY360's catalogue. */
export type Interpreter = (text: string) => Promise<{ criteria: AudienceRequestSpec['targeting']['criteria']; unmapped: string[]; engine: string; notes: string[]; problems: string[] }>;

export async function createRequest(db: Db, cfg: Config, actor: Actor, body: unknown, interpret?: Interpreter) {
  const spec = parse(AudienceRequestInput, body);
  if (actor.kind === 'client') {
    if (actor.system === 'SUPPLY360') throw forbidden('SUPPLY360 does not create audience requests');
    if (actor.system !== 'EXTERNAL' && spec.source.platform !== actor.system) throw forbidden(`A ${actor.system} client can only create ${actor.system} requests`);
  } else if (!['supply_admin', 'supply_manager'].includes(actor.role)) {
    throw forbidden('Needs supply_manager');
  }
  // A description without criteria (e.g. from PROJEXA or ZAPX) becomes draft criteria here. They
  // only take effect after a person reviews feasibility and approves; an empty or unusable result
  // is refused so a request can never silently target everyone.
  if (!spec.targeting.criteria.length) {
    const text = spec.targeting.naturalLanguage?.trim();
    if (!text) throw badRequest('Give targeting criteria or describe the audience');
    if (!interpret) throw badRequest('Targeting criteria are required');
    const draft = await interpret(text);
    if (!draft.criteria.length || draft.problems.length) {
      throw badRequest('The audience description could not be turned into filters; send targeting criteria', { unmapped: draft.unmapped, problems: draft.problems });
    }
    spec.targeting.criteria = draft.criteria;
    (spec.targeting as Record<string, unknown>).interpretation = { engine: draft.engine, unmapped: draft.unmapped, notes: draft.notes };
  }
  const id = newAudienceRequestId();
  const hostClientId = (body as { survey?: { hostId?: string } })?.survey?.hostId ?? cfg.defaultSurveyHost;
  return tx(db, async (c) => {
    const existing = await one<{ id: string; status: string }>(c, "SELECT id, status FROM audience_requests WHERE source_platform=$1 AND source_project_id=$2 AND survey_id=$3 AND status NOT IN ('closed','rejected','cancelled')", [spec.source.platform, spec.source.projectId, spec.source.surveyId]);
    if (existing) throw conflict('An open audience request already exists for this project and survey', { audienceRequestId: existing.id, status: existing.status });
    const r = await one<RequestRow>(
      c,
      `INSERT INTO audience_requests (id, status, source_platform, source_project_id, survey_id, organization_id, organization_name, title, spec, countries,
         required_completes, host_client_id, created_by, created_via)
       VALUES ($1,'submitted',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, spec.source.platform, spec.source.projectId, spec.source.surveyId, spec.organization.id, spec.organization.name, spec.title ?? null,
        JSON.stringify(spec), spec.countries, spec.requiredCompletes, hostClientId, actorId(actor), actor.kind === 'client' ? 'client' : 'console'],
    );
    await audit(c, actorId(actor), 'request.created', id, { source: spec.source });
    await emit(c, r!, 'audience_request.submitted', { title: spec.title ?? null, countries: spec.countries, requiredCompletes: spec.requiredCompletes, status: 'submitted' });
    return r!;
  });
}

const EDITABLE: RequestStatus[] = ['submitted', 'feasibility_ready', 'approved', 'soft_launch', 'live', 'paused'];

/** Approved project changes from the source system or a manager. Quota targets update in place. */
export async function changeRequest(db: Db, actor: Actor, id: string, body: unknown) {
  const change = parse(AudienceRequestChange, body);
  return tx(db, async (c) => {
    const r = await loadRequest(c, id, true);
    assertSee(actor, r);
    if (actor.kind === 'client' && actor.system !== r.source_platform) throw forbidden('Only the source system changes a request');
    if (actor.kind === 'user' && !['supply_admin', 'supply_manager'].includes(actor.role)) throw forbidden('Needs supply_manager');
    if (!EDITABLE.includes(r.status)) throw conflict(`A ${r.status} request cannot change`);
    const spec: AudienceRequestSpec = {
      ...r.spec,
      ...(change.requiredCompletes ? { requiredCompletes: change.requiredCompletes } : {}),
      ...(change.completesByCountry ? { completesByCountry: change.completesByCountry } : {}),
      ...(change.quotas ? { quotas: change.quotas } : {}),
      ...(change.fieldwork ? { fieldwork: change.fieldwork } : {}),
      survey: { ...r.spec.survey, ...(change.survey?.launchUrl ? { launchUrl: change.survey.launchUrl } : {}) },
    };
    const checked = parse(AudienceRequestInput, spec);
    await c.query('UPDATE audience_requests SET spec=$2, required_completes=$3, updated_at=now() WHERE id=$1', [id, JSON.stringify(checked), checked.requiredCompletes]);
    if (['approved', 'soft_launch', 'live', 'paused'].includes(r.status)) await syncQuotaCells(c, id, checked, await allocationTargets(c, id));
    await audit(c, actorId(actor), 'request.changed', id, change);
    const updated = await loadRequest(c, id);
    await emitQuotaUpdate(c, updated);
    return updated;
  });
}

// ---- Feasibility ----------------------------------------------------------------------------

export interface CountryFeasibility {
  eligible: number;
  reachable: number;
  missingProfile: Record<string, number>;
  responseRate: number;
  estimatedCompletes: number;
  target: number;
  invitesNeeded: number;
  shortfall: number;
  byPanel: Record<string, { eligible: number; reachable: number; estimatedCompletes: number; recommended: number }>;
}
export interface Feasibility {
  calculatedAt: string;
  feasible: boolean;
  eligible: number;
  reachable: number;
  estimatedCompletes: number;
  requiredCompletes: number;
  shortfall: number;
  invitesNeeded: number;
  fieldDaysAvailable: number;
  missingProfile: Record<string, number>;
  byCountry: Record<string, CountryFeasibility>;
  recommendedAllocation: Record<string, Record<string, number>>;
  assumptions: string[];
}

/** Share of delivered invitations that started a survey, from SAMPLEON history (≥200 invitations), else the default. */
async function responseRate(q: Queryable, cfg: Config, country: string, panel?: string) {
  const r = await one<{ delivered: string; started: string }>(
    q,
    `SELECT count(*) FILTER (WHERE i.status IN ('delivered','opened')) AS delivered,
            count(DISTINCT s.invitation_id) AS started
     FROM invitations i LEFT JOIN sessions s ON s.invitation_id = i.id
     WHERE i.country = $1 AND ($2::text IS NULL OR i.panel = $2)`,
    [country, panel ?? null],
  );
  const delivered = Number(r?.delivered ?? 0);
  return delivered >= 200 ? Math.max(0.01, Number(r!.started) / delivered) : cfg.defaultResponseRate;
}

/** Split `total` in proportion to `weights` (largest remainder), each capped at `caps`. */
export function apportion(total: number, weights: Record<string, number>, caps?: Record<string, number>): Record<string, number> {
  const keys = Object.keys(weights);
  const out: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  let left = total;
  for (let round = 0; round < 5 && left > 0; round++) {
    const open = keys.filter((k) => (caps?.[k] ?? Infinity) > out[k]! && weights[k]! > 0);
    const sum = open.reduce((s, k) => s + weights[k]!, 0);
    if (!sum) break;
    const shares = open.map((k) => ({ k, exact: (left * weights[k]!) / sum }));
    let given = 0;
    for (const s of shares) {
      const add = Math.min(Math.floor(s.exact), (caps?.[s.k] ?? Infinity) - out[s.k]!);
      out[s.k]! += add; given += add;
    }
    let rem = left - given;
    for (const s of shares.sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
      if (rem <= 0) break;
      if ((caps?.[s.k] ?? Infinity) > out[s.k]!) { out[s.k]! += 1; rem--; given++; }
    }
    left -= given;
    if (!given) break;
  }
  return out;
}

export async function calculateFeasibility(db: Db, cfg: Config, supply: Supply360Client, r: RequestRow): Promise<Feasibility> {
  const spec = r.spec;
  const ir = spec.expectedIncidence;
  const exclude = { audienceRequestIds: [...spec.exclusions.audienceRequestIds], surveyIds: [...spec.exclusions.surveyIds] };
  const fatigue = { maxInvites: cfg.fatigueMaxInvites, windowDays: cfg.fatigueWindowDays };
  const per: Record<string, CountryFeasibility> = {};
  for (const country of spec.countries) {
    const counts = await supply.count({ country, criteria: spec.targeting.criteria, exclude, fatigue, activeWithinDays: cfg.activeWithinDays }, r.id);
    const rr = await responseRate(db, cfg, country);
    const byPanel: CountryFeasibility['byPanel'] = {};
    for (const [panel, pc] of Object.entries(counts.byPanel)) {
      const prr = await responseRate(db, cfg, country, panel);
      byPanel[panel] = { eligible: pc.eligible, reachable: pc.reachable, estimatedCompletes: Math.floor(pc.reachable * prr * ir), recommended: 0 };
    }
    per[country] = {
      eligible: counts.eligible, reachable: counts.reachable, missingProfile: counts.missingProfile, responseRate: rr,
      estimatedCompletes: Math.floor(counts.reachable * rr * ir), target: 0, invitesNeeded: 0, shortfall: 0, byPanel,
    };
  }
  // Country targets: given per country, else spread evenly then moved to countries with spare capacity.
  const capacity = Object.fromEntries(Object.entries(per).map(([c, f]) => [c, f.estimatedCompletes]));
  let targets: Record<string, number>;
  if (spec.completesByCountry && Object.keys(spec.completesByCountry).length) {
    targets = Object.fromEntries(spec.countries.map((c) => [c, spec.completesByCountry![c] ?? 0]));
  } else {
    const even = apportion(spec.requiredCompletes, Object.fromEntries(spec.countries.map((c) => [c, 1])));
    const placed = Object.fromEntries(spec.countries.map((c) => [c, Math.min(even[c]!, capacity[c]!)]));
    const spill = spec.requiredCompletes - Object.values(placed).reduce((s, n) => s + n, 0);
    const spare = Object.fromEntries(spec.countries.map((c) => [c, capacity[c]! - placed[c]!]));
    const extra = spill > 0 ? apportion(spill, spare, spare) : {};
    targets = Object.fromEntries(spec.countries.map((c) => [c, placed[c]! + (extra[c] ?? 0)]));
    // Whatever cannot be placed stays on the even split, so the shortfall shows against a country.
    let unplaced = spec.requiredCompletes - Object.values(targets).reduce((s, n) => s + n, 0);
    for (const c of spec.countries) { if (unplaced <= 0) break; const add = Math.max(0, even[c]! - targets[c]!); const n = Math.min(add, unplaced); targets[c]! += n; unplaced -= n; }
  }
  const recommendedAllocation: Feasibility['recommendedAllocation'] = {};
  const missing: Record<string, number> = {};
  for (const [country, f] of Object.entries(per)) {
    f.target = targets[country] ?? 0;
    f.shortfall = Math.max(0, f.target - f.estimatedCompletes);
    f.invitesNeeded = Math.ceil(f.target / Math.max(0.0001, f.responseRate * ir));
    const panelWeights = Object.fromEntries(Object.entries(f.byPanel).map(([p, v]) => [p, v.estimatedCompletes]));
    const alloc = apportion(Math.min(f.target, f.estimatedCompletes), panelWeights, panelWeights);
    for (const [p, n] of Object.entries(alloc)) f.byPanel[p]!.recommended = n;
    recommendedAllocation[country] = alloc;
    for (const [k, n] of Object.entries(f.missingProfile)) missing[k] = (missing[k] ?? 0) + n;
  }
  const sum = (k: 'eligible' | 'reachable' | 'estimatedCompletes' | 'shortfall' | 'invitesNeeded') => Object.values(per).reduce((s, f) => s + f[k], 0);
  const days = Math.max(1, Math.round((Date.parse(spec.fieldwork.end) - Math.max(Date.now(), Date.parse(spec.fieldwork.start))) / 86_400_000) + 1);
  const shortfall = Math.max(0, spec.requiredCompletes - Object.values(per).reduce((s, f) => s + Math.min(f.target, f.estimatedCompletes), 0));
  return {
    calculatedAt: new Date().toISOString(),
    feasible: shortfall === 0,
    eligible: sum('eligible'),
    reachable: sum('reachable'),
    estimatedCompletes: sum('estimatedCompletes'),
    requiredCompletes: spec.requiredCompletes,
    shortfall,
    invitesNeeded: sum('invitesNeeded'),
    fieldDaysAvailable: days,
    missingProfile: missing,
    byCountry: per,
    recommendedAllocation,
    assumptions: [
      `Reachable = eligible, consented, active within ${cfg.activeWithinDays} days, under ${cfg.fatigueMaxInvites} invitations per ${cfg.fatigueWindowDays} days, not excluded`,
      `Estimated completes = reachable × response rate × incidence (${ir}); response rate from SampAudience history, default ${cfg.defaultResponseRate}`,
    ],
  };
}

export async function runFeasibility(db: Db, cfg: Config, supply: Supply360Client, actor: Actor, id: string) {
  const r = await loadRequest(db, id);
  assertSee(actor, r);
  if (!['submitted', 'feasibility_ready', 'approved', 'soft_launch', 'live', 'paused'].includes(r.status)) throw conflict(`A ${r.status} request has no feasibility`);
  const f = await calculateFeasibility(db, cfg, supply, r);
  return tx(db, async (c) => {
    const cur = await loadRequest(c, id, true);
    await c.query('INSERT INTO feasibility_snapshots (request_id, result) VALUES ($1,$2)', [id, JSON.stringify(f)]);
    if (cur.status === 'submitted') {
      await c.query("UPDATE audience_requests SET status='feasibility_ready', updated_at=now() WHERE id=$1", [id]);
      await c.query('DELETE FROM allocations WHERE request_id=$1', [id]);
      for (const [country, panels] of Object.entries(f.recommendedAllocation)) for (const [panel, n] of Object.entries(panels)) {
        await c.query('INSERT INTO allocations (request_id, country, panel, target) VALUES ($1,$2,$3,$4)', [id, country, panel, n]);
      }
    }
    await emit(c, cur, 'feasibility.calculated', {
      feasible: f.feasible, eligible: f.eligible, reachable: f.reachable, estimatedCompletes: f.estimatedCompletes, shortfall: f.shortfall,
      byCountry: Object.fromEntries(Object.entries(f.byCountry).map(([k, v]) => [k, { eligible: v.eligible, reachable: v.reachable, estimatedCompletes: v.estimatedCompletes }])),
    });
    await audit(c, actorId(actor), 'feasibility.calculated', id, { feasible: f.feasible, shortfall: f.shortfall });
    return f;
  });
}

// ---- Approval -------------------------------------------------------------------------------

export async function allocationTargets(q: Queryable, id: string): Promise<Record<string, number>> {
  const rows = await many<{ country: string; target: string }>(q, 'SELECT country, sum(target) AS target FROM allocations WHERE request_id=$1 GROUP BY country', [id]);
  return Object.fromEntries(rows.map((r) => [r.country, Number(r.target)]));
}

/** One cell per country (key country:XX, target = the country's completes) plus the request's quota definitions. */
export async function syncQuotaCells(q: Queryable, id: string, spec: AudienceRequestSpec, alloc: Record<string, number>) {
  const countryTargets = spec.completesByCountry && Object.keys(spec.completesByCountry).length
    ? spec.completesByCountry
    : Object.keys(alloc).length ? alloc : apportion(spec.requiredCompletes, Object.fromEntries(spec.countries.map((c) => [c, 1])));
  const keys: string[] = [];
  for (const country of spec.countries) {
    const key = `country:${country}`;
    keys.push(key);
    await q.query(
      `INSERT INTO quota_cells (request_id, quota_key, label, country, conditions, target, hard) VALUES ($1,$2,$3,$4,'[]',$5,true)
       ON CONFLICT (request_id, quota_key) DO UPDATE SET target = EXCLUDED.target, full_announced = quota_cells.full_announced AND quota_cells.count >= EXCLUDED.target`,
      [id, key, country, country, Math.max(0, countryTargets[country] ?? 0)],
    );
  }
  for (const qd of spec.quotas) {
    keys.push(qd.id);
    await q.query(
      `INSERT INTO quota_cells (request_id, quota_key, label, country, conditions, target, hard) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (request_id, quota_key) DO UPDATE SET target=EXCLUDED.target, conditions=EXCLUDED.conditions, hard=EXCLUDED.hard, label=EXCLUDED.label,
         full_announced = quota_cells.full_announced AND quota_cells.count >= EXCLUDED.target`,
      [id, qd.id, qd.label ?? qd.id, qd.country ?? null, JSON.stringify(qd.conditions), qd.target, qd.hard],
    );
  }
  // Removed quotas stop counting but keep their history.
  await q.query('UPDATE quota_cells SET target = count, hard = true WHERE request_id=$1 AND NOT (quota_key = ANY($2))', [id, keys]);
}

export async function decide(db: Db, actor: Actor, id: string, approve: boolean, body: { note?: string; allocation?: Record<string, Record<string, number>> }) {
  if (actor.kind !== 'user' || !['supply_admin', 'supply_approver'].includes(actor.role)) throw forbidden('Approval needs a supply_approver');
  return tx(db, async (c) => {
    const r = await loadRequest(c, id, true);
    if (r.status !== 'feasibility_ready') throw conflict(r.status === 'submitted' ? 'Calculate feasibility before deciding' : `A ${r.status} request cannot be decided`);
    if (r.created_by === actorId(actor)) throw forbidden('The requester cannot approve their own request');
    if (!approve) {
      await c.query("UPDATE audience_requests SET status='rejected', decision_note=$2, approved_by=$3, updated_at=now() WHERE id=$1", [id, body.note ?? null, actorId(actor)]);
      await audit(c, actorId(actor), 'request.rejected', id, { note: body.note });
      return loadRequest(c, id);
    }
    if (body.allocation) {
      await c.query('DELETE FROM allocations WHERE request_id=$1', [id]);
      for (const [country, panels] of Object.entries(body.allocation)) {
        if (!r.countries.includes(country)) throw badRequest(`${country} is not one of the request's countries`);
        for (const [panel, n] of Object.entries(panels)) {
          if (!Number.isInteger(n) || n < 0) throw badRequest('Allocation targets are whole numbers');
          await c.query('INSERT INTO allocations (request_id, country, panel, target) VALUES ($1,$2,$3,$4)', [id, country, panel, n]);
        }
      }
    }
    const alloc = await many<{ country: string; panel: string; target: number }>(c, 'SELECT country, panel, target FROM allocations WHERE request_id=$1', [id]);
    await c.query("UPDATE audience_requests SET status='approved', approved_by=$2, approved_at=now(), decision_note=$3, updated_at=now() WHERE id=$1", [id, actorId(actor), body.note ?? null]);
    // Country cells follow the request's country targets; the allocation decides which panels get invitations.
    await syncQuotaCells(c, id, r.spec, {});
    await audit(c, actorId(actor), 'request.approved', id, { allocation: alloc });
    const flat: Record<string, number> = {};
    for (const a of alloc) flat[`${a.country}:${a.panel}`] = a.target;
    await emit(c, r, 'audience.approved', { approvedBy: actor.name, allocation: flat });
    return loadRequest(c, id);
  });
}

// ---- Progress -------------------------------------------------------------------------------

export async function quotaFill(q: Queryable, id: string) {
  return many<{ quota_key: string; label: string | null; country: string | null; target: number; count: number; hard: boolean; full_announced: boolean; conditions: unknown }>(
    q, 'SELECT quota_key, label, country, target, count, hard, full_announced, conditions FROM quota_cells WHERE request_id=$1 ORDER BY id', [id],
  );
}

/** Absolute counters with a sequence number, so a late event never rolls a number back (§6.3). */
export async function emitQuotaUpdate(q: Queryable, r: RequestRow, causationId?: string) {
  const seq = await one<{ quota_sequence: number }>(q, 'UPDATE audience_requests SET quota_sequence = quota_sequence + 1 WHERE id=$1 RETURNING quota_sequence', [r.id]);
  const cur = await one<{ completes: number; required_completes: number }>(q, 'SELECT completes, required_completes FROM audience_requests WHERE id=$1', [r.id]);
  const cells = await quotaFill(q, r.id);
  const byCountry: Record<string, { target: number; completes: number }> = {};
  for (const c of cells.filter((c) => c.quota_key.startsWith('country:'))) byCountry[c.country!] = { target: c.target, completes: c.count };
  await emit(q, r, 'project.quota_updated', {
    progress: { required: cur!.required_completes, completes: cur!.completes, remaining: Math.max(0, cur!.required_completes - cur!.completes) },
    byCountry,
    quotas: cells.filter((c) => !c.quota_key.startsWith('country:')).map((c) => ({ id: c.quota_key, country: c.country, target: c.target, completes: c.count, full: c.count >= c.target })),
    sequence: seq!.quota_sequence,
  }, causationId);
}

export async function setStatus(db: Db, actor: Actor, id: string, to: 'paused' | 'resume' | 'closed' | 'cancelled', reason?: string) {
  return tx(db, async (c) => {
    const r = await loadRequest(c, id, true);
    assertSee(actor, r);
    if (actor.kind === 'client' && actor.system !== r.source_platform) throw forbidden('Only the source system can do that');
    if (actor.kind === 'user' && !['supply_admin', 'supply_manager'].includes(actor.role)) throw forbidden('Needs supply_manager');
    let next: RequestStatus;
    if (to === 'paused') { if (!['soft_launch', 'live'].includes(r.status)) throw conflict(`A ${r.status} request cannot pause`); next = 'paused'; }
    else if (to === 'resume') { if (r.status !== 'paused') throw conflict('Only a paused request resumes'); next = r.launch_mode === 'soft' ? 'soft_launch' : 'live'; }
    else if (to === 'cancelled') { if (!['submitted', 'feasibility_ready', 'approved'].includes(r.status)) throw conflict('Only a request that has not launched can be cancelled; close it instead'); next = 'cancelled'; }
    else { if (['closed', 'rejected', 'cancelled'].includes(r.status)) throw conflict(`Already ${r.status}`); next = 'closed'; }
    await c.query('UPDATE audience_requests SET status=$2, updated_at=now() WHERE id=$1', [id, next]);
    if (next === 'paused' || next === 'closed' || next === 'cancelled') await c.query("UPDATE batches SET status='cancelled' WHERE request_id=$1 AND status='scheduled'", [id]);
    await audit(c, actorId(actor), `request.${next}`, id, { reason });
    if (next === 'closed') {
      await emit(c, r, 'project.closed', { reason: reason ?? 'closed', progress: { required: r.required_completes, completes: r.completes, remaining: Math.max(0, r.required_completes - r.completes) } });
    }
    return loadRequest(c, id);
  });
}

/** Full view of a request for its owner or staff. Reward cost is hidden from org viewers and source systems. */
export async function requestView(q: Queryable, actor: Actor, r: RequestRow) {
  const [feas, alloc, cells, batches, outcomes, routing] = await Promise.all([
    one<{ result: Feasibility }>(q, 'SELECT result FROM feasibility_snapshots WHERE request_id=$1 ORDER BY id DESC LIMIT 1', [r.id]),
    many(q, 'SELECT country, panel, target FROM allocations WHERE request_id=$1 ORDER BY country, panel', [r.id]),
    quotaFill(q, r.id),
    many(q, 'SELECT id, mode, size, scheduled_at, auto, status, selected, delivered, suppressed, error, sent_at FROM batches WHERE request_id=$1 ORDER BY created_at', [r.id]),
    many<{ status: string; n: string }>(q, 'SELECT status, count(*) AS n FROM sessions WHERE request_id=$1 GROUP BY status', [r.id]),
    one<{ total: string; routed: string }>(q, 'SELECT count(*) AS total, count(to_request) AS routed FROM routing_decisions WHERE from_request=$1', [r.id]),
  ]);
  const showCost = actor.kind === 'user' && actor.role !== 'org_viewer';
  const spec = showCost ? r.spec : { ...r.spec, reward: { points: r.spec.reward.points } };
  return {
    audienceRequestId: r.id,
    status: r.status,
    source: { platform: r.source_platform, projectId: r.source_project_id, surveyId: r.survey_id },
    organization: { id: r.organization_id, name: r.organization_name },
    title: r.title,
    spec,
    requiredCompletes: r.required_completes,
    completes: r.completes,
    remaining: Math.max(0, r.required_completes - r.completes),
    approval: { approvedBy: r.approved_by, approvedAt: r.approved_at, note: r.decision_note },
    launch: { mode: r.launch_mode, softLaunchTarget: r.soft_launch_target, autoBatches: r.auto_batches },
    feasibility: feas?.result ?? null,
    allocation: alloc,
    quotas: cells.map((c) => ({ id: c.quota_key, label: c.label, country: c.country, target: c.target, completes: c.count, hard: c.hard, full: c.count >= c.target })),
    batches,
    outcomes: Object.fromEntries(outcomes.map((o) => [o.status, Number(o.n)])),
    routing: { decisions: Number(routing?.total ?? 0), routed: Number(routing?.routed ?? 0) },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
