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
  recordTerminalNoCoverage,
  hasTimeCoverage,
  isContainedInMarineCache
} from './marineControllerCache';

import { extractMarineAtOffset } from './marineControllerExtractor';

import { ensureMarineSeries, getMarineSeriesFrame } from './marineGridSeries';
import { publishServeDiag } from './marineServeDiag';
import { prewarmGlobalMarineGrid, _rewarmWashBaseIfStale, registerPrewarmDeps } from './marineGlobalPrewarm';

// The GLOBAL-coarse prewarm and the coarse-bridge seed moved to marineGlobalPrewarm.js on 2026-08-11
// (cut 2 of the 3-cut split that holds this file under the 800 LOC ratchet). They are RE-EXPORTED
// here so every existing call site and test still imports them from marineController.
export { prewarmGlobalMarineGrid, _stageCoarseBridgeSeed, _coarseBaseMatches } from './marineGlobalPrewarm';

// One-way dependency injection, NOT an import back: that module needs three things declared in this
// one, and importing marineController from there would close a cycle on a live fetch path. Function
// declarations hoist, so getModelSafeMarine and isMarineSiblingPrewarmEnabled are both initialized
// when this runs; _cacheMarineResult is an import binding from marineControllerCache, which does not
// import this module. Until this call runs the prewarm fails soft (returns) rather than throwing.
registerPrewarmDeps({
  getModelSafeMarine,
  cacheMarineResult: _cacheMarineResult,
  isSiblingPrewarmEnabled: isMarineSiblingPrewarmEnabled
});

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

// Sibling-layer SERIES prewarm -- rationale relocated 2026-08-11 to keep marineController under the 800
// LOC ratchet (it was 853). NOTHING WAS DELETED: the full reasoning, verbatim, is in
// docs/research/FINDING-2026-08-11-marineController-rationale.md#sibling-prewarm
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

/** getModelSafeMarine - returns safe model cached results */
export function getModelSafeMarine(requestedModel, requestedHourOffset, requestedLayer, bounds = null, options = {}) {
  const wanted = requestedModel || 'GFS', wantedLayer = requestedLayer || 'waves', wantedHour = requestedHourOffset !== undefined ? requestedHourOffset : 0;
  // A world-coarse grid is intentionally not an ordinary zoomed-in cache fallback: it masks a
  // regional revalidation. The 429 cooldown caller is different—it has no network path and its
  // own coverage guard—so it may explicitly retain a covering world grid instead of blanking.
  const allowGlobalCoarseFallback = options?.allowGlobalCoarseFallback === true;
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
      const disableGlobalSkip = typeof window !== 'undefined' && window.__RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__ === true;

      // INSERTION ORDER DECIDED THE FIELD -- rationale relocated 2026-08-11 to keep marineController under the 800
      // LOC ratchet (it was 853). NOTHING WAS DELETED: the full reasoning, verbatim, is in
      // docs/research/FINDING-2026-08-11-marineController-rationale.md#insertion-order
      const _tightestOff = typeof window !== 'undefined' && window.__RAW_DISABLE_TIGHTEST_CONTAINED__ === true;
      const _areaOf = (b) => {
        const w = (b.east < b.west) ? (b.east + 360) - b.west : (b.east - b.west);
        return Math.max(1e-4, w) * Math.max(1e-4, Math.abs(b.north - b.south));
      };
      let _bestEntry = null, _bestKey = null, _bestArea = Infinity, _bestWidth = Infinity, _candidates = 0;
      for (const [key, entry] of _perModelHourCache.entries()) {
        if (key.startsWith(`${wanted}_${layerPart}_`) && key.endsWith(`_${wantedHour}`) && Date.now() - entry.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
          const g = entry.data?.grid;
          if (g?.vectors?.length > 0 && g.bounds) {
            // DEBT-CACHE-03: Avoid committing world-coarse grids (gwid >= 340) as safe-cache at zoomed-in viewports
            const gwid = Math.abs(g.bounds.east - g.bounds.west);
            if (!disableGlobalSkip && !allowGlobalCoarseFallback && (gwid >= 340 || key.includes('global_coarse'))) {
              const reqWidth = Math.abs(bounds.east - bounds.west);
              if (reqWidth < 100) {
                continue; // Skip global grid fallback for zoomed-in requests
              }
            }
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
                  if (_tightestOff) {
                    hitData = entry.data;
                    cacheSource = 'per_model_hour_cache_contained';
                    break;
                  }
                  _candidates++;
                  const _a = _areaOf(g.bounds);
                  if (_a < _bestArea || (_a === _bestArea && (_bestKey === null || key < _bestKey))) {
                    _bestArea = _a; _bestEntry = entry; _bestKey = key;
                    _bestWidth = (ge < gw) ? (ge + 360 - gw) : (ge - gw);
                  }
                }
              } else if (!isBackendActive) {
                if (_tightestOff) {
                  hitData = entry.data;
                  cacheSource = 'per_model_hour_cache_contained';
                  break;
                }
                _candidates++;
                const _a2 = _areaOf(g.bounds);
                if (_a2 < _bestArea || (_a2 === _bestArea && (_bestKey === null || key < _bestKey))) {
                  _bestArea = _a2; _bestEntry = entry; _bestKey = key;
                  _bestWidth = (ge < gw) ? (ge + 360 - gw) : (ge - gw);
                }
              }
            }
          }
        }
      }

      // Commit the TIGHTEST containing candidate (deterministic regardless of insertion order).
      if (!hitData && _bestEntry) {
        hitData = _bestEntry.data;
        cacheSource = 'per_model_hour_cache_contained';
      }
      // Proof surface: how many entries were servable, and which extent actually won.
      if (typeof window !== 'undefined' && _candidates > 0) {
        window.__MARINE_CONTAINED_PICK__ = {
          model: wanted, layer: wantedLayer, hour: wantedHour,
          candidates: _candidates,
          chosenKey: _bestKey,
          chosenWidthDeg: _bestWidth === Infinity ? null : Math.round(_bestWidth * 1000) / 1000,
          mode: _tightestOff ? 'legacy_first_wins' : 'tightest',
          at: new Date().toISOString()
        };
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

  // Serve-coverage diagnostic (extracted to marineServeDiag.js — pure instrumentation, and its
  // known limits are documented there: written only on a cache HIT, and `coversViewport` has no
  // global-span shortcut, so `gridWidth == null` means NOT MEASURED, never "does not cover").
  publishServeDiag(hitData, bounds,
    { cacheSource, model: wanted, layer: wantedLayer, hour: wantedHour });

  return hitData;
}

