// windController.js — Fetch layer and reindexing for wind data.
// Extracted from marineController.js to satisfy the 800 LOC limit.

import {
  findClosestHourIndex, HOURLY_CACHE_TTL, hydrateCache,
  getSnapConfig, isViewportInsideCachedBounds
} from './marineControllerUtils';
import { getBackendWindFlag, clampViewportBbox, getSharedValidTime } from './backendWeatherServiceClient';
import { fetchBackendWindGrid } from './backendWindServiceClient';
import { createFallbackSafeZeroGrid, recordTerminalNoCoverage } from './marineControllerCache';
import { recordTruthStage } from './weatherTruthTracker';

// --- CACHES ---
var WIND_CACHE = new Map();

// STALE-AWARE TTL (2026-07-19, wind viewport-fine arc). When the backend's dynamic wind lane is
// upstream-rate-limited it answers a FINE-bbox request with the stale GLOBAL 10-deg product
// (fallbackReason: upstream_rate_limited) — honest, renderable, and cached here under the fine
// tile key. Its GLOBAL bounds then satisfy the containment fallback for EVERY viewport, so the
// full 10-min TTL pinned users to coarse long after the upstream recovered (observed live: one
// rate-limited window -> every later zoom/pan served from that one stale entry, zero network).
// A stale entry gets 2 min instead: long enough to ride out the backend's own 60-120s negative
// cache without hammering it, short enough that recovery is minutes, not the TTL.
function windCacheTtlMs(entry) {
  return entry?.data?.stale ? 2 * 60 * 1000 : 10 * 60 * 1000;
}
// In-flight wind fetches keyed by the canonical target (model + hour + snapped tile) so the
// primary refresh, moveend, and scrub-settle callers share ONE network request instead of
// issuing duplicate same-hour wind URLs (F3).
var WIND_INFLIGHT = new Map();
var windHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0, model: null };

// --- PERSISTENT CACHE ---
var LS_WIND_KEY = 'rawsurf_wind_cache_v3';

// Hydrate on module init
var _hydratedWind = hydrateCache(LS_WIND_KEY);
if (_hydratedWind) {
  var _hydBounds = _hydratedWind.bounds;
  var _hydLngSpan = _hydBounds ? Math.abs(_hydBounds.east - _hydBounds.west) : 0;
  if (_hydLngSpan > 180) {
    windHourlyCache = _hydratedWind;
    console.log(`[Wind] Hydrated from localStorage: ${_hydratedWind.points?.length} pts, age ${Math.round((Date.now() - _hydratedWind.timestamp)/1000)}s (GLOBAL)`);
  } else {
    console.log(`[Wind] Rejected non-global localStorage cache (lngSpan=${_hydLngSpan.toFixed(0)}°, need >180°)`);
    _hydratedWind = null;
    try { localStorage.removeItem(LS_WIND_KEY); } catch(e) {}
  }
}

// --- LAST KNOWN GOOD FIELDS ---
var lastKnownGoodWind = _hydratedWind ? extractWindAtOffset(_hydratedWind, 0) : null;

// --- INFLIGHT ABORT CONTROLLERS ---
var windAbortController = null;

// --- INFLIGHT LOCKS ---
var windRequestInFlight = false;

// --- BOOTSTRAP MODE ---
var BOOTSTRAP_WIND = true;

// Cost estimation removed (legacy)

