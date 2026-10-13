/**
 * marineLayerStamp — WHY the marine layer did not draw on a frame (2026-09-26).
 *
 * The continuity gate (e2e/marine-render-continuity.spec.js, A15-06) reads the engine's draw counter,
 * `__RAW_GPU__.opacity.n`, which advances only when the heatmap actually DRAWS. On desktop Safari it
 * stalls for 1.5-2.1 s on a Swell toggle and a switch to EURO, and the counter alone cannot say why.
 * The attached series split the cases already: on the EURO switch the in-page sampler kept its
 * ~100 ms rhythm (main thread free, the engine simply did not draw); on the Swell toggle it had an
 * 801 ms hole (main thread blocked). What neither can say is WHICH exit the layer took.
 *
 * This stamp answers that. `__RAW_GPU__.layer` is rewritten on EVERY render() call:
 *   n     advances per call, so a flat `n` means MapLibre stopped calling the layer at all
 *   skip  null when the engine was asked to draw; otherwise the exit taken instead
 * ⚠️ Skips other than `engine_no_data` and `engine_no_matrix` return BEFORE `finally { map.triggerRepaint() }`,
 * which is the layer's own animation clock, so those skips also stop the layer driving frames.
 * The gate records both fields; the next dev E2E run names the mechanism instead of a guess.
 */
export const SKIP = Object.freeze({
  INACTIVE: 'inactive',              // active=false and nothing held (a real deactivation)
  INACTIVE_HELD: 'inactive_held',    // active=false while a transition hold keeps the textures
  ERRORS: 'errors',                  // the error burst disabled drawing
  NO_MAP: 'no_map',
  REJECTED_BAIL: 'rejected_bail',    // regional grid rejected at a zoomed-out viewport
  ZOOMED_OUT_IDLE: 'zoomed_out_idle', // regional grid hidden at world zoom while idle
  ENGINE_NO_DATA: 'engine_no_data',  // the layer called the engine, which has no wave data to draw
  ENGINE_NO_MATRIX: 'engine_no_matrix', // the engine has data but no projection, so cannot draw
});

/** Stamp one render() call; returns the stamp to mark a skip on, or null when not instrumented. */
export function stampLayerCall(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const g = w && w.__RAW_GPU__;
  if (!g) return null;
  const stamp = { n: ((g.layer && g.layer.n) || 0) + 1, t: Date.now(), skip: null };
  g.layer = stamp;
  return stamp;
}

/** Record the exit this call took instead of a draw. */
export function stampSkip(stamp, reason) {
  if (stamp) stamp.skip = reason;
}
