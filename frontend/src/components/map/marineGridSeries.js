// marineGridSeries.js
// Option 1 "sync upgrade" — marine time-series client.
//
// Fetches a MULTI-HOUR marine grid in ONE request (/api/weather/grid_series) so the
// timeline scrubber can select an hour CLIENT-SIDE (instant) instead of one backend
// fetch per hour. The backend endpoint is additive and reuses the same per-hour grid
// builder /grid uses; the first hour fetches the multi-hour upstream (already returned
// by Open-Meteo/Copernicus), the rest re-slice it.
//
// SAFETY: this whole path is OFF unless window.__MARINE_SERIES__ === true. When off,
// nothing here runs and the orchestrator behaves exactly as before. When on, a series
// frame is used ONLY as an extra cache source during scrub — it commits through the
// SAME orchestrator path as a normal cached grid (parity/transition gates still apply),
// and anything missing falls back to the existing per-hour fetch.

import { API_BASE } from '../../lib/apiClient';

// model_layer_viewportKey -> { ts, frames: Map<hourOffset, marineData>, hours: number[] }
const _seriesCache = new Map();
const _inFlight = new Map();
const SERIES_TTL_MS = 5 * 60 * 1000; // mirror backend upstream cache TTL
const SERIES_MAX = 24;

export function isMarineSeriesEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__MARINE_SERIES__ === true) return true;
  // Persistent opt-in so it survives reloads (set once, test reliably):
  //   localStorage.setItem('marine_series', 'true')
  try {
    return window.localStorage && window.localStorage.getItem('marine_series') === 'true';
  } catch (e) {
    return false;
  }
}

// Coarse viewport key so small pans reuse the same series.
function viewportKey(bounds) {
  if (!bounds) return 'global';
  const r = (v) => (Math.round(v * 2) / 2).toFixed(1); // 0.5° snap
  return `${r(bounds.west)}_${r(bounds.south)}_${r(bounds.east)}_${r(bounds.north)}`;
}

function seriesKey(model, layer, bounds) {
  return `${model || 'GFS'}_${layer || 'waves'}_${viewportKey(bounds)}`;
}

// The hour offsets we request. 3-hourly across the near-to-mid range (≤48 frames server
// cap). Far hours beyond this fall back to the existing per-hour fetch/hold.
function buildHours() {
  const hours = [];
  for (let h = 0; h <= 141; h += 3) hours.push(h);
  return hours;
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

/**
 * Background-load the marine time-series for a model/layer/viewport. Idempotent + TTL'd +
 * deduped. No-op when the flag is off. Never throws.
 */
export async function ensureMarineSeries(model, layer, bounds, signal) {
  if (!isMarineSeriesEnabled() || !bounds) return;
  const key = seriesKey(model, layer, bounds);
  const existing = _seriesCache.get(key);
  if (existing && Date.now() - existing.ts < SERIES_TTL_MS) return;
  if (_inFlight.has(key)) return;

  const hours = buildHours();
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
 * Return a ready-to-commit marineData for the requested hour from the cached series, or
 * null if no series / no nearby frame. Snaps to the nearest frame within ±1.5h (frames
 * are 3-hourly), so scrubbing tracks the nearest available hour.
 */
export function getMarineSeriesFrame(model, layer, bounds, hourOffset) {
  if (!isMarineSeriesEnabled() || !bounds) return null;
  const entry = _seriesCache.get(seriesKey(model, layer, bounds));
  if (!entry || Date.now() - entry.ts >= SERIES_TTL_MS) return null;

  let best = null;
  let bestDiff = Infinity;
  for (const h of entry.hours) {
    const d = Math.abs(h - hourOffset);
    if (d < bestDiff) { bestDiff = d; best = h; }
  }
  if (best === null || bestDiff > 1.5) {
    if (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) window.__MARINE_SERIES_DIAG__.misses++;
    return null;
  }
  if (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) window.__MARINE_SERIES_DIAG__.hits++;
  return entry.frames.get(best) || null;
}

export function _resetMarineSeriesForTest() {
  _seriesCache.clear();
  _inFlight.clear();
}
