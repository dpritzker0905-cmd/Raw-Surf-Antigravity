/**
 * staticRatingFrames.js — the Surf Rating band from RATED static frames instead of /grid?surf=1 (2026-11-01, item 10). DARK.
 *
 * WHY: turning the band ON asked the 1-CPU box for /grid?surf=1 (4.4 s live; one burst took it to 1,056 MB): the rating is a
 * serve-time transform of the stored product. The publisher now rates every stored 2-deg world product in CI through the served
 * function itself (backend/services/frame_set_rating.py -> grid_resolver_surf.apply_surf_overlay) and publishes it as the set
 * `<model>/marine/<layer>/global_mid_rated`: the stored product's four planes plus a RATING plane, which
 * staticFrameCodec.buildVectors turns back into the exact vectors /grid?surf=1 serves.
 *
 * WHAT IT SERVES (seam A only): (1) inside a GFS pilot box, the box's RATED regional bundle (`<model>/marine/<layer>/<region>_rated`,
 * 0.25 deg: the grid the band PAINTS from; marineRatingBandRes holds 1-deg-and-coarser rating grids) through the regional seam, only while
 * /capabilities reports `regional_tile_first_surf` (MARINE_REGIONAL_TILE_FIRST_SURF=1: /grid?surf=1 rates the same stored tile);
 * (2) a CROP box /grid would answer from the global_mid tier (staticFrameCrop.midCropRulesPass), minus
 * the surf-only regional preference (product_selection.pick_surf_regional_override: a request <= 15 deg either way that overlaps a
 * regional tile gets the tile), at an ask the frame was rated for (`ask_offsets_h`: the wind products and gate confirmations the
 * rating read are the same as at the frame's own hour). Everything else asks /grid as before: world boxes (the box serves the honest
 * field there), z7-9 regional tiles, any ask outside the offsets, an unbuilt hour, the series lane (/grid_series).
 *
 * ON BY DEFAULT (the owner, 2026-11-01 22:10 EST, D-057: "start it automatically running ... if we don't like it, we kill switch
 * it"). The band's inputs are read once per publish (the gate's spot confirmations, the size climatology) while Render re-reads them
 * every 300-600 s, so a CDN band can lag the box by up to one republish; the owner accepted that with the kill switch:
 *   KILL (wins over all): window.__RAW_DISABLE_RATING_FRAMES__ = true; this browser: localStorage '__RAW_RATING_FRAMES__' = '0';
 *   a build: REACT_APP_RATING_FRAMES=false. The static-frames kills apply too.
 * Telemetry: window.__RAW_STATIC_FRAMES_RATED__ (hits, misses by reason).
 */
import { gridJsonFromFrame, pickIndexFrame, ratingCounts } from './staticFrameCodec';
import { cropGridJson, cropVectors, gridBboxParam, midCropFor, midCropRulesPass, parseBboxString } from './staticFrameCrop';
import { getAvailableTilesFromManifest } from './backendWeatherServiceClientCoverage';
import { buildTruthTag } from './weatherTruthTracker';
import { pickRegionalTile } from './staticRegional';

export const RATED_TIER = 'global_mid_rated';
// The publisher's frame_set_rating.RATED_LAYERS (the world sets the band can be asked of).
export const RATED_SET_KEYS = [
  'GFS/marine/waves', 'ICON/marine/waves', 'EURO/marine/waves', 'GFS/marine/swell_1', 'GFS/marine/swell_2',
  'GFS/marine/wind_waves', 'ICON/marine/swell_1', 'ICON/marine/wind_waves',
].map((k) => `${k}/${RATED_TIER}`);
const WORLD_MIN_SPAN = 340;           // staticFrames' world box (the box keeps the honest field there: span >= 350 is not rated)
const SURF_REGIONAL_MAX_SPAN = 15.5;  // product_selection.pick_surf_regional_override's 15 deg, plus margin (refusing is safe)
const HOUR_MS = 3600000;
export const RATED_SUFFIX = '_rated';

/** /capabilities' GFS marine row says surf asks are rated on the stored pilot tile (MARINE_REGIONAL_TILE_FIRST_SURF). Per call. */
export function serverTileFirstSurf() {
  try {
    const rows = typeof window !== 'undefined' ? window.__WEATHER_CAPABILITIES__ : null;
    return Array.isArray(rows) && rows.some((r) => r && String(r.domain).toLowerCase() === 'marine'
      && String(r.model).toUpperCase() === 'GFS' && r.regional_tile_first_surf === true);
  } catch (e) { return false; }
}

