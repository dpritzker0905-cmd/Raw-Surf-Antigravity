/**
 * marineBboxGeometry.js - the REQUEST BOX: stateless bbox geometry for the marine series lane.
 *
 * Extracted verbatim from `marineGridSeries.js` on 2026-08-04 because that file crossed the 800-LOC
 * ratchet (892). This block is the natural seam: pure geometry, no module state, no I/O, no cache -
 * everything else in `marineGridSeries` closes over `_seriesCache` / `_inFlight` / timers.
 *
 * NOTHING WAS REWRITTEN. Every line below is byte-identical to what it replaced, including the
 * rationale comments - they are the record of two expensive, separately-diagnosed defects (a
 * normalised cache key against an un-normalised URL costing 33x bandwidth, and a plain rectangle
 * containment test that could never clear `coverageBroken` across the antimeridian). Deleting that
 * rationale to satisfy a line count is how both defects would come back.
 *
 * Guarded by `marineGridSeries.antimeridian.test.js` and `marineGridSeries.coverage.test.js`, which
 * import these symbols directly - the safety net moved with the code.
 */

// Pad a REGIONAL request bbox outward by ~0.5° so the backend's degree-snapped tile reliably CONTAINS the
// viewport — and any sub-cell pan that maps to the SAME 0.5° viewportKey. Without this, a viewport whose edge
// sits just outside the served tile (live 2026-06-28: viewport south 27.96 vs served tile south 28.0) fails
// getMarineSeriesFrame's strict bboxContains → found:false → the heatmap stays CLAMPED until the 5-min TTL
// expires, because the TTL dedup refuses to re-fetch a tile that would contain it. Proven by curl: the padded
// request returns a tile that contains the unpadded viewport. Only pads comfortably-regional spans so padding
// can never push a near-15° viewport over the backend's wide/global-coarse threshold. Latitude clamped.
export const SERIES_BBOX_PAD_DEG = 0.5;
export function padRegionalBbox(b) {
  if (!b) return b;
  const spanLng = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
  const spanLat = Math.abs(b.north - b.south);
  if (spanLng >= 12 || spanLat >= 12) return b;   // wide/near-wide: leave alone (avoid the 15° threshold)
  const p = SERIES_BBOX_PAD_DEG;
  return {
    west: b.west - p,
    east: b.east + p,
    south: Math.max(-89.5, b.south - p),
    north: Math.min(89.5, b.north + p),
  };
}

