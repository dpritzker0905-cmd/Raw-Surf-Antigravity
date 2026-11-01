/**
 * isobarStore.js — isobars + H/L per pressure frame, computed in a worker and cached by frame path (2026-10-24, per-model
 * pressure). Never on the scrub path: useOwnRasterFrames asks for a frame's products when the frame LANDS in the window (the pump),
 * and the map layer only reads the cache when the colour field cuts to that frame (usePressureIsobars).
 * Kill: window.__RAW_DISABLE_RASTER_ISOBARS__ = true (no isobars, no H/L, no worker). Telemetry: window.__RAW_ISOBARS__.
 */
import { isobarProducts } from './isobarContours';

const CACHE_MAX = 12;
const W = () => (typeof window !== 'undefined' ? window : {});
export const isobarsOn = () => W().__RAW_DISABLE_RASTER_ISOBARS__ !== true;

const _cache = new Map();       // path -> { lines, centres }
const _pending = new Map();     // path -> Promise
const _waiters = new Map();     // worker message id -> resolve
const _subs = new Set();
let _workerP = null; let _worker = null; let _seq = 0;

function tel() {
  const w = W();
  const t = (w.__RAW_ISOBARS__ = w.__RAW_ISOBARS__ || {});          // shared with usePressureIsobars' visiblePath
  if (!Array.isArray(t.ms)) Object.assign(t, { computed: 0, cached: 0, ms: [], errors: 0, worker: t.worker || null });
  return t;
}

// The worker, created once: a dynamic import of isobarWorkerFactory (its module-URL constructor never reaches Jest: no Worker there).
// Resolves to null when there is no Worker or it fails: requests then compute after the current task instead.
function worker() {
  if (_workerP) return _workerP;
  if (typeof Worker === 'undefined') { tel().worker = 'none'; _workerP = Promise.resolve(null); return _workerP; }
  _workerP = import('./isobarWorkerFactory').then((m) => {
    const w = m.createIsobarWorker();
    w.onmessage = (e) => { const r = _waiters.get(e.data.id); if (r) { _waiters.delete(e.data.id); r(e.data); } };
    w.onerror = () => {
      _worker = null; _workerP = Promise.resolve(null); tel().worker = 'failed';
      for (const r of _waiters.values()) r({ error: 'worker error' });
      _waiters.clear();
    };
    _worker = w; tel().worker = 'module';
    return w;
  }).catch(() => { tel().worker = 'none'; return null; });
  return _workerP;
}

/** The cached products for a frame path, or null (no I/O, no compute). */
export function getIsobars(path) {
  const v = _cache.get(path);
  if (v) { _cache.delete(path); _cache.set(path, v); }
  return v || null;
}

/** Subscribe to "products for `path` are ready": fn(path). Returns the unsubscribe. */
export function onIsobarsReady(fn) { _subs.add(fn); return () => _subs.delete(fn); }

function keep(path, products) {
  _cache.set(path, products);
  while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
  for (const fn of _subs) { try { fn(path); } catch (e) { /* a subscriber's own */ } }
}

/** Compute (once per path) the isobars and centres of a decoded field. Resolves to the products, or null. */
export function requestIsobars(path, field, opts) {
  if (!isobarsOn() || !path || !field) return Promise.resolve(null);
  const have = getIsobars(path);
  if (have) { tel().cached += 1; return Promise.resolve(have); }
  if (_pending.has(path)) return _pending.get(path);
  const p = worker().then((w) => new Promise((resolve) => {
    if (w) {
      const id = ++_seq;
      _waiters.set(id, resolve);
      // A COPY of the values: the field stays in the frame LRU (and on the GPU path); the copy is transferred, not cloned twice.
      const values = new Float32Array(field.values);
      w.postMessage({ id, cols: field.cols, rows: field.rows, bounds: field.bounds, values, opts }, [values.buffer]);
    } else {
      // No worker (tests, an old browser): compute after the current task, still never inside a scrub step's handler.
      setTimeout(() => {
        const t0 = Date.now();
        try { resolve({ ...isobarProducts(field, opts), ms: Date.now() - t0 }); } catch (e) { resolve({ error: String(e) }); }
      }, 0);
    }
  })).then((r) => {
    _pending.delete(path);
    if (!r || r.error) { tel().errors += 1; return null; }
    const t = tel(); t.computed += 1; t.ms.push(r.ms); if (t.ms.length > 50) t.ms.shift();
    const products = { lines: r.lines, centres: r.centres };
    keep(path, products);
    return products;
  });
  _pending.set(path, p);
  return p;
}

export function _resetIsobarStoreForTest() {
  _cache.clear(); _pending.clear(); _waiters.clear(); _subs.clear();
  if (_worker) { try { _worker.terminate(); } catch (e) { /* gone */ } }
  _worker = null; _workerP = null; _seq = 0;
  delete W().__RAW_ISOBARS__;
}
