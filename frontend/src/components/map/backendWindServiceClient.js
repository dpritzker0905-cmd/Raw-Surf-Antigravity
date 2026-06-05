/**
 * backendWindServiceClient.js
 * 
 * Dedicated client adapter for wind forecast layers.
 */

import { BACKEND_URL } from '../../lib/apiClient';
import {
  GRID_URL,
  POINT_URL,
  getSharedValidTime,
  clampViewportBbox,
  getBackendWindFlag,
  latestTimeDiag,
  updateProjectionDiag
} from './backendWeatherServiceClient';
import { BoundedPointCache } from './BoundedPointCache';

export const windPointCache = new BoundedPointCache(50, 30000);

/**
 * Maps the standard backend wind grid response schema to the WebGLWindEngine expectations.
 * Computes grid renderability checks (all-zero and empty vectors rejection).
 */
export function mapNormalizedWindGridToWebGL(json, snappedBounds, hourOffset) {
  if (!json || !json.grid || !Array.isArray(json.grid.vectors)) {
    throw new Error("Invalid normalized wind grid response structure");
  }

  const mappedVectors = json.grid.vectors.map(v => ({
    lat: v.lat,
    lng: v.lng,
    speed: v.speed || 0,
    direction: v.direction || 0,
    u: v.u || 0,
    v: v.v || 0
  }));

  const nonzeroCount = mappedVectors.filter(v => v.speed > 0).length;
  const renderable = mappedVectors.length > 0 && nonzeroCount > 0;

  if (!renderable) {
    console.warn(`[Backend Weather Service] Wind grid is not renderable. mappedVectors=${mappedVectors.length}, nonzeroCount=${nonzeroCount}`);
  }

  return {
    vectors: mappedVectors,
    bounds: json.grid.bounds || snappedBounds,
    cols: json.grid.cols,
    rows: json.grid.rows,
    stale: false,
    source: json.model || 'GFS',
    hourOffset,
    provider: json.provider || 'backend-weather-service',
    nonzeroCount,
    renderable
  };
}

// Wind Diagnostics Telemetry Initializer
if (typeof window !== 'undefined') {
  window.__BACKEND_WIND_SERVICE_DIAG__ = window.__BACKEND_WIND_SERVICE_DIAG__ || {
    featureFlagActive: getBackendWindFlag(),
    selectedManifestValidTime: null,
    requestedValidTime: null,
    manifestDeltaHours: null,
    fallbackReason: null,
    timeFallbackReason: null,
    pointParity: 'pending_point_fetch',
    requestedBbox: null,
    clampedBbox: null,
    coverageInside: true,
    fallbackToLegacy: false,
    gridVectorCount: null,
    nonzeroCount: null,
    provider: 'backend-weather-service',
    model: 'GFS',
    activeModel: 'GFS',
    layer: 'wind',
    lastGridFetch: null,
    lastPointFetch: null,
    renderable: false,
    gridValidTime: null,
    pointValidTime: null,
    boundsSource: 'controller'
  };
}

/**
 * Updates the global wind diagnostics telemetry registry.
 */
export function updateWindDiagnostics(type, details) {
  if (typeof window === 'undefined') return;

  if (!window.__BACKEND_WIND_SERVICE_DIAG__) {
    window.__BACKEND_WIND_SERVICE_DIAG__ = {
      featureFlagActive: getBackendWindFlag(),
      selectedManifestValidTime: null,
      requestedValidTime: null,
      manifestDeltaHours: null,
      fallbackReason: null,
      timeFallbackReason: null,
      pointParity: 'pending_point_fetch',
      requestedBbox: null,
      clampedBbox: null,
      coverageInside: true,
      fallbackToLegacy: false,
      gridVectorCount: null,
      nonzeroCount: null,
      provider: 'backend-weather-service',
      model: 'GFS',
      activeModel: 'GFS',
      layer: 'wind',
      lastGridFetch: null,
      lastPointFetch: null,
      renderable: false,
      gridValidTime: null,
      pointValidTime: null,
      boundsSource: 'controller'
    };
  }

  const diag = window.__BACKEND_WIND_SERVICE_DIAG__;
  diag.featureFlagActive = getBackendWindFlag();

  const currentModel = details.model || diag.model || 'GFS';
  diag.model = currentModel;
  diag.activeModel = currentModel;

  if (type === 'grid') {
    diag.lastGridFetch = details;
    diag.gridValidTime = details.validTime || null;
    diag.requestedBbox = details.requestedBbox;
    diag.clampedBbox = details.clampedBbox;
    diag.gridVectorCount = details.gridVectorCount || null;
    diag.nonzeroCount = details.nonzeroCount || null;
    diag.renderable = details.renderable || false;
    diag.boundsSource = details.boundsSource || diag.boundsSource || 'controller';

    const isInside = details.coverageInside !== undefined 
      ? details.coverageInside 
      : (details.clampedBbox !== null && !details.error?.includes('outside'));
      
    diag.coverageInside = isInside;
    diag.fallbackToLegacy = !isInside || !!details.error;
    diag.fallbackReason = details.error || null;
    diag.provider = details.provider || diag.provider;
    diag.productId = details.productId || null;
    diag.gridProductId = details.productId || null;
  } else if (type === 'point') {
    diag.lastPointFetch = details;
    diag.pointValidTime = details.validTime || null;
    diag.provider = details.provider || diag.provider;
    diag.productId = details.productId || null;
    diag.pointProductId = details.productId || null;
    diag.gridProductId = diag.lastGridFetch?.productId || null;
    diag.source = details.source || 'network';
  }

  if (details.hourOffset !== undefined) {
    getSharedValidTime(details.hourOffset, 'wind', currentModel);
  }

  const timeDiag = latestTimeDiag[`${currentModel}_wind`] || {};
  diag.requestedValidTime = timeDiag.requestedValidTime;
  diag.selectedManifestValidTime = timeDiag.selectedManifestValidTime;
  diag.manifestDeltaHours = timeDiag.manifestDeltaHours;
  diag.timeFallbackReason = timeDiag.fallbackReason;

  diag.pointParity = diag.pointValidTime 
    ? (diag.gridValidTime === diag.pointValidTime) 
    : 'pending_point_fetch';
}

