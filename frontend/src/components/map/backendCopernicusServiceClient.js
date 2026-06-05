/**
 * backendCopernicusServiceClient.js
 * 
 * Dedicated client adapter for Copernicus marine components (Swell 1, Swell 2).
 */

import { BACKEND_URL } from '../../lib/apiClient';
import {
  GRID_URL,
  POINT_URL,
  getSharedValidTime,
  clampViewportBbox,
  getBackendCopernicusFlag,
  latestTimeDiag,
  PILOT_COVERAGE,
  updateProjectionDiag
} from './backendWeatherServiceClient';
import { BoundedPointCache } from './BoundedPointCache';

export const copernicusPointCache = new BoundedPointCache(50, 30000);

/**
 * Maps the standard backend grid response schema to the WebGLMarineLayer expectations for Copernicus swell/waves.
 */
export function mapNormalizedCopernicusGridToWebGL(json, snappedBounds, hourOffset, layer = 'swell_1') {
  if (!json || !json.grid || !Array.isArray(json.grid.vectors)) {
    throw new Error("Invalid normalized grid response structure");
  }

  const zeroVec = { u: 0, v: 0, speed: 0, period: 0 };
  const mappedVectors = json.grid.vectors.map(v => {
    const componentUV = {
      u: v.u || 0,
      v: v.v || 0,
      speed: v.speed || 0,
      period: v.period || 0
    };
    return {
      lat: v.lat,
      lng: v.lng,
      isOcean: true,
      waves: layer === 'waves' ? componentUV : zeroVec,
      swell_1: layer === 'swell_1' ? componentUV : zeroVec,
      swell_2: layer === 'swell_2' ? componentUV : zeroVec,
      wind_waves: layer === 'wind_waves' ? componentUV : zeroVec
    };
  });

  const nonzeroCount = mappedVectors.filter(v => v[layer].speed > 0).length;
  const maxSpeed = mappedVectors.length > 0 ? Math.max(...mappedVectors.map(v => v[layer].speed), 0) : 0;
  const renderable = mappedVectors.length > 0 && nonzeroCount > 0;

  return {
    type: 'FeatureCollection',
    features: [],
    hourOffset,
    grid: {
      vectors: mappedVectors,
      bounds: json.grid.bounds || snappedBounds,
      cols: json.grid.cols,
      rows: json.grid.rows,
      timestamp: Date.now(),
      __sourceModel: 'EURO',
      __provider: json.provider || 'backend-weather-service',
      __gridProvider: json.provider || 'backend-weather-service',
      __componentLayer: layer,
      __gridSupportsLayer: renderable,
      __activeLayerNonzeroCount: nonzeroCount,
      __activeLayerMax: maxSpeed,
      __oceanMaskCount: mappedVectors.length,
      __renderable: renderable,
      provider: json.provider || 'backend-weather-service',
      hourOffset,
      nonzeroCount,
      maxSpeed,
      renderable
    }
  };
}

// Copernicus Diagnostics Telemetry Initializer
if (typeof window !== 'undefined') {
  window.__BACKEND_COPERNICUS_SERVICE_DIAG__ = window.__BACKEND_COPERNICUS_SERVICE_DIAG__ || {
    featureFlagActive: getBackendCopernicusFlag(),
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
    model: 'EURO',
    layer: 'swell_1',
    lastGridFetch: null,
    lastPointFetch: null,
    renderable: false,
    gridValidTime: null,
    pointValidTime: null,
    boundsSource: 'controller',
    sourceDataset: null,
    sourceVariables: null,
    is_forecast_authoritative: false,
    is_estimated: false,
    is_test_fixture: false,
    gridMode: null
  };
}

/**
 * Updates the global Copernicus diagnostics telemetry registry.
 */
