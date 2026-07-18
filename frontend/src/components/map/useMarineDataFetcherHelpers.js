// Display/serve maxima: the furthest hour each model is requested under its OWN identity
// before falling back. EURO marine is native to 240h and serves backend-conformed ESTIMATED
// products from 241..336h (240 native + 96 estimated), so the display max is 336h — matching
// capabilities.max_forecast_hours. (The native/estimate boundary, 240h, lives in the backend
// estimator + capabilities; post-240 EURO products stay model=EURO, provider=estimated.)
import { getMarineSeriesFrame } from './marineGridSeries';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';
import { shouldShortCircuitSameProductCommit } from './marineCommitShortCircuit';
import { recordMarineEvent } from './marineForensics';

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
  const isViewportZoomedOut = (zoom <= MARINE_ZOOMED_OUT_MAX_ZOOM) || (vpWidth > 15.0 || vpHeight > 15.0);

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
    // COVERAGE-ALIGNED (2026-07-05): same exemption as the display gate (Fix A) + the useMarineWindData
    // conform — a regional COVERING ≥0.8 of the viewport is display-acceptable at zoomed-out (the mid
    // tier commits covering clipped grids at z5-7); only a non-covering regional clears. Same levers.
    const _coverFrac = (typeof window !== 'undefined' && Number(window.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.8;
    const _coverAlignOff = (typeof window !== 'undefined' && window.__RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__ === true);
    const _zoomedOutClear = _coverAlignOff
      ? (!isContained || gridWidth < 340.0 || overlapRatio < 0.15)
      : (overlapRatio < _coverFrac);
    shouldClear = isGlobalSupported
      ? (isViewportZoomedOut ? _zoomedOutClear : (overlapWidth <= 0 || intSouth >= intNorth))
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
      // RETAIN-STALE, don't null (2026-07-04, user-reported zoom flash): setMarineData(null) blanked
      // the heatmap for the window between the null-clear and the replacement commit — the only spot
      // in the pipeline that cleared BEFORE the successor existed (everywhere else "retains stale view
      // while fetching"). Stamping stale keeps the old grid rendering at its true geo bounds (plus the
      // BLEND-BOTH coarse base beneath it) while forcing the refetch exactly like the null did: the
      // dedup gates read marineData.stale/grid.stale (bypassDedupe) and the sig ledger is reset below.
      setMarineData(prev => {
        if (!prev) return prev;
        // Stamp ONCE: while the viewport stays outside the tile, every updateMarineGrid invocation
        // re-enters here — returning the same object keeps React state identity stable (no render
        // churn, no re-upload retriggers) until the covering grid actually replaces it.
        if (prev.stale && prev.grid?.stale) return prev;
        console.log('[Marine-Bounds-Clear] Viewport left the regional grid — stamping STALE (view retained while the covering grid fetches).');
        return {
          ...prev,
          stale: true,
          grid: prev.grid ? { ...prev.grid, stale: true, staleReason: 'viewport_left_regional_bounds' } : prev.grid
        };
      });
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
  // COMMIT-STAMP INVARIANT (2026-07-18, structural #3): every frame this choke commits carries
  // its hour + lane provenance. A missing hourOffset reads as "rendered hour=undefined" in the
  // scrub-settle verification, which then re-drives a fetch loop against whatever the cache
  // serves — the z6.5 band-flap driver (probe_flavor_loss). Series commits are stamped by
  // stampSeriesCommit; this covers the DIRECT lane (all return paths below).
  if (data) {
    if (data.grid && data.grid.hourOffset === undefined) data.grid.hourOffset = timeOffset;
    if (data.hourOffset === undefined) data.hourOffset = timeOffset;
    data.__commitLane = source || 'direct';
  }
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
  // ── Inverse-guard the zoom-out heatmap ping-pong (live-test 2026-06-30) ──
  // A STALE global-COARSE single-/grid frame (width ≥ 340°, e.g. 37×17) committed on moveend/zoom-out
  // texture-realloc-clobbers the covering REGIONAL series frame (e.g. 11×9) for the same viewport → the
  // "heatmap clears on zoom out" flicker (the documented single-grid↔series dimension ping-pong). When a
  // COVERING REGIONAL series frame already exists for this viewport+hour, commit IT instead so the two
  // paths agree on grid dimensions (no realloc). Non-scrub only (scrub keeps its own anti-flicker guard
  // below). SAFE: only ever redirects to a known-covering REGIONAL frame — never blanks; on any miss it
  // falls straight through to the normal commit. Kill switch: window.__RAW_DISABLE_PINGPONG_GUARD__ = true.
  try {
    const _incomingStale = !!(data?.stale || data?.grid?.stale);
    const _dgb = data?.grid?.bounds;
    const _dW = _dgb ? ((_dgb.east < _dgb.west) ? (_dgb.east + 360 - _dgb.west) : (_dgb.east - _dgb.west)) : 0;
    const _guardOff = (typeof window !== 'undefined' && window.__RAW_DISABLE_PINGPONG_GUARD__ === true);
    if (!_guardOff && source !== 'timeline_scrub' && _incomingStale && _dW >= 340.0 && bounds
        && typeof getMarineSeriesFrame === 'function') {
      const _sf = getMarineSeriesFrame(model, layer, bounds, timeOffsetRef.current);
      const _sfb = _sf && _sf.grid && _sf.grid.bounds;
      if (_sfb && _sf.grid.vectors && _sf.grid.vectors.length > 0) {
        const _sfW = (_sfb.east < _sfb.west) ? (_sfb.east + 360 - _sfb.west) : (_sfb.east - _sfb.west);
        if (_sfW < 340.0) { // a covering REGIONAL series frame — prefer it over the stale coarse-global
          const _sig = _marineDataSignature(_sf, layer);
          consecutiveFailuresRef.current = 0; locks.lastHash = getViewportHash(); locks.lastTime = Date.now();
          // Dedup with BOTH authorities agreeing (2026-07-03), same as the main commit path: the side
          // ledger alone wedged when it diverged from state (an engine-rejected commit records its
          // sig) — and this path returns without committing at all; prev-sig alone would break the
          // ledger-null recovery hatch.
          setMarineData(prev => {
            const _prevSig = prev ? (prev.__committedSig || _marineDataSignature(prev, prev?.grid?.__componentLayer || layer)) : null;
            if (!_sig || (_sig === _prevSig && _sig === lastCommittedSigRef.current)) return prev;
            lastCommittedSigRef.current = _sig;
            marineRevision.current += 1;
            _sf.__commitRevision = marineRevision.current;
            _sf.__committedSig = _sig;
            logPipelineEventHelper('pingpong_guard_series_preferred', { model, layer, hour: timeOffset, coarseW: Math.round(_dW), seriesW: Math.round(_sfW) });
            return _sf;
          });
          return;
        }
      }
    }
  } catch (e) { /* fall through to the normal commit */ }

  consecutiveFailuresRef.current = 0; locks.lastHash = getViewportHash(); locks.lastTime = Date.now();

  logPipelineEventHelper('data_committed', { model, layer, hour: timeOffset, provider: data?.grid?.__provider, vectorCount: data?.grid?.vectors?.length || 0,
    ...(data?.grid?.frame_substituted ? { frameOff: data.grid.frame_offset_hours } : {}) });
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
    // §7g-β COMMIT SHORT-CIRCUIT (2026-07-14): a re-clip of the SAME product+run_time whose
    // bounds the resident already contains adds zero information — committing it would only buy
    // a texture re-upload + mask rebuild + particle churn (the round-12 per-gesture mid-clip
    // churn). Every provability check (incl. the run_time data-revision component that the
    // falsified §4.5 dedup lacked, and the ledger-agreement escape hatch) lives in the pure
    // helper. Kill: window.__RAW_DISABLE_COMMIT_SHORT_CIRCUIT__ = true.
    if (hasNewValidData && hasPrevValidData && isSameModelAndLayer) {
      const _sc = shouldShortCircuitSameProductCommit({
        disabled: typeof window !== 'undefined' && window.__RAW_DISABLE_COMMIT_SHORT_CIRCUIT__ === true,
        prev, incoming: data, lastCommittedSig: lastCommittedSigRef.current,
      });
      if (_sc) {
        logPipelineEventHelper('commit_short_circuit', _sc);
        recordMarineEvent('commit_short_circuit', _sc);
        if (typeof window !== 'undefined') {
          const sc = window.__MARINE_COMMIT_SHORT_CIRCUIT__ || (window.__MARINE_COMMIT_SHORT_CIRCUIT__ = { count: 0 });
          sc.count++;
          sc.last = { ..._sc, ts: Date.now() };
        }
        return prev;
      }
    }
    const newSig = _marineDataSignature(data, layer);
    // Duplicate test needs BOTH authorities to agree (2026-07-03 audit):
    //  • prev state's own signature — the ledger alone records commits the ENGINE may still reject
    //    downstream (no-downgrade guard racing a stale _lastZoom); ledger≠state wedged the display
    //    permanently (3Hz×40min dup-skip loop + stranded 3° regional at band zoom, twice tonight).
    //  • the ledger — recovery paths (engine-empty §2b, toggle re-feed, model switch) deliberately
    //    NULL it to force an identical-content re-commit through; skipping on prev-sig alone would
    //    break that escape hatch (a re-fetched identical product must re-fire the upload effect).
    // Skip only when the content matches state AND no invalidation is pending — either disagreeing
    // lets the commit through, and a wrong pass costs one redundant upload, never a wedge.
    const prevSig = prev ? (prev.__committedSig || _marineDataSignature(prev, prevLayer)) : null;
    if (newSig && newSig === prevSig && newSig === lastCommittedSigRef.current) {
      logPipelineEventHelper('duplicate_commit_skipped', { signature: newSig });
      return prev;
    }
    lastCommittedSigRef.current = newSig;
    data.__committedSig = newSig;
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

  // Clear the commit lock after the commit's render frame. NOT via rAF alone: rAF PAUSES when the
  // tab is hidden (and can be starved under load), which strands isCommittingDataRef true — and
  // while it's true updateMarineGridCore early-returns on every NON-scrub fetch (model/layer switch,
  // activation, moveend, pan), wedging the heatmap on stale data until a scrub. The setTimeout
  // fallback fires even when hidden (throttled to ~1s). On a visible tab the rAF wins (~16ms) so the
  // timeout is a redundant no-op and timing is unchanged.
  requestAnimationFrame(() => { isCommittingDataRef.current = false; });
  setTimeoutFunc(() => { isCommittingDataRef.current = false; }, 1500);
  if (internalUpdateTimerRef.current) clearTimeoutFunc(internalUpdateTimerRef.current);
  internalUpdateTimerRef.current = setTimeoutFunc(() => { isInternalMapUpdateRef.current = false; }, 800);

  scheduleSWRRevalidation(data, (src) => {
    updateMarineGrid(src);
  });
}


// §4.3 PAN-REPLAY (2026-07-13, round-12 pt4 — the "pan half a screen before the heatmap
// renders" live report): the same-target dedup (never abort model/layer/hour duplicates —
// the activation multi-trigger / abort-murder-loop rule) used to DROP a moved-viewport
// request on the floor. The panned-over area then sat on the old tile until the next
// gesture or the 3s render backstop. When the CURRENT viewport hash differs from the
// in-flight request's boundsKey, buffer the intent instead: updateMarineGrid's completion
// replay (its finally block) re-fires for the current viewport the moment the in-flight
// fetch lands. Same-viewport duplicates still skip WITHOUT buffering (boundsKey matches),
// so the replay can never self-feed; the rate limiter is bypassed naturally because a moved
// viewport resets locks.lastTime. NO aborts on any path.
// Kill: window.__RAW_PAN_REPLAY_DISABLED__ = true. Telemetry: inflight_skip.panMoved +
// pipeline event 'intent_buffered_panmoved'.
export function bufferPanMovedReplay({
  inflight, currentViewportHash, getViewportHash, source, model, layer, hour,
  pendingMarineIntentRef, logPipelineEventHelper, win,
}) {
  const w = win !== undefined ? win : (typeof window !== 'undefined' ? window : undefined);
  if (w && w.__RAW_PAN_REPLAY_DISABLED__ === true) return false;
  let cur = currentViewportHash;
  if (cur === undefined && typeof getViewportHash === 'function') {
    try { cur = getViewportHash(); } catch (e) { cur = null; } // map torn down mid-timer
  }
  if (!inflight || !inflight.boundsKey || !cur) return false;
  if (inflight.boundsKey === cur) return false;
  const src = String(source || 'unknown');
  const intent = {
    source: src.includes('_panmoved') ? src : `${src}_panmoved`,
    model, layer, hour, timestamp: Date.now(),
  };
  pendingMarineIntentRef.current = intent;
  if (typeof logPipelineEventHelper === 'function') logPipelineEventHelper('intent_buffered_panmoved', intent);
  return true;
}
