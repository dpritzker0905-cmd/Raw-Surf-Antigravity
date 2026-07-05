// marineController.js — Fetch layer for marine weather data.
// Pressure data: marineControllerPressure.js. Shared utilities: marineControllerUtils.js.

import {
  findClosestHourIndex,
  HOURLY_CACHE_TTL,
  PER_MODEL_HOUR_CACHE_TTL,
  getSnapConfig,
  isViewportInsideCachedBounds
} from './marineControllerUtils';
import {
  getBackendWeatherFlag,
  getBackendCopernicusFlag,
  getBackendIconMarineFlag,
  getBackendMarineSystemFlag,
  getSharedValidTime,
  getSurfModeFlag,
  updateDiagnostics,
  updateProjectionDiag,
  fetchBackendMarineGrid,
  clampViewportBbox
} from './backendWeatherServiceClient';
import { fetchBackendCopernicusGrid } from './backendCopernicusServiceClient';
import { recordTruthStage } from './weatherTruthTracker';

import {
  getMarineHourlyCache,
  setMarineHourlyCache,
  getLastKnownGoodMarine,
  setLastKnownGoodMarine,
  getLastKnownGoodMarineModel,
  getPerModelHourCache,
  _isAllVarModel,
  _cacheMarineResult,
  _updateDiagnosticsOnCacheHit,
  createFallbackSafeZeroGrid,
  hasTimeCoverage,
  isContainedInMarineCache
} from './marineControllerCache';

import { extractMarineAtOffset } from './marineControllerExtractor';

import { ensureMarineSeries, getMarineSeriesFrame } from './marineGridSeries';

// GLOBAL-COARSE grid prewarm (2026-07-04, the "heatmap clears 3-5s on FIRST zoom-out" root, traced):
// on zoom-out past z7 the display gate rejects the regional grid (op 0) and the GLOBAL-coarse grid
// must take over — but on a COLD cache that /grid fetch is ~5s (1-CPU backend), a long blank window
// (only ~1s once warm). Warm the ACTIVE layer's global-coarse into the SAME result cache the zoom-out
// lookup uses, WHILE the user is still zoomed in. SAFE vs the documented landmine (which COMMITTED a
// coarse grid at a zoomed-IN viewport → tripped the backstop → clear): this only CACHES via
// _cacheMarineResult under the 'global_coarse' tile key. A zoomed-IN fetchMarineData keys by the
// VIEWPORT tile (viewport_...), never global_coarse, so the cached global can only be RETRIEVED +
// committed once the viewport is wide (zoomed out) — its correct context. Bounded: deduped, skipped
// once cached, gated to zoomed-in viewports, rides the sibling-prewarm kill switch, silent (no
// truth-stage pollution). No abort signal → the background warm survives the pan/zoom that would
// otherwise cancel it (the global is location-independent, so a stray completion is harmless).
const _globalGridPrewarmInFlight = new Set();
const _GLOBAL_BOUNDS = { west: -180, south: -80, east: 180, north: 85 };

export { getBackendWindFlag, getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getBackendMarineSystemFlag } from './backendWeatherServiceClient';

// Re-export wind controller components for timeline scrubs and observers
export { fetchWindData, getWindHourlyCache, extractWindAtOffset, isContainedInWindCache, getModelSafeWind, prewarmSiblingModelWind, isRenderableWindData } from './windController';

// Re-export shared utilities for consumers that import from marineController
export { getRemainingCooldown } from './marineControllerUtils';

// Re-export pressure domain for backwards compatibility
export { fetchPressureData, extractPressureAtOffset, getPressureHourlyCache, isContainedInPressureCache } from './marineControllerPressure';

// Re-export cache/extractor functions for backwards compatibility and external imports
export {
  getMarineHourlyCache,
  isContainedInMarineCache,
  extractMarineAtOffset
};

// --- CACHE & DEDUPLICATION CONFIG ---

