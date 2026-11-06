#!/usr/bin/env node
/**
 * Cross-service end-to-end run of both Sampledge workflows with the real services:
 *
 *   1. PROJEXA project → SAMPLEON → SUPPLY360 → panel card → ZAPX survey → SAMPLEON → PROJEXA
 *   2. Independent ZAPX survey → SAMPLEON → SUPPLY360 → panel card → ZAPX survey → SAMPLEON → ZAPX
 *
 * It creates four empty databases, migrates and seeds them, registers the service clients, starts
 * SAMPLEON, SUPPLY360, ZAPX and PROJEXA as separate processes on 127.0.0.1, drives both workflows
 * over HTTP exactly as the products and a respondent's browser would, checks every system's
 * records, and stops the services. Nothing is mocked.
 *
 * Needs: built checkouts of the four repositories and a PostgreSQL superuser.
 *   SUPPLY360_DIR=../Sampledge-full-Supply-CRM ZAPX_DIR=../Sampledge-ZAPX PROJEXA_DIR=../Projecxa \
 *   PG_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres node e2e/ecosystem/run.mjs
 * See e2e/ecosystem/README.md.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { request } from 'node:http';
import { mkdirSync, readFileSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const dir = (v, d) => resolve(process.env[v] ?? d);
const SUPPLY360_DIR = dir('SUPPLY360_DIR', join(root, '../sampledge-full-supply-crm'));
const ZAPX_DIR = dir('ZAPX_DIR', join(root, '../sampledge-zapx'));
const PROJEXA_DIR = dir('PROJEXA_DIR', join(root, '../projecxa'));
const PG_ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const LOGS = resolve(process.env.E2E_LOG_DIR ?? join(root, 'e2e/ecosystem/logs'));
mkdirSync(LOGS, { recursive: true });

const PORT = { sampleon: 4600, supply360: 4610, zapx: 4620, projexa: 4630 };
const url = (s) => `http://127.0.0.1:${PORT[s]}`;
const dbUrl = (name) => { const u = new URL(PG_ADMIN_URL); u.pathname = `/${name}`; return u.toString(); };
const DB = { sampleon: 'sampleon_e2e', supply360: 'supply360_e2e', zapx: 'zapx_e2e', projexa: 'projexa_e2e' };

// One secret per pair of systems (docs/ECOSYSTEM_ARCHITECTURE.md §5.0).
const SECRET = {
  supply360: 'e2e-supply360-sampleon-shared-secret-0123456789',
  projexa: 'e2e-projexa-client-secret-at-sampleon-0123456789',
  zapx: 'e2e-zapx-client-secret-at-sampleon-0123456789',
  zapxOutcome: 'e2e-zapx-outcome-secret-at-sampleon-0123456789',
  panels: { t2o: 'e2e-panel-cards-t2o-0123456789', mfr: 'e2e-panel-cards-mfr-0123456789', mho: 'e2e-panel-cards-mho-0123456789' },
};
const JWT = 'e2e-jwt-secret-not-for-production-0123456789abcdef';
const PROJEXA_ADMIN = { email: 'pm@projexa-e2e.test', password: 'Correct-Horse-Battery-9!' };

const children = [];
const step = (m) => console.log(`\n▸ ${m}`);
const ok = (m) => console.log(`  ✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts, env: { ...process.env, ...opts.env } });
}

function start(name, cmd, args, cwd, env) {
  const log = createWriteStream(join(LOGS, `${name}.log`));
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.pipe(log); p.stderr.pipe(log);
  p.on('exit', (code) => { if (code && !stopping) console.error(`  ✗ ${name} exited with ${code}; see ${join(LOGS, `${name}.log`)}`); });
  children.push(p);
}
let stopping = false;
function stopAll() { stopping = true; for (const c of children) c.kill('SIGTERM'); }
process.on('exit', stopAll);

async function waitFor(name, u, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u); if (r.status < 500) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${name} did not start; see ${join(LOGS, `${name}.log`)}`);
}

async function until(what, fn, tries = 80, ms = 500) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (last) return last;
    await sleep(ms);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * Plain HTTP client (node:http). Not fetch: fetch adds browser headers such as Sec-Fetch-Mode,
 * and services rightly treat those callers as browsers (e.g. ZAPX then keeps the session in a cookie).
 */