// ── THE REQUEST BOX (audit v7 §2a, 2026-08-03) ────────────────────────────────────────────────
// THE KEY WAS NORMALISED AND THE URL WAS NOT. `viewportKey` above wraps longitude into [-180,180)
// and collapses every span > 15° to the single key 'global'; the URL builders below sent the RAW
// `bounds` straight from MapLibre's getBounds(), which legitimately returns west < -180 on a wide
// low-zoom viewport. Measured live against production, 48 frames, span held at 183°:
//
//     west = -180.0   ->   1,300,516 B   1.9 s   19x9    served bounds == request
//     west = -180.5   ->  42,589,599 B  28.4 s   104x54  served bounds inflated + CROSSING
//
// A STEP FUNCTION AT EXACTLY -180: 0.5° of longitude costs 33x the bytes and 24x the time (repeat-
// verified, so not cache warming). The backend wraps each edge INDEPENDENTLY (route_helpers.py
// clamp_and_normalize_bbox), so w=-199.4/e=-16.0 becomes west=160.6 > east=-16.0 — an antimeridian-
// CROSSING box, which no precomputed rectangular product can cover. Selection misses and the
// fallback builds a dynamic grid at NATIVE resolution over an inflated box, x48 frames: 272,160
// vectors == 334 MB of Python objects == 2.27x the whole serve box's vector budget, per request.
// That is the same event as the OOM.
//
// ★ WIDE VIEWPORTS REQUEST THE CANONICAL WORLD BOX. This is not a new policy — it is the one
//   `viewportKey` has always asserted. Every span > 15° ALREADY shares one cache entry, so today
//   whichever wide viewport fetched first serves all the others (04110e1c measured exactly that:
//   "a global view over Portugal hit the series warmed over Florida"). Resolution at wide zoom is
//   already a lottery; this makes it deterministic, and picks the cheapest, most covering member:
//   the world box measured 2,200,343 B / 2.0 s — the CHEAPEST request in the system, and it
//   contains every viewport by construction, so bboxContains can never break on it (its >=340°
//   width also earns the permanent TTL skip in loadSeriesPage).
// ★ It makes 04110e1c's prewarm ACTUALLY LAND: the prewarm requests _GLOBAL_BOUNDS and the gesture
//   now requests the identical box, so they stop fighting over one key. The "first zoom-out is slow,
//   then it improves" report is that race, not cache warming.
// ★ NARROW viewports keep their own box and are only longitude-normalised — a genuinely regional
//   crossing viewport (Fiji, NZ) must NOT be widened to the world; bboxContains handles those.
// Kill: window.__RAW_DISABLE_BBOX_NORM__ = true  (restores the raw pre-v7 box exactly).
export const GLOBAL_REQUEST_BBOX = { west: -180, south: -80, east: 180, north: 85 };
const _normLng = (lng) => (((lng + 180) % 360) + 360) % 360 - 180;   // same expression as viewportKey
export function normalizeRequestBbox(b) {
  if (!b) return b;
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_BBOX_NORM__ === true) return b;
  const w = _normLng(b.west);
  const e = _normLng(b.east);
  // Crossing-aware width, computed on the NORMALISED edges — the raw ones can be outside [-180,180)
  // and a plain (east - west) reads 183° as -183° or 543° depending on which side wrapped.
  const spanLng = (e < w) ? (e + 360) - w : e - w;
  const spanLat = Math.abs(b.north - b.south);
  // Same 15° threshold as viewportKey, so the request box and the cache key can never disagree.
  if (spanLng > 15.0 || spanLat > 15.0) return { ...GLOBAL_REQUEST_BBOX };
  return { west: w, south: b.south, east: e, north: b.north };
}

// True if `outer` bbox fully contains `inner`. No antimeridian handling — series bboxes don't
// cross it in practice; a wrap case just fails containment and falls through to exact/miss.
// ANTIMERIDIAN (audit v7 §2b, 2026-08-03). This was a plain rectangle test living in a file where
// ELEVEN sibling call sites already carry the `(east < west) ? east+360-west : east-west` crossing
// idiom, and twenty files across the map tree carry it. The one function that decides whether to
// RE-FETCH was the one that did not — so for a served crossing tile {west:148, east:-4} against a
// viewport {west:-199.4, east:-16.0} the test asked `148 <= -199.4`, answered false, and
// loadSeriesPage's `coverageBroken` (:378 region) could NEVER clear. The TTL dedup was bypassed on
// every single gesture and the client re-fetched the same 43 MB page forever. That is the observed
// repeat of one identical URL in the owner's console log.
//
// Longitude is CYCLIC, so containment is "does inner's arc lie inside outer's arc", not "<=". Both
// arcs are measured from `outer.west` going east; inner is contained iff its own offset plus its
// width fits inside outer's width. Latitude stays a plain interval — it does not wrap.
// Exported for its OWN guard: driving this through ensureMarineSeries' cache-key machinery could
// not discriminate a correct implementation from the broken one (both viewports that share a
// 0.5°-snapped key are on the same side of the antimeridian), and a first draft of that test
// passed with the fix reverted. The logic is real; it gets a real unit guard.
export function bboxContains(outer, inner) {
  if (!outer || !inner) return false;
  if (!(outer.south <= inner.south && outer.north >= inner.north)) return false;
  const arc = (west, east) => ((east < west) ? (east + 360) - west : east - west);
  const outerW = arc(outer.west, outer.east);
  if (outerW >= 360) return true;                       // whole-world outer contains every arc
  const innerW = arc(inner.west, inner.east);
  // Offset of inner's west from outer's west, walking east, normalised into [0,360).
  const offset = (((inner.west - outer.west) % 360) + 360) % 360;
  return offset + innerW <= outerW + 1e-9;
}
