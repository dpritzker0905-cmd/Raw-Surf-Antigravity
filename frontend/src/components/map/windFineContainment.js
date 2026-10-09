// windFineContainment.js
// WIND FINE-TIER CONTAINMENT + CACHE LIFETIME (2026-10-08 wind zoom audit; windFineContainment.test.js).
//
// fetchWindData's containment fallback returned ANY cached grid whose bounds contained the request,
// skipping only world-span ones for `wind_viewport_fine_*` tiles. A 190-deg clip of the 2-deg global_mid
// (cached while zoomed out) therefore answered every deeper fine request for its 10-minute TTL: no fine
// fetch was made, and GFS / EURO / ICON wind stayed 2-deg at every zoom. A containing grid may now answer
// a fine request only if its cells are no coarser than what the fine tier would serve for that span.
// Kill: window.__RAW_DISABLE_WIND_FINE_CONTAIN_GUARD__ = true (the old bounds-only rule).

// Mirror of backend route_helpers.choose_adaptive_resolution (wind prices viewport products at 400 points).
const RES_STEPS = [0.25, 0.5, 1.0, 2.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0];
export function chooseAdaptiveResolution(spanLng, spanLat, targetPoints = 400) {
  const est = Math.sqrt((spanLng * spanLat) / targetPoints);
  for (const step of RES_STEPS) if (est <= step) return step;
  return 45.0;
}

const lngArc = (b) => (b.east < b.west ? (b.east + 360) - b.west : b.east - b.west);

/** Grid-point spacing in degrees on the coarser axis, or NaN without a usable grid. */
export function windGridCellDeg(grid) {
  const b = grid && grid.bounds;
  if (!b || !(grid.cols > 1) || !(grid.rows > 1)) return NaN;
  return Math.max(lngArc(b) / (grid.cols - 1), (b.north - b.south) / (grid.rows - 1));
}

// 10% slack so a product at exactly the tier's own resolution (snap rounding) still counts.
const FINE_ENOUGH_SLACK = 1.1;

/** True when cached `grid` is fine enough to stand in for a fine-tier request of `requestBbox`. */
export function fineContainmentAcceptable(grid, requestBbox) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_FINE_CONTAIN_GUARD__ === true) return true;
  const cell = windGridCellDeg(grid);
  if (!Number.isFinite(cell) || !requestBbox) return false;
  const tierCell = chooseAdaptiveResolution(lngArc(requestBbox), Math.abs(requestBbox.north - requestBbox.south));
  return cell <= tierCell * FINE_ENOUGH_SLACK;
}

// A mid-tier answer the backend is still sharpening (staleReason 'swr_revalidation_pending') is replaced
// on the next refresh rather than held for the 2-minute stale lifetime.
const TTL_FRESH_MS = 10 * 60 * 1000;
const TTL_STALE_MS = 2 * 60 * 1000;
const TTL_SHARPENING_MS = 15 * 1000;
export function windCacheTtlMs(entry) {
  const d = entry && entry.data;
  if (!d || !d.stale) return TTL_FRESH_MS;
  return d.staleReason === 'swr_revalidation_pending' ? TTL_SHARPENING_MS : TTL_STALE_MS;
}

// DATELINE (2026-10-08 live test, the "solid line in the Pacific"): map.getBounds() reports UNWRAPPED
// longitudes across +-180 (west -257, east -99.6 at z2), and the wind tier only treated west > east as
// crossing — it requested a fine box clamped at -180 whose edge sat on the dateline mid-screen. Normalise
// first: a view wholly beyond +-180 shifts by 360 (keeps its fine box); a view that straddles the dateline
// comes back in wrapped form (west > east), which the tier already serves with the global product.
export function windDatelineNormalize(west, east) {
  if (!Number.isFinite(west) || !Number.isFinite(east)) return { west, east };
  if (east - west >= 360) return { west: -180, east: 180 };
  let w = west, e = east;
  while (e < -180) { w += 360; e += 360; }
  while (w > 180) { w -= 360; e -= 360; }
  if (w < -180) w += 360;          // straddles -180
  else if (e > 180) e -= 360;      // straddles +180
  return { west: w, east: e };
}
