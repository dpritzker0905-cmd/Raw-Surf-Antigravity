'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installIdleDrawDiagnostics, startIdleDrawDiagnostics, readIdleDrawCounter,
  stopIdleDrawDiagnostics, attachIdleDrawDiagnostics } = require('../e2e/idleDrawDiagnostics');

function fixture() {
  const listeners = new Map();
  const target = (name) => ({
    addEventListener(type, fn) { listeners.set(`${name}:${type}`, fn); },
    removeEventListener(type, fn) { if (listeners.get(`${name}:${type}`) === fn) listeners.delete(`${name}:${type}`); },
  });
  let next = 0;
  const queued = new Map();
  const mapEvents = new Map();
  const window = { ...target('window'),
    requestAnimationFrame(callback) {
      assert.equal(this, window);
      if (typeof callback !== 'function') throw new TypeError('callback required');
      queued.set(++next, callback);
      return next;
    },
    cancelAnimationFrame(id) { assert.equal(this, window); queued.delete(Number(id)); return 'cancel-result'; },
    __RAW_GPU__: { opacity: { n: 1, t: 100, heatmap: 1 }, layer: { n: 3, t: 101, skip: 'programs_pending' } },
    __MAP_INSTANCE__: { on: (name, fn) => mapEvents.set(name, fn), off: (name, fn) => {
      if (mapEvents.get(name) === fn) mapEvents.delete(name);
    } },
  };
  const document = { ...target('document'), visibilityState: 'visible', hasFocus: () => true };
  let now = 200;
  const context = vm.createContext({ window, document, performance: { now: () => now } });
  const page = { evaluate: async (fn, arg) => { context.argument = arg;
    return vm.runInContext(`(${fn.toString()})(argument)`, context); },
  addInitScript: async fn => vm.runInContext(`(${fn.toString()})()`, context) };
  return { page, window, document, queued, listeners, mapEvents,
    advance(ms) { now += ms; },
    deliver(id, timestamp) { const callback = queued.get(id); queued.delete(id); callback.call(window, timestamp); } };
}

test('observing an idle page schedules nothing and cleans up without changing cancellation', async () => {
  const f = fixture();
  const raf = f.window.requestAnimationFrame, cancel = f.window.cancelAnimationFrame;
  await installIdleDrawDiagnostics(f.page);
  const start = await startIdleDrawDiagnostics(f.page);
  assert.equal(start.opacity.n, 1);
  assert.equal(start.layer.skip, 'programs_pending');
  assert.equal(f.queued.size, 0);
  assert.notEqual(f.window.cancelAnimationFrame, cancel);
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.end.requested, 0);
  assert.equal(stop.end.delivered, 0);
  assert.equal(f.window.requestAnimationFrame, raf);
  assert.equal(f.window.cancelAnimationFrame, cancel);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.mapEvents.size, 0);
  assert.equal(await stopIdleDrawDiagnostics(f.page), null);
});

test('passes callback receiver, timestamp, return ID and cancellation through without extra requests', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  await startIdleDrawDiagnostics(f.page);
  let calls = 0;
  const first = f.window.requestAnimationFrame(function(timestamp) {
    assert.equal(this, f.window); assert.equal(timestamp, 123); calls += 1;
  });
  const cancelled = f.window.requestAnimationFrame(() => assert.fail('cancelled callback delivered'));
  f.window.cancelAnimationFrame(cancelled);
  assert.equal(f.queued.size, 1);
  f.deliver(first, 123);
  assert.equal(calls, 1);
  assert.equal(f.queued.size, 0);
  f.mapEvents.get('render')();
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.end.requested, 2);
  assert.equal(stop.end.delivered, 1);
  assert.equal(stop.end.cancelledTracked, 1);
  assert.equal(stop.end.pendingTracked, 0);
  assert.ok(stop.rafEvents.outsideOracle.some(e => e.kind === 'delivered' && e.id === first));
  assert.ok(stop.rafEvents.outsideOracle.some(e => e.kind === 'cancelled-tracked' && e.id === cancelled));
  assert.equal(stop.end.callbackTimestamps, 1);
  assert.equal(stop.end.mapFrames, 1);
});

