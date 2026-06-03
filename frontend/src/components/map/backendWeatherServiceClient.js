/**
 * backendWeatherServiceClient.js
 * 
 * Dedicated client adapter for the Backend-Owned Weather Data Service.
 * Decouples the frontend controllers from feature flag checks, shared valid_time
 * computations, bounding box dynamic clamping, diagnostics telemetry updates,
 * and WebGL layer grid normalizations.
 */

import { BACKEND_URL } from '../../lib/apiClient';

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

let latestTimeDiag = {
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
 * Resolves the weather service feature flag.
 * Disabled by default. Can be overridden in console or localStorage.
 */
export function getBackendWeatherFlag() {
  if (typeof window === 'undefined') return false;
  if (window.__USE_BACKEND_WEATHER_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_WEATHER_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_WEATHER_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  return process.env.REACT_APP_USE_BACKEND_WEATHER === 'true';
}

/**
 * Resolves the backend wind service feature flag.
 */
export function getBackendWindFlag() {
  if (typeof window === 'undefined') return false;
  if (window.__USE_BACKEND_WIND_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_WIND_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_WIND_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  return process.env.REACT_APP_USE_BACKEND_WIND === 'true';
}

/**
 * Resolves the backend Copernicus service feature flag.
 */
export function getBackendCopernicusFlag() {
  if (typeof window === 'undefined') return false;
  if (window.__USE_BACKEND_COPERNICUS_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_COPERNICUS_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_COPERNICUS_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  return process.env.REACT_APP_USE_BACKEND_COPERNICUS === 'true';
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
export function mapNormalizedGridToWebGL(json, snappedBounds, hourOffset) {
  if (!json || !json.grid || !Array.isArray(json.grid.vectors)) {
    throw new Error("Invalid normalized grid response structure");
  }

  const mappedVectors = json.grid.vectors.map(v => ({
    lat: v.lat,
    lng: v.lng,
    isOcean: true,
    waves: {
      u: v.u || 0,
      v: v.v || 0,
      speed: v.speed || 0,
      period: v.period || 0
    },
    swell_1: { u: 0, v: 0, speed: 0, period: 0 },
    swell_2: { u: 0, v: 0, speed: 0, period: 0 },
    wind_waves: { u: 0, v: 0, speed: 0, period: 0 }
  }));

  const nonzeroCount = mappedVectors.filter(v => v.waves.speed > 0).length;
  const maxSpeed = mappedVectors.length > 0 ? Math.max(...mappedVectors.map(v => v.waves.speed), 0) : 0;
  
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
      __sourceModel: 'GFS',
      __provider: json.provider || 'backend-weather-service',
      __gridProvider: json.provider || 'backend-weather-service',
      __componentLayer: 'waves',
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

// Global Diagnostics Telemetry Initializer
if (typeof window !== 'undefined') {
  window.__BACKEND_WEATHER_SERVICE_DIAG__ = window.__BACKEND_WEATHER_SERVICE_DIAG__ || {
    featureFlagActive: getBackendWeatherFlag(),
    activeModel: 'GFS',
    activeLayer: 'waves',
    backendUrl: BACKEND_URL,
    statusUrl: STATUS_URL,
    gridUrl: GRID_URL,
    pointUrl: POINT_URL,
    requestedHour: null,
    validTime: null,
    gridValidTime: null,
    pointValidTime: null,
    parity: 'pending_point_fetch',
    requestedBbox: null,
    clampedBbox: null,
    coverage: PILOT_COVERAGE,
    fallbackReason: null,
    lastGridFetch: null,
    lastPointFetch: null,
    // Coverage diagnostics
    coverageInside: true,
    fallbackToLegacy: false,
    reason: null,
    // Time diagnostics
    requestedValidTime: null,
    selectedManifestValidTime: null,
    manifestDeltaHours: null
  };
}

/**
 * Updates the global diagnostics telemetry registry.
 */
export function updateDiagnostics(type, details) {
  if (typeof window === 'undefined') return;

  if (!window.__BACKEND_WEATHER_SERVICE_DIAG__) {
    window.__BACKEND_WEATHER_SERVICE_DIAG__ = {
      featureFlagActive: getBackendWeatherFlag(),
      activeModel: 'GFS',
      activeLayer: 'waves',
      backendUrl: BACKEND_URL,
      statusUrl: STATUS_URL,
      gridUrl: GRID_URL,
      pointUrl: POINT_URL,
      requestedHour: null,
      validTime: null,
      gridValidTime: null,
      pointValidTime: null,
      parity: 'pending_point_fetch',
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
      manifestDeltaHours: null
    };
  }

  const diag = window.__BACKEND_WEATHER_SERVICE_DIAG__;
  diag.featureFlagActive = getBackendWeatherFlag();

  if (type === 'grid') {
    diag.lastGridFetch = details;
    diag.gridValidTime = details.validTime;
    diag.requestedBbox = details.requestedBbox;
    diag.clampedBbox = details.clampedBbox;
    diag.fallbackReason = details.fallbackReason || null;

    // Handle coverage flags and fallback telemetry
    const isInside = details.coverageInside !== undefined 
      ? details.coverageInside 
      : (details.clampedBbox !== null && !details.error?.includes('outside'));
      
    diag.coverageInside = isInside;
    diag.fallbackToLegacy = !isInside;
    diag.reason = !isInside ? 'outside_pilot_coverage' : null;
  } else if (type === 'point') {
    diag.lastPointFetch = details;
    diag.pointValidTime = details.validTime;
  }

  if (details.hourOffset !== undefined) {
    diag.requestedHour = details.hourOffset;
    // Calling getSharedValidTime refreshes latestTimeDiag state
    diag.validTime = getSharedValidTime(details.hourOffset);
  }

  // Inject computed nearest manifest time match diagnostics
  const timeDiag = latestTimeDiag['GFS_waves'] || {};
  diag.requestedValidTime = timeDiag.requestedValidTime;
  diag.selectedManifestValidTime = timeDiag.selectedManifestValidTime;
  diag.manifestDeltaHours = timeDiag.manifestDeltaHours;
  diag.timeFallbackReason = timeDiag.fallbackReason;

  // Recalculate parity
  diag.parity = diag.pointValidTime 
    ? (diag.gridValidTime === diag.pointValidTime) 
    : 'pending_point_fetch';
}

/**
 * Fetches exact point forecast from backend weather service.
 */
export async function fetchBackendExactPoint(lat, lng, hourOffset, signal) {
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset);
  const url = `${POINT_URL}?model=GFS&domain=marine&layer=waves&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`Backend point returned HTTP ${res.status}`);
    }
    const json = await res.json();
    
    // Structure mock hourly response compatible with forecastSamplers.js expectances
    const mockTime = validTimeStr.replace(/\.\d+Z$/, 'Z');
    const mockHourly = {
      time: [mockTime],
      wave_height: [json.point.speed || 0],
      wave_direction: [json.point.direction || 0],
      wave_period: [json.point.period || 0],
      wave_peak_period: [json.point.period || 0],
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

    const data = {
      hourly: mockHourly,
      snappedLat: json.point.sampled_lat || lat,
      snappedLng: json.point.sampled_lng || lng,
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: 'GFS',
      activeLayer: 'waves',
      forecastDays: 1,
      apiModel: 'ncep_gfswave025',
      provider: json.provider || 'backend-weather-service',
      source: 'backend_point_api'
    };

    updateDiagnostics('point', {
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || 'wave_height',
      valueUnit: json.value_unit || 'm',
      displayUnitHint: json.display_unit_hint || 'ft',
      elapsedMs: Date.now() - start,
      error: null,
      hourOffset
    });

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
      hourOffset
    });
    console.error(`[Backend Weather Service] Point fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    throw err;
  }
}

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
      waves: zeroVec,
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
  } else if (type === 'point') {
    diag.lastPointFetch = details;
    diag.pointValidTime = details.validTime || null;

    diag.provider = details.provider || diag.provider;
    diag.sourceDataset = details.sourceDataset || null;
    diag.sourceVariables = details.sourceVariables || null;
    diag.is_forecast_authoritative = details.is_forecast_authoritative !== undefined ? details.is_forecast_authoritative : false;
    diag.is_estimated = details.is_estimated !== undefined ? details.is_estimated : false;
    diag.is_test_fixture = details.is_test_fixture !== undefined ? details.is_test_fixture : false;
  }

  if (details.hourOffset !== undefined) {
    getSharedValidTime(details.hourOffset, 'swell_1', 'EURO');
  }

  const timeDiag = latestTimeDiag['EURO_swell_1'] || {};
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
 * Fetches EURO Copernicus swell_1 grid forecast from backend weather service.
 */
export async function fetchBackendCopernicusGrid(bounds, hourOffset, signal, snappedBounds, boundsSource = "controller") {
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, 'swell_1', 'EURO');

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

  const clampResult = clampViewportBbox(actualBounds, 'swell_1');
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
    updateCopernicusDiagnostics('grid', errorDetails);
    throw new Error(clampResult.fallbackReason);
  }

  const { clampedBbox } = clampResult;
  const bboxParam = `${clampedBbox.west},${clampedBbox.south},${clampedBbox.east},${clampedBbox.north}`;
  const url = `${GRID_URL}?model=EURO&domain=marine&layer=swell_1&valid_time=${validTimeStr}&bbox=${bboxParam}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`Backend returned HTTP ${res.status}`);
    }
    const json = await res.json();
    const result = mapNormalizedCopernicusGridToWebGL(json, clampedBbox, hourOffset, 'swell_1');

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
      gridMode: json.grid?.diagnostics?.gridMode || 'rectangular'
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
      is_test_fixture: false
    };
    updateCopernicusDiagnostics('grid', errorDetails);
    console.error(`[Backend Weather Service] Copernicus grid fetch error: ${err.message}.`);
    throw err;
  }
}

/**
 * Fetches exact point forecast from backend weather service for EURO Copernicus swell_1.
 */
export async function fetchBackendExactCopernicusPoint(lat, lng, hourOffset, signal) {
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, 'swell_1', 'EURO');
  const url = `${POINT_URL}?model=EURO&domain=marine&layer=swell_1&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`Backend point returned HTTP ${res.status}`);
    }
    const json = await res.json();
    
    // Structure mock hourly response compatible with forecastSamplers.js expectances
    const mockTime = validTimeStr.replace(/\.\d+Z$/, 'Z');
    const mockHourly = {
      time: [mockTime],
      wave_height: [0],
      wave_direction: [0],
      wave_period: [0],
      wave_peak_period: [0],
      swell_wave_height: [json.point.speed || 0],
      swell_wave_direction: [json.point.direction || 0],
      swell_wave_period: [json.point.period || 0],
      swell_wave_peak_period: [json.point.period || 0],
      secondary_swell_wave_height: [0],
      secondary_swell_wave_direction: [0],
      secondary_swell_wave_period: [0],
      wind_wave_height: [0],
      wind_wave_direction: [0],
      wind_wave_period: [0],
      wind_wave_peak_period: [0]
    };

    const data = {
      hourly: mockHourly,
      snappedLat: json.point.sampled_lat || lat,
      snappedLng: json.point.sampled_lng || lng,
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: 'EURO',
      activeLayer: 'swell_1',
      forecastDays: 1,
      apiModel: 'ecmwf_wam025',
      provider: json.provider || 'backend-weather-service',
      source: 'backend_point_api'
    };

    updateCopernicusDiagnostics('point', {
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || 'swell_wave_height',
      valueUnit: json.value_unit || 'm',
      displayUnitHint: json.display_unit_hint || 'ft',
      elapsedMs: Date.now() - start,
      error: null,
      hourOffset,
      speed: json.point.speed || 0,
      direction: json.point.direction || 0,
      interpolationMethod: json.point.interpolation_method || 'bilinear',
      interpolation_method: json.point.interpolation_method || 'bilinear',
      provider: json.provider || 'backend-weather-service',
      sourceDataset: json.source_dataset,
      sourceVariables: json.source_variables,
      is_forecast_authoritative: json.is_forecast_authoritative,
      is_estimated: json.is_estimated,
      is_test_fixture: json.is_test_fixture
    });

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
      is_test_fixture: false
    });
    console.error(`[Backend Weather Service] Copernicus point fetch error: ${err.message}.`);
    throw err;
  }
}


