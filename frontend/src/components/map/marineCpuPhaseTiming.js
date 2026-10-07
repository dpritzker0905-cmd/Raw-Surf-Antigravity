// Fixed-size CPU scalars only. Nested phases overlap: never sum them as frame time.
// These timings include possible driver waiting, not asynchronous GPU completion.
export const MARINE_CPU_PHASES = [
  'customCallback', 'engineDraw', 'waveDataUpdate', 'regionalMaskRefresh',
  'overlayMaskRefresh', 'maskFeatureQuery', 'maskBaseCanvas', 'maskWaterPaint', 'maskUpload',
  'maskRefreshInitial', 'maskRefreshIdle', 'maskRefreshMoveEnd', 'maskRefreshZoomEnd',
  'maskRefreshSourceWater', 'maskRefreshSourceOther', 'maskRefreshSourceUnknown', 'maskRefreshOther',
  'maskPaintSourceFallback', 'maskPaintRenderedDamage', 'maskPaintRenderedClean',
  'maskPaintEmpty', 'maskPaintFailed', 'maskPaintUnknown',
];
const CONTEXTS = ['visibleFocused', 'visibleUnfocused', 'hidden', 'unknown'];
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const count = n => Number.isSafeInteger(n) && n >= 0;
const bucket = () => ({ calls: 0, totalDurationMs: 0, histogram: [0, 0, 0, 0, 0] });
// A readonly/corrupt diagnostic store may refuse even an invalid-sample marker.
// Weak membership prevents such failures from being mistaken for zero work.
const unreadableStates = new WeakSet();
function markUnreadable(state) {
  if (state && typeof state === 'object') unreadableStates.add(state);
}

function context() {
  try {
    if (typeof document === 'undefined' || typeof document.hidden !== 'boolean') return 'unknown';
    if (document.hidden) return 'hidden';
    const focused = document.hasFocus();
    return focused === true ? 'visibleFocused' : focused === false ? 'visibleUnfocused' : 'unknown';
  } catch (e) { return 'unknown'; }
}

export function beginMarineCpuPhase(phase) {
  let state = null;
  try {
    if (!MARINE_CPU_PHASES.includes(phase) || typeof window === 'undefined'
        || window.__RAW_DISABLE_MARINE_PHASE_TIMING__ === true || !window.__RAW_GPU__) return null;
    const gpu = window.__RAW_GPU__;
    if (!gpu.cpuPhaseTiming) gpu.cpuPhaseTiming = {
      buckets: Object.fromEntries(MARINE_CPU_PHASES.map(name => [name, bucket()])),
      contexts: Object.fromEntries(CONTEXTS.map(name => [name, 0])), active: 0, invalidSamples: 0,
    };
    state = gpu.cpuPhaseTiming;
    const start = performance.now();
    if (!finite(start)) { state.invalidSamples++; return null; }
    const visibility = phase === 'customCallback' ? context() : null;
    state.active++;
    return { state, phase, start, visibility };
  } catch (e) {
    markUnreadable(state);
    try { if (state) state.invalidSamples++; } catch (ignored) { /* unknown stays unknown */ }
    return null;
  } // Instrumentation cannot interrupt rendering.
}

export function endMarineCpuPhase(token) {
  if (!token) return;
  try {
    const { state, phase, start, visibility } = token;
    // Clear before any read that can throw, so failed diagnostics cannot leave a live operation.
    state.active--;
    const duration = performance.now() - start;
    if (!finite(duration)) { state.invalidSamples++; return; }
    const totals = state.buckets[phase];
    totals.calls++; totals.totalDurationMs += duration;
    const index = duration <= 8 ? 0 : duration <= 16.6 ? 1 : duration <= 33.3 ? 2 : duration <= 66.6 ? 3 : 4;
    totals.histogram[index]++;
    if (visibility) state.contexts[visibility]++;
  } catch (e) {
    markUnreadable(token.state);
    try { token.state.invalidSamples++; } catch (ignored) { /* unknown stays unknown */ }
  }
}

export function timeMarineCpuPhase(phase, operation) {
  return function(...args) {
    const token = beginMarineCpuPhase(phase);
    try { return operation.apply(this, args); }
    finally { endMarineCpuPhase(token); }
  };
}

export function measureMarineCpuPhase(phase, operation) {
  const token = beginMarineCpuPhase(phase);
  try { return operation(); }
  finally { endMarineCpuPhase(token); }
}

// Install once when the engine module initializes. Public methods stay synchronous;
// early exits and thrown operations are measured without changing their semantics.
export function instrumentMarineEngineCpuPhases(Engine) {
  for (const [method, phase] of [
    ['render', 'engineDraw'], ['setWaveData', 'waveDataUpdate'],
    ['refreshMaskWithBasemapWater', 'regionalMaskRefresh'], ['refreshViewportOverlayMask', 'overlayMaskRefresh'],
  ]) Engine.prototype[method] = timeMarineCpuPhase(phase, Engine.prototype[method]);
}

export function snapshotMarineCpuPhases(gpu) {
  try {
    if (typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_PHASE_TIMING__ === true) return null;
    const source = gpu?.cpuPhaseTiming;
    if (!source || unreadableStates.has(source) || source.active !== 0 || !count(source.invalidSamples)) return null;
    const buckets = {};
    for (const phase of MARINE_CPU_PHASES) {
      const b = source.buckets[phase];
      if (!count(b.calls) || !finite(b.totalDurationMs) || !Array.isArray(b.histogram)
          || b.histogram.length !== 5 || !Array.from(b.histogram).every(count)
          || b.histogram.reduce((a, n) => a + n, 0) !== b.calls) return null;
      buckets[phase] = { calls: b.calls, totalDurationMs: b.totalDurationMs, histogram: b.histogram.slice() };
    }
    const contexts = {};
    for (const name of CONTEXTS) {
      if (!count(source.contexts[name])) return null;
      contexts[name] = source.contexts[name];
    }
    if (Object.values(contexts).reduce((a, n) => a + n, 0) !== buckets.customCallback.calls) return null;
    return { source, buckets, contexts, invalidSamples: source.invalidSamples };
  } catch (e) { return null; }
}

export function marineCpuPhaseDelta(before, after) {
  if (!before || !after || before.source !== after.source || before.invalidSamples !== after.invalidSamples) return null;
  const subtract = (a, b) => finite(a) && finite(b) && b >= a ? b - a : null;
  const phases = {}, callbackContexts = {};
  for (const name of MARINE_CPU_PHASES) {
    const a = before.buckets[name], b = after.buckets[name];
    const calls = subtract(a.calls, b.calls), totalDurationMs = subtract(a.totalDurationMs, b.totalDurationMs);
    const histogram = a.histogram.map((n, i) => subtract(n, b.histogram[i]));
    if (calls === null || totalDurationMs === null || histogram.includes(null)) return null;
    phases[name] = { calls, totalDurationMs, histogram };
  }
  for (const name of CONTEXTS) {
    const n = subtract(before.contexts[name], after.contexts[name]);
    if (n === null) return null;
    callbackContexts[name] = n;
  }
  return { overlappingPhases: true, gpuCompletionMeasured: false,
    histogramUpperBoundsMs: [8, 16.6, 33.3, 66.6, null], phases, callbackContexts };
}
