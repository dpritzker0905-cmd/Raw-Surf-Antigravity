const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(require.resolve('../src/testSupport/syntheticAppLifecycle.js'), 'utf8');
const moduleReady = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(a => { resolve = a; }); return { promise, resolve }; };
const scope = () => ({ __RAW_SYNTHETIC_APP_LIFECYCLE__: { version: 1 } });
const marker = value => value.__RAW_SYNTHETIC_APP_LIFECYCLE__;
function goodClient(overrides = {}) {
  return { removeAllChannels: async () => [], getChannels: () => [],
    realtime: { disconnect: async () => 'ok', connectionState: () => 'closed' }, ...overrides };
}

test('unmarked app never loads SDK or exposes a shutdown capability', async () => {
  const { registerSyntheticAppLifecycle: register } = await moduleReady;
  const normal = {};
  assert.equal(register(normal, () => assert.fail('unmounted normal app'), () => assert.fail('loaded SDK')), false);
  assert.deepEqual(normal, {});
});

test('pristine opt-in is required and duplicate registration cannot reactivate a document', async () => {
  const { registerSyntheticAppLifecycle: register } = await moduleReady;
  for (const value of [null, {}, { version: 2 }, { version: 1, shutdown: () => {} }]) {
    assert.throws(() => register({ __RAW_SYNTHETIC_APP_LIFECYCLE__: value }, () => {}, async () => null));
  }
  const value = scope(); register(value, () => {}, async () => null);
  const original = marker(value).shutdown;
  assert.throws(() => register(value, () => {}, async () => null));
  assert.equal(marker(value).shutdown, original); assert.equal(Object.isFrozen(marker(value)), true);
});

test('one shared operation is installed before synchronous reentrant unmount and awaits async cleanup', async () => {
  const { registerSyntheticAppLifecycle: register } = await moduleReady;
  const value = scope(), pending = deferred(), events = []; let reentrant;
  register(value, () => { events.push('unmount'); reentrant = marker(value).shutdown(); }, async () => {
    events.push('load'); return goodClient({ removeAllChannels: async () => { await pending.promise; events.push('cleanup'); return []; } });
  });
  const operation = marker(value).shutdown(); assert.equal(operation, reentrant);
  assert.equal(marker(value).shutdown(), operation); assert.equal(marker(value).state, 'stopping');
  await flush(); assert.deepEqual(events, ['unmount', 'load']);
  pending.resolve(); assert.deepEqual(await operation, { status: 'complete', client: 'configured' });
  assert.equal(marker(value).shutdown(), operation); assert.equal(marker(value).state, 'complete');
});

test('null client is explicit and unmount/load/SDK/status/transport/inventory failures remain failures', async () => {
  const { registerSyntheticAppLifecycle: register } = await moduleReady;
  const noClient = scope(); register(noClient, () => {}, async () => null);
  assert.deepEqual(await marker(noClient).shutdown(), { status: 'complete', client: 'unconfigured' });
  for (const config of [
    { unmount: () => { throw new Error('private unmount'); } },
    { load: async () => { throw new Error('private loader'); } },
    { client: goodClient({ removeAllChannels: async () => { throw new Error('private SDK'); } }) },
    ...['error', 'timed out'].map(status => ({ client: goodClient({ removeAllChannels: async () => [status] }) })),
    { client: goodClient({ realtime: { disconnect: async () => 'timeout', connectionState: () => 'closed' } }) },
    { client: goodClient({ realtime: { disconnect: async () => 'ok', connectionState: () => 'closing' } }) },
    { client: goodClient({ getChannels: () => [{}] }) },
  ]) {
    const value = scope(); register(value, config.unmount || (() => {}), config.load || (async () => config.client || goodClient()));
    const operation = marker(value).shutdown(); await assert.rejects(operation, /^Error: Synthetic app shutdown incomplete$/);
    assert.equal(marker(value).state, 'failed'); assert.equal(marker(value).shutdown(), operation);
  }
});

// Real pinned SDK and Phoenix channel/socket logic. Only the browser transport is controlled.
const { RealtimeClient } = require('@supabase/realtime-js');
class ControlledSocket {
  static instances = [];
  constructor() { this.readyState = 0; this.bufferedAmount = 0; this.leaves = []; this.mode = 'ok';
    ControlledSocket.instances.push(this); ControlledSocket.onCreate?.(this); }
  open() { this.readyState = 1; this.onopen?.({}); }
  reply(message, status = 'ok') {
    this.onmessage?.({ data: JSON.stringify([message[0], message[1], message[2], 'phx_reply', { status, response: { postgres_changes: [] } }]) });
  }
  send(data) {
    const message = JSON.parse(data);
    if (message[3] === 'phx_join') queueMicrotask(() => this.reply(message));
    else if (message[3] === 'phx_leave') {
      this.leaves.push(message);
      if (this.mode === 'error') this.reply(message, 'error');
      else if (this.mode !== 'hold') queueMicrotask(() => this.reply(message));
    }
  }
  close() { this.readyState = this.mode === 'hold-close' ? 2 : 3;
    if (this.readyState === 3) this.onclose?.({ code: 1000, wasClean: true }); }
}
async function realClient() {
  const realtime = new RealtimeClient('ws://synthetic.invalid/socket', { transport: ControlledSocket, timeout: 50, params: { apikey: 'synthetic-transport-only' } });
  const channel = realtime.channel('synthetic-owned'); channel.subscribe();
  const transport = ControlledSocket.instances.at(-1); transport.open(); await flush();
  assert.equal(realtime.connectionState(), 'open'); assert.equal(channel.state, 'joined');
  return { realtime, channel, transport, client: {
    realtime, removeAllChannels: () => realtime.removeAllChannels(), getChannels: () => realtime.getChannels(),
  } };
}

