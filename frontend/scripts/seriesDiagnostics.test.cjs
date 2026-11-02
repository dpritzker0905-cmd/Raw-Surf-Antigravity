const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { HEADER, requestIdFor, createSeriesDiagnostics } = require('./offline-backend/series_diagnostics.cjs');
const { routeWeatherToLocal } = require('./offline-backend/weather_route');
const { recordWeatherRequests } = require('../e2e/requestRecorder');
const URL_TEXT = 'https://backend.invalid/api/weather/grid_series?model=GFS&domain=marine&layer=waves&hours=0,3&token=never-log';
const LOCAL = 'http://127.0.0.1:4100';

function setup({ fetchError, fulfillError, diagnosticSink } = {}) {
  const page = new EventEmitter(), calls = {}, lines = [];
  const request = { url: () => URL_TEXT, method: () => 'GET', headerValue: async () => null,
    headers: () => ({ authorization: 'never-log-auth', cookie: 'never-log-cookie' }),
    allHeaders: async () => ({ authorization: 'never-log-auth', cookie: 'never-log-cookie' }),
    timing: () => ({ startTime: 1000, responseEnd: 20 }),
    failure: () => ({ errorText: 'net::ERR_ABORTED' }),
    response: async () => ({ status: () => 200, headerValue: async () => calls.fetch.headers[HEADER] }) };
  page.route = async (_, handler) => { calls.handler = handler; };
  const route = { request: () => request,
    fetch: async options => {
      calls.fetch = options;
      if (fetchError) throw fetchError;
      return { headers: () => ({ [HEADER]: options.headers?.[HEADER] || '', 'content-type': 'application/json' }),
        status: () => 200 };
    },
    fulfill: async options => { calls.fulfill = options; if (fulfillError) throw fulfillError; },
    abort: async () => { calls.aborted = true; } };
  return { page, calls, request, route, lines,
    config: { liveOrigin: 'https://backend.invalid', local: LOCAL,
      seriesDiagnostics: { project: 'Desktop Chrome', test: 'known test', retry: 0 },
      diagnosticSink: diagnosticSink || (line => lines.push(JSON.parse(line.slice('[SYNTHETIC SERIES] '.length)))) } };
}
test('recorder, route header, and backend header share one ID; existing headers survive', async () => {
  const f = setup(), rows = recordWeatherRequests(f.page, () => 'gesture');
  const stats = await routeWeatherToLocal(f.page, f.config);
  f.page.emit('request', f.request);
  await f.calls.handler(f.route);
  f.page.emit('requestfinished', f.request);
  await new Promise(setImmediate);
  assert.equal(rows[0].clientRequestId, f.calls.fetch.headers[HEADER]);
  assert.equal(rows[0].backendRequestId, rows[0].clientRequestId);
  assert.equal(rows[0].failureKind, null);
  assert.equal(f.calls.fetch.headers.authorization, 'never-log-auth');
  assert.equal(f.calls.fetch.headers.cookie, 'never-log-cookie');
  assert.equal(f.calls.fulfill.headers[HEADER], rows[0].clientRequestId);
  assert.equal(stats.local, 1);
  assert.equal(stats.cancelled, 0);
  assert.deepEqual(f.lines.map(r => r.event), ['fetch_start', 'fetch_response', 'fulfilled']);
  assert.ok(f.lines.every(r => r.request_id === rows[0].clientRequestId));
  assert.ok(!JSON.stringify(f.lines).includes('never-log'));
});
test('browser failure retains client ID and only a sanitized error token', async () => {
  const f = setup({ fulfillError: new Error('page already gone private-detail') });
  const rows = recordWeatherRequests(f.page, () => 'gesture');
  const stats = await routeWeatherToLocal(f.page, f.config);
  f.page.emit('request', f.request);
  await f.calls.handler(f.route);
  f.page.emit('requestfailed', f.request);
  await new Promise(setImmediate);
  assert.equal(rows[0].clientRequestId, f.calls.fetch.headers[HEADER]);
  assert.equal(rows[0].backendRequestId, null);
  assert.equal(rows[0].failureKind, 'ERR_ABORTED');
  assert.equal(stats.failed, 0);
  assert.equal(stats.cancelled, 1);
  assert.equal(f.lines.at(-1).event, 'fulfill_error');
  assert.ok(!JSON.stringify(f.lines).includes('private-detail'));
});
test('transport reset classification and fail-closed 502 are unchanged', async () => {
  const f = setup({ fetchError: new Error('read ECONNRESET') });
  const stats = await routeWeatherToLocal(f.page, f.config);
  await f.calls.handler(f.route);
  assert.equal(stats.failed, 1);
  assert.equal(stats.cancelled, 0);
  assert.equal(f.calls.fulfill.status, 502);
  assert.equal(f.lines.at(-1).error_kind, 'transport_reset');
});
test('sink failure cannot change success; disabled correlation preserves old fetch options', async () => {
  const f = setup({ diagnosticSink: () => { throw new Error('sink'); } });
  const stats = await routeWeatherToLocal(f.page, f.config);
  await f.calls.handler(f.route);
  assert.equal(stats.local, 1);
  const plain = setup();
  delete plain.config.seriesDiagnostics;
  await routeWeatherToLocal(plain.page, plain.config);
  await plain.calls.handler(plain.route);
  assert.equal(plain.calls.fetch.headers, undefined);
  assert.deepEqual(plain.lines, []);
});
test('IDs are stable per request and unique across equal-URL request objects', () => {
  const a = {}, b = {};
  assert.equal(requestIdFor(a), requestIdFor(a));
  assert.notEqual(requestIdFor(a), requestIdFor(b));
  const lines = [];
  createSeriesDiagnostics({}, line => lines.push(line)).begin(a, new URL(URL_TEXT));
  assert.ok(!lines[0].includes('never-log'));
});
test('correlation refuses a remote target before registering the route', async () => {
  const f = setup();
  f.config.local = 'https://remote.invalid';
  await assert.rejects(routeWeatherToLocal(f.page, f.config), /loopback/);
  assert.equal(f.calls.handler, undefined);
});