test('bounded events retain context-loss and visibility transitions independently of draws', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  await startIdleDrawDiagnostics(f.page);
  f.listeners.get('document:webglcontextlost')();
  f.document.visibilityState = 'hidden';
  f.listeners.get('document:visibilitychange')();
  for (let i = 0; i < 90; i++) f.listeners.get('window:blur')();
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.end.contextLost, 1);
  assert.equal(stop.end.opacity.n, 1);
  assert.equal(stop.end.visibility, 'hidden');
  assert.equal(stop.events.length, 64);
  assert.ok(stop.droppedEvents > 0);
  assert.ok(stop.events.some(e => e.kind === 'context-lost'));
});

test('cleanup preserves a later RAF wrapper and callbacks queued before cleanup still execute', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  await startIdleDrawDiagnostics(f.page);
  let delivered = false;
  const id = f.window.requestAnimationFrame(() => { delivered = true; });
  const later = () => 999;
  const laterCancel = () => 'later cancel';
  f.window.requestAnimationFrame = later;
  f.window.cancelAnimationFrame = laterCancel;
  await stopIdleDrawDiagnostics(f.page);
  assert.equal(f.window.requestAnimationFrame, later);
  assert.equal(f.window.cancelAnimationFrame, laterCancel);
  f.deliver(id, 456);
  assert.equal(delivered, true);
});

test('attaches a failed idle observation and preserves the primary failure if capture fails', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  await startIdleDrawDiagnostics(f.page);
  let attachment;
  const info = { annotations: [], attach: async (name, value) => { attachment = { name, ...value }; } };
  await attachIdleDrawDiagnostics(f.page, info, new Error('original idle red'));
  assert.equal(attachment.name, 'idle-draw-diagnostics.json');
  assert.equal(JSON.parse(attachment.body).end.opacity.n, 1);
  const broken = { evaluate: async () => { throw new Error('page closed'); } };
  await attachIdleDrawDiagnostics(broken, info, new Error('original idle red'));
  assert.equal(info.annotations.length, 1);
  await assert.rejects(attachIdleDrawDiagnostics(broken, info, null), /page closed/);
});

test('post-boundary draws cannot override the original failed idle oracle', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  await startIdleDrawDiagnostics(f.page);
  const n0 = await readIdleDrawCounter(f.page, 'n0');
  f.advance(1500);
  const n1 = await readIdleDrawCounter(f.page, 'n1');
  assert.equal(n0, n1);
  // Outside the oracle window: excluded from exact-boundary accounting.
  f.window.__RAW_GPU__.opacity.n = 2;
  let attached;
  const info = { annotations: [], attach: async (_, value) => { attached = JSON.parse(value.body); } };
  await attachIdleDrawDiagnostics(f.page, info, new Error('n1 == n0'));
  assert.equal(attached.oracleFailed, true);
  assert.ok(attached.end.opacity.n > attached.start.opacity.n);
  assert.equal(attached.measurementWindow, 'same-task-as-original-counter-reads');
  assert.equal(attached.oracle.n0.n, 1);
  assert.equal(attached.oracle.n1.n, 1);
  assert.equal(attached.oracle.n1.perf - attached.oracle.n0.perf, 1500);
});

test('failed map-listener installation leaves no DOM listeners or RAF wrapper', async () => {
  const f = fixture();
  const raf = f.window.requestAnimationFrame;
  const cancel = f.window.cancelAnimationFrame;
  await installIdleDrawDiagnostics(f.page);
  f.window.__MAP_INSTANCE__.on = () => { throw new Error('map disposed'); };
  await assert.rejects(startIdleDrawDiagnostics(f.page), /map disposed/);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.window.requestAnimationFrame, raf);
  assert.equal(f.window.cancelAnimationFrame, cancel);
  assert.equal(f.window.__RAW_IDLE_DRAW_DIAGNOSTICS__, undefined);
});

