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
      if (name === '../scripts/offline-backend/route_lifecycle') return require('./offline-backend/route_lifecycle');
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


// Drive the actual fixture and guard; only the native context/RPC boundary is controlled.
async function afterUseCloseRace({ user = { id: 'test-surfer-id' }, completed = false,
  independentError = false, owners = 1, pendingHttp = false, beforeReadRelease = async () => {},
  expectComplete = true, lateUnknownDuringClose = false, lateKnownDuringClose = false, appScope = null, lateSocketProducer = null, shutdownStatus = 'complete' } = {}) {
  const vm = require('node:vm'), { EventEmitter } = require('node:events');
  const logs = [], definitions = actualOfflineFixture(logs);
  const finalReady = deferred(), finalRelease = deferred(), fixtureReady = deferred(), fixtureRelease = deferred();
  const readStarted = deferred(), readRelease = deferred();
  let register, closed = false, readSettled = false, reads = 0, storageReads = 0, connects = 0;
  const closeCalls = [], socketCloses = [], events = [];
  let lateOperation;
  const httpStarted = deferred(), httpRelease = deferred();
  const owner = { url: () => 'https://site.invalid/map', isClosed: () => closed,
    evaluate: async fn => {
      if (fn.name === 'shutdownAppDocument') {
        events.push('app-shutdown');
        if (appScope) return vm.runInNewContext(`(${fn.toString()})()`, appScope);
        return { status: shutdownStatus, client: 'unconfigured' };
      }
      reads += 1; events.push('read-start'); readStarted.resolve();
      try {
        await readRelease.promise;
        return JSON.parse(JSON.stringify(vm.runInNewContext(`(${fn.toString()})()`, {
          localStorage: { getItem: key => {
            storageReads += 1; assert.equal(key, 'raw-surf-user'); return JSON.stringify(user);
          } },
        })));
      } finally { readSettled = true; events.push('read-settled'); }
    } };
  const context = Object.assign(new EventEmitter(), { sockets: [], routes: [],
    addInitScript: async () => {}, route: async (matches, handle) => { context.routes.push({ matches, handle }); },
    routeWebSocket: async (matches, handle) => { context.sockets.push({ matches, handle }); },
    pages: () => Array.from({ length: owners }, () => owner),
    async close(options) {
      assert.equal(this, context, 'preserve the native close receiver');
      closeCalls.push(options); events.push('native-close-start');
      if (lateSocketProducer) await lateSocketProducer(context.sockets[0].handle, socketCloses);
      else if (lateKnownDuringClose) {
        lateOperation = context.sockets[0].handle({ url: () => 'wss://realtime.invalid/realtime/v1/websocket',
          connectToServer: () => assert.fail('late known producer opened upstream'),
          close: async value => socketCloses.push(value) });
        await lateOperation;
      }
      closed = true;
      if (lateUnknownDuringClose) {
        lateOperation = context.sockets[0].handle({ url: () => 'wss://realtime.invalid/realtime/v1/websocket?token=fictional-query',
          connectToServer: () => { connects += 1; assert.fail('late callback opened upstream'); },
          close: async value => socketCloses.push(value) });
      }
      // Model the pinned native close boundary cancelling an already pending Evaluate.
      if (!readSettled && reads) readRelease.reject(new Error('page.evaluate: Test ended.'));
      await new Promise(setImmediate);
      context.emit('close'); events.push('native-close-event'); return 'native-close-result';
    } });
  const finalOwner = definitions.syntheticFinalReceipt[0]({ browserName: 'local-mock-no-browser' }, async callback => {
    register = callback; finalReady.resolve(); await finalRelease.promise;
  });
  const finalOutcome = finalOwner.then(() => null, error => error);
  await finalReady.promise;
  const fixtureOwner = definitions.offlineWeather[0]({ context, syntheticFinalReceipt: register }, async () => {
    fixtureReady.resolve(); await fixtureRelease.promise;
  }, { project: { name: 'local-mock-no-browser' }, titlePath: ['mock', 'after-use close race'], retry: 0 });
  await fixtureReady.promise;
  fixtureRelease.resolve(); await fixtureOwner; events.push('fixture-returned');
  let httpOperation;
  if (pendingHttp) {
    const httpURL = 'https://backend.invalid/api/weather/client-diagnostics';
    const httpRoute = context.routes.filter(r => typeof r.matches === 'function' && r.matches(new URL(httpURL))).at(-1);
    assert.ok(httpRoute);
    httpOperation = httpRoute.handle({ request: () => ({ url: () => httpURL, method: () => 'POST', headerValue: async () => null }),
      fulfill: async () => { httpStarted.resolve(); await httpRelease.promise; events.push('http-settled'); } });
    await httpStarted.promise;
  }
  const url = 'wss://realtime.invalid/realtime/v1/websocket';
  const route = context.sockets.find(candidate => candidate.matches(new URL(url))); assert.ok(route);
  // A native event dispatch does not await this callback before a separate close request.
  const operation = route.handle({ url: () => url,
    connectToServer: () => { connects += 1; assert.fail('opened upstream'); },
    close: async value => { socketCloses.push(value); events.push('socket-close'); } });
  if (owners === 1) {
    await readStarted.promise;
    if (independentError) { readRelease.reject(new Error('page.evaluate: Test ended.')); await operation; }
    else if (completed) { readRelease.resolve(); await operation; }
  } else await operation;
  const closePromise = context.close({ reason: 'Test ended.' });
  await new Promise(setImmediate);
  const nativeCloseBeforeReadRelease = closeCalls.length > 0;
  await beforeReadRelease();
  // When a coordinator correctly waits, the existing read can settle before native close.
  if (!completed && !independentError) readRelease.resolve();
  const closeResult = await closePromise; await operation;
  if (lateOperation) await lateOperation;
  if (pendingHttp) { httpRelease.resolve(); await httpOperation; }
  finalRelease.resolve(); const finalError = await finalOutcome;
  const ui = JSON.parse(logs.find(line => line.startsWith('[SEEDED UI ISOLATION] ')).slice('[SEEDED UI ISOLATION] '.length));
  assert.equal(connects, 0); assert.equal(closeResult, 'native-close-result');
  assert.deepEqual(closeCalls, [{ reason: 'Test ended.' }]);
  assert.deepEqual(socketCloses, Array.from({ length: lateUnknownDuringClose || lateKnownDuringClose ? 2 : 1 },
    () => ({ code: 1008, reason: 'Synthetic UI fixture: no server connection' })));
  assert.deepEqual(ui.cleanup.ui, { complete: true, pending: 0, handlerErrors: 0 });
  assert.equal(ui.cleanup.complete, expectComplete);
  assert.equal(reads, owners === 1 ? (lateKnownDuringClose ? 2 : 1) : 0);
  const weather = JSON.parse(logs.find(line => line.startsWith('[OFFLINE WEATHER] ')).slice('[OFFLINE WEATHER] '.length));
  return { finalError, ui, weather, events, reads, storageReads, nativeCloseBeforeReadRelease };
}

