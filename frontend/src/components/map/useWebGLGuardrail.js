import { useEffect, useRef } from 'react';
import { WeatherTelemetry } from './WeatherTelemetry';

/**
 * useWebGLGuardrail hook monitors the map's render loop frame rate.
 * If the frame rate drops below 30 FPS while WebGL layers are active
 * for 3 consecutive seconds, it triggers the fallback to Canvas2D layers
 * and emits a telemetry warning event.
 */
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

    const mountTime = performance.now();
    let frameCount = 0;
    let lastTime = performance.now();
    let lastFrameTime = performance.now();
    let lowFpsCount = 0;

    const onRender = () => {
      // Guard against rendering while tab is hidden
      if (typeof document !== 'undefined' && document.hidden) {
        frameCount = 0;
        lastTime = performance.now();
        lastFrameTime = performance.now();
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
      if (now - mountTime < 10000) {
        frameCount = 0;
        lastTime = now;
        lowFpsCount = 0;
        return;
      }

      // Bypass monitoring if the fallback has already occurred for active layers, or if no target WebGL layers are active
      const active = activeLayersRef.current || [];
      const hasWind = active.includes('wind') && !webglWindFailedRef.current;
      const hasMarine = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => active.includes(l)) && !webglMarineFailedRef.current;

      if (!hasWind && !hasMarine) {
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

        if (fps < 30) {
          if (typeof window !== 'undefined' && window.__DISABLE_WEBGL_GUARDRAIL__ === true) {
            frameCount = 0;
            lowFpsCount = 0;
            return;
          }
          console.warn(`[WebGLGuardrail] Warning: MapWebGL render FPS dropped below 30: ${fps} FPS`);
          
          // Log to console & telemetry
          WeatherTelemetry.emit('FPS_drop_detected', { 
            currentFps: fps, 
            context: 'MapWebGL_RenderLoop',
            activeLayers: active
          });

          lowFpsCount++;
          if (lowFpsCount >= 6) {
            console.error(`[WebGLGuardrail] Frame rate consistently below 30 FPS (${fps} FPS) for 6 consecutive seconds. Triggering local rendering fallback overrides.`);
            
            if (hasWind) {
              console.warn('[WebGLGuardrail] Triggering fallback override for WebGL Wind layer');
              setWebglWindFailedRef.current(true);
            }
            if (hasMarine) {
              console.warn('[WebGLGuardrail] Triggering fallback override for WebGL Marine layer');
              setWebglMarineFailedRef.current(true);
            }
            
            lowFpsCount = 0;
          }
        } else {
          lowFpsCount = 0;
        }
      }
    };

    const handleVisibilityChange = () => {
      // Reset all frame rate tracking variables when tab is hidden or restored
      frameCount = 0;
      const now = performance.now();
      lastTime = now;
      lastFrameTime = now;
      lowFpsCount = 0;
    };

    mapInstance.on('render', onRender);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      try {
        if (mapInstance) {
          mapInstance.off('render', onRender);
        }
      } catch (err) {
        console.warn('[WebGLGuardrail] Failed to remove render listener:', err);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [mapInstance]);
}
