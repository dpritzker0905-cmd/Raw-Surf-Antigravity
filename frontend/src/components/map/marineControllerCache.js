// marineControllerCache.js
// Decomposed caching layer for marine weather data.

import {
  HOURLY_CACHE_TTL, PER_MODEL_HOUR_CACHE_TTL, persistCache, hydrateCache,
  isViewportInsideCachedBounds, findClosestHourIndex
} from './marineControllerUtils';
import {
  getBackendWeatherFlag,
  getBackendCopernicusFlag,
  getBackendIconMarineFlag,
  getSharedValidTime,
  updateDiagnostics,
  updateCopernicusDiagnostics,
  updateProjectionDiag,
  clampViewportBbox
} from './backendWeatherServiceClient';
import { recordTruthStage } from './weatherTruthTracker';
import { extractMarineAtOffset } from './marineControllerExtractor';

// --- CACHES ---
var marineHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0 };
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

export function getMarineHourlyCache() { return marineHourlyCache; }
export function setMarineHourlyCache(cache) { 
  marineHourlyCache = cache;
  persistCache(LS_MARINE_KEY, cache);
}

export function getLastKnownGoodMarine() { return lastKnownGoodMarine; }
export function setLastKnownGoodMarine(val, model = 'GFS', provider = 'open-meteo') {
  lastKnownGoodMarine = val;
  if (lastKnownGoodMarine) {
    lastKnownGoodMarineModel = model;
    lastKnownGoodMarine.__sourceModel = model;
    lastKnownGoodMarine.__provider = provider;
  }
}

export function getLastKnownGoodMarineModel() { return lastKnownGoodMarineModel; }

var _perModelHourCache = new Map();
var PER_MODEL_HOUR_CACHE_MAX = 50;

export function getPerModelHourCache() { return _perModelHourCache; }

export function estimateRequestCost(type, model, pointCount, hourlyVarCount, forecastDays) {
  if (type === 'tiles') return 50000;
  const timeBytes = forecastDays * 24 * 25;
  const varBytes = hourlyVarCount * forecastDays * 24 * 8;
  const metadataBytes = 1500;
  return pointCount * (timeBytes + varBytes + metadataBytes);
}

export function _isAllVarModel(model) {
  const m = model || 'GFS';
  if (m === 'EURO') return false;
  if (m === 'GFS' && getBackendWeatherFlag()) return false;
  if (m === 'ICON' && getBackendIconMarineFlag()) return false;
  return true;
}

export function _cacheMarineResult(model, hourOffset, data, layer) {
  if (!data) return;
  const layerPart = _isAllVarModel(model) ? 'all' : (layer || 'waves');
  const tileId = data.tile_id || data.region_id || data.grid?.region_id || 'unknown';
  const key = `${model || 'GFS'}_${layerPart}_${tileId}_${hourOffset}`;
  
  const g = data.grid || {};
  const bounds = g.bounds || {};
  const boundsStr = bounds.west !== undefined ? `${bounds.west.toFixed(2)}:${bounds.south.toFixed(2)}:${bounds.east.toFixed(2)}:${bounds.north.toFixed(2)}` : 'none';

  const signature = {
    model: model || 'GFS',
    layer: layer || 'waves',
    provider: g.__gridProvider || g.provider || 'none',
    hourOffset: hourOffset,
    boundsStr: boundsStr,
    cols: g.cols || 0,
    rows: g.rows || 0,
    vectorsLength: g.vectors?.length || 0
  };

  _perModelHourCache.set(key, { 
    data, 
    timestamp: Date.now(), 
    model: model || 'GFS',
    signature
  });

  if (model === 'GFS' && layer === 'waves' && hourOffset === 0) {
    recordTruthStage('cacheWrite', {
      model,
      domain: 'marine',
      layer,
      valid_time: data.valid_time || data.validTime,
      run_time: data.run_time || data.runTime,
      product_id: data.product_id || data.productId,
      is_dynamic_viewport_product: data.is_dynamic_viewport_product,
      coverage_scope: data.coverage_scope,
      requested_bbox: data.requested_bbox,
      served_bbox: data.served_bbox,
      grid: data.grid,
      truthTag: data.truthTag
    }, 'marineControllerCache.js', '_cacheMarineResult');
  }

  if (_perModelHourCache.size > PER_MODEL_HOUR_CACHE_MAX) {
    const oldest = [..._perModelHourCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 10; i++) _perModelHourCache.delete(oldest[i][0]);
  }
}

