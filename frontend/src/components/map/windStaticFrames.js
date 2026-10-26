/**
 * windStaticFrames.js — GFS WIND from the CDN instead of the 1-CPU backend (2026-10-22, the owner: "wind is not immediately
 * instant scrub upon toggling over to that layer").
 *
 * WHY. Toggling to wind asked /grid for the 2-degree world base and the viewport clip of the same product, then a /grid_series
 * page per 48 hours (~10-25 s of the box each, a thinned 46 x 21 picture when it lands); every scrub step before those pages
 * landed asked /grid again. The publisher now writes the GFS wind world field (global_mid, 3-hourly, 181 x 83) as static frames
 * beside the marine sets (backend/services/frame_set_wind.py), each frame the stored product WITH THE HRRR LANE APPLIED exactly
 * as /grid applies it (D-017), parity-checked node by node. This module turns a frame back into the /grid response:
 *   - the WORLD box (span >= 340): the whole frame;
 *   - a VIEWPORT box the resolver answers from global_mid (larger span over the wind sharpen cap, 20 deg, and at most the
 *     client's own 180-deg band, no antimeridian, no regional wind tile that could win): the mid tier's clip of the frame
 *     (staticFrameCrop.midClipWindow: the server's snap, pad and lattice arithmetic), with the lane stamp rebuilt for the clip;
 *   - anything else (a close zoom the dynamic lane sharpens, another model): null, and /grid serves it as before.
 * THE LANE CHECK. The frames carry the lane the publisher read; the serve box re-reads the lane every 300 s and a new HRRR cycle
 * lands ~4 times a day. `v1/wind_lane.json` (written by the ingest after each lane publish) names the lane the box loads. A frame
 * whose valid time lies inside either lane's window, or whose values carry HRRR, is served only when that pointer names the
 * frames' own lane and is older than LANE_SETTLE_MS (the box's re-read); otherwise /grid serves the hour. A frame outside both
 * windows is GFS on both sides, and its stamp is rebuilt from the pointer's lane, as /grid stamps it.
 * Nothing here can reach the backend. Kills (read per call): window.__RAW_DISABLE_WIND_STATIC_FRAMES__ = true (wind only),
 * window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = ['GFS/wind/wind/global_mid'], or the global __RAW_DISABLE_STATIC_FRAMES__;
 * window.__RAW_DISABLE_WIND_STATIC_LANE_HOURS__ = true keeps only the hours the HRRR lane can touch on /grid.
 * Telemetry: window.__RAW_WIND_STATIC__.
 */
import {
  staticFramesEnabled, staticFramesBase, staticSetEnabled, getPinnedIndex, loadFrameParsed, fetchFrameBytes,
} from './staticFrames';
import { buildWindVectors, frameMeta, gridJsonFromFrame, parseFrame, pickIndexFrame } from './staticFrameCodec';
import { cropGridJson, cropVectors, gridBboxParam, midClipWindow, parseBboxString } from './staticFrameCrop';
import { clampViewportBbox, getAvailableTilesFromManifest } from './backendWeatherServiceClientCoverage';
import { buildTruthTag, seedJsDataHash } from './weatherTruthTracker';
import { BACKEND_URL } from '../../lib/apiClient';

export const WIND_SET_KEY = 'GFS/wind/wind/global_mid';
export const LANE_POINTER_PATH = 'v1/wind_lane.json';
const WORLD_MIN_SPAN = 340;
export const WIND_REVAL_MAX_SPAN = 20;   // mid_res_tier WIND_MID_REVAL_MAX_SPAN: at or under it /grid sharpens (a dynamic product)
const WIND_MAX_CROP_SPAN = 180;          // the client's wind band ceiling (backendWeatherServiceClientCoverage, wideMax)
const WIDER_EPS = 0.05;                  // decide_manifest_product's "wider than the tile" slack
export const LANE_SETTLE_MS = 330000;    // the box re-reads the lane index every 300 s (WIND_HRRR_LANE_INDEX_TTL_S) + slack
const POINTER_TTL_MS = 120000;
const POINTER_NEG_MS = 60000;
const POINTER_NEG_MAX_MS = 900000;
const BOX_MAX_AGE_MS = 300000;           // a box-lane read older than this confirms nothing (the box re-reads its lane every 300 s)
export const BOX_LANE_PATH = '/api/weather/wind_lane';
const BUILT_MAX = 10;                    // built grids kept (a step's idle pre-build fills ~6; each ~15k objects, ~1.5 MB)

