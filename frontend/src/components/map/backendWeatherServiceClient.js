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
  requestedValidTime: null,
  selectedManifestValidTime: null,
  manifestDeltaHours: null,
  fallbackReason: null
};

/**
 * Direct setter to mock cached manifest registry during unit tests.
 */
export function setCachedManifest(manifest) {
  cachedManifest = manifest;
}

/**
 * Fetches the products manifest from the backend registry.
 */
export async function fetchProductsManifest() {
  if (cachedManifest) return cachedManifest;
  if (manifestFetchPromise) return manifestFetchPromise;

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
 * Computes a standardized snapped UTC ISO string from hourOffset.
 * Resolves the nearest valid_time from cachedManifest when available (max 3h delta).
 * Provides the single source of authority for matching grid/point time dimensions.
 */
export function getSharedValidTime(timeOffsetHours) {
  const roundedNow = Math.round(Date.now() / 3600000) * 3600000;
  const targetDt = new Date(roundedNow + timeOffsetHours * 3600000);
  const requestedValidTime = targetDt.toISOString();

  let selectedManifestValidTime = null;
  let manifestDeltaHours = null;
  let fallbackReason = null;

  if (cachedManifest && Array.isArray(cachedManifest.products)) {
    const matchingProducts = cachedManifest.products.filter(p => 
      p.model.toUpperCase() === 'GFS' &&
      p.domain.toLowerCase() === 'marine' &&
      p.layer.toLowerCase() === 'waves'
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
        fallbackReason = `No GFS waves product within 3 hours delta limit (${(minDiffMs / 3600000).toFixed(1)}h delta)`;
      }
    } else {
      fallbackReason = "No GFS waves products found matching GFS model/marine domain/waves layer";
    }
  } else {
    fallbackReason = "Manifest is not yet loaded or invalid; using snapped target valid time as fallback";
    // Prefetch manifest in background
    fetchProductsManifest().catch(() => {});
  }

  latestTimeDiag = {
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
export function clampViewportBbox(requestedBbox) {
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
    return {
      isInside: false,
      clampedBbox: null,
      fallbackReason: "Requested viewport completely outside GFS Waves pilot coverage area"
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
    parity: false,
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
      parity: false,
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
  diag.requestedValidTime = latestTimeDiag.requestedValidTime;
  diag.selectedManifestValidTime = latestTimeDiag.selectedManifestValidTime;
  diag.manifestDeltaHours = latestTimeDiag.manifestDeltaHours;
  diag.timeFallbackReason = latestTimeDiag.fallbackReason;

  // Recalculate parity
  diag.parity = !!(diag.gridValidTime && diag.pointValidTime && diag.gridValidTime === diag.pointValidTime);
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
