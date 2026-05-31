/**
 * forecastHelpers.js
 * Extracted helper utilities for weather forecasting and unit conversions.
 */

export var mToFt = (m) => m != null ? (m * 3.281).toFixed(1) : null;

export var degToCompass = (deg) => {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
};

export function findHourIndex(timeArray, timeOffsetHours) {
  if (!timeArray) return 0;
  const targetTime = new Date();
  targetTime.setHours(targetTime.getHours() + timeOffsetHours);
  const targetTs = targetTime.getTime();

  let closest = 0;
  let minDiff = Infinity;
  timeArray.forEach((t, i) => {
    const diff = Math.abs(new Date(t + 'Z').getTime() - targetTs);
    if (diff < minDiff) { minDiff = diff; closest = i; }
  });
  return closest;
}

export function getClampedValue(array, index) {
  if (!array || !Array.isArray(array) || array.length === 0) return null;
  const clampedIndex = Math.max(0, Math.min(index, array.length - 1));
  for (let i = clampedIndex; i >= 0; i--) {
    if (array[i] !== null && array[i] !== undefined) return array[i];
  }
  for (let i = clampedIndex + 1; i < array.length; i++) {
    if (array[i] !== null && array[i] !== undefined) return array[i];
  }
  return null;
}

export function getBiasAdjusted(val, variableType, activeModel, timeOffsetHours) {
  if (val == null) return null;
  const isSwell2 = variableType === 'swell2';
  const isFallback = (activeModel === 'ICON' && (timeOffsetHours > 180 || isSwell2));
  if (!isFallback) return val;
  if (activeModel === 'ICON') {
    if (variableType === 'wind' || variableType === 'wind_gusts') return val * 0.97;
    if (variableType === 'wave' || variableType === 'swell1' || variableType === 'wind_wave') return val * 0.96;
  }
  return val;
}

export var EURO_UNSUPPORTED_MARINE_VARS = new Set([
  'wave_height', 'wave_direction', 'wave_period',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
  'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
  'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
]);
export var ICON_UNSUPPORTED_MARINE_VARS = new Set([
  'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period'
]);

