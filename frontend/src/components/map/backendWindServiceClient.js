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
  latestTimeDiag
} from './backendWeatherServiceClient';

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
  } else if (type === 'point') {
    diag.lastPointFetch = details;
    diag.pointValidTime = details.validTime || null;
  }

  if (details.hourOffset !== undefined) {
    getSharedValidTime(details.hourOffset, 'wind');
  }

  const timeDiag = latestTimeDiag['GFS_wind'] || {};
  diag.requestedValidTime = timeDiag.requestedValidTime;
  diag.selectedManifestValidTime = timeDiag.selectedManifestValidTime;
  diag.manifestDeltaHours = timeDiag.manifestDeltaHours;
  diag.timeFallbackReason = timeDiag.fallbackReason;

  diag.pointParity = diag.pointValidTime 
    ? (diag.gridValidTime === diag.pointValidTime) 
    : 'pending_point_fetch';
}

/**
 * Fetches exact point forecast from backend weather service for GFS wind.
 */
export async function fetchBackendExactWindPoint(lat, lng, hourOffset, signal) {
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, 'wind');
  const url = `${POINT_URL}?model=GFS&domain=wind&layer=wind&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;

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
      requestedModel: 'GFS',
      activeLayer: 'wind',
      forecastDays: 1,
      apiModel: 'gfs_seamless',
      provider: json.provider || 'backend-weather-service',
      source: 'backend_point_api'
    };

    updateWindDiagnostics('point', {
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
      provider: json.provider || 'backend-weather-service'
    });

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
      provider: 'none'
    });
    console.error(`[Backend Weather Service] Wind point fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    throw err;
  }
}

/**
 * Fetches GFS wind grid forecast from backend weather service.
 */
export async function fetchBackendWindGrid(bounds, hourOffset, signal, snappedBounds, boundsSource = "controller") {
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, 'wind');

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

  const clampResult = clampViewportBbox(actualBounds, 'wind');
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
      boundsSource: actualSource
    };
    updateWindDiagnostics('grid', errorDetails);
    throw new Error(clampResult.fallbackReason);
  }

  const { clampedBbox } = clampResult;
  const bboxParam = `${clampedBbox.west},${clampedBbox.south},${clampedBbox.east},${clampedBbox.north}`;
  const url = `${GRID_URL}?model=GFS&domain=wind&layer=wind&valid_time=${validTimeStr}&bbox=${bboxParam}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`Backend returned HTTP ${res.status}`);
    }
    const json = await res.json();
    const result = mapNormalizedWindGridToWebGL(json, clampedBbox, hourOffset);

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
      boundsSource: actualSource
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
      boundsSource: actualSource
    };
    updateWindDiagnostics('grid', errorDetails);
    console.error(`[Backend Weather Service] Wind grid fetch error: ${err.message}. Falling back cleanly.`);
    throw err;
  }
}
