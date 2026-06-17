import { useState, useRef, useEffect, useCallback } from 'react';
import { fetchMarineData, getRemainingCooldown, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { fetchCopernicusComponentGrid, mergeComponentGrid, COMPONENT_LAYERS } from './copernicusGridFetcher';
import { getBackendCopernicusFlag, getSharedValidTime, getBackendIconMarineFlag, getBackendWeatherFlag } from './backendWeatherServiceClient';
import { updateDeprecationDiag } from './forecastSamplers';
import { isInCooldown } from './marineControllerUtils';
import { _marineDataSignature, _logPipelineEvent } from './useMarineOrchestratorDiag';
import {
  DISPLAY_EURO_WAVES_MAX_HOURS,
  DISPLAY_EURO_COMPONENT_MAX_HOURS,
  DISPLAY_ICON_MAX_HOURS,
  getLongitudinalOverlap,
  checkShouldClearRegionalGrid
} from './useMarineDataFetcherHelpers';


export function useMarineDataFetcher({
  mapInstance,
  activeLayers,
  activeMarineLayer,
  activeMarineLayerRef,
  timeOffsetHours,
  timeOffsetRef,
  activeModel,
  activeModelRef
}) {
  const [marineData, setMarineData] = useState(null);

  const marineRevision = useRef(0);
  const marineRequestIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  const activeMarineLayersRef = useRef(false);
  const marineFetchLocksRef = useRef({ lastHash: null, lastTime: 0, isFetching: false, manualFetchActiveUntil: 0 });
  const manualMarineTriggerRef = useRef(null);
  const isCommittingDataRef = useRef(false);
  const isInternalMapUpdateRef = useRef(false);
  const internalUpdateTimerRef = useRef(null);
  const lastUserInteractionRef = useRef(0);
  const lastStableCameraRef = useRef(null);
  const lastInvocationRef = useRef({ source: null, time: 0 });
  const cooldownRetryRef = useRef(null);
  const marineRetryCountRef = useRef(0);
  const swrTimerRef = useRef(null);
  const swrRetryCountRef = useRef(0);
  const updateMarineGridRef = useRef(null);
  const enqueueMarineUpdateRef = useRef(null);
  const consecutiveFailuresRef = useRef(0);
  const lastFetchedModelRef = useRef(null);
  const pendingMarineIntentRef = useRef(null);
  const pipelineEventsRef = useRef([]);

  const pipelineCountersRef = useRef({
    networkFetches: 0, cacheRemaps: 0, duplicateCommitSkipped: 0, duplicateUploadSkipped: 0,
    staleRejections: 0, pendingIntents: 0, rateLimits: 0, extendedEstimateFetches: 0,
    extendedEstimateSkipped: 0, webglUploads: 0, webglClears: 0
  });

  const lastCommittedSigRef = useRef(null);
  const orchestratorInFlight = useRef(new Map());

  const scheduledRef = useRef(false);
  const timeoutIdRef = useRef(null);
  const moveendDebounceRef = useRef({ timer: null });
  const scrubDebounceRef = useRef(null);

  const getViewportHash = useCallback(() => {
    if (!mapInstance) return null;
    try {
      const b = mapInstance.getBounds();
      const west = b.getWest();
      const east = b.getEast();
      const south = b.getSouth();
      const north = b.getNorth();
      if (Math.abs(east - west) < 0.01 || Math.abs(north - south) < 0.01) {
        return null;
      }
      const q = v => Number(v).toFixed(2);
      const bboxStr = `${q(west)},${q(south)},${q(east)},${q(north)}`;
      return `${bboxStr}:${activeModelRef.current}:${activeMarineLayerRef.current || 'waves'}:${timeOffsetRef.current}`;
    } catch (e) { return null; }
  }, [mapInstance, activeModelRef, activeMarineLayerRef, timeOffsetRef]);

  const logPipelineEventHelper = useCallback((eventType, detail) => {
    _logPipelineEvent(
      eventType,
      detail,
      pipelineEventsRef,
      pipelineCountersRef,
      activeModelRef,
      activeMarineLayerRef,
      timeOffsetRef,
      lastCommittedSigRef,
      pendingMarineIntentRef
    );
  }, [activeModelRef, activeMarineLayerRef, timeOffsetRef]);

  const updateMarineGrid = useCallback(async (source = 'unknown') => {
    let phase = 'init';
    const rawModel = activeModelRef.current;
    const layer = activeMarineLayerRef.current || 'waves';
    const timeOffset = timeOffsetRef.current;
    const isWaves = layer === 'waves';
    const nativeLimit = isWaves ? DISPLAY_EURO_WAVES_MAX_HOURS : DISPLAY_EURO_COMPONENT_MAX_HOURS;
    const model = (rawModel === 'ICON' && timeOffset > DISPLAY_ICON_MAX_HOURS) ? 'GFS'
                : (rawModel === 'EURO' && timeOffset > nativeLimit) ? 'GFS'
                : rawModel;
    const zoom = mapInstance.getZoom();
    const locks = marineFetchLocksRef.current;
    let requestId = 0;
    let clearDebounce = true;

    try {
      const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
      if (!isTimelineScrub && (window.isScrubbingTimeline || isCommittingDataRef.current)) return;
      if (!activeMarineLayersRef.current) return;
      const viewportHash = getViewportHash();
      if (!viewportHash) {
        console.log(`[Marine] Viewport bounds are degenerate or map not ready. Skipping fetch (source=${source}).`);
        const isRetrySource = source.includes('retry');
        const canRetry = source === 'mount' || source === 'load' || source === 'manual' || isRetrySource;
        if (canRetry) {
          clearDebounce = false;
          const retryCount = marineRetryCountRef.current || 0;
          if (retryCount < 20) {
            marineRetryCountRef.current = retryCount + 1;
            const nextSource = isRetrySource ? source : source + '_retry';
            setTimeout(() => {
              if (activeMarineLayersRef.current && updateMarineGridRef.current) {
                updateMarineGridRef.current(nextSource);
              }
            }, 500);
          } else {
            console.warn(`[Marine] Max retries (${retryCount}) reached for degenerate bounds.`);
          }
        }
        return;
      }
      marineRetryCountRef.current = 0;
      const isRetry = source === 'cooldown_retry' || source === 'delayed_retry' || source === 'swr_revalidation';
      const hasValidData = marineData && marineData.grid && marineData.grid.vectors && marineData.grid.vectors.length > 0;
      const isCorrectLayer = marineData?.grid?.__componentLayer === layer;
      let bypassDedupe = !hasValidData || !isCorrectLayer || !!(marineData?.stale || marineData?.grid?.stale);

      if (!isRetry && !isTimelineScrub && !bypassDedupe && locks.lastHash === viewportHash && (Date.now() - locks.lastTime < 5 * 60 * 1000)) return;
      if (locks.lastHash !== viewportHash) {
        consecutiveFailuresRef.current = 0;
        marineRetryCountRef.current = 0;
        swrRetryCountRef.current = 0;
        clearTimeout(swrTimerRef.current);
        swrTimerRef.current = null;
        locks.lastTime = 0; // Prevent 1200ms rate-limiter from blocking the fetch on layer/viewport switch
      }

      if (source !== 'swr_revalidation') {
        clearTimeout(swrTimerRef.current);
        swrTimerRef.current = null;
        swrRetryCountRef.current = 0;
      }
      updateMarineGridRef.current = updateMarineGrid;

      if (locks.isFetching) {
        const activeSource = locks.activeSource || 'unknown';
        const isHighPriority = (src) => src === 'manual' || src.includes('timeline') || src.includes('scrub');
        if (isHighPriority(activeSource) && !isHighPriority(source)) {
          console.log(`[Abort-Gate] Preserving high-priority fetch (${activeSource}) against low-priority update request (${source})`);
          return;
        }
        console.log(`[Abort] Aborting in-flight fetch (${activeSource}) for new request source=${source}`);
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        locks.isFetching = false;
      }
      if (!isRetry && !isTimelineScrub && consecutiveFailuresRef.current >= 3) return;
      const now = Date.now();
      if (!isRetry && !isTimelineScrub && now - locks.lastTime < 1200) return;
      if (!isTimelineScrub && (mapInstance.isMoving() || mapInstance.isZooming()) && hasValidData) {
        clearDebounce = false;
        return;
      }

      phase = 'pre_fetch';
      // Use actual viewport bounds from the map instance, NOT hardcoded global bounds,
      // EXCEPT on activation events ('mount', 'load', 'manual') to ensure the heatmap starts unclamped.
      let bounds = { west: -180, south: -85, east: 180, north: 85 };
      const isActivation = source === 'mount' || source === 'load' || source === 'manual';
      if (!isActivation) {
        try {
          const mb = mapInstance.getBounds();
          bounds = { west: mb.getWest(), south: mb.getSouth(), east: mb.getEast(), north: mb.getNorth() };
        } catch (e) {
          // Fallback to global if getBounds fails (e.g., map not ready)
        }
      }

      if (marineData && marineData.grid && marineData.grid.bounds) {
        checkShouldClearRegionalGrid({ marineData, bounds, zoom, model, layer });
      }

      requestId = ++marineRequestIdRef.current;
      
      if (getRemainingCooldown('marine') > 0 || isInCooldown('marine')) {
        console.warn('[Orchestrator] 429 rate limit active, skipping network fetch and entering cooldown fallback');
        consecutiveFailuresRef.current = 3;
        clearTimeout(cooldownRetryRef.current); cooldownRetryRef.current = null;
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
            lastCommittedSigRef.current = sig; marineRevision.current += 1;
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
          return;
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
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      locks.isFetching = true;
      locks.activeSource = source;
      if (typeof window !== 'undefined') {
        window.__MARINE_FETCH_DEBOUNCING__ = false;
        window.__MARINE_FETCH_PENDING__ = { model: rawModel, layer, hour: timeOffset, timestamp: new Date().toISOString() };
      }
      const fetchIntent = { model: rawModel, layer, hour: timeOffset };

      const isWaves = layer === 'waves';
      const nativeLimit = isWaves ? DISPLAY_EURO_WAVES_MAX_HOURS : DISPLAY_EURO_COMPONENT_MAX_HOURS;
      let data = null;

      const safeLoadGrid = async (modelName, targetLayer, targetHour, targetBounds, targetZoom, diagObj) => {
        phase = `load_${modelName}_h${targetHour}`;
        
        try {
          const cached = getModelSafeMarine(modelName, targetHour, targetLayer, targetBounds);
          if (cached?.grid?.vectors?.length > 0) {
            if (cached.stale || cached.grid?.stale) {
              const sig = _marineDataSignature(cached, targetLayer);
              if (sig && sig !== lastCommittedSigRef.current) {
                lastCommittedSigRef.current = sig;
                marineRevision.current += 1;
                cached.__commitRevision = marineRevision.current;
                setMarineData(cached);
              }
            } else {
              diagObj.cacheHits.push(`${modelName}_h${targetHour}`);
              return cached;
            }
          }
        } catch (e) { console.warn('[safeLoadGrid] Cache read error:', e.message); }

        if (isInCooldown('marine')) {
          diagObj.cooldownStatus = 'rate_limited'; diagObj.skippedReason = 'cooldown_active'; return null;
        }

        const expectedProvider = (modelName === 'EURO' && COMPONENT_LAYERS.includes(targetLayer)) ? 'copernicus' : 'open-meteo';
        const layerKey = (modelName !== 'EURO') ? 'all' : (targetLayer || 'waves');
        const snapBoundsStr = targetBounds ? `${targetBounds.west.toFixed(2)}_${targetBounds.south.toFixed(2)}_${targetBounds.east.toFixed(2)}_${targetBounds.north.toFixed(2)}` : 'global';
        const requestKey = `${modelName}_${layerKey}_${targetHour}_${expectedProvider}_vp_${targetZoom}_${snapBoundsStr}`;
        
        if (orchestratorInFlight.current.has(requestKey)) {
          diagObj.cacheHits.push(`${modelName}_h${targetHour}_inflight`);
          return orchestratorInFlight.current.get(requestKey);
        }
        diagObj.fetchStarted.push(`${modelName}_h${targetHour}`);
        const promise = (async () => {
          try {
            return await fetchMarineData(targetBounds, targetZoom, signal, targetHour, false, modelName, targetLayer);
          } catch (e) {
            return null;
          } finally { orchestratorInFlight.current.delete(requestKey); }
        })();
        orchestratorInFlight.current.set(requestKey, promise);
        return promise;
      };

      const diagObj = {
        model, layer, targetHour: timeOffset, nativeLimit: model === 'ICON' ? DISPLAY_ICON_MAX_HOURS : nativeLimit,
        requiredSources: [], cacheHits: [], fetchStarted: [], skippedReason: null, resultStatus: 'pending',
        rateLimitStatus: 'ok', cooldownStatus: isInCooldown('marine') ? 'rate_limited' : 'ok', timestamp: new Date().toISOString()
      };
      window.__EXTENDED_ESTIMATE_FETCH_DIAG__ = diagObj;

      if (model === 'ICON' && timeOffset > DISPLAY_ICON_MAX_HOURS) {
        const hasBackend = getBackendIconMarineFlag();
        const fallbackReason = hasBackend ? 'icon_no_backend_extended_estimate' : 'backend_required_no_frontend_estimator';
        if (typeof window !== 'undefined') {
          updateDeprecationDiag({
            model: 'ICON',
            layer,
            offset: timeOffset,
            calledFunc: null,
            called: false,
            backendAvailable: false,
            productId: null,
            fallbackReason
          });
        }
        data = {
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
      } else if (model === 'EURO' && timeOffset > nativeLimit && !getBackendCopernicusFlag()) {
        const fallbackReason = 'backend_required_no_frontend_estimator';
        if (typeof window !== 'undefined') {
          updateDeprecationDiag({
            model: 'EURO',
            layer,
            offset: timeOffset,
            calledFunc: null,
            called: false,
            backendAvailable: false,
            productId: null,
            fallbackReason
          });
        }
        data = {
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
      } else if (data === null) {
        if (model === 'EURO' && layer && COMPONENT_LAYERS.includes(layer)) {
          if (getBackendCopernicusFlag()) {
            phase = 'standard_fetch_copernicus';
            try {
              data = await fetchMarineData(bounds, zoom, signal, timeOffset, false, model, layer);
               if (!data || !data.grid || (!data.grid.renderable && (!data.grid.vectors || data.grid.vectors.length === 0))) {
                console.warn('[Marine] Deployed Copernicus grid returned empty/unrenderable grid.');
                const failureReason = data?.grid?.__failureReason || 'unavailable';
                data = {
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
                    __failureReason: failureReason,
                    renderable: false,
                    provider: 'backend-weather-service'
                  }
                };
              }
            } catch (err) {
              console.error('[Marine] Deployed Copernicus grid fetch failed:', err.message);
              data = {
                type: 'FeatureCollection', features: [], hourOffset: timeOffset,
                grid: {
                  vectors: [],
                  bounds,
                  cols: 0,
                  rows: 0,
                  timestamp: Date.now(),
                  __sourceModel: 'EURO',
                  __provider: 'backend-weather-service',
                  __gridProvider: 'backend-weather-service',
                  __componentLayer: layer,
                  __gridSupportsLayer: false,
                  renderable: false,
                  provider: 'backend-weather-service',
                  emptyGridWarning: err.message || 'Copernicus grid fetch failed'
                }
              };
            }
          } else {
            data = {
              type: 'FeatureCollection',
              features: [],
              grid: {
                vectors: [],
                bounds,
                cols: 0,
                rows: 0,
                status: "no_coverage",
                source: "backend_required",
                provider: "none",
                is_estimated: false,
                fallbackReason: "backend_required_no_frontend_estimator",
                renderable: false,
                emptyGridWarning: "Backend Copernicus support is absent, no frontend estimator"
              }
            };
          }
        } else {
          phase = 'standard_fetch';
          data = await fetchMarineData(bounds, zoom, signal, timeOffset, false, model, layer);
        }
      }

      if (requestId !== marineRequestIdRef.current) return;
      if (fetchIntent.model !== activeModelRef.current || fetchIntent.layer !== (activeMarineLayerRef.current || 'waves') || fetchIntent.hour !== timeOffsetRef.current) {
        logPipelineEventHelper('stale_async_response_rejected', fetchIntent); return;
      }

      phase = 'commit';
      if (typeof window !== 'undefined') {
        let nzCount = 0;
        if (data?.grid?.vectors) {
          for (const v of data.grid.vectors) {
            if (v) {
              const comp = v[layer] || v.waves || v.swell_1 || v.swell_2 || v.wind_waves || v;
              if (comp && comp.speed > 0) nzCount++;
            }
          }
        }
        window.__MARINE_FETCH_DIAG__ = { activeModel: activeModelRef.current, activeLayer: layer, timeOffsetHours: timeOffsetRef.current, provider: data?.grid?.__provider || 'none', gridProvider: data?.grid?.__gridProvider || 'none', httpStatus: data ? 200 : 502, elapsedMs: Date.now() - now, vectorCount: data?.grid?.vectors?.length || 0, nonzeroCount: nzCount, timestamp: new Date().toISOString() };
      }

      if (data && (data.features?.length > 0 || data.grid?.vectors?.length > 0 || data.grid?.__skippedReason === 'zoom_too_low' || data.grid?.skippedReason === 'zoom_too_low' || data.grid?.emptyGridWarning)) {
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
        consecutiveFailuresRef.current = 0; locks.lastHash = viewportHash; locks.lastTime = Date.now();
        logPipelineEventHelper('data_committed', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour, provider: data?.grid?.__provider, vectorCount: data?.grid?.vectors?.length || 0 });
        isCommittingDataRef.current = true; isInternalMapUpdateRef.current = true;
        // After a successful scrub-deferred fetch commits, reset the lastHash so that
        // the next scrub position (which may also be a cache miss) can trigger a fetch
        // without being blocked by the viewportHash deduplication window.
        if (source === 'timeline_scrub' && timeOffsetRef.current !== fetchIntent.hour) {
          locks.lastHash = null;
        }

        setMarineData(prev => {
          const hasNewValidData = data && data.grid && data.grid.vectors && data.grid.vectors.length > 0 && data.grid.renderable !== false;
          const hasPrevValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
          const isZoomTooLow = data?.grid?.__skippedReason === 'zoom_too_low' || data?.grid?.skippedReason === 'zoom_too_low';
          const prevModel = prev?.grid?.__sourceModel || prev?.__sourceModel;
          const prevLayer = prev?.grid?.__componentLayer || prev?.__componentLayer || 'waves';
          const isSameModelAndLayer = prevModel === model && prevLayer === layer;
          if (!hasNewValidData && hasPrevValidData && !isZoomTooLow) {
            console.log(`[Marine] Ignoring empty/unrenderable commit to preserve stale heatmap data.`);
            return prev;
          }
          const newSig = _marineDataSignature(data, layer);
          if (newSig && newSig === lastCommittedSigRef.current) { logPipelineEventHelper('duplicate_commit_skipped', { signature: newSig }); return prev; }
          lastCommittedSigRef.current = newSig; marineRevision.current += 1; data.__commitRevision = marineRevision.current;
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
        clearTimeout(internalUpdateTimerRef.current); internalUpdateTimerRef.current = setTimeout(() => { isInternalMapUpdateRef.current = false; }, 800);

        if (data.stale || data.grid?.stale) {
          if (swrRetryCountRef.current < 3) {
            console.log(`[SWR] Committed stale/coarse grid. Scheduling SWR revalidation retry #${swrRetryCountRef.current + 1} in 1500ms`);
            clearTimeout(swrTimerRef.current);
            swrTimerRef.current = setTimeout(() => {
              swrTimerRef.current = null;
              swrRetryCountRef.current += 1;
              if (activeMarineLayersRef.current) {
                updateMarineGrid('swr_revalidation');
              }
            }, 1500);
          } else {
            console.warn('[SWR] Max revalidation retries reached (3), stopping polling.');
          }
        } else {
          swrRetryCountRef.current = 0;
          clearTimeout(swrTimerRef.current);
          swrTimerRef.current = null;
        }
      } else {
        consecutiveFailuresRef.current += 1;
        const isCurrentHour = fetchIntent.hour === timeOffsetRef.current;
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
          console.log(`[Marine] Fetch returned empty/failed (isCurrentHour=${isCurrentHour}), preserving stale data.`);
        }
        if (isInCooldown('marine')) logPipelineEventHelper('rate_limit_429', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour });
        if (consecutiveFailuresRef.current >= 3 || ['cooldown_retry', 'delayed_retry'].includes(source)) return;
        const remaining = getRemainingCooldown('marine'), delay = remaining > 0 ? remaining + 3000 : 5000, retrySource = remaining > 0 ? 'cooldown_retry' : 'delayed_retry';
        cooldownRetryRef.current = setTimeout(() => { cooldownRetryRef.current = null; if (updateMarineGridRef.current && activeMarineLayersRef.current) updateMarineGridRef.current(retrySource); }, delay);
      }
    } catch (err) {
      const isAbort = err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort');
      console.error(`[Orchestrator Fatal Exception] phase=${phase} error:`, err.message);
      const isCurrentHour = timeOffset === timeOffsetRef.current;
      if (!isAbort && !window.isScrubbingTimeline && isCurrentHour) {
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
        console.log(`[Marine] Fetch exception (isAbort=${isAbort}, isCurrentHour=${isCurrentHour}), preserving stale data.`);
      }
    } finally {
      if (requestId === marineRequestIdRef.current) {
        locks.isFetching = false;
        locks.activeSource = null;
        if (typeof window !== 'undefined') {
          window.__MARINE_FETCH_PENDING__ = null;
          window.__MARINE_TRANSITIONING__ = false;
          if (clearDebounce) {
            window.__MARINE_FETCH_DEBOUNCING__ = false;
          }
        }
        const pending = pendingMarineIntentRef.current;
        if (pending) {
          pendingMarineIntentRef.current = null;
          if (pending.model === activeModelRef.current && pending.layer === (activeMarineLayerRef.current || 'waves')) {
            setTimeout(() => enqueueMarineUpdateRef.current?.(pending.source + '_pending'), 50);
          } else { logPipelineEventHelper('pending_intent_expired', pending); }
        }
      }
    }
  }, [
    mapInstance,
    activeModelRef,
    activeMarineLayerRef,
    timeOffsetRef,
    getViewportHash,
    logPipelineEventHelper
  ]);

  const enqueueMarineUpdate = useCallback((source) => {
    if (source === 'cancel_scrub') {
      if (scrubDebounceRef.current) {
        clearTimeout(scrubDebounceRef.current);
        scrubDebounceRef.current = null;
      }
      return;
    }

    const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
    if (!isTimelineScrub && window.isScrubbingTimeline) return;

    // Debounced scrub path: coalesce rapid scrub positions into a single fetch
    if (source === 'timeline_scrub_deferred') {
      if (!window.isScrubbingTimeline) {
        if (scrubDebounceRef.current) {
          clearTimeout(scrubDebounceRef.current);
          scrubDebounceRef.current = null;
        }
        updateMarineGrid('timeline_scrub');
        return;
      }
      clearTimeout(scrubDebounceRef.current);
      scrubDebounceRef.current = setTimeout(() => {
        scrubDebounceRef.current = null;
        updateMarineGrid('timeline_scrub');
      }, 150);
      return;
    }

    const now = Date.now();
    const locks = marineFetchLocksRef.current;
    if (locks.isFetching) {
      pendingMarineIntentRef.current = { source, model: activeModelRef.current, layer: activeMarineLayerRef.current || 'waves', hour: timeOffsetRef.current, timestamp: Date.now() };
      logPipelineEventHelper('intent_buffered', pendingMarineIntentRef.current);
      const activeSource = locks.activeSource || 'unknown';
      const isHighPriority = (src) => src === 'manual' || src.includes('timeline') || src.includes('scrub');
      if (isHighPriority(activeSource) && !isHighPriority(source)) {
        console.log(`[Abort-Gate] Preserving high-priority fetch (${activeSource}) against low-priority request (${source})`);
        return;
      }
      console.log(`[Abort] Aborting active fetch (${activeSource}) in enqueueMarineUpdate for new source=${source}`);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      return;
    }

    if (source === 'manual') locks.manualFetchActiveUntil = now + 1500;
    if (source.includes('moveend') && !source.includes('_pending') && now < (locks.manualFetchActiveUntil || 0)) return;

    let isCached = false;
    try {
      const b = mapInstance.getBounds(), bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
      isCached = isContainedInMarineCache(bounds, activeModelRef.current, timeOffsetRef.current, activeMarineLayerRef.current || 'waves');
    } catch (e) {
      isCached = false;
    }

    const dedupeWindow = isCached ? 50 : 800;
    if (lastInvocationRef.current.source === source && now - lastInvocationRef.current.time < dedupeWindow) return;

    try {
      const viewportHash = getViewportHash();
      const hasValidData = marineData && marineData.grid && marineData.grid.vectors && marineData.grid.vectors.length > 0;
      const isCorrectLayer = marineData?.grid?.__componentLayer === (activeMarineLayerRef.current || 'waves');
      const bypassDedupe = !hasValidData || !isCorrectLayer || !!(marineData?.stale || marineData?.grid?.stale);
      if (!bypassDedupe && locks.lastHash === viewportHash && (now - locks.lastTime < 5 * 60 * 1000)) return;
    } catch (e) {
      // ignore
    }

    lastInvocationRef.current = { source, time: now };
    if (scheduledRef.current) return;
    scheduledRef.current = true;

    if (typeof window !== 'undefined') {
      window.__MARINE_FETCH_DEBOUNCING__ = true;
    }

    requestAnimationFrame(() => {
      scheduledRef.current = false;
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      const stableDelay = (isCached || source === 'manual' || source === 'timeline_scrub') ? 20 : 300;
      timeoutIdRef.current = setTimeout(() => {
        if (isTimelineScrub || (!mapInstance.isMoving() && !mapInstance.isZooming())) {
          updateMarineGrid(source);
        } else {
          let fired = false;
          const runUpdate = () => {
            if (fired) return;
            fired = true;
            mapInstance.off('idle', runUpdate);
            if (activeMarineLayersRef.current) {
              updateMarineGrid(source);
            }
          };
          mapInstance.once('idle', runUpdate);
          setTimeout(runUpdate, 1000);
        }
      }, stableDelay);
    });
  }, [
    mapInstance,
    activeModelRef,
    activeMarineLayerRef,
    timeOffsetRef,
    getViewportHash,
    logPipelineEventHelper,
    updateMarineGrid
  ]);

  enqueueMarineUpdateRef.current = enqueueMarineUpdate;
  manualMarineTriggerRef.current = () => enqueueMarineUpdate('manual');

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (cooldownRetryRef.current) clearTimeout(cooldownRetryRef.current);
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      if (moveendDebounceRef.current.timer) clearTimeout(moveendDebounceRef.current.timer);
      if (internalUpdateTimerRef.current) clearTimeout(internalUpdateTimerRef.current);
      if (scrubDebounceRef.current) clearTimeout(scrubDebounceRef.current);
      if (swrTimerRef.current) clearTimeout(swrTimerRef.current);
    };
  }, []);

  return {
    marineData,
    setMarineData,
    marineRevision,
    marineRequestIdRef,
    activeMarineLayersRef,
    marineFetchLocksRef,
    manualMarineTriggerRef,
    isCommittingDataRef,
    isInternalMapUpdateRef,
    internalUpdateTimerRef,
    lastUserInteractionRef,
    lastStableCameraRef,
    lastInvocationRef,
    cooldownRetryRef,
    marineRetryCountRef,
    updateMarineGridRef,
    enqueueMarineUpdateRef,
    consecutiveFailuresRef,
    lastFetchedModelRef,
    pendingMarineIntentRef,
    pipelineEventsRef,
    pipelineCountersRef,
    lastCommittedSigRef,
    orchestratorInFlight,
    scheduledRef,
    timeoutIdRef,
    moveendDebounceRef,
    getViewportHash,
    logPipelineEventHelper,
    updateMarineGrid,
    enqueueMarineUpdate
  };
}
