// marineController.js — Fetch layer for marine weather data.
// Pressure data: marineControllerPressure.js. Shared utilities: marineControllerUtils.js.

import {
  safeNum, getUV, PROXY_URL, isLocalhost, findClosestHourIndex,
  HOURLY_CACHE_TTL, persistCache, hydrateCache,
  isInCooldown, enterCooldown, clearCooldown, logMarineRequest,
  getSnapConfig, isViewportInsideCachedBounds, viewportCacheKey, computeGridPoints
} from './marineControllerUtils';
import { governMarineRequest } from './marineRequestGovernor';
import { BACKEND_URL } from '../../lib/apiClient';

// Re-export wind controller components for timeline scrubs and observers
export { fetchWindData, getWindHourlyCache, extractWindAtOffset, isContainedInWindCache } from './windController';

// Re-export shared utilities for consumers that import from marineController
export { getRemainingCooldown } from './marineControllerUtils';

// Re-export pressure domain for backwards compatibility
export { fetchPressureData, extractPressureAtOffset, getPressureHourlyCache, isContainedInPressureCache } from './marineControllerPressure';

// --- CACHES ---
var MARINE_CACHE = new Map();

// Hourly cache stores full API responses keyed by viewport+model+layer hash.
var marineHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0 };

// --- PERSISTENT CACHE (localStorage) ---
var LS_MARINE_KEY = 'rawsurf_marine_cache_v10'; // v7.14.2: Bumped to avoid stale 3-var GFS cache poisoning

// Hydrate from localStorage on module init
var _hydratedMarine = hydrateCache(LS_MARINE_KEY);
if (_hydratedMarine) {
  var _hydMarineProvider = _hydratedMarine.provider || 'open-meteo';
  var _hydMarineModel = _hydratedMarine.model || 'GFS';
  var _expectedProvider = 'open-meteo';
  if (_hydMarineProvider !== _expectedProvider) {
    console.log(`[Marine] Rejected hydrated cache: provider=${_hydMarineProvider}, expected=${_expectedProvider} for model=${_hydMarineModel}`);
    _hydratedMarine = null;
    try { localStorage.removeItem(LS_MARINE_KEY); } catch(e) {}
  } else {
    marineHourlyCache = _hydratedMarine;
    console.log(`[Marine] Hydrated from localStorage: ${_hydratedMarine.points?.length} pts, age ${Math.round((Date.now() - _hydratedMarine.timestamp)/1000)}s, provider=${_hydMarineProvider}`);
  }
}

// --- LAST KNOWN GOOD FIELDS ---
var lastKnownGoodMarine = _hydratedMarine ? extractMarineAtOffset(_hydratedMarine, 0) : null;
var lastKnownGoodMarineModel = _hydratedMarine?.model || 'GFS';
if (lastKnownGoodMarine) lastKnownGoodMarine.__sourceModel = lastKnownGoodMarineModel;

function estimateRequestCost(type, model, pointCount, hourlyVarCount, forecastDays) {
  if (type === 'tiles') return 50000;
  const timeBytes = forecastDays * 24 * 25;
  const varBytes = hourlyVarCount * forecastDays * 24 * 8;
  const metadataBytes = 1500;
  return pointCount * (timeBytes + varBytes + metadataBytes);
}

function _isAllVarModel(model) { return (model || 'GFS') !== 'EURO'; }

var _perModelHourCache = new Map();
var PER_MODEL_HOUR_CACHE_MAX = 50;
var PER_MODEL_HOUR_CACHE_TTL = 10 * 60 * 1000;
function _cacheMarineResult(model, hourOffset, data, layer) {
  if (!data) return;
  const layerPart = _isAllVarModel(model) ? 'all' : (layer || 'waves');
  const key = `${model || 'GFS'}_${layerPart}_${hourOffset}`;
  _perModelHourCache.set(key, { data, timestamp: Date.now(), model: model || 'GFS' });
  if (_perModelHourCache.size > PER_MODEL_HOUR_CACHE_MAX) {
    const oldest = [..._perModelHourCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 10; i++) _perModelHourCache.delete(oldest[i][0]);
  }
}

