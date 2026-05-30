/**
 * marineController.js v3.0.0
 *
 * Authoritative fetch layer for wind and marine data.
 * Conforms to the Marine Engine v3 runtime contract.
 *
 * RULES:
 * - NO mock data injection in production
 * - Viewport-based fetching ONLY
 * - 429 cooldown protection (120s)
 * - AbortController for inflight cancellation
 * - Cache-first architecture
 * - Last valid field preservation on failure
 *
 * Pressure data has been extracted to marineControllerPressure.js.
 * Shared utilities live in marineControllerUtils.js.
 */

import {
  safeNum, getUV, PROXY_URL, isLocalhost, findClosestHourIndex,
  HOURLY_CACHE_TTL, persistCache, hydrateCache,
  isInCooldown, enterCooldown,
  getSnapConfig, isViewportInsideCachedBounds, viewportCacheKey, computeGridPoints
} from './marineControllerUtils';

// Re-export shared utilities for consumers that import from marineController
export { getRemainingCooldown } from './marineControllerUtils';

// Re-export pressure domain for backwards compatibility
export { fetchPressureData, extractPressureAtOffset, getPressureHourlyCache, isContainedInPressureCache } from './marineControllerPressure';

// --- CACHES ---
var MARINE_CACHE = new Map();
var WIND_CACHE = new Map();

// --- HOURLY DATA CACHE (pre-fetched for timeline scrub) ---
// Stores full API responses keyed by viewport hash so timeline
// changes re-index locally instead of making new API calls.
var windHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0, model: null };
var marineHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0 };

// --- PERSISTENT CACHE (localStorage) ---
var LS_WIND_KEY = 'rawsurf_wind_cache_v3'; // v5.5: bumped to invalidate stale direction data
var LS_MARINE_KEY = 'rawsurf_marine_cache_v5'; // v6.1: bumped to invalidate caches lacking provider guard

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
  var _expectedProvider = (_hydMarineModel === 'EURO') ? 'copernicus' : 'open-meteo';
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
// Pre-populated from localStorage hydrated cache if available
var lastKnownGoodWind = _hydratedWind ? extractWindAtOffset(_hydratedWind, 0) : null;
var lastKnownGoodMarine = _hydratedMarine ? extractMarineAtOffset(_hydratedMarine, 0) : null;
// v5.9.3: Tag lastKnownGood with its source model to prevent cross-model leaks
var lastKnownGoodMarineModel = _hydratedMarine?.model || 'GFS';
if (lastKnownGoodMarine) lastKnownGoodMarine.__sourceModel = lastKnownGoodMarineModel;
if (lastKnownGoodWind) console.log(`[Wind] Pre-populated lastKnownGood: ${lastKnownGoodWind.vectors.length} vectors`);
if (lastKnownGoodMarine) console.log(`[Marine] Pre-populated lastKnownGood: ${lastKnownGoodMarine.features?.length} features, model=${lastKnownGoodMarineModel}`);

/**
 * v5.9.3: Model-safe accessor for lastKnownGoodMarine.
 * Returns null if the cached data is from a different model,
 * preventing GFS component data from being served as EURO.
 */