/** The pilot tile this surf ask's RATED bundle is (staticRegional.pickRegionalTile, key + '_rated'), or null. No I/O. */
export function ratedRegionalTile({ model, layer, bboxStr }) {
  if (!serverTileFirstSurf()) return null;
  // GFS only: pickRegionalTile also returns EURO / ICON tiles (D-059), but /grid?surf=1 rates on the stored tile only for GFS
  // (regional_tile_first.eligible) and the publisher bakes rated bundles for GFS alone (frame_set_rating.rated_regional_sets).
  if (String(model || 'GFS').toUpperCase() !== 'GFS') return null;
  const tile = pickRegionalTile({ model, layer, bboxStr });
  return tile ? { ...tile, key: tile.key + RATED_SUFFIX } : null;
}
export const isRatedKey = (key) => String(key || '').endsWith(RATED_SUFFIX);

export const ratedSetKey = (model, layer) => `${(model || 'GFS').toUpperCase()}/marine/${(layer || 'waves').toLowerCase()}/${RATED_TIER}`;

/** Is the rated path on for this page? Kill first, then this browser's choice, then the build. Default ON (D-057). */
export function ratingFramesOn() {
  if (typeof window === 'undefined' || window.__RAW_DISABLE_RATING_FRAMES__ === true) return false;
  if (window.__RAW_RATING_FRAMES__ === true) return true;
  try {
    const choice = window.localStorage && window.localStorage.getItem('__RAW_RATING_FRAMES__');
    if (choice === '0' || choice === 'false') return false;
    if (choice === '1' || choice === 'true') return true;
  } catch (e) { /* blocked */ }
  try { return process.env.REACT_APP_RATING_FRAMES !== 'false'; } catch (e) { return true; }
}

function telemetry() {
  if (typeof window === 'undefined') return { hits: 0, misses: {} };
  if (!window.__RAW_STATIC_FRAMES_RATED__) window.__RAW_STATIC_FRAMES_RATED__ = { hits: 0, misses: {}, last: null };
  return window.__RAW_STATIC_FRAMES_RATED__;
}
function noteMiss(reason) {
  const t = telemetry();
  t.misses[reason] = (t.misses[reason] || 0) + 1;
  t.last = { miss: reason, at: Date.now() };
  return null;
}

