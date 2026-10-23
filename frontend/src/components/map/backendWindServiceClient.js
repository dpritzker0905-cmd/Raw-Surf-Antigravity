/**
 * backendWindServiceClient.js
 * 
 * Dedicated client adapter for wind forecast layers.
 */


import {
  GRID_URL,
  POINT_URL,
  getSharedValidTime,
  clampViewportBbox,
  getBackendWindFlag,
  latestTimeDiag,
  updateProjectionDiag,
  PILOT_COVERAGE,
  fetchProductsManifest
} from './backendWeatherServiceClient';
import { pointRequestIdentityEnabled, createPointRequestContext } from './pointRequestIdentity';
import { BoundedPointCache } from './BoundedPointCache';
import { recordTruthStage } from './weatherTruthTracker';
import { windLaneParam, windLaneDisabled } from './windLane';
// STATIC WIND FRAMES (2026-10-22, the wind instant scrub): world and mid-zoom boxes from the CDN (windStaticFrames.js).
import { tryStaticWindGrid, staticWindGridSync, windBoxKind, windStaticEnabled } from './windStaticFrames';

export const windPointCache = new BoundedPointCache(50, 30000);

const inFlightWindRequests = new Map();
const inFlightWindPointRequests = new Map();

/**
 * Maps the standard backend wind grid response schema to the WebGLWindEngine expectations.
 * Computes grid renderability checks (all-zero and empty vectors rejection).
 */
export function mapNormalizedWindGridToWebGL(json, snappedBounds, hourOffset) {
  if (!json || !json.grid || !Array.isArray(json.grid.vectors)) {
    throw new Error("Invalid normalized wind grid response structure");
  }

  const mappedVectors = json.grid.vectors.map(v => ({
    lat: v.lat,
    lng: v.lng,
    speed: v.speed || 0,
    direction: v.direction || 0,
    u: v.u || 0,
    v: v.v || 0
  }));

  const nonzeroCount = mappedVectors.filter(v => v.speed > 0).length;
  const renderable = mappedVectors.length > 0 && nonzeroCount > 0;

  if (!renderable) {
    console.warn(`[Backend Weather Service] Wind grid is not renderable. mappedVectors=${mappedVectors.length}, nonzeroCount=${nonzeroCount}`);
  }

  const result = {
    vectors: mappedVectors,
    bounds: json.grid.bounds || snappedBounds,
    cols: json.grid.cols,
    rows: json.grid.rows,
    // 2026-07-19: this was hardcoded `false`, ERASING the backend's stale flag. Harmless in the
    // always-global era (every response was the same product, stale or not) — but with the
    // viewport-fine tier a rate-limited upstream answers a FINE request with the stale GLOBAL
    // 10-deg product, and with the flag erased that coarse fallback passed isRenderableWindData
    // and REPLACED a good fine grid on screen (the zoom/pan "clearing" report). The flag is the
    // contract: WeatherEngine retains the previous frame instead of committing a stale grid over
    // it, and windController's stale-aware cache TTL (2 min) finally has something to key on.
    stale: !!json.stale,
    staleReason: json.staleReason || json.fallbackReason || null,
    source: json.model || 'GFS',
    hourOffset,
    provider: json.provider || 'backend-weather-service',
    nonzeroCount,
    renderable,
    // Preserved metadata fields
    truthTag: json.truthTag || null,
    productId: json.product_id || null,
    product_id: json.product_id || null,
    is_dynamic_viewport_product: json.is_dynamic_viewport_product || false,
    coverage_scope: json.coverage_scope || null,
    requested_bbox: json.requested_bbox || null,
    served_bbox: json.served_bbox || null,
    run_time: json.run_time || null,
    // The model CYCLE (run_time is the legacy ingest stamp, one per built box): windTierMosaic.js merges two boxes of one cycle only.
    model_run_time: json.model_run_time || null, model_run_time_status: json.model_run_time_status || null,
    // The frame really served (valid_time echoes the asked hour; grid_resolver.stamp_frame_honesty).
    served_valid_time: json.served_valid_time || null, frame_substituted: !!json.frame_substituted,
    valid_time: json.valid_time || null,
    // Which model the backend's wind lane put at this hour (HRRR near the US / GFS; windLane.js, D-017).
    wind_lane: json.wind_lane || null
  };

  if (typeof window !== 'undefined' && hourOffset === 0) {
    recordTruthStage('mappedGrid', {
      model: json.model || 'GFS',
      domain: 'wind',
      layer: 'wind',
      valid_time: json.valid_time,
      run_time: json.run_time,
      product_id: json.product_id,
      is_dynamic_viewport_product: json.is_dynamic_viewport_product,
      coverage_scope: json.coverage_scope,
      requested_bbox: json.requested_bbox,
      served_bbox: json.served_bbox,
      grid: json.grid,
      truthTag: json.truthTag
    }, 'backendWindServiceClient.js', 'mapNormalizedWindGridToWebGL');
  }

  return result;
}

