/**
 * marineControllerPressure.js
 *
 * Pressure data fetch layer, extracted from marineController.js for LOC compliance.
 * Conforms to the Marine Engine v3 runtime contract.
 */

import {
  safeNum, PROXY_URL, isLocalhost, findClosestHourIndex,
  HOURLY_CACHE_TTL, persistCache, hydrateCache,
  isInCooldown, enterCooldown,
  getSnapConfig, isViewportInsideCachedBounds, viewportCacheKey, computeGridPoints
} from './marineControllerUtils';

// --- CACHES ---
var PRESSURE_CACHE = new Map();

// --- HOURLY DATA CACHE (pre-fetched for timeline scrub) ---
var pressureHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0, model: null };

// --- PERSISTENT CACHE (localStorage) ---
var LS_PRESSURE_KEY = 'rawsurf_pressure_cache_v2'; // v2: bumped to invalidate stale 225-point caches

// Hydrate from localStorage on module init
var _hydratedPressure = hydrateCache(LS_PRESSURE_KEY);
if (_hydratedPressure) {
  pressureHourlyCache = _hydratedPressure;
  console.log(`[Pressure] Hydrated from localStorage: ${_hydratedPressure.points?.length} pts, age ${Math.round((Date.now() - _hydratedPressure.timestamp)/1000)}s`);
}

// --- LAST KNOWN GOOD FIELDS ---
var lastKnownGoodPressure = _hydratedPressure ? extractPressureAtOffset(_hydratedPressure, 0) : null;
if (lastKnownGoodPressure) console.log(`[Pressure] Pre-populated lastKnownGood: ${lastKnownGoodPressure.pressures.length} pressures`);

// --- INFLIGHT ABORT CONTROLLERS ---
var pressureAbortController = null;

// --- INFLIGHT LOCKS ---
var pressureRequestInFlight = false;

// --- BOOTSTRAP MODE ---
var BOOTSTRAP_PRESSURE = true;

export function isContainedInPressureCache(bounds, model) {
  if (!bounds || !pressureHourlyCache.bounds || !pressureHourlyCache.results) return false;
  if (pressureHourlyCache.model !== (model || 'GFS')) return false;
  if (Date.now() - pressureHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  const isGlobalCached = !!pressureHourlyCache.isGlobal;
  const isGlobalViewport = Math.abs(bounds.east - bounds.west) > 180 || Math.abs(bounds.north - bounds.south) > 90;
  if (isGlobalCached !== isGlobalViewport) return false;
  return isViewportInsideCachedBounds(bounds, pressureHourlyCache.bounds);
}

// ========================================================================
// EXTRACT PRESSURE DATA AT A GIVEN HOUR OFFSET (from pre-fetched hourly cache)
// ========================================================================
export function extractPressureAtOffset(cache, hourOffset) {
  const { results, points, gridSize, bounds } = cache;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;

  const pressures = [];
  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      pressures.push({ lat: pt.lat, lng: pt.monotonicLng, pressure: 1013 });
      return;
    }
    const pressure = r.hourly.pressure_msl?.[idx];
    if (pressure == null || isNaN(pressure)) {
      pressures.push({ lat: pt.lat, lng: pt.monotonicLng, pressure: 1013 });
      return;
    }
    pressures.push({ lat: pt.lat, lng: pt.monotonicLng, pressure });
  });

  if (pressures.length === 0) return null;
  const sample = pressures[0];
  console.log(`[Pressure] Timeline re-index: offset=${hourOffset}h, idx=${idx}, ${pressures.length} pressures, sample: pressure=${sample.pressure.toFixed(1)}`);
  return {
    pressures, bounds, cols: gridSize, rows: gridSize,
    stale: false, source: cache.model || 'GFS', hourOffset
  };
}

/** Public accessor for the pressure hourly cache */
export function getPressureHourlyCache() {
  return pressureHourlyCache;
}