export function updateCopernicusDiagnostics(type, details) {
  if (typeof window === 'undefined') return;

  if (!window.__BACKEND_COPERNICUS_SERVICE_DIAG__) {
    window.__BACKEND_COPERNICUS_SERVICE_DIAG__ = {
      featureFlagActive: getBackendCopernicusFlag(),
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
      model: 'EURO',
      layer: 'swell_1',
      lastGridFetch: null,
      lastPointFetch: null,
      renderable: false,
      gridValidTime: null,
      pointValidTime: null,
      boundsSource: 'controller',
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false,
      gridMode: null
    };
  }

  const diag = window.__BACKEND_COPERNICUS_SERVICE_DIAG__;
  diag.featureFlagActive = getBackendCopernicusFlag();

  if (type === 'grid') {
    diag.layer = details.layer || diag.layer || 'swell_1';
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
    diag.sourceDataset = details.sourceDataset || null;
    diag.sourceVariables = details.sourceVariables || null;
    diag.is_forecast_authoritative = details.is_forecast_authoritative !== undefined ? details.is_forecast_authoritative : false;
    diag.is_estimated = details.is_estimated !== undefined ? details.is_estimated : false;
    diag.is_test_fixture = details.is_test_fixture !== undefined ? details.is_test_fixture : false;
    diag.gridMode = details.gridMode || diag.gridMode || null;
    diag.productId = details.productId || null;
    diag.gridProductId = details.productId || null;
  } else if (type === 'point') {
    diag.layer = details.layer || diag.layer || 'swell_1';
    diag.lastPointFetch = details;
    diag.pointValidTime = details.validTime || null;
    diag.period = details.period || 0;

    diag.provider = details.provider || diag.provider;
    diag.sourceDataset = details.sourceDataset || null;
    diag.sourceVariables = details.sourceVariables || null;
    diag.is_forecast_authoritative = details.is_forecast_authoritative !== undefined ? details.is_forecast_authoritative : false;
    diag.is_estimated = details.is_estimated !== undefined ? details.is_estimated : false;
    diag.is_test_fixture = details.is_test_fixture !== undefined ? details.is_test_fixture : false;
    diag.productId = details.productId || null;
    diag.pointProductId = details.productId || null;
    diag.gridProductId = diag.lastGridFetch?.productId || null;
    diag.source = details.source || 'network';
  }

  if (details.hourOffset !== undefined) {
    getSharedValidTime(details.hourOffset, diag.layer, 'EURO');
  }

  const timeDiag = latestTimeDiag[`EURO_${diag.layer}`] || {};
  diag.requestedValidTime = timeDiag.requestedValidTime;
  diag.selectedManifestValidTime = timeDiag.selectedManifestValidTime;
  diag.manifestDeltaHours = timeDiag.manifestDeltaHours;
  diag.timeFallbackReason = timeDiag.fallbackReason;

  diag.pointParity = diag.pointValidTime 
    ? (diag.gridValidTime === diag.pointValidTime) 
    : 'pending_point_fetch';

  // Synchronize with window.__COPERNICUS_GRID_DIAG__ for frontend visual inspection compliance
  window.__COPERNICUS_GRID_DIAG__ = {
    layer: diag.layer,
    componentLayer: diag.layer,
    provider: diag.provider,
    sourceDataset: diag.sourceDataset,
    sourceVariables: diag.sourceVariables,
    is_forecast_authoritative: diag.is_forecast_authoritative,
    is_estimated: diag.is_estimated,
    is_test_fixture: diag.is_test_fixture,
    selectedManifestValidTime: diag.selectedManifestValidTime,
    pointParity: diag.pointParity,
    renderable: diag.renderable,
    fallbackReason: diag.fallbackReason,
    gridMode: diag.gridMode,
    timestamp: new Date().toISOString()
  };
}

/**
 * Fetches EURO Copernicus forecast grid from backend weather service.
 */
