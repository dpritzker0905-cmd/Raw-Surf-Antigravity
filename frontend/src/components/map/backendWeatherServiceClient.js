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
import { readMarineSurfMode } from './marineSurfMode';
import { clampViewportBbox, getCachedManifest, setCachedManifest } from './backendWeatherServiceClientCoverage';
import { getManifestTimeIndex, manifestGroupKey, manifestTimeIndexEnabled, nearestValidTime } from './manifestTimeIndex';
import { latestTimeDiag, updateDiagnostics, updateProjectionDiag } from './backendWeatherServiceClientDiag';
import { recordTruthStage } from './weatherTruthTracker';
import { fetchBackendMarineGridIconExtended, mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';
import { arrayMax, arrayMin } from './marineControllerUtils';
import { blendIconSwell2 } from './iconSwell2Blend';
import { requireStoredIconEstimate } from './iconEstimateDelivery';
import { noteRequestDiet, planManifestFetch, requestDietOn } from './marineRequestDiet';
import { staticEligible, tryStaticWorldGrid } from './staticFrames';
import { noteBackendAnswer } from './staticRegional';


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
let lastBackgroundManifestStartMs = null;

// PRODUCTS_SHARE (request diet 2026-10-20, marineRequestDiet.js): `background` marks the fire-and-forget refresh getSharedValidTime
// starts while the manifest is not loaded (or empty). Before, every such call skipped the in-flight promise and started its own
// 10.75 MB download (9-13 per map open in the live access logs, ~1.8 s of server event loop each); now a forced call shares the
// running download and background refreshes are spaced MANIFEST_BACKGROUND_REFRESH_MIN_MS apart. Kill: __RAW_DISABLE_PRODUCTS_SHARE__.
export async function fetchProductsManifest(forceRefresh = false, { background = false } = {}) {
  const cached = getCachedManifest();
  const isEmpty = cached && Array.isArray(cached.products) && cached.products.length === 0;
  if (cached && !forceRefresh && !isEmpty) return cached;
  const plan = planManifestFetch({ inFlight: !!manifestFetchPromise, force: forceRefresh, background,
    lastBackgroundStartMs: lastBackgroundManifestStartMs, nowMs: Date.now() });
  if (plan === 'share') { if (forceRefresh) noteRequestDiet('products_shared'); return manifestFetchPromise; }
  if (plan === 'skip') { noteRequestDiet('products_refresh_spaced'); return cached || null; }
  if (background) lastBackgroundManifestStartMs = Date.now();

  const p = (async () => {
    try {
      // PRODUCTS_COMPACT (#423): only the seven fields the client reads; an older backend ignores the parameter (full list).
      const res = await fetch(STATUS_URL.replace('/status', '/products') + (requestDietOn('PRODUCTS_COMPACT') ? '?fields=compact' : ''));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCachedManifest(data);
      return data;
    } catch (err) {
      console.warn("[Backend Weather Service] Failed to fetch products manifest:", err.message);
      return null;
    } finally {
      // Identity-safe: a download superseded under the kill switch must not clear the newer one's slot.
      if (manifestFetchPromise === p || !requestDietOn('PRODUCTS_SHARE')) manifestFetchPromise = null;
    }
  })();
  manifestFetchPromise = p;

  return manifestFetchPromise;
}

/** Test seam: forget the in-flight download and the background spacing clock. */
export function _resetProductsManifestFetchForTest() {
  manifestFetchPromise = null;
  lastBackgroundManifestStartMs = null;
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
    const persisted = readMarineSurfMode(window);
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
 * THE frontend forecast anchor, in epoch ms: "now" snapped to the NEAREST whole hour.
 *
 * F-01 (audit 14.0). This value used to be computed inline inside getSharedValidTime only, while
 * the /grid_series backend independently FLOORED its own clock. The two agree for 30 minutes of
 * every hour and disagree by exactly one hour for the other 30 — so the committed series frame
 * silently differed from the hour the wheel displayed (measured live 2026-09-20 20:52Z: requested
 * 21Z, committed 20Z). It is exported so every caller that needs the anchor reads THIS one rather
 * than re-deriving it; the series request now transmits it, and the backend honours it.
 *
 * ⚠️ Do not "fix" a future anchor disagreement by adding a second rounding rule here. There is one
 * anchor; if a consumer disagrees with it, transmit this value to that consumer instead.
 */
export function getSeriesAnchorMs() {
  const baseTime = (typeof window !== 'undefined' && window.__MOCK_DATE_NOW__) || Date.now();
  return Math.round(baseTime / 3600000) * 3600000;
}

/** The same anchor as an ISO-8601 UTC string, which is the wire format /grid_series accepts. */
export function getSeriesAnchorIso() {
  return new Date(getSeriesAnchorMs()).toISOString();
}

/**
 * Computes a standardized snapped UTC ISO string from hourOffset.
 * Resolves the nearest valid_time from cachedManifest when available (max 3h delta).
 * Provides the single source of authority for matching grid/point time dimensions.
 * Diagnostic callers use readOnly to avoid manifest refreshes or serving diagnostic writes.
 */
export function getSharedValidTime(timeOffsetHours, layer = 'waves', modelName = 'GFS', { readOnly = false, anchorMs = null, domain = null } = {}) {
  const offset = isNaN(Number(timeOffsetHours)) ? 0 : Number(timeOffsetHours);
  const roundedNow = anchorMs ?? getSeriesAnchorMs();
  const targetDt = new Date(roundedNow + offset * 3600000);
  const requestedValidTime = targetDt.toISOString();

  let selectedManifestValidTime = null;
  let manifestDeltaHours = null;
  let fallbackReason = null;

  const filterLayer = (layer || 'waves').toLowerCase();
  const filterDomain = domain || (filterLayer === 'wind' ? 'wind' : 'marine');
  const filterModel = (modelName || 'GFS').toUpperCase();

  const manifest = getCachedManifest();
  const hasEmptyProducts = manifest && Array.isArray(manifest.products) && manifest.products.length === 0;

  if (manifest && Array.isArray(manifest.products) && !hasEmptyProducts) {
    // The nearest product's time, from the per-manifest index (manifestTimeIndex.js: built once, binary-searched, the same
    // answer as the scan below, ties included) or, with its kill switch or a malformed manifest, from the original scan.
    let matchCount = 0;
    let minDiffMs = Infinity;
    let bestMs = null;
    const timeIndex = manifestTimeIndexEnabled() ? getManifestTimeIndex(manifest.products) : null;
    if (timeIndex) {
      const group = timeIndex.get(manifestGroupKey(filterModel, filterDomain, filterLayer));
      if (group) {
        matchCount = group.count;
        const near = nearestValidTime(group, targetDt.getTime());
        minDiffMs = near.diffMs;
        bestMs = near.ms;
      }
    } else {
      const matchingProducts = manifest.products.filter(p => 
        p.model.toUpperCase() === filterModel &&
        p.domain.toLowerCase() === filterDomain &&
        p.layer.toLowerCase() === filterLayer
      );
      matchCount = matchingProducts.length;
      let bestProduct = null;

      for (const p of matchingProducts) {
        const pDate = new Date(p.valid_time_start);
        const diffMs = Math.abs(pDate.getTime() - targetDt.getTime());
        if (diffMs < minDiffMs) {
          minDiffMs = diffMs;
          bestProduct = p;
        }
      }
      if (bestProduct) bestMs = new Date(bestProduct.valid_time_start).getTime();
    }

    if (matchCount > 0) {
      // Snapped to products within a max 3h delta window
      if (minDiffMs <= 3 * 3600000 && bestMs !== null) {
        selectedManifestValidTime = new Date(bestMs).toISOString();
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
    if (!readOnly) fetchProductsManifest(true, { background: true }).catch(() => {});
  }

  const cacheDiagKey = `${filterModel}_${filterLayer}`;
  if (!readOnly) latestTimeDiag[cacheDiagKey] = {
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
export async function fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, layer = 'waves', model = 'GFS', options = {}) {
  await fetchProductsManifest().catch(() => null);

  // D-001: changing displayed forecasts stays dark until the owner authorizes a flip.
  // When enabled, use the backend's stored estimate and its product/run/served-time identity.
  // Secondary swell retains its separately disclosed legacy estimate (D-003).
  const storedIconTail = process.env.REACT_APP_ICON_STORED_TAIL === 'true';
  if (model === 'ICON' && hourOffset > 168 && !options.storedIconRecovery && (!storedIconTail || layer === 'swell_2')) {
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
      // The blend math lives in iconSwell2Blend.js, shared with the series path (no-network scrub frames).
      return blendIconSwell2(gfsGrid?.grid || null, euroGrid?.grid || null, hourOffset, snappedBounds);
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
    // STATIC FRAMES (step 2b, DARK: staticFrames.js): a WORLD box is answered from the pinned CDN frame when one
    // covers this valid time; any miss or error returns null and /grid is fetched exactly as before.
    const surfNow = getSurfModeFlag();
    const staticJson = staticEligible({ model, layer, bbox: clampedBbox, surf: surfNow })
      ? await tryStaticWorldGrid({ model, layer, validTimeStr, clampedBbox, surf: surfNow, signal })
      : null;
    let res = null;
    let json = staticJson;
    if (!json) {
      res = await fetch(url, { signal });
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
      json = await res.json();
      noteBackendAnswer({ model, layer, bboxStr: bboxParam, json });   // a dynamic answer on a box a regional bundle covers (expected 0)
    }

    if (options.storedIconRecovery) requireStoredIconEstimate(json, layer, validTimeStr);

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
      url: staticJson ? `static:${staticJson.static_frame.path}` : url,
      status: res ? res.status : 200,
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
      // NOTE (2026-07-31): `validTime` and `timeOffsetHours` were each declared TWICE in this
      // literal; the later pair below silently won. Removed the dead ones — a no-op, but the
      // correctness was resting on source ORDER. Keep `validTime: validTimeStr` (the value actually
      // used to build the request URL) rather than re-calling getSharedValidTime here: that function
      // reads Date.now() rounded to the hour AND the cached manifest, so a re-call after the fetch
      // can drift from what was requested — and this object is a diagnostic describing the request.
      requestedValidTime: getSharedValidTime(hourOffset, layer, model),
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