export async function fetchMarineData(bounds, zoom, signal, hourOffset = 0, forceFetch = false, model = null, activeLayer = 'waves', isPrefetch = false, fetchOpts = null) {
  if (!bounds) return getModelSafeMarine(model, hourOffset, activeLayer);

  let west = bounds.west, east = bounds.east;
  if (east < west) east += 360;

  // TIGHT snap (clamp_resharpen only — see getSnapConfig): a viewport-scoped request fits inside
  // the fine regional tile the default 8°-wide snap overflows. Kill: __RAW_DISABLE_TIGHT_RESHARPEN__.
  const _tight = !!(fetchOpts && fetchOpts.tightSnap) &&
    !(typeof window !== 'undefined' && window.__RAW_DISABLE_TIGHT_RESHARPEN__ === true);
  const { snap, padding } = getSnapConfig(bounds, _tight ? { tight: true } : { midCeilingGuard: true });
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
            _rewarmWashBaseIfStale(model || 'GFS', hourOffset, bounds, activeLayer);
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
                _rewarmWashBaseIfStale(model || 'GFS', hourOffset, bounds, activeLayer);
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
      // Wash-base warm (2026-07-15): EURO was the only redirect path with NO global prewarm, so a
      // switch INTO EURO at a regional zoom left blend-both's base on the previous model (wash off —
      // same disease as the ICON report). Sibling-series prewarm stays deliberately absent for EURO
      // (per-hour cost class); the single world-coarse fetch here is cheap and cached.
      prewarmGlobalMarineGrid('EURO', hourOffset, bounds, activeLayer);
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
  // §7.6 far-horizon churn: a GENUINELY-TERMINAL coverage failure (EURO waves >240h = no_copernicus_coverage;
  // ICON extended range not yet ingested = "...anchor and target GFS are both unavailable") won't resolve by
  // refetching. Record it so the scrub-settle backstop stops re-driving the doomed 404 (the "10-day slowdown")
  // while the held stale grid keeps displaying. NEVER record transient reasons (timeout/abort/fetch_failed).
  const _fr = lastRedirectFailureReason || '';
  if (_fr.includes('coverage') || _fr.includes('unsupported') || _fr.includes('anchor')) {
    recordTerminalNoCoverage(model, activeLayer, hourOffset);
  }
  return getModelSafeMarine(model, hourOffset, activeLayer, bounds) || createFallbackSafeZeroGrid(model, lastRedirectFailureReason || 'backend_fetch_failed');
}
