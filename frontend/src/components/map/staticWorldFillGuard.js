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
 * THE FILLED WORLD SET (2026-10-24, backend services/frame_set_fill.py). While the box runs the TARGETED fill (D-050), the
 * publisher also writes `<model>/marine/<layer>/global_mid_filled`: the same stored products with /grid's own targeted fill
 * applied (same code, same-layer GFS 2-deg donor), stamped `fill_mode: 'targeted'` on its latest.json record. A world box of a
 * guarded set reads THAT set instead of asking /grid, only while /capabilities reports `gulf_fill_mid_mode: 'targeted'` for the
 * model AND the record says the same; anything else (legacy mode, an older server, a retired record, no latest.json yet) returns
 * null and the world box asks /grid as before. Crops never read it: /grid does not fill a viewport crop.
 * Kill (back to /grid for these world boxes): window.__RAW_DISABLE_STATIC_FILLED_WORLD__ = true.
 */
export function filledWorldSetKey(model, layer, latest) {
  if (!filledWorldPossible(model, layer)) return null;
  const key = `${String(model).toUpperCase()}/marine/${String(layer || 'waves').toLowerCase()}/global_mid_filled`;
  const rec = latest && latest.sets && latest.sets[key];
  return rec && rec.index && !rec.empty && rec.fill_mode === 'targeted' ? key : null;
}

/**
 * PRELOAD (2026-10-25, the lead: the cold first EURO click made two SERIAL CDN reads, the filled index and then its frame; offline
 * 1.3 s vs 0.9 s for today's /grid path). Once latest.json is read, start loading the WAVES index of each servable filled world set
 * (EURO, ICON), so a model switch finds it in memory and waits for the frame only. `load(path)` is staticFrames' cached index
 * loader (no pin: the scrub's pin rules are untouched); `enabled(key)` is its per-set kill. Returns the keys started. One index
 * read per set per run (the loader caches by content-addressed path). Kill: window.__RAW_DISABLE_FILLED_INDEX_PRELOAD__ = true.
 */
export function preloadFilledIndexes(latest, load, enabled = () => true) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_FILLED_INDEX_PRELOAD__ === true) return [];
  const started = [];
  for (const m of ['EURO', 'ICON']) {
    const key = filledWorldSetKey(m, 'waves', latest);
    if (!key || !enabled(key)) continue;
    try { Promise.resolve(load(latest.sets[key].index)).catch(() => {}); started.push(key); } catch (e) { /* never break a read */ }
  }
  return started;
}

/** Could a filled world set serve this guarded model x layer right now (not killed, the server in the targeted mode)? It does not
 *  look at latest.json: staticFrames uses it to decide whether that read is worth starting. */
export function filledWorldPossible(model, layer) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_STATIC_FILLED_WORLD__ === true) return false;
  const m = String(model || 'GFS').toUpperCase();
  return serveTimeFillAtWorld(m, layer) && serverFillModeOf(m) === 'targeted';
}

/** The 2-deg world fill mode /capabilities reports for this model (`gulf_fill_mid_mode`), or null when unknown. Per call. */
function serverFillModeOf(model) {
  try {
    const rows = typeof window !== 'undefined' ? window.__WEATHER_CAPABILITIES__ : null;
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => r && String(r.domain).toLowerCase() === 'marine' && String(r.model).toUpperCase() === model
      && typeof r.gulf_fill_mid_mode === 'string');
    return row ? row.gulf_fill_mid_mode : null;
  } catch (e) {
    return null;
  }
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