function http(method, u, { body, headers = {}, redirect = 'follow' } = {}, hops = 0) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolveP, reject) => {
    const req = request(u, { method, headers: { ...(text ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } : {}), ...headers } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const location = res.headers.location ?? null;
        if (redirect === 'follow' && location && res.statusCode >= 300 && res.statusCode < 400 && hops < 5) {
          resolveP(http('GET', new URL(location, u).toString(), { headers, redirect }, hops + 1));
          return;
        }
        let json = null; try { json = data ? JSON.parse(data) : null; } catch { json = null; }
        resolveP({ status: res.statusCode, json, text: data, location });
      });
    });
    req.on('error', reject);
    if (text) req.write(text);
    req.end();
  });
}
const expectOk = (r, what) => { assert.ok(r.status >= 200 && r.status < 300, `${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`); return r.json; };

/** Panel-website signature for the SUPPLY360 card feed (Sampledge service signature, §5.0). */
function panelHeaders(panel, method, path) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', SECRET.panels[panel]).update(`${ts}.${method}.${path}.${createHash('sha256').update('').digest('hex')}`).digest('hex');
  return { 'X-Sampledge-Client': panel, 'X-Sampledge-Timestamp': ts, 'X-Sampledge-Signature': `v1=${sig}` };
}

// ---------------------------------------------------------------------------------------------

