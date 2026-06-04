/**
 * backendWeatherServiceClient.js
 * 
 * Dedicated client adapter for the Backend-Owned Weather Data Service.
 * Decouples the frontend controllers from feature flag checks, shared valid_time
 * computations, bounding box dynamic clamping, diagnostics telemetry updates,
 * and WebGL layer grid normalizations.
 */

import { BACKEND_URL } from '../../lib/apiClient';

import { BoundedPointCache } from './BoundedPointCache';
export { BoundedPointCache };

export const pointCache = new BoundedPointCache(50, 30000);

export const PILOT_COVERAGE = {
  west: -85.0,
  south: 24.0,
  east: -79.0,
  north: 31.0
};

// Expose standard API base endpoints
export const STATUS_URL = `${BACKEND_URL}/api/weather/status`;
export const GRID_URL = `${BACKEND_URL}/api/weather/grid`;
export const POINT_URL = `${BACKEND_URL}/api/weather/point`;

// Cache manifest products listing
let cachedManifest = null;
let manifestFetchPromise = null;

export let latestTimeDiag = {
  marine: {
    requestedValidTime: null,
    selectedManifestValidTime: null,
    manifestDeltaHours: null,
    fallbackReason: null
  },
  wind: {
    requestedValidTime: null,
    selectedManifestValidTime: null,
    manifestDeltaHours: null,
    fallbackReason: null
  }
};

/**
 * Direct setter to mock cached manifest registry during unit tests.
 */
export function setCachedManifest(manifest) {
  cachedManifest = manifest;
}

/**
 * Fetches the products manifest from the backend registry.
 * Forces refetch if cachedManifest is empty to support dynamic ingestion updates.
 */
export async function fetchProductsManifest(forceRefresh = false) {
  const isEmpty = cachedManifest && Array.isArray(cachedManifest.products) && cachedManifest.products.length === 0;
  if (cachedManifest && !forceRefresh && !isEmpty) return cachedManifest;
  if (manifestFetchPromise && !forceRefresh) return manifestFetchPromise;

  manifestFetchPromise = (async () => {
    try {
      const res = await fetch(STATUS_URL.replace('/status', '/products'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cachedManifest = data;
      return cachedManifest;
    } catch (err) {
      console.warn("[Backend Weather Service] Failed to fetch products manifest:", err.message);
      return null;
    } finally {
      manifestFetchPromise = null;
    }
  })();

  return manifestFetchPromise;
}

/**
 * Resolves the master backend marine weather system feature flag.
 * Enabled by default. Can be overridden in console or localStorage.
 */
export function getBackendMarineSystemFlag() {
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_MARINE_SYSTEM__ !== undefined) {
    return !!window.__USE_BACKEND_MARINE_SYSTEM__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_MARINE_SYSTEM__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_MARINE_SYSTEM !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_MARINE_SYSTEM === 'true';
  }
  return true;
}

/**
 * Resolves the weather service feature flag.
 * Defaults to true under active master flag. Can be overridden in console or localStorage.
 */
export function getBackendWeatherFlag() {
  if (!getBackendMarineSystemFlag()) return false;
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_WEATHER_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_WEATHER_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_WEATHER_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_WEATHER !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_WEATHER === 'true';
  }
  return true;
}

/**
 * Resolves the backend wind service feature flag.
 * Keeps its legacy behavior (disabled by default) untouched.
 */
export function getBackendWindFlag() {
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_WIND_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_WIND_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_WIND_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_WIND !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_WIND === 'true';
  }
  return true;
}

/**
 * Resolves the backend Copernicus service feature flag.
 * Defaults to true under active master flag.
 */
export function getBackendCopernicusFlag() {
  if (!getBackendMarineSystemFlag()) return false;
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_COPERNICUS_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_COPERNICUS_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_COPERNICUS_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_COPERNICUS !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_COPERNICUS === 'true';
  }
  return true;
}

