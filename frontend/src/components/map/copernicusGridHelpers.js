/**
 * copernicusGridHelpers.js
 * 
 * Bilinear upscaling and grid point generation for Copernicus grid fetcher.
 */

export function upscaleGrid(originalGrid, targetSize) {
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

/**
 * Compute a regular lat/lon grid within the given viewport bounds.
 */
export function computeRegionalGrid(bounds, gridSize) {
  var latMin = Math.max(-80, bounds.south);
  var latMax = Math.min(85, bounds.north);
  var lonMin = bounds.west;
  var lonMax = bounds.east;

  if (lonMax < lonMin) lonMax += 360;

  var latStep = (latMax - latMin) / (gridSize - 1);
  var lonStep = (lonMax - lonMin) / (gridSize - 1);
  var points = [];

  for (var r = 0; r < gridSize; r++) {
    for (var c = 0; c < gridSize; c++) {
      var lat = latMin + r * latStep;
      var lng = lonMin + c * lonStep;
      var normLng = lng;
      if (normLng > 180) normLng -= 360;
      if (normLng < -180) normLng += 360;
      points.push({
        lat: Number(lat.toFixed(4)),
        lng: Number(normLng.toFixed(4)),
        monotonicLng: Number(lng.toFixed(4))
      });
    }
  }

  return {
    points,
    gridSize: gridSize,
    bounds: { west: lonMin, south: latMin, east: lonMax, north: latMax }
  };
}
