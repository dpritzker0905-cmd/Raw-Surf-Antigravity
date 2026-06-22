// marineGridSeries.js
// Option 1 "sync upgrade" — marine time-series client (PAGED).
//
// Fetches a MULTI-HOUR marine grid in ONE request (/api/weather/grid_series) so the
// timeline scrubber can select an hour CLIENT-SIDE (instant) instead of one backend
// fetch per hour. The backend endpoint is additive and reuses the same per-hour grid
// builder /grid uses; the first hour fetches the multi-hour upstream (already returned
// by Open-Meteo/Copernicus), the rest re-slice it.
//
// PAGING (audit Finding 2): the full 0..336h window is 113 3-hourly frames, but the
// backend caps a series at 48 frames. So we split into 3-hourly PAGES of <=48 frames
// (0..141, 144..285, 288..336) and load the page containing the CURRENT hour FIRST, then
// adjacent pages during idle — instead of always starting at hour zero. Cache/in-flight
// are keyed by model+layer+viewport+page so far-hour scrubbing is instant once its page
// is loaded.
//
// SAFETY: this whole path is OFF unless window.__MARINE_SERIES__ === true. When off,
// nothing here runs and the orchestrator behaves exactly as before. When on, a series
// frame is used ONLY as an extra cache source during scrub — it commits through the
// SAME orchestrator path as a normal cached grid (parity/transition gates still apply),
// and anything missing falls back to the existing per-hour fetch.

import { API_BASE } from '../../lib/apiClient';

// pageKey (model_layer_viewportKey_pN) -> { ts, frames: Map<hourOffset, marineData>, hours: number[] }
const _seriesCache = new Map();
const _inFlight = new Map();
const _idleTimers = new Set(); // pending adjacent-page prefetch timers (cleared on reset)
const SERIES_TTL_MS = 5 * 60 * 1000; // mirror backend upstream cache TTL
const SERIES_MAX = 32;              // bounded; ~10 distinct (model,layer,viewport) targets × pages

// 3-hourly pages of at most 48 frames (the backend series cap). 48 frames × 3h = 144h span.
const PAGE_SPAN_HOURS = 144;
const MARINE_SERIES_MAX_HOURS = 336; // EURO 14-day window ceiling (240 native + 96 estimated)
const LAST_PAGE = Math.floor(MARINE_SERIES_MAX_HOURS / PAGE_SPAN_HOURS); // 2

export function isMarineSeriesEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__MARINE_SERIES__ === false) return false;
  try {
    if (window.localStorage && window.localStorage.getItem('marine_series') === 'false') {
      return false;
    }
  } catch (e) {}
  return true;
}

// The 3-hourly page that contains a given hour offset. Page 0: 0..141, 1: 144..285, 2: 288..336.
export function marineSeriesPageForHour(hourOffset) {
  const h = Math.max(0, Number(hourOffset) || 0);
  return Math.min(LAST_PAGE, Math.floor(h / PAGE_SPAN_HOURS));
}

// The hour offsets a page requests (<=48 frames, 3-hourly, clamped to the 336h ceiling).
function buildPageHours(page) {
  const start = page * PAGE_SPAN_HOURS;
  const end = Math.min(start + PAGE_SPAN_HOURS - 3, MARINE_SERIES_MAX_HOURS);
  const hours = [];
  for (let h = start; h <= end; h += 3) hours.push(h);
  return hours;
}

// Coarse viewport key so small pans reuse the same series.
function viewportKey(bounds) {
  if (!bounds) return 'global';
  const r = (v) => (Math.round(v * 2) / 2).toFixed(1); // 0.5° snap
  return `${r(bounds.west)}_${r(bounds.south)}_${r(bounds.east)}_${r(bounds.north)}`;
}

function pageKey(model, layer, bounds, page) {
  return `${model || 'GFS'}_${layer || 'waves'}_${viewportKey(bounds)}_p${page}`;
}

// Defer adjacent-page prefetch to idle so it never competes with the current page or a
// scrub. requestIdleCallback when available; otherwise a macrotask (NOT a microtask, so it
// can't fire inside a caller's await — keeps the synchronous "one fetch" test invariant).
function scheduleIdlePrefetch(fn) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => { _idleTimers.delete(id); fn(); }, { timeout: 2500 });
    _idleTimers.add(id);
    return;
  }
  const id = setTimeout(() => { _idleTimers.delete(id); fn(); }, 1500);
  _idleTimers.add(id);
}

// Convert one backend series frame into a marineData object shaped exactly like a normal
// cached grid commit, so the orchestrator's existing commit/parity logic accepts it.
function frameToMarineData(frame, model, layer) {
  const provider = frame.provider || (model === 'EURO' ? 'copernicus' : 'open-meteo');
  const renderable = Array.isArray(frame.vectors) && frame.vectors.length > 0;
  const grid = {
    vectors: frame.vectors,
    cols: frame.cols,
    rows: frame.rows,
    bounds: frame.bounds,
    __renderable: renderable,
    __componentLayer: layer,
    __sourceModel: model,
    __gridProvider: provider,
    provider,
    hourOffset: frame.hour_offset,
    is_estimated: !!frame.is_estimated,
    is_dynamic_viewport_product: true,
    __fromSeries: true,
  };
  return {
    type: 'FeatureCollection',
    features: [],
    grid,
    __sourceModel: model,
    __provider: provider,
    __renderable: renderable,
    __fromSeries: true,
    hourOffset: frame.hour_offset,
    product_id: `series_${model}_${layer}_h${frame.hour_offset}`,
    region_id: 'series',
    is_dynamic_viewport_product: true,
  };
}