async function setUp() {
  step('Databases');
  const admin = new pg.Client({ connectionString: PG_ADMIN_URL });
  await admin.connect();
  for (const name of Object.values(DB)) {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  }
  await admin.end();
  ok(Object.values(DB).join(', '));

  step('Migrations and seed data');
  run('npx', ['prisma', 'migrate', 'deploy'], { cwd: join(SUPPLY360_DIR, 'apps/api'), env: { DATABASE_URL: dbUrl(DB.supply360) } });
  run('node', ['dist/seed.js'], { cwd: join(SUPPLY360_DIR, 'apps/api'), env: { DATABASE_URL: dbUrl(DB.supply360), JWT_SECRET: JWT } });
  // A few known, recently active cardiologists on My Health Opinions, so the run does not depend on
  // the random seed. They live only in SUPPLY360, like every other respondent.
  const sdb = new pg.Client({ connectionString: dbUrl(DB.supply360) });
  await sdb.connect();
  const tenantId = (await sdb.query(`SELECT id FROM "Tenant" WHERE slug='sampledge-demo'`)).rows[0].id;
  const e2ePanelists = [['e2e-us-1', 'US', 12], ['e2e-us-2', 'US', 9], ['e2e-us-3', 'US', 20], ['e2e-gb-1', 'GB', 7], ['e2e-de-1', 'DE', 15]];
  for (const [id, country, years] of e2ePanelists) {
    await sdb.query(`INSERT INTO "Panelist" (id, "tenantId", brand, handle, country, "ageBand", gender, segment, status, "qualityScore", "profileCompletion", "lastActiveAt", "joinedAt")
      VALUES ($1,$2,'myhealthopinions',$3,$4,'45-54','female','hcp','active',0.95,0.9,now(),now() - interval '200 days')`, [id, tenantId, id.toUpperCase(), country]);
    for (const purpose of ['research_participation', 'health_data']) {
      await sdb.query(`INSERT INTO "Consent" (id, "panelistId", purpose, granted, at) VALUES (gen_random_uuid()::text, $1, $2, true, now() - interval '100 days')`, [id, purpose]);
    }
    await sdb.query(`INSERT INTO "PanelistAttribute" (id, "tenantId", "panelistId", key, "valueText") VALUES (gen_random_uuid()::text, $1, $2, 'hcp.specialty', 'cardiology')`, [tenantId, id]);
    await sdb.query(`INSERT INTO "PanelistAttribute" (id, "tenantId", "panelistId", key, "valueNum") VALUES (gen_random_uuid()::text, $1, $2, 'b2b.years_experience', $3)`, [tenantId, id, years]);
  }
  await sdb.end();
  ok('SUPPLY360 migrated and seeded with synthetic panelists (three panel websites), plus five e2e cardiologists');
  run('npx', ['prisma', 'migrate', 'deploy'], { cwd: join(ZAPX_DIR, 'packages/db'), env: { DATABASE_URL: dbUrl(DB.zapx) } });
  ok('ZAPX migrated');
  run('npx', ['prisma', 'migrate', 'deploy'], { cwd: join(PROJEXA_DIR, 'apps/api'), env: { DATABASE_URL: dbUrl(DB.projexa) } });
  run('npx', ['ts-node', '--transpile-only', 'prisma/create-admin.ts', '--org-name', 'Frequent Research', '--email', PROJEXA_ADMIN.email, '--name', 'Project Manager'],
    { cwd: join(PROJEXA_DIR, 'apps/api'), env: { DATABASE_URL: dbUrl(DB.projexa), ADMIN_PASSWORD: PROJEXA_ADMIN.password } });
  ok('PROJEXA migrated, organization and admin created');

  const adminJs = join(root, 'apps/sampleon/dist/src/admin.js');
  const env = { DATABASE_URL: dbUrl(DB.sampleon) };
  run('node', [adminJs, 'client', 'supply360', 'SUPPLY360', 'SUPPLY360', `${url('supply360')}/api/v1/s2s/supply/events`, SECRET.supply360], { env });
  run('node', [adminJs, 'client', 'projexa', 'PROJEXA', 'PROJEXA', `${url('projexa')}/api/v1/integrations/sampleon/events`, SECRET.projexa], { env });
  run('node', [adminJs, 'client', 'zapx', 'ZAPX', 'ZAPX', `${url('zapx')}/api/v1/sampleon/events`, SECRET.zapx, SECRET.zapxOutcome], { env });
  const token = (out) => out.match(/(son_[A-Za-z0-9_-]+)/)[1];
  const staff = {
    manager: token(run('node', [adminJs, 'user', 'manager@sampleon-e2e.test', 'Supply Manager', 'supply_manager'], { env })),
    approver: token(run('node', [adminJs, 'user', 'approver@sampleon-e2e.test', 'Supply Approver', 'supply_approver'], { env })),
  };
  ok('SAMPLEON migrated; clients supply360, projexa, zapx (survey host) and two staff users registered');

  step('Starting the four services');
  start('sampleon', 'node', ['apps/sampleon/dist/src/main.js'], root, {
    DATABASE_URL: dbUrl(DB.sampleon), PORT: String(PORT.sampleon), HOST: '127.0.0.1', PUBLIC_URL: url('sampleon'),
    SUPPLY360_URL: url('supply360'), SUPPLY360_SECRET: SECRET.supply360, WORKER_INTERVAL_MS: '300', AI_PROVIDER: 'rules',
  });
  start('supply360', 'node', ['dist/main.js'], join(SUPPLY360_DIR, 'apps/api'), {
    DATABASE_URL: dbUrl(DB.supply360), PORT: String(PORT.supply360), JWT_SECRET: JWT, WORKER_INLINE: 'true', NODE_ENV: 'development',
    SAMPLEON_URL: url('sampleon'), SAMPLEON_SECRET: SECRET.supply360,
    PANEL_CARDS_SECRET_T2O: SECRET.panels.t2o, PANEL_CARDS_SECRET_MFR: SECRET.panels.mfr, PANEL_CARDS_SECRET_MHO: SECRET.panels.mho,
  });
  start('zapx', 'node', ['dist/main.js'], join(ZAPX_DIR, 'apps/api'), {
    DATABASE_URL: dbUrl(DB.zapx), API_PORT: String(PORT.zapx), JWT_SECRET: JWT, NODE_ENV: 'development', ALLOW_SIGNUP: 'true',
    RUNTIME_BASE_URL: 'http://127.0.0.1:4621', CALLBACK_WORKER: 'on', CALLBACK_POLL_MS: '300', CALLBACK_ALLOW_PRIVATE_HOSTS: 'true',
    SAMPLEON_URL: url('sampleon'), SAMPLEON_CLIENT_ID: 'zapx', SAMPLEON_CLIENT_SECRET: SECRET.zapx, SAMPLEON_OUTCOME_SECRET: SECRET.zapxOutcome,
  });
  start('projexa', 'node', ['dist/main.js'], join(PROJEXA_DIR, 'apps/api'), {
    DATABASE_URL: dbUrl(DB.projexa), PORT: String(PORT.projexa), JWT_SECRET: JWT, PUBLIC_BASE_URL: url('projexa'), NODE_ENV: 'development',
    CALLBACK_WORKER_ENABLED: 'false', MONITOR_ENABLED: 'false', REPORT_SCHEDULER_ENABLED: 'false', REDIRECT_SCHEDULER_ENABLED: 'false',
    ZOHO_BOOKS_SCHEDULER_ENABLED: 'false', PRIVACY_SCHEDULER_ENABLED: 'false', AUTOMATION_SCHEDULER_ENABLED: 'false', PUSH_SCHEDULER_ENABLED: 'false',
    SAMPLEON_URL: url('sampleon'), SAMPLEON_CLIENT_ID: 'projexa', SAMPLEON_CLIENT_SECRET: SECRET.projexa,
  });
  await Promise.all([
    waitFor('sampleon', `${url('sampleon')}/health`), waitFor('supply360', `${url('supply360')}/api/v1/health`),
    waitFor('zapx', `${url('zapx')}/api/health`), waitFor('projexa', `${url('projexa')}/api/v1/auth/me`),
  ]);
  ok(`SAMPLEON ${url('sampleon')} · SUPPLY360 ${url('supply360')} · ZAPX ${url('zapx')} · PROJEXA ${url('projexa')}`);
  return staff;
}

