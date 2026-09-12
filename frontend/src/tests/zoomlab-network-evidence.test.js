const { EventEmitter } = require('events');
const { attachNetworkEvidence, runWithNetworkEvidence } = require('../../scripts/zoomlab-network-evidence');

test('records DNS attribution while removing private URL components and error text', () => {
  const handlers = {};
  const snapshot = attachNetworkEvidence({ on: (name, fn) => { handlers[name] = fn; } });
  handlers.requestfailed({
    url: () => 'https://user:password@missing.example/private-id?token=secret#fragment',
    resourceType: () => 'fetch',
    failure: () => ({ errorText: 'net::ERR_NAME_NOT_RESOLVED https://example.test/?token=secret' }),
  });
  expect(snapshot()).toMatchObject({ requests: [{ origin: 'https://missing.example',
    resourceType: 'fetch', errorCode: 'net::ERR_NAME_NOT_RESOLVED' }], dropped: 0 });
  expect(JSON.stringify(snapshot())).not.toMatch(/password|private-id|secret|fragment/);
});

test('bounds capture and marks unknown origins/errors without exposing their values', () => {
  const page = new EventEmitter();
  const snapshot = attachNetworkEvidence(page, 1);
  const request = { url: () => 'data:private', resourceType: () => 'image', failure: () => null };
  page.emit('requestfailed', request);
  page.emit('requestfailed', request);
  expect(snapshot()).toMatchObject({ requests: [{ origin: null, resourceType: 'image', errorCode: 'UNKNOWN' }], dropped: 1 });
});

const EPOCH = Date.parse('2026-09-11T01:00:00Z');
function harness(options = {}) {
  const page = new EventEmitter();
  let ms = 0;
  let utcMs = EPOCH;
  const snapshot = attachNetworkEvidence(page, { now: () => ({ utcMs, monoMs: ms }), ...options });
  return { page, snapshot, advance: n => { ms += n; utcMs += n; }, wall: n => { utcMs = n; } };
}
function request(url = 'https://api.example/api/explore/spot-details/private-id?token=secret', code = 'net::ERR_FAILED') {
  return { url: () => url, resourceType: () => 'fetch', failure: () => ({ errorText: code }) };
}
function respond(page, req, status) {
  page.emit('response', { request: () => req, status: () => status });
}

test('separate weather ledger retains fast and late terminals after diagnostic exhaustion', () => {
  const h = harness({ limit: 1, weatherLimit: 2 });
  h.page.emit('requestfailed', request()); h.page.emit('requestfailed', request());
  const a = request('https://api.example/api/weather/grid?token=secret'), b = request('https://api.example/api/weather/grid_series');
  h.page.emit('request', a); const identity = h.snapshot.requestIdentity(a);
  h.advance(5); h.page.emit('request', b); respond(h.page, b, 200); h.page.emit('requestfinished', b);
  respond(h.page, a, 200); h.advance(5); h.page.emit('requestfinished', a);
  const s = h.snapshot();
  expect(s).toMatchObject({ dropped: 1, weatherSeen: 2, weatherDropped: 0 });
  expect(s.weatherRequests).toMatchObject([
    { requestId: h.snapshot.requestIdentity(b).requestId, outcome: 'finished', startedAtMonoMs: 5, observedAtMonoMs: 5 },
    { requestId: identity.requestId, outcome: 'finished', startedAtMonoMs: 0, observedAtMonoMs: 10 },
  ]);
  expect(h.snapshot.requestIdentity(a)).toEqual(identity); // still linkable after terminal removal
  expect(identity.captureId).toBe(s.captureId);
  expect(h.snapshot.requestIdentity({})).toBeNull();
  expect(JSON.stringify(s)).not.toContain('secret');
});
test('weather ledger overflow is explicit, keeps latest results and does not change default capture', () => {
  const h = harness({ weatherLimit: 1 });
  for (let i = 0; i < 3; i++) h.page.emit('requestfailed', request('https://api.example/api/weather/grid'));
  expect(h.snapshot()).toMatchObject({ weatherSeen: 3, weatherDropped: 2, weatherRequests: [{ requestId: 'r3' }] });
  const s = h.snapshot(); s.weatherRequests[0].status = 999;
  expect(h.snapshot().weatherRequests[0].status).toBeNull();
  expect(harness().snapshot().weatherRequests).toBeUndefined();
});
test.each([-1, 1.5, NaN, 1001])('rejects invalid weather ledger bound %s', weatherLimit => {
  expect(() => harness({ weatherLimit })).toThrow(RangeError);
});

