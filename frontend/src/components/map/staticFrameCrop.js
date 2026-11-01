/**
 * staticFrameCrop.js — the mid tier's viewport clip, served from the static world frame (2026-10-22, the mid-zoom instant scrub).
 *
 * WHY. Static frames (staticFrames.js) answered WORLD boxes only (a 340-degree span). At the zooms people scrub (a desktop map at
 * about z4.7 to z7, a small window at about z3.5 to z5.5) the map asks /grid for its VIEWPORT (up to 40 degrees; /grid_series up to
 * 15, wider series pages ask the world box), and the resolver answers from the very same 2-degree global_mid product, CLIPPED to
 * that viewport (grid_resolver Step 3.6 ->
 * mid_res_tier.try_serve_mid_res_tier -> route_helpers.filter_grid_to_bbox). So every step there waited on the 1-CPU box while
 * the CDN already held the frame the clip is cut from. The owner's console (dev bundle 9ecac552, z3.5-4.4): 27x20 / 29x20
 * clips, "[SCRUB] [BACKEND CACHE] Instant re-index", no static-frame activity; offline on the real run, a desktop at z5 took
 * 223-273 ms per step on a local backend (seconds on the live box).
 * This module computes the clip window EXACTLY as the server does and builds the same response from the static frame, so the
 * cropped frame is the /grid clip node for node (scn_static_crop_parity.mjs compares them over hundreds of boxes and every frame).
 *
 * WHERE (midCropFor): only where the resolver provably answers from global_mid, else null and /grid serves as before:
 *   - the request's larger span (max of longitude and latitude, as the server's _request_span) is over MIN_CROP_SPAN (12 deg).
 *     Below it a fine product can win: the mid tier's background sharpen builds a 0.25-deg dynamic product for spans up to
 *     MARINE_MID_REVAL_MAX_SPAN (8 deg by default) and the dynamic cache then answers first (Step 1 & 2);
 *   - and at most the request ceiling where /grid stops asking for the viewport (__RAW_MARINE_GLOBAL_SPAN__, 40 deg): wider
 *     boxes keep today's path (the /grid seam already asks for the world box there);
 *   - no antimeridian crossing and nothing outside [-180, 180] (the server wraps each edge on its own there);
 *   - no regional tile in the client's products manifest that the request is NOT wider than (decide_manifest_product serves a
 *     regional tile only when the request is not wider than it in either axis); without a loaded manifest, nothing is eligible;
 *     for a model other than GFS no overlapping regional tile at all (an estimated item wins whatever the width, and ICON / EURO
 *     carry estimated regional tails).
 * HOW (midClipWindow): the server's arithmetic, step for step, in the same IEEE doubles: get_snapped_bbox (floor/ceil to 1 deg for
 * GFS, 2 deg otherwise, then clamp_and_normalize_bbox, printed at 4 dp), the pad min(12, max(2, 0.5 * span)) with span from the
 * request as sent, the padded window (clamped to -180/-80/180/85, printed at 4 dp and parsed back), then clip_lattice: the cell
 * centres from the data's first lat/lng at the data step, within the window +- 1e-4. The window maps onto the frame's own lattice
 * (row 0 = south, column 0 = west); a window that does not land exactly on it returns null.
 *
 * Kill: window.__RAW_DISABLE_STATIC_MID_CROP__ = true (static frames serve world boxes only, as before). Read per call.
 */
import { getAvailableTilesFromManifest } from './backendWeatherServiceClientCoverage';

export const MIN_CROP_SPAN = 12;          // deg: comfortably above the server's 8-deg sharpen cap (MARINE_MID_REVAL_MAX_SPAN)
const DEFAULT_MAX_CROP_SPAN = 40;         // deg: /grid's own viewport ceiling (backendWeatherServiceClientCoverage)
const PAD_MIN = 2.0;                      // mid_res_tier: max(2.0, MARINE_MID_CLIP_PAD_FRAC * span), capped at MARINE_MID_CLIP_PAD_MAX
const PAD_FRAC = 0.5;
const PAD_MAX = 12.0;
const LATTICE_EPS = 0.0001;               // clip_lattice's window slack
const WIDER_EPS = 0.05;                   // decide_manifest_product's "wider than the tile" slack

