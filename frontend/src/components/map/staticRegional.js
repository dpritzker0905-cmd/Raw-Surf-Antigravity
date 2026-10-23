/**
 * staticRegional.js — regional static frames at zoom 7-9: a pilot box's run as ONE immutable bundle on the CDN (2026-10-23).
 *
 * WHY. At z7-9 the map asks /grid and /grid_series for its viewport, and inside a pilot box the resolver serves the stored 0.25-deg
 * tile (grid_resolver Step 3). The map OPENS at z9 over florida_east_coast: one load cost ~34 s of /grid_series CPU on the 1-CPU box
 * (the lead's live read, 2026-10-23 16:33Z). The publisher (frame_set_bundle.py, #467) now writes each box's run as one bundle.
 *
 * THE CONTRACT (agreed with the static-frames session, approved by the lead; regional-frames-client-contract-draft, amended):
 *   - latest.json sets['GFS/marine/waves/<region_id>'] = { index, bundle: { path, bytes, sha12 }, run, ... }; the index (immutable)
 *     lists frames { valid_time, is_estimated, meta, source, offset, length, sha12 } (offset null + `unbuilt` = no frame) and `grid`
 *     = the tile lattice (cell_bounds). The bundle is the concatenated per-frame gzip members; frame = bundle[offset, offset+length),
 *     byte-identical to the per-frame object, and sha12 = the first 12 hex of sha256 over that GZIP slice (checked before decoding).
 *   - A regional frame answers ONLY a box the tile FULLY covers: the window Step 3 serves (get_snapped_bbox, the data-extent clamp,
 *     clip_lattice; no pad) must cover the request with margin 0, the server's own partial_coverage test. A partial cover is
 *     served by the server as `regional_partial` and sharpened to a dynamic product, so it stays on /grid. Measured from Render logs
 *     2026-10-16..23: every dynamic-cache answer over a tile was such a partial cover; none on a fully covered box.
 *   - The tile is the one Step 3 would pick for a box inside it: among the regional tiles whose manifest coverage contains the
 *     request, the smallest (select_best_candidate: largest intersection, then smallest coverage area); an exact tie -> /grid.
 *   - GFS waves, swell_1, swell_2 and wind_waves: the four layers the publisher bundles (#486; the swell trains were most of the
 *     opening view's /grid_series time). A box with no stored tile or no published set of a layer (SoCal swell_2) is a miss ->
 *     /grid. The frame store does not take regional sets yet: getPinnedIndexSync keeps them out.
 * Kill: window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true (every regional box asks /grid as before). The per-set kill
 * (__RAW_DISABLE_STATIC_FRAMES_SETS__ with the regional key) and the global static-frames kill also apply.
 * Telemetry: window.__RAW_STATIC_REGIONAL__ (also window.__RAW_STATIC_FRAMES__.regional) = { bundles, bundleBytes, slices, hits, series,
 *   misses, dynamicOnCovered }.
 */
import { clampAndNormalize, latticeWindow, parseBboxString } from './staticFrameCrop';
import { getAvailableTilesFromManifest } from './backendWeatherServiceClientCoverage';

export const REGIONAL_MODELS = ['GFS'];
export const REGIONAL_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
const BUNDLES_KEPT = 6;                 // bundles held in memory (the current and previous run of a few boxes; each 0.03-0.9 MB)

const W = () => (typeof window !== 'undefined' ? window : {});
export const regionalBundlesOn = () => W().__RAW_DISABLE_REGIONAL_BUNDLES__ !== true;

/** A regional set key ('GFS/marine/waves/florida_east_coast'): anything but the world sets. */
export function isRegionalSetKey(key) {
  const parts = String(key || '').split('/');
  return parts.length === 4 && parts[1] === 'marine' && REGIONAL_LAYERS.includes(parts[2]) && REGIONAL_MODELS.includes(parts[0])
    && !/^global_/.test(parts[3]);
}

export function regionalSetKey(model, layer, regionId) {
  return `${String(model || 'GFS').toUpperCase()}/marine/${String(layer || 'waves').toLowerCase()}/${regionId}`;
}

// The counters live HERE (never create window.__RAW_STATIC_FRAMES__: staticFrames owns its shape) and are attached to it as
// its `regional` field whenever it exists; window.__RAW_STATIC_REGIONAL__ always points at them.
const freshStats = () => ({ bundles: 0, bundleBytes: 0, slices: 0, hits: 0, series: 0, misses: {}, dynamicOnCovered: 0 });
let _stats = freshStats();
export function regionalTelemetry() {
  const w = W();
  w.__RAW_STATIC_REGIONAL__ = _stats;
  if (w.__RAW_STATIC_FRAMES__ && w.__RAW_STATIC_FRAMES__.regional !== _stats) w.__RAW_STATIC_FRAMES__.regional = _stats;
  return _stats;
}
export function noteRegionalMiss(reason) {
  const r = regionalTelemetry();
  r.misses[reason] = (r.misses[reason] || 0) + 1;
}

