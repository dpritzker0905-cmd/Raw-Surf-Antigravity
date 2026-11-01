/**
 * heldFrameTime.js: the DATA time of a frame the client builds from other frames (2026-10-25, the owner's day-14 test).
 *
 * Past a model's stored tail the server serves its far-edge hold: the last stored frame, relabelled as an estimate, with its true
 * time in served_valid_time (grid_resolver.stamp_frame_honesty). The ICON extended blend (backendWeatherServiceClientHelpers, hours
 * past 240) averages the GFS and EURO answers for the target hour and dropped those times, so the drawn record had no data time,
 * compared hour LABELS and called a 12-14 h-old field exact ("Estimated forecast: estimated" under the Sunday label).
 * A blend is only as recent as its oldest input, so it carries the OLDEST input's served time, readout-only (__readoutServedTime:
 * the status line reads it; the commit rules never do, as #444 keeps served_valid_time out of the conform).
 * Kill: window.__RAW_DISABLE_BLEND_SERVED_TIME__ = true (the blend carries no time, as before).
 */
export const blendServedTimeOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_BLEND_SERVED_TIME__ === true);

/** The served (data) time a /grid answer carries: top level, its grid, or its grid's diagnostics; null when it says none. */
export function servedTimeOf(result) {
  if (!result) return null;
  const g = result.grid || {};
  return result.served_valid_time || g.served_valid_time || (g.diagnostics && g.diagnostics.served_valid_time) || null;
}

/** The oldest served time among the inputs a blend used, and each input's time: { oldest, times } or null when none says one. */
export function oldestServedTime(inputs) {
  if (!blendServedTimeOn()) return null;
  const times = {};
  let oldest = null; let oldestMs = Infinity;
  for (const [name, result] of Object.entries(inputs || {})) {
    const t = servedTimeOf(result);
    const ms = t ? Date.parse(t) : NaN;
    if (!Number.isFinite(ms)) continue;
    times[name] = t;
    if (ms < oldestMs) { oldestMs = ms; oldest = t; }
  }
  return oldest ? { oldest, times } : null;
}
