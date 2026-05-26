import { useState, useRef, useEffect, useMemo } from 'react';
import { fetchMarineData, getRemainingCooldown, getMarineHourlyCache, extractMarineAtOffset, isContainedInMarineCache } from './marineController';

/**
 * useMarineOrchestrator (v238)
 *
 * SINGLE-PIPELINE marine data orchestrator. Consolidates all entry paths
 * (manual toggle, moveend, mount) into one serialized update function.
 *
 * Architecture (addresses ChatGPT architectural audit):
 * 1. ONE enqueueUpdate function all sources funnel through it
 * 2. Camera-hash dedup won't fetch if viewport hasn't moved
 * 3. Post-manual suppression blocks moveend-derived triggers for 1500ms
 * 4. Intent tracking only user-driven moveend events trigger fetches
 * 5. Internal update tracking ignores moveend caused by source/style mutations
 *
 * RULE: This hook has ZERO knowledge of rendering. It only manages data.
 */
export function useMarineOrchestrator({ mapInstance, activeLayers, timeOffsetHours = 0, activeModel = 'GFS' }) {
  const [marineData, setMarineData] = useState(null);

  // --- Refs (all internal to this hook) ---
  const marineRevision = useRef(0);
  const marineFetchLocksRef = useRef({
    lastHash: null,
    lastTime: 0,
    isFetching: false,
    manualFetchActiveUntil: 0
  });
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
  const consecutiveFailuresRef = useRef(0); // v3.9: Circuit breaker
  const activeModelRef = useRef(activeModel);

  useEffect(() => {
    activeModelRef.current = activeModel;
  }, [activeModel]);

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
        // Reset hash so the 5-min TTL guard does not block re-activation fetches
        marineFetchLocksRef.current.lastHash = null;
        marineFetchLocksRef.current.lastTime = 0;
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
      if (isCommittingDataRef.current) {
        console.log(`[FETCH] [Marine Trace] aborted (data commit in progress) source=${source}`);
        return;
      }

      // Scrubbing mode hard freeze (Request 3)
      if (window.isScrubbingTimeline) {
        console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing");
        return;
      }

      if (!activeMarineLayersRef.current) return;
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();

      const q = (v) => Number(v).toFixed(2);
      const z = Math.round(zoom * 2) / 2;
      const viewportHash = `${q(center.lng)}:${q(center.lat)}:${z}`;

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

      // Hard block: concurrent fetch or rate limit (bypass for retries)
      if (locks.isFetching) {
        // Silenced: already fetching
        return;
      }
      const now = Date.now();
      if (!isRetry && now - locks.lastTime < 1200) {
 return; // Rate limit suppress log spam
      }

 // v3.9: Circuit breaker stop after 3 consecutive failures
      if (!isRetry && consecutiveFailuresRef.current >= 3) {
        return; // Silently block until viewport changes
      }

      // Hard block: map is actively moving/zooming
      if (mapInstance.isMoving() || mapInstance.isZooming()) {
        // Silenced: map moving
        return;
      }

      const b = mapInstance.getBounds();
      const bounds = {
        west: b.getWest(), south: b.getSouth(),
        east: b.getEast(), north: b.getNorth()
      };

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
      // Silenced: fetchMarineData call
      locks.isFetching = true;
      try {
        let data = await fetchMarineData(bounds, zoom, null, timeOffsetRef.current, false, activeModelRef.current);
        if (window.__LRCM_EXEC_TRACE__) {
          const isDebug = typeof window !== 'undefined' && window.__RASTER_DEBUG__?.enableTrace;
          window.__LRCM_EXEC_TRACE__.push({
            layer: 'marine',
            action: 'fetch',
            source: 'useMarineOrchestrator',
            timestamp: Date.now(),
            payload: data,
            stack: isDebug ? new Error().stack : null
          });
        }

        // Stale request discard
        if (requestId !== marineRequestIdRef.current) {
          // Silenced: stale request
          return;
        }

        // Silenced: fetchMarineData result trace

        if (data && data.features?.length > 0) {
          consecutiveFailuresRef.current = 0; // Reset circuit breaker on success
          locks.lastHash = viewportHash;
          locks.lastTime = Date.now();

          isCommittingDataRef.current = true;
          isInternalMapUpdateRef.current = true;

          setMarineData(prev => {
            if (JSON.stringify(prev) === JSON.stringify(data)) {
              return prev;
            }
            // Silenced: marineData state set
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
          if (consecutiveFailuresRef.current >= 3) {
            console.warn('[FETCH] [Marine] Circuit breaker: 3 consecutive failures stopping until viewport changes.');
            return; // Don't schedule more retries
          }
          const remaining = getRemainingCooldown('marine');
          marineRetryCountRef.current = (marineRetryCountRef.current || 0) + 1;
          if (marineRetryCountRef.current > 3) {
            console.warn('[FETCH] [Marine] Max retries (3) reached stopping.');
            marineRetryCountRef.current = 0;
          } else if (remaining > 0 && !cooldownRetryRef.current) {
            cooldownRetryRef.current = setTimeout(() => {
              cooldownRetryRef.current = null;
              if (updateMarineGridRef.current && activeMarineLayersRef.current) {
                updateMarineGridRef.current('cooldown_retry');
              }
            }, remaining + 3000);
          } else if (remaining <= 0 && !cooldownRetryRef.current) {
            cooldownRetryRef.current = setTimeout(() => {
              cooldownRetryRef.current = null;
              if (updateMarineGridRef.current && activeMarineLayersRef.current) {
                updateMarineGridRef.current('delayed_retry');
              }
            }, 5000);
          }
        }
      } finally {
        locks.isFetching = false;
      }
    };

    // --- Single Ingress Funnel ---
    // ALL update triggers (manual, moveend, mount) funnel through here.
    const scheduledRef = { current: false };

    const enqueueMarineUpdate = (source) => {
      const now = Date.now();

      // Scrubbing mode hard freeze (Request 3)
      if (window.isScrubbingTimeline) {
        console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing");
        return;
      }

      // HARD GATE: If a fetch is already in-flight, reject immediately
      if (locks.isFetching) return;

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
        isCached = isContainedInMarineCache(bounds, activeModelRef.current);
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
        const viewportHash = `${q(center.lng)}:${q(center.lat)}:${z}`;
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
        isCached = isContainedInMarineCache(bounds, activeModelRef.current);
      } catch (e) { /* map not ready */ }
      const debounceTime = isCached ? 50 : 900;

      // v3 contract: 900ms debounce for moveend per rate limit protection
      clearTimeout(moveendDebounceRef.timer);
      moveendDebounceRef.timer = setTimeout(() => {
        enqueueMarineUpdate('moveend');
      }, debounceTime);
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

    // 1. Try instant local cache re-index first
    try {
      const cache = getMarineHourlyCache();
      if (cache?.results?.length) {
        const data = extractMarineAtOffset(cache, timeOffsetHours);
        if (data) {
          console.log(`[SCRUB] [CACHE] [Marine Orchestrator] Instant local timeline re-index: +${timeOffsetHours}h`);
          setMarineData(data);
          return; // Skip API fetch entirely!
        }
      }
    } catch (e) {
      console.warn('[CACHE] [Marine Orchestrator] Local timeline re-index failed:', e.message);
    }

    // Scrubbing mode hard freeze (Request 3)
    if (window.isScrubbingTimeline) {
      console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing");
      return;
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

    // Scrubbing mode hard freeze (Request 3)
    if (window.isScrubbingTimeline) {
      console.log("[SCRUB] [FETCH] Marine fetch suppressed during active scrubbing");
      return;
    }

    console.log(`[MODEL] [Marine] Active model changed to ${activeModel}, triggering manual fetch...`);
    marineFetchLocksRef.current.lastHash = null;
    marineFetchLocksRef.current.lastTime = 0;
    const t = setTimeout(() => {
      manualMarineTriggerRef.current?.();
    }, 350);
    return () => clearTimeout(t);
  }, [activeModel, mapInstance]);

  return { marineData };
}
