// The rating band must not paint a score from a grid COARSER than the regional one, and must not show a seam where a rating grid ends
// (the owner's manual test, 2026-10-25: "breaks in the rating on tiles that weren't all the way on screen yet, and inconsistent
// colours/ratings match up"; the console showed the band PAINTING on a 9x8 global_mid rating grid, 16 deg wide, 2 deg cells, beside the
// 17x21 florida_east_coast rating grid, 0.25 deg cells, one zoom step later).
//
// Two legs, combined with the existing span and coverage legs by min() (resolveRatingBandFade, marineEngineDecisions.js), so the band HOLDS
// OFF (the honest wave heatmap draws in its place, the existing band <-> wash trade) until a fine, covering rating grid is resident:
//   RESOLUTION  the resident rating grid's lattice spacing (lon span / (cols - 1)) against the regional lattice (0.25 deg): full band up to
//               __RAW_BAND_RES_CELL_LO__ (default 0.5 deg: twice the regional spacing, what a decimated series page of an 8-deg box is),
//               gone at __RAW_BAND_RES_CELL_HI__ (default 1.0 deg), a smoothstep between. A 2-deg global_mid grid is gone; 0.25 / 0.5 are full.
//   EDGE        the resident's coverage of the viewport, only above the zoom the coverage leg owns (MARINE_ZOOMED_OUT_MAX_ZOOM) and only once
//               the view has stayed uncovered for __RAW_BAND_EDGE_GRACE_MS__ (default 1500 ms): full band at >= __RAW_BAND_EDGE_COVER_HI__
//               (default 0.98), gone at <= __RAW_BAND_EDGE_COVER_LO__ (default 0.85). A rating grid that ends inside the view and stays
//               there is a seam, so the band waits for the tile that covers it. The grace keeps a mid-pan dip (rated -> rated handoff
//               under the commit grace) untouched: dimming those was the band-blink the coverage leg's spec rules out.
// Unknown inputs FAIL OPEN (the leg is inert: the 2026-07-03 unknown-input lesson). Kills: __RAW_DISABLE_BAND_RES_FADE__,
// __RAW_DISABLE_BAND_EDGE_FADE__. The words for it (not colour alone): ForecastTimeStatus reads heldBy and says so.
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';

const smooth = (t) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const num = (w, k, d) => (typeof w[k] === 'number' ? w[k] : d);

let _uncoveredSince = null;
/** How long (ms) the resident has covered less than __RAW_BAND_EDGE_COVER_HI__ of the view without a break; 0 while covered. One engine. */
export function edgeUncoveredMs(coverFrac, nowMs) {
  const w = typeof window !== 'undefined' ? window : {};
  const now = typeof nowMs === 'number' ? nowMs : (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (typeof coverFrac !== 'number' || coverFrac >= num(w, '__RAW_BAND_EDGE_COVER_HI__', 0.98)) { _uncoveredSince = null; return 0; }
  if (_uncoveredSince === null) _uncoveredSince = now;
  return now - _uncoveredSince;
}
export const _resetEdgeTimerForTest = () => { _uncoveredSince = null; };

// cov.cellDeg is marineEngineDecisions.gridCellDeg(resident): lon span / (cols - 1), antimeridian-safe, null when unknown.
/** { fade, resFade, edgeFade, heldBy } for the resident rating grid. cov = { cellDeg, coverFrac, zoom, uncoveredMs }; all optional (fail open). */
export function resolveBandResolutionEdge(win, cov) {
  const w = win || {};
  let resFade = 1.0;
  let edgeFade = 1.0;
  if (cov && w.__RAW_DISABLE_BAND_RES_FADE__ !== true && typeof cov.cellDeg === 'number' && cov.cellDeg > 0) {
    const lo = num(w, '__RAW_BAND_RES_CELL_LO__', 0.5);
    const hi = num(w, '__RAW_BAND_RES_CELL_HI__', 1.0);
    resFade = 1.0 - smooth((cov.cellDeg - lo) / Math.max(1e-6, hi - lo));
  }
  if (cov && w.__RAW_DISABLE_BAND_EDGE_FADE__ !== true && typeof cov.coverFrac === 'number' && typeof cov.zoom === 'number'
      && cov.zoom > MARINE_ZOOMED_OUT_MAX_ZOOM && typeof cov.uncoveredMs === 'number' && cov.uncoveredMs >= num(w, '__RAW_BAND_EDGE_GRACE_MS__', 1500)) {
    const lo = num(w, '__RAW_BAND_EDGE_COVER_LO__', 0.85);
    const hi = num(w, '__RAW_BAND_EDGE_COVER_HI__', 0.98);
    edgeFade = smooth((cov.coverFrac - lo) / Math.max(1e-6, hi - lo));
  }
  const fade = Math.min(resFade, edgeFade);
  const heldBy = fade >= 0.5 ? null : (resFade <= edgeFade ? 'resolution' : 'edge');
  return { fade, resFade, edgeFade, heldBy };
}

/** The line ForecastTimeStatus shows while the band is held (words, so the state is never colour alone). */
export function ratingBandHeldText(heldBy) {
  if (heldBy === 'resolution') return 'Surf ratings paused: the detailed rating grid for this view is still loading.';
  if (heldBy === 'edge') return 'Surf ratings paused: the rating grid does not cover this whole view yet.';
  return null;
}