/**
 * Resolves the backend ICON service feature flag.
 * Defaults to true under active master flag.
 */
export function getBackendIconMarineFlag() {
  if (!getBackendMarineSystemFlag()) return false;
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_ICON_MARINE_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_ICON_MARINE_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_ICON_MARINE_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_ICON_MARINE !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_ICON_MARINE === 'true';
  }
  return true;
}

/**
 * Computes a standardized snapped UTC ISO string from hourOffset.
 * Resolves the nearest valid_time from cachedManifest when available (max 3h delta).
 * Provides the single source of authority for matching grid/point time dimensions.
 */
export function getSharedValidTime(timeOffsetHours, layer = 'waves', modelName = 'GFS') {
  const baseTime = (typeof window !== 'undefined' && window.__MOCK_DATE_NOW__) || Date.now();
  const roundedNow = Math.round(baseTime / 3600000) * 3600000;
  const targetDt = new Date(roundedNow + timeOffsetHours * 3600000);
  const requestedValidTime = targetDt.toISOString();

  let selectedManifestValidTime = null;
  let manifestDeltaHours = null;
  let fallbackReason = null;

  const filterLayer = (layer || 'waves').toLowerCase();
  const filterDomain = filterLayer === 'wind' ? 'wind' : 'marine';
  const filterModel = (modelName || 'GFS').toUpperCase();

  const hasEmptyProducts = cachedManifest && Array.isArray(cachedManifest.products) && cachedManifest.products.length === 0;

  if (cachedManifest && Array.isArray(cachedManifest.products) && !hasEmptyProducts) {
    const matchingProducts = cachedManifest.products.filter(p => 
      p.model.toUpperCase() === filterModel &&
      p.domain.toLowerCase() === filterDomain &&
      p.layer.toLowerCase() === filterLayer
    );

    if (matchingProducts.length > 0) {
      let minDiffMs = Infinity;
      let bestProduct = null;

      for (const p of matchingProducts) {
        const pDate = new Date(p.valid_time_start);
        const diffMs = Math.abs(pDate.getTime() - targetDt.getTime());
        if (diffMs < minDiffMs) {
          minDiffMs = diffMs;
          bestProduct = p;
        }
      }

      // Snapped to products within a max 3h delta window
      if (minDiffMs <= 3 * 3600000 && bestProduct) {
        selectedManifestValidTime = new Date(bestProduct.valid_time_start).toISOString();
        manifestDeltaHours = minDiffMs / 3600000;
      } else {
        fallbackReason = `No ${filterModel} ${filterLayer} product within 3 hours delta limit (${(minDiffMs / 3600000).toFixed(1)}h delta)`;
      }
    } else {
      fallbackReason = `No ${filterModel} products found matching ${filterModel} model/${filterDomain} domain/${filterLayer} layer`;
    }
  } else {
    fallbackReason = "Manifest is not yet loaded, empty, or invalid; using snapped target valid time as fallback";
    // Prefetch or refresh manifest in background
    fetchProductsManifest(true).catch(() => {});
  }

  const cacheDiagKey = `${filterModel}_${filterLayer}`;
  latestTimeDiag[cacheDiagKey] = {
    requestedValidTime,
    selectedManifestValidTime,
    manifestDeltaHours,
    fallbackReason
  };

  return selectedManifestValidTime || requestedValidTime;
}

/**
 * Clamps or intersects the requested viewport bbox coordinates with the pilot coverage limits.
 * Triggers fallback if viewport lies completely outside West Florida's region.
 */
