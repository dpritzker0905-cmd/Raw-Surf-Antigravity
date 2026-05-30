/**
 * forecastSamplers.js — Marine data sampling utilities
 *
 * Extracted from MapForecastOverlay.js (v5.7.2 refactor) to keep
 * the overlay component under 800 LOC.
 *
 * Contains three independent sampling pathways:
 *   1. sampleFromMarineGrid()      — samples the live WebGL marine grid
 *   2. fetchExactMarinePoint()     — exact-point Open-Meteo API fetch
 *   3. sampleValueFromDecodedTiles() — samples decoded OM raster tiles
 *
 * RULES:
 *   - NO React, NO DOM manipulation
 *   - Pure data sampling + caching
 *   - Marine directions are forecast-authoritative (no mutation)
 *   - v5.9.3: No cross-model sampling — unsupported model/var returns null
 */

import { MARINE_MODEL_CAPABILITIES } from './marineControllerUtils';

// v6.1: EURO marine now comes from Copernicus, NOT Open-Meteo decoded tiles.
// Block ALL marine variables from decoded tile sampling for EURO to prevent
// stale Open-Meteo tile data from leaking into the Copernicus-sourced infobox.
var EURO_UNSUPPORTED_MARINE_VARS = new Set([
  'wave_height', 'wave_direction', 'wave_period',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
  'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
  'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
]);
var ICON_UNSUPPORTED_MARINE_VARS = new Set([
  'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period'
]);

// ========================================================================
// 1. MARINE GRID SAMPLER — bilinear interpolation on the live heatmap grid
// ========================================================================

/**
 * Sample wave data directly from the marine grid that drives the heatmap.
 * Ensures the infobox shows values consistent with the visual heatmap colors,
 * using the SAME data source as WebGLMarineEngine (bilinear interpolation).
 * Falls back gracefully to null if grid data isn't available.
 *
 * v5.9.4: Added activeModel parameter to prevent cross-model grid leakage.
 * Returns null if the grid was produced by a different model than requested.
 *
 * v6.2: Added activeLayer parameter. Grid vectors store per-component data
 * (waves, swell_1, swell_2, wind_waves). Without activeLayer, the function
 * was reading undefined top-level v.speed/v.u/v.v — always returning 0/null.
 *
 * @param {number|null} lat
 * @param {number|null} lng
 * @param {string} [activeModel] - 'GFS' | 'ICON' | 'EURO'
 * @param {string} [activeLayer] - 'waves' | 'swell_1' | 'swell_2' | 'wind_waves'
 * @returns {{ value: number, direction: number|null, period: number|null, source: string } | null}
 */
