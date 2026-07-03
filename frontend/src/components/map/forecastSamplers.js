/**
 * forecastSamplers.js — Marine data sampling utilities
 *
 * Re-exports refactored exact point fetching and diagnostic helpers.
 */

import {
  mToFt, degToCompass, findHourIndex, getClampedValue, getBiasAdjusted,
  sampleValueFromDecodedTiles, sampleFromMarineGrid
} from './forecastHelpers';
import {
  getBackendCopernicusFlag,
  getBackendIconMarineFlag,
  getBackendWeatherFlag,
} from './backendWeatherServiceClient';

import { updateDeprecationDiag } from './forecastDeprecationDiag';
// F5: single source of truth for display horizons. Import from useMarineDataFetcherHelpers (the
// one definition) instead of redefining locally — this duplication is what let EURO drift to a
// stale 240h. These are display/no-coverage serve maxima; the authoritative scrubber max is the
// backend capabilities max_forecast_hours, consumed by LayerAccessResolver.
import {
  DISPLAY_EURO_WAVES_MAX_HOURS,
  DISPLAY_EURO_COMPONENT_MAX_HOURS,
  DISPLAY_ICON_MAX_HOURS,
} from './useMarineDataFetcherHelpers';

export { sampleFromMarineGrid };

export {
  hasCacheForModel,
  fetchExactMarinePoint,
  getCachedPointResponse,
  _exactPointCache
} from './forecastExactPoint';

export { updateDeprecationDiag } from './forecastDeprecationDiag';

/**
 * Select the correct hour from a cached exact-point response.
 */
