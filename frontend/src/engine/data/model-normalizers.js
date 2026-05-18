/*
====================================================
 Raw Surf OS Forecast Model Normalizers
 GFS / ICON / EURO / RADAR / SATELLITE
====================================================

ALL models normalize into ONE unified format:
NormalizedForecastGrid = {
  u, v, scalar: Float32Array,
  width, height, timestep, timestamp,
  bounds: { north, south, east, west },
  resolution, sourceModel
}

Rendering engine NEVER knows which model produced the data.
var/function only (TDZ-immune)
====================================================
*/

// SHARED NORMALIZATION HELPERS 

/**
 * Create an empty normalized grid.
 */
function createEmptyGrid(width, height, model) {
  var size = width * height;
  return {
    u: new Float32Array(size),
    v: new Float32Array(size),
    scalar: new Float32Array(size),
    width: width,
    height: height,
    timestep: 0,
    timestamp: Date.now(),
    bounds: { north: 90, south: -90, east: 180, west: -180 },
    resolution: 0,
    sourceModel: model,
  };
}

/**
 * Convert wind speed + direction arrays to u/v components.
 * @param {Array|Float32Array} speeds
 * @param {Array|Float32Array} directions - meteorological convention (from)
 * @param {Float32Array} u - output
 * @param {Float32Array} v - output
 */
function windToUV(speeds, directions, u, v) {
  var len = Math.min(speeds.length, directions.length, u.length);
  for (var i = 0; i < len; i++) {
    var rad = (directions[i] * Math.PI) / 180;
    u[i] = -speeds[i] * Math.sin(rad);
    v[i] = -speeds[i] * Math.cos(rad);
  }
}

/**
 * Copy array data into Float32Array with bounds clamping.
 */
function copyToTyped(source, target) {
  if (!source) return;
  var len = Math.min(source.length || 0, target.length);
  for (var i = 0; i < len; i++) {
    target[i] = source[i] || 0;
  }
}

// GFS NORMALIZER 

/**
 * Normalize GFS (Global Forecast System) output.
 * GFS typically provides: u10m, v10m, t2m, precip, mslp
 * Resolution: 0.25 (~28km)
 */
function normalizeGFS(raw, bounds) {
  var w = raw.nx || raw.width || 360;
  var h = raw.ny || raw.height || 181;
  var grid = createEmptyGrid(w, h, 'GFS');
  grid.resolution = 0.25;

  if (bounds) grid.bounds = bounds;

  // Wind components
  if (raw.u10m || raw.ugrd) {
    copyToTyped(raw.u10m || raw.ugrd, grid.u);
    copyToTyped(raw.v10m || raw.vgrd, grid.v);
  } else if (raw.windSpeed && raw.windDirection) {
    windToUV(raw.windSpeed, raw.windDirection, grid.u, grid.v);
  }

  // Scalar: prefer wave height, fallback to pressure, then temperature
  if (raw.swh || raw.waveHeight) {
    copyToTyped(raw.swh || raw.waveHeight, grid.scalar);
  } else if (raw.mslp || raw.pressure) {
    copyToTyped(raw.mslp || raw.pressure, grid.scalar);
  } else if (raw.t2m || raw.temperature) {
    copyToTyped(raw.t2m || raw.temperature, grid.scalar);
  }

  grid.timestep = raw.timestep || raw.forecastHour || 0;
  grid.timestamp = raw.timestamp || raw.refTime || Date.now();

  return grid;
}

// ICON NORMALIZER 

/**
 * Normalize DWD ICON output.
 * ICON provides: u, v, t_2m, rain_gsp, pmsl
 * Resolution: 0.125 (~13km) or 0.0625 (~7km) for ICON-EU
 */
function normalizeICON(raw, bounds) {
  var w = raw.nx || raw.width || 720;
  var h = raw.ny || raw.height || 361;
  var grid = createEmptyGrid(w, h, 'ICON');
  grid.resolution = raw.resolution || 0.125;

  if (bounds) grid.bounds = bounds;

  // ICON uses u/v directly
  if (raw.u || raw.u_10m) {
    copyToTyped(raw.u || raw.u_10m, grid.u);
    copyToTyped(raw.v || raw.v_10m, grid.v);
  }

  // Scalar
  if (raw.swh || raw.significant_wave_height) {
    copyToTyped(raw.swh || raw.significant_wave_height, grid.scalar);
  } else if (raw.pmsl || raw.mean_sea_level_pressure) {
    copyToTyped(raw.pmsl || raw.mean_sea_level_pressure, grid.scalar);
  }

  grid.timestep = raw.timestep || raw.step || 0;
  grid.timestamp = raw.timestamp || raw.ref_time || Date.now();

  return grid;
}