const W = () => (typeof window !== 'undefined' ? window : {});

export function windStaticEnabled() {
  if (!staticFramesEnabled() || !staticFramesBase()) return false;
  if (W().__RAW_DISABLE_WIND_STATIC_FRAMES__ === true) return false;
  return staticSetEnabled(WIND_SET_KEY);
}

function tel() {
  const w = W();
  if (!w.__RAW_WIND_STATIC__) {
    w.__RAW_WIND_STATIC__ = { hits: 0, syncHits: 0, crops: 0, misses: {}, laneRefused: 0, pointer: null, pin: null,
      raw: 0, rawBytes: 0, buildMs: [] };
  }
  return w.__RAW_WIND_STATIC__;
}
function miss(reason) { const t = tel(); t.misses[reason] = (t.misses[reason] || 0) + 1; return null; }
const spanLng = (b) => (b ? ((b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west) : 0);
const nowMs = () => Date.now();
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; };
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ── the pinned index, mirrored synchronously ─────────────────────────────────────────────────────────────────────────────────
const _s = { index: null, indexAt: 0, pinLoad: null, ptr: null, ptrAt: 0, ptrLoad: null, ptrFails: 0, raw: new Map(), built: new Map(),
  box: null, boxAt: 0, boxLoad: null, boxFails: 0, rebuilt: null };

/**
 * The lane-window rebuild the lane pointer names (`frames`: {index, run, lane}; backend frame_set_wind_rebuild.py, written by
 * the core lane right after a new HRRR lane), when it is the SAME run as the published index and carries the pointer's lane
 * where the published index does not. Else null. The rebuilt index is immutable: fetched once per path.
 * Kill: window.__RAW_DISABLE_WIND_LANE_REBUILT_INDEX__ = true (the published index only; lane hours then wait for the pilots).
 */
async function rebuiltIndexFor(idx) {
  const ptr = _s.ptr; const f = ptr && ptr.frames;
  if (!idx || !f || !f.index || f.lane !== ptr.key || f.run !== idx.run) return null;
  if ((idx.wind_lane || {}).key === ptr.key || W().__RAW_DISABLE_WIND_LANE_REBUILT_INDEX__ === true) return null;
  if (_s.rebuilt && _s.rebuilt.path === f.index) return _s.rebuilt;
  try {
    const r = await fetch(staticFramesBase() + f.index, { credentials: 'omit' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.frames) || j.run !== idx.run || (j.wind_lane || {}).key !== ptr.key) return null;
    j.path = j.path || f.index;
    _s.rebuilt = j;
    return j;
  } catch (e) {
    return null;
  }
}

/** The pinned wind index (async; staticFrames' pin rules: one index per scrub session, re-pinned when idle), or the pointer's
 * lane-window rebuild of that same run (rebuiltIndexFor). */
export async function windIndex() {
  if (!windStaticEnabled()) return null;
  try {
    let idx = await getPinnedIndex(WIND_SET_KEY);
    idx = (await rebuiltIndexFor(idx)) || idx;
    if (idx && idx !== _s.index) {
      _s.index = idx;
      _s.indexAt = nowMs();
      for (const p of _s.raw.keys()) if (!idx.frames.some((f) => f.path === p)) _s.raw.delete(p);   // another run's bytes
      _s.built.clear();
      tel().pin = { index: idx.path || null, run: idx.run || null, frames: idx.frames.length, lane: idx.wind_lane ? idx.wind_lane.key : null };
    }
    return idx;
  } catch (e) {
    return null;
  }
}

/** The pinned index right now, or null. Synchronous; no I/O. */
export function windIndexSync() { return windStaticEnabled() ? _s.index : null; }

// ── the box's lane: v1/wind_lane.json (what L2 names) + GET /api/weather/wind_lane (what the box holds) ─────────────────────────
/**
 * The lane pointer, re-read with the box's own lane (both on the same TTL; every caller of the pointer gets both). The pointer
 * names the lane L2 holds; the box can hold an older one (2026-10-23: its lane refresh was lazy, and the box kept a 19 h old
 * HRRR cycle for ~5 h), so a lane-window hour is served only when the BOX's lane equals the frames' (laneVerdict).
 */
export async function readLanePointer(force = false) {
  const [ptr] = await Promise.all([readPointerOnly(force), readBoxLane(force)]);
  return ptr;
}

