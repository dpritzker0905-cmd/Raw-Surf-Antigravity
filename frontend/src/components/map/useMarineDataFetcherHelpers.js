// Display/serve maxima: the furthest hour each model is requested under its OWN identity
// before falling back. EURO marine is native to 240h and serves backend-conformed ESTIMATED
// products from 241..336h (240 native + 96 estimated), so the display max is 336h — matching
// capabilities.max_forecast_hours. (The native/estimate boundary, 240h, lives in the backend
// estimator + capabilities; post-240 EURO products stay model=EURO, provider=estimated.)
export const EURO_NATIVE_HOURS = 240;
export const DISPLAY_EURO_WAVES_MAX_HOURS = 336;
export const DISPLAY_EURO_COMPONENT_MAX_HOURS = 336;
export const DISPLAY_ICON_MAX_HOURS = 336;

export function getLongitudinalOverlap(w1, e1, w2, e2) {
  const vpWidth = (e1 < w1) ? (e1 + 360) - w1 : e1 - w1;
  if (vpWidth >= 360.0 - 1e-5) {
    return (e2 < w2) ? (e2 + 360) - w2 : e2 - w2;
  }
  const norm = lng => ((lng % 360) + 360) % 360;
  const nw1 = norm(w1), ne1 = norm(e1);
  const nw2 = norm(w2), ne2 = norm(e2);
  const getSegments = (s, e) => s <= e ? [[s, e]] : [[s, 360], [0, e]];
  const segs1 = getSegments(nw1, ne1);
  const segs2 = getSegments(nw2, ne2);
  let overlap = 0;
  for (const seg1 of segs1) {
    for (const seg2 of segs2) {
      const start = Math.max(seg1[0], seg2[0]);
      const end = Math.min(seg1[1], seg2[1]);
      if (start < end) overlap += (end - start);
    }
  }
  return overlap;
}

export function checkShouldClearRegionalGrid({ marineData, bounds, zoom, model, layer }) {
  if (!marineData || !marineData.grid || !marineData.grid.bounds) return false;
  const g = marineData.grid;
  const ew = bounds.west, ee = bounds.east, es = bounds.south, en = bounds.north;
  const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
  
  const vpWidth = (ee < ew) ? (ee + 360) - ew : ee - ew;
  const gridWidth = (ge < gw) ? (ge + 360) - gw : ge - gw;
  const vpHeight = en - es;
  const gridHeight = gn - gs;

  const overlapWidth = getLongitudinalOverlap(ew, ee, gw, ge);
  const intSouth = Math.max(es, gs);
  const intNorth = Math.min(en, gn);
  
  let overlapRatio = 0;
  if (overlapWidth > 0 && intSouth < intNorth) {
    const intersectionArea = overlapWidth * (intNorth - intSouth);
    const viewportArea = vpWidth * (en - es);
    if (viewportArea > 0) {
      overlapRatio = intersectionArea / viewportArea;
    }
  }

  const isGlobalSupported = (model === 'GFS' || model === 'ICON');
  const isViewportZoomedOut = (zoom <= 6.5) || (vpWidth > 15.0 || vpHeight > 15.0);

  const isGridRegional = gridWidth < 340.0;
  let isContained = true;
  if (isGridRegional) {
    let vWest = ew;
    let vEast = ee;
    if (vEast < vWest) vEast += 360;

    let gWest = gw;
    let gEast = ge;
    if (gEast < gWest) gEast += 360;

    isContained = es >= gs && en <= gn && vWest >= gWest && vEast <= gEast;
  }

  let shouldClear = false;
  if (isGridRegional) {
    shouldClear = isGlobalSupported
      ? (isViewportZoomedOut ? (!isContained || gridWidth < 340.0 || overlapRatio < 0.15) : (overlapWidth <= 0 || intSouth >= intNorth))
      : (overlapWidth <= 0 || intSouth >= intNorth);

    const canBypassRegionalRejection = !isViewportZoomedOut || !isGlobalSupported;
    if (g && (g.__isAcceptableRegional || gridWidth < 340.0) && canBypassRegionalRejection) {
      shouldClear = isGlobalSupported
        ? (isViewportZoomedOut ? (!isContained || overlapWidth <= 0 || intSouth >= intNorth) : (overlapWidth <= 0 || intSouth >= intNorth))
        : (overlapWidth <= 0 || intSouth >= intNorth);
    }
  } else {
    shouldClear = (overlapWidth <= 0 || intSouth >= intNorth);
  }

  if (shouldClear) {
    console.log(`[Marine-Bounds-Clear] Bypassing clear stale grid (isGlobalSupported=${isGlobalSupported}, gridWidth=${gridWidth.toFixed(1)}x${gridHeight.toFixed(1)}) to prevent heatmap blanking during transitions.`);
  }
  return shouldClear;
}