const lngSpan = (w, e) => (w <= e ? e - w : (180.0 - w) + (e + 180.0));

/**
 * The regional tile Step 3 picks for this request, or null: the request (as the seam sends it) must lie inside a regional tile's
 * manifest coverage; with several, the smallest; an exact area tie, a crossing box or no manifest -> null. Phase 1 models/layers.
 */
export function pickRegionalTile({ model, layer, bboxStr }) {
  if (!regionalBundlesOn()) return null;
  const m = String(model || 'GFS').toUpperCase(); const l = String(layer || 'waves').toLowerCase();
  if (!REGIONAL_MODELS.includes(m) || !REGIONAL_LAYERS.includes(l)) return null;
  const req = parseBboxString(bboxStr);
  if (!req) return null;
  const [w, s, e, n] = req;
  if (!(w < e) || !(s < n) || w < -180 || e > 180) return null;
  const { tiles, fallbackReason } = getAvailableTilesFromManifest(m, 'marine', l);
  if (fallbackReason || !Array.isArray(tiles)) return null;
  let best = null; let bestArea = Infinity; let tie = false;
  for (const tile of tiles) {
    const c = tile && tile.bounds;
    if (!tile || !tile.id || !c || ![c.west, c.south, c.east, c.north].every(Number.isFinite)) continue;
    if (lngSpan(c.west, c.east) >= 350) continue;                       // the world tiers are not regional
    if (!(c.west <= w && c.east >= e && c.south <= s && c.north >= n)) continue;
    const area = lngSpan(c.west, c.east) * (c.north - c.south);
    if (Math.abs(area - bestArea) < 1e-9) tie = true;
    else if (area < bestArea) { best = tile; bestArea = area; tie = false; }
  }
  return best && !tie ? { id: best.id, bounds: { ...best.bounds }, key: regionalSetKey(m, l, best.id) } : null;
}

/**
 * The window of the tile lattice `grid` that Step 3 serves for `bboxStr` (filter_grid_to_bbox(get_snapped_bbox(bbox)): the 1-deg
 * GFS snap, clamp_and_normalize, the data-extent clamp, clip_lattice), or null. `covers` = the served lattice covers the request
 * with margin 0 (the server's partial_coverage test); only a covering window may be served from the bundle.
 */
export function regionalClipWindow(bboxStr, grid, model = 'GFS') {
  const req = parseBboxString(bboxStr);
  if (!req || !grid || !grid.bounds) return null;
  const [rw, rs, re, rn] = req;
  const t = String(model || 'GFS').toUpperCase() === 'GFS' ? 1.0 : 2.0;
  const at4 = (x) => Number(x.toFixed(4));
  const snapped = clampAndNormalize(Math.floor(rw / t) * t, Math.floor(rs / t) * t, Math.ceil(re / t) * t, Math.ceil(rn / t) * t).map(at4);
  let [west, south, east, north] = clampAndNormalize(...snapped);
  if (west > east) return null;
  const b = grid.bounds;                                              // the data extent (the lattice's first and last nodes)
  west = Math.max(west, b.west); east = Math.min(east, b.east); south = Math.max(south, b.south); north = Math.min(north, b.north);
  if (west > east || south > north) return null;
  const win = latticeWindow(west, south, east, north, grid);
  if (!win) return null;
  const covers = win.bounds.west <= rw && win.bounds.east >= re && win.bounds.south <= rs && win.bounds.north >= rn;
  return { ...win, covers, snapped: snapped.map((x) => x.toFixed(4)).join(',') };
}

// ── The bundle: one fetch per bundle path (raw bytes; never inflated whole), slices checked and inflated one by one ──────
const _bundles = new Map();           // path -> Promise<ArrayBuffer|null>

async function fetchBundle(url, path) {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) { noteRegionalMiss(`bundle_http_${res.status}`); return null; }
    const buf = await res.arrayBuffer();
    const r = regionalTelemetry();
    r.bundles += 1; r.bundleBytes += buf.byteLength;
    return buf;
  } catch (e) {
    noteRegionalMiss('bundle_fetch_error');
    _bundles.delete(path);
    return null;
  }
}

function bundleFor(base, path) {
  let p = _bundles.get(path);
  if (p) { _bundles.delete(path); _bundles.set(path, p); return p; }
  p = fetchBundle(base + path, path).then((buf) => { if (!buf) _bundles.delete(path); return buf; });
  _bundles.set(path, p);
  while (_bundles.size > BUNDLES_KEPT) _bundles.delete(_bundles.keys().next().value);
  return p;
}

const _codec = { sha12: null, gunzip: null };   // test hook (_setRegionalCodecForTest): jsdom has neither crypto.subtle nor DecompressionStream

