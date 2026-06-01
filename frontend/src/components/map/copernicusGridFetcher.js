/**
 * copernicusGridFetcher.js — v6.5
 *
 * Fetches a viewport-bounded Copernicus regional grid for EURO component layers
 * (swell_1, swell_2, wind_waves). Returns data in the same shape as
 * extractMarineAtOffset() from marineController.js.
 *
 * Safety constraints:
 *   - Max 11×11 = 121 grid points
 *   - Only requests the 3 variables for the active layer
 *   - forecast_days = 1 (current + 24h)
 *   - Min zoom = 4 (prevents huge bbox)
 *   - No global grids — always viewport-bounded
 */

import { governMarineRequest } from './marineRequestGovernor';

// Maps marine layer → Copernicus/Open-Meteo variable names
var COPERNICUS_LAYER_VARS = {
  swell_1:    ['swell_wave_height', 'swell_wave_direction', 'swell_wave_period'],
  swell_2:    ['secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period'],
  wind_waves: ['wind_wave_height', 'wind_wave_direction', 'wind_wave_period'],
};

// Maps layer → field name prefixes for grid vector construction
var LAYER_FIELD_MAP = {
  swell_1:    { height: 'swell_wave_height', direction: 'swell_wave_direction', period: 'swell_wave_period' },
  swell_2:    { height: 'secondary_swell_wave_height', direction: 'secondary_swell_wave_direction', period: 'secondary_swell_wave_period' },
  wind_waves: { height: 'wind_wave_height', direction: 'wind_wave_direction', period: 'wind_wave_period' },
};

var COMPONENT_LAYERS = ['swell_1', 'swell_2', 'wind_waves'];
var MAX_GRID = 9; // Optimized to 9x9 (81 points) for fast, sub-2.5s rendering and reduced memory footprint
var MIN_ZOOM = 4;

export var COPERNICUS_COMPONENT_GRID_SIZE = 9; // Hard production-safe cap for CMEMS network requests
export var COPERNICUS_UPSCALED_GRID_SIZE = 25; // Client-side dynamic upscaling size for WebGL smoothness

// Client-side regional grid cache & in-flight requests Map
var clientGridCache = new Map();
var CLIENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
var inFlightRequests = new Map();

function getClientCacheKey(viewportBounds, layer, hourOffset, zoom) {
  var latCenter = (viewportBounds.north + viewportBounds.south) / 2;
  var lonCenter = (viewportBounds.east + viewportBounds.west) / 2;
  // Round center to 1 decimal place to cache stable regional clusters (~11km shifts)
  var roundedLat = Math.round(latCenter * 10) / 10;
  var roundedLon = Math.round(lonCenter * 10) / 10;
  var zoomBucket = Math.floor(zoom);
  return `${roundedLat}:${roundedLon}:${zoomBucket}:${layer}:${hourOffset}`;
}

