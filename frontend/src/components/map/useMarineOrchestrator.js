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
  const pendingMarineIntentRef = useRef(null); // v7.7: Buffer for dropped requests during in-flight
  const pipelineEventsRef = useRef([]); // v7.7: Last 10 pipeline events
  const pipelineCountersRef = useRef({ staleRejections: 0, pendingIntents: 0, networkFetches: 0, cacheRemaps: 0, clears: 0 });

  // v7.7: Pipeline event logger + truth diagnostic
  const _logPipelineEvent = (eventType, detail) => {
    const entry = { event: eventType, ...detail, timestamp: new Date().toISOString() };
    pipelineEventsRef.current = [...pipelineEventsRef.current.slice(-9), entry];
    if (eventType === 'stale_async_response_rejected') pipelineCountersRef.current.staleRejections++;
    if (eventType === 'intent_buffered') pipelineCountersRef.current.pendingIntents++;
    if (eventType.startsWith('network_fetch')) pipelineCountersRef.current.networkFetches++;
    if (eventType === 'local_cache_remap') pipelineCountersRef.current.cacheRemaps++;
    if (typeof window !== 'undefined') {
      window.__MARINE_PIPELINE_TRUTH__ = {
        activeModel: activeModelRef.current, activeLayer: activeMarineLayerRef.current || 'waves', activeHour: timeOffsetRef.current,
        pendingIntent: pendingMarineIntentRef.current,
        fetchPending: !!window.__MARINE_FETCH_PENDING__,
        fetchDiag: window.__MARINE_FETCH_DIAG__ || null,
        counters: { ...pipelineCountersRef.current },
        lastEvents: pipelineEventsRef.current,
        timestamp: new Date().toISOString()
      };
    }
  };

  // v6.5: Derive the active marine layer for Copernicus component grid routing
  const activeMarineLayer = useMemo(() => {
    const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
    return activeLayers.find(l => MARINE_LAYERS.includes(l)) || null;
  }, [activeLayers]);
  const activeMarineLayerRef = useRef(activeMarineLayer);
  const lastFetchedLayerRef = useRef(null);

  useEffect(() => {
    activeModelRef.current = activeModel;
    if (typeof window !== 'undefined') {
      window.activeModel = activeModel;
    }
  }, [activeModel]);

  useEffect(() => {
    activeMarineLayerRef.current = activeMarineLayer;
    if (typeof window !== 'undefined') {
      window.activeMarineLayer = activeMarineLayer || 'waves';
    }
  }, [activeMarineLayer]);

  useEffect(() => {
    timeOffsetRef.current = timeOffsetHours;
    if (typeof window !== 'undefined') {
      window.activeTimeOffsetHours = timeOffsetHours;
    }
  }, [timeOffsetHours]);

  const activeLayersKey = useMemo(() => activeLayers.join(','), [activeLayers]);

  const prevActiveLayersRef = useRef('');

  // Layer State Tracker: Decoupled from Fetch Orchestrator
  useEffect(() => {
    if (prevActiveLayersRef.current === activeLayersKey) return;
    prevActiveLayersRef.current = activeLayersKey;

    const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
    const hasMarine = MARINE_LAYERS.some(l => activeLayersKey.includes(l));

    const t = setTimeout(() => {
      const previouslyHadMarine = activeMarineLayersRef.current;
      activeMarineLayersRef.current = hasMarine;

      if (!hasMarine) {
        // Reset activation guard when all marine layers disabled
        hasActivatedRef.current = false;
      } else if (!previouslyHadMarine && !hasActivatedRef.current) {
        // Only trigger manual fetch on FIRST activation, not re-renders
        hasActivatedRef.current = true;
        console.log('[Marine] Layer activated, triggering manual fetch...');
        // Reset hash and circuit breaker so the 5-min TTL guard does not block re-activation fetches
        marineFetchLocksRef.current.lastHash = null;
        marineFetchLocksRef.current.lastTime = 0;
        consecutiveFailuresRef.current = 0;
        marineRetryCountRef.current = 0;
        manualMarineTriggerRef.current?.();
      }
    }, 50);

    return () => clearTimeout(t);
  }, [activeLayersKey]); // Deliberately omit marineData to prevent loops

  // Network Orchestrator: Purely viewport driven, zero knowledge of rendering
  useEffect(() => {
    if (!mapInstance) return;

    let timeoutId;
    const locks = marineFetchLocksRef.current;

    const updateMarineGrid = async (source = 'unknown') => {
      // Scrubbing mode hard freeze (Request 3)
      if (window.isScrubbingTimeline) {
        console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing");
        return;
      }

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

      // Viewport Hash Guard with 5m TTL (bypass for retries)
      if (!isRetry && locks.lastHash === viewportHash &&
          (Date.now() - locks.lastTime < 5 * 60 * 1000)) {
        return;
      }

      // v3.9: Reset circuit breaker when viewport actually changes
      if (locks.lastHash !== viewportHash) {
        consecutiveFailuresRef.current = 0;
        marineRetryCountRef.current = 0;
      }

      // Trace logs silenced in production (v3.9)

      // Store ref for cooldown retry direct access
      updateMarineGridRef.current = updateMarineGrid;

      if (locks.isFetching) {
        pendingMarineIntentRef.current = { source, model, layer, hour: timeOffset, timestamp: Date.now() };
        return;
      }

      if (!isRetry && consecutiveFailuresRef.current >= 3) return;
      const now = Date.now();
      if (!isRetry && now - locks.lastTime < 1200) return;

      // Hard block: map is actively moving/zooming
      if (mapInstance.isMoving() || mapInstance.isZooming()) {
        // Silenced: map moving
        return;
      }

      // v3.13: Force global bounds for marine data.
      // The WebGLMarineEngine needs global coverage — viewport bounds cause
      // frantic particle speed (speed / small lngSpan = huge) and grid patterns.
      const bounds = { west: -180, south: -85, east: 180, north: 85 };

      const requestId = ++marineRequestIdRef.current;
      // v3.9.5: Check cooldown before fetch to prevent spam
      const cooldownRemaining = getRemainingCooldown('marine');
      if (!isRetry && cooldownRemaining > 0) {
        // Schedule ONE retry after cooldown expires instead of spamming
        if (!cooldownRetryRef.current) {
          console.log(`[FETCH] [Marine] In cooldown (${Math.ceil(cooldownRemaining/1000)}s), scheduling retry`);
          cooldownRetryRef.current = setTimeout(() => {
            cooldownRetryRef.current = null;
            if (updateMarineGridRef.current && activeMarineLayersRef.current) {
              updateMarineGridRef.current('cooldown_retry');
            }
          }, cooldownRemaining + 2000);
        }
        locks.isFetching = false;
        return;
      }
      locks.isFetching = true;
      if (typeof window !== 'undefined') window.__MARINE_FETCH_PENDING__ = { model, layer, hour: timeOffset, timestamp: new Date().toISOString() };
      const fetchIntent = { model, layer, hour: timeOffset }; // v7.7: Capture intent for stale detection
      try {
        const currentLayer = activeMarineLayerRef.current || 'waves';
        const isWaves = currentLayer === 'waves';
        const nativeLimit = isWaves ? EURO_LIMIT_WAVES : EURO_LIMIT_COMPONENTS;
        const isPastLimit = activeModelRef.current === 'EURO' && timeOffsetRef.current > nativeLimit;
        const isIconPastLimit = activeModelRef.current === 'ICON' && timeOffsetRef.current > ICON_LIMIT;

        let data = null;

        if (isPastLimit) {
          console.log(`[Marine] EURO timeline offset +${timeOffsetRef.current}h is past native limit (+${nativeLimit}h). Generating Extended Estimate grid...`);
          
          let vpBounds = null;
          if (!isWaves) {
            try {
              const b = mapInstance.getBounds();
              const west = b.getWest();
              const east = b.getEast();
              const south = b.getSouth();
              const north = b.getNorth();
              const lngSpan = east - west;
              const latSpan = north - south;
              const padding = 0.25;
              vpBounds = {
                west: west - lngSpan * padding,
                east: east + lngSpan * padding,
                south: Math.max(-80, south - latSpan * padding),
                north: Math.min(85, north + latSpan * padding)
              };
            } catch (e) {
              vpBounds = { west: -125, south: 25, east: -65, north: 50 };
            }
          }

          const isIconValid = timeOffsetRef.current <= 168 && currentLayer !== 'swell_2';

          const euroAnchorPromise = loadGrid('EURO', currentLayer, nativeLimit, vpBounds || bounds, zoom);
          const gfsAnchorPromise = loadGrid('GFS', currentLayer, nativeLimit, bounds, zoom);
          const gfsTargetPromise = loadGrid('GFS', currentLayer, timeOffsetRef.current, bounds, zoom);
          const iconAnchorPromise = isIconValid ? loadGrid('ICON', currentLayer, nativeLimit, bounds, zoom) : Promise.resolve(null);
          const iconTargetPromise = isIconValid ? loadGrid('ICON', currentLayer, timeOffsetRef.current, bounds, zoom) : Promise.resolve(null);

          const [euroAnchor, gfsAnchor, gfsTarget, iconAnchor, iconTarget] = await Promise.all([
            euroAnchorPromise,
            gfsAnchorPromise,
            gfsTargetPromise,
            iconAnchorPromise,
            iconTargetPromise
          ]);

          if (euroAnchor?.grid && gfsAnchor?.grid && gfsTarget?.grid) {
            const blendedGrid = estimateEuroGrid(
              timeOffsetRef.current,
              nativeLimit,
              currentLayer,
              euroAnchor.grid,
              gfsTarget.grid,
              gfsAnchor.grid,
              iconTarget?.grid,
              iconAnchor?.grid
            );

            if (blendedGrid) {
              data = {
                type: 'FeatureCollection',
                features: euroAnchor.features || [],
                grid: {
                  ...blendedGrid,
                  __sourceModel: 'EURO',
                  __provider: 'estimated',
                  __gridProvider: 'estimated',
                  __componentLayer: currentLayer,
                  __gridSupportsLayer: true,
                  __estimated: true,
                  __estimateBasis: {
                    euroAnchorHour: nativeLimit,
                    targetHour: timeOffsetRef.current,
                    gfsWeight: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.weights?.gfs || 0,
                    iconWeight: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.weights?.icon || 0,
                    persistenceWeight: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.weights?.persistence || 0,
                    confidence: window.__EURO_EXTENDED_ESTIMATE_DIAG__?.estimateConfidence || 0
                  },
                  provider: 'estimated'
                }
              };
            }
          }
        } else if (isIconPastLimit) {
          console.log(`[Marine] ICON timeline offset +${timeOffsetRef.current}h is past native limit (+${ICON_LIMIT}h). Generating Extended Estimate grid...`);
          
          const iconAnchorPromise = loadGrid('ICON', currentLayer, ICON_LIMIT, bounds, zoom);
          const gfsAnchorPromise = loadGrid('GFS', currentLayer, ICON_LIMIT, bounds, zoom);
          const gfsTargetPromise = loadGrid('GFS', currentLayer, timeOffsetRef.current, bounds, zoom);
          
          const [iconAnchor, gfsAnchor, gfsTarget] = await Promise.all([
            iconAnchorPromise,
            gfsAnchorPromise,
            gfsTargetPromise
          ]);
          
          if (iconAnchor?.grid && gfsAnchor?.grid && gfsTarget?.grid) {
            const blendedGrid = estimateIconGrid(
              timeOffsetRef.current,
              ICON_LIMIT,
              currentLayer,
              iconAnchor.grid,
              gfsTarget.grid,
              gfsAnchor.grid
            );
            
            if (blendedGrid) {
              data = {
                type: 'FeatureCollection',
                features: iconAnchor.features || [],
                grid: {
                  ...blendedGrid,
                  __sourceModel: 'ICON',
                  __provider: 'estimated',
                  __gridProvider: 'estimated',
                  __componentLayer: currentLayer,
                  __gridSupportsLayer: true,
                  __estimated: true,
                  __estimateBasis: {
                    iconAnchorHour: ICON_LIMIT,
                    targetHour: timeOffsetRef.current,
                    gfsWeight: window.__ICON_EXTENDED_ESTIMATE_DIAG__?.weights?.gfs || 0,
                    persistenceWeight: window.__ICON_EXTENDED_ESTIMATE_DIAG__?.weights?.persistence || 0,
                    confidence: window.__ICON_EXTENDED_ESTIMATE_DIAG__?.estimateConfidence || 0
                  },
                  provider: 'estimated'
                }
              };
            }
          }
        } else {
          const isEuroComponent = activeModelRef.current === 'EURO' && currentLayer && COMPONENT_LAYERS.includes(currentLayer);
          if (isEuroComponent) {
            try {
              const gfsGridData = await fetchMarineData(bounds, zoom, null, timeOffsetRef.current, false, 'GFS', currentLayer);
              if (gfsGridData?.grid?.vectors?.length > 0) {
                // v7.0: Honest provenance — GFS backdrop is NOT copernicus
                data = {
                  ...gfsGridData,
                  grid: {
                    ...gfsGridData.grid,
                    __sourceModel: 'EURO',
                    __provider: 'gfs_estimated_backdrop',
                    __gridProvider: 'gfs_estimated_backdrop',
                    __baseProvider: 'open-meteo',
                    __overlayProvider: 'pending_copernicus',
                    __isEstimated: true,
                    __componentLayer: currentLayer,
                    __gridSupportsLayer: true,
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
                  // v7.0: Split metadata after successful Copernicus merge
                  if (data?.grid) {
                    data.grid.__baseProvider = 'open-meteo';
                    data.grid.__overlayProvider = 'copernicus';
                    data.grid.__isBlended = true;
                  }
                } else {
                  // v7.0: Copernicus returned empty — tag as GFS fallback, not copernicus
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
                // v7.0: On Copernicus failure, tag as GFS fallback
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



        // v7.7: Stale request discard — check both requestId AND intent match
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
          _logPipelineEvent('data_committed', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour, provider: data?.grid?.__provider, vectorCount: data?.grid?.vectors?.length || 0 });

          isCommittingDataRef.current = true;
          isInternalMapUpdateRef.current = true;

          setMarineData(prev => {
            if (JSON.stringify(prev) === JSON.stringify(data)) {
              return prev;
            }
            marineRevision.current += 1;
            return data;
          });

          requestAnimationFrame(() => {
            isCommittingDataRef.current = false;
          });
          clearTimeout(internalUpdateTimerRef.current);
          internalUpdateTimerRef.current = setTimeout(() => {
            isInternalMapUpdateRef.current = false;
          }, 800);
        } else {
          // Data is null or empty increment circuit breaker
          consecutiveFailuresRef.current += 1;

          if (typeof window !== 'undefined') {
            window.__MARINE_FETCH_DIAG__ = { activeModel: activeModelRef.current, activeLayer: currentLayer, timeOffsetHours: timeOffsetRef.current, provider: 'none', gridProvider: 'none', httpStatus: 502, elapsedMs: Date.now() - now, vectorCount: 0, nonzeroCount: 0, consecutiveFailures: consecutiveFailuresRef.current, timestamp: new Date().toISOString() };
          }

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
        // v7.7: Replay pending intent if one was buffered during in-flight fetch
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

    // --- Single Ingress Funnel ---
    // ALL update triggers (manual, moveend, mount) funnel through here.
    const scheduledRef = { current: false };

    const enqueueMarineUpdate = (source) => {
      // Scrubbing mode hard freeze (Request 3)
      if (window.isScrubbingTimeline) {
        console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing");
        return;
      }

      const now = Date.now();

      // v7.7: Buffer intent instead of dropping when fetch is in-flight
      if (locks.isFetching) {
        pendingMarineIntentRef.current = { source, model: activeModelRef.current, layer: activeMarineLayerRef.current || 'waves', hour: timeOffsetRef.current, timestamp: Date.now() };
        _logPipelineEvent('intent_buffered', pendingMarineIntentRef.current);
        return;
      }

      // Manual activation: set suppression window
      if (source === 'manual') {
        locks.manualFetchActiveUntil = now + 1500;
      }

      // Suppress ALL moveend-derived triggers during manual activation window
      if (source.includes('moveend') && now < (locks.manualFetchActiveUntil || 0)) {
        return;
      }

      // Check if this pan is already cached
      let isCached = false;
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(), south: b.getSouth(),
          east: b.getEast(), north: b.getNorth()
        };
        isCached = isContainedInMarineCache(bounds, activeModelRef.current, timeOffsetRef.current, activeMarineLayerRef.current || 'waves');
      } catch (e) { /* map not ready */ }

      // Hard Dedupe: Ignore identical triggers within 800ms (reduced to 50ms if cached)
      const dedupeWindow = isCached ? 50 : 800;
      if (lastInvocationRef.current.source === source && now - lastInvocationRef.current.time < dedupeWindow) {
        return;
      }

      // Pre-check viewport hash at ingress to avoid scheduling a no-op
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
      } catch (e) { /* map not ready */ }

      lastInvocationRef.current = { source, time: now };

      if (scheduledRef.current) return;
      scheduledRef.current = true;

      requestAnimationFrame(() => {
        scheduledRef.current = false;
        clearTimeout(timeoutId);
        // Stable Bounds Delay: let inertial map easing settle (turbo-boosted to 20ms if cached)
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

    // --- Unified moveend handler (simplified from burst counter) ---
    const moveendDebounceRef = { timer: null };

    const onMoveEnd = () => {
      if (window.isScrubbingTimeline) return;
      // Camera hash dedup (did the camera ACTUALLY move?)
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();
      const cameraHash = `${center.lng.toFixed(3)}:${center.lat.toFixed(3)}:${zoom.toFixed(2)}`;
      if (lastStableCameraRef.current === cameraHash) return;
      lastStableCameraRef.current = cameraHash;

      // Turbo-boost pan: check if cached, drop debounce from 900ms to 50ms
      let isCached = false;
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(), south: b.getSouth(),
          east: b.getEast(), north: b.getNorth()
        };
        isCached = isContainedInMarineCache(bounds, activeModelRef.current, timeOffsetRef.current, activeMarineLayerRef.current || 'waves');
      } catch (e) { /* map not ready */ }
      const debounceTime = isCached ? 50 : 900;
      clearTimeout(moveendDebounceRef.timer);
      moveendDebounceRef.timer = setTimeout(() => { enqueueMarineUpdate('moveend'); }, debounceTime);
    };

    // User Intent Tracking
    const trackIntent = () => { lastUserInteractionRef.current = Date.now(); };
    mapInstance.on('mousedown', trackIntent);
    mapInstance.on('touchstart', trackIntent);
    mapInstance.on('wheel', trackIntent);
    mapInstance.on('dragstart', trackIntent);
    mapInstance.on('zoomstart', trackIntent);

    // MapLibre Internal Update Tracking
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

    // Initial fetch if layers are already active on mount
    if (activeMarineLayersRef.current) {
      enqueueMarineUpdate('mount');
    }

    return () => {
      clearTimeout(timeoutId);
      if (moveendDebounceRef.timer) clearTimeout(moveendDebounceRef.timer);
      if (internalUpdateTimerRef.current) clearTimeout(internalUpdateTimerRef.current);
      mapInstance.off('mousedown', trackIntent);
      mapInstance.off('touchstart', trackIntent);
      mapInstance.off('wheel', trackIntent);
      mapInstance.off('dragstart', trackIntent);
      mapInstance.off('zoomstart', trackIntent);
      mapInstance.off('sourcedata', onMapInternalUpdate);
      mapInstance.off('styledata', onMapInternalUpdate);
      mapInstance.off('moveend', onMoveEnd);
      manualMarineTriggerRef.current = null;
    };
  }, [mapInstance]); // Severed from activeLayersKey completely

  // v3.8.5: Re-fetch marine data or re-index locally when timeline offset CHANGES (not on mount)
  useEffect(() => {
    const prev = timeOffsetRef.current;
    timeOffsetRef.current = timeOffsetHours;
    // Skip mount (prev === timeOffsetHours) to prevent duplicate fetch
    if (prev === timeOffsetHours) return;
    if (!mapInstance || !activeMarineLayersRef.current) return;

    // 1. Try instant local cache re-index first — validate cache identity
    try {
      const cache = getMarineHourlyCache();
      const curModel = activeModelRef.current || 'GFS';
      const curLayer = activeMarineLayerRef.current || 'waves';
      if (cache?.results?.length &&
          cache.model === curModel &&
          (cache.activeLayer || 'waves') === curLayer) {
        const data = extractMarineAtOffset(cache, timeOffsetHours);
        if (data) {
          console.log(`[SCRUB] [CACHE] Instant re-index: +${timeOffsetHours}h model=${curModel} layer=${curLayer}`);
          setMarineData(data);
          return; // Skip API fetch
        }
      }
    } catch (e) {
      console.warn('[CACHE] Local timeline re-index failed:', e.message);
    }

    // Scrubbing mode: suppress fetch but schedule settle-refetch for final scrub position
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

    // 2. Fall back to fetch if cache is unavailable or empty
    marineFetchLocksRef.current.lastHash = null;
    const t = setTimeout(() => {
      manualMarineTriggerRef.current?.();
    }, 350);
    return () => clearTimeout(t);
  }, [timeOffsetHours, mapInstance]);

  // v3.9.8: Trigger re-fetch when activeModel changes
  useEffect(() => {
    if (!mapInstance || !activeMarineLayersRef.current) return;

    // Model Switch Guard (Request 2)
    if (lastFetchedModelRef.current === activeModel) {
      return;
    }

    // Scrubbing mode hard freeze (Request 3)
    if (window.isScrubbingTimeline) {
      console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing");
      return;
    }

    lastFetchedModelRef.current = activeModel;
    lastFetchedLayerRef.current = null; // Clear layer ref so re-entering components works perfectly
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
    lastFetchedLayerRef.current = activeMarineLayer;
    // v7.7: Try local cache remap for GFS/ICON before network fetch
    if (activeModel !== 'EURO') {
      try {
        const cache = getMarineHourlyCache();
        if (cache?.results?.length && cache.model === activeModel) {
          const remapped = extractMarineAtOffset(cache, timeOffsetHours, activeMarineLayer);
          if (remapped?.grid?.vectors?.length > 0 && remapped.grid.__renderable !== false) {
            console.log(`[Marine] Layer switch to ${activeMarineLayer}: local cache remap (no network fetch)`);
            _logPipelineEvent('local_cache_remap', { model: activeModel, layer: activeMarineLayer, hour: timeOffsetHours });
            setMarineData(remapped);
            return; // Skip network fetch — cache had all vars
          }
        }
      } catch (e) { console.warn('[Marine] Cache remap failed:', e.message); }
    }
    console.log(`[Marine] Layer changed to ${activeMarineLayer} (model=${activeModel}), network fetch required`);
    _logPipelineEvent('network_fetch_layer_change', { model: activeModel, layer: activeMarineLayer });
    marineFetchLocksRef.current.lastHash = null;
    marineFetchLocksRef.current.lastTime = 0;
    const t = setTimeout(() => { manualMarineTriggerRef.current?.(); }, 350);
    return () => clearTimeout(t);
  }, [activeMarineLayer, activeModel, mapInstance]);

  return { marineData };
}
