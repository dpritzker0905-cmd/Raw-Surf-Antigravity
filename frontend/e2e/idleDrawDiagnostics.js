'use strict';

// Install before app bootstrap. Never request observer frames, timers, repaints or contexts.
async function installIdleDrawDiagnostics(page) {
  await page.addInitScript(() => {
    const key = '__RAW_IDLE_DRAW_DIAGNOSTICS__';
    if (window[key]) return;
    const nativeRaf = window.requestAnimationFrame, nativeCancel = window.cancelAnimationFrame;
    const pending = new Map(), events = [];
    const rafEvents = { outsideOracle: [], oracle: [] };
    const droppedRafEvents = { outsideOracle: 0, oracle: 0 };
    let rafSequence = 0;
    const metrics = { requested: 0, delivered: 0, cancelCalls: 0, cancelledTracked: 0,
      unknownCancels: 0, overflowRequests: 0, duplicateIds: 0, callbackTimestamps: 0,
      mapFrames: 0, contextLost: 0, contextRestored: 0 };
    let active = true, phase = 'bootstrap', droppedEvents = 0, lastTimestamp, map = null, start = null;
    const oracle = {};
    const recordRaf = (kind, id) => {
      const bucket = phase === 'oracle' ? 'oracle' : 'outsideOracle';
      const rows = rafEvents[bucket];
      if (rows.length === 64) { rows.shift(); droppedRafEvents[bucket] += 1; }
      // Never serialize arbitrary cancel arguments or coerce them a second time.
      rows.push({ sequence: ++rafSequence, kind, phase,
        id: typeof id === 'number' && Number.isFinite(id) ? id : null, idType: typeof id });
    };
    const record = (kind) => {
      if (events.length < 64) events.push({ kind, phase, at: Date.now(),
        visibility: document.visibilityState, focused: document.hasFocus() });
      else droppedEvents += 1;
    };
    const snapshot = (label, n) => {
      const at = Date.now(), perf = performance.now();
      const gpu = window.__RAW_GPU__ || {}, opacity = gpu.opacity || {}, layer = gpu.layer || {};
      const currentMap = window.__MAP_INSTANCE__ || null;
      let contextIsLost = null, contextRead = 'unavailable';
      try {
        const gl = currentMap?.painter?.context?.gl;
        if (typeof gl?.isContextLost === 'function') { contextIsLost = gl.isContextLost(); contextRead = 'existing-map-context'; }
      } catch { contextRead = 'read-threw'; }
      return { phase: label, at, perf, n: Number.isFinite(n) ? n : null,
        counterValid: Number.isFinite(n), counterType: n === null ? 'null' : typeof n,
        visibility: document.visibilityState, focused: document.hasFocus(),
        mapBound: !!map, mapUnchanged: map === currentMap, contextIsLost, contextRead,
        opacity: { n: opacity.n ?? null, t: opacity.t ?? null, heatmap: opacity.heatmap ?? null },
        layer: { n: layer.n ?? null, t: layer.t ?? null, skip: layer.skip ?? null },
        ...metrics, pendingTracked: pending.size, pendingIds: Array.from(pending.keys()).slice(0, 16) };
    };
    const wrappedRaf = function(callback) {
      if (typeof callback !== 'function' || !active) return nativeRaf.call(this, callback);
      let id;
      const entry = {};
      id = nativeRaf.call(this, function(timestamp) {
        if (active) {
          metrics.delivered += 1;
          recordRaf('delivered', id);
          if (pending.get(id) === entry) pending.delete(id);
          if (timestamp !== lastTimestamp) { metrics.callbackTimestamps += 1; lastTimestamp = timestamp; }
        }
        return Reflect.apply(callback, this, [timestamp]);
      });
      metrics.requested += 1;
      recordRaf('requested', id);
      if (pending.has(id)) { metrics.duplicateIds += 1; pending.delete(id); }
      if (pending.size < 256) pending.set(id, entry);
      else metrics.overflowRequests += 1;
      return id;
    };
    const wrappedCancel = function(id) {
      // Preserve native coercion: never coerce a cancellation argument a second time.
      const result = nativeCancel.call(this, id);
      if (active) {
        metrics.cancelCalls += 1;
        if (pending.delete(id)) { metrics.cancelledTracked += 1; recordRaf('cancelled-tracked', id); }
        else { metrics.unknownCancels += 1; recordRaf('cancel-untracked', id); }
      }
      return result;
    };
    const onRender = () => { metrics.mapFrames += 1; };
    const onLost = () => { metrics.contextLost += 1; record('context-lost'); };
    const onRestored = () => { metrics.contextRestored += 1; record('context-restored'); };
    const onVisibility = () => record('visibility');
    const onFocus = () => record('focus');
    const onBlur = () => record('blur');
    const cleanup = () => {
      active = false;
      if (window.requestAnimationFrame === wrappedRaf) window.requestAnimationFrame = nativeRaf;
      if (window.cancelAnimationFrame === wrappedCancel) window.cancelAnimationFrame = nativeCancel;
      document.removeEventListener('webglcontextlost', onLost, true);
      document.removeEventListener('webglcontextrestored', onRestored, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      try { if (map && typeof map.off === 'function') map.off('render', onRender); }
      finally { pending.clear(); delete window[key]; }
    };
    try {
      document.addEventListener('webglcontextlost', onLost, true);
      document.addEventListener('webglcontextrestored', onRestored, true);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      window.requestAnimationFrame = wrappedRaf;
      window.cancelAnimationFrame = wrappedCancel;
      if (window.requestAnimationFrame !== wrappedRaf || window.cancelAnimationFrame !== wrappedCancel) {
        throw new Error('idle diagnostic wrappers were not installed');
      }
      record('installed');
      const installed = snapshot('installed');
      window[key] = {
        begin() {
          if (start) throw new Error('idle draw diagnostics already active');
          map = window.__MAP_INSTANCE__ || null;
          try { if (map && typeof map.on === 'function') map.on('render', onRender); }
          catch (error) { try { cleanup(); } catch { /* preserve begin failure */ } throw error; }
          phase = 'pre-oracle';
          start = snapshot('idle-start');
          return start;
        },
        boundary(label, n) {
          if (!start || !['n0', 'n1'].includes(label) || oracle[label] || (label === 'n1' && !oracle.n0)) {
            throw new Error('invalid idle diagnostic boundary');
          }
          oracle[label] = snapshot(label, n);
          phase = label === 'n0' ? 'oracle' : 'post-oracle';
        },
        stop() {
          let result;
          try {
            const end = snapshot('idle-end');
            record('stopped');
            const delta = oracle.n0 && oracle.n1 ? Object.fromEntries(Object.keys(metrics)
              .map(name => [name, oracle.n1[name] - oracle.n0[name]])) : null;
            const oracleValid = oracle.n0 && oracle.n1 ? oracle.n0.counterValid && oracle.n1.counterValid : null;
            result = { version: 2, measurementWindow: 'same-task-as-original-counter-reads', installed,
              start, end, oracle, delta, events, droppedEvents, rafEvents, droppedRafEvents,
              oracleValid, oracleFailed: oracleValid ? oracle.n1.n <= oracle.n0.n : null,
              limitations: ['Counts observe wrapped app requests, not independent native frame opportunities or GPU completion',
                'Pending IDs are capped at 256 and samples at 16; overflow/unknown cancellations make accounting incomplete',
                'Only the last 64 RAF ID events per oracle/outside-oracle bucket are retained; dropped counts are explicit',
                'Non-number cancellation arguments pass unchanged; native coercion may refer to an unaccounted tracked ID',
                'Other realms, references obtained before this init script, and map frames before begin are not counted',
                'Context events include all page canvases; existing-map context state is sampled, not continuously polled',
                'Map events and GPU stamps do not prove pixel correctness; instrumentation has overhead'] };
          } finally { cleanup(); }
          return result;
        },
      };
    } catch (error) { try { cleanup(); } catch { /* preserve install failure */ } throw error; }
  });
}

async function startIdleDrawDiagnostics(page) {
  return page.evaluate(() => window.__RAW_IDLE_DRAW_DIAGNOSTICS__.begin());
}

// Original counter first, snapshot second, with no callback interleaving in this JS task.
async function readIdleDrawCounter(page, boundary) {
  return page.evaluate((label) => {
    const n = window.__RAW_GPU__.opacity.n;
    window.__RAW_IDLE_DRAW_DIAGNOSTICS__.boundary(label, n);
    return n;
  }, boundary);
}

async function stopIdleDrawDiagnostics(page) {
  return page.evaluate(() => window.__RAW_IDLE_DRAW_DIAGNOSTICS__?.stop() || null);
}

async function attachIdleDrawDiagnostics(page, info, primaryFailure) {
  try {
    const idle = await stopIdleDrawDiagnostics(page);
    if (!idle) return;
    idle.captureAfterFailure = !!primaryFailure;
    await info.attach('idle-draw-diagnostics.json', {
      body: JSON.stringify(idle, null, 2), contentType: 'application/json',
    });
  } catch (error) {
    if (!primaryFailure) throw error;
    info.annotations.push({ type: 'idle diagnostic unavailable',
      description: 'Capture failed; the original test failure is preserved.' });
  }
}

module.exports = { installIdleDrawDiagnostics, startIdleDrawDiagnostics, readIdleDrawCounter,
  stopIdleDrawDiagnostics, attachIdleDrawDiagnostics };