function upscaleGrid(originalGrid, targetSize) {
  if (!originalGrid || !originalGrid.grid || !originalGrid.grid.vectors) return originalGrid;
  
  var originalSize = originalGrid.grid.cols;
  var originalVectors = originalGrid.grid.vectors;
  var bounds = originalGrid.grid.bounds;
  
  var latMin = bounds.south;
  var latMax = bounds.north;
  var lonMin = bounds.west;
  var lonMax = bounds.east;
  
  var latStep = (latMax - latMin) / (targetSize - 1);
  var lonStep = (lonMax - lonMin) / (targetSize - 1);
  
  var upscaledVectors = [];
  
  for (var r = 0; r < targetSize; r++) {
    for (var c = 0; c < targetSize; c++) {
      var pctY = r / (targetSize - 1);
      var pctX = c / (targetSize - 1);
      
      var origR = pctY * (originalSize - 1);
      var origC = pctX * (originalSize - 1);
      
      var r0 = Math.floor(origR);
      var r1 = Math.min(originalSize - 1, r0 + 1);
      var c0 = Math.floor(origC);
      var c1 = Math.min(originalSize - 1, c0 + 1);
      
      var weightY = origR - r0;
      var weightX = origC - c0;
      
      var v00 = originalVectors[r0 * originalSize + c0];
      var v10 = originalVectors[r1 * originalSize + c0];
      var v01 = originalVectors[r0 * originalSize + c1];
      var v11 = originalVectors[r1 * originalSize + c1];
      
      var interp = function(getVal) {
        var val00 = getVal(v00);
        var val10 = getVal(v10);
        var val01 = getVal(v01);
        var val11 = getVal(v11);
        
        var val0 = val00 * (1 - weightX) + val01 * weightX;
        var val1 = val10 * (1 - weightX) + val11 * weightX;
        return val0 * (1 - weightY) + val1 * weightY;
      };
      
      var isOcean = (v00 && v00.isOcean) || (v10 && v10.isOcean) || (v01 && v01.isOcean) || (v11 && v11.isOcean);
      
      var upscaledVec = {
        lat: latMin + r * latStep,
        lng: lonMin + c * lonStep,
        isOcean: isOcean
      };
      
      var LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
      LAYERS.forEach(function(l) {
        var speed = interp(function(v) { return v[l]?.speed || 0; });
        var u = interp(function(v) { return v[l]?.u || 0; });
        var v_y = interp(function(v) { return v[l]?.v || 0; });
        var period = interp(function(v) { return v[l]?.period || 0; });
        
        upscaledVec[l] = { u, v: v_y, speed, period };
      });
      
      upscaledVectors.push(upscaledVec);
    }
  }
  
  return {
    ...originalGrid,
    grid: {
      ...originalGrid.grid,
      vectors: upscaledVectors,
      cols: targetSize,
      rows: targetSize
    }
  };
}

function safeNum(v) { return (v != null && isFinite(v)) ? v : 0; }

