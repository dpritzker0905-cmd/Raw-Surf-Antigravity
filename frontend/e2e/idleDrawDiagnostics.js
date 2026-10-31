'use strict';

// Observe callbacks the app requests; never request a frame, repaint or timer ourselves.
// This counts delivered app callbacks, not native frame opportunities or GPU completion.
async function startIdleDrawDiagnostics(page) {
  return page.evaluate(() => {
    const key = '__RAW_IDLE_DRAW_DIAGNOSTICS__';
    if (window[key]) throw new Error('idle draw diagnostics already active');
    const map = window.__MAP_INSTANCE__ || null;
    const events = [];
    const state = { requested: 0, delivered: 0, callbackTimestamps: 0, mapFrames: 0,
      contextLost: 0, contextRestored: 0, droppedEvents: 0, active: true };
    let lastTimestamp;
    const record = (phase) => {
      if (events.length < 32) events.push({ phase, at: Date.now(),
        visibility: document.visibilityState, focused: document.hasFocus() });
      else state.droppedEvents += 1;
    };
    const snapshot = (phase) => {
      const gpu = window.__RAW_GPU__ || {};
      const opacity = gpu.opacity || {};
      const layer = gpu.layer || {};
      return { phase, at: Date.now(), perf: performance.now(),
        visibility: document.visibilityState, focused: document.hasFocus(), mapBound: !!map,
        mapUnchanged: map === (window.__MAP_INSTANCE__ || null),
        opacity: { n: opacity.n ?? null, t: opacity.t ?? null, heatmap: opacity.heatmap ?? null },
        layer: { n: layer.n ?? null, t: layer.t ?? null, skip: layer.skip ?? null },
        requested: state.requested, delivered: state.delivered,
        callbackTimestamps: state.callbackTimestamps, mapFrames: state.mapFrames,
        contextLost: state.contextLost, contextRestored: state.contextRestored };
    };
    const nativeRaf = window.requestAnimationFrame;
    const wrappedRaf = function(callback) {
      if (typeof callback !== 'function') return nativeRaf.call(this, callback);
      const id = nativeRaf.call(this, function(timestamp) {
        if (state.active) {
          state.delivered += 1;
          if (timestamp !== lastTimestamp) { state.callbackTimestamps += 1; lastTimestamp = timestamp; }
        }
        return callback.call(this, timestamp);
      });
      if (state.active) state.requested += 1;
      return id;
    };
    const onRender = () => { state.mapFrames += 1; };
    const onLost = () => { state.contextLost += 1; record('context-lost'); };
    const onRestored = () => { state.contextRestored += 1; record('context-restored'); };
    const onVisibility = () => record('visibility');
    const onFocus = () => record('focus');
    const onBlur = () => record('blur');
    // Bind the only app-owned event API before installing DOM listeners or the RAF wrapper.
    if (map && typeof map.on === 'function') {
      try { map.on('render', onRender); }
      catch (error) {
        try { if (typeof map.off === 'function') map.off('render', onRender); } catch { /* preserve start failure */ }
        throw error;
      }
    }
    document.addEventListener('webglcontextlost', onLost, true);
    document.addEventListener('webglcontextrestored', onRestored, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.requestAnimationFrame = wrappedRaf;
    record('idle-start');
    const start = snapshot('idle-start');
    window[key] = { stop() {
      const end = snapshot('idle-end');
      record('idle-end');
      state.active = false;
      if (window.requestAnimationFrame === wrappedRaf) window.requestAnimationFrame = nativeRaf;
      document.removeEventListener('webglcontextlost', onLost, true);
      document.removeEventListener('webglcontextrestored', onRestored, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      if (map && typeof map.off === 'function') map.off('render', onRender);
      delete window[key];
      return { version: 1, measurementWindow: 'brackets-original-counter-reads',
        start, end, events, droppedEvents: state.droppedEvents,
        limitations: ['Snapshots include activity before n0 and after n1; totals do not establish activity within the oracle interval',
          'Callbacks already queued at installation are not counted',
          'Calls through native RAF references cached before installation are not counted',
          'Callback delivery is not an independent measure of native frame availability',
          'Map render events and GPU stamps do not prove pixel correctness'] };
    } };
    return start;
  });
}

async function stopIdleDrawDiagnostics(page) {
  return page.evaluate(() => window.__RAW_IDLE_DRAW_DIAGNOSTICS__?.stop() || null);
}

// Do not replace the original assertion failure if capture/attachment itself fails.
async function attachIdleDrawDiagnostics(page, info, primaryFailure) {
  try {
    const idle = await stopIdleDrawDiagnostics(page);
    if (idle) idle.oracleFailed = !!primaryFailure;
    await info.attach('idle-draw-diagnostics.json', {
      body: JSON.stringify(idle, null, 2), contentType: 'application/json',
    });
  } catch (error) {
    if (!primaryFailure) throw error;
    info.annotations.push({ type: 'idle diagnostic unavailable',
      description: 'Capture failed; the original idle failure is preserved.' });
  }
}

module.exports = { startIdleDrawDiagnostics, stopIdleDrawDiagnostics, attachIdleDrawDiagnostics };
