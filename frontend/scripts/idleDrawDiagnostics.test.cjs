'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { startIdleDrawDiagnostics, stopIdleDrawDiagnostics, attachIdleDrawDiagnostics } = require('../e2e/idleDrawDiagnostics');

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
    cancelAnimationFrame(id) { queued.delete(id); },
    __RAW_GPU__: { opacity: { n: 1, t: 100, heatmap: 1 }, layer: { n: 3, t: 101, skip: 'programs_pending' } },
    __MAP_INSTANCE__: { on: (name, fn) => mapEvents.set(name, fn), off: (name, fn) => {
      if (mapEvents.get(name) === fn) mapEvents.delete(name);
    } },
  };
  const document = { ...target('document'), visibilityState: 'visible', hasFocus: () => true };
  const context = vm.createContext({ window, document, performance: { now: () => 200 } });
  const page = { evaluate: async fn => vm.runInContext(`(${fn.toString()})()`, context) };
  return { page, window, document, queued, listeners, mapEvents,
    deliver(id, timestamp) { const callback = queued.get(id); queued.delete(id); callback.call(window, timestamp); } };
}

test('observing an idle page schedules nothing and cleans up without changing cancellation', async () => {
  const f = fixture();
  const raf = f.window.requestAnimationFrame, cancel = f.window.cancelAnimationFrame;
  const start = await startIdleDrawDiagnostics(f.page);
  assert.equal(start.opacity.n, 1);
  assert.equal(start.layer.skip, 'programs_pending');
  assert.equal(f.queued.size, 0);
  assert.equal(f.window.cancelAnimationFrame, cancel);
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.end.requested, 0);
  assert.equal(stop.end.delivered, 0);
  assert.equal(f.window.requestAnimationFrame, raf);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.mapEvents.size, 0);
  assert.equal(await stopIdleDrawDiagnostics(f.page), null);
});

test('passes callback receiver, timestamp, return ID and cancellation through without extra requests', async () => {
  const f = fixture();
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
  assert.equal(stop.end.callbackTimestamps, 1);
  assert.equal(stop.end.mapFrames, 1);
});

test('bounded events retain context-loss and visibility transitions independently of draws', async () => {
  const f = fixture();
  await startIdleDrawDiagnostics(f.page);
  f.listeners.get('document:webglcontextlost')();
  f.document.visibilityState = 'hidden';
  f.listeners.get('document:visibilitychange')();
  for (let i = 0; i < 50; i++) f.listeners.get('window:blur')();
  const stop = await stopIdleDrawDiagnostics(f.page);
  assert.equal(stop.end.contextLost, 1);
  assert.equal(stop.end.opacity.n, 1);
  assert.equal(stop.end.visibility, 'hidden');
  assert.equal(stop.events.length, 32);
  assert.ok(stop.droppedEvents > 0);
  assert.ok(stop.events.some(e => e.phase === 'context-lost'));
});

test('cleanup preserves a later RAF wrapper and callbacks queued before cleanup still execute', async () => {
  const f = fixture();
  await startIdleDrawDiagnostics(f.page);
  let delivered = false;
  const id = f.window.requestAnimationFrame(() => { delivered = true; });
  const later = () => 999;
  f.window.requestAnimationFrame = later;
  await stopIdleDrawDiagnostics(f.page);
  assert.equal(f.window.requestAnimationFrame, later);
  f.deliver(id, 456);
  assert.equal(delivered, true);
});

test('attaches a failed idle observation and preserves the primary failure if capture fails', async () => {
  const f = fixture();
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

test('a positive bracketing delta cannot override an original failed idle oracle', async () => {
  const f = fixture();
  await startIdleDrawDiagnostics(f.page);
  // This can happen before n0 or after n1: it must never be read as a passing oracle.
  f.window.__RAW_GPU__.opacity.n = 2;
  let attached;
  const info = { annotations: [], attach: async (_, value) => { attached = JSON.parse(value.body); } };
  await attachIdleDrawDiagnostics(f.page, info, new Error('n1 == n0'));
  assert.equal(attached.oracleFailed, true);
  assert.ok(attached.end.opacity.n > attached.start.opacity.n);
  assert.equal(attached.measurementWindow, 'brackets-original-counter-reads');
  assert.ok(attached.limitations.some(x => x.includes('before n0 and after n1')));
});

test('failed map-listener installation leaves no DOM listeners or RAF wrapper', async () => {
  const f = fixture();
  const raf = f.window.requestAnimationFrame;
  f.window.__MAP_INSTANCE__.on = () => { throw new Error('map disposed'); };
  await assert.rejects(startIdleDrawDiagnostics(f.page), /map disposed/);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.window.requestAnimationFrame, raf);
  assert.equal(f.window.__RAW_IDLE_DRAW_DIAGNOSTICS__, undefined);
});
