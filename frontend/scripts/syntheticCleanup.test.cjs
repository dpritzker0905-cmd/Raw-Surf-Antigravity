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


function actualOfflineFixture(logs) {
  const fs = require('node:fs'), vm = require('node:vm');
  let definitions;
  const base = { test: { extend: value => { definitions = value; return {}; } },
    expect: (actual, message) => ({ toBe: expected => assert.equal(actual, expected, message) }) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../e2e/offlineWeather'), 'utf8'), {
    require: name => {
      if (name === '@playwright/test') return base;
      if (name === 'node:fs') return { appendFileSync: () => assert.fail('mock fixture wrote a ledger file') };
      if (name === './seededUiIsolation') return require('../e2e/seededUiIsolation');
      if (name === '../scripts/offline-backend/weather_route') return require('./offline-backend/weather_route');
      throw new Error('Unexpected fixture dependency: ' + name);
    },
    process: { env: { E2E_WEATHER_BACKEND: 'http://127.0.0.1:4100', E2E_BASE_URL: 'https://site.invalid',
      REACT_APP_BACKEND_URL: 'https://backend.invalid' } },
    URL, module, console: { log: line => logs.push(line) },
  }, { filename: require.resolve('../e2e/offlineWeather') });
  assert.equal(typeof definitions.offlineWeather[0], 'function');
  assert.equal(typeof definitions.syntheticFinalReceipt[0], 'function');
  return definitions;
}

async function fixtureCompletionExperiment({ interrupted, id = 'test-surfer-id' }) {
  const vm = require('node:vm'), { EventEmitter } = require('node:events');
  const logs = [], events = [], definitions = actualOfflineFixture(logs);
  const finalReady = deferred(), finalRelease = deferred(), fixtureReady = deferred(), fixtureRelease = deferred();
  const readStarted = deferred(), readRelease = deferred();
  let register, ended = false, contextClosed = false, reads = 0, storageReads = 0, remoteConnections = 0;
  const user = { id };
  const page = { url: () => 'https://site.invalid/map', isClosed: () => contextClosed,
    evaluate: async fn => {
      reads += 1; events.push('read-start'); readStarted.resolve(); await readRelease.promise;
      if (ended) { events.push('read-Test-ended'); throw new Error('page.evaluate: Test ended.'); }
      const value = vm.runInNewContext(`(${fn.toString()})()`, {
        localStorage: { getItem: key => { storageReads += 1; assert.equal(key, 'raw-surf-user'); return JSON.stringify(user); } },
      });
      events.push('read-result'); return JSON.parse(JSON.stringify(value));
    } };
  const context = Object.assign(new EventEmitter(), { sockets: [],
    addInitScript: async () => {}, route: async () => {},
    routeWebSocket: async (matches, handle) => { context.sockets.push({ matches, handle }); },
    pages: () => contextClosed ? [] : [page],
    close: () => assert.fail('fixture must not close a borrowed context') });
  const finalOwner = definitions.syntheticFinalReceipt[0]({ browserName: 'local-mock-no-browser' }, async callback => {
    register = callback; finalReady.resolve(); await finalRelease.promise;
  });
  let finalDone = false;
  const finalOutcome = finalOwner.then(() => { finalDone = true; return null; }, error => { finalDone = true; return error; });
  await finalReady.promise;
  const fixtureOwner = definitions.offlineWeather[0]({ context, syntheticFinalReceipt: register }, async () => {
    events.push('fixture-ready'); fixtureReady.resolve(); await fixtureRelease.promise; events.push('fixture-use-returned');
  }, { project: { name: 'local-mock-no-browser' }, titlePath: ['mock', 'controlled lifecycle'], retry: 0 });
  await Promise.race([fixtureReady.promise, fixtureOwner.then(() => assert.fail('fixture ended before setup'))]);
  const url = 'wss://backend.invalid/api/ws/call/test-surfer-id';
  const route = context.sockets.find(candidate => candidate.matches(new URL(url)));
  assert.ok(route, 'actual fixture must register the actual call-socket guard');
  const closed = [];
  const operation = route.handle({ url: () => url,
    connectToServer: () => { remoteConnections += 1; assert.fail('mock opened transport'); },
    close: async value => { closed.push(value); events.push('socket-close'); } });
  await readStarted.promise;
  if (!interrupted) { readRelease.resolve(); await operation; }
  ended = true; events.push('test-complete');
  fixtureRelease.resolve(); await fixtureOwner;
  contextClosed = true; context.emit('close'); events.push('context-close-event');
  finalRelease.resolve();
  if (interrupted) {
    await new Promise(setImmediate);
    assert.equal(finalDone, false, 'actual finalizer must wait for the pending guard');
    assert.equal(logs.length, 0, 'do not emit premature complete counters');
    readRelease.resolve(); await operation;
  }
  const finalError = await finalOutcome;
  events.push(finalError ? 'final-policy-error' : 'final-policy-green');
  const ui = JSON.parse(logs.find(line => line.startsWith('[SEEDED UI ISOLATION] ')).slice('[SEEDED UI ISOLATION] '.length));
  const weather = JSON.parse(logs.find(line => line.startsWith('[OFFLINE WEATHER] ')).slice('[OFFLINE WEATHER] '.length));
  assert.equal(user.id, id); assert.equal(user.access_token, undefined);
  assert.equal(reads, 1); assert.equal(storageReads, interrupted ? 0 : 1);
  assert.equal(remoteConnections, 0);
  assert.deepEqual(closed, [{ code: 1008, reason: 'Synthetic UI fixture: no server connection' }]);
  assert.equal(ui.cleanup.complete, true); assert.equal(ui.cleanup.contextClosed, true);
  assert.deepEqual(ui.cleanup.ui, { complete: true, pending: 0, handlerErrors: 0 });
  assert.equal(weather.sentToLive, 0); assert.equal(weather.routedToLocal, 0);
  return { finalError, ui, weather, events, reads, storageReads, remoteConnections };
}