export function clampViewportBbox(requestedBbox, layerName = "waves") {
  if (!requestedBbox) {
    return {
      isInside: false,
      clampedBbox: null,
      fallbackReason: "Missing requested bounding box coordinates"
    };
  }

  const { west, south, east, north } = requestedBbox;

  // 1. Check if completely outside coverage limits
  if (
    east < PILOT_COVERAGE.west ||
    west > PILOT_COVERAGE.east ||
    north < PILOT_COVERAGE.south ||
    south > PILOT_COVERAGE.north
  ) {
    let areaName = "GFS Waves";
    if (layerName === "wind") {
      areaName = "GFS Wind";
    } else if (layerName === "swell_1" || layerName === "swell_2" || layerName === "wind_waves") {
      areaName = "Copernicus Waves";
    }
    return {
      isInside: false,
      clampedBbox: null,
      fallbackReason: `Requested viewport completely outside ${areaName} pilot coverage area`
    };
  }

  // 2. Perform intersection clamping
  const clampedBbox = {
    west: Math.max(west, PILOT_COVERAGE.west),
    south: Math.max(south, PILOT_COVERAGE.south),
    east: Math.min(east, PILOT_COVERAGE.east),
    north: Math.min(north, PILOT_COVERAGE.north)
  };

  return {
    isInside: true,
    clampedBbox,
    fallbackReason: null
  };
}

/**
 * Maps the standard backend grid response schema to the WebGLMarineLayer expectations.
 * Computes grid renderability checks (all-zero and empty vectors rejection).
 */
export function mapNormalizedGridToWebGL(json, snappedBounds, hourOffset, layer = 'waves', model = 'GFS') {
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
  
  // A grid is renderable only if it has vectors and at least one non-zero speed vector
  const renderable = mappedVectors.length > 0 && nonzeroCount > 0;

  if (!renderable) {
    console.warn(`[Backend Weather Service] Grid is not renderable. mappedVectors=${mappedVectors.length}, nonzeroCount=${nonzeroCount}`);
  }

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
      __sourceModel: model,
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
      renderable,
      emptyGridWarning: !renderable ? "All vectors in grid are zero or null, or grid is empty" : null
    }
  };
}

// Global Diagnostics Telemetry Initializers
if (typeof window !== 'undefined') {
  window.__BACKEND_WEATHER_SERVICE_DIAG__ = window.__BACKEND_WEATHER_SERVICE_DIAG__ || {
    featureFlagActive: getBackendWeatherFlag(),
    activeModel: 'GFS',
    activeLayer: 'waves',
    layer: 'waves',
    backendUrl: BACKEND_URL,
    statusUrl: STATUS_URL,
    gridUrl: GRID_URL,
    pointUrl: POINT_URL,
    requestedHour: null,
    validTime: null,
    gridValidTime: null,
    pointValidTime: null,
    parity: 'pending_point_fetch',
    pointParity: 'pending_point_fetch',
    requestedBbox: null,
    clampedBbox: null,
    coverage: PILOT_COVERAGE,
    fallbackReason: null,
    lastGridFetch: null,
    lastPointFetch: null,
    coverageInside: true,
    fallbackToLegacy: false,
    reason: null,
    requestedValidTime: null,
    selectedManifestValidTime: null,
    manifestDeltaHours: null,
    gridVectorCount: null,
    nonzeroCount: null,
    renderable: false,
    sourceDataset: null,
    sourceVariables: null,
    is_forecast_authoritative: false,
    is_estimated: false,
    is_test_fixture: false,
    gridMode: null,
    interpolationMethod: null
  };

  window.__BACKEND_ICON_SERVICE_DIAG__ = window.__BACKEND_ICON_SERVICE_DIAG__ || {
    featureFlagActive: getBackendIconMarineFlag(),
    activeModel: 'ICON',
    activeLayer: 'waves',
    layer: 'waves',
    backendUrl: BACKEND_URL,
    statusUrl: STATUS_URL,
    gridUrl: GRID_URL,
    pointUrl: POINT_URL,
    requestedHour: null,
    validTime: null,
    gridValidTime: null,
    pointValidTime: null,
    parity: 'pending_point_fetch',
    pointParity: 'pending_point_fetch',
    requestedBbox: null,
    clampedBbox: null,
    coverage: PILOT_COVERAGE,
    fallbackReason: null,
    lastGridFetch: null,
    lastPointFetch: null,
    coverageInside: true,
    fallbackToLegacy: false,
    reason: null,
    requestedValidTime: null,
    selectedManifestValidTime: null,
    manifestDeltaHours: null,
    gridVectorCount: null,
    nonzeroCount: null,
    renderable: false,
    sourceDataset: null,
    sourceVariables: null,
    is_forecast_authoritative: false,
    is_estimated: false,
    is_test_fixture: false,
    gridMode: null,
    interpolationMethod: null
  };
}

