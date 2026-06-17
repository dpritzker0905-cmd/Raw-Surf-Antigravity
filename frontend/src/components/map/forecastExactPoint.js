/**
 * forecastExactPoint.js
 * 
 * Exact point marine fetch and cached responses.
 */

import { isInCooldown } from './marineControllerUtils';
import { findHourIndex } from './forecastHelpers';
import { governMarineRequest } from './marineRequestGovernor';
import { updateDeprecationDiag } from './forecastDeprecationDiag';
import {
  getBackendWeatherFlag,
  getBackendIconMarineFlag,
  fetchBackendExactPoint,
  getBackendWindFlag,
  getBackendCopernicusFlag,
  fetchBackendExactCopernicusPoint,
  getSharedValidTime
} from './backendWeatherServiceClient';
import {
  fetchBackendExactWindPoint
} from './backendWindServiceClient';
import {
  getBackendPressureFlag,
  fetchBackendExactPressurePoint
} from './backendPressureServiceClient';
import {
  getBackendPrecipitationFlag,
  fetchBackendExactPrecipitationPoint,
  precipitationPointCache
} from './backendPrecipitationServiceClient';

export const _exactPointCache = new Map();
const _recentFailedRequests = new Map();
const RECENT_FAILED_TTL = 30000;
const _inFlightExactPointRequests = new Map();
const EXACT_POINT_CACHE_TTL = 10 * 60 * 1000;

// v7.1: Periodic cleanup of expired failure entries to prevent unbounded Map growth
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of _recentFailedRequests) {
    if (now - ts > RECENT_FAILED_TTL) _recentFailedRequests.delete(key);
  }
  // Safety: cap in-flight requests to prevent orphaned promise accumulation
  if (_inFlightExactPointRequests.size > 20) {
    console.warn(`[ExactPoint] In-flight request map has ${_inFlightExactPointRequests.size} entries, clearing stale entries.`);
    _inFlightExactPointRequests.clear();
  }
}, 60000);

const MARINE_MODEL_LIMITS = {
  'ncep_gfswave025': 16,
  'gwam': 7,
  'ecmwf_wam025': 10,
};