export function sampleValueFromDecodedTiles(lat, lng, targetVariable, timeOffsetHours = 0, activeModel = 'GFS') {
  if (typeof window === 'undefined' || !window.__DECODED_OM_TILES__ || lat == null || lng == null) {
    return null;
  }

  // v5.9.3: Model capability gate — refuse to sample tiles for unsupported variables.
  // Prevents stale GFS tiles from being returned as EURO/ICON data.
  if (activeModel === 'EURO' && EURO_UNSUPPORTED_MARINE_VARS.has(targetVariable)) return null;
  if (activeModel === 'ICON' && ICON_UNSUPPORTED_MARINE_VARS.has(targetVariable)) return null;

  // Resolve the correct model for the variable to lookup its validTimes for accurate index matching
  const isMarine = targetVariable.includes('wave') || targetVariable.includes('swell');
  const model = isMarine 
    ? (activeModel === 'EURO' ? 'ecmwf_wam025' : (activeModel === 'ICON' ? 'dwd_gwam' : 'ncep_gfswave025'))
    : (activeModel === 'EURO' ? 'ecmwf_ifs025' : (activeModel === 'ICON' ? 'dwd_icon' : 'ncep_gfs013'));

  const meta = window.__MODEL_METADATA_CACHE__?.[model];
  let targetIdx = 0;

  if (meta && Array.isArray(meta.validTimes) && meta.validTimes.length > 0) {
    const targetMs = Date.now() + timeOffsetHours * 3600000;
    let minDiff = Infinity;
    for (let i = 0; i < meta.validTimes.length; i++) {
      const diff = Math.abs(new Date(meta.validTimes[i]).getTime() - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        targetIdx = i;
      }
    }
  } else {
    // Fallback: standard GFS/OM intervals (3-hourly for marine, 1-hourly for atmospheric)
    const hoursPerStep = isMarine ? 3 : 1;
    targetIdx = Math.round(timeOffsetHours / hoursPerStep);
  }
  
  const matchingTiles = [];
  for (const tile of window.__DECODED_OM_TILES__.values()) {
    if (tile.variable === targetVariable && tile.timeIndex === targetIdx && tile.model === model) {
      matchingTiles.push(tile);
    }
  }
  
  if (matchingTiles.length === 0) return null;
  
  let bestTile = null;
  for (const tile of matchingTiles) {
    if (!tile.bounds || tile.bounds.length !== 4) continue;
    const [tWest, tSouth, tEast, tNorth] = tile.bounds;
    if (lng >= tWest && lng <= tEast && lat >= tSouth && lat <= tNorth) {
      bestTile = tile;
      break;
    }
  }
  
  if (!bestTile) {
    return null; // no_containing_tile — refuse to sample from non-containing tile
  }
  
  if (!bestTile || !bestTile.values || !bestTile.values.length) return null;
  
  const [tWest, tSouth, tEast, tNorth] = bestTile.bounds;
  const tLngSpan = tEast - tWest;
  const tLatSpan = tNorth - tSouth;
  
  const tileCols = bestTile.nx || Math.sqrt(bestTile.values.length);
  const tileRows = bestTile.ny || Math.sqrt(bestTile.values.length);
  if (!tileCols || isNaN(tileCols)) return null;
  
  const tx = Math.max(0, Math.min(tileCols - 1, ((lng - tWest) / tLngSpan) * (tileCols - 1)));
  const ty = Math.max(0, Math.min(tileRows - 1, (1.0 - (lat - tSouth) / tLatSpan) * (tileRows - 1)));
  
  const x0 = Math.floor(tx);
  const x1 = Math.min(tileCols - 1, x0 + 1);
  const y0 = Math.floor(ty);
  const y1 = Math.min(tileRows - 1, y0 + 1);
  
  const dx = tx - x0;
  const dy = ty - y0;
  
  const idx00 = y0 * tileCols + x0;
  const idx10 = y0 * tileCols + x1;
  const idx01 = y1 * tileCols + x0;
  const idx11 = y1 * tileCols + x1;
  
  const raw00 = bestTile.values[idx00];
  const raw10 = bestTile.values[idx10];
  const raw01 = bestTile.values[idx01];
  const raw11 = bestTile.values[idx11];
  
  const isPeriod = targetVariable.includes('period');
  
  let value;
  if (isPeriod) {
    let weightSum = 0;
    let weightedVal = 0;
    
    if (raw00 != null && !isNaN(raw00) && raw00 > 0) {
      const w = (1 - dx) * (1 - dy);
      weightedVal += raw00 * w;
      weightSum += w;
    }
    if (raw10 != null && !isNaN(raw10) && raw10 > 0) {
      const w = dx * (1 - dy);
      weightedVal += raw10 * w;
      weightSum += w;
    }
    if (raw01 != null && !isNaN(raw01) && raw01 > 0) {
      const w = (1 - dx) * dy;
      weightedVal += raw01 * w;
      weightSum += w;
    }
    if (raw11 != null && !isNaN(raw11) && raw11 > 0) {
      const w = dx * dy;
      weightedVal += raw11 * w;
      weightSum += w;
    }
    
    if (weightSum > 0) {
      value = weightedVal / weightSum;
    } else {
      value = 0;
    }
  } else {
    const v00 = (typeof raw00 === 'number' && !isNaN(raw00)) ? raw00 : 0;
    const v10 = (typeof raw10 === 'number' && !isNaN(raw10)) ? raw10 : 0;
    const v01 = (typeof raw01 === 'number' && !isNaN(raw01)) ? raw01 : 0;
    const v11 = (typeof raw11 === 'number' && !isNaN(raw11)) ? raw11 : 0;
    
    value = v00 * (1 - dx) * (1 - dy) +
            v10 * dx * (1 - dy) +
            v01 * (1 - dx) * dy +
            v11 * dx * dy;
  }

  // Apply Nearshore Coastal Wave Decay:
  const isWaveHeightVar = targetVariable.includes('height') && (targetVariable.includes('wave') || targetVariable.includes('swell'));
  if (isWaveHeightVar && value > 0) {
    let landCount = 0;
    if (raw00 == null || isNaN(raw00) || raw00 === 0) landCount++;
    if (raw10 == null || isNaN(raw10) || raw10 === 0) landCount++;
    if (raw01 == null || isNaN(raw01) || raw01 === 0) landCount++;
    if (raw11 == null || isNaN(raw11) || raw11 === 0) landCount++;
    
    if (landCount > 0) {
      const decayFactor = landCount === 1 ? 0.65 : (landCount === 2 ? 0.45 : 0.35);
      value = value * decayFactor;
      
      if (typeof window !== 'undefined' && window.__OM_SAMPLER_DEBUG__) {
        console.log(`[Nearshore-Decay] Coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)}) variable: ${targetVariable} is nearshore. Land neighbors: ${landCount}/4, Decay: ${decayFactor.toFixed(2)}x -> Value: ${value.toFixed(2)}`);
      }
    }
  }
                
  let direction = null;
  if (bestTile.directions) {
    const d00 = bestTile.directions[idx00] || 0;
    const d10 = bestTile.directions[idx10] || 0;
    const d01 = bestTile.directions[idx01] || 0;
    const d11 = bestTile.directions[idx11] || 0;
    
    const r00 = d00 * Math.PI / 180;
    const r10 = d10 * Math.PI / 180;
    const r01 = d01 * Math.PI / 180;
    const r11 = d11 * Math.PI / 180;
    
    const sinAvg = Math.sin(r00) * (1 - dx) * (1 - dy) +
                   Math.sin(r10) * dx * (1 - dy) +
                   Math.sin(r01) * (1 - dx) * dy +
                   Math.sin(r11) * dx * dy;
                   
    const cosAvg = Math.cos(r00) * (1 - dx) * (1 - dy) +
                   Math.cos(r10) * dx * (1 - dy) +
                   Math.cos(r01) * (1 - dx) * dy +
                   Math.cos(r11) * dx * dy;
                   
    direction = (Math.atan2(sinAvg, cosAvg) * 180 / Math.PI + 360) % 360;
  }
  
  if (value !== null && value !== undefined && typeof window !== 'undefined' && window.__OM_SAMPLER_DEBUG__) {
    console.log(`[OM-Sampler] Coordinate (${lat.toFixed(4)}, ${lng.toFixed(4)}) variable: ${targetVariable} -> Sampled Value: ${value.toFixed(2)}, Dir: ${direction}`);
  }

  return { value, direction };
}
