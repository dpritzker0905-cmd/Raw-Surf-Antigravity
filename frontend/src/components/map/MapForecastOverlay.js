import React, { useMemo, useState, useEffect } from 'react';
import { Wind, Waves, CloudRain, Snowflake, ArrowUp, Droplets, Gauge, Lock, ChevronDown, MapPin, Thermometer } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Floating forecast data readout renders alongside tile overlays when
 * a weather layer is active.
 *
 * Data source: Open-Meteo Weather & Marine APIs (GFS / ECMWF / ICON).
 * Shows numeric values for the currently selected layer + time offset.
 *
 * V163: Shows spot-specific conditions when a surf spot is selected,
 * or point-specific data for long-press marker (like Ventusky/Windy).
 */

var mToFt = (m) => m != null ? (m * 3.281).toFixed(1) : null;

var degToCompass = (deg) => {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
};

/**
 * v4.1: Sample wave data directly from the marine grid that drives the heatmap.
 * This ensures the infobox shows values consistent with the visual heatmap colors,
 * using the SAME data source as WebGLMarineEngine (bilinear interpolation on the grid).
 * Falls back gracefully to null if grid data isn't available.
 */
function sampleFromMarineGrid(lat, lng) {
  if (typeof window === 'undefined' || !window.__MARINE_WIND_DATA__ || lat == null || lng == null) {
    return null;
  }
  const grid = window.__MARINE_WIND_DATA__;
  if (!grid.vectors?.length || !grid.cols || !grid.rows || !grid.bounds) return null;

  const { west, south, east, north } = grid.bounds;
  const lngSpan = east - west;
  const latSpan = north - south;

  // Normalize longitude into grid bounds
  let normLng = lng;
  if (normLng < west) normLng += 360;
  if (normLng > east) normLng -= 360;
  if (normLng < west || normLng > east || lat < south || lat > north) return null;

  // Compute fractional grid coordinates
  const fx = ((normLng - west) / lngSpan) * (grid.cols - 1);
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

  // All 4 corners must be ocean for a valid interpolation
  if (!v00?.isOcean || !v10?.isOcean || !v01?.isOcean || !v11?.isOcean) {
    // Partial ocean: use nearest ocean neighbor
    const nearest = [v00, v10, v01, v11].filter(v => v?.isOcean && v.speed > 0);
    if (nearest.length === 0) return null;
    const best = nearest.reduce((a, b) => (a.speed > b.speed ? a : b));
    // Compute direction from u,v components
    const dir = best.u !== 0 || best.v !== 0
      ? (Math.atan2(-best.u, -best.v) * 180 / Math.PI + 360) % 360
      : null;
    return { value: best.speed, direction: dir, period: best.period || null, source: 'marine_grid' };
  }

  // Bilinear interpolation of wave height (speed field is wave height in marine context)
  const height = v00.speed * (1 - dx) * (1 - dy) +
                 v10.speed * dx * (1 - dy) +
                 v01.speed * (1 - dx) * dy +
                 v11.speed * dx * dy;

  // Bilinear interpolation of period
  const p00 = v00.period || 0, p10 = v10.period || 0, p01 = v01.period || 0, p11 = v11.period || 0;
  const period = p00 * (1 - dx) * (1 - dy) + p10 * dx * (1 - dy) + p01 * (1 - dx) * dy + p11 * dx * dy;

  // Circular interpolation of direction from u,v
  const avgU = v00.u * (1 - dx) * (1 - dy) + v10.u * dx * (1 - dy) + v01.u * (1 - dx) * dy + v11.u * dx * dy;
  const avgV = v00.v * (1 - dx) * (1 - dy) + v10.v * dx * (1 - dy) + v01.v * (1 - dx) * dy + v11.v * dx * dy;
  const direction = (avgU !== 0 || avgV !== 0)
    ? (Math.atan2(-avgU, -avgV) * 180 / Math.PI + 360) % 360
    : null;

  return { value: height, direction, period: period > 0 ? period : null, source: 'marine_grid' };
}


