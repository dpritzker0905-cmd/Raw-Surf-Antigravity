import { useEffect } from 'react';
import { WeatherTelemetry } from './WeatherTelemetry';

export function useMapContextEvents(mapInstance, setWebglWindFailed, setWebglMarineFailed) {
  // Self-healing observability for MapLibre errors and WebGL context events
  useEffect(() => {
    if (!mapInstance) return;

    const onError = (e) => {
      console.error('[MapWebGL] Map instance error event:', e);
      WeatherTelemetry.trackMapError(e.error?.message || 'MapError', e.error?.stack || '');
    };

    mapInstance.on('error', onError);

    const canvas = mapInstance.getCanvas();
    let onContextLost = null;
    let onContextRestored = null;

    if (canvas) {
      onContextLost = (e) => {
        e.preventDefault();
        console.error('[MapWebGL] WebGL context lost detected! Triggering safety fallbacks.');
        WeatherTelemetry.trackWebGLContextLost();
        setWebglWindFailed(true);
        setWebglMarineFailed(true);
      };

      onContextRestored = () => {
        console.log('[MapWebGL] WebGL context restored successfully! Recovering WebGL renderers.');
        WeatherTelemetry.trackWebGLContextRestored();
        
        const forceWind = typeof window !== 'undefined' && (window.__FORCE_WIND_FALLBACK__ === true || localStorage.getItem('force_wind_fallback') === 'true');
        const forceMarine = typeof window !== 'undefined' && (window.__FORCE_MARINE_FALLBACK__ === true || localStorage.getItem('force_marine_fallback') === 'true');
        
        if (!forceWind) setWebglWindFailed(false);
        if (!forceMarine) setWebglMarineFailed(false);
      };

      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.addEventListener('webglcontextrestored', onContextRestored);
    }

    return () => {
      mapInstance.off('error', onError);
      if (canvas) {
        if (onContextLost) canvas.removeEventListener('webglcontextlost', onContextLost);
        if (onContextRestored) canvas.removeEventListener('webglcontextrestored', onContextRestored);
      }
    };
  }, [mapInstance, setWebglWindFailed, setWebglMarineFailed]);

}