async function sha12Of(bytes) {
  if (_codec.sha12) return _codec.sha12(bytes);
  const subtle = (typeof crypto !== 'undefined' && crypto.subtle) || null;
  if (!subtle) return null;
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(d.slice(0, 6), (x) => x.toString(16).padStart(2, '0')).join('');
}

async function gunzip(bytes) {
  if (_codec.gunzip) return _codec.gunzip(bytes);
  if (typeof DecompressionStream === 'undefined') return null;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/**
 * A bundle frame's inflated bytes, as fetchFrameBytes returns them ({ buffer, wire, fetchMs, inflateMs } or { error, status }).
 * `frame.bundle` = { path, offset, length, sha12 } (staticFrames.loadIndex sets it). Never throws.
 */
export async function regionalFrameBytes(base, frame, signal) {
  const s = frame && frame.bundle;
  if (!s || !Number.isFinite(s.offset) || !Number.isFinite(s.length)) return { error: 'not_a_bundle_frame' };
  if (signal && signal.aborted) return { error: 'aborted' };
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const buf = await bundleFor(base, s.path);
  if (!buf) return { error: 'bundle_unavailable', status: 404 };
  if (s.offset + s.length > buf.byteLength) { noteRegionalMiss('slice_out_of_range'); return { error: 'slice_out_of_range' }; }
  const slice = new Uint8Array(buf, s.offset, s.length);
  const sum = await sha12Of(slice);
  if (sum !== null && sum !== s.sha12) { noteRegionalMiss('sha12_mismatch'); return { error: 'sha12_mismatch' }; }
  if (sum === null) noteRegionalMiss('sha12_unchecked');
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const inflated = await gunzip(slice);
  if (!inflated) return { error: 'no_decompression_stream' };
  regionalTelemetry().slices += 1;
  return { buffer: inflated, wire: 0, fetchMs: t1 - t0, inflateMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t1 };
}

/** The index frames of a bundle set get a `bundle` slice record and a unique `path` (`<bundle>#<offset>`) for the shared loader. */
export function normalizeBundleIndex(idx) {
  if (!idx || !idx.bundle || !idx.bundle.path || !Array.isArray(idx.frames)) return idx;
  for (const f of idx.frames) {
    if (f.offset === null || f.offset === undefined) { f.path = null; continue; }
    f.bundle = { path: idx.bundle.path, offset: f.offset, length: f.length, sha12: f.sha12 };
    f.path = `${idx.bundle.path}#${f.offset}`;
  }
  return idx;
}

// ── The JSON the seams return, shaped as Step 3 shapes a clipped regional tile ─────────────────────────────────────────
const bbox4 = (b) => `${b.west.toFixed(4)},${b.south.toFixed(4)},${b.east.toFixed(4)},${b.north.toFixed(4)}`;

/** gridJsonFromFrame's JSON (the whole tile) clipped to the Step 3 window. As Step 3: requested_bbox = the SNAPPED box
 *  (filter_grid_to_bbox stamps its get_snapped_bbox argument there), query_bbox and requested_bbox_original = the request. */
export function regionalGridJson(json, win, cropped, bboxStr) {
  const g = json.grid;
  return {
    ...json,
    requested_bbox: win.snapped, query_bbox: bboxStr, requested_bbox_original: bboxStr,
    served_bbox: bbox4(win.bounds), coverage: { ...win.bounds }, coverage_scope: 'regional', coverage_mode: 'regional_tile',
    partial_coverage: false,
    grid: {
      ...g, bounds: { ...win.bounds }, cols: win.cols, rows: win.rows, vectors: cropped,
      diagnostics: { ...(g.diagnostics || {}), cols: win.cols, rows: win.rows, vectorCount: cropped.length,
        renderable: cropped.some((v) => v.speed > 0), partial_coverage: false },
    },
    static_frame: { ...(json.static_frame || {}), regional: true, snapped: win.snapped },
  };
}

/** The counter the lead asked for: a /grid answer that came back DYNAMIC for a box a regional bundle would answer (it never
 *  should: the bundle serves the stored tile there). Called by the /grid seam with the backend's JSON. */
export function noteBackendAnswer({ model, layer, bboxStr, json }) {
  try {
    if (!json || !json.is_dynamic_viewport_product) return;
    const tile = pickRegionalTile({ model, layer, bboxStr });
    if (tile) regionalTelemetry().dynamicOnCovered += 1;
  } catch (e) { /* telemetry never breaks a fetch */ }
}

export function _resetRegionalForTest() {
  _bundles.clear();
  _stats = freshStats();
}

export function _setRegionalCodecForTest({ sha12 = null, gunzip: gz = null } = {}) {
  _codec.sha12 = sha12; _codec.gunzip = gz;
}