// ---- Product helpers ----------------------------------------------------------------------------

const demo = JSON.parse(readFileSync(join(ZAPX_DIR, 'docs/examples/demo-screener.json'), 'utf8'));

async function zapxSignup() {
  const r = expectOk(await http('POST', `${url('zapx')}/api/auth/register`, { body: { organization: 'Frequent Research Programming', name: 'Programmer', email: 'programmer@zapx-e2e.test', password: 'correct-horse-battery' } }), 'ZAPX sign-up');
  const auth = { Authorization: `Bearer ${r.token}` };
  const z = (method, p, body) => http(method, `${url('zapx')}/api${p}`, { body, headers: auth });
  return z;
}

async function zapxSurvey(z, projectName, name) {
  const projectId = expectOk(await z('POST', '/projects', { name: projectName }), 'ZAPX project').id;
  const surveyId = expectOk(await z('POST', `/projects/${projectId}/surveys`, { name }), 'ZAPX survey').id;
  expectOk(await z('PUT', `/surveys/${surveyId}/draft`, { definition: demo }), 'ZAPX draft');
  expectOk(await z('POST', `/surveys/${surveyId}/publish`), 'ZAPX publish');
  return { projectId, surveyId };
}

async function projexaLogin() {
  const r = expectOk(await http('POST', `${url('projexa')}/api/v1/auth/login`, { body: PROJEXA_ADMIN }), 'PROJEXA sign-in');
  const auth = { Authorization: `Bearer ${r.token}` };
  return (method, p, body) => http(method, `${url('projexa')}/api/v1${p}`, { body, headers: auth });
}

const sampleon = (token) => (method, p, body) => http(method, `${url('sampleon')}${p}`, { body, headers: { Authorization: `Bearer ${token}` } });

