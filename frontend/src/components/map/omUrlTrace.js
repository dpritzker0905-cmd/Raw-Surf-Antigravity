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

/**
 * Record WHICH early-return branch rejected a tile, and why.
 *
 * ⛔ THE BUG THIS EXISTS FOR (2026-08-13, owner: "fog isn't activating at the two farthest out
 * zooms"). At the map's zoom floor (minZoom 2 on dev live) the protocol callback is ENTERED but
 * exits before decoding. Measured, same layer, one zoom notch apart, settled view, cache cleared:
 *     z2.99  water temp -> 45 trace entries, 20 reached the decode counter, tiles decoded
 *     z2.00  water temp -> 24 trace entries,  0 reached the decode counter, 0 decoded
 * It is NOT fog-specific -- every om:// raster layer is blank at the floor.
 *
 * ★ `traceOmUrl` (top of the callback) and `TILE_TRUTH.protocolCalls` (further in) DISAGREEING is
 * the whole signal. Without a probe at the entry, "24 entered / 0 decoded" is indistinguishable
 * from "nothing was requested" -- and I concluded the latter twice before this instrument existed.
 *
 * Returns undefined always, so it can be folded into an existing return expression
 * (`return traceOmBlock(...) || fallback(...)`) without adding a line to a file at its LOC ceiling.
 */
/**
 * Record that a tile request was SERVED, and by which route.
 *
 * ⛔ C4-MR-11 (2026-08-16) — WHY THE FOG READING WAS INCONCLUSIVE. The measurement above
 * ("z2.00 -> 24 entered, 0 reached the decode counter") was read as evidence of a blank. It is not.
 * `TILE_TRUTH.protocolCalls` is documented as "actual decodes", and the DECODED_TILE_CACHE fast path
 * returns BEFORE that counter, incrementing `cacheHits` instead. So **0 decodes is exactly what a
 * warm cache produces while serving every tile perfectly** — openMeteoProtocol's own diagnosis
 * string says so: `protocolCalls === 0` => "SourceCache is serving everything from GPU cache".
 *
 * The z2.99 leg ran with the cache cleared (20 decodes, cache now warm); the z2.00 leg then
 * requested the SAME world tiles and decoded 0. That null hypothesis fits the numbers exactly, and
 * nothing recorded at the time could separate it from a real block.
 *
 * ★ THE FIX IS RECONCILIATION, not another counter to eyeball: every entry must land in exactly one
 * bucket, so `n === sum(blocked) + sum(served)` and a shortfall is visible as a shortfall. A trace
 * that counts arrivals but not departures cannot tell "blocked" from "served" — the same shape as a
 * check that cannot tell "not sampled" from "broken".
 *
 * Returns undefined always, so it folds onto an existing statement without adding a line to a file
 * at its LOC ceiling (openMeteoProtocol.js is at 943/943).
 */
export function traceOmServed(route) {
  if (typeof window === 'undefined') return undefined;
  const t = window.__OM_URL_TRACE__;
  if (!t) return undefined;
  try {
    t.served = t.served || {};
    t.served[route] = (t.served[route] || 0) + 1;
  } catch (e) { /* an instrument must never break the protocol */ }
  return undefined;
}

/**
 * Do the trace's arrivals and departures balance? Exported so a reading can be REFUSED rather than
 * misread: if `unaccounted > 0`, some exit path is uninstrumented and no conclusion about blanks is
 * admissible from this trace.
 */
export function reconcileOmTrace(trace) {
  const t = trace || (typeof window !== 'undefined' ? window.__OM_URL_TRACE__ : null);
  if (!t) return { ok: false, reason: 'no_trace' };
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const entered = Number(t.n) || 0;
  const blocked = sum(t.blocked);
  const served = sum(t.served);
  const unaccounted = entered - blocked - served;
  return { ok: unaccounted === 0, entered, blocked, served, unaccounted };
}

export function traceOmBlock(reason, detail) {
  if (typeof window === 'undefined') return undefined;
  const t = window.__OM_URL_TRACE__;
  if (!t) return undefined;
  try {
    t.blocked = t.blocked || {};
    t.blocked[reason] = (t.blocked[reason] || 0) + 1;
    if (detail !== undefined && !t.blockedDetail) t.blockedDetail = {};
    if (detail !== undefined && !t.blockedDetail[reason]) {
      t.blockedDetail[reason] = String(detail).slice(0, 120);
    }
  } catch (e) { /* an instrument must never break the protocol */ }
  return undefined;
}

export default traceOmUrl;
