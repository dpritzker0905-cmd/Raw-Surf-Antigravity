import { useState, useCallback, useEffect } from 'react';
import { WeatherTelemetry } from './WeatherTelemetry';
import { detectWebglSupport, isMapStartupFailure } from './mapWebglSupport';

/**
 * Everything the map does when its rendering goes wrong, in one place.
 *
 * 2026-09-22 — created by pulling the existing "self-healing observability" effect out of
 * MapWebGL.js and joining it to the new STARTUP failure path. They belong together: they are
 * the same concern (the map cannot draw) split across two lifetimes (never started vs.
 * started then lost), and keeping them apart is what let the startup half go unhandled while
 * the runtime half had listeners.
 *
 * It also keeps the two halves from fighting. `onMapError` and the runtime `error` listener
 * are reachable by the SAME library event, so exactly one of them must own telemetry for a
 * given error — which is much easier to see when they are twenty lines apart than when they
 * are five hundred.
 *
 * Returns the startup state the surface renders from, plus the handler to hand to <Map>.
 */
export const useMapErrorSurface = ({ mapInstance, innerMapRef, setWebglWindFailed, setWebglMarineFailed }) => {
  // Probed once per mount rather than per render: cheap, but not free, and it allocates a
  // real GL context (which mapWebglSupport releases immediately).
  const [webglSupport] = useState(() => detectWebglSupport());
  const [mapInitError, setMapInitError] = useState(null);
  const [mapMountAttempt, setMapMountAttempt] = useState(0);

  /**
   * ⚠️ `onError` is NOT only an init hook. @vis.gl/react-maplibre maps the map's ongoing
   * `error` event onto the SAME prop (dist/maplibre/maplibre.js line 60, `error: 'onError'`),
   * so a failed tile, style or source request arrives here too. Raising the startup panel on
   * one of those would blank a map that is drawing perfectly well — strictly worse than the
   * silence this replaces. isMapStartupFailure carries that judgement, and is tested.
   *
   * Runtime errors return early: the effect below already logs and calls trackMapError for
   * exactly those, and claiming them here too would double every runtime map error.
   */
  const onMapError = useCallback((event) => {
    if (!isMapStartupFailure(event, Boolean(innerMapRef?.current))) return;

    const err = event?.error || event;
    const message = (err && err.message) || String(err || 'Unknown map initialisation error');
    console.error('[MapWebGL] Map failed to initialise:', err);
    WeatherTelemetry.trackMapError(message, (err && err.stack) || '');
    setMapInitError(message);
  }, [innerMapRef]);

  /**
   * Retry remounts the map subtree by key rather than reloading the page: a reload would
   * discard the user's session state to fix a failure that is often transient (a lost GPU
   * process recovers on its own).
   */
  const onRetryMapInit = useCallback(() => {
    setMapInitError(null);
    setMapMountAttempt((n) => n + 1);
  }, []);

  // Self-healing observability for MapLibre errors and WebGL context events.
  // Moved verbatim from MapWebGL.js (2026-09-22) — behaviour unchanged.
  useEffect(() => {
    if (!mapInstance) return undefined;

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

  // A WebGL-less browser is reported up front; anything else only after maplibre has tried.
  const mapUnavailableReason = !webglSupport.supported
    ? webglSupport.reason
    : (mapInitError ? 'init-failed' : null);

  return { mapUnavailableReason, mapInitError, mapMountAttempt, onMapError, onRetryMapInit };
};

export default useMapErrorSurface;