// Wind Diagnostics Telemetry Initializer
if (typeof window !== 'undefined') {
  window.__BACKEND_WIND_SERVICE_DIAG__ = window.__BACKEND_WIND_SERVICE_DIAG__ || {
    featureFlagActive: getBackendWindFlag(),
    selectedManifestValidTime: null,
    requestedValidTime: null,
    manifestDeltaHours: null,
    fallbackReason: null,
    timeFallbackReason: null,
    pointParity: 'pending_point_fetch',
    requestedBbox: null,
    clampedBbox: null,
    coverageInside: true,
    fallbackToLegacy: false,
    gridVectorCount: null,
    nonzeroCount: null,
    provider: 'backend-weather-service',
    model: 'GFS',
    activeModel: 'GFS',
    layer: 'wind',
    lastGridFetch: null,
    lastPointFetch: null,
    renderable: false,
    gridValidTime: null,
    pointValidTime: null,
    boundsSource: 'controller'
  };
}

/**
 * Updates the global wind diagnostics telemetry registry.
 */
export function updateWindDiagnostics(type, details) {
  if (typeof window === 'undefined') return;

  if (!window.__BACKEND_WIND_SERVICE_DIAG__) {
    window.__BACKEND_WIND_SERVICE_DIAG__ = {
      featureFlagActive: getBackendWindFlag(),
      selectedManifestValidTime: null,
      requestedValidTime: null,
      manifestDeltaHours: null,
      fallbackReason: null,
      timeFallbackReason: null,
      pointParity: 'pending_point_fetch',
      requestedBbox: null,
      clampedBbox: null,
      coverageInside: true,
      fallbackToLegacy: false,
      gridVectorCount: null,
      nonzeroCount: null,
      provider: 'backend-weather-service',
      model: 'GFS',
      activeModel: 'GFS',
      layer: 'wind',
      lastGridFetch: null,
      lastPointFetch: null,
      renderable: false,
      gridValidTime: null,
      pointValidTime: null,
      boundsSource: 'controller'
    };
  }

  const diag = window.__BACKEND_WIND_SERVICE_DIAG__;
  diag.featureFlagActive = getBackendWindFlag();

  const currentModel = details.model || diag.model || 'GFS';
  diag.model = currentModel;
  diag.activeModel = currentModel;

  if (type === 'grid') {
    diag.lastGridFetch = details;
    diag.gridValidTime = details.validTime || null;
    diag.requestedBbox = details.requestedBbox;
    diag.clampedBbox = details.clampedBbox;
    diag.gridVectorCount = details.gridVectorCount || null;
    diag.nonzeroCount = details.nonzeroCount || null;
    diag.renderable = details.renderable || false;
    diag.boundsSource = details.boundsSource || diag.boundsSource || 'controller';

    const isInside = details.coverageInside !== undefined 
      ? details.coverageInside 
      : (details.clampedBbox !== null && !details.error?.includes('outside'));
      
    diag.coverageInside = isInside;
    diag.fallbackToLegacy = !isInside || !!details.error;
    diag.fallbackReason = details.error || null;
    diag.provider = details.provider || diag.provider;
    diag.productId = details.productId || null;
    diag.gridProductId = details.productId || null;
  } else if (type === 'point') {
    diag.lastPointFetch = details;
    diag.pointValidTime = details.validTime || null;
    diag.provider = details.provider || diag.provider;
    diag.productId = details.productId || null;
    diag.pointProductId = details.productId || null;
    diag.is_estimated = details.is_estimated !== undefined ? details.is_estimated : false;
    diag.is_forecast_authoritative = details.is_forecast_authoritative !== undefined ? details.is_forecast_authoritative : true;
    diag.estimate_basis = details.estimate_basis || details.estimateBasis || null;
    diag.estimateBasis = details.estimate_basis || details.estimateBasis || null;

    if (typeof window !== 'undefined' && window.__FORECAST_TIMELINE_COVERAGE_DIAG__) {
      window.__FORECAST_TIMELINE_COVERAGE_DIAG__.pointProductId = details.productId || null;
      if (details.is_estimated !== undefined) {
        window.__FORECAST_TIMELINE_COVERAGE_DIAG__.isEstimated = !!details.is_estimated;
        window.__FORECAST_TIMELINE_COVERAGE_DIAG__.estimateSource = details.is_estimated ? "backend" : "none";
      }
      window.__FORECAST_TIMELINE_COVERAGE_DIAG__.estimateBasis = details.estimate_basis || details.estimateBasis || null;
    }
  }

  if (details.hourOffset !== undefined) {
    getSharedValidTime(details.hourOffset, 'wind', currentModel);
  }

  const timeDiag = latestTimeDiag[`${currentModel}_wind`] || {};
  diag.requestedValidTime = timeDiag.requestedValidTime;
  diag.selectedManifestValidTime = timeDiag.selectedManifestValidTime;
  diag.manifestDeltaHours = timeDiag.manifestDeltaHours;
  diag.timeFallbackReason = timeDiag.fallbackReason;

  diag.pointParity = diag.pointValidTime 
    ? (diag.gridValidTime === diag.pointValidTime) 
    : 'pending_point_fetch';
}

