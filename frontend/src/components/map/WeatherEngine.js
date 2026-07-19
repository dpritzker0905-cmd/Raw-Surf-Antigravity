import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchWindData, getRemainingCooldown, getWindHourlyCache, extractWindAtOffset, isContainedInWindCache, getModelSafeWind, getBackendWindFlag, prewarmSiblingModelWind, isRenderableWindData } from './marineController';
import { onForecastUpdate } from '../../engine/data/forecast-pipeline';
import { clampViewportBbox } from './backendWeatherServiceClientCoverage';
import { recordTruthStage } from './weatherTruthTracker';
import { ensureWindSeries, getWindSeriesFrame, prewarmWindSeries } from './windGridSeries';
import { isTerminalNoCoverage } from './marineControllerCache';

// Module-level scrub log throttle (max once per 2s)
let _lastScrubLogTime = 0;

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
  const activeModelRef = useRef(activeModel);
  const activeLayersRef = useRef(activeLayers);
  // Keep latest model in a ref so an async wind fetch can verify request-intent parity (model +
  // hour) before committing — a scrub/model-switch during the fetch must not commit stale data.
  activeModelRef.current = activeModel;

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
    // First empty-retry is fast (3s) so wind recovers quickly when its initial fetch returns
    // empty because the 1-CPU backend was momentarily storm-loaded (e.g. right after rapidly
    // cycling marine layers — the "wind won't activate" report). Subsequent retries back off so
    // a persistently-empty viewport doesn't hammer the box.
    const RETRY_DELAYS = [0, 3000, 10000, 25000, 60000];

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

      // SYNC PARITY (wind↔marine): if a warm client/series cache already covers the current
      // hour+viewport+model, commit it INSTANTLY so wind renders without waiting on the backend
      // round-trip — the same cached-instant pattern the marine scrub path uses. The network
      // fetch below still runs to refresh. Additive + cache-only (keyed by model+hour+bounds, so
      // never a stale-viewport commit): a cold cache is a no-op, no extra backend load. This kills
      // the "wind reloads slowly after toggling around / scrubbing marine" delay on warm toggles.
      try {
        let warm = getBackendWindFlag() ? getModelSafeWind(activeModel, timeOffsetRef.current, bounds) : null;
        if (!warm || !(warm.vectors?.length > 0)) {
          const sf = getWindSeriesFrame(activeModel, bounds, timeOffsetRef.current);
          if (sf && sf.vectors?.length > 0) warm = sf;
        }
        if (warm && warm.vectors?.length > 0) {
          windRevision.current += 1;
          commitWindData(warm);
        }
      } catch (e) { /* best-effort warm commit; fall through to the authoritative fetch */ }

      console.log(`[FETCH] [WeatherEngine] Fetching wind (attempt ${retryCount + 1}/${MAX_RETRIES}, offset: ${timeOffsetRef.current}h)`);
      
      try {
        const data = await fetchWindData(bounds, null, timeOffsetRef.current, false, forecastDays, activeModel);
        
        if (cancelled) return;
        
        // Commit ONLY a renderable, non-stale grid. A failed redirect returns a 1-vector safe-zero
        // grid (renderable:false/stale:true) — committing it would CLEAR the wind heatmap. Instead
        // fall through to the retry branch and RETAIN the previous frame (the EURO-wind-clearing fix).
        if (isRenderableWindData(data)) {
          console.log(`[CACHE] [WeatherEngine] Wind data: ${data.vectors.length} vectors`);
          windRevision.current += 1;
          commitWindData(data);
          retryCount = 0; // Reset on success
          // Cross-model prewarm (DEFAULT OFF): warm the OTHER models' wind into the isolated
          // per-model cache so a subsequent model switch is an instant warm commit, not a cold fetch.
          prewarmSiblingModelWind(activeModel, bounds, timeOffsetRef.current, forecastDays, null);
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

    // WIND VIEWPORT-FINE REFETCH (2026-07-19). The always-global era never needed a move
    // listener — one grid covered the world and a 5-min timer refreshed it. With the fine tier
    // (clampViewportBbox wind branch), panning/zooming can leave the committed regional grid
    // behind, so a camera move that CHANGES THE CLAMP TILE ID re-drives the fetch. The id is
    // 1-deg-snapped, so pans inside the same snapped box are free, and the global id is a
    // constant — wide views never refetch on move (exact old behaviour). attemptFetch carries
    // its own scrub-freeze, 429-cooldown, warm-cache and in-flight dedup, so re-entry is cheap.
    // The kill switch that disables the fine tier makes the id constant again, which makes this
    // listener a structural no-op — one lever kills both halves.
    let lastWindTileId = null;
    const onWindMoveEnd = () => {
      if (cancelled || !isWindActive) return;
      try {
        const b = getBounds();
        if (!b) return;
        const tile = clampViewportBbox(b, 'wind', activeModel, 'wind').selectedTileId || '';
        const prev = lastWindTileId;
        lastWindTileId = tile;
        if (prev !== null && tile !== prev) attemptFetch();
      } catch (e) { /* the clamp must never break a move handler */ }
    };
    mapInstance.on('moveend', onWindMoveEnd);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      try { mapInstance.off('moveend', onWindMoveEnd); } catch (e) { /* map may be disposed */ }
    };
  }, [mapInstance, activeModel, forecastDays, isWindActive]); // Refetch when model or forecast window changes

  // F3: background-load the wind multi-hour series for the active model/viewport — the page
  // containing the current hour first, neighbours on idle — so far-hour scrubbing is instant
  // (the during-drag path reads getWindSeriesFrame above). Flag-gated (window.__WIND_SERIES__);
  // a no-op until enabled, so the default wind path is unchanged.
  useEffect(() => {
    if (!mapInstance || !isWindActive) return;
    let cancelled = false;
    const controller = new AbortController();
    const kick = () => {
      if (cancelled || !mapInstance) return;
      try {
        const b = mapInstance.getBounds();
        ensureWindSeries(
          activeModel,
          { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) },
          timeOffsetHours,
          controller.signal
        );
      } catch (e) { /* map not ready — ignore */ }
    };
    const t = setTimeout(kick, 600);
    const onIdle = () => kick();
    mapInstance.on('moveend', onIdle);
    // On scrub start, eagerly load EVERY page so any hour the user jumps to during a fast drag
    // is already cached (the during-drag path reads getWindSeriesFrame synchronously).
    const onScrubStart = () => {
      if (cancelled || !mapInstance) return;
      try {
        const b = mapInstance.getBounds();
        prewarmWindSeries(
          activeModel,
          { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) },
          controller.signal
        );
      } catch (e) { /* map not ready — ignore */ }
    };
    if (typeof window !== 'undefined') window.addEventListener('timeline_scrub_start', onScrubStart);
    return () => {
      cancelled = true;
      clearTimeout(t);
      controller.abort();
      try { mapInstance.off('moveend', onIdle); } catch (e) { /* ignore */ }
      if (typeof window !== 'undefined') window.removeEventListener('timeline_scrub_start', onScrubStart);
    };
    // Page is intentionally NOT a dep (mirror useMarineOrchestrator). prewarmWindSeries loads ALL
    // pages on settle + scrub-start; re-running per page crossing only ABORTS the in-flight warm via
    // the cleanup's controller.abort(), so a fast multi-page scrub perpetually killed its own wind
    // warm → the wind series never warmed → wind scrub fell to per-hour fetches. Key on
    // model/layer/map only so the warm COMPLETES and getWindSeriesFrame hits during scrub.
  }, [mapInstance, activeModel, isWindActive]);

  // On a MODEL switch (or the first wind landing) eagerly warm the NEW model's series pages —
  // mirror useMarineOrchestrator's model-switch prewarm. The scrub-start prewarm above fires only
  // on a DRAG and series pages are per-model, so a switched-to model's series stayed cold and every
  // click-jump/landed hour fell to a per-hour fetch (the model-compare "Cache miss ... Fetching
  // immediately" storm, 2026-07-10). Rapid re-switching aborts the previous model's still-queued
  // warm via the cleanup controller (prewarmWindSeries is deduped + TTL'd + capped at 2 concurrent),
  // so toggling can't pile onto the 1-CPU backend. Ref-guarded: fires on model change only — never
  // on pans or hour ticks. Kill switch: window.__RAW_WIND_MODEL_PREWARM_DISABLED__ = true
  // (scrub-start prewarm and the per-hour fallback are unchanged); __WIND_SERIES__ = false also
  // no-ops it (master series flag).
  const prevWindPrewarmModelRef = useRef(null);
  useEffect(() => {
    if (!mapInstance || !isWindActive) return;
    if (typeof window !== 'undefined' && window.__RAW_WIND_MODEL_PREWARM_DISABLED__) return;
    if (prevWindPrewarmModelRef.current === activeModel) return;
    prevWindPrewarmModelRef.current = activeModel;
    const controller = new AbortController();
    try {
      const b = mapInstance.getBounds();
      prewarmWindSeries(
        activeModel,
        { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) },
        controller.signal
      );
      if (typeof window !== 'undefined') {
        window.__WIND_MODEL_PREWARM_COUNT__ = (window.__WIND_MODEL_PREWARM_COUNT__ || 0) + 1;
      }
    } catch (e) { /* map not ready — ignore */ }
    return () => { try { controller.abort(); } catch (e) { /* ignore */ } };
  }, [activeModel, mapInstance, isWindActive]);

  // ===== TIMELINE SCRUB (local cache re-index, with FETCH ON CACHE MISS) =====
  const prevOffsetRef = useRef(timeOffsetHours);
  useEffect(() => {
    if (prevOffsetRef.current === timeOffsetHours) return;
    prevOffsetRef.current = timeOffsetHours;
    if (!mapInstance || !isWindActive) return;

    // Active drag scrub path - immediate cache-only lookup (zero network requests)
    if (window.isScrubbingTimeline) {
      let targetData = null;
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
        if (getBackendWindFlag()) {
          targetData = getModelSafeWind(activeModel, timeOffsetHours, bounds);
        } else {
          const cache = getWindHourlyCache();
          if (cache?.results?.length && cache.model === activeModel) {
            targetData = extractWindAtOffset(cache, timeOffsetHours);
          }
        }
        // F3: wind multi-hour series cache — nearest frame for the scrubbed hour, served
        // synchronously. Additive: returns null when the series flag is off or unloaded, so the
        // existing per-hour cache/fetch path is unchanged.
        if (!targetData || !(targetData.vectors?.length > 0)) {
          const seriesFrame = getWindSeriesFrame(activeModel, bounds, timeOffsetHours);
          if (seriesFrame) targetData = seriesFrame;
        }
      } catch (e) {
        // ignore
      }

      if (targetData && targetData.vectors?.length > 0) {
        windRevision.current += 1;
        commitWindData(targetData);
      }
      return;
    }

    const t = setTimeout(async () => {
      let cacheMiss = false;
      let targetData = null;
      try {
        if (getBackendWindFlag()) {
          const b = mapInstance.getBounds();
          const bounds = {
            west: b.getWest(),
            south: Math.max(-85, b.getSouth()),
            east: b.getEast(),
            north: Math.min(85, b.getNorth())
          };
          targetData = getModelSafeWind(activeModel, timeOffsetHours, bounds);
          if (!targetData) {
            cacheMiss = true;
          }
        } else {
          const cache = getWindHourlyCache();
          if (cache?.results?.length && cache.model === activeModel) {
            targetData = extractWindAtOffset(cache, timeOffsetHours);
            if (!targetData || !targetData.vectors || targetData.vectors.length === 0) {
              cacheMiss = true;
            }
          } else {
            cacheMiss = true;
          }
        }
      } catch (e) {
        cacheMiss = true;
      }

      // SERIES-FIRST SETTLE (2026-07-10, the wind "Cache miss ... Fetching immediately" storm): the
      // during-drag path serves warmed series frames (above), but this SETTLE path only consulted the
      // per-hour caches — so every hour LANDED on after a drag/jump missed and fired a per-hour network
      // fetch. Marine's settle has committed warmed series frames ("no fetch") since F3; mirror it for
      // wind. Additive: getWindSeriesFrame returns null when the series is off (__WIND_SERIES__=false
      // restores the old behavior exactly) or unloaded, falling through to the fetch unchanged.
      if (cacheMiss) {
        try {
          const b = mapInstance.getBounds();
          const bounds = {
            west: b.getWest(),
            south: Math.max(-85, b.getSouth()),
            east: b.getEast(),
            north: Math.min(85, b.getNorth())
          };
          const seriesFrame = getWindSeriesFrame(activeModel, bounds, timeOffsetHours);
          if (seriesFrame && seriesFrame.vectors?.length > 0) {
            targetData = seriesFrame;
            cacheMiss = false;
            if (typeof window !== 'undefined') {
              window.__WIND_SERIES_SETTLE_HIT__ = (window.__WIND_SERIES_SETTLE_HIT__ || 0) + 1;
            }
          }
        } catch (e) { /* fall through to the per-hour fetch */ }
      }

      // TERMINAL NO-COVERAGE skip (2026-07-10, audit queue #2 — wind analog of marine d38a693b):
      // a genuinely-terminal coverage 404 recorded by windController won't resolve by refetching
      // this run — skip the doomed per-hour fetch and keep the held frame displaying. TTL 15 min
      // (marineControllerCache); kill __RAW_DISABLE_TERMINAL_NOCOV_BYPASS__ (shared with marine).
      // Tel: __WIND_TERMINAL_NOCOV_SKIP_COUNT__.
      if (cacheMiss && isTerminalNoCoverage(activeModel, 'wind', timeOffsetHours)) {
        if (typeof window !== 'undefined') {
          window.__WIND_TERMINAL_NOCOV_SKIP_COUNT__ = (window.__WIND_TERMINAL_NOCOV_SKIP_COUNT__ || 0) + 1;
        }
        return;
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

          // F3: revalidate via the cache-aware path (was forceFetch=true). The WeatherEngine
          // caches already missed above, but fetchWindData's own WIND_CACHE may still hold this
          // exact tile/hour — let it reuse that (TTL-gated) instead of forcing a duplicate network
          // fetch, and join any in-flight request for the same target.
          const data = await fetchWindData(bounds, null, timeOffsetHours, false, forecastDays, activeModel);
          // Request-intent parity: if the user scrubbed or switched model during the async fetch,
          // this result is stale — discard it (the newer effect run owns the display) (F3).
          if (timeOffsetRef.current !== timeOffsetHours || activeModelRef.current !== activeModel) {
            console.log(`[SCRUB] [WeatherEngine] Discarding stale wind fetch (req +${timeOffsetHours}h/${activeModel}; now +${timeOffsetRef.current}h/${activeModelRef.current}).`);
            return;
          }
          if (isRenderableWindData(data)) {
            console.log(`[SCRUB] [WeatherEngine] Fetch wind grid success for hour +${timeOffsetHours}h: ${data.vectors.length} vectors`);
            windRevision.current += 1;
            commitWindData(data);
          } else if (typeof window !== 'undefined' && window.__RAW_WIND_HOLD_LAST_FRAME_DISABLED__ === true) {
            // Kill switch: restore the old clear-on-no-coverage behavior exactly.
            console.log(`[WeatherEngine] No wind forecast coverage at offset +${timeOffsetHours}h. Clearing visual.`);
            commitWindData(null);
            windRevision.current += 1;
          } else {
            // HOLD-LAST-FRAME (2026-07-10, audit queue #2 — wind analog of marine d38a693b): a
            // no-coverage or safe-zero result must not blank the wind layer mid-scrub; keep the
            // last-good frame displaying. The 1-vector safe-zero grid used to pass the old
            // vectors.length>0 guard and commit (= the "wind clears at 14 days" blank); the
            // renderable guard above now rejects it, and the terminal record in windController
            // stops the settle re-driving this hour for 15 min.
            console.log(`[WeatherEngine] No renderable wind at +${timeOffsetHours}h (${(data && data.__failureReason) || 'empty'}) — holding last frame.`);
          }
        } catch (err) {
          // F3: preserve the previous same-model frame on a fetch error — do NOT clear the visual
          // merely because a (far-hour) fetch failed/aborted. A transient error shouldn't blank wind.
          console.error('[WeatherEngine] Wind scrub fetch failed (preserving previous frame):', err.message);
        }
      } else if (targetData && targetData.vectors?.length > 0) {
        const _now = Date.now();
        if (_now - _lastScrubLogTime > 2000) {
          _lastScrubLogTime = _now;
          console.log(`[CACHE] [WeatherEngine] Timeline data: ${targetData.vectors.length} vectors at +${timeOffsetHours}h`);
        }
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
            // Renderable guard (2026-07-10, the "ICON wind heatmap cleared" report): the 1-vector
            // safe-zero fallback PASSED the old vectors.length>0 check and committed here ×5 on
            // moveend refetches of a failed far hour — the layer's renderable===false branch then
            // CLEARED the wind buffers (the same guard-class bug the settle path fixed in 06fbeef2).
            // Hold the last-good frame instead; kill __RAW_WIND_HOLD_LAST_FRAME_DISABLED__ restores.
            const _holdDisabled = typeof window !== 'undefined' && window.__RAW_WIND_HOLD_LAST_FRAME_DISABLED__ === true;
            if (isRenderableWindData(data) || (_holdDisabled && data && data.vectors?.length > 0)) {
              console.log(`[FETCH] [WeatherEngine] Viewport wind fetch success: ${data.vectors.length} vectors`);
              windRevision.current += 1;
              commitWindData(data);
            } else if (data) {
              console.log(`[WeatherEngine] Viewport refetch unrenderable (${data.__failureReason || 'empty'}) — holding last frame.`);
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
