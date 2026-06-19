/**
 * backendWeatherServiceClientPoint.js
 * 
 * Fetches exact point forecasts from backend weather service.
 */

import { getSharedValidTime, pointCache, POINT_URL } from './backendWeatherServiceClient';
import { recordTruthStage } from './weatherTruthTracker';
import { updateDiagnostics } from './backendWeatherServiceClientDiag';

export async function fetchBackendExactPoint(lat, lng, hourOffset, signal, layer = 'waves', model = 'GFS', gridProductIdParam = null, gridBboxParam = null) {
  if (model === 'ICON' && layer === 'swell_2') {
    return {
      status: 'unsupported',
      hourly: {
        time: [getSharedValidTime(hourOffset, 'swell_2', 'ICON')],
        secondary_swell_wave_height: [null],
        secondary_swell_wave_direction: [null],
        secondary_swell_wave_period: [null]
      },
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: 'ICON',
      activeLayer: 'swell_2',
      provider: 'none',
      source: 'unsupported_model_layer',
      is_estimated: false,
      warnings: ['unsupported_model_layer']
    };
  }

  let gridProductId = gridProductIdParam;
  if (!gridProductId && typeof window !== 'undefined') {
    const diag = window.__MARINE_PROJECTION_DIAG__;
    if (diag && diag.activeLayer === layer && diag.activeModel === model) {
      gridProductId = diag.productId || diag.gridProductId || null;
    }
  }

  let gridBbox = gridBboxParam;
  if (!gridBbox && typeof window !== 'undefined') {
    const diag = window.__MARINE_PROJECTION_DIAG__;
    if (diag && diag.activeLayer === layer && diag.activeModel === model) {
      gridBbox = diag.requested_bbox || diag.backendRequestBbox || null;
    }
  }
  if (!gridBbox && typeof window !== 'undefined' && window.map) {
    try {
      const b = window.map.getBounds();
      gridBbox = `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`;
    } catch (e) {
      gridBbox = null;
    }
  }

  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, layer, model);
  const provider = model === 'EURO' ? 'copernicus' : 'open-meteo';
  let cacheKey = `${model}_marine_${layer}_${lat.toFixed(2)}_${lng.toFixed(2)}_${validTimeStr}_${provider}`;
  if (gridProductId) {
    cacheKey += `_grid_${gridProductId}`;
  }
  if (gridBbox) {
    cacheKey += `_bbox_${gridBbox}`;
  }

  const cached = pointCache.get(cacheKey);
  if (cached) {
    console.log(`[Backend Weather Service] Cache hit for ${model} Marine: ${cacheKey}`);
    const clonedData = JSON.parse(JSON.stringify(cached.data));
    clonedData.source = 'cache';
    updateDiagnostics('point', { ...cached.details, source: 'cache' }, model);
    return clonedData;
  }

  let url = `${POINT_URL}?model=${model}&domain=marine&layer=${layer}&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;
  if (gridProductId) {
    url += `&grid_product_id=${encodeURIComponent(gridProductId)}`;
  }
  if (gridBbox) {
    url += `&grid_bbox=${encodeURIComponent(gridBbox)}`;
  }

  if (model === 'GFS' && layer === 'waves' && hourOffset === 0) {
    recordTruthStage('pointRequest', {
      model,
      domain: 'marine',
      layer,
      valid_time: validTimeStr,
      grid_product_id: gridProductId,
      truthTag: window.__WEATHER_TRUTH_TRACE__?.stages?.find(s => s.stage === 'webglRender')?.truthTag
    }, 'backendWeatherServiceClient.js', 'fetchBackendExactPoint');
  }

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      let reason = `Backend conformed point returned HTTP ${res.status}`;
      let errorJson = null;
      try {
        errorJson = await res.json();
        if (errorJson && errorJson.reason) {
          reason = errorJson.reason;
        } else if (errorJson && errorJson.detail) {
          reason = errorJson.detail;
        }
      } catch (e) {}

      if (reason === 'no_backend_coverage' || reason === 'no_copernicus_coverage') {
        const errorDetails = {
          url,
          status: res.status,
          validTime: validTimeStr,
          valueKind: 'none',
          valueUnit: 'none',
          displayUnitHint: 'none',
          elapsedMs: Date.now() - start,
          error: reason,
          hourOffset,
          layer,
          speed: 0,
          direction: 0,
          interpolationMethod: 'none',
          provider: 'backend-weather-service',
          sourceDataset: null,
          sourceVariables: null,
          is_forecast_authoritative: false,
          is_estimated: false,
          is_test_fixture: false
        };
        updateDiagnostics('point', errorDetails, model);
        return {
          status: reason,
          hourly: { time: [] },
          requestedLat: lat,
          requestedLng: lng,
          requestedModel: model,
          activeLayer: layer,
          provider: 'backend-weather-service',
          source: 'backend_point_api'
        };
      }
      throw new Error(reason);
    }
    const json = await res.json();
    if (model === 'GFS' && layer === 'waves' && hourOffset === 0) {
      recordTruthStage('pointResponse', {
        model,
        domain: 'marine',
        layer,
        valid_time: json.valid_time,
        product_id: json.product_id,
        truthTag: json.truthTag
      }, 'backendWeatherServiceClient.js', 'fetchBackendExactPoint');
    }
    
    const mockTime = validTimeStr.replace(/\.\d+Z$/, 'Z');
    const conformedHourly = {
      time: [mockTime],
      wave_height: [null],
      wave_direction: [null],
      wave_period: [null],
      wave_peak_period: [null],
      swell_wave_height: [null],
      swell_wave_direction: [null],
      swell_wave_period: [null],
      swell_wave_peak_period: [null],
      secondary_swell_wave_height: [null],
      secondary_swell_wave_direction: [null],
      secondary_swell_wave_period: [null],
      wind_wave_height: [null],
      wind_wave_direction: [null],
      wind_wave_period: [null],
      wind_wave_peak_period: [null]
    };

    if (layer === 'waves') {
      conformedHourly.wave_height = [json.point.speed || 0];
      conformedHourly.wave_direction = [json.point.direction || 0];
      conformedHourly.wave_period = [json.point.period || 0];
      conformedHourly.wave_peak_period = [null];
    } else if (layer === 'swell_1') {
      conformedHourly.swell_wave_height = [json.point.speed || 0];
      conformedHourly.swell_wave_direction = [json.point.direction || 0];
      conformedHourly.swell_wave_period = [json.point.period || 0];
      conformedHourly.swell_wave_peak_period = [null];
    } else if (layer === 'swell_2') {
      conformedHourly.secondary_swell_wave_height = [json.point.speed || 0];
      conformedHourly.secondary_swell_wave_direction = [json.point.direction || 0];
      conformedHourly.secondary_swell_wave_period = [json.point.period || 0];
    } else if (layer === 'wind_waves') {
      conformedHourly.wind_wave_height = [json.point.speed || 0];
      conformedHourly.wind_wave_direction = [json.point.direction || 0];
      conformedHourly.wind_wave_period = [json.point.period || 0];
      conformedHourly.wind_wave_peak_period = [null];
    }

    const data = {
      hourly: conformedHourly,
      snappedLat: json.point.sampled_lat || lat,
      snappedLng: json.point.sampled_lng || lng,
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: model,
      activeLayer: layer,
      forecastDays: 1,
      apiModel: model === 'ICON' ? 'gwam' : (model === 'EURO' ? 'ecmwf_wam025' : 'ncep_gfswave025'),
      provider: json.provider || provider,
      source: 'network',
      status: json.status || json.coverage_status || 'exact_success',
      is_estimated: json.is_estimated || false,
      estimate_basis: json.estimate_basis || null,
      productId: json.product_id || null
    };

    const details = {
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || (layer === 'swell_1' ? 'swell_wave_height' : 'wave_height'),
      valueUnit: json.value_unit || 'm',
      displayUnitHint: json.display_unit_hint || 'ft',
      elapsedMs: Date.now() - start,
      error: null,
      hourOffset,
      layer,
      speed: json.point.speed || 0,
      direction: json.point.direction || 0,
      period: json.point.period || 0,
      interpolationMethod: json.point.interpolation_method || 'bilinear',
      provider: json.provider || provider,
      sourceDataset: json.source_dataset,
      sourceVariables: json.source_variables,
      is_forecast_authoritative: json.is_forecast_authoritative,
      is_estimated: json.is_estimated,
      estimate_basis: json.estimate_basis || null,
      estimateBasis: json.estimate_basis || null,
      is_test_fixture: json.is_test_fixture,
      productId: json.product_id || null,
      pointProductId: json.product_id || null,
      source: json.source || 'network',
      is_dynamic_viewport_product: json.is_dynamic_viewport_product || false,
      coverage_scope: json.coverage_scope || null,
      requested_bbox: json.requested_bbox || null,
      served_bbox: json.served_bbox || null,
      resolution: json.resolution || null,
      coordinate_count: json.coordinate_count || null,
      cache_key: json.cache_key || null,
      cache_hit: json.cache_hit || null
    };

    if (typeof window !== 'undefined' && model === 'GFS' && layer === 'waves' && hourOffset === 0) {
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__.exactPoint = {
        pointRequestUrl: url,
        pointProductId: json.point?.product_id || json.product_id || null,
        pointValidTime: json.point?.valid_time || json.valid_time || null,
        pointSpeed: json.point?.speed,
        pointDirection: json.point?.direction,
        pointPeriod: json.point?.period,
        gridProductId: gridProductId,
        gridParity: json.gridParity !== undefined ? json.gridParity : (json.point?.grid_parity),
        fallbackReason: json.fallbackReason || json.point?.fallback_reason || null,
        coverageStatus: json.status || json.coverage_status || null,
        infoboxDisplayedHeight: json.point?.speed ? `${json.point.speed.toFixed(1)} m` : 'No Data'
      };
      if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
        window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
      }
    }

    pointCache.set(cacheKey, { data, details });
    updateDiagnostics('point', details, model);
    return data;
  } catch (err) {
    const status = err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500;
    updateDiagnostics('point', {
      url,
      status,
      validTime: validTimeStr,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: err.message,
      hourOffset,
      layer,
      speed: 0,
      direction: 0,
      interpolationMethod: 'none',
      provider: 'none',
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false
    }, model);
    if (err.name === 'AbortError' || err.message?.includes('abort')) {
      console.log(`[Backend Weather Service] Point fetch aborted (expected during model/layer switch).`);
    } else {
      console.error(`[Backend Weather Service] Point fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    }
    throw err;
  }
}