test('after-use healthy identity read settles before native context close', async () => {
  const result = await afterUseCloseRace();
  assert.equal(result.finalError, null, 'native context teardown must not cancel an already pending valid guard read');
  assert.equal(result.storageReads, 1); assert.equal(result.ui.realtimeSockets, 1); assert.equal(result.ui.blocked, 0);
  assert.equal(result.nativeCloseBeforeReadRelease, false, 'one microtask delay is not sufficient coordination');
  assert.ok(result.events.indexOf('read-settled') < result.events.indexOf('native-close-start'));
});

test('after-use invalid and token-bearing identities remain observed and refused', async () => {
  for (const user of [{ id: 'fictional-other-owner' }, { id: 'test-surfer-id', access_token: 'fictional-token' }]) {
    const result = await afterUseCloseRace({ user });
    assert.match(result.finalError.message, /Seeded UI isolation recorded 1 violation/);
    assert.equal(result.storageReads, 1);
    const v = result.ui.violations[0]; assert.equal(v.socket.sessionObserved, true);
    assert.equal(v.socketObservation.outcome, 'evaluated');
    assert.equal(JSON.stringify(result.ui).includes('fictional-token'), false);
  }
});

test('after-use completed valid control remains accepted', async () => {
  const result = await afterUseCloseRace({ completed: true });
  assert.equal(result.finalError, null); assert.equal(result.storageReads, 1);
});

test('after-use independent unavailable or ambiguous identity remains a policy failure', async () => {
  for (const config of [{ independentError: true }, { owners: 2 }]) {
    const result = await afterUseCloseRace(config);
    assert.match(result.finalError.message, /Seeded UI isolation recorded 1 violation/);
    assert.equal(result.ui.blocked, 1); assert.equal(result.ui.violations[0].socket.sessionObserved, false);
    assert.equal(result.ui.violations[0].socketObservation.outcome,
      config.owners ? 'no-unique-owner' : 'evaluate-test-ended');
  }
});


