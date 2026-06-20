import { useState, useRef, useEffect, useCallback } from 'react';
import { useMarineRevalidation } from '../../hooks/useMarineRevalidation';
import { fetchMarineData, getRemainingCooldown, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { fetchCopernicusComponentGrid, mergeComponentGrid, COMPONENT_LAYERS } from './copernicusGridFetcher';
import { getBackendCopernicusFlag, getSharedValidTime, getBackendIconMarineFlag, getBackendWeatherFlag } from './backendWeatherServiceClient';
import { updateDeprecationDiag } from './forecastSamplers';
import { isInCooldown, clearCooldown } from './marineControllerUtils';
import { _marineDataSignature, _logPipelineEvent } from './useMarineOrchestratorDiag';
import {
  DISPLAY_EURO_WAVES_MAX_HOURS,
  DISPLAY_EURO_COMPONENT_MAX_HOURS,
  DISPLAY_ICON_MAX_HOURS,
  getLongitudinalOverlap,
  checkShouldClearRegionalGrid,
  buildIconFallbackGrid,
  buildEuroFallbackGrid,
  buildCopernicusEmptyGrid,
  getAbortRecoveryGrid,
  handleRegionalGridClearing,
  handleCooldownFallback,
  commitMarineData
} from './useMarineDataFetcherHelpers';
import { getTarget, endTransition, recordChurn } from './marineTransitionCoordinator';


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
  const marineDataRef = useRef(null);

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
  const {
    swrTimerRef,
    swrRetryCountRef,
    cooldownRetryRef,
    marineRetryCountRef,
    clearAllTimers,
    scheduleSWRRevalidation,
    scheduleCooldownRetry,
    scheduleDegenerateRetry,
    resetRetryCounts
  } = useMarineRevalidation();
  const updateMarineGridRef = useRef(null);
  const enqueueMarineUpdateRef = useRef(null);
  const consecutiveFailuresRef = useRef(0);
  const abortRecoveryRetryCountRef = useRef(0);
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
    const model = (rawModel === 'ICON' && timeOffset > 168 && !getBackendIconMarineFlag()) ? 'GFS'
                : (rawModel === 'ICON' && timeOffset > DISPLAY_ICON_MAX_HOURS) ? 'GFS'
                : (rawModel === 'EURO' && timeOffset > nativeLimit) ? 'GFS'
                : rawModel;
    const zoom = mapInstance.getZoom();
    const locks = marineFetchLocksRef.current;
    let requestId = 0;
    let clearDebounce = true;
    // Generation of the transition this fetch fulfills, if any. Captured at dispatch so
    // the finally can end ONLY the transition it owns — a stale request (older generation,
    // or a non-transition viewport refetch) can never end a newer transition.
    let capturedTransitionGen = null;

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
          scheduleDegenerateRetry(source, (nextSource) => {
            if (activeMarineLayersRef.current && updateMarineGridRef.current) {
              updateMarineGridRef.current(nextSource);
            }
          });
        }
        return;
      }
      resetRetryCounts();
      const isRetry = source === 'cooldown_retry' || source === 'delayed_retry' || source === 'swr_revalidation';
      const hasValidData = marineData && marineData.grid && marineData.grid.vectors && marineData.grid.vectors.length > 0;
      const isCorrectLayer = marineData?.grid?.__componentLayer === layer;
      let bypassDedupe = !hasValidData || !isCorrectLayer || !!(marineData?.stale || marineData?.grid?.stale);

      if (!isRetry && !isTimelineScrub && !bypassDedupe && locks.lastHash === viewportHash && (Date.now() - locks.lastTime < 5 * 60 * 1000)) return;
      if (locks.lastHash !== viewportHash) {
        consecutiveFailuresRef.current = 0;
        resetRetryCounts();
        clearAllTimers();
        locks.lastTime = 0; // Prevent 1200ms rate-limiter from blocking the fetch on layer/viewport switch
      }

      if (source !== 'swr_revalidation') {
        if (swrTimerRef.current) {
          clearTimeout(swrTimerRef.current);
          swrTimerRef.current = null;
        }
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
        recordChurn('abort', { site: 'updateMarineGrid', from: activeSource, to: source });
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
      const isActivation = source.startsWith('mount') || source.startsWith('load') || source.startsWith('manual');
      const bounds = handleRegionalGridClearing({
        mapInstance, isActivation, marineData, zoom, model, layer, setMarineData, lastCommittedSigRef
      });

      requestId = ++marineRequestIdRef.current;
      
      if (getRemainingCooldown('marine') > 0 || isInCooldown('marine')) {
        handleCooldownFallback({
          mapInstance, model, layer, timeOffset, timeOffsetRef, setMarineData, lastCommittedSigRef,
          marineRevision, getViewportHash, logPipelineEventHelper, cooldownRetryRef, consecutiveFailuresRef,
          clearTimeoutFunc: clearTimeout, getModelSafeMarine, _marineDataSignature, getSharedValidTime
        });
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
      // Take ownership of the open transition ONLY if this fetch's target identity matches it.
      // A viewport/moveend refetch (different intent) leaves capturedTransitionGen null and
      // therefore cannot end the transition.
      {
        const t = getTarget();
        if (t && t.status === 'pending' && t.model === rawModel && t.layer === layer) {
          capturedTransitionGen = t.gen;
        }
      }
      const fetchIntent = { model: rawModel, layer, hour: timeOffset };

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

        const expectedProvider = (modelName === 'EURO' && (COMPONENT_LAYERS.includes(targetLayer) || targetLayer === 'waves')) ? 'copernicus' : 'open-meteo';
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
        data = buildIconFallbackGrid(bounds, fallbackReason);
      } else if (model === 'EURO' && timeOffset > nativeLimit && !getBackendCopernicusFlag()) {
        data = buildEuroFallbackGrid(bounds, 'backend_required_no_frontend_estimator');
      } else if (data === null) {
        if (model === 'EURO' && layer && COMPONENT_LAYERS.includes(layer)) {
          if (getBackendCopernicusFlag()) {
            phase = 'standard_fetch_copernicus';
            try {
              data = await fetchMarineData(bounds, zoom, signal, timeOffset, false, model, layer);
              if (!data || !data.grid || (!data.grid.renderable && (!data.grid.vectors || data.grid.vectors.length === 0))) {
                console.warn('[Marine] Deployed Copernicus grid returned empty/unrenderable grid.');
                const failureReason = data?.grid?.__failureReason || 'unavailable';
                data = buildCopernicusEmptyGrid(bounds, timeOffset, layer, failureReason);
              }
            } catch (err) {
              if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort')) {
                throw err;
              } else {
                console.error('[Marine] Deployed Copernicus grid fetch failed:', err.message);
              }
              data = buildCopernicusEmptyGrid(bounds, timeOffset, layer, err.message || 'Copernicus grid fetch failed');
            }
          } else {
            data = {
              type: 'FeatureCollection',
              features: [],
              grid: {
                vectors: [], bounds, cols: 0, rows: 0, status: "no_coverage", source: "backend_required",
                provider: "none", is_estimated: false, fallbackReason: "backend_required_no_frontend_estimator",
                renderable: false, emptyGridWarning: "Backend Copernicus support is absent, no frontend estimator"
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

      const isUnsupportedLayer = data?.grid?.__unsupportedLayer || data?.__unsupportedLayer || data?.status === 'unsupported';
      if (isUnsupportedLayer) {
        console.log(`[Marine] Unsupported layer detected: ${model}/${layer}. Preserving existing heatmap.`);
        logPipelineEventHelper('unsupported_layer_preserved', { model, layer, hour: timeOffset, reason: data?.grid?.emptyGridWarning || 'unsupported_model_layer' });
        consecutiveFailuresRef.current = 0; locks.lastHash = viewportHash; locks.lastTime = Date.now();
        setMarineData(prev => {
          if (prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0) {
            return {
              ...prev,
              __unsupportedLayerOverride: { model, layer, reason: data?.grid?.emptyGridWarning || 'unsupported_model_layer' }
            };
          }
          lastCommittedSigRef.current = null;
          return data;
        });
        return;
      }

      if (data && (data.features?.length > 0 || data.grid?.vectors?.length > 0 || data.grid?.__skippedReason === 'zoom_too_low' || data.grid?.skippedReason === 'zoom_too_low' || data.grid?.emptyGridWarning)) {
        commitMarineData({
          data, bounds, model, layer, timeOffset, timeOffsetRef, setMarineData, lastCommittedSigRef,
          marineRevision, getViewportHash, logPipelineEventHelper, consecutiveFailuresRef,
          isCommittingDataRef, isInternalMapUpdateRef, internalUpdateTimerRef, locks, source,
          scheduleSWRRevalidation, updateMarineGrid, getBackendCopernicusFlag, getBackendIconMarineFlag,
          getBackendWeatherFlag, _marineDataSignature, getSharedValidTime, updateDeprecationDiag,
          setTimeoutFunc: setTimeout, clearTimeoutFunc: clearTimeout
        });
      } else {
        consecutiveFailuresRef.current += 1;
        const isCurrentHour = fetchIntent.hour === timeOffsetRef.current;
        if (!window.isScrubbingTimeline && isCurrentHour) {
          setMarineData(prev => {
            const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
            const prevModel = prev?.grid?.__sourceModel || prev?.__sourceModel;
            const prevLayer = prev?.grid?.__componentLayer || prev?.__componentLayer || 'waves';
            const isSameModelAndLayer = prevModel === model && prevLayer === layer;
            if (hasValidData && isSameModelAndLayer) {
              return { ...prev, stale: true, grid: { ...prev.grid, stale: true } };
            }
            lastCommittedSigRef.current = null;
            return null;
          });
        } else {
          console.log(`[Marine] Fetch returned empty/failed (isCurrentHour=${isCurrentHour}), preserving stale data.`);
        }
        if (isInCooldown('marine')) logPipelineEventHelper('rate_limit_429', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour });
        if (consecutiveFailuresRef.current >= 3 || ['cooldown_retry', 'delayed_retry'].includes(source)) return;
        scheduleCooldownRetry((src) => {
          if (updateMarineGridRef.current && activeMarineLayersRef.current) {
            updateMarineGridRef.current(src);
          }
        });
      }
    } catch (err) {
      const isAbort = err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort');
      if (isAbort) {
        console.log(`[Marine] Fetch aborted (expected during model/layer switch) phase=${phase}: ${err.message}`);
      } else {
        console.error(`[Orchestrator Fatal Exception] phase=${phase} error:`, err.message);
      }
      const isCurrentHour = timeOffset === timeOffsetRef.current;
      if (!isAbort && !window.isScrubbingTimeline && isCurrentHour) {
        setMarineData(prev => {
          const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
          const prevModel = prev?.grid?.__sourceModel || prev?.__sourceModel;
          const prevLayer = prev?.grid?.__componentLayer || prev?.__componentLayer || 'waves';
          const isSameModelAndLayer = prevModel === model && prevLayer === layer;
          if (hasValidData && isSameModelAndLayer) {
            return { ...prev, stale: true, grid: { ...prev.grid, stale: true } };
          }
          lastCommittedSigRef.current = null;
          return null;
        });
      } else if (isAbort && isCurrentHour && !window.isScrubbingTimeline) {
        if (requestId !== marineRequestIdRef.current) {
          console.log(`[ABORT RECOVERY] Discarding abort recovery because requestId (${requestId}) is stale (current=${marineRequestIdRef.current}).`);
          return;
        }
        console.log(`[ABORT RECOVERY] AbortError in phase=${phase}, model=${model}, layer=${layer}. Retry count: ${abortRecoveryRetryCountRef.current}/3`);
        const prev = marineDataRef.current;
        const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
        if (hasValidData) {
          console.log(`[ABORT RECOVERY] Previous valid data exists, preserving.`);
        } else {
          console.warn(`[ABORT RECOVERY] No previous data exists. Committing recovery grid to break LOADING deadlock.`);
          recordChurn('recovery_grid_commit', { model, layer, hour: timeOffset, phase, retry: abortRecoveryRetryCountRef.current });
          lastCommittedSigRef.current = null;
          marineRevision.current += 1;
          const recoveryGrid = getAbortRecoveryGrid(model, layer, phase, marineRevision.current);
          setMarineData(recoveryGrid);

          if (abortRecoveryRetryCountRef.current < 3) {
            abortRecoveryRetryCountRef.current += 1;
            const retryModel = model;
            const retryLayer = layer;
            setTimeout(() => {
              if (activeModelRef.current !== retryModel || (activeMarineLayerRef.current || 'waves') !== retryLayer) {
                console.log(`[ABORT RECOVERY] Discarding stale retry (target=${retryModel}/${retryLayer}, current=${activeModelRef.current}/${activeMarineLayerRef.current}).`);
                return;
              }
              if (enqueueMarineUpdateRef.current && activeMarineLayersRef.current) {
                console.log(`[ABORT RECOVERY] Scheduling retry fetch after abort recovery (attempt ${abortRecoveryRetryCountRef.current}/3).`);
                enqueueMarineUpdateRef.current('abort_recovery_retry');
              }
            }, 1500);
          } else {
            console.warn(`[ABORT RECOVERY] Max retries (3) reached. Stopping abort recovery loop.`);
          }
        }
      } else {
        console.log(`[Marine] Fetch exception (isAbort=${isAbort}, isCurrentHour=${isCurrentHour}), preserving stale data.`);
      }
    } finally {
      if (requestId === marineRequestIdRef.current) {
        locks.isFetching = false;
        locks.activeSource = null;
        if (typeof window !== 'undefined') {
          window.__MARINE_FETCH_PENDING__ = null;
          if (!timeoutIdRef.current && capturedTransitionGen !== null) {
            // End ONLY the transition this fetch owns. No-op if a newer transition began
            // (endTransition checks generation), so a stale request can't end it. The
            // coordinator mirrors __MARINE_TRANSITIONING__ for un-migrated readers.
            endTransition(capturedTransitionGen);
          }
          if (clearDebounce) {
            window.__MARINE_FETCH_DEBOUNCING__ = false;
          }
        }
        const pending = pendingMarineIntentRef.current;
        if (pending) {
          pendingMarineIntentRef.current = null;
          if (pending.model === activeModelRef.current && pending.layer === (activeMarineLayerRef.current || 'waves')) {
            const pendingSource = pending.source.includes('_pending') ? pending.source : pending.source + '_pending';
            setTimeout(() => enqueueMarineUpdateRef.current?.(pendingSource), 50);
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
      const isHighPriority = (src) => src === 'manual' || src.startsWith('manual') || src.includes('timeline') || src.includes('scrub');
      if (isHighPriority(activeSource) && !isHighPriority(source)) {
        console.log(`[Abort-Gate] Preserving high-priority fetch (${activeSource}) against low-priority request (${source})`);
        return;
      }
      console.log(`[Abort] Aborting active fetch (${activeSource}) in enqueueMarineUpdate for new source=${source}`);
      recordChurn('abort', { site: 'enqueueMarineUpdate', from: activeSource, to: source });
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      locks.isFetching = false;
      locks.activeSource = null;
      // Schedule a coalesced retry instead of falling through immediately.
      // The fall-through created chain reactions: each replacement fetch got
      // aborted by the next trigger from a different React effect (model-switch,
      // layer-activation, layer-switch all fire within milliseconds).
      // A 150ms coalesced retry absorbs all cross-effect collisions:
      // subsequent triggers are either deduped or cancel-and-replace this timer.
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = setTimeout(() => {
        // Timer has fired — it is no longer pending. Null the ref BEFORE running the
        // update so updateMarineGrid's finally sees no pending coalesced retry and can
        // end the transition. (If updateMarineGrid schedules a new retry, this ref is
        // reassigned and the transition is correctly kept open.)
        timeoutIdRef.current = null;
        if (!activeMarineLayersRef.current) return;
        updateMarineGrid(source);
      }, 150);
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
        // Timer fired — clear the ref so updateMarineGrid's finally can settle the
        // transition (see note in the abort-gate retry above).
        timeoutIdRef.current = null;
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
    marineDataRef.current = marineData;
  }, [marineData]);

  useEffect(() => {
    consecutiveFailuresRef.current = 0;
    abortRecoveryRetryCountRef.current = 0;
    resetRetryCounts();
  }, [activeModel, activeMarineLayer, timeOffsetHours]);

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
