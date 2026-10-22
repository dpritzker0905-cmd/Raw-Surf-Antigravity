/**
 * staticFrames.js — load forecast frames from the CDN instead of the 1-CPU backend (step 2b, 2026-10-20). ON by default
 * since 2026-10-21 (owner: "turn on static frames"; DECISIONS).
 *
 * The ingest runner publishes the world-view GFS wave field once per model run as immutable gzipped binary frames
 * in the PUBLIC Supabase bucket `weather-frames` (backend/scripts/publish_frame_images.py):
 *   v1/latest.json                        no-cache pointer: { sets: { 'GFS/marine/waves/global_mid': { index } } }
 *   <index path>                          immutable run index: frames, product identity, metadata
 *   <frame path>                          immutable gzipped frame (~55 KB; staticFrameCodec.js decodes it)
 * Two seams use it, and both fall back to the backend exactly as before on ANY miss or error:
 *   A. backendWeatherServiceClient.fetchBackendMarineGrid, world boxes: tryStaticWorldGrid -> the /grid JSON.
 *   B. marineGridSeries.loadSeriesPage, world pages: staticSeriesFrames -> full-resolution series frames.
 * One index is PINNED for a scrub session: a new run never replaces frames mid-scrub. The pin moves only after the
 * scrub has been idle for IDLE_REPIN_MS (a 'raw_static_frames_new_run' event announces a waiting run), or when a
 * frame of the pinned index is gone (retention keeps the current and previous index only).
 *
 * It served dark until the owner's word: during a scrub the series path draws the THINNED world frame (46 x 21, an
 * 8-degree lattice) and static frames draw the full 2-degree field, the same numbers /grid serves for the exact frame
 * (parity-gated node by node at publish), so no served number moves.
 *   KILL: window.__RAW_DISABLE_STATIC_FRAMES__ = true restores the /grid path exactly (wins over everything).
 *   THIS BROWSER: localStorage '__RAW_STATIC_FRAMES__' = 'false' (off) or 'true' (on).
 *   BUILD: REACT_APP_STATIC_FRAMES=false turns the default off; without REACT_APP_SUPABASE_URL (or the base override)
 *   nothing is eligible, synchronously.
 *   CDN:  window.__RAW_STATIC_FRAMES_BASE__ overrides the bucket's public URL (the offline harness's local host).
 * Telemetry: window.__RAW_STATIC_FRAMES__ (hits, misses by reason, bytes, fetch/inflate/build ms, the pin).
 */
import {
  buildVectors, gridJsonFromFrame, isGzip, parseFrame, pickIndexFrame, seriesFrameFromFrame,
} from './staticFrameCodec';
import { buildTruthTag } from './weatherTruthTracker';

export const FRAME_BUCKET = 'weather-frames';
export const LATEST_PATH = 'v1/latest.json';
const IDLE_REPIN_MS = 30000;      // a pin may move only after this long without a static-frame request
const LATEST_TTL_MS = 120000;     // and latest.json is re-read at most this often
const LRU_MAX = 12;               // decoded frames kept (each ~15k vector objects, a few MB of heap)
const MAX_IN_FLIGHT = 4;
const WORLD_MIN_SPAN = 340;

function readBuildDefault() {
  try { return process.env.REACT_APP_STATIC_FRAMES !== 'false'; } catch (e) { return true; }
}

/** ON by default (owner, 2026-10-21). Kill switch first, then this browser's explicit choice, then the build default. */
export function staticFramesEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__RAW_DISABLE_STATIC_FRAMES__ === true) return false;
  try {
    const choice = window.localStorage && window.localStorage.getItem('__RAW_STATIC_FRAMES__');
    if (choice === 'true') return true;
    if (choice === 'false') return false;
  } catch (e) { /* storage blocked: the build default decides */ }
  return readBuildDefault();
}

export function staticFramesBase() {
  if (typeof window !== 'undefined' && typeof window.__RAW_STATIC_FRAMES_BASE__ === 'string') {
    return window.__RAW_STATIC_FRAMES_BASE__.replace(/\/+$/, '') + '/';
  }
  const sb = process.env.REACT_APP_SUPABASE_URL;
  return sb ? `${sb.replace(/\/+$/, '')}/storage/v1/object/public/${FRAME_BUCKET}/` : null;
}

function telemetry() {
  if (typeof window === 'undefined') return { misses: {} };
  if (!window.__RAW_STATIC_FRAMES__) {
    window.__RAW_STATIC_FRAMES__ = {
      hits: 0, seriesFrames: 0, misses: {}, errors: 0, bytes: 0, fetches: 0, lruHits: 0,
      fetchMs: [], inflateMs: [], buildMs: [], pin: null, newRunWaiting: null, lastMiss: null, worker: null,
    };
  }
  return window.__RAW_STATIC_FRAMES__;
}

