import { useEffect, useRef } from 'react';
import { WeatherTelemetry } from './WeatherTelemetry';
import { cancelTruthChains } from './weatherTruthTracker';

/**
 * useWebGLGuardrail hook monitors the map's render loop frame rate.
 * If the frame rate drops below 20 FPS while WebGL layers are active
 * for 12 consecutive seconds, it triggers the fallback to Canvas2D layers
 * and emits a telemetry warning event.
 */
/** Mount/remount grace: shader compilation and the first texture uploads are not a stall. */
export const GRACE_MS = 10000;

/**
 * RECOVERY (2026-08-16). Before this, the trip was PERMANENT for the session: nothing ever called
 * `setWebglMarineFailed(false)` again, so one transient stall cost the user the WebGL marine field —
 * and with it the surf-RATING coastal band, which the Open-Meteo raster fallback does not draw — until
 * they changed layer or reloaded. Root-caused from the owner's "the rating band is being layered
 * underneath the marine heatmap": measured on the dev alias, the guardrail tripped 10 ms after the
 * band's last confirmed paint, and disabling it restored the band at 6/6 cameras.
 *
 * ⚠️ WHY THIS IS A TIMER AND NOT AN FPS RECOVERY, which is the obvious design and is WRONG here.
 * While the fallback is engaged the WebGL layer is UNMOUNTED, so the frames being counted are the
 * raster tiles'. Those are cheap and will comfortably clear any recovery threshold — measuring them
 * would prove nothing about the renderer we would be switching back on, and would re-enable it
 * straight into the same stall. There is no sound in-band signal, so recovery is a BOUNDED RETRY:
 * wait, try once, and if it trips again wait longer. After the budget it stays in the fallback for
 * good, which is the honest end state for a machine that genuinely cannot run the layer.
 *
 * Backoffs are also the flap bound: at most `RECOVERY_BACKOFFS_MS.length` re-enables per session.
 */
export const RECOVERY_BACKOFFS_MS = [60000, 300000];

/** True when the fallback was forced by a human (debug hook / persisted preference) rather than by
 *  this hook. Those must never be auto-recovered — the user asked for the fallback. */
export function isForcedFallback(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return false;
  if (w.__FORCE_MARINE_FALLBACK__ === true) return true;
  try { return w.localStorage && w.localStorage.getItem('force_marine_fallback') === 'true'; }
  catch (e) { return false; }
}

/**
 * Is a recovery attempt due? Pure, so the policy is testable without a map or a clock.
 * @returns {boolean}
 */
export function shouldAttemptRecovery({ marineFailed, guardrailOwned, attempts, trippedAt, now, forced, disabled }) {
  if (disabled || forced) return false;
  if (!marineFailed || !guardrailOwned) return false;          // not ours to undo
  if (!(attempts < RECOVERY_BACKOFFS_MS.length)) return false; // budget spent — stay down
  if (typeof trippedAt !== 'number' || typeof now !== 'number') return false;
  return (now - trippedAt) >= RECOVERY_BACKOFFS_MS[attempts];
}

