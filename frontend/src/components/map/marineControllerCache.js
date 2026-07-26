// marineControllerCache.js
// Decomposed caching layer for marine weather data.

import {
  HOURLY_CACHE_TTL, PER_MODEL_HOUR_CACHE_TTL, persistCache, hydrateCache,
  isViewportInsideCachedBounds, findClosestHourIndex
} from './marineControllerUtils';
import {
  getBackendWeatherFlag,
  getBackendCopernicusFlag,
  getBackendIconMarineFlag,
  getSharedValidTime,
  getSurfModeFlag,
  updateDiagnostics,
  updateCopernicusDiagnostics,
  updateProjectionDiag,
  clampViewportBbox
} from './backendWeatherServiceClient';
import { recordTruthStage } from './weatherTruthTracker';
import { extractMarineAtOffset } from './marineControllerExtractor';

// --- CACHES ---
var marineHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0 };
var LS_MARINE_KEY = 'rawsurf_marine_cache_v10'; // v7.14.2: Bumped to avoid stale 3-var GFS cache poisoning

// Hydrate from localStorage on module init
var _hydratedMarine = hydrateCache(LS_MARINE_KEY);
if (_hydratedMarine) {
  var _hydMarineProvider = _hydratedMarine.provider || 'open-meteo';
  var _hydMarineModel = _hydratedMarine.model || 'GFS';
  var _expectedProvider = 'open-meteo';
  if (_hydMarineProvider !== _expectedProvider) {
    console.log(`[Marine] Rejected hydrated cache: provider=${_hydMarineProvider}, expected=${_expectedProvider} for model=${_hydMarineModel}`);
    _hydratedMarine = null;
    try { localStorage.removeItem(LS_MARINE_KEY); } catch(e) {}
  } else {
    marineHourlyCache = _hydratedMarine;
    console.log(`[Marine] Hydrated from localStorage: ${_hydratedMarine.points?.length} pts, age ${Math.round((Date.now() - _hydratedMarine.timestamp)/1000)}s, provider=${_hydMarineProvider}`);
  }
}

// --- LAST KNOWN GOOD FIELDS ---
var lastKnownGoodMarine = _hydratedMarine ? extractMarineAtOffset(_hydratedMarine, 0) : null;
var lastKnownGoodMarineModel = _hydratedMarine?.model || 'GFS';
if (lastKnownGoodMarine) lastKnownGoodMarine.__sourceModel = lastKnownGoodMarineModel;

export function getMarineHourlyCache() { return marineHourlyCache; }
export function setMarineHourlyCache(cache) { 
  marineHourlyCache = cache;
  persistCache(LS_MARINE_KEY, cache);
}

export function getLastKnownGoodMarine() { return lastKnownGoodMarine; }
export function setLastKnownGoodMarine(val, model = 'GFS', provider = 'open-meteo') {
  lastKnownGoodMarine = val;
  if (lastKnownGoodMarine) {
    lastKnownGoodMarineModel = model;
    lastKnownGoodMarine.__sourceModel = model;
    lastKnownGoodMarine.__provider = provider;
  }
}

export function getLastKnownGoodMarineModel() { return lastKnownGoodMarineModel; }

class LRUMap extends Map {
  constructor(limit = 50) {
    super();
    this.limit = limit;
    // Bounded tombstone set of keys removed by capacity eviction, so a later lookup can
    // report a structured `evicted` miss (vs `exact_key_absent` for a never-cached key).
    this._evicted = new Set();
    this._evictedLimit = limit * 4;
  }
  get(key) {
    const value = super.get(key);
    if (value) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }
  set(key, value) {
    if (super.has(key)) {
      super.delete(key);
    }
    // A re-cached key is live again — clear any stale eviction tombstone for it.
    this._evicted.delete(key);
    super.set(key, value);
    if (super.size > this.limit) {
      const oldestKey = super.keys().next().value;
      if (oldestKey !== undefined) {
        super.delete(oldestKey);
        this._evicted.add(oldestKey);
        if (this._evicted.size > this._evictedLimit) {
          // Drop the oldest tombstone to keep the set bounded.
          this._evicted.delete(this._evicted.values().next().value);
        }
      }
    }
    return this;
  }
  wasEvicted(key) {
    return this._evicted.has(key);
  }
}