export function getCachedPointResponse(lat, lng, model, activeLayer = 'waves', timeOffsetHours = 0) {
  if (lat == null || lng == null) return null;
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
  const isPrecipRedirect = typeof getBackendPrecipitationFlag === 'function' && getBackendPrecipitationFlag() && (model === 'GFS' || model === 'ICON' || model === 'EURO' || !model) && (activeLayer === 'precipitation' || activeLayer === 'rain');

  if (isPrecipRedirect) {
    const validTimeStr = getSharedValidTime(timeOffsetHours, activeLayer, model || 'GFS');
    const cacheKey = `${(model || 'GFS').toUpperCase()}_weather_precipitation_${rLat.toFixed(2)}_${rLng.toFixed(2)}_${validTimeStr}_${provider}`;
    const cachedPrecip = _exactPointCache.get(cacheKey);
    if (cachedPrecip && Date.now() - cachedPrecip.timestamp < EXACT_POINT_CACHE_TTL) {
      return cachedPrecip.data;
    }
    const cachedPrecipBC = precipitationPointCache.get(cacheKey);
    if (cachedPrecipBC) {
      return cachedPrecipBC.data;
    }
    return null;
  }

  const isBackendRedirect = isPressureRedirect || isGfsRedirect || isWindRedirect || isCopernicusRedirect || isIconRedirect;

  const cacheKey = isBackendRedirect
    ? `${rLat}_${rLng}_${model || 'GFS'}_${activeLayer || 'waves'}_${provider}_hr${timeOffsetHours}`
    : `${rLat}_${rLng}_${model || 'GFS'}_${activeLayer || 'waves'}_${provider}`;

  const cached = _exactPointCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EXACT_POINT_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

export function hasCacheForModel(lat, lng, model, activeLayer = 'waves', timeOffsetHours = 0) {
  return getCachedPointResponse(lat, lng, model, activeLayer, timeOffsetHours) !== null;
}

/**
 * Fetch the FULL multi-day forecast for a single point.
 */
export async function fetchExactMarinePoint(lat, lng, model, activeLayer = 'waves', signal = null, timeOffsetHours = 0, force = false, gridProductId = null, gridBbox = null) {
  if (lat == null || lng == null) return null;

  const startTime = Date.now();
  const rLat = +lat.toFixed(2);
  const rLng = +lng.toFixed(2);
  
  if (typeof isInCooldown === 'function' && isInCooldown('marine')) {
    console.warn(`[ExactPoint] Blocked fetch for model=${model} lat=${rLat} lng=${rLng}: marine cooldown is active.`);
    return { status: 'rate_limited' };
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
  const isPrecipRedirect = typeof getBackendPrecipitationFlag === 'function' && getBackendPrecipitationFlag() && (model === 'GFS' || model === 'ICON' || model === 'EURO' || !model) && (activeLayer === 'precipitation' || activeLayer === 'rain');
  const isBackendRedirect = isPressureRedirect || isGfsRedirect || isWindRedirect || isCopernicusRedirect || isIconRedirect;

  const cacheKey = isPrecipRedirect
    ? `${(model || 'GFS').toUpperCase()}_weather_precipitation_${rLat.toFixed(2)}_${rLng.toFixed(2)}_${getSharedValidTime(timeOffsetHours, activeLayer, model || 'GFS')}_${provider}`
    : (isBackendRedirect
      ? `${rLat}_${rLng}_${model || 'GFS'}_${activeLayer || 'waves'}_${provider}_hr${timeOffsetHours}`
      : `${rLat}_${rLng}_${model || 'GFS'}_${activeLayer || 'waves'}_${provider}`);

  // --- v7.6 Unified Cache Interception ---
  const cachedResponse = getCachedPointResponse(rLat, rLng, model, activeLayer, timeOffsetHours);
  if (cachedResponse) {
    console.log(`[ExactPoint] Cache hit resolved at entry for key: ${cacheKey}`);
    return cachedResponse;
  }

  // --- TEMPORARY ROUTING: REDIRECT GFS/ICON/EURO PRECIPITATION TO BACKEND ---
  if (isPrecipRedirect) {
    try {
      console.log(`[Backend Precipitation Service] Redirecting ${model || 'GFS'} Precipitation point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactPrecipitationPoint(rLat, rLng, timeOffsetHours, signal, model || 'GFS');
      if (pointResult) {
        updateDeprecationDiag({
          model: model || 'GFS',
          layer: activeLayer,
          offset: timeOffsetHours,
          calledFunc: null,
          called: false,
          backendAvailable: true,
          productId: pointResult.productId,
          fallbackReason: 'backend_redirect_active',
          conformedPoint: pointResult
        });
        _exactPointCache.set(cacheKey, { data: pointResult, timestamp: Date.now() });
        return pointResult;
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort') || signal?.aborted) {
        throw err;
      }
      console.warn(`[Backend Precipitation Service] Precipitation point redirect failed: ${err.message}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  // --- REDIRECT GFS/ICON/EURO PRESSURE TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (isPressureRedirect) {
    try {
      console.log(`[Backend Pressure Service] Redirecting ${model || 'GFS'} Pressure point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactPressurePoint(rLat, rLng, timeOffsetHours, signal, model || 'GFS');
      if (pointResult) {
        updateDeprecationDiag({
          model: model || 'GFS',
          layer: activeLayer,
          offset: timeOffsetHours,
          calledFunc: null,
          called: false,
          backendAvailable: true,
          productId: pointResult.productId,
          fallbackReason: 'backend_redirect_active',
          conformedPoint: pointResult
        });
        _exactPointCache.set(cacheKey, { data: pointResult, timestamp: Date.now() });
        return pointResult;
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort') || signal?.aborted) {
        throw err;
      }
      console.warn(`[Backend Pressure Service] Pressure point redirect failed. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  // --- REDIRECT GFS WAVES / SWELL_1 / SWELL_2 TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (isGfsRedirect) {
    try {
      console.log(`[Backend Weather Service] Redirecting GFS ${activeLayer} point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactPoint(rLat, rLng, timeOffsetHours, signal, activeLayer, 'GFS', gridProductId, gridBbox);
      if (pointResult) {
        updateDeprecationDiag({
          model: 'GFS',
          layer: activeLayer,
          offset: timeOffsetHours,
          calledFunc: null,
          called: false,
          backendAvailable: true,
          productId: pointResult.productId,
          fallbackReason: 'backend_redirect_active',
          conformedPoint: pointResult
        });
        _exactPointCache.set(cacheKey, { data: pointResult, timestamp: Date.now() });
        return pointResult;
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort') || signal?.aborted) {
        throw err;
      }
      console.warn(`[Backend Weather Service] Point redirect failed for GFS ${activeLayer}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  // --- REDIRECT GFS, ICON AND EURO WIND TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (isWindRedirect) {
    try {
      console.log(`[Backend Weather Service] Redirecting ${model || 'GFS'} Wind point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactWindPoint(rLat, rLng, timeOffsetHours, signal, model || 'GFS');
      if (pointResult) {
        updateDeprecationDiag({
          model: model || 'GFS',
          layer: activeLayer,
          offset: timeOffsetHours,
          calledFunc: null,
          called: false,
          backendAvailable: true,
          productId: pointResult.productId,
          fallbackReason: 'backend_redirect_active',
          conformedPoint: pointResult
        });
        _exactPointCache.set(cacheKey, { data: pointResult, timestamp: Date.now() });
        return pointResult;
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort') || signal?.aborted) {
        throw err;
      }
      console.warn(`[Backend Weather Service] Wind point redirect failed: ${err.message}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  // --- REDIRECT COPERNICUS TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (isCopernicusRedirect) {
    try {
      console.log(`[Backend Weather Service] Redirecting Copernicus ${activeLayer} point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactCopernicusPoint(rLat, rLng, timeOffsetHours, signal, activeLayer, gridProductId, gridBbox);
      if (pointResult) {
        updateDeprecationDiag({
          model: 'EURO',
          layer: activeLayer,
          offset: timeOffsetHours,
          calledFunc: null,
          called: false,
          backendAvailable: true,
          productId: pointResult.productId,
          fallbackReason: 'backend_redirect_active',
          conformedPoint: pointResult
        });
        _exactPointCache.set(cacheKey, { data: pointResult, timestamp: Date.now() });
        return pointResult;
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort') || signal?.aborted) {
        throw err;
      }
      console.warn(`[Backend Weather Service] Copernicus point redirect failed: ${err.message}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  // --- REDIRECT ICON WAVES / SWELL_1 / SWELL_2 / WIND_WAVES TO BACKEND IF FEATURE FLAG IS ACTIVE ---
  if (isIconRedirect) {
    try {
      console.log(`[Backend Weather Service] Redirecting ICON ${activeLayer} point fetch to backend Weather Data Service for lat=${rLat} lng=${rLng} hourOffset=+${timeOffsetHours}h`);
      const pointResult = await fetchBackendExactPoint(rLat, rLng, timeOffsetHours, signal, activeLayer, 'ICON', gridProductId, gridBbox);
      if (pointResult) {
        updateDeprecationDiag({
          model: 'ICON',
          layer: activeLayer,
          offset: timeOffsetHours,
          calledFunc: null,
          called: false,
          backendAvailable: true,
          productId: pointResult.productId,
          fallbackReason: 'backend_redirect_active',
          conformedPoint: pointResult
        });
        _exactPointCache.set(cacheKey, { data: pointResult, timestamp: Date.now() });
        return pointResult;
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort') || signal?.aborted) {
        throw err;
      }
      console.warn(`[Backend Weather Service] Point redirect failed for ICON ${activeLayer}. Falling back cleanly to original Netlify proxy/Open-Meteo pipeline.`);
    }
  }

  if (force) {
    _recentFailedRequests.delete(cacheKey);
  }
  const recentFailure = _recentFailedRequests.get(cacheKey);
  if (!force && recentFailure && Date.now() - recentFailure < RECENT_FAILED_TTL) {
    console.warn(`[ExactPoint] Blocked fetch: recent failed request exists in TTL window for key: ${cacheKey}`);
    return { status: 'rate_limited' };
  }

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
      let abortHandler = null;
      let localController = null;
      if (isEuroComponent) {
        localController = new AbortController();
        standaloneTimeoutId = setTimeout(() => localController.abort(), 25000);
        fetchSignal = localController.signal;
        if (signal) {
          if (signal.aborted) {
            localController.abort();
          } else {
            abortHandler = () => localController.abort();
            signal.addEventListener('abort', abortHandler);
          }
        }
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
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }

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

        const detectedProvider = (model === 'EURO' && ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(activeLayer))
          ? 'copernicus'
          : (result.__provider || result.provider || (proxyType === 'copernicus_marine' ? 'copernicus' : 'open-meteo'));
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

        if (_exactPointCache.size > 200) {
          const oldest = [..._exactPointCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
          for (let i = 0; i < 40; i++) _exactPointCache.delete(oldest[i][0]);
        }

        return data;

      } catch (err) {
        if (standaloneTimeoutId) clearTimeout(standaloneTimeoutId);
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
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
          if (signal && signal.aborted) {
            console.warn(`[ExactPoint Forensic] USER ABORT: Fetch aborted by user signal after ${elapsed.toFixed(2)}s for model=${apiModel}`);
            throw err;
          }
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
        if (standaloneTimeoutId) clearTimeout(standaloneTimeoutId);
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
        _inFlightExactPointRequests.delete(inFlightKey);
      }
    }
  })();

  _inFlightExactPointRequests.set(inFlightKey, fetchPromise);
  return fetchPromise;
}