// Sibling-layer SERIES prewarm (instant marine layer toggles) — DEFAULT OFF (opt-in).
// After a marine layer commits, warm the OTHER component layers' regional SERIES frames into the
// client per-model-hour cache, so toggling to a sibling is an instant client-side hit via the
// orchestrator's switch instant-commit path (getModelSafeMarine) — NO round-trip, NO blank.
//
// Why SERIES (not /grid): fetchBackendMarineGrid always returns a COARSE-GLOBAL grid; the REGIONAL
// grid only exists in the grid_series path. A coarse-global frame committed at a zoomed-in viewport
// trips the render backstop → clear — the bug the first /grid prewarm attempt hit (it was a confirmed
// no-op). So we warm the sibling SERIES, read its REGIONAL current-hour frame, and cache THAT.
//
// Safe by design:
//  • DEFAULT ON (2026-06-26) — kill switch: set window.__MARINE_SIBLING_PREWARM__ === false (or
//    localStorage marine_sibling_prewarm === 'false') to disable. Held opt-in until the zoom-out
//    coverage/clamp blocker was resolved (54e289b5 + SWR revalidation); live A/B 2026-06-25 verified
//    instant toggles + 0 engine clears at stable zoom. The other guards below still bound the load.
//  • REGIONAL GUARD — only at a zoomed-in viewport (span ≤ 15°, mirrors the switch path's
//    !zoomedOut gate). At global/coarse we skip (global toggles already hit the manifest cache).
//  • REGIONAL-ONLY WRITE — only caches a frame whose grid width < 340° (never a coarse-global one),
//    so a sibling toggle can never commit a coarse-global grid at a regional viewport.
//  • LAYER-ISOLATED — writes only the layer-keyed _perModelHourCache via _cacheMarineResult (it does
//    NOT touch marineHourlyCache.__layerKey/lastKnownGood), so a sibling write never clobbers the
//    active layer's cache view; silent=true skips the GFS-waves-h0 truth-stage (no diag pollution).
//  • BOUNDED — ensureMarineSeries is deduped + TTL'd + capped at 2 concurrent grid_series fetches
//    and aborts with the active signal; skipped during scrub; per-(model,hour,layer) in-flight dedup.
const _siblingPrewarmInFlight = new Set();

function isMarineSiblingPrewarmEnabled() {
  if (typeof window === 'undefined') return false;
  // Kill switch (explicit opt-OUT): a window flag or localStorage value of false disables prewarm.
  if (window.__MARINE_SIBLING_PREWARM__ === false) return false;
  try {
    if (window.localStorage && window.localStorage.getItem('marine_sibling_prewarm') === 'false') return false;
  } catch (e) { /* localStorage blocked */ }
  return true; // DEFAULT ON (2026-06-26) — zoom-out clamp blocker resolved; see comment above.
}

export function prewarmSiblingMarineSeries(model, hourOffset, bounds, activeLayer, signal) {
  try {
    if (!isMarineSiblingPrewarmEnabled()) return;
    if (typeof window !== 'undefined' && window.isScrubbingTimeline) return; // don't compete with scrub
    if (!bounds || bounds.east === undefined || bounds.north === undefined) return;
    // Regional viewport only (series frames are regional). Mirrors the switch instant-commit gate.
    const vw = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
    const vh = Math.abs(bounds.north - bounds.south);
    if (vw > 15 || vh > 15) return;
    const siblings = (model === 'ICON')
      ? ['waves', 'swell_1', 'wind_waves']               // ICON has no native secondary swell
      : ['waves', 'swell_1', 'swell_2', 'wind_waves'];
    for (const lyr of siblings) {
      if (lyr === activeLayer) continue;
      const key = `${model}_${hourOffset}_${lyr}`;
      if (_siblingPrewarmInFlight.has(key)) continue;
      // Already warm REGIONAL client-side? Don't refetch the series.
      const cached = getModelSafeMarine(model, hourOffset, lyr, bounds);
      if (cached && cached.grid && cached.grid.__renderable !== false && !cached.__staleHour) {
        const cb = cached.grid.bounds;
        const cw = cb ? ((cb.east < cb.west) ? (cb.east + 360) - cb.west : cb.east - cb.west) : 999;
        if (cw < 340) continue;
      }
      _siblingPrewarmInFlight.add(key);
      Promise.resolve()
        .then(() => ensureMarineSeries(model, lyr, bounds, hourOffset, signal, true /* currentPageOnly */))
        .then(() => {
          if (signal && signal.aborted) return;
          const frame = getMarineSeriesFrame(model, lyr, bounds, hourOffset);
          const fg = frame && frame.grid;
          if (!fg || !Array.isArray(fg.vectors) || fg.vectors.length === 0) return;
          const fb = fg.bounds;
          const fw = fb ? ((fb.east < fb.west) ? (fb.east + 360) - fb.west : fb.east - fb.west) : 999;
          if (fw >= 340) return; // never cache a coarse-global frame at a regional viewport
          _cacheMarineResult(model, hourOffset, frame, lyr, true /* silent: no truth-stage pollution */);
        })
        .catch(() => { /* best-effort: miss/abort is fine, the toggle still works per-layer */ })
        .finally(() => { _siblingPrewarmInFlight.delete(key); });
    }
  } catch (e) { /* never let prewarm break the active fetch */ }
}