export function sampleFromMarineGrid(lat, lng, activeModel, activeLayer) {
  if (typeof window === 'undefined' || !window.__MARINE_WIND_DATA__ || lat == null || lng == null) {
    return null;
  }
  const grid = window.__MARINE_WIND_DATA__;
  if (!grid.vectors?.length || !grid.cols || !grid.rows || !grid.bounds) return null;

  // v5.9.4: Model guard — reject grid data from a different model to prevent
  // GFS values leaking into EURO/ICON infobox during model switch transitions.
  if (activeModel && grid.__sourceModel && grid.__sourceModel !== activeModel) {
    return null;
  }

  // v6.3: Grid provider guard — grid data always comes from Open-Meteo, even for EURO.
  // EURO grid uses ecmwf_wam025 model. Only exact-point uses Copernicus.
  const EXPECTED_PROVIDERS = { GFS: 'open-meteo', ICON: 'open-meteo', EURO: 'open-meteo' };
  const expectedProvider = activeModel ? EXPECTED_PROVIDERS[activeModel] : null;
  if (expectedProvider && grid.__provider && grid.__provider !== expectedProvider) {
    return null;
  }

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

  // v6.2: Map activeLayer to the correct grid vector component key.
  // Grid vectors have: { waves: {u,v,speed,period}, swell_1: {...}, swell_2: {...}, wind_waves: {...} }
  const LAYER_TO_COMPONENT = { waves: 'waves', swell_1: 'swell_1', swell_2: 'swell_2', wind_waves: 'wind_waves' };
  const componentKey = LAYER_TO_COMPONENT[activeLayer] || 'waves';

  // Helper to extract component data from a grid vector
  const getComp = (vec) => vec?.[componentKey] || null;

  // All 4 corners must be ocean for a valid interpolation
  if (!v00?.isOcean || !v10?.isOcean || !v01?.isOcean || !v11?.isOcean) {
    // Partial ocean: use nearest ocean neighbor by geographic distance.
    const oceanCorners = [v00, v10, v01, v11].filter(v => {
      if (!v?.isOcean) return false;
      const c = getComp(v);
      return c && c.speed > 0;
    });
    if (oceanCorners.length === 0) return null;
    const best = oceanCorners.reduce((a, b) => {
      const dA = Math.pow(a.lat - lat, 2) + Math.pow(a.lng - lng, 2);
      const dB = Math.pow(b.lat - lat, 2) + Math.pow(b.lng - lng, 2);
      return dA < dB ? a : b;
    });
    const comp = getComp(best);
    if (!comp) return null;
    const dir = comp.u !== 0 || comp.v !== 0
      ? (Math.atan2(-comp.u, -comp.v) * 180 / Math.PI + 360) % 360
      : null;
    return { value: comp.speed, direction: dir, period: comp.period || null, source: 'marine_grid_nearest' };
  }

  // Get component data from each corner
  const c00 = getComp(v00), c10 = getComp(v10), c01 = getComp(v01), c11 = getComp(v11);
  if (!c00 || !c10 || !c01 || !c11) return null;

  // Bilinear interpolation of wave height (speed field = wave height in marine context)
  const height = c00.speed * (1 - dx) * (1 - dy) +
                 c10.speed * dx * (1 - dy) +
                 c01.speed * (1 - dx) * dy +
                 c11.speed * dx * dy;

  // Bilinear interpolation of period
  const p00 = c00.period || 0, p10 = c10.period || 0, p01 = c01.period || 0, p11 = c11.period || 0;
  const period = p00 * (1 - dx) * (1 - dy) + p10 * dx * (1 - dy) + p01 * (1 - dx) * dy + p11 * dx * dy;

  // Circular interpolation of direction from u,v
  const avgU = c00.u * (1 - dx) * (1 - dy) + c10.u * dx * (1 - dy) + c01.u * (1 - dx) * dy + c11.u * dx * dy;
  const avgV = c00.v * (1 - dx) * (1 - dy) + c10.v * dx * (1 - dy) + c01.v * (1 - dx) * dy + c11.v * dx * dy;
  const direction = (avgU !== 0 || avgV !== 0)
    ? (Math.atan2(-avgU, -avgV) * 180 / Math.PI + 360) % 360
    : null;

  return { value: height, direction, period: period > 0 ? period : null, source: 'marine_grid' };
}

// ========================================================================
// 2. EXACT POINT MARINE FETCH — single-point API for infobox accuracy
// ========================================================================

var _exactPointCache = new Map();
var EXACT_POINT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Model-specific forecast day limits (Open-Meteo marine models)
var MARINE_MODEL_LIMITS = {
  'ncep_gfswave025': 16,   // GFS Wave: 16 days
  'gwam': 7,               // DWD GWAM (ICON marine): 7.5 days
  'ecmwf_wam025': 10,      // ECMWF WAM: 10 days
};

/**
 * Fetch the FULL multi-day forecast for a single point.
 * Caches by lat/lng/model so timeline scrubs don't re-fetch.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} model - 'GFS' | 'ICON' | 'EURO'
 * @returns {Promise<Object|null>} Full response with hourly arrays
 */
