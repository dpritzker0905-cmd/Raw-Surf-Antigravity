import { useRef, useCallback, useEffect } from 'react';

/**
 * useMapRenderContract (v244)
 *
 * SINGLE SOURCE OF TRUTH for map readiness state.
 *
 * State Machine:
 *   INIT → STYLE_LOADING → READY ↔ INTERACTING
 *
 * v244 fixes:
 * - Reference-counted interaction state using matched event pairs
 *   (dragstart/dragend, zoomstart/zoomend) instead of dragstart→moveend
 *   which caused READY/INTERACTING flapping.
 * - moveend is now ONLY used for the post-inertia idle confirmation,
 *   NOT as the primary unlock trigger.
 */

const MAP_STATE = {
  INIT: 'INIT',
  STYLE_LOADING: 'STYLE_LOADING',
  READY: 'READY',
  INTERACTING: 'INTERACTING',
};

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
      console.log(`[RenderContract] ${stateRef.current} → READY`);
      stateRef.current = MAP_STATE.READY;
      fireReadyCallbacks();
    };

    const onStyleLoad = () => transitionToReady();
    mapInstance.on('style.load', onStyleLoad);

    if (mapInstance.isStyleLoaded?.()) {
      transitionToReady();
    }

    const fallbackTimer = setTimeout(() => {
      if (stateRef.current !== MAP_STATE.READY && mapInstance.isStyleLoaded?.()) {
        console.log('[RenderContract] Fallback poll → READY');
        transitionToReady();
      }
    }, 500);

    // v244: Reference-counted interaction state
    // Uses matched pairs: dragstart/dragend + zoomstart/zoomend
    // moveend is ONLY for post-inertia idle confirmation
    // v245: Only user gestures trigger INTERACTING — NOT programmatic flyTo/easeTo
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
          console.log('[RenderContract] INTERACTING → READY (idle confirmed)');
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
      mapInstance.off('dragstart', incrementInteraction);
      mapInstance.off('zoomstart', incrementInteraction);
      mapInstance.off('dragend', decrementInteraction);
      mapInstance.off('zoomend', decrementInteraction);
      mapInstance.off('moveend', confirmIdle);
      clearTimeout(fallbackTimer);
      clearTimeout(idleTimer.current);
    };
  }, [mapInstance, fireReadyCallbacks]);

  return { canCommit, onReady, getState, MAP_STATE };
}
