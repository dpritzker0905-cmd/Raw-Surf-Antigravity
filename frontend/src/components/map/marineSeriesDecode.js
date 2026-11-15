/**
 * marineSeriesDecode.js: the /grid_series page decode, OFF the main thread (2026-11-15; the researcher's #912 item #2).
 *
 * WHY. A 48-frame series page is up to several MB of JSON. Today the main thread reads the body, runs `JSON.parse` and builds a
 * marineData object for every frame (`frameToMarineData`) the moment the page lands: a world page is a long task on a phone.
 * Measured offline (docs/weather-program/log/2026-11-15-opus-series-decode-worker.md): a parse-only worker would be WORSE (the
 * main thread receives the object graph through structured clone, ~2x JSON.parse), and an eager rebuild from typed columns
 * saves only 19-49%. So:
 *   - the worker fetches the page, parses it and packs each frame's vectors into typed columns (transferred, zero copy);
 *   - the main thread keeps the frames packed in a LazySeriesFrames map and builds a frame (its vectors, frameToMarineData,
 *     the truth-tag mint on the REAL vectors) the first time that frame is read. A scrub builds only what it shows.
 * The built objects are identical to JSON.parse's: same key order, numbers bit-exact (Float64Array keeps -0), null and an
 * absent key kept distinct. A frame whose vectors do not fit the columns (an unknown key, a non-number cell, a different key
 * order between cells) travels unpacked, as JSON.parse made it.
 *
 * FALLBACK: no Worker / Blob / URL, a worker error, a pack failure, or the kill switch: the page is decoded on the main
 * thread exactly as before (the caller's own path). Kill: window.__RAW_DISABLE_SERIES_DECODE_WORKER__ = true.
 * TELEMETRY (both paths, the pre-registered gate's metric): window.__MARINE_SERIES_DIAG__.decodeMs / .decodes / .workerPages.
 */
import { frameToMarineData } from './marineSeriesFrame';

// The vector fields the server sends that are numbers or null. is_valid (a boolean) is carried apart.
export const SERIES_NUM_KEYS = ['lat', 'lng', 'speed', 'direction', 'u', 'v', 'period', 'gust', 'value', 'dir_confidence'];

export function seriesDecodeWorkerOn() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_SERIES_DECODE_WORKER__ === true);
}

