import { useState, useRef, useEffect, useMemo } from 'react';
import { fetchMarineData, getRemainingCooldown, getMarineHourlyCache, extractMarineAtOffset, isContainedInMarineCache, getModelSafeMarine } from './marineController';
import { fetchCopernicusComponentGrid, mergeComponentGrid, COMPONENT_LAYERS } from './copernicusGridFetcher';
import { getBackendCopernicusFlag, getBackendWeatherFlag, getBackendIconMarineFlag } from './backendWeatherServiceClient';
import { estimateEuroGrid, estimateIconGrid, EURO_LIMIT_WAVES, EURO_LIMIT_COMPONENTS, ICON_LIMIT } from './euroExtendedEstimate';
import { isInCooldown, findClosestHourIndex } from './marineControllerUtils';
import { computeGridContentHash } from './marineGridHash';
import { _marineDataSignature, _logPipelineEvent } from './useMarineOrchestratorDiag';

const loadGrid = (model, layer, hour, bounds, zoom) =>
  model === 'EURO' && ['swell_1', 'swell_2', 'wind_waves'].includes(layer)
    ? fetchCopernicusComponentGrid(bounds, layer, hour, zoom)
    : fetchMarineData(bounds, zoom, null, hour, false, model, layer);

export function useMarineOrchestrator({ mapInstance, activeLayers, timeOffsetHours = 0, activeModel = 'GFS' }) {
  const [marineData, setMarineData] = useState(null);
  const marineRevision = useRef(0), marineRequestIdRef = useRef(0), activeMarineLayersRef = useRef(false);
  const marineFetchLocksRef = useRef({ lastHash: null, lastTime: 0, isFetching: false, manualFetchActiveUntil: 0 });
  const manualMarineTriggerRef = useRef(null), isCommittingDataRef = useRef(false), isInternalMapUpdateRef = useRef(false);
  const internalUpdateTimerRef = useRef(null), lastUserInteractionRef = useRef(0), lastStableCameraRef = useRef(null);
  const lastInvocationRef = useRef({ source: null, time: 0 }), timeOffsetRef = useRef(timeOffsetHours);
  const cooldownRetryRef = useRef(null), marineRetryCountRef = useRef(0), updateMarineGridRef = useRef(null);
  const hasActivatedRef = useRef(false), consecutiveFailuresRef = useRef(0), activeModelRef = useRef(activeModel);
  const lastFetchedModelRef = useRef(null), pendingMarineIntentRef = useRef(null), pipelineEventsRef = useRef([]);

  const pipelineCountersRef = useRef({
    networkFetches: 0, cacheRemaps: 0, duplicateCommitSkipped: 0, duplicateUploadSkipped: 0,
    staleRejections: 0, pendingIntents: 0, rateLimits: 0, extendedEstimateFetches: 0,
    extendedEstimateSkipped: 0, webglUploads: 0, webglClears: 0
  });

  const lastCommittedSigRef = useRef(null);
  const orchestratorInFlight = useRef(new Map());

  const getViewportHash = () => {
    if (!mapInstance) return null;
    try {
      const center = mapInstance.getCenter(), zoom = mapInstance.getZoom(), q = v => Number(v).toFixed(2), z = Math.round(zoom * 2) / 2;
      return `${q(center.lng)}:${q(center.lat)}:${z}:${activeModelRef.current}:${activeMarineLayerRef.current || 'waves'}:${timeOffsetRef.current}`;
    } catch (e) { return null; }
  };

  const logPipelineEventHelper = (eventType, detail) => {
    _logPipelineEvent(eventType, detail, pipelineEventsRef, pipelineCountersRef, activeModelRef, activeMarineLayerRef, timeOffsetRef, lastCommittedSigRef, pendingMarineIntentRef);
  };

  const activeMarineLayer = useMemo(() => {
    const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
    return activeLayers.find(l => MARINE_LAYERS.includes(l)) || null;
  }, [activeLayers]);
  const activeMarineLayerRef = useRef(activeMarineLayer);
  const lastFetchedLayerRef = useRef(null);

  useEffect(() => { activeModelRef.current = activeModel; if (typeof window !== 'undefined') window.activeModel = activeModel; }, [activeModel]);
  useEffect(() => { activeMarineLayerRef.current = activeMarineLayer; if (typeof window !== 'undefined') window.activeMarineLayer = activeMarineLayer || 'waves'; }, [activeMarineLayer]);
  useEffect(() => { if (typeof window !== 'undefined') window.activeTimeOffsetHours = timeOffsetHours; }, [timeOffsetHours]);

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
        consecutiveFailuresRef.current = 0; marineRetryCountRef.current = 0;
        manualMarineTriggerRef.current?.();
      }
    }, 50);
    return () => clearTimeout(t);
  }, [activeLayersKey]);

  useEffect(() => {
    if (!mapInstance) return;
    let timeoutId;
    const locks = marineFetchLocksRef.current;

    const updateMarineGrid = async (source = 'unknown') => {
      let phase = 'init';
      const model = activeModelRef.current, layer = activeMarineLayerRef.current || 'waves', timeOffset = timeOffsetRef.current;

      try {
        const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
        if (!isTimelineScrub && (window.isScrubbingTimeline || isCommittingDataRef.current)) return;
        if (!activeMarineLayersRef.current) return;
        const center = mapInstance.getCenter(), zoom = mapInstance.getZoom(), q = (v) => Number(v).toFixed(2), z = Math.round(zoom * 2) / 2;
        const viewportHash = `${q(center.lng)}:${q(center.lat)}:${z}:${model}:${layer}:${timeOffset}`;
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
            cachedData = getModelSafeMarine(model, timeOffset, layer);
          } catch (e) { console.warn('[Cooldown Fallback] cache check failed:', e.message); }

          if (cachedData?.grid?.vectors?.length > 0) {
            console.log(`[Cooldown Fallback] Reusing valid cached grid for ${model} layer=${layer} hour=+${timeOffset}h`);
            const sig = _marineDataSignature(cachedData, layer);
            if (sig && sig !== lastCommittedSigRef.current) {
              lastCommittedSigRef.current = sig; marineRevision.current += 1;
              cachedData.__commitRevision = marineRevision.current; setMarineData(cachedData);
            }
            return;
          }
          setMarineData(null); // Clear visual frame since rate limit is active and no cache exists
          return;
        }

        locks.isFetching = true;
        if (typeof window !== 'undefined') window.__MARINE_FETCH_PENDING__ = { model, layer, hour: timeOffset, timestamp: new Date().toISOString() };
        const fetchIntent = { model, layer, hour: timeOffset };

        const isWaves = layer === 'waves', nativeLimit = isWaves ? EURO_LIMIT_WAVES : EURO_LIMIT_COMPONENTS;
        const isPastLimit = model === 'EURO' && timeOffset > nativeLimit && !getBackendCopernicusFlag(), isIconPastLimit = model === 'ICON' && timeOffset > ICON_LIMIT;
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
          consecutiveFailuresRef.current = 0; locks.lastHash = viewportHash; locks.lastTime = Date.now(); lastFetchedLayerRef.current = layer;
          logPipelineEventHelper('data_committed', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour, provider: data?.grid?.__provider, vectorCount: data?.grid?.vectors?.length || 0 });
          isCommittingDataRef.current = true; isInternalMapUpdateRef.current = true;

          setMarineData(prev => {
            const newSig = _marineDataSignature(data, layer);
            if (newSig && newSig === lastCommittedSigRef.current) { logPipelineEventHelper('duplicate_commit_skipped', { signature: newSig }); return prev; }
            lastCommittedSigRef.current = newSig; marineRevision.current += 1; data.__commitRevision = marineRevision.current; return data;
          });
          requestAnimationFrame(() => { isCommittingDataRef.current = false; });
          clearTimeout(internalUpdateTimerRef.current); internalUpdateTimerRef.current = setTimeout(() => { isInternalMapUpdateRef.current = false; }, 800);
        } else {
          consecutiveFailuresRef.current += 1;
          setMarineData(null); // Clear visual grid honestly on fetch failure/empty data
          if (isInCooldown('marine')) logPipelineEventHelper('rate_limit_429', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour });
          if (consecutiveFailuresRef.current >= 3 || ['cooldown_retry', 'delayed_retry'].includes(source)) return;
          const remaining = getRemainingCooldown('marine'), delay = remaining > 0 ? remaining + 3000 : 5000, retrySource = remaining > 0 ? 'cooldown_retry' : 'delayed_retry';
          cooldownRetryRef.current = setTimeout(() => { cooldownRetryRef.current = null; if (updateMarineGridRef.current && activeMarineLayersRef.current) updateMarineGridRef.current(retrySource); }, delay);
        }
      } catch (err) {
        console.error(`[Orchestrator Fatal Exception] phase=${phase} error:`, err.message);
        setMarineData(null); // Clear grid on crash/error
      } finally {
        locks.isFetching = false;
        if (typeof window !== 'undefined') window.__MARINE_FETCH_PENDING__ = null;
        const pending = pendingMarineIntentRef.current;
        if (pending) {
          pendingMarineIntentRef.current = null;
          if (pending.model === activeModelRef.current && pending.layer === (activeMarineLayerRef.current || 'waves')) {
            setTimeout(() => enqueueMarineUpdate(pending.source + '_pending'), 50);
          } else { logPipelineEventHelper('pending_intent_expired', pending); }
        }
      }
    };

    const scheduledRef = { current: false };

    const enqueueMarineUpdate = (source) => {
      const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
      if (!isTimelineScrub && window.isScrubbingTimeline) return;
      const now = Date.now();
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
      } catch (e) {}

      const dedupeWindow = isCached ? 50 : 800;
      if (lastInvocationRef.current.source === source && now - lastInvocationRef.current.time < dedupeWindow) return;

      try {
        const center = mapInstance.getCenter(), zoom = mapInstance.getZoom(), q = (v) => Number(v).toFixed(2), z = Math.round(zoom * 2) / 2;
        const model = activeModelRef.current, layer = activeMarineLayerRef.current || 'waves', timeOffset = timeOffsetRef.current;
        const viewportHash = `${q(center.lng)}:${q(center.lat)}:${z}:${model}:${layer}:${timeOffset}`;
        if (locks.lastHash === viewportHash && (now - locks.lastTime < 5 * 60 * 1000)) return;
      } catch (e) {}

      lastInvocationRef.current = { source, time: now };
      if (scheduledRef.current) return;
      scheduledRef.current = true;

      requestAnimationFrame(() => {
        scheduledRef.current = false; clearTimeout(timeoutId);
        const stableDelay = isCached ? 20 : 300;
        timeoutId = setTimeout(() => {
          if (isTimelineScrub || (!mapInstance.isMoving() && !mapInstance.isZooming())) {
            updateMarineGrid(source);
          } else {
            mapInstance.once('idle', () => { if (activeMarineLayersRef.current) updateMarineGrid(source); });
          }
        }, stableDelay);
      });
    };

    manualMarineTriggerRef.current = () => enqueueMarineUpdate('manual');
    const moveendDebounceRef = { timer: null };

    const onMoveEnd = () => {
      if (window.isScrubbingTimeline) return;
      const center = mapInstance.getCenter(), zoom = mapInstance.getZoom(), cameraHash = `${center.lng.toFixed(3)}:${center.lat.toFixed(3)}:${zoom.toFixed(2)}`;
      if (lastStableCameraRef.current === cameraHash) return;
      lastStableCameraRef.current = cameraHash;

      let isCached = false;
      try {
        const b = mapInstance.getBounds(), bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
        isCached = isContainedInMarineCache(bounds, activeModelRef.current, timeOffsetRef.current, activeMarineLayerRef.current || 'waves');
      } catch (e) {}
      
      const debounceTime = isCached ? 50 : 900;
      clearTimeout(moveendDebounceRef.timer); moveendDebounceRef.timer = setTimeout(() => { enqueueMarineUpdate('moveend'); }, debounceTime);
    };

    const trackIntent = () => { lastUserInteractionRef.current = Date.now(); };
    ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => mapInstance.on(e, trackIntent));

    const onMapInternalUpdate = () => {
      isInternalMapUpdateRef.current = true; clearTimeout(internalUpdateTimerRef.current);
      internalUpdateTimerRef.current = setTimeout(() => { isInternalMapUpdateRef.current = false; }, 500);
    };
    mapInstance.on('sourcedata', onMapInternalUpdate); mapInstance.on('styledata', onMapInternalUpdate); mapInstance.on('moveend', onMoveEnd);

    if (activeMarineLayersRef.current) enqueueMarineUpdate('mount');

    return () => {
      clearTimeout(timeoutId); if (moveendDebounceRef.timer) clearTimeout(moveendDebounceRef.timer);
      if (internalUpdateTimerRef.current) clearTimeout(internalUpdateTimerRef.current);
      ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => mapInstance.off(e, trackIntent));
      mapInstance.off('sourcedata', onMapInternalUpdate); mapInstance.off('styledata', onMapInternalUpdate); mapInstance.off('moveend', onMoveEnd);
      manualMarineTriggerRef.current = null;
    };
  }, [mapInstance]);

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

    const cache = getMarineHourlyCache();

    let vpBounds = null;
    try {
      const b = mapInstance.getBounds();
      vpBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    } catch (e) {}

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
        return;
      }
    } else {
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

    // Cache Miss -> Fetch immediately!
    console.log(`[CACHE] [Marine] Cache miss for hour +${timeOffsetHours}h. Fetching...`);
    marineFetchLocksRef.current.lastHash = null;
    if (updateMarineGridRef.current) {
      updateMarineGridRef.current('timeline_scrub');
    }
  }, [timeOffsetHours, mapInstance]);

  useEffect(() => {
    if (!mapInstance || !activeMarineLayersRef.current) return;
    if (lastFetchedModelRef.current === activeModel) return;
    if (window.isScrubbingTimeline) return;

    lastFetchedModelRef.current = activeModel; lastFetchedLayerRef.current = null;
    console.log(`[MODEL] [Marine] Active model changed to ${activeModel}, triggering manual fetch...`);
    marineFetchLocksRef.current.lastHash = null; marineFetchLocksRef.current.lastTime = 0; consecutiveFailuresRef.current = 0; marineRetryCountRef.current = 0;
    const t = setTimeout(() => { manualMarineTriggerRef.current?.(); }, 350);
    return () => clearTimeout(t);
  }, [activeModel, mapInstance]);

  useEffect(() => {
    if (!mapInstance || !activeMarineLayer) return;
    if (lastFetchedLayerRef.current === activeMarineLayer) return;
    
    if (activeModel !== 'EURO') {
      try {
        const cache = getMarineHourlyCache();
        if (cache?.results?.length && cache.model === activeModel) {
          const remapped = extractMarineAtOffset(cache, timeOffsetHours, activeMarineLayer);
          if (remapped?.grid?.vectors?.length > 0) {
            const isRenderable = remapped.grid.__renderable !== false, sig = _marineDataSignature(remapped, activeMarineLayer);
            if (sig && sig === lastCommittedSigRef.current) { logPipelineEventHelper('duplicate_commit_skipped', { signature: sig }); lastFetchedLayerRef.current = activeMarineLayer; return; }
            const evtType = isRenderable ? 'local_cache_remap_renderable' : 'local_cache_remap_no_data';
            console.log(`[Marine] Layer switch to ${activeMarineLayer}: ${evtType}`);
            logPipelineEventHelper(evtType, { model: activeModel, layer: activeMarineLayer, hour: timeOffsetHours, renderable: isRenderable, noDataReason: remapped.grid.__noDataReason });
            
            lastCommittedSigRef.current = sig; marineRevision.current += 1; remapped.__commitRevision = marineRevision.current;
            const vHash = getViewportHash();
            if (vHash) { marineFetchLocksRef.current.lastHash = vHash; marineFetchLocksRef.current.lastTime = Date.now(); }

            setMarineData(remapped); lastFetchedLayerRef.current = activeMarineLayer; return;
          }
        }
      } catch (e) { console.warn('[Marine] Cache remap failed:', e.message); }
    }
    
    marineFetchLocksRef.current.lastHash = null; marineFetchLocksRef.current.lastTime = 0;
    const t = setTimeout(() => { manualMarineTriggerRef.current?.(); }, 350);
    return () => clearTimeout(t);
  }, [activeMarineLayer, activeModel, mapInstance]);

  return { marineData };
}