test('correlation keeps Playwright default headers and does not broaden to raw-only headers', async () => {
  const f = setup();
  let rawReads = 0;
  f.request.headers = () => ({ 'x-baseline': 'keep' });
  f.request.allHeaders = async () => {
    rawReads += 1;
    return { 'x-baseline': 'keep', authorization: 'raw-only-marker', cookie: 'raw-only-cookie' };
  };
  await routeWeatherToLocal(f.page, f.config);
  await f.calls.handler(f.route);
  assert.deepEqual(f.calls.fetch.headers, { 'x-baseline': 'keep', [HEADER]: requestIdFor(f.request) });
  assert.equal(rawReads, 0);
  assert.equal(f.calls.fetch.url, LOCAL + new URL(URL_TEXT).pathname + new URL(URL_TEXT).search);
  assert.equal(f.calls.fetch.timeout, 120000);
});

// Exact Playwright 1.60 teardown reasons; no live request or browser is created.
for (const message of ['Test ended.', 'route.fetch: Test ended.']) {
  test(`exact test-ended cancellation shares routing and diagnostic classification: ${message}`, async () => {
    const f = setup({ fetchError: new Error(message) });
    const stats = await routeWeatherToLocal(f.page, f.config);
    await f.calls.handler(f.route);
    assert.deepEqual([stats.local, stats.failed, stats.cancelled], [0, 0, 1]);
    assert.deepEqual(stats.failedExamples, []);
    assert.equal(f.calls.aborted, true);
    assert.equal(f.calls.fulfill, undefined);
    assert.deepEqual(f.lines.map(row => row.event), ['fetch_start', 'fetch_error']);
    assert.equal(f.lines.at(-1).error_kind, 'page_or_context_closed');
    assert.equal(f.lines[0].request_id, f.lines[1].request_id);
    assert.deepEqual(await stats.lifecycle.drain(), { complete: true, pending: 0, handlerErrors: 0 });
  });
}

for (const [message, kind] of [
  ['route.fetch: read ECONNRESET', 'transport_reset'],
  ['route.fetch: Timeout 120000ms exceeded.', 'timeout'],
  ['route.fetch: unexpected upstream error', 'other'],
  ['route.fetch: upstream says Test ended.', 'other'],
  ['route.fetch: Test ended. unexpectedly', 'other'],
  ['route.fetch: Test ended.\nread ECONNRESET', 'transport_reset'],
]) {
  test(`non-cancellation remains a failed local 502: ${message}`, async () => {
    const f = setup({ fetchError: new Error(message) });
    const stats = await routeWeatherToLocal(f.page, f.config);
    await f.calls.handler(f.route);
    assert.deepEqual([stats.local, stats.failed, stats.cancelled], [0, 1, 0]);
    assert.equal(f.calls.aborted, undefined);
    assert.equal(f.calls.fulfill.status, 502);
    assert.equal(stats.failedExamples.length, 1);
    assert.equal(f.lines.at(-1).error_kind, kind);
    assert.deepEqual(await stats.lifecycle.drain(), { complete: true, pending: 0, handlerErrors: 0 });
  });
}
