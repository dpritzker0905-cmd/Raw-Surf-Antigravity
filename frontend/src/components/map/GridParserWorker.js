/**
 * GridParserWorker.js — Web Worker for Off-Thread Grid Data Parsing
 *
 * Parses raw Open-Meteo / marine grid responses off the main thread.
 * Prevents long-running grid interpolation from blocking UI/RAF.
 *
 * Usage from main thread:
 *   import { createGridWorker } from './useGridWorker';
 *   const worker = createGridWorker();
 *   worker.parse(rawData, bounds).then(grid => { ... });
 *
 * RULES:
 *   - NO DOM access (Web Worker scope)
 *   - NO React
 *   - Pure data transformation
 */

/* eslint-disable no-restricted-globals */

/**
 * Parse raw Open-Meteo hourly response into a vector grid.
 * @param {Object} raw - OM API response
 * @param {string} uVar - u-component variable name
 * @param {string} vVar - v-component variable name  
 * @param {number} timeIndex - which hourly index to extract
 * @returns {Object} parsed grid
 */
function parseWindGrid(raw, uVar, vVar, timeIndex) {
  var uData = raw.hourly?.[uVar];
  var vData = raw.hourly?.[vVar];
  if (!uData || !vData) return null;

  var lat = raw.latitude;
  var lng = raw.longitude;

  // Determine grid dimensions from the response
  // OM returns flat arrays; we need to reconstruct the 2D grid
  var lats = Array.isArray(lat) ? lat : [lat];
  var lngs = Array.isArray(lng) ? lng : [lng];
  var rows = lats.length;
  var cols = lngs.length;
  var offset = timeIndex * rows * cols;

  var vectors = [];
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var idx = offset + r * cols + c;
      var u = uData[idx] || 0;
      var v = vData[idx] || 0;
      vectors.push({
        u: u,
        v: v,
        speed: Math.sqrt(u * u + v * v),
        lat: lats[r],
        lng: lngs[c],
      });
    }
  }

  return {
    vectors: vectors,
    cols: cols,
    rows: rows,
    bounds: {
      west: lngs[0],
      east: lngs[cols - 1],
      south: lats[0],
      north: lats[rows - 1],
    },
  };
}

/**
 * Parse marine wave grid from OM marine response.
 */
function parseMarineGrid(raw, heightVar, dirVar, periodVar, timeIndex) {
  var heights = raw.hourly?.[heightVar];
  var dirs = raw.hourly?.[dirVar];
  var periods = raw.hourly?.[periodVar];
  if (!heights) return null;

  var lat = Array.isArray(raw.latitude) ? raw.latitude : [raw.latitude];
  var lng = Array.isArray(raw.longitude) ? raw.longitude : [raw.longitude];
  var rows = lat.length;
  var cols = lng.length;
  var offset = timeIndex * rows * cols;

  var vectors = [];
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var idx = offset + r * cols + c;
      var h = heights[idx] || 0;
      var dir = dirs ? (dirs[idx] || 0) : 0;
      var period = periods ? (periods[idx] || 0) : 0;
      var dirRad = dir * Math.PI / 180;
      vectors.push({
        u: h * Math.sin(dirRad),
        v: h * Math.cos(dirRad),
        speed: h,
        direction: dir,
        period: period,
        lat: lat[r],
        lng: lng[c],
      });
    }
  }

  return {
    vectors: vectors,
    cols: cols,
    rows: rows,
    bounds: {
      west: lng[0],
      east: lng[cols - 1],
      south: lat[0],
      north: lat[rows - 1],
    },
  };
}

// ─── WORKER MESSAGE HANDLER ──────────────────────────────────────────────────

self.onmessage = function(e) {
  var msg = e.data;
  var result = null;
  var error = null;

  try {
    switch (msg.type) {
      case 'parseWind':
        result = parseWindGrid(msg.raw, msg.uVar, msg.vVar, msg.timeIndex || 0);
        break;
      case 'parseMarine':
        result = parseMarineGrid(msg.raw, msg.heightVar, msg.dirVar, msg.periodVar, msg.timeIndex || 0);
        break;
      default:
        error = 'Unknown parse type: ' + msg.type;
    }
  } catch (err) {
    error = err.message;
  }

  self.postMessage({ id: msg.id, result: result, error: error });
};
