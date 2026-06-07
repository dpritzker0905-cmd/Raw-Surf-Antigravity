/**
 * backendWeatherServiceClient.js
 * 
 * Dedicated client adapter for the Backend-Owned Weather Data Service.
 * Decouples the frontend controllers from feature flag checks, shared valid_time
 * computations, bounding box dynamic clamping, diagnostics telemetry updates,
 * and WebGL layer grid normalizations.
 */

import { BACKEND_URL } from '../../lib/apiClient';
import { BoundedPointCache } from './BoundedPointCache';
import { clampViewportBbox, getCachedManifest, setCachedManifest } from './backendWeatherServiceClientCoverage';
import { latestTimeDiag, updateDiagnostics, updateProjectionDiag } from './backendWeatherServiceClientDiag';
import { recordTruthStage } from './weatherTruthTracker';

export { BoundedPointCache };
export { getCachedManifest, setCachedManifest };
export const pointCache = new BoundedPointCache(50, 30000);

// Expose standard API base endpoints
export const STATUS_URL = `${BACKEND_URL}/api/weather/status`;
export const GRID_URL = `${BACKEND_URL}/api/weather/grid`;
export const POINT_URL = `${BACKEND_URL}/api/weather/point`;

if (typeof window !== 'undefined') {
  window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
  
  window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ = function() {
    const trace = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
    const reasons = [];
    let failedStage = "none";
    let nextPatchTarget = "none";

    // 1. Check backendResponse
    if (!trace.backendResponse) {
      failedStage = "backendResponse";
      reasons.push("Missing backendResponse trace data");
      nextPatchTarget = "fetchBackendMarineGrid";
    } else {
      const br = trace.backendResponse;
      if (br.product_id && br.product_id.includes("florida_east_coast")) {
        failedStage = "backendResponse";
        reasons.push("Backend product ID contains 'florida_east_coast': " + br.product_id);
        nextPatchTarget = "backend/routes/weather.py (route selector)";
      }
      if (br.is_dynamic_viewport_product !== true) {
        failedStage = "backendResponse";
        reasons.push("Backend is_dynamic_viewport_product is not true");
        nextPatchTarget = "backend/routes/weather.py";
      }
      if (br.coverage_scope !== "viewport" && br.coverage_scope !== "global_coarse") {
        failedStage = "backendResponse";
        reasons.push("Backend coverage_scope is '" + br.coverage_scope + "', expected 'viewport' or 'global_coarse'");
        nextPatchTarget = "backend/routes/weather.py";
      }
      if (br.nonzeroSpeedCount === 0) {
        failedStage = "backendResponse";
        reasons.push("Backend nonzero speed count is 0");
        nextPatchTarget = "backend weather ingestion / Open-Meteo API";
      }
    }

    // 2. Check mappedGrid
    if (failedStage === "none") {
      if (!trace.mappedGrid) {
        failedStage = "mappedGrid";
        reasons.push("Missing mappedGrid trace data");
        nextPatchTarget = "mapNormalizedGridToWebGL";
      } else {
        const mg = trace.mappedGrid;
        if (mg.rootFlatSpeedNonzeroCount === 0) {
          failedStage = "mappedGrid";
          reasons.push("Mapped root flat speed nonzero count is 0");
          nextPatchTarget = "mapNormalizedGridToWebGL";
        }
        if (mg.nestedWavesSpeedNonzeroCount === 0) {
          failedStage = "mappedGrid";
          reasons.push("Mapped nested waves speed nonzero count is 0");
          nextPatchTarget = "mapNormalizedGridToWebGL";
        }
      }
    }

    // 3. Check cacheCommit
    if (failedStage === "none") {
      if (!trace.cacheCommit) {
        failedStage = "cacheCommit";
        reasons.push("Missing cacheCommit trace data");
        nextPatchTarget = "useMarineOrchestrator.js";
      } else {
        const cc = trace.cacheCommit;
        const brProductId = trace.backendResponse?.product_id;
        if (cc.committedProductId !== brProductId) {
          failedStage = "cacheCommit";
          reasons.push("Committed product ID (" + cc.committedProductId + ") differs from backend product ID (" + brProductId + ")");
          nextPatchTarget = "useMarineOrchestrator.js / marineController.js";
        }
      }
    }

    // 4. Check webglTextureUpload
    if (failedStage === "none") {
      if (!trace.webglTextureUpload) {
        failedStage = "webglTextureUpload";
        reasons.push("Missing webglTextureUpload trace data");
        nextPatchTarget = "WebGLMarineLayer.js / WebGLMarineTextureEncoder.js";
      } else {
        const tu = trace.webglTextureUpload;
        const ccProductId = trace.cacheCommit?.committedProductId;
        if (tu.uploadProductId !== ccProductId) {
          failedStage = "webglTextureUpload";
          reasons.push("Uploaded product ID (" + tu.uploadProductId + ") differs from committed product ID (" + ccProductId + ")");
          nextPatchTarget = "WebGLMarineLayer.js";
        }
        if (tu.encodedTextureMax <= tu.encodedTextureMin) {
          failedStage = "webglTextureUpload";
          reasons.push("Encoded texture max (" + tu.encodedTextureMax + ") is <= min (" + tu.encodedTextureMin + ")");
          nextPatchTarget = "WebGLMarineTextureEncoder.js";
        }
        if (tu.encodedNonzeroPixelCount === 0) {
          failedStage = "webglTextureUpload";
          reasons.push("Encoded nonzero pixel count is 0");
          nextPatchTarget = "WebGLMarineTextureEncoder.js";
        }
        if (tu.maskValidOceanCount === 0) {
          failedStage = "webglTextureUpload";
          reasons.push("Mask valid ocean count is 0");
          nextPatchTarget = "WebGLMarineTextureEncoder.js / renderMaskToCanvas";
        }
        if (tu.renderDecision !== "render") {
          failedStage = "webglTextureUpload";
          reasons.push("Render decision is '" + tu.renderDecision + "', expected 'render'");
          nextPatchTarget = "WebGLMarineLayer.js";
        }
      }
    }

    // 6. Check exactPoint
    if (failedStage === "none") {
      if (trace.exactPoint) {
        const ep = trace.exactPoint;
        const tuProductId = trace.webglTextureUpload?.uploadProductId;
        if (!ep.pointRequestUrl || !ep.pointRequestUrl.includes("grid_product_id=")) {
          failedStage = "exactPoint";
          reasons.push("Exact point request URL lacks 'grid_product_id': " + ep.pointRequestUrl);
          nextPatchTarget = "backendWeatherServiceClient.js (fetchBackendExactPoint)";
        }
        if (ep.pointProductId !== tuProductId) {
          failedStage = "exactPoint";
          reasons.push("Point product ID (" + ep.pointProductId + ") differs from uploaded product ID (" + tuProductId + ")");
          nextPatchTarget = "backend/services/weather_pipeline/point_resolution.py";
        }
        const epTime = ep.pointValidTime ? new Date(ep.pointValidTime).toISOString() : "";
        const ccTime = trace.cacheCommit?.committedValidTime ? new Date(trace.cacheCommit.committedValidTime).toISOString() : "";
        if (epTime !== ccTime) {
          failedStage = "exactPoint";
          reasons.push("Point valid_time (" + epTime + ") differs from grid valid_time (" + ccTime + ")");
          nextPatchTarget = "backend/services/weather_pipeline/point_resolution.py / backendWeatherServiceClient.js";
        }
      }
    }

    trace.verdict = {
      status: reasons.length === 0 ? "PASS" : "BLOCKED",
      failedStage,
      failReasons: reasons,
      nextPatchTarget
    };
  };
}