async function readPointerOnly(force) {
  const base = staticFramesBase();
  if (!base) return null;
  const now = nowMs();
  const ttl = _s.ptr ? POINTER_TTL_MS : Math.min(POINTER_NEG_MAX_MS, POINTER_NEG_MS * 2 ** Math.max(0, _s.ptrFails - 1));
  if (!force && _s.ptrAt && now - _s.ptrAt < ttl) return _s.ptr;
  if (_s.ptrLoad) return _s.ptrLoad;
  _s.ptrLoad = fetch(base + LANE_POINTER_PATH, { cache: 'no-cache', credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error(`http_${r.status}`); return r.json(); })
    .then((j) => { _s.ptr = j && j.key ? j : null; _s.ptrAt = nowMs(); _s.ptrFails = 0; tel().pointer = _s.ptr && { key: _s.ptr.key, written_at: _s.ptr.written_at }; return _s.ptr; })
    .catch(() => { _s.ptrAt = nowMs(); _s.ptrFails += 1; return _s.ptr; })
    .finally(() => { _s.ptrLoad = null; });
  return _s.ptrLoad;
}

/** GET /api/weather/wind_lane (wind_lane.box_state: no I/O on the box, cached 60 s); the last good read, or null. */
export async function readBoxLane(force = false) {
  const now = nowMs();
  const ttl = _s.box ? POINTER_TTL_MS : Math.min(POINTER_NEG_MAX_MS, POINTER_NEG_MS * 2 ** Math.max(0, _s.boxFails - 1));
  if (!force && _s.boxAt && now - _s.boxAt < ttl) return _s.box;
  if (_s.boxLoad) return _s.boxLoad;
  _s.boxLoad = fetch(`${BACKEND_URL}${BOX_LANE_PATH}`, { credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error(`http_${r.status}`); return r.json(); })
    .then((j) => { _s.box = j && typeof j === 'object' && 'key' in j ? j : null; _s.boxAt = nowMs(); _s.boxFails = 0; tel().box = _s.box && { key: _s.box.key, at: _s.boxAt }; return _s.box; })
    .catch(() => { _s.boxFails += 1; _s.boxAt = nowMs(); _s.box = null; return null; })   // unknown: lane hours ask /grid
    .finally(() => { _s.boxLoad = null; });
  return _s.boxLoad;
}

const laneBase = (lane) => ({ lane: 'gfs', feather_km: lane.feather_km, taper_hours: lane.taper_hours, hrrr_cycle: lane.cycle,
  hrrr_horizon: lane.horizon, source: lane.source });

/**
 * The HRRR lane the serve box blends with (wind_lane.box_state: {enabled, feather_km, taper_hours, key, cycle, horizon, ...}):
 * the last GET /api/weather/wind_lane read when it is under BOX_MAX_AGE_MS old, else /capabilities' GFS wind row `wind_lane`
 * (LayerAccessResolver keeps the matrix in window.__WEATHER_CAPABILITIES__; read once per page, so its key is not trusted), or
 * null when neither is known.
 */
export function boxLane() {
  if (_s.box && nowMs() - _s.boxAt < BOX_MAX_AGE_MS) return _s.box;
  try {
    const rows = W().__WEATHER_CAPABILITIES__;
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => r && r.model === 'GFS' && r.domain === 'wind' && r.wind_lane && typeof r.wind_lane === 'object');
    if (!row) return null;
    const constants = { ...row.wind_lane };   // constants only: its key is a page-load snapshot, never a confirmation
    delete constants.key; delete constants.cycle; delete constants.horizon;
    return constants;
  } catch (e) {
    return null;
  }
}

/**
 * May this frame be served, and with which world lane stamp? Returns { stamp } or { refuse: reason }. Pure given its inputs:
 * `index` (its `wind_lane` = the frames' lane), `frame`, `ptr` (the box's lane, v1/wind_lane.json), `now`, `box` (boxLane()).
 */
