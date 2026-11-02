const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installSeededUiIsolation } = require('../e2e/seededUiIsolation');

const LIVE = 'https://backend.invalid';
const SITE = 'https://site.invalid';
const WS = 'wss://backend.invalid';
const MARKER = 'x-rawsurf-e2e-isolation';
const IDS = ['test-surfer-id', 'admin-user-id'];
const ADMIN = ['/api/admin/event-dashboard/events', '/api/admin/event-dashboard/actions'];
const RUM = '/api/weather/client-diagnostics';

function page(user = { id: IDS[0] }, origin = SITE) {
  return { user, closed: false, evaluations: [], url: () => origin + '/admin', isClosed() { return this.closed; },
    async evaluate(fn) {
      const localStorage = { getItem: name => name === 'raw-surf-user' ? JSON.stringify(this.user) : null };
      const result = vm.runInNewContext(`(${fn.toString()})()`, { localStorage });
      const plain = JSON.parse(JSON.stringify(result));
      this.evaluations.push(plain);
      return plain;
    } };
}

async function fixture(pages = [page()]) {
  const ctx = { routes: [], sockets: [], scripts: [], listeners: [],
    pages: () => pages,
    async addInitScript(fn) { this.scripts.push(fn); },
    async route(matches, handle) { this.routes.push({ matches, handle }); },
    async routeWebSocket(matches, handle) { this.sockets.push({ matches, handle }); },
    on(event, handle) { if (event === 'response') this.listeners.push(handle); } };
  const result = await installSeededUiIsolation(ctx, { liveOrigin: LIVE, siteOrigin: SITE });
  return { ctx, result, pages };
}

async function request(f, path, { origin = LIVE, method = 'GET', owner = f.pages[0], frameError = false, headers = {} } = {}) {
  const url = origin + path;
  const calls = { fulfilled: [], aborted: [], network: 0 };
  const matching = f.ctx.routes.filter(r => r.matches(new URL(url)));
  if (!matching.length) { calls.network += 1; return calls; }
  await matching.at(-1).handle({ request: () => ({ url: () => url, method: () => method,
    headerValue: async name => headers[name.toLowerCase()] || null,
    frame: () => { if (frameError) throw new Error('No frame'); return { page: () => owner }; } }),
  fulfill: async value => { calls.fulfilled.push(value); }, abort: async reason => { calls.aborted.push(reason); },
  fallback: () => assert.fail('Owned request fell through'), continue: () => assert.fail('Opened network') });
  return calls;
}

async function socket(f, path, origin = WS) {
  const url = origin + path;
  const calls = { closed: [], serverConnections: 0, untouched: false };
  const matching = f.ctx.sockets.filter(r => r.matches(new URL(url)));
  if (!matching.length) { calls.untouched = true; return calls; }
  await matching.at(-1).handle({ url: () => url,
    connectToServer: () => { calls.serverConnections += 1; assert.fail('Socket opened real transport'); },
    close: async value => { calls.closed.push(value); } });
  assert.equal(calls.serverConnections, 0);
  return calls;
}

function response(f, path, { origin = LIVE, method = 'POST', marker } = {}) {
  f.ctx.listeners.forEach(fn => fn({ url: () => origin + path, request: () => ({ method: () => method }),
    headers: () => marker ? { [MARKER]: marker } : {} }));
}

test('before-page init disables sending while retaining the local telemetry object', async () => {
  const f = await fixture();
  const window = { __RAW_RUM__: { sampled: true, sent: 0 }, __RAW_RUM_URL__: 'old' };
  vm.runInNewContext(`(${f.ctx.scripts[0].toString()})()`, window);
  assert.equal(window.__RAW_RUM_URL__, '');
  assert.deepEqual(window.__RAW_RUM__, { sampled: true, sent: 0 });
  assert.equal(window.__RAW_DISABLE_RUM__, undefined);
});