export async function fetchBackendCopernicusGrid(bounds, hourOffset, signal, snappedBounds, boundsSource = "controller", layer = "swell_1") {
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, layer, 'EURO');

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

  const clampResult = clampViewportBbox(actualBounds, layer, 'EURO');
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
      layer
    };
    updateCopernicusDiagnostics('grid', errorDetails);

    updateProjectionDiag('marine', {
      activeModel: 'EURO',
      activeLayer: layer,
      requestedViewportBounds: actualBounds,
      backendRequestBbox: null,
      responseGridBounds: null,
      coverageBounds: clampResult.coverageBounds,
      renderable: false,
      error: clampResult.fallbackReason,
      reason: clampResult.fallbackReason
    });

    throw new Error(clampResult.fallbackReason);
  }

  const { clampedBbox } = clampResult;
  const bboxParam = `${clampedBbox.west},${clampedBbox.south},${clampedBbox.east},${clampedBbox.north}`;
  const url = `${GRID_URL}?model=EURO&domain=marine&layer=${layer}&valid_time=${validTimeStr}&bbox=${bboxParam}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      let reason = `Backend returned HTTP ${res.status}`;
      try {
        const errorJson = await res.json();
        if (errorJson && errorJson.reason) {
          reason = errorJson.reason;
        } else if (errorJson && errorJson.detail) {
          reason = errorJson.detail;
        }
      } catch (e) {}
      throw new Error(reason);
    }
    const json = await res.json();
    const result = mapNormalizedCopernicusGridToWebGL(json, clampedBbox, hourOffset, layer);

    updateCopernicusDiagnostics('grid', {
      url,
      status: res.status,
      validTime: validTimeStr,
      elapsedMs: Date.now() - start,
      error: null,
      requestedBbox: actualBounds,
      clampedBbox,
      hourOffset,
      gridVectorCount: result.grid.vectors.length,
      nonzeroCount: result.grid.nonzeroCount,
      renderable: result.grid.renderable,
      coverageInside: true,
      boundsSource: actualSource,
      provider: json.provider,
      sourceDataset: json.source_dataset,
      sourceVariables: json.source_variables,
      is_forecast_authoritative: json.is_forecast_authoritative,
      is_estimated: json.is_estimated,
      is_test_fixture: json.is_test_fixture,
      gridMode: json.grid?.diagnostics?.gridMode || 'rectangular',
      productId: json.product_id || null,
      layer
    });

    const vectors = result.grid.vectors;
    const firstVector = vectors && vectors[0] ? { lat: vectors[0].lat, lng: vectors[0].lng } : null;
    const lastVector = vectors && vectors.length > 0 ? { lat: vectors[vectors.length - 1].lat, lng: vectors[vectors.length - 1].lng } : null;

    updateProjectionDiag('marine', {
      activeModel: 'EURO',
      activeLayer: layer,
      requestedViewportBounds: actualBounds,
      backendRequestBbox: bboxParam,
      responseGridBounds: result.grid.bounds,
      coverageBounds: clampResult.coverageBounds,
      cols: result.grid.cols,
      rows: result.grid.rows,
      vectorCount: vectors ? vectors.length : 0,
      firstVectorLatLng: firstVector,
      lastVectorLatLng: lastVector,
      productId: json.product_id,
      provider: json.provider,
      renderable: result.grid.renderable,
      clampedBbox,
      selectedTileId: clampResult.selectedTileId,
      rejectedTileIds: clampResult.rejectedTileIds,
      regionId: json.region_id || clampResult.selectedTileId,
      tileId: json.tile_id || clampResult.selectedTileId,
      validTime: validTimeStr,
      isEstimated: json.is_estimated,
      estimateBasis: json.estimate_basis
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
      provider: 'backend-weather-service',
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false,
      layer
    };
    updateCopernicusDiagnostics('grid', errorDetails);

    updateProjectionDiag('marine', {
      activeModel: 'EURO',
      activeLayer: layer,
      requestedViewportBounds: actualBounds,
      backendRequestBbox: bboxParam,
      responseGridBounds: null,
      coverageBounds: clampResult.coverageBounds,
      renderable: false,
      error: err.message,
      reason: err.message,
      clampedBbox
    });

    console.error(`[Backend Weather Service] Copernicus grid fetch error: ${err.message}.`);
    throw err;
  }
}

/**
 * Fetches exact point forecast from backend weather service for EURO Copernicus.
 */
export async function fetchBackendExactCopernicusPoint(lat, lng, hourOffset, signal, layer = 'swell_1') {
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, layer, 'EURO');
  const provider = 'copernicus';
  const cacheKey = `EURO_marine_${layer}_${lat.toFixed(2)}_${lng.toFixed(2)}_${validTimeStr}_${provider}`;

  const cached = copernicusPointCache.get(cacheKey);
  if (cached) {
    console.log(`[Backend Weather Service] Cache hit for EURO Copernicus: ${cacheKey}`);
    const clonedData = JSON.parse(JSON.stringify(cached.data));
    clonedData.source = 'cache';
    updateCopernicusDiagnostics('point', { ...cached.details, source: 'cache' });
    return clonedData;
  }

  const url = `${POINT_URL}?model=EURO&domain=marine&layer=${layer}&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      let reason = 'no_copernicus_coverage';
      try {
        const errorJson = await res.json();
        if (errorJson && errorJson.reason) {
          reason = errorJson.reason;
        } else if (errorJson && errorJson.detail) {
          reason = errorJson.detail;
        }
      } catch (e) {}
      
      const errorDetails = {
        url,
        status: res.status,
        validTime: validTimeStr,
        valueKind: 'none',
        valueUnit: 'none',
        displayUnitHint: 'none',
        elapsedMs: Date.now() - start,
        error: reason,
        hourOffset,
        speed: 0,
        direction: 0,
        interpolationMethod: 'none',
        interpolation_method: 'none',
        provider: 'none',
        sourceDataset: null,
        sourceVariables: null,
        is_forecast_authoritative: false,
        is_estimated: false,
        is_test_fixture: false,
        layer
      };
      updateCopernicusDiagnostics('point', errorDetails);
      console.warn(`[Backend Weather Service] Copernicus point fetch returned status ${res.status}: ${reason}`);
      return {
        status: reason,
        hourly: { time: [] },
        requestedLat: lat,
        requestedLng: lng,
        requestedModel: 'EURO',
        activeLayer: layer,
        provider: 'copernicus',
        source: 'backend_point_api'
      };
    }
    const json = await res.json();
    
    // Structure conformed hourly response compatible with forecastSamplers.js expectations.
    const mockTime = validTimeStr.replace(/\.\d+Z$/, 'Z');
    const conformedHourly = {
      time: [mockTime],
      wave_height: [0],
      wave_direction: [0],
      wave_period: [0],
      wave_peak_period: [0],
      swell_wave_height: [0],
      swell_wave_direction: [0],
      swell_wave_period: [0],
      swell_wave_peak_period: [0],
      secondary_swell_wave_height: [0],
      secondary_swell_wave_direction: [0],
      secondary_swell_wave_period: [0],
      wind_wave_height: [0],
      wind_wave_direction: [0],
      wind_wave_period: [0],
      wind_wave_peak_period: [0]
    };

    if (layer === 'swell_1') {
      conformedHourly.swell_wave_height = [json.point.speed || 0];
      conformedHourly.swell_wave_direction = [json.point.direction || 0];
      conformedHourly.swell_wave_period = [json.point.period || 0];
      conformedHourly.swell_wave_peak_period = [json.point.period || 0];
    } else if (layer === 'swell_2') {
      conformedHourly.secondary_swell_wave_height = [json.point.speed || 0];
      conformedHourly.secondary_swell_wave_direction = [json.point.direction || 0];
      conformedHourly.secondary_swell_wave_period = [json.point.period || 0];
    } else if (layer === 'wind_waves') {
      conformedHourly.wind_wave_height = [json.point.speed || 0];
      conformedHourly.wind_wave_direction = [json.point.direction || 0];
      conformedHourly.wind_wave_period = [json.point.period || 0];
      conformedHourly.wind_wave_peak_period = [json.point.period || 0];
    } else if (layer === 'waves') {
      conformedHourly.wave_height = [json.point.speed || 0];
      conformedHourly.wave_direction = [json.point.direction || 0];
      conformedHourly.wave_period = [json.point.period || 0];
    }

    const data = {
      hourly: conformedHourly,
      snappedLat: json.point.sampled_lat || lat,
      snappedLng: json.point.sampled_lng || lng,
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: 'EURO',
      activeLayer: layer,
      forecastDays: 1,
      apiModel: 'ecmwf_wam025',
      provider: json.provider || 'copernicus',
      source: 'network'
    };

    const details = {
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || (layer === 'swell_1' ? 'swell_wave_height' : 'secondary_swell_wave_height'),
      valueUnit: json.value_unit || 'm',
      displayUnitHint: json.display_unit_hint || 'ft',
      elapsedMs: Date.now() - start,
      error: null,
      hourOffset,
      layer,
      speed: json.point.speed || 0,
      direction: json.point.direction || 0,
      period: json.point.period || 0,
      interpolationMethod: json.point.interpolation_method || 'bilinear',
      interpolation_method: json.point.interpolation_method || 'bilinear',
      provider: json.provider || 'copernicus',
      sourceDataset: json.source_dataset,
      sourceVariables: json.source_variables,
      is_forecast_authoritative: json.is_forecast_authoritative,
      is_estimated: json.is_estimated,
      is_test_fixture: json.is_test_fixture,
      productId: json.product_id || null,
      pointProductId: json.product_id || null,
      source: 'network'
    };

    copernicusPointCache.set(cacheKey, { data, details });

    updateCopernicusDiagnostics('point', details);

    return data;
  } catch (err) {
    const status = err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500;
    updateCopernicusDiagnostics('point', {
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
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false,
      layer
    });
    console.error(`[Backend Weather Service] Copernicus point fetch error: ${err.message}.`);
    throw err;
  }
}