export function laneVerdict(index, frame, ptr, now = nowMs(), box = boxLane()) {
  if (!ptr || !ptr.key) return { refuse: 'no_lane_pointer' };
  // A box serving with the lane switched off (WIND_HRRR_LANE=0) stamps every hour differently: /grid serves them all.
  if (box && box.enabled === false) return { refuse: 'box_lane_off' };
  const meta = frameMeta(index, frame);
  const own = meta.wind_lane || null;
  const vt = ms(frame.valid_time);
  const frames = index.wind_lane || null;
  const settled = Number.isFinite(ms(ptr.written_at)) && now - ms(ptr.written_at) >= LANE_SETTLE_MS;
  const same = !!(frames && frames.key === ptr.key && frames.feather_km === ptr.feather_km && frames.taper_hours === ptr.taper_hours);
  const inWindow = (lane) => !!lane && vt >= ms(lane.cycle) && vt <= ms(lane.horizon);
  const held = box && box.key ? box : null;           // the lane in the box's memory, when the box said which
  const touched = inWindow(ptr) || inWindow(frames) || inWindow(held) || !!(own && own.lane === 'hrrr+gfs');
  // KILL for a box that failed to re-read its lane (it would keep an older one past the 330 s settle): every hour the lane can
  // touch asks /grid. window.__RAW_DISABLE_WIND_STATIC_LANE_HOURS__ = true.
  if (touched && W().__RAW_DISABLE_WIND_STATIC_LANE_HOURS__ === true) return { refuse: 'lane_hours_killed' };
  // A lane hour is served only when the box says it blends the frames' OWN lane (key) with the frames' constants. Unknown (no
  // fresh box read, an older server) is not confirmed: /grid serves it.
  const boxSame = !!(held && box.enabled === true && frames && held.key === frames.key && box.feather_km === frames.feather_km
    && box.taper_hours === frames.taper_hours);
  if (touched && !boxSame) return { refuse: held ? 'box_lane_differs' : 'box_lane_unconfirmed' };
  if (touched) return same && settled && own ? { stamp: own } : { refuse: same ? 'lane_unsettled' : 'lane_mismatch' };
  // GFS on both sides. The frame's own stamp names the frames' lane: /grid's, unless the box holds another one.
  if (same && settled && own && (!held || held.key === frames.key)) return { stamp: own };
  // GFS on both sides: /grid's stamp names the box's lane (the one it holds when it said, else the pointer's).
  const named = held || ptr;
  return { stamp: { ...laneBase(named), valid_time: iso(vt), reason: vt < ms(named.cycle) ? 'before_hrrr_cycle' : 'beyond_hrrr_horizon' } };
}

/** The lane stamp /grid puts on a CLIP of the frame: the nodes the lane touched inside the window decide it (wind_lane._blend). */
function cropStamp(world, laneW, vectors, gridCols, win) {
  if (!world || world.lane !== 'hrrr+gfs' || !laneW) return world;
  let cells = 0; let full = 0; let maxW = 0;
  for (let r = win.r0; r <= win.r1; r++) {
    for (let c = win.c0; c <= win.c1; c++) {
      const i = r * gridCols + c; const w = laneW[i];
      if (!(w > 0)) continue;
      cells += 1;
      if (w > maxW) maxW = w;
      if (w >= 0.9999 && vectors[i] && vectors[i].is_valid !== false) full += 1;
    }
  }
  const { hrrr_cells: _a, hrrr_full_cells: _b, max_weight: _c, lane: _d, ...info } = world;
  if (!cells) return { ...info, lane: 'gfs', reason: 'outside_hrrr_domain' };
  return { ...info, lane: 'hrrr+gfs', hrrr_cells: cells, hrrr_full_cells: full, max_weight: Math.round(maxW * 1e4) / 1e4 };
}

// ── which boxes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** mid_res_tier._request_span: the larger of the longitude and latitude spans. */
function requestSpan(w, s, e, n) { return Math.max(w <= e ? e - w : (180 - w) + (e + 180), Math.abs(n - s)); }

