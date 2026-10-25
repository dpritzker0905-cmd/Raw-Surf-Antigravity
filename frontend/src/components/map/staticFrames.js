/**
 * staticFrames.js — load forecast frames from the CDN instead of the 1-CPU backend (step 2b, 2026-10-20). ON by default
 * since 2026-10-21 (owner: "turn on static frames"; DECISIONS).
 *
 * The ingest runner publishes the world-view (2-degree global_mid) marine sets in STATIC_SETS once per model run as
 * immutable gzipped binary frames
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
 *   ONE SET: window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = ['ICON/marine/waves/global_mid'] (or '*'), see staticSetEnabled.
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
// MID-ZOOM CROPS (2026-10-22): a viewport box the resolver answers from global_mid is served as a crop of the same frame.
import { cropGridJson, cropSeriesFrame, cropVectors, gridBboxParam, midCropFor, midCropRulesPass, seriesBboxParam } from './staticFrameCrop';
import { _resetRegionalForTest, bundleBackingOff, isRegionalSetKey, noteRegionalMiss, normalizeBundleIndex, pickRegionalTile, regionalBundlesOn, regionalClipWindow, regionalFrameBytes,
  regionalGridJson, regionalTelemetry } from './staticRegional';   // regional bundles at z7-9 (2026-10-23)
import { registerLatestProbes, setIsEmpty, setIsListed } from './regionalLatestSets';
import { filledWorldPossible, filledWorldSetKey, serveTimeFillAtWorld } from './staticWorldFillGuard';
export { serveTimeFillAtWorld };   // moved to staticWorldFillGuard.js (the 800-line cap); the callers import it from here

export const FRAME_BUCKET = 'weather-frames';
export const LATEST_PATH = 'v1/latest.json';
const IDLE_REPIN_MS = 30000;      // a pin may move only after this long without a static-frame request
const LATEST_TTL_MS = 120000;     // and latest.json is re-read at most this often
const NEGATIVE_TTL_MS = 60000;    // a missing/unreadable latest.json is re-asked at most this often, doubling per consecutive
const NEGATIVE_TTL_MAX_MS = 900000; // failure up to 15 min (each 400 is an origin round trip the step waits on before /grid:
                                  // measured 120-560 ms on dev, 2026-10-22); a successful read resets it
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
    const res = await fetch(m.url, m.priority ? { signal: c.signal, credentials: 'omit', priority: m.priority } : { signal: c.signal, credentials: 'omit' });
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

async function fetchInflateMainThread(url, signal, priority) {
  const t0 = performance.now();
  const res = await fetch(url, priority ? { signal, credentials: 'omit', priority } : { signal, credentials: 'omit' });
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

// FETCH PRIORITY (2026-10-23; skills audit #1). `priority` is RequestInit.priority: 'high' for the frame on screen, 'low' for
// prefetch the user MIGHT need (warm sets, the run fill, crop build-ahead), undefined = the browser's default (High for fetch).
// Trace-verified on Chrome 154: a dedicated (Blob) worker's fetch gets the same scheduling priority as the main thread's
// (ResourceSendRequest: low -> Low, none -> High, high -> High). Kill: window.__RAW_DISABLE_FETCH_PRIORITY__ = true (no hint).
export function fetchPriorityOf(priority) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_FETCH_PRIORITY__ === true) return undefined;
  return priority === 'high' || priority === 'low' ? priority : undefined;
}

/** { buffer, wire, fetchMs, inflateMs } or { error, status }. Never throws. `priority`: 'high' | 'low' | undefined. */
export async function fetchFrameBytes(url, signal, priority) {
  if (signal && signal.aborted) return { error: 'aborted' };
  const pr = fetchPriorityOf(priority);
  const t = telemetry();
  t.byPriority = t.byPriority || { high: 0, low: 0, auto: 0 };
  t.byPriority[pr || 'auto'] += 1;
  const w = getWorker();
  if (!w) {
    try { return await fetchInflateMainThread(url, signal, pr); } catch (e) { return { error: (e && e.name === 'AbortError') ? 'aborted' : String(e && e.message) }; }
  }
  const id = ++_seq;
  return new Promise((resolve) => {
    _pending.set(id, { resolve });
    const onAbort = () => { try { w.postMessage({ id, abort: true }); } catch (e) { /* ignore */ } };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    w.postMessage(pr ? { id, url, priority: pr } : { id, url });
  });
}