/**
 * Fetches exact point forecast from backend weather service for wind.
 */
export async function fetchBackendExactWindPoint(lat, lng, hourOffset, signal, model = 'GFS', requestContext = null) {
  requestContext = pointRequestIdentityEnabled()
    ? requestContext || createPointRequestContext(model, 'wind', hourOffset) : null;
  let gridProductId = null;
  if (typeof window !== 'undefined') {
    const diag = window.__WIND_PROJECTION_DIAG__;
    if (diag && diag.activeLayer === 'wind' && diag.activeModel === model) {
      gridProductId = diag.productId || diag.gridProductId || null;
    }
  }

  const start = Date.now();
  if (requestContext) gridProductId = requestContext.gridProductId;
  const validTimeStr = requestContext?.validTime || getSharedValidTime(hourOffset, 'wind', model);
  const provider = model === 'EURO' ? 'copernicus' : 'open-meteo';
  let cacheKey = `${model}_wind_wind_${lat.toFixed(2)}_${lng.toFixed(2)}_${validTimeStr}_${provider}`;
  if (gridProductId) {
    cacheKey += `_grid_${gridProductId}`;
  }

  const cached = requestContext?.force ? null : windPointCache.get(cacheKey);
  if (cached) {
    console.log(`[Backend Weather Service] Cache hit for ${model} Wind: ${cacheKey}`);
    const clonedData = JSON.parse(JSON.stringify(cached.data));
    clonedData.source = 'cache';
    updateWindDiagnostics('point', { ...cached.details, source: 'cache' });
    return clonedData;
  }

  let url = `${POINT_URL}?model=${model}&domain=wind&layer=wind&lat=${lat}&lng=${lng}&valid_time=${validTimeStr}`;
  if (gridProductId) {
    url += `&grid_product_id=${encodeURIComponent(gridProductId)}`;
  }

  if (hourOffset === 0) {
    recordTruthStage('pointRequest', {
      model,
      domain: 'wind',
      layer: 'wind',
      valid_time: validTimeStr,
      grid_product_id: gridProductId,
      truthTag: window.__WEATHER_TRUTH_TRACE__?.stages?.find(s => s.stage === 'webglRender')?.truthTag
    }, 'backendWindServiceClient.js', 'fetchBackendExactWindPoint');
  }

  if (inFlightWindPointRequests.has(url)) {
    return inFlightWindPointRequests.get(url);
  }

  const promise = (async () => {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) {
        throw new Error(`Backend point returned HTTP ${res.status}`);
      }
      const json = await res.json();
      
      if (hourOffset === 0) {
        recordTruthStage('pointResponse', {
          model,
          domain: 'wind',
          layer: 'wind',
          valid_time: json.valid_time || validTimeStr,
          product_id: json.product_id,
          truthTag: json.truthTag
        }, 'backendWindServiceClient.js', 'fetchBackendExactWindPoint');
      }

      const mockTime = validTimeStr.replace(/\.\d+Z$/, 'Z');
      const data = {
        hourly: {
          time: [mockTime],
          wind_speed_10m: [json.point.speed || 0],
          wind_direction_10m: [json.point.direction || 0]
        },
        snappedLat: json.point.sampled_lat || lat,
        snappedLng: json.point.sampled_lng || lng,
        requestedLat: lat,
        requestedLng: lng,
        requestedModel: model,
        activeLayer: 'wind',
        forecastDays: 1,
        apiModel: model === 'ICON' ? 'dwd_icon' : (model === 'EURO' ? 'ecmwf_ifs' : 'gfs_seamless'),
        provider: json.provider || provider,
        source: 'network',
        status: json.status || json.coverage_status || 'exact_success',
        // Preserved metadata fields
        truthTag: json.truthTag || null,
        gridPointParity: json.gridPointParity || null,
        mismatchReason: json.mismatchReason || null,
        product_id: json.product_id || null,
        productId: json.product_id || null
      };

      const details = {
        url,
        status: res.status,
        validTime: validTimeStr,
        valueKind: json.value_kind || 'wind_speed',
        valueUnit: json.value_unit || 'kn',
        displayUnitHint: json.display_unit_hint || 'kn',
        elapsedMs: Date.now() - start,
        error: null,
        hourOffset,
        speed: json.point.speed || 0,
        direction: json.point.direction || 0,
        interpolationMethod: json.point.interpolation_method || 'bilinear',
        interpolation_method: json.point.interpolation_method || 'bilinear',
        provider: json.provider || provider,
        productId: json.product_id || null,
        pointProductId: json.product_id || null,
        is_estimated: json.is_estimated !== undefined ? json.is_estimated : false,
        estimate_basis: json.estimate_basis || null,
        estimateBasis: json.estimate_basis || null,
        source: json.source || 'network',
        is_dynamic_viewport_product: json.is_dynamic_viewport_product || false,
        coverage_scope: json.coverage_scope || null,
        requested_bbox: json.requested_bbox || null,
        served_bbox: json.served_bbox || null,
        resolution: json.resolution || null,
        coordinate_count: json.coordinate_count || null,
        cache_key: json.cache_key || null,
        cache_hit: json.cache_hit || null,
        model
      };

      windPointCache.set(cacheKey, { data, details });

      updateWindDiagnostics('point', details);

      return data;
    } catch (err) {
      const status = err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500;
      updateWindDiagnostics('point', {
        url,
        status,
        validTime: validTimeStr,
        valueKind: 'none',
        valueUnit: 'none',
        displayUnitHint: 'none',
        elapsedMs: Date.now() - start,
        error: err.message,
        hourOffset,
        speed: 0,
        direction: 0,
        interpolationMethod: 'none',
        interpolation_method: 'none',
        provider: 'none',
        model
      });
      console.error(`[Backend Weather Service] Wind point fetch error: ${err.message}. Falling back cleanly to standard proxy pipeline.`);
      throw err;
    } finally {
      inFlightWindPointRequests.delete(url);
    }
  })();

  inFlightWindPointRequests.set(url, promise);
  return promise;
}