/** Is this /grid box answered from global_mid by the resolver, so the static frame (or its clip) IS the answer? */
export function windBoxKind(model, bbox) {
  if (String(model || 'GFS').toUpperCase() !== 'GFS' || !bbox) return null;
  if (spanLng(bbox) >= WORLD_MIN_SPAN) return 'world';
  if (W().__RAW_DISABLE_STATIC_MID_CROP__ === true || W().__RAW_DISABLE_WIND_STATIC_CROP__ === true) return null;
  const req = parseBboxString(gridBboxParam(bbox));
  if (!req) return null;
  const [w, s, e, n] = req;
  if (!(w >= -180 && e <= 180 && w < e && s < n)) return null;                 // no crossing, nothing past +-180
  const span = requestSpan(w, s, e, n);
  if (!(span > WIND_REVAL_MAX_SPAN) || (e - w) > WIND_MAX_CROP_SPAN) return null;
  const { tiles, fallbackReason } = getAvailableTilesFromManifest(model, 'wind', 'wind');
  if (fallbackReason || !Array.isArray(tiles)) return null;                     // no manifest yet: /grid decides
  for (const t of tiles) {
    const c = t && t.bounds;
    if (!c || ![c.west, c.south, c.east, c.north].every(Number.isFinite)) return null;
    const tLng = c.west <= c.east ? c.east - c.west : (180 - c.west) + (c.east + 180);
    if (tLng >= 350) continue;                                                  // a world product
    const wraps = c.west > c.east;
    const overlaps = wraps || (Math.min(e, c.east) > Math.max(w, c.west) && Math.min(n, c.north) > Math.max(s, c.south));
    if (!overlaps) continue;
    if (t.is_estimated || t.isEstimated) return null;                           // an estimated item is served at any width
    if (!((e - w) > tLng + WIDER_EPS || (n - s) > Math.abs(c.north - c.south) + WIDER_EPS)) return null;
  }
  return 'crop';
}

/**
 * Does the viewport still need /grid once the static WORLD frame of its hour is drawn? False where /grid's own answer is that
 * frame or its clip (world and mid-zoom boxes); true at close zooms, where /grid sharpens to a finer product the CDN cannot hold.
 */
export function windViewportNeedsGrid(model, bounds) {
  try {
    const c = bounds ? clampViewportBbox(bounds, 'wind', model || 'GFS', 'wind') : null;
    if (!c || !c.isInside || !c.clampedBbox) return true;
    return !windBoxKind(model || 'GFS', c.clampedBbox);
  } catch (e) {
    return true;
  }
}

// ── the frame's bytes: kept raw (~60-90 KB each; parsed on use) ──────────────────────────────────────────────────────────────
/** Keep a fetched frame's decompressed bytes (the prefetcher and the on-demand load both land here). */
export function keepRaw(path, buffer) {
  if (!path || !buffer || _s.raw.has(path)) return;
  _s.raw.set(path, buffer);
  const t = tel(); t.raw = _s.raw.size; t.rawBytes += buffer.byteLength || 0;
}
export function hasRaw(path) { return _s.raw.has(path); }

async function loadRaw(frame, signal) {
  if (_s.raw.has(frame.path)) return _s.raw.get(frame.path);
  const got = await loadFrameParsed(WIND_SET_KEY, frame, signal);   // shared per-path fetch (staticFrames), one request per path
  if (!got || !got.buffer) return null;
  keepRaw(frame.path, got.buffer);
  return got.buffer;
}

/** The fetcher for the prefetcher: one immutable frame's bytes, kept here when it lands. */
export async function fetchWindFrame(path, signal) {
  const got = await fetchFrameBytes(staticFramesBase() + path, signal);
  if (got && got.buffer) keepRaw(path, got.buffer);
  return got;
}

// ── frame -> the /grid JSON ──────────────────────────────────────────────────────────────────────────────────────────────────
function build(index, frame, buffer, stamp, { askIso, bbox, kind }) {
  const key = `${frame.path}|${kind === 'crop' ? gridBboxParam(bbox) : 'world'}|${stamp ? JSON.stringify(stamp) : ''}|${askIso}`;
  const hit = _s.built.get(key);
  if (hit) return hit;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const parsed = parseFrame(buffer);
  if (Math.abs(parsed.validEpoch * 1000 - ms(frame.valid_time)) > 1000) throw new Error('frame/index valid_time mismatch');
  const { vectors, laneW } = buildWindVectors(parsed);
  const grid = frame.grid || index.grid;
  let json = gridJsonFromFrame(index, frame, vectors, { askIso, requestedBbox: kind === 'world' ? bbox : null });
  json.wind_lane = stamp || null;
  if (kind === 'crop') {
    const win = midClipWindow(gridBboxParam(bbox), grid, 'GFS');
    if (!win) return miss('crop_unmirrored');
    json = cropGridJson(json, win, cropVectors(vectors, grid.cols, win));
    json.wind_lane = cropStamp(stamp, laneW, vectors, grid.cols, win);
    tel().crops += 1;
  }
  // The frame is content-addressed: its sha256 (+ the crop window) names these vectors, so the truth tag's data hash takes
  // that instead of string-hashing every vector (weatherTruthTracker.seedJsDataHash). Kill: __RAW_DISABLE_WIND_FRAME_HASH_SEED__.
  if (frame.sha256 && W().__RAW_DISABLE_WIND_FRAME_HASH_SEED__ !== true) {
    seedJsDataHash(json.grid && json.grid.vectors, json.layer, `${frame.sha256}|${kind === 'crop' ? gridBboxParam(bbox) : 'world'}`);
  }
  try { json.truthTag = buildTruthTag(json, 'staticFrame'); } catch (e) { json.truthTag = null; }
  if (t0) { const b = tel().buildMs; b.push(Math.round((performance.now() - t0) * 10) / 10); if (b.length > 64) b.shift(); }
  _s.built.set(key, json);
  while (_s.built.size > BUILT_MAX) _s.built.delete(_s.built.keys().next().value);
  return json;
}