test('installed SDK waits for overlapping effect removeChannel and disconnects before success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { registerSyntheticAppLifecycle: register } = await moduleReady;
    const sdk = await realClient(), value = scope(); let effect;
    sdk.transport.mode = 'hold';
    register(value, () => { effect = sdk.realtime.removeChannel(sdk.channel); }, async () => sdk.client);
    const operation = marker(value).shutdown();
    assert.equal(marker(value).state, 'stopping'); await flush();
    assert.ok(sdk.transport.leaves.length >= 1);
    for (const message of sdk.transport.leaves) sdk.transport.reply(message);
    await effect; await operation;
    assert.equal(sdk.realtime.connectionState(), 'closed'); assert.equal(sdk.realtime.getChannels().length, 0);
    const transports = ControlledSocket.instances.length; t.mock.timers.tick(10000); await flush();
    assert.equal(ControlledSocket.instances.length, transports, 'owned reconnect timer must not reopen transport');
  } finally { t.mock.timers.reset(); }
});

test('installed SDK synchronous unsubscribe error is not successful shutdown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { registerSyntheticAppLifecycle: register } = await moduleReady;
    for (const mode of ['error']) {
      const sdk = await realClient(), value = scope(); sdk.transport.mode = mode;
      register(value, () => {}, async () => sdk.client);
      const operation = marker(value).shutdown(); const outcome = assert.rejects(operation, /shutdown incomplete/);
      await flush(); if (mode === 'hold') { t.mock.timers.tick(50); await flush(); }
      await outcome; assert.equal(marker(value).state, 'failed');
      assert.equal(sdk.realtime.connectionState(), 'closed');
    }
    t.mock.timers.tick(10000);
  } finally { t.mock.timers.reset(); }
});

test('installed SDK disconnect timeout and early-ok while closing remain failed evidence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { registerSyntheticAppLifecycle: register } = await moduleReady;
    const sdk = await realClient(), value = scope(); sdk.transport.mode = 'hold-close';
    register(value, () => {}, async () => sdk.client);
    const operation = marker(value).shutdown();
    const outcome = assert.rejects(operation, /shutdown incomplete/); await flush();
    assert.equal(sdk.realtime.connectionState(), 'closing');
    assert.equal(await sdk.realtime.disconnect(), 'ok');
    assert.equal(sdk.realtime.connectionState(), 'closing');
    t.mock.timers.tick(10000); await flush(); await outcome;
    assert.equal(marker(value).state, 'failed');
    sdk.transport.readyState = 3;
    for (let i = 0; i < 6; i += 1) { t.mock.timers.tick(1500); await flush(); }
  } finally { t.mock.timers.reset(); }
});

test('installed SDK later subscription invalidates actual harness shutdown with unchanged socket refusal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { registerSyntheticAppLifecycle: register } = await moduleReady;
    const sdk = await realClient(), value = scope();
    value.localStorage = { getItem: () => JSON.stringify({ id: 'test-surfer-id' }) };
    register(value, () => {}, async () => sdk.client);
    const page = { url: () => 'https://site.invalid/map', isClosed: () => false,
      evaluate: fn => vm.runInNewContext(`(${fn.toString()})()`, value) };
    const { context, isolation } = await isolationHarness(page);
    assert.equal((await isolation.shutdownApps()).complete, true);
    const count = ControlledSocket.instances.length; let admission, close;
    const url = 'wss://realtime.invalid/realtime/v1/websocket';
    const route = context.sockets.find(row => row.matches(new URL(url)));
    ControlledSocket.onCreate = () => {
      admission = route.handle({ url: () => url,
        connectToServer: () => assert.fail('late producer opened upstream'), close: async value => { close = value; } });
    };
    sdk.realtime.channel('late-producer-negative').subscribe(); await admission;
    ControlledSocket.onCreate = undefined;
    assert.equal(ControlledSocket.instances.length, count + 1);
    assert.notEqual(sdk.realtime.connectionState(), 'closed');
    assert.equal(isolation.appShutdownSnapshot().complete, false);
    assert.equal(isolation.appShutdownSnapshot().lateSocketAdmissions, 1);
    assert.equal(isolation.stats.realtimeSockets, 1); assert.equal(isolation.stats.blocked, 0);
    assert.equal(close.code, 1008);
    await sdk.realtime.removeAllChannels(); t.mock.timers.tick(10000);
  } finally { ControlledSocket.onCreate = undefined; t.mock.timers.reset(); }
});

