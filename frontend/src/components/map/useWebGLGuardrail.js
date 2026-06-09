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

    let frameCount = 0;
    let lastTime = performance.now();
    let lastFrameTime = performance.now();
    let lowFpsCount = 0;

    const onRender = () => {
      const now = performance.now();
      const delta = now - lastFrameTime;
      lastFrameTime = now;

      // Delta-time gate: if delta is >= 500ms, it's likely a tab switch or suspend.
      // Reset the window to avoid false performance drop detection.
      if (delta >= 500) {
        frameCount = 0;
        lastTime = now;
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
          console.warn(`[WebGLGuardrail] Warning: MapWebGL render FPS dropped below 30: ${fps} FPS`);
          
          // Log to console & telemetry
          WeatherTelemetry.emit('FPS_drop_detected', { 
            currentFps: fps, 
            context: 'MapWebGL_RenderLoop',
            activeLayers: active
          });

          lowFpsCount++;
          if (lowFpsCount >= 3) {
            console.error(`[WebGLGuardrail] Frame rate consistently below 30 FPS (${fps} FPS) for 3 consecutive seconds. Triggering local rendering fallback overrides.`);
            
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

    mapInstance.on('render', onRender);

    return () => {
      if (mapInstance) {
        mapInstance.off('render', onRender);
      }
    };
  }, [mapInstance]);
}
