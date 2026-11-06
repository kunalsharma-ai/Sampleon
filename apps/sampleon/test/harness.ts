/**
 * Test harness: a fresh database, SAMPLEON on a random port, a stand-in for the SUPPLY360
 * eligibility & delivery API (§5.1) that checks signatures, and an event sink for source systems.
 * The full cross-product run against the real SUPPLY360 is in the e2e/ folder.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import {
  evaluate, outcomeSignature, parseEvent, signRequest, unixSeconds, verifyRequest,
  type AttributeDef, type Criterion, type EventEnvelope, type Profile,
} from '@sampledge/contracts';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { createPool, type Db } from '../src/db';
import { migrate } from '../src/migrate';
import { createUser, upsertClient } from '../src/admin';
import { tick } from '../src/worker';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://sampleon:sampleon@localhost:5432/postgres';
const TEST_DB = 'sampleon_test';

export const SECRETS = { supply360: 's360-secret', projexa: 'projexa-secret', zapx: 'zapx-secret', zapxOutcome: 'zapx-outcome-secret' };

const readBody = (req: IncomingMessage) => new Promise<string>((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => res(b)); });
const listen = (s: Server) => new Promise<number>((res) => s.listen(0, '127.0.0.1', () => res((s.address() as AddressInfo).port)));

export const CATALOGUE: AttributeDef[] = [
  { key: 'demo.gender', label: 'Gender', type: 'enum', values: ['female', 'male', 'other'], sensitivity: 'standard', synonyms: { female: ['women', 'woman'], male: ['men', 'man'] } },
  { key: 'demo.age', label: 'Age', type: 'number', sensitivity: 'standard' },
  { key: 'hcp.specialty', label: 'Medical specialty', type: 'enum', values: ['cardiology', 'oncology', 'general_practice', 'dermatology'], sensitivity: 'standard', synonyms: { cardiology: ['cardiologist', 'heart specialist'], oncology: ['oncologist'], general_practice: ['gp', 'general practitioner'] } },
  { key: 'b2b.years_experience', label: 'Years of professional experience', type: 'number', sensitivity: 'standard', synonyms: { _phrases: ['years of experience', 'experience', 'years in practice'] } },
  { key: 'b2b.role', label: 'Job role', type: 'enum', values: ['it_decision_maker', 'hr', 'finance'], sensitivity: 'standard', synonyms: { it_decision_maker: ['it decision maker', 'itdm'] } },
  // Same definition as SUPPLY360's catalogue: "professional" must not be read out of "years of professional experience".
  { key: 'panelist.segment', label: 'Panel segment', type: 'enum', values: ['consumer', 'professional', 'hcp', 'patient', 'caregiver'], sensitivity: 'standard', synonyms: { consumer: ['consumers', 'general population', 'gen pop'], professional: ['b2b', 'business professionals'], hcp: ['healthcare professionals', 'hcps', 'doctors', 'physicians'], caregiver: ['caregivers', 'carers'] } },
  { key: 'health.diabetes', label: 'Diagnosed with diabetes', type: 'boolean', sensitivity: 'health', synonyms: { true: ['diabetics', 'with diabetes'] } },
];

export interface FakeRespondent { ref: string; panel: string; country: string; consented: boolean; profile: Profile; invites: string[]; surveys: string[] }

/** In-memory SUPPLY360 stand-in. Same contract as the real service. */
export class FakeSupply360 {
  respondents: FakeRespondent[] = [];
  cards: { invitationId: string; respondentRef: string; cardUrl: string; audienceRequestId: string }[] = [];
  events: EventEnvelope[] = [];
  calls: string[] = [];
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    const v = verifyRequest({ headers: req.headers, method: req.method!, path: req.url!, body, secretsFor: (id) => (id === 'sampleon' ? [SECRETS.supply360] : []) });
    if (!v.ok) { res.writeHead(401).end(JSON.stringify({ error: v.reason })); return; }
    const path = req.url!.replace('/api/v1/s2s/supply', '');
    this.calls.push(`${req.method} ${path}`);
    const b = body ? JSON.parse(body) : {};
    const json = (x: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(x)); };
    if (path === '/attributes') return json({ attributes: CATALOGUE });
    if (path === '/eligibility/count') return json(this.count(b));
    if (path === '/eligibility/select') return json({ respondents: this.reachable(b).filter((r) => !b.panel || r.panel === b.panel).slice(0, b.limit).map((r) => ({ respondentRef: r.ref, panel: r.panel, country: r.country })) });
    if (path === '/eligibility/check') {
      const r = this.respondents.find((x) => x.ref === b.respondentRef);
      if (!r) return json({ eligible: false, reasons: ['unknown'], quotaIds: [], country: null, consented: false });
      const e = evaluate(r.profile, b.criteria as Criterion[]);
      return json({ eligible: e.eligible, reasons: [...e.missing, ...e.failed], quotaIds: (b.quotas ?? []).filter((q: { conditions: Criterion[] }) => evaluate(r.profile, q.conditions).eligible).map((q: { id: string }) => q.id), country: r.country, consented: r.consented });
    }
    if (path === '/deliveries') {
      return json({ results: b.items.map((i: { invitationId: string; respondentRef: string; cardUrl: string }) => {
        const r = this.respondents.find((x) => x.ref === i.respondentRef);
        if (!r?.consented) return { invitationId: i.invitationId, status: 'suppressed', reason: 'no consent' };
        r.invites.push(b.audienceRequestId);
        this.cards.push({ ...i, audienceRequestId: b.audienceRequestId });
        return { invitationId: i.invitationId, status: 'delivered' };
      }) });
    }
    if (path === '/events') { const p = parseEvent(JSON.parse(body)); if (p.ok) this.events.push(p.event); return json({ status: 'processed' }); }
    res.writeHead(404).end('{}');
  });

  private eligibleSet(b: { country: string; criteria: Criterion[] }) {
    return this.respondents.filter((r) => r.country === b.country && evaluate(r.profile, b.criteria).eligible);
  }
  reachable(b: { country: string; criteria: Criterion[]; exclude?: { audienceRequestIds?: string[]; surveyIds?: string[] }; fatigue?: { maxInvites: number } }) {
    return this.eligibleSet(b).filter((r) => r.consented
      && !(b.exclude?.audienceRequestIds ?? []).some((id) => r.invites.includes(id))
      && !(b.exclude?.surveyIds ?? []).some((id) => r.surveys.includes(id))
      && r.invites.length < (b.fatigue?.maxInvites ?? Infinity));
  }
  count(b: { country: string; criteria: Criterion[] }) {
    const el = this.eligibleSet(b);
    const re = this.reachable(b);
    const missing: Record<string, number> = {};
    for (const r of this.respondents.filter((r) => r.country === b.country)) {
      const e = evaluate(r.profile, b.criteria);
      if (!e.failed.length) for (const m of e.missing) missing[m] = (missing[m] ?? 0) + 1;
    }
    const byPanel: Record<string, { eligible: number; reachable: number }> = {};
    for (const r of el) (byPanel[r.panel] ??= { eligible: 0, reachable: 0 }).eligible++;
    for (const r of re) byPanel[r.panel]!.reachable++;
    return { eligible: el.length, reachable: re.length, missingProfile: missing, byPanel };
  }
}

