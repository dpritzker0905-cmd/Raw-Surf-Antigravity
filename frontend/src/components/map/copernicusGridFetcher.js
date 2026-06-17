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
import { upscaleGrid, computeRegionalGrid } from './copernicusGridHelpers';

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

function safeNum(v) { return (v != null && isFinite(v)) ? v : 0; }

function getUV(speed, dirDeg) {
  if (speed === 0) return { u: 0, v: 0, speed: 0 };
  var rad = (dirDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
}

/**
 * Find the closest hour index in a time array to the target timestamp.
 */
function findClosestHourIndex(timeArray, targetMs) {
  var bestIdx = 0, minDiff = Infinity;
  for (var i = 0; i < timeArray.length; i++) {
    var diff = Math.abs(new Date(timeArray[i].endsWith('Z') ? timeArray[i] : timeArray[i] + 'Z').getTime() - targetMs);
    if (diff < minDiff) { minDiff = diff; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Clamp bounds around their geographic center if they exceed the maximum safe dimensions (28° lat x 56° lon) for the Copernicus backend.
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

  // v7.14.7: Secure 28° × 56° maximum bounds limit
  if (latDiff > 28) {
    clampedSouth = latCenter - 14;
    clampedNorth = latCenter + 14;
    isClamped = true;
  }
  if (lonDiff > 56) {
    clampedWest = lonCenter - 28;
    clampedEast = lonCenter + 28;
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

async function doFetchAndUpscale(viewportBounds, layer, hourOffset, zoom, cacheKey, stateValidator) {
  var startTime = Date.now();
  var vars = COPERNICUS_LAYER_VARS[layer];
  var fields = LAYER_FIELD_MAP[layer];

  // Cap grid size at safe production grid size (9x9)
  var gridSize = COPERNICUS_COMPONENT_GRID_SIZE;
  var { bounds: clampedBBox, isClamped } = clampBounds(viewportBounds);
  var { points, bounds } = computeRegionalGrid(clampedBBox, gridSize);
  var lats = points.map(function(p) { return p.lat; });
  var lons = points.map(function(p) { return p.lng; });

  var zoomAtSchedule = zoom;
  var boundsAtSchedule = viewportBounds;
  var zoomAtSend = zoom;
  var boundsAtSend = viewportBounds;

  if (stateValidator) {
    if (typeof stateValidator.getCurrentZoom === 'function') zoomAtSend = stateValidator.getCurrentZoom();
    if (typeof stateValidator.getCurrentBounds === 'function') boundsAtSend = stateValidator.getCurrentBounds();

    if (zoomAtSend !== undefined && zoomAtSend < 4.0) {
      console.log(`[CopernicusGrid] Active zoom ${zoomAtSend} < 4.0 immediately before fetch, aborting.`);
      if (typeof window !== 'undefined') {
        window.__COPERNICUS_GRID_DIAG__ = {
          layer,
          componentLayer: layer,
          provider: 'copernicus',
          backendPointCount: 0,
          renderPointCount: 0,
          nonzeroCount: 0,
          bbox: bounds,
          zoom: zoomAtSend,
          cacheHit: false,
          isStale: false,
          elapsedMs: Date.now() - startTime,
          skipped: true,
          skippedReason: 'zoom_too_low_deferred',
          timestamp: new Date().toISOString(),
          zoomAtSchedule,
          zoomAtSend,
          boundsAtSchedule,
          boundsAtSend,
          inputBounds: viewportBounds,
          clampedBounds: clampedBBox,
          sentMinLat: lats.length > 0 ? Math.min(...lats) : null,
          sentMaxLat: lats.length > 0 ? Math.max(...lats) : null,
          sentMinLon: lons.length > 0 ? Math.min(...lons) : null,
          sentMaxLon: lons.length > 0 ? Math.max(...lons) : null,
          sentLatSpan: lats.length > 0 ? (Math.max(...lats) - Math.min(...lats)) : null,
          sentLonSpan: lons.length > 0 ? (Math.max(...lons) - Math.min(...lons)) : null,
          zoomSnapshot: zoomAtSend
        };
      }
      throw new Error('zoom_too_low_deferred');
    }

    if (typeof stateValidator.isActiveIntent === 'function' && !stateValidator.isActiveIntent()) {
      console.log(`[CopernicusGrid] Active intent changed while queued. Aborting stale request.`);
      throw new Error('stale_intent_aborted');
    }
  }

  var boundsDiag = {
    inputBounds: viewportBounds,
    clampedBounds: clampedBBox,
    sentMinLat: lats.length > 0 ? Math.min(...lats) : null,
    sentMaxLat: lats.length > 0 ? Math.max(...lats) : null,
    sentMinLon: lons.length > 0 ? Math.min(...lons) : null,
    sentMaxLon: lons.length > 0 ? Math.max(...lons) : null,
    sentLatSpan: lats.length > 0 ? (Math.max(...lats) - Math.min(...lats)) : null,
    sentLonSpan: lons.length > 0 ? (Math.max(...lons) - Math.min(...lons)) : null,
    zoomSnapshot: zoomAtSend,
    zoomAtSchedule,
    zoomAtSend,
    boundsAtSchedule,
    boundsAtSend
  };

  var body = {
    latitude: lats,
    longitude: lons,
    hourly: vars,
    forecast_days: Math.min(3, Math.max(1, Math.ceil((hourOffset + 1) / 24))),
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
        timestamp: new Date().toISOString(),
        ...boundsDiag
      };
    }
    throw new Error(`HTTP ${res.status}: ${skippedReason}`);
  }

  var json = await res.json();
  var results = Array.isArray(json) ? json : null;
  if (!results || results.length === 0) {
    throw new Error('empty_backend_results');
  }

  var timeArray = results[0]?.hourly?.time;
  if (!timeArray || timeArray.length === 0) {
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

  var upscaled = upscaleGrid(originalGrid, COPERNICUS_UPSCALED_GRID_SIZE);

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
      skippedReason: nonzeroCount === 0 ? 'copernicus_no_nonzero_vectors' : null,
      ...boundsDiag
    };
  }

  return upscaled;
}

export async function fetchCopernicusComponentGrid(viewportBounds, layer, hourOffset, zoom, stateValidator) {
  if (hourOffset > 240) {
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
    return null;
  }
  if (zoom < MIN_ZOOM) {
    console.log(`[CopernicusGrid] Zoom ${zoom} < ${MIN_ZOOM}, skipping component grid`);
    return null;
  }

  var vars = COPERNICUS_LAYER_VARS[layer];
  var fields = LAYER_FIELD_MAP[layer];
  if (!vars || !fields) {
    return null;
  }

  var cacheKey = getClientCacheKey(viewportBounds, layer, hourOffset, zoom);
  var now = Date.now();
  for (var [key, entry] of clientGridCache.entries()) {
    if (now - entry.timestamp > CLIENT_CACHE_TTL_MS) {
      clientGridCache.delete(key);
    }
  }

  var cached = clientGridCache.get(cacheKey);
  if (cached) {
    var isExpired = now - cached.timestamp > CLIENT_CACHE_TTL_MS;
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
      triggerBackgroundRevalidate(viewportBounds, layer, hourOffset, zoom, cacheKey, stateValidator);
      return cached.data;
    }
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  var promise = (async () => {
    try {
      return await doFetchAndUpscale(viewportBounds, layer, hourOffset, zoom, cacheKey, stateValidator);
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

function triggerBackgroundRevalidate(viewportBounds, layer, hourOffset, zoom, cacheKey, stateValidator) {
  if (inFlightRequests.has(cacheKey)) return;
  
  var promise = (async () => {
    try {
      await doFetchAndUpscale(viewportBounds, layer, hourOffset, zoom, cacheKey, stateValidator);
    } catch (err) {
      console.warn(`[CopernicusGrid] Background SWR refresh failed for ${layer}:`, err.message);
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();
  
  inFlightRequests.set(cacheKey, promise);
}

export function mergeComponentGrid(baseData, componentData, layer) {
  if (!baseData?.grid?.vectors || !componentData?.grid?.vectors) return baseData;

  const cBounds = componentData.grid.bounds;
  const cVectors = componentData.grid.vectors;
  const cCols = componentData.grid.cols;
  const cRows = componentData.grid.rows;

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