function getUV(speed, dirDeg) {
  if (speed === 0) return { u: 0, v: 0, speed: 0 };
  var rad = (dirDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
}

/**
 * Compute a regular lat/lon grid within the given viewport bounds.
 * Returns at most MAX_GRID × MAX_GRID = 121 points.
 */
function computeRegionalGrid(bounds, gridSize) {
  var latMin = Math.max(-80, bounds.south);
  var latMax = Math.min(85, bounds.north);
  var lonMin = bounds.west;
  var lonMax = bounds.east;

  // Handle antimeridian wrap
  if (lonMax < lonMin) lonMax += 360;

  var latStep = (latMax - latMin) / (gridSize - 1);
  var lonStep = (lonMax - lonMin) / (gridSize - 1);
  var points = [];

  for (var r = 0; r < gridSize; r++) {
    for (var c = 0; c < gridSize; c++) {
      var lat = latMin + r * latStep;
      var lng = lonMin + c * lonStep;
      // Normalize longitude to [-180, 180]
      var normLng = lng;
      if (normLng > 180) normLng -= 360;
      if (normLng < -180) normLng += 360;
      points.push({ lat, lng: normLng, monotonicLng: lng });
    }
  }

  return {
    points,
    gridSize: gridSize,
    bounds: { west: lonMin, south: latMin, east: lonMax, north: latMax }
  };
}

/**
 * Find the closest hour index in a time array to the target timestamp.
 */
function findClosestHourIndex(timeArray, targetMs) {
  var bestIdx = 0, minDiff = Infinity;
  for (var i = 0; i < timeArray.length; i++) {
    var diff = Math.abs(new Date(timeArray[i] + 'Z').getTime() - targetMs);
    if (diff < minDiff) { minDiff = diff; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Clamp bounds around their geographic center if they exceed the maximum safe dimensions (30° lat x 60° lon) for the Copernicus backend.
 */
function clampBounds(bounds) {
  var latMin = bounds.south;
  var latMax = bounds.north;
  var lonMin = bounds.west;
  var lonMax = bounds.east;

  // Handle wrap
  if (lonMax < lonMin) lonMax += 360;

  var latCenter = (latMax + latMin) / 2;
  var lonCenter = (lonMax + lonMin) / 2;

  var latDiff = latMax - latMin;
  var lonDiff = lonMax - lonMin;

  var clampedSouth = latMin;
  var clampedNorth = latMax;
  var clampedWest = lonMin;
  var clampedEast = lonMax;

  var isClamped = false;

  if (latDiff > 30) {
    clampedSouth = latCenter - 15;
    clampedNorth = latCenter + 15;
    isClamped = true;
  }
  if (lonDiff > 60) {
    clampedWest = lonCenter - 30;
    clampedEast = lonCenter + 30;
    isClamped = true;
  }

  // Normalize lon to [-180, 180]
  if (clampedWest > 180) clampedWest -= 360;
  if (clampedWest < -180) clampedWest += 360;
  if (clampedEast > 180) clampedEast -= 360;
  if (clampedEast < -180) clampedEast += 360;

  return {
    bounds: { west: clampedWest, south: clampedSouth, east: clampedEast, north: clampedNorth },
    isClamped: isClamped
  };
}

async function doFetchAndUpscale(viewportBounds, layer, hourOffset, zoom, cacheKey) {
  var startTime = Date.now();
  var vars = COPERNICUS_LAYER_VARS[layer];
  var fields = LAYER_FIELD_MAP[layer];

  // Cap grid size at safe production grid size (9x9)
  var gridSize = COPERNICUS_COMPONENT_GRID_SIZE;
  var { bounds: clampedBBox, isClamped } = clampBounds(viewportBounds);
  var { points, bounds } = computeRegionalGrid(clampedBBox, gridSize);
  var lats = points.map(function(p) { return p.lat; });
  var lons = points.map(function(p) { return p.lng; });

  var forecastDays = Math.min(3, Math.max(1, Math.ceil((hourOffset + 1) / 24)));
  var body = {
    latitude: lats,
    longitude: lons,
    hourly: vars,
    forecast_days: forecastDays,
    models: ['ecmwf_wam025']
  };

  console.log(`[CopernicusGrid] Fetching ${layer} regional: ${points.length} pts, clamped=${isClamped}`);

  var res = await governMarineRequest({
    source: 'copernicusGridFetcher.doFetchAndUpscale',
    type: 'copernicus_marine',
    body: body,
    model: 'EURO',
    layer: layer,
    category: 'copernicus_grid'
  });

  if (!res.ok) {
    console.error(`[CopernicusGrid] HTTP ${res.status} for ${layer}`);
    var skippedReason = 'backend_error';
    var detail = 'unknown';
    try {
      var errJson = await res.json();
      detail = errJson.detail || errJson.message || errJson.error || 'unknown';
    } catch (e) {
      try {
        detail = await res.text();
      } catch (e2) {}
    }

    if (res.status === 503 || (typeof detail === 'string' && detail.toLowerCase().includes('credentials'))) {
      skippedReason = 'copernicus_credentials_missing';
    } else if (res.status === 502) {
      if (typeof detail === 'string' && detail.toLowerCase().includes('timeout')) {
        skippedReason = 'copernicus_timeout';
      } else {
        skippedReason = 'copernicus_backend_502';
      }
    } else if (res.status === 504 || (typeof detail === 'string' && detail.toLowerCase().includes('gateway timeout'))) {
      skippedReason = 'copernicus_timeout';
    }

    if (typeof window !== 'undefined') {
      window.__COPERNICUS_GRID_DIAG__ = {
        layer,
        componentLayer: layer,
        provider: 'copernicus',
        backendPointCount: gridSize * gridSize,
        renderPointCount: COPERNICUS_UPSCALED_GRID_SIZE * COPERNICUS_UPSCALED_GRID_SIZE,
        nonzeroCount: 0,
        bbox: bounds,
        zoom,
        cacheHit: false,
        isStale: false,
        elapsedMs: Date.now() - startTime,
        skipped: true,
        skippedReason: skippedReason,
        httpStatus: res.status,
        errorDetail: detail,
        timestamp: new Date().toISOString()
      };
    }
    throw new Error(`HTTP ${res.status}: ${skippedReason}`);
  }

  var json = await res.json();
  var results = Array.isArray(json) ? json : null;
  if (!results || results.length === 0) {
    if (typeof window !== 'undefined') {
      window.__COPERNICUS_GRID_DIAG__ = {
        layer,
        componentLayer: layer,
        provider: 'copernicus',
        backendPointCount: gridSize * gridSize,
        renderPointCount: COPERNICUS_UPSCALED_GRID_SIZE * COPERNICUS_UPSCALED_GRID_SIZE,
        nonzeroCount: 0,
        bbox: bounds,
        zoom,
        cacheHit: false,
        isStale: false,
        elapsedMs: Date.now() - startTime,
        skipped: true,
        skippedReason: 'empty_backend_results',
        timestamp: new Date().toISOString()
      };
    }
    throw new Error('empty_backend_results');
  }

  var timeArray = results[0]?.hourly?.time;
  if (!timeArray || timeArray.length === 0) {
    if (typeof window !== 'undefined') {
      window.__COPERNICUS_GRID_DIAG__ = {
        layer,
        componentLayer: layer,
        provider: 'copernicus',
        backendPointCount: gridSize * gridSize,
        renderPointCount: COPERNICUS_UPSCALED_GRID_SIZE * COPERNICUS_UPSCALED_GRID_SIZE,
        nonzeroCount: 0,
        bbox: bounds,
        zoom,
        cacheHit: false,
        isStale: false,
        elapsedMs: Date.now() - startTime,
        skipped: true,
        skippedReason: 'copernicus_empty_time_range',
        timestamp: new Date().toISOString()
      };
    }
    throw new Error('copernicus_empty_time_range');
  }
  var targetMs = Date.now() + hourOffset * 3600000;
  var idx = findClosestHourIndex(timeArray, targetMs);

  var gridVectors = [];
  var features = [];
  var nonzeroCount = 0;

  points.forEach(function(pt, i) {
    var r = results[i];
    if (!r?.hourly) {
      gridVectors.push({
        lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0, period: 0 },
        swell_1: { u: 0, v: 0, speed: 0, period: 0 },
        swell_2: { u: 0, v: 0, speed: 0, period: 0 },
        wind_waves: { u: 0, v: 0, speed: 0, period: 0 },
        isOcean: false
      });
      return;
    }

    var height = r.hourly[fields.height]?.[idx];
    var direction = r.hourly[fields.direction]?.[idx];
    var period = r.hourly[fields.period]?.[idx];
    var h = safeNum(height != null ? height : 0);
    var d = safeNum(direction != null ? direction : 0);
    var p = safeNum(period != null ? period : 0);
    var isOcean = height != null;
    if (h > 0) nonzeroCount++;

    var componentUV = { ...getUV(h, d), period: p };
    var zeroVec = { u: 0, v: 0, speed: 0, period: 0 };

    var vec = {
      lat: pt.lat, lng: pt.monotonicLng,
      waves: zeroVec,
      swell_1: layer === 'swell_1' ? componentUV : zeroVec,
      swell_2: layer === 'swell_2' ? componentUV : zeroVec,
      wind_waves: layer === 'wind_waves' ? componentUV : zeroVec,
      isOcean: isOcean
    };
    gridVectors.push(vec);

    if (isOcean) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pt.monotonicLng, pt.lat] },
        properties: { [fields.height.replace('_height', '')]: h }
      });
    }
  });

  var originalGrid = {
    type: 'FeatureCollection',
    features: features,
    grid: {
      vectors: gridVectors,
      bounds: bounds,
      cols: gridSize,
      rows: gridSize,
      timestamp: Date.now(),
      __sourceModel: 'EURO',
      __provider: 'copernicus',
      __gridProvider: 'copernicus',
      __gridSupportsLayer: true,
      __componentLayer: layer,
      provider: 'copernicus'
    }
  };

  // 2. Perform client-side bilinear upscaling to smooth the visual output
  var upscaled = upscaleGrid(originalGrid, COPERNICUS_UPSCALED_GRID_SIZE);

  // 3. Cache the resulting upscaled grid
  clientGridCache.set(cacheKey, {
    data: upscaled,
    timestamp: Date.now()
  });

  var elapsedMs = Date.now() - startTime;

  if (typeof window !== 'undefined') {
    window.__COPERNICUS_GRID_DIAG__ = {
      layer,
      componentLayer: layer,
      provider: 'copernicus',
      backendPointCount: gridSize * gridSize,
      renderPointCount: COPERNICUS_UPSCALED_GRID_SIZE * COPERNICUS_UPSCALED_GRID_SIZE,
      nonzeroCount,
      bbox: bounds,
      zoom,
      cacheHit: false,
      isStale: false,
      elapsedMs,
      timestamp: new Date().toISOString(),
      skipped: nonzeroCount === 0,
      skippedReason: nonzeroCount === 0 ? 'copernicus_no_nonzero_vectors' : null
    };
  }

  return upscaled;
}