/**
 * Fetches wind grid forecast from backend weather service.
 */
export async function fetchBackendWindGrid(bounds, hourOffset, signal, snappedBounds, boundsSource = "controller", model = 'GFS') {
  await fetchProductsManifest().catch(() => null);
  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, 'wind', model);

  let actualBounds = bounds;
  let actualSource = boundsSource;

  if (!actualBounds) {
    if (typeof window !== 'undefined' && window.map) {
      try {
        const b = window.map.getBounds();
        actualBounds = {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
        actualSource = "window_map";
      } catch (e) {
        actualBounds = snappedBounds || PILOT_COVERAGE;
        actualSource = "fallback";
      }
    } else {
      actualBounds = snappedBounds || PILOT_COVERAGE;
      actualSource = "fallback";
    }
  }

  const clampResult = clampViewportBbox(actualBounds, 'wind', model, 'wind');
  if (!clampResult.isInside) {
    const errorDetails = {
      url: 'none',
      status: 0,
      validTime: validTimeStr,
      elapsedMs: Date.now() - start,
      error: clampResult.fallbackReason,
      requestedBbox: actualBounds,
      clampedBbox: null,
      hourOffset,
      coverageInside: false,
      fallbackToLegacy: true,
      boundsSource: actualSource,
      model
    };
    updateWindDiagnostics('grid', errorDetails);

    updateProjectionDiag('wind', {
      activeModel: model,
      activeLayer: 'wind',
      requestedViewportBounds: actualBounds,
      backendRequestBbox: null,
      responseGridBounds: null,
      coverageBounds: clampResult.coverageBounds,
      renderable: false,
      error: clampResult.fallbackReason,
      reason: clampResult.fallbackReason,
      selectedTileId: clampResult.selectedTileId,
      rejectedTileIds: clampResult.rejectedTileIds,
      regionId: clampResult.selectedTileId,
      tileId: clampResult.selectedTileId,
      validTime: validTimeStr,
      timeOffsetHours: hourOffset
    });

    throw new Error(clampResult.fallbackReason);
  }

  const { clampedBbox } = clampResult;
  const bboxParam = `${clampedBbox.west},${clampedBbox.south},${clampedBbox.east},${clampedBbox.north}`;
  const url = `${GRID_URL}?model=${model}&domain=wind&layer=wind&valid_time=${validTimeStr}&bbox=${bboxParam}${windLaneParam()}`;

  // SEAM A (2026-10-22): a box /grid answers from the GFS wind world field (the world, or a mid-zoom clip over the 20-deg sharpen
  // cap) comes from the static frame the CDN holds, the same numbers parity-gated at publish (lane included). Any miss: /grid.
  // Never with the HRRR lane switched off for this session (wind_lane=gfs): the frames carry the lane.
  if (windStaticEnabled() && !windLaneDisabled() && windBoxKind(model, clampedBbox)) {
    const sj = await tryStaticWindGrid({ model, validTimeStr, clampedBbox, signal });
    if (sj) return staticWindResult(sj, { clampedBbox, hourOffset, model, actualBounds, actualSource, start, validTimeStr, clampResult });
  }

  const _inFlight = inFlightWindRequests.get(url);
  if (_inFlight) {
    // STRANDED-DEDUP GUARD (2026-07-20 — the marine stranded fetch-lock lesson, wind edition;
    // see marine-stranded-fetch-lock-wedge / releaseStaleMarineLock). The shared promise is
    // bound to its CREATOR's abort signal. WeatherEngine's retry loop aborts its previous
    // controller each attempt, so every later caller joined a corpse promise that rejects
    // instantly with "signal is aborted without reason" (live: attempt 6/5, 7/5 — the lane
    // starved itself while the backend was healthy). Serve the dedup ONLY while its creating
    // signal is alive; a provably-dead entry is dropped and refetched fresh.
    if (!(_inFlight.signal && _inFlight.signal.aborted)) {
      return _inFlight.promise;
    }
    inFlightWindRequests.delete(url);
  }
  let _entry;
  const promise = (async () => {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) {
        // Surface the backend's failure reason (e.g. the wind horizon gate's 404 `no_wind_coverage`)
        // so callers can tell a TERMINAL coverage miss from a transient 5xx — mirror of the marine
        // grid client's error shape. Falls back to the bare status when the body isn't JSON.
        let reason = `Backend returned HTTP ${res.status}`;
        try {
          const errorJson = await res.json();
          if (errorJson && errorJson.reason) {
            reason = errorJson.reason;
          } else if (errorJson && errorJson.detail) {
            reason = errorJson.detail;
          }
        } catch (e) { /* opaque error body — keep the bare status */ }
        throw new Error(reason);
      }
      const json = await res.json();
      if (typeof window !== 'undefined' && hourOffset === 0) {
        recordTruthStage('backendResponse', {
          model: json.model || model,
          domain: 'wind',
          layer: 'wind',
          valid_time: json.valid_time,
          run_time: json.run_time,
          product_id: json.product_id,
          is_dynamic_viewport_product: json.is_dynamic_viewport_product,
          coverage_scope: json.coverage_scope,
          requested_bbox: json.requested_bbox,
          served_bbox: json.served_bbox,
          grid: json.grid,
          truthTag: json.truthTag
        }, 'backendWindServiceClient.js', 'fetchBackendWindGrid');
      }
      const result = mapNormalizedWindGridToWebGL(json, clampedBbox, hourOffset);
      result.source = model;

      updateWindDiagnostics('grid', {
        url,
        status: res.status,
        validTime: validTimeStr,
        elapsedMs: Date.now() - start,
        error: null,
        requestedBbox: actualBounds,
        clampedBbox,
        hourOffset,
        gridVectorCount: result.vectors.length,
        nonzeroCount: result.nonzeroCount,
        renderable: result.renderable,
        coverageInside: true,
        boundsSource: actualSource,
        productId: json.product_id || null,
        is_dynamic_viewport_product: json.is_dynamic_viewport_product || false,
        coverage_scope: json.coverage_scope || null,
        requested_bbox: json.requested_bbox || null,
        served_bbox: json.served_bbox || null,
        resolution: json.resolution || null,
        coordinate_count: json.coordinate_count || null,
        cache_key: json.cache_key || null,
        cache_hit: json.cache_hit || null,
        model
      });

      const firstVector = result.vectors && result.vectors[0] ? { lat: result.vectors[0].lat, lng: result.vectors[0].lng } : null;
      const lastVector = result.vectors && result.vectors.length > 0 ? { lat: result.vectors[result.vectors.length - 1].lat, lng: result.vectors[result.vectors.length - 1].lng } : null;

      updateProjectionDiag('wind', {
        activeModel: model,
        activeLayer: 'wind',
        requestedViewportBounds: actualBounds,
        backendRequestBbox: bboxParam,
        responseGridBounds: json.grid?.bounds,
        coverageBounds: clampResult.coverageBounds,
        cols: result.cols,
        rows: result.rows,
        vectorCount: result.vectors.length,
        nonzeroCount: result.nonzeroCount,
        timeOffsetHours: hourOffset,
        requestedValidTime: getSharedValidTime(hourOffset, 'wind', model),
        validTime: getSharedValidTime(hourOffset, 'wind', model),
        firstVectorLatLng: firstVector,
        lastVectorLatLng: lastVector,
        productId: json.product_id,
        provider: json.provider,
        renderable: result.renderable,
        clampedBbox,
        selectedTileId: clampResult.selectedTileId,
        rejectedTileIds: clampResult.rejectedTileIds,
        regionId: json.region_id || clampResult.selectedTileId,
        tileId: json.tile_id || clampResult.selectedTileId,
        coverage_scope: json.coverage_scope || null
      });

      return result;
    } catch (err) {
      const errorDetails = {
        url,
        status: err.message.includes('HTTP') ? parseInt(err.message.match(/\d+/)?.[0] || '0') : 500,
        validTime: validTimeStr,
        elapsedMs: Date.now() - start,
        error: err.message,
        requestedBbox: actualBounds,
        clampedBbox,
        hourOffset,
        fallbackToLegacy: true,
        boundsSource: actualSource,
        model
      };
      updateWindDiagnostics('grid', errorDetails);

      updateProjectionDiag('wind', {
        activeModel: model,
        activeLayer: 'wind',
        requestedViewportBounds: actualBounds,
        backendRequestBbox: bboxParam,
        responseGridBounds: null,
        coverageBounds: clampResult.coverageBounds,
        renderable: false,
        error: err.message,
        reason: err.message,
        clampedBbox,
        timeOffsetHours: hourOffset,
        selectedTileId: clampResult.selectedTileId,
        rejectedTileIds: clampResult.rejectedTileIds,
        regionId: clampResult.selectedTileId,
        tileId: clampResult.selectedTileId,
        validTime: validTimeStr
      });

      console.error(`[Backend Weather Service] Wind grid fetch error: ${err.message}. Falling back cleanly.`);
      throw err;
    } finally {
      // delete only OUR entry — an aborted predecessor's late finally must not evict a
      // fresh successor registered for the same url (the map-clobber twin of the guard above)
      if (inFlightWindRequests.get(url) === _entry) {
        inFlightWindRequests.delete(url);
      }
    }
  })();

  _entry = { promise, signal };
  inFlightWindRequests.set(url, _entry);
  return promise;
}