test('app-cached wrappers before begin retain bootstrap pending/cancel/delivery accounting', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  const cached = f.window.requestAnimationFrame, cancel = f.window.cancelAnimationFrame;
  const carried = cached.call(f.window, () => {});
  const cancelled = cached.call(f.window, () => assert.fail('cancelled'));
  assert.equal(cancel.call(f.window, cancelled), 'cancel-result');
  await startIdleDrawDiagnostics(f.page);
  await readIdleDrawCounter(f.page, 'n0');
  f.deliver(carried, 456);
  const pending = cached.call(f.window, () => {});
  f.advance(1500);
  await readIdleDrawCounter(f.page, 'n1');
  // Work outside n0/n1 must not enter delta.
  f.deliver(pending, 789);
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.start.cancelledTracked, 1);
  assert.equal(stop.oracle.n0.pendingTracked, 1);
  assert.equal(stop.oracle.n1.pendingTracked, 1);
  assert.equal(stop.delta.requested, 1);
  assert.equal(stop.delta.delivered, 1);
  assert.equal(stop.end.delivered, 2);
});

test('early context event survives begin and existing-map context state is sampled without creation', async () => {
  const f = fixture();
  let lost = true;
  f.window.__MAP_INSTANCE__.painter = { context: { gl: { isContextLost: () => lost } } };
  await installIdleDrawDiagnostics(f.page);
  f.listeners.get('document:webglcontextlost')();
  await startIdleDrawDiagnostics(f.page);
  await readIdleDrawCounter(f.page, 'n0');
  lost = false;
  f.listeners.get('document:webglcontextrestored')();
  await readIdleDrawCounter(f.page, 'n1');
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.start.contextLost, 1);
  assert.equal(stop.oracle.n0.contextIsLost, true);
  assert.equal(stop.oracle.n1.contextIsLost, false);
  assert.equal(stop.delta.contextLost, 0);
  assert.equal(stop.delta.contextRestored, 1);
  assert.ok(stop.events.some(e => e.kind === 'context-lost' && e.phase === 'bootstrap'));
});

test('pending ID storage is bounded and overflow is explicit', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  await startIdleDrawDiagnostics(f.page);
  for (let i = 0; i < 300; i++) f.window.requestAnimationFrame(() => {});
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.end.requested, 300);
  assert.equal(stop.end.pendingTracked, 256);
  assert.equal(stop.end.pendingIds.length, 16);
  assert.equal(stop.end.overflowRequests, 44);
  assert.equal(stop.rafEvents.outsideOracle.length, 64);
  assert.equal(stop.droppedRafEvents.outsideOracle, 236);
});

test('native cancellation argument coercion is not repeated by the observer', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  await startIdleDrawDiagnostics(f.page);
  const id = f.window.requestAnimationFrame(() => {});
  let coerced = 0;
  const arg = { valueOf() { coerced += 1; return id; } };
  f.window.cancelAnimationFrame(arg);
  assert.equal(coerced, 1);
  assert.equal(f.queued.size, 0);
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.end.unknownCancels, 1);
  assert.equal(stop.end.cancelledTracked, 0);
  assert.equal(stop.rafEvents.outsideOracle.at(-1).id, null);
  assert.equal(stop.rafEvents.outsideOracle.at(-1).idType, 'object');
});

test('early startup failure attaches once without requiring oracle boundaries', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  f.listeners.get('document:webglcontextlost')();
  const bodies = [];
  const info = { annotations: [], attach: async (_, value) => bodies.push(JSON.parse(value.body)) };
  await attachIdleDrawDiagnostics(f.page, info, new Error('first draw failed'));
  await attachIdleDrawDiagnostics(f.page, info, new Error('afterEach'));
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].start, null);
  assert.equal(bodies[0].oracleFailed, null);
  assert.equal(bodies[0].end.contextLost, 1);
  assert.equal(f.listeners.size, 0);
});

