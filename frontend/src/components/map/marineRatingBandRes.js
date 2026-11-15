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

/**
 * A cached RATING grid the band cannot paint at this view (2026-11-15, rating band SOTA lane; measured offline in
 * scn_band_zoom_stability.js): its lattice spacing is at or past the resolution leg's HI (1.0 deg: the band is held off on it)
 * while the view is narrower than the span leg's HI (9.5 deg: the band would otherwise show). Before this, a 2-deg world crop
 * cached on a zoom-out answered the next zoomed-in pan as a CACHE HIT: the engine rejected it as a downgrade (or held the band
 * for resolution) and, the cache having "answered", no fine grid was ever asked: the band stayed off for as long as one looked.
 * Such an entry is not a hit (the predicate) and is not served (the selector): the fetch asks for a fine grid instead.
 * Unknown inputs fail OPEN (not coarse). Kill: window.__RAW_DISABLE_COARSE_RATED_CACHE_SKIP__ = true.
 */
// The second leg (measured the same day, the stuck PAN): after a pan at z9 the lookup took a 0.5-deg rated grid that contained the
// view while the 0.25-deg resident still covered most of it, and the engine's no-downgrade guard (marineEngineDecisions
// .shouldRejectResolutionDowngrade: >= 2x coarser over a regional resident covering >= 0.6) rejected it: the cache "answered", the
// engine refused, nothing fine was asked, and the band stayed held at the edge. So a rated entry >= 2x coarser than the finest
// rated entry of the same ask that overlaps the view (`finestCell`, the cache's own resident: ratedFinestCellDeg) is not a hit.
export const ratedCellDeg = (grid) => {
  if (!grid || !grid.bounds || !(grid.cols > 1)) return null;
  const b = grid.bounds;
  const span = b.east >= b.west ? b.east - b.west : b.east + 360 - b.west;
  return span > 0 ? span / (grid.cols - 1) : null;
};
export function coarseRatedForView(grid, view, win, finestCell) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_COARSE_RATED_CACHE_SKIP__ === true || !grid || !view || !grid.bounds) return false;
  const viewW = view.east >= view.west ? view.east - view.west : view.east + 360 - view.west;
  if (!(viewW < num(w, '__RAW_RATING_SPAN_FADE_HI__', 9.5))) return false;
  // An UNRATED grid under the surf key (the honest-swell bridge: global_coarse, the mid tier) while a rated grid of the same ask
  // overlaps the view: the guard refuses rated -> unrated over that resident (measured: the stuck pan's real "hit" was a 2-deg
  // unrated global_coarse entry), so it is not a hit either. finestCell is non-null only in surf mode (ratedFinestCellDeg).
  // REVIEW 2026-11-15: every leg needs `finestCell` = a finer rated grid of the ask that COVERS >= 0.6 of the view (the guard's own
  // rule, ratedFinestCellDeg). A standalone ">= 1 deg is never a hit" leg made every narrow surf view outside the pilot boxes (where
  // the 2-deg world set is the best there is) refetch on every moveend; an "overlaps" finest made a box-edge view refetch forever.
  if (!(typeof finestCell === 'number' && finestCell > 0)) return false;
  if (!(grid.ratingMode || grid.rating_mode)) return true;
  const cell = ratedCellDeg(grid);
  if (cell === null) return false;
  return cell >= 2 * finestCell - 1e-9;
}

/** The line ForecastTimeStatus shows while the band is held (words, so the state is never colour alone). */
export function ratingBandHeldText(heldBy) {
  if (heldBy === 'resolution') return 'Surf ratings paused: the detailed rating grid for this view is still loading.';
  if (heldBy === 'edge') return 'Surf ratings paused: the rating grid does not cover this whole view yet.';
  if (heldBy === 'loading') return 'Surf ratings loading for this view…';
  if (heldBy === 'off_loading') return 'Loading wave heights for this view…';
  return null;
}