export function isContainedInWindCache(bounds, model) {
  if (!bounds || !windHourlyCache.bounds || !windHourlyCache.results) return false;
  if (windHourlyCache.model !== (model || 'GFS')) return false;
  if (Date.now() - windHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  const isGlobalCached = !!windHourlyCache.isGlobal;
  const isGlobalViewport = Math.abs(bounds.east - bounds.west) > 180 || Math.abs(bounds.north - bounds.south) > 90;
  if (isGlobalCached !== isGlobalViewport) return false;
  return isViewportInsideCachedBounds(bounds, windHourlyCache.bounds);
}

export function getWindHourlyCache() {
  return windHourlyCache;
}

export function extractWindAtOffset(cache, hourOffset) {
  const { results, points, gridSize, cols, rows, bounds, vectors: cacheVectors } = cache;

  // If backend weather service / grid cache is active, check if the cache has conformed vectors
  if (cacheVectors && cacheVectors.length > 0) {
    const timeArray = results[0]?.hourly?.time;
    const targetValidTime = getSharedValidTime(hourOffset, 'wind', cache.model || 'GFS');
    // Ensure the cached grid matches the requested valid time
    if (timeArray?.[0] === targetValidTime) {
      return {
        vectors: cacheVectors,
        bounds,
        cols: cols || gridSize,
        rows: rows || gridSize,
        stale: false,
        source: cache.model || 'GFS',
        hourOffset,
        // #18/A3 wind mirror: carry the cached grid's lineage identity through extraction —
        // valid only in this branch (timeArray[0] === targetValidTime guarantees the cached
        // product IS the requested hour), so the tag stays truthful.
        truthTag: cache.truthTag || null,
        product_id: cache.product_id || null,
        productId: cache.product_id || null,
        valid_time: cache.valid_time || null,
        run_time: cache.run_time || null,
        provider: cache.provider || undefined
      };
    }
    return null; // Cache miss for the requested hour
  }

  // Legacy point-forecast fallback
  if (!results || !points) return null;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;

  const speedUnit = results[0]?.hourly_units?.wind_speed_10m || 'km/h';

  const vectors = [];
  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      vectors.push({ lat: pt.lat, lng: pt.monotonicLng, speed: 0, direction: 0, u: 0, v: 0 });
      return;
    }
    let speed = r.hourly.wind_speed_10m?.[idx];
    const dir = r.hourly.wind_direction_10m?.[idx];
    if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) {
      vectors.push({ lat: pt.lat, lng: pt.monotonicLng, speed: 0, direction: 0, u: 0, v: 0 });
      return;
    }
    if (speedUnit === 'km/h') {
      speed = speed * 0.539957;
    } else if (speedUnit === 'm/s') {
      speed = speed * 1.943844;
    } else if (speedUnit === 'mph') {
      speed = speed * 0.868976;
    }

    const rad = dir * (Math.PI / 180);
    vectors.push({
      lat: pt.lat, lng: pt.monotonicLng, speed, direction: dir,
      u: -speed * Math.sin(rad), v: -speed * Math.cos(rad)
    });
  });

  if (vectors.length === 0) return null;

  return {
    vectors, bounds, 
    cols: cols || gridSize, 
    rows: rows || gridSize,
    stale: false, source: cache.model || 'GFS', hourOffset
  };
}

export function getModelSafeWind(model, hourOffset, bounds) {
  const resolvedModel = model || 'GFS';
  if (!bounds) return null;

  const clampResult = clampViewportBbox(bounds, 'wind', resolvedModel, 'wind');
  const tileId = clampResult.selectedTileId || 'outside';
  const cacheKey = `${resolvedModel}_wind_grid_${tileId}_${hourOffset}`;

  const cached = WIND_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < windCacheTtlMs(cached)) {
    return cached.data;
  }

  // Fallback search: check if any cached entry contains the bounds for this hour
  for (const [key, entry] of WIND_CACHE.entries()) {
    if (key.startsWith(`${resolvedModel}_wind_grid_`) && key.endsWith(`_${hourOffset}`) && Date.now() - entry.timestamp < windCacheTtlMs(entry)) {
      const g = entry.data;
      if (g?.vectors?.length > 0 && g.bounds) {
        const ew = bounds.west, ee = bounds.east, es = bounds.south, en = bounds.north;
        const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
        const containsLng = ge < gw 
          ? (ew >= gw || ew <= ge) && (ee >= gw || ee <= ge)
          : ew >= gw && ee <= ge;
        const containsLat = es >= gs && en <= gn;

        if (containsLng && containsLat) {
          return g;
        }
      }
    }
  }

  return null;
}

export async function fetchWindData(bounds, signal, hourOffset = 0, forceFetch = false, forecastDays = 3, model = null, isPrewarm = false) {
  // In-flight marker for TruthDiff's WIND_DATA_EMPTY rule (#19 follow-up, user log 07-10:
  // the rule fired during the DESIGNED empty window between wind activation and first commit).
  // Counter (not boolean) — concurrent fetches must not clear each other's window. Prewarms
  // excluded: they don't feed the active layer, so they must not mask a real empty render.
  if (!isPrewarm && typeof window !== 'undefined') {
    window.__WIND_FETCH_PENDING__ = (window.__WIND_FETCH_PENDING__ || 0) + 1;
  }
  try {
    return await _fetchWindDataInner(bounds, signal, hourOffset, forceFetch, forecastDays, model, isPrewarm);
  } finally {
    if (!isPrewarm && typeof window !== 'undefined') {
      window.__WIND_FETCH_PENDING__ = Math.max(0, (window.__WIND_FETCH_PENDING__ || 1) - 1);
    }
  }
}