export function buildIconFallbackGrid(bounds, fallbackReason) {
  return {
    type: 'FeatureCollection',
    features: [],
    grid: {
      bounds: bounds || { west: -180, south: -85, east: 180, north: 85 },
      cols: 0,
      rows: 0,
      vectors: [],
      emptyGridWarning: "No ICON weather precipitation/marine products found in manifest",
      productId: null,
      provider: 'backend-weather-service',
      is_estimated: false,
      fallbackReason,
      renderable: false
    }
  };
}

export function buildEuroFallbackGrid(bounds, fallbackReason) {
  return {
    type: 'FeatureCollection',
    features: [],
    grid: {
      bounds: bounds || { west: -180, south: -85, east: 180, north: 85 },
      cols: 0,
      rows: 0,
      vectors: [],
      emptyGridWarning: "Backend Copernicus support is absent, no frontend estimator",
      productId: null,
      provider: 'none',
      is_estimated: false,
      fallbackReason,
      renderable: false
    }
  };
}

export function buildCopernicusEmptyGrid(bounds, timeOffset, layer, reason) {
  return {
    type: 'FeatureCollection',
    features: [],
    hourOffset: timeOffset,
    grid: {
      vectors: [],
      bounds: bounds,
      cols: 0,
      rows: 0,
      timestamp: Date.now(),
      __sourceModel: 'EURO',
      __provider: 'backend-weather-service',
      __gridProvider: 'backend-weather-service',
      __componentLayer: layer,
      __gridSupportsLayer: false,
      __failureReason: reason,
      renderable: false,
      provider: 'backend-weather-service',
      emptyGridWarning: `Copernicus ${layer} grid empty/unrenderable: ${reason}`
    }
  };
}

export function getAbortRecoveryGrid(model, layer, phase, marineRevision) {
  // Honest product identity so the abort-recovery placeholder never logs "Product: undefined"
  // in the weather-truth trace (it is a non-renderable safe-zero placeholder, not real data).
  const recoveryProductId = `${(model || 'GFS').toLowerCase()}_${layer || 'waves'}_abort_recovery`;
  return {
    type: 'FeatureCollection',
    features: [],
    __commitRevision: marineRevision,
    __sourceModel: model,
    __provider: 'abort_recovery',
    productId: recoveryProductId,
    product_id: recoveryProductId,
    is_estimated: true,
    grid: {
      vectors: [],
      bounds: { west: -180, south: -80, east: 180, north: 85 },
      cols: 0,
      rows: 0,
      productId: recoveryProductId,
      __sourceModel: model,
      __provider: 'abort_recovery',
      __gridProvider: 'abort_recovery',
      __componentLayer: layer,
      __gridSupportsLayer: false,
      __renderable: false,
      __failureReason: 'abort_recovery_no_previous_data',
      renderable: false,
      provider: 'abort_recovery',
      is_estimated: true,
      emptyGridWarning: `Fetch aborted during ${phase}. Recovery grid committed to prevent LOADING deadlock.`
    }
  };
}

export function handleRegionalGridClearing({ mapInstance, isActivation, marineData, zoom, model, layer, setMarineData, lastCommittedSigRef }) {
  let bounds = { west: -180, south: -85, east: 180, north: 85 };
  if (!isActivation) {
    try {
      const mb = mapInstance.getBounds();
      bounds = { west: mb.getWest(), south: mb.getSouth(), east: mb.getEast(), north: mb.getNorth() };
    } catch (e) {
      // Fallback if map not ready
    }
  }

  if (marineData && marineData.grid && marineData.grid.bounds) {
    const shouldClear = checkShouldClearRegionalGrid({ marineData, bounds, zoom, model, layer });
    if (shouldClear) {
      console.log('[Marine-Bounds-Clear] Clearing stale regional grid from marineData.');
      setMarineData(null);
      lastCommittedSigRef.current = null;
    }
  }
  return bounds;
}

