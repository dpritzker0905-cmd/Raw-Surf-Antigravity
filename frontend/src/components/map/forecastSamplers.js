/**
 * forecastSamplers.js — Marine data sampling utilities
 *
 * Contains three independent sampling pathways:
 *   1. sampleFromMarineGrid()      — samples the live WebGL marine grid
 *   2. fetchExactMarinePoint()     — exact-point Open-Meteo API fetch
 *   3. sampleValueFromDecodedTiles() — samples decoded OM raster tiles
 */

import { MARINE_MODEL_CAPABILITIES, isInCooldown } from './marineControllerUtils';
import {
  mToFt, degToCompass, findHourIndex, getClampedValue, getBiasAdjusted,
  sampleValueFromDecodedTiles, sampleFromMarineGrid
} from './forecastHelpers';
import { estimateEuroPoint, estimateIconPoint, EURO_LIMIT_WAVES, EURO_LIMIT_COMPONENTS, ICON_LIMIT } from './euroExtendedEstimate';
import { governMarineRequest } from './marineRequestGovernor';
import {
  getBackendWeatherFlag,
  getBackendIconMarineFlag,
  fetchBackendExactPoint,
  getBackendWindFlag,
  fetchBackendExactWindPoint,
  getBackendCopernicusFlag,
  fetchBackendExactCopernicusPoint
} from './backendWeatherServiceClient';
import {
  getBackendPressureFlag,
  fetchBackendExactPressurePoint
} from './backendPressureServiceClient';

export { sampleFromMarineGrid };

var _recentFailedRequests = new Map();
var RECENT_FAILED_TTL = 30000;

// ========================================================================
// 2. EXACT POINT MARINE FETCH — single-point API for infobox accuracy
// ========================================================================

var _exactPointCache = new Map();