export function useWebGLGuardrail({
  mapInstance,
  activeLayers,
  setWebglWindFailed,
  setWebglMarineFailed,
  webglWindFailed,
  webglMarineFailed,
}) {
  const activeLayersRef = useRef(activeLayers);
  const setWebglWindFailedRef = useRef(setWebglWindFailed);
  const setWebglMarineFailedRef = useRef(setWebglMarineFailed);
  const webglWindFailedRef = useRef(webglWindFailed);
  const webglMarineFailedRef = useRef(webglMarineFailed);

  // Sync refs with the latest props
  useEffect(() => {
    activeLayersRef.current = activeLayers;
    setWebglWindFailedRef.current = setWebglWindFailed;
    setWebglMarineFailedRef.current = setWebglMarineFailed;
    webglWindFailedRef.current = webglWindFailed;
    webglMarineFailedRef.current = webglMarineFailed;
  }, [activeLayers, setWebglWindFailed, setWebglMarineFailed, webglWindFailed, webglMarineFailed]);

  useEffect(() => {
    if (!mapInstance) return;

    // `graceUntil` replaces a fixed mountTime so RECOVERY can re-arm it: after the WebGL layer is
    // remounted the first seconds are shader compilation and texture upload again, exactly the cost
    // the mount grace exists to forgive. Without re-arming, every recovery attempt would trip
    // straight back on its own startup cost and the retry budget would burn for nothing.
    let graceUntil = performance.now() + GRACE_MS;
    let frameCount = 0;
    let lastTime = performance.now();
    let lastFrameTime = performance.now();
    let lowFpsCount = 0;
    // Recovery state. `guardrailOwned` is the consent check: only a trip this hook caused may be
    // undone by this hook. `attempts` is spent, never refunded, so the retry budget bounds flapping.
    let guardrailOwned = false;
    let trippedAt = 0;
    let attempts = 0;

    const onRender = () => {
      // Guard against rendering while tab is hidden or window lacks focus
      if (typeof document !== 'undefined' && (document.hidden || !document.hasFocus())) {
        frameCount = 0;
        lastTime = performance.now();
        lastFrameTime = performance.now();
        lowFpsCount = 0;
        return;
      }

      const now = performance.now();
      const delta = now - lastFrameTime;
      lastFrameTime = now;

      // Delta-time gate: if delta is >= 2000ms, it's likely a suspend, wake-up, or massive stutter.
      // Reset the window to avoid false performance drop detection, while still allowing
      // extremely low frame rates (e.g. 1 FPS, 1000ms delta) to be detected correctly.
      if (delta >= 2000) {
        frameCount = 0;
        lastTime = now;
        return;
      }

      // v3.9.5: Add grace period of 10 seconds to allow shader compilation and map initialization
      if (now < graceUntil) {
        frameCount = 0;
        lastTime = now;
        lowFpsCount = 0;
        return;
      }

      // Bypass monitoring if the fallback has already occurred for active layers, or if no target WebGL layers are active
      const active = activeLayersRef.current || [];
      // Note: Wind is excluded from performance-based fallback triggers. It only falls back on hard errors.
      const hasMarine = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => active.includes(l)) && !webglMarineFailedRef.current;

      if (!hasMarine) {
        frameCount = 0;
        lastTime = now;
        lowFpsCount = 0;
        return;
      }

      // Bypass monitoring if the user is currently timeline scrubbing or has scrubbed in the last 5 seconds
      const isScrubbing = typeof window !== 'undefined' && (
        window.isScrubbingTimeline === true ||
        (window.lastScrubTime && (Date.now() - window.lastScrubTime < 5000))
      );
      if (isScrubbing) {
        frameCount = 0;
        lastTime = now;
        lowFpsCount = 0;
        return;
      }

      // Bypass monitoring if the map is moving or zooming
      const isMoving = mapInstance.isMoving?.() || mapInstance.isZooming?.();
      if (isMoving) {
        frameCount = 0;
        lastTime = now;
        lowFpsCount = 0;
        return;
      }

      // Bypass monitoring during active model/layer transitions — FPS drops are expected
      // while tile sources reload and the WebGL engine re-uploads textures.
      if (typeof window !== 'undefined' && window.__MARINE_TRANSITIONING__ === true) {
        frameCount = 0;
        lastTime = now;
        lowFpsCount = 0;
        return;
      }

      frameCount++;
      const elapsed = now - lastTime;

      // Calculate FPS every second
      if (elapsed >= 1000) {
        const fps = Math.round((frameCount * 1000) / elapsed);
        frameCount = 0;
        lastTime = now;

        if (typeof window !== 'undefined') {
          window.__MAP_RENDER_FPS__ = fps;
        }

        if (fps < 20) {
          const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
          const isLocalhost = typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
            !isTest;

          if (typeof window !== 'undefined' && (window.__DISABLE_WEBGL_GUARDRAIL__ === true || isLocalhost)) {
            frameCount = 0;
            lowFpsCount = 0;
            return;
          }
          console.warn(`[WebGLGuardrail] Warning: MapWebGL render FPS dropped below 20: ${fps} FPS`);
          
          // Log to console & telemetry
          WeatherTelemetry.emit('FPS_drop_detected', { 
            currentFps: fps, 
            context: 'MapWebGL_RenderLoop',
            activeLayers: active
          });

          lowFpsCount++;
          if (lowFpsCount >= 12) {
            console.error(`[WebGLGuardrail] Frame rate consistently below 20 FPS (${fps} FPS) for 12 consecutive seconds. Triggering local rendering fallback overrides.`);
            
            if (hasMarine) {
              console.warn('[WebGLGuardrail] Triggering fallback override for WebGL Marine layer');
              // Stamp the trip as OURS and when it happened — recovery only ever undoes a
              // performance trip, never a hard WebGL error or a human-forced fallback.
              guardrailOwned = true;
              trippedAt = now;
              setWebglMarineFailedRef.current(true);
              // R11-01(c): this flip unmounts WebGLMarineLayer — every in-flight truth chain is
              // being ABANDONED ON PURPOSE. Close them with the cancel terminal, or 30 s later
              // the absence watchdog reports each as "died after <stage>" (the false death that
              // misdirected the 2026-08-09 live forensics). Telemetry carries the transition.
              try {
                const n = cancelTruthChains('webgl_marine_fallback: guardrail tripped after 12 low-FPS windows');
                WeatherTelemetry.emit('webgl_marine_fallback_engaged', { cancelledChains: n, fps });
              } catch (e) { /* the flip must never fail on diagnostics */ }
            }

            lowFpsCount = 0;
          }
        } else {
          lowFpsCount = 0;
        }
      }
    };

    const handleReset = () => {
      // Reset all frame rate tracking variables when tab/window focus or visibility changes
      frameCount = 0;
      const now = performance.now();
      lastTime = now;
      lastFrameTime = now;
      lowFpsCount = 0;
    };

    // The retry runs on a timer, not on 'render': a map sitting idle in the fallback emits few or no
    // renders, and a recovery that only fires while the user is already interacting would never
    // reach the user who set the map down for a minute — the case it exists for.
    const recoveryTick = () => {
      const now = performance.now();
      if (!shouldAttemptRecovery({
        marineFailed: webglMarineFailedRef.current, guardrailOwned, attempts, trippedAt, now,
        forced: isForcedFallback(typeof window !== 'undefined' ? window : null),
        disabled: typeof window !== 'undefined' && window.__DISABLE_WEBGL_GUARDRAIL_RECOVERY__ === true,
      })) return;
      // Don't re-enable into a gesture or a hidden tab — a remount mid-pan is the worst moment for
      // it, and a background tab's frames are throttled so the attempt would be wasted.
      if (typeof document !== 'undefined' && (document.hidden || !document.hasFocus())) return;
      if (mapInstance.isMoving?.() || mapInstance.isZooming?.()) return;

      attempts += 1;
      graceUntil = now + GRACE_MS;   // remount costs startup again; forgive it (see graceUntil)
      lowFpsCount = 0; frameCount = 0; lastTime = now; lastFrameTime = now;
      console.warn(`[WebGLGuardrail] Recovery attempt ${attempts}/${RECOVERY_BACKOFFS_MS.length}: `
        + 're-enabling the WebGL Marine layer after backoff.');
      try {
        WeatherTelemetry.emit('webgl_marine_fallback_recovery', { attempt: attempts });
      } catch (e) { /* the retry must never fail on diagnostics */ }
      setWebglMarineFailedRef.current(false);
    };
    const recoveryTimer = setInterval(recoveryTick, 5000);

    mapInstance.on('render', onRender);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleReset);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleReset);
      window.addEventListener('blur', handleReset);
    }

    return () => {
      clearInterval(recoveryTimer);
      try {
        if (mapInstance) {
          mapInstance.off('render', onRender);
        }
      } catch (err) {
        console.warn('[WebGLGuardrail] Failed to remove render listener:', err);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleReset);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleReset);
        window.removeEventListener('blur', handleReset);
      }
    };
  }, [mapInstance]);
}