/**
 * Fetches exact point forecast from backend weather service for wind.
 */
export async function fetchBackendExactWindPoint(lat, lng, hourOffset, signal, model = 'GFS') {
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, 'wind', model);
  const provider = model === 'EURO' ? 'copernicus' : 'open-meteo';
  const cacheKey = `${model}_wind_wind_${lat.toFixed(2)}_${lng.toFixed(2)}_${validTimeStr}_${provider}`;

  const cached = windPointCache.get(cacheKey);
  if (cached) {
    console.log(`[Backend Weather Service] Cache hit for ${model} Wind: ${cacheKey}`);
    const clonedData = JSON.parse(JSON.stringify(cached.data));
    clonedData.source = 'cache';
    updateWindDiagnostics('point', { ...cached.details, source: 'cache' });
    return clonedData;
  }

  const url = `${POINT_URL}?model=${model}&domain=wind&layer=wind&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`Backend point returned HTTP ${res.status}`);
    }
    const json = await res.json();
    
    const mockTime = validTimeStr.replace(/\.\d+Z$/, 'Z');
    const data = {
      hourly: {
        time: [mockTime],
        wind_speed_10m: [json.point.speed || 0],
        wind_direction_10m: [json.point.direction || 0]
      },
      snappedLat: json.point.sampled_lat || lat,
      snappedLng: json.point.sampled_lng || lng,
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: model,
      activeLayer: 'wind',
      forecastDays: 1,
      apiModel: model === 'ICON' ? 'dwd_icon' : (model === 'EURO' ? 'ecmwf_ifs' : 'gfs_seamless'),
      provider: json.provider || provider,
      source: 'network'
    };

    const details = {
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || 'wind_speed',
      valueUnit: json.value_unit || 'kn',
      displayUnitHint: json.display_unit_hint || 'kn',
      elapsedMs: Date.now() - start,
      error: null,
      hourOffset,
      speed: json.point.speed || 0,
      direction: json.point.direction || 0,
      interpolationMethod: json.point.interpolation_method || 'bilinear',
      interpolation_method: json.point.interpolation_method || 'bilinear',
      provider: json.provider || provider,
      productId: json.product_id || null,
      pointProductId: json.product_id || null,
      source: 'network',
      model
    };

    windPointCache.set(cacheKey, { data, details });

    updateWindDiagnostics('point', details);

    return data;
  } catch (err) {
    const status = err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500;
    updateWindDiagnostics('point', {
      url,
      status,
      validTime: validTimeStr,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: err.message,
      hourOffset,
      speed: 0,
      direction: 0,
      interpolationMethod: 'none',
      interpolation_method: 'none',
      provider: 'none',
      model
    });
    console.error(`[Backend Weather Service] Wind point fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    throw err;
  }
}

/**
 * Fetches wind grid forecast from backend weather service.
 */