/** getModelSafeMarine - returns safe model cached results */
export function getModelSafeMarine(requestedModel, requestedHourOffset, requestedLayer) {
  const wanted = requestedModel || 'GFS', wantedLayer = requestedLayer || 'waves', wantedHour = requestedHourOffset !== undefined ? requestedHourOffset : 0;
  let hitData = null, cacheSource = 'none', staleHour = false, returnedHour = null;
  const cacheLayerKey = marineHourlyCache?.__layerKey || 'all';
  const isCacheMatch = cacheLayerKey === 'all' || cacheLayerKey === wantedLayer;
  
  if (_isAllVarModel(wanted) && marineHourlyCache?.results?.length && marineHourlyCache.model === wanted && isCacheMatch) {
    try {
      const reExtracted = extractMarineAtOffset(marineHourlyCache, wantedHour, wantedLayer);
      if (reExtracted?.grid?.vectors?.length > 0) { hitData = reExtracted; cacheSource = 'raw_hourly_cache'; }
    } catch (e) {}
  }
  if (!hitData) {
    const layerPart = _isAllVarModel(wanted) ? 'all' : wantedLayer;
    const exact = _perModelHourCache.get(`${wanted}_${layerPart}_${wantedHour}`);
    if (exact && Date.now() - exact.timestamp < PER_MODEL_HOUR_CACHE_TTL) { hitData = exact.data; cacheSource = 'per_model_hour_cache_exact'; }
  }
  if (!hitData && !_isAllVarModel(wanted)) {
    const prefix = `${wanted}_${wantedLayer}_`;
    let bestEntry = null, bestDiff = Infinity;
    for (const [key, entry] of _perModelHourCache.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (Date.now() - entry.timestamp >= PER_MODEL_HOUR_CACHE_TTL) continue;
      const cachedHour = parseInt(key.substring(prefix.length), 10);
      const diff = Math.abs(cachedHour - wantedHour);
      if (diff < bestDiff && diff <= 6) { bestDiff = diff; bestEntry = entry; }
    }
    if (bestEntry) {
      hitData = { ...bestEntry.data, __staleHour: true, __originalHour: bestEntry.data.hourOffset };
      staleHour = true; cacheSource = 'per_model_hour_cache_nearest';
    }
  }
  if (!hitData && lastKnownGoodMarine && (lastKnownGoodMarineModel || 'GFS') === wanted && (lastKnownGoodMarine?.grid?.__componentLayer || 'waves') === wantedLayer) {
    const cachedProvider = lastKnownGoodMarine.__provider || lastKnownGoodMarine?.grid?.provider || 'open-meteo';
    if (cachedProvider === 'open-meteo' || cachedProvider === 'estimated' || cachedProvider === 'backend-weather-service') {
      const diff = Math.abs((lastKnownGoodMarine.hourOffset || 0) - wantedHour);
      if (diff <= 6) {
        hitData = { ...lastKnownGoodMarine };
        if (diff > 0) { hitData.__staleHour = true; hitData.__originalHour = lastKnownGoodMarine.hourOffset; staleHour = true; }
        cacheSource = 'last_known_good';
      }
    }
  }
  if (hitData) {
    const gotModel = hitData.__sourceModel || hitData.grid?.__sourceModel || 'GFS';
    const gotLayer = hitData.grid?.__componentLayer || 'waves';
    returnedHour = hitData.hourOffset !== undefined ? hitData.hourOffset : wantedHour;
    if (gotModel !== wanted || gotLayer !== wantedLayer) {
      console.warn(`[Safe Cache] Mismatch! Wanted ${wanted}/${wantedLayer}, got ${gotModel}/${gotLayer}`);
      hitData = null;
    } else if (Math.abs(returnedHour - wantedHour) > 6) {
      console.warn(`[Safe Cache] Hour delta ${Math.abs(returnedHour - wantedHour)}h > 6h, rejected.`);
      hitData = null;
    }
  }
  const provider = hitData?.grid?.__provider || hitData?.grid?.provider || 'none';
  const hasHit = !!hitData;
  returnedHour = hasHit ? (hitData.hourOffset !== undefined ? hitData.hourOffset : wantedHour) : null;
  if (typeof window !== 'undefined') {
    window.__MARINE_SAFE_CACHE_DIAG__ = { requestedModel: wanted, requestedLayer: wantedLayer, requestedHour: wantedHour, returnedHour, provider, staleHour: staleHour && hasHit, cacheHit: hasHit, cacheSource, timestamp: new Date().toISOString() };
  }
  return hitData;
}

function createFallbackSafeZeroGrid(model, failureReason) {
  const m = model || 'GFS', g = { vectors: [], bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 27, rows: 27,
    __provider: 'fallback_safe_zero', __gridProvider: 'none', __renderable: false, __failureReason: failureReason };
  return { type: 'FeatureCollection', features: [], grid: g, __sourceModel: m, __provider: 'fallback_safe_zero',
    __gridProvider: 'none', __renderable: false, __failureReason: failureReason };
}

// --- INFLIGHT ABORT CONTROLLERS & INFLIGHT LOCKS ---
var marinAbortController = null;
var marineRequestInFlight = false;
var BOOTSTRAP_MARINE = true;

