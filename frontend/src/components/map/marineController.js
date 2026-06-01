// marineController.js — Fetch layer for wind and marine data.
// Pressure data: marineControllerPressure.js. Shared utilities: marineControllerUtils.js.

import {
  safeNum, getUV, PROXY_URL, isLocalhost, findClosestHourIndex,
  HOURLY_CACHE_TTL, persistCache, hydrateCache,
  isInCooldown, enterCooldown, clearCooldown, logMarineRequest,
  getSnapConfig, isViewportInsideCachedBounds, viewportCacheKey, computeGridPoints
} from './marineControllerUtils';

// Re-export shared utilities for consumers that import from marineController
export { getRemainingCooldown } from './marineControllerUtils';

// Re-export pressure domain for backwards compatibility
export { fetchPressureData, extractPressureAtOffset, getPressureHourlyCache, isContainedInPressureCache } from './marineControllerPressure';

// --- CACHES ---
var MARINE_CACHE = new Map();
var WIND_CACHE = new Map();

// Hourly cache stores full API responses keyed by viewport+model+layer hash.
var windHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0, model: null };
var marineHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0 };

// --- PERSISTENT CACHE (localStorage) ---
var LS_WIND_KEY = 'rawsurf_wind_cache_v3'; // v5.5: bumped to invalidate stale direction data
var LS_MARINE_KEY = 'rawsurf_marine_cache_v9'; // v6.5: Copernicus component grid integration