/**
 * Fetch a Copernicus regional grid for a EURO component layer.
 * Incorporates SWR caching and in-flight request deduplication.
 *
 * @param {Object} viewportBounds - { west, south, east, north }
 * @param {string} layer - 'swell_1' | 'swell_2' | 'wind_waves'
 * @param {number} hourOffset - timeline offset in hours
 * @param {number} zoom - current map zoom level
 * @returns {Object|null} Grid data in marineData.grid format, or null on error
 */
export async function fetchCopernicusComponentGrid(viewportBounds, layer, hourOffset, zoom) {
  if (hourOffset > 72) {
    if (typeof window !== 'undefined') {
      window.__COPERNICUS_GRID_DIAG__ = {
        layer,
        componentLayer: layer,
        provider: 'copernicus',
        backendPointCount: 0,
        renderPointCount: 0,
        nonzeroCount: 0,
        bbox: null,
        zoom,
        cacheHit: false,
        isStale: false,
        elapsedMs: 0,
        skipped: true,
        skippedReason: 'past_native_coverage',
        timestamp: new Date().toISOString()
      };
    }
    return null;
  }

  if (!viewportBounds) {
    if (typeof window !== 'undefined') {
      window.__COPERNICUS_GRID_DIAG__ = {
        layer,
        componentLayer: layer,
        provider: 'copernicus',
        backendPointCount: 0,
        renderPointCount: 0,
        nonzeroCount: 0,
        bbox: null,
        zoom,
        cacheHit: false,
        isStale: false,
        elapsedMs: 0,
        skipped: true,
        skippedReason: 'missing_viewport_bounds',
        timestamp: new Date().toISOString()
      };
    }
    return null;
  }
  if (zoom < MIN_ZOOM) {
    console.log(`[CopernicusGrid] Zoom ${zoom} < ${MIN_ZOOM}, skipping component grid`);
    if (typeof window !== 'undefined') {
      window.__COPERNICUS_GRID_DIAG__ = {
        layer,
        componentLayer: layer,
        provider: 'copernicus',
        backendPointCount: 0,
        renderPointCount: 0,
        nonzeroCount: 0,
        bbox: null,
        zoom,
        cacheHit: false,
        isStale: false,
        elapsedMs: 0,
        skipped: true,
        skippedReason: 'zoom_too_low',
        timestamp: new Date().toISOString()
      };
    }
    return null;
  }

  var vars = COPERNICUS_LAYER_VARS[layer];
  var fields = LAYER_FIELD_MAP[layer];
  if (!vars || !fields) {
    if (typeof window !== 'undefined') {
      window.__COPERNICUS_GRID_DIAG__ = {
        layer,
        componentLayer: layer,
        provider: 'copernicus',
        backendPointCount: 0,
        renderPointCount: 0,
        nonzeroCount: 0,
        bbox: null,
        zoom,
        cacheHit: false,
        isStale: false,
        elapsedMs: 0,
        skipped: true,
        skippedReason: 'unsupported_layer_vars',
        timestamp: new Date().toISOString()
      };
    }
    return null;
  }

  var cacheKey = getClientCacheKey(viewportBounds, layer, hourOffset, zoom);
  
  // Clean up expired cache entries periodically
  var now = Date.now();
  for (var [key, entry] of clientGridCache.entries()) {
    if (now - entry.timestamp > CLIENT_CACHE_TTL_MS) {
      clientGridCache.delete(key);
    }
  }

  // 1. Check cache hit
  var cached = clientGridCache.get(cacheKey);
  if (cached) {
    var isExpired = now - cached.timestamp > CLIENT_CACHE_TTL_MS;
    
    // Deterministic nonzeroCount calculation from cached grid
    var nzCount = 0;
    if (cached.data?.grid?.vectors) {
      cached.data.grid.vectors.forEach(function(v) {
        var compVec = v[layer];
        if (compVec && compVec.speed > 0) nzCount++;
      });
    }

    if (!isExpired) {
      console.log(`[CopernicusGrid] Cache HIT for key: ${cacheKey}`);
      if (typeof window !== 'undefined') {
        window.__COPERNICUS_GRID_DIAG__ = {
          layer,
          componentLayer: layer,
          provider: 'copernicus',
          backendPointCount: COPERNICUS_COMPONENT_GRID_SIZE * COPERNICUS_COMPONENT_GRID_SIZE,
          renderPointCount: COPERNICUS_UPSCALED_GRID_SIZE * COPERNICUS_UPSCALED_GRID_SIZE,
          nonzeroCount: nzCount,
          bbox: cached.data?.grid?.bounds || null,
          zoom,
          cacheHit: true,
          isStale: false,
          elapsedMs: 0,
          timestamp: new Date().toISOString(),
          skipped: nzCount === 0,
          skippedReason: nzCount === 0 ? 'copernicus_no_nonzero_vectors' : null
        };
      }
      return cached.data;
    } else {
      console.log(`[CopernicusGrid] Cache STALE hit for key: ${cacheKey}. Revalidating in background.`);
      if (typeof window !== 'undefined') {
        window.__COPERNICUS_GRID_DIAG__ = {
          layer,
          componentLayer: layer,
          provider: 'copernicus',
          backendPointCount: COPERNICUS_COMPONENT_GRID_SIZE * COPERNICUS_COMPONENT_GRID_SIZE,
          renderPointCount: COPERNICUS_UPSCALED_GRID_SIZE * COPERNICUS_UPSCALED_GRID_SIZE,
          nonzeroCount: nzCount,
          bbox: cached.data?.grid?.bounds || null,
          zoom,
          cacheHit: true,
          isStale: true,
          elapsedMs: 0,
          timestamp: new Date().toISOString(),
          skipped: nzCount === 0,
          skippedReason: nzCount === 0 ? 'copernicus_no_nonzero_vectors' : null
        };
      }
      // SWR: trigger in background, don't await, return stale immediately
      triggerBackgroundRevalidate(viewportBounds, layer, hourOffset, zoom, cacheKey);
      return cached.data;
    }
  }

  // 2. Check in-flight requests
  if (inFlightRequests.has(cacheKey)) {
    console.log(`[CopernicusGrid] In-flight request match for key: ${cacheKey}`);
    return inFlightRequests.get(cacheKey);
  }

  // 3. Create a new in-flight request
  var promise = (async () => {
    try {
      var result = await doFetchAndUpscale(viewportBounds, layer, hourOffset, zoom, cacheKey);
      return result;
    } catch (err) {
      console.error(`[CopernicusGrid] Fetch failed for ${layer}:`, err.message);
      return null;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

function triggerBackgroundRevalidate(viewportBounds, layer, hourOffset, zoom, cacheKey) {
  if (inFlightRequests.has(cacheKey)) return;
  
  var promise = (async () => {
    try {
      await doFetchAndUpscale(viewportBounds, layer, hourOffset, zoom, cacheKey);
    } catch (err) {
      console.warn(`[CopernicusGrid] Background SWR refresh failed for ${layer}:`, err.message);
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();
  
  inFlightRequests.set(cacheKey, promise);
}

/**
 * Merge a Copernicus component grid into existing Open-Meteo marineData.
 * Replaces the component layer vectors while preserving the combined waves grid.
 *
 * @param {Object} baseData - marineData from Open-Meteo (has combined waves)
 * @param {Object} componentData - Copernicus regional grid (has component layer)
 * @param {string} layer - 'swell_1' | 'swell_2' | 'wind_waves'
 * @returns {Object} Merged marineData with Copernicus metadata
 */
export function mergeComponentGrid(baseData, componentData, layer) {
  if (!baseData?.grid?.vectors || !componentData?.grid?.vectors) return baseData;

  const cBounds = componentData.grid.bounds;
  const cVectors = componentData.grid.vectors;
  const cCols = componentData.grid.cols;
  const cRows = componentData.grid.rows;

  // Feathering boundary width in degrees
  const featherLat = Math.min(2.0, (cBounds.north - cBounds.south) * 0.15);
  const featherLng = Math.min(2.0, (cBounds.east - cBounds.west) * 0.15);

  const vectors = baseData.grid.vectors.map(v => {
    let lng = v.lng;
    if (lng < cBounds.west && cBounds.west > 180) lng += 360;
    if (lng > cBounds.east && cBounds.east < -180) lng -= 360;

    const inLat = v.lat >= cBounds.south && v.lat <= cBounds.north;
    const inLng = lng >= cBounds.west && lng <= cBounds.east;

    if (!inLat || !inLng) {
      return {
        ...v,
        [layer]: {
          u: v[layer]?.u || 0,
          v: v[layer]?.v || 0,
          speed: v[layer]?.speed || 0,
          period: v[layer]?.period || 0,
          __estimated: true
        }
      };
    }

    // Bilinear interpolation on Copernicus regional grid
    const fx = ((lng - cBounds.west) / (cBounds.east - cBounds.west)) * (cCols - 1);
    const fy = ((v.lat - cBounds.south) / (cBounds.north - cBounds.south)) * (cRows - 1);

    const x0 = Math.floor(fx);
    const x1 = Math.min(cCols - 1, x0 + 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(cRows - 1, y0 + 1);

    const dx = fx - x0;
    const dy = fy - y0;

    const v00 = cVectors[y0 * cCols + x0];
    const v10 = cVectors[y0 * cCols + x1];
    const v01 = cVectors[y1 * cCols + x0];
    const v11 = cVectors[y1 * cCols + x1];

    const getComp = (vec) => vec?.[layer] || vec || { u: 0, v: 0, speed: 0, period: 0 };
    const c00 = getComp(v00), c10 = getComp(v10), c01 = getComp(v01), c11 = getComp(v11);

    const interp = (f) => c00[f] * (1 - dx) * (1 - dy) + c10[f] * dx * (1 - dy) + c01[f] * (1 - dx) * dy + c11[f] * dx * dy;
    const copU = interp('u');
    const copV = interp('v');
    const copSpeed = interp('speed');
    const copPeriod = interp('period');

    // Smooth boundary feather blend
    const distSouth = v.lat - cBounds.south;
    const distNorth = cBounds.north - v.lat;
    const distWest = lng - cBounds.west;
    const distEast = cBounds.east - lng;

    const minLatDist = Math.min(distSouth, distNorth);
    const minLngDist = Math.min(distWest, distEast);

    const alphaLat = featherLat > 0 ? Math.min(1.0, minLatDist / featherLat) : 1.0;
    const alphaLng = featherLng > 0 ? Math.min(1.0, minLngDist / featherLng) : 1.0;
    const alpha = Math.min(alphaLat, alphaLng);

    const finalU = alpha * copU + (1 - alpha) * (v[layer]?.u || 0);
    const finalV = alpha * copV + (1 - alpha) * (v[layer]?.v || 0);
    const finalSpeed = alpha * copSpeed + (1 - alpha) * (v[layer]?.speed || 0);
    const finalPeriod = alpha * copPeriod + (1 - alpha) * (v[layer]?.period || 0);

    return {
      ...v,
      [layer]: {
        u: finalU,
        v: finalV,
        speed: finalSpeed,
        period: finalPeriod,
        __blended: alpha < 1.0 && alpha > 0,
        __estimated: alpha === 0
      }
    };
  });

  return {
    ...baseData,
    grid: {
      ...baseData.grid,
      vectors,
      __sourceModel: 'EURO',
      __provider: 'copernicus',
      __gridProvider: 'copernicus',
      __gridSupportsLayer: true,
      __componentLayer: layer,
      provider: 'copernicus'
    }
  };
}

export { COMPONENT_LAYERS, COPERNICUS_LAYER_VARS };
