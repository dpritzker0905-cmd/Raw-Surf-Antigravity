/**
 * windScrubEndSettle.js — does the wind lane owe the final hour a settle when a wheel drag ends? (scrub audit 2026-10-18, T-02)
 *
 * During a drag WeatherEngine's timeline effect is CACHE-ONLY (zero network). The wheel commits detents mid-drag at 11 Hz
 * and DEDUPS its release commit when the final detent was already committed (ForecastWheel `commit`: lastCommitted === t),
 * so no new `timeOffsetHours` reaches the wind effect after release, and wind has no scrub-end listener of its own (marine
 * is rescued by its scrub-settle net). A final hour that MISSED the cache mid-drag was therefore never fetched: the particles
 * stayed on the pre-drag (or last cached) hour until an unrelated pan.
 *
 * True when the hour that missed mid-drag is still the selected hour at scrub end; the caller then re-runs its normal settle
 * path once (per-hour cache -> series -> fetch). A newer hour already owns its own settle through the effect's dependency.
 * Kill: window.__RAW_DISABLE_WIND_SCRUB_END_SETTLE__ = true.
 */
export function shouldResettleWindAfterDrag(dragMissHour, currentHour, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_WIND_SCRUB_END_SETTLE__ === true) return false;
  return dragMissHour !== null && dragMissHour !== undefined && dragMissHour === currentHour;
}