function diag() {
  if (typeof window === 'undefined') return { decodeMs: 0, decodes: 0, workerPages: 0, mainPages: 0 };
  const d = (window.__MARINE_SERIES_DIAG__ = window.__MARINE_SERIES_DIAG__ || { loads: 0, hits: 0, misses: 0 });
  if (d.decodeMs === undefined) { d.decodeMs = 0; d.decodes = 0; d.workerPages = 0; d.mainPages = 0; }
  return d;
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export function noteDecodeMs(ms, idle) { const d = diag(); d.decodeMs += ms; d.decodes += 1; if (idle) d.idleDecodeMs = (d.idleDecodeMs || 0) + ms; }

// ONE frame -> its columns. Runs INSIDE the worker (stringified into WORKER_SRC) and in tests. It must stay self-contained,
// ES5-shaped code: no closure references (the minifier renames them), no rest/spread or for..of (Babel would turn them into
// helpers the worker does not have). `keys` is SERIES_NUM_KEYS, passed in.
export function packSeriesFrame(f, keys) {
  var order = Object.keys(f);
  var meta = {};
  for (var oi = 0; oi < order.length; oi++) if (order[oi] !== 'vectors') meta[order[oi]] = f[order[oi]];
  var vecs = f.vectors;
  if (!Array.isArray(vecs) || vecs.length === 0) return { order: order, meta: meta, raw: vecs };
  var keyOrder = Object.keys(vecs[0]);
  var sig = keyOrder.join(',');
  var known = {};
  for (var ki = 0; ki < keys.length; ki++) known[keys[ki]] = true;
  for (var ko = 0; ko < keyOrder.length; ko++) if (keyOrder[ko] !== 'is_valid' && !known[keyOrder[ko]]) return { order: order, meta: meta, raw: vecs };
  var n = vecs.length;
  var cols = {};
  var present = {};
  for (var k = 0; k < keys.length; k++) { cols[keys[k]] = new Float64Array(n); present[keys[k]] = new Uint8Array(n); }
  var valid = new Uint8Array(n);
  for (var i = 0; i < n; i++) {
    var v = vecs[i];
    if (v === null || typeof v !== 'object' || Object.keys(v).join(',') !== sig) return { order: order, meta: meta, raw: vecs };
    for (var j = 0; j < keyOrder.length; j++) {
      var key = keyOrder[j];
      var x = v[key];
      if (key === 'is_valid') {
        if (x !== true && x !== false) return { order: order, meta: meta, raw: vecs };
        valid[i] = x ? 1 : 0;
      } else if (x === null) {
        present[key][i] = 2;
      } else if (typeof x === 'number') {
        present[key][i] = 1;
        cols[key][i] = x;
      } else {
        return { order: order, meta: meta, raw: vecs };
      }
    }
  }
  return { order: order, meta: meta, n: n, keyOrder: keyOrder, cols: cols, present: present, valid: valid };
}

/** The transferable buffers of a packed frame (none for a raw one). */
export function packedBuffers(p) {
  if (!p || !p.cols) return [];
  const out = [p.valid.buffer];
  for (const k of Object.keys(p.cols)) out.push(p.cols[k].buffer, p.present[k].buffer);
  return out;
}

/** A packed frame -> the frame object JSON.parse made: same key order, vectors rebuilt cell by cell. */
export function unpackSeriesFrame(p) {
  let vectors;
  if (!p.cols) vectors = p.raw;
  else {
    vectors = new Array(p.n);
    const { keyOrder, cols, present, valid } = p;
    for (let i = 0; i < p.n; i += 1) {
      const o = {};
      for (let j = 0; j < keyOrder.length; j += 1) {
        const key = keyOrder[j];
        if (key === 'is_valid') { o.is_valid = valid[i] === 1; continue; }
        const at = present[key][i];
        if (at === 1) o[key] = cols[key][i];
        else if (at === 2) o[key] = null;
      }
      vectors[i] = o;
    }
  }
  const frame = {};
  for (const k of p.order) frame[k] = k === 'vectors' ? vectors : p.meta[k];
  return frame;
}

/** Vectors in a packed frame without building them (the page loop's "has vectors" test). */
export const packedVectorCount = (p) => (p.cols ? p.n : (Array.isArray(p.raw) ? p.raw.length : 0));

/**
 * The frames of a page, keyed by hour offset, built on first read. `get` builds one frame; `has`, `size`, `keys` and `delete`
 * build nothing; a full iteration (`values`, `entries`, `forEach`, spread) builds every frame, so no caller ever sees a packed
 * one. `metaValues()` yields each frame's metadata (the marineData's top-level cycle fields and the grid bounds) WITHOUT
 * building it, for the page's own all-frame readers.
 */
// BUILD AHEAD (2026-11-15, gate 3): a step whose frame is not built yet pays its build on the step. So in idle time, one frame
// per idle callback (never a long task), the page's first frame is built when the page lands, and the neighbours of a frame that
// was just read are built next. Kill: window.__RAW_DISABLE_SERIES_BUILD_AHEAD__ = true (build on first read only).
export const buildAheadOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_SERIES_BUILD_AHEAD__ === true);
function whenIdle(fn) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 50);
}

export class LazySeriesFrames extends Map {
  constructor(packedByHour, model, layer) {
    super();
    this._packed = packedByHour;   // Map hour -> packed frame
    this._model = model;
    this._layer = layer;
    this._order = [...packedByHour.keys()].sort((a, b) => a - b);
    this._ahead = new Set();
    for (const h of packedByHour.keys()) super.set(h, undefined);
    if (this._order.length) this._buildAhead(this._order[0]);
  }

  _buildAhead(h) {
    if (!buildAheadOn() || !this._packed.has(h) || this._ahead.has(h)) return;
    this._ahead.add(h);
    whenIdle(() => { this._ahead.delete(h); if (this._packed.has(h)) this._build(h, true); });
  }

  _neighbours(h) {
    const i = this._order.indexOf(h);
    if (i < 0) return;
    if (i + 1 < this._order.length) this._buildAhead(this._order[i + 1]);
    if (i > 0) this._buildAhead(this._order[i - 1]);
  }

