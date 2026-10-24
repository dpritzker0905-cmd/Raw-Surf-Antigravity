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
 *     /grid. The frame store's regional show (marineFrameStoreRegional.js) reads the pinned GFS waves ones; its world sets do not.
 * Kill: window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true (every regional box asks /grid as before). The per-set kill
 * (__RAW_DISABLE_STATIC_FRAMES_SETS__ with the regional key) and the global static-frames kill also apply.
 * Telemetry: window.__RAW_STATIC_REGIONAL__ (also window.__RAW_STATIC_FRAMES__.regional) = { bundles, bundleBytes, slices, hits, series,
 *   misses, dynamicOnCovered }. Opt-in decision trace: window.__RAW_STATIC_REGIONAL_TRACE__ = [] (each tile pick and why; the
 *   series seam's waits and page decisions).
 * The map's opening: the tile list is the products manifest, which lands seconds after the first series pages are decided; a page
 *   that could be regional waits for it, bounded (marineSeriesStatic.regionalSeriesWait). Small regional pages fill every hour
 *   (marineSeriesStatic.regionalFullPage).
 */
import { clampAndNormalize, latticeWindow, parseBboxString } from './staticFrameCrop';
import { getAvailableTilesFromManifest } from './backendWeatherServiceClientCoverage';

export const REGIONAL_MODELS = ['GFS'];
export const REGIONAL_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
const BUNDLES_KEPT = 6;                 // bundles held in memory (the current and previous run of a few boxes; each 0.03-0.9 MB)

const W = () => (typeof window !== 'undefined' ? window : {});
// DARK until the LIVE parity passes (2026-10-23 evening): static-frames' live bundle-vs-/grid_series parity FAILED for
// florida_east_coast (the whole-tile lattice differs; 465 of 585 sub-box nodes), so the server may answer these boxes from another
// product than the tile, which would make the bundle a served-number change (D-001: dark). Opt in per browser with
// window.__RAW_ENABLE_REGIONAL_BUNDLES__ = true; the kill (__RAW_DISABLE_REGIONAL_BUNDLES__) still wins. Flip
// REGIONAL_BUNDLES_DEFAULT_ON once the served product is named and the live parity passes.
export const REGIONAL_BUNDLES_DEFAULT_ON = false;
export const regionalBundlesOn = () => W().__RAW_DISABLE_REGIONAL_BUNDLES__ !== true
  && (REGIONAL_BUNDLES_DEFAULT_ON || W().__RAW_ENABLE_REGIONAL_BUNDLES__ === true);

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
  if (!regionalCapable()) return trace({ l, bboxStr, pick: 'not_capable' });
  const req = parseBboxString(bboxStr);
  if (!req) return null;
  const [w, s, e, n] = req;
  if (!(w < e) || !(s < n) || w < -180 || e > 180) return trace({ l, bboxStr, pick: 'bad_box' });
  const { tiles, fallbackReason } = getAvailableTilesFromManifest(m, 'marine', l);
  if (fallbackReason === 'manifest_not_loaded') return pilotFallback(m, l, bboxStr, { west: w, south: s, east: e, north: n });
  if (fallbackReason || !Array.isArray(tiles)) {
    // A manifest that lists no tile for this layer at all is what an explicit-empty set looks like once it has loaded: say 'empty'.
    return trace({ l, bboxStr, pick: emptySetFor(m, l, { west: w, south: s, east: e, north: n }) ? 'empty' : (fallbackReason || 'no_tiles') });
  }
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
  if (best && !tie) { trace({ l, bboxStr, pick: best.id }); return { id: best.id, bounds: { ...best.bounds }, key: regionalSetKey(m, l, best.id) }; }
  if (!tie && emptySetFor(m, l, { west: w, south: s, east: e, north: n })) return trace({ l, bboxStr, pick: 'empty' });
  return trace({ l, bboxStr, pick: tie ? 'tie' : 'outside' });
}

/**
 * True when this box could be answered by a regional bundle but the products manifest (the tile list Step 3 picks from) has
 * not loaded yet: pickRegionalTile would say "no tile" only because it is early. The /grid seam awaits the manifest before it
 * decides (fetchBackendMarineGrid); the series pages decide synchronously, so at the map's opening every page was sent to
 * /grid_series before the manifest landed (the z9 Florida trace, 2026-10-23: 11 picks 'manifest_not_loaded', all four waves
 * pages queued to the backend, ~4 s before the manifest arrived). Boxes wider than any pilot tile never wait.
 */