var PER_MODEL_HOUR_CACHE_MAX = 50;
var _perModelHourCache = new LRUMap(PER_MODEL_HOUR_CACHE_MAX);

// The tile id the REQUEST side (clampViewportBbox) uses for world-bounds marine lookups. Kept here
// so the store can mirror world grids under it — see the WORLD-GRID KEY ALIAS note in
// _cacheMarineResult. globalGridCacheKeyParity.test.js pins this equal to the value clampViewportBbox
// actually returns, so the two can never drift apart silently again.
export const GLOBAL_LOOKUP_TILE_ID = 'global_coarse';

export function getPerModelHourCache() { return _perModelHourCache; }

// ---------------------------------------------------------------------------
// Structured cache lookup telemetry (Phase 1.3)
// Records WHY a marine cache lookup hit or missed so the dominant miss class can
// be measured BEFORE any cache capacity/prefetch change. Pure diagnostics: this
// never changes the lookup result. Reasons: hit, hit_fallback, exact_key_absent,
// evicted, expired, stale, signature_mismatch, bounds_not_contained.
// Read in console: window.__MARINE_CACHE_DIAG__  /  reset: window.__MARINE_CACHE_DIAG_RESET__()
// ---------------------------------------------------------------------------
export function recordMarineCacheLookup(reason, detail) {
  if (typeof window === 'undefined') return;
  let diag = window.__MARINE_CACHE_DIAG__;
  if (!diag) {
    diag = window.__MARINE_CACHE_DIAG__ = { counts: {}, log: [] };
    window.__MARINE_CACHE_DIAG_RESET__ = () => { window.__MARINE_CACHE_DIAG__ = { counts: {}, log: [] }; };
  }
  diag.counts[reason] = (diag.counts[reason] || 0) + 1;
  diag.log.unshift({ reason, ...detail, timestamp: new Date().toISOString() });
  if (diag.log.length > 60) diag.log.pop();
}

export function estimateRequestCost(type, model, pointCount, hourlyVarCount, forecastDays) {
  if (type === 'tiles') return 50000;
  const timeBytes = forecastDays * 24 * 25;
  const varBytes = hourlyVarCount * forecastDays * 24 * 8;
  const metadataBytes = 1500;
  return pointCount * (timeBytes + varBytes + metadataBytes);
}

export function _isAllVarModel(model) {
  const m = model || 'GFS';
  if (m === 'EURO') return false;
  if (m === 'GFS' && getBackendWeatherFlag()) return false;
  if (m === 'ICON' && getBackendIconMarineFlag()) return false;
  return true;
}

