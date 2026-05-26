/**
 * GridParserWorker.js Web Worker for Off-Thread Grid Data Parsing
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

// Helper to compute geodesic distance between coordinates using the Haversine formula
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  var R = 6371; // Earth's radius in km
  var dLat = (lat2 - lat1) * (Math.PI / 180);
  var dLon = (lon2 - lon1) * (Math.PI / 180);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Ocean basin classifier mapping coordinate spaces to unique meteorological basins
function getBasin(lat, lng) {
  var normLng = lng;
  while (normLng > 180) normLng -= 360;
  while (normLng < -180) normLng += 360;

  if (lat > 0) {
    if (normLng >= -20 && normLng <= 145) {
      return 'Eurasia';
    } else if (normLng < -20 && normLng >= -100) {
      return 'North Atlantic';
    } else {
      return 'North Pacific';
    }
  } else {
    if (normLng >= -70 && normLng <= 20) {
      return 'South Atlantic';
    } else if (normLng > 20 && normLng <= 145) {
      return 'Indian Ocean';
    } else {
      return 'South Pacific';
    }
  }
}

// v3.14: Fully off-thread pressure synoptic scanning
function calculatePressureExtrema(pressures, coarseRows, coarseCols, bounds, timeOffsetHours, activeModel) {
  if (!pressures || pressures.length === 0) {
    return { lowSystems: [], highSystems: [] };
  }

  // Step 1: Reshape 1D flat array into 2D coarse grid
  var coarseMatrix = [];
  for (var y = 0; y < coarseRows; y++) {
    coarseMatrix[y] = [];
    for (var x = 0; x < coarseCols; x++) {
      coarseMatrix[y][x] = pressures[y * coarseCols + x].pressure;
    }
  }

  // Step 2: Bilinearly interpolate to high-density dense grid (90x90)
  var denseRows = 90;
  var denseCols = 90;
  var P = [];
  for (var dy = 0; dy < denseRows; dy++) {
    P[dy] = [];
    var cy = (dy / (denseRows - 1)) * (coarseRows - 1);
    var y0 = Math.floor(cy);
    var y1 = Math.min(coarseRows - 1, y0 + 1);
    var ty = cy - y0;

    for (var dx = 0; dx < denseCols; dx++) {
      var cx = (dx / (denseCols - 1)) * (coarseCols - 1);
      var x0 = Math.floor(cx);
      var x1 = Math.min(coarseCols - 1, x0 + 1);
      var tx = cx - x0;

      var v00 = coarseMatrix[y0][x0];
      var v10 = coarseMatrix[y1][x0];
      var v01 = coarseMatrix[y0][x1];
      var v11 = coarseMatrix[y1][x1];

      P[dy][dx] = (1 - tx) * (1 - ty) * v00 +
                  tx * (1 - ty) * v01 +
                  (1 - tx) * ty * v10 +
                  tx * ty * v11;
    }
  }

  // Step 3: Basin-Aware Normalization
  var south = bounds.south;
  var north = bounds.north;
  var west = bounds.west;
  var east = bounds.east;
  var isGlobalLng = Math.abs(east - west) >= 350;

  var basinPressures = {
    'Eurasia': [],
    'North Atlantic': [],
    'South Atlantic': [],
    'North Pacific': [],
    'South Pacific': [],
    'Indian Ocean': []
  };

  for (var y = 0; y < denseRows; y++) {
    for (var x = 0; x < denseCols; x++) {
      var lat = south + (y / (denseRows - 1)) * (north - south);
      var lng = west + (x / (denseCols - 1)) * (east - west);
      var val = P[y][x];
      var basin = getBasin(lat, lng);
      basinPressures[basin].push(val);
    }
  }

  var basinStats = {};
  var keys = Object.keys(basinPressures);
  for (var bIdx = 0; bIdx < keys.length; bIdx++) {
    var basin = keys[bIdx];
    var vals = basinPressures[basin];
    if (vals.length === 0) {
      basinStats[basin] = { lowThresh: 1012, highThresh: 1014, mean: 1013 };
      continue;
    }
    var sorted = vals.slice().sort(function(a, b) { return a - b; });
    var sum = 0;
    for (var vi = 0; vi < vals.length; vi++) sum += vals[vi];
    var mean = sum / vals.length;

    var p15 = sorted[Math.floor(sorted.length * 0.15)];
    var p85 = sorted[Math.floor(sorted.length * 0.85)];
    
    basinStats[basin] = {
      lowThresh: Math.min(1013.5, p15),
      highThresh: Math.max(1012.5, p85),
      mean: mean
    };
  }

  // Step 4: BFS Contiguous Component Labeling (8-neighbor Moore adjacency)
  var visitedLows = Array(denseRows);
  var visitedHighs = Array(denseRows);
  for (var y = 0; y < denseRows; y++) {
    visitedLows[y] = Array(denseCols).fill(false);
    visitedHighs[y] = Array(denseCols).fill(false);
  }
  
  var candidateLows = [];
  var candidateHighs = [];

  // Low Pressure Systems Clustering
  for (var y = 0; y < denseRows; y++) {
    for (var x = 0; x < denseCols; x++) {
      if (visitedLows[y][x]) continue;

      var lat = south + (y / (denseRows - 1)) * (north - south);
      var lng = west + (x / (denseCols - 1)) * (east - west);
      var val = P[y][x];
      var basin = getBasin(lat, lng);
      var stats = basinStats[basin];

      if (val <= stats.lowThresh) {
        var clusterCells = [];
        var queue = [{ y: y, x: x }];
        visitedLows[y][x] = true;

        while (queue.length > 0) {
          var curr = queue.shift();
          clusterCells.push(curr);

          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (dy === 0 && dx === 0) continue;
              var ny = curr.y + dy;
              var nx = curr.x + dx;

              if (ny >= 0 && ny < denseRows) {
                if (isGlobalLng) {
                  nx = (nx + denseCols) % denseCols;
                } else if (nx < 0 || nx >= denseCols) {
                  continue;
                }

                if (!visitedLows[ny][nx]) {
                  var nLat = south + (ny / (denseRows - 1)) * (north - south);
                  var nLng = west + (nx / (denseCols - 1)) * (east - west);
                  var nVal = P[ny][nx];
                  var nBasin = getBasin(nLat, nLng);
                  var nStats = basinStats[nBasin];

                  if (nVal <= nStats.lowThresh) {
                    visitedLows[ny][nx] = true;
                    queue.push({ y: ny, x: nx });
                  }
                }
              }
            }
          }
        }

        if (clusterCells.length >= 1) {
          candidateLows.push(clusterCells);
        }
      }
    }
  }

  // High Pressure Systems Clustering
  for (var y = 0; y < denseRows; y++) {
    for (var x = 0; x < denseCols; x++) {
      if (visitedHighs[y][x]) continue;

      var lat = south + (y / (denseRows - 1)) * (north - south);
      var lng = west + (x / (denseCols - 1)) * (east - west);
      var val = P[y][x];
      var basin = getBasin(lat, lng);
      var stats = basinStats[basin];

      if (val >= stats.highThresh) {
        var clusterCells = [];
        var queue = [{ y: y, x: x }];
        visitedHighs[y][x] = true;

        while (queue.length > 0) {
          var curr = queue.shift();
          clusterCells.push(curr);

          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (dy === 0 && dx === 0) continue;
              var ny = curr.y + dy;
              var nx = curr.x + dx;

              if (ny >= 0 && ny < denseRows) {
                if (isGlobalLng) {
                  nx = (nx + denseCols) % denseCols;
                } else if (nx < 0 || nx >= denseCols) {
                  continue;
                }

                if (!visitedHighs[ny][nx]) {
                  var nLat = south + (ny / (denseRows - 1)) * (north - south);
                  var nLng = west + (nx / (denseCols - 1)) * (east - west);
                  var nVal = P[ny][nx];
                  var nBasin = getBasin(nLat, nLng);
                  var nStats = basinStats[nBasin];

                  if (nVal >= nStats.highThresh) {
                    visitedHighs[ny][nx] = true;
                    queue.push({ y: ny, x: nx });
                  }
                }
              }
            }
          }
        }

        if (clusterCells.length >= 1) {
          candidateHighs.push(clusterCells);
        }
      }
    }
  }

  // Step 5: Extract BFS cluster extrema with deviation filter
  var selectedLows = [];
  candidateLows.forEach(function(clusterCells) {
    var extremumCell = clusterCells[0];
    clusterCells.forEach(function(cell) {
      if (P[cell.y][cell.x] < P[extremumCell.y][extremumCell.x]) {
        extremumCell = cell;
      }
    });

    var extLat = south + (extremumCell.y / (denseRows - 1)) * (north - south);
    var extLng = west + (extremumCell.x / (denseCols - 1)) * (east - west);
    
    var normExtLng = extLng;
    while (normExtLng > 180) normExtLng -= 360;
    while (normExtLng < -180) normExtLng += 360;

    var extremumP = P[extremumCell.y][extremumCell.x];
    var basin = getBasin(extLat, normExtLng);
    var stats = basinStats[basin];
    var deviation = Math.abs(extremumP - stats.mean);

    if (deviation >= 1.6) {
      selectedLows.push({
        lat: extLat,
        lng: normExtLng,
        pressure: Math.round(extremumP),
        type: 'L',
        size: clusterCells.length,
        basin: basin,
        deviation: deviation
      });
    }
  });

  var selectedHighs = [];
  candidateHighs.forEach(function(clusterCells) {
    var extremumCell = clusterCells[0];
    clusterCells.forEach(function(cell) {
      if (P[cell.y][cell.x] > P[extremumCell.y][extremumCell.x]) {
        extremumCell = cell;
      }
    });

    var extLat = south + (extremumCell.y / (denseRows - 1)) * (north - south);
    var extLng = west + (extremumCell.x / (denseCols - 1)) * (east - west);

    var normExtLng = extLng;
    while (normExtLng > 180) normExtLng -= 360;
    while (normExtLng < -180) normExtLng += 360;

    var extremumP = P[extremumCell.y][extremumCell.x];
    var basin = getBasin(extLat, normExtLng);
    var stats = basinStats[basin];
    var deviation = Math.abs(extremumP - stats.mean);

    if (deviation >= 1.6) {
      selectedHighs.push({
        lat: extLat,
        lng: normExtLng,
        pressure: Math.round(extremumP),
        type: 'H',
        size: clusterCells.length,
        basin: basin,
        deviation: deviation
      });
    }
  });

  // Step 6: PRIMARY DETECTION — Multi-scale local extrema scan
  var neighborhoods = [
    { radius: 1, label: '3x3' },
    { radius: 2, label: '5x5' },
    { radius: 3, label: '7x7' },
  ];

  for (var ni = 0; ni < neighborhoods.length; ni++) {
    var radius = neighborhoods[ni].radius;
    for (var y = radius; y < denseRows - radius; y++) {
      for (var x = radius; x < denseCols - radius; x++) {
        var val = P[y][x];
        var lat = south + (y / (denseRows - 1)) * (north - south);
        var lng = west + (x / (denseCols - 1)) * (east - west);
        var normLng = lng;
        while (normLng > 180) normLng -= 360;
        while (normLng < -180) normLng += 360;

        var isLocalMin = true, isLocalMax = true;
        for (var dy = -radius; dy <= radius && (isLocalMin || isLocalMax); dy++) {
          for (var dx = -radius; dx <= radius && (isLocalMin || isLocalMax); dx++) {
            if (dy === 0 && dx === 0) continue;
            var ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < denseRows && nx >= 0 && nx < denseCols) {
              if (P[ny][nx] <= val) isLocalMin = false;
              if (P[ny][nx] >= val) isLocalMax = false;
            }
          }
        }

        var basin = getBasin(lat, normLng);
        var stats = basinStats[basin];

        if (isLocalMin && val < stats.mean) {
          var deviation = Math.abs(val - stats.mean);
          var alreadyFound = false;
          for (var li = 0; li < selectedLows.length; li++) {
            if (getHaversineDistance(lat, normLng, selectedLows[li].lat, selectedLows[li].lng) < 300) {
              alreadyFound = true; break;
            }
          }
          if (!alreadyFound && deviation >= 1.6) {
            selectedLows.push({
              lat: lat, lng: normLng, pressure: Math.round(val), type: 'L',
              size: 1, basin: basin, deviation: deviation
            });
          }
        }
        if (isLocalMax && val > stats.mean) {
          var deviation = Math.abs(val - stats.mean);
          var alreadyFound = false;
          for (var hi = 0; hi < selectedHighs.length; hi++) {
            if (getHaversineDistance(lat, normLng, selectedHighs[hi].lat, selectedHighs[hi].lng) < 300) {
              alreadyFound = true; break;
            }
          }
          if (!alreadyFound && deviation >= 1.6) {
            selectedHighs.push({
              lat: lat, lng: normLng, pressure: Math.round(val), type: 'H',
              size: 1, basin: basin, deviation: deviation
            });
          }
        }
      }
    }
  }

  // Step 7: Laplacian-based secondary detection
  for (var y = 2; y < denseRows - 2; y++) {
    for (var x = 2; x < denseCols - 2; x++) {
      var val = P[y][x];
      var laplacian = P[y-1][x] + P[y+1][x] + P[y][x-1] + P[y][x+1] - 4 * val;

      var lat = south + (y / (denseRows - 1)) * (north - south);
      var lng = west + (x / (denseCols - 1)) * (east - west);
      var normLng = lng;
      while (normLng > 180) normLng -= 360;
      while (normLng < -180) normLng += 360;

      var basin = getBasin(lat, normLng);
      var stats = basinStats[basin];
      var deviation = Math.abs(val - stats.mean);

      if (laplacian > 0.3 && val < stats.mean && deviation >= 2.0) {
        var alreadyFound = false;
        for (var li = 0; li < selectedLows.length; li++) {
          if (getHaversineDistance(lat, normLng, selectedLows[li].lat, selectedLows[li].lng) < 500) {
            alreadyFound = true; break;
          }
        }
        if (!alreadyFound) {
          selectedLows.push({
            lat: lat, lng: normLng, pressure: Math.round(val), type: 'L',
            size: 1, basin: basin, deviation: deviation
          });
        }
      }
      if (laplacian < -0.3 && val > stats.mean && deviation >= 2.0) {
        var alreadyFound = false;
        for (var hi = 0; hi < selectedHighs.length; hi++) {
          if (getHaversineDistance(lat, normLng, selectedHighs[hi].lat, selectedHighs[hi].lng) < 500) {
            alreadyFound = true; break;
          }
        }
        if (!alreadyFound) {
          selectedHighs.push({
            lat: lat, lng: normLng, pressure: Math.round(val), type: 'H',
            size: 1, basin: basin, deviation: deviation
          });
        }
      }
    }
  }

  // Step 8: Greedy Haversine deduplication (750km radius)
  var finalLows = [];
  selectedLows
    .sort(function(a, b) { return a.pressure - b.pressure; })
    .forEach(function(low) {
      var isNear = false;
      for (var li = 0; li < finalLows.length; li++) {
        if (getHaversineDistance(low.lat, low.lng, finalLows[li].lat, finalLows[li].lng) < 750) {
          isNear = true; break;
        }
      }
      if (!isNear) {
        finalLows.push(low);
      }
    });

  var finalHighs = [];
  selectedHighs
    .sort(function(a, b) { return b.pressure - a.pressure; })
    .forEach(function(high) {
      var isNear = false;
      for (var hi = 0; hi < finalHighs.length; hi++) {
        if (getHaversineDistance(high.lat, high.lng, finalHighs[hi].lat, finalHighs[hi].lng) < 750) {
          isNear = true; break;
        }
      }
      if (!isNear) {
        finalHighs.push(high);
      }
    });

  return { lowSystems: finalLows, highSystems: finalHighs };
}

// WORKER MESSAGE HANDLER 

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
      case 'calculatePressureExtrema':
        result = calculatePressureExtrema(msg.pressures, msg.coarseRows, msg.coarseCols, msg.bounds, msg.timeOffsetHours, msg.activeModel);
        break;
      default:
        error = 'Unknown parse type: ' + msg.type;
    }
  } catch (err) {
    error = err.message;
  }

  self.postMessage({ id: msg.id, result: result, error: error });
};
