import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { isAudienceRequestId } from '@sampledge/contracts';
import { requestBody, seedRespondents, startHarness, tokenFrom, type Harness } from './harness';

let h: Harness;
before(async () => { h = await startHarness({ defaultResponseRate: 0.9 }); seedRespondents(h.supply); });
after(async () => { await h.close(); });

const json = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

/** Create, calculate feasibility, approve and fully launch a request; returns its id. */
async function liveRequest(client: 'projexa' | 'zapx', body: Record<string, unknown>, launch: Record<string, unknown> = { mode: 'full' }) {
  const created = await h.signed(client, 'POST', '/api/v1/audience-requests', body);
  assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
  const id = (await created.json()).audienceRequestId as string;
  assert.equal((await h.staff(h.tokens.manager, 'POST', `/api/v1/audience-requests/${id}/feasibility`)).status, 200);
  assert.equal((await h.staff(h.tokens.approver, 'POST', `/api/v1/audience-requests/${id}/approve`, {})).status, 200);
  const l = await h.staff(h.tokens.manager, 'POST', `/api/v1/audience-requests/${id}/launch`, launch);
  assert.equal(l.status, 200, JSON.stringify(await l.clone().json()));
  await h.drain();
  return id;
}

const cardsFor = (id: string) => h.supply.cards.filter((c) => c.audienceRequestId === id);

