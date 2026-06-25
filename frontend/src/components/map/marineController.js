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
//  • DEFAULT OFF — runs only when window.__MARINE_SIBLING_PREWARM__ === true (or localStorage
//    marine_sibling_prewarm === 'true'). Production behavior is unchanged until opted in.
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
  if (window.__MARINE_SIBLING_PREWARM__ === true) return true;
  try {
    if (window.localStorage && window.localStorage.getItem('marine_sibling_prewarm') === 'true') return true;
  } catch (e) { /* localStorage blocked */ }
  return false;
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

  const layerPart = _isAllVarModel(wanted) ? 'all' : wantedLayer;
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
    const layerPart = _isAllVarModel(model) ? 'all' : activeLayer;
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
