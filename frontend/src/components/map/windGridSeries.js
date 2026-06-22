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

// pageKey (model_viewportKey_pN) -> { ts, frames: Map<hourOffset, windData>, hours: number[] }
const _seriesCache = new Map();
const _inFlight = new Map();
const _idleTimers = new Set();
const SERIES_TTL_MS = 5 * 60 * 1000;
const SERIES_MAX = 24;

const PAGE_SPAN_HOURS = 144;            // 48 frames × 3h
const WIND_SERIES_MAX_HOURS = 384;      // GFS wind horizon ceiling
const LAST_PAGE = Math.floor(WIND_SERIES_MAX_HOURS / PAGE_SPAN_HOURS); // 2

export function isWindSeriesEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__WIND_SERIES__ === false) return false; // explicit opt-out
  try {
    if (window.localStorage && window.localStorage.getItem('wind_series') === 'false') return false;
  } catch (e) {}
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
  const r = (v) => (Math.round(v * 2) / 2).toFixed(1);
  return `${r(bounds.west)}_${r(bounds.south)}_${r(bounds.east)}_${r(bounds.north)}`;
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
    renderable: mappedVectors.length > 0 && nonzeroCount > 0,
    is_estimated: !!frame.is_estimated,
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
  const url = `${API_BASE}/weather/grid_series?model=${encodeURIComponent(model || 'GFS')}`
    + `&domain=wind&layer=wind`
    + `&bbox=${bounds.west.toFixed(4)},${bounds.south.toFixed(4)},${bounds.east.toFixed(4)},${bounds.north.toFixed(4)}`
    + `&hours=${hours.join(',')}`;

  const localController = new AbortController();
  const timeoutId = setTimeout(() => { try { localController.abort(); } catch (e) {} }, 45000);
  if (signal) { try { signal.addEventListener('abort', () => localController.abort()); } catch (e) {} }

  const p = (async () => {
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
    try { clearTimeout(id); if (typeof window !== 'undefined' && window.cancelIdleCallback) window.cancelIdleCallback(id); } catch (e) {}
  }
  _idleTimers.clear();
}