function noteMiss(reason) {
  const t = telemetry();
  t.misses[reason] = (t.misses[reason] || 0) + 1;
  t.lastMiss = { reason, at: Date.now() };
}

function pushSample(arr, v) {
  arr.push(Math.round(v * 10) / 10);
  if (arr.length > 64) arr.shift();
}

// ── Fetch + inflate, off the main thread when a Worker exists ───────────────────────────────────────────────
// The worker is an inline Blob (no bundler entry, nothing for Jest to resolve): fetch, check the gzip magic bytes
// (1f 8b: the bucket stores gzipped bytes WITHOUT a Content-Encoding header, so the browser hands them over raw),
// inflate with DecompressionStream, and TRANSFER the ArrayBuffer back (zero-copy).
const WORKER_SRC = `
const ctl = new Map();
self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.abort) { const c = ctl.get(m.id); if (c) c.abort(); return; }
  const c = new AbortController(); ctl.set(m.id, c);
  const t0 = performance.now();
  try {
    const res = await fetch(m.url, { signal: c.signal, credentials: 'omit' });
    if (!res.ok) { self.postMessage({ id: m.id, error: 'http_' + res.status, status: res.status }); return; }
    let buf = await res.arrayBuffer();
    const wire = buf.byteLength, t1 = performance.now();
    const h = new Uint8Array(buf, 0, Math.min(2, wire));
    if (h[0] === 0x1f && h[1] === 0x8b) {
      buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    self.postMessage({ id: m.id, buffer: buf, wire, fetchMs: t1 - t0, inflateMs: performance.now() - t1 }, [buf]);
  } catch (err) {
    self.postMessage({ id: m.id, error: (err && err.name === 'AbortError') ? 'aborted' : String((err && err.message) || err) });
  } finally { ctl.delete(m.id); }
};`;

let _worker = null;
let _workerFailed = false;
let _seq = 0;
const _pending = new Map();

function getWorker() {
  if (_worker || _workerFailed) return _worker;
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
      _workerFailed = true;
      return null;
    }
    _worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
    _worker.onmessage = (e) => {
      const p = _pending.get(e.data && e.data.id);
      if (!p) return;
      _pending.delete(e.data.id);
      p.resolve(e.data);
    };
    _worker.onerror = () => {
      _workerFailed = true;
      for (const p of _pending.values()) p.resolve({ error: 'worker_error' });
      _pending.clear();
      try { _worker.terminate(); } catch (e) { /* ignore */ }
      _worker = null;
    };
    telemetry().worker = 'blob';
  } catch (e) {
    _workerFailed = true;
    _worker = null;
  }
  return _worker;
}

async function fetchInflateMainThread(url, signal) {
  const t0 = performance.now();
  const res = await fetch(url, { signal, credentials: 'omit' });
  if (!res.ok) return { error: `http_${res.status}`, status: res.status };
  let buf = await res.arrayBuffer();
  const wire = buf.byteLength;
  const t1 = performance.now();
  if (isGzip(new Uint8Array(buf, 0, Math.min(2, wire)))) {
    if (typeof DecompressionStream === 'undefined') return { error: 'no_decompression_stream' };
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return { buffer: buf, wire, fetchMs: t1 - t0, inflateMs: performance.now() - t1 };
}

/** { buffer, wire, fetchMs, inflateMs } or { error, status }. Never throws. */
export async function fetchFrameBytes(url, signal) {
  if (signal && signal.aborted) return { error: 'aborted' };
  const w = getWorker();
  if (!w) {
    try { return await fetchInflateMainThread(url, signal); } catch (e) { return { error: (e && e.name === 'AbortError') ? 'aborted' : String(e && e.message) }; }
  }
  const id = ++_seq;
  return new Promise((resolve) => {
    _pending.set(id, { resolve });
    const onAbort = () => { try { w.postMessage({ id, abort: true }); } catch (e) { /* ignore */ } };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ id, url });
  });
}

// ── The pinned index ────────────────────────────────────────────────────────────────────────────────────────
const _state = { latest: null, latestAt: 0, latestLoad: null, pins: new Map(), lastUse: 0, indexLoads: new Map() };
const _lru = new Map();
const _inflight = new Map();

export function setKeyFor(model, layer) {
  return `${(model || 'GFS').toUpperCase()}/marine/${(layer || 'waves').toLowerCase()}/global_mid`;
}