/** Human review in SAMPLEON: feasibility, approval by a second person, launch. */
async function reviewAndLaunch(staff, id, batchSize) {
  const m = sampleon(staff.manager), a = sampleon(staff.approver);
  const req = expectOk(await m('GET', `/api/v1/audience-requests/${id}`), 'SAMPLEON request');
  ok(`SAMPLEON criteria for review: ${JSON.stringify(req.targeting?.criteria ?? req.spec?.targeting?.criteria ?? req.criteria)}`);
  const f = expectOk(await m('POST', `/api/v1/audience-requests/${id}/feasibility`), 'feasibility');
  const reachable = Object.values(f.byCountry ?? {}).reduce((s, c) => s + (c.reachable ?? 0), 0);
  ok(`feasibility: ${JSON.stringify(Object.fromEntries(Object.entries(f.byCountry ?? {}).map(([k, v]) => [k, { eligible: v.eligible, reachable: v.reachable }])))}`);
  assert.ok(reachable > 0, 'SUPPLY360 found reachable respondents');
  assert.equal((await m('POST', `/api/v1/audience-requests/${id}/launch`, { mode: 'full' })).status, 409, 'no invitations before approval');
  expectOk(await a('POST', `/api/v1/audience-requests/${id}/approve`, { note: 'Audience checked' }), 'approve');
  ok('approved by a second person; launch before approval was refused');
  expectOk(await m('POST', `/api/v1/audience-requests/${id}/launch`, { mode: 'full', batches: [{ size: batchSize }] }), 'launch');
  const sent = await until('the batch to be sent', async () => {
    const r = expectOk(await m('GET', `/api/v1/audience-requests/${id}`), 'request');
    return r.batches?.find((b) => b.status === 'sent') ?? null;
  });
  ok(`batch sent: ${sent.selected} selected, ${sent.delivered} cards delivered, ${sent.suppressed} suppressed`);
  assert.ok(sent.delivered > 0);
}

/** A panelist opens their card on the panel website and takes the ZAPX survey to the end. */
async function respondent(supplyDb, id, skipRefs = new Set()) {
  const card = (await supplyDb.query(`SELECT id, "panelistId", panel, "cardUrl" FROM "SurveyCard" WHERE "audienceRequestId"=$1 AND status='open' ORDER BY "createdAt"`, [id])).rows.find((c) => !skipRefs.has(c.panelistId));
  assert.ok(card, 'a delivered survey card');
  const feedPath = `/api/v1/s2s/supply/panel/${card.panel}/cards?respondentRef=${encodeURIComponent(card.panelistId)}`;
  const feed = expectOk(await http('GET', `${url('supply360')}${feedPath}`, { headers: panelHeaders(card.panel, 'GET', feedPath) }), 'panel card feed');
  const shown = feed.cards.find((c) => c.id === card.id);
  assert.ok(shown, 'the panel website shows the card');
  ok(`panel ${card.panel} shows the card to ${card.panelistId}`);

  const go = await http('GET', shown.url, { redirect: 'manual' });
  assert.equal(go.status, 302, `card link redirects to the survey: ${go.text.slice(0, 200)}`);
  const entry = new URL(go.location);
  const surveyId = entry.pathname.split('/').pop();
  const query = Object.fromEntries(entry.searchParams);
  assert.equal(query.vid, 'SAMPLEON');
  assert.match(query.uid, /\S/);
  ok(`SAMPLEON session ${query.uid.slice(0, 10)}… sent to ZAPX survey ${surveyId}`);

  const s = expectOk(await http('POST', `${url('zapx')}/api/public/s/${surveyId}/start`, { body: { query } }), 'ZAPX start');
  const answer = async (pageId, answers) => expectOk(await http('POST', `${url('zapx')}/api/public/r/${s.token}/answers`, { body: { pageId, answers } }), `ZAPX answer ${pageId}`);
  await answer('P1', { AGE: 40, GENDER: 2 });
  await answer('P2', { AWARE: [99] });
  const done = await answer('P4', { COMMENTS: 'fine' });
  assert.equal(done.redirectUrl, `${url('sampleon')}/r/complete?token=${encodeURIComponent(query.uid)}`);
  const back = await http('GET', done.redirectUrl, { redirect: 'manual' });
  assert.ok(back.status === 200 || back.status === 302, `browser return: ${back.status}`);
  ok('completed in ZAPX; browser returned to SAMPLEON');
  return { panelistId: card.panelistId, sessionToken: query.uid };
}

// ---- Workflows ----------------------------------------------------------------------------------

