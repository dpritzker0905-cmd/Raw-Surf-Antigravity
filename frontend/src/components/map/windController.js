// windController.js — Fetch layer and reindexing for wind data.
// Extracted from marineController.js to satisfy the 800 LOC limit.

import {
  safeNum, getUV, PROXY_URL, isLocalhost, findClosestHourIndex,
  HOURLY_CACHE_TTL, persistCache, hydrateCache,
  isInCooldown, enterCooldown, clearCooldown,
  getSnapConfig, isViewportInsideCachedBounds, viewportCacheKey, computeGridPoints
} from './marineControllerUtils';
import { governMarineRequest } from './marineRequestGovernor';

// --- CACHES ---
var WIND_CACHE = new Map();
var windHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0, model: null };

// --- PERSISTENT CACHE ---
var LS_WIND_KEY = 'rawsurf_wind_cache_v3';

// Hydrate on module init
var _hydratedWind = hydrateCache(LS_WIND_KEY);
if (_hydratedWind) {
  var _hydBounds = _hydratedWind.bounds;
  var _hydLngSpan = _hydBounds ? Math.abs(_hydBounds.east - _hydBounds.west) : 0;
  if (_hydLngSpan > 180) {
    windHourlyCache = _hydratedWind;
    console.log(`[Wind] Hydrated from localStorage: ${_hydratedWind.points?.length} pts, age ${Math.round((Date.now() - _hydratedWind.timestamp)/1000)}s (GLOBAL)`);
  } else {
    console.log(`[Wind] Rejected non-global localStorage cache (lngSpan=${_hydLngSpan.toFixed(0)}°, need >180°)`);
    _hydratedWind = null;
    try { localStorage.removeItem(LS_WIND_KEY); } catch(e) {}
  }
}

// --- LAST KNOWN GOOD FIELDS ---
var lastKnownGoodWind = _hydratedWind ? extractWindAtOffset(_hydratedWind, 0) : null;

// --- INFLIGHT ABORT CONTROLLERS ---
var windAbortController = null;

// --- INFLIGHT LOCKS ---
var windRequestInFlight = false;

// --- BOOTSTRAP MODE ---
var BOOTSTRAP_WIND = true;

function estimateRequestCost(type, model, pointCount, hourlyVarCount, forecastDays) {
  if (type === 'tiles') return 50000;
  const timeBytes = forecastDays * 24 * 25;
  const varBytes = hourlyVarCount * forecastDays * 24 * 8;
  const metadataBytes = 1500;
  return pointCount * (timeBytes + varBytes + metadataBytes);
}

export function isContainedInWindCache(bounds, model) {
  if (!bounds || !windHourlyCache.bounds || !windHourlyCache.results) return false;
  if (windHourlyCache.model !== (model || 'GFS')) return false;
  if (Date.now() - windHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  const isGlobalCached = !!windHourlyCache.isGlobal;
  const isGlobalViewport = Math.abs(bounds.east - bounds.west) > 180 || Math.abs(bounds.north - bounds.south) > 90;
  if (isGlobalCached !== isGlobalViewport) return false;
  return isViewportInsideCachedBounds(bounds, windHourlyCache.bounds);
}

export function getWindHourlyCache() {
  return windHourlyCache;
}

export function extractWindAtOffset(cache, hourOffset) {
  const { results, points, gridSize, bounds } = cache;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;

  const speedUnit = results[0]?.hourly_units?.wind_speed_10m || 'km/h';

  const vectors = [];
  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      vectors.push({ lat: pt.lat, lng: pt.monotonicLng, speed: 0, direction: 0, u: 0, v: 0 });
      return;
    }
    let speed = r.hourly.wind_speed_10m?.[idx];
    const dir = r.hourly.wind_direction_10m?.[idx];
    if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) {
      vectors.push({ lat: pt.lat, lng: pt.monotonicLng, speed: 0, direction: 0, u: 0, v: 0 });
      return;
    }
    if (speedUnit === 'km/h') {
      speed = speed * 0.539957;
    } else if (speedUnit === 'm/s') {
      speed = speed * 1.943844;
    } else if (speedUnit === 'mph') {
      speed = speed * 0.868976;
    }

    const rad = dir * (Math.PI / 180);
    vectors.push({
      lat: pt.lat, lng: pt.monotonicLng, speed, direction: dir,
      u: -speed * Math.sin(rad), v: -speed * Math.cos(rad)
    });
  });

  if (vectors.length === 0) return null;

  return {
    vectors, bounds, cols: gridSize, rows: gridSize,
    stale: false, source: cache.model || 'GFS', hourOffset
  };
}

