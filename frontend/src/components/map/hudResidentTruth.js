// The HUD's "Class" must describe the grid the engine HOLDS (what the heatmap and particles draw), not the grid the fetch
// layer last handed up. 2026-11-07, cold GFS swell_2 press: the engine kept the 0.25 deg regional resident and refused the 2 deg
// world grid (no-downgrade, stashed for self-heal), but the fetch state and __MARINE_PROJECTION_DIAG__ carried the world grid,
// so the HUD said "COARSE 2 deg GRID" over a regional draw. Kill: window.__RAW_DISABLE_HUD_RESIDENT_TRUTH__ = true.
function cellDeg(g) {
  if (!g || !g.bounds || !(g.cols > 1)) return null;
  const b = g.bounds;
  const span = b.east < b.west ? b.east + 360 - b.west : b.east - b.west;
  return span > 0 ? span / (g.cols - 1) : null;
}

/** The engine-resident cell size (deg, 2 dp) when it differs from the offered grid's, else null (use the offered one). */
export function residentResolutionDeg(win, offeredGrid) {
  try {
    if (!win || win.__RAW_DISABLE_HUD_RESIDENT_TRUTH__ === true) return null;
    const res = win.__MARINE_ENGINE__ && win.__MARINE_ENGINE__._waveData && win.__MARINE_ENGINE__._waveData.waveGrid;
    if (!res || !offeredGrid || res === offeredGrid) return null;
    if (res.__componentLayer && offeredGrid.__componentLayer && res.__componentLayer !== offeredGrid.__componentLayer) return null;
    const rc = cellDeg(res);
    const oc = cellDeg(offeredGrid);
    if (rc === null || (oc !== null && Math.abs(rc - oc) < 0.01)) return null;
    return Math.round(rc * 100) / 100;
  } catch (e) { return null; }
}
