// windGridSeries.js
// Wind time-series client (PAGED) — the wind analogue of marineGridSeries.js (F3).
//
// Wind previously had no multi-hour series cache: a scrub to a cold/far hour did a debounced
// per-hour network fetch (visible pause). This fetches a MULTI-HOUR wind grid in ONE request
// (/api/weather/grid_series?domain=wind) so the timeline scrubber can select an hour
// CLIENT-SIDE (instant). The backend per-hour loop re-slices the global coarse wind product,
// which is cheap.
//
// PAGING: 3-hourly PAGES of <=48 frames (the backend series cap): 0..141, 144..285, 288..384.
// Load the page containing the CURRENT hour first, then adjacent pages during idle. Cache +
// in-flight are keyed by model+viewport+page.
//
// SAFETY: OFF unless window.__WIND_SERIES__ === true (opt-in; default off so the existing wind
// path is unchanged until verified live). When on, a series frame is used ONLY as an extra
// cache source during scrub — it commits through the SAME WeatherEngine commit path as a normal
// cached wind grid, and anything missing falls back to the existing per-hour fetch.

import { API_BASE } from '../../lib/apiClient';
import { buildTruthTag } from './weatherTruthTracker';
// ONE expression, not a second copy (audit v7 §2a): wind carried the IDENTICAL split as marine —
// viewportKey normalises longitude at :97, the URL below sent the raw bounds. A duplicated rule
// only diverges on a boundary, and this one's boundary is the antimeridian.
import { normalizeRequestBbox } from './marineBboxGeometry';

// pageKey (model_viewportKey_pN) -> { ts, frames: Map<hourOffset, windData>, hours: number[] }
const _seriesCache = new Map();
const _inFlight = new Map();
const _idleTimers = new Set();
const SERIES_TTL_MS = 5 * 60 * 1000;
const SERIES_MAX = 24;

// Concurrency gate for wind grid_series fetches — mirrors marineGridSeries.js. The 1-CPU backend
// can't take N concurrent series fetches; cap so it serves ~2 at a time (requests queue
// client-side; aborted-while-queued ones are dropped before they hit the box).
const WIND_SERIES_MAX_CONCURRENT = 2;
let _windActiveLoads = 0;
const _windWaiters = []; // [{ resolve, signal }]

function acquireWindSeriesSlot(signal) {
  if (_windActiveLoads < WIND_SERIES_MAX_CONCURRENT) { _windActiveLoads++; return Promise.resolve(true); }
  return new Promise((resolve) => {
    const entry = { resolve, signal };
    _windWaiters.push(entry);
    if (signal) {
      try {
        signal.addEventListener('abort', () => {
          const i = _windWaiters.indexOf(entry);
          if (i >= 0) { _windWaiters.splice(i, 1); resolve(false); }
        }, { once: true });
      } catch (e) { /* ignore */ }
    }
  });
}

function releaseWindSeriesSlot() {
  if (_windActiveLoads > 0) _windActiveLoads--;
  while (_windWaiters.length && _windActiveLoads < WIND_SERIES_MAX_CONCURRENT) {
    const w = _windWaiters.shift();
    if (w.signal && w.signal.aborted) { w.resolve(false); continue; }
    _windActiveLoads++;
    w.resolve(true);
  }
}

const PAGE_SPAN_HOURS = 144;            // 48 frames × 3h
const WIND_SERIES_MAX_HOURS = 384;      // GFS wind horizon ceiling
const LAST_PAGE = Math.floor(WIND_SERIES_MAX_HOURS / PAGE_SPAN_HOURS); // 2

export function isWindSeriesEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__WIND_SERIES__ === false) return false; // explicit opt-out
  try {
    if (window.localStorage && window.localStorage.getItem('wind_series') === 'false') return false;
  } catch (e) { /* localStorage blocked */ }
  return true; // default ON
}

export function windSeriesPageForHour(hourOffset) {
  const h = Math.max(0, Number(hourOffset) || 0);
  return Math.min(LAST_PAGE, Math.floor(h / PAGE_SPAN_HOURS));
}

function buildPageHours(page) {
  const start = page * PAGE_SPAN_HOURS;
  const end = Math.min(start + PAGE_SPAN_HOURS - 3, WIND_SERIES_MAX_HOURS);
  const hours = [];
  for (let h = start; h <= end; h += 3) hours.push(h);
  return hours;
}