async function _fetchWindDataInner(bounds, signal, hourOffset = 0, forceFetch = false, forecastDays = 3, model = null, isPrewarm = false) {
  if (!bounds) { console.log('[Wind] fetchWindData: no bounds'); return lastKnownGoodWind; }

  let west = bounds.west, east = bounds.east;
  if (east < west) east += 360;

  const { snap, padding } = getSnapConfig(bounds);
  const latMinRaw = Math.floor((bounds.south - padding) / snap) * snap;
  const latMaxRaw = Math.ceil((bounds.north + padding) / snap) * snap;
  const lngMin = Math.floor((west - padding) / snap) * snap;
  const lngMax = Math.ceil((east + padding) / snap) * snap;
  const latMin = Math.max(-85, Math.min(85, latMinRaw));
  const latMax = Math.max(-85, Math.min(85, latMaxRaw));

  if (latMax <= latMin || lngMax <= lngMin) return lastKnownGoodWind;
  const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };

  const resolvedModel = model || 'GFS';

  // EXPLICIT GLOBAL REQUEST (2026-07-19, base+overlay completion): a caller passing a
  // WORLD-SPAN bbox (the cold-start global-base lane, the zoom-out backstop prefetch) wants THE
  // GLOBE. The viewport substitution below rewrote it to the current viewport — harmless in the
  // always-global era, but under the fine tier that re-clamps to the FINE tile, so the "global
  // base" fetch returned the fine product (observed live: "Committing GLOBAL base ... 425
  // vectors" = the 25x17 fine box) and the two-texture engine never got its base on a cold
  // enable at fine zoom. A world-span request now keeps its own bbox (clampViewportBbox resolves
  // it to the global tile); the substitution remains for viewport-shaped requests.
  const reqSpanLng = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
  const isExplicitGlobal = reqSpanLng >= 350.0;

  // Resolve actual viewport bounds to pass explicitly
  let viewportBounds = bounds;
  let source = "controller";
  if (!isExplicitGlobal && bounds && Math.abs(bounds.east - bounds.west) > 180) {
    if (typeof window !== 'undefined' && window.map) {
      try {
        const b = window.map.getBounds();
        viewportBounds = {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
        source = "window_map";
      } catch (e) {
        source = "fallback";
      }
    } else {
      source = "fallback";
    }
  }

  // Check cache first!
  const clampResult = clampViewportBbox(viewportBounds || snappedBounds, 'wind', resolvedModel, 'wind');
  const tileId = clampResult.selectedTileId || 'outside';
  const cacheKey = `${resolvedModel}_wind_grid_${tileId}_${hourOffset}`;
  
  if (!forceFetch) {
    const cached = WIND_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < windCacheTtlMs(cached)) { // 10 min, 2 min if stale
      console.log(`[Backend Wind Cache Hit] Returning cached backend wind grid for ${resolvedModel} at hourOffset=+${hourOffset}h`);
      if (!isPrewarm && hourOffset === 0) {
        recordTruthStage('cacheRead', cached.data, 'windController.js', 'fetchWindData');
      }
      return cached.data;
    }

    // Check if any cached entry contains viewportBounds/snappedBounds
    const boundsToCheck = viewportBounds || snappedBounds;
    const wantsFineTile = tileId.startsWith('wind_viewport_fine_');
    for (const [key, entry] of WIND_CACHE.entries()) {
      if (key.startsWith(`${resolvedModel}_wind_grid_`) && key.endsWith(`_${hourOffset}`) && Date.now() - entry.timestamp < windCacheTtlMs(entry)) {
        const g = entry.data;
        // A WORLD-SPAN grid contains every viewport, so without this a fresh global fetch
        // suppresses the fine-tier's AUTHORITATIVE fetch for its whole TTL (observed live:
        // zoom out then back into the Gulf -> 10-deg coarse from cache, zero network). The
        // global grid still renders instantly via the getModelSafeWind warm-commit path —
        // containment just must not COUNT AS the fine product. Fine-over-fine containment
        // (small pans inside the padded box) keeps the early return.
        if (wantsFineTile && g?.bounds) {
          const bSpan = g.bounds.west > g.bounds.east
            ? (g.bounds.east + 360.0) - g.bounds.west : g.bounds.east - g.bounds.west;
          if (bSpan >= 350.0) continue;
        }
        if (g?.vectors?.length > 0 && g.bounds) {
          const ew = boundsToCheck.west, ee = boundsToCheck.east, es = boundsToCheck.south, en = boundsToCheck.north;
          const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
          const containsLng = ge < gw 
            ? (ew >= gw || ew <= ge) && (ee >= gw || ee <= ge)
            : ew >= gw && ee <= ge;
          const containsLat = es >= gs && en <= gn;

          if (containsLng && containsLat) {
            console.log(`[Backend Contained Wind Cache Hit] Returning cached backend wind grid for ${resolvedModel} at hourOffset=+${hourOffset}h`);
            if (!isPrewarm && hourOffset === 0) {
              recordTruthStage('cacheRead', entry.data, 'windController.js', 'fetchWindData');
            }
            return entry.data;
          }
        }
      }
    }
  }
  
  // Join an in-flight fetch for this exact target rather than starting a duplicate (F3).
  const existingInflight = WIND_INFLIGHT.get(cacheKey);
  if (existingInflight) {
    try { return await existingInflight; } catch (e) { /* fall through to a fresh attempt */ }
  }

  const fetchPromise = (async () => {
    let lastWindRedirectFailureReason = '';
    if (getBackendWindFlag() && (resolvedModel === 'GFS' || resolvedModel === 'ICON' || resolvedModel === 'EURO')) {
      try {
        console.log(`[Backend Weather Service] Redirecting ${resolvedModel} Wind grid fetch to backend Weather Data Service for hourOffset=+${hourOffset}h`);
        const result = await fetchBackendWindGrid(viewportBounds, hourOffset, signal, snappedBounds, source, resolvedModel);

        if (result && result.renderable) {
          // WIND_CACHE is per-model-keyed (model_wind_grid_tile_hour) → ALWAYS safe to write, even
          // for a sibling-model prewarm (getModelSafeWind reads this). The shared single-slot caches
          // below (windHourlyCache / lastKnownGoodWind) and the truth stage are model-stamped GLOBAL
          // state — a sibling-model prewarm MUST NOT clobber them (that's the marine cache-pollution
          // landmine), so they are skipped when isPrewarm.
          WIND_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
          if (!isPrewarm && hourOffset === 0) {
            recordTruthStage('cacheWrite', result, 'windController.js', 'fetchWindData');
          }
          if (!isPrewarm) {
            // Also populate windHourlyCache for timeline scrubs fallback
            windHourlyCache = {
              hash: tileId,
              results: [ { hourly: { time: [ getSharedValidTime(hourOffset, 'wind', resolvedModel) ] } } ],
              points: result.vectors.map(v => ({ lat: v.lat, reqLng: v.lng, monotonicLng: v.lng })),
              gridSize: result.cols,
              cols: result.cols,
              rows: result.rows,
              bounds: result.bounds,
              timestamp: Date.now(),
              model: resolvedModel,
              isGlobal: Math.abs(result.bounds.east - result.bounds.west) > 180,
              vectors: result.vectors,
              // #18/A3 wind mirror: keep the lineage identity so extractWindAtOffset can carry it —
              // the extraction used to rebuild a bare object and the tracker logged
              // "Product: undefined" + divergent traceIds for every timeline commit (user log 07-10).
              truthTag: result.truthTag || null,
              product_id: result.product_id || null,
              valid_time: result.valid_time || null,
              run_time: result.run_time || null,
              provider: result.provider || null
            };
            lastKnownGoodWind = result;
          }
        }
        return result;
      } catch (err) {
        console.warn(`[Backend Weather Service] Wind grid redirect failed: ${err.message}.`);
        lastWindRedirectFailureReason = err.message || '';
        if (typeof window !== 'undefined' && window.__BACKEND_WIND_SERVICE_DIAG__) {
          window.__BACKEND_WIND_SERVICE_DIAG__.fallbackPath = 'none';
          window.__BACKEND_WIND_SERVICE_DIAG__.fallbackReason = err.message;
        }
      }
    }

    console.warn(`[Fallback] Backend wind redirects failed for model=${resolvedModel}, hour=${hourOffset}. Returning conformed safe zero grid.`);
    // Terminal no-coverage (wind analog of marineController's §7.6 recording): a coverage 404 from
    // the wind horizon gate won't resolve by refetching this run — record (model,'wind',hour) so the
    // scrub-settle stops re-driving the doomed fetch while the held frame keeps displaying. NEVER
    // record transient reasons (timeout/abort/5xx) — those must keep retrying.
    if (lastWindRedirectFailureReason.includes('coverage') || lastWindRedirectFailureReason.includes('unsupported')) {
      recordTerminalNoCoverage(resolvedModel, 'wind', hourOffset);
    }
    const targetBounds = viewportBounds || snappedBounds;
    if (isContainedInWindCache(targetBounds, resolvedModel)) {
      const cachedData = extractWindAtOffset(windHourlyCache, hourOffset);
      if (cachedData) {
        return cachedData;
      }
    }

    return {
      vectors: [{ lat: (targetBounds.south + targetBounds.north) / 2, lng: (targetBounds.west + targetBounds.east) / 2, speed: 0, direction: 0, u: 0, v: 0 }],
      bounds: targetBounds,
      cols: 1,
      rows: 1,
      stale: true,
      source: resolvedModel,
      hourOffset,
      renderable: false,
      nonzeroCount: 0,
      __failureReason: lastWindRedirectFailureReason || 'backend_fetch_failed'
    };
  })();

  WIND_INFLIGHT.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    WIND_INFLIGHT.delete(cacheKey);
  }
}