/** Collects events delivered to a source system's webhook and checks SAMPLEON's signature. */
export class EventSink {
  events: EventEnvelope[] = [];
  rejected = 0;
  constructor(private secret: string) {}
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    const v = verifyRequest({ headers: req.headers, method: req.method!, path: req.url!, body, secretsFor: (id) => (id === 'sampleon' ? [this.secret] : []) });
    if (!v.ok) { this.rejected++; res.writeHead(401).end(); return; }
    const p = parseEvent(JSON.parse(body));
    if (p.ok && !this.events.some((e) => e.eventId === p.event.eventId)) this.events.push(p.event);
    res.writeHead(200).end('{}');
  });
  of(type: string) { return this.events.filter((e) => e.type === type); }
}

export interface Harness {
  db: Db; cfg: Config; base: string; supply: FakeSupply360; projexa: EventSink; zapx: EventSink;
  tokens: { admin: string; approver: string; manager: string; viewer: string; orgViewer: string };
  close(): Promise<void>;
  tick(): Promise<unknown>;
  drain(): Promise<void>;
  signed(client: 'projexa' | 'zapx' | 'supply360', method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<Response>;
  staff(token: string, method: string, path: string, body?: unknown): Promise<Response>;
  hostOutcome(token: string, status: string, secret?: string): Promise<Response>;
  follow(url: string): Promise<{ status: number; location: string | null; text: string }>;
}

export async function startHarness(over: Partial<Config> = {}): Promise<Harness> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const url = new URL(ADMIN_URL); url.pathname = `/${TEST_DB}`;

  const supply = new FakeSupply360();
  const projexa = new EventSink(SECRETS.projexa);
  const zapx = new EventSink(SECRETS.zapx);
  const [sp, pp, zp] = await Promise.all([listen(supply.server), listen(projexa.server), listen(zapx.server)]);

  const db = createPool(url.toString());
  await migrate(db);
  const cfg: Config = { ...loadConfig({ DATABASE_URL: url.toString() }), supply360Url: `http://127.0.0.1:${sp}`, supply360Secret: SECRETS.supply360, ...over };
  const { app, supply: client } = buildApp(db, cfg);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  cfg.publicUrl = base;

