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
 * PURE: summarize a spotId -> rating map for diagnostics. Returns { count, sampleIds, levels } where `levels`
 * tallies how many glyphs fall in each rating level (so a live capture instantly shows "15 spots, all very_poor"
 * vs "0 spots" — the difference between "flat but working" and "broken"). Unit-testable without React/DOM.
 */
export function summarizeSpotRatings(map) {
  const ids = map ? Object.keys(map) : [];
  const levels = {};
  for (const id of ids) {
    const lvl = (map[id] && map[id].level) || 'unknown';
    levels[lvl] = (levels[lvl] || 0) + 1;
  }
  return { count: ids.length, sampleIds: ids.slice(0, 5), levels };
}

/**
 * SSR-safe writer for window.__SPOT_RATINGS_DIAG__ — the rating-overlay's live truth window (mirrors the
 * __MARINE_*__ diag pattern). Merges `patch` into the running diag and stamps `ts` so a console capture in §5
 * of the handoff shows exactly WHY glyphs are/aren't showing (fetch status, source, counts, sample ids) instead
 * of guesswork. No-op outside the browser. Never throws into the render path.
 */
export function writeSpotRatingsDiag(patch) {
  if (typeof window === 'undefined') return;
  try {
    window.__SPOT_RATINGS_DIAG__ = { ...(window.__SPOT_RATINGS_DIAG__ || {}), ...patch, ts: Date.now() };
  } catch (e) { /* diagnostics must never break rendering */ }
}

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
 * PURE: pick the BEST (highest-score) rating among a cluster's leaf spots. `leaves` are supercluster leaf
 * features (each `properties.spotId`); `spotRatings` is the spotId -> rating map. Returns the best rating
 * augmented with `count` (how many leaves were rated), or null when the cluster has no rated spots. Used to
 * TINT cluster bubbles so toggling Rating visibly recolours the map even when spots are clustered (zoomed out)
 * — the gap that made the toggle look like "nothing happens" at regional zoom.
 */
export function aggregateLeafRatings(leaves, spotRatings) {
  if (!Array.isArray(leaves) || !spotRatings) return null;
  let best = null;
  let count = 0;
  for (const lf of leaves) {
    const id = lf && lf.properties && lf.properties.spotId;
    const r = id != null ? spotRatings[id] : null;
    if (!r) continue;
    count += 1;
    if (best == null || r.score > best.score) best = r;
  }
  if (!best) return null;
  return { color: best.color, level: best.level, score: best.score, label: best.label, count };
}

/**
 * PURE: clusterId(`cluster.id`) -> aggregated best rating, for the cluster markers in view. Skips non-clusters
 * and clusters with no rated leaves (→ plain orange bubble, graceful). `supercluster.getLeaves` is capped at
 * `leafCap` so a giant zoomed-out cluster can't stall the render (best-of-a-sample is plenty for a tint).
 */