/**
 * Fetches the products manifest from the backend registry.
 * Forces refetch if cachedManifest is empty to support dynamic ingestion updates.
 */
let manifestFetchPromise = null;

export async function fetchProductsManifest(forceRefresh = false) {
  const cached = getCachedManifest();
  const isEmpty = cached && Array.isArray(cached.products) && cached.products.length === 0;
  if (cached && !forceRefresh && !isEmpty) return cached;
  if (manifestFetchPromise && !forceRefresh) return manifestFetchPromise;

  manifestFetchPromise = (async () => {
    try {
      const res = await fetch(STATUS_URL.replace('/status', '/products'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCachedManifest(data);
      return data;
    } catch (err) {
      console.warn("[Backend Weather Service] Failed to fetch products manifest:", err.message);
      return null;
    } finally {
      manifestFetchPromise = null;
    }
  })();

  return manifestFetchPromise;
}

/**
 * Resolves the master backend marine weather system feature flag.
 * Enabled by default. Can be overridden in console or localStorage.
 */
export function getBackendMarineSystemFlag() {
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_MARINE_SYSTEM__ !== undefined) {
    return !!window.__USE_BACKEND_MARINE_SYSTEM__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_MARINE_SYSTEM__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_MARINE_SYSTEM !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_MARINE_SYSTEM === 'true';
  }
  return true;
}

/**
 * Resolves the weather service feature flag.
 * Defaults to true under active master flag. Can be overridden in console or localStorage.
 */
export function getBackendWeatherFlag() {
  if (!getBackendMarineSystemFlag()) return false;
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_WEATHER_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_WEATHER_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_WEATHER_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_WEATHER !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_WEATHER === 'true';
  }
  return true;
}