export function _cacheMarineResult(model, hourOffset, data, layer, silent = false) {
  if (!data) return;
  // Do not cache empty / non-renderable grids. An HTTP-200 response carrying zero
  // vectors is typically a *transient* absence of data — e.g. a far-hour slice of a
  // freshly-published model run the backend is still ingesting (ICON marine far
  // hours return empty for a few minutes after a run lands, then fill in). Caching
  // it would pin the blank heatmap for the cache TTL and starve any retry of the
  // real data once ingestion completes. Grids with vectors (incl. all-calm or
  // stale/coarse) are still cached as before.
  const vecLen = data.grid?.vectors?.length || 0;
  if (vecLen === 0 || data.grid?.renderable === false) return;
  // Mode-keyed (2026-07-03): surf-banded and plain products must never cross-hit (frame mixing).
  const layerPart = (_isAllVarModel(model) ? 'all' : (layer || 'waves')) + (getSurfModeFlag() ? '~surf' : '');
  const tileId = data.tile_id || data.region_id || data.grid?.region_id || 'unknown';
  const key = `${model || 'GFS'}_${layerPart}_${tileId}_${hourOffset}`;
  
  const g = data.grid || {};
  const bounds = g.bounds || {};
  const boundsStr = bounds.west !== undefined ? `${bounds.west.toFixed(2)}:${bounds.south.toFixed(2)}:${bounds.east.toFixed(2)}:${bounds.north.toFixed(2)}` : 'none';

  const signature = {
    model: model || 'GFS',
    layer: layer || 'waves',
    provider: g.__gridProvider || g.provider || 'none',
    hourOffset: hourOffset,
    boundsStr: boundsStr,
    cols: g.cols || 0,
    rows: g.rows || 0,
    vectorsLength: g.vectors?.length || 0
  };

  const entry = {
    data,
    timestamp: Date.now(),
    model: model || 'GFS',
    signature
  };
  _perModelHourCache.set(key, entry);

  // WORLD-GRID KEY ALIAS (MAR-01, 2026-07-26). This key is derived from the RESPONSE
  // (tile_id/region_id), but getModelSafeMarine looks up by the REQUEST-derived selectedTileId,
  // which clampViewportBbox hardcodes to GLOBAL_LOOKUP_TILE_ID for world bounds. Nothing kept the
  // two in sync: backendWeatherServiceClientCoverage.js:390 documents this exact desync being fixed
  // ONCE already, and then 41addb91 (2026-07-22) moved the served world tier from 'global_coarse' to
  // 'global_mid' and silently broke it again — verified live 2026-07-26, /api/weather/grid at
  // bbox=-180,-80,180,85 returns region_id='global_mid'. Every world lookup therefore missed the
  // exact key and fell through to the O(N) containment scan, on the activation hot path.
  // Mirroring the SAME entry object under the lookup id costs one map slot and no extra payload,
  // and makes a future tier rename unable to desync the cache again.
  const _aw = bounds.west !== undefined
    ? ((bounds.east < bounds.west) ? (bounds.east + 360 - bounds.west) : (bounds.east - bounds.west))
    : 0;
  if (_aw >= 340 && tileId !== GLOBAL_LOOKUP_TILE_ID) {
    _perModelHourCache.set(`${model || 'GFS'}_${layerPart}_${GLOBAL_LOOKUP_TILE_ID}_${hourOffset}`, entry);
  }

  if (!silent && model === 'GFS' && layer === 'waves' && hourOffset === 0) {
    recordTruthStage('cacheWrite', {
      model,
      domain: 'marine',
      layer,
      valid_time: data.valid_time || data.validTime,
      run_time: data.run_time || data.runTime,
      product_id: data.product_id || data.productId,
      is_dynamic_viewport_product: data.is_dynamic_viewport_product,
      coverage_scope: data.coverage_scope,
      requested_bbox: data.requested_bbox,
      served_bbox: data.served_bbox,
      grid: data.grid,
      truthTag: data.truthTag
    }, 'marineControllerCache.js', '_cacheMarineResult');
  }

  // LRUMap automatically manages eviction on .set()
}

