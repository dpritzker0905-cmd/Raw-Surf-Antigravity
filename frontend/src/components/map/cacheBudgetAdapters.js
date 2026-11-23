/**
 * cacheBudgetAdapters.js — what each cache holds, as cacheBudget.js entries { key, bytes, model, layer, lastUse, pinned, id }
 * (2026-11-23). Pure: each takes the cache's own Map and the active view, reads sizes in O(1) per entry and NEVER builds a lazy
 * series frame (a LazySeriesFrames page is sized from its packed bytes: iterating its values() would decode every frame).
 *
 * PINNED = the active view's working set, which the budget never drops: the series page holding the selected hour, the per-hour
 * grids within PIN_HOURS of it, the frame-store set being scrubbed, the raster fields within PIN_HOURS of the selected instant and
 * the gap fill's anchors, the newest three decoded .om fields. Everything else on screen goes after everything off screen.
 *
 * Object grids (per-cell JS objects) are sized as cells x a per-cell constant, calibrated against heap snapshots of the same replay
 * (heap_census.cjs; the log of 2026-11-23): MARINE_CELL_BYTES for marine vectors (a cell object, its boxed numbers and its layer
 * records), WIND_CELL_BYTES for wind vectors. Typed arrays and ArrayBuffers are exact (byteLength).
 */
import { normLayer, normModel, onScreen } from './cacheBudget';

export const MARINE_CELL_BYTES = 160;
export const WIND_CELL_BYTES = 100;
export const PIN_HOURS = 3;

const bufBytes = (x) => (x && (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) ? x.byteLength : 0);
/** A packed record's own typed arrays (one level), or the buffer itself. */
export function packedBytes(p) {
  if (!p) return 0;
  const own = bufBytes(p);
  if (own) return own;
  let n = 0;
  for (const v of Object.values(p)) n += bufBytes(v);
  return n;
}
const vectorBytes = (vectors, perCell) => (!vectors ? 0 : (ArrayBuffer.isView(vectors) ? vectors.byteLength : (vectors.length || 0) * perCell));
const near = (hour, view) => view.hour != null && Number.isFinite(hour) && Math.abs(hour - view.hour) <= PIN_HOURS;

// ---- marine series pages (marineGridSeries._seriesCache) ----
export function seriesPageBytes(entry) {
  const frames = entry && entry.frames;
  let bytes = 256;
  if (!frames || typeof frames.size !== 'number') return bytes;
  const packed = frames._packed instanceof Map ? frames._packed : null;   // LazySeriesFrames: hour -> packed frame
  const seen = new Set();
  for (const h of Map.prototype.keys.call(frames)) {
    const p = packed && packed.get(h);
    if (p) { bytes += packedBytes(p) + 512; continue; }
    const md = Map.prototype.get.call(frames, h);
    const v = md && md.grid && md.grid.vectors;
    if (!v || seen.has(v)) continue;
    seen.add(v);
    bytes += vectorBytes(v, MARINE_CELL_BYTES) + 1024;
  }
  return bytes;
}
export function seriesEntries(cache, view) {
  const out = [];
  for (const [key, entry] of Map.prototype.entries.call(cache)) {
    if (!entry) continue;
    const e = { key, bytes: seriesPageBytes(entry), model: normModel(entry.model), layer: normLayer(entry.layer), lastUse: entry.__used || entry.ts || 0 };
    const hrs = entry.hours || [];
    e.pinned = onScreen(e, view) && view.hour != null && hrs.length > 0 && view.hour >= hrs[0] - PIN_HOURS && view.hour <= hrs[hrs.length - 1] + PIN_HOURS;
    out.push(e);
  }
  return out;
}

// ---- per-hour marine grids (marineControllerCache._perModelHourCache; aliases share one entry and one vectors array) ----
export function hourCacheEntries(cache, view) {
  const out = [];
  for (const [key, entry] of Map.prototype.entries.call(cache)) {
    const g = entry && entry.data && entry.data.grid;
    if (!g) continue;
    const k = String(key); const hour = Number(k.slice(k.lastIndexOf('_') + 1));
    const e = { key, bytes: vectorBytes(g.vectors, MARINE_CELL_BYTES) + 1024, id: g.vectors || null,
      model: normModel(entry.model || g.__sourceModel || k.split('_')[0]), layer: normLayer(g.__componentLayer || entry.data.layer),
      lastUse: entry.__used || entry.timestamp || 0 };
    e.pinned = onScreen(e, view) && near(hour, view);
    out.push(e);
  }
  return out;
}