export async function fetchBackendWindGrid(bounds, hourOffset, signal, snappedBounds, boundsSource = "controller", model = 'GFS') {
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, 'wind', model);

  let actualBounds = bounds;
  let actualSource = boundsSource;

  if (!actualBounds) {
    if (typeof window !== 'undefined' && window.map) {
      try {
        const b = window.map.getBounds();
        actualBounds = {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
        actualSource = "window_map";
      } catch (e) {
        actualBounds = snappedBounds || PILOT_COVERAGE;
        actualSource = "fallback";
      }
    } else {
      actualBounds = snappedBounds || PILOT_COVERAGE;
      actualSource = "fallback";
    }
  }

  const clampResult = clampViewportBbox(actualBounds, 'wind', model);
  if (!clampResult.isInside) {
    const errorDetails = {
      url: 'none',
      status: 0,
      validTime: validTimeStr,
      elapsedMs: Date.now() - start,
      error: clampResult.fallbackReason,
      requestedBbox: actualBounds,
      clampedBbox: null,
      hourOffset,
      coverageInside: false,
      fallbackToLegacy: true,
      boundsSource: actualSource,
      model
    };
    updateWindDiagnostics('grid', errorDetails);

    updateProjectionDiag('wind', {
      activeModel: model,
      activeLayer: 'wind',
      requestedViewportBounds: actualBounds,
      backendRequestBbox: null,
      responseGridBounds: null,
      coverageBounds: clampResult.coverageBounds,
      renderable: false,
      error: clampResult.fallbackReason,
      reason: clampResult.fallbackReason,
      selectedTileId: clampResult.selectedTileId,
      rejectedTileIds: clampResult.rejectedTileIds,
      regionId: clampResult.selectedTileId,
      tileId: clampResult.selectedTileId,
      validTime: validTimeStr
    });

    throw new Error(clampResult.fallbackReason);
  }

  const { clampedBbox } = clampResult;
  const bboxParam = `${clampedBbox.west},${clampedBbox.south},${clampedBbox.east},${clampedBbox.north}`;
  const url = `${GRID_URL}?model=${model}&domain=wind&layer=wind&valid_time=${validTimeStr}&bbox=${bboxParam}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`Backend returned HTTP ${res.status}`);
    }
    const json = await res.json();
    const result = mapNormalizedWindGridToWebGL(json, clampedBbox, hourOffset);
    result.source = model;

    updateWindDiagnostics('grid', {
      url,
      status: res.status,
      validTime: validTimeStr,
      elapsedMs: Date.now() - start,
      error: null,
      requestedBbox: actualBounds,
      clampedBbox,
      hourOffset,
      gridVectorCount: result.vectors.length,
      nonzeroCount: result.nonzeroCount,
      renderable: result.renderable,
      coverageInside: true,
      boundsSource: actualSource,
      productId: json.product_id || null,
      model
    });

    const firstVector = result.vectors && result.vectors[0] ? { lat: result.vectors[0].lat, lng: result.vectors[0].lng } : null;
    const lastVector = result.vectors && result.vectors.length > 0 ? { lat: result.vectors[result.vectors.length - 1].lat, lng: result.vectors[result.vectors.length - 1].lng } : null;

    updateProjectionDiag('wind', {
      activeModel: model,
      activeLayer: 'wind',
      requestedViewportBounds: actualBounds,
      backendRequestBbox: bboxParam,
      responseGridBounds: json.grid?.bounds,
      coverageBounds: clampResult.coverageBounds,
      cols: result.cols,
      rows: result.rows,
      vectorCount: result.vectors.length,
      firstVectorLatLng: firstVector,
      lastVectorLatLng: lastVector,
      productId: json.product_id,
      provider: json.provider,
      renderable: result.renderable,
      clampedBbox,
      selectedTileId: clampResult.selectedTileId,
      rejectedTileIds: clampResult.rejectedTileIds,
      regionId: json.region_id || clampResult.selectedTileId,
      tileId: json.tile_id || clampResult.selectedTileId,
      validTime: validTimeStr
    });

    return result;
  } catch (err) {
    const errorDetails = {
      url,
      status: err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500,
      validTime: validTimeStr,
      elapsedMs: Date.now() - start,
      error: err.message,
      requestedBbox: actualBounds,
      clampedBbox,
      hourOffset,
      fallbackToLegacy: true,
      boundsSource: actualSource,
      model
    };
    updateWindDiagnostics('grid', errorDetails);

    updateProjectionDiag('wind', {
      activeModel: model,
      activeLayer: 'wind',
      requestedViewportBounds: actualBounds,
      backendRequestBbox: bboxParam,
      responseGridBounds: null,
      coverageBounds: clampResult.coverageBounds,
      renderable: false,
      error: err.message,
      reason: err.message,
      clampedBbox,
      selectedTileId: clampResult.selectedTileId,
      rejectedTileIds: clampResult.rejectedTileIds,
      regionId: clampResult.selectedTileId,
      tileId: clampResult.selectedTileId,
      validTime: validTimeStr
    });

    console.error(`[Backend Weather Service] Wind grid fetch error: ${err.message}. Falling back cleanly.`);
    throw err;
  }
}

if (typeof window !== 'undefined') {
  window.fetchBackendExactWindPoint = fetchBackendExactWindPoint;
  window.fetchBackendWindGrid = fetchBackendWindGrid;
}