test('service calls must be signed by a known client, for their own platform', async () => {
  assert.equal((await fetch(`${h.base}/api/v1/audience-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  const bad = await fetch(`${h.base}/api/v1/audience-requests`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'x-sampledge-client': 'projexa', 'x-sampledge-timestamp': String(Math.floor(Date.now() / 1000)), 'x-sampledge-signature': 'v1=00' } });
  assert.equal(bad.status, 401);
  const wrongPlatform = await h.signed('projexa', 'POST', '/api/v1/audience-requests', requestBody({ source: { platform: 'ZAPX', projectId: 'z1', surveyId: 's1' } }));
  assert.equal(wrongPlatform.status, 403);
  const invalid = await h.signed('projexa', 'POST', '/api/v1/audience-requests', requestBody({ countries: ['Germany'] }));
  assert.equal(invalid.status, 400);
  // Source systems may read the attribute catalogue to map their own quota questions.
  const cat = await h.signed('projexa', 'GET', '/api/v1/attributes');
  assert.equal(cat.status, 200);
  assert.ok(((await cat.json()) as { attributes: { key: string }[] }).attributes.some((a) => a.key === 'hcp.specialty'));
});

test('natural-language targeting becomes structured filters from the SUPPLY360 catalogue', async () => {
  const r = await h.staff(h.tokens.manager, 'POST', '/api/v1/targeting/parse', { text: 'Find 1,500 cardiologists in the USA, UK and Germany with at least five years of professional experience for PROJEXA Project PRJ-1045.' });
  const p = await json(r);
  assert.equal(r.status, 200);
  assert.equal(p.requiredCompletes, 1500);
  assert.deepEqual(p.countries.sort(), ['DE', 'GB', 'US']);
  assert.deepEqual([...p.criteria].sort((a: { attribute: string }, b: { attribute: string }) => a.attribute.localeCompare(b.attribute)), [{ attribute: 'b2b.years_experience', op: 'gte', value: 5 }, { attribute: 'hcp.specialty', op: 'in', values: ['cardiology'] }]);
  assert.deepEqual(p.source, { platform: 'PROJEXA', projectId: 'PRJ-1045' });
  assert.deepEqual(p.problems, []);
  assert.equal(p.engine, 'rules');
  const renamed = await json(await h.staff(h.tokens.manager, 'POST', '/api/v1/targeting/parse', { text: '300 nurses in the UK for SampCode survey ZPX-221' }));
  assert.deepEqual(renamed.source, { platform: 'ZAPX', projectId: 'ZPX-221' });
  const odd = await json(await h.staff(h.tokens.manager, 'POST', '/api/v1/targeting/parse', { text: '200 women aged 25-34 in France who own a Tesla' }));
  const byAttr = (xs: { attribute: string }[]) => [...xs].sort((a, b) => a.attribute.localeCompare(b.attribute));
  assert.deepEqual(byAttr(odd.criteria), [{ attribute: 'demo.age', op: 'between', min: 25, max: 34 }, { attribute: 'demo.gender', op: 'in', values: ['female'] }]);
  assert.deepEqual(odd.countries, ['FR']);
  assert.equal(odd.requiredCompletes, 200);
  assert.ok(odd.unmapped.includes('tesla'), JSON.stringify(odd.unmapped));
});

test('PROJEXA workflow: request → feasibility → human approval → batches → cards → ZAPX → verified complete → PROJEXA and SUPPLY360 updated', async () => {
  const created = await h.signed('projexa', 'POST', '/api/v1/audience-requests', requestBody(), { 'Idempotency-Key': 'prj-1045-req-1' });
  assert.equal(created.status, 201);
  const view = await created.json();
  const id = view.audienceRequestId as string;
  assert.ok(isAudienceRequestId(id));
  assert.equal(view.status, 'submitted');

  // Same Idempotency-Key replays the first response; a second open request for the survey is refused.
  const replay = await h.signed('projexa', 'POST', '/api/v1/audience-requests', requestBody(), { 'Idempotency-Key': 'prj-1045-req-1' });
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).audienceRequestId, id);
  assert.equal((await h.signed('projexa', 'POST', '/api/v1/audience-requests', requestBody())).status, 409);

  // Nothing launches before feasibility and approval.
  assert.equal((await h.staff(h.tokens.manager, 'POST', `/api/v1/audience-requests/${id}/launch`, { mode: 'full' })).status, 409);
  assert.equal((await h.staff(h.tokens.approver, 'POST', `/api/v1/audience-requests/${id}/approve`, {})).status, 409);

  const f = await json(await h.staff(h.tokens.manager, 'POST', `/api/v1/audience-requests/${id}/feasibility`));
  assert.equal(f.byCountry.US.eligible, 7);        // 6 cardiologists + the one without consent
  assert.equal(f.byCountry.US.reachable, 6);       // consent removes one
  assert.equal(f.byCountry.US.missingProfile['b2b.years_experience'], 1);
  assert.equal(f.byCountry.GB.reachable, 4);
  assert.equal(f.requiredCompletes, 4);
  assert.ok(f.recommendedAllocation.US.t2o + f.recommendedAllocation.US.mho > 0);

  // Only an approver, and not with a manager token.
  assert.equal((await h.staff(h.tokens.manager, 'POST', `/api/v1/audience-requests/${id}/approve`, {})).status, 403);
  const approved = await json(await h.staff(h.tokens.approver, 'POST', `/api/v1/audience-requests/${id}/approve`, { note: 'ok' }));
  assert.equal(approved.status, 'approved');
  assert.deepEqual(approved.quotas.map((q: { id: string; target: number }) => [q.id, q.target]), [['country:US', 2], ['country:GB', 2]]);

  const launched = await json(await h.staff(h.tokens.manager, 'POST', `/api/v1/audience-requests/${id}/launch`, { mode: 'soft', softLaunchCompletes: 1 }));
  assert.equal(launched.status, 'soft_launch');
  await h.drain();
  const cards = cardsFor(id);
  assert.ok(cards.length > 0, 'survey cards delivered through SUPPLY360');
  assert.ok(cards.every((c) => !c.respondentRef.includes('noconsent') && !c.respondentRef.includes('junior') && !c.respondentRef.includes('onc')));

  // Respondent opens the card on the panel website and is sent to ZAPX with an opaque token.
  const card = cards.find((c) => c.respondentRef.startsWith('rsp_us'))!;
  const go = await h.follow(card.cardUrl);
  assert.equal(go.status, 302);
  assert.ok(go.location!.startsWith('https://take.zapx.example/s/cardio?rid='));
  const token = tokenFrom(go.location!);
  assert.ok(!go.location!.includes(card.respondentRef), 'the host never sees the respondentRef');

  // Browser says complete: not counted until the host confirms server to server.
  const back = await h.follow(`/r/complete?token=${encodeURIComponent(token)}`);
  assert.equal(back.status, 200);
  assert.match(back.text, /Thank you/);
  let v = await json(await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}`));
  assert.equal(v.completes, 0);
  assert.equal(v.outcomes.pending_verification, 1);

  assert.equal((await h.hostOutcome(token, 'complete', 'wrong')).status, 401);
  const ok = await h.hostOutcome(token, 'complete');
  assert.equal(ok.status, 200);
  assert.equal((await h.hostOutcome(token, 'complete')).status, 200, 'same outcome again is fine');
  assert.equal((await h.hostOutcome(token, 'terminate')).status, 409, 'a different outcome is refused');
  v = await json(await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}`));
  assert.equal(v.completes, 1);
  assert.equal(v.quotas.find((q: { id: string }) => q.id === 'country:US').completes, 1);
  assert.equal(v.spec.reward.value, undefined, 'source systems do not see reward cost');

  await h.drain();
  // PROJEXA got the lifecycle, without respondent-level fields.
  for (const t of ['audience_request.submitted', 'feasibility.calculated', 'audience.approved', 'batch.scheduled', 'invitation.delivered', 'survey.started', 'survey.completed', 'project.quota_updated']) {
    assert.ok(h.projexa.of(t).some((e) => e.correlationId === id), `PROJEXA received ${t}`);
  }
  assert.ok(h.projexa.events.every((e) => !('respondentRef' in e.payload)));
  const qu = h.projexa.of('project.quota_updated').filter((e) => e.correlationId === id).at(-1)!;
  assert.deepEqual((qu.payload as { progress: unknown }).progress, { required: 4, completes: 1, remaining: 3 });
  assert.equal(qu.subject.sourceProjectId, 'PRJ-1045');
  // SUPPLY360 got the respondent's participation, with the respondentRef.
  const done = h.supply.events.find((e) => e.type === 'survey.completed' && e.correlationId === id)!;
  assert.equal((done.payload as { respondentRef: string }).respondentRef, card.respondentRef);
  assert.equal(h.projexa.rejected, 0);

  // SUPPLY360 confirms the reward.
  const conf = { specVersion: '1.0', eventId: crypto.randomUUID(), type: 'reward.eligibility_confirmed', version: 1, source: 'SUPPLY360', occurredAt: new Date().toISOString(), correlationId: id, subject: {}, payload: { sessionId: (done.payload as { sessionId: string }).sessionId, respondentRef: card.respondentRef, points: 500, ledgerEntryId: 'inc_1' } };
  assert.equal((await json(await h.signed('supply360', 'POST', '/api/v1/events', conf))).status, 'processed');
  assert.equal((await json(await h.signed('supply360', 'POST', '/api/v1/events', conf))).status, 'duplicate');
  assert.equal((await h.signed('projexa', 'POST', '/api/v1/events', { ...conf, eventId: crypto.randomUUID() })).status, 403);

  // Soft launch target (1) reached: auto batches stop until a full launch.
  const before = (await json(await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}`))).batches.length;
  await h.drain();
  assert.equal((await json(await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}`))).batches.length, before);
  const full = await json(await h.staff(h.tokens.manager, 'POST', `/api/v1/audience-requests/${id}/launch`, { mode: 'full' }));
  assert.equal(full.status, 'live');
  await h.drain();

  // Finish the target with verified completes; the request closes itself and PROJEXA is told.
  for (const c of cardsFor(id)) {
    const cur = await json(await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}`));
    if (cur.status === 'closed') break;
    const g = await h.follow(c.cardUrl);
    if (g.status !== 302 || !g.location!.startsWith('https://take.zapx.example/s/cardio')) continue;
    await h.hostOutcome(tokenFrom(g.location!), 'complete');
  }
  await h.drain();
  v = await json(await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}`));
  assert.equal(v.status, 'closed');
  assert.equal(v.completes, 4);
  assert.ok(h.projexa.of('project.closed').some((e) => e.correlationId === id));

  const report = await json(await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}/report`));
  assert.equal(report.participation.completes, 4);
});