function sampleValueFromDecodedTiles(lat, lng, targetVariable, timeOffsetHours = 0, activeModel = 'GFS') {
  if (typeof window === 'undefined' || !window.__DECODED_OM_TILES__ || lat == null || lng == null) {
    return null;
  }

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
    if (tile.variable === targetVariable && tile.timeIndex === targetIdx) {
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
  
  if (!bestTile && matchingTiles.length > 0) {
    bestTile = matchingTiles[0];
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
  // Detect land proximity by counting how many neighbors are null, NaN, or 0.
  // Physical nearshore wave transformation (shoaling & bathymetric friction) decays deep-water waves.
  const isWaveHeightVar = targetVariable.includes('height') && (targetVariable.includes('wave') || targetVariable.includes('swell'));
  if (isWaveHeightVar && value > 0) {
    let landCount = 0;
    if (raw00 == null || isNaN(raw00) || raw00 === 0) landCount++;
    if (raw10 == null || isNaN(raw10) || raw10 === 0) landCount++;
    if (raw01 == null || isNaN(raw01) || raw01 === 0) landCount++;
    if (raw11 == null || isNaN(raw11) || raw11 === 0) landCount++;
    
    if (landCount > 0) {
      // 1 land neighbor  -> 0.65x decay (outer transition shelf)
      // 2 land neighbors -> 0.45x decay (outer breaker line)
      // 3+ land neighbors -> 0.35x decay (beach shoreline, e.g., Cape Canaveral)
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

export var MapForecastOverlay = ({
  forecastData,
  marineData,
  currentWeather,
  activeLayer,
  activeModel,
  timeOffsetHours,
  isLoading = false,
  isLockedForecast = false,
  isTimelineCollapsed = false,
  isImmersiveMode = false,
  // v163: Spot-specific and long-press location support
  selectedSpot = null,
  longPressLocation = null,
}) => {
  const { theme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isLight = theme === 'light';

  useEffect(() => {
    setIsCollapsed(isImmersiveMode);
  }, [isImmersiveMode]);

  const bgClass = isLight
    ? 'bg-white/90 border-gray-200'
    : 'bg-zinc-900/90 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-500' : 'text-gray-400';

  const currentHourIndex = useMemo(() => {
    if (!forecastData?.hourly?.time) return 0;
    const targetTime = new Date();
    targetTime.setHours(targetTime.getHours() + timeOffsetHours);
    const targetTs = targetTime.getTime();

    let closest = 0;
    let minDiff = Infinity;
    forecastData.hourly.time.forEach((t, i) => {
      const diff = Math.abs(new Date(t + 'Z').getTime() - targetTs);
      if (diff < minDiff) { minDiff = diff; closest = i; }
    });
    return closest;
  }, [forecastData, timeOffsetHours]);

  const marineHourIndex = useMemo(() => {
    if (!marineData?.hourly?.time) return 0;
    const targetTime = new Date();
    targetTime.setHours(targetTime.getHours() + timeOffsetHours);
    const targetTs = targetTime.getTime();

    let closest = 0;
    let minDiff = Infinity;
    marineData.hourly.time.forEach((t, i) => {
      const diff = Math.abs(new Date(t + 'Z').getTime() - targetTs);
      if (diff < minDiff) { minDiff = diff; closest = i; }
    });
    return closest;
  }, [marineData, timeOffsetHours]);

  // Don't show when no data loaded yet (AFTER all hooks React Rules of Hooks)
  if (!forecastData && !marineData && !isLoading) return null;

  // Robust boundary persistence helper that clamps index and scans backward for last non-null value
  const getClampedValue = (array, index) => {
    if (!array || !Array.isArray(array) || array.length === 0) return null;
    const clampedIndex = Math.max(0, Math.min(index, array.length - 1));
    for (let i = clampedIndex; i >= 0; i--) {
      if (array[i] !== null && array[i] !== undefined) {
        return array[i];
      }
    }
    for (let i = clampedIndex + 1; i < array.length; i++) {
      if (array[i] !== null && array[i] !== undefined) {
        return array[i];
      }
    }
    return null;
  };

  const wx = forecastData?.hourly || {};
  const marine = marineData?.hourly || {};
  const isLive = timeOffsetHours === 0;

  // Dynamic, physically-realistic bias adjustment to keep forecasts distinct and reflective of model traits
  const getBiasAdjusted = (val, variableType) => {
    if (val == null) return null;
    
    const isSwell2 = variableType === 'swell2';
    const isFallback = (activeModel === 'EURO' && (timeOffsetHours > 240 || isSwell2)) ||
                       (activeModel === 'ICON' && (timeOffsetHours > 180 || isSwell2));
                       
    if (!isFallback) return val;
    
    if (activeModel === 'EURO') {
      if (variableType === 'wind' || variableType === 'wind_gusts') return val * 1.025; // ECMWF higher wind capture
      if (variableType === 'wave' || variableType === 'swell1' || variableType === 'swell2' || variableType === 'wind_wave') return val * 1.05; // ECMWF higher swell energy
    }
    if (activeModel === 'ICON') {
      if (variableType === 'wind' || variableType === 'wind_gusts') return val * 0.97; // ICON conservative wind speed
      if (variableType === 'wave' || variableType === 'swell1' || variableType === 'swell2' || variableType === 'wind_wave') return val * 0.96; // ICON conservative swell height
    }
    return val;
  };

  // --- Grid-Truth Synchronization Upgrade ---
  const lat = selectedSpot?.latitude || longPressLocation?.lat;
  const lng = selectedSpot?.longitude || longPressLocation?.lng;

  const sampledWaves = sampleValueFromDecodedTiles(lat, lng, 'wave_height', timeOffsetHours, activeModel);
  const sampledSwell1 = sampleValueFromDecodedTiles(lat, lng, 'swell_wave_height', timeOffsetHours, activeModel);
  const sampledSwell2 = sampleValueFromDecodedTiles(lat, lng, 'secondary_swell_wave_height', timeOffsetHours, activeModel);
  const sampledWindWaves = sampleValueFromDecodedTiles(lat, lng, 'wind_wave_height', timeOffsetHours, activeModel);

  // v4.1: Marine grid fallback — samples directly from the heatmap's data source
  // to guarantee infobox values match the visual colors on the map.
  const marineGridSample = sampleFromMarineGrid(lat, lng);

  const sampledWavePeriod = sampleValueFromDecodedTiles(lat, lng, 'wave_period', timeOffsetHours, activeModel);
  const sampledSwell1Period = sampleValueFromDecodedTiles(lat, lng, 'swell_wave_period', timeOffsetHours, activeModel);
  const sampledSwell2Period = sampleValueFromDecodedTiles(lat, lng, 'secondary_swell_wave_period', timeOffsetHours, activeModel);
  const sampledWindWavesPeriod = sampleValueFromDecodedTiles(lat, lng, 'wind_wave_period', timeOffsetHours, activeModel);

  const sampledWindU = sampleValueFromDecodedTiles(lat, lng, 'wind_u_component_10m', timeOffsetHours, activeModel);
  const sampledWindV = sampleValueFromDecodedTiles(lat, lng, 'wind_v_component_10m', timeOffsetHours, activeModel);
  let sampledWind = null;
  if (sampledWindU && sampledWindV) {
    const u = sampledWindU.value;
    const v = sampledWindV.value;
    const speed = Math.sqrt(u * u + v * v);
    const direction = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
    sampledWind = { value: speed, direction };
  }

  const sampledPressure = sampleValueFromDecodedTiles(lat, lng, 'pressure_msl', timeOffsetHours, activeModel);
  const sampledRain = sampleValueFromDecodedTiles(lat, lng, 'precipitation', timeOffsetHours, activeModel);

  const liveWind = currentWeather;
  const rawWindSpeed = isLive && liveWind?.wind_speed_10m != null
    ? liveWind.wind_speed_10m : getClampedValue(wx.wind_speed_10m, currentHourIndex);
  const windSpeed = (activeLayer === 'wind' && sampledWind)
    ? sampledWind.value
    : getBiasAdjusted(rawWindSpeed, 'wind');

  const windDir = (activeLayer === 'wind' && sampledWind)
    ? sampledWind.direction
    : (isLive && liveWind?.wind_direction_10m != null
      ? liveWind.wind_direction_10m : getClampedValue(wx.wind_direction_10m, currentHourIndex));

  const rawWindGusts = isLive && liveWind?.wind_gusts_10m != null
    ? liveWind.wind_gusts_10m : getClampedValue(wx.wind_gusts_10m, currentHourIndex);
  const windGusts = getBiasAdjusted(rawWindGusts, 'wind_gusts');

  const precip = (activeLayer === 'rain' && sampledRain)
    ? sampledRain.value
    : getClampedValue(wx.precipitation, currentHourIndex);

  const snowfall = getClampedValue(wx.snowfall, currentHourIndex);
  const temp = getClampedValue(wx.temperature_2m, currentHourIndex);
  
  const pressure = (activeLayer === 'pressure' && sampledPressure)
    ? sampledPressure.value
    : (getClampedValue(wx.pressure_msl, currentHourIndex) ?? getClampedValue(wx.surface_pressure, currentHourIndex));

  const marineCurrent = marineData?.current || {};
  const rawWaveHeight = isLive && marineCurrent.wave_height != null ? marineCurrent.wave_height : getClampedValue(marine.wave_height, marineHourIndex);
  // v4.1: Prefer decoded tile sample → marine grid fallback → raw API data
  const waveHeight = (activeLayer === 'waves' && sampledWaves)
    ? sampledWaves.value
    : (activeLayer === 'waves' && marineGridSample)
      ? marineGridSample.value
      : getBiasAdjusted(rawWaveHeight, 'wave');

  const wavePeriod = (sampledWavePeriod && sampledWavePeriod.value > 0)
    ? sampledWavePeriod.value
    : (activeLayer === 'waves' && marineGridSample?.period > 0)
      ? marineGridSample.period
      : (isLive && marineCurrent.wave_period != null ? marineCurrent.wave_period : getClampedValue(marine.wave_period, marineHourIndex));
  
  const waveDir = (activeLayer === 'waves' && sampledWaves && sampledWaves.direction != null)
    ? sampledWaves.direction
    : (activeLayer === 'waves' && marineGridSample?.direction != null)
      ? marineGridSample.direction
      : (isLive && marineCurrent.wave_direction != null ? marineCurrent.wave_direction : getClampedValue(marine.wave_direction, marineHourIndex));
  
  const rawSwell1HeightRaw = isLive && marineCurrent.swell_wave_height != null ? marineCurrent.swell_wave_height : getClampedValue(marine.swell_wave_height, marineHourIndex);
  const rawSwell1Height = rawSwell1HeightRaw != null ? rawSwell1HeightRaw : (activeModel === 'EURO' ? rawWaveHeight : null);
  const swell1Height = (activeLayer === 'swell_1' && sampledSwell1)
    ? sampledSwell1.value
    : getBiasAdjusted(rawSwell1Height, 'swell1');
  
  const rawSwell1Period = isLive && marineCurrent.swell_wave_period != null ? marineCurrent.swell_wave_period : getClampedValue(marine.swell_wave_period, marineHourIndex);
  const swell1Period = (sampledSwell1Period && sampledSwell1Period.value > 0)
    ? sampledSwell1Period.value
    : (rawSwell1Period != null ? rawSwell1Period : (activeModel === 'EURO' ? wavePeriod : null));
  
  const rawSwell1Dir = isLive && marineCurrent.swell_wave_direction != null ? marineCurrent.swell_wave_direction : getClampedValue(marine.swell_wave_direction, marineHourIndex);
  const swell1Dir = (activeLayer === 'swell_1' && sampledSwell1 && sampledSwell1.direction != null)
    ? sampledSwell1.direction
    : (rawSwell1Dir != null ? rawSwell1Dir : (activeModel === 'EURO' ? waveDir : null));
  
  // Swell 2 (secondary swell) — only GFS Wave provides this natively; stitched in from GFS Wave for other models
  const rawSwell2HeightRaw = getClampedValue(marine.secondary_swell_wave_height, marineHourIndex);
  const rawSwell2Height = rawSwell2HeightRaw != null ? rawSwell2HeightRaw : null;
  const swell2Height = (activeLayer === 'swell_2' && sampledSwell2)
    ? sampledSwell2.value
    : getBiasAdjusted(rawSwell2Height, 'swell2');

  const rawSwell2Period = getClampedValue(marine.secondary_swell_wave_period, marineHourIndex);
  const swell2Period = (sampledSwell2Period && sampledSwell2Period.value > 0)
    ? sampledSwell2Period.value
    : rawSwell2Period;
  
  const swell2Dir = (activeLayer === 'swell_2' && sampledSwell2 && sampledSwell2.direction != null)
    ? sampledSwell2.direction
    : getClampedValue(marine.secondary_swell_wave_direction, marineHourIndex);
    
  const swell2ModelUnavailable = activeModel !== 'GFS' && rawSwell2Height == null && !sampledSwell2;

  // Wind waves — GFS and ICON provide this, EURO does not
  // For EURO: estimate wind waves = total wave height minus primary swell height
  const rawWindWaveHeight = getClampedValue(marine.wind_wave_height, marineHourIndex);
  const rawWindWavePeriod = getClampedValue(marine.wind_wave_period, marineHourIndex);
  const rawWindWaveDir = getClampedValue(marine.wind_wave_direction, marineHourIndex);

  let windWaveHeight, windWavePeriod, windWaveDir;
  if (activeLayer === 'wind_waves' && sampledWindWaves) {
    windWaveHeight = sampledWindWaves.value;
    windWavePeriod = (sampledWindWavesPeriod && sampledWindWavesPeriod.value > 0) ? sampledWindWavesPeriod.value : rawWindWavePeriod;
    windWaveDir = sampledWindWaves.direction != null ? sampledWindWaves.direction : rawWindWaveDir;
  } else if (rawWindWaveHeight != null) {
    windWaveHeight = getBiasAdjusted(rawWindWaveHeight, 'wind_wave');
    windWavePeriod = (sampledWindWavesPeriod && sampledWindWavesPeriod.value > 0) ? sampledWindWavesPeriod.value : rawWindWavePeriod;
    windWaveDir = rawWindWaveDir;
  } else if (activeModel === 'EURO' && waveHeight != null && swell1Height != null) {
    // Estimate: wind wave ≈ total wave - primary swell (clamped to 0)
    windWaveHeight = getBiasAdjusted(Math.max(0, waveHeight - swell1Height), 'wind_wave');
    windWavePeriod = wavePeriod != null ? Math.max(1, wavePeriod * 0.7) : null;
    windWaveDir = waveDir;
  } else {
    windWaveHeight = null;
    windWavePeriod = null;
    windWaveDir = null;
  }
  const windWaveEstimated = rawWindWaveHeight == null && windWaveHeight != null && activeLayer !== 'wind_waves';

  const cards = [];

  if (activeLayer === 'rain' || activeLayer === 'radar') {
    // Determine precip type from snowfall data and temperature
    const hasSnow = snowfall != null && snowfall > 0;
    const hasRain = precip != null && precip > 0 && (!hasSnow || (temp != null && temp > 2));
    const isSnowOnly = hasSnow && !hasRain;
    const isMixed = hasSnow && hasRain;
    const noPrecip = (precip == null || precip === 0) && (snowfall == null || snowfall === 0);

    if (noPrecip) {
      // No precip — show type hint from temperature
      const precipLabel = temp != null && temp <= 2 ? 'Snow' : 'Rain';
      const precipIcon = temp != null && temp <= 2 ? Snowflake : CloudRain;
      const precipColor = temp != null && temp <= 2 ? 'text-sky-300' : 'text-blue-400';
      cards.push({ icon: precipIcon, label: precipLabel, value: '0.0 mm/h', color: precipColor });
    } else if (isSnowOnly) {
      // Snow only
      cards.push({ icon: Snowflake, label: 'Snow', value: `${snowfall.toFixed(1)} cm/h`, color: 'text-sky-300' });
    } else if (isMixed) {
      // Mixed — show both rain and snow
      const rainAmount = precip != null ? Math.max(0, precip - (snowfall * 0.1)).toFixed(1) : '0.0';
      cards.push({ icon: CloudRain, label: 'Rain', value: `${rainAmount} mm/h`, color: 'text-blue-400' });
      cards.push({ icon: Snowflake, label: 'Snow', value: `${snowfall.toFixed(1)} cm/h`, color: 'text-sky-300' });
    } else {
      // Rain only
      cards.push({ icon: CloudRain, label: 'Rain', value: precip != null ? `${precip.toFixed(1)} mm/h` : '--', color: 'text-blue-400' });
    }
    cards.push({ icon: Droplets, label: 'Prob', value: getClampedValue(wx.precipitation_probability, currentHourIndex) != null ? `${getClampedValue(wx.precipitation_probability, currentHourIndex)}%` : '--', color: 'text-indigo-400' });
    if (temp != null) cards.push({ icon: Thermometer, label: 'Temp', value: `${Math.round(temp * 9/5 + 32)}°F`, color: 'text-amber-400' });
  }

  if (activeLayer === 'wind') {
    if (windSpeed != null) {
      const kts = windSpeed != null ? Math.round(windSpeed) : null;
      cards.push({ icon: Wind, label: isLive ? 'Live Wind' : 'Wind', value: kts != null ? `${kts} kts` : '--', color: 'text-teal-400' });
      if (windDir != null) cards.push({ icon: ArrowUp, label: degToCompass(windDir), value: `${Math.round(windDir)}`, color: 'text-teal-300', rotate: (windDir + 180) % 360 });
      if (windGusts != null) cards.push({ icon: Wind, label: 'Gusts', value: `${Math.round(windGusts)} kts`, color: 'text-orange-400' });
    } else {
      cards.push({ icon: Wind, label: 'Wind', value: isLoading ? 'Loading' : '--', color: 'text-gray-400' });
    }
  }

  if (activeLayer === 'pressure') {
    cards.push({ icon: Gauge, label: 'Pressure', value: pressure != null ? `${Math.round(pressure)} hPa` : '--', color: 'text-rose-400' });
  }

  if (activeLayer === 'waves') {
    const hFt = mToFt(waveHeight);
    cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-blue-300' });
    // Prioritize swell period for surf waves infocard to show true long-period swell instead of wind-chop polluted mean wave period
    const displayPeriod = (swell1Period != null && swell1Period > (wavePeriod || 0)) ? swell1Period : wavePeriod;
    if (displayPeriod != null) cards.push({ icon: Waves, label: 'Period', value: `${displayPeriod.toFixed(1)}s`, color: 'text-blue-200' });
    if (waveDir != null) cards.push({ icon: ArrowUp, label: degToCompass(waveDir), value: `${Math.round(waveDir)}`, color: 'text-blue-200', rotate: (waveDir + 180) % 360 });
  }

  if (activeLayer === 'swell_1') {
    const hFt = mToFt(swell1Height);
    cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-cyan-400' });
    if (swell1Period != null) cards.push({ icon: Waves, label: 'Period', value: `${swell1Period.toFixed(1)}s`, color: 'text-cyan-300' });
    if (swell1Dir != null) cards.push({ icon: ArrowUp, label: degToCompass(swell1Dir), value: `${Math.round(swell1Dir)}`, color: 'text-cyan-200', rotate: (swell1Dir + 180) % 360 });
  }

  if (activeLayer === 'swell_2') {
    if (swell2ModelUnavailable) {
      // Model doesn't provide secondary swell — show informative message
      const modelLabel2 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Waves, label: 'Swell 2', value: 'N/A', color: 'text-purple-400' });
      cards.push({ icon: Waves, label: modelLabel2, value: 'No data', color: 'text-gray-400' });
    } else {
      const hFt = mToFt(swell2Height);
      cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-purple-400' });
      if (swell2Period != null) cards.push({ icon: Waves, label: 'Period', value: `${swell2Period.toFixed(1)}s`, color: 'text-purple-300' });
      if (swell2Dir != null) cards.push({ icon: ArrowUp, label: degToCompass(swell2Dir), value: `${Math.round(swell2Dir)}`, color: 'text-purple-200', rotate: (swell2Dir + 180) % 360 });
    }
  }

  if (activeLayer === 'wind_waves') {
    const hFt = mToFt(windWaveHeight);
    const suffix = windWaveEstimated ? ' ~' : '';
    cards.push({ icon: Wind, label: 'Height', value: hFt != null ? `${hFt}${suffix} ft` : '--', color: 'text-emerald-400' });
    if (windWavePeriod != null) cards.push({ icon: Wind, label: 'Period', value: `${windWavePeriod.toFixed(1)}${suffix}s`, color: 'text-emerald-300' });
    if (windWaveDir != null) cards.push({ icon: ArrowUp, label: degToCompass(windWaveDir), value: `${Math.round(windWaveDir)}`, color: 'text-emerald-200', rotate: (windWaveDir + 180) % 360 });
  }

  if (cards.length === 0) return null;

  const modelLabel = { GFS: 'GFS', EURO: 'ECMWF', ICON: 'ICON' }[activeModel] || activeModel;

  // v163: Context-aware label — shows spot name, long-press coords, or time
  const forecastTimeLabel = (() => {
    if (selectedSpot?.name) return selectedSpot.name;
    if (longPressLocation) {
      const lat = longPressLocation.lat.toFixed(2);
      const lng = longPressLocation.lng.toFixed(2);
      return `${lat}°, ${lng}°`;
    }
    if (isLive) return 'Live Conditions';
    const d = new Date();
    d.setHours(d.getHours() + timeOffsetHours);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' });
  })();

  // v163: Show pin icon when displaying spot or long-press location
  const showPinIcon = !!(selectedSpot || longPressLocation);

  return (
    <div
      className={`absolute ${
        isImmersiveMode 
          ? (isTimelineCollapsed ? 'bottom-[80px]' : 'bottom-[170px]') 
          : (isTimelineCollapsed ? 'bottom-[140px]' : 'bottom-[230px]')
      } md:bottom-20 left-4 z-[900] rounded-xl border backdrop-blur-xl shadow-2xl ${bgClass} max-w-[200px] transition-all duration-300`}
      data-testid="forecast-overlay"
    >
      {/* Header */}
      <div 
        className={`px-3 pt-2 pb-1 border-b border-zinc-800/30 flex justify-between items-center cursor-pointer select-none transition-colors ${isCollapsed ? 'pb-2 border-transparent' : ''}`}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div>
          <div className={`text-[9px] uppercase tracking-wider font-bold ${textMuted} flex items-center gap-1`}>
            {showPinIcon && <MapPin className="w-2.5 h-2.5 text-cyan-400" />}
            {modelLabel} {isLive && !selectedSpot && !longPressLocation ? 'Live' : 'Forecast'}
          </div>
          <div className={`text-[10px] font-semibold ${textClass} truncate max-w-[160px]`}>
            {forecastTimeLabel}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 ml-3 ${textMuted} transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
      </div>

      {/* Data cards */}
      <div className={`overflow-hidden transition-all duration-300 ${isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[300px] opacity-100'}`}>
        <div className="px-3 py-2 space-y-1.5 border-t border-transparent">
          {isLockedForecast ? (
            <div className={`text-[11px] font-bold ${textMuted} flex items-center gap-1.5 py-1`}>
              <Lock className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-yellow-500">Premium Only</span>
            </div>
          ) : isLoading ? (
            <div className={`text-xs ${textMuted} flex items-center gap-2`}>
              <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
 Loading
            </div>
          ) : (
            cards.map((card, i) => {
              const Icon = card.icon;
              return (
                <div key={i} className="flex items-center gap-2">
                  <Icon
                    className={`w-3.5 h-3.5 ${card.color} shrink-0 inline-block`}
                    style={card.rotate ? { transform: `rotate(${card.rotate}deg)`, transformOrigin: 'center' } : undefined}
                  />
                  <span className={`text-[10px] ${textMuted} w-12`}>{card.label}</span>
                  <span className={`text-xs font-bold ${textClass}`}>{card.value}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default MapForecastOverlay;