const spanOf = (b) => (b ? ((b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west) : 0);

/** Could /grid?surf=1 answer this box from a REGIONAL tile instead of global_mid (pick_surf_regional_override)? True = refuse. */
export function surfRegionalMayWin({ model, layer, bboxStr }) {
  const req = parseBboxString(bboxStr);
  if (!req) return true;
  const [w, s, e, n] = req;
  if (e - w > SURF_REGIONAL_MAX_SPAN || n - s > SURF_REGIONAL_MAX_SPAN) return false;   // a wide view: no override
  const { tiles, fallbackReason } = getAvailableTilesFromManifest(model, 'marine', layer);
  if (fallbackReason || !Array.isArray(tiles)) return true;
  return tiles.some((tile) => {
    const c = tile && tile.bounds;
    if (!c || ![c.west, c.south, c.east, c.north].every(Number.isFinite)) return true;
    const tLng = c.west <= c.east ? c.east - c.west : (180 - c.west) + (c.east + 180);
    if (tLng >= 350.0) return false;                                       // a world product
    if (c.west > c.east) return true;                                      // a wrapping tile: refuse
    return Math.min(e, c.east) > Math.max(w, c.west) && Math.min(n, c.north) > Math.max(s, c.south);
  });
}

/** Does a surf ask for this box get a rated frame at all? Cheap, no I/O. `setEnabled` = staticFrames.staticSetEnabled. */
export function ratedCropEligible({ model, layer, bbox }, setEnabled) {
  if (!ratingFramesOn() || !bbox || spanOf(bbox) >= WORLD_MIN_SPAN) return false;
  const bboxStr = gridBboxParam(bbox);
  const tile = ratedRegionalTile({ model, layer, bboxStr });
  if (tile) return setEnabled(tile.key);                      // z7-9 in a pilot box: its rated bundle (or /grid), never the world set
  if (!setEnabled(ratedSetKey(model, layer))) return false;
  return midCropRulesPass({ model, layer, bboxStr }) && !surfRegionalMayWin({ model, layer, bboxStr });
}

/** The frame answers this ask: the ask sits a whole number of hours from its valid time, in the frame's `ask_offsets_h`. */
export function askOffsetServed(index, frame, askMs) {
  const meta = { ...((index && index.common_meta) || {}), ...((frame && frame.meta) || {}) };
  const offsets = meta.ask_offsets_h;
  const off = (askMs - Date.parse(frame.valid_time)) / HOUR_MS;
  return Array.isArray(offsets) && Number.isInteger(off) && offsets.includes(off);
}

/**
 * Seam A for a surf ask: the /grid?surf=1 JSON for a crop box from the pinned rated frame, or null (the caller asks /grid).
 * `d` = staticFrames' loaders { getPinnedIndex, loadFrameVectors, regionalGrid(tile) } (passed in: staticFrames imports this
 * module; regionalGrid is its regional seam, which crops the bundle exactly as it does for the plain bundles).
 */
export async function tryStaticRatedGrid({ model, layer, validTimeStr, clampedBbox, signal }, d) {
  const tile = ratedRegionalTile({ model, layer, bboxStr: gridBboxParam(clampedBbox) });
  if (tile) return tryRatedRegional(tile, validTimeStr, d);
  const key = ratedSetKey(model, layer);
  try {
    const index = await d.getPinnedIndex(key);
    if (!index) return noteMiss('no_index');
    const askMs = Date.parse(validTimeStr);
    const frame = pickIndexFrame(index, askMs);
    if (!frame) return noteMiss('no_frame_in_window');
    if (!frame.path) return noteMiss('unbuilt_frame');                  // the publisher refused it: /grid rates this hour
    if (!askOffsetServed(index, frame, askMs)) return noteMiss('ask_offset');
    const grid = frame.grid || index.grid;
    const win = midCropFor({ model, layer, bboxStr: gridBboxParam(clampedBbox), grid });
    if (!win) return noteMiss('crop_unmirrored');
    const vectors = await d.loadFrameVectors(key, frame, signal, { priority: 'high' });
    if (!vectors) return noteMiss('frame_load');
    const cropped = cropVectors(vectors, grid.cols, win);
    const json = cropGridJson(gridJsonFromFrame(index, frame, vectors, { askIso: validTimeStr, requestedBbox: clampedBbox }), win, cropped);
    stampOverlay(json, cropped, key, frame, validTimeStr);
    try { json.truthTag = buildTruthTag(json, 'staticFrame'); } catch (e) { json.truthTag = null; }
    return json;
  } catch (e) {
    return noteMiss('error');
  }
}

function stampOverlay(json, cropped, key, frame, validTimeStr) {
  const diag = json.grid.diagnostics;
  diag.surf_transform = { ...ratingCounts(cropped), ...(diag.surf_transform || {}) };   // the overlay's per-box counts
  const t = telemetry();
  t.hits += 1;
  t.last = { hit: key, valid_time: frame.valid_time, ask: validTimeStr, at: Date.now() };
}

/** A pilot-box surf ask from its rated bundle: the frame must be built and rated for this ask, then the regional seam crops it. */
async function tryRatedRegional(tile, validTimeStr, d) {
  try {
    const index = await d.getPinnedIndex(tile.key);
    if (!index) return noteMiss('regional_no_index');
    const askMs = Date.parse(validTimeStr);
    const frame = pickIndexFrame(index, askMs);
    if (!frame) return noteMiss('regional_no_frame_in_window');
    if (!frame.path) return noteMiss('regional_unbuilt_frame');
    if (!askOffsetServed(index, frame, askMs)) return noteMiss('regional_ask_offset');
    const json = d.regionalGrid ? await d.regionalGrid(tile) : null;
    if (!json) return noteMiss('regional_seam');                     // partial cover, window, bundle: the seam recorded why
    stampOverlay(json, json.grid.vectors, tile.key, frame, validTimeStr);
    return json;                                                       // the regional seam minted its truth tag
  } catch (e) {
    return noteMiss('regional_error');
  }
}