export function regionalManifestPending({ model, layer, bbox, surf }) {
  if (surf || !bbox || !regionalBundlesOn() || !regionalCapable()) return false;
  const m = String(model || 'GFS').toUpperCase(); const l = String(layer || 'waves').toLowerCase();
  if (!REGIONAL_MODELS.includes(m) || !REGIONAL_LAYERS.includes(l)) return false;
  if (!insidePilotBox(bbox)) return false;              // only a box a pilot tile could cover waits
  if (emptySetFor(m, l, bbox)) return false;             // its set is an explicit empty in the latest.json read (#514): no tile to wait for
  if (_latestRead() && !pilotFallbackOff()) return false;   // latest.json is read: the pilot fallback decides now (pilotFallback)
  return getAvailableTilesFromManifest(m, 'marine', l).fallbackReason === 'manifest_not_loaded';
}

/** The browser can check and inflate bundle slices: crypto.subtle (secure contexts) and DecompressionStream('gzip') (Safari
 *  16.4+). Without either no regional box is picked, so nothing is downloaded and every box keeps its existing path. */
export function regionalCapable() {
  const digest = !!_codec.sha12 || (typeof crypto !== 'undefined' && !!crypto && !!crypto.subtle);
  const inflate = !!_codec.gunzip || typeof DecompressionStream !== 'undefined';
  return digest && inflate;
}

// ── Before the products manifest has loaded (the live read: ~4 s into the opening) ─────────────────────────────────────────
// A box inside a pilot box can be served by that box's tile ONLY (the pilot boxes do not overlap: the backend's tests ban
// interior overlap, and PILOT_BOXES is pinned to pilot_regions.py), and a set listed in latest.json was written from that
// tile's stored products. So until the manifest lands, the tile is that pilot box when its set is listed; the cover is then
// checked on the set's own lattice as always. Once the manifest has loaded it decides (a tile it does not list is no tile).
// staticFrames registers the latest.json probes (no import cycle). Kill: window.__RAW_DISABLE_REGIONAL_PILOT_FALLBACK__ = true.
let _listed = () => false;
let _latestRead = () => false;
let _empty = () => false;
export function setRegionalLatestProbes({ listed, read, empty }) { _listed = listed; _latestRead = read; if (empty) _empty = empty; }
// The pilot box (id) holding this box, or null; and whether its set for (model, layer) is an explicit empty in the latest.json read.
const pilotBoxFor = (b) => PILOT_BOXES.find(([, w, s, e, n]) => b.west >= w && b.east <= e && b.south >= s && b.north <= n) || null;
const emptySetFor = (m, l, b) => { const box = pilotBoxFor(b); return !!box && _empty(regionalSetKey(m, l, box[0])); };
const pilotFallbackOff = () => W().__RAW_DISABLE_REGIONAL_PILOT_FALLBACK__ === true;
function pilotFallback(m, l, bboxStr, b) {
  if (pilotFallbackOff()) return trace({ l, bboxStr, pick: 'manifest_not_loaded' });
  const box = PILOT_BOXES.find(([, w, s, e, n]) => b.west >= w && b.east <= e && b.south >= s && b.north <= n);
  if (!box) return trace({ l, bboxStr, pick: 'manifest_not_loaded' });
  const key = regionalSetKey(m, l, box[0]);
  if (_empty(key)) return trace({ l, bboxStr, pick: 'empty', key });             // an explicit empty (#514): no tile exists, nothing to wait for
  if (!_listed(key)) return trace({ l, bboxStr, pick: 'manifest_not_loaded_unlisted' });
  trace({ l, bboxStr, pick: `pilot:${box[0]}` });
  return { id: box[0], bounds: { west: box[1], south: box[2], east: box[3], north: box[4] }, key, provisional: true };
}

/**
 * The 19 GFS marine pilot boxes (backend pilot_regions.py: REGIONAL_CONFIGS, WORLDWIDE_COASTAL_REGIONS, GFS_MARINE_EXTRA_REGIONS,
 * GFS_MARINE_STAGE_B_REGIONS; pinned to that file by staticRegional.test.js). A HINT only, for "could a tile cover this box"
 * before the products manifest has loaded; which tile serves a box is always decided from the manifest (pickRegionalTile).
 */