// ── The pinned index ────────────────────────────────────────────────────────────────────────────────────────
const _state = { latest: null, latestAt: 0, latestLoad: null, latestFails: 0, pins: new Map(), lastUse: 0, indexLoads: new Map() };
const _lru = new Map();
const _inflight = new Map();

export function setKeyFor(model, layer) {
  return `${(model || 'GFS').toUpperCase()}/marine/${(layer || 'waves').toLowerCase()}/global_mid`;
}

// The world sets the client reads from the CDN (the publisher's frame_set.SETS; each parity-gated node by node at publish
// and offline against /grid, 2026-10-22). A set the publisher has not published yet is simply a miss ('no_index' or
// 'set_not_published') and /grid serves it. Not here: EURO swell layers (global_coarse + serve-time Gulf fill) and ICON
// swell_2 (a client blend; its GFS swell_2 input IS served from frames through the same seam).
export const STATIC_SETS = [
  'GFS/marine/waves/global_mid', 'GFS/marine/swell_1/global_mid', 'GFS/marine/swell_2/global_mid',
  'GFS/marine/wind_waves/global_mid', 'ICON/marine/waves/global_mid', 'EURO/marine/waves/global_mid',
  'ICON/marine/swell_1/global_mid', 'ICON/marine/wind_waves/global_mid',
  // GFS 10 m wind (2026-10-22, the wind instant scrub): read only by windStaticFrames.js. getPinnedIndexSync keeps it out of the
  // marine frame store (waves sets only).
  'GFS/wind/wind/global_mid',
  // GFS mean-sea-level pressure (2026-10-23, the raster layers' own frames from free NOAA GRIB): read only by ownRasterFrames.js,
  // behind window.__RAW_RASTER_OWN_FRAMES__ (default off). Not a waves set, so the marine frame store never takes it.
  'GFS/weather/pressure/global_0p5',
  // Per-model pressure (2026-10-24): EURO from ECMWF open data, ICON from DWD (frame_set_raster_sources). Raster sets: the marine
  // frame store never takes them (not waves).
  'EURO/weather/pressure/global_0p5', 'ICON/weather/pressure/global_0p5',
  // GFS 2 m air temperature (2026-10-24, #515's set): read only by ownRasterFrames.js, behind the same lever (default off).
  'GFS/weather/temperature/global_0p5',
  // GFS total cloud cover (2026-10-24, the 'satellite' layer; #515's set): read only by ownRasterFrames.js, same lever.
  'GFS/weather/cloud_cover/global_0p5',
  // EURO / ICON world frames with /grid's TARGETED Gulf fill baked in (2026-10-24, frame_set_fill.py): read only for WORLD boxes,
  // only while the server and the set agree on the mode (staticWorldFillGuard.filledWorldSetKey); crops read the plain sets.
  'ICON/marine/waves/global_mid_filled', 'EURO/marine/waves/global_mid_filled', 'ICON/marine/swell_1/global_mid_filled',
  'ICON/marine/wind_waves/global_mid_filled',
];

/** Per-set kill: window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = ['ICON/marine/waves/global_mid', ...] (or '*'), or
 *  localStorage '__RAW_STATIC_FRAMES_SETS_OFF__' = a comma list, for this browser. The global kill still wins over all. */
