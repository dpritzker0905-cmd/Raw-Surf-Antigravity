import { useState, useRef, useEffect, useMemo } from 'react';
import { fetchMarineData, getRemainingCooldown, getMarineHourlyCache, extractMarineAtOffset, isContainedInMarineCache } from './marineController';
import { fetchCopernicusComponentGrid, mergeComponentGrid, COMPONENT_LAYERS } from './copernicusGridFetcher';
import { estimateEuroGrid, estimateIconGrid, EURO_LIMIT_WAVES, EURO_LIMIT_COMPONENTS, ICON_LIMIT } from './euroExtendedEstimate';

const loadGrid = async (model, layer, hour, bounds, zoom) => {
  if (model === 'EURO' && ['swell_1', 'swell_2', 'wind_waves'].includes(layer)) {
    return fetchCopernicusComponentGrid(bounds, layer, hour, zoom);
  } else {
    return fetchMarineData(bounds, zoom, null, hour, false, model, layer);
  }
};

export function useMarineOrchestrator({ mapInstance, activeLayers, timeOffsetHours = 0, activeModel = 'GFS' }) {
  const [marineData, setMarineData] = useState(null);
  const marineRevision = useRef(0);
  const marineFetchLocksRef = useRef({ lastHash: null, lastTime: 0, isFetching: false, manualFetchActiveUntil: 0 });
  const marineRequestIdRef = useRef(0);
  const activeMarineLayersRef = useRef(false);
  const manualMarineTriggerRef = useRef(null);
  const isCommittingDataRef = useRef(false);
  const isInternalMapUpdateRef = useRef(false);
  const internalUpdateTimerRef = useRef(null);
  const lastUserInteractionRef = useRef(0);
  const lastStableCameraRef = useRef(null);
  const lastInvocationRef = useRef({ source: null, time: 0 });
  const timeOffsetRef = useRef(timeOffsetHours);
  const cooldownRetryRef = useRef(null);
  const marineRetryCountRef = useRef(0);
  const updateMarineGridRef = useRef(null);
  const hasActivatedRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const activeModelRef = useRef(activeModel);
  const lastFetchedModelRef = useRef(null);
  const pendingMarineIntentRef = useRef(null);
  const pipelineEventsRef = useRef([]);
  
  const pipelineCountersRef = useRef({
    networkFetches: 0,
    cacheRemaps: 0,
    duplicateCommitSkipped: 0,
    duplicateUploadSkipped: 0,
    staleRejections: 0,
    pendingIntents: 0,
    rateLimits: 0,
    extendedEstimateFetches: 0,
    extendedEstimateSkipped: 0,
    webglUploads: 0,
    webglClears: 0
  });

  const lastCommittedSigRef = useRef(null);
  const orchestratorInFlight = useRef(new Map());

  const getViewportHash = () => {
    if (!mapInstance) return null;
    try {
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();
      const q = (v) => Number(v).toFixed(2);
      const z = Math.round(zoom * 2) / 2;
      return `${q(center.lng)}:${q(center.lat)}:${z}:${activeModelRef.current}:${activeMarineLayerRef.current || 'waves'}:${timeOffsetRef.current}`;
    } catch (e) {
      return null;
    }
  };

  const _marineDataSignature = (data, layer) => {
    if (!data?.grid) return null;
    const g = data.grid;
    let checksum = 0;
    if (g.vectors?.length) {
      const step = Math.max(1, Math.floor(g.vectors.length / 20));
      for (let i = 0; i < g.vectors.length; i += step) {
        const c = g.vectors[i]?.[layer || 'waves'];
        if (c) checksum += (c.speed || 0) * 1000 | 0;
      }
    }
    return `${g.__sourceModel}_${g.__componentLayer}_${data.hourOffset}_${g.__provider}_${g.cols}x${g.rows}_n${g.vectors?.length}_nz${g.__activeLayerNonzeroCount}_mx${g.__activeLayerMax?.toFixed?.(2) || 0}_r${g.__renderable}_ck${checksum}`;
  };

  const _logPipelineEvent = (eventType, detail) => {
    const entry = { event: eventType, ...detail, timestamp: new Date().toISOString() };
    pipelineEventsRef.current = [...pipelineEventsRef.current.slice(-19), entry];
    
    if (eventType === 'stale_async_response_rejected') pipelineCountersRef.current.staleRejections++;
    if (eventType === 'intent_buffered') pipelineCountersRef.current.pendingIntents++;
    if (eventType.startsWith('network_fetch')) pipelineCountersRef.current.networkFetches++;
    if (eventType.startsWith('local_cache_remap')) pipelineCountersRef.current.cacheRemaps++;
    if (eventType === 'duplicate_commit_skipped') pipelineCountersRef.current.duplicateCommitSkipped++;
    if (eventType === 'extended_estimate_fetch') pipelineCountersRef.current.extendedEstimateFetches++;
    if (eventType === 'extended_estimate_skipped') pipelineCountersRef.current.extendedEstimateSkipped++;
    if (eventType === 'rate_limit_429') pipelineCountersRef.current.rateLimits++;

    if (typeof window !== 'undefined') {
      pipelineCountersRef.current.duplicateUploadSkipped = window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__ || 0;
      pipelineCountersRef.current.webglUploads = window.__WEBGL_MARINE_UPLOAD_COUNT__ || 0;
      pipelineCountersRef.current.webglClears = window.__WEBGL_MARINE_CLEAR_COUNT__ || 0;

      window.__MARINE_PIPELINE_TRUTH__ = {
        deployedVersion: 'v7.12',
        activeModel: activeModelRef.current,
        activeLayer: activeMarineLayerRef.current || 'waves',
        activeHour: timeOffsetRef.current,
        cacheMode: (activeModelRef.current || 'GFS') !== 'EURO' ? 'all_vars_model_cache' : 'layer_scoped',
        pendingIntent: pendingMarineIntentRef.current,
        fetchPending: !!window.__MARINE_FETCH_PENDING__,
        lastCommittedSignature: lastCommittedSigRef.current,
        counters: { ...pipelineCountersRef.current },
        lastEvents: pipelineEventsRef.current,
        timestamp: new Date().toISOString()
      };
    }
  };

  const activeMarineLayer = useMemo(() => {
    const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
    return activeLayers.find(l => MARINE_LAYERS.includes(l)) || null;
  }, [activeLayers]);
  const activeMarineLayerRef = useRef(activeMarineLayer);
  const lastFetchedLayerRef = useRef(null);

  useEffect(() => { activeModelRef.current = activeModel; if (typeof window !== 'undefined') window.activeModel = activeModel; }, [activeModel]);
  useEffect(() => { activeMarineLayerRef.current = activeMarineLayer; if (typeof window !== 'undefined') window.activeMarineLayer = activeMarineLayer || 'waves'; }, [activeMarineLayer]);
  useEffect(() => { timeOffsetRef.current = timeOffsetHours; if (typeof window !== 'undefined') window.activeTimeOffsetHours = timeOffsetHours; }, [timeOffsetHours]);

  const activeLayersKey = useMemo(() => activeLayers.join(','), [activeLayers]);
  const prevActiveLayersRef = useRef('');

  useEffect(() => {
    if (prevActiveLayersRef.current === activeLayersKey) return;
    prevActiveLayersRef.current = activeLayersKey;

    const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
    const hasMarine = MARINE_LAYERS.some(l => activeLayersKey.includes(l));

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
      if (window.isScrubbingTimeline) { console.log('[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing'); return; }

      if (isCommittingDataRef.current) {
        console.log(`[FETCH] [Marine Trace] aborted (data commit in progress) source=${source}`);
        return;
      }

      if (!activeMarineLayersRef.current) return;
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();

      const q = (v) => Number(v).toFixed(2);
      const z = Math.round(zoom * 2) / 2;
      const model = activeModelRef.current;
      const layer = activeMarineLayerRef.current || 'waves';
      const timeOffset = timeOffsetRef.current;
      const viewportHash = `${q(center.lng)}:${q(center.lat)}:${z}:${model}:${layer}:${timeOffset}`;

      const isRetry = source === 'cooldown_retry' || source === 'delayed_retry';

      if (!isRetry && locks.lastHash === viewportHash &&
          (Date.now() - locks.lastTime < 5 * 60 * 1000)) {
        return;
      }

      if (locks.lastHash !== viewportHash) {
        consecutiveFailuresRef.current = 0;
        marineRetryCountRef.current = 0;
      }

      updateMarineGridRef.current = updateMarineGrid;

      if (locks.isFetching) {
        pendingMarineIntentRef.current = { source, model, layer, hour: timeOffset, timestamp: Date.now() };
        _logPipelineEvent('intent_buffered', pendingMarineIntentRef.current);
        return;
      }

      if (!isRetry && consecutiveFailuresRef.current >= 3) return;
      const now = Date.now();
      if (!isRetry && now - locks.lastTime < 1200) return;

      if (mapInstance.isMoving() || mapInstance.isZooming()) {
        return;
      }

      const bounds = { west: -180, south: -85, east: 180, north: 85 };
      const requestId = ++marineRequestIdRef.current;
      const cooldownRemaining = getRemainingCooldown('marine');
      
      const is429 = cooldownRemaining > 0 || isInCooldown('marine');
      if (is429) {
        console.warn('[Orchestrator] 429 rate limit active, skipping network fetch and entering cooldown fallback');
        consecutiveFailuresRef.current = 3;
        clearTimeout(cooldownRetryRef.current);
        cooldownRetryRef.current = null;
        
        _logPipelineEvent('rate_limit_429', { model, layer, hour: timeOffset });
        
        const fallbackData = {
          type: 'FeatureCollection',
          features: [],
          grid: {
            vectors: [],
            bounds: { west: -180, south: -85, east: 180, north: 85 },
            cols: 0,
            rows: 0,
            timestamp: Date.now(),
            __sourceModel: activeModelRef.current,
            __provider: 'fallback_safe_zero',
            __gridProvider: 'fallback_safe_zero',
            __componentLayer: layer,
            __gridSupportsLayer: false,
            __renderable: false,
            __noDataReason: 'rate_limited',
            provider: 'fallback_safe_zero'
          },
          __provider: 'fallback_safe_zero'
        };
        locks.isFetching = false;
        setMarineData(fallbackData);
        return;
      }

      locks.isFetching = true;
      if (typeof window !== 'undefined') window.__MARINE_FETCH_PENDING__ = { model, layer, hour: timeOffset, timestamp: new Date().toISOString() };
      const fetchIntent = { model, layer, hour: timeOffset };
      
      try {
        const currentLayer = activeMarineLayerRef.current || 'waves';
        const isWaves = currentLayer === 'waves';
        const nativeLimit = isWaves ? EURO_LIMIT_WAVES : EURO_LIMIT_COMPONENTS;
        const isPastLimit = activeModelRef.current === 'EURO' && timeOffsetRef.current > nativeLimit;
        const isIconPastLimit = activeModelRef.current === 'ICON' && timeOffsetRef.current > ICON_LIMIT;

        let data = null;

        const safeLoadGrid = async (modelName, targetLayer, targetHour, targetBounds, targetZoom, diagObj) => {
          if (isInCooldown('marine')) {
            diagObj.cooldownStatus = 'rate_limited';
            diagObj.skippedReason = 'cooldown_active';
            return null;
          }

          try {
            const cache = getMarineHourlyCache();
            const isAllVar = modelName !== 'EURO';
            if (cache?.results?.length &&
                cache.model === modelName &&
                (isAllVar || (cache.activeLayer || 'waves') === targetLayer) &&
                Date.now() - cache.timestamp < 5 * 60 * 1000) {
              const cachedData = extractMarineAtOffset(cache, targetHour, targetLayer);
              if (cachedData?.grid?.vectors?.length > 0) {
                diagObj.cacheHits.push(`${modelName}_h${targetHour}`);
                return cachedData;
              }
            }
          } catch (e) {}

          const expectedProvider = (modelName === 'EURO' && COMPONENT_LAYERS.includes(targetLayer)) ? 'copernicus' : 'open-meteo';
          const layerKey = (modelName !== 'EURO') ? 'all' : (targetLayer || 'waves');
          const requestKey = `${modelName}_${layerKey}_${targetHour}_${expectedProvider}_vp_${targetZoom}`;
          
          if (orchestratorInFlight.current.has(requestKey)) {
            diagObj.cacheHits.push(`${modelName}_h${targetHour}_inflight`);
            return orchestratorInFlight.current.get(requestKey);
          }

          diagObj.fetchStarted.push(`${modelName}_h${targetHour}`);
          const promise = (async () => {
            try {
              if (modelName === 'EURO' && COMPONENT_LAYERS.includes(targetLayer)) {
                return await fetchCopernicusComponentGrid(targetBounds, targetLayer, targetHour, targetZoom);
              } else {
                return await fetchMarineData(targetBounds, targetZoom, null, targetHour, false, modelName, targetLayer);
              }
            } catch (e) {
              if (e.message.includes('429')) diagObj.rateLimitStatus = 'rate_limited';
              return null;
            } finally {
              orchestratorInFlight.current.delete(requestKey);
            }
          })();

          orchestratorInFlight.current.set(requestKey, promise);
          return promise;
        };

        const diagObj = {
          model: activeModelRef.current,
          layer: currentLayer,
          targetHour: timeOffsetRef.current,
          nativeLimit: isIconPastLimit ? ICON_LIMIT : nativeLimit,
          requiredSources: [],
          cacheHits: [],
          fetchStarted: [],
          skippedReason: null,
          resultStatus: 'pending',
          rateLimitStatus: 'ok',
          cooldownStatus: isInCooldown('marine') ? 'rate_limited' : 'ok',
          timestamp: new Date().toISOString()
        };
        window.__EXTENDED_ESTIMATE_FETCH_DIAG__ = diagObj;

        if (isPastLimit) {
          _logPipelineEvent('extended_estimate_fetch', { model: 'EURO', layer: currentLayer, hour: timeOffsetRef.current });
          console.log(`[Marine] EURO timeline offset +${timeOffsetRef.current}h is past native limit (+${nativeLimit}h). Generating Extended Estimate grid...`);
          
          let vpBounds = null;
          if (!isWaves) {
            try {
              const b = mapInstance.getBounds();
              const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
              const lngSpan = east - west, latSpan = north - south, padding = 0.25;
              vpBounds = {
                west: west - lngSpan * padding, east: east + lngSpan * padding,
                south: Math.max(-80, south - latSpan * padding), north: Math.min(85, north + latSpan * padding)
              };
            } catch (e) {
              vpBounds = { west: -125, south: 25, east: -65, north: 50 };
            }
          }

          const isIconValid = timeOffsetRef.current <= 168 && currentLayer !== 'swell_2';
          diagObj.requiredSources = ['EURO_anchor', 'GFS_anchor', 'GFS_target'];
          if (isIconValid) diagObj.requiredSources.push('ICON_anchor', 'ICON_target');

          if (isInCooldown('marine')) {
            diagObj.skippedReason = 'cooldown_active';
            diagObj.resultStatus = 'skipped';
            _logPipelineEvent('extended_estimate_skipped', { model: 'EURO', layer: currentLayer, hour: timeOffsetRef.current, reason: 'cooldown_active' });
            locks.isFetching = false;
            return;
          }

          const euroAnchor = await safeLoadGrid('EURO', currentLayer, nativeLimit, vpBounds || bounds, zoom, diagObj);
          const gfsAnchor = await safeLoadGrid('GFS', currentLayer, nativeLimit, bounds, zoom, diagObj);
          const gfsTarget = await safeLoadGrid('GFS', currentLayer, timeOffsetRef.current, bounds, zoom, diagObj);
          const iconAnchor = isIconValid ? await safeLoadGrid('ICON', currentLayer, nativeLimit, bounds, zoom, diagObj) : null;
          const iconTarget = isIconValid ? await safeLoadGrid('ICON', currentLayer, timeOffsetRef.current, bounds, zoom, diagObj) : null;

          if (euroAnchor?.grid && gfsAnchor?.grid && gfsTarget?.grid) {
            const blendedGrid = estimateEuroGrid(
              timeOffsetRef.current, nativeLimit, currentLayer,
              euroAnchor.grid, gfsTarget.grid, gfsAnchor.grid,
              iconTarget?.grid, iconAnchor?.grid
            );

            if (blendedGrid) {
              data = {
                type: 'FeatureCollection',
                features: euroAnchor.features || [],
                grid: {
                  ...blendedGrid,
                  __sourceModel: 'EURO', __provider: 'estimated', __gridProvider: 'estimated',
                  __componentLayer: currentLayer, __gridSupportsLayer: true, __estimated: true,
                  __estimateBasis: {
                    euroAnchorHour: nativeLimit, targetHour: timeOffsetRef.current,
                    gfsWeight: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.weights?.gfs || 0,
                    iconWeight: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.weights?.icon || 0,
                    persistenceWeight: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.weights?.persistence || 0,
                    confidence: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.estimateConfidence || 0
                  },
                  provider: 'estimated'
                }
              };
              diagObj.resultStatus = 'success';
            }
          }

          if (!data) {
            diagObj.resultStatus = 'failed_sources_missing';
            console.warn('[Extended Estimate] EURO estimate sources failed to load.');
            const currentModel = marineData?.grid?.__sourceModel;
            const currentLayerName = marineData?.grid?.__componentLayer;
            const currentHour = marineData?.hourOffset;
            if (currentModel === 'EURO' && currentLayerName === currentLayer && currentHour === timeOffsetRef.current) {
              locks.isFetching = false;
              return;
            }
          }
        } else if (isIconPastLimit) {
          _logPipelineEvent('extended_estimate_fetch', { model: 'ICON', layer: currentLayer, hour: timeOffsetRef.current });
          console.log(`[Marine] ICON timeline offset +${timeOffsetRef.current}h is past native limit (+${ICON_LIMIT}h). Generating Extended Estimate grid...`);
          
          diagObj.requiredSources = ['ICON_anchor', 'GFS_anchor', 'GFS_target'];

          if (isInCooldown('marine')) {
            diagObj.skippedReason = 'cooldown_active';
            diagObj.resultStatus = 'skipped';
            _logPipelineEvent('extended_estimate_skipped', { model: 'ICON', layer: currentLayer, hour: timeOffsetRef.current, reason: 'cooldown_active' });
            locks.isFetching = false;
            return;
          }

          const iconAnchor = await safeLoadGrid('ICON', currentLayer, ICON_LIMIT, bounds, zoom, diagObj);
          const gfsAnchor = await safeLoadGrid('GFS', currentLayer, ICON_LIMIT, bounds, zoom, diagObj);
          const gfsTarget = await safeLoadGrid('GFS', currentLayer, timeOffsetRef.current, bounds, zoom, diagObj);

          if (iconAnchor?.grid && gfsAnchor?.grid && gfsTarget?.grid) {
            const blendedGrid = estimateIconGrid(
              timeOffsetRef.current, ICON_LIMIT, currentLayer,
              iconAnchor.grid, gfsTarget.grid, gfsAnchor.grid
            );

            if (blendedGrid) {
              data = {
                type: 'FeatureCollection',
                features: iconAnchor.features || [],
                grid: {
                  ...blendedGrid,
                  __sourceModel: 'ICON', __provider: 'estimated', __gridProvider: 'estimated',
                  __componentLayer: currentLayer, __gridSupportsLayer: true, __estimated: true,
                  __estimateBasis: {
                    iconAnchorHour: ICON_LIMIT, targetHour: timeOffsetRef.current,
                    gfsWeight: window.__ICON_EXTENDED_ESTIMATE_DIAG__?.weights?.gfs || 0,
                    persistenceWeight: window.__ICON_EXTENDED_ESTIMATE_DIAG__?.weights?.persistence || 0,
                    confidence: window.__ICON_EXTENDED_ESTIMATE_DIAG__?.estimateConfidence || 0
                  },
                  provider: 'estimated'
                }
              };
              diagObj.resultStatus = 'success';
            }
          }

          if (!data) {
            diagObj.resultStatus = 'failed_sources_missing';
            console.warn('[Extended Estimate] ICON estimate sources failed to load.');
            const currentModel = marineData?.grid?.__sourceModel;
            const currentLayerName = marineData?.grid?.__componentLayer;
            const currentHour = marineData?.hourOffset;
            if (currentModel === 'ICON' && currentLayerName === currentLayer && currentHour === timeOffsetRef.current) {
              locks.isFetching = false;
              return;
            }
          }
        } else {
          const isEuroComponent = activeModelRef.current === 'EURO' && currentLayer && COMPONENT_LAYERS.includes(currentLayer);
          if (isEuroComponent) {
            try {
              const gfsGridData = await fetchMarineData(bounds, zoom, null, timeOffsetRef.current, false, 'GFS', currentLayer);
              if (gfsGridData?.grid?.vectors?.length > 0) {
                data = {
                  ...gfsGridData,
                  grid: {
                    ...gfsGridData.grid,
                    __sourceModel: 'EURO', __provider: 'gfs_estimated_backdrop', __gridProvider: 'gfs_estimated_backdrop',
                    __baseProvider: 'open-meteo', __overlayProvider: 'pending_copernicus',
                    __isEstimated: true, __componentLayer: currentLayer, __gridSupportsLayer: true,
                    provider: 'estimated'
                  }
                };
              }
            } catch (err) {
              console.warn('[Marine] Global backdrop fetch failed:', err.message);
            }

            if (!data) {
              data = {
                type: 'FeatureCollection', features: [],
                grid: { vectors: [], bounds: { west: -180, south: -85, east: 180, north: 85 }, cols: 0, rows: 0, timestamp: Date.now(), __sourceModel: 'EURO', __provider: 'gfs_estimated_backdrop', __gridProvider: 'gfs_estimated_backdrop', __componentLayer: currentLayer, __gridSupportsLayer: true, provider: 'estimated' }
              };
            }

            if (zoom < 4) {
              console.log(`[Marine] Zoom ${zoom} < 4, using GFS estimated backdrop`);
              if (data?.grid) {
                data.grid.__provider = 'gfs_estimated_backdrop';
                data.grid.__gridProvider = 'gfs_estimated_backdrop';
                data.grid.__componentLayer = currentLayer;
                data.grid.__gridSupportsLayer = true;
                data.grid.__skippedReason = 'zoom_too_low_fallback';
                data.grid.provider = 'estimated';
              }
            } else {
              try {
                const b = mapInstance.getBounds();
                const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
                const lngSpan = east - west, latSpan = north - south, padding = 0.25;
                const vpBounds = {
                  west: west - lngSpan * padding, east: east + lngSpan * padding,
                  south: Math.max(-80, south - latSpan * padding), north: Math.min(85, north + latSpan * padding)
                };
                const componentGrid = await fetchCopernicusComponentGrid(vpBounds, currentLayer, timeOffsetRef.current, zoom);
                if (componentGrid && componentGrid.grid?.vectors?.length > 0) {
                  data = mergeComponentGrid(data, componentGrid, currentLayer);
                  if (data?.grid) {
                    data.grid.__baseProvider = 'open-meteo';
                    data.grid.__overlayProvider = 'copernicus';
                    data.grid.__isBlended = true;
                  }
                } else {
                  console.log(`[Marine] Copernicus returned empty for ${currentLayer}, keeping GFS estimated backdrop`);
                  if (data?.grid) {
                    data.grid.__provider = 'gfs_estimated_fallback';
                    data.grid.__gridProvider = 'gfs_estimated_fallback';
                    data.grid.__overlayProvider = 'copernicus_unavailable';
                    data.grid.provider = 'estimated';
                  }
                }
              } catch (err) {
                console.warn('[Marine] Copernicus fetch failed:', err.message);
                if (data?.grid) {
                  data.grid.__provider = 'gfs_estimated_fallback';
                  data.grid.__gridProvider = 'gfs_estimated_fallback';
                  data.grid.__overlayProvider = 'copernicus_error';
                  data.grid.provider = 'estimated';
                }
              }
            }
          } else {
            data = await fetchMarineData(bounds, zoom, null, timeOffsetRef.current, false, activeModelRef.current, currentLayer);
          }
        }

        if (requestId !== marineRequestIdRef.current) return;
        if (fetchIntent.model !== activeModelRef.current || fetchIntent.layer !== (activeMarineLayerRef.current || 'waves') || fetchIntent.hour !== timeOffsetRef.current) {
          _logPipelineEvent('stale_async_response_rejected', fetchIntent);
          return;
        }

        if (typeof window !== 'undefined') {
          let nzCount = 0;
          if (data?.grid?.vectors) {
            for (const v of data.grid.vectors) {
              if (v) {
                const comp = v[currentLayer] || v.waves || v.swell_1 || v.swell_2 || v.wind_waves || v;
                if (comp && comp.speed > 0) nzCount++;
              }
            }
          }
          window.__MARINE_FETCH_DIAG__ = { activeModel: activeModelRef.current, activeLayer: currentLayer, timeOffsetHours: timeOffsetRef.current, provider: data?.grid?.__provider || 'none', gridProvider: data?.grid?.__gridProvider || 'none', httpStatus: data ? 200 : 502, elapsedMs: Date.now() - now, vectorCount: data?.grid?.vectors?.length || 0, nonzeroCount: nzCount, timestamp: new Date().toISOString() };
        }

        const hasFeatures = data?.features?.length > 0;
        const hasGridVectors = data?.grid?.vectors?.length > 0;
        const hasSkippedZoom = data?.grid?.__skippedReason === 'zoom_too_low' || data?.grid?.skippedReason === 'zoom_too_low';

        if (data && (hasFeatures || hasGridVectors || hasSkippedZoom)) {
          consecutiveFailuresRef.current = 0;
          locks.lastHash = viewportHash;
          locks.lastTime = Date.now();
          lastFetchedLayerRef.current = currentLayer;
          _logPipelineEvent('data_committed', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour, provider: data?.grid?.__provider, vectorCount: data?.grid?.vectors?.length || 0 });

          isCommittingDataRef.current = true;
          isInternalMapUpdateRef.current = true;

          setMarineData(prev => {
            const newSig = _marineDataSignature(data, currentLayer);
            const prevSig = lastCommittedSigRef.current;
            if (newSig && newSig === prevSig) {
              _logPipelineEvent('duplicate_commit_skipped', { signature: newSig });
              return prev;
            }
            lastCommittedSigRef.current = newSig;
            marineRevision.current += 1;
            data.__commitRevision = marineRevision.current;
            return data;
          });

          requestAnimationFrame(() => { isCommittingDataRef.current = false; });
          clearTimeout(internalUpdateTimerRef.current);
          internalUpdateTimerRef.current = setTimeout(() => { isInternalMapUpdateRef.current = false; }, 800);
        } else {
          consecutiveFailuresRef.current += 1;
          
          if (isInCooldown('marine')) {
            _logPipelineEvent('rate_limit_429', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour });
          }

          if (typeof window !== 'undefined') window.__MARINE_FETCH_DIAG__ = { activeModel: activeModelRef.current, activeLayer: currentLayer, timeOffsetHours: timeOffsetRef.current, provider: 'none', httpStatus: 502, elapsedMs: Date.now() - now, vectorCount: 0, consecutiveFailures: consecutiveFailuresRef.current, timestamp: new Date().toISOString() };
          if (consecutiveFailuresRef.current >= 3) return;
          if (['cooldown_retry', 'delayed_retry'].includes(source)) return;
          const remaining = getRemainingCooldown('marine');
          marineRetryCountRef.current = (marineRetryCountRef.current || 0) + 1;
          if (marineRetryCountRef.current > 3) { marineRetryCountRef.current = 0;
          } else if (!cooldownRetryRef.current) {
            const delay = remaining > 0 ? remaining + 3000 : 5000;
            const retrySource = remaining > 0 ? 'cooldown_retry' : 'delayed_retry';
            cooldownRetryRef.current = setTimeout(() => { cooldownRetryRef.current = null; if (updateMarineGridRef.current && activeMarineLayersRef.current) updateMarineGridRef.current(retrySource); }, delay);
          }
        }
      } finally {
        locks.isFetching = false;
        if (typeof window !== 'undefined') window.__MARINE_FETCH_PENDING__ = null;
        const pending = pendingMarineIntentRef.current;
        if (pending) {
          pendingMarineIntentRef.current = null;
          if (pending.model === activeModelRef.current && pending.layer === (activeMarineLayerRef.current || 'waves')) {
            console.log(`[Marine] Replaying pending intent: ${pending.source} model=${pending.model} layer=${pending.layer}`);
            setTimeout(() => enqueueMarineUpdate(pending.source + '_pending'), 50);
          } else {
            _logPipelineEvent('pending_intent_expired', pending);
          }
        }
      }
    };

    const scheduledRef = { current: false };

    const enqueueMarineUpdate = (source) => {
      if (window.isScrubbingTimeline) {
        console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing");
        return;
      }

      const now = Date.now();

      if (locks.isFetching) {
        pendingMarineIntentRef.current = { source, model: activeModelRef.current, layer: activeMarineLayerRef.current || 'waves', hour: timeOffsetRef.current, timestamp: Date.now() };
        _logPipelineEvent('intent_buffered', pendingMarineIntentRef.current);
        return;
      }

      if (source === 'manual') {
        locks.manualFetchActiveUntil = now + 1500;
      }

      if (source.includes('moveend') && now < (locks.manualFetchActiveUntil || 0)) {
        return;
      }

      let isCached = false;
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(), south: b.getSouth(),
          east: b.getEast(), north: b.getNorth()
        };
        isCached = isContainedInMarineCache(bounds, activeModelRef.current, timeOffsetRef.current, activeMarineLayerRef.current || 'waves');
      } catch (e) {}

      const dedupeWindow = isCached ? 50 : 800;
      if (lastInvocationRef.current.source === source && now - lastInvocationRef.current.time < dedupeWindow) {
        return;
      }

      try {
        const center = mapInstance.getCenter();
        const zoom = mapInstance.getZoom();
        const q = (v) => Number(v).toFixed(2);
        const z = Math.round(zoom * 2) / 2;
        const model = activeModelRef.current;
        const layer = activeMarineLayerRef.current || 'waves';
        const timeOffset = timeOffsetRef.current;
        const viewportHash = `${q(center.lng)}:${q(center.lat)}:${z}:${model}:${layer}:${timeOffset}`;
        if (locks.lastHash === viewportHash && (now - locks.lastTime < 5 * 60 * 1000)) {
          return;
        }
      } catch (e) {}

      lastInvocationRef.current = { source, time: now };

      if (scheduledRef.current) return;
      scheduledRef.current = true;

      requestAnimationFrame(() => {
        scheduledRef.current = false;
        clearTimeout(timeoutId);
        const stableDelay = isCached ? 20 : 300;
        timeoutId = setTimeout(() => {
          if (!mapInstance.isMoving() && !mapInstance.isZooming()) {
            updateMarineGrid(source);
          } else {
            mapInstance.once('idle', () => {
              if (activeMarineLayersRef.current) {
                updateMarineGrid(source);
              }
            });
          }
        }, stableDelay);
      });
    };

    manualMarineTriggerRef.current = () => enqueueMarineUpdate('manual');

    const moveendDebounceRef = { timer: null };

    const onMoveEnd = () => {
      if (window.isScrubbingTimeline) return;
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();
      const cameraHash = `${center.lng.toFixed(3)}:${center.lat.toFixed(3)}:${zoom.toFixed(2)}`;
      if (lastStableCameraRef.current === cameraHash) return;
      lastStableCameraRef.current = cameraHash;

      let isCached = false;
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(), south: b.getSouth(),
          east: b.getEast(), north: b.getNorth()
        };
        isCached = isContainedInMarineCache(bounds, activeModelRef.current, timeOffsetRef.current, activeMarineLayerRef.current || 'waves');
      } catch (e) {}
      
      const debounceTime = isCached ? 50 : 900;
      clearTimeout(moveendDebounceRef.timer);
      moveendDebounceRef.timer = setTimeout(() => { enqueueMarineUpdate('moveend'); }, debounceTime);
    };

    const trackIntent = () => { lastUserInteractionRef.current = Date.now(); };
    ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => mapInstance.on(e, trackIntent));

    const onMapInternalUpdate = () => {
      isInternalMapUpdateRef.current = true;
      clearTimeout(internalUpdateTimerRef.current);
      internalUpdateTimerRef.current = setTimeout(() => {
        isInternalMapUpdateRef.current = false;
      }, 500);
    };
    mapInstance.on('sourcedata', onMapInternalUpdate);
    mapInstance.on('styledata', onMapInternalUpdate);
    mapInstance.on('moveend', onMoveEnd);

    if (activeMarineLayersRef.current) {
      enqueueMarineUpdate('mount');
    }

    return () => {
      clearTimeout(timeoutId);
      if (moveendDebounceRef.timer) clearTimeout(moveendDebounceRef.timer);
      if (internalUpdateTimerRef.current) clearTimeout(internalUpdateTimerRef.current);
      ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => mapInstance.off(e, trackIntent));
      mapInstance.off('sourcedata', onMapInternalUpdate);
      mapInstance.off('styledata', onMapInternalUpdate);
      mapInstance.off('moveend', onMoveEnd);
      manualMarineTriggerRef.current = null;
    };
  }, [mapInstance]);

  useEffect(() => {
    const prev = timeOffsetRef.current;
    timeOffsetRef.current = timeOffsetHours;
    if (prev === timeOffsetHours) return;
    if (!mapInstance || !activeMarineLayersRef.current) return;

    try {
      const cache = getMarineHourlyCache();
      const curModel = activeModelRef.current || 'GFS';
      const curLayer = activeMarineLayerRef.current || 'waves';
      const isAllVar = curModel !== 'EURO';
      if (cache?.results?.length &&
          cache.model === curModel &&
          (isAllVar || (cache.activeLayer || 'waves') === curLayer)) {
        const data = extractMarineAtOffset(cache, timeOffsetHours, curLayer);
        if (data) {
          const sig = _marineDataSignature(data, curLayer);
          if (sig && sig !== lastCommittedSigRef.current) {
            const evtType = data.grid?.__renderable ? 'local_cache_remap_timeline' : 'local_cache_remap_timeline_no_data';
            console.log(`[SCRUB] [CACHE] Instant re-index: +${timeOffsetHours}h model=${curModel} layer=${curLayer} renderable=${data.grid?.__renderable}`);
            lastCommittedSigRef.current = sig;
            _logPipelineEvent(evtType, { model: curModel, layer: curLayer, hour: timeOffsetHours, renderable: data.grid?.__renderable });
            marineRevision.current += 1;
            data.__commitRevision = marineRevision.current;
            
            const vHash = getViewportHash();
            if (vHash) {
              marineFetchLocksRef.current.lastHash = vHash;
              marineFetchLocksRef.current.lastTime = Date.now();
            }
            
            setMarineData(data);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('[CACHE] Local timeline re-index failed:', e.message);
    }
    
    if (window.isScrubbingTimeline) {
      console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing, settle scheduled");
      const settle = setTimeout(() => {
        if (!window.isScrubbingTimeline) {
          marineFetchLocksRef.current.lastHash = null;
          manualMarineTriggerRef.current?.();
        }
      }, 500);
      return () => clearTimeout(settle);
    }

    marineFetchLocksRef.current.lastHash = null;
    const t = setTimeout(() => {
      manualMarineTriggerRef.current?.();
    }, 350);
    return () => clearTimeout(t);
  }, [timeOffsetHours, mapInstance]);

  useEffect(() => {
    if (!mapInstance || !activeMarineLayersRef.current) return;

    if (lastFetchedModelRef.current === activeModel) {
      return;
    }

    if (window.isScrubbingTimeline) {
      console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing");
      return;
    }

    lastFetchedModelRef.current = activeModel;
    lastFetchedLayerRef.current = null;
    console.log(`[MODEL] [Marine] Active model changed to ${activeModel}, triggering manual fetch...`);
    marineFetchLocksRef.current.lastHash = null;
    marineFetchLocksRef.current.lastTime = 0;
    consecutiveFailuresRef.current = 0;
    marineRetryCountRef.current = 0;
    const t = setTimeout(() => {
      manualMarineTriggerRef.current?.();
    }, 350);
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
            const isRenderable = remapped.grid.__renderable !== false;
            const sig = _marineDataSignature(remapped, activeMarineLayer);
            
            if (sig && sig === lastCommittedSigRef.current) {
              _logPipelineEvent('duplicate_commit_skipped', { signature: sig });
              lastFetchedLayerRef.current = activeMarineLayer;
              return;
            }

            const evtType = isRenderable ? 'local_cache_remap_renderable' : 'local_cache_remap_no_data';
            console.log(`[Marine] Layer switch to ${activeMarineLayer}: ${evtType} (no network fetch)`);
            _logPipelineEvent(evtType, { model: activeModel, layer: activeMarineLayer, hour: timeOffsetHours, renderable: isRenderable, noDataReason: remapped.grid.__noDataReason });
            
            lastCommittedSigRef.current = sig;
            marineRevision.current += 1;
            remapped.__commitRevision = marineRevision.current;
            
            const vHash = getViewportHash();
            if (vHash) {
              marineFetchLocksRef.current.lastHash = vHash;
              marineFetchLocksRef.current.lastTime = Date.now();
            }

            setMarineData(remapped);
            lastFetchedLayerRef.current = activeMarineLayer;
            return;
          } else {
            const reason = !cache ? 'no_cache' : !remapped ? 'extract_returned_null' : 'no_vectors';
            console.log(`[Marine] Layer changed to ${activeMarineLayer} (model=${activeModel}), cache miss: ${reason}`);
            _logPipelineEvent('network_fetch_layer_change', { model: activeModel, layer: activeMarineLayer, reason });
          }
        } else {
          const reason = !getMarineHourlyCache() ? 'no_cache' : !getMarineHourlyCache()?.results?.length ? 'empty_cache' : 'model_mismatch';
          console.log(`[Marine] Layer changed to ${activeMarineLayer} (model=${activeModel}), cache miss: ${reason}`);
          _logPipelineEvent('network_fetch_layer_change', { model: activeModel, layer: activeMarineLayer, reason });
        }
      } catch (e) { console.warn('[Marine] Cache remap failed:', e.message); }
    } else {
      console.log(`[Marine] Layer changed to ${activeMarineLayer} (model=${activeModel}), EURO is layer-scoped`);
      _logPipelineEvent('network_fetch_layer_change', { model: activeModel, layer: activeMarineLayer, reason: 'euro_layer_scoped' });
    }
    
    marineFetchLocksRef.current.lastHash = null;
    marineFetchLocksRef.current.lastTime = 0;
    const t = setTimeout(() => { manualMarineTriggerRef.current?.(); }, 350);
    return () => clearTimeout(t);
  }, [activeMarineLayer, activeModel, mapInstance]);

  return { marineData };
}
