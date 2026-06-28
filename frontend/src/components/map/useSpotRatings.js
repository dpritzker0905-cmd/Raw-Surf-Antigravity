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
import { useMemo, useState, useEffect, useRef } from 'react';
import { scoreToLevel, RATING_COLOR, RATING_LABEL } from './surfRating';
import { fetchSpotRatings, mapSpotRatingsResponse } from './spotRatingsClient';
import { getSharedValidTime } from './backendWeatherServiceClient';

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
 * Pure: spotId -> { score, level, color, label } for the visible (non-cluster) spots in Rating mode.
 * Extracted from the hook so the ratingMode gate + sampling are unit-testable without React.
 *
 * Option-A gate (rating plan §8 #2): returns {} unless `grid.ratingMode` is true. On a raw-height frame
 * (e.g. the global-coarse frame where the backend skipped the surf transform) `grid.speed` is wave HEIGHT
 * in metres, which sampleRatingScoreFromGrid would mis-decode as score/10 → fake "poor" glyphs. When
 * ratingMode is false the spots fall back to plain pins (matching the shader showing the honest swell field).
 */
export function computeSpotRatings(spotClusters, grid, surfMode) {
  const out = {};
  if (!surfMode || !grid || !grid.ratingMode || !spotClusters) return out;
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
}

/**
 * Map of spotId -> { score, level, color, label, confidence, why } for the visible spots while Rating mode is on.
 *
 * Two-source (P1 increment 2): the per-spot backend endpoint (/api/weather/spot-ratings) is the ACCURATE source
 * — it resolves each spot at its precise location (best-resolution tile + bathymetry + wind), so glyphs are right
 * even at remote/un-warmed spots where the coarse grid sample is wrong or absent. The instant grid-sample
 * (computeSpotRatings) is kept as an immediate fallback so glyphs appear with zero latency on toggle, then the
 * endpoint result overrides it. Endpoint failures keep the last result (no flicker); the grid fallback still covers.
 */
export function useSpotRatings({ spotClusters, marineData, surfMode, mapInstance, activeModel = 'GFS', timeOffsetHours = 0 }) {
  const grid = marineData && marineData.grid;
  const rev = (marineData && (marineData.__commitRevision || (grid && grid.__activeLayerNonzeroCount))) || 0;
  // Instant fallback from the already-loaded rating grid (gated on ratingMode — Option A).
  const gridRatings = useMemo(
    () => computeSpotRatings(spotClusters, grid, surfMode),
    [spotClusters, surfMode, rev, grid]
  );

  const [endpointRatings, setEndpointRatings] = useState({});
  const [moveNonce, setMoveNonce] = useState(0);
  const lastKeyRef = useRef(null);

  // moveend fires once per pan/zoom settle (not per frame) → a clean refetch trigger.
  useEffect(() => {
    if (!mapInstance) return;
    const onMove = () => setMoveNonce((n) => (n + 1) % 1000000);
    mapInstance.on('moveend', onMove);
    return () => { try { mapInstance.off('moveend', onMove); } catch (e) { /* map gone */ } };
  }, [mapInstance]);

  // Fetch accurate per-spot ratings for the viewport, debounced + deduped + abortable.
  useEffect(() => {
    if (!surfMode || !mapInstance) { setEndpointRatings({}); lastKeyRef.current = null; return; }
    let bounds;
    try { bounds = mapInstance.getBounds(); } catch (e) { return; }
    if (!bounds) return;
    const snap = (v) => Math.round(v * 4) / 4;          // 0.25° — no refetch on sub-cell pans
    const bbox = `${snap(bounds.getWest())},${snap(bounds.getSouth())},${snap(bounds.getEast())},${snap(bounds.getNorth())}`;
    let validTime;
    try { validTime = getSharedValidTime(timeOffsetHours, 'waves', activeModel || 'GFS'); } catch (e) { return; }
    const key = `${bbox}|${validTime}|${activeModel}`;
    if (key === lastKeyRef.current) return;             // same viewport/time/model → keep current ratings
    const controller = new AbortController();
    const t = setTimeout(() => {
      lastKeyRef.current = key;
      fetchSpotRatings({ bbox, validTime, model: activeModel || 'GFS', limit: 80, signal: controller.signal })
        .then((resp) => setEndpointRatings(mapSpotRatingsResponse(resp && resp.spots)))
        .catch(() => { lastKeyRef.current = null; /* allow retry; keep last + grid fallback */ });
    }, 450);
    return () => { clearTimeout(t); controller.abort(); };
  }, [surfMode, mapInstance, activeModel, timeOffsetHours, moveNonce]);

  // Endpoint ratings (accurate) override the instant grid-sample fallback.
  return useMemo(() => ({ ...gridRatings, ...endpointRatings }), [gridRatings, endpointRatings]);
}