test('independent ZAPX workflow: no PROJEXA project, events and analytics go back to ZAPX', async () => {
  const id = await liveRequest('zapx', requestBody({ source: { platform: 'ZAPX', projectId: 'zpj_77', surveyId: 'zsv_77' }, countries: ['GB'], requiredCompletes: 1, survey: { launchUrl: 'https://take.zapx.example/s/77', language: 'en-GB' } }));
  const card = cardsFor(id)[0]!;
  const go = await h.follow(card.cardUrl);
  assert.ok(go.location!.startsWith('https://take.zapx.example/s/77?token='), 'token appended when the URL has no {token}');
  assert.equal((await h.hostOutcome(tokenFrom(go.location!), 'complete')).status, 200);
  await h.drain();
  assert.ok(h.zapx.of('survey.completed').some((e) => e.correlationId === id));
  assert.ok(h.zapx.of('project.closed').some((e) => e.correlationId === id));
  assert.equal(h.projexa.events.filter((e) => e.correlationId === id).length, 0, 'PROJEXA is not involved');
  assert.equal((await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}`)).status, 404, 'PROJEXA cannot read ZAPX requests');
  const report = await json(await h.signed('zapx', 'GET', `/api/v1/audience-requests/${id}/report`));
  assert.equal(report.participation.completes, 1);
  assert.equal(report.completionRate, 100);
});

test('routing: a screened-out respondent is offered another eligible survey once, then the chain ends gracefully', async () => {
  h.supply.respondents.push({ ref: 'rsp_route', panel: 't2o', country: 'US', consented: true, profile: { 'hcp.specialty': 'cardiology', 'b2b.years_experience': 20 }, invites: [], surveys: [] });
  const a = await liveRequest('projexa', requestBody({ source: { platform: 'PROJEXA', projectId: 'PRJ-2001', surveyId: 'zsv_a' }, countries: ['US'], requiredCompletes: 50, survey: { launchUrl: 'https://take.zapx.example/s/a?rid={token}', language: 'en' } }));
  const b = await liveRequest('zapx', requestBody({ source: { platform: 'ZAPX', projectId: 'zpj_b', surveyId: 'zsv_b' }, countries: ['US'], requiredCompletes: 50, survey: { launchUrl: 'https://take.zapx.example/s/b?rid={token}', language: 'en' } }), { mode: 'full', batches: [{ size: 1 }] });
  const invitedToB = new Set(cardsFor(b).map((c) => c.respondentRef));
  assert.ok(invitedToB.size >= 1);
  const cardA = cardsFor(a).find((c) => !invitedToB.has(c.respondentRef))!;
  const tA = tokenFrom((await h.follow(cardA.cardUrl)).location!);
  const routed = await h.follow(`/r/screenout?token=${encodeURIComponent(tA)}`);
  assert.equal(routed.status, 302);
  assert.ok(routed.location!.startsWith('https://take.zapx.example/s/b?rid='), routed.location!);
  const tB = tokenFrom(routed.location!);
  // B screens out too: A is already in the chain and there is nothing else, so the chain ends.
  const end = await h.follow(`/r/terminate?token=${encodeURIComponent(tB)}`);
  assert.equal(end.status, 200);
  assert.match(end.text, /no other survey/);
  // Replaying A's browser return does not route again or start a new session.
  const sessionsBefore = (await h.db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n;
  await h.follow(`/r/screenout?token=${encodeURIComponent(tA)}`);
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n, sessionsBefore);

  // A respondent already invited to B is not routed to B: the chain ends instead.
  const cardA2 = cardsFor(a).find((c) => invitedToB.has(c.respondentRef));
  if (cardA2) {
    const t2 = tokenFrom((await h.follow(cardA2.cardUrl)).location!);
    const r2 = await h.follow(`/r/quota_full?token=${encodeURIComponent(t2)}`);
    assert.equal(r2.status, 200);
    assert.match(r2.text, /no other survey/);
  }
  assert.equal((await h.hostOutcome(tA, 'terminate')).status, 200);
  await h.drain();
  const scr = h.projexa.of('survey.screenout').find((e) => e.correlationId === a)!;
  assert.equal((scr.payload as { routedTo: string | null }).routedTo, b);
  // Coming back through the same card: already taken, no second session.
  assert.match((await h.follow(cardA.cardUrl)).text, /already taken part/);
  const d = await json(await h.staff(h.tokens.viewer, 'GET', `/api/v1/dashboard/requests/${a}`));
  assert.ok(d.routingDecisions.length >= 1);
});

test('hard quotas: a complete over a full cell becomes quota full; a later quality reject releases the place', async () => {
  const id = await liveRequest('projexa', requestBody({
    source: { platform: 'PROJEXA', projectId: 'PRJ-3001', surveyId: 'zsv_q' }, countries: ['US'], requiredCompletes: 3,
    quotas: [{ id: 'female', country: 'US', conditions: [{ attribute: 'demo.gender', op: 'eq', value: 'female' }], target: 1, hard: true }],
    exclusions: { surveyIds: [], audienceRequestIds: [] },
    survey: { launchUrl: 'https://take.zapx.example/s/q?rid={token}', language: 'en' },
  }));
  const women = h.supply.respondents.filter((r) => r.country === 'US' && r.profile['demo.gender'] === 'female').map((r) => r.ref);
  const cards = cardsFor(id).filter((c) => women.includes(c.respondentRef));
  assert.ok(cards.length >= 2, `need two women invited, got ${cards.length}`);
  const t1 = tokenFrom((await h.follow(cards[0]!.cardUrl)).location!);
  const t2 = tokenFrom((await h.follow(cards[1]!.cardUrl)).location!);
  assert.equal((await json(await h.hostOutcome(t1, 'complete'))).status, 'complete');
  const over = await json(await h.hostOutcome(t2, 'complete'));
  assert.equal(over.status, 'quota_full');
  assert.equal(over.overquota, true);
  await h.drain();
  assert.ok(h.projexa.of('quota.full').some((e) => e.correlationId === id && (e.payload as { quotaId: string }).quotaId === 'female'));
  // The host rejects the first complete after review: quota place and reward released.
  assert.equal((await json(await h.hostOutcome(t1, 'quality_fail'))).status, 'quality_fail');
  const v = await json(await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}`));
  assert.equal(v.quotas.find((q: { id: string }) => q.id === 'female').completes, 0);
  assert.equal(v.completes, 0);
  await h.drain();
  assert.ok(h.supply.events.some((e) => e.type === 'quality.failed' && e.correlationId === id));
  // A third woman can now enter.
  const r = await h.db.query("SELECT status FROM rewards WHERE request_id=$1", [id]);
  assert.deepEqual(r.rows.map((x) => x.status), ['cancelled']);
});

