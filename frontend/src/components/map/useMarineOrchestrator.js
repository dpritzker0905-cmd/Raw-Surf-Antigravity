import { useRef, useEffect, useMemo } from 'react';
import { getMarineHourlyCache, extractMarineAtOffset, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { getBackendCopernicusFlag, getBackendWeatherFlag, getBackendIconMarineFlag, getSharedValidTime } from './backendWeatherServiceClient';
import { findClosestHourIndex } from './marineControllerUtils';
import { computeGridContentHash } from './marineGridHash';
import { _marineDataSignature } from './useMarineOrchestratorDiag';
import { recordTruthStage, resetTruthTracker } from './weatherTruthTracker';
import { useMarineDataFetcher } from './useMarineDataFetcher';
import { beginTransition, endCurrentTransition, recordChurn } from './marineTransitionCoordinator';
import { ensureMarineSeries, getMarineSeriesFrame } from './marineGridSeries';

// Module-level scrub log throttle (max once per 2s)
let _lastMarineScrubLogTime = 0;

// Coalescing window for model/layer SWITCH fetches. The timer resets on every switch, so a
// burst of clicks collapses into ONE fetch once the user pauses for this long. 300ms was
// shorter than a typical explore-click interval (~0.4-0.7s), so each click fired its own
// fetch → abort-and-clear storm (blank flashes). 600ms absorbs normal rapid toggling while
// staying imperceptible for a single deliberate switch. (Does NOT touch the 150ms scrub
// coalescing or engine residency.)
const SWITCH_FETCH_COALESCE_MS = 600;

export function useMarineOrchestrator({ mapInstance, activeLayers, timeOffsetHours = 0, activeModel = 'GFS' }) {
  const timeOffsetRef = useRef(timeOffsetHours);
  const activeModelRef = useRef(activeModel);

  const activeMarineLayer = useMemo(() => {
    const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
    return activeLayers.find(l => MARINE_LAYERS.includes(l)) || null;
  }, [activeLayers]);
  const activeMarineLayerRef = useRef(activeMarineLayer);
  const prevTimeOffsetRef = useRef(timeOffsetHours);

  // Synchronously update refs during render to prevent effect race conditions
  activeModelRef.current = activeModel;
  activeMarineLayerRef.current = activeMarineLayer;

  useEffect(() => { if (typeof window !== 'undefined') window.activeModel = activeModel; }, [activeModel]);
  useEffect(() => { if (typeof window !== 'undefined') window.activeMarineLayer = activeMarineLayer || 'waves'; }, [activeMarineLayer]);
  useEffect(() => { if (typeof window !== 'undefined') window.activeTimeOffsetHours = timeOffsetHours; }, [timeOffsetHours]);

  // Churn instrumentation: record every activeMarineLayer flip. A flip to/from null
  // unmounts <WebGLMarineLayer> (gated on !!activeMarineLayer in MapWebGL) and tears down
  // the WebGL + foam engines, so `toNull`/`fromNull` flips are the engine-remount smoking gun.
  const churnPrevLayerRef = useRef(activeMarineLayer);
  useEffect(() => {
    const prev = churnPrevLayerRef.current;
    if (prev !== activeMarineLayer) {
      recordChurn('active_layer_flip', { from: prev, to: activeMarineLayer, toNull: !activeMarineLayer, fromNull: !prev });
      churnPrevLayerRef.current = activeMarineLayer;
    }
  }, [activeMarineLayer]);

  const lastFetchedLayerRef = useRef(null);
  const layerFetchTimeoutRef = useRef(null);
  const modelFetchTimeoutRef = useRef(null);
  const activationTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (layerFetchTimeoutRef.current) clearTimeout(layerFetchTimeoutRef.current);
      if (modelFetchTimeoutRef.current) clearTimeout(modelFetchTimeoutRef.current);
      if (activationTimeoutRef.current) clearTimeout(activationTimeoutRef.current);
    };
  }, []);

  const {
    marineData,
    setMarineData,
    marineRevision,
    activeMarineLayersRef,
    marineFetchLocksRef,
    manualMarineTriggerRef,
    isCommittingDataRef,
    isInternalMapUpdateRef,
    internalUpdateTimerRef,
    lastUserInteractionRef,
    lastStableCameraRef,
    updateMarineGridRef,
    consecutiveFailuresRef,
    lastFetchedModelRef,
    pipelineEventsRef,
    lastCommittedSigRef,
    moveendDebounceRef,
    getViewportHash,
    logPipelineEventHelper,
    enqueueMarineUpdate
  } = useMarineDataFetcher({
    mapInstance,
    activeLayers,
    activeMarineLayer,
    activeMarineLayerRef,
    timeOffsetHours,
    timeOffsetRef,
    activeModel,
    activeModelRef
  });

  const hasMarineLayers = useMemo(() => {
    return ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayers.includes(l));
  }, [activeLayers]);
  activeMarineLayersRef.current = hasMarineLayers;

  // Open a transition during render if model/layer changes, BEFORE the child WebGL layer
  // can clear buffers. beginTransition is idempotent on {model,layer} and ownership-tracked
  // (a stale fetch can no longer end a newer transition), so a render-phase call is safe
  // under repeated/StrictMode renders.
  if (typeof window !== 'undefined' && activeMarineLayersRef.current) {
    const modelChanged = lastFetchedModelRef.current !== null && lastFetchedModelRef.current !== activeModel;
    const layerChanged = lastFetchedLayerRef.current !== null && lastFetchedLayerRef.current !== activeMarineLayer;
    if (modelChanged || layerChanged) {
      beginTransition({ model: activeModel, layer: activeMarineLayer || 'waves', hour: timeOffsetHours });
    }
  }

  const hasActivatedRef = useRef(false);

  useEffect(() => {
    const handleRejection = (event) => {
      const reason = event.reason;
      let message = 'Unknown';
      let stack = '';
      if (reason) {
        message = reason.message || String(reason);
        stack = reason.stack || '';
      }
      const activeRequestStatus = window.__MARINE_FETCH_PENDING__ ? 'pending' : 'idle';
      const lastEvents = pipelineEventsRef.current || [];
      const lastEvent = lastEvents[lastEvents.length - 1];
      window.__UNHANDLED_PROMISE_DIAG__ = {
        reason: reason,
        message: message,
        stack: stack,
        model: activeModelRef.current,
        layer: activeMarineLayerRef.current || 'waves',
        hour: timeOffsetRef.current,
        activeRequestStatus: activeRequestStatus,
        lastMarinePipelineEvent: lastEvent ? lastEvent.event : 'none',
        timestamp: new Date().toISOString()
      };
      console.error('[Unhandled Promise Rejection Captured]', window.__UNHANDLED_PROMISE_DIAG__);
    };
    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  const activeLayersKey = useMemo(() => activeLayers.join(','), [activeLayers]);
  const prevActiveLayersRef = useRef('');

  useEffect(() => {
    if (prevActiveLayersRef.current === activeLayersKey) return;
    prevActiveLayersRef.current = activeLayersKey;
    const hasMarine = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayersKey.includes(l));
    if (!hasMarine) {
      hasActivatedRef.current = false;
    } else if (!hasActivatedRef.current) {
      hasActivatedRef.current = true;
      console.log('[Marine] Layer activated, triggering manual fetch...');
      marineFetchLocksRef.current.lastHash = null; marineFetchLocksRef.current.lastTime = 0;
      consecutiveFailuresRef.current = 0;
      manualMarineTriggerRef.current?.();
    }
  }, [activeLayersKey]);

  useEffect(() => {
    if (!hasMarineLayers) {
      setMarineData(null);
      lastCommittedSigRef.current = null;
      if (typeof window !== 'undefined') {
        window.__MARINE_HEATMAP_STATUS__ = null;
      }
    }
  }, [hasMarineLayers, setMarineData]);

  useEffect(() => {
    if (!mapInstance) return;

    manualMarineTriggerRef.current = () => enqueueMarineUpdate('manual');

    const onMoveEnd = () => {
      if (window.isScrubbingTimeline) return;

      let b = null;
      try {
        b = mapInstance.getBounds();
      } catch (e) {
        return;
      }
      if (!b || Math.abs(b.getEast() - b.getWest()) < 0.01 || Math.abs(b.getNorth() - b.getSouth()) < 0.01) {
        return; // Degenerate bounds, skip setting stable camera and return early
      }

      const center = mapInstance.getCenter(), zoom = mapInstance.getZoom(), cameraHash = `${center.lng.toFixed(3)}:${center.lat.toFixed(3)}:${zoom.toFixed(2)}`;
      if (lastStableCameraRef.current === cameraHash) return;
      lastStableCameraRef.current = cameraHash;

      if (typeof window !== 'undefined') {
        window.__MARINE_FETCH_DEBOUNCING__ = true;
      }

      let isCached = false;
      try {
        const bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
        isCached = isContainedInMarineCache(bounds, activeModelRef.current, timeOffsetRef.current, activeMarineLayerRef.current || 'waves');
      } catch (e) {
        isCached = false;
      }
      
      const debounceTime = isCached ? 50 : 900;
      clearTimeout(moveendDebounceRef.current.timer);
      moveendDebounceRef.current.timer = setTimeout(() => { enqueueMarineUpdate('moveend'); }, debounceTime);
    };

    const trackIntent = () => { lastUserInteractionRef.current = Date.now(); };
    ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => mapInstance.on(e, trackIntent));

    const onMapInternalUpdate = () => {
      isInternalMapUpdateRef.current = true;
      clearTimeout(internalUpdateTimerRef.current);
      internalUpdateTimerRef.current = setTimeout(() => { isInternalMapUpdateRef.current = false; }, 500);
    };
    const setDebouncingTrue = () => {
      if (typeof window !== 'undefined') {
        window.__MARINE_FETCH_DEBOUNCING__ = true;
      }
    };
    mapInstance.on('zoom', setDebouncingTrue);
    mapInstance.on('move', setDebouncingTrue);
    mapInstance.on('sourcedata', onMapInternalUpdate);
    mapInstance.on('styledata', onMapInternalUpdate);
    mapInstance.on('moveend', onMoveEnd);
    mapInstance.on('resize', onMoveEnd);

    const onLoad = () => {
      mapInstance.off('load', onLoad);
      if (activeMarineLayersRef.current) enqueueMarineUpdate('load');
    };

    if (activeMarineLayersRef.current) {
      if (mapInstance.loaded()) {
        enqueueMarineUpdate('mount');
      } else {
        mapInstance.on('load', onLoad);
      }
    }

    return () => {
      if (moveendDebounceRef.current.timer) clearTimeout(moveendDebounceRef.current.timer);
      if (internalUpdateTimerRef.current) clearTimeout(internalUpdateTimerRef.current);
      ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => mapInstance.off(e, trackIntent));
      mapInstance.off('zoom', setDebouncingTrue);
      mapInstance.off('move', setDebouncingTrue);
      mapInstance.off('sourcedata', onMapInternalUpdate);
      mapInstance.off('styledata', onMapInternalUpdate);
      mapInstance.off('moveend', onMoveEnd);
      mapInstance.off('resize', onMoveEnd);
      mapInstance.off('load', onLoad);
      manualMarineTriggerRef.current = null;
    };
  }, [mapInstance, enqueueMarineUpdate]);

  useEffect(() => {
    const prev = prevTimeOffsetRef.current; prevTimeOffsetRef.current = timeOffsetHours;
    timeOffsetRef.current = timeOffsetHours;
    if (prev === timeOffsetHours) return;
    if (!mapInstance || !activeMarineLayersRef.current) return;

    let selectedApiTimestamp = 'none';
    let selectedIndex = -1;
    let cacheStartStr = 'none';
    let cacheEndStr = 'none';
    let cacheForecastDays = 0;
    let coverageRejected = false;
    let extractedGrid = null;
    let curModel = activeModelRef.current || 'GFS';
    let curLayer = activeMarineLayerRef.current || 'waves';
    const isWaves = (curLayer === 'waves');
    const nativeLimit = 240;
    if (curModel === 'ICON' && timeOffsetHours > 168) {
      curModel = 'GFS';
    } else if (curModel === 'EURO' && timeOffsetHours > nativeLimit) {
      curModel = 'GFS';
    }
    const isGfsBackend = getBackendWeatherFlag() && (curModel === 'GFS' || !curModel);
    const isIconBackend = getBackendIconMarineFlag() && curModel === 'ICON';
    const isCopernicusBackend = getBackendCopernicusFlag() && curModel === 'EURO';
    const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

    let vpBounds = null;
    try {
      const b = mapInstance.getBounds();
      vpBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    } catch (e) {
      vpBounds = null;
    }

    if (isBackendActive) {
      let cachedBackendData = getModelSafeMarine(curModel, timeOffsetHours, curLayer, vpBounds);
      // Option 1 (flag-gated): when the per-hour cache misses, try the pre-loaded
      // multi-hour SERIES so scrubbing tracks the requested hour instantly. Commits
      // through the SAME path below (parity/transition gates unchanged). Off by default.
      if (!cachedBackendData) {
        const seriesFrame = getMarineSeriesFrame(curModel, curLayer, vpBounds, timeOffsetHours);
        if (seriesFrame) cachedBackendData = seriesFrame;
      }
      
      let isRegional = false;
      let isViewportZoomedOut = false;
      const currentZoom = mapInstance.getZoom();
      let vpWidth = 0;
      let vpHeight = 0;
      if (vpBounds) {
        const ew = vpBounds.east, ew_w = vpBounds.west;
        vpWidth = (ew < ew_w) ? (ew + 360) - ew_w : ew - ew_w;
        vpHeight = Math.abs(vpBounds.north - vpBounds.south);
      }
      isViewportZoomedOut = (currentZoom <= 6.5) || (vpWidth > 15.0 || vpHeight > 15.0);

      let isGridWidthRegional = false;
      let isContained = true;

      if (cachedBackendData) {
        const prodId = cachedBackendData.product_id || cachedBackendData.productId;
        const regionId = cachedBackendData.region_id || cachedBackendData.regionId || cachedBackendData.grid?.region_id || cachedBackendData.grid?.regionId;
        const coverageMode = cachedBackendData.coverage_mode || cachedBackendData.coverageMode || cachedBackendData.grid?.coverage_mode || cachedBackendData.grid?.coverageMode;
        const isDynamic = !!(cachedBackendData.is_dynamic_viewport_product || cachedBackendData.isDynamicViewportProduct || cachedBackendData.grid?.is_dynamic_viewport_product || cachedBackendData.grid?.isDynamicViewportProduct);

        const actualBounds = cachedBackendData.grid?.bounds || cachedBackendData.bounds;
        if (actualBounds) {
          const gw = actualBounds.west, ge = actualBounds.east, gs = actualBounds.south, gn = actualBounds.north;
          const gridWidth = (ge < gw) ? (ge + 360) - gw : ge - gw;
          isGridWidthRegional = gridWidth < 340.0;

          if (isGridWidthRegional && vpBounds) {
            const ew = vpBounds.west, ee = vpBounds.east, es = vpBounds.south, en = vpBounds.north;
            
            let vWest = ew;
            let vEast = ee;
            if (vEast < vWest) vEast += 360;

            let gWest = gw;
            let gEast = ge;
            if (gEast < gWest) gEast += 360;

            isContained = es >= gs && en <= gn && vWest >= gWest && vEast <= gEast;
          }
        }

        isRegional = prodId && (
          prodId.includes('florida_east_coast') ||
          coverageMode === 'regional_tile' ||
          (regionId && regionId !== 'global_coarse' && !isDynamic) ||
          (isDynamic && (!isContained || isViewportZoomedOut) && isGridWidthRegional)
        );
      }

      const rejectRegionalCache = isViewportZoomedOut && (isRegional || (isGridWidthRegional && !isContained));

      if (cachedBackendData && cachedBackendData.grid && !cachedBackendData.__staleHour && !rejectRegionalCache) {
        extractedGrid = cachedBackendData.grid;
        const sig = _marineDataSignature(cachedBackendData, curLayer);
        if (sig && sig !== lastCommittedSigRef.current) {
          const evtType = cachedBackendData.grid?.__renderable ? 'local_cache_remap_timeline' : 'local_cache_remap_timeline_no_data';
          const _now = Date.now();
          if (_now - _lastMarineScrubLogTime > 2000) {
            _lastMarineScrubLogTime = _now;
            console.log(`[SCRUB] [BACKEND CACHE] Instant re-index: +${timeOffsetHours}h model=${curModel} layer=${curLayer}`);
          }
          lastCommittedSigRef.current = sig;
          logPipelineEventHelper(evtType, { model: curModel, layer: curLayer, hour: timeOffsetHours, renderable: cachedBackendData.grid?.__renderable });
          marineRevision.current += 1;
          cachedBackendData.__commitRevision = marineRevision.current;

          const vHash = getViewportHash();
          if (vHash) { marineFetchLocksRef.current.lastHash = vHash; marineFetchLocksRef.current.lastTime = Date.now(); }
          if (typeof window !== 'undefined' && curModel === 'GFS' && curLayer === 'waves' && timeOffsetHours === 0) {
            window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
            window.__GFS_WAVES_SINGLE_SLICE_TRACE__.cacheCommit = {
              committedProductId: cachedBackendData.grid?.productId || cachedBackendData.productId || null,
              committedValidTime: cachedBackendData.grid?.validTime || cachedBackendData.validTime || (typeof getSharedValidTime === 'function' ? getSharedValidTime(0, 'waves', 'GFS') : null),
              committedBounds: cachedBackendData.grid?.bounds || cachedBackendData.bounds || null,
              cacheKey: vHash,
              cacheSource: 'backend_cache_scrub',
              didRejectStaleRegional: true,
              didClearPreviousRegionalBeforeViewport: true,
              commitRevision: marineRevision.current,
              timeOffsetHours: timeOffsetHours
            };
            if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
              window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
            }
          }
          setMarineData(cachedBackendData);
        }

        // Fast-path: skip expensive diagnostic construction during active scrub
        if (!window.isScrubbingTimeline) {
          const sampleIndices = [0, 5, 10, 20, 50, 100, 200, 300, 400, 500];
          const samples = sampleIndices.map(idx => {
            const v = extractedGrid?.vectors?.[idx];
            const comp = v?.[curLayer] || v;
            return comp ? { idx, speed: comp.speed || 0, u: comp.u || 0, v: comp.v || 0, period: comp.period || 0 } : { idx, speed: 0, u: 0, v: 0, period: 0 };
          });

          window.__MARINE_SCRUB_DIAG__ = {
            requestedHour: timeOffsetHours,
            targetMs: Date.now() + timeOffsetHours * 3600000,
            selectedApiTimestamp: 'none',
            selectedIndex: -1,
            cacheCoverageStart: 'none',
            cacheCoverageEnd: 'none',
            forecastDays: 1,
            contentHash: computeGridContentHash(extractedGrid, curLayer),
            samples,
            coverageRejected: false,
            timestamp: new Date().toISOString()
          };
        }
        // Do NOT cancel pending deferred fetches — they protect against cache-miss hours
        // that would otherwise never be fetched during rapid scrubbing sequences.
        // The deferred fetch has its own staleness check to self-invalidate if stale.
        return;
      } else {
        // Per-intermediate-hour scrub cache-miss log. The actual grid fetch is coalesced
        // (one fetch at scrub-settle), so this fires once per scrub tick and floods the
        // console without indicating extra work. Gate behind window.__SCRUB_DEBUG__.
        if (typeof window !== 'undefined' && window.__SCRUB_DEBUG__) {
          console.log(`[SCRUB] [BACKEND CACHE] Miss: +${timeOffsetHours}h model=${curModel} layer=${curLayer}. Retaining stale view while fetching.`);
        }
        // DO NOT clear marineData — retain stale heatmap view while the deferred fetch loads
        marineFetchLocksRef.current.lastHash = null;
        if (!window.isScrubbingTimeline) {
          enqueueMarineUpdate('timeline_scrub_deferred');
        }
        return;
      }
    } else {
      const cache = getMarineHourlyCache();
      if (cache?.results?.length && cache.model === curModel && (curModel !== 'EURO' || (cache.activeLayer || 'waves') === curLayer)) {
        const timeArray = cache.results[0]?.hourly?.time;
        const targetMs = Date.now() + timeOffsetHours * 3600000;
        const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
        selectedIndex = idx;
        if (timeArray?.[idx]) {
          selectedApiTimestamp = timeArray[idx];
          const cachedMs = new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').getTime();
          const delta = Math.abs(cachedMs - targetMs);
          if (delta > 3 * 3600000) {
            coverageRejected = true;
          }
        }
        cacheForecastDays = cache.__forecastDays || 0;
        if (cache.__coverageStartMs) cacheStartStr = new Date(cache.__coverageStartMs).toISOString();
        if (cache.__coverageEndMs) cacheEndStr = new Date(cache.__coverageEndMs).toISOString();
      }

      try {
        if (cache?.results?.length && cache.model === curModel && (curModel !== 'EURO' || (cache.activeLayer || 'waves') === curLayer) && !coverageRejected) {
          const data = extractMarineAtOffset(cache, timeOffsetHours, curLayer);
          if (data) {
            extractedGrid = data.grid;
            const sig = _marineDataSignature(data, curLayer);
            if (sig && sig !== lastCommittedSigRef.current) {
              const evtType = data.grid?.__renderable ? 'local_cache_remap_timeline' : 'local_cache_remap_timeline_no_data';
              const _now2 = Date.now();
              if (_now2 - _lastMarineScrubLogTime > 2000) {
                _lastMarineScrubLogTime = _now2;
                console.log(`[SCRUB] [CACHE] Instant re-index: +${timeOffsetHours}h model=${curModel} layer=${curLayer}`);
              }
              lastCommittedSigRef.current = sig; logPipelineEventHelper(evtType, { model: curModel, layer: curLayer, hour: timeOffsetHours, renderable: data.grid?.__renderable });
              marineRevision.current += 1; data.__commitRevision = marineRevision.current;
              
              const vHash = getViewportHash();
              if (vHash) { marineFetchLocksRef.current.lastHash = vHash; marineFetchLocksRef.current.lastTime = Date.now(); }
              setMarineData(data);
            }
            
            // Fast-path: skip expensive diagnostic construction during active scrub
            if (!window.isScrubbingTimeline) {
              const sampleIndices = [0, 5, 10, 20, 50, 100, 200, 300, 400, 500];
              const samples = sampleIndices.map(idx => {
                const v = extractedGrid?.vectors?.[idx];
                const comp = v?.[curLayer] || v;
                return comp ? { idx, speed: comp.speed || 0, u: comp.u || 0, v: comp.v || 0, period: comp.period || 0 } : { idx, speed: 0, u: 0, v: 0, period: 0 };
              });

              window.__MARINE_SCRUB_DIAG__ = {
                requestedHour: timeOffsetHours,
                targetMs: Date.now() + timeOffsetHours * 3600000,
                selectedApiTimestamp,
                selectedIndex,
                cacheCoverageStart: cacheStartStr,
                cacheCoverageEnd: cacheEndStr,
                forecastDays: cacheForecastDays,
                contentHash: computeGridContentHash(extractedGrid, curLayer),
                samples,
                coverageRejected,
                timestamp: new Date().toISOString()
              };
            }
            // Do NOT cancel pending deferred fetches — same rationale as backend cache hit path.
            return;
          }
        }
      } catch (e) { console.warn('[CACHE] Local timeline re-index failed:', e.message); }
    }

    if (coverageRejected) {
      let renderedHour = timeOffsetHours;
      if (cache?.results?.[0]?.hourly?.time) {
        const timeArray = cache.results[0].hourly.time;
        if (timeArray[selectedIndex]) {
          const closestTimeMs = new Date(timeArray[selectedIndex].endsWith('Z') ? timeArray[selectedIndex] : timeArray[selectedIndex] + 'Z').getTime();
          renderedHour = Math.round((closestTimeMs - Date.now()) / 3600000);
        }
      }
      const statusVal = isBackendActive
        ? (curModel === 'EURO' ? 'no_copernicus_coverage' : 'no_backend_coverage')
        : 'retained_previous_hour_warning';
      window.__MARINE_HEATMAP_STATUS__ = {
        status: statusVal,
        requestedHour: timeOffsetHours,
        renderedHour: renderedHour,
        coverageRejected: true,
        retainedPrevious: true,
        blockedReason: 'cache_coverage_exceeded'
      };
    } else {
      if (window.__MARINE_HEATMAP_STATUS__?.status === 'retained_previous_hour_warning' ||
          window.__MARINE_HEATMAP_STATUS__?.status === 'no_copernicus_coverage' ||
          window.__MARINE_HEATMAP_STATUS__?.status === 'no_backend_coverage') {
        window.__MARINE_HEATMAP_STATUS__ = null;
      }
    }

    // Skip diagnostic construction during active scrub — only update on settle
    if (!window.isScrubbingTimeline) {
      window.__MARINE_SCRUB_DIAG__ = {
        requestedHour: timeOffsetHours,
        targetMs: Date.now() + timeOffsetHours * 3600000,
        selectedApiTimestamp,
        selectedIndex,
        cacheCoverageStart: cacheStartStr,
        cacheCoverageEnd: cacheEndStr,
        forecastDays: cacheForecastDays,
        contentHash: 0,
        samples: [],
        coverageRejected,
        timestamp: new Date().toISOString()
      };
    }

    const _now3 = Date.now();
    if (_now3 - _lastMarineScrubLogTime > 2000) {
      _lastMarineScrubLogTime = _now3;
      console.log(`[CACHE] [Marine] Cache miss for hour +${timeOffsetHours}h. Suppressing network fetch while scrubbing; safety net will fetch on settle.`);
    }
    marineFetchLocksRef.current.lastHash = null;
    if (!window.isScrubbingTimeline) {
      if (updateMarineGridRef.current) {
        updateMarineGridRef.current('timeline_scrub');
      }
    }
  }, [timeOffsetHours, mapInstance]);

  useEffect(() => {
    if (!mapInstance || !activeMarineLayersRef.current) return;
    if (lastFetchedModelRef.current === activeModel) return;

    // Immediately open an ownership-tracked transition for responsiveness.
    beginTransition({ model: activeModel, layer: activeMarineLayerRef.current || 'waves', hour: timeOffsetRef.current, viewportKey: getViewportHash?.() });

    // Coalesce rapid model switches (e.g. GFS→EURO→ICON in quick succession).
    // Only the final model in the sequence will execute the full reset + fetch logic.
    // This prevents the abort cascade where intermediate fetches get killed.
    if (modelFetchTimeoutRef.current) clearTimeout(modelFetchTimeoutRef.current);
    modelFetchTimeoutRef.current = setTimeout(() => {
      modelFetchTimeoutRef.current = null;
      // Verify this is still the target model after the coalescing window
      if (activeModelRef.current !== activeModel) return;

      lastFetchedModelRef.current = activeModel; lastFetchedLayerRef.current = null;
      console.log(`[MODEL] [Marine] Active model changed to ${activeModel}, triggering manual fetch...`);
      resetTruthTracker(`model_switch_to_${activeModel}`);
      lastCommittedSigRef.current = null;
      marineFetchLocksRef.current.lastHash = null; marineFetchLocksRef.current.lastTime = 0;
      manualMarineTriggerRef.current?.();
    }, SWITCH_FETCH_COALESCE_MS);
  }, [activeModel, mapInstance, setMarineData]);

  useEffect(() => {
    if (!mapInstance || !activeMarineLayer) return;
    if (lastFetchedLayerRef.current === activeMarineLayer) return;

    // Immediately open an ownership-tracked transition for responsiveness.
    beginTransition({ model: activeModelRef.current || 'GFS', layer: activeMarineLayer, hour: timeOffsetRef.current, viewportKey: getViewportHash?.() });

    // Coalesce rapid layer switches (e.g. waves→swell_1→swell_2→wind_waves in quick
    // succession). Only the final layer in the sequence will execute the full
    // cache-lookup + fetch logic. This prevents the abort cascade where each
    // intermediate Copernicus/ICON fetch gets killed before completing.
    if (layerFetchTimeoutRef.current) clearTimeout(layerFetchTimeoutRef.current);
    layerFetchTimeoutRef.current = setTimeout(() => {
      layerFetchTimeoutRef.current = null;
      // Verify this is still the target layer after the coalescing window
      if (activeMarineLayerRef.current !== activeMarineLayer) return;

    resetTruthTracker(`layer_switch_to_${activeMarineLayer}`);
    lastCommittedSigRef.current = null;

    let vpBounds = null;
    try {
      const b = mapInstance.getBounds();
      if (b && Math.abs(b.getEast() - b.getWest()) > 0.01 && Math.abs(b.getNorth() - b.getSouth()) > 0.01) {
        vpBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
      }
    } catch (e) {
      vpBounds = null;
    }

    let curModel = activeModelRef.current || 'GFS';
    const isWaves = (activeMarineLayer === 'waves');
    const nativeLimit = 240;
    if (curModel === 'ICON' && timeOffsetHours > 168) {
      curModel = 'GFS';
    } else if (curModel === 'EURO' && timeOffsetHours > nativeLimit) {
      curModel = 'GFS';
    }
    const isGfsBackend = getBackendWeatherFlag() && (curModel === 'GFS' || !curModel);
    const isIconBackend = getBackendIconMarineFlag() && curModel === 'ICON';
    const isCopernicusBackend = getBackendCopernicusFlag() && curModel === 'EURO';
    const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

    if (isBackendActive) {
      try {
        const cached = getModelSafeMarine(curModel, timeOffsetHours, activeMarineLayer, vpBounds);
        if (cached && cached.grid && !cached.__staleHour) {
          const prodId = cached.product_id || cached.productId;
          const regionId = cached.region_id || cached.regionId || cached.grid?.region_id || cached.grid?.regionId;
          const coverageMode = cached.coverage_mode || cached.coverageMode || cached.grid?.coverage_mode || cached.grid?.coverageMode;
          const isDynamic = !!(cached.is_dynamic_viewport_product || cached.isDynamicViewportProduct || cached.grid?.is_dynamic_viewport_product || cached.grid?.isDynamicViewportProduct);

          let vpWidth = 0;
          let vpHeight = 0;
          if (vpBounds) {
            const ew = vpBounds.east, ew_w = vpBounds.west;
            vpWidth = (ew < ew_w) ? (ew + 360) - ew_w : ew - ew_w;
            vpHeight = Math.abs(vpBounds.north - vpBounds.south);
          }
          const currentZoom = mapInstance.getZoom();
          const isViewportZoomedOut = (currentZoom <= 6.5) || (vpWidth > 15.0 || vpHeight > 15.0);

          const actualBounds = cached.grid?.bounds || cached.bounds;
          let isGridWidthRegional = false;
          let isContained = true;
          if (actualBounds) {
            const gw = actualBounds.west, ge = actualBounds.east, gs = actualBounds.south, gn = actualBounds.north;
            const gridWidth = (ge < gw) ? (ge + 360) - gw : ge - gw;
            isGridWidthRegional = gridWidth < 340.0;

            if (isGridWidthRegional && vpBounds) {
              const ew = vpBounds.west, ee = vpBounds.east, es = vpBounds.south, en = vpBounds.north;
              
              let vWest = ew;
              let vEast = ee;
              if (vEast < vWest) vEast += 360;

              let gWest = gw;
              let gEast = ge;
              if (gEast < gWest) gEast += 360;

              isContained = es >= gs && en <= gn && vWest >= gWest && vEast <= gEast;
            }
          }

          const isRegional = prodId && (
            prodId.includes('florida_east_coast') ||
            coverageMode === 'regional_tile' ||
            (regionId && regionId !== 'global_coarse' && !isDynamic) ||
            (isDynamic && (!isContained || isViewportZoomedOut) && isGridWidthRegional) ||
            (isViewportZoomedOut && !isContained && isGridWidthRegional)
          );
          if (prodId && !isRegional) {
            const sig = _marineDataSignature(cached, activeMarineLayer);
            if (sig) {
              if (sig === lastCommittedSigRef.current) {
                lastFetchedLayerRef.current = activeMarineLayer;
                endCurrentTransition();
                return;
              }
              console.log(`[WEATHER_TRUTH] [Marine] Layer switch backend cache HIT for ${activeMarineLayer}: ${prodId}`);
              lastCommittedSigRef.current = sig;
              marineRevision.current += 1;
              cached.__commitRevision = marineRevision.current;
              
              const vHash = getViewportHash();
              if (vHash) {
                marineFetchLocksRef.current.lastHash = vHash;
                marineFetchLocksRef.current.lastTime = Date.now();
              }
              
              if (window.__GFS_WAVES_SINGLE_SLICE_TRACE__) {
                window.__GFS_WAVES_SINGLE_SLICE_TRACE__.cacheCommit = {
                  committedProductId: prodId,
                  committedValidTime: cached.grid?.validTime || cached.validTime || (typeof getSharedValidTime === 'function' ? getSharedValidTime(0, 'waves', 'GFS') : null),
                  committedBounds: cached.grid?.bounds || cached.bounds || null,
                  cacheKey: vHash,
                  cacheSource: 'backend_cache_switch',
                  didRejectStaleRegional: true,
                  didClearPreviousRegionalBeforeViewport: true,
                  commitRevision: marineRevision.current,
                  timeOffsetHours: timeOffsetHours
                };
                if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
                  window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
                }
              }
              
              setMarineData(cached);
              lastFetchedLayerRef.current = activeMarineLayer;
              endCurrentTransition();
              enqueueMarineUpdate('cancel_scrub');
              return;
            }
          }
        }
      } catch (e) {
        console.warn('[Marine] Backend cache switch lookup failed:', e.message);
      }
      console.log(`[Marine] Layer switch backend cache MISS for ${activeMarineLayer}. Retaining stale view while fetching.`);
    } else {
      if (activeModelRef.current !== 'EURO') {
        try {
          const cache = getMarineHourlyCache();
          if (cache?.results?.length && cache.model === activeModelRef.current) {
            const remapped = extractMarineAtOffset(cache, timeOffsetHours, activeMarineLayer);
            if (remapped?.grid?.vectors?.length > 0) {
              const isRenderable = remapped.grid.__renderable !== false, sig = _marineDataSignature(remapped, activeMarineLayer);
              if (sig && sig === lastCommittedSigRef.current) {
                logPipelineEventHelper('duplicate_commit_skipped', { signature: sig });
                lastFetchedLayerRef.current = activeMarineLayer;
                endCurrentTransition();
                return;
              }
              const evtType = isRenderable ? 'local_cache_remap_renderable' : 'local_cache_remap_no_data';
              console.log(`[Marine] Layer switch to ${activeMarineLayer}: ${evtType}`);
              logPipelineEventHelper(evtType, { model: activeModelRef.current, layer: activeMarineLayer, hour: timeOffsetHours, renderable: isRenderable, noDataReason: remapped.grid.__noDataReason });
              
              lastCommittedSigRef.current = sig; marineRevision.current += 1; remapped.__commitRevision = marineRevision.current;
              const vHash = getViewportHash();
              if (vHash) { marineFetchLocksRef.current.lastHash = vHash; marineFetchLocksRef.current.lastTime = Date.now(); }
 
              setMarineData(remapped); lastFetchedLayerRef.current = activeMarineLayer;
              endCurrentTransition();
              enqueueMarineUpdate('cancel_scrub');
              return;
            }
          }
        } catch (e) { console.warn('[Marine] Cache remap failed:', e.message); }
      }
    }
    
    marineFetchLocksRef.current.lastHash = null; marineFetchLocksRef.current.lastTime = 0;
    manualMarineTriggerRef.current?.();
    }, SWITCH_FETCH_COALESCE_MS); // end coalescing setTimeout — absorbs rapid layer cycling
  }, [activeMarineLayer, mapInstance, setMarineData]);

  useEffect(() => {
    if (marineData && activeModel === 'GFS' && activeMarineLayer === 'waves' && timeOffsetHours === 0) {
      recordTruthStage('orchestratorCommit', {
        model: activeModel,
        domain: 'marine',
        layer: activeMarineLayer,
        valid_time: marineData.valid_time || marineData.validTime,
        run_time: marineData.run_time || marineData.runTime,
        product_id: marineData.product_id || marineData.productId || marineData.grid?.productId,
        is_dynamic_viewport_product: marineData.is_dynamic_viewport_product || marineData.grid?.is_dynamic_viewport_product,
        coverage_scope: marineData.coverage_scope || marineData.grid?.coverage_scope,
        requested_bbox: marineData.requested_bbox || marineData.grid?.requested_bbox,
        served_bbox: marineData.served_bbox || marineData.grid?.served_bbox,
        grid: marineData.grid,
        truthTag: marineData.truthTag || marineData.grid?.truthTag
      }, 'useMarineOrchestrator.js', 'marineData useEffect');
    }
  }, [marineData, activeModel, activeMarineLayer, timeOffsetHours]);

  // Scrub-settle safety net: After scrubbing ends, verify that the marineData
  // matches the current timeOffsetHours. If not, trigger a fresh fetch.
  // This catches edge cases where deferred fetches were lost during rapid scrub sequences.
  const scrubSettleTimerRef = useRef(null);
  useEffect(() => {
    if (!mapInstance || !activeMarineLayersRef.current) return;

    const checkScrubSettle = () => {
      if (window.isScrubbingTimeline) return;
      const currentHour = timeOffsetRef.current;
      const renderedHour = marineData?.grid?.hourOffset ?? marineData?.hourOffset;
      const hourMismatch = renderedHour !== undefined && renderedHour !== null && renderedHour !== currentHour;
      const noData = !marineData || !marineData.grid?.vectors?.length;

      if (hourMismatch || noData) {
        const pending = window.__MARINE_FETCH_PENDING__;
        const isAlreadyFetchingCurrentHour = pending && 
          pending.hour === currentHour &&
          pending.model === activeModelRef.current &&
          pending.layer === (activeMarineLayerRef.current || 'waves');

        if (isAlreadyFetchingCurrentHour) {
          console.log(`[SCRUB-SETTLE] Post-scrub verification: rendered hour=${renderedHour}, requested hour=${currentHour}. Fetch already in-flight for this hour. Bypassing redundant fetch.`);
          return;
        }

        console.log(`[SCRUB-SETTLE] Post-scrub verification: rendered hour=${renderedHour}, requested hour=${currentHour}. Triggering fetch.`);
        marineFetchLocksRef.current.lastHash = null;
        if (updateMarineGridRef.current) {
          updateMarineGridRef.current('timeline_scrub');
        }
      }
    };

    // Listen for scrub-end via a lightweight interval that self-clears
    let wasScrubbingRef = false;
    const intervalId = setInterval(() => {
      const isNowScrubbing = !!window.isScrubbingTimeline;
      if (wasScrubbingRef && !isNowScrubbing) {
        // Scrubbing just ended — delay slightly then verify
        clearTimeout(scrubSettleTimerRef.current);
        scrubSettleTimerRef.current = setTimeout(checkScrubSettle, 150);
      }
      wasScrubbingRef = isNowScrubbing;
    }, 150);

    return () => {
      clearInterval(intervalId);
      clearTimeout(scrubSettleTimerRef.current);
    };
  }, [mapInstance, marineData]);

  // Option 1 (flag-gated): background-load the marine time-series for the active
  // model/layer/viewport so the timeline scrubber can track hours instantly via the
  // series-as-cache-source above. No-op unless window.__MARINE_SERIES__ === true;
  // ensureMarineSeries is deduped + TTL'd so moveend spam is cheap.
  useEffect(() => {
    if (!mapInstance || !activeMarineLayer) return;
    let cancelled = false;
    const controller = new AbortController();
    const kick = () => {
      if (cancelled || !mapInstance) return;
      try {
        const b = mapInstance.getBounds();
        ensureMarineSeries(
          activeModelRef.current,
          activeMarineLayerRef.current,
          { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
          controller.signal
        );
      } catch (e) { /* map not ready — ignore */ }
    };
    const t = setTimeout(kick, 600);
    const onIdle = () => kick();
    mapInstance.on('moveend', onIdle);
    return () => {
      cancelled = true;
      clearTimeout(t);
      controller.abort();
      try { mapInstance.off('moveend', onIdle); } catch (e) { /* ignore */ }
    };
  }, [mapInstance, activeModel, activeMarineLayer]);

  return { marineData };
}

