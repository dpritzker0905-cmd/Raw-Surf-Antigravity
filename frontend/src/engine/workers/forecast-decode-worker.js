/*
====================================================
 Raw Surf OS Forecast Decode Worker
 OFF-MAIN-THREAD DATA PROCESSING
====================================================

Heavy operations run here, NOT on UI thread:
- GRIB/JSON parsing
- Field normalization
- Interpolation
- Vector transforms

POSTMESSAGE API:
  { type: 'normalize', model: 'GFS', raw: {...}, bounds: {...} }
 { type: 'normalized', grid: NormalizedForecastGrid }

  { type: 'interpolate', fieldA: Float32Array, fieldB: Float32Array, t: 0.5 }
 { type: 'interpolated', result: Float32Array }

====================================================
*/

 

/**
 * Normalize forecast data off-thread.
 * Same logic as model-normalizers.js but runs in worker context.
 */
function workerNormalize(raw, model, bounds) {
  var upper = (model || '').toUpperCase();
  var w = raw.nx || raw.width || 360;
  var h = raw.ny || raw.height || 181;
  var size = w * h;

  var u = new Float32Array(size);
  var v = new Float32Array(size);
  var scalar = new Float32Array(size);

  // Wind extraction
  var uSrc = raw.u10m || raw.ugrd || raw.u || raw['10u'] || raw.u10 || raw.u_component_of_wind;
  var vSrc = raw.v10m || raw.vgrd || raw.v || raw['10v'] || raw.v10 || raw.v_component_of_wind;

  if (uSrc && vSrc) {
    var len = Math.min(size, uSrc.length || 0);
    for (var i = 0; i < len; i++) {
      u[i] = uSrc[i] || 0;
      v[i] = vSrc[i] || 0;
    }
  } else if (raw.windSpeed && raw.windDirection) {
    var sLen = Math.min(size, raw.windSpeed.length || 0);
    for (var j = 0; j < sLen; j++) {
      var rad = (raw.windDirection[j] * Math.PI) / 180;
      u[j] = -raw.windSpeed[j] * Math.sin(rad);
      v[j] = -raw.windSpeed[j] * Math.cos(rad);
    }
  }

  // Scalar extraction
  var scSrc = raw.swh || raw.waveHeight || raw.significant_wave_height ||
              raw.mslp || raw.pressure || raw.mean_sea_level_pressure ||
              raw.reflectivity || raw.brightness || raw.data;
  if (scSrc) {
    var scLen = Math.min(size, scSrc.length || 0);
    for (var k = 0; k < scLen; k++) scalar[k] = scSrc[k] || 0;
  }

  var resolution = 0.25;
  if (upper === 'ICON') resolution = 0.125;
  else if (upper === 'EURO' || upper === 'ECMWF') resolution = 0.1;
  else if (upper === 'RADAR') resolution = 0.01;
  else if (upper === 'SATELLITE' || upper === 'SAT') resolution = 0.005;

  return {
    u: u,
    v: v,
    scalar: scalar,
    width: w,
    height: h,
    timestep: raw.timestep || raw.forecastHour || raw.step || 0,
    timestamp: raw.timestamp || raw.time || Date.now(),
    bounds: bounds || { north: 90, south: -90, east: 180, west: -180 },
    resolution: raw.resolution || resolution,
    sourceModel: upper || 'GFS',
  };
}

/**
 * Linearly interpolate between two Float32Arrays.
 */
function workerInterpolate(a, b, t) {
  var len = Math.min(a.length, b.length);
  var result = new Float32Array(len);
  var oneMinusT = 1 - t;
  for (var i = 0; i < len; i++) {
    result[i] = a[i] * oneMinusT + b[i] * t;
  }
  return result;
}

/**
 * Compute wind magnitude from u/v.
 */
function workerMagnitude(u, v) {
  var len = Math.min(u.length, v.length);
  var result = new Float32Array(len);
  for (var i = 0; i < len; i++) {
    result[i] = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
  }
  return result;
}

// MESSAGE HANDLER 

self.onmessage = function(e) {
  var msg = e.data;
  if (!msg || !msg.type) return;

  try {
    if (msg.type === 'normalize') {
      var grid = workerNormalize(msg.raw, msg.model, msg.bounds);
      self.postMessage({
        type: 'normalized',
        grid: grid,
        id: msg.id,
      }, [grid.u.buffer, grid.v.buffer, grid.scalar.buffer]);
    }

    else if (msg.type === 'interpolate') {
      var result = workerInterpolate(msg.fieldA, msg.fieldB, msg.t);
      self.postMessage({
        type: 'interpolated',
        result: result,
        id: msg.id,
      }, [result.buffer]);
    }

    else if (msg.type === 'magnitude') {
      var mag = workerMagnitude(msg.u, msg.v);
      self.postMessage({
        type: 'magnitude',
        result: mag,
        id: msg.id,
      }, [mag.buffer]);
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err.message || 'Worker error',
      id: msg.id,
    });
  }
};