// ── Cross-model wind prewarm (instant model switches) — DEFAULT OFF (opt-in) ──
// After the active model's wind commits, warm the OTHER models' current wind into the per-model
// WIND_CACHE (isolated; getModelSafeWind reads it) so switching models is an INSTANT warm commit
// (WeatherEngine's getModelSafeWind path, WeatherEngine.js:151) instead of the cold ~1s backend
// fetch the first switch to each model otherwise pays on the 1-CPU box.
// Safe/bounded: fetchWindData(...,isPrewarm=true) writes ONLY WIND_CACHE (NOT the shared model-
// stamped windHourlyCache / lastKnownGood / truth stage — the marine cache-pollution landmine);
// deduped (WIND_INFLIGHT same-target + _windModelPrewarmInFlight), skipped during scrub, skipped
// when already warm. The 1–2 extra fetches are small (global-coarse ~300 vectors) but still hit the
// 1-CPU backend — MEASURE before flipping default-on.
const _windModelPrewarmInFlight = new Set();
const WIND_PREWARM_MODELS = ['GFS', 'ICON', 'EURO'];

function isWindModelPrewarmEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__WIND_MODEL_PREWARM__ === true) return true;
  try {
    if (window.localStorage && window.localStorage.getItem('wind_model_prewarm') === 'true') return true;
  } catch (e) { /* localStorage blocked */ }
  return false;
}

