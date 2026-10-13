/**
 * useMarineWebglRecovery — a transient error burst must not cost the session its WebGL marine renderer.
 *
 * WHY (2026-09-26, dev E2E run 36285144742). The Chrome burst at Sebastian Inlet z12 stopped the marine
 * field for 22,378 ms and 30,456 ms. The continuity anatomy (#108/#109) showed MapLibre never called the
 * marine layer again (`layerCalls: 0`), with engine_dispose x2 + foam_mount at the stall's start:
 * `webglMarineFailed` had flipped, and MapWebGL swapped WebGLMarineLayer for the Canvas2D
 * `MarineParticleCanvas`, which draws no heatmap. The custom layer trips that after THREE render errors
 * inside 10 s, and nothing ever flipped it back, so a burst during one rapid zoom downgraded the whole
 * session until a reload.
 *
 * Now the fallback is bounded: after `delayMs` the WebGL layer is remounted with a fresh engine, up to
 * `max` times per map; after that the session stays on the fallback, so a PERSISTENT error cannot loop.
 * A forced fallback (`__FORCE_MARINE_FALLBACK__` / localStorage `force_marine_fallback`) is never undone,
 * and context loss keeps its own path (useMapErrorSurface: the `webglcontextrestored` event).
 * Each recovery is recorded as `marine_webgl_recover` on the churn log the continuity gate attaches.
 * This bounds the damage; the exception itself is named by #111's `marine_render_error` records.
 */
import { useCallback, useEffect, useRef } from 'react';
import { recordChurn } from './marineTransitionCoordinator';

export const MARINE_RECOVERY_DELAY_MS = 4000;
export const MARINE_RECOVERY_MAX = 3;

function forcedFallback() {
  try {
    return window.__FORCE_MARINE_FALLBACK__ === true || localStorage.getItem('force_marine_fallback') === 'true';
  } catch (e) {
    return false;
  }
}

export function useMarineWebglRecovery(setWebglMarineFailed,
  { delayMs = MARINE_RECOVERY_DELAY_MS, max = MARINE_RECOVERY_MAX } = {}) {
  const state = useRef({ attempts: 0, timer: null });
  useEffect(() => () => {
    if (state.current.timer) clearTimeout(state.current.timer);
    state.current.timer = null;
  }, []);
  return useCallback(() => {
    console.warn('[MapWebGL] Fallback to Canvas2D Marine overlay triggered');
    setWebglMarineFailed(true);
    const s = state.current;
    if (s.timer || s.attempts >= max || forcedFallback()) return;
    s.timer = setTimeout(() => {
      s.timer = null;
      if (forcedFallback()) return;
      s.attempts += 1;
      recordChurn('marine_webgl_recover', { attempt: s.attempts });
      setWebglMarineFailed(false);
    }, delayMs);
  }, [setWebglMarineFailed, delayMs, max]);
}
