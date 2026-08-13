/**
 * omUrlTrace.js — record the tile z/x/y the `om` protocol is ACTUALLY asked for.
 *
 * WHY THIS EXISTS. On 2026-08-13 the water-temp heatmap was reported covering only part of the
 * viewport and clearing at global zoom. Six explanations were proposed and every one died:
 *   1. ICON lacks `surface_temperature`      → refuted: it fails on ALL models
 *   2. `ocean-mask-fill` covers the ocean    → refuted: it is the Natural Earth 50m LAND fill
 *   3. the `&_cb=` cache-buster kills caching→ refuted: `useRef(Date.now())`, constant per session
 *   4. the tile cache never hits             → refuted: hits went 0 → 62 once tiles repeated
 *   5. the source `bounds` clip coverage     → refuted: `bounds: null` on all three slot sources
 *   6. tile enumeration drops columns/rows   → refuted BY THIS FILE, see below
 * Each died to a measurement, and five of the six were argued from OUTSIDE the protocol, because
 * every other vantage point is second-hand: `__RASTER_PROBE__` does not fire on this path, the
 * fetches happen off-thread so they never reach the page's network log, and `getStyle()` does not
 * round-trip these sources (it reports `tiles: []` for sources that are demonstrably serving).
 * ★ THE PROTOCOL CALLBACK IS THE ONLY PLACE `params.url` IS GUARANTEED TRUE.
 *
 * ⭐⭐ THE TRAP THIS FILE EXISTS TO PREVENT — READ BEFORE USING IT. Sampled during a zoom or pan,
 * this trace WILL show a partial tile set, because the bounds were still moving while the
 * requests were issued. That produced two confident, wrong findings in one session ("only x=0 is
 * requested", then "only y=3 is requested"), each backed by arithmetic against the CURRENT centre
 * — arithmetic on a snapshot of a moving target. Under a controlled read the same view requested
 * all six tiles it should:
 *     expected z2, x[0,2], y[1,2]   observed z{2:18}, x{0:6,1:6,2:6}, y{1:9,2:9}
 * ⇒ HOLD THE VIEW STILL, CLEAR THE TRACE, THEN FORCE A FETCH. Toggling the layer off/on re-fetches
 *   without moving the map; changing the view invalidates the very thing you are measuring.
 *
 * USAGE (zero cost unless armed — the export returns immediately when the global is unset):
 *     window.__OM_URL_TRACE__ = { n: 0, x: {}, z: {}, y: {}, recent: [], unmatched: 0 };
 *     // toggle the layer off and on WITHOUT touching the view, then:
 *     JSON.stringify(window.__OM_URL_TRACE__)
 */

// `<z>/<x>/<y>` at the tail of the path, optional `.om`, optional query. Anchored on the SEPARATOR
// so a cache-buster or any other query parameter cannot be mistaken for a coordinate.
const TILE_XYZ = /\/(\d+)\/(\d+)\/(\d+)(?:\.om)?(?:\?|$)/;

/**
 * Record one protocol request. Never throws: an instrument that can break the transport it
 * observes is worse than no instrument, and this sits in the hot path of every tile.
 */
export function traceOmUrl(url) {
  if (typeof window === 'undefined') return;
  const t = window.__OM_URL_TRACE__;
  if (!t) return;                       // unarmed: one property read, then out
  try {
    const m = String(url || '').match(TILE_XYZ);
    if (!m) {
      t.unmatched = (t.unmatched || 0) + 1;
      // Keep ONE example. The metadata fetch (`latest.json?...&variable=...`) lands here, and
      // seeing it is how we confirmed water_temp is served from ncep_gfs013 whatever model the
      // UI has selected — an unmatched sample is evidence, not noise.
      if (!t.sampleUnmatched) t.sampleUnmatched = String(url || '').slice(0, 160);
      return;
    }
    const [, z, x, y] = m;
    t.n = (t.n || 0) + 1;
    t.z = t.z || {}; t.z[z] = (t.z[z] || 0) + 1;
    t.x = t.x || {}; t.x[x] = (t.x[x] || 0) + 1;
    t.y = t.y || {}; t.y[y] = (t.y[y] || 0) + 1;
    t.recent = t.recent || [];
    t.recent.push(z + '/' + x + '/' + y);
    if (t.recent.length > 60) t.recent.shift();
  } catch (e) { /* an instrument must never break the protocol */ }
}

export default traceOmUrl;