const W = () => (typeof window !== 'undefined' ? window : {});

export function midCropEnabled() {
  return W().__RAW_DISABLE_STATIC_MID_CROP__ !== true;
}

function maxCropSpan() {
  const v = Number(W().__RAW_MARINE_GLOBAL_SPAN__);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_CROP_SPAN;
}

/** Python's f"{x:.4f}" parsed back (both round the exact binary value to the nearest 4-dp decimal). */
const at4 = (x) => Number(x.toFixed(4));

/** route_helpers.wrap_longitude. */
export function wrapLongitude(lng) {
  if (lng < -180.0 || lng > 180.0) {
    let wrapped = lng % 360.0;
    if (wrapped < 0) wrapped += 360.0;               // Python's float % takes the divisor's sign
    if (wrapped > 180.0) wrapped -= 360.0;
    if (wrapped === 180.0 && lng < 0) wrapped = -180.0;
    return wrapped;
  }
  return lng;
}

/** route_helpers.clamp_and_normalize_bbox. */
export function clampAndNormalize(w, s, e, n) {
  if (s > n) { const t = s; s = n; n = t; }
  const south = Math.max(-80.0, Math.min(85.0, s));
  const north = Math.max(-80.0, Math.min(85.0, n));
  if ((e - w) >= 360.0) return [-180.0, south, 180.0, north];
  return [wrapLongitude(w), south, wrapLongitude(e), north];
}