// True only for a wind grid that is safe to COMMIT to the engine. The backend wind redirect returns
// a 1-vector "conformed safe zero grid" (cols:1,rows:1,stale:true,renderable:false) when a fetch
// fails (e.g. EURO wind /grid 500s for some forecast valid_times → the browser reports it as a CORS
// error because the 500 response carries no CORS headers). Committing that 1-vector grid CLEARS the
// wind heatmap ([WebGLWind] Buffers cleared). Gating the commit on this lets the caller RETAIN the
// previous frame + retry instead — mirrors the marine "retain stale view while fetching" behavior.
export function isRenderableWindData(d) {
  return !!(d && Array.isArray(d.vectors) && d.vectors.length > 0 && d.renderable !== false && !d.stale);
}

export function _resetWindCachesForTest() {
  WIND_CACHE.clear();
  WIND_INFLIGHT.clear();
  _windModelPrewarmInFlight.clear();
  windHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0, model: null };
  lastKnownGoodWind = null;
}

export function prewarmSiblingModelWind(activeModel, bounds, hourOffset = 0, forecastDays = 3, signal = null) {
  try {
    if (!isWindModelPrewarmEnabled()) return;
    if (typeof window !== 'undefined' && window.isScrubbingTimeline) return; // don't compete with scrub
    if (!getBackendWindFlag() || !bounds) return;
    const active = activeModel || 'GFS';
    for (const m of WIND_PREWARM_MODELS) {
      if (m === active) continue;
      const key = `${m}_${hourOffset}`;
      if (_windModelPrewarmInFlight.has(key)) continue;
      if (getModelSafeWind(m, hourOffset, bounds)) continue; // already warm for this model/hour/viewport
      _windModelPrewarmInFlight.add(key);
      Promise.resolve()
        .then(() => fetchWindData(bounds, signal, hourOffset, false, forecastDays, m, true /* isPrewarm */))
        .catch(() => { /* best-effort: a miss just means that switch falls back to a cold fetch */ })
        .finally(() => { _windModelPrewarmInFlight.delete(key); });
    }
  } catch (e) { /* never let prewarm break the active fetch */ }
}