/**
 * Resolves the backend wind service feature flag.
 * Keeps its legacy behavior (disabled by default) untouched.
 */
export function getBackendWindFlag() {
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_WIND_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_WIND_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_WIND_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_WIND !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_WIND === 'true';
  }
  return true;
}

/**
 * Resolves the backend Copernicus service feature flag.
 * Defaults to true under active master flag.
 */
export function getBackendCopernicusFlag() {
  if (!getBackendMarineSystemFlag()) return false;
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_COPERNICUS_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_COPERNICUS_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_COPERNICUS_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_COPERNICUS !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_COPERNICUS === 'true';
  }
  return true;
}

/**
 * Resolves the backend ICON service feature flag.
 * Defaults to true under active master flag.
 */
export function getBackendIconMarineFlag() {
  if (!getBackendMarineSystemFlag()) return false;
  if (typeof window === 'undefined') return true;
  if (window.__USE_BACKEND_ICON_MARINE_SERVICE__ !== undefined) {
    return !!window.__USE_BACKEND_ICON_MARINE_SERVICE__;
  }
  try {
    const lsVal = window.localStorage.getItem('__USE_BACKEND_ICON_MARINE_SERVICE__');
    if (lsVal !== null) return lsVal === 'true';
  } catch (e) {}
  if (process.env.REACT_APP_USE_BACKEND_ICON_MARINE !== undefined) {
    return process.env.REACT_APP_USE_BACKEND_ICON_MARINE === 'true';
  }
  return true;
}

/**
 * Computes a standardized snapped UTC ISO string from hourOffset.
 * Resolves the nearest valid_time from cachedManifest when available (max 3h delta).
 * Provides the single source of authority for matching grid/point time dimensions.
 */
