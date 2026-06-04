import { BACKEND_URL } from '../../lib/apiClient';
import { fetchProductsManifest } from './backendWeatherServiceClient';

export const POINT_URL = `${BACKEND_URL}/api/weather/point`;

/**
 * Resolves the backend pressure feature flag.
 * Keeps it default-off. Controlled by rawsurf_backend_pressure_enabled in localStorage,
 * or __USE_BACKEND_PRESSURE_SERVICE__ window variable.
 */
export function getBackendPressureFlag() {
  if (typeof window === 'undefined') return false;
  if (window.__USE_BACKEND_PRESSURE_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_PRESSURE_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('rawsurf_backend_pressure_enabled');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  return false;
}

/**
 * Fetches exact point pressure forecast from backend weather service.
 */
export async function fetchBackendExactPressurePoint(lat, lng, hourOffset, signal) {
  const start = Date.now();
  
  // Try to load manifest to get nearest valid_time
  const manifest = await fetchProductsManifest().catch(() => null);
  
  const baseTime = (typeof window !== 'undefined' && window.__MOCK_DATE_NOW__) || Date.now();
  const roundedNow = Math.round(baseTime / 3600000) * 3600000;
  const targetDt = new Date(roundedNow + hourOffset * 3600000);
  const requestedValidTime = targetDt.toISOString();
  
  let validTimeStr = requestedValidTime;
  let fallbackReason = null;
  
  if (manifest && Array.isArray(manifest.products)) {
    const matchingProducts = manifest.products.filter(p => 
      p.model.toUpperCase() === 'GFS' &&
      p.domain.toLowerCase() === 'weather' &&
      p.layer.toLowerCase() === 'pressure'
    );
    if (matchingProducts.length > 0) {
      let minDiffMs = Infinity;
      let bestProduct = null;
      for (const p of matchingProducts) {
        const pDate = new Date(p.valid_time_start);
        const diffMs = Math.abs(pDate.getTime() - targetDt.getTime());
        if (diffMs < minDiffMs) {
          minDiffMs = diffMs;
          bestProduct = p;
        }
      }
      if (minDiffMs <= 3 * 3600000 && bestProduct) {
        validTimeStr = new Date(bestProduct.valid_time_start).toISOString();
      } else {
        fallbackReason = `No GFS pressure product within 3 hours delta limit (${(minDiffMs / 3600000).toFixed(1)}h delta)`;
      }
    } else {
      fallbackReason = "No GFS weather pressure products found in manifest";
    }
  } else {
    fallbackReason = "Manifest not loaded or empty";
  }

  const url = `${POINT_URL}?model=GFS&domain=weather&layer=pressure&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;
  
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      let reason = `Backend point returned HTTP ${res.status}`;
      try {
        const errorJson = await res.json();
        if (errorJson && errorJson.reason) {
          reason = errorJson.reason;
        } else if (errorJson && errorJson.detail) {
          reason = errorJson.detail;
        }
      } catch (e) {}
      throw new Error(reason);
    }
    
    const json = await res.json();
    
    // Conformed hourly response format compatible with forecastSamplers.js
    const mockTime = validTimeStr.replace(/\.\d+Z$/, 'Z');
    const conformedHourly = {
      time: [mockTime],
      pressure_msl: [json.point.value !== undefined ? json.point.value : null]
    };
    
    const data = {
      hourly: conformedHourly,
      snappedLat: json.point.sampled_lat || lat,
      snappedLng: json.point.sampled_lng || lng,
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: 'GFS',
      activeLayer: 'pressure',
      forecastDays: 1,
      apiModel: 'gfs_seamless',
      provider: json.provider || 'backend-weather-service',
      source: 'backend_point_api',
      diagnosticDetails: {
        url,
        status: res.status,
        validTime: validTimeStr,
        requestedValidTime,
        fallbackReason,
        valueKind: json.value_kind || 'pressure',
        valueUnit: json.value_unit || 'hPa',
        displayUnitHint: json.display_unit_hint || 'hPa',
        elapsedMs: Date.now() - start,
        error: null,
        hourOffset,
        layer: 'pressure',
        value: json.point.value,
        interpolationMethod: json.point.interpolation_method || 'bilinear',
        provider: json.provider || 'backend-weather-service',
        sourceDataset: json.source_dataset,
        sourceVariables: json.source_variables,
        is_forecast_authoritative: json.is_forecast_authoritative,
        is_estimated: json.is_estimated,
        is_test_fixture: json.is_test_fixture
      }
    };
    
    if (typeof window !== 'undefined') {
      window.__BACKEND_PRESSURE_SERVICE_DIAG__ = data.diagnosticDetails;
    }
    
    return data;
  } catch (err) {
    const errorDetails = {
      url,
      status: 500,
      validTime: validTimeStr,
      requestedValidTime,
      fallbackReason: err.message,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: err.message,
      hourOffset,
      layer: 'pressure',
      value: null,
      interpolationMethod: 'none',
      provider: 'none',
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false
    };
    if (typeof window !== 'undefined') {
      window.__BACKEND_PRESSURE_SERVICE_DIAG__ = errorDetails;
    }
    console.error(`[Backend Pressure Service] Point fetch error: ${err.message}. Falling back cleanly.`);
    throw err;
  }
}