test('approved project changes from PROJEXA update targets; the requester cannot approve; closing from PROJEXA closes the request', async () => {
  const created = await h.signed('projexa', 'POST', '/api/v1/audience-requests', requestBody({ source: { platform: 'PROJEXA', projectId: 'PRJ-4001', surveyId: 'zsv_c' } }));
  const id = (await created.json()).audienceRequestId;
  await h.staff(h.tokens.manager, 'POST', `/api/v1/audience-requests/${id}/feasibility`);
  const change = await json(await h.signed('projexa', 'PATCH', `/api/v1/audience-requests/${id}`, { requiredCompletes: 8, completesByCountry: { US: 5, GB: 3 } }));
  assert.equal(change.requiredCompletes, 8);
  // A manager-created request cannot be approved by the same manager... managers cannot approve at all; approver can.
  const mine = await h.staff(h.tokens.manager, 'POST', '/api/v1/audience-requests', requestBody({ source: { platform: 'PROJEXA', projectId: 'PRJ-4002', surveyId: 'zsv_d' } }));
  assert.equal(mine.status, 201);
  const adminMade = await h.staff(h.tokens.admin, 'POST', '/api/v1/audience-requests', requestBody({ source: { platform: 'PROJEXA', projectId: 'PRJ-4003', surveyId: 'zsv_e' } }));
  const adminId = (await adminMade.json()).audienceRequestId;
  await h.staff(h.tokens.admin, 'POST', `/api/v1/audience-requests/${adminId}/feasibility`);
  assert.equal((await h.staff(h.tokens.admin, 'POST', `/api/v1/audience-requests/${adminId}/approve`, {})).status, 403, 'requester cannot approve own request');

  const ev = { specVersion: '1.0', eventId: crypto.randomUUID(), type: 'project.closed', version: 1, source: 'PROJEXA', occurredAt: new Date().toISOString(), correlationId: 'PRJ-4001', subject: { sourcePlatform: 'PROJEXA', sourceProjectId: 'PRJ-4001' }, payload: { reason: 'client cancelled' } };
  assert.equal((await json(await h.signed('projexa', 'POST', '/api/v1/events', ev))).status, 'processed');
  assert.equal((await json(await h.signed('projexa', 'GET', `/api/v1/audience-requests/${id}`))).status, 'cancelled');
  const created2 = { ...ev, eventId: crypto.randomUUID(), type: 'project.created', payload: { projectId: 'PRJ-5000', name: 'New tracker', countries: ['US'] } };
  assert.equal((await json(await h.signed('projexa', 'POST', '/api/v1/events', created2))).status, 'processed');
  assert.equal((await json(await h.signed('projexa', 'POST', '/api/v1/events', { ...ev, eventId: crypto.randomUUID(), type: 'brand.new.thing' }))).status, 'ignored');
});