/**
 * Updates the global diagnostics telemetry registry.
 */
export function updateDiagnostics(type, details, model = 'GFS') {
  if (typeof window === 'undefined') return;

  const isIcon = model.toUpperCase() === 'ICON';
  const diagKey = isIcon ? '__BACKEND_ICON_SERVICE_DIAG__' : '__BACKEND_WEATHER_SERVICE_DIAG__';

  if (!window[diagKey]) {
    window[diagKey] = {
      featureFlagActive: isIcon ? getBackendIconMarineFlag() : getBackendWeatherFlag(),
      activeModel: model.toUpperCase(),
      activeLayer: 'waves',
      layer: 'waves',
      backendUrl: BACKEND_URL,
      statusUrl: STATUS_URL,
      gridUrl: GRID_URL,
      pointUrl: POINT_URL,
      requestedHour: null,
      validTime: null,
      gridValidTime: null,
      pointValidTime: null,
      parity: 'pending_point_fetch',
      pointParity: 'pending_point_fetch',
      requestedBbox: null,
      clampedBbox: null,
      coverage: PILOT_COVERAGE,
      fallbackReason: null,
      lastGridFetch: null,
      lastPointFetch: null,
      coverageInside: true,
      fallbackToLegacy: false,
      reason: null,
      requestedValidTime: null,
      selectedManifestValidTime: null,
      manifestDeltaHours: null,
      gridVectorCount: null,
      nonzeroCount: null,
      renderable: false,
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false,
      gridMode: null,
      interpolationMethod: null
    };
  }

  const diag = window[diagKey];
  diag.featureFlagActive = isIcon ? getBackendIconMarineFlag() : getBackendWeatherFlag();

  if (type === 'grid') {
    diag.layer = details.layer || diag.layer || 'waves';
    diag.lastGridFetch = details;
    diag.gridValidTime = details.validTime || null;
    diag.requestedBbox = details.requestedBbox;
    diag.clampedBbox = details.clampedBbox;
    diag.fallbackReason = details.error || details.fallbackReason || null;
    diag.gridVectorCount = details.gridVectorCount || null;
    diag.nonzeroCount = details.nonzeroCount || null;
    diag.renderable = details.renderable !== undefined ? details.renderable : false;
    diag.sourceDataset = details.sourceDataset || null;
    diag.sourceVariables = details.sourceVariables || null;
    diag.is_forecast_authoritative = details.is_forecast_authoritative !== undefined ? details.is_forecast_authoritative : false;
    diag.is_estimated = details.is_estimated !== undefined ? details.is_estimated : false;
    diag.is_test_fixture = details.is_test_fixture !== undefined ? details.is_test_fixture : false;
    diag.gridMode = details.gridMode || null;
    diag.productId = details.productId || null;
    diag.gridProductId = details.productId || null;

    // Handle coverage flags and fallback telemetry (Correction 4: precise status)
    const isInside = details.coverageInside !== undefined 
      ? details.coverageInside 
      : (details.clampedBbox !== null && !details.error?.includes('outside'));
      
    diag.coverageInside = isInside;
    diag.fallbackToLegacy = !isInside || !!details.error;
    
    if (!isInside) {
      diag.reason = 'outside_coverage';
    } else if (details.error) {
      diag.reason = 'fallback_legacy';
    } else {
      diag.reason = 'backend_success';
    }
  } else if (type === 'point') {
    diag.layer = details.layer || diag.layer || 'waves';
    diag.lastPointFetch = details;
    diag.pointValidTime = details.validTime || null;
    diag.interpolationMethod = details.interpolationMethod || null;
    diag.period = details.period || 0;
    diag.sourceDataset = details.sourceDataset || null;
    diag.sourceVariables = details.sourceVariables || null;
    diag.is_forecast_authoritative = details.is_forecast_authoritative !== undefined ? details.is_forecast_authoritative : false;
    diag.is_estimated = details.is_estimated !== undefined ? details.is_estimated : false;
    diag.is_test_fixture = details.is_test_fixture !== undefined ? details.is_test_fixture : false;
    diag.productId = details.productId || null;
    diag.pointProductId = details.productId || null;
    diag.gridProductId = diag.lastGridFetch?.productId || null;
    diag.source = details.source || 'network';

    if (details.error) {
      diag.reason = details.error === 'unsupported' ? 'unsupported_model_layer' : 'fallback_legacy';
    } else {
      diag.reason = 'backend_success';
    }
  }

  diag.activeModel = model.toUpperCase();
  diag.activeLayer = diag.layer;

  if (details.hourOffset !== undefined) {
    diag.requestedHour = details.hourOffset;
    diag.validTime = getSharedValidTime(details.hourOffset, diag.layer, model);
  }

  // Inject computed nearest manifest time match diagnostics
  const timeDiag = latestTimeDiag[`${model.toUpperCase()}_${diag.layer}`] || {};
  diag.requestedValidTime = timeDiag.requestedValidTime;
  diag.selectedManifestValidTime = timeDiag.selectedManifestValidTime;
  diag.manifestDeltaHours = timeDiag.manifestDeltaHours;
  diag.timeFallbackReason = timeDiag.fallbackReason;

  // Recalculate parity
  diag.parity = diag.pointValidTime 
    ? (diag.gridValidTime === diag.pointValidTime) 
    : 'pending_point_fetch';
  diag.pointParity = diag.parity;
}