export function getSharedValidTime(timeOffsetHours, layer = 'waves', modelName = 'GFS') {
  const baseTime = (typeof window !== 'undefined' && window.__MOCK_DATE_NOW__) || Date.now();
  const roundedNow = Math.round(baseTime / 3600000) * 3600000;
  const targetDt = new Date(roundedNow + timeOffsetHours * 3600000);
  const requestedValidTime = targetDt.toISOString();

  let selectedManifestValidTime = null;
  let manifestDeltaHours = null;
  let fallbackReason = null;

  const filterLayer = (layer || 'waves').toLowerCase();
  const filterDomain = filterLayer === 'wind' ? 'wind' : 'marine';
  const filterModel = (modelName || 'GFS').toUpperCase();

  const manifest = getCachedManifest();
  const hasEmptyProducts = manifest && Array.isArray(manifest.products) && manifest.products.length === 0;

  if (manifest && Array.isArray(manifest.products) && !hasEmptyProducts) {
    const matchingProducts = manifest.products.filter(p => 
      p.model.toUpperCase() === filterModel &&
      p.domain.toLowerCase() === filterDomain &&
      p.layer.toLowerCase() === filterLayer
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

      // Snapped to products within a max 3h delta window
      if (minDiffMs <= 3 * 3600000 && bestProduct) {
        selectedManifestValidTime = new Date(bestProduct.valid_time_start).toISOString();
        manifestDeltaHours = minDiffMs / 3600000;
      } else {
        fallbackReason = `No ${filterModel} ${filterLayer} product within 3 hours delta limit (${(minDiffMs / 3600000).toFixed(1)}h delta)`;
      }
    } else {
      fallbackReason = `No ${filterModel} products found matching ${filterModel} model/${filterDomain} domain/${filterLayer} layer`;
    }
  } else {
    fallbackReason = "Manifest is not yet loaded, empty, or invalid; using snapped target valid time as fallback";
    // Prefetch or refresh manifest in background
    fetchProductsManifest(true).catch(() => {});
  }

  const cacheDiagKey = `${filterModel}_${filterLayer}`;
  latestTimeDiag[cacheDiagKey] = {
    requestedValidTime,
    selectedManifestValidTime,
    manifestDeltaHours,
    fallbackReason
  };

  return selectedManifestValidTime || requestedValidTime;
}

/**
 * Maps the standard backend grid response schema to the WebGLMarineLayer expectations.
 * Computes grid renderability checks (all-zero and empty vectors rejection).
 */