test('dashboard: cross-platform tiles, drill-down and role-based scope', async () => {
  const s = await json(await h.staff(h.tokens.viewer, 'GET', '/api/v1/dashboard/summary'));
  assert.ok(s.requests.projexa.total >= 3);
  assert.ok(s.requests.zapx.total >= 2);
  assert.equal(s.requests.projexa.projectsKnown, 1);
  assert.ok(s.invitations.delivered > 0);
  assert.ok(s.participation.started > 0);
  assert.ok(s.routing.decisions >= 1);
  assert.ok(s.rewardLiabilities.confirmedPoints >= 500);
  assert.ok(s.countryQuotas.length >= 1);
  assert.notEqual(s.integrationFailures, null);
  const org = await json(await h.staff(h.tokens.orgViewer, 'GET', '/api/v1/dashboard/summary'));
  assert.equal(org.rewardLiabilities, null);
  assert.equal(org.integrationFailures, null);
  assert.equal((await h.staff(h.tokens.orgViewer, 'GET', '/api/v1/dashboard/failures')).status, 403);
  const list = await json(await h.staff(h.tokens.orgViewer, 'GET', '/api/v1/dashboard/requests?platform=PROJEXA'));
  assert.ok(list.data.length > 0 && list.data.every((r: { organization_id: string }) => r.organization_id === 'org_acme'));
  const detail = await json(await h.staff(h.tokens.orgViewer, 'GET', `/api/v1/dashboard/requests/${list.data[0].id}`));
  assert.equal(detail.spec.reward.value, undefined);
  assert.deepEqual(detail.events, []);
  assert.equal((await h.staff('son_nope', 'GET', '/api/v1/dashboard/summary')).status, 401);
  const html = await fetch(`${h.base}/console`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /<title>SampAudience operations<\/title>/);
  const logo = await fetch(`${h.base}/brand/sampaudience-logo-light.svg`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/svg+xml');
  assert.equal((await fetch(`${h.base}/brand/..%2Fconsole.html`)).status, 404);
});

test('outbox: a refusing receiver is dead-lettered, shown as an integration failure, and can be replayed', async () => {
  await h.db.query("UPDATE service_clients SET webhook_url = replace(webhook_url, '/api/v1/integrations', '/nowhere') WHERE id='zapx'");
  h.zapx.server.removeAllListeners('request');
  h.zapx.server.on('request', (_q, res) => res.writeHead(422).end());
  await liveRequest('zapx', requestBody({ source: { platform: 'ZAPX', projectId: 'zpj_dead', surveyId: 'zsv_dead' }, countries: ['GB'], requiredCompletes: 1 }));
  const f = await json(await h.staff(h.tokens.manager, 'GET', '/api/v1/dashboard/failures'));
  assert.ok(f.deadLetters.length > 0);
  assert.equal(f.deadLetters[0].last_status, 422);
  assert.equal((await h.staff(h.tokens.manager, 'POST', `/api/v1/dashboard/failures/${f.deadLetters[0].id}/replay`)).status, 200);
});

test('a request that only describes its audience gets draft criteria for review; an unusable description is refused', async () => {
  const described = await h.signed('zapx', 'POST', '/api/v1/audience-requests', requestBody({
    source: { platform: 'ZAPX', projectId: 'zpj_nl', surveyId: 'zsv_nl' },
    targeting: { naturalLanguage: 'Cardiologists with at least five years of professional experience' },
  }));
  assert.equal(described.status, 201, JSON.stringify(await described.clone().json()));
  const id = (await described.json()).audienceRequestId as string;
  const spec = (await h.db.query('SELECT spec FROM audience_requests WHERE id=$1', [id])).rows[0].spec;
  assert.deepEqual([...spec.targeting.criteria].sort((a: { attribute: string }, b: { attribute: string }) => a.attribute.localeCompare(b.attribute)), [
    { attribute: 'b2b.years_experience', op: 'gte', value: 5 },
    { attribute: 'hcp.specialty', op: 'in', values: ['cardiology'] },
  ]);
  assert.equal(spec.targeting.interpretation.engine, 'rules');
  const status = (await h.db.query('SELECT status FROM audience_requests WHERE id=$1', [id])).rows[0].status;
  assert.equal(status, 'submitted', 'nothing is sent before a person approves');

  const vague = await h.signed('zapx', 'POST', '/api/v1/audience-requests', requestBody({
    source: { platform: 'ZAPX', projectId: 'zpj_nl2', surveyId: 'zsv_nl2' },
    targeting: { naturalLanguage: 'people who love quantum knitting' },
  }));
  assert.equal(vague.status, 400);
  const none = await h.signed('zapx', 'POST', '/api/v1/audience-requests', requestBody({ source: { platform: 'ZAPX', projectId: 'zpj_nl3', surveyId: 'zsv_nl3' }, targeting: {} }));
  assert.equal(none.status, 400);
});