// Hydrate from localStorage on module init
// v3.13: Only accept global wind caches (lngSpan > 180). Viewport-scoped
// caches cause particles to be confined to a small region.
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
var _hydratedMarine = hydrateCache(LS_MARINE_KEY);
if (_hydratedMarine) {
  // v6.1: Reject hydrated cache if provider doesn't match expected for the model.
  // Prevents stale Open-Meteo GFS/ICON cache from being used for EURO (Copernicus).
  var _hydMarineProvider = _hydratedMarine.provider || 'open-meteo';
  var _hydMarineModel = _hydratedMarine.model || 'GFS';
  // v6.3: EURO grid now comes from Open-Meteo (ecmwf_wam025), NOT Copernicus.
  // Only exact-point requests use Copernicus. So grid provider is always open-meteo.
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
var lastKnownGoodWind = _hydratedWind ? extractWindAtOffset(_hydratedWind, 0) : null;
var lastKnownGoodMarine = _hydratedMarine ? extractMarineAtOffset(_hydratedMarine, 0) : null;
var lastKnownGoodMarineModel = _hydratedMarine?.model || 'GFS';
if (lastKnownGoodMarine) lastKnownGoodMarine.__sourceModel = lastKnownGoodMarineModel;

// v7.8: Helper — GFS/ICON use all-variable cache, EURO stays layer-scoped
function _isAllVarModel(model) { return (model || 'GFS') !== 'EURO'; }

var _perModelHourCache = new Map();
var PER_MODEL_HOUR_CACHE_MAX = 50;
var PER_MODEL_HOUR_CACHE_TTL = 10 * 60 * 1000;
function _cacheMarineResult(model, hourOffset, data, layer) {
  if (!data) return;
  // v7.9: All-var models use model+hour key; EURO keeps layer-scoped
  const layerPart = _isAllVarModel(model) ? 'all' : (layer || 'waves');
  const key = `${model || 'GFS'}_${layerPart}_${hourOffset}`;
  _perModelHourCache.set(key, { data, timestamp: Date.now(), model: model || 'GFS' });
  if (_perModelHourCache.size > PER_MODEL_HOUR_CACHE_MAX) {
    const oldest = [..._perModelHourCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 10; i++) _perModelHourCache.delete(oldest[i][0]);
  }
}

/** v7.9: Per-model/layer/hour cache accessor. All-var models search by model+hour. */
function getModelSafeMarine(requestedModel, requestedHourOffset, requestedLayer) {
  const wanted = requestedModel || 'GFS';
  const wantedLayer = requestedLayer || 'waves';
  const wantedHour = requestedHourOffset !== undefined ? requestedHourOffset : 0;
  const layerPart = _isAllVarModel(wanted) ? 'all' : wantedLayer;
  const exactKey = `${wanted}_${layerPart}_${wantedHour}`;
  const exact = _perModelHourCache.get(exactKey);
  if (exact && Date.now() - exact.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
    return exact.data;
  }

  // Nearest hour within ±6h
  const prefix = `${wanted}_${layerPart}_`;
  let bestEntry = null;
  let bestDiff = Infinity;
  for (const [key, entry] of _perModelHourCache.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (Date.now() - entry.timestamp >= PER_MODEL_HOUR_CACHE_TTL) continue;
    const cachedHour = parseInt(key.substring(prefix.length), 10);
    const diff = Math.abs(cachedHour - wantedHour);
    if (diff < bestDiff && diff <= 6) { bestDiff = diff; bestEntry = entry; }
  }
  if (bestEntry) {
    const staleResult = { ...bestEntry.data };
    staleResult.__staleHour = true;
    staleResult.__originalHour = bestEntry.data.hourOffset;
    return staleResult;
  }

  // 3. Fall back to legacy single lastKnownGood (model + layer safe only)
  if (lastKnownGoodMarine) {
    const cachedModel = lastKnownGoodMarineModel || 'GFS';
    const cachedLayer = lastKnownGoodMarine?.grid?.__componentLayer || 'waves';
    if (cachedModel === wanted && cachedLayer === wantedLayer) {
      const cachedProvider = lastKnownGoodMarine.__provider || lastKnownGoodMarine?.grid?.provider || 'open-meteo';
      if (cachedProvider === 'open-meteo' || cachedProvider === 'estimated') {
        return lastKnownGoodMarine;
      }
    }
  }
  return null;
}

function createFallbackSafeZeroGrid(model, failureReason) {
  const m = model || 'GFS', g = { vectors: [], bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 27, rows: 27,
    __provider: 'fallback_safe_zero', __gridProvider: 'none', __renderable: false, __failureReason: failureReason };
  return { type: 'FeatureCollection', features: [], grid: g, __sourceModel: m, __provider: 'fallback_safe_zero',
    __gridProvider: 'none', __renderable: false, __failureReason: failureReason };
}

// --- INFLIGHT ABORT CONTROLLERS ---
var windAbortController = null;
var marinAbortController = null;

// --- INFLIGHT LOCKS ---
var windRequestInFlight = false;
var marineRequestInFlight = false;

// --- BOOTSTRAP MODE ---
// First-load safety: always accept first valid response regardless of quality
var BOOTSTRAP_WIND = true;
var BOOTSTRAP_MARINE = true;

export function isContainedInWindCache(bounds, model) {
  if (!bounds || !windHourlyCache.bounds || !windHourlyCache.results) return false;
  if (windHourlyCache.model !== (model || 'GFS')) return false;
  if (Date.now() - windHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  const isGlobalCached = !!windHourlyCache.isGlobal;
  const isGlobalViewport = Math.abs(bounds.east - bounds.west) > 180 || Math.abs(bounds.north - bounds.south) > 90;
  if (isGlobalCached !== isGlobalViewport) return false;
  return isViewportInsideCachedBounds(bounds, windHourlyCache.bounds);
}

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
  // v7.8: All-var caches serve any layer; skip layer check for GFS/ICON
  if (!_isAllVarModel(model) && (marineHourlyCache.activeLayer || 'waves') !== layer) return false;
  if (Date.now() - marineHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  if (!hasTimeCoverage(marineHourlyCache, hourOffset)) return false;
  const isGlobalCached = !!marineHourlyCache.isGlobal;
  const isGlobalViewport = Math.abs(bounds.east - bounds.west) > 180 || Math.abs(bounds.north - bounds.south) > 90;
  if (isGlobalCached !== isGlobalViewport) return false;
  return isViewportInsideCachedBounds(bounds, marineHourlyCache.bounds);
}

// ========================================================================
// EXTRACT WIND DATA AT A GIVEN HOUR OFFSET (from pre-fetched hourly cache)
// This is the critical function that eliminates timeline API calls.
// ========================================================================
function extractWindAtOffset(cache, hourOffset) {
  const { results, points, gridSize, bounds } = cache;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;

  const speedUnit = results[0]?.hourly_units?.wind_speed_10m || 'km/h';

  const vectors = [];
  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      // Always push a zero vector to maintain grid density (vectors.length === cols*rows)
      vectors.push({ lat: pt.lat, lng: pt.monotonicLng, speed: 0, direction: 0, u: 0, v: 0 });
      return;
    }
    let speed = r.hourly.wind_speed_10m?.[idx];
    const dir = r.hourly.wind_direction_10m?.[idx];
    if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) {
      vectors.push({ lat: pt.lat, lng: pt.monotonicLng, speed: 0, direction: 0, u: 0, v: 0 });
      return;
    }
    // Mathematically normalize wind speed to knots
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
  const sample = vectors[0];

  return {
    vectors, bounds, cols: gridSize, rows: gridSize,
    stale: false, source: cache.model || 'GFS', hourOffset
  };
}

