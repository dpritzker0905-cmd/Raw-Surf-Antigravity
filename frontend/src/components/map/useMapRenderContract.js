import { useRef, useCallback, useEffect } from 'react';

/**
 * useMapRenderContract (v242)
 *
 * SINGLE SOURCE OF TRUTH for map readiness state.
 * All subsystems (Raster TX, Marine Orchestrator, Wind Engine) key off this contract.
 *
 * State Machine:
 *   INIT → STYLE_LOADING → READY ↔ INTERACTING
 *
 * Rules:
 * 1. No source mutation unless state === READY
 * 2. INTERACTING blocks all commits (deferred to queue)
 * 3. Transitions are event-driven, not polled
 * 4. isMoving()/isZooming() is a HARD block independent of state
 */

const MAP_STATE = {
  INIT: 'INIT',
  STYLE_LOADING: 'STYLE_LOADING',
  READY: 'READY',
  INTERACTING: 'INTERACTING',
};

export function useMapRenderContract(mapInstance) {
  const stateRef = useRef(MAP_STATE.INIT);
  const interactionResumeTimer = useRef(null);
  const onReadyCallbacks = useRef([]);

  /**
   * Register a callback to fire when state transitions to READY.
   * If already READY, fires immediately.
   */
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

  /**
   * Query: can a source mutation be committed RIGHT NOW?
   */
  const canCommit = useCallback(() => {
    if (!mapInstance) return false;
    if (stateRef.current !== MAP_STATE.READY) return false;
    // Hard block: MapLibre is mid-animation/inertia
    if (mapInstance.isMoving?.() || mapInstance.isZooming?.()) return false;
    return true;
  }, [mapInstance]);

  /**
   * Query current state (for debug logging)
   */
  const getState = useCallback(() => stateRef.current, []);

  /**
   * Lifecycle wiring — listens to MapLibre events and drives state transitions.
   */
  useEffect(() => {
    if (!mapInstance) return;

    stateRef.current = MAP_STATE.STYLE_LOADING;

    const transitionToReady = () => {
      if (stateRef.current === MAP_STATE.READY) return; // Idempotent
      console.log(`[RenderContract] ${stateRef.current} → READY`);
      stateRef.current = MAP_STATE.READY;
      fireReadyCallbacks();
    };

    // style.load → READY
    const onStyleLoad = () => transitionToReady();
    mapInstance.on('style.load', onStyleLoad);

    // Immediate check (style may already be loaded)
    if (mapInstance.isStyleLoaded?.()) {
      transitionToReady();
    }

    // Fallback poll (race condition: style.load fires before listener attaches)
    const fallbackTimer = setTimeout(() => {
      if (stateRef.current !== MAP_STATE.READY && mapInstance.isStyleLoaded?.()) {
        console.log('[RenderContract] Fallback poll → READY');
        transitionToReady();
      }
    }, 500);

    // Interaction: READY → INTERACTING
    const lockInteraction = () => {
      if (stateRef.current === MAP_STATE.READY) {
        stateRef.current = MAP_STATE.INTERACTING;
      }
      clearTimeout(interactionResumeTimer.current);
    };

    // moveend: INTERACTING → READY (after 300ms debounce for inertial settle)
    const unlockInteraction = () => {
      clearTimeout(interactionResumeTimer.current);
      interactionResumeTimer.current = setTimeout(() => {
        if (stateRef.current === MAP_STATE.INTERACTING) {
          stateRef.current = MAP_STATE.READY;
          console.log('[RenderContract] INTERACTING → READY (idle)');
          fireReadyCallbacks();
        }
      }, 300);
    };

    mapInstance.on('dragstart', lockInteraction);
    mapInstance.on('zoomstart', lockInteraction);
    mapInstance.on('moveend', unlockInteraction);

    return () => {
      mapInstance.off('style.load', onStyleLoad);
      mapInstance.off('dragstart', lockInteraction);
      mapInstance.off('zoomstart', lockInteraction);
      mapInstance.off('moveend', unlockInteraction);
      clearTimeout(fallbackTimer);
      clearTimeout(interactionResumeTimer.current);
    };
  }, [mapInstance, fireReadyCallbacks]);

  return { canCommit, onReady, getState, MAP_STATE };
}
