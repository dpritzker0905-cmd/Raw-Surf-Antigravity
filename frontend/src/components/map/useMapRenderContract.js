import { useRef, useCallback, useEffect } from 'react';

/**
 * useMapRenderContract (v244)
 *
 * SINGLE SOURCE OF TRUTH for map readiness state.
 *
 * State Machine:
 * INIT STYLE_LOADING READY INTERACTING
 *
 * v244 fixes:
 * - Reference-counted interaction state using matched event pairs
 * (dragstart/dragend, zoomstart/zoomend) instead of dragstartmoveend
 *   which caused READY/INTERACTING flapping.
 * - moveend is now ONLY used for the post-inertia idle confirmation,
 *   NOT as the primary unlock trigger.
 */

var MAP_STATE = {
  INIT: 'INIT',
  STYLE_LOADING: 'STYLE_LOADING',
  READY: 'READY',
  INTERACTING: 'INTERACTING',
};

// FUNCTIONAL-READY signal (2026-07-21): mapbox-gl 5.x `isStyleLoaded()` transiently returns FALSE while
// any source is (re)loading — so a first-READY path that gates ONLY on it can miss and, if `style.load`
// already fired before this contract mounted, leave the contract stuck in STYLE_LOADING FOREVER, silently
// blocking every raster commit (precip/radar/pressure/OM). `areTilesLoaded()` is the reliable
// functional-ready truth (already the load-gate in WebGLMarineMaskRenderer + the marine fetch trigger).
// Either being true means the map can render. Pure + exported for tests.
export function isMapFunctionallyReady(mapInstance) {
  if (!mapInstance) return false;
  try {
    if (typeof mapInstance.isStyleLoaded === 'function' && mapInstance.isStyleLoaded()) return true;
    if (typeof mapInstance.areTilesLoaded === 'function' && mapInstance.areTilesLoaded()) return true;
  } catch (e) { /* getters can throw mid-style-load */ }
  return false;
}

export function useMapRenderContract(mapInstance) {
  const stateRef = useRef(MAP_STATE.INIT);
  const idleTimer = useRef(null);
  const onReadyCallbacks = useRef([]);
  // v244: Reference-counted interaction tracking
  const interactionCount = useRef(0);

  const onReady = useCallback((cb) => {
    if (stateRef.current === MAP_STATE.READY) {
      cb();
    } else {
      onReadyCallbacks.current.push(cb);
    }
  }, []);

  const fireReadyCallbacks = useCallback(() => {
    const cbs = onReadyCallbacks.current;
    onReadyCallbacks.current = [];
    cbs.forEach(cb => cb());
  }, []);

  const canCommit = useCallback(() => {
    if (!mapInstance) return false;
    if (stateRef.current !== MAP_STATE.READY) return false;
    if (mapInstance.isMoving?.() || mapInstance.isZooming?.()) return false;
    return true;
  }, [mapInstance]);

  const getState = useCallback(() => stateRef.current, []);

  useEffect(() => {
    if (!mapInstance) return;

    stateRef.current = MAP_STATE.STYLE_LOADING;

    const transitionToReady = () => {
      if (stateRef.current === MAP_STATE.READY) return;
 console.log(`[RenderContract] ${stateRef.current} READY`);
      stateRef.current = MAP_STATE.READY;
      fireReadyCallbacks();
    };

    const onStyleLoad = () => transitionToReady();
    mapInstance.on('style.load', onStyleLoad);
    // 'idle' fires once the style + sources + tiles have loaded and the map is still — a reliable
    // first-READY signal even if `style.load` fired before this contract mounted (the missed-event case).
    const onIdle = () => transitionToReady();
    mapInstance.on('idle', onIdle);

    if (isMapFunctionallyReady(mapInstance)) {
      transitionToReady();
    }

    // Functional-ready poll (isStyleLoaded OR areTilesLoaded — no longer isStyleLoaded-only, which could
    // sit false forever while a source reloaded and strand the whole raster pipeline).
    const fallbackTimer = setTimeout(() => {
      if (stateRef.current !== MAP_STATE.READY && isMapFunctionallyReady(mapInstance)) {
 console.log('[RenderContract] Fallback poll READY');
        transitionToReady();
      }
    }, 500);

    // BOUNDED BACKSTOP (2026-07-21): the map is interactive within a few seconds regardless of the flaky
    // readiness signals; staying STYLE_LOADING forever (no raster ever commits) is strictly worse than a
    // slightly-early READY. Force it once, unconditionally, as a last resort. This no-ops on the happy
    // path (already READY via style.load/idle). Kill: __RAW_DISABLE_RENDER_CONTRACT_BACKSTOP__.
    const backstopTimer = setTimeout(() => {
      const killed = typeof window !== 'undefined' && window.__RAW_DISABLE_RENDER_CONTRACT_BACKSTOP__ === true;
      if (stateRef.current !== MAP_STATE.READY && !killed) {
 console.log('[RenderContract] Bounded backstop READY');
        transitionToReady();
      }
    }, 4000);

    // v244: Reference-counted interaction state
    // Uses matched pairs: dragstart/dragend + zoomstart/zoomend
    // moveend is ONLY for post-inertia idle confirmation
 // v245: Only user gestures trigger INTERACTING NOT programmatic flyTo/easeTo
    const incrementInteraction = (e) => {
      // Programmatic animations (flyTo, easeTo) fire dragstart/zoomstart WITHOUT originalEvent
      if (!e?.originalEvent) return;
      interactionCount.current++;
      clearTimeout(idleTimer.current);
      if (stateRef.current === MAP_STATE.READY) {
        stateRef.current = MAP_STATE.INTERACTING;
      }
    };

    const decrementInteraction = (e) => {
      if (!e?.originalEvent) return;
      interactionCount.current = Math.max(0, interactionCount.current - 1);
    };

    // Post-inertia idle confirmation
    // Only fires READY after ALL interactions have ended AND map is truly still
    const confirmIdle = () => {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        // Double-check: map must not be moving AND no outstanding interactions
        if (interactionCount.current === 0 &&
            stateRef.current === MAP_STATE.INTERACTING &&
            !mapInstance.isMoving?.() &&
            !mapInstance.isZooming?.()) {
          stateRef.current = MAP_STATE.READY;
 console.log('[RenderContract] INTERACTING READY (idle confirmed)');
          fireReadyCallbacks();
        }
      }, 300);
    };

    mapInstance.on('dragstart', incrementInteraction);
    mapInstance.on('zoomstart', incrementInteraction);
    mapInstance.on('dragend', decrementInteraction);
    mapInstance.on('zoomend', decrementInteraction);
    mapInstance.on('moveend', confirmIdle);

    return () => {
      mapInstance.off('style.load', onStyleLoad);
      mapInstance.off('idle', onIdle);
      mapInstance.off('dragstart', incrementInteraction);
      mapInstance.off('zoomstart', incrementInteraction);
      mapInstance.off('dragend', decrementInteraction);
      mapInstance.off('zoomend', decrementInteraction);
      mapInstance.off('moveend', confirmIdle);
      clearTimeout(fallbackTimer);
      clearTimeout(backstopTimer);
      clearTimeout(idleTimer.current);
    };
  }, [mapInstance, fireReadyCallbacks]);

  return { canCommit, onReady, getState, MAP_STATE };
}
