/**
 * useSpotRatings.js — per-surf-spot quality rating for the map's "Rating" overlay glyphs.
 *
 * In Rating mode the backend already transforms the marine grid into a surf-QUALITY field: each coastal cell
 * carries score/10 in `vec.speed` (physically grounded — surf_transform breaking height + wind offshore/onshore
 * via shore-normal + period; open-ocean cells masked to 0). So instead of re-deriving anything client-side, we
 * sample THAT field at each surf spot — accurate, perfectly consistent with the band, and zero extra fetches.
 *
 * The result colours a discrete animated glyph at each spot (rendered in MapMarkerLayers) so the rating reads
 * AT the surf breaks, not as a coarse band smeared across the whole shelf.
 */
import { useMemo } from 'react';
import { scoreToLevel, RATING_COLOR, RATING_LABEL } from './surfRating';

/**
 * Nearest rated coastal cell to (lat,lng) in a Rating-mode marine grid (speed = score/10; open-ocean = 0).
 * Indexed directly via cols/rows/bounds, then a small ±2-cell neighbourhood search so a coastal spot still
 * finds its adjacent rated cell when its exact nearest cell is land-masked. Returns a 0-100 score or null.
 */
export function sampleRatingScoreFromGrid(grid, lat, lng) {
  if (!grid || !grid.vectors || !grid.vectors.length || !grid.cols || !grid.rows || !grid.bounds) return null;
  if (lat == null || lng == null) return null;
  const { west, south, east, north } = grid.bounds;
  if (south == null || north == null || west == null || east == null) return null;

  let lngSpan = east - west;
  if (lngSpan <= 0) lngSpan += 360;            // antimeridian-crossing grid
  if (lngSpan <= 0) return null;
  let rel = lng - west;
  if (rel < 0) rel += 360;
  if (rel > lngSpan) return null;
  if (lat < south || lat > north) return null;

  const latSpan = (north - south) || 1e-6;
  const fx = (rel / lngSpan) * (grid.cols - 1);
  const fy = ((lat - south) / latSpan) * (grid.rows - 1);
  const cx = Math.round(fx);
  const cy = Math.round(fy);

  let best = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) continue;
      const v = grid.vectors[y * grid.cols + x];
      const sp = v && typeof v.speed === 'number' ? v.speed : 0;
      if (sp > best) best = sp;
    }
  }
  if (best <= 0.05) return null;                // no rated cell near this spot
  return Math.min(100, best * 10);              // speed packs score/10
}

/**
 * Map of spotId -> { score, level, color, label } for the visible (non-cluster) spots, while Rating mode is on.
 * Recomputes only when the spots, the surf-mode flag, or the marine grid revision change.
 */
export function useSpotRatings({ spotClusters, marineData, surfMode }) {
  const grid = marineData && marineData.grid;
  const rev = (marineData && (marineData.__commitRevision || (grid && grid.__activeLayerNonzeroCount))) || 0;

  return useMemo(() => {
    const out = {};
    if (!surfMode || !grid || !spotClusters) return out;
    for (const c of spotClusters) {
      if (!c || c.isCluster) continue;
      const score = sampleRatingScoreFromGrid(grid, c.latitude, c.longitude);
      if (score == null) continue;
      const level = scoreToLevel(score);
      out[c.id] = {
        score: Math.round(score),
        level,
        color: RATING_COLOR[level],
        label: RATING_LABEL[level],
      };
    }
    return out;
    // rev guards the data-content recompute when the grid is mutated in place across commits.
  }, [spotClusters, surfMode, rev, grid]);
}
