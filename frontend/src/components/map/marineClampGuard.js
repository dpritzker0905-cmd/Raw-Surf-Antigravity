/**
 * marineClampGuard.js — WebGLMarineLayer's zoom-out clamp guard, as a pure function (moved out 2026-10-26; that file is past the
 * 800-line cap and may only shrink).
 *
 * The guard: the engine HOLDS a regional texture while the viewport is zoomed out to ~global, so holding it would draw that grid as a
 * clamped rectangle; then the layer clears (or bridges to the coarse base) instead of holding, and the switch-hold refuses too.
 *
 * ⛔ THE MID-ZOOM CLIP IS NOT A CLAMPED RECTANGLE (2026-10-26, the owner's live test: "Heatmap temporarily cleared when switching to
 * Euro"). Since #459 the resident at z3.5-7 is a viewport CLIP of global_mid that covers the view. The old test (regional width < 340
 * AND zoom <= 7 or a view wider than 15 deg) called that clip "regional at a global viewport", so a model switch's non-renderable
 * moment skipped every hold and cleared: offline at z4.6 / z5.3, GFS -> ICON drew 84-130 blank frames (non_renderable_terminal, every
 * transition flag false). The display gate (useMarineWindData, marineZoomThresholds.alignedCoverFrac) already SHOWS a regional grid
 * that covers that share of the viewport at any zoom; the guard now uses the same rule. A resident that covers less (a z9 tile after a
 * zoom-out) is still regional-at-global, exactly as before.
 * Kill (the coverage test off: the old width-and-zoom test alone): window.__RAW_DISABLE_COVERING_CLIP_HOLD__ = true.
 */
import { MARINE_ZOOMED_OUT_MAX_ZOOM, alignedCoverFrac } from './marineZoomThresholds';
import { getLongitudinalOverlap } from './useMarineDataFetcherHelpers';

const widthOf = (w, e) => ((e < w) ? (e + 360) - w : e - w);

/** The share of the viewport `view` = { west, south, east, north } that `bounds` covers (0..1). */
export function coverOfView(bounds, view) {
  const lng = getLongitudinalOverlap(view.west, view.east, bounds.west, bounds.east);
  const lat = Math.min(view.north, bounds.north) - Math.max(view.south, bounds.south);
  const area = widthOf(view.west, view.east) * (view.north - view.south);
  return lng > 0 && lat > 0 && area > 0 ? (lng * lat) / area : 0;
}

/**
 * Is the resident (its `bounds`) a regional grid at a zoomed-out viewport that it does NOT cover? `map` = the MapLibre map (getZoom,
 * getBounds). Any error (mid style-load) reads false: the caller then holds, as it always did.
 */
export function residentRegionalAtGlobalViewport(bounds, map, win) {
  try {
    if (!bounds || !map || typeof map.getZoom !== 'function') return false;
    if (!(widthOf(bounds.west, bounds.east) < 340.0)) return false;
    const vb = map.getBounds();
    const view = { west: vb.getWest(), south: vb.getSouth(), east: vb.getEast(), north: vb.getNorth() };
    const zoomedOut = map.getZoom() <= MARINE_ZOOMED_OUT_MAX_ZOOM || widthOf(view.west, view.east) > 15.0 || view.north - view.south > 15.0;
    if (!zoomedOut) return false;
    const w = win || (typeof window !== 'undefined' ? window : {});
    if (w.__RAW_DISABLE_COVERING_CLIP_HOLD__ === true) return true;
    return coverOfView(bounds, view) < alignedCoverFrac(w);
  } catch (e) {
    return false;
  }
}
