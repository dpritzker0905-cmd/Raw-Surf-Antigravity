/**
 * ownRasterFrames.js — the raster weather layers from OUR OWN static frames instead of Open-Meteo's .om files (2026-10-23).
 *
 * WHY. The owner: "I want ... all the layers ... instant load upon activating the toggle, and instant scrub" and "we want free
 * grib data". Today each raster hour is a 38-166 MB Open-Meteo .om file read in 64 KB ranges (1.1-5 MB per hour per layer,
 * a whole-world decode per hour; baseline in docs/weather-program/log/2026-10-22-claude-raster-instant.md), under
 * Open-Meteo's terms. The ingest now publishes the free NOAA GRIB fields as immutable gzipped RSWF frames on our CDN
 * (backend/services/frame_binary.py; the publisher is the static-frames lane's), one set per model x layer, listed in
 * v1/latest.json. Phase 1 is GFS mean-sea-level pressure:
 *   set  GFS/weather/pressure/global_0p5   720 x 361, outer cell centres -180..179.5 / -90..90, south row first, no wrap
 *        column; f000-f336 every 3 h; field 6 pressure_hpa u16 (value = code * 0.1 + 799.9, code 0 = no data).
 * This module holds the data side: the pinned index (staticFrames' pin rules), the frame for an asked time (the nearest stored
 * frame within 3 h, pickIndexFrame: NO time interpolation, the status line says "nearest stored forecast"), a direction-aware
 * window of at most +-2 frames (+-1 on handhelds) and a small LRU of decoded Float32 fields. Raster frames do NOT join any
 * idle whole-run fill (egress): only the window is fetched, on demand. ownRasterLayer.js draws; useOwnRasterFrames.js wires.
 *
 * Phase 1 is DARK: window.__RAW_RASTER_OWN_FRAMES__ = true (or localStorage '__RAW_RASTER_OWN_FRAMES__' = 'true') turns it on;
 * window.__RAW_DISABLE_RASTER_OWN_FRAMES__ = true, the static-frames global kill or the per-set kill
 * (__RAW_DISABLE_STATIC_FRAMES_SETS__) turn it off. Any miss (no set published, no index) falls back to the .om path.
 * Telemetry: window.__RAW_OWN_RASTER__.
 */
