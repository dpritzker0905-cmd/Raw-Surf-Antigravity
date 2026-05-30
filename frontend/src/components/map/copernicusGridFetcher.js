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
var MAX_GRID = 11;
var MIN_ZOOM = 4;

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
function computeRegionalGrid(bounds) {
  var latMin = Math.max(-80, bounds.south);
  var latMax = Math.min(85, bounds.north);
  var lonMin = bounds.west;
  var lonMax = bounds.east;

  // Handle antimeridian wrap
  if (lonMax < lonMin) lonMax += 360;

  var latStep = (latMax - latMin) / (MAX_GRID - 1);
  var lonStep = (lonMax - lonMin) / (MAX_GRID - 1);
  var points = [];

  for (var r = 0; r < MAX_GRID; r++) {
    for (var c = 0; c < MAX_GRID; c++) {
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
    gridSize: MAX_GRID,
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
 * Fetch a Copernicus regional grid for a EURO component layer.
 *
 * @param {Object} viewportBounds - { west, south, east, north }
 * @param {string} layer - 'swell_1' | 'swell_2' | 'wind_waves'
 * @param {number} hourOffset - timeline offset in hours
 * @param {number} zoom - current map zoom level
 * @returns {Object|null} Grid data in marineData.grid format, or null on error
 */
export async function fetchCopernicusComponentGrid(viewportBounds, layer, hourOffset, zoom) {
  if (!COMPONENT_LAYERS.includes(layer)) return null;
  if (!viewportBounds) return null;
  if (zoom < MIN_ZOOM) {
    console.log(`[CopernicusGrid] Zoom ${zoom} < ${MIN_ZOOM}, skipping component grid`);
    return null;
  }

  var vars = COPERNICUS_LAYER_VARS[layer];
  var fields = LAYER_FIELD_MAP[layer];
  if (!vars || !fields) return null;

  var { points, gridSize, bounds } = computeRegionalGrid(viewportBounds);
  var lats = points.map(function(p) { return p.lat; });
  var lons = points.map(function(p) { return p.lng; });

  var body = {
    latitude: lats,
    longitude: lons,
    hourly: vars,
    forecast_days: 1,
    models: ['ecmwf_wam025']
  };

  console.log(`[CopernicusGrid] Fetching ${layer}: ${points.length} pts, vars=${vars.join(',')}`);

  try {
    var res = await fetch('/api/weather-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'copernicus_marine', body })
    });

    if (!res.ok) {
      console.error(`[CopernicusGrid] HTTP ${res.status} for ${layer}`);
      return null;
    }

    var json = await res.json();
    var results = Array.isArray(json) ? json : null;
    if (!results || results.length === 0) return null;

    // Find the target time index
    var timeArray = results[0]?.hourly?.time;
    var targetMs = Date.now() + hourOffset * 3600000;
    var idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;

    // Build grid vectors in the same shape as extractMarineAtOffset
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

      // Populate only the active layer's vector; others stay zero
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

    console.log(`[CopernicusGrid] ${layer}: ${gridVectors.length} vectors, ${nonzeroCount} nonzero`);

    // Diagnostics
    if (typeof window !== 'undefined') {
      window.__COPERNICUS_GRID_DIAG__ = {
        layer, gridSize, pointCount: points.length,
        nonzeroCount, vars, hourOffset,
        bbox: bounds,
        timestamp: new Date().toISOString(),
        zoom
      };
    }

    return {
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
  } catch (err) {
    console.error(`[CopernicusGrid] Fetch failed for ${layer}:`, err.message);
    return null;
  }
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

  // The component grid may have different bounds/size than the base grid.
  // Replace the entire grid with the Copernicus component grid, but carry
  // forward Copernicus metadata so MapWebGL knows to render it.
  var merged = {
    ...componentData,
    grid: {
      ...componentData.grid,
      __sourceModel: 'EURO',
      __provider: 'copernicus',
      __gridProvider: 'copernicus',
      __gridSupportsLayer: true,
      __componentLayer: layer,
      provider: 'copernicus'
    }
  };

  return merged;
}

export { COMPONENT_LAYERS, COPERNICUS_LAYER_VARS };