test.each([
  ['/api/weather/grid_series', 'weather-grid-series'],
  ['/api/weather/grid_series/', 'weather-grid-series'],
  ['/api/weather/grid-series', 'weather-grid-series'],
  ['/api/weather/grid_series/private', null],
  ['/api/weather/grid_series_backup', null],
])('categorizes the real series endpoint without retaining private query data: %s', (path, route) => {
  const h = harness(), r = request('https://api.example' + path + '?token=secret');
  h.page.emit('request', r); h.page.emit('requestfailed', r);
  expect(h.snapshot().requests[0].route).toBe(route);
  expect(JSON.stringify(h.snapshot())).not.toContain('secret');
});

test('pairs overlapping identical URLs by request object and records measured timing', () => {
  const h = harness();
  const a = request(), b = request();
  h.page.emit('request', a); h.advance(20); h.page.emit('request', b); h.advance(30);
  h.page.emit('requestfailed', b); h.advance(50); h.page.emit('requestfailed', a);
  expect(h.snapshot().requests).toMatchObject([
    { requestId: 'r2', route: 'spot-details', durationMs: 30, startedAtUTC: new Date(EPOCH + 20).toISOString() },
    { requestId: 'r1', route: 'spot-details', durationMs: 100, startedAtUTC: new Date(EPOCH).toISOString() },
  ]);
  expect(h.snapshot().pending).toEqual([]);
});

test('uses monotonic elapsed time despite a wall-clock reversal', () => {
  const h = harness(), r = request();
  h.page.emit('request', r); h.advance(250); h.wall(EPOCH - 10000); h.page.emit('requestfailed', r);
  expect(h.snapshot().requests[0]).toMatchObject({ durationMs: 250, durationBasis: 'observer-monotonic' });
});

test.each([404, 429, 503])('records HTTP%d as an HTTP response, not a transport failure', status => {
  const h = harness(), r = request();
  h.page.emit('request', r); h.advance(5); respond(h.page, r, status); h.advance(5);
  h.page.emit('requestfinished', r);
  expect(h.snapshot()).toMatchObject({ requests: [{ outcome: 'http-error', status, errorCode: null, durationMs: 10 }],
    totals: { started: 1, finished: 1, failed: 0, httpErrors: 1 } });
});

test('retains response status when the body transfer subsequently fails', () => {
  const h = harness(), r = request();
  h.page.emit('request', r); respond(h.page, r, 200); h.advance(4); h.page.emit('requestfailed', r);
  expect(h.snapshot().requests[0]).toMatchObject({ outcome: 'failed', status: 200, errorCode: 'net::ERR_FAILED' });
});

test('fast successes do not fill diagnostic capacity; slow successes retain duration', () => {
  const h = harness({ limit: 1, slowMs: 1000 });
  for (let i = 0; i < 10; i++) {
    const r = request(); h.page.emit('request', r); respond(h.page, r, 200); h.advance(1); h.page.emit('requestfinished', r);
  }
  expect(h.snapshot().requests).toHaveLength(0);
  const slow = request(); h.page.emit('request', slow); respond(h.page, slow, 200); h.advance(1200); h.page.emit('requestfinished', slow);
  expect(h.snapshot()).toMatchObject({ requests: [{ outcome: 'slow', status: 200, durationMs: 1200 }],
    totals: { started: 11, finished: 11, slow: 1 }, dropped: 0 });
});