/** Public accessor for the wind hourly cache (used by WeatherEngine timeline scrub) */
export function getWindHourlyCache() {
  return windHourlyCache;
}

export function getMarineHourlyCache() {
  return marineHourlyCache;
}

/** Public re-index function for timeline scrub (zero API calls) */
export { extractWindAtOffset, extractMarineAtOffset };

// ========================================================================
// WIND FETCH
// v3.9.3: Pre-fetches 72h hourly data. Timeline scrub re-indexes locally.
// Logs every decision point. Returns null explicitly on first-load failure
// so the caller (WeatherEngine) knows to retry.
// ========================================================================
export async function fetchWindData(bounds, signal, hourOffset = 0, forceFetch = false, forecastDays = 3, model = null) {
  if (!bounds) { console.log('[Wind] fetchWindData: no bounds'); return lastKnownGoodWind; }

  // Viewport containment caching hit (0ms load from memory)
  if (!forceFetch && isContainedInWindCache(bounds, model)) {
    console.log(`[Wind] Viewport containment HIT`);
    return extractWindAtOffset(windHourlyCache, hourOffset);
  }

 // Inflight lock but DON'T return null on first load, return lastKnownGood
  if (windRequestInFlight) {
    console.log('[Wind] fetchWindData: request already inflight, returning cached');
    return lastKnownGoodWind;
  }

  // 429 cooldown check (bypassable by timeline forceFetch)
  if (!forceFetch && isInCooldown('wind')) {
    console.log(`[Wind] fetchWindData: in 429 cooldown, returning cached`);
    return lastKnownGoodWind;
  }

  // Adjust for Antimeridian / Pacific wrap (ensure east is always greater than west)
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

  if (latMax <= latMin || lngMax <= lngMin) return lastKnownGoodWind;

  const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };

  // v3.9.1: Hourly cache re-index locally instead of making new API call
  // Cache key now includes model so GFS/EURO/ICON don't collide
  const viewHash = viewportCacheKey(snappedBounds, `wind_${model || 'GFS'}`);
  if (windHourlyCache.hash === viewHash &&
      windHourlyCache.model === (model || 'GFS') &&
      Date.now() - windHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    // Exact cache hit: extract data at the requested offset without API call

    return extractWindAtOffset(windHourlyCache, hourOffset);
  }

  // v3.9.5: Stale viewport fallback only if same model
  if (windHourlyCache.hash && windHourlyCache.model === (model || 'GFS') &&
      Date.now() - windHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractWindAtOffset(windHourlyCache, hourOffset);
    if (staleData && staleData.vectors.length > 0) {
      lastKnownGoodWind = staleData;
    }
  }

  // Per-offset cache (covers initial load + exact re-visits)
  const cacheKey = viewportCacheKey(snappedBounds, `wind_${model || 'GFS'}_h${hourOffset}`);
  if (WIND_CACHE.has(cacheKey)) {
    const cached = WIND_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) {
      return cached.data;
    }
  }

  if (windAbortController) windAbortController.abort();
  windAbortController = new AbortController();
  const fetchSignal = signal || windAbortController.signal;
  windRequestInFlight = true;

  try {
    const { points, gridSize, isGlobal, bounds: gridBounds } = computeGridPoints(snappedBounds);
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.reqLng);

    // Open-Meteo model identifiers
    const OM_MODELS = { GFS: 'gfs_seamless', EURO: 'ecmwf_ifs', ICON: 'dwd_icon' };



    const body = {
      latitude: lats, longitude: lons,
      wind_speed_unit: 'kn',
      hourly: ['wind_speed_10m', 'wind_direction_10m'],
      forecast_days: forecastDays
    };
    // Add explicit model parameter (enforce global GFS/EURO/ICON explicitly)
    if (model && OM_MODELS[model]) {
      body.models = [OM_MODELS[model]];
    }

    // v3.9.6: Proxy-first, direct fallback
    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'wind', body }),
        signal: fetchSignal
      });
      // v3.13: 429 = API rate limit, NOT proxy failure. Do NOT fall back to direct.
      if (res.status === 429) {
        enterCooldown('wind');
        console.warn('[Wind] 429 from proxy, cooldown activated (not retrying direct)');
        return lastKnownGoodWind;
      }
      if (!res.ok) {
        // v3.14: Check if proxy 500 wraps a rate-limit (chunk 429 → proxy 500 regression)
        if (res.status === 500) {
          try {
            const errBody = await res.clone().json();
            if (errBody?.isRateLimit || errBody?.message?.includes('429') || errBody?.statusCode === 429) {
              enterCooldown('wind');
              console.warn('[Wind] Proxy 500 wrapping rate-limit, cooldown activated');
              return lastKnownGoodWind;
            }
          } catch(e) { /* not JSON, proceed with normal error */ }
        }
        throw new Error(`Proxy returned HTTP ${res.status}`);
      }
      // v3.13: React dev server returns 200 with HTML for unknown routes — detect and skip
      const windContentType = res.headers.get('content-type') || '';
      if (!windContentType.includes('application/json')) {
        throw new Error(`Proxy returned non-JSON content-type: ${windContentType.substring(0, 50)}`);
      }
      // X-Cache header check (no-op, kept for future diagnostics)
    } catch (proxyErr) {
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

    // Cache the full hourly response for local timeline re-indexing
    windHourlyCache = {
      hash: viewHash, results, points, gridSize,
      bounds: gridBounds,
      timestamp: Date.now(),
      model: model || 'GFS',
      isGlobal
    };
    // v3.13: Only persist global wind caches to prevent viewport-scoped regression
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

function extractMarineAtOffset(cache, hourOffset, targetLayer) {
  const { results, points, gridSize, bounds } = cache;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
  // v7.3: Coverage check — reject if closest cached hour >3h from target
  if (timeArray?.[idx]) {
    const cachedMs = new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').getTime();
    if (Math.abs(cachedMs - targetMs) > 3 * 3600000) return null;
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

    // v7.7: Use explicit targetLayer if provided, otherwise fall back to cache.activeLayer
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

    // v7.3: ICON swell_2 estimated from primary swell (gwam lacks secondary_swell)
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

  if (features.length === 0) return null;

  // v7.4: Active-layer truth metadata — separate ocean mask from active component data
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

// v7.5: Auto-retry after 429 cooldown expires
var _marineRetryTimer = null, _marineRetryCount = 0, MAX_MARINE_RETRIES = 2;
function _scheduleMarineRetry(bounds, zoom, hourOffset, model, activeLayer) {
  if (_marineRetryCount >= MAX_MARINE_RETRIES) return;
  clearTimeout(_marineRetryTimer);
  const delay = getRemainingCooldown('marine') + 2000;
  _marineRetryCount++;
  _marineRetryTimer = setTimeout(() => {
    fetchMarineData(bounds, zoom, null, hourOffset, true, model, activeLayer, false).catch(() => {});
  }, delay);
}

// Centralized single-flight request registry for marine fetches
var inFlightMarineRequests = new Map();

export async function fetchMarineData(bounds, zoom, signal, hourOffset = 0, forceFetch = false, model = null, activeLayer = 'waves', isPrefetch = false) {
  if (!bounds) return getModelSafeMarine(model, hourOffset, activeLayer);

  // Viewport containment cache hit
  if (!forceFetch && isContainedInMarineCache(bounds, model, hourOffset, activeLayer)) {
    return extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
  }

  // Adjust for Pacific wrap
  let west = bounds.west, east = bounds.east;
  if (east < west) east += 360;

  // Snap bounds
  const { snap, padding } = getSnapConfig(bounds);
  let latMin = Math.max(-80, Math.min(84.5, Math.floor((bounds.south - padding) / snap) * snap));
  let latMax = Math.max(-79.5, Math.min(85, Math.ceil((bounds.north + padding) / snap) * snap));
  if (latMax <= latMin) { latMin = -80; latMax = 85; }
  const snappedBounds = { west: Math.floor((west - padding) / snap) * snap, south: latMin, east: Math.ceil((east + padding) / snap) * snap, north: latMax };

  const expectedProvider = 'open-meteo';
  // v7.8: For all-var models, cache key omits layer so one cache serves all sublayers
  const layerKey = _isAllVarModel(model) ? 'all' : (activeLayer || 'waves');
  const viewHash = viewportCacheKey(snappedBounds, `marine_${model || 'GFS'}_${layerKey}_${expectedProvider}`);

  // Check hourly cache
  if (marineHourlyCache.hash === viewHash &&
      marineHourlyCache.model === (model || 'GFS') &&
      (_isAllVarModel(model) || (marineHourlyCache.activeLayer || 'waves') === (activeLayer || 'waves')) &&
      (marineHourlyCache.provider || 'open-meteo') === expectedProvider &&
      Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL &&
      hasTimeCoverage(marineHourlyCache, hourOffset)) {
    return extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
  }

  if (marineHourlyCache.hash && marineHourlyCache.model === (model || 'GFS') &&
      (_isAllVarModel(model) || (marineHourlyCache.activeLayer || 'waves') === (activeLayer || 'waves')) &&
      (marineHourlyCache.provider || 'open-meteo') === expectedProvider &&
      Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const stale = extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
    if (stale?.features?.length) { lastKnownGoodMarine = stale; lastKnownGoodMarineModel = model || 'GFS'; lastKnownGoodMarine.__sourceModel = lastKnownGoodMarineModel; lastKnownGoodMarine.__provider = expectedProvider; }
  }

  const cacheKey = viewportCacheKey(snappedBounds, `marine_${model || 'GFS'}_${layerKey}_${expectedProvider}_h${hourOffset}`);
  const cachedResult = MARINE_CACHE.get(cacheKey);
  if (cachedResult && Date.now() - cachedResult.timestamp < 300000) return cachedResult.data;

  const requestKey = `${model || 'GFS'}_${layerKey}_${hourOffset}_${expectedProvider}_${viewHash}_${isPrefetch ? 'p' : 'l'}`;
  if (inFlightMarineRequests.has(requestKey)) return inFlightMarineRequests.get(requestKey);

  if (!forceFetch && isInCooldown('marine')) {
    return getModelSafeMarine(model, hourOffset, activeLayer);
  }

  const fetchPromise = (async () => {
    if (marinAbortController && !isPrefetch) marinAbortController.abort();
    if (!isPrefetch) marinAbortController = new AbortController();
    const fetchSignal = signal || (isPrefetch ? null : marinAbortController.signal);

    try {
      let { points, gridSize, isGlobal, bounds: gridBounds } = computeGridPoints(snappedBounds, 'marine');
      const lats = points.map(p => p.lat);
      const lons = points.map(p => p.reqLng);

      const MARINE_OM_MODELS = { GFS: 'ncep_gfswave025', ICON: 'gwam', EURO: 'ecmwf_wam025' };
      const _baseVars = ['wave_height','wave_direction','wave_period','swell_wave_height','swell_wave_direction','swell_wave_period'];
      const _swellVars = ['secondary_swell_wave_height','secondary_swell_wave_direction','secondary_swell_wave_period'];
      const _windVars = ['wind_wave_height','wind_wave_direction','wind_wave_period'];
      const MODEL_SUPPORTED_VARS = {
        'ncep_gfswave025': [..._baseVars, ..._swellVars, ..._windVars],
        'gwam': [..._baseVars, ..._windVars],
        'ecmwf_wam025': [..._baseVars, ..._swellVars, ..._windVars]
      };

      const apiModel = (model && MARINE_OM_MODELS[model]) ? MARINE_OM_MODELS[model] : 'ncep_gfswave025';
      
      const maxForecastDays = apiModel === 'ncep_gfswave025' ? 16 : apiModel === 'gwam' ? 7 : apiModel === 'ecmwf_wam025' ? 10 : 3;
      const requestedDays = isPrefetch ? maxForecastDays : hourOffset > 48 ? Math.ceil((hourOffset + 1) / 24) : 2;
      const forecastDays = Math.min(maxForecastDays, requestedDays);

      // v7.7: For GFS/ICON, request ALL supported vars to enable local remap on layer switch
      // For EURO, keep layer-scoped (Copernicus routing uses different variable sets)
      const isAllVarModel = (model !== 'EURO');
      let activeVars;
      if (isAllVarModel) {
        activeVars = [...MODEL_SUPPORTED_VARS[apiModel]];
      } else if (activeLayer === 'waves') {
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

      let marineVarList = activeVars.filter(v => MODEL_SUPPORTED_VARS[apiModel].includes(v));
      if (marineVarList.length === 0) {
        marineVarList = MODEL_SUPPORTED_VARS[apiModel].slice(0, 3);
      }
      // v7.1: Always include wave_height as ocean-mask variable (negligible payload, reliable isOcean)
      if (!marineVarList.includes('wave_height') && MODEL_SUPPORTED_VARS[apiModel].includes('wave_height')) {
        marineVarList.push('wave_height');
      }

      const body = { latitude: lats, longitude: lons, hourly: marineVarList, forecast_days: forecastDays };
      if (model && MARINE_OM_MODELS[model]) body.models = [MARINE_OM_MODELS[model]];

      const estPayloadKB = Math.round(JSON.stringify({ type: 'marine', body }).length / 1024);
      const fetchStart = Date.now();
      console.log(`[Marine] POST: ${points.length}pts × ${marineVarList.length}vars × ${forecastDays}d = ~${estPayloadKB}KB | model=${apiModel} layer=${activeLayer}`);

      let res;
      try {
        res = await fetch(PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'marine', body }),
          signal: fetchSignal
        });
        if (res.status === 429) {
          enterCooldown('marine');
          logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 429, result: 'rate_limited', elapsedMs: Date.now() - fetchStart });
          _scheduleMarineRetry(bounds, zoom, hourOffset, model, activeLayer);
          return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'rate_limited_no_cache');
        }
        if (!res.ok) {
          if (res.status === 500) {
            try {
              const err = await res.clone().json();
              if (err?.isRateLimit || err?.message?.includes('429')) {
                enterCooldown('marine');
                logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 500, upstreamStatus: 429, result: 'rate_limited', elapsedMs: Date.now() - fetchStart });
                _scheduleMarineRetry(bounds, zoom, hourOffset, model, activeLayer);
                return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'rate_limited_no_cache');
              }
            } catch(e) {}
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Non-JSON response');
      } catch (err) {
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
        if (res.status === 429) {
          enterCooldown('marine');
          logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 429, result: 'rate_limited_fallback', elapsedMs: Date.now() - fetchStart });
          _scheduleMarineRetry(bounds, zoom, hourOffset, model, activeLayer);
          return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'rate_limited');
        }
        logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: res.status, result: 'proxy_error', elapsedMs: Date.now() - fetchStart });
        return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'proxy_error');
      }

      const json = await res.json();
      let allResults = Array.isArray(json) ? json : (json?.hourly ? points.map(() => json) : null);
      if (!allResults) return getModelSafeMarine(model, hourOffset, activeLayer) || createFallbackSafeZeroGrid(model, 'invalid_shape');

      var detectedProvider = (allResults[0]?.__provider === 'copernicus') ? 'copernicus' : 'open-meteo';
      marineHourlyCache = {
        hash: viewHash, results: allResults, points, gridSize,
        bounds: gridBounds, timestamp: Date.now(),
        model: model || 'GFS', activeLayer: activeLayer || 'waves', provider: detectedProvider, isGlobal
      };
      persistCache(LS_MARINE_KEY, marineHourlyCache);

      const result = extractMarineAtOffset(marineHourlyCache, hourOffset, activeLayer);
      if (result) {
        // v7.5: Success — reset retry counter and clear cooldown
        _marineRetryCount = 0;
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
        
        // v7.10: SWR marine prefetch DISABLED — rate limits remain too risky
        if (forecastDays < maxForecastDays && !isPrefetch && !signal?.aborted) {
          console.log(`[Marine] SWR prefetch suppressed (disabled in v7.10): ${model} ${maxForecastDays}d`);
        }
        
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

