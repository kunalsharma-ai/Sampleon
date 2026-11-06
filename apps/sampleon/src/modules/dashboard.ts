/** Unified operations dashboard (§8). Org viewers see only their organisation and no reward cost. */
import { many, one, type Db } from '../db';
import { notFound, type Actor } from '../http';
import { canSee, loadRequest, requestView } from './requests';

const scope = (a: Actor) => (a.kind === 'user' && a.role === 'org_viewer' ? a.organizationId ?? '__none__' : null);

export async function summary(db: Db, a: Actor) {
  const org = scope(a);
  const p = [org];
  const W = '($1::text IS NULL OR r.organization_id = $1)';
  const [byPlatform, active, reach, quotas, invites, sessions, routing, remaining, pending, failures, rewards, projects] = await Promise.all([
    many<{ source_platform: string; n: string; open: string }>(db, `SELECT source_platform, count(*) AS n, count(*) FILTER (WHERE status NOT IN ('closed','rejected','cancelled')) AS open FROM audience_requests r WHERE ${W} GROUP BY source_platform`, p),
    one<{ allocations: string; surveys: string }>(db, `SELECT count(*) AS allocations, count(DISTINCT survey_id) AS surveys FROM audience_requests r WHERE status IN ('soft_launch','live') AND ${W}`, p),
    one<{ eligible: string; reachable: string }>(db, `SELECT coalesce(sum((f.result->>'eligible')::int),0) AS eligible, coalesce(sum((f.result->>'reachable')::int),0) AS reachable
       FROM audience_requests r JOIN LATERAL (SELECT result FROM feasibility_snapshots WHERE request_id=r.id ORDER BY id DESC LIMIT 1) f ON true
       WHERE r.status NOT IN ('closed','rejected','cancelled') AND ${W}`, p),
    many<{ country: string; target: string; completes: string }>(db, `SELECT q.country, sum(q.target) AS target, sum(q.count) AS completes FROM quota_cells q JOIN audience_requests r ON r.id=q.request_id
       WHERE q.quota_key LIKE 'country:%' AND r.status IN ('soft_launch','live','paused') AND ${W} GROUP BY q.country ORDER BY q.country`, p),
    many<{ status: string; n: string }>(db, `SELECT i.status, count(*) AS n FROM invitations i JOIN audience_requests r ON r.id=i.request_id WHERE ${W} GROUP BY i.status`, p),
    many<{ status: string; n: string }>(db, `SELECT s.status, count(*) AS n FROM sessions s JOIN audience_requests r ON r.id=s.request_id WHERE ${W} GROUP BY s.status`, p),
    one<{ total: string; routed: string }>(db, `SELECT count(*) AS total, count(d.to_request) AS routed FROM routing_decisions d JOIN audience_requests r ON r.id=d.from_request WHERE ${W}`, p),
    one<{ n: string }>(db, `SELECT coalesce(sum(greatest(0, required_completes - completes)),0) AS n FROM audience_requests r WHERE status IN ('approved','soft_launch','live','paused') AND ${W}`, p),
    one<{ n: string }>(db, `SELECT count(*) AS n FROM audience_requests r WHERE status='feasibility_ready' AND ${W}`, p),
    org ? Promise.resolve(null) : one<{ dead: string; errors: string; pending: string }>(db, `SELECT (SELECT count(*) FROM outbox WHERE status='dead') AS dead,
       (SELECT count(*) FROM integration_errors WHERE NOT resolved AND created_at > now() - interval '7 days') AS errors,
       (SELECT count(*) FROM outbox WHERE status='pending' AND attempts > 0) AS pending`),
    org ? Promise.resolve(null) : one<{ pending_points: string; confirmed_points: string; pending_value: string; confirmed_value: string }>(db,
      `SELECT coalesce(sum(points) FILTER (WHERE status='pending'),0) AS pending_points, coalesce(sum(points) FILTER (WHERE status='confirmed'),0) AS confirmed_points,
              coalesce(sum(value) FILTER (WHERE status='pending'),0) AS pending_value, coalesce(sum(value) FILTER (WHERE status='confirmed'),0) AS confirmed_value FROM rewards`),
    many<{ source_platform: string; n: string }>(db, 'SELECT source_platform, count(*) AS n FROM source_projects WHERE closed_at IS NULL GROUP BY source_platform'),
  ]);
  const sess = Object.fromEntries(sessions.map((s) => [s.status, Number(s.n)]));
  const started = Object.values(sess).reduce((s, n) => s + n, 0);
  const finished = started - (sess.started ?? 0) - (sess.pending_verification ?? 0);
  const inv = Object.fromEntries(invites.map((s) => [s.status, Number(s.n)]));
  const plat = (k: string) => byPlatform.find((b) => b.source_platform === k);
  return {
    generatedAt: new Date().toISOString(),
    scope: org ? { organizationId: org } : 'all',
    requests: {
      projexa: { total: Number(plat('PROJEXA')?.n ?? 0), open: Number(plat('PROJEXA')?.open ?? 0), projectsKnown: Number(projects.find((x) => x.source_platform === 'PROJEXA')?.n ?? 0) },
      zapx: { total: Number(plat('ZAPX')?.n ?? 0), open: Number(plat('ZAPX')?.open ?? 0), projectsKnown: Number(projects.find((x) => x.source_platform === 'ZAPX')?.n ?? 0) },
      external: { total: Number(plat('EXTERNAL')?.n ?? 0), open: Number(plat('EXTERNAL')?.open ?? 0) },
    },
    activeAllocations: Number(active?.allocations ?? 0),
    activeSurveys: Number(active?.surveys ?? 0),
    audience: { eligible: Number(reach?.eligible ?? 0), reachable: Number(reach?.reachable ?? 0), source: 'latest feasibility from SUPPLY360 for open requests' },
    countryQuotas: quotas.map((q) => ({ country: q.country, target: Number(q.target), completes: Number(q.completes), pct: Number(q.target) ? Math.round((Number(q.completes) / Number(q.target)) * 1000) / 10 : 0 })),
    invitations: { delivered: (inv.delivered ?? 0) + (inv.opened ?? 0), opened: inv.opened ?? 0, suppressed: inv.suppressed ?? 0, pending: inv.pending ?? 0 },
    participation: { started, inProgress: sess.started ?? 0, awaitingVerification: sess.pending_verification ?? 0, outcomes: sess },
    completionRate: finished ? Math.round(((sess.complete ?? 0) / finished) * 1000) / 10 : null,
    routing: { decisions: Number(routing?.total ?? 0), routed: Number(routing?.routed ?? 0), successRate: Number(routing?.total) ? Math.round((Number(routing!.routed) / Number(routing!.total)) * 1000) / 10 : null },
    remainingSample: Number(remaining?.n ?? 0),
    pendingApprovals: Number(pending?.n ?? 0),
    integrationFailures: failures ? { deadLetters: Number(failures.dead), recentErrors: Number(failures.errors), retrying: Number(failures.pending) } : null,
    rewardLiabilities: rewards ? { pendingPoints: Number(rewards.pending_points), confirmedPoints: Number(rewards.confirmed_points), pendingValue: Number(rewards.pending_value), confirmedValue: Number(rewards.confirmed_value) } : null,
  };
}

