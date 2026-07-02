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