// A static grid's vectors are already in the mapped shape ({lat, lng, speed, direction, u, v}, plus is_valid: staticFrameCodec.
// buildWindVectors), so the result reuses them instead of copying 15k objects again; mapNormalizedWindGridToWebGL still builds
// every other field (one mapper, so the two paths cannot drift).
function mapStaticWind(json, box, hourOffset) {
  const vectors = json.grid.vectors;
  // The shell is mapped as hour -1 so the mapper's hour-0 truth stage never records the one-vector stand-in; the real grid is
  // recorded below instead.
  const shell = mapNormalizedWindGridToWebGL({ ...json, grid: { ...json.grid, vectors: [{ lat: 0, lng: 0, speed: 1 }] } }, box, -1);
  let nonzero = 0;
  for (let i = 0; i < vectors.length; i++) if (vectors[i].speed > 0) nonzero += 1;
  shell.vectors = vectors;
  shell.hourOffset = hourOffset;
  shell.nonzeroCount = nonzero;
  shell.renderable = vectors.length > 0 && nonzero > 0;
  if (typeof window !== 'undefined' && hourOffset === 0) {
    recordTruthStage('mappedGrid', { model: json.model || 'GFS', domain: 'wind', layer: 'wind', valid_time: json.valid_time,
      run_time: json.run_time, product_id: json.product_id, is_dynamic_viewport_product: false, coverage_scope: json.coverage_scope,
      requested_bbox: json.requested_bbox, served_bbox: json.served_bbox, grid: json.grid, truthTag: json.truthTag },
    'backendWindServiceClient.js', 'mapStaticWind');
  }
  return shell;
}