function pick(index, askIso, bbox, model) {
  const kind = windBoxKind(model, bbox);
  if (!kind) return { refuse: 'box' };
  const frame = pickIndexFrame(index, ms(askIso));
  if (!frame) return { refuse: 'no_frame_in_window' };
  if (!frame.path) return { refuse: 'unbuilt_frame' };     // /grid serves this hour; never a neighbouring frame
  const v = laneVerdict(index, frame, _s.ptr);
  if (v.refuse) { if (v.refuse !== 'no_lane_pointer') tel().laneRefused += 1; return { refuse: v.refuse }; }
  return { kind, frame, stamp: v.stamp };
}

/**
 * Seam A: the /grid JSON for a wind request from the pinned static frame, or null (the caller fetches /grid). Async: it may pin
 * the index, read the lane pointer and fetch the frame (CDN only).
 */
export async function tryStaticWindGrid({ model, validTimeStr, clampedBbox, signal }) {
  if (!windStaticEnabled()) return null;
  if (!windBoxKind(model, clampedBbox)) return null;
  try {
    const [index] = await Promise.all([windIndex(), readLanePointer(false)]);
    if (!index) return miss('no_index');
    const p = pick(index, validTimeStr, clampedBbox, model);
    if (p.refuse) return miss(p.refuse);
    const buffer = await loadRaw(p.frame, signal);
    if (!buffer) return miss('fetch');
    const json = build(index, p.frame, buffer, p.stamp, { askIso: validTimeStr, bbox: clampedBbox, kind: p.kind });
    if (json) tel().hits += 1;
    return json;
  } catch (e) {
    return miss('error');
  }
}

/**
 * The same, SYNCHRONOUSLY, from bytes already here (the idle prefetch or an earlier load), or null. No I/O: what the scrub drag
 * path and the warm commits call on every step.
 */
export function staticWindGridSync({ model, validTimeStr, clampedBbox }) {
  if (!windStaticEnabled() || !_s.index) return null;
  try {
    const p = pick(_s.index, validTimeStr, clampedBbox, model);
    if (p.refuse) return null;
    const buffer = _s.raw.get(p.frame.path);
    if (!buffer) return null;
    const json = build(_s.index, p.frame, buffer, p.stamp, { askIso: validTimeStr, bbox: clampedBbox, kind: p.kind });
    if (json) tel().syncHits += 1;
    return json;
  } catch (e) {
    return null;
  }
}

/** Can every hour of `askIsos` be served statically right now (pinned, lane-cleared, built)? For skipping a series page. */
export function staticWindCovers(askIsos, model = 'GFS') {
  const index = windIndexSync();
  if (!index || String(model).toUpperCase() !== 'GFS') return false;
  return askIsos.every((a) => {
    const f = pickIndexFrame(index, ms(a));
    return !!(f && f.path && !laneVerdict(index, f, _s.ptr).refuse);
  });
}

/** Test hook. */
export function _resetWindStaticForTest() {
  _s.index = null; _s.indexAt = 0; _s.pinLoad = null; _s.ptr = null; _s.ptrAt = 0; _s.ptrLoad = null; _s.ptrFails = 0;
  _s.box = null; _s.boxAt = 0; _s.boxLoad = null; _s.boxFails = 0; _s.rebuilt = null;
  _s.raw.clear(); _s.built.clear();
  if (typeof window !== 'undefined') delete window.__RAW_WIND_STATIC__;
}
/** Test hook: install a lane pointer without I/O. */
export function _setLanePointerForTest(ptr) { _s.ptr = ptr; _s.ptrAt = nowMs(); }
export function _setBoxLaneForTest(box) { _s.box = box; _s.boxAt = box ? nowMs() : 0; }
