/**
 * staticWorldFillGuard.js: the world-box serve-time-fill guard of staticFrames.js, in its own module (2026-10-24: staticFrames.js
 * had reached the 800-line cap). Moved verbatim; staticFrames re-exports serveTimeFillAtWorld (the callers and tests import it
 * from there). Reads only window globals (__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__, __WEATHER_CAPABILITIES__).
 */

/**
 * A WORLD-span /grid (and /grid_series frame) of this set is NOT the stored product (2026-10-22): the route runs
 * coarse_gulf_fill.fill_coarse_enclosed_sea_from_gfs_served on EURO and ICON marine grids whose served span is 350 deg or more,
 * which includes the whole global_mid clip a world request gets. It rewrites every masked cell (land too) that has a valid GFS
 * coarse cell within 8 deg with GFS values (offline, the real function on a EURO global_mid with simulated land: 1,757 of 2,066
 * masked cells rewritten at world span; 0 on a 50-deg crop). A static frame of the stored product would differ there, so a world
 * box of these sets asks /grid; their viewport crops (span < 350, no fill) stay static. It lifts by itself when the server
 * reports the fill off for global_mid (MARINE_GULF_FILL_MID=0, the owner's call: serverFillsWorldMid), because /grid then serves
 * the stored world grid these frames encode.
 * Kill (serve these world boxes from frames anyway, the pre-fix behaviour): window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__ = true.
 */
export function serveTimeFillAtWorld(model, layer) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__ === true) return false;
  const m = String(model || 'GFS').toUpperCase();
  if (!((m === 'EURO' || m === 'ICON') && ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(String(layer || 'waves').toLowerCase()))) return false;
  return serverFillsWorldMid(m);
}

/**
 * Does the server still run the Gulf fill on this model's 2-deg world grid? /capabilities says so on its EURO/ICON marine rows
 * (`gulf_fill_mid`, from MARINE_GULF_FILL_MID; LayerAccessResolver keeps the matrix in window.__WEATHER_CAPABILITIES__). Only an
 * explicit `false` lifts the guard: not loaded yet, an older server without the field, or an unreadable matrix all keep it,
 * because then /grid may differ from the stored frame. Read per call, so a matrix that loads later takes effect at once.
 */
function serverFillsWorldMid(model) {
  try {
    const rows = typeof window !== 'undefined' ? window.__WEATHER_CAPABILITIES__ : null;
    if (!Array.isArray(rows)) return true;
    const row = rows.find((r) => r && String(r.domain).toLowerCase() === 'marine' && String(r.model).toUpperCase() === model
      && Object.prototype.hasOwnProperty.call(r, 'gulf_fill_mid'));
    return !row || row.gulf_fill_mid !== false;
  } catch (e) {
    return true;
  }
}