function hasTimeCoverage(cache, hourOffset) {
  const timeArray = cache?.results?.[0]?.hourly?.time;
  if (!timeArray || timeArray.length === 0) return false;
  const targetMs = Date.now() + hourOffset * 3600000;
  const lastCachedMs = new Date(timeArray[timeArray.length - 1] + 'Z').getTime();
  return targetMs <= lastCachedMs + 2 * 3600000;
}

export function isContainedInMarineCache(bounds, model, hourOffset = 0, layer = 'waves') {
  if (!bounds || !marineHourlyCache.bounds || !marineHourlyCache.results) return false;
  if (marineHourlyCache.model !== (model || 'GFS')) return false;
  const cacheLayerKey = marineHourlyCache.__layerKey || 'all';
  if (cacheLayerKey !== 'all' && cacheLayerKey !== layer) return false;
  if (!_isAllVarModel(model) && (marineHourlyCache.activeLayer || 'waves') !== layer) return false;
  if (Date.now() - marineHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  
  if (marineHourlyCache.__coverageStartMs && marineHourlyCache.__coverageEndMs) {
    const targetMs = Date.now() + hourOffset * 3600000;
    if (targetMs < marineHourlyCache.__coverageStartMs - 3600000 || targetMs > marineHourlyCache.__coverageEndMs + 3600000) {
      return false;
    }
  } else {
    if (!hasTimeCoverage(marineHourlyCache, hourOffset)) return false;
  }
  
  const isGlobalCached = !!marineHourlyCache.isGlobal;
  const isGlobalViewport = Math.abs(bounds.east - bounds.west) > 180 || Math.abs(bounds.north - bounds.south) > 90;
  if (isGlobalCached !== isGlobalViewport) return false;
  return isViewportInsideCachedBounds(bounds, marineHourlyCache.bounds);
}

export function getMarineHourlyCache() {
  return marineHourlyCache;
}

// --- FEATURE FLAG CONTROLLER FOR BACKEND WEATHER SERVICE ---
export function getBackendWeatherFlag() {
  if (typeof window === 'undefined') return false;
  if (window.__USE_BACKEND_WEATHER_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_WEATHER_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_WEATHER_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  return process.env.REACT_APP_USE_BACKEND_WEATHER === 'true';
}

var lastGridUrl = 'none';
var lastGridStatus = 0;
var lastGridValidTime = 'none';
var lastGridValueKind = 'none';
var lastGridValueUnit = 'none';
var lastGridDisplayUnitHint = 'none';
var lastGridElapsedMs = 0;
var lastGridError = null;

if (typeof window !== 'undefined') {
  window.__BACKEND_WEATHER_SERVICE_DIAG__ = {
    featureFlagActive: getBackendWeatherFlag(),
    activeModel: 'GFS',
    activeLayer: 'waves',
    gridUrl: `${BACKEND_URL}/api/weather/grid`,
    pointUrl: `${BACKEND_URL}/api/weather/point`,
    statusUrl: `${BACKEND_URL}/api/weather/status`,
    lastGridFetch: null,
    lastPointFetch: null
  };
}

async function fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds) {
  const start = Date.now();
  const targetDt = new Date(Math.round(Date.now() / 3600000) * 3600000 + hourOffset * 3600000);
  const validTimeStr = targetDt.toISOString();
  lastGridValidTime = validTimeStr;

  const bboxParam = `${snappedBounds.west},${snappedBounds.south},${snappedBounds.east},${snappedBounds.north}`;
  const url = `${BACKEND_URL}/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=${validTimeStr}&bbox=${bboxParam}`;
  lastGridUrl = url;

  try {
    const res = await fetch(url, { signal });
    lastGridStatus = res.status;
    if (!res.ok) {
      throw new Error(`Backend returned HTTP ${res.status}`);
    }
    const json = await res.json();
    lastGridValueKind = json.value_kind || 'wave_height';
    lastGridValueUnit = json.value_unit || 'm';
    lastGridDisplayUnitHint = json.display_unit_hint || 'ft';
    lastGridElapsedMs = Date.now() - start;
    lastGridError = null;

    const mappedVectors = json.grid.vectors.map(v => ({
      lat: v.lat,
      lng: v.lng,
      isOcean: true,
      waves: {
        u: v.u || 0,
        v: v.v || 0,
        speed: v.speed || 0,
        period: v.period || 0
      },
      swell_1: { u: 0, v: 0, speed: 0, period: 0 },
      swell_2: { u: 0, v: 0, speed: 0, period: 0 },
      wind_waves: { u: 0, v: 0, speed: 0, period: 0 }
    }));

    const result = {
      type: 'FeatureCollection',
      features: [],
      hourOffset,
      grid: {
        vectors: mappedVectors,
        bounds: json.grid.bounds || snappedBounds,
        cols: json.grid.cols,
        rows: json.grid.rows,
        timestamp: Date.now(),
        __sourceModel: 'GFS',
        __provider: json.provider || 'backend-weather-service',
        __gridProvider: json.provider || 'backend-weather-service',
        __componentLayer: 'waves',
        __gridSupportsLayer: true,
        __activeLayerNonzeroCount: mappedVectors.filter(v => v.waves.speed > 0).length,
        __activeLayerMax: Math.max(...mappedVectors.map(v => v.waves.speed), 0),
        __oceanMaskCount: mappedVectors.length,
        __renderable: true,
        provider: json.provider || 'backend-weather-service',
        hourOffset
      }
    };

    if (typeof window !== 'undefined') {
      window.__BACKEND_WEATHER_SERVICE_DIAG__.lastGridFetch = {
        url,
        status: res.status,
        validTime: validTimeStr,
        valueKind: lastGridValueKind,
        valueUnit: lastGridValueUnit,
        displayUnitHint: lastGridDisplayUnitHint,
        elapsedMs: lastGridElapsedMs,
        error: null
      };
      window.__BACKEND_WEATHER_SERVICE_DIAG__.featureFlagActive = getBackendWeatherFlag();
    }

    return result;
  } catch (err) {
    lastGridElapsedMs = Date.now() - start;
    lastGridError = err.message;
    if (typeof window !== 'undefined') {
      window.__BACKEND_WEATHER_SERVICE_DIAG__.lastGridFetch = {
        url,
        status: lastGridStatus,
        validTime: validTimeStr,
        valueKind: 'none',
        valueUnit: 'none',
        displayUnitHint: 'none',
        elapsedMs: lastGridElapsedMs,
        error: err.message
      };
      window.__BACKEND_WEATHER_SERVICE_DIAG__.featureFlagActive = getBackendWeatherFlag();
    }
    console.error(`[Backend Weather Service] Grid fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    throw err;
  }
}

function extractMarineAtOffset(cache, hourOffset, targetLayer) {
  const { results, points, gridSize, bounds } = cache;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
  
  if (timeArray?.[idx]) {
    const cachedMs = new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').getTime();
    const delta = Math.abs(cachedMs - targetMs);
    if (delta > 3 * 3600000) {
      console.warn(`[extractMarineAtOffset] Rejected: delta=${(delta/3600000).toFixed(1)}h > 3h`);
      return null;
    }
  }

  const activeModel = cache.model || 'GFS';
  const gridVectors = [];
  const features = [];

  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0, period: 0 }, swell_1: { u: 0, v: 0, speed: 0, period: 0 },
        swell_2: { u: 0, v: 0, speed: 0, period: 0 }, wind_waves: { u: 0, v: 0, speed: 0, period: 0 },
        isOcean: false });
      return;
    }
    const c = {
      wave_height: r.hourly.wave_height?.[idx], wave_direction: r.hourly.wave_direction?.[idx],
      wave_period: r.hourly.wave_period?.[idx],
      swell_wave_height: r.hourly.swell_wave_height?.[idx], swell_wave_direction: r.hourly.swell_wave_direction?.[idx],
      swell_wave_period: r.hourly.swell_wave_period?.[idx],
      secondary_swell_wave_height: r.hourly.secondary_swell_wave_height?.[idx],
      secondary_swell_wave_direction: r.hourly.secondary_swell_wave_direction?.[idx],
      secondary_swell_wave_period: r.hourly.secondary_swell_wave_period?.[idx],
      wind_wave_height: r.hourly.wind_wave_height?.[idx], wind_wave_direction: r.hourly.wind_wave_direction?.[idx],
      wind_wave_period: r.hourly.wind_wave_period?.[idx],
    };
    const w_h = safeNum(c.wave_height), w_d = safeNum(c.wave_direction);
    const s1_h = safeNum(c.swell_wave_height ?? 0), s1_d = safeNum(c.swell_wave_direction ?? 0);
    const s2_h = safeNum(c.secondary_swell_wave_height ?? 0), s2_d = safeNum(c.secondary_swell_wave_direction ?? 0);
    const ww_h = safeNum(c.wind_wave_height ?? 0), ww_d = safeNum(c.wind_wave_direction ?? 0);

    const activeLayerFromCache = targetLayer || cache.activeLayer || 'waves';
    let isOcean = false;
    if (activeLayerFromCache === 'waves') {
      isOcean = (r.hourly.wave_height?.[idx] != null);
    } else if (activeLayerFromCache === 'swell_1') {
      isOcean = (r.hourly.swell_wave_height?.[idx] != null) || (r.hourly.wave_height?.[idx] != null);
    } else if (activeLayerFromCache === 'swell_2') {
      isOcean = (r.hourly.secondary_swell_wave_height?.[idx] != null) || (r.hourly.swell_wave_height?.[idx] != null) || (r.hourly.wave_height?.[idx] != null);
    } else if (activeLayerFromCache === 'wind_waves') {
      isOcean = (r.hourly.wind_wave_height?.[idx] != null) || (r.hourly.wave_height?.[idx] != null);
    } else {
      isOcean = (r.hourly.wave_height?.[idx] != null);
    }

    if (w_h === 0 && s1_h === 0 && ww_h === 0) {
      gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0, period: 0 }, swell_1: { u: 0, v: 0, speed: 0, period: 0 },
        swell_2: { u: 0, v: 0, speed: 0, period: 0 }, wind_waves: { u: 0, v: 0, speed: 0, period: 0 },
        isOcean });
      return;
    }

    const isIconSwell2Estimated = activeLayerFromCache === 'swell_2' && activeModel === 'ICON' && s2_h === 0 && s1_h > 0;
    const final_s2_h = isIconSwell2Estimated ? s1_h : s2_h;
    const final_s2_d = isIconSwell2Estimated ? s1_d : s2_d;
    const final_s2_period = isIconSwell2Estimated ? safeNum(c.swell_wave_period ?? 0) : safeNum(c.secondary_swell_wave_period ?? 0);

    gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
      waves: { ...getUV(w_h, w_d), period: safeNum(c.wave_period) },
      swell_1: { ...getUV(s1_h, s1_d), period: safeNum(c.swell_wave_period ?? 0) },
      swell_2: { ...getUV(final_s2_h, final_s2_d), period: final_s2_period },
      wind_waves: { ...getUV(ww_h, ww_d), period: safeNum(c.wind_wave_period ?? 0) },
      isOcean });

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pt.monotonicLng, pt.lat] },
      properties: {
        wave_height: w_h, wave_period: safeNum(c.wave_period), wave_direction: w_d,
        swell_wave_height: s1_h, swell_wave_period: safeNum(c.swell_wave_period != null ? c.swell_wave_period : null), swell_wave_direction: s1_h > 0 ? s1_d : null,
        secondary_swell_wave_height: s2_h, secondary_swell_wave_period: safeNum(c.secondary_swell_wave_period != null ? c.secondary_swell_wave_period : null), secondary_swell_wave_direction: s2_h > 0 ? s2_d : null,
        wind_wave_height: ww_h, wind_wave_period: safeNum(c.wind_wave_period != null ? c.wind_wave_period : null), wind_wave_direction: ww_h > 0 ? ww_d : null,
      },
    });
  });

  if (gridVectors.length === 0) return null;

  const provider = cache.provider || 'open-meteo';
  const activeLayerFromCache = targetLayer || cache.activeLayer || 'waves';
  let activeLayerNonzero = 0, activeLayerMax = 0, oceanMaskCount = 0;
  for (const gv of gridVectors) {
    if (gv.isOcean) oceanMaskCount++;
    const ld = gv[activeLayerFromCache];
    if (ld && ld.speed > 0) { activeLayerNonzero++; if (ld.speed > activeLayerMax) activeLayerMax = ld.speed; }
  }
  const renderable = activeLayerNonzero > 0;
  const noDataReason = !renderable ? (oceanMaskCount > 0 ? 'active_layer_zero_ocean_present' : 'no_ocean_data') : null;
  return {
    type: 'FeatureCollection', features, hourOffset,
    grid: { vectors: gridVectors, bounds, cols: gridSize, rows: gridSize, timestamp: Date.now(),
            __sourceModel: activeModel, __provider: provider, __gridProvider: provider,
            __componentLayer: activeLayerFromCache, __gridSupportsLayer: renderable,
            __activeLayerNonzeroCount: activeLayerNonzero, __activeLayerMax: activeLayerMax,
            __oceanMaskCount: oceanMaskCount, __renderable: renderable, __noDataReason: noDataReason,
            provider: provider, hourOffset }
  };
}

export { extractMarineAtOffset };

// Centralized single-flight request registry for marine fetches
var inFlightMarineRequests = new Map();

export async function fetchMarineData(bounds, zoom, signal, hourOffset = 0, forceFetch = false, model = null, activeLayer = 'waves', isPrefetch = false) {
  if (!bounds) return getModelSafeMarine(model, hourOffset, activeLayer);

  let west = bounds.west, east = bounds.east;
  if (east < west) east += 360;

  const { snap, padding } = getSnapConfig(bounds);
  let latMin = Math.max(-80, Math.min(84.5, Math.floor((bounds.south - padding) / snap) * snap));
  let latMax = Math.max(-79.5, Math.min(85, Math.ceil((bounds.north + padding) / snap) * snap));
  if (latMax <= latMin) { latMin = -80; latMax = 85; }
  const snappedBounds = { west: Math.floor((west - padding) / snap) * snap, south: latMin, east: Math.ceil((east + padding) / snap) * snap, north: latMax };

  // --- GFS BACKEND SERVICE REDIRECT FOR STAGE 2 PILOT ---
  if (getBackendWeatherFlag() && (model === 'GFS' || !model) && activeLayer === 'waves') {
    try {
      console.log(`[Backend Weather Service] Redirecting GFS Waves grid fetch to backend Weather Data Service for hourOffset=+${hourOffset}h`);
      const result = await fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds);
      return result;
    } catch (err) {
      console.warn(`[Backend Weather Service] Grid redirect failed. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  const { points, gridSize, isGlobal, bounds: gridBounds } = computeGridPoints(snappedBounds, 'marine');
  const pointCount = points.length || 1;

  const MARINE_OM_MODELS = { GFS: 'ncep_gfswave025', ICON: 'gwam', EURO: 'ecmwf_wam025' };
  const apiModel = (model && MARINE_OM_MODELS[model]) ? MARINE_OM_MODELS[model] : 'ncep_gfswave025';
  const maxForecastDays = apiModel === 'ncep_gfswave025' ? 16 : apiModel === 'gwam' ? 7 : apiModel === 'ecmwf_wam025' ? 10 : 3;
  const requestedDays = isPrefetch ? maxForecastDays : hourOffset > 48 ? Math.ceil((hourOffset + 1) / 24) : 2;
  let forecastDays = Math.min(maxForecastDays, requestedDays);

  const _baseVars = ['wave_height','wave_direction','wave_period','swell_wave_height','swell_wave_direction','swell_wave_period'];
  const _swellVars = ['secondary_swell_wave_height','secondary_swell_wave_direction','secondary_swell_wave_period'];
  const _windVars = ['wind_wave_height','wind_wave_direction','wind_wave_period'];
  const allVarsList = apiModel === 'gwam' ? [..._baseVars, ..._windVars] : [..._baseVars, ..._swellVars, ..._windVars];
  const allVarsCount = allVarsList.length;

  let varFetchMode = 'all';
  let activeVars = [];
  const isAllVarModel = (model !== 'EURO');

  const estimatedAllVarBytes = estimateRequestCost('marine', model, pointCount, allVarsCount, forecastDays);
  if (isAllVarModel && forecastDays <= 2 && estimatedAllVarBytes <= 4500000) {
    varFetchMode = 'all';
    activeVars = [...allVarsList];
  } else {
    varFetchMode = 'layer_scoped';
    if (activeLayer === 'waves') {
      activeVars = ['wave_height', 'wave_direction', 'wave_period'];
    } else if (activeLayer === 'swell_1') {
      activeVars = ['swell_wave_height', 'swell_wave_direction', 'swell_wave_period'];
    } else if (activeLayer === 'swell_2') {
      if (apiModel === 'gwam') activeVars = ['swell_wave_height', 'swell_wave_direction', 'swell_wave_period'];
      else activeVars = ['secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period'];
    } else if (activeLayer === 'wind_waves') {
      activeVars = ['wind_wave_height', 'wind_wave_direction', 'wind_wave_period'];
    } else {
      activeVars = ['wave_height', 'wave_direction', 'wave_period'];
    }
  }

  if (!activeVars.includes('wave_height')) {
    activeVars.push('wave_height');
  }

  let marineVarList = activeVars.filter(v => allVarsList.includes(v));
  if (marineVarList.length === 0) {
    marineVarList = allVarsList.slice(0, 3);
  }

  let estimatedBytes = estimateRequestCost('marine', model, pointCount, marineVarList.length, forecastDays);
  if (estimatedBytes > 4500000) {
    const bytesPerDay = pointCount * (24 * 19 + marineVarList.length * 24 * 6);
    const maxSafeDays = Math.floor((4500000 - pointCount * 1000) / bytesPerDay);
    forecastDays = Math.min(forecastDays, Math.max(1, maxSafeDays));
    estimatedBytes = estimateRequestCost('marine', model, pointCount, marineVarList.length, forecastDays);
  }

  if (!forceFetch && isContainedInMarineCache(bounds, model, hourOffset, activeLayer)) {
    return extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
  }

  const expectedProvider = 'open-meteo';
  const layerKey = varFetchMode === 'all' ? 'all' : (activeLayer || 'waves');
  const viewHash = viewportCacheKey(snappedBounds, `marine_${model || 'GFS'}_${layerKey}_${expectedProvider}`);

  if (marineHourlyCache.hash === viewHash &&
      marineHourlyCache.model === (model || 'GFS') &&
      (layerKey === 'all' || (marineHourlyCache.activeLayer || 'waves') === (activeLayer || 'waves')) &&
      (marineHourlyCache.provider || 'open-meteo') === expectedProvider &&
      Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL &&
      hasTimeCoverage(marineHourlyCache, hourOffset)) {
    return extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
  }

  if (marineHourlyCache.hash && marineHourlyCache.model === (model || 'GFS') &&
      (layerKey === 'all' || (marineHourlyCache.activeLayer || 'waves') === (activeLayer || 'waves')) &&
      (marineHourlyCache.provider || 'open-meteo') === expectedProvider &&
      Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const stale = extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
    if (stale?.features?.length) { lastKnownGoodMarine = stale; lastKnownGoodMarineModel = model || 'GFS'; lastKnownGoodMarine.__sourceModel = lastKnownGoodMarineModel; lastKnownGoodMarine.__provider = expectedProvider; }
  }

  const cacheKey = viewportCacheKey(snappedBounds, `marine_${model || 'GFS'}_${layerKey}_${expectedProvider}_h${hourOffset}`);
  const cachedResult = MARINE_CACHE.get(cacheKey);
  if (cachedResult && Date.now() - cachedResult.timestamp < 300000) return cachedResult.data;

  const requestKey = `${model || 'GFS'}_${layerKey}_fd${forecastDays}_${expectedProvider}_${viewHash}_${isPrefetch ? 'p' : 'l'}`;
  
  let matchedPromise = null;
  for (const [key, promise] of inFlightMarineRequests.entries()) {
    if (key.includes(`_${expectedProvider}_${viewHash}_`)) {
      const parts = key.split('_');
      const keyModel = parts[0];
      const keyLayerKey = parts[1];
      const keyFdPart = parts[2] || '';
      if (keyFdPart.startsWith('fd')) {
        const keyFd = parseInt(keyFdPart.replace('fd', ''), 10);
        if (keyModel === (model || 'GFS') && keyLayerKey === layerKey && keyFd >= forecastDays) {
          matchedPromise = promise;
          break;
        }
      }
    }
  }

  if (matchedPromise) {
    try {
      await matchedPromise;
      return extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
    } catch (e) {
      return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'inflight_failed');
    }
  }

  if (inFlightMarineRequests.has(requestKey)) {
    try {
      await inFlightMarineRequests.get(requestKey);
      return extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
    } catch (e) {
      return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'inflight_failed');
    }
  }

  if (!forceFetch && isInCooldown('marine')) {
    return getModelSafeMarine(model, hourOffset, activeLayer);
  }

  const fetchPromise = (async () => {
    if (marinAbortController && !isPrefetch) marinAbortController.abort();
    if (!isPrefetch) marinAbortController = new AbortController();
    const fetchSignal = signal || (isPrefetch ? null : marinAbortController.signal);

    try {
      const lats = points.map(p => p.lat);
      const lons = points.map(p => p.reqLng);

      const body = { latitude: lats, longitude: lons, hourly: marineVarList, forecast_days: forecastDays };
      if (model && MARINE_OM_MODELS[model]) body.models = [MARINE_OM_MODELS[model]];

      const fetchStart = Date.now();
      let res;
      try {
        res = await governMarineRequest({
          source: 'marineController.fetchMarineData',
          type: 'marine',
          body: body,
          signal: fetchSignal,
          model: model || 'GFS',
          layer: activeLayer || 'waves',
          category: 'grid'
        });
        if (res.status === 429) {
          enterCooldown('marine');
          logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 429, result: 'rate_limited', elapsedMs: Date.now() - fetchStart });
          return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'rate_limited_no_cache');
        }
        if (!res.ok) {
          if (res.status === 500) {
            try {
              const err = await res.clone().json();
              if (err?.isRateLimit || err?.message?.includes('429')) {
                enterCooldown('marine');
                logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 500, upstreamStatus: 429, result: 'rate_limited', elapsedMs: Date.now() - fetchStart });
                return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'rate_limited_no_cache');
              }
            } catch(e) {}
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Non-JSON response');
      } catch (err) {
        if (err.message === 'cooldown_active' || err.message === 'failure_ttl_active' || err.message === 'grid_fetch_in_flight') {
          return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'rate_limited');
        }
        if (isLocalhost) {
          const rg = 6, rLats = [], rLons = [], rPts = [];
          for (let y = 0; y <= rg; y++) for (let x = 0; x <= rg; x++) {
            let lat = snappedBounds.south + y * (snappedBounds.north - snappedBounds.south) / rg;
            let lng = snappedBounds.west + x * (snappedBounds.east - snappedBounds.west) / rg;
            while (lng >= 180) lng -= 360; while (lng < -180) lng += 360;
            rLats.push(lat.toFixed(2)); rLons.push(lng.toFixed(2));
            rPts.push({ lat: +lat.toFixed(2), reqLng: +lng.toFixed(2), monotonicLng: +(snappedBounds.west + x * (snappedBounds.east - snappedBounds.west) / rg).toFixed(2) });
          }
          const getUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${rLats.join(',')}&longitude=${rLons.join(',')}&hourly=${marineVarList.join(',')}&forecast_days=${forecastDays}${(model && MARINE_OM_MODELS[model]) ? '&models=' + MARINE_OM_MODELS[model] : ''}`;
          res = await fetch(getUrl, { signal: fetchSignal });
          if (res.ok) { points.length = 0; rPts.forEach(p => points.push(p)); gridSize = rg + 1; }
        } else { throw err; }
      }

      if (!res.ok) {
        if (res.status === 413) {
          if (typeof window !== 'undefined') {
            window.__MARINE_HEATMAP_STATUS__ = { status: 'payload_too_large', model, layer: activeLayer, hour: hourOffset };
          }
          return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'payload_too_large');
        }
        if (res.status === 429) {
          enterCooldown('marine');
          logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 429, result: 'rate_limited_fallback', elapsedMs: Date.now() - fetchStart });
          return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'rate_limited');
        }
        logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: res.status, result: 'proxy_error', elapsedMs: Date.now() - fetchStart });
        return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'proxy_error');
      }

      const json = await res.json();
      let allResults = Array.isArray(json) ? json : (json?.hourly ? points.map(() => json) : null);
      if (!allResults) return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'invalid_shape');

      const timeArray = allResults[0]?.hourly?.time;
      const validTimesCount = timeArray ? timeArray.length : 0;
      const coverageStartMs = timeArray && timeArray[0] ? new Date(timeArray[0].endsWith('Z') ? timeArray[0] : timeArray[0] + 'Z').getTime() : Date.now();
      const coverageEndMs = timeArray && timeArray[timeArray.length - 1] ? new Date(timeArray[timeArray.length - 1].endsWith('Z') ? timeArray[timeArray.length - 1] : timeArray[timeArray.length - 1] + 'Z').getTime() : Date.now();

      var detectedProvider = (allResults[0]?.__provider === 'copernicus') ? 'copernicus' : 'open-meteo';
      marineHourlyCache = {
        hash: viewHash, results: allResults, points, gridSize,
        bounds: gridBounds, timestamp: Date.now(),
        model: model || 'GFS', activeLayer: activeLayer || 'waves', provider: detectedProvider, isGlobal,
        __coverageStartMs: coverageStartMs,
        __coverageEndMs: coverageEndMs,
        __forecastDays: forecastDays,
        __validTimesCount: validTimesCount,
        __model: model || 'GFS',
        __layerKey: layerKey
      };
      persistCache(LS_MARINE_KEY, marineHourlyCache);

      const result = extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
      if (result) {
        clearCooldown('marine');
        logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset,
          pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 200,
          provider: detectedProvider, cacheHit: false, result: 'success',
          elapsedMs: Date.now() - fetchStart, renderable: result?.grid?.__renderable });
        MARINE_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
        lastKnownGoodMarine = result;
        lastKnownGoodMarineModel = model || 'GFS';
        lastKnownGoodMarine.__sourceModel = lastKnownGoodMarineModel;
        lastKnownGoodMarine.__provider = detectedProvider;
        _cacheMarineResult(model || 'GFS', hourOffset, result, activeLayer);
        if (BOOTSTRAP_MARINE) { BOOTSTRAP_MARINE = false; }
        return result;
      }
      return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'empty_vectors');
    } catch (err) {
      if (err.name === 'AbortError') return getModelSafeMarine(model, hourOffset, activeLayer);
      return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'fetch_exception');
    } finally {
      inFlightMarineRequests.delete(requestKey);
    }
  })();

  inFlightMarineRequests.set(requestKey, fetchPromise);
  return fetchPromise;
}