for (const id of IDS) {
  test(`the declared tokenless ${id} receives only the two fictional admin reads and health contract`, async () => {
    const f = await fixture([page({ id, email: 'fictional@example.invalid', irrelevant: 'not returned' })]);
    for (const origin of [LIVE, SITE]) {
      const events = await request(f, ADMIN[0], { origin });
      const actions = await request(f, ADMIN[1] + '?limit=5', { origin });
      const health = await request(f, '/api/health/data', { origin });
      assert.deepEqual(events.fulfilled[0].json, { success: true, events: [] });
      assert.deepEqual(actions.fulfilled[0].json, { success: true, actions: [] });
      assert.deepEqual(health.fulfilled[0].json, {
        status: 'ok', fixture: 'synthetic-ui-read', freshest_run_age_h: 0, lanes: {}, alerts: [],
      });
      assert.equal(events.fulfilled[0].headers[MARKER], 'admin');
      assert.equal(events.fulfilled[0].headers['access-control-allow-origin'], SITE);
      assert.equal(actions.fulfilled[0].headers['access-control-allow-methods'], 'GET, OPTIONS');
      assert.equal(health.fulfilled[0].headers[MARKER], 'diagnostics');
      assert.equal(health.fulfilled[0].headers['access-control-allow-origin'], SITE);
    }
    assert.equal(f.result.stats.adminReads, 4);
    assert.equal(f.result.stats.diagnosticsReads, 2);
    assert.deepEqual(f.pages[0].evaluations, Array(6).fill({ id, hasToken: false }));
    f.result.assertNoViolations();
  });
}

test('real accounts, authenticated fixture IDs and anonymous/malformed sessions fail closed', async () => {
  for (const user of [{ id: 'real-account' }, { id: IDS[0], access_token: 'fictional-token-marker' }, null, {}, 'invalid']) {
    const f = await fixture([page(user)]);
    for (const origin of [LIVE, SITE]) for (const path of [ADMIN[0], '/api/health/data']) {
      const r = await request(f, path, { origin });
      assert.deepEqual(r.aborted, ['blockedbyclient']);
      assert.equal(r.network + r.fulfilled.length, 0);
    }
    assert.equal(f.result.violations.length, 4);
    assert.throws(() => f.result.assertNoViolations(), /4 violation/);
    assert.doesNotMatch(JSON.stringify(f.result), /fictional-token-marker|real-account/);
  }
});

test('explicit Authorization cannot turn tokenless stored fixture IDs into authenticated protected reads', async () => {
  for (const id of IDS) for (const origin of [LIVE, SITE]) for (const path of [...ADMIN, '/api/health/data']) {
    const f = await fixture([page({ id })]);
    const r = await request(f, path, { origin, headers: { authorization: 'Bearer fictional-explicit-auth-marker' } });
    assert.equal(r.aborted.length, 1, `${id} ${origin} ${path}`);
    assert.equal(r.network + r.fulfilled.length, 0);
    assert.equal(f.result.violations[0].kind, 'unexpected-request-auth');
    assert.doesNotMatch(JSON.stringify(f.result), /fictional-explicit-auth-marker|Bearer/);
  }
  for (const origin of [LIVE, SITE]) {
    const f = await fixture();
    const preflight = await request(f, ADMIN[0], { origin, method: 'OPTIONS', headers: {
      origin: SITE, authorization: 'fictional-explicit-auth-marker', 'access-control-request-method': 'GET',
    } });
    assert.equal(preflight.aborted.length, 1);
    assert.equal(f.result.violations[0].kind, 'unexpected-request-auth');
    const sink = await request(f, RUM, { origin, method: 'POST', headers: {
      origin: SITE, authorization: 'fictional-explicit-auth-marker',
    } });
    assert.equal(sink.fulfilled[0]?.status, 204, 'the nonsession diagnostic sink remains locally absorbed');
  }
});