export const PILOT_BOXES = [
  ['florida_east_coast', -85, 24, -79, 31], ['us_west_coast_socal', -125, 30, -115, 38], ['hawaii', -161, 18, -154, 23],
  ['iberia_west', -11, 36, -6, 44], ['uk_ireland', -11, 49, 1, 59], ['east_australia', 150, -38, 156, -25],
  ['indonesia', 98, -11, 120, 2], ['brazil_east', -49, -27, -34, -3], ['south_africa', 17, -35, 28, -31],
  ['mexico_centralamerica_pac', -106, 8, -84, 21], ['us_southeast_midatlantic', -82, 31, -74.4, 37.5],
  ['azores', -29.8, 36, -24, 40.1], ['us_northeast', -76.1, 37.5, -69, 44.6], ['france_biscay', -6, 42.5, 1, 48.8],
  ['canaries_madeira_morocco', -19, 26, -9, 34], ['caribbean_pr_dr', -71, 12, -61, 20], ['srilanka_maldives', 72, 2, 82, 10],
  ['centralamerica_caribbean', -84, 3, -75, 11], ['us_pacific_northwest', -128, 38, -122, 49],
];
export function insidePilotBox(b) {
  return !!b && PILOT_BOXES.some(([, w, s, e, n]) => b.west >= w && b.east <= e && b.south >= s && b.north <= n);
}

/** Opt-in decision trace (diagnostics only): set window.__RAW_STATIC_REGIONAL_TRACE__ = [] and every tile pick is appended
 *  (layer, box, the tile or why none), capped at 500. Free when unset. Always returns null (the callers' "no tile"). */
export function trace(rec) {
  const t = W().__RAW_STATIC_REGIONAL_TRACE__;
  if (Array.isArray(t) && t.length < 500) t.push({ t: Math.round(typeof performance !== 'undefined' ? performance.now() : 0), ...rec });
  return null;
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
  // Covered: the request lies inside the served lattice (the server's partial_coverage test, margin 0) AND so does its SNAPPED
  // box. The server's dynamic cache (grid_resolver Steps 1-2, ahead of the tile) is keyed on the snapped box; on a tile whose
  // edge is not a whole degree a PARTIAL cover can snap to the same key as a full one, and its background sharpen would then
  // answer the full one dynamically. With the snapped box inside the data no partial cover shares the key. On whole-degree
  // tiles the two tests agree.
  const e9 = 1e-9;
  const snapInside = snapped[0] >= b.west - e9 && snapped[2] <= b.east + e9 && snapped[1] >= b.south - e9 && snapped[3] <= b.north + e9;
  const covers = snapInside && win.bounds.west <= rw && win.bounds.east >= re && win.bounds.south <= rs && win.bounds.north >= rn;
  return { ...win, covers, snapInside, snapped: snapped.map((x) => x.toFixed(4)).join(',') };
}

// ── The bundle: one fetch per bundle path (raw bytes; never inflated whole), slices checked and inflated one by one ──────
// Concurrent asks for one path share one fetch (the path is content-addressed: one run of one box). A failed fetch is remembered
// per path: a 429, a 5xx, a network or CORS error or the timeout backs off 30 s -> 2 min -> 10 min -> 30 min (BUNDLE_BACKOFF_STEPS_MS,
// a longer Retry-After wins), and asks inside the backoff get { status: 'backoff' } at once, with no request and no stale mark;
// a 404 / 400 or a slice whose sha12 does not match is a DEAD path for this pin (BUNDLE_DEAD_MS) and is passed on once as such
// (status 404 / 400 / 'integrity'), which re-pins. So a 429 or an outage costs one request per backoff step, not one per hour (and
// per latest.json re-read) of every page.
export const BUNDLE_TIMEOUT_MS = 8000;                  // the floor; a large bundle gets its size at 150 KB/s (brazil_east ~2.5 MB)
export const bundleTimeoutMs = (bytes) => Math.max(BUNDLE_TIMEOUT_MS, Math.ceil((Number(bytes) || 0) / 150));
export const BUNDLE_BACKOFF_STEPS_MS = [30000, 120000, 600000, 1800000];
export const BUNDLE_BACKOFF_MS = BUNDLE_BACKOFF_STEPS_MS[0];
export const BUNDLE_DEAD_MS = 1800000;
const _bundles = new Map();           // path -> Promise<{ buf } | { status, error, retryAfterMs }>
const _failed = new Map();            // path -> { until, n, status }

function retryAfterMs(res) {
  const h = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
  if (!h) return 0;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

async function fetchBundle(url, { bytes, priority } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bundleTimeoutMs(bytes));
  try {
    const opts = { credentials: 'omit', signal: controller.signal };
    if (priority) opts.priority = priority;                 // fetch priority: ignored where unsupported
    const res = await fetch(url, opts);
    if (!res.ok) return { status: res.status, error: `bundle_http_${res.status}`, retryAfterMs: retryAfterMs(res) };
    const buf = await res.arrayBuffer();
    const r = regionalTelemetry();
    r.bundles += 1; r.bundleBytes += buf.byteLength;
    return { buf };
  } catch (e) {
    return { status: 0, error: controller.signal.aborted ? 'bundle_timeout' : 'bundle_fetch_error' };
  } finally {
    clearTimeout(timer);
  }
}

