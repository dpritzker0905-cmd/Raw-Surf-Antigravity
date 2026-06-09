/**
 * forecastHelpers.js
 * Extracted helper utilities for weather forecasting and unit conversions.
 */

import { isGridLayerSupported } from './marineControllerUtils';
import { wrapLngRelative, getCenterLng } from './mapUtils';

export var mToFt = (m) => m != null ? (m * 3.281).toFixed(1) : null;

export var degToCompass = (deg) => {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
};

export function findHourIndex(timeArray, timeOffsetHours) {
  if (!timeArray) return 0;
  const offset = isNaN(Number(timeOffsetHours)) ? 0 : Number(timeOffsetHours);
  const targetTime = new Date();
  targetTime.setHours(targetTime.getHours() + offset);
  const targetTs = targetTime.getTime();

  let closest = 0;
  let minDiff = Infinity;
  timeArray.forEach((t, i) => {
    const diff = Math.abs(new Date(t.endsWith('Z') ? t : t + 'Z').getTime() - targetTs);
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

  if (activeModel === 'EURO' && EURO_UNSUPPORTED_MARINE_VARS.has(targetVariable)) return null;
  if (activeModel === 'ICON' && ICON_UNSUPPORTED_MARINE_VARS.has(targetVariable)) return null;

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
  let wrappedLngForTile = lng;
  let wrappedWestForTile = 0;
  let wrappedEastForTile = 0;
  for (const tile of matchingTiles) {
    if (!tile.bounds || tile.bounds.length !== 4) continue;
    const [tWest, tSouth, tEast, tNorth] = tile.bounds;
    const center = getCenterLng(tWest, tEast);
    const wLng = wrapLngRelative(lng, center);
    const wWest = wrapLngRelative(tWest, center);
    const wEast = wrapLngRelative(tEast, center);
    if (wLng >= wWest && wLng <= wEast && lat >= tSouth && lat <= tNorth) {
      bestTile = tile;
      wrappedLngForTile = wLng;
      wrappedWestForTile = wWest;
      wrappedEastForTile = wEast;
      break;
    }
  }
  
  if (!bestTile) {
    return null;
  }
  
  if (!bestTile || !bestTile.values || !bestTile.values.length) return null;
  
  const [tWest, tSouth, tEast, tNorth] = bestTile.bounds;
  const tLngSpan = wrappedEastForTile - wrappedWestForTile;
  const tLatSpan = tNorth - tSouth;
  
  const tileCols = bestTile.nx || Math.sqrt(bestTile.values.length);
  const tileRows = bestTile.ny || Math.sqrt(bestTile.values.length);
  if (!tileCols || isNaN(tileCols)) return null;
  
  const tx = Math.max(0, Math.min(tileCols - 1, ((wrappedLngForTile - wrappedWestForTile) / tLngSpan) * (tileCols - 1)));
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

/**
 * Sample wave data directly from the marine grid that drives the heatmap.
 * Ensures the infobox shows values consistent with the visual heatmap colors,
 * using the SAME data source as WebGLMarineEngine (bilinear interpolation).
 * Falls back gracefully to null if grid data isn't available.
 */
export function sampleFromMarineGrid(lat, lng, activeModel, activeLayer) {
  if (typeof window === 'undefined' || !window.__MARINE_WIND_DATA__ || lat == null || lng == null) {
    return null;
  }
  const grid = window.__MARINE_WIND_DATA__;
  if (!grid.vectors?.length || !grid.cols || !grid.rows || !grid.bounds) return null;

  if (activeModel && grid.__sourceModel && grid.__sourceModel !== activeModel) {
    return null;
  }

  if (activeModel === 'GFS' || activeModel === 'ICON') {
    if (grid.__provider !== 'open-meteo' && grid.__provider !== 'backend-weather-service' && grid.__provider !== 'test-fixture') return null;
  } else if (activeModel === 'EURO') {
    if (activeLayer === 'waves') {
      if (grid.__provider !== 'open-meteo' && grid.__provider !== 'estimated' && grid.__provider !== 'test-fixture') return null;
    } else if (['swell_1', 'swell_2', 'wind_waves'].includes(activeLayer)) {
      const validProviders = ['copernicus', 'estimated', 'gfs_estimated_backdrop', 'gfs_estimated_fallback', 'test-fixture'];
      const isValidProvider = validProviders.includes(grid.__gridProvider) &&
                              grid.__componentLayer === activeLayer;
      if (!isValidProvider) return null;
    } else {
      return null;
    }
  }

  const { west, south, east, north } = grid.bounds;
  const latSpan = north - south;
 
  const center = getCenterLng(west, east);
  const wrappedWest = wrapLngRelative(west, center);
  const wrappedEast = wrapLngRelative(east, center);
  const lngSpan = wrappedEast - wrappedWest;
 
  const normLng = wrapLngRelative(lng, center);
  if (normLng < wrappedWest || normLng > wrappedEast || lat < south || lat > north) return null;
 
  const fx = ((normLng - wrappedWest) / lngSpan) * (grid.cols - 1);
  const fy = ((lat - south) / latSpan) * (grid.rows - 1);

  const x0 = Math.floor(fx);
  const x1 = Math.min(grid.cols - 1, x0 + 1);
  const y0 = Math.floor(fy);
  const y1 = Math.min(grid.rows - 1, y0 + 1);

  const dx = fx - x0;
  const dy = fy - y0;

  const idx00 = y0 * grid.cols + x0;
  const idx10 = y0 * grid.cols + x1;
  const idx01 = y1 * grid.cols + x0;
  const idx11 = y1 * grid.cols + x1;

  const v00 = grid.vectors[idx00];
  const v10 = grid.vectors[idx10];
  const v01 = grid.vectors[idx01];
  const v11 = grid.vectors[idx11];

  const LAYER_TO_COMPONENT = { waves: 'waves', swell_1: 'swell_1', swell_2: 'swell_2', wind_waves: 'wind_waves' };
  const componentKey = LAYER_TO_COMPONENT[activeLayer] || 'waves';

  const getComp = (vec) => {
    if (grid.__gridProvider === 'copernicus' || grid.__gridProvider === 'estimated') {
      return vec;
    }
    if (vec?.[componentKey] !== undefined) {
      return vec[componentKey];
    }
    if (vec?.speed !== undefined) {
      return vec;
    }
    return null;
  };

  const corners = [
    { vec: v00, w: (1 - dx) * (1 - dy) },
    { vec: v10, w: dx * (1 - dy) },
    { vec: v01, w: (1 - dx) * dy },
    { vec: v11, w: dx * dy }
  ];

  const validOceanCorners = corners.filter(item => {
    if (!item.vec || !item.vec.isOcean) return false;
    const c = getComp(item.vec);
    return c && c.speed > 0;
  });

  if (validOceanCorners.length === 0) return null;

  if (validOceanCorners.length >= 2) {
    const sumW = validOceanCorners.reduce((acc, item) => acc + item.w, 0);
    if (sumW > 0) {
      let avgU = 0;
      let avgV = 0;
      let periodSum = 0;
      let periodW = 0;
      for (const item of validOceanCorners) {
        const normW = item.w / sumW;
        const comp = getComp(item.vec);
        avgU += normW * comp.u;
        avgV += normW * comp.v;
        if (comp.period !== undefined && comp.period !== null) {
          periodSum += normW * comp.period;
          periodW += normW;
        }
      }
      const value = Math.sqrt(avgU * avgU + avgV * avgV);
      const direction = (avgU !== 0 || avgV !== 0)
        ? (Math.atan2(-avgU, -avgV) * 180 / Math.PI + 360) % 360
        : null;
      const period = periodW > 0 ? periodSum / periodW : null;
      return { value, direction, period: period > 0 ? period : null, source: 'marine_grid' };
    }
  }

  // Fallback to nearest ocean vector (if validOceanCorners.length === 1 or sumW === 0)
  const cosLat = Math.cos((lat * Math.PI) / 180.0);
  const best = validOceanCorners.reduce((a, b) => {
    const dLngA = (wrapLngRelative(a.vec.lng, normLng) - normLng) * cosLat;
    const dLatA = a.vec.lat - lat;
    const dA = dLatA * dLatA + dLngA * dLngA;

    const dLngB = (wrapLngRelative(b.vec.lng, normLng) - normLng) * cosLat;
    const dLatB = b.vec.lat - lat;
    const dB = dLatB * dLatB + dLngB * dLngB;

    return dA < dB ? a : b;
  }).vec;
  const comp = getComp(best);
  if (!comp) return null;
  const dir = comp.u !== 0 || comp.v !== 0
    ? (Math.atan2(-comp.u, -comp.v) * 180 / Math.PI + 360) % 360
    : null;
  return { value: comp.speed, direction: dir, period: comp.period || null, source: 'marine_grid_nearest' };
}