test('marks teardown aborts while preserving the phase where the request began', () => {
  const h = harness(), r = request(undefined, 'net::ERR_ABORTED');
  h.page.emit('request', r); h.snapshot.beginTeardown(); h.advance(2); h.page.emit('requestfailed', r);
  expect(h.snapshot().requests[0]).toMatchObject({ startedPhase: 'capture', finishedPhase: 'teardown', errorCode: 'net::ERR_ABORTED' });
});

test('bounded pending capture exposes overflow and unknown start instead of inventing timing', () => {
  const h = harness({ pendingLimit: 1 }), a = request(), b = request();
  h.page.emit('request', a); h.page.emit('request', b); h.advance(8); h.page.emit('requestfailed', b);
  expect(h.snapshot()).toMatchObject({ trackingDropped: 1, totals: { started: 2, unattributedTerminals: 1 },
    requests: [{ durationMs: null, startedAtUTC: null, startedPhase: null }] });
  expect(h.snapshot().pending).toHaveLength(1);
});

test('stop detaches owned listeners, retains incomplete requests and freezes returned copies', () => {
  const h = harness(), r = request();
  const other = jest.fn(); h.page.on('requestfailed', other);
  h.page.emit('request', r); h.advance(9); h.snapshot.stop();
  const first = h.snapshot();
  expect(first).toMatchObject({ stopped: true, pending: [{ outcome: 'incomplete', durationMs: 9 }] });
  first.pending[0].origin = 'mutated'; first.totals.started = 999;
  h.page.emit('requestfailed', r); h.advance(9000);
  expect(h.snapshot().pending[0].durationMs).toBe(9);
  expect(h.snapshot().pending[0].origin).toBe('https://api.example');
  expect(h.snapshot().totals.started).toBe(1);
  expect(other).toHaveBeenCalledTimes(1);
  expect(h.page.listenerCount('request')).toBe(0);
  expect(h.page.listenerCount('requestfailed')).toBe(1);
});

test('record overflow is explicit and snapshots cannot mutate retained records', () => {
  const h = harness({ limit: 1 });
  h.page.emit('requestfailed', request()); h.page.emit('requestfailed', request());
  const first = h.snapshot(); first.requests[0].origin = 'mutated';
  expect(h.snapshot()).toMatchObject({ dropped: 1, requests: [{ origin: 'https://api.example' }] });
});

test('only fixed route categories and diagnostic codes survive serialization', () => {
  const h = harness();
  const r = request('https://user:password@api.example/private-person?token=secret#fragment', 'private error net::ERR_FAILED private-url');
  h.page.emit('request', r); h.page.emit('requestfailed', r);
  expect(h.snapshot().requests[0]).toMatchObject({ route: null, origin: 'https://api.example', errorCode: 'net::ERR_FAILED' });
  expect(JSON.stringify(h.snapshot())).not.toMatch(/password|private-person|secret|fragment|private error|private-url/);
});

test.each([-1, NaN, Infinity, 1001])('rejects invalid record limit %s', limit => {
  expect(() => attachNetworkEvidence(new EventEmitter(), limit)).toThrow(RangeError);
});

test('session failure still saves teardown evidence and preserves the original exception', async () => {
  const page = new EventEmitter(), r = request();
  const original = new Error('scenario failure');
  const save = jest.fn();
  await expect(runWithNetworkEvidence(page, {
    run: async () => { page.emit('request', r); throw original; },
    close: async () => { page.emit('requestfailed', r); throw new Error('close failure'); }, save,
  })).rejects.toBe(original);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ stopped: true,
    completion: { scenarioCompleted: false, contextClosed: false },
    requests: [expect.objectContaining({ finishedPhase: 'teardown' })] }));
});

test('successful session returns the result and saves only after close', async () => {
  const order = [], save = jest.fn(() => { order.push('save'); });
  const result = await runWithNetworkEvidence(new EventEmitter(), {
    run: async () => { order.push('run'); return 7; },
    close: async () => { order.push('close'); }, save,
  });
  expect(result).toBe(7); expect(order).toEqual(['run', 'close', 'save']);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ completion: { scenarioCompleted: true, contextClosed: true } }));
});
