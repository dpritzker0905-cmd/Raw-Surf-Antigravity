const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRouteLifecycle } = require('./offline-backend/route_lifecycle');
const { routeWeatherToLocal } = require('./offline-backend/weather_route');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject }; };

test('drain waits for late close classification before final counters', async () => {
  let handle;
  const stats = await routeWeatherToLocal({ route: async (_, fn) => { handle = fn; } },
    { liveOrigin: 'https://backend.invalid', local: 'http://127.0.0.1:4100' });
  const pending = deferred();
  const operation = handle({ request: () => ({ url: () => 'https://backend.invalid/api/weather/grid',
    method: () => 'GET', headerValue: async () => null }), fetch: () => pending.promise,
    abort: async () => {}, fulfill: async () => assert.fail('closing request fulfilled') });
  await new Promise(setImmediate);
  let finished = false;
  const drain = stats.lifecycle.drain().then(result => { finished = true; return result; });
  await new Promise(setImmediate);
  assert.equal(finished, false);
  assert.equal(stats.cancelled, 0);
  pending.reject(new Error('Target page, context or browser has been closed'));
  await operation;
  assert.deepEqual(await drain, { complete: true, pending: 0, handlerErrors: 0 });
  assert.equal(stats.cancelled, 1);
  assert.equal(stats.failed, 0);
});

test('a real reset remains a local failure while the handler is drained', async () => {
  let handle;
  const stats = await routeWeatherToLocal({ route: async (_, fn) => { handle = fn; } },
    { liveOrigin: 'https://backend.invalid', local: 'http://127.0.0.1:4100' });
  let status;
  await handle({ request: () => ({ url: () => 'https://backend.invalid/api/weather/grid',
    method: () => 'GET', headerValue: async () => null }), fetch: async () => { throw new Error('read ECONNRESET'); },
    fulfill: async response => { status = response.status; } });
  assert.equal(status, 502);
  assert.equal(stats.failed, 1);
  assert.equal(stats.cancelled, 0);
  assert.equal((await stats.lifecycle.drain()).complete, true);
});

test('deadline reports incomplete without cancelling a pending task', async () => {
  const lifecycle = createRouteLifecycle(), pending = deferred();
  const task = lifecycle.wrap(() => pending.promise)();
  assert.deepEqual(await lifecycle.drain(5), { complete: false, pending: 1, handlerErrors: 0 });
  pending.resolve(); await task;
  assert.deepEqual(await lifecycle.drain(), { complete: true, pending: 0, handlerErrors: 0 });
});

test('handler rejection is preserved and prevents complete accounting', async () => {
  const lifecycle = createRouteLifecycle(), original = new Error('primary handler failure');
  await assert.rejects(lifecycle.wrap(async () => { throw original; })(), error => error === original);
  assert.deepEqual(await lifecycle.drain(), { complete: false, pending: 0, handlerErrors: 1 });
});

test('drain includes a handler started by a completing handler', async () => {
  const lifecycle = createRouteLifecycle(), pending = deferred(); let child;
  await lifecycle.wrap(async () => { child = lifecycle.wrap(() => pending.promise)(); })();
  const drain = lifecycle.drain(); pending.resolve(); await child;
  assert.deepEqual(await drain, { complete: true, pending: 0, handlerErrors: 0 });
});


test('UI HTTP and socket handlers participate in the same final drain', async () => {
  const { installSeededUiIsolation } = require('../e2e/seededUiIsolation');
  let http, socket;
  const page = { url: () => 'http://127.0.0.1:9900/admin', isClosed: () => false,
    evaluate: async () => ({ id: 'test-surfer-id', hasToken: false }) };
  const context = { addInitScript: async () => {}, route: async (_, fn) => { http = fn; },
    routeWebSocket: async (_, fn) => { socket = fn; }, on: () => {}, pages: () => [page] };
  const isolation = await installSeededUiIsolation(context,
    { liveOrigin: 'https://backend.invalid', siteOrigin: 'http://127.0.0.1:9900' });
  const httpPending = deferred(), socketPending = deferred();
  const httpTask = http({ request: () => ({ url: () => 'https://backend.invalid/api/weather/client-diagnostics',
    method: () => 'POST', headerValue: async () => null }), fulfill: () => httpPending.promise });
  const socketTask = socket({ url: () => 'wss://backend.invalid/api/ws/admin/events', close: () => socketPending.promise });
  await new Promise(setImmediate);
  let finished = false;
  const drain = isolation.lifecycle.drain().then(result => { finished = true; return result; });
  await new Promise(setImmediate); assert.equal(finished, false);
  httpPending.resolve(); await httpTask;
  assert.equal(isolation.stats.rumAnswered, 1);
  assert.equal(finished, false);
  socketPending.resolve(); await socketTask;
  assert.deepEqual(await drain, { complete: true, pending: 0, handlerErrors: 0 });
  assert.equal(isolation.stats.adminSockets, 1);
  assert.deepEqual(isolation.violations, []);
});
