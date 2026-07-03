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
import { fetchBackendMarineGridIconExtended, mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';
import { arrayMax, arrayMin } from './marineControllerUtils';


export { BoundedPointCache };
export { getCachedManifest, setCachedManifest };
export const pointCache = new BoundedPointCache(50, 30000);

// Expose standard API base endpoints
export const STATUS_URL = `${BACKEND_URL}/api/weather/status`;
export const GRID_URL = `${BACKEND_URL}/api/weather/grid`;
export const POINT_URL = `${BACKEND_URL}/api/weather/point`;

import './backendWeatherServiceClientTrace';

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
 * Option-2 Swell<->Surf toggle flag. When ON, marine grid fetches request &surf=1 so the heatmap renders
 * the bathymetry SURF (nearshore breaking) height instead of offshore swell. window + localStorage; OFF by
 * default. Read by the marine grid URL builder + the marine cache key; flipped by the controls toggle.
 */
export function getSurfModeFlag() {
  if (typeof window === 'undefined') return false;
  if (window.__SURF_MODE__ !== undefined) return !!window.__SURF_MODE__;
  try {
    const persisted = window.localStorage.getItem('__SURF_MODE__') === 'true';
    // BOOT-RACE PIN (2026-07-03): stamp the window flag on FIRST read so every reader —
    // including the raw `window.__SURF_MODE__` inline reads in the engine — agrees for the whole
    // boot. Before this, code reading the window flag directly saw `undefined` (falsy) until the
    // first toggle wrote it, while localStorage said 'true' → plain and surf-banded frames mixed
    // across the boot sequence (night-1 z7.12 "heatmap cleared").
    window.__SURF_MODE__ = persisted;
    return persisted;
  } catch (e) { return false; }
}

export function setSurfModeFlag(on) {
  if (typeof window === 'undefined') return;
  window.__SURF_MODE__ = !!on;
  try { window.localStorage.setItem('__SURF_MODE__', on ? 'true' : 'false'); } catch (e) {}
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
  const offset = isNaN(Number(timeOffsetHours)) ? 0 : Number(timeOffsetHours);
  const baseTime = (typeof window !== 'undefined' && window.__MOCK_DATE_NOW__) || Date.now();
  const roundedNow = Math.round(baseTime / 3600000) * 3600000;
  const targetDt = new Date(roundedNow + offset * 3600000);
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

export {
  blendDirection,
  blendPeriod,
  blendSubVector,
  extrapolateSubVector,
  mapNormalizedGridToWebGL,
  fetchBackendMarineGridIconExtended
} from './backendWeatherServiceClientHelpers';

export { fetchBackendExactPoint } from './backendWeatherServiceClientPoint';


/**
 * Fetches marine conformed forecast grid from backend weather service.
 */
export async function fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, layer = 'waves', model = 'GFS') {
  await fetchProductsManifest().catch(() => null);

  if (model === 'ICON' && hourOffset > 168) {
    if (hourOffset <= 240 && layer === 'swell_2') {
      // Fall through to existing swell_2 blender below
    } else {
      return fetchBackendMarineGridIconExtended(bounds, hourOffset, signal, snappedBounds, layer, fetchBackendMarineGrid);
    }
  }

  if (model === 'ICON' && layer === 'swell_2') {
    // ICON/GWAM doesn't provide native swell_2. Synthesize from GFS/EURO blend.
    // Formula: 60% GFS + 40% EURO weighted average (GFS has broader 384h coverage).
    updateProjectionDiag('marine', {
      activeModel: 'ICON',
      activeLayer: 'swell_2',
      requestedViewportBounds: bounds || snappedBounds,
      renderable: true,
      renderDecision: 'estimated_blend',
      reason: 'icon_swell_2_gfs_euro_blend',
      timeOffsetHours: hourOffset
    });

    try {
      const [gfsResult, euroResult] = await Promise.allSettled([
        fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, 'swell_2', 'GFS'),
        fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, 'swell_2', 'EURO')
      ]);

      const gfsGrid = gfsResult.status === 'fulfilled' ? gfsResult.value : null;
      const euroGrid = euroResult.status === 'fulfilled' ? euroResult.value : null;
      const gfsVectors = gfsGrid?.grid?.vectors || [];
      const euroVectors = euroGrid?.grid?.vectors || [];

      // Anchor the blend on the grid with MORE vectors (the finer/fuller resolution). FIX: GFS swell_2 can
      // come back as a coarse fallback (e.g. 60 vectors) while EURO returns a rich dynamic grid (629 vectors,
      // 348 nonzero in the Gulf) — anchoring on GFS + an exact (lat*100)|0 key DROPPED EURO's real secondary
      // swell, leaving the "Gulf/Antarctica square of no swell_2". Anchor on the fuller grid so that coverage
      // is preserved; then per-cell use whichever source actually has secondary swell.
      const gfsIsPrimary = gfsVectors.length >= euroVectors.length;
      const primaryVectors = gfsIsPrimary ? gfsVectors : euroVectors;
      const secondaryVectors = gfsIsPrimary ? euroVectors : gfsVectors;
      const primaryGrid = gfsIsPrimary ? gfsGrid?.grid : euroGrid?.grid;

      if (!primaryVectors.length) {
        // Both models failed — return unsupported
        return {
          type: 'FeatureCollection', features: [], hourOffset,
          grid: {
            vectors: [], bounds: snappedBounds || { west: -180, south: -80, east: 180, north: 85 },
            cols: 0, rows: 0, timestamp: Date.now(),
            __sourceModel: 'ICON', __provider: 'none', __gridProvider: 'none',
            __componentLayer: 'swell_2', __gridSupportsLayer: false,
            __activeLayerNonzeroCount: 0, __activeLayerMax: 0, __oceanMaskCount: 0,
            __renderable: false, __unsupportedLayer: true,
            provider: 'none', hourOffset, nonzeroCount: 0, maxSpeed: 0,
            renderable: false, status: 'unsupported'
          },
          __renderable: false, __unsupportedLayer: true, status: 'unsupported'
        };
      }

      // TOLERANT secondary lookup keyed at ~0.5° so a primary cell still matches a slightly-offset or
      // coarser secondary cell (the old exact 0.01° key missed whenever the two grids' centres/resolutions
      // differed — the root of the dropped-EURO bug). Keep the strongest secondary in each 0.5° bucket so a
      // zero never overwrites real swell.
      const skey = (lat, lng) => `${Math.round(lat * 2)},${Math.round(lng * 2)}`;
      let secondaryLookup = null;
      if (secondaryVectors.length > 0) {
        secondaryLookup = new Map();
        for (let i = 0; i < secondaryVectors.length; i++) {
          const sv = secondaryVectors[i];
          const key = skey(sv.lat, sv.lng);
          const ex = secondaryLookup.get(key);
          if (!ex || (sv.speed || 0) > (ex.speed || 0)) secondaryLookup.set(key, sv);
        }
      }

      // Source weights (GFS 0.6 / EURO 0.4) applied by ORIGIN regardless of which grid is the anchor.
      const bothPresent = gfsVectors.length > 0 && euroVectors.length > 0;
      const GFS_WEIGHT = bothPresent ? 0.6 : (gfsVectors.length > 0 ? 1.0 : 0.0);
      const EURO_WEIGHT = 1.0 - GFS_WEIGHT;
      const primaryW = gfsIsPrimary ? GFS_WEIGHT : EURO_WEIGHT;
      const secondaryW = gfsIsPrimary ? EURO_WEIGHT : GFS_WEIGHT;
      let maxSpeed = 0, nonzeroCount = 0;

      const blendedVectors = primaryVectors.map(pv => {
        let speed = pv.speed || 0;
        let u = pv.u || 0;
        let v = pv.v || 0;
        let period = pv.period || 0;

        const sv = secondaryLookup ? secondaryLookup.get(skey(pv.lat, pv.lng)) : null;
        const sSpeed = sv ? (sv.speed || 0) : 0;
        if (sSpeed > 0 && speed > 0) {
          // both sources have secondary swell here -> weighted blend
          speed = speed * primaryW + sSpeed * secondaryW;
          u = u * primaryW + (sv.u || 0) * secondaryW;
          v = v * primaryW + (sv.v || 0) * secondaryW;
          period = period * primaryW + (sv.period || 0) * secondaryW;
        } else if (sSpeed > 0) {
          // only the secondary source has it -> use it fully (fills the anchor grid's gaps, e.g. EURO in
          // the Gulf where GFS is 0/coarse). This is what kills the no-swell square.
          speed = sSpeed; u = sv.u || 0; v = sv.v || 0; period = sv.period || 0;
        }
        // else: only the primary source (or neither) -> keep the primary value

        if (speed > maxSpeed) maxSpeed = speed;
        if (speed > 0) nonzeroCount++;

        return {
          lat: pv.lat, lng: pv.lng,
          speed, u, v, period,
          is_valid: pv.is_valid !== false
        };
      });

      const blendedGrid = {
        vectors: blendedVectors,
        bounds: primaryGrid.bounds || snappedBounds || { west: -180, south: -80, east: 180, north: 85 },
        cols: primaryGrid.cols || 0,
        rows: primaryGrid.rows || 0,
        timestamp: Date.now(),
        __sourceModel: 'ICON',
        __provider: 'estimated',
        __gridProvider: 'gfs_euro_blend',
        __componentLayer: 'swell_2',
        __gridSupportsLayer: true,
        __activeLayerNonzeroCount: nonzeroCount,
        __activeLayerMax: maxSpeed,
        __oceanMaskCount: primaryGrid.__oceanMaskCount || 0,
        __renderable: blendedVectors.length > 0,
        provider: 'estimated',
        source_dataset: 'estimated_blend',
        hourOffset,
        nonzeroCount,
        maxSpeed,
        renderable: blendedVectors.length > 0,
        is_estimated: true,
        isEstimated: true,
        estimate_basis: {
          type: 'icon_swell_2_gfs_euro_blend',
          method: 'weighted_average',
          gfs_weight: GFS_WEIGHT,
          euro_weight: EURO_WEIGHT,
          gfs_vectors: gfsVectors.length,
          euro_vectors: euroVectors.length,
          source_model: 'ncep_gfswave025+ecmwf_wam025'
        }
      };

      console.log(`[Backend] ICON swell_2 blend: ${blendedVectors.length} vectors (GFS:${gfsVectors.length} EURO:${euroVectors.length}), max:${maxSpeed.toFixed(2)}, nz:${nonzeroCount}`);

      return {
        type: 'FeatureCollection',
        features: [],
        hourOffset,
        grid: blendedGrid,
        __renderable: blendedGrid.__renderable,
        status: 'ok'
      };
    } catch (blendErr) {
      console.error('[Backend] ICON swell_2 blend failed:', blendErr);
      return {
        type: 'FeatureCollection', features: [], hourOffset,
        grid: {
          vectors: [], bounds: snappedBounds || { west: -180, south: -80, east: 180, north: 85 },
          cols: 0, rows: 0, timestamp: Date.now(),
          __sourceModel: 'ICON', __provider: 'none', __gridProvider: 'none',
          __componentLayer: 'swell_2', __gridSupportsLayer: false,
          __activeLayerNonzeroCount: 0, __activeLayerMax: 0, __oceanMaskCount: 0,
          __renderable: false, __unsupportedLayer: true,
          provider: 'none', hourOffset, nonzeroCount: 0, maxSpeed: 0,
          renderable: false, status: 'unsupported'
        },
        __renderable: false, __unsupportedLayer: true, status: 'unsupported'
      };
    }
  }

  const start = Date.now();
  const validTimeStr = getSharedValidTime(hourOffset, layer, model);

  let actualBounds = bounds;
  if (!actualBounds) {
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
  const url = `${GRID_URL}?model=${model}&domain=marine&layer=${layer}&valid_time=${validTimeStr}&bbox=${bboxParam}${getSurfModeFlag() ? '&surf=1' : ''}`;

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
      recordTruthStage('backendResponse', {
        model,
        domain: 'marine',
        layer,
        valid_time: json.valid_time,
        product_id: json.product_id,
        is_dynamic_viewport_product: json.is_dynamic_viewport_product,
        coverage_scope: json.coverage_scope,
        requested_bbox: json.requested_bbox,
        served_bbox: json.served_bbox,
        grid: json.grid,
        truthTag: json.truthTag
      }, 'backendWeatherServiceClient.js', 'fetchBackendMarineGrid');

      window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
      const vectors = json.grid && Array.isArray(json.grid.vectors) ? json.grid.vectors : [];
      const nonzero = vectors.filter(v => (v.speed || 0) > 0);
      const minS = arrayMin(vectors.map(v => v.speed || 0));
      const maxS = arrayMax(vectors.map(v => v.speed || 0));
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