  _build(h, idle) {
    const p = this._packed.get(h);
    if (!p) return super.get(h);
    const t0 = now();
    const md = frameToMarineData(unpackSeriesFrame(p), this._model, this._layer);
    noteDecodeMs(now() - t0, idle);   // idle: built ahead, off the step path (counted apart as idleDecodeMs too)
    this._packed.delete(h);
    super.set(h, md);
    return md;
  }

  get(h) {
    const md = this._packed.has(h) ? this._build(h) : super.get(h);
    if (md !== undefined) this._neighbours(h);
    return md;
  }

  set(h, v) { this._packed.delete(h); return super.set(h, v); }

  delete(h) { this._packed.delete(h); return super.delete(h); }

  clear() { this._packed.clear(); super.clear(); }

  _buildAll() { for (const h of [...this._packed.keys()]) this._build(h); }

  values() { this._buildAll(); return super.values(); }

  entries() { this._buildAll(); return super.entries(); }

  [Symbol.iterator]() { this._buildAll(); return super.entries(); }

  forEach(fn, thisArg) { this._buildAll(); return super.forEach(fn, thisArg); }

  /** Per frame, the fields the page's own readers need, never building a frame. */
  * metaValues() {
    for (const h of super.keys()) {
      const p = this._packed.get(h);
      if (!p) { yield super.get(h); continue; }
      const m = p.meta;
      yield { model_run_time: m.model_run_time ?? null, model_run_time_status: m.model_run_time_status || 'missing', grid: { bounds: m.bounds } };
    }
  }
}

/**
 * A decoded page's frames as the page loop wants them: { frames, hours }, frames keyed by hour offset, empty-vector frames
 * skipped (as before). `packed` (worker) -> a LazySeriesFrames; `json` (main thread) -> a plain Map built now, as before.
 */
export function seriesPageFrames({ packed, json }, model, layer) {
  const hours = [];
  if (packed) {
    const byHour = new Map();
    for (const p of packed) {
      if (typeof p.meta.hour_offset !== 'number' || packedVectorCount(p) === 0) continue;
      byHour.set(p.meta.hour_offset, p);
      hours.push(p.meta.hour_offset);
    }
    return { frames: new LazySeriesFrames(byHour, model, layer), hours };
  }
  const t0 = now();
  const frames = new Map();
  for (const f of json.frames) {
    if (typeof f.hour_offset !== 'number' || !f.vectors || f.vectors.length === 0) continue;
    frames.set(f.hour_offset, frameToMarineData(f, model, layer));
    hours.push(f.hour_offset);
  }
  noteDecodeMs(now() - t0);
  return { frames, hours };
}

/** The first frame's grid bounds without building it (the coarse-preview test). */
export function firstFrameBounds(frames) {
  const first = typeof frames.metaValues === 'function' ? frames.metaValues().next().value : frames.values().next().value;
  return first && first.grid && first.grid.bounds;
}