function getModelSafeMarine(requestedModel) {
  if (!lastKnownGoodMarine) return null;
  const cachedModel = lastKnownGoodMarineModel || 'GFS';
  const wanted = requestedModel || 'GFS';
  if (cachedModel !== wanted) {
    console.log(`[Marine] lastKnownGood model mismatch: cached=${cachedModel}, wanted=${wanted} — returning null`);
    return null;
  }
  return lastKnownGoodMarine;
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

export function isContainedInMarineCache(bounds, model) {
  if (!bounds || !marineHourlyCache.bounds || !marineHourlyCache.results) return false;
  if (marineHourlyCache.model !== (model || 'GFS')) return false;
  if (Date.now() - marineHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
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
  console.log(`[Wind] Timeline re-index: offset=${hourOffset}h, idx=${idx}, ${vectors.length} vectors, sample: speed=${sample.speed.toFixed(1)}`);
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
    console.log(`[Wind] Viewport containment HIT: zero-API pan served instantly from memory`);
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
    console.log(`[Wind] Cache HIT for offset=${hourOffset}h, model=${model || 'GFS'}`);
    return extractWindAtOffset(windHourlyCache, hourOffset);
  }

  // v3.9.5: Stale viewport fallback only if same model
  if (windHourlyCache.hash && windHourlyCache.model === (model || 'GFS') &&
      Date.now() - windHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractWindAtOffset(windHourlyCache, hourOffset);
    if (staleData && staleData.vectors.length > 0) {
      console.log(`[Wind] Stale cache served (viewport mismatch) ${staleData.vectors.length} vectors`);
      lastKnownGoodWind = staleData;
    }
  }

  // Per-offset cache (covers initial load + exact re-visits)
  const cacheKey = viewportCacheKey(snappedBounds, `wind_${model || 'GFS'}_h${hourOffset}`);
  if (WIND_CACHE.has(cacheKey)) {
    const cached = WIND_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) {
      console.log('[Wind] Per-offset cache hit');
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

    console.log(`[Wind] POST via proxy: ${points.length} grid points, forecast_days=${forecastDays}, model=${model || 'GFS'}`);

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
      if (res.headers.get('X-Cache') === 'HIT') {
        console.log(`[Wind] Proxy cache HIT (age: ${res.headers.get('X-Cache-Age')}s)`);
      }
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
 if (BOOTSTRAP_WIND) { BOOTSTRAP_WIND = false; console.log('[Wind] BOOTSTRAP complete first valid data received'); }
      console.log(`[Wind] Fetch success: ${data.vectors.length} vectors, ${gridSize}x${gridSize} grid, offset: ${hourOffset}h`);
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

// ========================================================================
// EXTRACT MARINE DATA AT A GIVEN HOUR OFFSET (from pre-fetched hourly cache)
// ========================================================================
function extractMarineAtOffset(cache, hourOffset) {
  const { results, points, gridSize, bounds } = cache;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;

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
    // v5.9.2: No EURO synthesis — unsupported components stay at 0, not faked from wave_*
    const s1_h = safeNum(c.swell_wave_height != null ? c.swell_wave_height : 0), 
          s1_d = safeNum(c.swell_wave_direction != null ? c.swell_wave_direction : 0);
    const s2_h = safeNum(c.secondary_swell_wave_height != null ? c.secondary_swell_wave_height : 0), 
          s2_d = safeNum(c.secondary_swell_wave_direction != null ? c.secondary_swell_wave_direction : 0);
    const ww_h = safeNum(c.wind_wave_height != null ? c.wind_wave_height : 0), 
          ww_d = safeNum(c.wind_wave_direction != null ? c.wind_wave_direction : 0);

    const w_h_raw = r.hourly.wave_height?.[idx];
    const isOcean = (w_h_raw !== null && w_h_raw !== undefined);

    if (w_h === 0 && s1_h === 0 && ww_h === 0) {
      gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0, period: 0 }, swell_1: { u: 0, v: 0, speed: 0, period: 0 },
        swell_2: { u: 0, v: 0, speed: 0, period: 0 }, wind_waves: { u: 0, v: 0, speed: 0, period: 0 },
        isOcean });
      return;
    }

    gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
      waves: { ...getUV(w_h, w_d), period: safeNum(c.wave_period) },
      swell_1: { ...getUV(s1_h, s1_d), period: safeNum(c.swell_wave_period != null ? c.swell_wave_period : 0) },
      swell_2: { ...getUV(s2_h, s2_d), period: safeNum(c.secondary_swell_wave_period != null ? c.secondary_swell_wave_period : 0) },
      wind_waves: { ...getUV(ww_h, ww_d), period: safeNum(c.wind_wave_period != null ? c.wind_wave_period : 0) },
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

  // v6.1: Propagate provider and source model to grid for infobox/WebGL verification
  const provider = cache.provider || 'open-meteo';
  return {
    type: 'FeatureCollection', features,
    grid: { vectors: gridVectors, bounds, cols: gridSize, rows: gridSize, timestamp: Date.now(),
            __sourceModel: activeModel, __provider: provider, provider: provider }
  };
}