function viewportKey(bounds) {
  if (!bounds) return 'global';
  // Mirror marineGridSeries: normalize longitude to [-180,180] so an antimeridian-wrapped viewport
  // (west < -180) doesn't yield keys that never match the warmed series, and collapse any WIDE
  // viewport (span > 15° either axis — served by ONE global-coarse wind product) to a single stable
  // 'global' key. Without this, the 0.5° snap on a ~200°-span global viewport churns the key on every
  // micro-pan, so the warmed global wind series is never reused → scrubbing freezes the wind heatmap
  // on the pre-scrub hour (the "wind doesn't track the scrubber at global zoom" bug). With it, the
  // global wind series warms once and every scrubbed hour HITS it (instant, zero-backend).
  const normLng = (lng) => (((lng + 180) % 360) + 360) % 360 - 180;
  const w = normLng(bounds.west);
  const e = normLng(bounds.east);
  const spanLng = (e < w) ? (e + 360) - w : e - w;
  const spanLat = Math.abs(bounds.north - bounds.south);
  if (spanLng > 15.0 || spanLat > 15.0) return 'global';
  const r = (v) => (Math.round(v * 2) / 2).toFixed(1);
  return `${r(w)}_${r(bounds.south)}_${r(e)}_${r(bounds.north)}`;
}

function pageKey(model, bounds, page) {
  return `${model || 'GFS'}_${viewportKey(bounds)}_p${page}`;
}

function scheduleIdlePrefetch(fn) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => { _idleTimers.delete(id); fn(); }, { timeout: 2500 });
    _idleTimers.add(id);
    return;
  }
  const id = setTimeout(() => { _idleTimers.delete(id); fn(); }, 1500);
  _idleTimers.add(id);
}

// One backend series frame -> windData shaped exactly like fetchBackendWindGrid's result
// (mapNormalizedWindGridToWebGL), so WeatherEngine's commit path accepts it unchanged.
function frameToWindData(frame, model) {
  const mappedVectors = (frame.vectors || []).map(v => ({
    lat: v.lat, lng: v.lng,
    speed: v.speed || 0, direction: v.direction || 0,
    u: v.u || 0, v: v.v || 0,
  }));
  const nonzeroCount = mappedVectors.filter(v => v.speed > 0).length;
  const renderable = mappedVectors.length > 0 && nonzeroCount > 0;
  const product_id = `series_${model || 'GFS'}_wind_h${frame.hour_offset}`;
  // #18/A3 wind mirror (marineGridSeries pattern): mint the lineage tag ONCE at frame
  // construction — recordTruthStage PRESERVES an existing tag, so commit + webglUpload share
  // product_id + traceId instead of reconstructing divergent tags ("Product: undefined" +
  // different traceIds per stage — user log 07-10).
  const truthTag = renderable ? buildTruthTag({
    grid: { vectors: mappedVectors, cols: frame.cols, rows: frame.rows, bounds: frame.bounds },
    model: model || 'GFS', domain: 'wind', layer: 'wind',
    valid_time: frame.valid_time, run_time: frame.run_time,
    product_id, provider: frame.provider || 'backend-weather-service',
    is_dynamic_viewport_product: true,
  }, 'seriesFrameMint') : null;
  if (truthTag && Number.isFinite(frame.hour_offset)) truthTag.timeOffsetHours = frame.hour_offset;
  return {
    vectors: mappedVectors,
    bounds: frame.bounds,
    cols: frame.cols,
    rows: frame.rows,
    stale: false,
    source: model || 'GFS',
    hourOffset: frame.hour_offset,
    provider: frame.provider || 'backend-weather-service',
    nonzeroCount,
    renderable,
    is_estimated: !!frame.is_estimated,
    ...(truthTag ? { truthTag, product_id, productId: product_id } : {}),
    __fromSeries: true,
  };
}