export function mapNormalizedGridToWebGL(json, snappedBounds, hourOffset, layer = 'waves', model = 'GFS') {
  if (!json || !json.grid || !Array.isArray(json.grid.vectors)) {
    throw new Error("Invalid normalized grid response structure");
  }

  const zeroVec = { u: 0, v: 0, speed: 0, period: 0, height: 0, direction: 0, isOcean: false };
  const mappedVectors = json.grid.vectors.map(v => {
    const u = v.u || 0;
    const v_val = v.v || 0;
    const speed = v.speed || 0;
    const period = v.period || 0;
    const height = v.height !== undefined ? v.height : speed;
    const direction = v.direction !== undefined ? v.direction : ((Math.atan2(-u, -v_val) * 180 / Math.PI + 360) % 360);
    const isOcean = v.is_valid !== false;

    const componentUV = { u, v: v_val, speed, period, height, direction, isOcean };

    return {
      lat: v.lat,
      lng: v.lng,
      u,
      v: v_val,
      speed,
      period,
      height,
      direction,
      isOcean,
      waves: layer === 'waves' ? componentUV : zeroVec,
      swell_1: layer === 'swell_1' ? componentUV : zeroVec,
      swell_2: layer === 'swell_2' ? componentUV : zeroVec,
      wind_waves: layer === 'wind_waves' ? componentUV : zeroVec
    };
  });

  const nonzeroCount = mappedVectors.filter(v => v[layer].speed > 0).length;
  const maxSpeed = mappedVectors.length > 0 ? Math.max(...mappedVectors.map(v => v[layer].speed), 0) : 0;
  
  // A grid is renderable only if it has vectors and at least one non-zero speed vector
  const renderable = mappedVectors.length > 0 && nonzeroCount > 0;

  if (!renderable) {
    console.warn(`[Backend Weather Service] Grid is not renderable. mappedVectors=${mappedVectors.length}, nonzeroCount=${nonzeroCount}`);
  }

  const result = {
    type: 'FeatureCollection',
    features: [],
    hourOffset,
    grid: {
      vectors: mappedVectors,
      bounds: json.grid.bounds || snappedBounds,
      cols: json.grid.cols,
      rows: json.grid.rows,
      timestamp: Date.now(),
      __sourceModel: model,
      __provider: json.provider || 'backend-weather-service',
      __gridProvider: json.provider || 'backend-weather-service',
      __componentLayer: layer,
      __gridSupportsLayer: renderable,
      __activeLayerNonzeroCount: nonzeroCount,
      __activeLayerMax: maxSpeed,
      __oceanMaskCount: mappedVectors.length,
      __renderable: renderable,
      provider: json.provider || 'backend-weather-service',
      hourOffset,
      nonzeroCount,
      maxSpeed,
      renderable,
      emptyGridWarning: !renderable ? "All vectors in grid are zero or null, or grid is empty" : null,
      productId: json.product_id || null,
      coverage_scope: json.coverage_scope || null,
      is_estimated: json.is_estimated !== undefined ? json.is_estimated : false,
      estimate_basis: json.estimate_basis || null,
      is_dynamic_viewport_product: json.is_dynamic_viewport_product || false,
      validTime: json.valid_time || null,
      valid_time: json.valid_time || null,
      truthTag: json.truthTag || null
    },
    validTime: json.valid_time || null,
    valid_time: json.valid_time || null,
    truthTag: json.truthTag || null
  };

  if (typeof window !== 'undefined' && model === 'GFS' && layer === 'waves' && hourOffset === 0) {
    recordTruthStage('mappedGrid', {
      model,
      domain: 'marine',
      layer,
      valid_time: result.valid_time,
      run_time: json.run_time,
      product_id: result.grid.productId,
      is_dynamic_viewport_product: result.grid.is_dynamic_viewport_product,
      coverage_scope: result.grid.coverage_scope,
      requested_bbox: json.requested_bbox,
      served_bbox: json.served_bbox,
      grid: result.grid,
      truthTag: json.truthTag
    }, 'backendWeatherServiceClient.js', 'mapNormalizedGridToWebGL');

    window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
    const rootFlatSpeedNonzeroCount = mappedVectors.filter(v => v.speed > 0).length;
    const nestedWavesSpeedNonzeroCount = mappedVectors.filter(v => v.waves && v.waves.speed > 0).length;
    const rootFlatMaxSpeed = mappedVectors.length > 0 ? Math.max(...mappedVectors.map(v => v.speed)) : 0;
    const nestedWavesMaxSpeed = mappedVectors.length > 0 ? Math.max(...mappedVectors.map(v => v.waves ? v.waves.speed : 0)) : 0;
    const sampleMapped = mappedVectors.filter(v => v.speed > 0).slice(0, 5).map(v => ({
      root: {
        speed: v.speed,
        u: v.u,
        v: v.v,
        period: v.period,
        isOcean: v.isOcean
      },
      waves: {
        speed: v.waves ? v.waves.speed : null,
        u: v.waves ? v.waves.u : null,
        v: v.waves ? v.waves.v : null,
        period: v.waves ? v.waves.period : null
      }
    }));
    window.__GFS_WAVES_SINGLE_SLICE_TRACE__.mappedGrid = {
      gridProductId: json.product_id || null,
      bounds: json.grid?.bounds || snappedBounds,
      cols: json.grid?.cols,
      rows: json.grid?.rows,
      vectorsLength: mappedVectors.length,
      activeLayer: layer,
      rootFlatSpeedNonzeroCount,
      nestedWavesSpeedNonzeroCount,
      rootFlatMaxSpeed,
      nestedWavesMaxSpeed,
      sampleMappedVectors: sampleMapped
    };
    if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
      window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
    }
  }

  return result;
}

/**
 * Fetches exact point forecast from backend weather service.
 */