function staticWindResult(json, { clampedBbox, hourOffset, model, actualBounds, actualSource, start, validTimeStr, clampResult }) {
  const result = mapStaticWind(json, clampedBbox, hourOffset);
  result.source = model;
  result.__staticWind = true;
  updateWindDiagnostics('grid', {
    url: 'static', status: 200, validTime: validTimeStr, elapsedMs: Date.now() - start, error: null,
    requestedBbox: actualBounds, clampedBbox, hourOffset, gridVectorCount: result.vectors.length,
    nonzeroCount: result.nonzeroCount, renderable: result.renderable, coverageInside: true, boundsSource: actualSource,
    productId: json.product_id || null, is_dynamic_viewport_product: false, coverage_scope: json.coverage_scope || null,
    requested_bbox: json.requested_bbox || null, served_bbox: json.served_bbox || null, model,
  });
  if (clampResult) {
    updateProjectionDiag('wind', {
      activeModel: model, activeLayer: 'wind', requestedViewportBounds: actualBounds, backendRequestBbox: 'static',
      responseGridBounds: json.grid && json.grid.bounds, coverageBounds: clampResult.coverageBounds, cols: result.cols,
      rows: result.rows, vectorCount: result.vectors.length, nonzeroCount: result.nonzeroCount, timeOffsetHours: hourOffset,
      requestedValidTime: validTimeStr, validTime: validTimeStr, productId: json.product_id, provider: json.provider,
      renderable: result.renderable, clampedBbox, selectedTileId: clampResult.selectedTileId, regionId: json.region_id,
      tileId: json.tile_id, coverage_scope: json.coverage_scope || null,
    });
  }
  return result;
}

