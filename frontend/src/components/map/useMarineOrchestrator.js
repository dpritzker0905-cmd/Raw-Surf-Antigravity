import { useRef, useEffect, useMemo } from 'react';
import { getMarineHourlyCache, extractMarineAtOffset, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { getBackendCopernicusFlag, getBackendWeatherFlag, getBackendIconMarineFlag, getSharedValidTime } from './backendWeatherServiceClient';
import { findClosestHourIndex } from './marineControllerUtils';
import { computeGridContentHash } from './marineGridHash';
import { _marineDataSignature } from './useMarineOrchestratorDiag';
import { recordTruthStage } from './weatherTruthTracker';
import { useMarineDataFetcher } from './useMarineDataFetcher';

export function useMarineOrchestrator({ mapInstance, activeLayers, timeOffsetHours = 0, activeModel = 'GFS' }) {
  const timeOffsetRef = useRef(timeOffsetHours);
  const activeModelRef = useRef(activeModel);

  const activeMarineLayer = useMemo(() => {
    const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
    return activeLayers.find(l => MARINE_LAYERS.includes(l)) || null;
  }, [activeLayers]);
  const activeMarineLayerRef = useRef(activeMarineLayer);

  useEffect(() => { activeModelRef.current = activeModel; if (typeof window !== 'undefined') window.activeModel = activeModel; }, [activeModel]);
  useEffect(() => { activeMarineLayerRef.current = activeMarineLayer; if (typeof window !== 'undefined') window.activeMarineLayer = activeMarineLayer || 'waves'; }, [activeMarineLayer]);
  useEffect(() => { if (typeof window !== 'undefined') window.activeTimeOffsetHours = timeOffsetHours; }, [timeOffsetHours]);

  const lastFetchedLayerRef = useRef(null);

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
    const t = setTimeout(() => {
      const previouslyHadMarine = activeMarineLayersRef.current;
      activeMarineLayersRef.current = hasMarine;
      if (!hasMarine) {
        hasActivatedRef.current = false;
      } else if (!previouslyHadMarine && !hasActivatedRef.current) {
        hasActivatedRef.current = true;
        console.log('[Marine] Layer activated, triggering manual fetch...');
        marineFetchLocksRef.current.lastHash = null; marineFetchLocksRef.current.lastTime = 0;
        consecutiveFailuresRef.current = 0;
        manualMarineTriggerRef.current?.();
      }
    }, 50);
    return () => clearTimeout(t);
  }, [activeLayersKey]);

  const hasMarineLayers = useMemo(() => {
    return ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayers.includes(l));
  }, [activeLayers]);

  useEffect(() => {
    if (!hasMarineLayers) {
      if (typeof window !== 'undefined') {
        window.__MARINE_HEATMAP_STATUS__ = null;
      }
    }
  }, [hasMarineLayers]);

  useEffect(() => {
    if (!mapInstance) return;

    manualMarineTriggerRef.current = () => enqueueMarineUpdate('manual');

    const onMoveEnd = () => {
      if (window.isScrubbingTimeline) return;
      const center = mapInstance.getCenter(), zoom = mapInstance.getZoom(), cameraHash = `${center.lng.toFixed(3)}:${center.lat.toFixed(3)}:${zoom.toFixed(2)}`;
      if (lastStableCameraRef.current === cameraHash) return;
      lastStableCameraRef.current = cameraHash;

      let isCached = false;
      try {
        const b = mapInstance.getBounds(), bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
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
    mapInstance.on('sourcedata', onMapInternalUpdate);
    mapInstance.on('styledata', onMapInternalUpdate);
    mapInstance.on('moveend', onMoveEnd);

    if (activeMarineLayersRef.current) enqueueMarineUpdate('mount');

    return () => {
      if (moveendDebounceRef.current.timer) clearTimeout(moveendDebounceRef.current.timer);
      if (internalUpdateTimerRef.current) clearTimeout(internalUpdateTimerRef.current);
      ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => mapInstance.off(e, trackIntent));
      mapInstance.off('sourcedata', onMapInternalUpdate);
      mapInstance.off('styledata', onMapInternalUpdate);
      mapInstance.off('moveend', onMoveEnd);
      manualMarineTriggerRef.current = null;
    };
  }, [mapInstance, enqueueMarineUpdate]);

  useEffect(() => {
    const prev = timeOffsetRef.current; timeOffsetRef.current = timeOffsetHours;
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
      const cachedBackendData = getModelSafeMarine(curModel, timeOffsetHours, curLayer, vpBounds);
      if (cachedBackendData && cachedBackendData.grid && !cachedBackendData.__staleHour) {
        extractedGrid = cachedBackendData.grid;
        const sig = _marineDataSignature(cachedBackendData, curLayer);
        if (sig && sig !== lastCommittedSigRef.current) {
          const evtType = cachedBackendData.grid?.__renderable ? 'local_cache_remap_timeline' : 'local_cache_remap_timeline_no_data';
          console.log(`[SCRUB] [BACKEND CACHE] Instant re-index: +${timeOffsetHours}h model=${curModel} layer=${curLayer}`);
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
        // Do NOT cancel pending deferred fetches — they protect against cache-miss hours
        // that would otherwise never be fetched during rapid scrubbing sequences.
        // The deferred fetch has its own staleness check to self-invalidate if stale.
        return;
      } else {
        console.log(`[SCRUB] [BACKEND CACHE] Miss: +${timeOffsetHours}h model=${curModel} layer=${curLayer}. Retaining stale view while fetching.`);
        // DO NOT clear marineData — retain stale heatmap view while the deferred fetch loads
        marineFetchLocksRef.current.lastHash = null;
        enqueueMarineUpdate('timeline_scrub_deferred');
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
              console.log(`[SCRUB] [CACHE] Instant re-index: +${timeOffsetHours}h model=${curModel} layer=${curLayer}`);
              lastCommittedSigRef.current = sig; logPipelineEventHelper(evtType, { model: curModel, layer: curLayer, hour: timeOffsetHours, renderable: data.grid?.__renderable });
              marineRevision.current += 1; data.__commitRevision = marineRevision.current;
              
              const vHash = getViewportHash();
              if (vHash) { marineFetchLocksRef.current.lastHash = vHash; marineFetchLocksRef.current.lastTime = Date.now(); }
              setMarineData(data);
            }
            
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

    console.log(`[CACHE] [Marine] Cache miss for hour +${timeOffsetHours}h. Fetching...`);
    marineFetchLocksRef.current.lastHash = null;
    if (window.isScrubbingTimeline) {
      enqueueMarineUpdate('timeline_scrub_deferred');
    } else {
      if (updateMarineGridRef.current) {
        updateMarineGridRef.current('timeline_scrub');
      }
    }
  }, [timeOffsetHours, mapInstance]);

  useEffect(() => {
    if (!mapInstance || !activeMarineLayersRef.current) return;
    if (lastFetchedModelRef.current === activeModel) return;
    if (window.isScrubbingTimeline) return;

    lastFetchedModelRef.current = activeModel; lastFetchedLayerRef.current = null;
    console.log(`[MODEL] [Marine] Active model changed to ${activeModel}, triggering manual fetch...`);
    marineFetchLocksRef.current.lastHash = null; marineFetchLocksRef.current.lastTime = 0;
    const t = setTimeout(() => { manualMarineTriggerRef.current?.(); }, 350);
    return () => clearTimeout(t);
  }, [activeModel, mapInstance]);

  useEffect(() => {
    if (!mapInstance || !activeMarineLayer) return;
    if (lastFetchedLayerRef.current === activeMarineLayer) return;

    let vpBounds = null;
    try {
      const b = mapInstance.getBounds();
      vpBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    } catch (e) {
      vpBounds = null;
    }

    const curModel = activeModel || 'GFS';
    const isGfsBackend = getBackendWeatherFlag() && (curModel === 'GFS' || !curModel);
    const isIconBackend = getBackendIconMarineFlag() && curModel === 'ICON';
    const isCopernicusBackend = getBackendCopernicusFlag() && curModel === 'EURO';
    const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

    if (isBackendActive) {
      try {
        const cached = getModelSafeMarine(activeModel, timeOffsetHours, activeMarineLayer, vpBounds);
        if (cached && cached.grid && !cached.__staleHour) {
          const prodId = cached.product_id || cached.productId;
          const isRegional = prodId && (prodId.includes('florida_east_coast') || !cached.is_dynamic_viewport_product);
          if (prodId && !isRegional) {
            const sig = _marineDataSignature(cached, activeMarineLayer);
            if (sig && sig !== lastCommittedSigRef.current) {
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
              enqueueMarineUpdate('cancel_scrub');
              return;
            }
          }
        }
      } catch (e) {
        console.warn('[Marine] Backend cache switch lookup failed:', e.message);
      }
      console.log(`[Marine] Layer switch backend cache MISS for ${activeMarineLayer}. Clearing.`);
      setMarineData(null);
    } else {
      if (activeModel !== 'EURO') {
        try {
          const cache = getMarineHourlyCache();
          if (cache?.results?.length && cache.model === activeModel) {
            const remapped = extractMarineAtOffset(cache, timeOffsetHours, activeMarineLayer);
            if (remapped?.grid?.vectors?.length > 0) {
              const isRenderable = remapped.grid.__renderable !== false, sig = _marineDataSignature(remapped, activeMarineLayer);
              if (sig && sig !== lastCommittedSigRef.current) { logPipelineEventHelper('duplicate_commit_skipped', { signature: sig }); lastFetchedLayerRef.current = activeMarineLayer; return; }
              const evtType = isRenderable ? 'local_cache_remap_renderable' : 'local_cache_remap_no_data';
              console.log(`[Marine] Layer switch to ${activeMarineLayer}: ${evtType}`);
              logPipelineEventHelper(evtType, { model: activeModel, layer: activeMarineLayer, hour: timeOffsetHours, renderable: isRenderable, noDataReason: remapped.grid.__noDataReason });
              
              lastCommittedSigRef.current = sig; marineRevision.current += 1; remapped.__commitRevision = marineRevision.current;
              const vHash = getViewportHash();
              if (vHash) { marineFetchLocksRef.current.lastHash = vHash; marineFetchLocksRef.current.lastTime = Date.now(); }

              setMarineData(remapped); lastFetchedLayerRef.current = activeMarineLayer; enqueueMarineUpdate('cancel_scrub'); return;
            }
          }
        } catch (e) { console.warn('[Marine] Cache remap failed:', e.message); }
      }
    }
    
    marineFetchLocksRef.current.lastHash = null; marineFetchLocksRef.current.lastTime = 0;
    const t = setTimeout(() => { manualMarineTriggerRef.current?.(); }, 350);
    return () => clearTimeout(t);
  }, [activeMarineLayer, activeModel, mapInstance]);

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
        scrubSettleTimerRef.current = setTimeout(checkScrubSettle, 500);
      }
      wasScrubbingRef = isNowScrubbing;
    }, 200);

    return () => {
      clearInterval(intervalId);
      clearTimeout(scrubSettleTimerRef.current);
    };
  }, [mapInstance, marineData]);

  return { marineData };
}