/** Parse a bbox string the way route_helpers.parse_bbox does (four finite floats), or null. */
export function parseBboxString(str) {
  const parts = String(str || '').split(',').map((x) => Number(x.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  return parts;
}

/** The bbox string each client seam puts in its URL: /grid prints the numbers as they are, /grid_series at 4 dp. */
export function gridBboxParam(b) { return `${b.west},${b.south},${b.east},${b.north}`; }
export function seriesBboxParam(b) { return `${b.west.toFixed(4)},${b.south.toFixed(4)},${b.east.toFixed(4)},${b.north.toFixed(4)}`; }

/** mid_res_tier._request_span: the larger of the longitude and latitude spans. */
function requestSpan(w, s, e, n) {
  const lng = w <= e ? e - w : (180.0 - w) + (e + 180.0);
  return Math.max(lng, Math.abs(n - s));
}

/**
 * The window of the frame lattice that the mid tier serves for `bboxStr` (exactly the string the seam sends), or null when this
 * mirror cannot reproduce it exactly. `grid` = the frame's { bounds, cols, rows } (row 0 = south, column 0 = west).
 * Returns { c0, c1, r0, r1, cols, rows, bounds, clip } where `clip` is the padded window string the server clips by.
 */
export function midClipWindow(bboxStr, grid, model = 'GFS') {
  const req = parseBboxString(bboxStr);
  if (!req || !grid || !grid.bounds || !(grid.cols >= 2) || !(grid.rows >= 2)) return null;
  const [rw, rs, re, rn] = req;
  // get_snapped_bbox
  const t = String(model || 'GFS').toUpperCase() === 'GFS' ? 1.0 : 2.0;
  const snapped = clampAndNormalize(Math.floor(rw / t) * t, Math.floor(rs / t) * t, Math.ceil(re / t) * t, Math.ceil(rn / t) * t).map(at4);
  const [sw, ss, se, sn] = snapped;
  // the proportional pad (mid_res_tier, defaults: MARINE_MID_CLIP_PAD_FRAC 0.5, MARINE_MID_CLIP_PAD_MAX 12)
  const pad = Math.min(PAD_MAX, Math.max(PAD_MIN, PAD_FRAC * requestSpan(rw, rs, re, rn)));
  const clip = [Math.max(-180.0, sw - pad), Math.max(-80.0, ss - pad), Math.min(180.0, se + pad), Math.min(85.0, sn + pad)].map(at4);
  // filter_grid_to_bbox: clamp_and_normalize_bbox(parse_bbox(clip)), then clip_lattice from the data's first lat / lng
  const [west, south, east, north] = clampAndNormalize(...clip);
  if (west > east) return null;                                   // an antimeridian-crossing window: not mirrored
  const win = latticeWindow(west, south, east, north, grid);
  return win && { ...win, clip: clip.map((x) => x.toFixed(4)).join(',') };
}

/**
 * route_helpers.clip_lattice on `grid` (row 0 = south, column 0 = west) for an already-normalised, non-crossing window, mapped
 * onto the grid's own lattice: { c0, c1, r0, r1, cols, rows, bounds } or null when the window is not one contiguous block of
 * existing cells. Shared by the mid tier's padded clip (midClipWindow) and the regional tile's snapped clip (staticRegional).
 */
export function latticeWindow(west, south, east, north, grid) {
  if (!grid || !grid.bounds || !(grid.cols >= 2) || !(grid.rows >= 2) || west > east) return null;
  const b = grid.bounds;
  const dLat = (b.north - b.south) / (grid.rows - 1);
  const dLng = (b.east - b.west) / (grid.cols - 1);
  const res = Math.round(dLat * 1e4) / 1e4;                       // the server's min(round(lat[i+1] - lat[i], 4))
  if (!(res > 0) || Math.abs(dLng - dLat) > 1e-9) return null;
  const refLat = b.south; let refLng = b.west;
  const kLat0 = Math.ceil((south - refLat - LATTICE_EPS) / res);
  const kLat1 = Math.floor((north - refLat + LATTICE_EPS) / res);
  while (refLng < west) refLng += 360.0;
  while (refLng >= west + 360.0) refLng -= 360.0;
  const kLng0 = Math.ceil((west - refLng - LATTICE_EPS) / res);
  const kLng1 = Math.floor((east - refLng + LATTICE_EPS) / res);
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const lats = [];
  for (let k = kLat0; k <= kLat1; k++) { const lat = r4(refLat + k * res); if (lat >= -80.0 && lat <= 85.0) lats.push(lat); }
  const lngs = [...new Set(Array.from({ length: Math.max(0, kLng1 - kLng0 + 1) }, (_, i) => r4(wrapLongitude(refLng + (kLng0 + i) * res))))]
    .sort((x, y) => x - y);
  if (lats.length < 2 || lngs.length < 2) return null;
  // Map onto the frame's own lattice; every cell must exist and the window must be one contiguous block.
  const ci = (lng) => Math.round((lng - b.west) / dLng);
  const ri = (lat) => Math.round((lat - b.south) / dLat);
  const c0 = ci(lngs[0]); const c1 = ci(lngs[lngs.length - 1]);
  const r0 = ri(lats[0]); const r1 = ri(lats[lats.length - 1]);
  if (c0 < 0 || r0 < 0 || c1 >= grid.cols || r1 >= grid.rows) return null;
  if (c1 - c0 + 1 !== lngs.length || r1 - r0 + 1 !== lats.length) return null;
  for (let i = 0; i < lngs.length; i++) if (Math.abs(b.west + (c0 + i) * dLng - lngs[i]) > 1e-6) return null;
  for (let i = 0; i < lats.length; i++) if (Math.abs(b.south + (r0 + i) * dLat - lats[i]) > 1e-6) return null;
  return {
    c0, c1, r0, r1, cols: lngs.length, rows: lats.length,
    bounds: { west: lngs[0], south: lats[0], east: lngs[lngs.length - 1], north: lats[lats.length - 1] },
  };
}

const lngSpanOf = (w, e) => (w <= e ? e - w : (180.0 - w) + (e + 180.0));

/**
 * THE RESOLVER'S REGIONAL CHOICE FOR ICON / EURO, EXACTLY (2026-10-26, traced through grid_resolver, product_selection and
 * grid_resolver_selection for the lead's live chaos run). Above a 15-deg request (lon OR lat), select_best_candidate keeps only
 * GLOBAL candidates whenever one exists (product_selection.py:133-161), so a regional tile can come back only through
 * prefer_overlapping_marine_region: a finer tile covering at least MARINE_REGIONAL_MIN_COVERAGE_FRACTION (0.70) of the REQUEST area
 * (grid_resolver_selection.py:61-106). An estimated one is then served whatever the width (decide_manifest_product), and ICON / EURO
 * carry estimated regional tails, so for them such a tile refuses; a smaller overlap does not. At 15 deg and under every overlap still
 * refuses for them (the server's covered-or-not tests there). Conservative where the server is not knowable here: any hour (the tile
 * may be estimated at some), and the raw request (the server's snapped box is larger, so its share is smaller).
 * Kill (the old any-overlap rule): window.__RAW_DISABLE_EXACT_REGIONAL_RULE__ = true.
 */
export const WIDE_REQUEST_DEG = 15;
export const REGIONAL_MIN_COVER = 0.70;
const exactRegionalRuleOn = () => W().__RAW_DISABLE_EXACT_REGIONAL_RULE__ !== true;
function coverOfRequest(c, w, s, e, n) {
  const lng = Math.min(e, c.east) - Math.max(w, c.west); const lat = Math.min(n, c.north) - Math.max(s, c.south);
  const area = (e - w) * (n - s);
  return lng > 0 && lat > 0 && area > 0 ? (lng * lat) / area : 0;
}
/** May this overlapping tile be served instead of the mid clip for a non-GFS request? (The rule above.) */
function otherModelTileMayWin(c, wraps, w, s, e, n) {
  if (wraps || !exactRegionalRuleOn()) return true;
  if (!(e - w > WIDE_REQUEST_DEG || n - s > WIDE_REQUEST_DEG)) return true;
  return coverOfRequest(c, w, s, e, n) >= REGIONAL_MIN_COVER;
}

/**
 * The request a mid-zoom CLIP was cut for (the inverse of the server's pad: min(12, max(2, span / 2)) each side of the larger span):
 * { west, south, east, north } (approximate to the 1-2 deg snap), or null. For the GPU frame store, which sees the clip, not the ask.
 */
export function requestFromClip(b) {
  if (!b || !(b.east > b.west) || !(b.north > b.south)) return null;
  const cm = Math.max(b.east - b.west, b.north - b.south);
  const span = cm <= 8 ? cm - 4 : (cm <= 48 ? cm / 2 : cm - 24);
  const pad = Math.min(PAD_MAX, Math.max(PAD_MIN, PAD_FRAC * span));
  return { west: b.west + pad, south: b.south + pad, east: b.east - pad, north: b.north - pad };
}

/**
 * Is a clip of a plain ICON / EURO global_mid frame what /grid serves for the request it was cut for, at any hour? The request is
 * wider than 15 deg (only globals are candidates, product_selection) and no regional tile of that set may win (the rule above). Needs
 * the products manifest; without it, false. For the frame store's plain EURO/ICON crops (marineFrameStoreRuntime).
 */
export function plainClipServable({ model, layer, bounds }) {
  try {
    const r = requestFromClip(bounds);
    if (!r || !(r.east - r.west > WIDE_REQUEST_DEG || r.north - r.south > WIDE_REQUEST_DEG)) return false;
    const { tiles, fallbackReason } = getAvailableTilesFromManifest(model, 'marine', layer);
    if (fallbackReason || !Array.isArray(tiles)) return false;
    for (const tile of tiles) {
      const c = tile && tile.bounds;
      if (!c || ![c.west, c.south, c.east, c.north].every(Number.isFinite)) return false;
      if (lngSpanOf(c.west, c.east) >= 350.0) continue;
      const wraps = c.west > c.east;
      const overlaps = wraps || (Math.min(r.east, c.east) > Math.max(r.west, c.west) && Math.min(r.north, c.north) > Math.max(r.south, c.south));
      if (overlaps && otherModelTileMayWin(c, wraps, r.west, r.south, r.east, r.north)) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Does the resolver answer this request from global_mid, by the rules above (no frame needed)? `bboxStr` is the string the seam
 * sends. Never throws. Returns false or true.
 */
export function midCropRulesPass({ model, layer, bboxStr }) {
  try {
    if (!midCropEnabled()) return false;
    const req = parseBboxString(bboxStr);
    if (!req) return false;
    const [w, s, e, n] = req;
    if (!(w >= -180.0 && e <= 180.0 && w < e && s < n)) return false;         // no crossing, nothing past +-180
    const lng = e - w; const lat = n - s;
    const span = Math.max(lng, lat);
    if (!(span > MIN_CROP_SPAN) || span > maxCropSpan()) return false;
    const { tiles, fallbackReason } = getAvailableTilesFromManifest(model, 'marine', layer);
    if (fallbackReason || !Array.isArray(tiles)) return false;   // no manifest, or no product of this set in it: /grid decides
    const gfs = String(model || 'GFS').toUpperCase() === 'GFS';
    for (const tile of tiles) {
      const c = tile && tile.bounds;
      if (!c || ![c.west, c.south, c.east, c.north].every(Number.isFinite)) return false;
      const tLng = lngSpanOf(c.west, c.east); const tLat = Math.abs(c.north - c.south);
      if (tLng >= 350.0) continue;                                             // a world product (global_mid / global_coarse)
      const wraps = c.west > c.east;
      const overlaps = wraps || (Math.min(e, c.east) > Math.max(w, c.west) && Math.min(n, c.north) > Math.max(s, c.south));
      if (!overlaps) continue;
      // An ESTIMATED item is served whatever the request's width (decide_manifest_product: `is_estimated` -> use it), and ICON /
      // EURO carry estimated regional tails; GFS has none inside the 14-day horizon. So another model refuses where such a tile
      // can be chosen at all: any overlap at 15 deg and under, a 70%-of-the-request cover above (otherModelTileMayWin, 2026-10-26).
      if (!gfs) { if (otherModelTileMayWin(c, wraps, w, s, e, n)) return false; continue; }
      if (!(lng > tLng + WIDER_EPS || lat > tLat + WIDER_EPS)) return false;   // the server may serve this regional tile
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Would the resolver answer this request from global_mid (so a crop of the static frame IS its answer)? Returns the window
 * (midClipWindow) on the frame lattice `grid`, or null. Never throws.
 */
export function midCropFor({ model, layer, bboxStr, grid }) {
  try {
    return midCropRulesPass({ model, layer, bboxStr }) ? midClipWindow(bboxStr, grid, model) : null;
  } catch (err) {
    return null;
  }
}

/** The frame's vectors inside a window, row by row (south first), west to east: the clip's own order. */
export function cropVectors(vectors, gridCols, win) {
  const out = new Array(win.cols * win.rows);
  let k = 0;
  for (let r = win.r0; r <= win.r1; r++) {
    const base = r * gridCols;
    for (let c = win.c0; c <= win.c1; c++) out[k++] = vectors[base + c];
  }
  return out;
}

const bbox4 = (b) => `${b.west.toFixed(4)},${b.south.toFixed(4)},${b.east.toFixed(4)},${b.north.toFixed(4)}`;

/**
 * Turn a WORLD /grid JSON built from the static frame (staticFrameCodec.gridJsonFromFrame) into the CLIP's JSON: the cropped
 * vectors and the geometry fields filter_grid_to_bbox sets on the clipped product (grid bounds / cols / rows, served_bbox, the
 * coverage = the grid bounds, requested_bbox = the padded clip window it was filtered by), plus the tier's diagnostics stamp.
 * Everything else (identity, times, honesty fields, provenance) is the frame's, as on the server.
 */
export function cropGridJson(json, win, cropped) {
  const g = json.grid;
  return {
    ...json,
    requested_bbox: win.clip, served_bbox: bbox4(win.bounds), coverage: { ...win.bounds },
    grid: {
      ...g, bounds: { ...win.bounds }, cols: win.cols, rows: win.rows, vectors: cropped,
      diagnostics: { ...(g.diagnostics || {}), mid_res_tier: true, cols: win.cols, rows: win.rows, vectorCount: cropped.length,
        renderable: cropped.some((v) => v.speed > 0) },
    },
    static_frame: { ...(json.static_frame || {}), crop: win.clip },
  };
}

/** The same for one series frame (staticFrameCodec.seriesFrameFromFrame). */
export function cropSeriesFrame(frame, win, cropped) {
  return { ...frame, cols: win.cols, rows: win.rows, bounds: { ...win.bounds }, vectors: cropped, static_crop: win.clip };
}
