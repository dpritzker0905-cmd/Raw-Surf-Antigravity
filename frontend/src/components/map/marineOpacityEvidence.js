// Opt-in observation only. Never supplies a rendering decision, changes a flag, or retains grids.
// The frame sequence joins the actual layer decision to Zoomlab's subsequent map render event.
const ids = new WeakMap();
let nextId = 0;
const id = value => {
  if (!value || typeof value !== 'object') return null;
  if (!ids.has(value)) ids.set(value, ++nextId);
  return ids.get(value);
};

const FLAGS = [
  '__MARINE_TRANSITIONING__', '__MARINE_FETCH_PENDING__', '__MARINE_FETCH_DEBOUNCING__',
  'isScrubbingTimeline', '__RAW_DISABLE_COARSE_BRIDGE__', '__RAW_COARSE_BRIDGE_GRACE__',
  '__RAW_DISABLE_ZOOMOUT_BRIDGE__', '__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__',
  '__RAW_MARINE_GLOBAL_SPAN__', '__RAW_DOWNGRADE_COVER_FRAC__',
  '__RAW_DISABLE_BRIDGE_MULT_REALIGN__', '__RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__',
];

export function opacityGridIdentity(grid) {
  if (!grid) return null;
  const b = grid.bounds;
  return {
    id: id(grid), bounds: b ? [b.west, b.south, b.east, b.north] : null,
    cols: grid.cols ?? null, rows: grid.rows ?? null,
    model: grid.__sourceModel ?? null, layer: grid.__componentLayer ?? null,
    rating: !!grid.ratingMode, coverage: grid.coverage_scope ?? grid.coverageMode ?? null,
    resolution: grid.resolution ?? null,
  };
}

export function opacityEngineState(engine) {
  const resident = engine._waveData;
  const coarse = engine._coarseBaseData;
  return {
    resident: opacityGridIdentity(resident && resident.waveGrid),
    coarse: opacityGridIdentity(coarse && coarse.waveGrid),
    coarseTexture: !!(coarse && coarse.u_waveTexture),
    pending: opacityGridIdentity(engine._pendingDowngrade),
    lastZoom: engine._lastZoom ?? null,
    lastViewport: engine._lastViewportBounds ? [...engine._lastViewportBounds] : null,
    coarseBridgeActive: !!engine.__coarseBridgeActive,
  };
}

// Bound the event sidecar explicitly; count dropped events so absence is never claimed as proof.
function lifecycle(store, event) {
  store.eventsSeen++;
  event.seq = store.eventsSeen;
  if (store.events.length < 2500) store.events.push(event);
  else { store.events[(store.eventsSeen - 1) % 2500] = event; store.eventsDropped++; }
}

function observeLifecycle(engine, win, store) {
  if (store.engines.has(engine)) return;
  store.engines.add(engine);
  for (const name of ['setWaveData', '_captureCoarseBase', '_freeCoarseBase', 'bridgeToCoarseGlobalIfHeld']) {
    const original = engine[name];
    if (typeof original !== 'function') continue;
    engine[name] = function(...args) {
      if (win.__RAW_CAPTURE_OPACITY__ !== true) return original.apply(this, args);
      let event;
      try {
        event = { method: name, t: performance.now(), frame: store.seq,
          before: opacityEngineState(this),
          incoming: name === 'setWaveData' || name === '_captureCoarseBase' ? opacityGridIdentity(args[1]) : null };
        lifecycle(store, event);
      } catch (_) { store.errors++; }
      try {
        const result = original.apply(this, args);
        if (event) event.result = typeof result === 'boolean' ? result : null;
        return result;
      } catch (error) {
        if (event) event.threw = true;
        throw error;
      } finally {
        try { if (event) { event.after = opacityEngineState(this); event.end = performance.now(); } }
        catch (_) { store.errors++; }
      }
    };
  }
}

export function beginOpacityEvidence(engine) {
  if (typeof window === 'undefined' || window.__RAW_CAPTURE_OPACITY__ !== true) return null;
  try {
    const store = window.__RAW_OPACITY_EVIDENCE__ || (window.__RAW_OPACITY_EVIDENCE__ = {
      schema: 1, seq: 0, events: [], eventsSeen: 0, eventsDropped: 0, errors: 0, engines: new WeakSet(),
    });
    observeLifecycle(engine, window, store);
    const flags = Object.fromEntries(FLAGS.map(name => [name, window[name] ?? null]));
    const frame = { seq: ++store.seq, start: performance.now(), status: 'entered',
      before: opacityEngineState(engine), flags };
    store.frame = frame;
    return frame;
  } catch (_) { return null; }
}

export function finishOpacityEvidence(frame, engine) {
  if (!frame) return;
  try {
    frame.after = opacityEngineState(engine);
    frame.end = performance.now();
  } catch (_) { frame.evidenceError = true; }
}