// EURO (ECMWF) NORMALIZER 

/**
 * Normalize ECMWF / EURO output.
 * Resolution: 0.1 (~11km) for HRES, 0.25 for ENS
 */
function normalizeEURO(raw, bounds) {
  var w = raw.nx || raw.width || 900;
  var h = raw.ny || raw.height || 451;
  var grid = createEmptyGrid(w, h, 'EURO');
  grid.resolution = raw.resolution || 0.1;

  if (bounds) grid.bounds = bounds;

  // ECMWF standard parameter names
  if (raw['10u'] || raw.u10) {
    copyToTyped(raw['10u'] || raw.u10, grid.u);
    copyToTyped(raw['10v'] || raw.v10, grid.v);
  } else if (raw.u_component_of_wind) {
    copyToTyped(raw.u_component_of_wind, grid.u);
    copyToTyped(raw.v_component_of_wind, grid.v);
  }

  // Scalar
  if (raw.swh || raw.significant_height_of_combined_wind_waves_and_swell) {
    copyToTyped(raw.swh || raw.significant_height_of_combined_wind_waves_and_swell, grid.scalar);
  } else if (raw.msl || raw.mean_sea_level_pressure) {
    copyToTyped(raw.msl || raw.mean_sea_level_pressure, grid.scalar);
  }

  grid.timestep = raw.timestep || raw.step || 0;
  grid.timestamp = raw.timestamp || raw.date || Date.now();

  return grid;
}

// RADAR NORMALIZER 

/**
 * Normalize radar imagery (temporal raster field).
 * Radar = reflectivity values, no wind components.
 */
function normalizeRadar(raw, bounds) {
  var w = raw.width || 512;
  var h = raw.height || 512;
  var grid = createEmptyGrid(w, h, 'RADAR');
  grid.resolution = raw.resolution || 0.01;

  if (bounds) grid.bounds = bounds;

 // Radar has no wind only scalar (reflectivity in dBZ)
  if (raw.reflectivity || raw.data) {
    copyToTyped(raw.reflectivity || raw.data, grid.scalar);
  }

  grid.timestep = raw.timestep || 0;
  grid.timestamp = raw.timestamp || raw.time || Date.now();

  return grid;
}

// SATELLITE NORMALIZER 

/**
 * Normalize satellite imagery (texture/tile field).
 * Satellite = brightness/IR values, no wind components.
 */
function normalizeSatellite(raw, bounds) {
  var w = raw.width || 1024;
  var h = raw.height || 1024;
  var grid = createEmptyGrid(w, h, 'SATELLITE');
  grid.resolution = raw.resolution || 0.005;

  if (bounds) grid.bounds = bounds;

  // Satellite has brightness temperature or visible channel
  if (raw.brightness || raw.ir || raw.data) {
    copyToTyped(raw.brightness || raw.ir || raw.data, grid.scalar);
  }

  grid.timestep = raw.timestep || 0;
  grid.timestamp = raw.timestamp || raw.time || Date.now();

  return grid;
}

// AUTO NORMALIZER 

/**
 * Route to the correct normalizer based on model name.
 * @param {Object} raw - raw model output
 * @param {string} model - 'GFS' | 'ICON' | 'EURO' | 'RADAR' | 'SATELLITE'
 * @param {Object} [bounds]
 * @returns {Object} NormalizedForecastGrid
 */
function normalizeModel(raw, model, bounds) {
  var upper = (model || '').toUpperCase();
  if (upper === 'GFS') return normalizeGFS(raw, bounds);
  if (upper === 'ICON') return normalizeICON(raw, bounds);
  if (upper === 'EURO' || upper === 'ECMWF') return normalizeEURO(raw, bounds);
  if (upper === 'RADAR') return normalizeRadar(raw, bounds);
  if (upper === 'SATELLITE' || upper === 'SAT') return normalizeSatellite(raw, bounds);

  // Fallback: try GFS normalization
  return normalizeGFS(raw, bounds);
}

export {
  createEmptyGrid,
  windToUV,
  copyToTyped,
  normalizeGFS,
  normalizeICON,
  normalizeEURO,
  normalizeRadar,
  normalizeSatellite,
  normalizeModel,
};