export function _updateDiagnosticsOnCacheHit(hitData, wantedModel, wantedHour, wantedLayer, bounds = null) {
  if (!hitData || typeof window === 'undefined') return;
  try {
    const g = hitData.grid || {};
    const isEuro = wantedModel === 'EURO';
    const validTimeStr = getSharedValidTime(wantedHour, wantedLayer, wantedModel);
    const clampRes = clampViewportBbox(bounds || g.bounds, wantedLayer, wantedModel, 'marine');
    const clampedBbox = clampRes.clampedBbox || g.bounds;

    const details = {
      url: 'cache',
      status: 200,
      validTime: validTimeStr,
      valueKind: wantedLayer === 'swell_1' ? 'swell_wave_height' : 'wave_height',
      valueUnit: 'm',
      displayUnitHint: 'none',
      elapsedMs: 0,
      error: null,
      requestedBbox: bounds || g.bounds,
      clampedBbox: clampedBbox,
      fallbackReason: null,
      hourOffset: wantedHour,
      layer: wantedLayer,
      gridVectorCount: g.vectors ? g.vectors.length : 0,
      nonzeroCount: g.nonzeroCount || 0,
      renderable: g.renderable !== false,
      provider: g.__gridProvider || g.provider || (isEuro ? 'copernicus' : 'open-meteo'),
      sourceDataset: hitData.source_dataset || null,
      sourceVariables: hitData.source_variables || null,
      is_forecast_authoritative: g.is_forecast_authoritative || false,
      is_estimated: g.is_estimated || false,
      is_test_fixture: g.is_test_fixture || false,
      gridMode: g.gridMode || 'rectangular',
      productId: g.productId || null,
      coverage_scope: g.coverage_scope || null
    };

    if (isEuro) {
      updateCopernicusDiagnostics('grid', details);
    } else {
      updateDiagnostics('grid', details, wantedModel);
    }

    const vectors = g.vectors;
    const firstVector = vectors && vectors[0] ? { lat: vectors[0].lat, lng: vectors[0].lng } : null;
    const lastVector = vectors && vectors.length > 0 ? { lat: vectors[vectors.length - 1].lat, lng: vectors[vectors.length - 1].lng } : null;
    const bboxParam = clampedBbox ? `${clampedBbox.west},${clampedBbox.south},${clampedBbox.east},${clampedBbox.north}` : null;

    updateProjectionDiag('marine', {
      activeModel: wantedModel,
      activeLayer: wantedLayer,
      requestedViewportBounds: bounds || g.bounds,
      backendRequestBbox: bboxParam,
      responseGridBounds: g.bounds,
      coverageBounds: clampRes.coverageBounds,
      cols: g.cols,
      rows: g.rows,
      vectorCount: vectors ? vectors.length : 0,
      nonzeroCount: g.nonzeroCount || 0,
      timeOffsetHours: wantedHour,
      requestedValidTime: validTimeStr,
      validTime: validTimeStr,
      firstVectorLatLng: firstVector,
      lastVectorLatLng: lastVector,
      productId: g.productId || null,
      provider: g.__gridProvider || g.provider || (isEuro ? 'copernicus' : 'open-meteo'),
      renderable: g.renderable !== false,
      clampedBbox: clampedBbox,
      selectedTileId: clampRes.selectedTileId,
      rejectedTileIds: clampRes.rejectedTileIds,
      regionId: hitData.region_id || clampRes.selectedTileId,
      tileId: hitData.tile_id || clampRes.selectedTileId,
      isEstimated: g.is_estimated || false,
      estimateBasis: g.estimate_basis || null,
      coverage_scope: g.coverage_scope || null,
      is_dynamic_viewport_product: g.is_dynamic_viewport_product || false,
      requested_bbox: g.requested_bbox || null,
      served_bbox: g.served_bbox || null,
      cache_key: g.cache_key || null,
      resolution: g.resolution || null,
      coordinate_count: g.coordinate_count || null
    });
  } catch (e) {
    console.warn('[Safe Cache] Failed to update diagnostics on cache hit:', e.message);
  }
}

export function createFallbackSafeZeroGrid(model, failureReason) {
  const m = model || 'GFS', g = { vectors: [], bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 27, rows: 27,
    __provider: 'fallback_safe_zero', __gridProvider: 'none', __renderable: false, __failureReason: failureReason };
  return { type: 'FeatureCollection', features: [], grid: g, __sourceModel: m, __provider: 'fallback_safe_zero',
    __gridProvider: 'none', __renderable: false, __failureReason: failureReason };
}

// TERMINAL NO-COVERAGE TRACKER (2026-07-09, §7.6 far-horizon churn fix). When a marine fetch fails with a
// GENUINELY-TERMINAL reason — a model horizon boundary the current run can't serve (EURO waves >240h /
// ICON extended estimated range not yet ingested) — the client HOLDS the last-good stale grid (no
// clearing, which the user wants), but that stale grid carries no __failureReason, so the scrub-settle
// backstop keeps re-driving the doomed 404 = the felt "10-day slowdown". Record the terminal (model,
// layer,hour) here so the settle stops re-driving THAT hour while the held frame keeps displaying. TTL'd
// (15 min, shorter than a model cycle) so a later run that DOES ingest the estimates re-tries cleanly.
// Only genuine coverage/unsupported/anchor reasons are recorded (caller-gated) — never transient
// (timeout/abort/fetch_failed). Kill switch: window.__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__.
const _terminalNoCoverage = new Map();       // `${model}_${layer}_${hour}` -> timestamp
const TERMINAL_NOCOV_TTL_MS = 15 * 60 * 1000;