import { getPinnedIndex, loadFrameParsed, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';
import { pickIndexFrame } from './staticFrameCodec';
import { isHandheldDevice } from './deviceTier';

export const PRESSURE_FIELD = 6;
// PER-MODEL (2026-10-24; the owner, 2026-10-23 20:13 EDT: "Yes start it", answering "start the per-model pressure route?" after
// "We want each models pressure showing"): one published set per model. The layer follows the model selector; past a model's
// last frame (EURO 240 h, ICON 180 h) the GFS frame stands in, labelled as an estimate (the wave layers' extension policy).
export const OWN_RASTER_SETS = {
  pressure: {
    models: { GFS: 'GFS/weather/pressure/global_0p5', EURO: 'EURO/weather/pressure/global_0p5', ICON: 'ICON/weather/pressure/global_0p5' },
    fallback: 'GFS', field: PRESSURE_FIELD, unit: 'hPa',
  },
};
// Who the frames come from, for the legend credit and the status line.
export const MODEL_SOURCE = { GFS: 'NOAA GFS', EURO: 'ECMWF', ICON: 'DWD ICON' };
const up = (m) => String(m || 'GFS').toUpperCase();
/** The set key for a layer and model, or null when that model has no own set. */
export function setKey(layer, model = 'GFS') {
  const set = OWN_RASTER_SETS[layer];
  return (set && set.models[up(model)]) || null;
}
export const MISSING = -9999;     // what a no-data node becomes in the uploaded field (every real value is positive)
const LRU_MAX = 6;                // the desktop window (4) plus the last two shown
const STEPS_KEPT = 400;

const W = () => (typeof window !== 'undefined' ? window : {});

/** Is the own-frames path on for this layer and model? Synchronous, no I/O. A model without its own set (or with its set killed)
 *  stays on the .om path, which draws that model as before (never another model's frames under its label). */
export function ownFramesOn(layer, model = 'GFS') {
  const key = setKey(layer, model);
  if (!key) return false;
  const w = W();
  if (w.__RAW_DISABLE_RASTER_OWN_FRAMES__ === true) return false;
  let on = w.__RAW_RASTER_OWN_FRAMES__ === true;
  if (!on) {
    try { on = !!w.localStorage && w.localStorage.getItem('__RAW_RASTER_OWN_FRAMES__') === 'true'; } catch (e) { on = false; }
  }
  return on && staticFramesEnabled() && !!staticFramesBase() && staticSetEnabled(key);
}

export function tel() {
  const w = W();
  if (!w.__RAW_OWN_RASTER__) {
    w.__RAW_OWN_RASTER__ = { loads: 0, loadErrors: 0, bytes: 0, decodeMs: [], misses: {}, steps: [], shown: null, want: null, pin: null };
  }
  return w.__RAW_OWN_RASTER__;
}
export function noteMiss(reason) { const t = tel(); t.misses[reason] = (t.misses[reason] || 0) + 1; }

// The last index pinned per layer and model: a toggle draws from it at once (one frame round trip) while ownIndex refreshes it.
const _lastIndex = {};
export const lastIndex = (layer, model = 'GFS') => _lastIndex[`${layer}/${up(model)}`] || null;

/** The pinned index for a layer's set of one model (async; null when none is published or the path is off). */
export async function ownIndex(layer, model = 'GFS') {
  if (!ownFramesOn(layer, model)) return null;
  try {
    const idx = await getPinnedIndex(setKey(layer, model));
    if (idx) _lastIndex[`${layer}/${up(model)}`] = idx;
    if (idx) tel().pin = { layer, model: up(model), index: idx.path || null, run: idx.run || null, frames: idx.frames.length, validMs: framesOf(idx).map((f) => Date.parse(f.valid_time)) };
    return idx || null;
  } catch (e) { return null; }
}

/**
 * The frames a scrub walks for one model: its own, then (when it has a fallback and the fallback's index is given) the
 * fallback's frames past its last one, flagged `estimated` (the basis the status line names). Each entry is a shallow copy
 * carrying the set key it loads from (`setKey`) and the model it shows (`model`); the indexes are never mutated.
 */
export function combinedFrames(layer, model, index, fallbackIndex) {
  const m = up(model);
  const own = framesOf(index).map((f) => ({ ...f, setKey: setKey(layer, m), model: m, estimated: null }));
  const fb = OWN_RASTER_SETS[layer] && OWN_RASTER_SETS[layer].fallback;
  if (!fallbackIndex || !fb || fb === m || !own.length) return own;
  const last = Date.parse(own[own.length - 1].valid_time);
  const tail = framesOf(fallbackIndex).filter((f) => Date.parse(f.valid_time) > last)
    .map((f) => ({ ...f, setKey: setKey(layer, fb), model: fb, estimated: 'gfs_estimated_fallback' }));
  return own.concat(tail);
}

/** The entry to show for an asked time in a combined list: the nearest within 3 h of the model's own, else (past its range)
 *  of the stand-in tail. pickIndexFrame's rule on each part, so own frames always win inside the model's range. */
export function combinedFrameAt(frames, validMs) {
  const own = frames.filter((f) => !f.estimated);
  const f = pickIndexFrame({ frames: own }, validMs);
  if (f && f.path) return f;
  const lastOwn = own.length ? Date.parse(own[own.length - 1].valid_time) : -Infinity;
  if (validMs <= lastOwn) return null;
  const g = pickIndexFrame({ frames: frames.filter((x) => x.estimated) }, validMs);
  return g && g.path ? g : null;
}

/** The index's frames that have a file, in valid-time order (the window walks these). */
export function framesOf(index) {
  return index && Array.isArray(index.frames) ? index.frames.filter((f) => f && f.path) : [];
}

/** The frame to show for an asked time: the nearest stored one within 3 h, or null (a gap: the caller shows nothing). */
export function frameAt(index, validMs) {
  const f = pickIndexFrame(index, validMs);
  return f && f.path ? f : null;
}

export function windowRadius() { return isHandheldDevice() ? 1 : 2; }

/**
 * The frame positions to hold, in fetch priority: the shown one, then up to `radius` ahead in the scrub direction, then one
 * behind (a reversal then costs no wait). `dir` < 0 is a backward scrub. Desktop (radius 2): 4 frames; handheld (1): 3.
 */
export function planWindow(cur, n, dir, radius) {
  if (!(n > 0) || !(cur >= 0) || cur >= n) return [];
  const d = dir < 0 ? -1 : 1;
  const out = [cur];
  for (let k = 1; k <= radius; k++) { const a = cur + d * k; if (a >= 0 && a < n) out.push(a); }
  const b = cur - d;
  if (radius >= 1 && b >= 0 && b < n) out.push(b);
  return out;
}

/** A decoded frame's one field as the renderer uploads it: Float32 values, MISSING for no data. */
export function toField(parsed, fieldId) {
  const src = parsed && parsed.fields && parsed.fields[fieldId];
  if (!src || src.length !== parsed.cols * parsed.rows) return null;
  const values = new Float32Array(src.length);
  let min = Infinity; let max = -Infinity;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isFinite(v)) { values[i] = v; if (v < min) min = v; if (v > max) max = v; } else values[i] = MISSING;
  }
  return {
    cols: parsed.cols, rows: parsed.rows, bounds: parsed.bounds, values, min, max,
    validMs: parsed.validEpoch * 1000, runMs: Number.isFinite(parsed.runEpoch) ? parsed.runEpoch * 1000 : null,
  };
}