export function _updateDiagnosticsOnCacheHit(hitData, wantedModel, wantedHour, wantedLayer, bounds = null) {
  if (!hitData || typeof window === 'undefined') return;
  try {
    const g = hitData.grid || {};
    const isEuro = wantedModel === 'EURO';
    const validTimeStr = getSharedValidTime(wantedHour, wantedLayer, wantedModel);
    const clampRes = clampViewportBbox(bounds || g.bounds, wantedLayer, wantedModel, 'marine');
    const clampedBbox = clampRes.clampedBbox || g.bounds;

    const details = {
      url: 'cache',
      status: 200,
      validTime: validTimeStr,
      valueKind: wantedLayer === 'swell_1' ? 'swell_wave_height' : 'wave_height',
      valueUnit: 'm',
      displayUnitHint: 'none',
      elapsedMs: 0,
      error: null,
      requestedBbox: bounds || g.bounds,
      clampedBbox: clampedBbox,
      fallbackReason: null,
      hourOffset: wantedHour,
      layer: wantedLayer,
      gridVectorCount: g.vectors ? g.vectors.length : 0,
      nonzeroCount: g.nonzeroCount || 0,
      renderable: g.renderable !== false,
      provider: g.__gridProvider || g.provider || (isEuro ? 'copernicus' : 'open-meteo'),
      sourceDataset: hitData.source_dataset || null,
      sourceVariables: hitData.source_variables || null,
      is_forecast_authoritative: g.is_forecast_authoritative || false,
      is_estimated: g.is_estimated || false,
      is_test_fixture: g.is_test_fixture || false,
      gridMode: g.gridMode || 'rectangular',
      productId: g.productId || null,
      coverage_scope: g.coverage_scope || null
    };

    if (isEuro) {
      updateCopernicusDiagnostics('grid', details);
    } else {
      updateDiagnostics('grid', details, wantedModel);
    }

    const vectors = g.vectors;
    const firstVector = vectors && vectors[0] ? { lat: vectors[0].lat, lng: vectors[0].lng } : null;
    const lastVector = vectors && vectors.length > 0 ? { lat: vectors[vectors.length - 1].lat, lng: vectors[vectors.length - 1].lng } : null;
    const bboxParam = clampedBbox ? `${clampedBbox.west},${clampedBbox.south},${clampedBbox.east},${clampedBbox.north}` : null;

    updateProjectionDiag('marine', {
      activeModel: wantedModel,
      activeLayer: wantedLayer,
      requestedViewportBounds: bounds || g.bounds,
      backendRequestBbox: bboxParam,
      responseGridBounds: g.bounds,
      coverageBounds: clampRes.coverageBounds,
      cols: g.cols,
      rows: g.rows,
      vectorCount: vectors ? vectors.length : 0,
      nonzeroCount: g.nonzeroCount || 0,
      timeOffsetHours: wantedHour,
      requestedValidTime: validTimeStr,
      validTime: validTimeStr,
      firstVectorLatLng: firstVector,
      lastVectorLatLng: lastVector,
      productId: g.productId || null,
      provider: g.__gridProvider || g.provider || (isEuro ? 'copernicus' : 'open-meteo'),
      renderable: g.renderable !== false,
      clampedBbox: clampedBbox,
      selectedTileId: clampRes.selectedTileId,
      rejectedTileIds: clampRes.rejectedTileIds,
      regionId: hitData.region_id || clampRes.selectedTileId,
      tileId: hitData.tile_id || clampRes.selectedTileId,
      isEstimated: g.is_estimated || false,
      estimateBasis: g.estimate_basis || null,
      coverage_scope: g.coverage_scope || null,
      is_dynamic_viewport_product: g.is_dynamic_viewport_product || false,
      requested_bbox: g.requested_bbox || null,
      served_bbox: g.served_bbox || null,
      cache_key: g.cache_key || null,
      resolution: g.resolution || null,
      coordinate_count: g.coordinate_count || null
    });
  } catch (e) {
    console.warn('[Safe Cache] Failed to update diagnostics on cache hit:', e.message);
  }
}

export function createFallbackSafeZeroGrid(model, failureReason) {
  const m = model || 'GFS', g = { vectors: [], bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 27, rows: 27,
    __provider: 'fallback_safe_zero', __gridProvider: 'none', __renderable: false, __failureReason: failureReason };
  return { type: 'FeatureCollection', features: [], grid: g, __sourceModel: m, __provider: 'fallback_safe_zero',
    __gridProvider: 'none', __renderable: false, __failureReason: failureReason };
}

