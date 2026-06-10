// windController.js — Fetch layer and reindexing for wind data.
// Extracted from marineController.js to satisfy the 800 LOC limit.

import {
  findClosestHourIndex, HOURLY_CACHE_TTL, hydrateCache,
  getSnapConfig, isViewportInsideCachedBounds
} from './marineControllerUtils';
import { getBackendWindFlag, fetchBackendWindGrid, clampViewportBbox, getSharedValidTime } from './backendWeatherServiceClient';
import { createFallbackSafeZeroGrid } from './marineControllerCache';
import { recordTruthStage } from './weatherTruthTracker';

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

// Cost estimation removed (legacy)

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
      if (hourOffset === 0) {
        recordTruthStage('cacheRead', cached.data, 'windController.js', 'fetchWindData');
      }
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
            if (hourOffset === 0) {
              recordTruthStage('cacheRead', entry.data, 'windController.js', 'fetchWindData');
            }
            return entry.data;
          }
        }
      }
    }
  }
  
  if (getBackendWindFlag() && (resolvedModel === 'GFS' || resolvedModel === 'ICON' || resolvedModel === 'EURO')) {
    try {
      console.log(`[Backend Weather Service] Redirecting ${resolvedModel} Wind grid fetch to backend Weather Data Service for hourOffset=+${hourOffset}h`);
      const result = await fetchBackendWindGrid(viewportBounds, hourOffset, signal, snappedBounds, source, resolvedModel);
      
      if (result && result.renderable) {
        WIND_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
        if (hourOffset === 0) {
          recordTruthStage('cacheWrite', result, 'windController.js', 'fetchWindData');
        }
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
        lastKnownGoodWind = result;
      }
      return result;
    } catch (err) {
      console.warn(`[Backend Weather Service] Wind grid redirect failed: ${err.message}.`);
      if (typeof window !== 'undefined' && window.__BACKEND_WIND_SERVICE_DIAG__) {
        window.__BACKEND_WIND_SERVICE_DIAG__.fallbackPath = 'none';
        window.__BACKEND_WIND_SERVICE_DIAG__.fallbackReason = err.message;
      }
    }
  }

  console.warn(`[Fallback] Backend wind redirects failed for model=${resolvedModel}, hour=${hourOffset}. Returning conformed safe zero grid.`);
  const targetBounds = viewportBounds || snappedBounds;
  if (isContainedInWindCache(targetBounds, resolvedModel)) {
    const cachedData = extractWindAtOffset(windHourlyCache, hourOffset);
    if (cachedData) {
      return cachedData;
    }
  }

  return {
    vectors: [{ lat: (targetBounds.south + targetBounds.north) / 2, lng: (targetBounds.west + targetBounds.east) / 2, speed: 0, direction: 0, u: 0, v: 0 }],
    bounds: targetBounds,
    cols: 1,
    rows: 1,
    stale: true,
    source: resolvedModel,
    hourOffset,
    renderable: false,
    nonzeroCount: 0
  };
}
