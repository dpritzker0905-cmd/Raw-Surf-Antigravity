import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { fetchMarineData } from './marineController';

/**
 * useMarineOrchestrator (v238)
 *
 * SINGLE-PIPELINE marine data orchestrator. Consolidates all entry paths
 * (manual toggle, moveend, mount) into one serialized update function.
 *
 * Architecture (addresses ChatGPT architectural audit):
 * 1. ONE enqueueUpdate function — all sources funnel through it
 * 2. Camera-hash dedup — won't fetch if viewport hasn't moved
 * 3. Post-manual suppression — blocks moveend-derived triggers for 1500ms
 * 4. Intent tracking — only user-driven moveend events trigger fetches
 * 5. Internal update tracking — ignores moveend caused by source/style mutations
 *
 * RULE: This hook has ZERO knowledge of rendering. It only manages data.
 */
export function useMarineOrchestrator({ mapInstance, activeLayers }) {
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
        // Don't clear marineData — layers are hidden via visibility:none.
        // Clearing would trigger a React re-render cycle on the Source.
      } else if (hasMarine && !previouslyHadMarine) {
        console.log('[Marine] Layer activated, triggering manual fetch...');
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
        console.log(`[Marine Trace] aborted (data commit in progress) source=${source}`);
        return;
      }

      if (!activeMarineLayersRef.current) return;
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();

      const q = (v) => Number(v).toFixed(2);
      const z = Math.round(zoom * 2) / 2;
      const viewportHash = `${q(center.lng)}:${q(center.lat)}:${z}`;

      // Viewport Hash Guard with 5m TTL
      if (locks.lastHash === viewportHash &&
          (Date.now() - locks.lastTime < 5 * 60 * 1000)) {
        console.log(`[Marine Trace] 2. aborted (viewport hash matched) source=${source}`);
        return;
      }

      console.log(`[Marine Trace] 1. updateMarineGrid triggered source=${source}`);

      // Hard block: concurrent fetch or rate limit
      if (locks.isFetching) {
        console.log(`[Marine Trace] 2. aborted (already fetching) source=${source}`);
        return;
      }
      const now = Date.now();
      if (now - locks.lastTime < 1200) {
        console.log(`[Marine Trace] 2. aborted (rate limit, < 1200ms) source=${source}`);
        return;
      }

      // Hard block: map is actively moving/zooming
      if (mapInstance.isMoving() || mapInstance.isZooming()) {
        console.log(`[Marine Trace] 2. aborted (map is moving/zooming) source=${source}`);
        return;
      }

      const b = mapInstance.getBounds();
      const bounds = {
        west: b.getWest(), south: b.getSouth(),
        east: b.getEast(), north: b.getNorth()
      };

      const requestId = ++marineRequestIdRef.current;
      console.log(`[Marine Trace] 3. calling fetchMarineData (req: ${requestId})`);
      locks.isFetching = true;
      try {
        let data = await fetchMarineData(bounds, zoom);
        if (window.__LRCM_EXEC_TRACE__) {
          data = window.__LRCM_EXEC_TRACE__.push({ layer: 'marine', fn: 'fetchMarineData', payload: data, stack: new Error().stack }) && data;
        }

        // Stale request discard
        if (requestId !== marineRequestIdRef.current) {
          console.log(`[Marine Trace] stale request discarded (req: ${requestId})`);
          return;
        }

        console.log('[Marine Trace] 4. fetchMarineData returned:',
          data ? `Success (${data.features?.length || 0} pts)` : 'NULL');

        if (data && data.features?.length > 0) {
          locks.lastHash = viewportHash;
          locks.lastTime = Date.now();

          isCommittingDataRef.current = true;
          isInternalMapUpdateRef.current = true;

          setMarineData(prev => {
            if (JSON.stringify(prev) === JSON.stringify(data)) {
              console.log('[Marine Trace] 5. setting marineData SKIPPED (data identical)');
              return prev;
            }
            console.log('[Marine Trace] 5. setting marineData state');
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

      // Hard Dedupe: Ignore identical triggers within 800ms
      if (lastInvocationRef.current.source === source && now - lastInvocationRef.current.time < 800) {
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
        // Stable Bounds Delay: let inertial map easing settle
        timeoutId = setTimeout(() => {
          if (!mapInstance.isMoving() && !mapInstance.isZooming()) {
            updateMarineGrid(source);
          }
        }, 150);
      });
    };

    manualMarineTriggerRef.current = () => enqueueMarineUpdate('manual');

    // --- Unified moveend handler (simplified from burst counter) ---
    const moveendDebounceRef = { timer: null };

    const onMoveEnd = () => {
      // User intent check
      const isUserDriven = Date.now() - lastUserInteractionRef.current < 1500;
      if (!isUserDriven) return;

      // Internal update check (source/style mutations cause synthetic moveends)
      if (isInternalMapUpdateRef.current) return;

      // Camera hash dedup (did the camera ACTUALLY move?)
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();
      const cameraHash = `${center.lng.toFixed(3)}:${center.lat.toFixed(3)}:${zoom.toFixed(2)}`;
      if (lastStableCameraRef.current === cameraHash) return;
      lastStableCameraRef.current = cameraHash;

      // Debounce burst: collapse all moveends within 250ms into ONE fetch
      clearTimeout(moveendDebounceRef.timer);
      moveendDebounceRef.timer = setTimeout(() => {
        enqueueMarineUpdate('moveend');
      }, 250);
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

  return { marineData };
}
