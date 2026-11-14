/**
 * landMaskSource.js — give the ocean mask's GeoJSON source the land FILE, not the parsed land object (2026-11-13).
 *
 * WHY. OceanMask's GeoJSON source was given the parsed Natural Earth land OBJECT: the 2.7 MB 50 m file, or, once the map has
 * been zoomed past level 8, the 18 MB 10 m file. The map library copies that object to its worker on the main thread. With the
 * 10 m object, the one postMessage at the first marine toggle measured 274 ms on desktop and 1360 ms on a 4x-throttled phone,
 * after the library's own deep copy of it (docs/weather-program/log/2026-11-13-fable-land-source-url.md). A GeoJSON source
 * given a URL sends only the string; the worker fetches the file (the page has just loaded it: the HTTP cache) and parses it
 * there.
 *
 * WHEN IT APPLIES. Only when the mask IS the file: `tagLandMaskUrl` records the URL for a mask object only if building the
 * mask dropped no feature (the mask keeps polygons only, with empty properties; no mask layer reads a property). Anything
 * else (the last-resort remote fallback at mount, a mask of unknown origin) keeps the object, as before.
 * IF THE WORKER CANNOT LOAD THE FILE the source reports an error; `armLandSourceFallback` then hands it the object once, so
 * the land is never left unmasked.
 * Kill: window.__RAW_DISABLE_LAND_SOURCE_URL__ = true (the object, as before). Telemetry: window.__RAW_LAND_SOURCE__.
 */
const W = () => (typeof window !== 'undefined' ? window : {});
const URLS = new WeakMap();

export const landSourceUrlOn = () => W().__RAW_DISABLE_LAND_SOURCE_URL__ !== true;

function tel() {
  const w = W();
  if (!w.__RAW_LAND_SOURCE__) w.__RAW_LAND_SOURCE__ = { byUrl: 0, byObject: 0, fellBack: 0, lastUrl: null };
  return w.__RAW_LAND_SOURCE__;
}

/** Remember that `mask` holds exactly the features of the land file at `url`. Returns `mask` unchanged. */
export function tagLandMaskUrl(mask, landGeoJSON, url) {
  const same = !!mask && Array.isArray(mask.features) && Array.isArray(landGeoJSON?.features)
    && mask.features.length === landGeoJSON.features.length;
  if (same && typeof url === 'string' && url) URLS.set(mask, url);
  return mask;
}

/** What to pass as the source's `data`: the file's URL when the mask is that file and the kill is off, else the mask. */
export function landSourceData(mask) {
  const url = mask && landSourceUrlOn() ? URLS.get(mask) : null;
  const t = tel();
  if (url) { t.byUrl += 1; t.lastUrl = url; } else t.byObject += 1;
  return url || mask;
}

/**
 * After adding the source with a URL: if it reports an error before it has loaded, give it the object once.
 * A no-op when `data` was the object. Returns a function that disarms it.
 */
export function armLandSourceFallback(map, sourceId, mask, data) {
  if (!map || typeof data !== 'string' || typeof map.on !== 'function') return () => {};
  let done = false;
  const disarm = () => {
    if (done) return; done = true;
    try { map.off('error', onError); map.off('sourcedata', onData); } catch (e) { /* map gone */ }
  };
  function onError(e) {
    if (!e || e.sourceId !== sourceId) return;
    disarm(); tel().fellBack += 1;
    try { const src = map.getSource(sourceId); if (src && typeof src.setData === 'function') src.setData(mask); } catch (err) { /* source gone */ }
  }
  function onData(e) {
    if (e && e.sourceId === sourceId && e.sourceDataType === 'metadata') disarm();
  }
  map.on('error', onError); map.on('sourcedata', onData);
  return disarm;
}