// ========================================================================
// PRESSURE FETCH
// ========================================================================
export async function fetchPressureData(bounds, signal, hourOffset = 0, forceFetch = false, forecastDays = 3, model = null) {
  if (!bounds) { console.log('[Pressure] fetchPressureData: no bounds'); return lastKnownGoodPressure; }

  // Zero-API scrubbing guard: Bypasses fetches during active timeline scrubbing
  if (window.isScrubbingTimeline === true && !forceFetch) {
    console.log(`[Pressure] Timeline scrubbing active: serving cache at offset=${hourOffset}h`);
    return extractPressureAtOffset(pressureHourlyCache, hourOffset);
  }

  // Viewport containment caching hit (0ms load from memory)
  if (!forceFetch && isContainedInPressureCache(bounds, model)) {
    console.log(`[Pressure] Viewport containment HIT: zero-API pan served instantly from memory`);
    return extractPressureAtOffset(pressureHourlyCache, hourOffset);
  }

  // Inflight lock
  if (pressureRequestInFlight) {
    console.log('[Pressure] fetchPressureData: request already inflight, returning cached');
    return lastKnownGoodPressure;
  }

  // 429 cooldown check
  if (!forceFetch && isInCooldown('pressure')) {
    console.log(`[Pressure] fetchPressureData: in 429 cooldown, returning cached`);
    return lastKnownGoodPressure;
  }

  // Adjust for Antimeridian / Pacific wrap
  let west = bounds.west;
  let east = bounds.east;
  if (east < west) {
    east += 360;
  }

  // Snap bounds
  const { snap, padding } = getSnapConfig(bounds);
  const latMinRaw = Math.floor((bounds.south - padding) / snap) * snap;
  const latMaxRaw = Math.ceil((bounds.north + padding) / snap) * snap;
  const lngMin = Math.floor((west - padding) / snap) * snap;
  const lngMax = Math.ceil((east + padding) / snap) * snap;

  // Clamp requested latitudes to Open-Meteo weather API limits [-85, 85]
  const latMin = Math.max(-85, Math.min(85, latMinRaw));
  const latMax = Math.max(-85, Math.min(85, latMaxRaw));

  if (latMax <= latMin || lngMax <= lngMin) return lastKnownGoodPressure;

  const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };

  const viewHash = viewportCacheKey(snappedBounds, `pressure_${model || 'GFS'}`);
  if (pressureHourlyCache.hash === viewHash &&
      pressureHourlyCache.model === (model || 'GFS') &&
      Date.now() - pressureHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    console.log(`[Pressure] Cache HIT for offset=${hourOffset}h, model=${model || 'GFS'}`);
    return extractPressureAtOffset(pressureHourlyCache, hourOffset);
  }

  // Stale viewport fallback only if same model
  if (pressureHourlyCache.hash && pressureHourlyCache.model === (model || 'GFS') &&
      Date.now() - pressureHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractPressureAtOffset(pressureHourlyCache, hourOffset);
    if (staleData && staleData.pressures.length > 0) {
      console.log(`[Pressure] Stale cache served (viewport mismatch) ${staleData.pressures.length} pressures`);
      lastKnownGoodPressure = staleData;
    }
  }

  // Per-offset cache
  const cacheKey = viewportCacheKey(snappedBounds, `pressure_${model || 'GFS'}_h${hourOffset}`);
  if (PRESSURE_CACHE.has(cacheKey)) {
    const cached = PRESSURE_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) {
      console.log('[Pressure] Per-offset cache hit');
      return cached.data;
    }
  }

  if (pressureAbortController) pressureAbortController.abort();
  pressureAbortController = new AbortController();
  const fetchSignal = signal || pressureAbortController.signal;
  pressureRequestInFlight = true;

  try {
    const { points, gridSize, isGlobal, bounds: gridBounds } = computeGridPoints(snappedBounds, 'pressure');
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.reqLng);

    // Open-Meteo model identifiers
    const OM_MODELS = { GFS: 'gfs_seamless', EURO: 'ecmwf_ifs', ICON: 'dwd_icon' };

    console.log(`[Pressure] POST via proxy: ${points.length} grid points, forecast_days=${forecastDays}, model=${model || 'GFS'}`);

    const body = {
      latitude: lats, longitude: lons,
      hourly: ['pressure_msl'],
      forecast_days: forecastDays
    };
    if (model && OM_MODELS[model]) {
      body.models = [OM_MODELS[model]];
    }

    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'wind', body }),  // 'wind' routes to api.open-meteo.com/v1/forecast which also serves pressure_msl
        signal: fetchSignal
      });
      // v3.13: 429 = API rate limit, NOT proxy failure.
      if (res.status === 429) {
        enterCooldown('pressure');
        console.warn('[Pressure] 429 from proxy, cooldown activated (not retrying direct)');
        return lastKnownGoodPressure;
      }
      if (!res.ok) {
        throw new Error(`Proxy returned HTTP ${res.status}`);
      }
      // v3.13: React dev server returns 200 with HTML for unknown routes — detect and skip
      const pressContentType = res.headers.get('content-type') || '';
      if (!pressContentType.includes('application/json')) {
        throw new Error(`Proxy returned non-JSON content-type: ${pressContentType.substring(0, 50)}`);
      }
    } catch (proxyErr) {
      if (isLocalhost) {
        console.log('[Pressure] Proxy unavailable or error, direct API fallback:', proxyErr.message);
        res = await fetch('https://api.open-meteo.com/v1/forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: fetchSignal
        });
      } else {
        console.error('[Pressure] Proxy error, direct fallback skipped in production/dev:', proxyErr.message);
        throw proxyErr;
      }
    }

    if (!res.ok) {
      if (res.status === 429) {
        enterCooldown('pressure');
        return lastKnownGoodPressure;
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    let results = Array.isArray(json) ? json
      : (json?.hourly ? points.map(() => json) : null);
    if (!results) { console.warn('[Pressure] Unexpected API response shape'); return lastKnownGoodPressure; }

    pressureHourlyCache = {
      hash: viewHash, results, points, gridSize,
      bounds: gridBounds,
      timestamp: Date.now(),
      model: model || 'GFS',
      isGlobal
    };
    persistCache(LS_PRESSURE_KEY, pressureHourlyCache);

    const data = extractPressureAtOffset(pressureHourlyCache, hourOffset);
    if (data) {
      PRESSURE_CACHE.set(cacheKey, { data, timestamp: Date.now() });
      lastKnownGoodPressure = data;
      if (BOOTSTRAP_PRESSURE) { BOOTSTRAP_PRESSURE = false; console.log('[Pressure] BOOTSTRAP complete first valid data received'); }
      console.log(`[Pressure] Fetch success: ${data.pressures.length} pressures, ${gridSize}x${gridSize} grid, offset: ${hourOffset}h`);
      return data;
    } else {
      console.warn('[Pressure] Zero valid pressures from API');
      return lastKnownGoodPressure;
    }
  } catch (err) {
    if (err.name === 'AbortError') return lastKnownGoodPressure;
    console.error(`[Pressure] Fetch failed: ${err.message}`);
    return lastKnownGoodPressure;
  } finally {
    pressureRequestInFlight = false;
  }
}
