/**
 * staticRatingFrames.js — the Surf Rating band from RATED static frames instead of /grid?surf=1 (2026-11-01, item 10). DARK.
 *
 * WHY: turning the band ON asked the 1-CPU box for /grid?surf=1 (4.4 s live; one burst took it to 1,056 MB): the rating is a
 * serve-time transform of the stored product. The publisher now rates every stored 2-deg world product in CI through the served
 * function itself (backend/services/frame_set_rating.py -> grid_resolver_surf.apply_surf_overlay) and publishes it as the set
 * `<model>/marine/<layer>/global_mid_rated`: the stored product's four planes plus a RATING plane, which
 * staticFrameCodec.buildVectors turns back into the exact vectors /grid?surf=1 serves.
 *
 * WHAT IT SERVES (seam A only): a CROP box /grid would answer from the global_mid tier (staticFrameCrop.midCropRulesPass), minus
 * the surf-only regional preference (product_selection.pick_surf_regional_override: a request <= 15 deg either way that overlaps a
 * regional tile gets the tile), at an ask the frame was rated for (`ask_offsets_h`: the wind products and gate confirmations the
 * rating read are the same as at the frame's own hour). Everything else asks /grid as before: world boxes (the box serves the honest
 * field there), z7-9 regional tiles, any ask outside the offsets, an unbuilt hour, the series lane (/grid_series).
 *
 * DARK, because the band's inputs are read once per publish (the gate's spot confirmations, the size climatology) while Render
 * re-reads them every 300-600 s: a CDN band can lag the box by up to one republish. That is the owner's call (D-001), so:
 *   ON for this browser:  localStorage '__RAW_RATING_FRAMES__' = '1', or window.__RAW_RATING_FRAMES__ = true;
 *   ON for a build:       REACT_APP_RATING_FRAMES=true;
 *   KILL (wins over all): window.__RAW_DISABLE_RATING_FRAMES__ = true. The static-frames kills apply too.
 * Telemetry: window.__RAW_STATIC_FRAMES_RATED__ (hits, misses by reason).
 */
import { gridJsonFromFrame, pickIndexFrame, ratingCounts } from './staticFrameCodec';
import { cropGridJson, cropVectors, gridBboxParam, midCropFor, midCropRulesPass, parseBboxString } from './staticFrameCrop';
import { getAvailableTilesFromManifest } from './backendWeatherServiceClientCoverage';
import { buildTruthTag } from './weatherTruthTracker';

export const RATED_TIER = 'global_mid_rated';
// The publisher's frame_set_rating.RATED_LAYERS (the world sets the band can be asked of).
export const RATED_SET_KEYS = [
  'GFS/marine/waves', 'ICON/marine/waves', 'EURO/marine/waves', 'GFS/marine/swell_1', 'GFS/marine/swell_2',
  'GFS/marine/wind_waves', 'ICON/marine/swell_1', 'ICON/marine/wind_waves',
].map((k) => `${k}/${RATED_TIER}`);
const WORLD_MIN_SPAN = 340;           // staticFrames' world box (the box keeps the honest field there: span >= 350 is not rated)
const SURF_REGIONAL_MAX_SPAN = 15.5;  // product_selection.pick_surf_regional_override's 15 deg, plus margin (refusing is safe)
const HOUR_MS = 3600000;

export const ratedSetKey = (model, layer) => `${(model || 'GFS').toUpperCase()}/marine/${(layer || 'waves').toLowerCase()}/${RATED_TIER}`;

/** Is the rated path on for this page? Kill first, then this browser, then the build. Default OFF (dark). */
export function ratingFramesOn() {
  if (typeof window === 'undefined' || window.__RAW_DISABLE_RATING_FRAMES__ === true) return false;
  if (window.__RAW_RATING_FRAMES__ === true) return true;
  try { if (window.localStorage && window.localStorage.getItem('__RAW_RATING_FRAMES__') === '1') return true; } catch (e) { /* blocked */ }
  try { return process.env.REACT_APP_RATING_FRAMES === 'true'; } catch (e) { return false; }
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
  if (!setEnabled(ratedSetKey(model, layer))) return false;
  const bboxStr = gridBboxParam(bbox);
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
 * `d` = staticFrames' loaders { getPinnedIndex, loadFrameVectors } (passed in: staticFrames imports this module).
 */
export async function tryStaticRatedGrid({ model, layer, validTimeStr, clampedBbox, signal }, d) {
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
    const diag = json.grid.diagnostics;
    diag.surf_transform = { ...ratingCounts(cropped), ...(diag.surf_transform || {}) };   // the overlay's per-box counts
    try { json.truthTag = buildTruthTag(json, 'staticFrame'); } catch (e) { json.truthTag = null; }
    const t = telemetry();
    t.hits += 1;
    t.last = { hit: key, valid_time: frame.valid_time, ask: validTimeStr, at: Date.now() };
    return json;
  } catch (e) {
    return noteMiss('error');
  }
}