// ── decoded fields: one load per path, shared; an LRU over the window ────────────────────────────────────────────
const _fields = new Map();
const _inflight = new Map();

/** The decoded field for a frame path, if held (no I/O; refreshes its LRU place). */
export function getField(path) {
  const f = _fields.get(path);
  if (f) { _fields.delete(path); _fields.set(path, f); }
  return f || null;
}

function keep(path, field) {
  _fields.set(path, field);
  while (_fields.size > LRU_MAX) _fields.delete(_fields.keys().next().value);
}

/** Load (fetch + inflate + parse + field) one frame; null on any failure. Shared per path; never aborted once started (a
 *  started frame is at most a window away, and the pump below bounds how many start). */
export function loadField(layer, frame, priority) {
  if (!frame || !frame.path) return Promise.resolve(null);
  const have = getField(frame.path);
  if (have) return Promise.resolve(have);
  const set = OWN_RASTER_SETS[layer];
  if (!set) return Promise.resolve(null);
  const key = frame.setKey || setKey(layer, 'GFS');
  let p = _inflight.get(frame.path);
  if (!p) {
    p = (async () => {
      const t = tel();
      t.loads += 1;
      // Fetch priority (staticFrames, #479): 'high' for the frame the step wants, 'low' for the rest of the window.
      const got = await loadFrameParsed(key, frame, undefined, priority ? { priority } : undefined);
      if (!got) { t.loadErrors += 1; noteMiss('load_failed'); return null; }
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const field = toField(got.parsed, set.field);
      const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (!field) { noteMiss('no_field'); return null; }
      t.bytes += got.wire || 0;
      t.decodeMs.push(Math.round((t1 - t0) * 10) / 10);
      if (t.decodeMs.length > 50) t.decodeMs.shift();
      keep(frame.path, field);
      return field;
    })().finally(() => _inflight.delete(frame.path));
    _inflight.set(frame.path, p);
  }
  return p;
}

// ── the window pump: at most MAX_IN_FLIGHT loads, started in the wanted order; a frame that left the window is never started ──
export const MAX_IN_FLIGHT = 3;
const _pump = { layer: null, wanted: [], onField: null };

/** Replace the wanted window (frames in priority order). onField(path, field) fires for each wanted frame as it lands. */
export function setWanted(layer, frames, onField) {
  _pump.layer = layer;
  _pump.wanted = (frames || []).filter((f) => f && f.path);
  _pump.onField = onField || null;
  pump();
}

function pump() {
  const { layer, wanted } = _pump;
  wanted.forEach((f, i) => {
    if (_inflight.size >= MAX_IN_FLIGHT) return;
    if (_fields.has(f.path) || _inflight.has(f.path)) return;
    loadField(layer, f, i === 0 ? 'high' : 'low').then((field) => {
      if (field && _pump.onField && _pump.wanted.some((w) => w.path === f.path)) _pump.onField(f.path, field);
      pump();
    });
  });
}

// ── which layers are drawn from our frames right now (the legend credit reads it) ──────────────────────────────────
let _engaged = Object.freeze({});
const _engagedSubs = new Set();
/** `on`: false, or the model of the frame on screen ('GFS' | 'EURO' | 'ICON'; `true` reads as GFS). */
export function setEngaged(layer, on) {
  const v = on === true ? 'GFS' : (on || false);
  if ((_engaged[layer] || false) === v) return;
  _engaged = Object.freeze({ ..._engaged, [layer]: v });
  for (const fn of _engagedSubs) { try { fn(); } catch (e) { /* a subscriber's error is its own */ } }
}
export const getEngaged = () => _engaged;
export function subscribeEngaged(fn) { _engagedSubs.add(fn); return () => _engagedSubs.delete(fn); }

/** Record one scrub step for the hit-rate-vs-velocity read: was the wanted frame already decoded when asked? */
export function noteStep(path, hit, at = Date.now()) {
  const s = tel().steps;
  s.push([at, path, hit ? 1 : 0]);
  if (s.length > STEPS_KEPT) s.shift();
}

export function _resetOwnRasterFramesForTest() {
  _fields.clear();
  _inflight.clear();
  _pump.layer = null; _pump.wanted = []; _pump.onField = null;
  _engaged = Object.freeze({});
  for (const k of Object.keys(_lastIndex)) delete _lastIndex[k];
  const w = W();
  delete w.__RAW_OWN_RASTER__;
}