export function handleCooldownFallback({
  mapInstance,
  model,
  layer,
  timeOffset,
  timeOffsetRef,
  setMarineData,
  lastCommittedSigRef,
  marineRevision,
  getViewportHash,
  logPipelineEventHelper,
  cooldownRetryRef,
  consecutiveFailuresRef,
  clearTimeoutFunc,
  getModelSafeMarine,
  _marineDataSignature,
  getSharedValidTime
}) {
  console.warn('[Orchestrator] 429 rate limit active, skipping network fetch and entering cooldown fallback');
  consecutiveFailuresRef.current = 3;
  if (cooldownRetryRef.current) {
    clearTimeoutFunc(cooldownRetryRef.current);
    cooldownRetryRef.current = null;
  }
  logPipelineEventHelper('rate_limit_429', { model, layer, hour: timeOffset });

  let cachedData = null;
  try {
    const b = mapInstance.getBounds();
    const vpBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    cachedData = getModelSafeMarine(model, timeOffset, layer, vpBounds);
  } catch (e) { console.warn('[Cooldown Fallback] cache check failed:', e.message); }

  if (cachedData?.grid?.vectors?.length > 0) {
    console.log(`[Cooldown Fallback] Reusing valid cached grid for ${model} layer=${layer} hour=+${timeOffset}h`);
    const sig = _marineDataSignature(cachedData, layer);
    if (sig && sig !== lastCommittedSigRef.current) {
      lastCommittedSigRef.current = sig;
      marineRevision.current += 1;
      cachedData.__commitRevision = marineRevision.current;
      if (typeof window !== 'undefined' && model === 'GFS' && layer === 'waves' && timeOffset === 0) {
        window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
        window.__GFS_WAVES_SINGLE_SLICE_TRACE__.cacheCommit = {
          committedProductId: cachedData.grid?.productId || cachedData.productId || null,
          committedValidTime: cachedData.grid?.validTime || cachedData.validTime || (typeof getSharedValidTime === 'function' ? getSharedValidTime(0, 'waves', 'GFS') : null),
          committedBounds: cachedData.grid?.bounds || cachedData.bounds || null,
          cacheKey: getViewportHash(),
          cacheSource: 'cooldown_cache',
          didRejectStaleRegional: true,
          didClearPreviousRegionalBeforeViewport: true,
          commitRevision: marineRevision.current,
          timeOffsetHours: timeOffset
        };
        if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
          window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
        }
      }
      setMarineData(cachedData);
    }
    return true; // Handled
  }
  const isCurrentHour = timeOffset === timeOffsetRef.current;
  if (!window.isScrubbingTimeline && isCurrentHour) {
    setMarineData(prev => {
      const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
      if (hasValidData) {
        return {
          ...prev,
          stale: true,
          grid: {
            ...prev.grid,
            stale: true
          }
        };
      }
      lastCommittedSigRef.current = null;
      return null;
    });
  } else {
    console.log(`[Marine] Cooldown hit during scrubbing/stale (isCurrentHour=${isCurrentHour}), preserving stale data.`);
  }
  return true; // Handled
}