async function isolationHarness(page) {
  const { installSeededUiIsolation } = require('../e2e/seededUiIsolation');
  const context = Object.assign(new EventEmitter(), { pages: () => [page], addInitScript: async () => {},
    sockets: [], route: async () => {}, routeWebSocket: async (matches, handle) => context.sockets.push({ matches, handle }) });
  const isolation = await installSeededUiIsolation(context, { siteOrigin: 'https://site.invalid', liveOrigin: 'https://backend.invalid' });
  return { context, isolation };
}

test('actual harness executes real hook and records explicit unconfigured, missing, replaced and failed states', async () => {
  const { registerSyntheticAppLifecycle: register } = await moduleReady;
  for (const mode of ['healthy', 'missing', 'replace', 'failure']) {
    const value = scope();
    if (mode !== 'missing') register(value, () => {}, async () => {
      if (mode === 'replace') value.__RAW_SYNTHETIC_APP_LIFECYCLE__ = { version: 1 };
      if (mode === 'failure') throw new Error('private');
      return null;
    });
    const page = { url: () => 'https://site.invalid/map', isClosed: () => false,
      evaluate: fn => vm.runInNewContext(`(${fn.toString()})()`, value) };
    const { isolation } = await isolationHarness(page); const result = await isolation.shutdownApps();
    assert.equal(result.complete, mode === 'healthy');
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('actual harness classifies blank/non-app and rejects new pages/navigation during shutdown', async () => {
  for (const url of ['about:blank', 'https://other.invalid/']) {
    const { isolation } = await isolationHarness({ url: () => url, isClosed: () => false,
      evaluate: () => assert.fail('evaluated non-app') });
    assert.equal((await isolation.shutdownApps()).complete, true);
  }
  for (const event of ['page', 'navigation']) {
    const page = Object.assign(new EventEmitter(), { url: () => 'https://site.invalid/map', isClosed: () => false,
      mainFrame: () => page, evaluate: async () => ({ status: 'complete', client: 'configured' }) });
    const { context, isolation } = await isolationHarness(page); await isolation.shutdownApps();
    if (event === 'page') context.emit('page', page); else page.emit('framenavigated', page);
    assert.equal(isolation.appShutdownSnapshot().complete, false); assert.equal(isolation.appShutdownSnapshot().changed, true);
  }
});

test('actual harness deadline stays failed when an unavailable hook completes later', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = deferred();
    const { isolation } = await isolationHarness({ url: () => 'https://site.invalid/map', isClosed: () => false,
      evaluate: () => pending.promise });
    const operation = isolation.shutdownApps(5); t.mock.timers.tick(5);
    assert.equal((await operation).complete, false);
    pending.resolve({ status: 'complete', client: 'configured' }); await flush();
    assert.equal(isolation.appShutdownSnapshot().complete, false);
  } finally { t.mock.timers.reset(); }
});

// Shared only with the actual-fixture integration control below its existing hosted entry point.
module.exports = { moduleReady, realClient, ControlledSocket };

test('actual harness records late admission synchronously while pre-boundary queued work stays ordinary', async () => {
  const pending = deferred();
  const page = { url: () => 'https://site.invalid/map', isClosed: () => false,
    evaluate: async fn => fn.name === 'shutdownAppDocument' ? pending.promise : { id: 'test-surfer-id', hasToken: false } };
  const { context, isolation } = await isolationHarness(page);
  const shutdown = isolation.shutdownApps();
  const url = 'wss://realtime.invalid/realtime/v1/websocket';
  const handle = context.sockets.find(row => row.matches(new URL(url))).handle;
  const socket = { url: () => url, connectToServer: () => assert.fail('opened upstream'), close: async () => {} };
  const before = handle(socket);
  assert.equal(isolation.appShutdownSnapshot().lateSocketAdmissions, 0);
  pending.resolve({ status: 'complete', client: 'configured' }); await shutdown; await before;
  assert.equal(isolation.appShutdownSnapshot().lateSocketAdmissions, 0);
  assert.equal(isolation.appShutdownSnapshot().complete, true);
  const after = handle(socket);
  assert.equal(isolation.appShutdownSnapshot().lateSocketAdmissions, 1, 'record public callback entry before deferred guard work');
  await after;
  assert.equal(isolation.appShutdownSnapshot().complete, false);
  assert.equal(isolation.stats.realtimeSockets, 2);
});