export async function fetchWindData(bounds, signal, hourOffset = 0, forceFetch = false, forecastDays = 3, model = null) {
  if (!bounds) { console.log('[Wind] fetchWindData: no bounds'); return lastKnownGoodWind; }
  if (!forceFetch && isContainedInWindCache(bounds, model)) return extractWindAtOffset(windHourlyCache, hourOffset);
  if (windRequestInFlight) return lastKnownGoodWind;
  if (!forceFetch && isInCooldown('wind')) return lastKnownGoodWind;

  let west = bounds.west, east = bounds.east;
  if (east < west) east += 360;

  const { snap, padding } = getSnapConfig(bounds);
  const latMinRaw = Math.floor((bounds.south - padding) / snap) * snap;
  const latMaxRaw = Math.ceil((bounds.north + padding) / snap) * snap;
  const lngMin = Math.floor((west - padding) / snap) * snap;
  const lngMax = Math.ceil((east + padding) / snap) * snap;
  const latMin = Math.max(-85, Math.min(85, latMinRaw));
  const latMax = Math.max(-85, Math.min(85, latMaxRaw));

  if (latMax <= latMin || lngMax <= lngMin) return lastKnownGoodWind;
  const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };

  const viewHash = viewportCacheKey(snappedBounds, `wind_${model || 'GFS'}`);
  if (windHourlyCache.hash === viewHash && windHourlyCache.model === (model || 'GFS') && Date.now() - windHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    return extractWindAtOffset(windHourlyCache, hourOffset);
  }

  if (windHourlyCache.hash && windHourlyCache.model === (model || 'GFS') && Date.now() - windHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractWindAtOffset(windHourlyCache, hourOffset);
    if (staleData?.vectors?.length) lastKnownGoodWind = staleData;
  }

  const cacheKey = viewportCacheKey(snappedBounds, `wind_${model || 'GFS'}_h${hourOffset}`);
  if (WIND_CACHE.has(cacheKey) && Date.now() - WIND_CACHE.get(cacheKey).timestamp < 300000) return WIND_CACHE.get(cacheKey).data;

  if (windAbortController) windAbortController.abort();
  windAbortController = new AbortController();
  const fetchSignal = signal || windAbortController.signal;
  windRequestInFlight = true;

  try {
    const { points, gridSize, isGlobal, bounds: gridBounds } = computeGridPoints(snappedBounds);
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.reqLng);

    const OM_MODELS = { GFS: 'gfs_seamless', EURO: 'ecmwf_ifs', ICON: 'dwd_icon' };

    const body = {
      latitude: lats, longitude: lons,
      wind_speed_unit: 'kn',
      hourly: ['wind_speed_10m', 'wind_direction_10m'],
      forecast_days: forecastDays
    };
    if (model && OM_MODELS[model]) {
      body.models = [OM_MODELS[model]];
    }

    let res;
    try {
      res = await governMarineRequest({
        source: 'marineController.fetchWindData',
        type: 'wind',
        body: body,
        signal: fetchSignal,
        model: model || 'GFS',
        layer: 'wind',
        category: 'grid'
      });
      if (res.status === 429) {
        enterCooldown('wind');
        console.warn('[Wind] 429 from proxy governor, cooldown activated');
        return lastKnownGoodWind;
      }
      if (!res.ok) {
        throw new Error(`Proxy returned HTTP ${res.status}`);
      }
      const windContentType = res.headers.get('content-type') || '';
      if (!windContentType.includes('application/json')) {
        throw new Error(`Proxy returned non-JSON content-type: ${windContentType.substring(0, 50)}`);
      }
    } catch (proxyErr) {
      if (proxyErr.message === 'wind_cooldown_active' || proxyErr.message === 'failure_ttl_active' || proxyErr.message === 'grid_fetch_in_flight') {
        console.warn(`[WindController] Governor blocked wind fetch: ${proxyErr.message}`);
        return lastKnownGoodWind;
      }
      if (isLocalhost) {
        console.log('[Wind] Proxy unavailable or error, direct API fallback:', proxyErr.message);
        res = await fetch('https://api.open-meteo.com/v1/forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: fetchSignal
        });
      } else {
        console.error('[Wind] Proxy error, direct fallback skipped in production/dev:', proxyErr.message);
        throw proxyErr;
      }
    }

    if (!res.ok) {
      if (res.status === 429) {
        enterCooldown('wind');
        console.warn(`[Wind] 429 rate limited cooldown active`);
        return lastKnownGoodWind;
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    let results = Array.isArray(json) ? json
      : (json?.hourly ? points.map(() => json) : null);
    if (!results) { console.warn('[Wind] Unexpected API response shape'); return lastKnownGoodWind; }

    windHourlyCache = {
      hash: viewHash, results, points, gridSize,
      bounds: gridBounds,
      timestamp: Date.now(),
      model: model || 'GFS',
      isGlobal
    };
    if (isGlobal) {
      persistCache(LS_WIND_KEY, windHourlyCache);
    }

    const data = extractWindAtOffset(windHourlyCache, hourOffset);
    if (data) {
      WIND_CACHE.set(cacheKey, { data, timestamp: Date.now() });
      lastKnownGoodWind = data;
      console.log(`[Wind] Fetch: ${data.vectors.length} vectors, offset: ${hourOffset}h`);
      return data;
    } else {
      console.warn('[Wind] Zero valid vectors from API');
      return lastKnownGoodWind;
    }
  } catch (err) {
    if (err.name === 'AbortError') return lastKnownGoodWind;
    console.error(`[Wind] Fetch failed: ${err.message}`);
    return lastKnownGoodWind;
  } finally {
    windRequestInFlight = false;
  }
}