/**
 * Fetches exact point forecast from backend weather service.
 */
export async function fetchBackendExactPoint(lat, lng, hourOffset, signal, layer = 'waves', model = 'GFS') {
  if (model === 'ICON' && layer === 'swell_2') {
    return {
      status: 'unsupported',
      hourly: {
        time: [getSharedValidTime(hourOffset, 'swell_2', 'ICON')],
        secondary_swell_wave_height: [null],
        secondary_swell_wave_direction: [null],
        secondary_swell_wave_period: [null]
      },
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: 'ICON',
      activeLayer: 'swell_2',
      provider: 'none',
      source: 'unsupported_model_layer',
      is_estimated: false,
      warnings: ['unsupported_model_layer']
    };
  }

  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, layer, model);
  const provider = model === 'EURO' ? 'copernicus' : 'open-meteo';
  const cacheKey = `${model}_marine_${layer}_${lat.toFixed(2)}_${lng.toFixed(2)}_${validTimeStr}_${provider}`;

  console.log("fetchBackendExactPoint: cacheKey:", cacheKey, "size:", pointCache.cache.size, "keys:", Array.from(pointCache.cache.keys()));
  const cached = pointCache.get(cacheKey);
  if (cached) {
    console.log(`[Backend Weather Service] Cache hit for ${model} Marine: ${cacheKey}`);
    const clonedData = JSON.parse(JSON.stringify(cached.data));
    clonedData.source = 'cache';
    updateDiagnostics('point', { ...cached.details, source: 'cache' }, model);
    return clonedData;
  }

  const url = `${POINT_URL}?model=${model}&domain=marine&layer=${layer}&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      let reason = `Backend point returned HTTP ${res.status}`;
      let errorJson = null;
      try {
        errorJson = await res.json();
        if (errorJson && errorJson.reason) {
          reason = errorJson.reason;
        } else if (errorJson && errorJson.detail) {
          reason = errorJson.detail;
        }
      } catch (e) {}

      if (reason === 'no_backend_coverage' || reason === 'no_copernicus_coverage') {
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
          layer,
          speed: 0,
          direction: 0,
          interpolationMethod: 'none',
          provider: 'backend-weather-service',
          sourceDataset: null,
          sourceVariables: null,
          is_forecast_authoritative: false,
          is_estimated: false,
          is_test_fixture: false
        };
        updateDiagnostics('point', errorDetails, model);
        return {
          status: reason,
          hourly: { time: [] },
          requestedLat: lat,
          requestedLng: lng,
          requestedModel: model,
          activeLayer: layer,
          provider: 'backend-weather-service',
          source: 'backend_point_api'
        };
      }
      throw new Error(reason);
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

    if (layer === 'waves') {
      conformedHourly.wave_height = [json.point.speed || 0];
      conformedHourly.wave_direction = [json.point.direction || 0];
      conformedHourly.wave_period = [json.point.period || 0];
      conformedHourly.wave_peak_period = [0];
    } else if (layer === 'swell_1') {
      conformedHourly.swell_wave_height = [json.point.speed || 0];
      conformedHourly.swell_wave_direction = [json.point.direction || 0];
      conformedHourly.swell_wave_period = [json.point.period || 0];
      conformedHourly.swell_wave_peak_period = [0];
    } else if (layer === 'swell_2') {
      conformedHourly.secondary_swell_wave_height = [json.point.speed || 0];
      conformedHourly.secondary_swell_wave_direction = [json.point.direction || 0];
      conformedHourly.secondary_swell_wave_period = [json.point.period || 0];
    } else if (layer === 'wind_waves') {
      conformedHourly.wind_wave_height = [json.point.speed || 0];
      conformedHourly.wind_wave_direction = [json.point.direction || 0];
      conformedHourly.wind_wave_period = [json.point.period || 0];
      conformedHourly.wind_wave_peak_period = [0];
    }

    const data = {
      hourly: conformedHourly,
      snappedLat: json.point.sampled_lat || lat,
      snappedLng: json.point.sampled_lng || lng,
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: model,
      activeLayer: layer,
      forecastDays: 1,
      apiModel: model === 'ICON' ? 'gwam' : (model === 'EURO' ? 'ecmwf_wam025' : 'ncep_gfswave025'),
      provider: json.provider || provider,
      source: 'network'
    };

    const details = {
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || (layer === 'swell_1' ? 'swell_wave_height' : 'wave_height'),
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
      provider: json.provider || provider,
      sourceDataset: json.source_dataset,
      sourceVariables: json.source_variables,
      is_forecast_authoritative: json.is_forecast_authoritative,
      is_estimated: json.is_estimated,
      is_test_fixture: json.is_test_fixture,
      productId: json.product_id || null,
      pointProductId: json.product_id || null,
      source: 'network'
    };

    pointCache.set(cacheKey, { data, details });

    updateDiagnostics('point', details, model);

    return data;
  } catch (err) {
    const status = err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500;
    updateDiagnostics('point', {
      url,
      status,
      validTime: validTimeStr,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: err.message,
      hourOffset,
      layer,
      speed: 0,
      direction: 0,
      interpolationMethod: 'none',
      provider: 'none',
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false
    }, model);
    console.error(`[Backend Weather Service] Point fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    throw err;
  }
}