export function hasCacheForModel(lat, lng, model, activeLayer = 'waves', timeOffsetHours = 0) {
  if (lat == null || lng == null) return false;
  const rLat = +lat.toFixed(2);
  const rLng = +lng.toFixed(2);
  const PROVIDER_MAP = { GFS: 'open-meteo', ICON: 'open-meteo', EURO: 'copernicus' };
  let provider = PROVIDER_MAP[model] || 'open-meteo';
  if (model === 'EURO' && activeLayer === 'waves' && !getBackendCopernicusFlag()) {
    provider = 'open-meteo';
  }

  const isPressureRedirect = typeof getBackendPressureFlag === 'function' && getBackendPressureFlag() && (model === 'GFS' || model === 'ICON' || model === 'EURO' || !model) && activeLayer === 'pressure';
  const isGfsRedirect = typeof getBackendWeatherFlag === 'function' && getBackendWeatherFlag() && (model === 'GFS' || !model) && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves');
  const isWindRedirect = typeof getBackendWindFlag === 'function' && getBackendWindFlag() && (model === 'GFS' || model === 'ICON' || model === 'EURO' || !model) && activeLayer === 'wind';
  const isCopernicusRedirect = typeof getBackendCopernicusFlag === 'function' && getBackendCopernicusFlag() && model === 'EURO' && (activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves' || activeLayer === 'waves');
  const isIconRedirect = typeof getBackendIconMarineFlag === 'function' && getBackendIconMarineFlag() && model === 'ICON' && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves');
  const isBackendRedirect = isPressureRedirect || isGfsRedirect || isWindRedirect || isCopernicusRedirect || isIconRedirect;

  const cacheKey = isBackendRedirect
    ? `${rLat}_${rLng}_${model}_${activeLayer}_${provider}_hr${timeOffsetHours}`
    : `${rLat}_${rLng}_${model}_${activeLayer}_${provider}`;

  return _exactPointCache.has(cacheKey);
}

var _inFlightExactPointRequests = new Map();
var EXACT_POINT_CACHE_TTL = 10 * 60 * 1000;

var MARINE_MODEL_LIMITS = {
  'ncep_gfswave025': 16,
  'gwam': 7,
  'ecmwf_wam025': 10,
};

/**
 * Fetch the FULL multi-day forecast for a single point.
 */
export async function fetchExactMarinePoint(lat, lng, model, activeLayer = 'waves', signal = null, timeOffsetHours = 0, force = false) {
  if (lat == null || lng == null) return null;

  const startTime = Date.now();
  const rLat = +lat.toFixed(2);
  const rLng = +lng.toFixed(2);
  
  if (typeof isInCooldown === 'function' && isInCooldown('marine')) {
    console.warn(`[ExactPoint] Blocked fetch for model=${model} lat=${rLat} lng=${rLng}: marine cooldown is active.`);
    return { status: 'rate_limited' };
  }

  // --- REDIRECT GFS/ICON/EURO PRESSURE TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (typeof getBackendPressureFlag === 'function' && getBackendPressureFlag() && (model === 'GFS' || model === 'ICON' || model === 'EURO' || !model) && activeLayer === 'pressure') {
    try {
      console.log(`[Backend Pressure Service] Redirecting ${model || 'GFS'} Pressure point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactPressurePoint(rLat, rLng, timeOffsetHours, signal, model || 'GFS');
      if (pointResult) {
        return pointResult;
      }
    } catch (err) {
      console.warn(`[Backend Pressure Service] Pressure point redirect failed. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  // --- REDIRECT GFS WAVES / SWELL_1 / SWELL_2 TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (typeof getBackendWeatherFlag === 'function' && getBackendWeatherFlag() && (model === 'GFS' || !model) && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves')) {
    try {
      console.log(`[Backend Weather Service] Redirecting GFS ${activeLayer} point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactPoint(rLat, rLng, timeOffsetHours, signal, activeLayer);
      if (pointResult) {
        return pointResult;
      }
    } catch (err) {
      console.warn(`[Backend Weather Service] Point redirect failed for GFS ${activeLayer}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  // --- REDIRECT GFS, ICON AND EURO WIND TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (typeof getBackendWindFlag === 'function' && getBackendWindFlag() && (model === 'GFS' || model === 'ICON' || model === 'EURO' || !model) && activeLayer === 'wind') {
    try {
      console.log(`[Backend Weather Service] Redirecting ${model || 'GFS'} Wind point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactWindPoint(rLat, rLng, timeOffsetHours, signal, model || 'GFS');
      if (pointResult) {
        return pointResult;
      }
    } catch (err) {
      console.warn(`[Backend Weather Service] Wind point redirect failed: ${err.message}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  // --- REDIRECT COPERNICUS TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (typeof getBackendCopernicusFlag === 'function' && getBackendCopernicusFlag() && model === 'EURO' && (activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves' || activeLayer === 'waves')) {
    try {
      console.log(`[Backend Weather Service] Redirecting Copernicus ${activeLayer} point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactCopernicusPoint(rLat, rLng, timeOffsetHours, signal, activeLayer);
      if (pointResult) {
        return pointResult;
      }
    } catch (err) {
      console.warn(`[Backend Weather Service] Copernicus point redirect failed: ${err.message}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  // --- REDIRECT ICON WAVES / SWELL_1 / SWELL_2 / WIND_WAVES TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (typeof getBackendIconMarineFlag === 'function' && getBackendIconMarineFlag() && model === 'ICON' && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves')) {
    try {
      console.log(`[Backend Weather Service] Redirecting ICON ${activeLayer} point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactPoint(rLat, rLng, timeOffsetHours, signal, activeLayer, 'ICON');
      if (pointResult) {
        return pointResult;
      }
    } catch (err) {
      console.warn(`[Backend Weather Service] Point redirect failed for ICON ${activeLayer}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  const PROVIDER_MAP = { GFS: 'open-meteo', ICON: 'open-meteo', EURO: 'copernicus' };
  let provider = PROVIDER_MAP[model] || 'open-meteo';
  if (model === 'EURO' && activeLayer === 'waves' && !getBackendCopernicusFlag()) {
    provider = 'open-meteo';
  }

  const isPressureRedirect = typeof getBackendPressureFlag === 'function' && getBackendPressureFlag() && (model === 'GFS' || model === 'ICON' || model === 'EURO' || !model) && activeLayer === 'pressure';
  const isGfsRedirect = typeof getBackendWeatherFlag === 'function' && getBackendWeatherFlag() && (model === 'GFS' || !model) && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves');
  const isWindRedirect = typeof getBackendWindFlag === 'function' && getBackendWindFlag() && (model === 'GFS' || model === 'ICON' || model === 'EURO' || !model) && activeLayer === 'wind';
  const isCopernicusRedirect = typeof getBackendCopernicusFlag === 'function' && getBackendCopernicusFlag() && model === 'EURO' && (activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves' || activeLayer === 'waves');
  const isIconRedirect = typeof getBackendIconMarineFlag === 'function' && getBackendIconMarineFlag() && model === 'ICON' && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves');
  const isBackendRedirect = isPressureRedirect || isGfsRedirect || isWindRedirect || isCopernicusRedirect || isIconRedirect;

  const cacheKey = isBackendRedirect
    ? `${rLat}_${rLng}_${model || 'GFS'}_${activeLayer || 'waves'}_${provider}_hr${timeOffsetHours}`
    : `${rLat}_${rLng}_${model || 'GFS'}_${activeLayer || 'waves'}_${provider}`;

  const cached = _exactPointCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EXACT_POINT_CACHE_TTL) {
    return cached.data;
  }

  if (force) {
    _recentFailedRequests.delete(cacheKey);
  }
  const recentFailure = _recentFailedRequests.get(cacheKey);
  if (!force && recentFailure && Date.now() - recentFailure < RECENT_FAILED_TTL) {
    console.warn(`[ExactPoint] Blocked fetch: recent failed request exists in TTL window for key: ${cacheKey}`);
    return { status: 'rate_limited' };
  }

  const nativeLimit = model === 'EURO' ? (activeLayer === 'waves' ? EURO_LIMIT_WAVES : EURO_LIMIT_COMPONENTS) : ICON_LIMIT;
  const isPastLimit = (model === 'EURO' && timeOffsetHours > 72) || (model === 'ICON' && timeOffsetHours > 120);

  const MARINE_OM_MODELS = { GFS: 'ncep_gfswave025', ICON: 'gwam', EURO: 'ecmwf_wam025' };
  const apiModel = (model && MARINE_OM_MODELS[model]) ? MARINE_OM_MODELS[model] : 'ncep_gfswave025';
  let forecastDays = MARINE_MODEL_LIMITS[apiModel] || 7;
  if (provider === 'copernicus') {
    forecastDays = 3;
  }

  const isEuroComponent = model === 'EURO' && provider === 'copernicus';
  const inFlightKey = isEuroComponent
    ? `${rLat}_${rLng}_EURO_COMPONENTS_fd${forecastDays}`
    : `${rLat}_${rLng}_${model || 'GFS'}_${activeLayer || 'waves'}_fd${forecastDays}`;

  if (_inFlightExactPointRequests.has(inFlightKey)) {
    console.log(`[ExactPoint] Sharing in-flight request for: ${inFlightKey}`);
    return _inFlightExactPointRequests.get(inFlightKey);
  }

  const fetchPromise = (async () => {
    let hourlyVars;
    if (model === 'EURO') {
      if (activeLayer === 'waves') {
        hourlyVars = ['wave_height', 'wave_direction', 'wave_period'];
      } else {
        hourlyVars = [
          'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
          'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
          'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
        ];
      }
    } else {
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
        const res = await governMarineRequest({
          source: 'forecastSamplers.fetchExactMarinePoint',
          type: proxyType,
          body: body,
          signal: fetchSignal,
          model: model || 'GFS',
          layer: activeLayer || 'waves',
          category: 'exact_point',
          lat: lat,
          lng: lng,
          isExplicit: force
        });
        if (standaloneTimeoutId) clearTimeout(standaloneTimeoutId);

        if (!res.ok) {
          const elapsed = (Date.now() - startTime) / 1000;
          let errText = '';
          try { errText = await res.text(); } catch(e) { errText = '(could not read body)'; }

          const isTimeout = res.status === 504 || res.status === 502 || errText.toLowerCase().includes('timeout') || errText.toLowerCase().includes('gateway');
          if (isTimeout && retriesLeft > 0) {
            console.warn(`[ExactPoint Forensic] Copernicus fetch got HTTP ${res.status}. Retrying in 2.5s...`);
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
          } else if (res.status === 429 || errText.toLowerCase().includes('rate limit') || errText.toLowerCase().includes('429')) {
            statusStr = 'rate_limited';
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
          _recentFailedRequests.set(cacheKey, Date.now());
          return { status: statusStr };
        }

        const json = await res.json();
        const result = Array.isArray(json) ? json[0] : json;
        if (!result?.hourly) {
          _recentFailedRequests.set(cacheKey, Date.now());
          return null;
        }

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

        if (model === 'EURO' && provider === 'copernicus' && !isBackendRedirect) {
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
        
        if (err.message === 'cooldown_active' || err.message === 'copernicus_cooldown_active' || err.message === 'failure_ttl_active' || err.message === 'grid_fetch_in_flight' || err.message === 'copernicus_concurrency_active') {
          return { status: 'rate_limited' };
        }
        
        const isAbortOrTimeout = err.name === 'AbortError' || err.message?.toLowerCase().includes('timeout') || err.message?.toLowerCase().includes('abort');
        if (isAbortOrTimeout && retriesLeft > 0) {
          console.warn(`[ExactPoint Forensic] Copernicus fetch got error: ${err.message}. Retrying in 2.5s...`);
          retriesLeft--;
          await new Promise(resolve => setTimeout(resolve, 2500));
          continue;
        }

        if (typeof window !== 'undefined') {
          window.__LAST_EXACT_FETCH_ELAPSED_MS__ = Math.round(elapsed * 1000);
        }
        if (err.name === 'AbortError') {
          console.warn(`[ExactPoint Forensic] TIMEOUT: Fetch aborted after ${elapsed.toFixed(2)}s for model=${apiModel}`);
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
        _recentFailedRequests.set(cacheKey, Date.now());
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
 */
export function selectExactPointHour(cachedResponse, hourOffset) {
  if (!cachedResponse) return null;

  const offset = isNaN(Number(hourOffset)) ? 0 : Number(hourOffset);
  const model = cachedResponse.requestedModel || 'GFS';
  const activeLayer = cachedResponse.activeLayer || 'waves';

  if (typeof window !== 'undefined') {
    let diag = null;
    let fallbackReasonValue = null;
    if (model === 'EURO') {
      diag = activeLayer === 'wind'
        ? window.__BACKEND_WIND_SERVICE_DIAG__
        : (window.__BACKEND_COPERNICUS_SERVICE_DIAG__ || window.__COPERNICUS_GRID_DIAG__);
      fallbackReasonValue = 'no_copernicus_coverage';
    } else if (model === 'GFS') {
      diag = window.__BACKEND_WEATHER_SERVICE_DIAG__;
      fallbackReasonValue = 'no_backend_coverage';
    } else if (model === 'ICON') {
      diag = window.__BACKEND_ICON_SERVICE_DIAG__;
      fallbackReasonValue = 'no_backend_coverage';
    }

    if (diag && 
        (diag.fallbackReason === fallbackReasonValue || diag.fallbackReason?.includes(fallbackReasonValue)) && 
        (diag.requestedHour === offset || diag.lastGridFetch?.hourOffset === offset)) {
      return {
        status: fallbackReasonValue,
        source: 'exact_point_api',
        requestedLat: cachedResponse.requestedLat,
        requestedLng: cachedResponse.requestedLng,
        requestedModel: model,
        activeLayer: activeLayer,
        provider: model === 'EURO' ? 'copernicus' : 'backend-weather-service',
        is_estimated: false,
        wave_height: null,
        wave_direction: null,
        wave_period: null,
        wave_peak_period: null,
        swell_wave_height: null,
        swell_wave_direction: null,
        swell_wave_period: null,
        swell_wave_peak_period: null,
        secondary_swell_wave_height: null,
        secondary_swell_wave_direction: null,
        secondary_swell_wave_period: null,
        wind_wave_height: null,
        wind_wave_direction: null,
        wind_wave_period: null,
        wind_wave_peak_period: null,
        wind_speed_10m: null,
        wind_direction_10m: null
      };
    }
  }

  if (cachedResponse.status === 'no_copernicus_coverage' || cachedResponse.status === 'no_backend_coverage' || cachedResponse.status === 'no_coverage' || cachedResponse.status === 'out_of_bounds/no_coverage') {
    return {
      status: cachedResponse.status,
      source: cachedResponse.source || 'exact_point_api',
      requestedLat: cachedResponse.requestedLat,
      requestedLng: cachedResponse.requestedLng,
      requestedModel: cachedResponse.requestedModel,
      activeLayer: cachedResponse.activeLayer,
      provider: cachedResponse.provider || 'copernicus',
      is_estimated: false,
      wave_height: null,
      wave_direction: null,
      wave_period: null,
      wave_peak_period: null,
      swell_wave_height: null,
      swell_wave_direction: null,
      swell_wave_period: null,
      swell_wave_peak_period: null,
      secondary_swell_wave_height: null,
      secondary_swell_wave_direction: null,
      secondary_swell_wave_period: null,
      wind_wave_height: null,
      wind_wave_direction: null,
      wind_wave_period: null,
      wind_wave_peak_period: null,
      wind_speed_10m: null,
      wind_direction_10m: null
    };
  }

  if (!cachedResponse.hourly?.time) return null;

  if (cachedResponse.status === 'unsupported') {
    return {
      status: 'unsupported',
      source: 'unsupported_model_layer',
      requestedLat: cachedResponse.requestedLat,
      requestedLng: cachedResponse.requestedLng,
      requestedModel: cachedResponse.requestedModel,
      activeLayer: cachedResponse.activeLayer,
      provider: 'none',
      is_estimated: false,
      warnings: ['unsupported_model_layer']
    };
  }

  const times = cachedResponse.hourly.time;
  const h = cachedResponse.hourly;

  const isEuro = cachedResponse.requestedModel === 'EURO';
  const hasCombinedWaves = cachedResponse.hourly.wave_height !== undefined;
  const hardNativeLimit = hasCombinedWaves ? EURO_LIMIT_WAVES : EURO_LIMIT_COMPONENTS;

  let nativeLimit = hardNativeLimit;
  if (cachedResponse.hourly?.time?.length) {
    const lastTimeStr = cachedResponse.hourly.time[cachedResponse.hourly.time.length - 1];
    const lastTimeMs = new Date(lastTimeStr.endsWith('Z') ? lastTimeStr : lastTimeStr + 'Z').getTime();
    const hoursFromNow = Math.max(0, Math.round((lastTimeMs - Date.now()) / 3600000));
    nativeLimit = Math.min(hardNativeLimit, hoursFromNow);
  }

  if (isEuro && offset > nativeLimit && !getBackendCopernicusFlag()) {
    const activeLayer = cachedResponse.activeLayer || (hasCombinedWaves ? 'waves' : 'swell_1');
    const rLat = +cachedResponse.requestedLat.toFixed(2);
    const rLng = +cachedResponse.requestedLng.toFixed(2);
    const gfsKey = `${rLat}_${rLng}_GFS_${activeLayer}_open-meteo`;
    const iconKey = `${rLat}_${rLng}_ICON_${activeLayer}_open-meteo`;

    const gfsData = _exactPointCache.get(gfsKey)?.data;
    const iconData = _exactPointCache.get(iconKey)?.data;

    if (!gfsData) {
      return {
        status: 'no_copernicus_coverage',
        source: 'exact_point_api',
        requestedLat: cachedResponse.requestedLat,
        requestedLng: cachedResponse.requestedLng,
        requestedModel: cachedResponse.requestedModel,
        activeLayer: cachedResponse.activeLayer,
        provider: 'copernicus',
        is_estimated: false,
        wave_height: null,
        wave_direction: null,
        wave_period: null,
        wave_peak_period: null,
        swell_wave_height: null,
        swell_wave_direction: null,
        swell_wave_period: null,
        swell_wave_peak_period: null,
        secondary_swell_wave_height: null,
        secondary_swell_wave_direction: null,
        secondary_swell_wave_period: null,
        wind_wave_height: null,
        wind_wave_direction: null,
        wind_wave_period: null,
        wind_wave_peak_period: null,
        wind_speed_10m: null,
        wind_direction_10m: null
      };
    }

    const anchorIdxEuro = findHourIndex(cachedResponse.hourly.time, nativeLimit);
    const anchorIdxGfs = gfsData ? findHourIndex(gfsData.hourly.time, nativeLimit) : 0;
    const targetIdxGfs = gfsData ? findHourIndex(gfsData.hourly.time, offset) : 0;

    const anchorIdxIcon = iconData ? findHourIndex(iconData.hourly.time, nativeLimit) : 0;
    const targetIdxIcon = iconData ? findHourIndex(iconData.hourly.time, offset) : 0;

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

    const est = estimateEuroPoint(offset, nativeLimit, activeLayer, euroAnchor, gfsTarget, gfsAnchor, iconTarget, iconAnchor);
    if (est) {
      const targetTimeStr = new Date(Date.now() + offset * 3600000).toISOString();
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
  let iconLimit = ICON_LIMIT;
  if (isIcon && cachedResponse.hourly?.time?.length) {
    const lastTimeStr = cachedResponse.hourly.time[cachedResponse.hourly.time.length - 1];
    const lastTimeMs = new Date(lastTimeStr.endsWith('Z') ? lastTimeStr : lastTimeStr + 'Z').getTime();
    const hoursFromNow = Math.max(0, Math.round((lastTimeMs - Date.now()) / 3600000));
    iconLimit = Math.min(ICON_LIMIT, hoursFromNow);
  }
  if (isIcon && offset > iconLimit && !getBackendIconMarineFlag()) {
    const activeLayer = cachedResponse.activeLayer || 'waves';
    const rLat = +cachedResponse.requestedLat.toFixed(2);
    const rLng = +cachedResponse.requestedLng.toFixed(2);
    const gfsKey = `${rLat}_${rLng}_GFS_${activeLayer}_open-meteo`;

    const gfsData = _exactPointCache.get(gfsKey)?.data;

    if (!gfsData) {
      return {
        status: 'no_backend_coverage',
        source: 'exact_point_api',
        requestedLat: cachedResponse.requestedLat,
        requestedLng: cachedResponse.requestedLng,
        requestedModel: cachedResponse.requestedModel,
        activeLayer: cachedResponse.activeLayer,
        provider: 'backend-weather-service',
        is_estimated: false,
        wave_height: null,
        wave_direction: null,
        wave_period: null,
        wave_peak_period: null,
        swell_wave_height: null,
        swell_wave_direction: null,
        swell_wave_period: null,
        swell_wave_peak_period: null,
        secondary_swell_wave_height: null,
        secondary_swell_wave_direction: null,
        secondary_swell_wave_period: null,
        wind_wave_height: null,
        wind_wave_direction: null,
        wind_wave_period: null,
        wind_wave_peak_period: null,
        wind_speed_10m: null,
        wind_direction_10m: null
      };
    }

    const anchorIdxIcon = findHourIndex(cachedResponse.hourly.time, iconLimit);
    const anchorIdxGfs = gfsData ? findHourIndex(gfsData.hourly.time, iconLimit) : 0;
    const targetIdxGfs = gfsData ? findHourIndex(gfsData.hourly.time, offset) : 0;

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

    const est = estimateIconPoint(offset, ICON_LIMIT, activeLayer, iconAnchor, gfsTarget, gfsAnchor);
    if (est) {
      const targetTimeStr = new Date(Date.now() + offset * 3600000).toISOString();
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

  const bestIdx = findHourIndex(times, offset);
  const targetTime = new Date();
  targetTime.setHours(targetTime.getHours() + (offset || 0));
  const timeStr = times[bestIdx];
  const minDiff = Math.abs(new Date(timeStr.endsWith('Z') ? timeStr : timeStr + 'Z').getTime() - targetTime.getTime());

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
    wind_speed_10m: status === 'exact_no_time_coverage' ? null : (h.wind_speed_10m?.[bestIdx] ?? null),
    wind_direction_10m: status === 'exact_no_time_coverage' ? null : (h.wind_direction_10m?.[bestIdx] ?? null),
    pressure_msl: status === 'exact_no_time_coverage' ? null : (h.pressure_msl?.[bestIdx] ?? null),
    status,
    source: cachedResponse.source || 'exact_point_api',
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
export { mToFt, degToCompass, findHourIndex, getClampedValue, getBiasAdjusted, sampleValueFromDecodedTiles };
