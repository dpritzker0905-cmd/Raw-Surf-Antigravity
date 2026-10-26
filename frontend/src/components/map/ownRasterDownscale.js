/**
 * ownRasterDownscale.js - the air-temperature elevation downscale's static asset (2026-10-25).
 *
 * The owner, 2026-10-25 (relayed by the lead): "Go with your recommendation if that is state of the art". Air temperature
 * stays on 0.5-degree frames and is drawn as T + lapse * dz, where dz = real ground (NOAA ETOPO 2022, public domain) - the
 * model's 0.5-degree terrain. Against METAR 2 m temperature at 31 airports, the mountain mean absolute error fell from 2.87 to
 * 2.07 C (Open-Meteo's 13 km field: 2.46); flat stations did not move (log 2026-10-25-claude-raster-temp-downscale).
 *
 * The asset is one descriptor (fixed, versioned path, no-cache) plus one or two immutable gzipped uint8 tiles
 * (backend/services/raster_downscale.py), 1.88 MB at 1/15 deg. It is fetched ONCE per page, on the first air-temperature
 * toggle (never prewarmed: most sessions never open the layer), through the static frames' fetch + inflate (off the main
 * thread). Until every tile is resident the field draws as is, never half adjusted.
 * Dark with the air-temperature own-frames path. Kill: window.__RAW_DISABLE_RASTER_TEMP_DOWNSCALE__ = true.
 */
import { fetchFrameBytes, staticFramesBase } from './staticFrames';

export const DZ_DESCRIPTOR = 'v1/gfs/weather/temperature/static/elevation_dz_v1.json';
const W = () => (typeof window !== 'undefined' ? window : {});
export const downscaleKilled = () => W().__RAW_DISABLE_RASTER_TEMP_DOWNSCALE__ === true;

function tel() {
  const w = W();
  if (!w.__RAW_OWN_RASTER__) w.__RAW_OWN_RASTER__ = { misses: {} };
  if (!w.__RAW_OWN_RASTER__.misses) w.__RAW_OWN_RASTER__.misses = {};
  return w.__RAW_OWN_RASTER__;
}
const miss = (why) => { const t = tel(); t.misses[`dz_${why}`] = (t.misses[`dz_${why}`] || 0) + 1; };

/** The descriptor's shape check: version 1, uint8 codes, 1-2 tiles whose sizes match the lattice. */
export function validDescriptor(d) {
  if (!d || d.version !== 1 || !d.lattice || !d.encoding || d.encoding.dtype !== 'uint8' || !Array.isArray(d.tiles)) return false;
  if (d.tiles.length < 1 || d.tiles.length > 2) return false;
  const L = d.lattice;
  if (!(L.cols > 1 && L.rows > 1 && L.dlat > 0 && L.dlon > 0)) return false;
  const inner = d.tiles.reduce((n, t) => n + t.cols - (d.encoding.overlap_cols || 0), 0);
  return inner === L.cols && d.tiles.every((t) => t.rows === L.rows && typeof t.path === 'string');
}

let _asset = null;
/** The decoded asset ({ lattice, offset, step, lapse, tiles: [{ col0, cols, rows, data }] }), or null (killed, no CDN, not
 *  published, a bad tile). One load per page, shared; a failure is retried on the next call. */
export function loadDownscale() {
  if (downscaleKilled()) return Promise.resolve(null);
  if (_asset) return _asset;
  const base = staticFramesBase();
  if (!base) return Promise.resolve(null);
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  _asset = (async () => {
    const res = await fetch(base + DZ_DESCRIPTOR, { cache: 'no-cache', credentials: 'omit' });
    if (!res.ok) { miss(res.status === 404 || res.status === 400 ? 'not_published' : `http_${res.status}`); return null; }
    const d = await res.json();
    if (!validDescriptor(d)) { miss('bad_descriptor'); return null; }
    let wire = 0;
    const tiles = await Promise.all(d.tiles.map(async (t) => {
      const got = await fetchFrameBytes(base + t.path, undefined, 'low');
      if (!got || got.error) throw new Error(`tile ${t.path}: ${got && got.error}`);
      const data = new Uint8Array(got.buffer);
      if (data.length !== t.rows * t.cols) throw new Error(`tile ${t.path}: ${data.length} bytes, expected ${t.rows * t.cols}`);
      wire += got.wire || 0;
      return { col0: t.col0, cols: t.cols, rows: t.rows, data };
    }));
    const asset = { lattice: d.lattice, offset: d.encoding.offset, step: d.encoding.step_m, lapse: d.lapse_K_per_m, tiles, credit: d.credit };
    tel().downscale = { ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0), wire,
      tiles: tiles.map((t) => [t.cols, t.rows]) };
    return asset;
  })().catch(() => { miss('load_failed'); return null; })
    .then((asset) => { if (!asset) _asset = null; return asset; });   // only a loaded asset is kept: a miss retries next time
  return _asset;
}

// ── which layers are drawn terrain-adjusted right now (the legend credit names the elevation source while one is) ──────────
let _on = Object.freeze({});
const _subs = new Set();
export function setDownscaled(layer, on) {
  if (!!_on[layer] === !!on) return;
  _on = Object.freeze({ ..._on, [layer]: !!on });
  for (const fn of _subs) { try { fn(); } catch (e) { /* a subscriber's error is its own */ } }
}
export const getDownscaled = () => _on;
export function subscribeDownscaled(fn) { _subs.add(fn); return () => _subs.delete(fn); }

export function _resetDownscaleForTest() { _asset = null; _on = Object.freeze({}); _subs.clear(); }