test('after-use socket settlement does not wait for an unrelated HTTP handler', async () => {
  const result = await afterUseCloseRace({ pendingHttp: true });
  assert.equal(result.finalError, null); assert.equal(result.ui.rumAnswered, 1);
  assert.ok(result.events.indexOf('native-close-start') < result.events.indexOf('http-settled'));
});

const { coordinateContextClose } = require('./offline-backend/route_lifecycle');

test('close coordinator waits for current and newly started socket work and preserves native call', async () => {
  const life = createRouteLifecycle(), first = deferred(), second = deferred();
  const calls = [], options = { reason: 'local-test' };
  const context = { close(value) { assert.equal(this, context); calls.push(value); return 'native-result'; } };
  const nativeClose = context.close, descriptor = Object.getOwnPropertyDescriptor(context, 'close');
  const barrier = coordinateContextClose(context, () => life.drain());
  const one = life.wrap(() => first.promise)();
  const close = context.close(options);
  await new Promise(setImmediate); assert.equal(calls.length, 0);
  const two = life.wrap(() => second.promise)(); first.resolve(); await one;
  await new Promise(setImmediate); assert.equal(calls.length, 0);
  second.resolve(); await two;
  assert.equal(await close, 'native-result'); assert.deepEqual(calls, [options]);
  assert.equal(calls[0], options);
  const snapshot = barrier.snapshot(); assert.equal(snapshot.requested, true); assert.equal(snapshot.drain.complete, true);
  snapshot.drain.complete = false; assert.equal(barrier.snapshot().drain.complete, true);
  assert.equal(barrier.restore(), true); assert.equal(context.close, nativeClose);
  assert.deepEqual(Object.getOwnPropertyDescriptor(context, 'close'), descriptor);
});

test('close coordinator preserves native rejection and restores an inherited method', async () => {
  const nativeError = new Error('native-close-control');
  const prototype = { close() { throw nativeError; } }, context = Object.create(prototype);
  const barrier = coordinateContextClose(context, async () => ({ complete: true, pending: 0, handlerErrors: 0 }));
  await assert.rejects(context.close(), error => error === nativeError);
  assert.equal(barrier.restore(), true); assert.equal(Object.hasOwn(context, 'close'), false);
  assert.equal(context.close, prototype.close);
});

test('close coordinator retains failed drain evidence but still permits native cleanup', async () => {
  for (const drain of [async () => { throw new Error('private-drain-value'); },
    async () => ({ complete: false, pending: 1, handlerErrors: 0 })]) {
    let closes = 0;
    const context = { close: async () => { closes += 1; return 'closed'; } };
    const barrier = coordinateContextClose(context, drain);
    assert.equal(await context.close(), 'closed'); assert.equal(closes, 1);
    assert.equal(barrier.snapshot().drain.complete, false);
    assert.equal(JSON.stringify(barrier.snapshot()).includes('private-drain-value'), false);
    barrier.restore();
  }
});

test('close coordinator shares only the barrier and forwards each native invocation', async () => {
  const release = deferred(), calls = []; let drains = 0;
  const context = { close: async value => { calls.push(value); return value; } };
  const barrier = coordinateContextClose(context, async () => { drains += 1; await release.promise;
    return { complete: true, pending: 0, handlerErrors: 0 }; });
  const a = context.close('first'), b = context.close('second');
  await new Promise(setImmediate); assert.equal(calls.length, 0); assert.equal(drains, 1);
  release.resolve(); assert.deepEqual(await Promise.all([a, b]), ['first', 'second']);
  assert.deepEqual(calls, ['first', 'second']);
  const replacement = () => 'other-owner'; context.close = replacement;
  assert.equal(barrier.restore(), false); assert.equal(context.close, replacement);
});


test('actual fixture keeps a pre-close drain deadline failure red while native cleanup finishes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const result = await afterUseCloseRace({ expectComplete: false, beforeReadRelease: async () => {
      t.mock.timers.tick(5000); await new Promise(setImmediate);
    } });
    assert.match(result.finalError.message, /synthetic cleanup incomplete/);
    assert.equal(result.ui.cleanup.socketClose.requested, true);
    assert.equal(result.ui.cleanup.socketClose.drain.complete, false);
    assert.equal(result.ui.cleanup.contextClosed, true);
  } finally { t.mock.timers.reset(); }
});

