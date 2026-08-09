/**
 * modelHorizons.js — the forecast hours at which a layer stops being the model you selected.
 *
 * WHY THIS FILE EXISTS. These cutovers were eight bare integer literals inline in
 * `useOpenMeteoTileUrls.resolveModel`, and at least four other places in the tree carry their own
 * copies which DISAGREE with them (`useTemporalPreloader` 216/228, `forecastDiagnostics`
 * nativeLimit 240/168, `LayerRegistry`'s generateDefaultTimes bootstrap, plus 168 in several
 * marine client files). Nothing reconciled them, so the preloader could warm one model while the
 * renderer painted another. Naming them does not by itself make them RIGHT — it makes them
 * arguable, countable, and testable, which is the precondition for changing any of them.
 *
 * ⚠️⚠️ THE "216" IN OTHER FILES IS NOT AN HOUR — it is a TAIL LENGTH, and reading it as a horizon
 * is a live trap (I fell into it on 2026-08-09 before checking the source). `capabilities.py`
 * declares ICON wind as native_horizon_hours 120, estimated_horizon_hours 216,
 * max_forecast_hours 336 — and 120 + 216 = 336. So "ICON has data to 216 h" is UNSOURCED: its only
 * in-repo support is a hardcoded bootstrap placeholder that was itself probably derived from that
 * same arithmetic. ⛔ DO NOT raise ICON_ATMOSPHERIC_CUTOVER_H on the strength of a 216 you found
 * somewhere; measure the model's real axis first.
 *
 * ⚠️ VALUES ARE UNCHANGED FROM THE INLINE LITERALS. This module is an EXTRACTION, deliberately
 * behaviour-preserving to the pixel. Moving a number here is a product change: it decides whose
 * forecast a user sees, and past a real horizon it decides whether they see a substituted model or
 * a silently repeated frame (the tile lane clamps to the last available index rather than
 * refusing, so an over-reaching cutover paints a STALE hour with no disclosure at all — a worse
 * failure than the model substitution `modelProvenance` was built to disclose).
 */

/** Wind rasters (`wind_u_component_10m`). ICON's wind axis ends well before its atmospheric one. */
export const ICON_WIND_CUTOVER_H = 120;
export const EURO_WIND_CUTOVER_H = 228;

/** Marine rasters. ⚠️ These bind ONLY when the WebGL marine engine has failed and the layers fall
 *  back to raster tiles — all four marine layers are `type: "marine"` in LayerRegistry, so the
 *  normal path never reaches them. Price their reach accordingly before investing here. */
export const ICON_MARINE_RASTER_CUTOVER_H = 168;
export const EURO_MARINE_RASTER_CUTOVER_H = 240;

/** Atmospheric rasters: precipitation, cloud_cover, temperature_2m, surface_temperature — and the
 *  generic tail (pressure) which uses the same numbers for the same reason. */
export const ICON_ATMOSPHERIC_CUTOVER_H = 168;
export const EURO_ATMOSPHERIC_CUTOVER_H = 228;

// ── THE AXIS, AND WHAT HAPPENS PAST THE END OF IT ────────────────────────────────────────────
// Extracted from the two inline copies in useOpenMeteoTileUrls (the `closestTimeIdx` memo and the
// per-layer resolve loop). BEHAVIOUR-IDENTICAL: same nearest-by-absolute-difference search, same
// clamp. It lives here so the next fact can be TESTED against shipped code rather than a replica.
//
// ⚠️⚠️ THE TILE LANE HAS NO PAST-THE-END REFUSAL. The search minimises |t - target|, so a target
// beyond the last valid time always selects the LAST index, and the clamp then guarantees it. Ask
// for hour 300 on an axis that ends at 168 and you get the 168 h frame — painted while the
// scrubber reads 300. Nothing discloses it: `modelProvenance` cannot see this because the MODEL
// never changed, only the hour did. It is a quieter failure than the model substitution it sits
// underneath, and the reason a cutover constant must never be raised without measuring the axis.

/** The index whose valid time is nearest `targetMs`, clamped into range. Mirrors the shipped
 *  selection exactly — including its saturation past the end of the axis. */
export function closestAxisIndex(validTimes, targetMs) {
  if (!Array.isArray(validTimes) || validTimes.length === 0) return 0;
  let closest = 0;
  let minDiff = Infinity;
  for (let i = 0; i < validTimes.length; i++) {
    const diff = Math.abs(new Date(validTimes[i]).getTime() - targetMs);
    if (diff < minDiff) { minDiff = diff; closest = i; }
  }
  const idx = Math.max(0, Math.min(validTimes.length - 1, closest));
  return Number.isNaN(idx) ? 0 : idx;
}

/** Is `targetMs` past the end of this axis — i.e. is the index above a STALE STAND-IN rather than
 *  the hour that was asked for? Returns false when the axis is unknown: absence is not evidence,
 *  and a bootstrap placeholder axis must never be read as proof that real data is missing. */
export function isBeyondAxis(validTimes, targetMs) {
  if (!Array.isArray(validTimes) || validTimes.length === 0) return false;
  const last = new Date(validTimes[validTimes.length - 1]).getTime();
  if (Number.isNaN(last)) return false;
  return targetMs > last;
}

/** Hours of real forecast the axis still covers from `nowMs`, or null when unknown. The floor a
 *  declared cutover should be min()'d against before it is trusted. */
export function axisHorizonHours(validTimes, nowMs) {
  if (!Array.isArray(validTimes) || validTimes.length === 0) return null;
  const last = new Date(validTimes[validTimes.length - 1]).getTime();
  if (Number.isNaN(last)) return null;
  return Math.max(0, Math.round((last - nowMs) / 3600000));
}
