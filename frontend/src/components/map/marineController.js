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
import {
  getBackendWeatherFlag,
  getBackendCopernicusFlag,
  getBackendIconMarineFlag,
  getBackendMarineSystemFlag,
  getSharedValidTime,
  mapNormalizedGridToWebGL,
  updateDiagnostics,
  updateCopernicusDiagnostics,
  updateProjectionDiag,
  GRID_URL,
  fetchBackendCopernicusGrid,
  fetchBackendMarineGrid,
  clampViewportBbox
} from './backendWeatherServiceClient';
import { recordTruthStage } from './weatherTruthTracker';

import {
  getMarineHourlyCache,
  setMarineHourlyCache,
  getLastKnownGoodMarine,
  setLastKnownGoodMarine,
  getLastKnownGoodMarineModel,
  getPerModelHourCache,
  estimateRequestCost,
  _isAllVarModel,
  _cacheMarineResult,
  _updateDiagnosticsOnCacheHit,
  createFallbackSafeZeroGrid,
  hasTimeCoverage,
  isContainedInMarineCache
} from './marineControllerCache';

import { extractMarineAtOffset } from './marineControllerExtractor';

export { getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getBackendMarineSystemFlag } from './backendWeatherServiceClient';

// Re-export wind controller components for timeline scrubs and observers
export { fetchWindData, getWindHourlyCache, extractWindAtOffset, isContainedInWindCache } from './windController';

// Re-export shared utilities for consumers that import from marineController
export { getRemainingCooldown } from './marineControllerUtils';

// Re-export pressure domain for backwards compatibility
export { fetchPressureData, extractPressureAtOffset, getPressureHourlyCache, isContainedInPressureCache } from './marineControllerPressure';

// Re-export cache/extractor functions for backwards compatibility and external imports
export {
  getMarineHourlyCache,
  isContainedInMarineCache,
  extractMarineAtOffset
};

// --- INFLIGHT ABORT CONTROLLERS & INFLIGHT LOCKS ---
var marinAbortController = null;
var marineRequestInFlight = false;
var BOOTSTRAP_MARINE = true;
var MARINE_CACHE = new Map();

var PER_MODEL_HOUR_CACHE_TTL = 10 * 60 * 1000;