// ---- the GPU frame store's CPU side, per SET (marineFrameStore; dropped by the runtime with its GPU array) ----
export function frameStoreEntries(store, activeKey) {
  const out = [];
  if (!store || !store.sets) return out;
  for (const s of store.sets.values()) {
    let bytes = 0;
    for (const f of s.frames.values()) bytes += bufBytes(f.packed) + bufBytes(f.raw) + bufBytes(f.validityBits) + bufBytes(f.oceanBitsPost);
    if (!bytes) continue;
    out.push({ key: s.key, bytes, model: normModel(s.model), layer: normLayer(s.layer), lastUse: s.lastActive || 0, pinned: s.key === activeKey });
  }
  return out;
}

// ---- raster own-frame fields (ownRasterFrames._fields / _anchors), keyed by CDN path ----
// v1/<model>/<domain>/<layer>/<tier>/<run>/<YYYYMMDDTHHMMSSZ>-<sha>.bin ; CMEMS currents are model-agnostic.
export function rasterPathView(path) {
  const p = String(path || '').split('/');
  const i = p[0] === 'v1' ? 1 : 0;
  const m = /(\d{8}T\d{6}Z)-[0-9a-f]+\.bin$/.exec(String(path || ''));
  const ms = m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : NaN;
  return { model: normModel(p[i]), layer: normLayer(p[i + 2]), validMs: Number.isFinite(ms) ? ms : null };
}
export const fieldBytes = (f) => (f ? bufBytes(f.values) + bufBytes(f.dirCodes) + bufBytes(f.mask) + bufBytes(f.speed) : 0);
/** The scrub window is the shown frame and its neighbours: the PIN_RASTER most recently used fields of the view on screen (the
 *  layer's getField reads stamp them). A gap fill's ANCHORS on screen are all pinned: every tail hour reads them. */
export const PIN_RASTER = 3;
export function rasterEntries(map, view, { anchors = false } = {}) {
  const out = [];
  for (const [path, f] of map) {
    const pv = rasterPathView(path);
    out.push({ key: path, bytes: fieldBytes(f), id: (f && f.values) || null, model: pv.model, layer: pv.layer, lastUse: (f && f.__used) || 0 });
  }
  const mine = out.filter((e) => onScreen(e, view)).sort((a, b) => b.lastUse - a.lastUse);
  for (const e of (anchors ? mine : mine.slice(0, PIN_RASTER))) e.pinned = true;
  return out;
}

// ---- decoded .om fields kept for the point infobox (window.__DECODED_OM_TILES__): the cheapest to lose ----
export function decodedOmEntries(map, view) {
  const out = [];
  if (!map) return out;
  for (const [key, v] of map) {
    if (!v) continue;
    out.push({ key, bytes: bufBytes(v.values) + bufBytes(v.directions), id: v.values || null, model: normModel(v.model),
      layer: normLayer(v.variable), lastUse: v.__used || v.timestamp || 0 });
  }
  // The raster ring has 3 slots (the shown hour and its neighbours): the 3 newest fields of the view on screen stay. Every infobox
  // card that reads these is gated on its own layer being on (forecastCardCompiler), so an off-screen field is never read.
  const mine = out.filter((e) => onScreen(e, view)).sort((a, b) => b.lastUse - a.lastUse).slice(0, 3);
  for (const e of mine) e.pinned = true;
  return out;
}

// ---- wind grids per model x tile x hour (windController.WIND_CACHE) ----
export function windCacheEntries(map, view) {
  const out = [];
  for (const [key, entry] of map) {
    const m = /^([A-Za-z]+)_wind_grid_.*_(-?\d+)$/.exec(String(key));
    const vecs = entry && entry.data && entry.data.vectors;
    const e = { key, bytes: vectorBytes(vecs, WIND_CELL_BYTES) + 512, id: vecs || null, model: normModel(m && m[1]), layer: 'wind',
      lastUse: (entry && (entry.__used || entry.timestamp)) || 0 };
    e.pinned = onScreen(e, view) && near(m ? Number(m[2]) : NaN, view);
    out.push(e);
  }
  return out;
}
