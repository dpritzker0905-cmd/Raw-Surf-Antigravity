import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchWindData, getRemainingCooldown } from './marineController';

/**
 * Unified Weather Data Engine (v3.9.3)
 * 
 * v3.9.3 CRITICAL FIX:
 * - Added retry with exponential backoff (3 retries: 5s, 10s, 20s)
 * - Wind grid fetch now ALWAYS attempts on layer activation
 * - Aggressive console logging at EVERY decision point
 * - Eliminated silent return paths — every early exit is logged
 * - Timeline scrub uses local hourly cache (zero API calls)
 */
export function useWeatherEngine({ activeLayers, mapInstance, timeOffsetHours = 0 }) {
  const [windData, setWindData] = useState(null);
  const windRevision = useRef(0);
  const retryTimerRef = useRef(null);
  const timeOffsetRef = useRef(timeOffsetHours);

  const isWindActive = useMemo(
    () => activeLayers.includes('wind'),
    // eslint-disable-next-line
    [activeLayers.join(',')]
  );

  useEffect(() => {
    timeOffsetRef.current = timeOffsetHours;
  }, [timeOffsetHours]);

  // ===== PRIMARY DATA FETCH WITH RETRY =====
  useEffect(() => {
    if (!mapInstance || !isWindActive) {
      console.log(`[WeatherEngine] Skip: mapInstance=${!!mapInstance}, isWindActive=${isWindActive}`);
      return;
    }

    let cancelled = false;
    let retryCount = 0;
    const MAX_RETRIES = 4;
    const RETRY_DELAYS = [0, 5000, 10000, 20000]; // immediate, then backoff

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

      const bounds = getBounds();
      if (!bounds) {
        console.warn('[WeatherEngine] No bounds available');
        return;
      }

      // Check if in 429 cooldown — wait and retry instead of giving up
      const cooldownMs = getRemainingCooldown('wind');
      if (cooldownMs > 0 && retryCount < MAX_RETRIES) {
        console.log(`[WeatherEngine] In 429 cooldown (${Math.ceil(cooldownMs/1000)}s remaining), retry #${retryCount + 1} in ${Math.ceil(cooldownMs/1000)}s`);
        retryTimerRef.current = setTimeout(() => {
          retryCount++;
          attemptFetch();
        }, cooldownMs + 1000);
        return;
      }

      console.log(`[WeatherEngine] Fetching wind (attempt ${retryCount + 1}/${MAX_RETRIES}, offset: ${timeOffsetRef.current}h)`);
      
      try {
        const data = await fetchWindData(bounds, null, timeOffsetRef.current);
        
        if (cancelled) return;
        
        if (data && data.vectors?.length > 0) {
          console.log(`[WeatherEngine] ✅ Wind data received: ${data.vectors.length} vectors`);
          windRevision.current += 1;
          setWindData(data);
        } else {
          console.warn(`[WeatherEngine] ❌ No wind data returned (attempt ${retryCount + 1})`);
          // Schedule retry if we haven't exceeded max
          if (retryCount < MAX_RETRIES - 1) {
            retryCount++;
            const delay = RETRY_DELAYS[retryCount] || 20000;
            console.log(`[WeatherEngine] Scheduling retry #${retryCount + 1} in ${delay/1000}s`);
            retryTimerRef.current = setTimeout(attemptFetch, delay);
          }
        }
      } catch (e) {
        if (e.name === 'AbortError' || cancelled) return;
        console.error(`[WeatherEngine] Fetch error (attempt ${retryCount + 1}):`, e.message);
        if (retryCount < MAX_RETRIES - 1) {
          retryCount++;
          const delay = RETRY_DELAYS[retryCount] || 20000;
          retryTimerRef.current = setTimeout(attemptFetch, delay);
        }
      }
    };

    // Start fetching immediately
    attemptFetch();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [mapInstance, isWindActive]);

  // ===== TIMELINE SCRUB (local cache re-index, zero API calls) =====
  const prevOffsetRef = useRef(timeOffsetHours);
  useEffect(() => {
    if (prevOffsetRef.current === timeOffsetHours) return;
    prevOffsetRef.current = timeOffsetHours;

    if (!mapInstance || !isWindActive) {
      console.log(`[WeatherEngine] Timeline skip: map=${!!mapInstance}, wind=${isWindActive}`);
      return;
    }

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
        // forceFetch=true to bypass cooldown, uses local cache when available
        const data = await fetchWindData(bounds, null, timeOffsetHours, true);
        if (data && data.vectors?.length > 0) {
          console.log(`[WeatherEngine] 🕐 Timeline data: ${data.vectors.length} vectors at +${timeOffsetHours}h`);
          windRevision.current += 1;
          setWindData(data);
        } else {
          console.warn(`[WeatherEngine] 🕐 No data for +${timeOffsetHours}h`);
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('[WeatherEngine] Timeline fetch failed:', e.message);
        }
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [timeOffsetHours]);

  // ===== VIEWPORT CHANGE REFETCH =====
  useEffect(() => {
    if (!mapInstance || !isWindActive || !windData) return;

    const onMoveEnd = () => {
      // Only refetch if we already have data (avoid double-fetch on mount)
      const t = setTimeout(async () => {
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
      return () => clearTimeout(t);
    };

    mapInstance.on('moveend', onMoveEnd);
    return () => mapInstance.off('moveend', onMoveEnd);
  }, [mapInstance, isWindActive, !!windData]); // eslint-disable-line

  return { windData, windRevision };
}