/** getModelSafeMarine - returns safe model cached results */
export function getModelSafeMarine(requestedModel, requestedHourOffset, requestedLayer, bounds = null) {
  const wanted = requestedModel || 'GFS', wantedLayer = requestedLayer || 'waves', wantedHour = requestedHourOffset !== undefined ? requestedHourOffset : 0;
  let hitData = null, cacheSource = 'none', staleHour = false, returnedHour = null;
  const marineHourlyCache = getMarineHourlyCache();
  const cacheLayerKey = marineHourlyCache?.__layerKey || 'all';
  const isCacheMatch = cacheLayerKey === 'all' || cacheLayerKey === wantedLayer;
  
  const isGfsBackend = getBackendWeatherFlag() && (wanted === 'GFS' || !wanted);
  const isIconBackend = getBackendIconMarineFlag() && wanted === 'ICON';
  const isCopernicusBackend = getBackendCopernicusFlag() && wanted === 'EURO';
  const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

  const _perModelHourCache = getPerModelHourCache();

  if (!isBackendActive && _isAllVarModel(wanted) && marineHourlyCache?.results?.length && marineHourlyCache.model === wanted && isCacheMatch) {
    try {
      const reExtracted = extractMarineAtOffset(marineHourlyCache, wantedHour, wantedLayer);
      if (reExtracted?.grid?.vectors?.length > 0) { hitData = reExtracted; cacheSource = 'raw_hourly_cache'; }
    } catch (e) {}
  }
  if (!hitData) {
    const layerPart = _isAllVarModel(wanted) ? 'all' : wantedLayer;
    let exact = null;
    if (bounds) {
      const clampRes = clampViewportBbox(bounds, wantedLayer, wanted, 'marine');
      const tileId = clampRes.selectedTileId || 'outside';
      exact = _perModelHourCache.get(`${wanted}_${layerPart}_${tileId}_${wantedHour}`);
      if (exact && Date.now() - exact.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
        const sig = exact.signature;
        if (sig) {
          const g = exact.data?.grid || {};
          const b = g.bounds || {};
          const bStr = b.west !== undefined ? `${b.west.toFixed(2)}:${b.south.toFixed(2)}:${b.east.toFixed(2)}:${b.north.toFixed(2)}` : 'none';
          const provider = g.__gridProvider || g.provider || 'none';

          if (sig.model === wanted &&
              sig.layer === wantedLayer &&
              sig.provider === provider &&
              sig.hourOffset === wantedHour &&
              sig.boundsStr === bStr &&
              sig.cols === (g.cols || 0) &&
              sig.rows === (g.rows || 0) &&
              sig.vectorsLength === (g.vectors?.length || 0)) {
            hitData = exact.data;
            cacheSource = 'per_model_hour_cache_exact';
          }
        } else if (!isBackendActive) {
          hitData = exact.data;
          cacheSource = 'per_model_hour_cache_exact';
        }
      }

      if (!hitData) {
        // Fallback search: check if any cached entry in _perModelHourCache contains these bounds
        for (const [key, entry] of _perModelHourCache.entries()) {
          if (key.startsWith(`${wanted}_${layerPart}_`) && key.endsWith(`_${wantedHour}`) && Date.now() - entry.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
            const g = entry.data?.grid;
            if (g?.vectors?.length > 0 && g.bounds) {
              const ew = bounds.west, ee = bounds.east, es = bounds.south, en = bounds.north;
              const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
              const containsLng = ge < gw 
                ? (ew >= gw || ew <= ge) && (ee >= gw || ee <= ge)
                : ew >= gw && ee <= ge;
              const containsLat = es >= gs && en <= gn;

              if (containsLng && containsLat) {
                const sig = entry.signature;
                if (sig) {
                  const bStr = g.bounds.west !== undefined ? `${g.bounds.west.toFixed(2)}:${g.bounds.south.toFixed(2)}:${g.bounds.east.toFixed(2)}:${g.bounds.north.toFixed(2)}` : 'none';
                  const provider = g.__gridProvider || g.provider || 'none';

                  if (sig.model === wanted &&
                      sig.layer === wantedLayer &&
                      sig.provider === provider &&
                      sig.hourOffset === wantedHour &&
                      sig.boundsStr === bStr &&
                      sig.cols === (g.cols || 0) &&
                      sig.rows === (g.rows || 0) &&
                      sig.vectorsLength === (g.vectors?.length || 0)) {
                    hitData = entry.data;
                    cacheSource = 'per_model_hour_cache_contained';
                    break;
                  }
                } else if (!isBackendActive) {
                  hitData = entry.data;
                  cacheSource = 'per_model_hour_cache_contained';
                  break;
                }
              }
            }
          }
        }
      }
    } else {
      const suffix = `_${wantedHour}`;
      const prefix = `${wanted}_${layerPart}_`;
      for (const [k, v] of _perModelHourCache.entries()) {
        if (k.startsWith(prefix) && k.endsWith(suffix) && Date.now() - v.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
          const sig = v.signature;
          if (sig) {
            const g = v.data?.grid || {};
            const b = g.bounds || {};
            const bStr = b.west !== undefined ? `${b.west.toFixed(2)}:${b.south.toFixed(2)}:${b.east.toFixed(2)}:${b.north.toFixed(2)}` : 'none';
            const provider = g.__gridProvider || g.provider || 'none';

            if (sig.model === wanted &&
                sig.layer === wantedLayer &&
                sig.provider === provider &&
                sig.hourOffset === wantedHour &&
                sig.boundsStr === bStr &&
                sig.cols === (g.cols || 0) &&
                sig.rows === (g.rows || 0) &&
                sig.vectorsLength === (g.vectors?.length || 0)) {
              hitData = v.data;
              cacheSource = 'per_model_hour_cache_prefix';
              break;
            }
          } else if (!isBackendActive) {
            hitData = v.data;
            cacheSource = 'per_model_hour_cache_prefix';
            break;
          }
        }
      }
    }
  }
  if (!isBackendActive && !hitData && !_isAllVarModel(wanted)) {
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
  const lastKnownGoodMarine = getLastKnownGoodMarine();
  const lastKnownGoodMarineModel = getLastKnownGoodMarineModel();
  if (!isBackendActive && !hitData && lastKnownGoodMarine && (lastKnownGoodMarineModel || 'GFS') === wanted && (lastKnownGoodMarine?.grid?.__componentLayer || 'waves') === wantedLayer) {
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

    if (hitData && typeof window !== 'undefined') {
      _updateDiagnosticsOnCacheHit(hitData, wanted, returnedHour, wantedLayer, bounds);
    }
  }
  if (hitData && wanted === 'GFS' && wantedLayer === 'waves' && wantedHour === 0) {
    const timeArray = hitData.results?.[0]?.hourly?.time;
    const targetMs = Date.now() + wantedHour * 3600000;
    const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
    const validTimeStr = timeArray?.[idx]
      ? new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').toISOString().replace(/\.\d{3}/, '')
      : new Date().toISOString().replace(/\.\d{3}/, '');

    const extractedSlice = extractMarineAtOffset(hitData, wantedHour, wantedLayer);

    recordTruthStage('cacheRead', {
      model: wanted,
      domain: 'marine',
      layer: wantedLayer,
      valid_time: validTimeStr,
      run_time: hitData.run_time || hitData.runTime,
      product_id: hitData.product_id || hitData.productId,
      is_dynamic_viewport_product: hitData.is_dynamic_viewport_product || hitData.grid?.is_dynamic_viewport_product,
      coverage_scope: hitData.coverage_scope || hitData.grid?.coverage_scope,
      requested_bbox: hitData.requested_bbox || hitData.grid?.requested_bbox,
      served_bbox: hitData.served_bbox || hitData.grid?.served_bbox,
      grid: extractedSlice?.grid,
      truthTag: hitData.truthTag || hitData.grid?.truthTag
    }, 'marineController.js', 'getModelSafeMarine');
  }

  return hitData;
}

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

  const isGfsBackend = getBackendWeatherFlag() && (model === 'GFS' || !model);
  const isIconBackend = getBackendIconMarineFlag() && model === 'ICON';
  const isCopernicusBackend = getBackendCopernicusFlag() && model === 'EURO';
  const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

  const clampRes = clampViewportBbox(bounds, activeLayer, model, 'marine');
  const resolvedBounds = clampRes.isInside && clampRes.clampedBbox ? clampRes.clampedBbox : bounds;

  const _perModelHourCache = getPerModelHourCache();

  if (!forceFetch && isBackendActive) {
    const layerPart = _isAllVarModel(model) ? 'all' : activeLayer;
    const tileId = clampRes.selectedTileId || 'outside';
    const exact = _perModelHourCache.get(`${model || 'GFS'}_${layerPart}_${tileId}_${hourOffset}`);
    if (exact && Date.now() - exact.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
      const sig = exact.signature;
      if (sig) {
        const g = exact.data?.grid || {};
        const b = g.bounds || {};
        const bStr = b.west !== undefined ? `${b.west.toFixed(2)}:${b.south.toFixed(2)}:${b.east.toFixed(2)}:${b.north.toFixed(2)}` : 'none';
        const provider = g.__gridProvider || g.provider || 'none';

        if (sig.model === (model || 'GFS') &&
            sig.layer === activeLayer &&
            sig.provider === provider &&
            sig.hourOffset === hourOffset &&
            sig.boundsStr === bStr &&
            sig.cols === (g.cols || 0) &&
            sig.rows === (g.rows || 0) &&
            sig.vectorsLength === (g.vectors?.length || 0)) {
          console.log(`[Backend Cache Hit] Returning cached backend grid for ${model || 'GFS'} ${activeLayer} at hourOffset=+${hourOffset}h`);
          _updateDiagnosticsOnCacheHit(exact.data, model || 'GFS', hourOffset, activeLayer, bounds);
          return exact.data;
        }
      }
    }

    // Fallback: check if any cached entry contains resolvedBounds
    for (const [key, entry] of _perModelHourCache.entries()) {
      if (key.startsWith(`${model || 'GFS'}_${layerPart}_`) && key.endsWith(`_${hourOffset}`) && Date.now() - entry.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
        const g = entry.data?.grid;
        if (g?.vectors?.length > 0 && g.bounds) {
          const ew = resolvedBounds.west, ee = resolvedBounds.east, es = resolvedBounds.south, en = resolvedBounds.north;
          const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
          const containsLng = ge < gw 
            ? (ew >= gw || ew <= ge) && (ee >= gw || ee <= ge)
            : ew >= gw && ee <= ge;
          const containsLat = es >= gs && en <= gn;

          if (containsLng && containsLat) {
            const sig = entry.signature;
            if (sig) {
              const bStr = g.bounds.west !== undefined ? `${g.bounds.west.toFixed(2)}:${g.bounds.south.toFixed(2)}:${g.bounds.east.toFixed(2)}:${g.bounds.north.toFixed(2)}` : 'none';
              const provider = g.__gridProvider || g.provider || 'none';

              if (sig.model === (model || 'GFS') &&
                  sig.layer === activeLayer &&
                  sig.provider === provider &&
                  sig.hourOffset === hourOffset &&
                  sig.boundsStr === bStr &&
                  sig.cols === (g.cols || 0) &&
                  sig.rows === (g.rows || 0) &&
                  sig.vectorsLength === (g.vectors?.length || 0)) {
                console.log(`[Backend Contained Cache Hit] Returning cached backend grid for ${model || 'GFS'} ${activeLayer} at hourOffset=+${hourOffset}h`);
                _updateDiagnosticsOnCacheHit(entry.data, model || 'GFS', hourOffset, activeLayer, bounds);
                return entry.data;
              }
            }
          }
        }
      }
    }
  }

  // --- GFS BACKEND SERVICE REDIRECT ---
  if (getBackendWeatherFlag() && (model === 'GFS' || !model) && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves')) {
    try {
      console.log(`[Backend Weather Service] Redirecting GFS ${activeLayer} grid fetch to backend Weather Data Service for hourOffset=+${hourOffset}h`);
      const result = await fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, activeLayer);
      _cacheMarineResult('GFS', hourOffset, result, activeLayer);
      return result;
    } catch (err) {
      // All backend errors (including no_backend_coverage after redeploy) fall through to legacy Open-Meteo
      console.warn(`[Backend Weather Service] Grid redirect failed for GFS ${activeLayer}: ${err.message}. Falling back to legacy Open-Meteo proxy pipeline.`);
    }
  }

  // --- COPERNICUS BACKEND SERVICE REDIRECT ---
  if (getBackendCopernicusFlag() && model === 'EURO' && (activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves' || activeLayer === 'waves')) {
    try {
      console.log(`[Backend Weather Service] Redirecting Copernicus ${activeLayer} grid fetch to backend Weather Data Service for hourOffset=+${hourOffset}h`);
      const result = await fetchBackendCopernicusGrid(bounds, hourOffset, signal, snappedBounds, "controller", activeLayer);
      _cacheMarineResult('EURO', hourOffset, result, activeLayer);
      return result;
    } catch (err) {
      // All backend errors (including no_copernicus_coverage after redeploy) fall through to legacy Open-Meteo
      console.warn(`[Backend Weather Service] Grid redirect failed for Copernicus ${activeLayer}: ${err.message}. Falling back to legacy Open-Meteo proxy pipeline.`);
    }
  }

  // --- ICON BACKEND SERVICE REDIRECT ---
  if (getBackendIconMarineFlag() && model === 'ICON' && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves')) {
    try {
      console.log(`[Backend Weather Service] Redirecting ICON ${activeLayer} grid fetch to backend Weather Data Service for hourOffset=+${hourOffset}h`);
      const result = await fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, activeLayer, 'ICON');
      _cacheMarineResult('ICON', hourOffset, result, activeLayer);
      return result;
    } catch (err) {
      // All backend errors (including no_backend_coverage after redeploy) fall through to legacy Open-Meteo
      console.warn(`[Backend Weather Service] Grid redirect failed for ICON ${activeLayer}: ${err.message}. Falling back to legacy Open-Meteo proxy pipeline.`);
    }
  }

  console.warn(`[Fallback] Using legacy Open-Meteo proxy pipeline for model=${model || 'GFS'}, layer=${activeLayer || 'waves'}, hour=${hourOffset}`);
  const gridPointsRes = computeGridPoints(snappedBounds, 'marine');
  const points = gridPointsRes.points;
  let gridSize = gridPointsRes.gridSize;
  const isGlobal = gridPointsRes.isGlobal;
  const gridBounds = gridPointsRes.bounds;
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

  const marineHourlyCache = getMarineHourlyCache();

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
    if (stale?.features?.length) {
      setLastKnownGoodMarine(stale, model || 'GFS', expectedProvider);
    }
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
      return extractMarineAtOffset(getMarineHourlyCache(), hourOffset, activeLayer);
    } catch (e) {
      return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'inflight_failed');
    }
  }

  if (inFlightMarineRequests.has(requestKey)) {
    try {
      await inFlightMarineRequests.get(requestKey);
      return extractMarineAtOffset(getMarineHourlyCache(), hourOffset, activeLayer);
    } catch (e) {
      return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'inflight_failed');
    }
  }

  if (!forceFetch && isInCooldown('marine')) {
    return getModelSafeMarine(model, hourOffset, activeLayer, bounds);
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
          return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'rate_limited_no_cache');
        }
        if (!res.ok) {
          if (res.status === 500) {
            try {
              const err = await res.clone().json();
              if (err?.isRateLimit || err?.message?.includes('429')) {
                enterCooldown('marine');
                logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 500, upstreamStatus: 429, result: 'rate_limited', elapsedMs: Date.now() - fetchStart });
                return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'rate_limited_no_cache');
              }
            } catch(e) {}
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Non-JSON response');
      } catch (err) {
        if (err.message === 'cooldown_active' || err.message === 'failure_ttl_active' || err.message === 'grid_fetch_in_flight') {
          return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'rate_limited');
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
        let reason = 'proxy_error';
        if (res.status === 404) {
          try {
            const errJson = await res.json();
            if (errJson && errJson.reason) {
              reason = errJson.reason;
            }
          } catch (e) {}
        }
        if (res.status === 413) {
          if (typeof window !== 'undefined') {
            window.__MARINE_HEATMAP_STATUS__ = { status: 'payload_too_large', model, layer: activeLayer, hour: hourOffset };
          }
          return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'payload_too_large');
        }
        if (res.status === 429) {
          enterCooldown('marine');
          logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 429, result: 'rate_limited_fallback', elapsedMs: Date.now() - fetchStart });
          return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'rate_limited');
        }
        logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset, pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: res.status, result: reason, elapsedMs: Date.now() - fetchStart });
        return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, reason);
      }

      const json = await res.json();
      let allResults = Array.isArray(json) ? json : (json?.hourly ? points.map(() => json) : null);
      if (!allResults) return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'invalid_shape');

      const timeArray = allResults[0]?.hourly?.time;
      const validTimesCount = timeArray ? timeArray.length : 0;
      const coverageStartMs = timeArray && timeArray[0] ? new Date(timeArray[0].endsWith('Z') ? timeArray[0] : timeArray[0] + 'Z').getTime() : Date.now();
      const coverageEndMs = timeArray && timeArray[timeArray.length - 1] ? new Date(timeArray[timeArray.length - 1].endsWith('Z') ? timeArray[timeArray.length - 1] : timeArray[timeArray.length - 1] + 'Z').getTime() : Date.now();

      var detectedProvider = (allResults[0]?.__provider === 'copernicus') ? 'copernicus' : 'open-meteo';
      
      const newCache = {
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
      setMarineHourlyCache(newCache);

      const result = extractMarineAtOffset(newCache, hourOffset, activeLayer);
      if (result) {
        clearCooldown('marine');
        logMarineRequest({ source: 'grid', model: model || 'GFS', layer: activeLayer, hour: hourOffset,
          pointCount: points.length, variables: marineVarList.length, forecastDays, proxyStatus: 200,
          provider: detectedProvider, cacheHit: false, result: 'success',
          elapsedMs: Date.now() - fetchStart, renderable: result?.grid?.__renderable });
        MARINE_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
        setLastKnownGoodMarine(result, model || 'GFS', detectedProvider);
        _cacheMarineResult(model || 'GFS', hourOffset, result, activeLayer);
        if (BOOTSTRAP_MARINE) { BOOTSTRAP_MARINE = false; }
        return result;
      }
      return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'empty_vectors');
    } catch (err) {
      if (err.name === 'AbortError') return getModelSafeMarine(model, hourOffset, activeLayer, bounds);
      return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, 'fetch_exception');
    } finally {
      inFlightMarineRequests.delete(requestKey);
    }
  })();

  inFlightMarineRequests.set(requestKey, fetchPromise);
  return fetchPromise;
}