export async function fetchExactMarinePoint(lat, lng, model) {
  if (lat == null || lng == null) return null;

  const rLat = +lat.toFixed(2);
  const rLng = +lng.toFixed(2);
  // v6.1: Include provider in cache key to prevent Copernicus/Open-Meteo cross-hits
  const PROVIDER_MAP = { GFS: 'open-meteo', ICON: 'open-meteo', EURO: 'copernicus' };
  const provider = PROVIDER_MAP[model] || 'open-meteo';
  const cacheKey = `${rLat}_${rLng}_${model || 'GFS'}_${provider}`;

  const cached = _exactPointCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EXACT_POINT_CACHE_TTL) {
    return cached.data;
  }

  const MARINE_OM_MODELS = { GFS: 'ncep_gfswave025', ICON: 'gwam', EURO: 'ecmwf_wam025' };
  const apiModel = (model && MARINE_OM_MODELS[model]) ? MARINE_OM_MODELS[model] : 'ncep_gfswave025';
  let forecastDays = MARINE_MODEL_LIMITS[apiModel] || 7;

  // v6.4: EURO exact-point goes through Copernicus which loads entire bbox into memory.
  // Reduce forecast window to 1 day (current + 24h) to minimize Render memory usage.
  // 10 days × 12 vars × 3-hourly = ~80 timesteps → 1 day = ~8 timesteps (10x reduction).
  if (provider === 'copernicus') {
    forecastDays = 1;
  }

  // v5.9.1: Model-specific variable map — aligned with marineController.js MODEL_SUPPORTED_VARS.
  // CRITICAL: Only request variables the model actually supports.
  // Open-Meteo returns 400 for any unsupported variable, killing the ENTIRE request.
  // Verified 2026-05-30: secondary_swell_wave_peak_period does NOT exist in Open-Meteo.
  var EXACT_POINT_VARS = {
    'ncep_gfswave025': [
      'wave_height', 'wave_direction', 'wave_period', 'wave_peak_period',
      'swell_wave_height', 'swell_wave_direction', 'swell_wave_period', 'swell_wave_peak_period',
      'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
      'wind_wave_height', 'wind_wave_direction', 'wind_wave_period', 'wind_wave_peak_period'
    ],
    'gwam': [
      'wave_height', 'wave_direction', 'wave_period',
      'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
      'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
    ],
    'ecmwf_wam025': [
      'wave_height', 'wave_direction', 'wave_period',
      'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
      'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
      'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
    ]
  };

  var hourlyVars = EXACT_POINT_VARS[apiModel] || EXACT_POINT_VARS['ncep_gfswave025'];

  const body = {
    latitude: [rLat],
    longitude: [rLng],
    hourly: hourlyVars,
    forecast_days: forecastDays,
    models: [apiModel]
  };

  try {
    // Route EURO through Copernicus Marine backend, others through Open-Meteo
    const proxyType = (apiModel === 'ecmwf_wam025') ? 'copernicus_marine' : 'marine';

    const res = await fetch('/api/weather-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: proxyType, body })
    });
    if (!res.ok) {
      // v5.9.1: LOUD error diagnostics — never silently swallow exact-point failures
      var errText = '';
      try { errText = await res.text(); } catch(e) { errText = '(could not read body)'; }
      console.error(`[ExactPoint] FAILED: HTTP ${res.status} for ${rLat},${rLng} model=${apiModel}`, errText.substring(0, 300));
      if (typeof window !== 'undefined') {
        window.__MARINE_EXACT_POINT_ERROR__ = {
          status: res.status,
          point: { lat: rLat, lng: rLng },
          model: apiModel,
          requestedVars: hourlyVars,
          responseText: errText.substring(0, 500),
          timestamp: new Date().toISOString()
        };
      }
      return null;
    }
    const json = await res.json();
    const result = Array.isArray(json) ? json[0] : json;
    if (!result?.hourly) return null;

    // Clear any previous error on success
    if (typeof window !== 'undefined') {
      window.__MARINE_EXACT_POINT_ERROR__ = null;
    }

    // v6.1: Detect provider from response, default based on proxy type
    const detectedProvider = result.__provider || (proxyType === 'copernicus_marine' ? 'copernicus' : 'open-meteo');

    const data = {
      hourly: result.hourly,
      snappedLat: result.latitude,
      snappedLng: result.longitude,
      // v6.2: Store the requested coordinates and model so consumers can verify
      // the response still matches the current selected point (stale-state guard)
      requestedLat: rLat,
      requestedLng: rLng,
      requestedModel: model || 'GFS',
      forecastDays,
      apiModel,
      provider: detectedProvider,
      source: 'exact_point_api'
    };

    // v6.1: Copernicus Marine diagnostic (never prints credentials)
    if (typeof window !== 'undefined' && proxyType === 'copernicus_marine') {
      const hourly = result.hourly || {};
      window.__COPERNICUS_MARINE_DIAG__ = {
        backendConfigured: true,
        provider: 'copernicus',
        snappedLat: result.latitude,
        snappedLng: result.longitude,
        selectedTimestamp: new Date().toISOString(),
        nonNullCounts: {
          wave_height: hourly.wave_height?.filter(v => v != null).length || 0,
          wave_direction: hourly.wave_direction?.filter(v => v != null).length || 0,
          wave_period: hourly.wave_period?.filter(v => v != null).length || 0,
          swell_wave_height: hourly.swell_wave_height?.filter(v => v != null).length || 0,
          swell_wave_direction: hourly.swell_wave_direction?.filter(v => v != null).length || 0,
          swell_wave_period: hourly.swell_wave_period?.filter(v => v != null).length || 0,
          secondary_swell_wave_height: hourly.secondary_swell_wave_height?.filter(v => v != null).length || 0,
          secondary_swell_wave_direction: hourly.secondary_swell_wave_direction?.filter(v => v != null).length || 0,
          secondary_swell_wave_period: hourly.secondary_swell_wave_period?.filter(v => v != null).length || 0,
          wind_wave_height: hourly.wind_wave_height?.filter(v => v != null).length || 0,
          wind_wave_direction: hourly.wind_wave_direction?.filter(v => v != null).length || 0,
          wind_wave_period: hourly.wind_wave_period?.filter(v => v != null).length || 0,
        },
        timestamp: new Date().toISOString()
      };
    }

    _exactPointCache.set(cacheKey, { data, timestamp: Date.now() });
    // Evict old entries
    if (_exactPointCache.size > 50) {
      const oldest = [..._exactPointCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < 10; i++) _exactPointCache.delete(oldest[i][0]);
    }

    return data;
  } catch (err) {
    console.error('[ExactPoint] Marine fetch exception:', err.message);
    if (typeof window !== 'undefined') {
      window.__MARINE_EXACT_POINT_ERROR__ = {
        status: 'exception',
        point: { lat: rLat, lng: rLng },
        model: apiModel,
        requestedVars: hourlyVars,
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
    return null;
  }
}

/**
 * Select the correct hour from a cached exact-point response.
 * Returns an object with all variable values for that hour, or null.
 *
 * @param {Object} cachedResponse - Full response from fetchExactMarinePoint
 * @param {number} hourOffset - Hours from now
 * @returns {Object|null} Variable values for the matched hour
 */
export function selectExactPointHour(cachedResponse, hourOffset) {
  if (!cachedResponse?.hourly?.time) return null;
  const times = cachedResponse.hourly.time;
  const h = cachedResponse.hourly;
  const targetMs = Date.now() + (hourOffset || 0) * 3600000;

  let bestIdx = 0, minDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i] + 'Z').getTime() - targetMs);
    if (diff < minDiff) { minDiff = diff; bestIdx = i; }
  }

  // If best match is > 3 hours away, consider it a miss (model doesn't cover this time)
  if (minDiff > 3 * 3600000) return null;

  return {
    wave_height: h.wave_height?.[bestIdx] ?? null,
    wave_direction: h.wave_direction?.[bestIdx] ?? null,
    wave_period: h.wave_period?.[bestIdx] ?? null,
    wave_peak_period: h.wave_peak_period?.[bestIdx] ?? null,
    swell_wave_height: h.swell_wave_height?.[bestIdx] ?? null,
    swell_wave_direction: h.swell_wave_direction?.[bestIdx] ?? null,
    swell_wave_period: h.swell_wave_period?.[bestIdx] ?? null,
    swell_wave_peak_period: h.swell_wave_peak_period?.[bestIdx] ?? null,
    secondary_swell_wave_height: h.secondary_swell_wave_height?.[bestIdx] ?? null,
    secondary_swell_wave_direction: h.secondary_swell_wave_direction?.[bestIdx] ?? null,
    secondary_swell_wave_period: h.secondary_swell_wave_period?.[bestIdx] ?? null,
    // NOTE: secondary_swell_wave_peak_period does NOT exist in Open-Meteo (verified 2026-05-30)
    wind_wave_height: h.wind_wave_height?.[bestIdx] ?? null,
    wind_wave_direction: h.wind_wave_direction?.[bestIdx] ?? null,
    wind_wave_period: h.wind_wave_period?.[bestIdx] ?? null,
    wind_wave_peak_period: h.wind_wave_peak_period?.[bestIdx] ?? null,
    source: 'exact_point_api',
    hourIndex: bestIdx,
    time: times[bestIdx],
    snappedLat: cachedResponse.snappedLat,
    snappedLng: cachedResponse.snappedLng,
    // v6.2: Carry forward request metadata for stale-state detection
    requestedLat: cachedResponse.requestedLat,
    requestedLng: cachedResponse.requestedLng,
    requestedModel: cachedResponse.requestedModel,
    provider: cachedResponse.provider,
    forecastDays: cachedResponse.forecastDays,
    timeRangeStart: times[0],
    timeRangeEnd: times[times.length - 1],
    matchDiffMs: minDiff
  };
}

// ========================================================================
// 3. DECODED TILE SAMPLER — bilinear interpolation on OM raster tiles
// ========================================================================

/**
 * Sample a single weather/marine variable from decoded Open-Meteo tiles.
 * Uses bilinear interpolation with circular averaging for directions
 * and nearshore coastal wave decay for wave heights.
 *
 * @param {number|null} lat
 * @param {number|null} lng
 * @param {string} targetVariable - e.g. 'wave_height', 'swell_wave_direction'
 * @param {number} timeOffsetHours
 * @param {string} activeModel - 'GFS' | 'EURO' | 'ICON'
 * @returns {{ value: number, direction: number|null } | null}
 */
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
  
  // v6.1: REMOVED dangerous fallback that used matchingTiles[0] when no tile
  // contained the selected lat/lng. This caused sampling from geographically
  // wrong tiles, producing fake values (e.g., 6.5ft/13s at Cape Canaveral).
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