async function loadSeriesPage(model, bounds, page, signal) {
  if (!isWindSeriesEnabled() || !bounds || page < 0 || page > LAST_PAGE) return;
  const key = pageKey(model, bounds, page);
  const existing = _seriesCache.get(key);
  if (existing && Date.now() - existing.ts < SERIES_TTL_MS) return;
  if (_inFlight.has(key)) return;

  const hours = buildPageHours(page);
  if (hours.length === 0) return;
  const reqBox = normalizeRequestBbox(bounds);
  const url = `${API_BASE}/weather/grid_series?model=${encodeURIComponent(model || 'GFS')}`
    + `&domain=wind&layer=wind`
    + `&bbox=${reqBox.west.toFixed(4)},${reqBox.south.toFixed(4)},${reqBox.east.toFixed(4)},${reqBox.north.toFixed(4)}`
    + `&hours=${hours.join(',')}`;

  const localController = new AbortController();
  const timeoutId = setTimeout(() => { try { localController.abort(); } catch (e) { /* ignore */ } }, 45000);
  if (signal) { try { signal.addEventListener('abort', () => localController.abort()); } catch (e) { /* ignore */ } }

  const p = (async () => {
    const gotSlot = await acquireWindSeriesSlot(localController.signal);
    if (!gotSlot || localController.signal.aborted) {
      clearTimeout(timeoutId);
      _inFlight.delete(key);
      return;
    }
    try {
      const res = await fetch(url, { signal: localController.signal });
      if (!res.ok) return;
      const json = await res.json();
      if (!json || !Array.isArray(json.frames) || json.frames.length === 0) return;
      const frames = new Map();
      const hoursList = [];
      for (const f of json.frames) {
        if (typeof f.hour_offset !== 'number' || !f.vectors || f.vectors.length === 0) continue;
        frames.set(f.hour_offset, frameToWindData(f, model));
        hoursList.push(f.hour_offset);
      }
      if (frames.size === 0) return;
      hoursList.sort((a, b) => a - b);
      _seriesCache.set(key, { ts: Date.now(), frames, hours: hoursList });
      if (_seriesCache.size > SERIES_MAX) {
        const oldest = _seriesCache.keys().next().value;
        if (oldest !== undefined) _seriesCache.delete(oldest);
      }
      if (typeof window !== 'undefined') {
        window.__WIND_SERIES_DIAG__ = window.__WIND_SERIES_DIAG__ || { loads: 0, hits: 0, misses: 0 };
        window.__WIND_SERIES_DIAG__.loads++;
        window.__WIND_SERIES_DIAG__.lastKey = key;
        window.__WIND_SERIES_DIAG__.lastPage = page;
        window.__WIND_SERIES_DIAG__.lastFrames = hoursList.length;
      }
    } catch (e) {
      // network/abort/timeout — silent, falls back to per-hour path
    } finally {
      releaseWindSeriesSlot();
      clearTimeout(timeoutId);
      _inFlight.delete(key);
    }
  })();
  _inFlight.set(key, p);
  await p;
}

/**
 * Background-load the wind series PAGE containing `hourOffset` first, then prefetch adjacent
 * page(s) during idle. Idempotent + TTL'd + deduped. No-op when the flag is off. Never throws.
 */
export async function ensureWindSeries(model, bounds, hourOffset = 0, signal) {
  if (!isWindSeriesEnabled() || !bounds) return;
  const page = windSeriesPageForHour(hourOffset);
  await loadSeriesPage(model, bounds, page, signal);
  for (const adj of [page + 1, page - 1]) {
    if (adj < 0 || adj > LAST_PAGE) continue;
    const k = pageKey(model, bounds, adj);
    const cached = _seriesCache.get(k);
    if ((cached && Date.now() - cached.ts < SERIES_TTL_MS) || _inFlight.has(k)) continue;
    scheduleIdlePrefetch(() => { loadSeriesPage(model, bounds, adj, signal); });
  }
}

/**
 * Eagerly load EVERY page for the active model/viewport (no idle deferral). Called on scrub
 * START so any hour the user jumps to during a fast drag already has a cached frame (idle
 * prefetch never runs during active scrubbing). Fire-and-forget; deduped + TTL'd.
 */
export function prewarmWindSeries(model, bounds, signal) {
  if (!isWindSeriesEnabled() || !bounds) return;
  for (let page = 0; page <= LAST_PAGE; page++) {
    loadSeriesPage(model, bounds, page, signal);
  }
}

/**
 * Nearest cached wind frame (±1.5h) for the requested hour, or null. Searches the hour's page
 * plus neighbours so boundary frames are found. Synchronous — never blocks the slider tick.
 */
export function getWindSeriesFrame(model, bounds, hourOffset) {
  if (!isWindSeriesEnabled() || !bounds) return null;
  const page = windSeriesPageForHour(hourOffset);
  const now = Date.now();
  let best = null;
  let bestDiff = Infinity;
  for (const cand of [page, page + 1, page - 1]) {
    if (cand < 0 || cand > LAST_PAGE) continue;
    const entry = _seriesCache.get(pageKey(model, bounds, cand));
    if (!entry || now - entry.ts >= SERIES_TTL_MS) continue;
    for (const h of entry.hours) {
      const d = Math.abs(h - hourOffset);
      if (d < bestDiff) { bestDiff = d; best = entry.frames.get(h) || null; }
    }
  }
  if (best === null || bestDiff > 1.5) {
    if (typeof window !== 'undefined' && window.__WIND_SERIES_DIAG__) window.__WIND_SERIES_DIAG__.misses++;
    return null;
  }
  if (typeof window !== 'undefined' && window.__WIND_SERIES_DIAG__) window.__WIND_SERIES_DIAG__.hits++;
  return best;
}

export function _resetWindSeriesForTest() {
  _seriesCache.clear();
  _inFlight.clear();
  for (const id of _idleTimers) {
    try { clearTimeout(id); if (typeof window !== 'undefined' && window.cancelIdleCallback) window.cancelIdleCallback(id); } catch (e) { /* ignore */ }
  }
  _idleTimers.clear();
  _windActiveLoads = 0;
  _windWaiters.length = 0;
}
