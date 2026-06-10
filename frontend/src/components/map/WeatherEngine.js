import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchWindData, getRemainingCooldown, getWindHourlyCache, extractWindAtOffset, isContainedInWindCache } from './marineController';
import { onForecastUpdate } from '../../engine/data/forecast-pipeline';
import { clampViewportBbox } from './backendWeatherServiceClientCoverage';
import { recordTruthStage } from './weatherTruthTracker';

/**
 * Unified Weather Data Engine (v3.9.4)
 * 
 * v3.9.4 FIXES:
 * - Retry survives layer switches (effect depends on mapInstance only)
 * - Removed timeline skip log spam (was firing on every slider tick)
 * - Uses module-level retry scheduling so 429 recovery persists
 * - Timeline scrub uses local hourly cache (zero API calls)
 */
export function useWeatherEngine({ activeLayers, mapInstance, timeOffsetHours = 0, activeModel = 'GFS', forecastDays = 3 }) {
  const [windData, setWindData] = useState(null);
  const windRevision = useRef(0);
  const timeOffsetRef = useRef(timeOffsetHours);
  const activeLayersRef = useRef(activeLayers);

  const commitWindData = (data) => {
    if (data && typeof window !== 'undefined' && data.hourOffset === 0) {
      recordTruthStage('orchestratorCommit', {
        model: data.source || activeModel,
        domain: 'wind',
        layer: 'wind',
        valid_time: data.valid_time,
        run_time: data.run_time,
        product_id: data.productId || data.product_id,
        is_dynamic_viewport_product: data.is_dynamic_viewport_product,
        coverage_scope: data.coverage_scope,
        requested_bbox: data.requested_bbox,
        served_bbox: data.served_bbox,
        grid: {
          cols: data.cols,
          rows: data.rows,
          bounds: data.bounds,
          vectors: data.vectors
        },
        truthTag: data.truthTag
      }, 'WeatherEngine.js', 'commitWindData');
    }
    setWindData(data);
  };

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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.getWindHourlyCache = getWindHourlyCache;
    }
  }, []);

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
      // Scrubbing mode hard freeze (Request 3)
      if (window.isScrubbingTimeline) {
        console.log("[SCRUB] [FETCH] Wind fetch suppressed during active scrubbing");
        return;
      }

      if (cancelled) return;

      // Check if wind is currently active
      if (!isWindActive) {
        return; // Return immediately to allow zero-overhead sleeping when wind is inactive
      }

      const bounds = getBounds();
      if (!bounds) {
        retryTimer = setTimeout(attemptFetch, 1000); // Shorter retry window to capture bounds faster
        return;
      }

      // v6I.1 Check coverage limits first to enforce regional tiles and outside coverage clearing
      const clampResult = clampViewportBbox(bounds, 'wind', activeModel, 'wind');
      if (!clampResult.isInside) {
        console.log(`[WeatherEngine] Viewport outside wind coverage (${clampResult.fallbackReason}). Clearing visual layer.`);
        commitWindData(null);
        windRevision.current += 1;
        // Periodic check to see if we pan back into coverage
        retryTimer = setTimeout(attemptFetch, 10000);
        return;
      }

      // Check if in 429 cooldown wait and retry
      const cooldownMs = getRemainingCooldown('wind');
      if (cooldownMs > 0) {
        const waitMs = cooldownMs + 2000;
        console.log(`[FETCH] [WeatherEngine] 429 cooldown active (${Math.ceil(cooldownMs/1000)}s), waiting ${Math.ceil(waitMs/1000)}s`);
        retryTimer = setTimeout(attemptFetch, waitMs);
        return;
      }

      console.log(`[FETCH] [WeatherEngine] Fetching wind (attempt ${retryCount + 1}/${MAX_RETRIES}, offset: ${timeOffsetRef.current}h)`);
      
      try {
        const data = await fetchWindData(bounds, null, timeOffsetRef.current, false, forecastDays, activeModel);
        
        if (cancelled) return;
        
        if (data && data.vectors?.length > 0) {
          console.log(`[CACHE] [WeatherEngine] Wind data: ${data.vectors.length} vectors`);
          windRevision.current += 1;
          commitWindData(data);
          retryCount = 0; // Reset on success
          // Schedule periodic refresh (5 min)
          retryTimer = setTimeout(attemptFetch, 5 * 60 * 1000);
        } else {
          retryCount++;
          if (retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAYS[retryCount] || 60000;
            console.log(`[FETCH] [WeatherEngine] No data (attempt ${retryCount}), retry in ${delay/1000}s`);
            retryTimer = setTimeout(attemptFetch, delay);
          } else {
            console.warn(`[FETCH] [WeatherEngine] Max retries (${MAX_RETRIES}) exhausted`);
            // Try again in 2 minutes
            retryTimer = setTimeout(() => { retryCount = 0; attemptFetch(); }, 120000);
          }
        }
      } catch (e) {
        if (e.name === 'AbortError' || cancelled) return;
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAYS[retryCount] || 60000;
          console.error(`[FETCH] [WeatherEngine] Error: ${e.message}, retry in ${delay/1000}s`);
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
  }, [mapInstance, activeModel, forecastDays, isWindActive]); // Refetch when model or forecast window changes

  // ===== TIMELINE SCRUB (local cache re-index, with FETCH ON CACHE MISS) =====
  const prevOffsetRef = useRef(timeOffsetHours);
  useEffect(() => {
    if (prevOffsetRef.current === timeOffsetHours) return;
    prevOffsetRef.current = timeOffsetHours;
    if (!mapInstance || !isWindActive) return;

    console.log(`[SCRUB] [WeatherEngine] Timeline scrub: ${timeOffsetHours}h`);

    const t = setTimeout(async () => {
      let cacheMiss = false;
      let targetData = null;
      try {
        const cache = getWindHourlyCache();
        if (cache?.results?.length && cache.model === activeModel) {
          targetData = extractWindAtOffset(cache, timeOffsetHours);
          if (!targetData || !targetData.vectors || targetData.vectors.length === 0) {
            cacheMiss = true;
          }
        } else {
          cacheMiss = true;
        }
      } catch (e) {
        cacheMiss = true;
      }

      if (cacheMiss) {
        console.log(`[CACHE] [WeatherEngine] Cache miss for wind at hour +${timeOffsetHours}h. Fetching immediately...`);
        try {
          const b = mapInstance.getBounds();
          const bounds = {
            west: b.getWest(),
            south: Math.max(-85, b.getSouth()),
            east: b.getEast(),
            north: Math.min(85, b.getNorth())
          };

          const clampResult = clampViewportBbox(bounds, 'wind', activeModel, 'wind');
          if (!clampResult.isInside) {
            console.log(`[WeatherEngine] Scrub target +${timeOffsetHours}h is outside wind coverage. Clearing visual.`);
            commitWindData(null);
            windRevision.current += 1;
            return;
          }

          const data = await fetchWindData(bounds, null, timeOffsetHours, true, forecastDays, activeModel);
          if (data && data.vectors?.length > 0) {
            console.log(`[SCRUB] [WeatherEngine] Fetch wind grid success for hour +${timeOffsetHours}h: ${data.vectors.length} vectors`);
            windRevision.current += 1;
            commitWindData(data);
          } else {
            console.log(`[WeatherEngine] No wind forecast coverage at offset +${timeOffsetHours}h. Clearing visual.`);
            commitWindData(null);
            windRevision.current += 1;
          }
        } catch (err) {
          console.error('[WeatherEngine] Wind scrub fetch failed:', err.message);
          commitWindData(null);
          windRevision.current += 1;
        }
      } else if (targetData && targetData.vectors?.length > 0) {
        console.log(`[CACHE] [WeatherEngine] Timeline data: ${targetData.vectors.length} vectors at +${timeOffsetHours}h`);
        windRevision.current += 1;
        commitWindData(targetData);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [timeOffsetHours, mapInstance, activeModel, isWindActive, forecastDays]);

  // ===== VIEWPORT CHANGE REFETCH =====
  useEffect(() => {
    if (!mapInstance || !isWindActive) return;

    let timer = null;

    const onMoveEnd = () => {
      if (window.isScrubbingTimeline) return;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
        // Turbo-boost: check if the new bounds are contained in cache, drop pan delay to 50ms instead of 500ms
        const isCached = isContainedInWindCache(bounds, activeModel);
        const delay = isCached ? 50 : 500;

        timer = setTimeout(async () => {
          timer = null;

          if (window.isScrubbingTimeline) {
            console.log("[SCRUB] [FETCH] Wind fetch suppressed during active scrubbing");
            return;
          }

          // v6I.1 Check coverage limits first
          const clampResult = clampViewportBbox(bounds, 'wind', activeModel, 'wind');
          if (!clampResult.isInside) {
            console.log(`[WeatherEngine] Viewport moved outside wind coverage. Clearing visual.`);
            commitWindData(null);
            windRevision.current += 1;
            return;
          }

          try {
            const data = await fetchWindData(bounds, null, timeOffsetRef.current, false, forecastDays, activeModel);
            if (data && data.vectors?.length > 0) {
              console.log(`[FETCH] [WeatherEngine] Viewport wind fetch success: ${data.vectors.length} vectors`);
              windRevision.current += 1;
              commitWindData(data);
            }
          } catch (e) { /* ignore */ }
        }, delay);
      } catch (e) { /* ignore bounds error on init */ }
    };

    mapInstance.on('moveend', onMoveEnd);
    return () => {
      mapInstance.off('moveend', onMoveEnd);
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [mapInstance, isWindActive, activeModel, forecastDays]);  

  // v3.11.1: Subscribe to forecast pipeline for downstream engine consumers
  useEffect(() => {
    var unsub = onForecastUpdate(function(field) {
      console.log('[TRANSITION] [WeatherEngine] Pipeline update:', field?.source, field?.grid?.width + 'x' + field?.grid?.height);
    });
    return unsub;
  }, []);

  return { windData, windRevision };
}
