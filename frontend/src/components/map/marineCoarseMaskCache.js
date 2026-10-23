/**
 * marineCoarseMaskCache.js — the coarse base's world mask outlives the base set that rasterized it (2026-10-23).
 *
 * WHY. Every coarse-base capture (engine._captureCoarseBase) needs a dense MERCATOR land mask for its grid's bounds. Rasterizing
 * one draws the land GeoJSON onto a 4096 x 2048 canvas and uploads it (~32 MB): the lead's live trace of dev (2026-10-23, the
 * owner's 844 x 390 window) measured 63-140 ms per capture, synchronously on the main thread, behind the 213 ms first keydown,
 * a 98 ms React commit, a 159 ms frame and the zoom-out spikes. The engine already SHARES a mask between LRU base sets with
 * identical bounds (§2d), but a set for the same model|layer supersedes the old one and frees it, mask included. Two world grids
 * whose bounds differ (a static/series frame and a /grid or prewarm-seed frame of the same model) then alternate, and every
 * alternation rasterizes again; offline, where all world grids share one bounds box, the same capture costs 3-13 ms.
 *
 * WHAT. The engine keeps up to MAX_MASKS rasterized masks keyed by the grid bounds and the land GeoJSON they were drawn from,
 * each holding one reference (the `__rsRefs` count the engine's _freeCoarseBase already honours). A capture with no LRU set of
 * the same bounds reuses a cached mask instead of rasterizing; a fresh raster is remembered. Only masks drawn from GeoJSON are
 * kept: the grid-mask fallback is built from the grid's own data and stays per set. Nothing drawn changes: a reused mask is the
 * texture the same bounds and GeoJSON produced.
 * Kill: window.__RAW_DISABLE_COARSE_MASK_CACHE__ = true (no cache: a mask lives exactly as long as its sets, as before).
 */
export const MAX_MASKS = 2;

const _landIds = new WeakMap();
let _nextLandId = 1;
function landId(landGeoJSON) {
  if (!landGeoJSON || typeof landGeoJSON !== 'object') return 0;
  let id = _landIds.get(landGeoJSON);
  if (!id) { id = _nextLandId++; _landIds.set(landGeoJSON, id); }
  return id;
}

export function coarseMaskCacheEnabled() {
  return typeof window === 'undefined' || window.__RAW_DISABLE_COARSE_MASK_CACHE__ !== true;
}

/** The identity of a rasterized coarse mask: exact grid bounds + which land GeoJSON object drew it (50 m vs 10 m swaps differ). */
export function coarseMaskKey(bounds, landGeoJSON) {
  if (!bounds) return null;
  return `${bounds.west},${bounds.south},${bounds.east},${bounds.north}|${landId(landGeoJSON)}`;
}

/** Drop one hold on a shared mask texture; delete it when the last holder lets go (the engine's freeOne rule). */
export function releaseMaskRef(gl, tex, del) {
  if (!tex) return;
  if ((tex.__rsRefs || 1) > 1) tex.__rsRefs -= 1;
  else del(gl, tex);
}

function telemetry(engine) {
  if (typeof window === 'undefined' || !window.__RAW_GPU__) return null;
  const t = window.__RAW_GPU__.coarseMaskCache || (window.__RAW_GPU__.coarseMaskCache = { hits: 0, rasters: 0, evictions: 0, size: 0 });
  t.size = engine._coarseMaskCache ? engine._coarseMaskCache.size : 0;
  return t;
}

/** A cached mask for `key` ({ tex, dims }) or null; a hit becomes the most recent entry. */
export function findCachedCoarseMask(engine, key) {
  const m = engine && engine._coarseMaskCache;
  const e = key && m ? m.get(key) : null;
  if (!e) return null;
  m.delete(key);
  m.set(key, e);
  const t = telemetry(engine);
  if (t) t.hits += 1;
  return e;
}

/** Remember a freshly rasterized mask (the cache takes its own hold); past MAX_MASKS the oldest entry lets go of its hold. */
export function rememberCoarseMask(gl, engine, key, tex, dims, del) {
  if (!engine || !key || !tex || !dims) return;
  const m = engine._coarseMaskCache || (engine._coarseMaskCache = new Map());
  const old = m.get(key);
  if (old && old.tex === tex) return;
  if (old) { m.delete(key); releaseMaskRef(gl, old.tex, del); }
  tex.__rsRefs = (tex.__rsRefs || 1) + 1;
  m.set(key, { tex, dims });
  const t = telemetry(engine);
  if (t) t.rasters += 1;
  while (m.size > MAX_MASKS) {
    const [k, e] = m.entries().next().value;
    m.delete(k);
    releaseMaskRef(gl, e.tex, del);
    if (t) t.evictions += 1;
  }
  if (t) t.size = m.size;
}

/** Teardown: let go of every cached hold (call AFTER the base sets were freed, so the last holder deletes). */
export function releaseCoarseMaskCache(gl, engine, del) {
  const m = engine && engine._coarseMaskCache;
  if (!m) return;
  for (const e of m.values()) releaseMaskRef(gl, e.tex, del);
  m.clear();
  const t = telemetry(engine);
  if (t) t.size = 0;
}