/**
 * Fetches marine forecast grid from backend weather service.
 */
export async function fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, layer = 'waves', model = 'GFS') {
  if (model === 'ICON' && layer === 'swell_2') {
    return {
      type: 'FeatureCollection',
      features: [],
      hourOffset,
      grid: {
        vectors: [],
        bounds: snappedBounds || { west: -180, south: -80, east: 180, north: 85 },
        cols: 0,
        rows: 0,
        timestamp: Date.now(),
        __sourceModel: 'ICON',
        __provider: 'none',
        __gridProvider: 'none',
        __componentLayer: 'swell_2',
        __gridSupportsLayer: false,
        __activeLayerNonzeroCount: 0,
        __activeLayerMax: 0,
        __oceanMaskCount: 0,
        __renderable: false,
        __unsupportedLayer: true,
        provider: 'none',
        hourOffset,
        nonzeroCount: 0,
        maxSpeed: 0,
        renderable: false,
        status: 'unsupported'
      },
      __renderable: false,
      __unsupportedLayer: true,
      status: 'unsupported'
    };
  }

  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, layer, model);

  // 1. Resolve actual viewport bounds for coverage check
  // Use the explicit bounds parameter (actual viewport), falling back to map instance bounds
  let actualBounds = bounds;
  if (!actualBounds || (Math.abs((actualBounds.east || 0) - (actualBounds.west || 0)) > 300)) {
    try {
      if (typeof window !== 'undefined' && window.map && typeof window.map.getBounds === 'function') {
        const mb = window.map.getBounds();
        actualBounds = {
          west: mb.getWest(),
          south: mb.getSouth(),
          east: mb.getEast(),
          north: mb.getNorth()
        };
      }
    } catch (e) {
      // Fall through to original bounds
    }
  }

  // 2. Perform Bbox Clamping and Coverage verification against actual viewport
  const clampResult = clampViewportBbox(actualBounds || snappedBounds, layer);
  if (!clampResult.isInside) {
    const errorDetails = {
      url: 'none',
      status: 0,
      validTime: validTimeStr,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: clampResult.fallbackReason,
      requestedBbox: actualBounds || snappedBounds,
      clampedBbox: null,
      fallbackReason: clampResult.fallbackReason,
      hourOffset,
      coverageInside: false,
      layer
    };
    updateDiagnostics('grid', errorDetails, model);
    throw new Error(clampResult.fallbackReason);
  }

  const { clampedBbox } = clampResult;
  const bboxParam = `${clampedBbox.west},${clampedBbox.south},${clampedBbox.east},${clampedBbox.north}`;
  const url = `${GRID_URL}?model=${model}&domain=marine&layer=${layer}&valid_time=${validTimeStr}&bbox=${bboxParam}`;

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
    const result = mapNormalizedGridToWebGL(json, clampedBbox, hourOffset, layer, model);

    updateDiagnostics('grid', {
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || (layer === 'swell_1' ? 'swell_wave_height' : 'wave_height'),
      valueUnit: json.value_unit || 'm',
      displayUnitHint: json.display_unit_hint || 'ft',
      elapsedMs: Date.now() - start,
      error: null,
      requestedBbox: snappedBounds,
      clampedBbox,
      fallbackReason: null,
      hourOffset,
      layer,
      gridVectorCount: result.grid.vectors.length,
      nonzeroCount: result.grid.nonzeroCount,
      renderable: result.grid.renderable,
      provider: json.provider,
      sourceDataset: json.source_dataset,
      sourceVariables: json.source_variables,
      is_forecast_authoritative: json.is_forecast_authoritative,
      is_estimated: json.is_estimated,
      is_test_fixture: json.is_test_fixture,
      gridMode: json.grid?.diagnostics?.gridMode || 'rectangular',
      productId: json.product_id || null
    }, model);

    return result;
  } catch (err) {
    const errorDetails = {
      url,
      status: err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500,
      validTime: validTimeStr,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: err.message,
      requestedBbox: snappedBounds,
      clampedBbox,
      fallbackReason: err.message,
      hourOffset,
      layer,
      provider: 'backend-weather-service',
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false
    };
    updateDiagnostics('grid', errorDetails, model);
    console.error(`[Backend Weather Service] Grid fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    throw err;
  }
}

export * from './backendWindServiceClient';
export * from './backendCopernicusServiceClient';



