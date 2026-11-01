/**
 * rasterFrameSwap.js: how the six Open-Meteo raster layers (rain, satellite, pressure, temperature, water temp, fog) swap
 * hours on screen. The three map slots per layer (useOpenMeteoTileUrls + MapWebGL.openMeteoRasterSlots) are a frame cache of
 * three: the shown hour, the hour before it, and ONE neighbour preloaded in the scrub's direction.
 *
 * Measured before (raster lab, 2026-10-22, dev 6a03c442a; 96 combos, docs/weather-program/log/2026-10-22-raster-instant.md):
 *  - every slot flip CROSS-FADED for MapLibre's default 300 ms raster-opacity transition: 9-12 frames with two hours lit;
 *    temperature / water temp also faded each new tile in over 200 ms (a patchwork of hours);
 *  - the neighbour was chosen by the PARITY of the time index (even -> next, odd -> previous), so scrubbing forward hit it on
 *    every other step only (125-165 ms) and loaded cold on the rest (1-5 s);
 *  - a resident neighbour still waited a 50 ms timer and an animation frame before the flip.
 * Now:
 *  - HARD CUT: raster-opacity-transition 0 and raster-fade-duration 0 on the slots (one hour on screen per frame).
 *    Kill: window.__RAW_DISABLE_RASTER_HARD_CUT__ = true (the 300 ms cross-fade and the per-layer tile fades, as before).
 *  - DIRECTIONAL NEIGHBOUR: the third slot preloads one step in the direction of the last step (forward by default). Same
 *    one-hour lookahead and request count as before. Kill: window.__RAW_DISABLE_RASTER_DIRECTIONAL_NEIGHBOUR__ = true.
 *  - INSTANT FLIP: when the asked-for hour is already loaded in a slot, it is shown in the same React commit as the URL
 *    update. A slot counts as loaded only with tiles in view: MapLibre reports a source no visible layer uses as loaded with
 *    no tiles, and a hidden slot must never be flipped to on that. Kill: window.__RAW_DISABLE_RASTER_INSTANT_FLIP__ = true.
 *  - RETAIN ON TOGGLE OFF: a layer switched off keeps its slots (hidden by layout visibility), so switching it back on at the
 *    same hour, model and theme shows the kept frame at once. If the hour changed meanwhile, nothing of the layer is shown
 *    until the new hour is ready (never the old hour under the new label).
 *    Kill: window.__RAW_DISABLE_RASTER_TOGGLE_RETAIN__ = true (slots reset to transparent on toggle off, as before).
 * Telemetry: window.__RAW_RASTER_FRAME_SWAP__.
 */
const W = () => (typeof window !== 'undefined' ? window : {});
const TRANSPARENT = 'om://transparent-tile';
export const hardCutOn = () => W().__RAW_DISABLE_RASTER_HARD_CUT__ !== true;
export const directionalOn = () => W().__RAW_DISABLE_RASTER_DIRECTIONAL_NEIGHBOUR__ !== true;
export const instantFlipOn = () => W().__RAW_DISABLE_RASTER_INSTANT_FLIP__ !== true;
export const retainOn = () => W().__RAW_DISABLE_RASTER_TOGGLE_RETAIN__ !== true;
/** activeSlots value that shows no slot of a layer (a re-toggled layer whose kept hour is not the asked one). */
export const NO_SLOT = -1;

function tel() {
  const w = W();
  if (!w.__RAW_RASTER_FRAME_SWAP__) w.__RAW_RASTER_FRAME_SWAP__ = { instantFlips: 0, heldHidden: 0, retained: 0, neighbours: {} };
  return w.__RAW_RASTER_FRAME_SWAP__;
}

/** Paint timing of one slot layer. `legacyFadeMs` is today's per-layer tile fade; an explicit __RAW_RASTER_FADE_MS__ wins. */
export function slotTiming(legacyFadeMs, fadeOverridden = false) {
  if (!hardCutOn()) return { 'raster-fade-duration': legacyFadeMs };
  return { 'raster-fade-duration': fadeOverridden ? legacyFadeMs : 0, 'raster-opacity-transition': { duration: 0, delay: 0 } };
}