export function computeClusterRatings(spotClusters, spotRatings, supercluster, leafCap = 100) {
  const out = {};
  if (!Array.isArray(spotClusters) || !spotRatings || !supercluster) return out;
  if (Object.keys(spotRatings).length === 0) return out;
  for (const c of spotClusters) {
    if (!c || !c.isCluster) continue;
    let leaves;
    try { leaves = supercluster.getLeaves(c.clusterId, leafCap); } catch (e) { continue; }
    const agg = aggregateLeafRatings(leaves, spotRatings);
    if (agg) out[c.id] = agg;
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
  const retryRef = useRef({ key: null, n: 0 });   // cold-start auto-recovery: bounded retries per viewport
  const retryTimerRef = useRef(null);

  // moveend fires once per pan/zoom settle (not per frame) → a clean refetch trigger.
  useEffect(() => {
    if (!mapInstance) return;
    const onMove = () => setMoveNonce((n) => (n + 1) % 1000000);
    mapInstance.on('moveend', onMove);
    return () => { try { mapInstance.off('moveend', onMove); } catch (e) { /* map gone */ } };
  }, [mapInstance]);

  // Fetch accurate per-spot ratings for the viewport, debounced + deduped + abortable.
  useEffect(() => {
    if (!surfMode || !mapInstance) {
      setEndpointRatings({}); lastKeyRef.current = null;
      writeSpotRatingsDiag({ status: 'idle', surfMode: !!surfMode });
      return;
    }
    let bounds;
    try { bounds = mapInstance.getBounds(); } catch (e) { return; }
    if (!bounds) return;
    // Snap OUTWARD to the 0.25° grid (floor W/S, ceil E/N) so the bbox always CONTAINS the viewport and can
    // never collapse to zero area. A plain round() collapsed a sub-0.25° viewport at high zoom (z13+) to a
    // single point (live: "0/0 rated · -122.5,37.5,-122.5,37.5") → no spots → glyphs vanished when zoomed in.
    const fl = (v) => Math.floor(v * 4) / 4;
    const ce = (v) => Math.ceil(v * 4) / 4;
    let bw = fl(bounds.getWest()), bs = fl(bounds.getSouth()), be = ce(bounds.getEast()), bn = ce(bounds.getNorth());
    if (be <= bw) be = bw + 0.25;                        // guarantee a non-degenerate span at any zoom
    if (bn <= bs) bn = bs + 0.25;
    const bbox = `${bw},${bs},${be},${bn}`;
    let validTime;
    try { validTime = getSharedValidTime(timeOffsetHours, 'waves', activeModel || 'GFS'); } catch (e) { return; }
    const key = `${bbox}|${validTime}|${activeModel}`;
    if (key === lastKeyRef.current) return;             // same viewport/time/model → keep current ratings
    const controller = new AbortController();
    const t = setTimeout(() => {
      lastKeyRef.current = key;
      const model = activeModel || 'GFS';
      writeSpotRatingsDiag({ status: 'fetching', surfMode: true, lastBbox: bbox, lastValidTime: validTime, lastModel: model });
      // limit=160 (backend cap 200): a regional viewport can hold >80 spots (dense coasts like SoCal); 80
      // truncated the rated set → only SOME spots glyphed ("some but not all" report). 160 covers typical
      // regional views; the deterministic verified-peak-first order means the best spots are always included.
      fetchSpotRatings({ bbox, validTime, model, limit: 160, signal: controller.signal })
        .then((resp) => {
          retryRef.current = { key: null, n: 0 };          // recovered → clear the cold-start retry budget
          const mapped = mapSpotRatingsResponse(resp && resp.spots);
          setEndpointRatings(mapped);
          const sum = summarizeSpotRatings(mapped);
          writeSpotRatingsDiag({
            status: 'ok', source: (resp && resp.source) || 'live',
            rawCount: (resp && Array.isArray(resp.spots)) ? resp.spots.length : 0,
            fetched: sum.count, sampleIds: sum.sampleIds, levels: sum.levels, error: null,
          });
          // One concise line per fetch (fetches are debounced + deduped → not spammy).
          try { console.debug(`[spot-ratings] ${sum.count}/${(resp && resp.spots || []).length} rated · src=${(resp && resp.source)} · ${bbox} @ ${validTime}`); } catch (e) { /* noop */ }
        })
        .catch((err) => {
          lastKeyRef.current = null; /* allow retry; keep last + grid fallback */
          if (err && err.name === 'AbortError') return;    // superseded by a newer viewport — not a real failure
          writeSpotRatingsDiag({ status: 'error', error: String(err && err.message || err) });
          // COLD-START AUTO-RECOVERY: Render spin-down makes EVERY fetch fail (CORS/timeout) for ~30-60s, so
          // toggling Rating during that window left glyphs blank until a manual re-toggle/pan. Retry THIS
          // viewport a few times so glyphs reappear on their own once the box is warm; bounded per-viewport so
          // a genuinely-down backend isn't hammered. AbortErrors (panning) are excluded above.
          const r = retryRef.current;
          if (r.key !== key) { r.key = key; r.n = 0; }
          if (r.n < 4) { r.n += 1; retryTimerRef.current = setTimeout(() => setMoveNonce((n) => (n + 1) % 1000000), 3500); }
        });
    }, 450);
    return () => { clearTimeout(t); controller.abort(); if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, [surfMode, mapInstance, activeModel, timeOffsetHours, moveNonce]);

  // Endpoint ratings (accurate) override the instant grid-sample fallback.
  const merged = useMemo(() => ({ ...gridRatings, ...endpointRatings }), [gridRatings, endpointRatings]);

  // Record the EFFECTIVE state (what actually reaches the glyphs) so a live capture distinguishes
  // "endpoint empty but grid fallback covering" from "nothing at all". Eligible = non-cluster spots in view.
  useEffect(() => {
    const eligible = Array.isArray(spotClusters) ? spotClusters.filter((c) => c && !c.isCluster).length : 0;
    writeSpotRatingsDiag({
      mergedCount: Object.keys(merged).length,
      gridFallbackCount: Object.keys(gridRatings).length,
      eligibleSpots: eligible,
      ratingGrid: !!(grid && grid.ratingMode),
    });
  }, [merged, gridRatings, spotClusters, grid]);

  return merged;
}
