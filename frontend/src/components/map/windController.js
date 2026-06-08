// windController.js — Fetch layer and reindexing for wind data.
// Extracted from marineController.js to satisfy the 800 LOC limit.

import {
  safeNum, getUV, PROXY_URL, isLocalhost, findClosestHourIndex,
  HOURLY_CACHE_TTL, persistCache, hydrateCache,
  isInCooldown, enterCooldown, clearCooldown,
  getSnapConfig, isViewportInsideCachedBounds, viewportCacheKey, computeGridPoints
} from './marineControllerUtils';
import { governMarineRequest } from './marineRequestGovernor';
import { getBackendWindFlag, fetchBackendWindGrid, clampViewportBbox, getSharedValidTime } from './backendWeatherServiceClient';

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

  // --- WIND BACKEND SERVICE REDIRECT FOR GFS, ICON AND EURO WIND ---
  if (getBackendWindFlag() && (model === 'GFS' || model === 'ICON' || model === 'EURO' || !model)) {
    try {
      const resolvedModel = model || 'GFS';
      
      // Resolve actual viewport bounds to pass explicitly
      let viewportBounds = bounds;
      let source = "controller";
      if (bounds && Math.abs(bounds.east - bounds.west) > 180) {
        if (typeof window !== 'undefined' && window.map) {
          try {
            const b = window.map.getBounds();
            viewportBounds = {
              west: b.getWest(),
              south: Math.max(-85, b.getSouth()),
              east: b.getEast(),
              north: Math.min(85, b.getNorth())
            };
            source = "window_map";
          } catch (e) {
            source = "fallback";
          }
        } else {
          source = "fallback";
        }
      }

      // Check cache first!
      const clampResult = clampViewportBbox(viewportBounds || snappedBounds, 'wind', resolvedModel, 'wind');
      const tileId = clampResult.selectedTileId || 'outside';
      const cacheKey = `${resolvedModel}_wind_grid_${tileId}_${hourOffset}`;
      
      if (!forceFetch) {
        const cached = WIND_CACHE.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) { // 10 minutes TTL
          console.log(`[Backend Wind Cache Hit] Returning cached backend wind grid for ${resolvedModel} at hourOffset=+${hourOffset}h`);
          return cached.data;
        }

        // Check if any cached entry contains viewportBounds/snappedBounds
        const boundsToCheck = viewportBounds || snappedBounds;
        for (const [key, entry] of WIND_CACHE.entries()) {
          if (key.startsWith(`${resolvedModel}_wind_grid_`) && key.endsWith(`_${hourOffset}`) && Date.now() - entry.timestamp < 10 * 60 * 1000) {
            const g = entry.data;
            if (g?.vectors?.length > 0 && g.bounds) {
              const ew = boundsToCheck.west, ee = boundsToCheck.east, es = boundsToCheck.south, en = boundsToCheck.north;
              const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
              const containsLng = ge < gw 
                ? (ew >= gw || ew <= ge) && (ee >= gw || ee <= ge)
                : ew >= gw && ee <= ge;
              const containsLat = es >= gs && en <= gn;

              if (containsLng && containsLat) {
                console.log(`[Backend Contained Wind Cache Hit] Returning cached backend wind grid for ${resolvedModel} at hourOffset=+${hourOffset}h`);
                return entry.data;
              }
            }
          }
        }
      }
      
      console.log(`[Backend Weather Service] Redirecting ${resolvedModel} Wind grid fetch to backend Weather Data Service for hourOffset=+${hourOffset}h`);
      const result = await fetchBackendWindGrid(viewportBounds, hourOffset, signal, snappedBounds, source, resolvedModel);
      
      if (result && result.renderable) {
        WIND_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
        // Also populate windHourlyCache for timeline scrubs fallback
        windHourlyCache = {
          hash: tileId,
          results: [ { hourly: { time: [ getSharedValidTime(hourOffset, 'wind', resolvedModel) ] } } ],
          points: result.vectors.map(v => ({ lat: v.lat, reqLng: v.lng, monotonicLng: v.lng })),
          gridSize: result.cols,
          bounds: result.bounds,
          timestamp: Date.now(),
          model: resolvedModel,
          isGlobal: Math.abs(result.bounds.east - result.bounds.west) > 180
        };
      }
      return result;
    } catch (err) {
      console.warn(`[Backend Weather Service] Wind grid redirect failed: ${err.message}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
      // Expose fallback diagnostics for TRUTH INSPECTOR
      if (typeof window !== 'undefined' && window.__BACKEND_WIND_SERVICE_DIAG__) {
        window.__BACKEND_WIND_SERVICE_DIAG__.fallbackPath = 'proxy';
        window.__BACKEND_WIND_SERVICE_DIAG__.fallbackReason = err.message;
      }
    }
  }

  // --- LEGACY PATH ---
  if (!forceFetch && isContainedInWindCache(bounds, model)) return extractWindAtOffset(windHourlyCache, hourOffset);
  if (windRequestInFlight) return lastKnownGoodWind;
  if (!forceFetch && isInCooldown('wind')) return lastKnownGoodWind;

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

    // Determine if we need to batch requests to fit under proxy budget.
    // Proxy budget: 4.5MB. Cost per point: forecastDays * 984 + 1500 bytes.
    // If total exceeds budget, split points into batches and fetch in parallel.
    const PROXY_BUDGET = 4500000;
    const costPerPoint = forecastDays * (24 * 25 + 2 * 24 * 8) + 1500;
    const maxPointsPerBatch = Math.max(50, Math.floor(PROXY_BUDGET / costPerPoint));
    const needsBatching = lats.length > maxPointsPerBatch;

    const makeBody = (batchLats, batchLons) => {
      const b = {
        latitude: batchLats, longitude: batchLons,
        wind_speed_unit: 'kn',
        hourly: ['wind_speed_10m', 'wind_direction_10m'],
        forecast_days: forecastDays
      };
      if (model && OM_MODELS[model]) b.models = [OM_MODELS[model]];
      return b;
    };

    let results;

    if (!needsBatching) {
      // Single request path (fits under budget)
      const body = makeBody(lats, lons);
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
        if (!res.ok) throw new Error(`Proxy returned HTTP ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error(`Non-JSON: ${ct.substring(0, 50)}`);
        console.log('[Wind] Proxy response OK:', { status: res.status, cacheHit: res.headers.get('x-cache') || 'miss' });
      } catch (proxyErr) {
        if (proxyErr.message === 'wind_cooldown_active' || proxyErr.message === 'failure_ttl_active' || proxyErr.message === 'grid_fetch_in_flight') {
          console.warn(`[WindController] Governor blocked wind fetch: ${proxyErr.message}`);
          return lastKnownGoodWind;
        }
        console.warn(`[windController] Direct Open-Meteo fallback blocked. Error: ${proxyErr.message}`);
        throw proxyErr;
      }
      if (!res.ok) {
        if (res.status === 429) { enterCooldown('wind'); return lastKnownGoodWind; }
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      results = Array.isArray(json) ? json : (json?.hourly ? points.map(() => json) : null);
    } else {
      // Batched request path — split points, parallel fetch, merge
      const batchCount = Math.ceil(lats.length / maxPointsPerBatch);
      console.log(`[Wind] Batching ${lats.length} points into ${batchCount} requests of ~${maxPointsPerBatch} (${forecastDays}-day forecast)`);

      const batches = [];
      for (let i = 0; i < lats.length; i += maxPointsPerBatch) {
        batches.push({
          lats: lats.slice(i, i + maxPointsPerBatch),
          lons: lons.slice(i, i + maxPointsPerBatch)
        });
      }

      const batchPromises = batches.map(async (batch, idx) => {
        const body = makeBody(batch.lats, batch.lons);
        try {
          const res = await governMarineRequest({
            source: `marineController.fetchWindData.batch${idx}`,
            type: 'wind',
            body: body,
            signal: fetchSignal,
            model: model || 'GFS',
            layer: 'wind',
            category: 'grid'
          });
          if (res.status === 429) { enterCooldown('wind'); return null; }
          if (!res.ok) throw new Error(`Batch ${idx} HTTP ${res.status}`);
          const json = await res.json();
          return Array.isArray(json) ? json : (json?.hourly ? batch.lats.map(() => json) : []);
        } catch (err) {
          console.warn(`[windController] Direct Open-Meteo batch fallback blocked. Error: ${err.message}`);
          throw err;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      if (batchResults.some(r => r === null)) {
        console.warn('[Wind] Batch fetch rate-limited');
        return lastKnownGoodWind;
      }
      results = batchResults.flat();
      console.log(`[Wind] Merged ${results.length} point results from ${batchCount} batches`);
    }

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
    // Wind fallback diagnostics
    if (data && typeof window !== 'undefined' && window.__BACKEND_WIND_SERVICE_DIAG__) {
      const nonzero = data.vectors ? data.vectors.filter(v => v.speed > 0).length : 0;
      window.__BACKEND_WIND_SERVICE_DIAG__.fallbackVectorCount = data.vectors?.length || 0;
      window.__BACKEND_WIND_SERVICE_DIAG__.fallbackNonzeroCount = nonzero;
      window.__BACKEND_WIND_SERVICE_DIAG__.renderable = (data.vectors?.length || 0) > 0;
      window.__BACKEND_WIND_SERVICE_DIAG__.fallbackFirstVector = data.vectors?.[0] ? { lat: data.vectors[0].lat, lng: data.vectors[0].lng, speed: data.vectors[0].speed } : null;
    }
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