export function staticSetEnabled(key) {
  if (!STATIC_SETS.includes(key) && !(isRegionalSetKey(key) && regionalBundlesOn())) return false;
  const off = (list) => list === '*' || (Array.isArray(list) && list.includes(key));
  if (typeof window !== 'undefined' && off(window.__RAW_DISABLE_STATIC_FRAMES_SETS__)) return false;
  try {
    const ls = window.localStorage && window.localStorage.getItem('__RAW_STATIC_FRAMES_SETS_OFF__');
    if (ls && (ls.trim() === '*' || ls.split(',').map((x) => x.trim()).includes(key))) return false;
  } catch (e) { /* storage blocked */ }
  return true;
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
  const ttl = _state.latest ? LATEST_TTL_MS
    : Math.min(NEGATIVE_TTL_MAX_MS, NEGATIVE_TTL_MS * 2 ** Math.max(0, _state.latestFails - 1));
  if (!force && _state.latestAt && now - _state.latestAt < ttl) return _state.latest;
  if (_state.latestLoad) return _state.latestLoad;
  _state.latestLoad = loadJson(base + LATEST_PATH, true)
    .then((j) => { _state.latest = j; _state.latestAt = Date.now(); _state.latestFails = 0; return j; })
    .catch(() => { _state.latestAt = Date.now(); _state.latestFails += 1; return _state.latest; })
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
    normalizeBundleIndex(idx);                       // a regional bundle set: frames read slices of one object (staticRegional)
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
  return !!(pin && !pin.stale) && staticSetEnabled(key);
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

/** The pinned index for a set right now, synchronously; null when none, stale, the set is killed, it is not a WAVES set, or
 *  it is a EURO / ICON set (serveTimeFillAtWorld: /grid's world-span Gulf fill).
 *  The GPU frame store (#437) reaches sets only through this: a per-set kill flipped after a pin also stops it, and it never
 *  plans or prefetches a non-waves run its packer would refuse (packStaticFrame: waves only), which would be egress for
 *  nothing (a whole run is ~6.3 MB). No I/O. */
export function getPinnedIndexSync(key) {
  const pin = _state.pins.get(key);
  const [model, , layer] = String(key || '').split('/');
  if (isRegionalSetKey(key)) return null;            // regional bundles (phase 1): the GPU frame store keeps to world sets
  // EURO / ICON: the store cannot tell a world view (where /grid's serve-time Gulf fill makes the served grid differ from the
  // stored frame; serveTimeFillAtWorld) from a crop at this door, so it takes none of their frames for now.
  return pin && !pin.stale && staticSetEnabled(key) && layer === 'waves' && !serveTimeFillAtWorld(model, layer) ? pin.index : null;
}

// The frame store's regional crop show (2026-10-24): the pinned REGIONAL waves index of a set key (null unless pinned, fresh, enabled; so only while the bundles' gate is open), and the pinned regional keys of a model x layer. No I/O.
export const getPinnedRegionalIndexSync = (key) => { const pin = _state.pins.get(key); return isRegionalSetKey(key) && key.split('/')[2] === 'waves' && pin && !pin.stale && staticSetEnabled(key) ? pin.index : null; };
export const pinnedRegionalKeys = (model, layer) => [..._state.pins.keys()].filter((k) => isRegionalSetKey(k) && k.startsWith(`${model}/marine/${layer}/`));

function sharedParsedLoad(key, frame, priority) {
  const controller = new AbortController();
  const promise = (async () => {
    const t = telemetry();
    let got;
    try {
      got = frame.bundle ? await regionalFrameBytes(staticFramesBase(), frame, controller.signal, priority)
        : await fetchFrameBytes(staticFramesBase() + frame.path, controller.signal, priority);
    } catch (e) { got = { error: 'fetch_error' }; }                      // never an unhandled rejection
    if (got.error) {
      if (got.status === 404 || got.status === 400 || got.status === 'integrity') markPinStale(key); // gone or wrong: re-pin
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
// `priority` ('high' | 'low') applies when THIS call starts the shared load; a load already in flight keeps the priority of the
// caller that started it (a fetch's priority cannot change once sent).
export function loadFrameParsed(key, frame, signal, { priority } = {}) {
  if (!frame || !frame.path) return Promise.resolve(null);
  return joinShared(_parsedInflight, frame.path, () => sharedParsedLoad(key, frame, priority), signal);
}

function sharedVectorsLoad(key, frame, priority) {
  const controller = new AbortController();
  const promise = (async () => {
    const got = await loadFrameParsed(key, frame, controller.signal, { priority });
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
export async function loadFrameVectors(key, frame, signal, { priority } = {}) {
  if (!frame || !frame.path) return null;
  const hit = _lru.get(frame.path);
  if (hit) {
    _lru.delete(frame.path);
    _lru.set(frame.path, hit);
    telemetry().lruHits += 1;
    return hit;
  }
  return joinShared(_inflight, frame.path, () => sharedVectorsLoad(key, frame, priority), signal);
}

const spanOf = (b) => (b ? ((b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west) : 0);
/** The set a box reads its global_mid frames from: a WORLD box of a guarded EURO/ICON set reads the filled world set while it is
 *  servable (filledWorldSetKey), every other box (and that box otherwise) the plain set. Synchronous, no I/O. */
const midSetKeyFor = (model, layer, bbox) => (spanOf(bbox) >= WORLD_MIN_SPAN && filledWorldSetKey(model, layer, _state.latest)) || setKeyFor(model, layer);

/** Does this request get a static frame at all? (Cheap; no I/O.) */
export function staticEligible({ model, layer, bbox, surf }) {
  if (!staticFramesEnabled() || !staticFramesBase()) return false;
  if (surf) return false;                         // rating grids are a server transform of the product
  const tile = regionalTileFor({ model, layer, bbox, surf, param: gridBboxParam });
  if (tile) return staticSetEnabled(tile.key);    // z7-9 inside a pilot box: the regional bundle or /grid, never the world tiers
  if (!staticSetEnabled(setKeyFor(model, layer))) return false;
  // A world box, or a viewport box the resolver answers from global_mid (the mid-zoom crop, #459): every world set's tier is
  // global_mid, so the crop rules (model-aware snap, regional refusal) apply to all of them.
  if (spanOf(bbox) >= WORLD_MIN_SPAN) {
    if (!serveTimeFillAtWorld(model, layer)) return true;
    // A guarded set's world box: only its filled set, if servable. Its record is in latest.json, which nothing may have read yet
    // when the session opens on EURO/ICON: start that read (once per TTL, no wait, only when it could help) so the next ask is served.
    if (!_state.latest && filledWorldPossible(model, layer)) readLatest(false).catch(() => {});
    const filled = filledWorldSetKey(model, layer, _state.latest);
    return !!filled && staticSetEnabled(filled);
  }
  return isMidCropBox({ model, layer, bbox });
}

/** The regional tile Step 3 serves this box from (staticRegional.pickRegionalTile), or null. `param` = the seam's bbox format. */
function regionalTileFor({ model, layer, bbox, surf, param }) {
  if (surf || !bbox || spanOf(bbox) >= WORLD_MIN_SPAN) return null;
  try { return pickRegionalTile({ model, layer, bboxStr: param(bbox) }); } catch (e) { return null; }
}

/** The set a box reads: its regional bundle set inside a pilot box, else the world set. Synchronous, no I/O. */
export function staticSetKeyForBox({ model, layer, bbox, surf }) {
  const tile = regionalTileFor({ model, layer, bbox, surf, param: gridBboxParam });
  return tile ? tile.key : midSetKeyFor(model, layer, bbox);       // a guarded world box: its filled world set (midSetKeyFor)
}

/** The set is listed in the latest.json already read (synchronous; false before the first read). */
export const isSetListed = (key) => setIsListed(_state.latest, key);
/** The set is an explicit empty in the latest.json already read (#514; regionalLatestSets.js). */
export const isSetEmpty = (key) => setIsEmpty(_state.latest, key);
registerLatestProbes(() => _state.latest);   // the pre-manifest tile pick (staticRegional)

/** The pinned regional index and this ask's frame and Step 3 window, or null with the miss recorded (the caller asks /grid). */
async function regionalPick({ tile, model, askMs, bboxStr }) {
  const index = await getPinnedIndex(tile.key).catch(() => null);
  if (!index) { noteRegionalMiss('no_index'); return null; }
  return regionalPickFrom(index, { model, askMs, bboxStr });
}

/** A regional PAGE is served from `index` only when the cover holds on its lattice and its bundle is not in a failure backoff. */
function regionalPageServable(index, model, bbox) {
  const win = regionalClipWindow(seriesBboxParam(bbox), index && index.grid, model);
  return !!(win && win.covers) && !(index.bundle && bundleBackingOff(index.bundle.path));
}

/** Synchronous: the PINNED index serves this box's regional page (false when nothing is pinned yet). No I/O. */
export function regionalPageServableSync({ model, layer, bbox, surf }) {
  const tile = regionalTileFor({ model, layer, bbox, surf, param: seriesBboxParam });
  const pin = tile && _state.pins.get(tile.key);
  return !!(pin && !pin.stale && staticSetEnabled(tile.key) && regionalPageServable(pin.index, model, bbox));
}

/** This ask's frame and Step 3 window in `index`, or null with the miss recorded. */
function regionalPickFrom(index, { model, askMs, bboxStr }) {
  const frame = pickIndexFrame(index, askMs);
  if (!frame) { noteRegionalMiss('no_frame_in_window'); return null; }
  if (!frame.path) { noteRegionalMiss('unbuilt_frame'); return null; }
  const grid = frame.grid || index.grid;
  const win = regionalClipWindow(bboxStr, grid, model);
  if (!win) { noteRegionalMiss('window_unmirrored'); return null; }
  if (!win.covers) { noteRegionalMiss('partial_cover'); return null; }   // the server serves regional_partial and sharpens it
  return { index, frame, grid, win };
}

/** Seam A for a regional box: Step 3's clipped tile from the bundle, or null. */
async function tryStaticRegionalGrid({ tile, model, validTimeStr, clampedBbox, signal }) {
  const bboxStr = gridBboxParam(clampedBbox);
  const p = await regionalPick({ tile, model, askMs: Date.parse(validTimeStr), bboxStr });
  if (!p) return null;
  const vectors = await loadFrameVectors(tile.key, p.frame, signal, { priority: 'high' });
  if (!vectors) return null;
  regionalTelemetry().hits += 1;
  const json = regionalGridJson(gridJsonFromFrame(p.index, p.frame, vectors, { askIso: validTimeStr, requestedBbox: clampedBbox }),
    p.win, cropVectors(vectors, p.grid.cols, p.win), bboxStr);
  try { json.truthTag = buildTruthTag(json, 'staticFrame'); } catch (e) { json.truthTag = null; }
  return json;
}

/** A viewport box (not a world one) that the resolver answers from global_mid: served as a crop (staticFrameCrop.js). */
function isMidCropBox({ model, layer, bbox }) {
  return !!bbox && spanOf(bbox) < WORLD_MIN_SPAN && midCropRulesPass({ model, layer, bboxStr: gridBboxParam(bbox) });
}

/** The crop window for a box in its seam's own URL format, or null (not a crop box, or not mirrored exactly: the caller asks
 *  the backend). `param` = gridBboxParam (/grid) or seriesBboxParam (/grid_series). World boxes return undefined. */
function cropWindowFor({ model, layer, bbox, index, frame, param }) {
  if (spanOf(bbox) >= WORLD_MIN_SPAN) return undefined;
  const win = midCropFor({ model, layer, bboxStr: param(bbox), grid: (frame && frame.grid) || index.grid });
  if (!win) noteMiss('crop_unmirrored');
  return win;
}

/**
 * The series page key for a crop page (2026-10-22). Every series viewport wider than 15 deg shares the key 'global'
 * (marineGridSeries.viewportKey), so a crop page and the world page would overwrite each other; a crop page carries its clip
 * window in its key. Any other page keeps `baseKey`. Synchronous, no I/O.
 */
export function staticCropPageKey(baseKey, { model, layer, reqBox, surf }) {
  try {
    if (!staticSeriesEligible({ model, layer, bbox: reqBox, surf }) || !isMidCropBox({ model, layer, bbox: reqBox })) return baseKey;
    const win = midCropFor({ model, layer, bboxStr: seriesBboxParam(reqBox), grid: WORLD_GRID });
    return win ? `${baseKey}|crop:${win.clip}` : baseKey;
  } catch (e) {
    return baseKey;
  }
}
// The global_mid lattice every published frame carries (index.grid): 181 x 83, 2 deg, -180..180 x -80..84. Only used to NAME a
// crop page before an index is pinned; the frames are always cropped on their own index's grid.
const WORLD_GRID = { bounds: { west: -180, south: -80, east: 180, north: 84 }, cols: 181, rows: 83 };

/**
 * Seam B (the series lane): every world set since #456 (2026-10-22). History: the series conform (useMarineWindData) used to
 * re-emit flat backend vectors without their top-level is_valid, and the encoder recovers land from the v.waves sub-record for
 * the waves layer only, so a swell_1 / swell_2 / wind_waves series frame's land cells (4,850 of 15,023 in a real world frame)
 * encoded as OCEAN where the /grid lane kept them land. #453 held non-waves sets to seam A until #456 made the conform carry
 * is_valid for every layer (marineFramePack.parity.test.js: swell_1 texels that differ between the lanes 4,657 -> 0 on a real
 * frame). The waves-only rule comes back by itself whenever that fix is killed (window.__RAW_DISABLE_CONFORM_IS_VALID__), and
 * on its own kill: window.__RAW_DISABLE_STATIC_SERIES_ALL_SETS__ = true. Series CROP pages (#459) follow this gate too.
 * The GPU frame store stays waves-only (getPinnedIndexSync) until its packer handles the other layers.
 */
export function staticSeriesEligible(args) {
  if (!staticEligible(args)) return false;
  if (String((args && args.layer) || 'waves').toLowerCase() === 'waves') return true;
  if (typeof window === 'undefined') return false;
  return window.__RAW_DISABLE_CONFORM_IS_VALID__ !== true && window.__RAW_DISABLE_STATIC_SERIES_ALL_SETS__ !== true;
}

/**
 * Seam A. The /grid JSON for a WORLD request from the pinned static frame, or null (the caller fetches /grid).
 * `validTimeStr` is what the caller would have put in the /grid URL.
 */
export async function tryStaticWorldGrid({ model, layer, validTimeStr, clampedBbox, surf, signal }) {
  if (!staticEligible({ model, layer, bbox: clampedBbox, surf })) return null;
  const tile = regionalTileFor({ model, layer, bbox: clampedBbox, surf, param: gridBboxParam });
  if (tile) {
    try { return await tryStaticRegionalGrid({ tile, model, validTimeStr, clampedBbox, signal }); } catch (e) { noteRegionalMiss('error'); return null; }
  }
  const key = midSetKeyFor(model, layer, clampedBbox);
  try {
    const index = await getPinnedIndex(key);
    if (!index) { noteMiss('no_index'); return null; }
    const askMs = Date.parse(validTimeStr);
    const frame = pickIndexFrame(index, askMs);
    if (!frame) { noteMiss('no_frame_in_window'); return null; }
    // The pick landed on an entry the publisher could not build (not on its disk, refused by parity): /grid serves this
    // hour. Never substitute a neighbouring frame, which could be up to 3 h away.
    if (!frame.path) { noteMiss('unbuilt_frame'); return null; }
    const win = cropWindowFor({ model, layer, bbox: clampedBbox, index, frame, param: gridBboxParam });
    if (win === null) return null;
    const vectors = await loadFrameVectors(key, frame, signal, { priority: 'high' });
    if (!vectors) return null;
    telemetry().hits += 1;
    let json = gridJsonFromFrame(index, frame, vectors, { askIso: validTimeStr, requestedBbox: clampedBbox });
    if (win) {
      json = cropGridJson(json, win, cropVectors(vectors, (frame.grid || index.grid).cols, win));
      telemetry().crops = (telemetry().crops || 0) + 1;
    }
    // /grid ships a server-minted truth tag; mint the lineage tag once here, as the series path does.
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
export async function staticSeriesFrames({ model, layer, bbox, surf, hours, anchorMs, focusHour, signal, onFrames, priority }) {
  if (!staticSeriesEligible({ model, layer, bbox, surf })) return null;
  const tile = regionalTileFor({ model, layer, bbox, surf, param: seriesBboxParam });
  if (tile) return staticRegionalSeriesFrames({ tile, model, bbox, hours, anchorMs, focusHour, signal, onFrames, priority });
  const key = midSetKeyFor(model, layer, bbox);
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
      const win = cropWindowFor({ model, layer, bbox, index, frame, param: seriesBboxParam });
      if (win === null) { missing.push(h); continue; }
      const vectors = await loadFrameVectors(key, frame, signal);
      if (!vectors) { missing.push(h); continue; }
      telemetry().seriesFrames += 1;
      let sf = seriesFrameFromFrame(index, frame, vectors, { hourOffset: h, askIso: new Date(askMs).toISOString() });
      if (win) { sf = cropSeriesFrame(sf, win, cropVectors(vectors, (frame.grid || index.grid).cols, win)); telemetry().crops = (telemetry().crops || 0) + 1; }
      sf.static_index = index.path;                       // the page keeps frames of one run (marineSeriesStatic commit)
      onFrames([sf]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, order.length) }, worker));
  return missing.sort((a, b) => a - b);
}

/** Seam B for a regional page: Step 3's clipped tile per hour from the bundle (one CDN request for the whole run). Null when the
 *  set has no index (the caller asks /grid_series); otherwise the hours it could not fill (partial covers, unbuilt hours). */
// null = this page is NOT served from the bundle (the caller asks /grid_series): no index, the cover does not hold on the tile
// lattice (a box past the last data node: us_southeast_midatlantic, us_northeast, france_biscay), or the bundle failed (fetch,
// sha12, decode) before a frame was served. ONE index for the whole fill, so a page never mixes two runs. Hours the run cannot
// serve (outside its window, unbuilt) are returned for the per-hour path.
async function staticRegionalSeriesFrames({ tile, model, bbox, hours, anchorMs, focusHour, signal, onFrames, priority }) {
  const index = await getPinnedIndex(tile.key).catch(() => null);
  if (!index) { noteRegionalMiss('no_index'); return null; }
  if (!regionalPageServable(index, model, bbox)) { noteRegionalMiss('page_not_servable'); return null; }
  const bboxStr = seriesBboxParam(bbox);
  const focus = Number.isFinite(focusHour) ? focusHour : hours[0];
  const order = [...hours].sort((a, b) => (Math.abs(a - focus) - Math.abs(b - focus)) || (b - a));
  const missing = [];
  let served = 0;
  for (const h of order) {
    if (signal && signal.aborted) break;
    const askMs = anchorMs + h * 3600000;
    const p = regionalPickFrom(index, { model, askMs, bboxStr });
    if (!p) { missing.push(h); continue; }
    const vectors = await loadFrameVectors(tile.key, p.frame, signal, { priority });
    if (!vectors) {
      if (served === 0 && !(signal && signal.aborted)) { noteRegionalMiss('page_failed'); return null; }
      missing.push(h); continue;
    }
    served += 1;
    regionalTelemetry().series += 1;
    const sf = seriesFrameFromFrame(p.index, p.frame, vectors, { hourOffset: h, askIso: new Date(askMs).toISOString() });
    const out = cropSeriesFrame(sf, { ...p.win, clip: p.win.snapped }, cropVectors(vectors, p.grid.cols, p.win));
    out.static_index = index.path;
    onFrames([out]);
  }
  return missing.sort((a, b) => a - b);
}

/** Test hook: forget every pin, index, decoded frame and the worker. */
// ── BOOT WARM-UP (2026-10-23, skills audit #2) ────────────────────────────────────────────────────────────────────────────
// The first Waves click paid a waterfall: latest.json, then the run index, then the frame, then the inflate worker's spawn, one
// after another and only after the map style, the layer and the first /grid ask were up. MapPage calls this at mount instead, so
// they run while the style and tiles load:
//   - the inflate worker is spawned;
//   - latest.json is read and the persisted model's waves index pinned;
//   - in idle time, the frame for the app's current hour is loaded and its vectors built, at 'low' priority (the map's own
//     style and tiles come first).
// Nothing is drawn, and seam A then finds the pin and the vectors in place. Only for a world-eligible set (EURO/ICON world boxes
// stay on /grid, #461). Skipped on Save-Data and 2g links; once per page load.
// Kill: window.__RAW_DISABLE_STATIC_FRAMES_PREWARM__ = true.
const PREWARM_WORLD = { west: -180, south: -80, east: 180, north: 85 };
let _prewarm = null;
export function prewarmStaticFrames({ model = 'GFS', layer = 'waves' } = {}) {
  if (_prewarm) return _prewarm;
  if (typeof window === 'undefined' || window.__RAW_DISABLE_STATIC_FRAMES_PREWARM__ === true) return null;
  if (!staticFramesEnabled() || !staticFramesBase()) return null;
  const conn = typeof navigator !== 'undefined' ? navigator.connection : null;
  if (conn && (conn.saveData === true || conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) return null;
  const t = telemetry();
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const rec = (t.prewarm = { model, layer, startedAt: Date.now(), indexMs: null, frameMs: null, frame: null, skipped: null });
  getWorker();
  if (!staticEligible({ model, layer, bbox: PREWARM_WORLD })) {
    rec.skipped = 'not_eligible';
    _prewarm = Promise.resolve(null);
    return _prewarm;
  }
  const key = setKeyFor(model, layer);
  const idle = (fn) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 0));
  _prewarm = getPinnedIndex(key).then((index) => {
    rec.indexMs = ms();
    if (!index) { rec.skipped = 'no_index'; return null; }
    const base = window.__MOCK_DATE_NOW__ || Date.now();
    const frame = pickIndexFrame(index, Math.round(base / 3600000) * 3600000);   // the app's hour 0 (getSeriesAnchorMs)
    if (!frame || !frame.path) { rec.skipped = 'no_frame'; return null; }
    return new Promise((resolve) => { idle(() => resolve(loadFrameVectors(key, frame, undefined, { priority: 'low' }))); })
      .then((vectors) => { rec.frameMs = ms(); rec.frame = vectors ? frame.valid_time : null; return vectors ? frame.valid_time : null; });
  }).catch(() => { rec.skipped = 'error'; return null; });
  return _prewarm;
}

export function _resetStaticFramesForTest() {
  _prewarm = null;
  _state.latest = null; _state.latestAt = 0; _state.latestLoad = null; _state.latestFails = 0; _state.pins.clear(); _state.lastUse = 0;
  _state.indexLoads.clear(); _lru.clear(); _inflight.clear(); _parsedInflight.clear(); _pending.clear();
  if (_worker) { try { _worker.terminate(); } catch (e) { /* ignore */ } }
  _worker = null; _workerFailed = false;
  _resetRegionalForTest();
  if (typeof window !== 'undefined') delete window.__RAW_STATIC_FRAMES__;
}