// ZOOM-OUT ANTICIPATION prewarm (2026-07-05, the "~1s before animations unclamp and expand on a fast
// zoom-out"): the moveend-driven fetch only STARTS after the gesture ends, so the wider view waits a
// full network round-trip before the grid expands. Fire this the moment a zoom-out gesture is detected
// (WebGLMarineLayer 'zoom' listener): it warms a ~2.5×-span grid for the SAME center into the marine
// result cache — the post-gesture lookup then serves it via the containment fallback (19e9d7c0) and
// commits near-instantly. Spans that would exceed the 15° mid-band delegate to the global prewarm.
// Fire-and-forget, dedup'd, silent. Kill switch rides the sibling-prewarm master switch.
const _zoomOutPrewarmInFlight = new Set();
export function prewarmZoomOutMarineGrid(model, hourOffset, bounds, activeLayer) {
  try {
    if (!isMarineSiblingPrewarmEnabled()) return;
    if (typeof window !== 'undefined' && window.isScrubbingTimeline) return;
    if (!bounds || bounds.east === undefined || bounds.north === undefined) return;
    const cLng = (bounds.west + bounds.east) / 2;
    const cLat = (bounds.south + bounds.north) / 2;
    const spanLng = bounds.east - bounds.west;
    const spanLat = bounds.north - bounds.south;
    const span = Math.max(spanLng, spanLat) * 2.5;
    if (span > 15.0) { prewarmGlobalMarineGrid(model, hourOffset, bounds, activeLayer); return; }
    const exp = {
      west: Math.max(-180, cLng - span / 2), east: Math.min(180, cLng + span / 2),
      south: Math.max(-80, cLat - span / 2), north: Math.min(85, cLat + span / 2)
    };
    const m = model || 'GFS';
    const key = `${m}_${hourOffset}_${activeLayer}_ZO_${exp.west.toFixed(0)}_${exp.south.toFixed(0)}`;
    if (_zoomOutPrewarmInFlight.has(key)) return;
    _zoomOutPrewarmInFlight.add(key);
    Promise.resolve()
      .then(() => fetchBackendMarineGrid(exp, hourOffset, undefined, exp, activeLayer, m))
      .then((result) => {
        const g = result && result.grid;
        if (g && Array.isArray(g.vectors) && g.vectors.length > 0) {
          _cacheMarineResult(m, hourOffset, result, activeLayer, true /* silent */);
        }
      })
      .catch(() => { /* best-effort */ })
      .finally(() => { _zoomOutPrewarmInFlight.delete(key); });
  } catch (e) { /* never break the active path */ }
}

export function prewarmGlobalMarineGrid(model, hourOffset, bounds, activeLayer) {
  try {
    if (!isMarineSiblingPrewarmEnabled()) return;
    if (typeof window !== 'undefined' && window.isScrubbingTimeline) return;
    if (!bounds || bounds.east === undefined || bounds.north === undefined) return;
    // Only while ZOOMED IN (regional viewport ≤ 15°) — that's when a zoom-out is the next likely
    // gesture and the global is cold. At a wide viewport we already hold or are actively fetching it.
    const vw = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
    const vh = Math.abs(bounds.north - bounds.south);
    if (vw > 15 || vh > 15) return;
    const m = model || 'GFS';
    const key = `${m}_${hourOffset}_${activeLayer}_GLOBALGRID`;
    if (_globalGridPrewarmInFlight.has(key)) return;
    // Already have the global-coarse cached (from a prior zoom-out or prewarm)? Nothing to do.
    const cached = getModelSafeMarine(m, hourOffset, activeLayer, _GLOBAL_BOUNDS);
    if (cached && cached.grid && Array.isArray(cached.grid.vectors) && cached.grid.vectors.length > 0) {
      const cb = cached.grid.bounds;
      const cw = cb ? ((cb.east < cb.west) ? (cb.east + 360) - cb.west : cb.east - cb.west) : 0;
      if (cw >= 340) return; // a global-width frame is cached → warm
    }
    _globalGridPrewarmInFlight.add(key);
    // No abort signal: this is a background best-effort warm that must survive the pan/zoom which
    // would otherwise cancel it. The global-coarse is location-independent, so it warms once and
    // serves every subsequent zoom-out.
    Promise.resolve()
      .then(() => (m === 'ICON')
        ? fetchBackendMarineGrid(_GLOBAL_BOUNDS, hourOffset, undefined, _GLOBAL_BOUNDS, activeLayer, 'ICON')
        : fetchBackendMarineGrid(_GLOBAL_BOUNDS, hourOffset, undefined, _GLOBAL_BOUNDS, activeLayer))
      .then((result) => {
        const g = result && result.grid;
        if (g && Array.isArray(g.vectors) && g.vectors.length > 0) {
          _cacheMarineResult(m, hourOffset, result, activeLayer, true /* silent: no truth-stage pollution */);
          // COARSE-BASE SEED (2026-07-04, Part 2 of the z7 zoom-out bridge): a COLD coast (fresh session
          // straight to a coast, never zoomed out) never commits a coarse grid → engine._coarseBaseData is
          // empty → the zoom-out bridge can't engage. Stage the prewarmed global (tagged for blend match) so
          // the ENGINE snapshots it into the bridge base at its next render (proper render-loop GL timing —
          // never do GL work in this detached callback). Kill: __RAW_DISABLE_COARSE_BRIDGE__.
          try {
            const eng = (typeof window !== 'undefined') && window.__MARINE_ENGINE__;
            if (eng && !eng._coarseBaseData && !eng._pendingCoarseBaseGrid &&
                (typeof window === 'undefined' || window.__RAW_DISABLE_COARSE_BRIDGE__ !== true)) {
              if (!g.__sourceModel) g.__sourceModel = m;
              if (!g.__componentLayer) g.__componentLayer = activeLayer;
              eng._pendingCoarseBaseGrid = g;
            }
          } catch (e) { /* seed is best-effort */ }
        }
      })
      .catch(() => { /* best-effort: a cold zoom-out just falls back to the live fetch */ })
      .finally(() => { _globalGridPrewarmInFlight.delete(key); });
  } catch (e) { /* never let prewarm break the active fetch */ }
}