async function loadJson(url, noCache) {
  const res = await fetch(url, { cache: noCache ? 'no-cache' : 'default', credentials: 'omit' });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

async function readLatest(force) {
  const base = staticFramesBase();
  if (!base) return null;
  const now = Date.now();
  if (!force && _state.latest && now - _state.latestAt < LATEST_TTL_MS) return _state.latest;
  if (_state.latestLoad) return _state.latestLoad;
  _state.latestLoad = loadJson(base + LATEST_PATH, true)
    .then((j) => { _state.latest = j; _state.latestAt = Date.now(); return j; })
    .catch(() => { _state.latestAt = Date.now(); return _state.latest; })
    .finally(() => { _state.latestLoad = null; });
  return _state.latestLoad;
}

async function loadIndex(path) {
  if (_state.indexLoads.has(path)) return _state.indexLoads.get(path);
  const p = loadJson(staticFramesBase() + path, false).then((idx) => {
    if (!idx || idx.encoding_version !== 1 || idx.transform_version !== 1 || !Array.isArray(idx.frames)) {
      throw new Error('unsupported index');
    }
    idx.path = idx.path || path;
    return idx;
  });
  _state.indexLoads.set(path, p);
  p.catch(() => _state.indexLoads.delete(path));
  return p;
}

/** The index pinned for this set, loading or (when idle) re-pinning it. Null when there is none. */
function announceNewRun(key, pin, latest) {
  const entry = latest && latest.sets && latest.sets[key];
  if (!entry || !entry.index || entry.index === pin.index.path) return;
  telemetry().newRunWaiting = { key, index: entry.index, run: entry.run, at: Date.now() };
  try { window.dispatchEvent(new CustomEvent('raw_static_frames_new_run', { detail: { key, run: entry.run } })); } catch (e) { /* ignore */ }
}

export async function getPinnedIndex(key) {
  const now = Date.now();
  const pin = _state.pins.get(key);
  const idle = now - _state.lastUse >= IDLE_REPIN_MS;
  _state.lastUse = now;
  const latestDue = now - _state.latestAt >= LATEST_TTL_MS;
  if (pin && !pin.stale) {
    const cached = _state.latest && _state.latest.sets && _state.latest.sets[key];
    const waiting = !!(cached && cached.index && cached.index !== pin.index.path);
    if (!(idle && (waiting || latestDue))) {
      // Mid-scrub (or nothing new): keep the pin. When latest.json is due, look for a newer run in the background
      // and announce it; never switch here.
      if (latestDue && !idle) readLatest(false).then((latest) => announceNewRun(key, pin, latest)).catch(() => {});
      return pin.index;
    }
  }
  // No pin, a stale pin (one of its frames is gone), or an idle session with latest.json due: (re)pin.
  const latest = await readLatest(!!(pin && pin.stale) || latestDue);
  const entry = latest && latest.sets && latest.sets[key];
  if (!entry || !entry.index) return pin && !pin.stale ? pin.index : null;
  if (pin && pin.index.path === entry.index) { pin.stale = false; return pin.index; }
  try {
    const index = await loadIndex(entry.index);
    _state.pins.set(key, { index, pinnedAt: now, stale: false });
    const t = telemetry();
    t.pin = { key, index: index.path, run: index.run, runTime: index.run_time || null, frames: index.frames.length, at: now };
    t.newRunWaiting = null;
    return index;
  } catch (e) {
    return pin && !pin.stale ? pin.index : null;
  }
}

/** Is an index pinned (and not stale) for this set right now? Synchronous; no I/O. */
export function hasPinnedIndex(key) {
  const pin = _state.pins.get(key);
  return !!(pin && !pin.stale);
}

function markPinStale(key) {
  const pin = _state.pins.get(key);
  if (pin) pin.stale = true;
}

// ── Frame loads: ONE fetch + parse per path, shared; vectors built on top, once per path ──────────────────────
// A frame fetch is SHARED by every caller that wants the same immutable path (seam A's exact /grid, seam B's window and the
// GPU frame store's prefetch often ask for the same frame at once). It runs on its OWN AbortController, aborted only when
// EVERY waiter has aborted: one caller's supersede must not leave another caller (or the LRU) without the frame.
// Two layers share that rule: the PARSED frame (fetch + inflate + parse; what the frame store packs, with no per-node
// objects) and, on top of it, the VECTORS (the ~15k objects /grid and the series pages carry), built once per path.
const _parsedInflight = new Map();
const _parsedHooks = new Set();

/** Subscribe to every frame this loader parses: fn({ key, frame, parsed, buffer }). Returns the unsubscribe. A hook that
 *  throws is ignored (it never breaks a load). The GPU frame store (marineFrameStoreRuntime) packs frames from here. */
export function onStaticFrameParsed(fn) {
  _parsedHooks.add(fn);
  return () => _parsedHooks.delete(fn);
}

/** The pinned index for a set right now, synchronously; null when none or stale. No I/O. */
export function getPinnedIndexSync(key) {
  const pin = _state.pins.get(key);
  return pin && !pin.stale ? pin.index : null;
}

function sharedParsedLoad(key, frame) {
  const controller = new AbortController();
  const promise = (async () => {
    const t = telemetry();
    const got = await fetchFrameBytes(staticFramesBase() + frame.path, controller.signal);
    if (got.error) {
      if (got.status === 404 || got.status === 400) markPinStale(key); // retention removed it: re-pin next time
      noteMiss(got.error === 'aborted' ? 'aborted' : (got.status ? `http_${got.status}` : 'fetch_error'));
      if (got.error !== 'aborted') t.errors += 1;
      return null;
    }
    try {
      const parsed = parseFrame(got.buffer);
      if (Math.abs(parsed.validEpoch * 1000 - Date.parse(frame.valid_time)) > 1000) throw new Error('frame/index valid_time mismatch');
      t.fetches += 1;
      t.bytes += got.wire || 0;
      pushSample(t.fetchMs, got.fetchMs || 0);
      pushSample(t.inflateMs, got.inflateMs || 0);
      for (const fn of _parsedHooks) { try { fn({ key, frame, parsed, buffer: got.buffer }); } catch (e) { /* never break a load */ } }
      return { parsed, buffer: got.buffer, wire: got.wire || 0 };
    } catch (e) {
      noteMiss('decode_error');
      t.errors += 1;
      return null;
    }
  })();
  return { promise, controller, waiters: 0 };
}

// Join the shared load for `path` in `map` (making it with `make` when there is none, or when every earlier waiter gave up on
// it). Resolves to the load's result, or null as soon as THIS caller's signal aborts (the load goes on for the others).
async function joinShared(map, path, make, signal) {
  if (signal && signal.aborted) return null;
  let entry = map.get(path);
  if (!entry || entry.controller.signal.aborted) {
    entry = make();
    map.set(path, entry);
    const mine = entry;
    entry.promise.finally(() => { if (map.get(path) === mine) map.delete(path); });
  }
  const shared = entry;
  shared.waiters += 1;
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    shared.waiters -= 1;
    if (shared.waiters <= 0) shared.controller.abort();   // nobody wants it any more
  };
  if (!signal) {
    try { return await shared.promise; } finally { left = true; shared.waiters -= 1; }
  }
  let onAbort;
  const aborted = new Promise((resolve) => { onAbort = () => { leave(); resolve(null); }; signal.addEventListener('abort', onAbort, { once: true }); });
  try {
    return await Promise.race([shared.promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (!left) { left = true; shared.waiters -= 1; }
  }
}

/** The parsed frame ({ parsed, buffer, wire }) for one frame record, shared per path; null on any failure or when THIS
 *  caller's signal aborts. No vectors are built: this is what the GPU frame store prefetches through. */
export function loadFrameParsed(key, frame, signal) {
  if (!frame || !frame.path) return Promise.resolve(null);
  return joinShared(_parsedInflight, frame.path, () => sharedParsedLoad(key, frame), signal);
}

function sharedVectorsLoad(key, frame) {
  const controller = new AbortController();
  const promise = (async () => {
    const got = await loadFrameParsed(key, frame, controller.signal);
    if (!got) return null;
    try {
      const t0 = performance.now();
      const vectors = buildVectors(got.parsed);
      pushSample(telemetry().buildMs, performance.now() - t0);
      _lru.set(frame.path, vectors);
      while (_lru.size > LRU_MAX) _lru.delete(_lru.keys().next().value);
      return vectors;
    } catch (e) {
      noteMiss('decode_error');
      telemetry().errors += 1;
      return null;
    }
  })();
  return { promise, controller, waiters: 0 };
}

/** Decoded vectors for one frame record (LRU + shared in-flight load). Null on any failure (reason recorded) or when
 *  THIS caller's signal aborts (the shared load keeps going for the other waiters). */
export async function loadFrameVectors(key, frame, signal) {
  if (!frame || !frame.path) return null;
  const hit = _lru.get(frame.path);
  if (hit) {
    _lru.delete(frame.path);
    _lru.set(frame.path, hit);
    telemetry().lruHits += 1;
    return hit;
  }
  return joinShared(_inflight, frame.path, () => sharedVectorsLoad(key, frame), signal);
}

const spanOf = (b) => (b ? ((b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west) : 0);

/** Does this request get a static frame at all? (Cheap; no I/O.) */
export function staticEligible({ model, layer, bbox, surf }) {
  if (!staticFramesEnabled() || !staticFramesBase()) return false;
  if (surf) return false;                         // rating grids are a server transform of the product
  if ((model || '').toUpperCase() !== 'GFS' || (layer || '').toLowerCase() !== 'waves') return false; // slice 1
  return spanOf(bbox) >= WORLD_MIN_SPAN;
}

/**
 * Seam A. The /grid JSON for a WORLD request from the pinned static frame, or null (the caller fetches /grid).
 * `validTimeStr` is what the caller would have put in the /grid URL.
 */
export async function tryStaticWorldGrid({ model, layer, validTimeStr, clampedBbox, surf, signal }) {
  if (!staticEligible({ model, layer, bbox: clampedBbox, surf })) return null;
  const key = setKeyFor(model, layer);
  try {
    const index = await getPinnedIndex(key);
    if (!index) { noteMiss('no_index'); return null; }
    const askMs = Date.parse(validTimeStr);
    const frame = pickIndexFrame(index, askMs);
    if (!frame) { noteMiss('no_frame_in_window'); return null; }
    // The pick landed on an entry the publisher could not build (not on its disk, refused by parity): /grid serves this
    // hour. Never substitute a neighbouring frame, which could be up to 3 h away.
    if (!frame.path) { noteMiss('unbuilt_frame'); return null; }
    const vectors = await loadFrameVectors(key, frame, signal);
    if (!vectors) return null;
    telemetry().hits += 1;
    const json = gridJsonFromFrame(index, frame, vectors, { askIso: validTimeStr, requestedBbox: clampedBbox });
    // /grid ships a server-minted truth tag for GFS waves; mint the lineage tag once here, as the series path does.
    try { json.truthTag = buildTruthTag(json, 'staticFrame'); } catch (e) { json.truthTag = null; }
    return json;
  } catch (e) {
    noteMiss('error');
    return null;
  }
}

/**
 * Seam B. Series frames for a WORLD page from static frames, nearest the focus hour first, at most MAX_IN_FLIGHT
 * at a time; `onFrames(frames)` is called as each window lands so the page can serve them at once. Resolves to the
 * hours it could not fill (the caller leaves those to the per-hour path), or null when the page is not eligible or
 * the index is missing (the caller then uses /grid_series as before).
 */
export async function staticSeriesFrames({ model, layer, bbox, surf, hours, anchorMs, focusHour, signal, onFrames }) {
  if (!staticEligible({ model, layer, bbox, surf })) return null;
  const key = setKeyFor(model, layer);
  const index = await getPinnedIndex(key).catch(() => null);
  if (!index) { noteMiss('no_index'); return null; }
  const focus = Number.isFinite(focusHour) ? focusHour : hours[0];
  const order = [...hours].sort((a, b) => (Math.abs(a - focus) - Math.abs(b - focus)) || (b - a));
  const missing = [];
  let next = 0;
  const worker = async () => {
    while (next < order.length) {
      if (signal && signal.aborted) return;
      const h = order[next++];
      const askMs = anchorMs + h * 3600000;
      const frame = pickIndexFrame(index, askMs);
      if (!frame || !frame.path) { missing.push(h); continue; }   // unbuilt: the per-hour path asks /grid
      const vectors = await loadFrameVectors(key, frame, signal);
      if (!vectors) { missing.push(h); continue; }
      telemetry().seriesFrames += 1;
      onFrames([seriesFrameFromFrame(index, frame, vectors, { hourOffset: h, askIso: new Date(askMs).toISOString() })]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, order.length) }, worker));
  return missing.sort((a, b) => a - b);
}

/** Test hook: forget every pin, index, decoded frame and the worker. */
export function _resetStaticFramesForTest() {
  _state.latest = null; _state.latestAt = 0; _state.latestLoad = null; _state.pins.clear(); _state.lastUse = 0;
  _state.indexLoads.clear(); _lru.clear(); _inflight.clear(); _parsedInflight.clear(); _pending.clear();
  if (_worker) { try { _worker.terminate(); } catch (e) { /* ignore */ } }
  _worker = null; _workerFailed = false;
  if (typeof window !== 'undefined') delete window.__RAW_STATIC_FRAMES__;
}