export function recordTerminalNoCoverage(model, layer, hourOffset) {
  const key = `${model || 'GFS'}_${layer || 'waves'}_${hourOffset}`;
  _terminalNoCoverage.set(key, Date.now());
  if (typeof window !== 'undefined') {
    window.__MARINE_TERMINAL_NOCOV_RECORDED__ = (window.__MARINE_TERMINAL_NOCOV_RECORDED__ || 0) + 1;
  }
  // Bound (far-horizon hours are ~32 max, but guard anyway): drop the oldest entry.
  if (_terminalNoCoverage.size > 200) {
    _terminalNoCoverage.delete(_terminalNoCoverage.keys().next().value);
  }
}

export function isTerminalNoCoverage(model, layer, hourOffset) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__ === true) return false;
  const key = `${model || 'GFS'}_${layer || 'waves'}_${hourOffset}`;
  const ts = _terminalNoCoverage.get(key);
  if (!ts) return false;
  if (Date.now() - ts > TERMINAL_NOCOV_TTL_MS) { _terminalNoCoverage.delete(key); return false; }
  return true;
}

// Test-only reset so terminal state doesn't leak across cases.
export function _resetTerminalNoCoverageForTest() { _terminalNoCoverage.clear(); }

export function hasTimeCoverage(cache, hourOffset) {
  const timeArray = cache?.results?.[0]?.hourly?.time;
  if (!timeArray || timeArray.length === 0) return false;
  const targetMs = Date.now() + hourOffset * 3600000;
  const lastTimeStr = timeArray[timeArray.length - 1];
  const lastCachedMs = new Date(lastTimeStr.endsWith('Z') ? lastTimeStr : lastTimeStr + 'Z').getTime();
  return targetMs <= lastCachedMs + 2 * 3600000;
}

