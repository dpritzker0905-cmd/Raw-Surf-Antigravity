/**
 * decodedOmSampler (2026-07-11, temp-pair infobox v2): sample the CLIENT-DECODED om field at a
 * lat/lng — the same grids the raster slots render from (openMeteoProtocol postReadCallback
 * side-channel, window.__DECODED_OM_TILES__). Used for infobox values on layers the backend
 * point lanes don't carry (surface_temperature — SST is not in the atmospheric point API and
 * not on the marine point lane either).
 *
 * Display-consistent by construction: the ACTIVE slot's om:// URL names the exact model +
 * valid_times index being rendered, and the sampler reads the decode with that timeIndex — the
 * infobox always agrees with the field on screen (incl. the dwd_icon→gfs013 SST cross-fall,
 * which is baked into the slot URL by useOpenMeteoTileUrls' resolveModel).
 *
 * Grid orientation: row 0 = SOUTH (probed live 2026-07-11 with Sahara/Antarctica pairs on both
 * ncep_gfs013 and ecmwf_ifs025); bounds are [west, south, east, north]. NaN cells = the
 * ocean-fill landmask's deep interior (land) → null.
 */

const SLOT_URL_RE = /data_spatial\/([a-z0-9_]+)\/latest\.json\?time_step=valid_times_(\d+)/;

/** Resolve the model + timeIndex the layer is currently RENDERING from its slot ring. */
export function resolveDisplayedSlot(map, layerKey) {
  if (!map || !map.getSource) return null;
  let fallback = null;
  for (let s = 0; s < 3; s++) {
    try {
      const src = map.getSource(`${layerKey}-slot-${s}-source`);
      const url = src && src.url;
      if (!url || String(url).includes('transparent')) continue;
      const mm = String(url).match(SLOT_URL_RE);
      if (!mm) continue;
      const hit = { model: mm[1], timeIndex: +mm[2] };
      let isActive = false;
      try {
        const op = map.getPaintProperty(`${layerKey}-slot-${s}-layer`, 'raster-opacity');
        isActive = Array.isArray(op); // the active slot carries the zoom expression; inactive slots are 0
      } catch (e) { /* layer mid-mount */ }
      if (isActive) return hit;
      if (!fallback) fallback = hit;
    } catch (e) { /* source mid-mount */ }
  }
  return fallback;
}

/**
 * Sample a decoded om variable at lat/lng for the displayed slot. Returns the raw value (°C for
 * temperature fields) or null (no decode / out of bounds / NaN land interior).
 * `deps` is injectable for tests: { map, tiles } default to the window globals.
 */
export function sampleDecodedOmValue({ variable, layerKey, lat, lng }, deps = {}) {
  const map = deps.map !== undefined ? deps.map : (typeof window !== 'undefined' ? (window.map || window.__MAP_INSTANCE__) : null);
  const tiles = deps.tiles !== undefined ? deps.tiles : (typeof window !== 'undefined' ? window.__DECODED_OM_TILES__ : null);
  if (!tiles || typeof tiles.values !== 'function') return null;
  const slot = resolveDisplayedSlot(map, layerKey);
  let best = null;
  for (const t of tiles.values()) {
    if (!t || t.variable !== variable) continue;
    if (slot && t.model !== slot.model) continue;
    if (slot && t.timeIndex === slot.timeIndex) { best = t; break; }
    if (!best || (t.timestamp || 0) > (best.timestamp || 0)) best = t; // newest fallback
  }
  if (!best || !best.values || !best.nx || !best.ny || !best.bounds) return null;
  const [w, s, e, n] = best.bounds;
  if (!(e > w) || !(n > s)) return null;
  const fx = (lng - w) / (e - w);
  const fy = (lat - s) / (n - s); // row 0 = SOUTH
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  const ix = Math.min(best.nx - 1, Math.max(0, Math.round(fx * (best.nx - 1))));
  const iy = Math.min(best.ny - 1, Math.max(0, Math.round(fy * (best.ny - 1))));
  const v = best.values[iy * best.nx + ix];
  return (v === null || v === undefined || Number.isNaN(v)) ? null : v;
}