const WORLD_WIND_BOX = { west: -180, south: -80, east: 180, north: 85 };
// The mapped grid per static JSON (built once, ~15k objects) and per hour offset, so a step that lands on a frame already built
// (the idle pre-build below) costs no allocation at all, and the same hour commits the same object.
const _mappedByJson = new WeakMap();
function mappedStatic(json, box, hourOffset, model) {
  let byHour = _mappedByJson.get(json);
  if (!byHour) { byHour = new Map(); _mappedByJson.set(json, byHour); }
  let r = byHour.get(hourOffset);
  if (!r) {
    const first = byHour.values().next().value;
    r = first ? { ...first, hourOffset } : mapStaticWind(json, box, hourOffset);
    r.source = model;
    r.__staticWind = true;
    byHour.set(hourOffset, r);
  }
  return r;
}

/**
 * The wind grid for `hourOffset` from static bytes ALREADY HERE (the idle prefetch or an earlier load), synchronously, or null.
 * `bounds` = the viewport: its /grid box (clampViewportBbox) when that box is a mid-zoom clip, else the WORLD frame (the base the
 * engine keeps under any fine overlay). No I/O; what the scrub drag path, the settle path and the warm commits call per step.
 */
export function getStaticWindDataSync(model, hourOffset, bounds, { world = false } = {}) {
  try {
    if (!windStaticEnabled() || windLaneDisabled()) return null;
    const m = model || 'GFS';
    const validTimeStr = getSharedValidTime(hourOffset, 'wind', m, { readOnly: true });
    let box = WORLD_WIND_BOX;
    if (!world && bounds) {
      const c = clampViewportBbox(bounds, 'wind', m, 'wind');
      if (c && c.isInside && c.clampedBbox && windBoxKind(m, c.clampedBbox) === 'crop') box = c.clampedBbox;
    }
    const json = staticWindGridSync({ model: m, validTimeStr, clampedBbox: box });
    if (!json) return null;
    return mappedStatic(json, box, hourOffset, m);
  } catch (e) {
    return null;
  }
}

/**
 * Build the world grids of the hours a next step most likely lands on (+-1, +-3, +-24 h) in idle time, so the step itself only
 * commits. From bytes already here; nothing is fetched. Kill: window.__RAW_DISABLE_WIND_PREBUILD__ = true.
 */
export function prebuildStaticWindAround(model, hourOffset) {
  if (typeof window === 'undefined' || window.__RAW_DISABLE_WIND_PREBUILD__ === true || !windStaticEnabled()) return;
  const hours = [1, -1, 3, -3, 24, -24].map((d) => hourOffset + d).filter((h) => h >= 0);
  const run = (i) => {
    if (i >= hours.length) return;
    const go = () => { getStaticWindDataSync(model, hours[i], null, { world: true }); run(i + 1); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 500 }); else setTimeout(go, 16);
  };
  run(0);
}

if (typeof window !== 'undefined') {
  window.fetchBackendExactWindPoint = fetchBackendExactWindPoint;
  window.fetchBackendWindGrid = fetchBackendWindGrid;
}