/** A bundle whose bytes do not match its index (a slice's sha12): dropped, and dead for this pin. */
function markBundleBad(path) {
  _bundles.delete(path);
  _failed.set(path, { n: BUNDLE_BACKOFF_STEPS_MS.length, status: 'integrity', until: Date.now() + BUNDLE_DEAD_MS });
}

/** Is this bundle path inside a failure backoff right now? (Synchronous.) */
export function bundleBackingOff(path) {
  const f = _failed.get(path);
  return !!(f && Date.now() < f.until);
}

function bundleFor(base, path, opts) {
  const f = _failed.get(path);
  if (f && Date.now() < f.until) { noteRegionalMiss('bundle_backoff'); return Promise.resolve({ status: 'backoff', error: 'bundle_backoff' }); }
  let p = _bundles.get(path);
  if (p) { _bundles.delete(path); _bundles.set(path, p); return p; }
  p = fetchBundle(base + path, opts).then((got) => {
    if (got.buf) { _failed.delete(path); return got; }
    noteRegionalMiss(got.error);
    const n = (f ? f.n : 0) + 1;
    const dead = got.status === 404 || got.status === 400;
    const step = BUNDLE_BACKOFF_STEPS_MS[Math.min(n, BUNDLE_BACKOFF_STEPS_MS.length) - 1];
    _failed.set(path, { n, status: got.status, until: Date.now() + (dead ? BUNDLE_DEAD_MS : Math.max(step, got.retryAfterMs || 0)) });
    if (_bundles.get(path) === p) _bundles.delete(path);
    return got;
  });
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
 * `frame.bundle` = { path, offset, length, sha12 } (staticFrames.loadIndex sets it). Never throws. `status` is the HTTP status
 * (0 for a network / CORS error or the timeout, 'backoff' inside a failure backoff, 'integrity' for a sha12 mismatch): a 404,
 * 400 or 'integrity' re-pins, nothing else does. `priority` ('high' | 'low') applies to the bundle fetch it starts.
 */
export async function regionalFrameBytes(base, frame, signal, priority) {
  const s = frame && frame.bundle;
  if (!s || !Number.isFinite(s.offset) || !Number.isFinite(s.length)) return { error: 'not_a_bundle_frame' };
  if (signal && signal.aborted) return { error: 'aborted' };
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const got = await bundleFor(base, s.path, { bytes: s.bytes, priority });
  if (!got.buf) return { error: got.error || 'bundle_unavailable', status: got.status };
  const buf = got.buf;
  if (s.offset + s.length > buf.byteLength) { noteRegionalMiss('slice_out_of_range'); return { error: 'slice_out_of_range' }; }
  const slice = new Uint8Array(buf, s.offset, s.length);
  let sum = null;
  try { sum = await sha12Of(slice); } catch (e) { sum = null; }
  // FAIL CLOSED: bytes whose sha12 cannot be checked are never decoded (the caller asks the backend).
  if (sum === null) { noteRegionalMiss('sha12_unavailable'); return { error: 'sha12_unavailable' }; }
  if (sum !== s.sha12) { noteRegionalMiss('sha12_mismatch'); markBundleBad(s.path); return { error: 'sha12_mismatch', status: 'integrity' }; }
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let inflated = null;
  try { inflated = await gunzip(slice); } catch (e) { noteRegionalMiss('gunzip_error'); return { error: 'gunzip_error' }; }
  if (!inflated) { noteRegionalMiss('no_decompression_stream'); return { error: 'no_decompression_stream' }; }
  regionalTelemetry().slices += 1;
  return { buffer: inflated, wire: 0, fetchMs: t1 - t0, inflateMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t1 };
}

/** The index frames of a bundle set get a `bundle` slice record and a unique `path` (`<bundle>#<offset>`) for the shared loader. */
export function normalizeBundleIndex(idx) {
  if (!idx || !idx.bundle || !idx.bundle.path || !Array.isArray(idx.frames)) return idx;
  for (const f of idx.frames) {
    if (f.offset === null || f.offset === undefined) { f.path = null; continue; }
    f.bundle = { path: idx.bundle.path, bytes: idx.bundle.bytes, offset: f.offset, length: f.length, sha12: f.sha12 };
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
  _failed.clear();
  _stats = freshStats();
}

export function _setRegionalCodecForTest({ sha12 = null, gunzip: gz = null } = {}) {
  _codec.sha12 = sha12; _codec.gunzip = gz;
}