// ========================================================================
// MARINE FETCH
// v3.9.1: Pre-fetches 72h hourly data. Timeline scrub re-indexes locally.
// ========================================================================
export async function fetchMarineData(bounds, zoom, signal, hourOffset = 0, forceFetch = false, model = null) {
  if (!bounds) return getModelSafeMarine(model);

  // Viewport containment caching hit (0ms load from memory)
  if (!forceFetch && isContainedInMarineCache(bounds, model)) {
    console.log(`[Marine] Viewport containment HIT: zero-API pan served instantly from memory`);
    return extractMarineAtOffset(marineHourlyCache, hourOffset);
  }

  if (marineRequestInFlight) {
    console.log('[Marine] fetchMarineData: request inflight, returning cached');
    return getModelSafeMarine(model);
  }
  if (!forceFetch && isInCooldown('marine')) {
    console.log('[Marine] fetchMarineData: in cooldown, returning cached');
    return getModelSafeMarine(model);
  }

  // Adjust for Antimeridian / Pacific wrap (ensure east is always greater than west)
  let west = bounds.west;
  let east = bounds.east;
  if (east < west) {
    east += 360;
  }

  // Snap bounds dynamically
  const { snap, padding } = getSnapConfig(bounds);
  const latMinRaw = Math.floor((bounds.south - padding) / snap) * snap;
  const latMaxRaw = Math.ceil((bounds.north + padding) / snap) * snap;
  const lngMin = Math.floor((west - padding) / snap) * snap;
  const lngMax = Math.ceil((east + padding) / snap) * snap;

  // Clamp requested latitudes to Open-Meteo marine API limits [-80, 85]
  // v4.1: Extended north to 85° for Norwegian/Barents Sea coverage. GFS Wave has data up to ~77.5°N;
  // points above return null which isOcean=false handles. South stays at -80 (Antarctic ice shelf).
  let latMin = Math.max(-80, Math.min(84.5, latMinRaw));
  let latMax = Math.max(-79.5, Math.min(85, latMaxRaw));
  if (latMax <= latMin) {
    latMin = -80;
    latMax = 85;
  }

  if (lngMax <= lngMin) return getModelSafeMarine(model);

  const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };

  // v3.9.3: Hourly cache re-index locally snaped to active model to avoid collisions
  const viewHash = viewportCacheKey(snappedBounds, `marine_${model || 'GFS'}`);
  if (marineHourlyCache.hash === viewHash &&
      marineHourlyCache.model === (model || 'GFS') &&
      Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    console.log(`[Marine] Cache HIT for offset=${hourOffset}h, model=${model || 'GFS'}`);
    return extractMarineAtOffset(marineHourlyCache, hourOffset);
  }

  // v3.9.5: Stale viewport fallback for marine snap to model
  if (marineHourlyCache.hash && marineHourlyCache.model === (model || 'GFS') &&
      Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractMarineAtOffset(marineHourlyCache, hourOffset);
    if (staleData && staleData.features?.length > 0) {
      console.log(`[Marine] Stale cache served (viewport mismatch) ${staleData.features.length} features`);
      lastKnownGoodMarine = staleData;
      lastKnownGoodMarineModel = model || 'GFS';
      lastKnownGoodMarine.__sourceModel = lastKnownGoodMarineModel;
    }
  }

  // Per-offset cache
  const cacheKey = viewportCacheKey(snappedBounds, `marine_${model || 'GFS'}_h${hourOffset}`);
  if (MARINE_CACHE.has(cacheKey)) {
    const cached = MARINE_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) return cached.data;
  }

  if (marinAbortController) marinAbortController.abort();
  marinAbortController = new AbortController();
  const fetchSignal = signal || marinAbortController.signal;
  marineRequestInFlight = true;

  try {
    let { points, gridSize, isGlobal, bounds: gridBounds } = computeGridPoints(snappedBounds, 'marine');
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.reqLng);

    // Open-Meteo model identifiers for Marine: GFS maps to ncep_gfswave025, ICON maps to gwam, EURO maps to ecmwf_wam025
    const MARINE_OM_MODELS = { GFS: 'ncep_gfswave025', ICON: 'gwam', EURO: 'ecmwf_wam025' };

    // Authoritative mapping of supported marine variables per model to prevent 400s and minimize payload
    const MODEL_SUPPORTED_VARS = {
      'ncep_gfswave025': [
        'wave_height', 'wave_direction', 'wave_period',
        'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
        'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
        'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
      ],
      'gwam': [
        'wave_height', 'wave_direction', 'wave_period',
        'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
        'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
      ],
      'ecmwf_wam025': [
        'wave_height', 'wave_direction', 'wave_period',
        'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
        'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
        'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
      ]
    };

    const apiModel = (model && MARINE_OM_MODELS[model]) ? MARINE_OM_MODELS[model] : 'ncep_gfswave025';
    const marineVarList = MODEL_SUPPORTED_VARS[apiModel] || MODEL_SUPPORTED_VARS['ncep_gfswave025'];
    const body = { latitude: lats, longitude: lons, hourly: marineVarList, forecast_days: 3 };

    if (model && MARINE_OM_MODELS[model]) {
      body.models = [MARINE_OM_MODELS[model]];
    }

    // Determine proxy type: EURO uses Copernicus Marine backend, others use Open-Meteo
    const proxyType = (model === 'EURO') ? 'copernicus_marine' : 'marine';

    // v3.9.6: Proxy-first, direct fallback
    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: proxyType, body }),
        signal: fetchSignal
      });
      // v3.13: 429 = API rate limit, NOT proxy failure. Do NOT fall back to direct.
      if (res.status === 429) {
        enterCooldown('marine');
        console.warn('[Marine] 429 from proxy, cooldown activated (not retrying direct)');
        return getModelSafeMarine(model);
      }
      if (!res.ok) {
        // v3.14: Check if proxy 500 wraps a rate-limit (chunk 429 → proxy 500 regression)
        if (res.status === 500) {
          try {
            const errBody = await res.clone().json();
            if (errBody?.isRateLimit || errBody?.message?.includes('429') || errBody?.statusCode === 429) {
              enterCooldown('marine');
              console.warn('[Marine] Proxy 500 wrapping rate-limit, cooldown activated');
              return getModelSafeMarine(model);
            }
          } catch(e) { /* not JSON, proceed with normal error */ }
        }
        throw new Error(`Proxy returned HTTP ${res.status}`);
      }
      // v3.13: React dev server returns 200 with HTML for unknown routes — detect and skip
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Proxy returned non-JSON content-type: ${contentType.substring(0, 50)}`);
      }
      if (res.headers.get('X-Cache') === 'HIT') {
        console.log(`[Marine] Proxy cache HIT (age: ${res.headers.get('X-Cache-Age')}s)`);
      }
    } catch (proxyErr) {
      if (isLocalhost) {
        console.log('[Marine] Proxy unavailable or error, direct API fallback:', proxyErr.message);
        // v3.13: Use GET with comma-separated params instead of POST bulk.
        // OpenMeteo's free tier rate-limits POST heavily. GET is more lenient.
        // Reduce grid to 6x6=36 points to stay well under rate limits.
        const reducedGrid = 6;
        const latStepReduced = (snappedBounds.north - snappedBounds.south) / reducedGrid;
        const lngStepReduced = (snappedBounds.east - snappedBounds.west) / reducedGrid;
        const reducedLats = [];
        const reducedLons = [];
        for (let yi = 0; yi <= reducedGrid; yi++) {
          for (let xi = 0; xi <= reducedGrid; xi++) {
            let lat = snappedBounds.south + yi * latStepReduced;
            let lng = snappedBounds.west + xi * lngStepReduced;
            while (lng >= 180) lng -= 360;
            while (lng < -180) lng += 360;
            reducedLats.push(lat.toFixed(2));
            reducedLons.push(lng.toFixed(2));
          }
        }
        const getUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${reducedLats.join(',')}&longitude=${reducedLons.join(',')}&hourly=${marineVarList.join(',')}&forecast_days=3${(model && MARINE_OM_MODELS[model]) ? '&models=' + MARINE_OM_MODELS[model] : ''}`;
        res = await fetch(getUrl, { signal: fetchSignal });
        // If GET succeeded, update grid metrics so downstream uses the reduced grid
        if (res.ok) {
          const reducedPoints = [];
          for (let yi = 0; yi <= reducedGrid; yi++) {
            for (let xi = 0; xi <= reducedGrid; xi++) {
              let lat = snappedBounds.south + yi * latStepReduced;
              let lng = snappedBounds.west + xi * lngStepReduced;
              let reqLng = lng;
              while (reqLng >= 180) reqLng -= 360;
              while (reqLng < -180) reqLng += 360;
              reducedPoints.push({ lat: +lat.toFixed(2), reqLng: +reqLng.toFixed(2), monotonicLng: +lng.toFixed(2) });
            }
          }
          // Override points and gridSize for the reduced grid
          points.length = 0;
          reducedPoints.forEach(p => points.push(p));
          gridSize = reducedGrid + 1;
        }
      } else {
        console.error('[Marine] Proxy error, direct fallback skipped in production/dev:', proxyErr.message);
        throw proxyErr;
      }
    }

    if (!res.ok) {
      if (res.status === 429) { enterCooldown('marine'); return getModelSafeMarine(model); }
      console.error(`[Marine] Fetch failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    let allResults = Array.isArray(data) ? data
      : (data?.hourly ? points.map(() => data) : null);
    if (!allResults) { console.warn('[Marine] Unexpected API response shape'); return getModelSafeMarine(model); }

    // Cache full hourly response
    // v6.0: Detect provider from API response (__provider tag set by Copernicus Marine backend)
    var detectedProvider = (allResults[0]?.__provider === 'copernicus') ? 'copernicus' : 'open-meteo';
    marineHourlyCache = {
      hash: viewHash, results: allResults, points, gridSize,
      bounds: gridBounds, timestamp: Date.now(),
      model: model || 'GFS',
      provider: detectedProvider,
      isGlobal
    };
    persistCache(LS_MARINE_KEY, marineHourlyCache);

    const result = extractMarineAtOffset(marineHourlyCache, hourOffset);
    if (result) {
      MARINE_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
      lastKnownGoodMarine = result;
      lastKnownGoodMarineModel = model || 'GFS';
      lastKnownGoodMarine.__sourceModel = lastKnownGoodMarineModel;
 if (BOOTSTRAP_MARINE) { BOOTSTRAP_MARINE = false; console.log('[Marine] BOOTSTRAP complete first valid data received'); }
      console.log(`[Marine] Fetch success: ${result.features.length} features, ${gridSize}x${gridSize} grid`);
      return result;
    } else {
      console.warn('[Marine] Zero valid features from API');
      return getModelSafeMarine(model);
    }
  } catch (err) {
    if (err.name === 'AbortError') return getModelSafeMarine(model);
    console.error(`[Marine] Fetch failed: ${err.message}`);
    return getModelSafeMarine(model);
  } finally {
    marineRequestInFlight = false;
  }
}