export async function listRequests(db: Db, a: Actor, f: { platform?: string; status?: string; country?: string }) {
  const org = scope(a);
  const rows = await many<{ id: string; status: string; source_platform: string; source_project_id: string; survey_id: string; organization_id: string; organization_name: string; title: string | null; countries: string[]; required_completes: number; completes: number; created_at: Date; created_by: string }>(db,
    `SELECT id, status, source_platform, source_project_id, survey_id, organization_id, organization_name, title, countries, required_completes, completes, created_at, created_by
     FROM audience_requests r WHERE ($1::text IS NULL OR organization_id=$1) AND ($2::text IS NULL OR source_platform=$2) AND ($3::text IS NULL OR status=$3)
       AND ($4::text IS NULL OR $4 = ANY(countries)) ORDER BY created_at DESC LIMIT 200`,
    [org, f.platform ?? null, f.status ?? null, f.country ?? null]);
  return rows.filter((r) => canSee(a, r)).map((r) => ({ ...r, remaining: Math.max(0, r.required_completes - r.completes) }));
}

export async function requestDetail(db: Db, a: Actor, id: string) {
  const r = await loadRequest(db, id);
  if (!canSee(a, r)) throw notFound('Unknown audience request');
  const view = await requestView(db, a, r);
  const byCountry = await many<{ country: string; status: string; n: string }>(db, 'SELECT country, status, count(*) AS n FROM sessions WHERE request_id=$1 GROUP BY country, status', [id]);
  const chains = await many(db, `SELECT d.chain_id, d.from_session, d.to_request, d.trigger, d.considered, d.reasons, d.created_at FROM routing_decisions d WHERE d.from_request=$1 ORDER BY d.id DESC LIMIT 50`, [id]);
  const events = a.kind === 'user' && a.role !== 'org_viewer'
    ? await many(db, 'SELECT type, destination, status, attempts, last_status, last_error, created_at, delivered_at FROM outbox WHERE correlation_id=$1 ORDER BY id DESC LIMIT 100', [id])
    : [];
  return { ...view, sessionsByCountry: byCountry.map((x) => ({ ...x, n: Number(x.n) })), routingDecisions: chains, events };
}

export async function failures(db: Db) {
  return {
    deadLetters: await many(db, "SELECT id, type, correlation_id, destination, attempts, last_status, last_error, created_at FROM outbox WHERE status='dead' ORDER BY id DESC LIMIT 100"),
    errors: await many(db, 'SELECT id, system, operation, request_id, error, created_at FROM integration_errors WHERE NOT resolved ORDER BY id DESC LIMIT 100'),
  };
}

export async function replay(db: Db, outboxId: number) {
  const r = await one<{ id: string }>(db, "UPDATE outbox SET status='pending', attempts=0, next_attempt_at=now(), last_error=NULL WHERE id=$1 AND status='dead' RETURNING id", [outboxId]);
  if (!r) throw notFound('No dead letter with that id');
  return { replayed: true };
}