test('missing frames, unavailable evaluation, closed pages and other site origins fail closed', async () => {
  const cases = [page(), page(), page(), page({ id: IDS[0] }, 'https://other.invalid')];
  cases[1].evaluate = async () => { throw new Error('Unavailable'); };
  cases[2].closed = true;
  for (let i = 0; i < cases.length; i++) {
    const f = await fixture([cases[i]]);
    const r = await request(f, ADMIN[0], { frameError: i === 0 });
    assert.equal(r.aborted.length, 1);
    assert.equal(f.result.violations[0].kind, 'unexpected-session');
  }
});

test('unexpected admin methods and paths are aborted rather than given broad success', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    const f = await fixture();
    const r = await request(f, ADMIN[0], { method });
    assert.equal(r.aborted.length, 1);
    assert.equal(f.result.stats.adminReads, 0);
  }
  for (const path of ['/api/admin', '/api/admin/unknown/private-value?query=omitted',
    '/api/admin/event-dashboard/actions/approve', ADMIN[0] + '/']) {
    const f = await fixture();
    const r = await request(f, path);
    assert.equal(r.aborted.length, 1);
    assert.equal(f.result.violations[0].path, '/api/admin/[unexpected]');
    assert.doesNotMatch(JSON.stringify(f.result), /private-value|query/);
  }
});

test('health mutations are blocked while similarly named and unrelated reads remain outside the fixture', async () => {
  const f = await fixture();
  assert.equal((await request(f, '/api/health/data', { method: 'POST' })).aborted.length, 1);
  for (const path of ['/api/health', '/api/health/database', '/api/health/data/']) {
    assert.equal((await request(f, path)).network, 1);
  }
});

test('auth, access gates, real Explore/SpotHub and weather routes are preserved for every method', async () => {
  const f = await fixture();
  for (const path of ['/api/auth/login', '/api/auth/signup', '/api/site-access', '/api/site-access/verify',
    '/api/explore/trending', '/api/explore/spot-details/real-spot', '/api/weather/grid_series?model=GFS',
    '/api/notifications/real-account/unread-count', '/api/administrator']) {
    for (const method of ['GET', 'POST']) assert.equal((await request(f, path, { method })).network, 1, `${method} ${path}`);
  }
  for (const path of [...ADMIN, '/api/health/data']) {
    for (const origin of ['https://other.invalid', 'https://backend.invalid.evil.invalid']) {
      assert.equal((await request(f, path, { origin })).network, 1);
    }
  }
  f.result.assertNoViolations();
});

test('POST and preflight RUM are answered and marked at BOTH configured origins, including anonymous pages', async () => {
  const f = await fixture([page(null)]);
  for (const origin of [LIVE, SITE]) for (const method of ['POST', 'OPTIONS']) {
    const r = await request(f, RUM + '?unused=not-recorded', { origin, method,
      headers: { origin: SITE, ...(method === 'OPTIONS' ? { 'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type' } : {}) } });
    assert.equal(r.fulfilled[0].status, 204);
    assert.equal(r.fulfilled[0].headers[MARKER], 'rum');
    assert.equal(r.fulfilled[0].headers['x-rawsurf-offline-weather'], 'local');
    assert.equal(r.fulfilled[0].headers['access-control-allow-origin'], SITE);
    assert.equal(r.network, 0);
  }
  assert.equal(f.result.stats.rumAnswered, 4);
  assert.deepEqual(f.pages[0].evaluations, []);
  f.result.assertNoViolations();
});

test('RUM unexpected methods fail closed; other origins and non-exact paths are untouched', async () => {
  const f = await fixture();
  assert.equal((await request(f, RUM, { method: 'GET' })).aborted.length, 1);
  assert.equal((await request(f, RUM, { origin: 'https://other.invalid', method: 'POST' })).network, 1);
  for (const path of [RUM + '/', '/api/weather/client-diagnostics-extra']) {
    assert.equal((await request(f, path, { method: 'POST' })).network, 1);
  }
});