/** getModelSafeMarine - returns safe model cached results */
export function getModelSafeMarine(requestedModel, requestedHourOffset, requestedLayer, bounds = null) {
  const wanted = requestedModel || 'GFS', wantedLayer = requestedLayer || 'waves', wantedHour = requestedHourOffset !== undefined ? requestedHourOffset : 0;
  let hitData = null, cacheSource = 'none', staleHour = false, returnedHour = null;
  const marineHourlyCache = getMarineHourlyCache();
  const cacheLayerKey = marineHourlyCache?.__layerKey || 'all';
  const isCacheMatch = cacheLayerKey === 'all' || cacheLayerKey === wantedLayer;
  
  const isGfsBackend = getBackendWeatherFlag() && (wanted === 'GFS' || !wanted);
  const isIconBackend = getBackendIconMarineFlag() && wanted === 'ICON';
  const isCopernicusBackend = getBackendCopernicusFlag() && wanted === 'EURO';
  const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

  const _perModelHourCache = getPerModelHourCache();

  // SURF-MODE IDENTITY (2026-07-03): the per-model-hour cache key must carry the Swell↔Surf mode —
  // surf-banded and plain products for the same tile+hour are DIFFERENT fields (open ocean
  // is_valid:false in surf mode), and a cross-mode cache hit committed the other mode's frame
  // (the plain/surf frame-mixing family). Folded into layerPart so every key template AND the
  // prefix-scan fallbacks inherit it.
  const layerPart = (_isAllVarModel(wanted) ? 'all' : wantedLayer) + (getSurfModeFlag() ? '~surf' : '');
  let exact = null;
  if (bounds) {
    const clampRes = clampViewportBbox(bounds, wantedLayer, wanted, 'marine');
    const tileId = clampRes.selectedTileId || 'outside';
    exact = _perModelHourCache.get(`${wanted}_${layerPart}_${tileId}_${wantedHour}`);
    if (exact && Date.now() - exact.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
      const sig = exact.signature;
      if (sig) {
        const g = exact.data?.grid || {};
        const b = g.bounds || {};
        const bStr = b.west !== undefined ? `${b.west.toFixed(2)}:${b.south.toFixed(2)}:${b.east.toFixed(2)}:${b.north.toFixed(2)}` : 'none';
        const provider = g.__gridProvider || g.provider || 'none';

        if (sig.model === wanted &&
            sig.layer === wantedLayer &&
            sig.provider === provider &&
            sig.hourOffset === wantedHour &&
            sig.boundsStr === bStr &&
            sig.cols === (g.cols || 0) &&
            sig.rows === (g.rows || 0) &&
            sig.vectorsLength === (g.vectors?.length || 0)) {
          hitData = exact.data;
          cacheSource = 'per_model_hour_cache_exact';
        }
      } else if (!isBackendActive) {
        hitData = exact.data;
        cacheSource = 'per_model_hour_cache_exact';
      }
    }

    if (!hitData) {
      // Fallback search: check if any cached entry in _perModelHourCache contains these bounds
      for (const [key, entry] of _perModelHourCache.entries()) {
        if (key.startsWith(`${wanted}_${layerPart}_`) && key.endsWith(`_${wantedHour}`) && Date.now() - entry.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
          const g = entry.data?.grid;
          if (g?.vectors?.length > 0 && g.bounds) {
            const ew = bounds.west, ee = bounds.east, es = bounds.south, en = bounds.north;
            const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
            const containsLng = ge < gw 
              ? (ew >= gw || ew <= ge) && (ee >= gw || ee <= ge)
              : ew >= gw && ee <= ge;
            const containsLat = es >= gs && en <= gn;

            if (containsLng && containsLat) {
              const sig = entry.signature;
              if (sig) {
                const bStr = g.bounds.west !== undefined ? `${g.bounds.west.toFixed(2)}:${g.bounds.south.toFixed(2)}:${g.bounds.east.toFixed(2)}:${g.bounds.north.toFixed(2)}` : 'none';
                const provider = g.__gridProvider || g.provider || 'none';

                if (sig.model === wanted &&
                    sig.layer === wantedLayer &&
                    sig.provider === provider &&
                    sig.hourOffset === wantedHour &&
                    sig.boundsStr === bStr &&
                    sig.cols === (g.cols || 0) &&
                    sig.rows === (g.rows || 0) &&
                    sig.vectorsLength === (g.vectors?.length || 0)) {
                  hitData = entry.data;
                  cacheSource = 'per_model_hour_cache_contained';
                  break;
                }
              } else if (!isBackendActive) {
                hitData = entry.data;
                cacheSource = 'per_model_hour_cache_contained';
                break;
              }
            }
          }
        }
      }
    }
  } else {
    const suffix = `_${wantedHour}`;
    const prefix = `${wanted}_${layerPart}_`;
    for (const [k, v] of _perModelHourCache.entries()) {
      if (k.startsWith(prefix) && k.endsWith(suffix) && Date.now() - v.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
        const sig = v.signature;
        if (sig) {
          const g = v.data?.grid || {};
          const b = g.bounds || {};
          const bStr = b.west !== undefined ? `${b.west.toFixed(2)}:${b.south.toFixed(2)}:${b.east.toFixed(2)}:${b.north.toFixed(2)}` : 'none';
          const provider = g.__gridProvider || g.provider || 'none';

          if (sig.model === wanted &&
              sig.layer === wantedLayer &&
              sig.provider === provider &&
              sig.hourOffset === wantedHour &&
              sig.boundsStr === bStr &&
              sig.cols === (g.cols || 0) &&
              sig.rows === (g.rows || 0) &&
              sig.vectorsLength === (g.vectors?.length || 0)) {
            hitData = v.data;
            cacheSource = 'per_model_hour_cache_prefix';
            break;
          }
        } else if (!isBackendActive) {
          hitData = v.data;
          cacheSource = 'per_model_hour_cache_prefix';
          break;
        }
      }
    }
  }

  // Fallback to raw_hourly_cache if still no data found
  if (!hitData && _isAllVarModel(wanted) && marineHourlyCache?.results?.length && marineHourlyCache.model === wanted && isCacheMatch) {
    let boundsOk = true;
    if (bounds) {
      const isGlobalCached = !!marineHourlyCache.isGlobal;
      const isGlobalViewport = Math.abs(bounds.east - bounds.west) > 180 || Math.abs(bounds.north - bounds.south) > 90;
      if (isGlobalCached !== isGlobalViewport) {
        boundsOk = false;
      } else if (marineHourlyCache.bounds) {
        boundsOk = isViewportInsideCachedBounds(bounds, marineHourlyCache.bounds);
      } else {
        boundsOk = false;
      }
    }
    if (boundsOk) {
      try {
        const reExtracted = extractMarineAtOffset(marineHourlyCache, wantedHour, wantedLayer);
        if (reExtracted?.grid?.vectors?.length > 0) {
          hitData = reExtracted;
          cacheSource = 'raw_hourly_cache';
        }
      } catch (e) {}
    }
  }

  // Fallback to nearest cached hour in perModelHourCache
  if (!hitData && !_isAllVarModel(wanted)) {
    const prefix = `${wanted}_${wantedLayer}_`;
    let bestEntry = null, bestDiff = Infinity;
    for (const [key, entry] of _perModelHourCache.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (Date.now() - entry.timestamp >= PER_MODEL_HOUR_CACHE_TTL) continue;
      const cachedHour = parseInt(key.substring(prefix.length), 10);
      const diff = Math.abs(cachedHour - wantedHour);
      if (diff < bestDiff && diff <= 6) { bestDiff = diff; bestEntry = entry; }
    }
    if (bestEntry) {
      hitData = { ...bestEntry.data, __staleHour: true, __originalHour: bestEntry.data.hourOffset };
      staleHour = true; cacheSource = 'per_model_hour_cache_nearest';
    }
  }

  // Fallback to last known good marine
  const lastKnownGoodMarine = getLastKnownGoodMarine();
  const lastKnownGoodMarineModel = getLastKnownGoodMarineModel();
  if (!hitData && lastKnownGoodMarine && (lastKnownGoodMarineModel || 'GFS') === wanted && (lastKnownGoodMarine?.grid?.__componentLayer || 'waves') === wantedLayer) {
    const cachedProvider = lastKnownGoodMarine.__provider || lastKnownGoodMarine?.grid?.provider || 'open-meteo';
    if (cachedProvider === 'open-meteo' || cachedProvider === 'estimated' || cachedProvider === 'backend-weather-service' || cachedProvider === 'test-fixture') {
      let boundsOk = true;
      if (bounds && lastKnownGoodMarine.grid?.bounds) {
        const isGlobalCached = Math.abs(lastKnownGoodMarine.grid.bounds.east - lastKnownGoodMarine.grid.bounds.west) >= 350;
        const isGlobalViewport = Math.abs(bounds.east - bounds.west) > 180 || Math.abs(bounds.north - bounds.south) > 90;
        if (isGlobalCached !== isGlobalViewport) {
          boundsOk = false;
        } else {
          boundsOk = isViewportInsideCachedBounds(bounds, lastKnownGoodMarine.grid.bounds);
        }
      }
      if (boundsOk) {
        const diff = Math.abs((lastKnownGoodMarine.hourOffset || 0) - wantedHour);
        if (diff <= 6) {
          hitData = { ...lastKnownGoodMarine };
          if (diff > 0) { hitData.__staleHour = true; hitData.__originalHour = lastKnownGoodMarine.hourOffset; staleHour = true; }
          cacheSource = 'last_known_good';
        }
      }
    }
  }
  if (hitData) {
    const gotModel = hitData.__sourceModel || hitData.grid?.__sourceModel || 'GFS';
    const gotLayer = hitData.grid?.__componentLayer || 'waves';
    returnedHour = hitData.hourOffset !== undefined ? hitData.hourOffset : wantedHour;
    if (gotModel !== wanted || gotLayer !== wantedLayer) {
      console.warn(`[Safe Cache] Mismatch! Wanted ${wanted}/${wantedLayer}, got ${gotModel}/${gotLayer}`);
      hitData = null;
    } else if (Math.abs(returnedHour - wantedHour) > 6) {
      console.warn(`[Safe Cache] Hour delta ${Math.abs(returnedHour - wantedHour)}h > 6h, rejected.`);
      hitData = null;
    }

    if (hitData && typeof window !== 'undefined') {
      _updateDiagnosticsOnCacheHit(hitData, wanted, returnedHour, wantedLayer, bounds);
    }
  }
  if (hitData && wanted === 'GFS' && wantedLayer === 'waves' && wantedHour === 0) {
    try {
      const isRaw = !!hitData.results;
      const timeArray = isRaw ? hitData.results?.[0]?.hourly?.time : null;
      const targetMs = Date.now() + wantedHour * 3600000;
      const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
      const validTimeStr = timeArray?.[idx]
        ? new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').toISOString().replace(/\.\d{3}/, '')
        : (hitData.validTime || hitData.valid_time || new Date().toISOString().replace(/\.\d{3}/, ''));

      const extractedGrid = isRaw 
        ? extractMarineAtOffset(hitData, wantedHour, wantedLayer)?.grid 
        : hitData.grid;

      recordTruthStage('cacheRead', {
        model: wanted,
        domain: 'marine',
        layer: wantedLayer,
        valid_time: validTimeStr,
        run_time: hitData.run_time || hitData.runTime || hitData.grid?.run_time || hitData.grid?.runTime,
        product_id: hitData.product_id || hitData.productId || hitData.grid?.productId || null,
        is_dynamic_viewport_product: hitData.is_dynamic_viewport_product || hitData.grid?.is_dynamic_viewport_product || false,
        coverage_scope: hitData.coverage_scope || hitData.grid?.coverage_scope || null,
        requested_bbox: hitData.requested_bbox || hitData.grid?.requested_bbox || null,
        served_bbox: hitData.served_bbox || hitData.grid?.served_bbox || null,
        grid: extractedGrid,
        truthTag: hitData.truthTag || hitData.grid?.truthTag || null
      }, 'marineController.js', 'getModelSafeMarine');
    } catch (e) {
      console.warn('[Truth Tracker] Failed to record cacheRead truth stage:', e.message);
    }
  }

  // Serve-coverage diagnostic: which cache path served, and does the served grid COVER the viewport?
  // coversViewport:false at a regional viewport is the heatmap-CLAMP signature (a sub-viewport grid).
  if (hitData && typeof window !== 'undefined' && bounds) {
    try {
      const g = hitData.grid;
      const gb = g && g.bounds;
      let covers = null, gw = null;
      if (gb && gb.west !== undefined) {
        gw = (gb.east < gb.west) ? (gb.east + 360 - gb.west) : (gb.east - gb.west);
        covers = gb.west <= bounds.west + 1e-6 && gb.east >= bounds.east - 1e-6 &&
                 gb.south <= bounds.south + 1e-6 && gb.north >= bounds.north - 1e-6;
      }
      window.__MARINE_SERVE_DIAG__ = {
        cacheSource, model: wanted, layer: wantedLayer, hour: wantedHour,
        gridWidth: gw, coversViewport: covers,
        gridBounds: gb && gb.west !== undefined ? { w: gb.west, s: gb.south, e: gb.east, n: gb.north } : null,
        viewport: { w: bounds.west, s: bounds.south, e: bounds.east, n: bounds.north },
        ts: Date.now()
      };
    } catch (e) { /* diag must not break the serve */ }
  }

  return hitData;
}