export async function fetchBackendExactPoint(lat, lng, hourOffset, signal, layer = 'waves', model = 'GFS') {
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

  let gridProductId = null;
  if (typeof window !== 'undefined') {
    const diag = window.__MARINE_PROJECTION_DIAG__;
    if (diag && diag.activeLayer === layer && diag.activeModel === model) {
      gridProductId = diag.productId || diag.gridProductId || null;
    }
  }

  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, layer, model);
  const provider = model === 'EURO' ? 'copernicus' : 'open-meteo';
  let cacheKey = `${model}_marine_${layer}_${lat.toFixed(2)}_${lng.toFixed(2)}_${validTimeStr}_${provider}`;
  if (gridProductId) {
    cacheKey += `_grid_${gridProductId}`;
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
      wave_height: [0],
      wave_direction: [0],
      wave_period: [0],
      wave_peak_period: [0],
      swell_wave_height: [0],
      swell_wave_direction: [0],
      swell_wave_period: [0],
      swell_wave_peak_period: [0],
      secondary_swell_wave_height: [0],
      secondary_swell_wave_direction: [0],
      secondary_swell_wave_period: [0],
      wind_wave_height: [0],
      wind_wave_direction: [0],
      wind_wave_period: [0],
      wind_wave_peak_period: [0]
    };

    if (layer === 'waves') {
      conformedHourly.wave_height = [json.point.speed || 0];
      conformedHourly.wave_direction = [json.point.direction || 0];
      conformedHourly.wave_period = [json.point.period || 0];
      conformedHourly.wave_peak_period = [0];
    } else if (layer === 'swell_1') {
      conformedHourly.swell_wave_height = [json.point.speed || 0];
      conformedHourly.swell_wave_direction = [json.point.direction || 0];
      conformedHourly.swell_wave_period = [json.point.period || 0];
      conformedHourly.swell_wave_peak_period = [0];
    } else if (layer === 'swell_2') {
      conformedHourly.secondary_swell_wave_height = [json.point.speed || 0];
      conformedHourly.secondary_swell_wave_direction = [json.point.direction || 0];
      conformedHourly.secondary_swell_wave_period = [json.point.period || 0];
    } else if (layer === 'wind_waves') {
      conformedHourly.wind_wave_height = [json.point.speed || 0];
      conformedHourly.wind_wave_direction = [json.point.direction || 0];
      conformedHourly.wind_wave_period = [json.point.period || 0];
      conformedHourly.wind_wave_peak_period = [0];
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
      status: json.status || json.coverage_status || 'exact_success'
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
    console.error(`[Backend Weather Service] Point fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    throw err;
  }
}

/**
 * Fetches marine conformed forecast grid from backend weather service.
 */
export async function fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, layer = 'waves', model = 'GFS') {
  if (model === 'ICON' && layer === 'swell_2') {
    updateProjectionDiag('marine', {
      activeModel: 'ICON',
      activeLayer: 'swell_2',
      requestedViewportBounds: bounds || snappedBounds,
      renderable: false,
      renderDecision: 'unsupported',
      reason: 'unsupported_model_layer',
      timeOffsetHours: hourOffset
    });
    return {
      type: 'FeatureCollection',
      features: [],
      hourOffset,
      grid: {
        vectors: [],
        bounds: snappedBounds || { west: -180, south: -80, east: 180, north: 85 },
        cols: 0,
        rows: 0,
        timestamp: Date.now(),
        __sourceModel: 'ICON',
        __provider: 'none',
        __gridProvider: 'none',
        __componentLayer: 'swell_2',
        __gridSupportsLayer: false,
        __activeLayerNonzeroCount: 0,
        __activeLayerMax: 0,
        __oceanMaskCount: 0,
        __renderable: false,
        __unsupportedLayer: true,
        provider: 'none',
        hourOffset,
        nonzeroCount: 0,
        maxSpeed: 0,
        renderable: false,
        status: 'unsupported'
      },
      __renderable: false,
      __unsupportedLayer: true,
      status: 'unsupported'
    };
  }

  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, layer, model);

  let actualBounds = bounds;
  if (!actualBounds || (Math.abs((actualBounds.east || 0) - (actualBounds.west || 0)) > 300)) {
    try {
      if (typeof window !== 'undefined' && window.map && typeof window.map.getBounds === 'function') {
        const mb = window.map.getBounds();
        actualBounds = {
          west: mb.getWest(),
          south: mb.getSouth(),
          east: mb.getEast(),
          north: mb.getNorth()
        };
      }
    } catch (e) {}
  }

  const clampResult = clampViewportBbox(actualBounds || snappedBounds, layer, model, 'marine');
  if (!clampResult.isInside) {
    const errorDetails = {
      url: 'none',
      status: 0,
      validTime: validTimeStr,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: clampResult.fallbackReason,
      requestedBbox: actualBounds || snappedBounds,
      clampedBbox: null,
      fallbackReason: clampResult.fallbackReason,
      hourOffset,
      coverageInside: false,
      layer
    };
    updateDiagnostics('grid', errorDetails, model);

    updateProjectionDiag('marine', {
      activeModel: model,
      activeLayer: layer,
      requestedViewportBounds: actualBounds || snappedBounds,
      backendRequestBbox: null,
      responseGridBounds: null,
      coverageBounds: clampResult.coverageBounds,
      renderable: false,
      error: clampResult.fallbackReason,
      reason: clampResult.fallbackReason,
      timeOffsetHours: hourOffset
    });

    throw new Error(clampResult.fallbackReason);
  }

  const { clampedBbox } = clampResult;
  const bboxParam = `${clampedBbox.west},${clampedBbox.south},${clampedBbox.east},${clampedBbox.north}`;
  const url = `${GRID_URL}?model=${model}&domain=marine&layer=${layer}&valid_time=${validTimeStr}&bbox=${bboxParam}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      let reason = `Backend grid returned HTTP ${res.status}`;
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

    if (typeof window !== 'undefined' && model === 'GFS' && layer === 'waves' && hourOffset === 0) {
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
      const vectors = json.grid && Array.isArray(json.grid.vectors) ? json.grid.vectors : [];
      const nonzero = vectors.filter(v => (v.speed || 0) > 0);
      const minS = vectors.length > 0 ? Math.min(...vectors.map(v => v.speed || 0)) : 0;
      const maxS = vectors.length > 0 ? Math.max(...vectors.map(v => v.speed || 0)) : 0;
      const samples = nonzero.slice(0, 5).map(v => ({
        lat: v.lat,
        lng: v.lng,
        speed: v.speed,
        u: v.u,
        v: v.v,
        period: v.period,
        is_valid: v.is_valid !== false
      }));
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__.backendResponse = {
        product_id: json.product_id || null,
        valid_time: json.valid_time || null,
        requested_bbox: json.requested_bbox || bboxParam,
        served_bbox: json.served_bbox || null,
        is_dynamic_viewport_product: json.is_dynamic_viewport_product === true,
        coverage_scope: json.coverage_scope || null,
        vectorCount: vectors.length,
        nonzeroSpeedCount: nonzero.length,
        minSpeed: minS,
        maxSpeed: maxS,
        sampleVectors: samples
      };
      if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
        window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
      }
    }

    const result = mapNormalizedGridToWebGL(json, clampedBbox, hourOffset, layer, model);

    updateDiagnostics('grid', {
      url,
      status: res.status,
      validTime: validTimeStr,
      valueKind: json.value_kind || (layer === 'swell_1' ? 'swell_wave_height' : 'wave_height'),
      valueUnit: json.value_unit || 'm',
      displayUnitHint: json.display_unit_hint || 'ft',
      elapsedMs: Date.now() - start,
      error: null,
      requestedBbox: snappedBounds,
      clampedBbox,
      fallbackReason: null,
      hourOffset,
      layer,
      gridVectorCount: result.grid.vectors.length,
      nonzeroCount: result.grid.nonzeroCount,
      renderable: result.grid.renderable,
      provider: json.provider,
      sourceDataset: json.source_dataset,
      sourceVariables: json.source_variables,
      is_forecast_authoritative: json.is_forecast_authoritative,
      is_estimated: json.is_estimated,
      is_test_fixture: json.is_test_fixture,
      gridMode: json.grid?.diagnostics?.gridMode || 'rectangular',
      productId: json.product_id || null
    }, model);

    const vectors = result.grid.vectors;
    const firstVector = vectors && vectors[0] ? { lat: vectors[0].lat, lng: vectors[0].lng } : null;
    const lastVector = vectors && vectors.length > 0 ? { lat: vectors[vectors.length - 1].lat, lng: vectors[vectors.length - 1].lng } : null;

    updateProjectionDiag('marine', {
      activeModel: model,
      activeLayer: layer,
      requestedViewportBounds: actualBounds || snappedBounds,
      backendRequestBbox: bboxParam,
      responseGridBounds: result.grid.bounds,
      coverageBounds: clampResult.coverageBounds,
      cols: result.grid.cols,
      rows: result.grid.rows,
      vectorCount: vectors ? vectors.length : 0,
      nonzeroCount: result.grid.nonzeroCount,
      timeOffsetHours: hourOffset,
      requestedValidTime: getSharedValidTime(hourOffset, layer, model),
      validTime: getSharedValidTime(hourOffset, layer, model),
      firstVectorLatLng: firstVector,
      lastVectorLatLng: lastVector,
      productId: json.product_id,
      provider: json.provider,
      renderable: result.grid.renderable,
      clampedBbox,
      selectedTileId: clampResult.selectedTileId,
      rejectedTileIds: clampResult.rejectedTileIds,
      regionId: json.region_id || clampResult.selectedTileId,
      tileId: json.tile_id || clampResult.selectedTileId,
      validTime: validTimeStr,
      isEstimated: json.is_estimated,
      estimateBasis: json.estimate_basis,
      timeOffsetHours: hourOffset,
      coverage_scope: json.coverage_scope || null,
      is_dynamic_viewport_product: json.is_dynamic_viewport_product || false,
      requested_bbox: json.requested_bbox || null,
      served_bbox: json.served_bbox || null,
      cache_key: json.cache_key || null,
      resolution: json.resolution || null,
      coordinate_count: json.coordinate_count || null
    });

    return result;
  } catch (err) {
    const errorDetails = {
      url,
      status: err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500,
      validTime: validTimeStr,
      valueKind: 'none',
      valueUnit: 'none',
      displayUnitHint: 'none',
      elapsedMs: Date.now() - start,
      error: err.message,
      requestedBbox: snappedBounds,
      clampedBbox,
      fallbackReason: err.message,
      hourOffset,
      layer,
      provider: 'backend-weather-service',
      sourceDataset: null,
      sourceVariables: null,
      is_forecast_authoritative: false,
      is_estimated: false,
      is_test_fixture: false
    };
    updateDiagnostics('grid', errorDetails, model);

    updateProjectionDiag('marine', {
      activeModel: model,
      activeLayer: layer,
      requestedViewportBounds: actualBounds || snappedBounds,
      backendRequestBbox: bboxParam,
      responseGridBounds: null,
      coverageBounds: clampResult.coverageBounds,
      renderable: false,
      error: err.message,
      reason: err.message,
      clampedBbox,
      selectedTileId: clampResult.selectedTileId,
      rejectedTileIds: clampResult.rejectedTileIds,
      regionId: clampResult.selectedTileId,
      tileId: clampResult.selectedTileId,
      validTime: validTimeStr,
      timeOffsetHours: hourOffset
    });

    console.error(`[Backend Weather Service] Grid fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
    throw err;
  }
}

export * from './backendWindServiceClient';
export * from './backendCopernicusServiceClient';
export { PILOT_COVERAGE, REGIONAL_TILES, getAvailableTilesFromManifest, getProductCoverage, clampViewportBbox } from './backendWeatherServiceClientCoverage';
export { latestTimeDiag, updateProjectionDiag, updateDiagnostics } from './backendWeatherServiceClientDiag';
