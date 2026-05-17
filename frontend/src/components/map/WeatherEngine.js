import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchWindData, getRemainingCooldown } from './marineController';

/**
 * Unified Weather Data Engine (v3.9.4)
 * 
 * v3.9.4 FIXES:
 * - Retry survives layer switches (effect depends on mapInstance only)
 * - Removed timeline skip log spam (was firing on every slider tick)
 * - Uses module-level retry scheduling so 429 recovery persists
 * - Timeline scrub uses local hourly cache (zero API calls)
 */
export function useWeatherEngine({ activeLayers, mapInstance, timeOffsetHours = 0 }) {
  const [windData, setWindData] = useState(null);
  const windRevision = useRef(0);
  const timeOffsetRef = useRef(timeOffsetHours);
  const activeLayersRef = useRef(activeLayers);

  const isWindActive = useMemo(
    () => activeLayers.includes('wind'),
     
    [activeLayers.join(',')]
  );

  useEffect(() => {
    timeOffsetRef.current = timeOffsetHours;
  }, [timeOffsetHours]);

  useEffect(() => {
    activeLayersRef.current = activeLayers;
  }, [activeLayers]);

  // ===== PRIMARY DATA FETCH WITH RETRY =====
  // Depends only on mapInstance so retries survive layer switches
  useEffect(() => {
    if (!mapInstance) return;

    let cancelled = false;
    let retryTimer = null;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [0, 8000, 15000, 30000, 60000];

    const getBounds = () => {
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

    const attemptFetch = async () => {
      if (cancelled) return;

      // Check if wind is currently active
      if (!activeLayersRef.current.includes('wind')) {
        // Wind not active — don't fetch, but watch for activation
        retryTimer = setTimeout(attemptFetch, 2000);
        return;
      }

      const bounds = getBounds();
      if (!bounds) {
        retryTimer = setTimeout(attemptFetch, 3000);
        return;
      }

      // Check if in 429 cooldown — wait and retry
      const cooldownMs = getRemainingCooldown('wind');
      if (cooldownMs > 0) {
        const waitMs = cooldownMs + 2000;
        console.log(`[WeatherEngine] 429 cooldown active (${Math.ceil(cooldownMs/1000)}s), waiting ${Math.ceil(waitMs/1000)}s`);
        retryTimer = setTimeout(attemptFetch, waitMs);
        return;
      }

      console.log(`[WeatherEngine] Fetching wind (attempt ${retryCount + 1}/${MAX_RETRIES}, offset: ${timeOffsetRef.current}h)`);
      
      try {
        const data = await fetchWindData(bounds, null, timeOffsetRef.current);
        
        if (cancelled) return;
        
        if (data && data.vectors?.length > 0) {
          console.log(`[WeatherEngine] ✅ Wind data: ${data.vectors.length} vectors`);
          windRevision.current += 1;
          setWindData(data);
          retryCount = 0; // Reset on success
          // Schedule periodic refresh (5 min)
          retryTimer = setTimeout(attemptFetch, 5 * 60 * 1000);
        } else {
          retryCount++;
          if (retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAYS[retryCount] || 60000;
            console.log(`[WeatherEngine] ❌ No data (attempt ${retryCount}), retry in ${delay/1000}s`);
            retryTimer = setTimeout(attemptFetch, delay);
          } else {
            console.warn(`[WeatherEngine] Max retries (${MAX_RETRIES}) exhausted`);
            // Try again in 2 minutes
            retryTimer = setTimeout(() => { retryCount = 0; attemptFetch(); }, 120000);
          }
        }
      } catch (e) {
        if (e.name === 'AbortError' || cancelled) return;
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAYS[retryCount] || 60000;
          console.error(`[WeatherEngine] Error: ${e.message}, retry in ${delay/1000}s`);
          retryTimer = setTimeout(attemptFetch, delay);
        }
      }
    };

    // Start the fetch loop
    attemptFetch();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [mapInstance]); // Only mapInstance — retries survive layer switches

  // ===== TIMELINE SCRUB (local cache re-index, zero API calls) =====
  const prevOffsetRef = useRef(timeOffsetHours);
  useEffect(() => {
    if (prevOffsetRef.current === timeOffsetHours) return;
    prevOffsetRef.current = timeOffsetHours;
    if (!mapInstance || !isWindActive) return; // Silent skip — no log spam

    console.log(`[WeatherEngine] 🕐 Timeline scrub: ${timeOffsetHours}h`);

    const t = setTimeout(async () => {
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
        const data = await fetchWindData(bounds, null, timeOffsetHours, true);
        if (data && data.vectors?.length > 0) {
          console.log(`[WeatherEngine] 🕐 Timeline data: ${data.vectors.length} vectors at +${timeOffsetHours}h`);
          windRevision.current += 1;
          setWindData(data);
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('[WeatherEngine] Timeline fetch failed:', e.message);
        }
      }
    }, 200);
    return () => clearTimeout(t);
     
  }, [timeOffsetHours]);

  // ===== VIEWPORT CHANGE REFETCH =====
  useEffect(() => {
    if (!mapInstance || !isWindActive || !windData) return;

    const onMoveEnd = () => {
      setTimeout(async () => {
        try {
          const b = mapInstance.getBounds();
          const bounds = {
            west: b.getWest(),
            south: Math.max(-85, b.getSouth()),
            east: b.getEast(),
            north: Math.min(85, b.getNorth())
          };
          const data = await fetchWindData(bounds, null, timeOffsetRef.current);
          if (data && data.vectors?.length > 0) {
            windRevision.current += 1;
            setWindData(data);
          }
        } catch (e) { /* ignore */ }
      }, 2000);
    };

    mapInstance.on('moveend', onMoveEnd);
    return () => mapInstance.off('moveend', onMoveEnd);
  }, [mapInstance, isWindActive, !!windData]);  

  return { windData, windRevision };
}