  await upsertClient(db, { id: 'projexa', system: 'PROJEXA', name: 'PROJEXA', webhookUrl: `http://127.0.0.1:${pp}/api/v1/integrations/sampleon/events`, secret: SECRETS.projexa });
  await upsertClient(db, { id: 'zapx', system: 'ZAPX', name: 'ZAPX', webhookUrl: `http://127.0.0.1:${zp}/api/v1/integrations/sampleon/events`, secret: SECRETS.zapx, outcomeSecret: SECRETS.zapxOutcome });
  await upsertClient(db, { id: 'supply360', system: 'SUPPLY360', name: 'SUPPLY360', webhookUrl: `http://127.0.0.1:${sp}/api/v1/s2s/supply/events`, secret: SECRETS.supply360 });
  const tokens = {
    admin: await createUser(db, { email: 'admin@test', name: 'Ada Admin', role: 'supply_admin' }),
    approver: await createUser(db, { email: 'approver@test', name: 'Avi Approver', role: 'supply_approver' }),
    manager: await createUser(db, { email: 'manager@test', name: 'Mo Manager', role: 'supply_manager' }),
    viewer: await createUser(db, { email: 'viewer@test', name: 'Vi Viewer', role: 'viewer' }),
    orgViewer: await createUser(db, { email: 'client@test', name: 'Cli Ent', role: 'org_viewer', organizationId: 'org_acme' }),
  };
  const secretOf = { projexa: SECRETS.projexa, zapx: SECRETS.zapx, supply360: SECRETS.supply360 };

  const h: Harness = {
    db, cfg, base, supply, projexa, zapx, tokens,
    async close() { await app.close(); await db.end(); for (const s of [supply.server, projexa.server, zapx.server]) s.close(); },
    tick: () => tick(db, cfg, client),
    async drain() { for (let i = 0; i < 5; i++) await tick(db, cfg, client); },
    signed(c, method, path, body, extra = {}) {
      const text = body === undefined ? '' : JSON.stringify(body);
      return fetch(base + path, { method, body: text || undefined, headers: { ...(text ? { 'content-type': 'application/json' } : {}), ...signRequest({ clientId: c, secret: secretOf[c], method, path, body: text }), ...extra } });
    },
    staff(token, method, path, body) {
      return fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) } });
    },
    hostOutcome(token, status, secret = SECRETS.zapxOutcome) {
      const timestamp = unixSeconds();
      return fetch(`${base}/api/v1/s2s/outcome`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, status, timestamp, signature: outcomeSignature(secret, token, status, timestamp) }) });
    },
    async follow(u) {
      const res = await fetch(u.startsWith('http') ? u : base + u, { redirect: 'manual' });
      return { status: res.status, location: res.headers.get('location'), text: await res.text() };
    },
  };
  return h;
}

/** Token the survey host received: the `token`/`rid` value in the launch URL. */
export function tokenFrom(location: string) {
  const u = new URL(location);
  return u.searchParams.get('rid') ?? u.searchParams.get('token')!;
}

export function requestBody(over: Record<string, unknown> = {}) {
  return {
    source: { platform: 'PROJEXA', projectId: 'PRJ-1045', surveyId: 'zsv_cardio' },
    organization: { id: 'org_acme', name: 'Acme Pharma' },
    title: 'Cardiology treatment study',
    countries: ['US', 'GB'],
    targeting: { criteria: [{ attribute: 'hcp.specialty', op: 'in', values: ['cardiology'] }, { attribute: 'b2b.years_experience', op: 'gte', value: 5 }] },
    requiredCompletes: 4,
    expectedIncidence: 0.8,
    loiMinutes: 15,
    reward: { points: 500, currency: 'USD', value: 5 },
    fieldwork: { start: '2026-01-01', end: '2099-12-31' },
    survey: { launchUrl: 'https://take.zapx.example/s/cardio?rid={token}', language: 'en' },
    ...over,
  };
}

export function seedRespondents(s: FakeSupply360) {
  const add = (ref: string, country: string, panel: string, profile: Profile, consented = true) => s.respondents.push({ ref, panel, country, consented, profile, invites: [], surveys: [] });
  for (let i = 0; i < 6; i++) add(`rsp_us_c${i}`, 'US', i % 2 ? 'mho' : 't2o', { 'hcp.specialty': 'cardiology', 'b2b.years_experience': 6 + i, 'demo.gender': i % 2 ? 'female' : 'male' });
  for (let i = 0; i < 4; i++) add(`rsp_gb_c${i}`, 'GB', 'mho', { 'hcp.specialty': 'cardiology', 'b2b.years_experience': 10, 'demo.gender': 'female' });
  add('rsp_us_junior', 'US', 't2o', { 'hcp.specialty': 'cardiology', 'b2b.years_experience': 2 });
  add('rsp_us_noexp', 'US', 't2o', { 'hcp.specialty': 'cardiology' });
  add('rsp_us_noconsent', 'US', 't2o', { 'hcp.specialty': 'cardiology', 'b2b.years_experience': 9 }, false);
  add('rsp_us_onc', 'US', 'mho', { 'hcp.specialty': 'oncology', 'b2b.years_experience': 9 });
}