export function hasTimeCoverage(cache, hourOffset) {
  const timeArray = cache?.results?.[0]?.hourly?.time;
  if (!timeArray || timeArray.length === 0) return false;
  const targetMs = Date.now() + hourOffset * 3600000;
  const lastTimeStr = timeArray[timeArray.length - 1];
  const lastCachedMs = new Date(lastTimeStr.endsWith('Z') ? lastTimeStr : lastTimeStr + 'Z').getTime();
  return targetMs <= lastCachedMs + 2 * 3600000;
}

export function isContainedInMarineCache(bounds, model, hourOffset = 0, layer = 'waves') {
  const isGfsBackend = getBackendWeatherFlag() && (model === 'GFS' || !model);
  const isIconBackend = getBackendIconMarineFlag() && model === 'ICON';
  const isCopernicusBackend = getBackendCopernicusFlag() && model === 'EURO';
  const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

  if (isBackendActive) {
    const layerPart = _isAllVarModel(model) ? 'all' : layer;
    const clampRes = clampViewportBbox(bounds, layer, model, 'marine');
    const tileId = clampRes.selectedTileId || 'outside';
    const exact = _perModelHourCache.get(`${model || 'GFS'}_${layerPart}_${tileId}_${hourOffset}`);
    if (exact && Date.now() - exact.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
      if (exact.data?.stale || exact.data?.grid?.stale) {
        return false;
      }
      const sig = exact.signature;
      if (sig) {
        const g = exact.data?.grid || {};
        const b = g.bounds || {};
        const bStr = b.west !== undefined ? `${b.west.toFixed(2)}:${b.south.toFixed(2)}:${b.east.toFixed(2)}:${b.north.toFixed(2)}` : 'none';
        const provider = g.__gridProvider || g.provider || 'none';

        if (sig.model === (model || 'GFS') &&
            sig.layer === layer &&
            sig.provider === provider &&
            sig.hourOffset === hourOffset &&
            sig.boundsStr === bStr &&
            sig.cols === (g.cols || 0) &&
            sig.rows === (g.rows || 0) &&
            sig.vectorsLength === (g.vectors?.length || 0)) {
          return true;
        }
      }
    }

    // Fallback search: check if any cached entry in _perModelHourCache contains these bounds
    if (bounds) {
      for (const [key, entry] of _perModelHourCache.entries()) {
        if (key.startsWith(`${model || 'GFS'}_${layerPart}_`) && key.endsWith(`_${hourOffset}`) && Date.now() - entry.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
          if (entry.data?.stale || entry.data?.grid?.stale) {
            continue;
          }
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

                if (sig.model === (model || 'GFS') &&
                    sig.layer === layer &&
                    sig.provider === provider &&
                    sig.hourOffset === hourOffset &&
                    sig.boundsStr === bStr &&
                    sig.cols === (g.cols || 0) &&
                    sig.rows === (g.rows || 0) &&
                    sig.vectorsLength === (g.vectors?.length || 0)) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
    return false;
  }

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

/**
 * Checks if ANY cached entry exists for the given model/layer/viewport,
 * regardless of hourOffset. Returns the cached entry or null.
 * 
 * This is useful for determining whether the backend likely has forecast data
 * cached for this viewport (since the backend caches all hours from a single
 * upstream fetch with the same bbox).
 */
export function getAnyHourCacheEntry(model, layer, bounds) {
  const wanted = model || 'GFS';
  const layerPart = _isAllVarModel(wanted) ? 'all' : (layer || 'waves');
  const prefix = `${wanted}_${layerPart}_`;

  for (const [key, entry] of _perModelHourCache.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (Date.now() - entry.timestamp >= PER_MODEL_HOUR_CACHE_TTL) continue;
    
    if (bounds && entry.data?.grid?.bounds) {
      const g = entry.data.grid;
      const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
      const ew = bounds.west, ee = bounds.east, es = bounds.south, en = bounds.north;
      const containsLng = ge < gw 
        ? (ew >= gw || ew <= ge) && (ee >= gw || ee <= ge)
        : ew >= gw && ee <= ge;
      const containsLat = es >= gs && en <= gn;
      if (containsLng && containsLat) {
        return entry;
      }
    } else {
      return entry;
    }
  }
  return null;
}