export function selectExactPointHour(cachedResponse, hourOffset) {
  if (!cachedResponse) return null;

  const offset = isNaN(Number(hourOffset)) ? 0 : Number(hourOffset);
  const model = cachedResponse.requestedModel || 'GFS';
  const activeLayer = cachedResponse.activeLayer || 'waves';

  // The point response is AUTHORITATIVE when it carries usable hourly data: the global grid diag
  // below reflects the last GRID fetch, and a grid coverage failure (viewport clamp, switch race,
  // cold backend) must never veto a successful point fetch. Without this guard, one stale
  // fallbackReason at the matching hour (usually 0) blanked every subsequent infobox read for the
  // model — the live-observed "EURO waves no_coverage mid-Pacific while the cache held real data".
  const cachedHasUsableHourly = !!(cachedResponse.hourly && Array.isArray(cachedResponse.hourly.time)
    && cachedResponse.hourly.time.length > 0)
    && !['unsupported', 'no_coverage', 'no_backend_coverage', 'no_copernicus_coverage',
         'out_of_bounds/no_coverage'].includes(cachedResponse.status);

  if (typeof window !== 'undefined' && !cachedHasUsableHourly) {
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

    // A diag written for a DIFFERENT layer says nothing about this request — require a match
    // when the diag carries one (marine diags default their layer; wind diags may not).
    const diagLayerMatches = !diag?.layer || diag.layer === activeLayer;

    if (diag && diagLayerMatches &&
        (diag.fallbackReason === fallbackReasonValue || diag.fallbackReason?.includes(fallbackReasonValue)) &&
        (diag.requestedHour === offset || diag.lastGridFetch?.hourOffset === offset)) {
      updateDeprecationDiag({
        model,
        layer: activeLayer,
        offset,
        calledFunc: null,
        called: false,
        backendAvailable: false,
        productId: null,
        fallbackReason: fallbackReasonValue
      });
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
    updateDeprecationDiag({
      model,
      layer: activeLayer,
      offset,
      calledFunc: null,
      called: false,
      backendAvailable: false,
      productId: null,
      fallbackReason: cachedResponse.status
    });
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

  // Empty time array (a failure response whose reason string isn't in the no-coverage set above,
  // e.g. a raw backend detail) must bail here too — [] is truthy, and falling through crashed on
  // times[bestIdx].endsWith. Treat as no selectable hour.
  if (!cachedResponse.hourly?.time || cachedResponse.hourly.time.length === 0) return null;

  if (cachedResponse.status === 'unsupported') {
    updateDeprecationDiag({
      model,
      layer: activeLayer,
      offset,
      calledFunc: null,
      called: false,
      backendAvailable: false,
      productId: null,
      fallbackReason: 'unsupported_model_layer'
    });
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
  const hardNativeLimit = hasCombinedWaves ? DISPLAY_EURO_WAVES_MAX_HOURS : DISPLAY_EURO_COMPONENT_MAX_HOURS;

  let nativeLimit = hardNativeLimit;
  if (cachedResponse.hourly?.time?.length) {
    const lastTimeStr = cachedResponse.hourly.time[cachedResponse.hourly.time.length - 1];
    const lastTimeMs = new Date(lastTimeStr.endsWith('Z') ? lastTimeStr : lastTimeStr + 'Z').getTime();
    const hoursFromNow = Math.max(0, Math.round((lastTimeMs - Date.now()) / 3600000));
    nativeLimit = Math.min(hardNativeLimit, hoursFromNow);
  }

  if (isEuro && offset > nativeLimit && !getBackendCopernicusFlag()) {
    const activeLayer = cachedResponse.activeLayer || (hasCombinedWaves ? 'waves' : 'swell_1');
    updateDeprecationDiag({
      model,
      layer: activeLayer,
      offset,
      calledFunc: null,
      called: false,
      backendAvailable: false,
      productId: null,
      fallbackReason: 'backend_required_no_frontend_estimator'
    });
    return {
      status: 'no_coverage',
      source: 'backend_required',
      requestedLat: cachedResponse.requestedLat,
      requestedLng: cachedResponse.requestedLng,
      requestedModel: cachedResponse.requestedModel,
      activeLayer: cachedResponse.activeLayer,
      provider: 'none',
      is_estimated: false,
      fallbackReason: 'backend_required_no_frontend_estimator',
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

  const isIcon = cachedResponse.requestedModel === 'ICON';
  let iconLimit = DISPLAY_ICON_MAX_HOURS;
  if (isIcon && cachedResponse.hourly?.time?.length) {
    const lastTimeStr = cachedResponse.hourly.time[cachedResponse.hourly.time.length - 1];
    const lastTimeMs = new Date(lastTimeStr.endsWith('Z') ? lastTimeStr : lastTimeStr + 'Z').getTime();
    const hoursFromNow = Math.max(0, Math.round((lastTimeMs - Date.now()) / 3600000));
    iconLimit = Math.min(DISPLAY_ICON_MAX_HOURS, hoursFromNow);
  }

  if (isIcon && offset > iconLimit && getBackendIconMarineFlag()) {
    updateDeprecationDiag({
      model,
      layer: activeLayer,
      offset,
      calledFunc: null,
      called: false,
      backendAvailable: false,
      productId: null,
      fallbackReason: 'icon_no_backend_extended_estimate'
    });
    return {
      status: 'no_coverage',
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

  if (isIcon && offset > iconLimit && !getBackendIconMarineFlag()) {
    const activeLayer = cachedResponse.activeLayer || 'waves';
    updateDeprecationDiag({
      model,
      layer: activeLayer,
      offset,
      calledFunc: null,
      called: false,
      backendAvailable: false,
      productId: null,
      fallbackReason: 'backend_required_no_frontend_estimator'
    });
    return {
      status: 'no_coverage',
      source: 'backend_required',
      requestedLat: cachedResponse.requestedLat,
      requestedLng: cachedResponse.requestedLng,
      requestedModel: cachedResponse.requestedModel,
      activeLayer: cachedResponse.activeLayer,
      provider: 'none',
      is_estimated: false,
      fallbackReason: 'backend_required_no_frontend_estimator',
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
  
  const isBackendCopernicus = typeof getBackendCopernicusFlag === 'function' && getBackendCopernicusFlag();
  const isBackendIcon = typeof getBackendIconMarineFlag === 'function' && getBackendIconMarineFlag();
  const isBackendGfs = typeof getBackendWeatherFlag === 'function' && getBackendWeatherFlag();
  const isBackendRedirectActive = (isEuro && isBackendCopernicus) || (isIcon && isBackendIcon) || (!isEuro && !isIcon && isBackendGfs);
  const backendAvailable = isBackendRedirectActive && (cachedResponse.status === 'exact_success' || cachedResponse.status === 'exact_stale_available' || cachedResponse.is_estimated || status === 'exact_success');
  const fbReasonVal = isBackendRedirectActive ? 'backend_redirect_active' : 'within_native_limit_or_unsupported';

  const pointResult = {
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
    precipitation: status === 'exact_no_time_coverage' ? null : (h.precipitation?.[bestIdx] ?? null),
    
    status,
    source: cachedResponse.source || 'exact_point_api',
    is_estimated: cachedResponse.is_estimated || false,
    estimate_basis: cachedResponse.estimate_basis || null,
    productId: cachedResponse.productId || null,
    provider: cachedResponse.provider,
    hourIndex: bestIdx,
    time: times[bestIdx],
    snappedLat: cachedResponse.snappedLat,
    snappedLng: cachedResponse.snappedLng,
    requestedLat: cachedResponse.requestedLat,
    requestedLng: cachedResponse.requestedLng,
    requestedModel: cachedResponse.requestedModel,
    forecastDays: cachedResponse.forecastDays,
    timeRangeStart: times[0],
    timeRangeEnd: times[times.length - 1],
    matchDiffMs: minDiff
  };

  updateDeprecationDiag({
    model,
    layer: activeLayer,
    offset,
    calledFunc: null,
    called: false,
    backendAvailable,
    productId: cachedResponse.productId,
    fallbackReason: fbReasonVal,
    conformedPoint: pointResult
  });

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
    precipitation: status === 'exact_no_time_coverage' ? null : (h.precipitation?.[bestIdx] ?? null),
    status,
    source: cachedResponse.source || 'exact_point_api',
    is_estimated: cachedResponse.is_estimated || false,
    estimate_basis: cachedResponse.estimate_basis || null,
    productId: cachedResponse.productId || null,
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
    matchDiffMs: minDiff,
    // Option-2 surf transform (estimate): nearshore breaking height for this point/hour, from the backend
    surf_height_m: status === 'exact_no_time_coverage' ? null : (cachedResponse.surf_height_m ?? null),
    surf_regime: cachedResponse.surf_regime ?? null,
    shelf_depth_m: cachedResponse.shelf_depth_m ?? null
  };
}

export { writeOverlayDiagnostics } from './forecastDiagnostics';
export { mToFt, degToCompass, findHourIndex, getClampedValue, getBiasAdjusted, sampleValueFromDecodedTiles };
