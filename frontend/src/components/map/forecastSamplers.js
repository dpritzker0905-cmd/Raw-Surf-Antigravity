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
import { mToFt, degToCompass, findHourIndex, getClampedValue, getBiasAdjusted } from './forecastHelpers';
import { estimateEuroPoint, estimateIconPoint, EURO_LIMIT_WAVES, EURO_LIMIT_COMPONENTS, ICON_LIMIT } from './euroExtendedEstimate';

// Sets moved to forecastHelpers.js to respect 800 LOC limit.

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

  // v6.6: Grid provider guard
  if (activeModel === 'GFS' || activeModel === 'ICON') {
    if (grid.__provider !== 'open-meteo') return null;
  } else if (activeModel === 'EURO') {
    if (activeLayer === 'waves') {
      if (grid.__provider !== 'open-meteo' && grid.__provider !== 'estimated') return null;
    } else if (['swell_1', 'swell_2', 'wind_waves'].includes(activeLayer)) {
      const isValidCopernicus = (grid.__gridProvider === 'copernicus' || grid.__gridProvider === 'estimated') &&
                                grid.__componentLayer === activeLayer;
      if (!isValidCopernicus) return null;
    } else {
      return null;
    }
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
var _inFlightExactPointRequests = new Map();
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
 * @param {string} [activeLayer='waves'] - The active layer to optimize variable requests
 * @param {AbortSignal} [signal=null] - Abort controller signal for timeouts
 * @returns {Promise<Object|null>} Full response with hourly arrays
 */
export async function fetchExactMarinePoint(lat, lng, model, activeLayer = 'waves', signal = null) {
  if (lat == null || lng == null) return null;

  const startTime = Date.now();
  const rLat = +lat.toFixed(2);
  const rLng = +lng.toFixed(2);
  
  if (model === 'EURO' && !signal?.aborted) {
    // Proactively pre-warm GFS and ICON exact point data in background for Extended Estimate
    fetchExactMarinePoint(lat, lng, 'GFS', activeLayer, signal).catch(() => {});
    fetchExactMarinePoint(lat, lng, 'ICON', activeLayer, signal).catch(() => {});
  } else if (model === 'ICON' && !signal?.aborted) {
    // Proactively pre-warm GFS exact point data in background for ICON Extended Estimate
    fetchExactMarinePoint(lat, lng, 'GFS', activeLayer, signal).catch(() => {});
  }
  
  // v6.7: Route EURO waves exact-point through Open-Meteo ecmwf_wam025 since
  // combined waves maps perfectly and resolves in <200ms, bypassing Copernicus.
  const PROVIDER_MAP = { GFS: 'open-meteo', ICON: 'open-meteo', EURO: 'copernicus' };
  let provider = PROVIDER_MAP[model] || 'open-meteo';
  if (model === 'EURO' && activeLayer === 'waves') {
    provider = 'open-meteo';
  }

  // Cache by layer and provider to avoid cross-layer pollution
  const cacheKey = `${rLat}_${rLng}_${model || 'GFS'}_${activeLayer || 'waves'}_${provider}`;

  const cached = _exactPointCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EXACT_POINT_CACHE_TTL) {
    return cached.data;
  }

  // Group Copernicus component requests under EURO_COMPONENTS to share the in-flight fetch
  const isEuroComponent = model === 'EURO' && provider === 'copernicus';
  const inFlightKey = isEuroComponent
    ? `${rLat}_${rLng}_EURO_COMPONENTS`
    : cacheKey;

  if (_inFlightExactPointRequests.has(inFlightKey)) {
    console.log(`[ExactPoint] Sharing in-flight request for: ${inFlightKey}`);
    return _inFlightExactPointRequests.get(inFlightKey);
  }

  const fetchPromise = (async () => {
    const MARINE_OM_MODELS = { GFS: 'ncep_gfswave025', ICON: 'gwam', EURO: 'ecmwf_wam025' };
    const apiModel = (model && MARINE_OM_MODELS[model]) ? MARINE_OM_MODELS[model] : 'ncep_gfswave025';
    let forecastDays = MARINE_MODEL_LIMITS[apiModel] || 7;

    if (provider === 'copernicus') {
      forecastDays = 3;
    }

    let hourlyVars;
    if (model === 'EURO') {
      if (activeLayer === 'waves') {
        hourlyVars = ['wave_height', 'wave_direction', 'wave_period'];
      } else {
        // Combined 9-variable component request for swell_1 + swell_2 + wind_waves
        hourlyVars = [
          'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
          'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
          'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
        ];
      }
    } else {
      // Keep GFS & ICON fully compatible with original behaviors
      const EXACT_POINT_VARS = {
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
        ]
      };
      hourlyVars = EXACT_POINT_VARS[apiModel] || EXACT_POINT_VARS['ncep_gfswave025'];
    }

    const body = {
      latitude: [rLat],
      longitude: [rLng],
      hourly: hourlyVars,
      forecast_days: forecastDays,
      models: [apiModel]
    };

    let retriesLeft = (provider === 'copernicus') ? 1 : 0;
    while (true) {
      let fetchSignal = signal;
      let standaloneTimeoutId = null;
      if (isEuroComponent) {
        const controller = new AbortController();
        standaloneTimeoutId = setTimeout(() => controller.abort(), 25000);
        fetchSignal = controller.signal;
      }

      try {
        const proxyType = (provider === 'copernicus') ? 'copernicus_marine' : 'marine';
        const res = await fetch('/api/weather-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: proxyType, body }),
          signal: fetchSignal
        });
        if (standaloneTimeoutId) clearTimeout(standaloneTimeoutId);

        if (!res.ok) {
          const elapsed = (Date.now() - startTime) / 1000;
          let errText = '';
          try { errText = await res.text(); } catch(e) { errText = '(could not read body)'; }

          const isTimeout = res.status === 504 || res.status === 502 || errText.toLowerCase().includes('timeout') || errText.toLowerCase().includes('gateway');
          if (isTimeout && retriesLeft > 0) {
            console.warn(`[ExactPoint Forensic] Copernicus fetch got HTTP ${res.status} (possible cold-start/backend warming). Retrying with backoff in 2.5s...`);
            retriesLeft--;
            await new Promise(resolve => setTimeout(resolve, 2500));
            continue;
          }

          if (typeof window !== 'undefined') {
            window.__LAST_EXACT_FETCH_ELAPSED_MS__ = Math.round(elapsed * 1000);
          }
          console.error(`[ExactPoint Forensic] FAILED: HTTP ${res.status} for ${rLat},${rLng} model=${apiModel} | Elapsed: ${elapsed.toFixed(2)}s`, errText.substring(0, 300));
          
          let statusStr = 'error';
          if (res.status === 503 || errText.toLowerCase().includes('credentials')) {
            statusStr = 'copernicus_credentials_missing';
          } else if (res.status === 502) {
            statusStr = errText.toLowerCase().includes('timeout') ? 'copernicus_timeout' : 'copernicus_backend_502';
          } else if (res.status === 504 || errText.toLowerCase().includes('gateway timeout')) {
            statusStr = 'copernicus_timeout';
          }

          if (typeof window !== 'undefined') {
            window.__MARINE_EXACT_POINT_ERROR__ = {
              status: statusStr,
              httpStatus: res.status,
              point: { lat: rLat, lng: rLng },
              model: apiModel,
              requestedVars: hourlyVars,
              responseText: errText.substring(0, 500),
              timestamp: new Date().toISOString()
            };
          }
          return { status: statusStr };
        }

        const json = await res.json();
        const result = Array.isArray(json) ? json[0] : json;
        if (!result?.hourly) return null;

        if (typeof window !== 'undefined') {
          window.__MARINE_EXACT_POINT_ERROR__ = null;
        }

        const detectedProvider = result.__provider || (proxyType === 'copernicus_marine' ? 'copernicus' : 'open-meteo');
        const data = {
          hourly: result.hourly,
          snappedLat: result.latitude,
          snappedLng: result.longitude,
          requestedLat: rLat,
          requestedLng: rLng,
          requestedModel: model || 'GFS',
          activeLayer,
          forecastDays,
          apiModel,
          provider: detectedProvider,
          source: 'exact_point_api'
        };

        const elapsed = (Date.now() - startTime) / 1000;
        if (typeof window !== 'undefined') {
          window.__LAST_EXACT_FETCH_ELAPSED_MS__ = Math.round(elapsed * 1000);
        }
        console.log(`[ExactPoint Forensic] Model: ${model} | Layer: ${activeLayer} | Provider: ${detectedProvider} | Elapsed: ${elapsed.toFixed(2)}s`);

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

        if (model === 'EURO' && provider === 'copernicus') {
          const componentLayers = ['swell_1', 'swell_2', 'wind_waves'];
          for (const compLayer of componentLayers) {
            const k = `${rLat}_${rLng}_EURO_${compLayer}_copernicus`;
            _exactPointCache.set(k, { data, timestamp: Date.now() });
          }
        } else {
          _exactPointCache.set(cacheKey, { data, timestamp: Date.now() });
        }

        if (_exactPointCache.size > 50) {
          const oldest = [..._exactPointCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
          for (let i = 0; i < 10; i++) _exactPointCache.delete(oldest[i][0]);
        }

        return data;

      } catch (err) {
        if (standaloneTimeoutId) clearTimeout(standaloneTimeoutId);
        const elapsed = (Date.now() - startTime) / 1000;
        
        const isAbortOrTimeout = err.name === 'AbortError' || err.message?.toLowerCase().includes('timeout') || err.message?.toLowerCase().includes('abort');
        if (isAbortOrTimeout && retriesLeft > 0) {
          console.warn(`[ExactPoint Forensic] Copernicus fetch exception/abort (possible cold-start/backend warming): ${err.message}. Retrying with backoff in 2.5s...`);
          retriesLeft--;
          await new Promise(resolve => setTimeout(resolve, 2500));
          continue;
        }

        if (typeof window !== 'undefined') {
          window.__LAST_EXACT_FETCH_ELAPSED_MS__ = Math.round(elapsed * 1000);
        }
        if (err.name === 'AbortError') {
          console.warn(`[ExactPoint Forensic] TIMEOUT: Fetch aborted after ${elapsed.toFixed(2)}s for model=${apiModel} (Florida snappy cap)`);
          return { status: 'timeout' };
        }
        console.error(`[ExactPoint Forensic] Marine fetch exception: ${err.message} | Elapsed: ${elapsed.toFixed(2)}s`);
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
      } finally {
        _inFlightExactPointRequests.delete(inFlightKey);
      }
    }
  })();

  _inFlightExactPointRequests.set(inFlightKey, fetchPromise);
  return fetchPromise;
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

  const isEuro = cachedResponse.requestedModel === 'EURO';
  const hasCombinedWaves = cachedResponse.hourly.wave_height !== undefined;
  const nativeLimit = hasCombinedWaves ? EURO_LIMIT_WAVES : EURO_LIMIT_COMPONENTS;

  if (isEuro && hourOffset > nativeLimit) {
    const activeLayer = cachedResponse.activeLayer || (hasCombinedWaves ? 'waves' : 'swell_1');
    const rLat = +cachedResponse.requestedLat.toFixed(2);
    const rLng = +cachedResponse.requestedLng.toFixed(2);
    const gfsKey = `${rLat}_${rLng}_GFS_${activeLayer}_open-meteo`;
    const iconKey = `${rLat}_${rLng}_ICON_${activeLayer}_open-meteo`;

    const gfsData = _exactPointCache.get(gfsKey)?.data;
    const iconData = _exactPointCache.get(iconKey)?.data;

    const anchorIdxEuro = findHourIndex(cachedResponse.hourly.time, nativeLimit);
    const anchorIdxGfs = gfsData ? findHourIndex(gfsData.hourly.time, nativeLimit) : 0;
    const targetIdxGfs = gfsData ? findHourIndex(gfsData.hourly.time, hourOffset) : 0;

    const anchorIdxIcon = iconData ? findHourIndex(iconData.hourly.time, nativeLimit) : 0;
    const targetIdxIcon = iconData ? findHourIndex(iconData.hourly.time, hourOffset) : 0;

    const euroAnchor = {};
    const gfsAnchor = {};
    const gfsTarget = {};
    const iconAnchor = {};
    const iconTarget = {};

    const vars = [
      'wave_height', 'wave_direction', 'wave_period',
      'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
      'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
      'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
    ];

    vars.forEach(v => {
      euroAnchor[v] = cachedResponse.hourly[v]?.[anchorIdxEuro];
      if (gfsData) {
        gfsAnchor[v] = gfsData.hourly[v]?.[anchorIdxGfs];
        gfsTarget[v] = gfsData.hourly[v]?.[targetIdxGfs];
      }
      if (iconData) {
        iconAnchor[v] = iconData.hourly[v]?.[anchorIdxIcon];
        iconTarget[v] = iconData.hourly[v]?.[targetIdxIcon];
      }
    });

    const est = estimateEuroPoint(hourOffset, nativeLimit, activeLayer, euroAnchor, gfsTarget, gfsAnchor, iconTarget, iconAnchor);
    if (est) {
      const targetTimeStr = new Date(Date.now() + hourOffset * 3600000).toISOString();
      return {
        ...est,
        status: 'euro_extended_estimate',
        source: 'euro_extended_estimate',
        hourIndex: targetIdxGfs,
        time: targetTimeStr,
        snappedLat: cachedResponse.snappedLat,
        snappedLng: cachedResponse.snappedLng,
        requestedLat: cachedResponse.requestedLat,
        requestedLng: cachedResponse.requestedLng,
        requestedModel: cachedResponse.requestedModel,
        provider: 'estimated',
        forecastDays: cachedResponse.forecastDays,
        timeRangeStart: cachedResponse.hourly.time[0],
        timeRangeEnd: targetTimeStr,
        matchDiffMs: 0
      };
    }
  }

  const isIcon = cachedResponse.requestedModel === 'ICON';
  if (isIcon && hourOffset > ICON_LIMIT) {
    const activeLayer = cachedResponse.activeLayer || 'waves';
    const rLat = +cachedResponse.requestedLat.toFixed(2);
    const rLng = +cachedResponse.requestedLng.toFixed(2);
    const gfsKey = `${rLat}_${rLng}_GFS_${activeLayer}_open-meteo`;

    const gfsData = _exactPointCache.get(gfsKey)?.data;

    const anchorIdxIcon = findHourIndex(cachedResponse.hourly.time, ICON_LIMIT);
    const anchorIdxGfs = gfsData ? findHourIndex(gfsData.hourly.time, ICON_LIMIT) : 0;
    const targetIdxGfs = gfsData ? findHourIndex(gfsData.hourly.time, hourOffset) : 0;

    const iconAnchor = {};
    const gfsAnchor = {};
    const gfsTarget = {};

    const vars = [
      'wave_height', 'wave_direction', 'wave_period',
      'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
      'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
    ];

    vars.forEach(v => {
      iconAnchor[v] = cachedResponse.hourly[v]?.[anchorIdxIcon];
      if (gfsData) {
        gfsAnchor[v] = gfsData.hourly[v]?.[anchorIdxGfs];
        gfsTarget[v] = gfsData.hourly[v]?.[targetIdxGfs];
      }
    });

    const est = estimateIconPoint(hourOffset, ICON_LIMIT, activeLayer, iconAnchor, gfsTarget, gfsAnchor);
    if (est) {
      const targetTimeStr = new Date(Date.now() + hourOffset * 3600000).toISOString();
      return {
        ...est,
        status: 'icon_extended_estimate',
        source: 'icon_extended_estimate',
        hourIndex: targetIdxGfs,
        time: targetTimeStr,
        snappedLat: cachedResponse.snappedLat,
        snappedLng: cachedResponse.snappedLng,
        requestedLat: cachedResponse.requestedLat,
        requestedLng: cachedResponse.requestedLng,
        requestedModel: cachedResponse.requestedModel,
        provider: 'estimated',
        forecastDays: cachedResponse.forecastDays,
        timeRangeStart: cachedResponse.hourly.time[0],
        timeRangeEnd: targetTimeStr,
        matchDiffMs: 0
      };
    }
  }

  const bestIdx = findHourIndex(times, hourOffset);
  const targetTime = new Date();
  targetTime.setHours(targetTime.getHours() + (hourOffset || 0));
  const minDiff = Math.abs(new Date(times[bestIdx] + 'Z').getTime() - targetTime.getTime());

  // v6.9: Expose exact status depending on time matching diff instead of silently returning null
  let status = 'exact_success';
  if (minDiff > 3 * 3600000) {
    if (minDiff <= 12 * 3600000) {
      status = 'exact_stale_available';
    } else {
      status = 'exact_no_time_coverage';
    }
  }

  return {
    wave_height: status === 'exact_no_time_coverage' ? null : (h.wave_height?.[bestIdx] ?? null),
    wave_direction: status === 'exact_no_time_coverage' ? null : (h.wave_direction?.[bestIdx] ?? null),
    wave_period: status === 'exact_no_time_coverage' ? null : (h.wave_period?.[bestIdx] ?? null),
    wave_peak_period: status === 'exact_no_time_coverage' ? null : (h.wave_peak_period?.[bestIdx] ?? null),
    swell_wave_height: status === 'exact_no_time_coverage' ? null : (h.swell_wave_height?.[bestIdx] ?? null),
    swell_wave_direction: status === 'exact_no_time_coverage' ? null : (h.swell_wave_direction?.[bestIdx] ?? null),
    swell_wave_period: status === 'exact_no_time_coverage' ? null : (h.swell_wave_period?.[bestIdx] ?? null),
    swell_wave_peak_period: status === 'exact_no_time_coverage' ? null : (h.swell_wave_peak_period?.[bestIdx] ?? null),
    secondary_swell_wave_height: status === 'exact_no_time_coverage' ? null : (h.secondary_swell_wave_height?.[bestIdx] ?? null),
    secondary_swell_wave_direction: status === 'exact_no_time_coverage' ? null : (h.secondary_swell_wave_direction?.[bestIdx] ?? null),
    secondary_swell_wave_period: status === 'exact_no_time_coverage' ? null : (h.secondary_swell_wave_period?.[bestIdx] ?? null),
    wind_wave_height: status === 'exact_no_time_coverage' ? null : (h.wind_wave_height?.[bestIdx] ?? null),
    wind_wave_direction: status === 'exact_no_time_coverage' ? null : (h.wind_wave_direction?.[bestIdx] ?? null),
    wind_wave_period: status === 'exact_no_time_coverage' ? null : (h.wind_wave_period?.[bestIdx] ?? null),
    wind_wave_peak_period: status === 'exact_no_time_coverage' ? null : (h.wind_wave_peak_period?.[bestIdx] ?? null),
    status,
    source: 'exact_point_api',
    hourIndex: bestIdx,
    time: times[bestIdx],
    snappedLat: cachedResponse.snappedLat,
    snappedLng: cachedResponse.snappedLng,
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

export { writeOverlayDiagnostics } from './forecastDiagnostics';

// Re-export helper functions from modularized forecastHelpers.js to respect LOC limits
export { mToFt, degToCompass, findHourIndex, getClampedValue, getBiasAdjusted, sampleValueFromDecodedTiles } from './forecastHelpers';

