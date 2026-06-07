import { useState, useRef, useEffect, useCallback } from 'react';
import { fetchMarineData, getRemainingCooldown, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { fetchCopernicusComponentGrid, mergeComponentGrid, COMPONENT_LAYERS } from './copernicusGridFetcher';
import { getBackendCopernicusFlag, getSharedValidTime } from './backendWeatherServiceClient';
import { estimateEuroGrid, estimateIconGrid, EURO_LIMIT_WAVES, EURO_LIMIT_COMPONENTS, ICON_LIMIT } from './euroExtendedEstimate';
import { isInCooldown } from './marineControllerUtils';
import { _marineDataSignature, _logPipelineEvent } from './useMarineOrchestratorDiag';

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

  const getViewportHash = useCallback(() => {
    if (!mapInstance) return null;
    try {
      const b = mapInstance.getBounds();
      const q = v => Number(v).toFixed(2);
      const bboxStr = `${q(b.getWest())},${q(b.getSouth())},${q(b.getEast())},${q(b.getNorth())}`;
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
    const model = activeModelRef.current;
    const layer = activeMarineLayerRef.current || 'waves';
    const timeOffset = timeOffsetRef.current;
    const zoom = mapInstance.getZoom();
    const locks = marineFetchLocksRef.current;

    try {
      const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
      if (!isTimelineScrub && (window.isScrubbingTimeline || isCommittingDataRef.current)) return;
      if (!activeMarineLayersRef.current) return;
      const viewportHash = getViewportHash();
      const isRetry = source === 'cooldown_retry' || source === 'delayed_retry';

      if (!isRetry && !isTimelineScrub && locks.lastHash === viewportHash && (Date.now() - locks.lastTime < 5 * 60 * 1000)) return;
      if (locks.lastHash !== viewportHash) { consecutiveFailuresRef.current = 0; marineRetryCountRef.current = 0; }
      updateMarineGridRef.current = updateMarineGrid;

      if (locks.isFetching) {
        pendingMarineIntentRef.current = { source, model, layer, hour: timeOffset, timestamp: Date.now() };
        logPipelineEventHelper('intent_buffered', pendingMarineIntentRef.current);
        return;
      }

      if (!isRetry && !isTimelineScrub && consecutiveFailuresRef.current >= 3) return;
      const now = Date.now();
      if (!isRetry && !isTimelineScrub && now - locks.lastTime < 1200) return;
      if (!isTimelineScrub && (mapInstance.isMoving() || mapInstance.isZooming())) return;

      phase = 'pre_fetch';
      const bounds = { west: -180, south: -85, east: 180, north: 85 };
      const requestId = ++marineRequestIdRef.current;
      
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
        setMarineData(null);
        return;
      }

      locks.isFetching = true;
      setMarineData(null);
      if (typeof window !== 'undefined') window.__MARINE_FETCH_PENDING__ = { model, layer, hour: timeOffset, timestamp: new Date().toISOString() };
      const fetchIntent = { model, layer, hour: timeOffset };

      const isWaves = layer === 'waves';
      const nativeLimit = isWaves ? EURO_LIMIT_WAVES : EURO_LIMIT_COMPONENTS;
      const isPastLimit = model === 'EURO' && timeOffset > nativeLimit && !getBackendCopernicusFlag();
      const isIconPastLimit = model === 'ICON' && timeOffset > ICON_LIMIT;
      let data = null;

      const safeLoadGrid = async (modelName, targetLayer, targetHour, targetBounds, targetZoom, diagObj) => {
        phase = `load_${modelName}_h${targetHour}`;
        
        try {
          const cached = getModelSafeMarine(modelName, targetHour, targetLayer, targetBounds);
          if (cached?.grid?.vectors?.length > 0) {
            diagObj.cacheHits.push(`${modelName}_h${targetHour}`);
            return cached;
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
            return await fetchMarineData(targetBounds, targetZoom, null, targetHour, false, modelName, targetLayer);
          } catch (e) {
            return null;
          } finally { orchestratorInFlight.current.delete(requestKey); }
        })();
        orchestratorInFlight.current.set(requestKey, promise);
        return promise;
      };

      const diagObj = {
        model, layer, targetHour: timeOffset, nativeLimit: isIconPastLimit ? ICON_LIMIT : nativeLimit,
        requiredSources: [], cacheHits: [], fetchStarted: [], skippedReason: null, resultStatus: 'pending',
        rateLimitStatus: 'ok', cooldownStatus: isInCooldown('marine') ? 'rate_limited' : 'ok', timestamp: new Date().toISOString()
      };
      window.__EXTENDED_ESTIMATE_FETCH_DIAG__ = diagObj;

      if (isPastLimit) {
        phase = 'extended_euro';
        logPipelineEventHelper('extended_estimate_fetch', { model: 'EURO', layer, hour: timeOffset });
        let vpBounds = null;
        if (!isWaves) {
          try {
            const b = mapInstance.getBounds(), west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
            const lngSpan = east - west, latSpan = north - south, padding = 0.25;
            vpBounds = {
              west: west - lngSpan * padding, east: east + lngSpan * padding,
              south: Math.max(-80, south - latSpan * padding), north: Math.min(85, north + latSpan * padding)
            };
          } catch (e) { vpBounds = { west: -125, south: 25, east: -65, north: 50 }; }
        }

        const isIconValid = timeOffset <= 168 && layer !== 'swell_2';
        diagObj.requiredSources = ['EURO_anchor', 'GFS_anchor', 'GFS_target'];
        if (isIconValid) diagObj.requiredSources.push('ICON_anchor', 'ICON_target');
        if (isInCooldown('marine')) {
          diagObj.skippedReason = 'cooldown_active'; diagObj.resultStatus = 'skipped';
          logPipelineEventHelper('extended_estimate_skipped', { model: 'EURO', layer, hour: timeOffset, reason: 'cooldown_active' });
          locks.isFetching = false; return;
        }

        const euroAnchor = await safeLoadGrid('EURO', layer, nativeLimit, vpBounds || bounds, zoom, diagObj);
        const gfsAnchor = await safeLoadGrid('GFS', layer, nativeLimit, vpBounds || bounds, zoom, diagObj);
        const gfsTarget = await safeLoadGrid('GFS', layer, timeOffset, vpBounds || bounds, zoom, diagObj);
        const iconAnchor = isIconValid ? await safeLoadGrid('ICON', layer, nativeLimit, vpBounds || bounds, zoom, diagObj) : null;
        const iconTarget = isIconValid ? await safeLoadGrid('ICON', layer, timeOffset, vpBounds || bounds, zoom, diagObj) : null;

        if (euroAnchor?.grid && gfsAnchor?.grid && gfsTarget?.grid) {
          const blendedGrid = estimateEuroGrid(timeOffset, nativeLimit, layer, euroAnchor.grid, gfsTarget.grid, gfsAnchor.grid, iconTarget?.grid, iconAnchor?.grid);
          if (blendedGrid) {
            data = {
              type: 'FeatureCollection', features: euroAnchor.features || [],
              grid: {
                ...blendedGrid, __sourceModel: 'EURO', __provider: 'estimated', __gridProvider: 'estimated',
                __componentLayer: layer, __gridSupportsLayer: true, __estimated: true,
                __estimateBasis: {
                  euroAnchorHour: nativeLimit, targetHour: timeOffset,
                  gfsWeight: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.weights?.gfs || 0,
                  iconWeight: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.weights?.icon || 0,
                  persistenceWeight: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.weights?.persistence || 0,
                  confidence: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.estimateConfidence || 0
                }, provider: 'estimated'
              }
            };
            diagObj.resultStatus = 'success';
            if (typeof window !== 'undefined') {
              window.__FORECAST_TIMELINE_COVERAGE_DIAG__ = window.__FORECAST_TIMELINE_COVERAGE_DIAG__ || {};
              window.__FORECAST_TIMELINE_COVERAGE_DIAG__.isEstimated = true;
              window.__FORECAST_TIMELINE_COVERAGE_DIAG__.estimateBasis = data.grid.__estimateBasis;
              window.__FORECAST_TIMELINE_COVERAGE_DIAG__.estimateSource = "frontend_fallback";
            }
          }
        }
        if (!data) {
          diagObj.resultStatus = 'failed_sources_missing';
          console.warn('[Extended Estimate] EURO estimate sources failed to load.');
        }
      } else if (isIconPastLimit) {
        phase = 'extended_icon';
        logPipelineEventHelper('extended_estimate_fetch', { model: 'ICON', layer, hour: timeOffset });
        let vpBounds = null;
        if (!isWaves) {
          try {
            const b = mapInstance.getBounds(), west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
            const lngSpan = east - west, latSpan = north - south, padding = 0.25;
            vpBounds = {
              west: west - lngSpan * padding, east: east + lngSpan * padding,
              south: Math.max(-80, south - latSpan * padding), north: Math.min(85, north + latSpan * padding)
            };
          } catch (e) { vpBounds = { west: -125, south: 25, east: -65, north: 50 }; }
        }

        diagObj.requiredSources = ['ICON_anchor', 'GFS_anchor', 'GFS_target'];
        if (isInCooldown('marine')) {
          diagObj.skippedReason = 'cooldown_active'; diagObj.resultStatus = 'skipped';
          logPipelineEventHelper('extended_estimate_skipped', { model: 'ICON', layer, hour: timeOffset, reason: 'cooldown_active' });
          locks.isFetching = false; return;
        }

        const iconAnchor = await safeLoadGrid('ICON', layer, ICON_LIMIT, vpBounds || bounds, zoom, diagObj);
        const gfsAnchor = await safeLoadGrid('GFS', layer, ICON_LIMIT, vpBounds || bounds, zoom, diagObj);
        const gfsTarget = await safeLoadGrid('GFS', layer, timeOffset, vpBounds || bounds, zoom, diagObj);

        if (iconAnchor?.grid && gfsAnchor?.grid && gfsTarget?.grid) {
          const blendedGrid = estimateIconGrid(timeOffset, ICON_LIMIT, layer, iconAnchor.grid, gfsTarget.grid, gfsAnchor.grid);
          if (blendedGrid) {
            data = {
              type: 'FeatureCollection', features: iconAnchor.features || [],
              grid: {
                ...blendedGrid, __sourceModel: 'ICON', __provider: 'estimated', __gridProvider: 'estimated',
                __componentLayer: layer, __gridSupportsLayer: true, __estimated: true,
                __estimateBasis: {
                  iconAnchorHour: ICON_LIMIT, targetHour: timeOffset,
                  gfsWeight: window.__ICON_EXTENDED_ESTIMATE_DIAG__?.weights?.gfs || 0,
                  persistenceWeight: window.__ICON_EXTENDED_ESTIMATE_DIAG__?.weights?.persistence || 0,
                  confidence: window.__ICON_EXTENDED_ESTIMATE_DIAG__?.estimateConfidence || 0
                }, provider: 'estimated'
              }
            };
            diagObj.resultStatus = 'success';
            if (typeof window !== 'undefined') {
              window.__FORECAST_TIMELINE_COVERAGE_DIAG__ = window.__FORECAST_TIMELINE_COVERAGE_DIAG__ || {};
              window.__FORECAST_TIMELINE_COVERAGE_DIAG__.isEstimated = true;
              window.__FORECAST_TIMELINE_COVERAGE_DIAG__.estimateBasis = data.grid.__estimateBasis;
              window.__FORECAST_TIMELINE_COVERAGE_DIAG__.estimateSource = "frontend_fallback";
            }
          }
        }
        if (!data) {
          diagObj.resultStatus = 'failed_sources_missing';
          console.warn('[Extended Estimate] ICON estimate sources failed to load.');
        }
      } else {
        if (model === 'EURO' && layer && COMPONENT_LAYERS.includes(layer)) {
          if (getBackendCopernicusFlag()) {
            phase = 'standard_fetch_copernicus';
            try {
              data = await fetchMarineData(bounds, zoom, null, timeOffset, false, model, layer);
               if (!data || !data.grid || !data.grid.renderable) {
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
                grid: { vectors: [], bounds, cols: 0, rows: 0, timestamp: Date.now(), __sourceModel: 'EURO', __provider: 'backend-weather-service', __gridProvider: 'backend-weather-service', __componentLayer: layer, __gridSupportsLayer: false, renderable: false, provider: 'backend-weather-service' }
              };
            }
          } else {
            phase = 'euro_component';
            try {
              const gfsGridData = await fetchMarineData(bounds, zoom, null, timeOffset, false, 'GFS', layer);
              if (gfsGridData?.grid?.vectors?.length > 0) {
                data = {
                  ...gfsGridData,
                  grid: {
                    ...gfsGridData.grid, __sourceModel: 'EURO', __provider: 'gfs_estimated_backdrop', __gridProvider: 'gfs_estimated_backdrop',
                    __baseProvider: 'open-meteo', __overlayProvider: 'pending_copernicus', __isEstimated: true, __componentLayer: layer, __gridSupportsLayer: true, provider: 'estimated'
                  }
                };
              }
            } catch (err) { console.warn('[Marine] Global backdrop fetch failed:', err.message); }

            if (!data) {
              data = {
                type: 'FeatureCollection', features: [],
                grid: { vectors: [], bounds, cols: 0, rows: 0, timestamp: Date.now(), __sourceModel: 'EURO', __provider: 'gfs_estimated_backdrop', __gridProvider: 'gfs_estimated_backdrop', __componentLayer: layer, __gridSupportsLayer: true, provider: 'estimated' }
              };
            }

            if (zoom < 4) {
              if (data?.grid) {
                data.grid.__provider = data.grid.__gridProvider = 'gfs_estimated_backdrop';
                data.grid.__componentLayer = layer; data.grid.__gridSupportsLayer = true;
                data.grid.__skippedReason = 'zoom_too_low_fallback'; data.grid.provider = 'estimated';
              }
            } else {
              try {
                const b = mapInstance.getBounds(), west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
                const lngSpan = east - west, latSpan = north - south, padding = 0.25;
                const vpBounds = { west: west - lngSpan * padding, east: east + lngSpan * padding, south: Math.max(-80, south - latSpan * padding), north: Math.min(85, north + latSpan * padding) };
                
                const stateValidator = {
                  getCurrentZoom: () => mapInstance?.getZoom(),
                  getCurrentBounds: () => {
                    try {
                      const b2 = mapInstance.getBounds();
                      return { west: b2.getWest(), south: b2.getSouth(), east: b2.getEast(), north: b2.getNorth() };
                    } catch (e) { return null; }
                  },
                  isActiveIntent: () => (
                    activeModelRef.current === 'EURO' &&
                    activeMarineLayerRef.current === layer &&
                    timeOffsetRef.current === timeOffset
                  )
                };

                const componentGrid = await fetchCopernicusComponentGrid(vpBounds, layer, timeOffset, zoom, stateValidator);
                if (componentGrid && componentGrid.grid?.vectors?.length > 0) {
                  data = mergeComponentGrid(data, componentGrid, layer);
                  if (data?.grid) { data.grid.__baseProvider = 'open-meteo'; data.grid.__overlayProvider = 'copernicus'; data.grid.__isBlended = true; }
                } else {
                  if (data?.grid) { data.grid.__provider = data.grid.__gridProvider = 'gfs_estimated_fallback'; data.grid.__overlayProvider = 'copernicus_unavailable'; data.grid.provider = 'estimated'; }
                }
              } catch (err) {
                console.warn('[Marine] Copernicus fetch failed:', err.message);
                if (data?.grid) { data.grid.__provider = data.grid.__gridProvider = 'gfs_estimated_fallback'; data.grid.__overlayProvider = 'copernicus_error'; data.grid.provider = 'estimated'; }
              }
            }
          }
        } else {
          phase = 'standard_fetch';
          data = await fetchMarineData(bounds, zoom, null, timeOffset, false, model, layer);
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

      if (data && (data.features?.length > 0 || data.grid?.vectors?.length > 0 || data.grid?.__skippedReason === 'zoom_too_low' || data.grid?.skippedReason === 'zoom_too_low')) {
        consecutiveFailuresRef.current = 0; locks.lastHash = viewportHash; locks.lastTime = Date.now();
        logPipelineEventHelper('data_committed', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour, provider: data?.grid?.__provider, vectorCount: data?.grid?.vectors?.length || 0 });
        isCommittingDataRef.current = true; isInternalMapUpdateRef.current = true;

        setMarineData(prev => {
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
      } else {
        consecutiveFailuresRef.current += 1;
        setMarineData(null);
        if (isInCooldown('marine')) logPipelineEventHelper('rate_limit_429', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour });
        if (consecutiveFailuresRef.current >= 3 || ['cooldown_retry', 'delayed_retry'].includes(source)) return;
        const remaining = getRemainingCooldown('marine'), delay = remaining > 0 ? remaining + 3000 : 5000, retrySource = remaining > 0 ? 'cooldown_retry' : 'delayed_retry';
        cooldownRetryRef.current = setTimeout(() => { cooldownRetryRef.current = null; if (updateMarineGridRef.current && activeMarineLayersRef.current) updateMarineGridRef.current(retrySource); }, delay);
      }
    } catch (err) {
      console.error(`[Orchestrator Fatal Exception] phase=${phase} error:`, err.message);
      setMarineData(null);
    } finally {
      locks.isFetching = false;
      if (typeof window !== 'undefined') window.__MARINE_FETCH_PENDING__ = null;
      const pending = pendingMarineIntentRef.current;
      if (pending) {
        pendingMarineIntentRef.current = null;
        if (pending.model === activeModelRef.current && pending.layer === (activeMarineLayerRef.current || 'waves')) {
          setTimeout(() => enqueueMarineUpdateRef.current?.(pending.source + '_pending'), 50);
        } else { logPipelineEventHelper('pending_intent_expired', pending); }
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
    const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
    if (!isTimelineScrub && window.isScrubbingTimeline) return;
    const now = Date.now();
    const locks = marineFetchLocksRef.current;
    if (locks.isFetching) {
      pendingMarineIntentRef.current = { source, model: activeModelRef.current, layer: activeMarineLayerRef.current || 'waves', hour: timeOffsetRef.current, timestamp: Date.now() };
      logPipelineEventHelper('intent_buffered', pendingMarineIntentRef.current); return;
    }

    if (source === 'manual') locks.manualFetchActiveUntil = now + 1500;
    if (source.includes('moveend') && now < (locks.manualFetchActiveUntil || 0)) return;

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
      if (locks.lastHash === viewportHash && (now - locks.lastTime < 5 * 60 * 1000)) return;
    } catch (e) {
      // ignore
    }

    lastInvocationRef.current = { source, time: now };
    if (scheduledRef.current) return;
    scheduledRef.current = true;

    requestAnimationFrame(() => {
      scheduledRef.current = false;
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      const stableDelay = isCached ? 20 : 300;
      timeoutIdRef.current = setTimeout(() => {
        if (isTimelineScrub || (!mapInstance.isMoving() && !mapInstance.isZooming())) {
          updateMarineGrid(source);
        } else {
          mapInstance.once('idle', () => { if (activeMarineLayersRef.current) updateMarineGrid(source); });
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

  useEffect(() => {
    return () => {
      if (cooldownRetryRef.current) clearTimeout(cooldownRetryRef.current);
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      if (moveendDebounceRef.current.timer) clearTimeout(moveendDebounceRef.current.timer);
      if (internalUpdateTimerRef.current) clearTimeout(internalUpdateTimerRef.current);
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
