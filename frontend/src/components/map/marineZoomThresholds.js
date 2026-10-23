/**
 * marineZoomThresholds.js — the single source of truth for the MARINE "zoomed-out" display boundary.
 *
 * Above this zoom (and under a 15° viewport span) the display product is a REGIONAL viewport tile; at or
 * below it the display product is the GLOBAL COARSE grid. Every marine fetch/commit/display/settle decision
 * must share this constant: the z6.4–7.6 "clamp until dwell" transition (2026-07-02) was this boundary
 * living at 6.5 in ~8 call sites while the coarse-crest nearest-cell band topped out at 7.0 — in 6.5–7.0 the
 * pipeline kept demanding a regional tile the viewport had outgrown, while the engine's no-downgrade guard
 * (also at 6.5) REJECTED the coarse commit whenever a covering regional was resident. Aligned at 7.0: coarse
 * (with nearest-cell crests, which handle it cleanly) is the steady state up to 7.0, and the regional demand
 * starts only where regional tiles actually fit a viewport.
 *
 * NOTE: the WIND layer keeps its own literal 6.5 (useMarineWindData.js) — separate lineage, no crest band,
 * not part of this alignment. The 5.5→6.5 coarse fade ramps in WebGLMarineCustomLayer are also intentionally
 * unchanged (they saturate at 1.0 for z≥6.5, so the new 6.5–7.0 coarse zone renders at full opacity).
 */
export const MARINE_ZOOMED_OUT_MAX_ZOOM = 7.0;

// Truth echo (house style): the RUNNING bundle's thresholds, checkable before any transition forensics —
// window.__MARINE_ZOOM_THRESHOLDS__ in the console. Guards against the stale-bundle trap.
if (typeof window !== 'undefined') {
  window.__MARINE_ZOOM_THRESHOLDS__ = { zoomedOutMaxZoom: MARINE_ZOOMED_OUT_MAX_ZOOM, coarseCrestBandMinZoom: 3.5 };
}

// Bottom of the coarse-crest special-handling band (nearest-cell direction sampling on a magnified
// coarse-global grid). The band top is MARINE_ZOOMED_OUT_MAX_ZOOM — coarse simply isn't the display
// product above it.
export const COARSE_CREST_BAND_MIN_ZOOM = 3.5;

// THE SHARED REGIONAL-COVERAGE FRACTION (2026-10-22). A regional grid covering at least this share of the viewport is kept by the
// no-downgrade guard (marineEngineDecisions) and SHOWN by the display gate (WebGLMarineCustomLayer): 0.6 since 2026-07-11 / 07-16.
// Three readers still defaulted to the old 0.8: the render backstop's retained-regional test (useMarineScrubSettle), the fetcher's
// regional clear (useMarineDataFetcherHelpers) and the wind-data conform that replicates the gate (useMarineWindData). In the
// 0.6-0.8 band a wide view therefore kept AND showed a 0.25-deg tile while the backstop called it display-empty and re-drove a world
// fetch every 6 s that the guard refused (the owner's "Render backstop: engine empty" lines). They read this instead.
// Live lever unchanged: window.__RAW_DOWNGRADE_COVER_FRAC__. Kill: window.__RAW_DISABLE_COVER_FRAC_ALIGN__ = true (those three back to 0.8).
export const DOWNGRADE_COVER_FRAC = 0.6;
export const LEGACY_COVER_FRAC = 0.8;
export function alignedCoverFrac(win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  const lever = Number(w.__RAW_DOWNGRADE_COVER_FRAC__);
  if (lever) return lever;
  return w.__RAW_DISABLE_COVER_FRAC_ALIGN__ === true ? LEGACY_COVER_FRAC : DOWNGRADE_COVER_FRAC;
}