test('actual fixture observes markers before drain while interrupted identity stays unknown and rejected', async () => {
  const valid = await fixtureCompletionExperiment({ interrupted: true });
  const invalid = await fixtureCompletionExperiment({ interrupted: true, id: 'fictional-other-owner' });
  assert.deepEqual(valid.ui, invalid.ui, 'the interrupted read cannot prove stored identity');
  assert.match(valid.finalError.message, /Seeded UI isolation recorded 1 violation/);
  const o = valid.ui.violations[0].socketObservation;
  assert.equal(o.outcome, 'evaluate-test-ended');
  assert.deepEqual(o.phaseAtReadStart, { fixtureUseReturned: false, contextCloseObserved: false, finalReceiptStarted: false });
  assert.deepEqual(o.phaseAtReadSettlement, { fixtureUseReturned: true, contextCloseObserved: true, finalReceiptStarted: true });
  const events = valid.ui.socketLifecycle.events;
  assert.deepEqual(events.map(event => event.phase), ['fixtureUseReturned', 'contextCloseObserved', 'finalReceiptStarted']);
  assert.ok(events.every(event => event.sequence > o.readStartSequence && event.sequence < o.readSettlementSequence));
});

test('actual fixture completed read retains valid acceptance and invalid rejection', async () => {
  const valid = await fixtureCompletionExperiment({ interrupted: false });
  assert.equal(valid.finalError, null); assert.equal(valid.ui.callSockets, 1);
  assert.deepEqual(valid.ui.violations, []);
  assert.equal(valid.ui.socketLifecycle.events.length, 3);
  const invalid = await fixtureCompletionExperiment({ interrupted: false, id: 'fictional-other-owner' });
  assert.match(invalid.finalError.message, /Seeded UI isolation recorded 1 violation/);
  const o = invalid.ui.violations[0].socketObservation;
  assert.equal(o.outcome, 'evaluated');
  assert.deepEqual(o.phaseAtReadSettlement, { fixtureUseReturned: false, contextCloseObserved: false, finalReceiptStarted: false });
  assert.ok(o.readSettlementSequence < invalid.ui.socketLifecycle.events[0].sequence);
});