// ── the worker ────────────────────────────────────────────────────────────────────────────────────────────────────
const WORKER_SRC = `var KEYS = ${JSON.stringify(SERIES_NUM_KEYS)};
var packSeriesFrame = ${packSeriesFrame.toString()};
var ctl = new Map();
self.onmessage = async function (e) {
  var m = e.data;
  if (m.abort) { var c0 = ctl.get(m.id); if (c0) c0.abort(); return; }
  var c = new AbortController(); ctl.set(m.id, c);
  try {
    var init = { signal: c.signal };
    if (m.priority) init.priority = m.priority;
    var res = await fetch(m.url, init);
    if (!res.ok) { self.postMessage({ id: m.id, status: res.status }); return; }
    var json = await res.json();
    var frames = Array.isArray(json && json.frames) ? json.frames : null;
    var top = {}; for (var k in json) if (k !== 'frames') top[k] = json[k];
    var packed = null; var transfer = [];
    if (frames) {
      packed = [];
      for (var i = 0; i < frames.length; i++) {
        var p = packSeriesFrame(frames[i], KEYS);
        packed.push(p);
        if (p.cols) { transfer.push(p.valid.buffer); for (var key in p.cols) { transfer.push(p.cols[key].buffer, p.present[key].buffer); } }
      }
    }
    self.postMessage({ id: m.id, status: res.status, top: top, packed: packed }, transfer);
  } catch (err) {
    self.postMessage({ id: m.id, error: (err && err.name === 'AbortError') ? 'aborted' : ('pack:' + String((err && err.message) || err)) });
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
  } catch (e) {
    _workerFailed = true;
    _worker = null;
  }
  return _worker;
}

/**
 * Fetch + decode one series page. Resolves { ok, status, json, packed } where json is the page's top level (frames left out
 * when packed) or { aborted } / { fallback } (no worker, a worker error or a pack failure: the caller decodes on the main
 * thread as before). Never throws. `init` is the caller's fetch init ({ signal, priority? }).
 */
export function fetchSeriesPage(url, init) {
  const signal = init && init.signal;
  if (!seriesDecodeWorkerOn()) return Promise.resolve({ fallback: 'off' });
  if (signal && signal.aborted) return Promise.resolve({ aborted: true });
  const w = getWorker();
  if (!w) return Promise.resolve({ fallback: 'no_worker' });
  const id = ++_seq;
  return new Promise((resolve) => {
    let onAbort = null;
    _pending.set(id, { resolve: (d) => {
      if (signal && onAbort) { try { signal.removeEventListener('abort', onAbort); } catch (e) { /* ignore */ } }
      if (d.error === 'aborted') { resolve({ aborted: true }); return; }
      if (d.error) {
        if (String(d.error).startsWith('pack:') || d.error === 'worker_error') { _workerFailed = _workerFailed || d.error === 'worker_error'; resolve({ fallback: d.error }); return; }
        resolve({ error: d.error });
        return;
      }
      if (!(d.status >= 200 && d.status < 300)) { resolve({ ok: false, status: d.status }); return; }
      const t0 = now();
      const json = d.top || {};
      const out = { ok: true, status: d.status, json, packed: d.packed };
      if (d.packed) { json.frames = d.packed; diag().workerPages += 1; }
      noteDecodeMs(now() - t0);
      resolve(out);
    } });
    if (signal) {
      onAbort = () => { try { w.postMessage({ id, abort: true }); } catch (e) { /* ignore */ } };
      try { signal.addEventListener('abort', onAbort); } catch (e) { /* ignore */ }
    }
    try { w.postMessage({ id, url, priority: init && init.priority }); } catch (e) {
      _pending.delete(id);
      resolve({ fallback: 'post_failed' });
    }
  });
}

/** The main-thread decode (the kill switch and every fallback): read the body, parse it, count the parse. */
export async function decodeSeriesResponseMainThread(res) {
  if (typeof res.text !== 'function') { diag().mainPages += 1; return res.json(); }   // a test double with json() only
  const text = await res.text();
  const t0 = now();
  const json = JSON.parse(text);
  noteDecodeMs(now() - t0);
  diag().mainPages += 1;
  return json;
}

const abortError = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };

/**
 * One series page, decoded: { ok, status, json, packed }. The worker when it is on and available, else the main thread as
 * before (`fetch` + parse). Throws an AbortError when aborted and an Error on a network failure, as `fetch` did, so the
 * caller's catch keeps its retry rules. `packed` is set only on the worker path.
 */
export async function loadSeriesJson(url, init) {
  const dec = await fetchSeriesPage(url, init);
  if (dec.aborted) throw abortError();
  if (dec.error) throw new Error(dec.error);
  if (!dec.fallback) return dec.ok ? { ok: true, status: dec.status, json: dec.json, packed: dec.packed } : { ok: false, status: dec.status };
  const res = await fetch(url, init);
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status, json: await decodeSeriesResponseMainThread(res), packed: null };
}

/** The h0 mini's one frame: the first with an hour and vectors, built (only that one) when packed. */
export function seriesMiniFrame({ json, packed }) {
  if (!packed) return json.frames.find((x) => typeof x.hour_offset === 'number' && x.vectors && x.vectors.length > 0) || null;
  const p = packed.find((x) => typeof x.meta.hour_offset === 'number' && packedVectorCount(x) > 0);
  if (!p) return null;
  const t0 = now();
  const f = unpackSeriesFrame(p);
  noteDecodeMs(now() - t0);
  return f;
}

export function _resetSeriesDecodeWorkerForTest() {
  if (_worker) { try { _worker.terminate(); } catch (e) { /* ignore */ } }
  _worker = null; _workerFailed = false; _seq = 0; _pending.clear();
}