export function commitMarineData({
  data,
  bounds,
  model,
  layer,
  timeOffset,
  timeOffsetRef,
  setMarineData,
  lastCommittedSigRef,
  marineRevision,
  getViewportHash,
  logPipelineEventHelper,
  consecutiveFailuresRef,
  isCommittingDataRef,
  isInternalMapUpdateRef,
  internalUpdateTimerRef,
  locks,
  source,
  scheduleSWRRevalidation,
  updateMarineGrid,
  getBackendCopernicusFlag,
  getBackendIconMarineFlag,
  getBackendWeatherFlag,
  _marineDataSignature,
  getSharedValidTime,
  updateDeprecationDiag,
  setTimeoutFunc,
  clearTimeoutFunc
}) {
  if (data.grid) {
    if (data.grid.bounds && bounds) {
      const ew = bounds.west, ee = bounds.east;
      const vpWidth = (ee < ew) ? (ee + 360) - ew : ee - ew;
      const gw = data.grid.bounds.west, ge = data.grid.bounds.east;
      const gridWidth = (ge < gw) ? (ge + 360) - gw : ge - gw;
      if (vpWidth > 15.0 && gridWidth < 340.0) {
        data.grid.__isAcceptableRegional = true;
      }
    }
    const isBackendCopernicus = typeof getBackendCopernicusFlag === 'function' && getBackendCopernicusFlag();
    const isBackendIcon = typeof getBackendIconMarineFlag === 'function' && getBackendIconMarineFlag();
    const isBackendGfs = typeof getBackendWeatherFlag === 'function' && getBackendWeatherFlag();
    const isBackendRedirectActive = (model === 'EURO' && isBackendCopernicus) || (model === 'ICON' && isBackendIcon) || (model === 'GFS' && isBackendGfs);
    const backendAvailable = isBackendRedirectActive && (data.grid.is_estimated || !data.grid.emptyGridWarning);
    if (typeof window !== 'undefined') {
      updateDeprecationDiag({
        model,
        layer,
        offset: timeOffset,
        calledFunc: null,
        called: false,
        backendAvailable: !!backendAvailable,
        productId: data.grid.productId || null,
        isEstimated: data.grid.is_estimated || false,
        fallbackReason: isBackendRedirectActive ? 'backend_redirect_active' : 'within_native_limit_or_unsupported'
      });
    }
  }
  consecutiveFailuresRef.current = 0; locks.lastHash = getViewportHash(); locks.lastTime = Date.now();
  
  logPipelineEventHelper('data_committed', { model, layer, hour: timeOffset, provider: data?.grid?.__provider, vectorCount: data?.grid?.vectors?.length || 0 });
  isCommittingDataRef.current = true; isInternalMapUpdateRef.current = true;
  if (source === 'timeline_scrub' && timeOffsetRef.current !== timeOffset) {
    locks.lastHash = null;
  }

  // All-zero guard (state side): a full-shape grid whose every active-layer ocean vector reads
  // exactly 0 is a conformed-empty / transient-starved placeholder, not real forecast data.
  // Committing it would blank the heatmap AND wedge the scrub-settle net (which sees vectors +
  // a matching hour and stops retrying). Treat it as non-valid so a good same-model/layer frame
  // is retained; the retained OLD hour then trips scrub-settle's hourMismatch and a retry
  // recovers real data. NOT marked terminal — the all-zero often comes from a per-hour global
  // fetch starved on the 1-CPU box during auto-play scrub and succeeds on retry when idle.
  let gridHasSignal = false;
  const _signalVecs = data?.grid?.vectors;
  if (Array.isArray(_signalVecs)) {
    for (const v of _signalVecs) {
      if (!v) continue;
      const comp = v[layer] || v.waves || v.swell_1 || v.swell_2 || v.wind_waves || v;
      if (comp && comp.speed > 0) { gridHasSignal = true; break; }
    }
  }

  setMarineData(prev => {
    const hasNewValidData = data && data.grid && data.grid.vectors && data.grid.vectors.length > 0 && data.grid.renderable !== false && gridHasSignal;
    const hasPrevValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
    const isZoomTooLow = data?.grid?.__skippedReason === 'zoom_too_low' || data?.grid?.skippedReason === 'zoom_too_low';
    const prevModel = prev?.grid?.__sourceModel || prev?.__sourceModel;
    const prevLayer = prev?.grid?.__componentLayer || prev?.__componentLayer || 'waves';
    const isSameModelAndLayer = prevModel === model && prevLayer === layer;
    if (!hasNewValidData && hasPrevValidData && !isZoomTooLow && isSameModelAndLayer) {
      console.log(`[Marine] Ignoring empty/unrenderable commit to preserve stale heatmap data.`);
      return prev;
    }
    // Anti-flicker during an ACTIVE scrub: a stale/coarse/degenerate grid (e.g. the 2x2
    // global fallback, 4 vectors) would replace the good heatmap with a near-empty frame
    // for a beat, then refill — the glitch felt while scrubbing. Hold the prior good
    // same-model/layer frame instead. This is scrub-only: the SWR revalidation commit
    // (source 'swr_revalidation') and settled commits are NOT suppressed, so the final
    // displayed frame is still truthful (even if genuinely coarse).
    const isScrubCommit = source === 'timeline_scrub';
    const isStaleCoarse = !!(data?.stale || data?.grid?.stale);
    const isDegenerate = ((data?.grid?.cols ?? 99) <= 2 || (data?.grid?.rows ?? 99) <= 2);
    if (isScrubCommit && (isStaleCoarse || isDegenerate) && hasPrevValidData && !isZoomTooLow && isSameModelAndLayer) {
      console.log(`[Marine] Scrub: holding good frame, skipped ${isDegenerate ? 'degenerate' : 'stale/coarse'} commit (cols=${data?.grid?.cols}, rows=${data?.grid?.rows}).`);
      return prev;
    }
    const newSig = _marineDataSignature(data, layer);
    if (newSig && newSig === lastCommittedSigRef.current) {
      logPipelineEventHelper('duplicate_commit_skipped', { signature: newSig });
      return prev;
    }
    lastCommittedSigRef.current = newSig;
    marineRevision.current += 1;
    data.__commitRevision = marineRevision.current;
    if (typeof window !== 'undefined' && model === 'GFS' && layer === 'waves' && timeOffset === 0) {
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__.cacheCommit = {
        committedProductId: data.grid?.productId || data.productId || null,
        committedValidTime: data.grid?.validTime || data.validTime || (typeof getSharedValidTime === 'function' ? getSharedValidTime(0, 'waves', 'GFS') : null),
        committedBounds: data.grid?.bounds || data.bounds || null,
        cacheKey: getViewportHash(),
        cacheSource: data.__provider || data.grid?.__provider || 'network',
        didRejectStaleRegional: true,
        didClearPreviousRegionalBeforeViewport: true,
        commitRevision: marineRevision.current,
        timeOffsetHours: timeOffset
      };
      if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
        window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
      }
    }
    return data;
  });

  requestAnimationFrame(() => { isCommittingDataRef.current = false; });
  if (internalUpdateTimerRef.current) clearTimeoutFunc(internalUpdateTimerRef.current);
  internalUpdateTimerRef.current = setTimeoutFunc(() => { isInternalMapUpdateRef.current = false; }, 800);

  scheduleSWRRevalidation(data, (src) => {
    updateMarineGrid(src);
  });
}

