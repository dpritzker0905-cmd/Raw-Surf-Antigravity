/**
 * KEEP THE BETTER FINE OVERLAY (2026-10-09, owner: "on the current live dev I see light wind bar and L shaped artifacts
 * appearing near the coastline").
 *
 * The owner's log (light theme, z~8, Mobile Bay - Mississippi delta, the 21Z hurricane at landfall): the 0.25-deg 17x17
 * viewport product (-90..-86 / 28..32) covered the whole view, then a coarser 11x9 grid arrived for a nudged box and
 * commitWindData's CHOKE let it through ("non-covering grid passes as FINE OVERLAY over the resident global base"),
 * replacing the covering box; the two kept trading places. The 11x9 box's west and north edges (~89.5 W, ~30.5 N) then
 * sat INSIDE the view, and the engine's 0.6-deg feather blends from the fine grid to the 2-deg world base there. Around
 * a landfalling hurricane a 2-deg base is badly wrong (#293's lane fixtures: base 10 kn where the fine grid reads 40 kn;
 * its bilinear vectors also cancel between nodes on opposite sides of the storm), so the feather drew a light-blue
 * (3-10 kn) band along those two edges: the "L". Open-Meteo HRRR and GFS at 21Z put 12-20 kn on that land and 30-70 kn
 * on that water at the same nodes, so the band is the composite, not the weather.
 *
 * The CHOKE's rule ("a non-covering grid may never REPLACE a covering one") already guards the world base; this extends
 * it to the resident FINE overlay, with the same thresholds as the stale-covering resolution guard in this file's caller
 * (a resident box keeps the view while it shows >= 70% of it; a markedly finer grid, >= 1.5x, may still take over).
 * Kill: window.__RAW_DISABLE_WIND_OVERLAY_KEEP__ (the CHOKE passes every same-model+hour grid again).
 */
export const OVERLAY_KEEP = Object.freeze({ minCover: 0.7, finerBy: 1.5 });

const lngSpan = (b) => b.east - b.west;

/** Share of the viewport's lng x lat area that `bounds` covers (0..1); null for antimeridian-crossing boxes. */
export function viewCoverFrac(bounds, vp) {
  if (!bounds || !vp || bounds.west > bounds.east || vp.west > vp.east) return null;
  const w = Math.max(0, Math.min(bounds.east, vp.east) - Math.max(bounds.west, vp.west));
  const h = Math.max(0, Math.min(bounds.north, vp.north) - Math.max(bounds.south, vp.south));
  const area = Math.max(1e-9, (vp.east - vp.west) * (vp.north - vp.south));
  return Math.min(1, (w * h) / area);
}

/** Node spacing in degrees of longitude (a point-registered grid of `cols` columns). */
export function cellDeg(bounds, cols) {
  return lngSpan(bounds) / Math.max(1, (cols || 2) - 1);
}

/**
 * True when the incoming NON-covering grid should be dropped because the engine's resident fine overlay is the better
 * picture of this view: it still shows >= 70% of it, the incoming shows no more of it, and the incoming is not markedly
 * finer. `resident` is the engine's window.__WIND_FINE_OVERLAY__ ({ active, bounds, cols }).
 */
export function keepResidentFine(resident, incoming, vp, win = (typeof window !== 'undefined' ? window : null)) {
  if (win && win.__RAW_DISABLE_WIND_OVERLAY_KEEP__ === true) return false;
  if (!resident || !resident.active || !resident.bounds || !(resident.cols > 1) || !incoming || !incoming.bounds) return false;
  const rCover = viewCoverFrac(resident.bounds, vp), iCover = viewCoverFrac(incoming.bounds, vp);
  if (rCover == null || iCover == null) return false;
  if (rCover < OVERLAY_KEEP.minCover) return false;         // the resident has scrolled away: coverage wins
  if (iCover > rCover + 1e-6) return false;                  // the incoming shows more of this view
  const rCell = cellDeg(resident.bounds, resident.cols), iCell = cellDeg(incoming.bounds, incoming.cols);
  return !(iCell * OVERLAY_KEEP.finerBy <= rCell);           // keep, unless the incoming is >= 1.5x finer
}