async function main() {
  const staff = await setUp();
  const supplyDb = new pg.Client({ connectionString: dbUrl(DB.supply360) });
  await supplyDb.connect();
  const sampleonDb = new pg.Client({ connectionString: dbUrl(DB.sampleon) });
  await sampleonDb.connect();
  const zapx = await zapxSignup();

  // ===== Workflow 1 ==============================================================================
  step('Workflow 1: PROJEXA project → SAMPLEON → SUPPLY360 → panel → ZAPX → SAMPLEON → PROJEXA');
  const linked = await zapxSurvey(zapx, 'PRJ-1045 programming', 'Cardiology treatment study');
  const { launchUrl } = expectOk(await zapx('POST', `/surveys/${linked.surveyId}/sampleon/connect`), 'ZAPX connect');
  ok(`ZAPX survey ${linked.surveyId} ready for SAMPLEON respondents: ${launchUrl}`);

  const px = await projexaLogin();
  const clientId = expectOk(await px('POST', '/clients', { name: 'Acme Pharma', code: 'ACME', contacts: [{ name: 'Pat' }] }), 'PROJEXA client').id;
  const project = expectOk(await px('POST', '/projects', {
    name: 'Cardiology treatment study', category: 'Healthcare', clientId, fieldStartAt: new Date().toISOString().slice(0, 10), fieldEndAt: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
    defaults: { language: 'en', loiMinutes: 15, irPercent: 60, cpi: 45, targetCompletes: 2, liveSurveyUrl: launchUrl.replace('{token}', '{session_token}') },
    countries: [{ countryCode: 'US' }, { countryCode: 'GB', targetCompletes: 1 }, { countryCode: 'DE', language: 'de', targetCompletes: 1 }],
  }), 'PROJEXA project');
  ok(`PROJEXA project ${project.projectCode} (US 2, GB 1, DE 1 completes)`);
  const submitted = expectOk(await px('POST', `/projects/${project.id}/sampleon/audience-requests`, {
    surveyId: linked.surveyId, launchUrl, rewardPoints: 1500,
    targeting: { naturalLanguage: `Find 1,500 cardiologists in the USA, UK and Germany with at least five years of professional experience for PROJEXA Project ${project.projectCode}.` },
  }), 'PROJEXA → SAMPLEON audience request');
  const ar1 = submitted.audienceRequest.audienceRequestId ?? submitted.audienceRequest.id;
  assert.match(ar1, /^AR-[0-9A-HJKMNP-TV-Z]{26}$/);
  ok(`Audience Request ${ar1} created from PROJEXA (status ${submitted.audienceRequest.status})`);

  await reviewAndLaunch(staff, ar1, 40);
  const r1 = await respondent(supplyDb, ar1);

  const progress1 = await until('PROJEXA to receive the verified complete', async () => {
    const v = expectOk(await px('GET', `/projects/${project.id}/sampleon`), 'PROJEXA view');
    const row = v.requests.find((x) => x.audienceRequestId === ar1);
    return row && row.completes >= 1 ? row : null;
  });
  ok(`PROJEXA shows ${progress1.completes}/${progress1.requiredCompletes} completes, status ${progress1.status} (from SAMPLEON events)`);
  const report1 = expectOk(await sampleon(staff.manager)('GET', `/api/v1/audience-requests/${ar1}/report`), 'SAMPLEON report');
  assert.equal(report1.participation.completes, 1, 'one verified complete in SAMPLEON');
  ok('SAMPLEON counted the complete only after ZAPX’s signed S2S confirmation');

  const part1 = await until('SUPPLY360 participation and reward', async () => (await supplyDb.query(`SELECT status, "rewardEntryId" FROM "Participation" WHERE "audienceRequestId"=$1 AND "panelistId"=$2`, [ar1, r1.panelistId])).rows.find((p) => p.status === 'complete' && p.rewardEntryId) ?? null);
  const entry = (await supplyDb.query(`SELECT points, kind FROM "IncentiveEntry" WHERE id=$1`, [part1.rewardEntryId])).rows[0];
  ok(`SUPPLY360 recorded the participation and posted ${entry.points} reward points`);
  await until('SAMPLEON to receive the reward confirmation', async () => (await sampleonDb.query(`SELECT 1 FROM inbox WHERE type='reward.eligibility_confirmed' AND correlation_id=$1`, [ar1])).rowCount > 0);
  ok('SUPPLY360 confirmed reward eligibility back to SAMPLEON');
  const pxEvents = (await sampleonDb.query(`SELECT type, status FROM outbox WHERE correlation_id=$1 AND destination='projexa' ORDER BY id`, [ar1])).rows;
  assert.ok(pxEvents.every((e) => e.status === 'delivered'), JSON.stringify(pxEvents));
  ok(`events to PROJEXA, all delivered: ${[...new Set(pxEvents.map((e) => e.type))].join(', ')}`);

  // Approved change in PROJEXA reaches SAMPLEON.
  const p = expectOk(await px('GET', `/projects/${project.id}`), 'project');
  const us = p.countries.find((c) => c.countryCode === 'US');
  expectOk(await px('PATCH', `/projects/${project.id}/countries/${us.id}`, { targetCompletes: 3 }), 'PROJEXA change');
  expectOk(await px('POST', `/projects/${project.id}/sampleon/${progress1.id}/sync`), 'PROJEXA → SAMPLEON change');
  const changed = expectOk(await sampleon(staff.manager)('GET', `/api/v1/audience-requests/${ar1}`), 'request');
  assert.equal(changed.requiredCompletes, 5);
  ok('approved PROJEXA target change (US 2 → 3) applied in SAMPLEON: 5 completes required');

  // ===== Workflow 2 ==============================================================================
  step('Workflow 2: independent ZAPX survey → SAMPLEON → SUPPLY360 → panel → ZAPX → SAMPLEON → ZAPX');
  const indie = await zapxSurvey(zapx, 'Independent DIY study', 'US cardiologist pulse');
  const sub2 = expectOk(await zapx('POST', `/surveys/${indie.surveyId}/sampleon/audience-requests`, {
    countries: ['US'], requiredCompletes: 1, expectedIncidence: 0.6, loiMinutes: 10, reward: { points: 800 },
    fieldwork: { start: new Date().toISOString().slice(0, 10), end: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10) },
    targeting: { naturalLanguage: 'Cardiologists in the USA with at least five years of professional experience' },
  }), 'ZAPX → SAMPLEON audience request');
  const ar2 = sub2.audienceRequest.audienceRequestId ?? sub2.audienceRequest.id;
  ok(`Audience Request ${ar2} created by ZAPX with no PROJEXA project`);
  await reviewAndLaunch(staff, ar2, 20);
  await respondent(supplyDb, ar2, new Set([r1.panelistId]));
  const zrow = await until('ZAPX to see the request close at its target', async () => {
    const v = expectOk(await zapx('GET', `/surveys/${indie.surveyId}/sampleon`), 'ZAPX view');
    const row = v.requests.find((x) => x.audienceRequestId === ar2);
    return row && row.status === 'closed' ? row : null;
  });
  ok(`ZAPX shows ${zrow.completes}/${zrow.requiredCompletes} completes, status ${zrow.status} (SAMPLEON closed it at target)`);
  const pxView = expectOk(await px('GET', `/projects/${project.id}/sampleon`), 'PROJEXA view');
  assert.ok(!pxView.requests.some((x) => x.audienceRequestId === ar2), 'PROJEXA is not involved in workflow 2');
  assert.equal((await sampleonDb.query(`SELECT count(*)::int AS n FROM outbox WHERE correlation_id=$1 AND destination='projexa'`, [ar2])).rows[0].n, 0);
  ok('no PROJEXA project, record or event for the independent survey');

  step('Dashboard');
  const dash = expectOk(await sampleon(staff.manager)('GET', '/api/v1/dashboard/summary'), 'dashboard');
  ok(`SAMPLEON dashboard: ${JSON.stringify(dash.tiles ?? dash).slice(0, 300)}`);
  const dead = (await sampleonDb.query(`SELECT count(*)::int AS n FROM outbox WHERE status='dead'`)).rows[0].n;
  assert.equal(dead, 0, 'no undeliverable events');
  ok('no dead-lettered events');

  await supplyDb.end(); await sampleonDb.end();
  console.log('\nBoth workflows passed end to end.');
}

main().then(() => { stopAll(); process.exit(0); }, (e) => { console.error(`\n✗ ${e.stack ?? e}`); console.error(`Logs: ${LOGS}`); stopAll(); process.exit(1); });