export function isContainedInMarineCache(bounds, model, hourOffset = 0, layer = 'waves') {
  const isGfsBackend = getBackendWeatherFlag() && (model === 'GFS' || !model);
  const isIconBackend = getBackendIconMarineFlag() && model === 'ICON';
  const isCopernicusBackend = getBackendCopernicusFlag() && model === 'EURO';
  const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

  if (isBackendActive) {
    const layerPart = (_isAllVarModel(model) ? 'all' : layer) + (getSurfModeFlag() ? '~surf' : '');
    const clampRes = clampViewportBbox(bounds, layer, model, 'marine');
    const tileId = clampRes.selectedTileId || 'outside';
    const lookupKey = `${model || 'GFS'}_${layerPart}_${tileId}_${hourOffset}`;
    const missDetail = { model: model || 'GFS', layer, hourOffset, tileId, lookupKey };
    const exact = _perModelHourCache.get(lookupKey);
    if (exact && Date.now() - exact.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
      if (exact.data?.stale || exact.data?.grid?.stale) {
        recordMarineCacheLookup('stale', missDetail);
        return false;
      }
      const sig = exact.signature;
      if (sig) {
        const g = exact.data?.grid || {};
        const b = g.bounds || {};
        const bStr = b.west !== undefined ? `${b.west.toFixed(2)}:${b.south.toFixed(2)}:${b.east.toFixed(2)}:${b.north.toFixed(2)}` : 'none';
        const provider = g.__gridProvider || g.provider || 'none';

        if (sig.model === (model || 'GFS') &&
            sig.layer === layer &&
            sig.provider === provider &&
            sig.hourOffset === hourOffset &&
            sig.boundsStr === bStr &&
            sig.cols === (g.cols || 0) &&
            sig.rows === (g.rows || 0) &&
            sig.vectorsLength === (g.vectors?.length || 0)) {
          recordMarineCacheLookup('hit', missDetail);
          return true;
        }
        recordMarineCacheLookup('signature_mismatch', missDetail);
      }
    } else if (exact) {
      recordMarineCacheLookup('expired', missDetail);
    } else if (_perModelHourCache.wasEvicted(lookupKey)) {
      recordMarineCacheLookup('evicted', missDetail);
    } else {
      recordMarineCacheLookup('exact_key_absent', missDetail);
    }

    // Fallback search: check if any cached entry in _perModelHourCache contains these bounds
    if (bounds) {
      for (const [key, entry] of _perModelHourCache.entries()) {
        if (key.startsWith(`${model || 'GFS'}_${layerPart}_`) && key.endsWith(`_${hourOffset}`) && Date.now() - entry.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
          if (entry.data?.stale || entry.data?.grid?.stale) {
            continue;
          }
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

                if (sig.model === (model || 'GFS') &&
                    sig.layer === layer &&
                    sig.provider === provider &&
                    sig.hourOffset === hourOffset &&
                    sig.boundsStr === bStr &&
                    sig.cols === (g.cols || 0) &&
                    sig.rows === (g.rows || 0) &&
                    sig.vectorsLength === (g.vectors?.length || 0)) {
                  recordMarineCacheLookup('hit_fallback', missDetail);
                  return true;
                }
              }
            }
          }
        }
      }
    }
    recordMarineCacheLookup('bounds_not_contained', missDetail);
    return false;
  }

  if (!bounds || !marineHourlyCache.bounds || !marineHourlyCache.results) return false;
  if (marineHourlyCache.model !== (model || 'GFS')) return false;
  const cacheLayerKey = marineHourlyCache.__layerKey || 'all';
  if (cacheLayerKey !== 'all' && cacheLayerKey !== layer) return false;
  if (!_isAllVarModel(model) && (marineHourlyCache.activeLayer || 'waves') !== layer) return false;
  if (Date.now() - marineHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  
  if (marineHourlyCache.__coverageStartMs && marineHourlyCache.__coverageEndMs) {
    const targetMs = Date.now() + hourOffset * 3600000;
    if (targetMs < marineHourlyCache.__coverageStartMs - 3600000 || targetMs > marineHourlyCache.__coverageEndMs + 3600000) {
      return false;
    }
  } else {
    if (!hasTimeCoverage(marineHourlyCache, hourOffset)) return false;
  }
  
  const isGlobalCached = !!marineHourlyCache.isGlobal;
  const isGlobalViewport = Math.abs(bounds.east - bounds.west) > 180 || Math.abs(bounds.north - bounds.south) > 90;
  if (isGlobalCached !== isGlobalViewport) return false;
  return isViewportInsideCachedBounds(bounds, marineHourlyCache.bounds);
}

/**
 * Checks if ANY cached entry exists for the given model/layer/viewport,
 * regardless of hourOffset. Returns the cached entry or null.
 * 
 * This is useful for determining whether the backend likely has forecast data
 * cached for this viewport (since the backend caches all hours from a single
 * upstream fetch with the same bbox).
 */
export function getAnyHourCacheEntry(model, layer, bounds) {
  const wanted = model || 'GFS';
  const layerPart = _isAllVarModel(wanted) ? 'all' : (layer || 'waves');
  const prefix = `${wanted}_${layerPart}_`;

  for (const [key, entry] of _perModelHourCache.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (Date.now() - entry.timestamp >= PER_MODEL_HOUR_CACHE_TTL) continue;
    
    if (bounds && entry.data?.grid?.bounds) {
      const g = entry.data.grid;
      const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
      const ew = bounds.west, ee = bounds.east, es = bounds.south, en = bounds.north;
      const containsLng = ge < gw 
        ? (ew >= gw || ew <= ge) && (ee >= gw || ee <= ge)
        : ew >= gw && ee <= ge;
      const containsLat = es >= gs && en <= gn;
      if (containsLng && containsLat) {
        return entry;
      }
    } else {
      return entry;
    }
  }
  return null;
}