/** The time index an om:// slot URL names, or null. */
export function slotIndexOf(url) {
  const m = typeof url === 'string' ? url.match(/time_step=valid_times_(\d+)/) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Index to preload into the third slot. `prevIdx` = the index the shown slot holds (the hour before this step); `dirs` keeps
 * each layer's last direction so a re-resolve at the same hour keeps preloading the same way.
 */
export function neighbourIndex(closestIdx, totalLen, prevIdx, dirs, layerKey) {
  if (!directionalOn()) {
    const prev = closestIdx - 1; const next = closestIdx + 1;
    return closestIdx % 2 === 0 ? (next < totalLen ? next : prev) : (prev >= 0 ? prev : next);
  }
  let dir = (dirs && dirs[layerKey]) || 1;
  if (Number.isFinite(prevIdx) && prevIdx !== closestIdx) dir = closestIdx > prevIdx ? 1 : -1;
  if (dirs) dirs[layerKey] = dir;
  let idx = closestIdx + dir;
  if (idx < 0 || idx >= totalLen) idx = closestIdx - dir;   // at an end of the axis, the other side
  const t = tel(); t.neighbours[layerKey] = { idx, dir };
  return idx;
}

/** Every in-view tile of the source loaded, and at least one tile in view (MapLibre 5 internals; absent -> loaded alone). */
export function sourceReady(map, sourceId) {
  try {
    if (!map || !map.getSource(sourceId) || map.isSourceLoaded(sourceId) !== true) return false;
    const tm = map.style && map.style.tileManagers && map.style.tileManagers[sourceId];
    const tiles = tm && tm._inViewTiles && typeof tm._inViewTiles.getAllTiles === 'function' ? tm._inViewTiles.getAllTiles() : null;
    return tiles === null || tiles.length > 0;
  } catch (e) { return false; }
}

/**
 * Is this slot's source showing `url` with every in-view tile loaded (and at least one tile in view)?
 * Also requires the source's TILE TEMPLATE to belong to `url` (the om TileJSON's tiles are `${url}/{z}/{x}/{y}`). MapLibre 5.24
 * marks a raster source loaded when an in-flight TileJSON request is aborted, and setUrl aborts the previous URL's request
 * AFTER the new load cleared the flag: the slot then reads "loaded" with the OLD tiles and template under the new URL until
 * the new TileJSON lands. Measured 2026-10-22 (raster lab, P1 build): long jumps that re-pointed a still-loading neighbour
 * slot flipped in ~100 ms to an older hour's tiles under the new label (silent stale), then reloaded ~1 s later.
 */
export function slotReady(map, sourceId, url) {
  try {
    const src = map && map.getSource(sourceId);
    if (!src || src.url !== url) return false;
    if (!instantFlipOn()) return map.isSourceLoaded(sourceId) === true;   // the old check exactly
    const tpl = Array.isArray(src.tiles) ? src.tiles[0] : null;
    if (typeof tpl === 'string' && !tpl.startsWith(url)) return false;
    return sourceReady(map, sourceId);
  } catch (e) { return false; }
}

/** A layer just switched off: keep its slots (their URLs stay in state) and its shown slot. Null = reset as before. */
export function retainedActiveSlot(urls, layerKey, activeSlot) {
  if (!retainOn() || !urls) return null;
  const real = [0, 1, 2].some((s) => { const u = urls[`${layerKey}-slot-${s}`]; return u && u !== TRANSPARENT; });
  if (!real) return null;
  tel().retained += 1;
  return Number.isInteger(activeSlot) ? activeSlot : 0;
}

/**
 * The slot to show NOW for an active layer, decided in the same commit as its URLs, or null to leave it to the transition
 * audit. `reactivated`: the layer was off and kept its slots.
 */
export function planFlip({ map, layerKey, targetSlot, targetUrl, currentActiveSlot, currentUrls, reactivated }) {
  const shownUrl = Number.isInteger(currentActiveSlot) && currentActiveSlot >= 0 ? currentUrls[`${layerKey}-slot-${currentActiveSlot}`] : null;
  const resident = currentUrls[`${layerKey}-slot-${targetSlot}`] === targetUrl;
  if (instantFlipOn() && resident && currentActiveSlot !== targetSlot && slotReady(map, `${layerKey}-slot-${targetSlot}-source`, targetUrl)) {
    tel().instantFlips += 1;
    return targetSlot;
  }
  if (reactivated && retainOn() && shownUrl !== targetUrl) { tel().heldHidden += 1; return NO_SLOT; }
  return null;
}
