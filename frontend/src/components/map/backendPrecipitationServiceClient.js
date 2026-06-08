import { BACKEND_URL } from '../../lib/apiClient';
import { 
  fetchProductsManifest, 
  updateProjectionDiag, 
  getProductCoverage, 
  PILOT_COVERAGE 
} from './backendWeatherServiceClient';
import { BoundedPointCache } from './BoundedPointCache';
import { MODEL_METADATA_CACHE, PRECIP_MODEL_MAP } from './LayerRegistry';

export const precipitationPointCache = new BoundedPointCache(50, 30000);

export const POINT_URL = `${BACKEND_URL}/api/weather/point`;

/**
 * Resolves the backend precipitation feature flag.
 * Keeps it default-on. Controlled by rawsurf_backend_precipitation_enabled in localStorage,
 * or __USE_BACKEND_PRECIPITATION_SERVICE__ window variable.
 */
export function getBackendPrecipitationFlag() {
  if (typeof window === 'undefined') return false;
  if (window.__USE_BACKEND_PRECIPITATION_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_PRECIPITATION_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('rawsurf_backend_precipitation_enabled');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  return true;
}

/**
 * Fetches exact point precipitation forecast from backend weather service.
 */
export async function fetchBackendExactPrecipitationPoint(lat, lng, hourOffset, signal, model = 'GFS') {
  const start = Date.now();
  const targetModel = (model || 'GFS').toUpperCase();
  const offset = isNaN(Number(hourOffset)) ? 0 : Number(hourOffset);
  
  // Try to load manifest to get nearest valid_time
  const manifest = await fetchProductsManifest().catch(() => null);
  
  const baseTime = (typeof window !== 'undefined' && window.__MOCK_DATE_NOW__) || Date.now();
  const roundedNow = Math.round(baseTime / 3600000) * 3600000;
  const targetDt = new Date(roundedNow + offset * 3600000);
  const requestedValidTime = targetDt.toISOString();
  
  let validTimeStr = requestedValidTime;
  let fallbackReason = null;
  
  if (manifest && Array.isArray(manifest.products)) {
    const matchingProducts = manifest.products.filter(p => 
      p.model.toUpperCase() === targetModel &&
      p.domain.toLowerCase() === 'weather' &&
      p.layer.toLowerCase() === 'precipitation'
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
        fallbackReason = `No ${targetModel} precipitation product within 3 hours delta limit (${(minDiffMs / 3600000).toFixed(1)}h delta)`;
      }
    } else {
      fallbackReason = `No ${targetModel} weather precipitation products found in manifest`;
    }
  } else {
    fallbackReason = "Manifest not loaded or empty";
  }

  // Compute visual tile time if available
  const visualModelKey = PRECIP_MODEL_MAP[targetModel] || 'ncep_gfs013';
  const meta = MODEL_METADATA_CACHE[visualModelKey];
  let visualTileTime = null;
  if (meta && Array.isArray(meta.validTimes) && meta.validTimes.length > 0) {
    const targetMs = baseTime + offset * 3600000;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < meta.validTimes.length; i++) {
      const diff = Math.abs(new Date(meta.validTimes[i]).getTime() - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    visualTileTime = meta.validTimes[closestIdx];
  }

  const provider = 'open-meteo';
  const cacheKey = `${targetModel}_weather_precipitation_${lat.toFixed(2)}_${lng.toFixed(2)}_${validTimeStr}_${provider}`;

  const cached = precipitationPointCache.get(cacheKey);
  if (cached) {
    console.log(`[Backend Weather Service] Cache hit for ${targetModel} Precipitation: ${cacheKey}`);
    const clonedData = JSON.parse(JSON.stringify(cached.data));
    clonedData.source = 'cache';
    if (typeof window !== 'undefined') {
      window.__BACKEND_PRECIPITATION_SERVICE_DIAG__ = { 
        ...cached.data.diagnosticDetails, 
        source: 'cache' 
      };
      const covInfo = getProductCoverage(targetModel, 'weather', 'precipitation');
      updateProjectionDiag('weather', {
        activeModel: targetModel,
        activeLayer: 'precipitation',
        requestedViewportBounds: null,
        backendRequestBbox: null,
        responseGridBounds: null,
        coverageBounds: covInfo ? covInfo.coverage : PILOT_COVERAGE,
        renderable: false,
        renderDecision: 'unsupported',
        reason: 'Precipitation raster visuals not supported from backend grids (contours stay legacy om://)'
      });
    }
    return clonedData;
  }

  const url = `${POINT_URL}?model=${targetModel}&domain=weather&layer=precipitation&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;
  
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
      precipitation: [json.point.value !== undefined ? json.point.value : null]
    };
    
    const backendPointValidTime = json.valid_time || validTimeStr;
    const finalTimeParity = visualTileTime === null 
      ? "unknown_visual_tile_time" 
      : (new Date(backendPointValidTime).getTime() === new Date(visualTileTime).getTime());

    const diagnosticDetails = {
      // Requested keys
      activeModel: targetModel,
      selectedTimelineOffset: offset,
      requestedValidTime,
      backendPointValidTime,
      visualTileTime,
      timeParity: finalTimeParity,
      pointValueMm: json.point.value !== undefined ? json.point.value : null,
      provider: json.provider || provider,
      source: 'network',
      fallbackReason: fallbackReason || (json.fallback_reason || json.fallbackReason || null),

      // Legacy/Existing keys
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || 'precipitation',
      valueUnit: json.value_unit || 'mm',
      displayUnitHint: json.display_unit_hint || 'mm',
      elapsedMs: Date.now() - start,
      error: null,
      hourOffset: offset,
      layer: 'precipitation',
      value: json.point.value,
      interpolationMethod: json.point.interpolation_method || 'bilinear',
      sourceDataset: json.source_dataset,
      sourceVariables: json.source_variables,
      is_forecast_authoritative: json.is_forecast_authoritative,
      is_estimated: json.is_estimated,
      is_test_fixture: json.is_test_fixture,
      productId: json.product_id || null,
      pointProductId: json.product_id || null,
      model: targetModel
    };

    const data = {
      hourly: conformedHourly,
      snappedLat: json.point.sampled_lat || lat,
      snappedLng: json.point.sampled_lng || lng,
      requestedLat: lat,
      requestedLng: lng,
      requestedModel: targetModel,
      activeLayer: 'precipitation',
      forecastDays: 1,
      apiModel: targetModel === 'ICON' ? 'dwd_icon' : (targetModel === 'EURO' ? 'ecmwf_ifs' : 'gfs_seamless'),
      provider: json.provider || provider,
      source: 'network',
      diagnosticDetails
    };
    
    precipitationPointCache.set(cacheKey, { data, details: diagnosticDetails });

    if (typeof window !== 'undefined') {
      window.__BACKEND_PRECIPITATION_SERVICE_DIAG__ = diagnosticDetails;
      const covInfo = getProductCoverage(targetModel, 'weather', 'precipitation');
      updateProjectionDiag('weather', {
        activeModel: targetModel,
        activeLayer: 'precipitation',
        requestedViewportBounds: null,
        backendRequestBbox: null,
        responseGridBounds: null,
        coverageBounds: covInfo ? covInfo.coverage : PILOT_COVERAGE,
        renderable: false,
        renderDecision: 'unsupported',
        reason: 'Precipitation raster visuals not supported from backend grids (contours stay legacy om://)'
      });
    }
    
    return data;
  } catch (err) {
    const finalTimeParity = visualTileTime === null 
      ? "unknown_visual_tile_time" 
      : (new Date(validTimeStr).getTime() === new Date(visualTileTime).getTime());

    const errorDetails = {
      // Requested keys
      activeModel: targetModel,
      selectedTimelineOffset: offset,
      requestedValidTime,
      backendPointValidTime: validTimeStr,
      visualTileTime,
      timeParity: finalTimeParity,
      pointValueMm: null,
      provider: 'none',
      source: 'error',
      fallbackReason: err.message,

      // Legacy/Existing keys
      url,
      status: 500,
      validTime: validTimeStr,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: err.message,
      hourOffset: offset,
      layer: 'precipitation',
      value: null,
      interpolationMethod: 'none',
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false,
      model: targetModel
    };
    if (typeof window !== 'undefined') {
      window.__BACKEND_PRECIPITATION_SERVICE_DIAG__ = errorDetails;
      const covInfo = getProductCoverage(targetModel, 'weather', 'precipitation');
      updateProjectionDiag('weather', {
        activeModel: targetModel,
        activeLayer: 'precipitation',
        requestedViewportBounds: null,
        backendRequestBbox: null,
        responseGridBounds: null,
        coverageBounds: (covInfo && covInfo.coverage) ? covInfo.coverage : PILOT_COVERAGE,
        renderable: false,
        error: err.message,
        reason: err.message
      });
    }
    console.error(`[Backend Precipitation Service] Point fetch error: ${err.message}. Falling back cleanly.`);
    throw err;
  }
}