test('actual fixture still refuses an unknown token-bearing socket arriving during native close', async () => {
  const result = await afterUseCloseRace({ lateUnknownDuringClose: true, expectComplete: false });
  assert.match(result.finalError.message, /synthetic cleanup incomplete/);
  assert.equal(result.ui.cleanup.appShutdown.lateSocketAdmissions, 1);
  assert.equal(result.ui.realtimeSockets, 1); assert.equal(result.ui.blocked, 1);
  const violation = result.ui.violations[0];
  assert.equal(violation.socket.sessionObserved, false); assert.equal(violation.socket.tokenQueryPresent, true);
  assert.equal(violation.socketObservation.outcome, 'no-unique-owner');
  assert.equal(JSON.stringify(result.ui).includes('fictional-query'), false);
});

// Included by the existing hosted cleanup-contract command.
require('./syntheticAppLifecycle.test.cjs');

test('actual fixture requires app shutdown before native close and retains failure through cleanup', async () => {
  const good = await afterUseCloseRace();
  assert.ok(good.events.indexOf('app-shutdown') >= 0);
  assert.ok(good.events.indexOf('app-shutdown') < good.events.indexOf('native-close-start'));
  assert.equal(good.ui.cleanup.appShutdown.complete, true);
  const bad = await afterUseCloseRace({ shutdownStatus: 'shutdown-failed', expectComplete: false });
  assert.match(bad.finalError.message, /synthetic cleanup incomplete/);
  assert.equal(bad.ui.cleanup.contextClosed, true);
  assert.equal(bad.ui.cleanup.appShutdown.complete, false);
});

test('actual final receipt fails even a valid synthetic socket admitted after app shutdown', async () => {
  const result = await afterUseCloseRace({ lateKnownDuringClose: true, expectComplete: false });
  assert.match(result.finalError.message, /synthetic cleanup incomplete/);
  assert.equal(result.ui.blocked, 0); assert.equal(result.ui.realtimeSockets, 2);
  assert.equal(result.ui.cleanup.appShutdown.lateSocketAdmissions, 1);
  assert.equal(result.ui.cleanup.appShutdown.complete, false);
  assert.equal(result.ui.cleanup.contextClosed, true);
});

test('installed SDK real shutdown and late subscription fail BOTH actual final fixture receipts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { moduleReady, realClient, ControlledSocket } = require('./syntheticAppLifecycle.test.cjs');
  try {
    const { registerSyntheticAppLifecycle: register } = await moduleReady;
    const sdk = await realClient();
    const appScope = { __RAW_SYNTHETIC_APP_LIFECYCLE__: { version: 1 } };
    let effect;
    register(appScope, () => { effect = sdk.realtime.removeChannel(sdk.channel); }, async () => sdk.client);
    const transports = ControlledSocket.instances.length;
    const result = await afterUseCloseRace({ appScope, lateKnownDuringClose: true, expectComplete: false,
      lateSocketProducer: async (handle, closes) => {
        assert.equal(appScope.__RAW_SYNTHETIC_APP_LIFECYCLE__.state, 'complete');
        assert.equal(sdk.realtime.connectionState(), 'closed');
        let admission;
        ControlledSocket.onCreate = () => {
          admission = handle({ url: () => 'wss://realtime.invalid/realtime/v1/websocket',
            connectToServer: () => assert.fail('late SDK opened upstream'),
            close: async value => closes.push(value) });
        };
        sdk.realtime.channel('late-sdk-final-receipt-negative').subscribe();
        await admission; ControlledSocket.onCreate = undefined;
      } });
    await effect;
    assert.equal(ControlledSocket.instances.length, transports + 1);
    assert.match(result.finalError.message, /synthetic cleanup incomplete/);
    for (const row of [result.ui, result.weather]) {
      assert.equal(row.cleanup.complete, false);
      assert.equal(row.cleanup.contextClosed, true);
      assert.equal(row.cleanup.appShutdown.complete, false);
      assert.equal(row.cleanup.appShutdown.lateSocketAdmissions, 1);
    }
    assert.equal(result.ui.blocked, 0); assert.equal(result.ui.realtimeSockets, 2);
    assert.deepEqual(result.ui.violations, []);
    await sdk.realtime.removeAllChannels(); t.mock.timers.tick(10000);
  } finally { ControlledSocket.onCreate = undefined; t.mock.timers.reset(); }
});
