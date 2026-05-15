import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchWindData } from './marineController';

/**
 * Unified Weather Data Engine (v230)
 * 
 * RULE: WEATHER IS TIME-DRIVEN, NOT MAP-DRIVEN.
 * This completely decouples wind, radar, and satellite fetching from MapLibre lifecycle events.
 * It enforces that weather layers only refresh on:
 * 1. Time ticks (e.g. 5 min intervals)
 * 2. Manual layer toggle (ON/OFF)
 * 3. Forecast step changes
 */
export function useWeatherEngine({ activeLayers, mapInstance }) {
  const [windData, setWindData] = useState(null);
  const windRevision = useRef(0);
  
  const activeLayersRef = useRef(activeLayers);
  
  // Track manual toggles
  useEffect(() => {
    activeLayersRef.current = activeLayers;
  }, [activeLayers]);

  useEffect(() => {
    if (!mapInstance) return;

    let isFetching = false;

    const requestUpdate = async (source) => {
      if (isFetching) return;
      
      const active = activeLayersRef.current;
      if (!active.includes('wind')) {
        setWindData(null);
        return;
      }

      isFetching = true;
      try {
        // v255: WIND DOMAIN FIX - Enforce global domain, NEVER viewport bounds
        const bounds = {
          west: -180, south: -85,
          east: 180, north: 85
        };

        console.log(`[WeatherEngine] tick -> fetching wind data (source: ${source})`);
        let data = await fetchWindData(bounds);
        if (window.__LRCM_EXEC_TRACE__) {
          data = window.__LRCM_EXEC_TRACE__.push({ layer: 'wind', action: 'fetch', source: 'WeatherEngine', timestamp: Date.now(), payload: data, stack: new Error().stack }) && data;
        }
        
        if (data) {
          console.log('[WeatherEngine] cache updated');
          windRevision.current += 1;
          setWindData(data);
        }
      } catch (e) {
        console.error('[WeatherEngine] Fetch failed:', e);
      } finally {
        isFetching = false;
      }
    };

    // Trigger on mount or when map is first ready
    requestUpdate('mount');

    // WEATHER TIME ENGINE: 5 minute API refresh interval
    // This absolutely guarantees ZERO feedback loops with MapLibre's moveend or sourcedata events.
    const tickInterval = setInterval(() => {
      requestUpdate('timer_tick');
    }, 5 * 60 * 1000);

    return () => clearInterval(tickInterval);
  }, [mapInstance]);

  // v246: Manual fetch trigger when wind layer is toggled ON but no data exists.
  // This was previously a no-op (empty setTimeout body) — the root cause of WIND_DATA_EMPTY.
  const isWindActive = useMemo(() => activeLayers.includes('wind'), [activeLayers.join(',')]);
  const isFetchingWindRef = useRef(false);

  useEffect(() => {
    if (!mapInstance || !isWindActive || windData || isFetchingWindRef.current) return;
    
    const t = setTimeout(async () => {
      // v256: WIND DOMAIN FIX - Enforce global domain for manual toggle as well
      const bounds = {
        west: -180, south: -85,
        east: 180, north: 85
      };
      console.log('[WeatherEngine] Manual fetch → wind layer toggled ON');
      isFetchingWindRef.current = true;
      try {
        const data = await fetchWindData(bounds);
        if (data) {
          windRevision.current += 1;
          setWindData(data);
        }
      } catch (e) {
        console.error('[WeatherEngine] Manual fetch failed:', e);
      } finally {
        isFetchingWindRef.current = false;
      }
    }, 200);
    return () => clearTimeout(t);
  }, [isWindActive, windData, mapInstance]);

  return { windData, windRevision };
}
