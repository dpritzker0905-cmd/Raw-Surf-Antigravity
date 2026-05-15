import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchWindData } from './marineController';

/**
 * Unified Weather Data Engine (v3.0.0)
 * 
 * Conforms to Marine Engine v3 runtime contract:
 * - VIEWPORT-based fetching (NOT global domain)
 * - Viewport hash deduplication
 * - 429 cooldown respected (handled in marineController)
 * - AbortController for inflight cancellation
 * - Preserves last valid field (handled in marineController)
 * - Only fetches on: mount, timer tick, manual toggle, significant viewport change
 * - NEVER fetches on: render, theme change, animation frame, particle update
 */
export function useWeatherEngine({ activeLayers, mapInstance }) {
  const [windData, setWindData] = useState(null);
  const windRevision = useRef(0);
  
  const activeLayersRef = useRef(activeLayers);
  const lastViewportHashRef = useRef(null);
  
  useEffect(() => {
    activeLayersRef.current = activeLayers;
  }, [activeLayers]);

  useEffect(() => {
    if (!mapInstance) return;

    let isFetching = false;
    let abortController = null;

    /**
     * Compute a viewport hash for deduplication.
     * If the hash hasn't changed, skip the fetch.
     */
    const getViewportHash = () => {
      try {
        const center = mapInstance.getCenter();
        const zoom = mapInstance.getZoom();
        const q = (v) => Number(v).toFixed(1);
        return `${q(center.lng)}:${q(center.lat)}:${Math.round(zoom)}`;
      } catch (e) {
        return null;
      }
    };

    /**
     * Get the current viewport bounds from MapLibre.
     */
    const getViewportBounds = () => {
      try {
        const b = mapInstance.getBounds();
        return {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
      } catch (e) {
        return null;
      }
    };

    const requestUpdate = async (source) => {
      if (isFetching) return;
      
      const active = activeLayersRef.current;
      if (!active.includes('wind')) {
        // Do NOT clear windData — hiding is done via canvas visibility.
        // Clearing triggers re-render loops.
        return;
      }

      // Viewport hash deduplication
      const hash = getViewportHash();
      if (hash && hash === lastViewportHashRef.current && source !== 'manual_toggle') {
        return;
      }

      const bounds = getViewportBounds();
      if (!bounds) return;

      // Cancel previous inflight
      if (abortController) abortController.abort();
      abortController = new AbortController();

      isFetching = true;
      try {
        console.log(`[WeatherEngine] Fetching wind (source: ${source})`);
        console.log('[Wind Bounds]', bounds);
        const data = await fetchWindData(bounds, abortController.signal);
        
        if (data && data.vectors?.length > 0) {
          lastViewportHashRef.current = hash;
          windRevision.current += 1;
          setWindData(data);
        } else if (data) {
          // Data returned but empty — don't overwrite existing
          console.warn('[WeatherEngine] Empty wind field returned, preserving last valid');
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('[WeatherEngine] Fetch failed:', e);
        }
      } finally {
        isFetching = false;
      }
    };

    // Initial fetch on mount
    requestUpdate('mount');

    // Timer-based refresh: 5 minute intervals
    const tickInterval = setInterval(() => {
      requestUpdate('timer_tick');
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(tickInterval);
      if (abortController) abortController.abort();
    };
  }, [mapInstance]);

  // Manual toggle trigger: when wind is turned ON but no data exists
  const isWindActive = useMemo(
    () => activeLayers.includes('wind'),
    [activeLayers.join(',')]
  );
  const isFetchingWindRef = useRef(false);

  useEffect(() => {
    if (!mapInstance || !isWindActive || windData || isFetchingWindRef.current) return;
    
    const t = setTimeout(async () => {
      isFetchingWindRef.current = true;
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
        console.log('[WeatherEngine] Manual fetch: wind layer toggled ON');
        const data = await fetchWindData(bounds);
        if (data && data.vectors?.length > 0) {
          windRevision.current += 1;
          setWindData(data);
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('[WeatherEngine] Manual fetch failed:', e);
        }
      } finally {
        isFetchingWindRef.current = false;
      }
    }, 200);
    return () => clearTimeout(t);
  }, [isWindActive, windData, mapInstance]);

  return { windData, windRevision };
}