test('invalid boundary ordering fails and remains cleanable', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  await startIdleDrawDiagnostics(f.page);
  await assert.rejects(readIdleDrawCounter(f.page, 'n1'), /invalid idle/);
  await stopIdleDrawDiagnostics(f.page);
  assert.equal(f.listeners.size, 0);
});

test('partial init installation failure removes listeners and restores owned APIs', async () => {
  const f = fixture();
  const raf = f.window.requestAnimationFrame, cancel = f.window.cancelAnimationFrame;
  const add = f.document.addEventListener;
  f.document.addEventListener = (type, fn) => {
    if (type === 'webglcontextrestored') throw new Error('listener installation failed');
    add(type, fn);
  };
  await assert.rejects(installIdleDrawDiagnostics(f.page), /listener installation failed/);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.window.requestAnimationFrame, raf);
  assert.equal(f.window.cancelAnimationFrame, cancel);
});

test('read-only RAF property fails installation explicitly and cleans up', async () => {
  const f = fixture();
  const raf = f.window.requestAnimationFrame, cancel = f.window.cancelAnimationFrame;
  Object.defineProperty(f.window, 'requestAnimationFrame', { value: raf, writable: false });
  await assert.rejects(installIdleDrawDiagnostics(f.page), /not installed|read only/);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.window.cancelAnimationFrame, cancel);
});

test('callback errors and native invalid-callback rejection retain their behavior', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  assert.throws(() => f.window.requestAnimationFrame(null), /callback required/);
  const original = new Error('callback failure');
  const id = f.window.requestAnimationFrame(() => { throw original; });
  assert.throws(() => f.deliver(id, 123), error => error === original);
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.end.requested, 1);
  assert.equal(stop.end.delivered, 1);
  assert.equal(stop.end.pendingTracked, 0);
});

test('unknown or throwing existing-context reads never create a context or invent healthy state', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  await startIdleDrawDiagnostics(f.page);
  await readIdleDrawCounter(f.page, 'n0');
  f.window.__MAP_INSTANCE__.painter = { context: { gl: { isContextLost() { throw new Error('context unavailable'); } } } };
  await readIdleDrawCounter(f.page, 'n1');
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.oracle.n0.contextIsLost, null);
  assert.equal(stop.oracle.n0.contextRead, 'unavailable');
  assert.equal(stop.oracle.n1.contextIsLost, null);
  assert.equal(stop.oracle.n1.contextRead, 'read-threw');
});

test('invalid original counter values stay unchanged and report unknown oracle outcome', async () => {
  for (const invalid of [undefined, NaN]) {
    const f = fixture();
    await installIdleDrawDiagnostics(f.page);
    await startIdleDrawDiagnostics(f.page);
    await readIdleDrawCounter(f.page, 'n0');
    f.window.__RAW_GPU__.opacity.n = invalid;
    const n1 = await readIdleDrawCounter(f.page, 'n1');
    assert.equal(n1, invalid);
    let attached;
    const info = { annotations: [], attach: async (_, value) => { attached = JSON.parse(value.body); } };
    await attachIdleDrawDiagnostics(f.page, info, new Error('original numeric assertion failed'));
    assert.equal(attached.oracleValid, false);
    assert.equal(attached.oracleFailed, null);
    assert.equal(attached.oracle.n1.counterValid, false);
    assert.equal(attached.captureAfterFailure, true);
  }
});

test('native-style callback invocation ignores an overridden function call property', async () => {
  const f = fixture();
  await installIdleDrawDiagnostics(f.page);
  let called = false;
  function callback(timestamp) { assert.equal(this, f.window); assert.equal(timestamp, 123); called = true; }
  callback.call = () => assert.fail('native callback invocation must not read this property');
  const id = f.window.requestAnimationFrame(callback);
  f.deliver(id, 123);
  assert.equal(called, true);
  await stopIdleDrawDiagnostics(f.page);
});