export async function fetchMarineData(bounds, zoom, signal, hourOffset = 0, forceFetch = false, model = null, activeLayer = 'waves', isPrefetch = false) {
  if (!bounds) return getModelSafeMarine(model, hourOffset, activeLayer);

  let west = bounds.west, east = bounds.east;
  if (east < west) east += 360;

  const { snap, padding } = getSnapConfig(bounds);
  let latMin = Math.max(-80, Math.min(84.5, Math.floor((bounds.south - padding) / snap) * snap));
  let latMax = Math.max(-79.5, Math.min(85, Math.ceil((bounds.north + padding) / snap) * snap));
  if (latMax <= latMin) { latMin = -80; latMax = 85; }
  const snappedBounds = { west: Math.floor((west - padding) / snap) * snap, south: latMin, east: Math.ceil((east + padding) / snap) * snap, north: latMax };

  const clampRes = clampViewportBbox(bounds, activeLayer, model, 'marine');
  const resolvedBounds = clampRes.isInside && clampRes.clampedBbox ? clampRes.clampedBbox : bounds;

  const _perModelHourCache = getPerModelHourCache();

  if (!forceFetch) {
    // Mode-keyed like getModelSafeMarine (surf/plain frames must never cross-hit).
    const layerPart = (_isAllVarModel(model) ? 'all' : activeLayer) + (getSurfModeFlag() ? '~surf' : '');
    const tileId = clampRes.selectedTileId || 'outside';
    const exact = _perModelHourCache.get(`${model || 'GFS'}_${layerPart}_${tileId}_${hourOffset}`);
    if (exact && Date.now() - exact.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
      if (exact.data?.stale || exact.data?.grid?.stale) {
        // Bypass stale cached preview to allow fresh fetch
      } else {
        const sig = exact.signature;
        if (sig) {
          const g = exact.data?.grid || {};
          const b = g.bounds || {};
          const bStr = b.west !== undefined ? `${b.west.toFixed(2)}:${b.south.toFixed(2)}:${b.east.toFixed(2)}:${b.north.toFixed(2)}` : 'none';
          const provider = g.__gridProvider || g.provider || 'none';

          if (sig.model === (model || 'GFS') &&
              sig.layer === activeLayer &&
              sig.provider === provider &&
              sig.hourOffset === hourOffset &&
              sig.boundsStr === bStr &&
              sig.cols === (g.cols || 0) &&
              sig.rows === (g.rows || 0) &&
              sig.vectorsLength === (g.vectors?.length || 0)) {
            _updateDiagnosticsOnCacheHit(exact.data, model || 'GFS', hourOffset, activeLayer, bounds);
            return exact.data;
          }
        }
      }
    }

    for (const [key, entry] of _perModelHourCache.entries()) {
      if (key.startsWith(`${model || 'GFS'}_${layerPart}_`) && key.endsWith(`_${hourOffset}`) && Date.now() - entry.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
        if (entry.data?.stale || entry.data?.grid?.stale) {
          continue;
        }
        const g = entry.data?.grid;
        if (g?.vectors?.length > 0 && g.bounds) {
          const ew = resolvedBounds.west, ee = resolvedBounds.east, es = bounds.south, en = bounds.north;
          const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
          // NEVER serve a coarse-GLOBAL cache entry at a ZOOMED-IN viewport (2026-07-04): the global
          // grid (bounds ±180) CONTAINS every regional viewport, so this containment fallback would
          // return it whenever a global entry is cached (after any zoom-out, or the global-coarse
          // prewarm) — leaving the map stuck on 10°/cell at z9 instead of fetching the fine tile. The
          // exact-key path above still serves the global when the request itself RESOLVED to
          // 'global_coarse' (i.e. genuinely zoomed out). Skip global entries only when this request
          // is for a regional tile → force the fresh fine-tile fetch (the backend returns global
          // anyway where no fine product exists, so coverage is never lost).
          const gwid = (ge < gw) ? (ge + 360 - gw) : (ge - gw);
          if (gwid >= 340 && clampRes.selectedTileId !== 'global_coarse') continue;
          const containsLng = ge < gw
            ? (ew >= gw || ew <= ge) && (ee >= gw || ee <= ge)
            : ew >= gw && ee <= ge;
          const containsLat = es >= gs && en <= gn;

          if (containsLng && containsLat) {
            const sig = entry.signature;
            if (sig) {
              const bStr = g.bounds.west !== undefined ? `${g.bounds.west.toFixed(2)}:${g.bounds.south.toFixed(2)}:${g.bounds.east.toFixed(2)}:${g.bounds.north.toFixed(2)}` : 'none';
              const provider = g.__gridProvider || g.provider || 'none';

              if (sig.model === (model || 'GFS') &&
                  sig.layer === activeLayer &&
                  sig.provider === provider &&
                  sig.hourOffset === hourOffset &&
                  sig.boundsStr === bStr &&
                  sig.cols === (g.cols || 0) &&
                  sig.rows === (g.rows || 0) &&
                  sig.vectorsLength === (g.vectors?.length || 0)) {
                _updateDiagnosticsOnCacheHit(entry.data, model || 'GFS', hourOffset, activeLayer, bounds);
                return entry.data;
              }
            }
          }
        }
      }
    }
  }

  // Preserve the SPECIFIC failure reason from the last redirect attempt (e.g.
  // 'no_copernicus_coverage') so the safe-zero grid below carries it. Genericizing it to
  // 'backend_fetch_failed' hid terminal no-coverage from the SWR layer, which then retried a
  // doomed fetch 3× (the EURO 404 churn). Abort errors rethrow above and never reach here.
  let lastRedirectFailureReason = null;

  // --- GFS BACKEND SERVICE REDIRECT ---
  if (getBackendWeatherFlag() && (model === 'GFS' || !model) && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves')) {
    try {
      const result = await fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, activeLayer);
      _cacheMarineResult('GFS', hourOffset, result, activeLayer);
      prewarmSiblingMarineSeries('GFS', hourOffset, bounds, activeLayer, signal);
      prewarmGlobalMarineGrid('GFS', hourOffset, bounds, activeLayer);
      return result;
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort')) {
        throw err;
      }
      lastRedirectFailureReason = err.message;
      console.warn(`[Backend Weather Service] Grid redirect failed for GFS ${activeLayer}: ${err.message}.`);
    }
  }

  // --- COPERNICUS BACKEND SERVICE REDIRECT ---
  if (getBackendCopernicusFlag() && model === 'EURO' && (activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves' || activeLayer === 'waves')) {
    try {
      const result = await fetchBackendCopernicusGrid(bounds, hourOffset, signal, snappedBounds, "controller", activeLayer);
      _cacheMarineResult('EURO', hourOffset, result, activeLayer);
      return result;
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort')) {
        throw err;
      }
      lastRedirectFailureReason = err.message;
      console.warn(`[Backend Weather Service] Grid redirect failed for Copernicus ${activeLayer}: ${err.message}.`);
    }
  }
  if (getBackendIconMarineFlag() && model === 'ICON' && (activeLayer === 'waves' || activeLayer === 'swell_1' || activeLayer === 'swell_2' || activeLayer === 'wind_waves')) {
    try {
      const result = await fetchBackendMarineGrid(bounds, hourOffset, signal, snappedBounds, activeLayer, 'ICON');
      _cacheMarineResult('ICON', hourOffset, result, activeLayer);
      prewarmSiblingMarineSeries('ICON', hourOffset, bounds, activeLayer, signal);
      prewarmGlobalMarineGrid('ICON', hourOffset, bounds, activeLayer);
      return result;
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort')) {
        throw err;
      }
      lastRedirectFailureReason = err.message;
      console.warn(`[Backend Weather Service] Grid redirect failed for ICON ${activeLayer}: ${err.message}.`);
    }
  }

  console.warn(`[Fallback] Backend redirects failed for model=${model || 'GFS'}, layer=${activeLayer || 'waves'}, hour=${hourOffset}. Returning conformed safe zero grid.`);
  return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, lastRedirectFailureReason || 'backend_fetch_failed');
}