test('known admin and health GET preflights are identity-bound and answered at both configured origins', async () => {
  const f = await fixture();
  for (const origin of [LIVE, SITE]) for (const path of [...ADMIN, '/api/health/data']) {
    const r = await request(f, path, { origin, method: 'OPTIONS', headers: { origin: SITE,
      'access-control-request-method': 'GET', 'access-control-request-headers': 'Content-Type' } });
    const reply = r.fulfilled[0];
    assert.equal(reply?.status, 204);
    assert.equal(reply.headers['access-control-allow-origin'], SITE);
    assert.equal(reply.headers['access-control-allow-methods'], 'GET, OPTIONS');
    assert.equal(reply.headers['access-control-allow-headers'], 'content-type');
    assert.equal(reply.headers.vary, 'Origin');
    assert.equal(r.network, 0);
  }
  assert.equal(f.result.stats.adminReads + f.result.stats.diagnosticsReads, 0, 'preflight is not a data read');
  f.result.assertNoViolations();
});

test('foreign origins, unknown/mutation preflights and unexpected headers fail closed without disclosure', async () => {
  for (const origin of [LIVE, SITE]) for (const [path, method, headers] of [
    [ADMIN[0], 'GET', { origin: 'https://foreign.invalid' }],
    ['/api/health/data', 'GET', { origin: 'null' }],
    [RUM, 'POST', { origin: 'https://foreign.invalid' }],
    [ADMIN[0], 'OPTIONS', { origin: SITE, 'access-control-request-method': 'POST' }],
    ['/api/admin/unknown', 'OPTIONS', { origin: SITE, 'access-control-request-method': 'GET' }],
    ['/api/health/data', 'OPTIONS', { origin: SITE, 'access-control-request-method': 'DELETE' }],
    [RUM, 'OPTIONS', { origin: SITE, 'access-control-request-method': 'GET' }],
    [RUM, 'OPTIONS', { origin: SITE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' }],
    [ADMIN[0], 'OPTIONS', { 'access-control-request-method': 'GET' }],
    [ADMIN[0], 'OPTIONS', { origin: SITE }],
  ]) {
    const f = await fixture();
    const r = await request(f, path, { origin, method, headers });
    assert.equal(r.aborted.length, 1, `${method} ${path}`);
    assert.equal(r.network + r.fulfilled.length, 0);
    assert.equal(f.result.violations.length, 1);
    assert.doesNotMatch(JSON.stringify(f.result), /foreign.invalid|authorization/);
  }
});

test('protected preflight retains session ownership checks and refuses missing frames', async () => {
  const headers = { origin: SITE, 'access-control-request-method': 'GET', 'access-control-request-headers': 'content-type' };
  for (const origin of [LIVE, SITE]) {
    for (const user of [null, { id: 'real-account' }, { id: IDS[0], access_token: 'fictional-token-marker' }]) {
      const f = await fixture([page(user)]);
      assert.equal((await request(f, ADMIN[0], { origin, method: 'OPTIONS', headers })).aborted.length, 1);
    }
    const f = await fixture();
    assert.equal((await request(f, '/api/health/data', { origin, method: 'OPTIONS', headers, frameError: true })).aborted.length, 1);
    assert.equal(f.result.violations[0].kind, 'unexpected-session');
  }
});

test('unmarked RUM responses fail qualification at both origins without query/header disclosure', async () => {
  const f = await fixture();
  for (const origin of [LIVE, SITE]) response(f, RUM + '?private-query-marker', { origin });
  response(f, RUM, { marker: 'rum' });
  response(f, RUM, { origin: 'https://other.invalid' });
  response(f, '/api/weather/grid');
  assert.equal(f.result.stats.rumLeaks, 2);
  assert.equal(f.result.violations.length, 2);
  assert.doesNotMatch(JSON.stringify(f.result), /private-query-marker/);
  assert.throws(() => f.result.assertNoViolations(), /violation/);
});

test('unmarked protected admin/health responses fail while real auth/Explore responses stay outside', async () => {
  const f = await fixture();
  for (const origin of [LIVE, SITE]) {
    response(f, ADMIN[0], { method: 'GET', origin });
    response(f, '/api/health/data', { method: 'GET', origin });
  }
  response(f, ADMIN[1], { marker: 'admin', method: 'GET' });
  response(f, '/api/auth/login');
  response(f, '/api/explore/trending', { method: 'GET' });
  assert.deepEqual(f.result.violations.map(v => v.kind), [
    'unmarked-admin-response', 'unmarked-diagnostics-response',
    'unmarked-admin-response', 'unmarked-diagnostics-response',
  ]);
});

for (const id of IDS) {
  test(`admin and exact ${id} call sockets close before server connection`, async () => {
    const f = await fixture([page({ id })]);
    for (const path of ['/api/ws/admin/events', `/api/ws/call/${id}`]) {
      assert.equal((await socket(f, path)).closed[0].code, 1008);
    }
    assert.equal(f.result.stats.adminSockets, 1);
    assert.equal(f.result.stats.callSockets, 1);
    f.result.assertNoViolations();
  });
}

test('a token-bearing query or stored session, real identity, missing owner and mismatched fake ID never connect', async () => {
  const cases = [
    { owners: [page()], path: '/api/ws/admin/events?token=fictional-query-marker' },
    { owners: [page({ id: IDS[0], access_token: 'fictional-token-marker' })], path: '/api/ws/admin/events' },
    { owners: [page({ id: 'real-account' })], path: '/api/ws/admin/events' },
    { owners: [], path: '/api/ws/admin/events' },
    { owners: [page(), page()], path: '/api/ws/admin/events' },
    { owners: [page()], path: `/api/ws/call/${IDS[1]}` },
  ];
  for (const c of cases) {
    const f = await fixture(c.owners);
    assert.equal((await socket(f, c.path)).closed.length, 1);
    assert.equal(f.result.violations.length, 1);
    assert.doesNotMatch(JSON.stringify(f.result), /fictional-query-marker|fictional-token-marker|real-account/);
  }
});

test('unknown backend protected sockets fail closed without broad success', async () => {
  for (const path of ['/api/ws/call/other-account', '/api/ws/admin/other', '/api/ws/unexpected']) {
    const f = await fixture();
    assert.equal((await socket(f, path)).closed.length, 1);
    assert.equal(f.result.violations[0].kind, 'unexpected-protected');
    assert.equal(f.result.violations[0].path, '/api/ws/[unexpected]');
  }
});

test('Supabase realtime is isolated by exact protocol path even on unknown custom domains', async () => {
  const f = await fixture();
  for (const origin of ['wss://project.supabase.co', 'wss://custom-realtime.invalid']) {
    assert.equal((await socket(f, '/realtime/v1/websocket?apikey=fictional-not-recorded', origin)).closed.length, 1);
  }
  assert.equal(f.result.stats.realtimeSockets, 2);
  assert.doesNotMatch(JSON.stringify(f.result), /fictional-not-recorded|apikey/);
  f.result.assertNoViolations();
});

test('unexpected realtime subtree and non-synthetic realtime owners close with violations', async () => {
  for (const path of ['/realtime/v1', '/realtime/v1/unknown']) {
    const f = await fixture();
    assert.equal((await socket(f, path, 'wss://custom.invalid')).closed.length, 1);
    assert.equal(f.result.violations[0].kind, 'unexpected-realtime');
  }
  const f = await fixture([page(null)]);
  assert.equal((await socket(f, '/realtime/v1/websocket', 'wss://custom.invalid')).closed.length, 1);
  assert.equal(f.result.violations[0].kind, 'unexpected-socket-session');
});

test('public backend and unrelated other-origin sockets are never intercepted', async () => {
  const f = await fixture();
  for (const path of ['/api/ws/conditions', '/api/ws/live', '/ws/unrelated', '/realtime/v10/websocket']) {
    assert.equal((await socket(f, path)).untouched, true, path);
  }
  for (const origin of ['wss://other.invalid', 'wss://backend.invalid.evil.invalid']) {
    for (const path of ['/api/ws/admin/events', `/api/ws/call/${IDS[0]}`, '/unrelated']) {
      assert.equal((await socket(f, path, origin)).untouched, true, origin + path);
    }
  }
  f.result.assertNoViolations();
});

test('invalid origin configuration fails before any fixture is installed and never echoes configuration', async () => {
  for (const config of [{}, { liveOrigin: 'not a URL', siteOrigin: SITE },
    { liveOrigin: 'ftp://backend.invalid', siteOrigin: SITE },
    { liveOrigin: 'https://fictional-user:fictional-password@backend.invalid', siteOrigin: SITE }]) {
    await assert.rejects(installSeededUiIsolation({ addInitScript: () => assert.fail('Installed') }, config), error => {
      assert.match(error.message, /requires HTTP\(S\)/);
      assert.doesNotMatch(error.message, /fictional-password|not a URL/);
      return true;
    });
  }
});


test('socket rejection receipts explain observed state without a second session read or private URL values', async () => {
  const cases = [
    { name: 'no owner', owners: [], count: 0, observed: false, match: false, stored: null },
    { name: 'ambiguous owner', owners: [page(), page()], count: 2, observed: false, match: false, stored: null },
    { name: 'unknown identity', owners: [page({ id: 'fictional-private-identity' })], count: 1, observed: true, match: false, stored: false },
    { name: 'stored token', owners: [page({ id: IDS[0], access_token: 'fictional-stored-secret' })], count: 1, observed: true, match: true, stored: true },
    { name: 'query name', owners: [page()], count: 1, observed: true, match: true, stored: false, query: true },
    { name: 'empty query name', owners: [page()], count: 1, observed: true, match: true, stored: false, query: true, empty: true },
    { name: 'unavailable evaluation', owners: [page()], count: 1, observed: false, match: false, stored: null, unavailable: true },
    { name: 'closed owner', owners: [Object.assign(page(), { closed: true })], count: 0, observed: false, match: false, stored: null },
    { name: 'foreign owner', owners: [page(undefined, 'https://other.invalid')], count: 0, observed: false, match: false, stored: null },
    { name: 'call mismatch', owners: [page({ id: IDS[1] })], count: 1, observed: true, match: true, stored: false, mismatch: true },
  ];
  for (const c of cases) {
    let reads = 0;
    for (const owner of c.owners) {
      const evaluate = owner.evaluate.bind(owner);
      owner.evaluate = async fn => { reads += 1; if (c.unavailable) throw new Error('Fictional evaluation unavailable'); return evaluate(fn); };
    }
    const f = await fixture(c.owners);
    const path = c.mismatch ? `/api/ws/call/${IDS[0]}` : '/realtime/v1/websocket';
    const origin = c.mismatch ? WS : 'wss://fictional-user:fictional-password@custom-realtime.invalid:8443';
    const suffix = c.query ? `?token=${c.empty ? '' : 'fictional-query-secret'}&unused=fictional-unrelated-secret#fictional-fragment` : '?unused=fictional-unrelated-secret#fictional-fragment';
    const calls = await socket(f, path + suffix, origin);
    assert.deepEqual(calls.closed, [{ code: 1008, reason: 'Synthetic UI fixture: no server connection' }], c.name);
    assert.equal(calls.serverConnections, 0, c.name);
    assert.equal(reads, c.count === 1 ? 1 : 0, c.name);
    assert.equal(f.result.stats.blocked, 1, c.name);
    assert.equal(f.result.stats.callSockets + f.result.stats.realtimeSockets, 0, c.name);
    const violation = f.result.violations[0];
    assert.equal(violation.kind, 'unexpected-socket-session', c.name);
    assert.deepEqual(violation.socket, {
      origin: c.mismatch ? WS : 'wss://custom-realtime.invalid:8443',
      kind: c.mismatch ? 'call' : 'realtime', matchingPageCount: c.count,
      sessionObserved: c.observed, syntheticIdMatch: c.match,
      storedTokenPresent: c.stored, callMismatch: !!c.mismatch, tokenQueryPresent: !!c.query,
    }, c.name);
    assert.doesNotMatch(JSON.stringify(f.result), /fictional-(?:user|password|private-identity|stored-secret|query-secret|unrelated-secret|fragment)/);
    assert.throws(() => f.result.assertNoViolations(), /violation/);
  }
});

test('valid tokenless socket owners retain counters, no rejection receipt, one read and no server transport', async () => {
  for (const id of IDS) for (const path of ['/realtime/v1/websocket', `/api/ws/call/${id}`]) {
    const owner = page({ id });
    const f = await fixture([owner]);
    const calls = await socket(f, path);
    assert.equal(calls.closed[0].code, 1008);
    assert.equal(calls.serverConnections, 0);
    assert.equal(owner.evaluations.length, 1);
    assert.equal(f.result.stats.callSockets + f.result.stats.realtimeSockets, 1);
    assert.equal(f.result.stats.blocked, 0);
    assert.deepEqual(f.result.violations, []);
    f.result.assertNoViolations();
  }
});


test('socket observations classify only the existing read and never retain raw errors', async () => {
  for (const [message, outcome] of [
    ['page.evaluate: Test ended. private-fixture-value', 'evaluate-test-ended'],
    ['Target page, context or browser has been closed private-fixture-value', 'evaluate-context-closed'],
    ['other private-fixture-value', 'evaluate-other-error'],
  ]) {
    const owner = page(); let reads = 0;
    owner.evaluate = async () => { reads += 1; throw new Error(message); };
    const f = await fixture([owner]);
    const calls = await socket(f, '/api/ws/call/test-surfer-id');
    const receipt = f.result.violations[0];
    assert.equal(reads, 1); assert.equal(calls.closed[0].code, 1008);
    assert.equal(receipt.socketObservation.outcome, outcome);
    assert.equal(receipt.socketObservation.handlerId, 1);
    assert.ok(receipt.socketObservation.handlerEntrySequence < receipt.socketObservation.readStartSequence);
    assert.ok(receipt.socketObservation.readStartSequence < receipt.socketObservation.readSettlementSequence);
    assert.deepEqual(receipt.socketObservation.phaseAtReadStart,
      { fixtureUseReturned: false, contextCloseObserved: false, finalReceiptStarted: false });
    assert.deepEqual(receipt.socketObservation.phaseAtReadSettlement, receipt.socketObservation.phaseAtReadStart);
    assert.equal(JSON.stringify(receipt).includes('private-fixture-value'), false);
    assert.equal(receipt.socket.sessionObserved, false);
    assert.deepEqual(await f.result.lifecycle.drain(), { complete: true, pending: 0, handlerErrors: 0 });
  }
});

test('unreadable error metadata cannot change socket refusal or draining', async () => {
  const owner = page(); let reads = 0;
  owner.evaluate = async () => { reads += 1; throw Object.defineProperty({}, 'message', {
    get() { throw new Error('diagnostic getter failure'); },
  }); };
  const f = await fixture([owner]);
  assert.equal((await socket(f, '/api/ws/call/test-surfer-id')).closed[0].code, 1008);
  assert.equal(reads, 1);
  assert.equal(f.result.violations[0].socketObservation.outcome, 'evaluate-other-error');
  assert.deepEqual(await f.result.lifecycle.drain(), { complete: true, pending: 0, handlerErrors: 0 });
});

test('ambiguous ownership keeps no-read sentinels; pre-evaluation loss is distinct', async () => {
  for (const owners of [[], [page(), page()]]) {
    const f = await fixture(owners);
    await socket(f, '/api/ws/call/test-surfer-id');
    const o = f.result.violations[0].socketObservation;
    assert.equal(o.outcome, 'no-unique-owner');
    for (const key of ['readStartSequence', 'readSettlementSequence', 'phaseAtReadStart', 'phaseAtReadSettlement']) {
      assert.equal(o[key], null);
    }
    assert.ok(owners.every(owner => owner.evaluations.length === 0));
  }
  const owner = page(); let checks = 0;
  owner.isClosed = () => ++checks > 1;
  const f = await fixture([owner]); await socket(f, '/api/ws/call/test-surfer-id');
  assert.equal(f.result.violations[0].socketObservation.outcome, 'unavailable-before-evaluation');
  assert.equal(owner.evaluations.length, 0);
});

test('lifecycle observations are bounded, idempotent, copied and policy-neutral', async () => {
  const f = await fixture();
  f.result.observeFixtureUseReturned(); f.result.observeFixtureUseReturned();
  f.result.observeContextClose(); f.result.observeContextClose();
  f.result.observeFinalReceiptStart(); f.result.observeFinalReceiptStart();
  const first = f.result.socketLifecycleSnapshot();
  assert.equal(first.events.length, 3);
  assert.deepEqual(first.events.map(event => event.phase), ['fixtureUseReturned', 'contextCloseObserved', 'finalReceiptStarted']);
  first.phase.fixtureUseReturned = false; first.events[0].sequence = -1;
  assert.equal(f.result.socketLifecycleSnapshot().phase.fixtureUseReturned, true);
  assert.ok(f.result.socketLifecycleSnapshot().events[0].sequence > 0);
  await socket(f, '/api/ws/call/test-surfer-id');
  assert.equal(f.result.stats.callSockets, 1); assert.equal(f.result.stats.blocked, 0);
  f.pages[0].user = { id: 'test-surfer-id', access_token: 'fictional-token' };
  await socket(f, '/api/ws/call/test-surfer-id');
  assert.equal(f.result.stats.blocked, 1);
  assert.equal(f.result.violations[0].socketObservation.outcome, 'evaluated');
  assert.equal(f.result.violations[0].socket.storedTokenPresent, true);
  assert.equal(JSON.stringify(f.result.violations).includes('fictional-token'), false);
});

test('concurrent reads keep handler attribution when settlement order reverses', async () => {
  const owner = page(), pending = [];
  let started; const bothStarted = new Promise(resolve => { started = resolve; });
  owner.evaluate = () => new Promise((resolve, reject) => {
    pending.push({ resolve, reject }); if (pending.length === 2) started();
  });
  const f = await fixture([owner]);
  const first = socket(f, '/api/ws/call/test-surfer-id');
  const second = socket(f, '/realtime/v1/websocket?token=fictional-query', 'wss://realtime.invalid');
  await bothStarted;
  assert.equal(pending.length, 2);
  f.result.observeFixtureUseReturned();
  pending[1].resolve({ id: 'test-surfer-id', hasToken: false }); await second;
  const settledSecond = JSON.parse(JSON.stringify(f.result.violations[0]));
  f.result.observeContextClose(); f.result.observeFinalReceiptStart();
  pending[0].reject(new Error('page.evaluate: Test ended.')); await first;
  const [b, a] = f.result.violations.map(v => v.socketObservation);
  assert.equal(a.handlerId, 1); assert.equal(b.handlerId, 2);
  assert.ok(a.handlerEntrySequence < b.handlerEntrySequence);
  assert.ok(b.readSettlementSequence < a.readSettlementSequence);
  assert.equal(a.outcome, 'evaluate-test-ended'); assert.equal(b.outcome, 'evaluated');
  assert.deepEqual(a.phaseAtReadStart, { fixtureUseReturned: false, contextCloseObserved: false, finalReceiptStarted: false });
  assert.deepEqual(a.phaseAtReadSettlement, { fixtureUseReturned: true, contextCloseObserved: true, finalReceiptStarted: true });
  assert.deepEqual(b.phaseAtReadSettlement, { fixtureUseReturned: true, contextCloseObserved: false, finalReceiptStarted: false });
  assert.deepEqual(f.result.violations[0], settledSecond);
  assert.equal(JSON.stringify(f.result.violations).includes('fictional-query'), false);
  assert.deepEqual(await f.result.lifecycle.drain(), { complete: true, pending: 0, handlerErrors: 0 });
});