// Load ONE page of the series. Idempotent + TTL'd + deduped (keyed by page). Never throws.
async function loadSeriesPage(model, layer, bounds, page, signal) {
  if (!isMarineSeriesEnabled() || !bounds || page < 0 || page > LAST_PAGE) return;
  const key = pageKey(model, layer, bounds, page);
  const existing = _seriesCache.get(key);
  if (existing && Date.now() - existing.ts < SERIES_TTL_MS) return;
  if (_inFlight.has(key)) return;

  const hours = buildPageHours(page);
  if (hours.length === 0) return;
  const url = `${API_BASE}/weather/grid_series?model=${encodeURIComponent(model || 'GFS')}`
    + `&domain=marine&layer=${encodeURIComponent(layer || 'waves')}`
    + `&bbox=${bounds.west.toFixed(4)},${bounds.south.toFixed(4)},${bounds.east.toFixed(4)},${bounds.north.toFixed(4)}`
    + `&hours=${hours.join(',')}`;

  // Local timeout so a slow model (EURO/Copernicus) can't leave the series fetch hanging.
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
        frames.set(f.hour_offset, frameToMarineData(f, model, layer));
        hoursList.push(f.hour_offset);
      }
      if (frames.size === 0) return;
      hoursList.sort((a, b) => a - b);
      _seriesCache.set(key, { ts: Date.now(), frames, hours: hoursList });
      // Bound memory.
      if (_seriesCache.size > SERIES_MAX) {
        const oldest = _seriesCache.keys().next().value;
        if (oldest !== undefined) _seriesCache.delete(oldest);
      }
      if (typeof window !== 'undefined') {
        window.__MARINE_SERIES_DIAG__ = window.__MARINE_SERIES_DIAG__ || { loads: 0, hits: 0, misses: 0 };
        window.__MARINE_SERIES_DIAG__.loads++;
        window.__MARINE_SERIES_DIAG__.lastKey = key;
        window.__MARINE_SERIES_DIAG__.lastPage = page;
        window.__MARINE_SERIES_DIAG__.lastFrames = hoursList.length;
      }
    } catch (e) {
      // network/abort/timeout — silent, falls back to per-hour path
    } finally {
      clearTimeout(timeoutId);
      _inFlight.delete(key);
    }
  })();
  _inFlight.set(key, p);
  // Awaiting here makes the load observable to callers that DO await (and tests); the
  // orchestrator calls this fire-and-forget (no await), so it stays a background load.
  await p;
}

/**
 * Background-load the marine time-series PAGE containing `hourOffset` (current hour) first,
 * then prefetch adjacent page(s) during idle. Idempotent + TTL'd + deduped. No-op when the
 * flag is off. Never throws. hourOffset defaults to 0 (near page) for legacy callers.
 */
export async function ensureMarineSeries(model, layer, bounds, hourOffset = 0, signal) {
  if (!isMarineSeriesEnabled() || !bounds) return;
  const page = marineSeriesPageForHour(hourOffset);
  await loadSeriesPage(model, layer, bounds, page, signal);
  // Prefetch neighbours during idle so scrubbing into an adjacent page is already warm.
  for (const adj of [page + 1, page - 1]) {
    if (adj < 0 || adj > LAST_PAGE) continue;
    const k = pageKey(model, layer, bounds, adj);
    const cached = _seriesCache.get(k);
    if ((cached && Date.now() - cached.ts < SERIES_TTL_MS) || _inFlight.has(k)) continue;
    scheduleIdlePrefetch(() => { loadSeriesPage(model, layer, bounds, adj, signal); });
  }
}

/**
 * Eagerly load EVERY page for the active model/layer/viewport (no idle deferral). Called on
 * scrub START so any hour the user jumps to during a fast drag already has a cached frame —
 * idle prefetch (requestIdleCallback) never runs during active scrubbing, which is why far
 * hours otherwise held the previous frame until settle. Fire-and-forget; deduped + TTL'd.
 */
export function prewarmMarineSeries(model, layer, bounds, signal) {
  if (!isMarineSeriesEnabled() || !bounds) return;
  for (let page = 0; page <= LAST_PAGE; page++) {
    loadSeriesPage(model, layer, bounds, page, signal);
  }
}

/**
 * Return a ready-to-commit marineData for the requested hour from the cached series, or
 * null if no series / no nearby frame. Searches the page containing the hour plus its
 * neighbours (to cover frames near a page boundary) and snaps to the nearest frame within
 * ±1.5h (frames are 3-hourly), so scrubbing tracks the nearest available hour synchronously.
 */
export function getMarineSeriesFrame(model, layer, bounds, hourOffset) {
  if (!isMarineSeriesEnabled() || !bounds) return null;
  const page = marineSeriesPageForHour(hourOffset);
  const now = Date.now();
  let best = null;
  let bestDiff = Infinity;
  for (const cand of [page, page + 1, page - 1]) {
    if (cand < 0 || cand > LAST_PAGE) continue;
    const entry = _seriesCache.get(pageKey(model, layer, bounds, cand));
    if (!entry || now - entry.ts >= SERIES_TTL_MS) continue;
    for (const h of entry.hours) {
      const d = Math.abs(h - hourOffset);
      if (d < bestDiff) { bestDiff = d; best = entry.frames.get(h) || null; }
    }
  }
  if (best === null || bestDiff > 1.5) {
    if (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) window.__MARINE_SERIES_DIAG__.misses++;
    return null;
  }
  if (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) window.__MARINE_SERIES_DIAG__.hits++;
  return best;
}

export function _resetMarineSeriesForTest() {
  _seriesCache.clear();
  _inFlight.clear();
  for (const id of _idleTimers) {
    try { clearTimeout(id); if (typeof window !== 'undefined' && window.cancelIdleCallback) window.cancelIdleCallback(id); } catch (e) {}
  }
  _idleTimers.clear();
}
