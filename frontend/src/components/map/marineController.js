/**
 * marineController.js v3.0.0
 *
 * Authoritative fetch layer for wind and marine data.
 * Conforms to the Marine Engine v3 runtime contract.
 *
 * RULES:
 * - NO mock data injection in production
 * - Viewport-based fetching ONLY
 * - 429 cooldown protection (120s)
 * - AbortController for inflight cancellation
 * - Cache-first architecture
 * - Last valid field preservation on failure
 */

// --- UTILITY FUNCTIONS (must be above module-init code that calls them) ---
var safeNum = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

var getUV = (speed, dir) => {
  if (speed === 0) return { u: 0, v: 0, speed: 0 };
  const rad = dir * (Math.PI / 180);
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
};

// --- PROXY CONFIG ---
// v3.9.6: Route through Netlify serverless proxy to bypass client IP rate limits
var PROXY_URL = '/api/weather-proxy';
var isLocalhost = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('192.168.'));

function findClosestHourIndex(timeArray, targetMs) {
  if (!timeArray || !timeArray.length) return 0;
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < timeArray.length; i++) {
    const timeStr = timeArray[i];
    const ms = new Date(timeStr.endsWith('Z') ? timeStr : timeStr + 'Z').getTime();
    const diff = Math.abs(ms - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }
  return closestIdx;
}

// --- CACHES ---
var MARINE_CACHE = new Map();
var WIND_CACHE = new Map();
var PRESSURE_CACHE = new Map();

// --- HOURLY DATA CACHE (pre-fetched for timeline scrub) ---
// Stores full API responses keyed by viewport hash so timeline
// changes re-index locally instead of making new API calls.
var windHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0, model: null };
var marineHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0 };
var pressureHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0, model: null };
var HOURLY_CACHE_TTL = 30 * 60 * 1000; // 30 min (increased from 10 to reduce API calls)

// --- PERSISTENT CACHE (localStorage) ---
// Survives page reloads eliminates 429s on revisit
var LS_WIND_KEY = 'rawsurf_wind_cache_v1';
var LS_MARINE_KEY = 'rawsurf_marine_cache_v1';
var LS_PRESSURE_KEY = 'rawsurf_pressure_cache_v2'; // v2: bumped to invalidate stale 225-point caches

function persistCache(key, cache) {
  try {
    const slim = { hash: cache.hash, results: cache.results, points: cache.points,
      gridSize: cache.gridSize, bounds: cache.bounds, timestamp: cache.timestamp, model: cache.model };
    localStorage.setItem(key, JSON.stringify(slim));
  } catch (e) { /* localStorage full or unavailable ignore */ }
}

function hydrateCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.hash || !cached?.results || !cached?.timestamp) return null;
    if (Date.now() - cached.timestamp > HOURLY_CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return cached;
  } catch (e) { return null; }
}

// Hydrate from localStorage on module init
var _hydratedWind = hydrateCache(LS_WIND_KEY);
if (_hydratedWind) {
  windHourlyCache = _hydratedWind;
  console.log(`[Wind] Hydrated from localStorage: ${_hydratedWind.points?.length} pts, age ${Math.round((Date.now() - _hydratedWind.timestamp)/1000)}s`);
}
var _hydratedMarine = hydrateCache(LS_MARINE_KEY);
if (_hydratedMarine) {
  marineHourlyCache = _hydratedMarine;
  console.log(`[Marine] Hydrated from localStorage: ${_hydratedMarine.points?.length} pts, age ${Math.round((Date.now() - _hydratedMarine.timestamp)/1000)}s`);
}
var _hydratedPressure = hydrateCache(LS_PRESSURE_KEY);
if (_hydratedPressure) {
  pressureHourlyCache = _hydratedPressure;
  console.log(`[Pressure] Hydrated from localStorage: ${_hydratedPressure.points?.length} pts, age ${Math.round((Date.now() - _hydratedPressure.timestamp)/1000)}s`);
}

// --- LAST KNOWN GOOD FIELDS ---
// Pre-populated from localStorage hydrated cache if available
var lastKnownGoodWind = _hydratedWind ? extractWindAtOffset(_hydratedWind, 0) : null;
var lastKnownGoodMarine = _hydratedMarine ? extractMarineAtOffset(_hydratedMarine, 0) : null;
var lastKnownGoodPressure = _hydratedPressure ? extractPressureAtOffset(_hydratedPressure, 0) : null;
if (lastKnownGoodWind) console.log(`[Wind] Pre-populated lastKnownGood: ${lastKnownGoodWind.vectors.length} vectors`);
if (lastKnownGoodMarine) console.log(`[Marine] Pre-populated lastKnownGood: ${lastKnownGoodMarine.features?.length} features`);
if (lastKnownGoodPressure) console.log(`[Pressure] Pre-populated lastKnownGood: ${lastKnownGoodPressure.pressures.length} pressures`);

// --- 429 COOLDOWN STATE ---
var windCooldownUntil = 0;
var marineCooldownUntil = 0;
var pressureCooldownUntil = 0;
var COOLDOWN_MS = 60000; // 60s longer cooldown to let Open-Meteo rate limit recover

// --- INFLIGHT ABORT CONTROLLERS ---
var windAbortController = null;
var marinAbortController = null;
var pressureAbortController = null;

// --- INFLIGHT LOCKS ---
var windRequestInFlight = false;
var marineRequestInFlight = false;
var pressureRequestInFlight = false;

// --- BOOTSTRAP MODE ---
// First-load safety: always accept first valid response regardless of quality
var BOOTSTRAP_WIND = true;
var BOOTSTRAP_MARINE = true;
var BOOTSTRAP_PRESSURE = true;

/**
 * Check if we are in 429 cooldown for a given domain.
 */
function isInCooldown(domain) {
  const now = Date.now();
  if (domain === 'wind') return now < windCooldownUntil;
  if (domain === 'marine') return now < marineCooldownUntil;
  if (domain === 'pressure') return now < pressureCooldownUntil;
  return false;
}

function enterCooldown(domain) {
  const until = Date.now() + COOLDOWN_MS;
  if (domain === 'wind') windCooldownUntil = until;
  if (domain === 'marine') marineCooldownUntil = until;
  if (domain === 'pressure') pressureCooldownUntil = until;
  console.warn(`[${domain}] 429 cooldown activated for ${COOLDOWN_MS / 1000}s`);
}

/**
 * Get remaining cooldown time for scheduling retries.
 */
export function getRemainingCooldown(domain) {
  const now = Date.now();
  if (domain === 'wind') return Math.max(0, windCooldownUntil - now);
  if (domain === 'marine') return Math.max(0, marineCooldownUntil - now);
  if (domain === 'pressure') return Math.max(0, pressureCooldownUntil - now);
  return 0;
}

/**
 * Dynamic snapping configurator based on current viewport size.
 * Prevents redundant API requests on minor pans while keeping resolution crisp.
 */
function getSnapConfig(bounds) {
  const lngSpan = Math.abs(bounds.east - bounds.west);
  const latSpan = Math.abs(bounds.north - bounds.south);
  const maxSpan = Math.max(lngSpan, latSpan);

  // v4.2.0: Coarser snapping grid to maximize regional containment cache hits
  if (maxSpan < 4) return { snap: 4.0, padding: 2.0 };
  if (maxSpan < 12) return { snap: 4.0, padding: 2.0 };
  if (maxSpan < 25) return { snap: 8.0, padding: 4.0 };
  return { snap: 16.0, padding: 8.0 };
}

function isViewportInsideCachedBounds(viewport, cached) {
  if (!viewport || !cached) return false;
  let vWest = viewport.west;
  let vEast = viewport.east;
  if (vEast < vWest) vEast += 360;

  let cWest = cached.west;
  let cEast = cached.east;
  if (cEast < cWest) cEast += 360;

  // Clamp viewport latitude to cache range (fixes Polar cache failure when panning near poles)
  const vSouth = Math.max(cached.south, Math.min(cached.north, viewport.south));
  const vNorth = Math.max(cached.south, Math.min(cached.north, viewport.north));

  // Verify full coordinate containment within active cached hourly grid bounds
  const isLatContained = vSouth >= cached.south && vNorth <= cached.north;
  const isLngContained = vWest >= cWest && vEast <= cEast;
  return isLatContained && isLngContained;
}

export function isContainedInWindCache(bounds, model) {
  if (!bounds || !windHourlyCache.bounds || !windHourlyCache.results) return false;
  if (windHourlyCache.model !== (model || 'GFS')) return false;
  if (Date.now() - windHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  return isViewportInsideCachedBounds(bounds, windHourlyCache.bounds);
}

export function isContainedInMarineCache(bounds, model) {
  if (!bounds || !marineHourlyCache.bounds || !marineHourlyCache.results) return false;
  if (marineHourlyCache.model !== (model || 'GFS')) return false;
  if (Date.now() - marineHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  return isViewportInsideCachedBounds(bounds, marineHourlyCache.bounds);
}

export function isContainedInPressureCache(bounds, model) {
  if (!bounds || !pressureHourlyCache.bounds || !pressureHourlyCache.results) return false;
  if (pressureHourlyCache.model !== (model || 'GFS')) return false;
  if (Date.now() - pressureHourlyCache.timestamp >= HOURLY_CACHE_TTL) return false;
  return isViewportInsideCachedBounds(bounds, pressureHourlyCache.bounds);
}

/**
 * Generate a cache key from viewport bounds.
 * Snaps to 0.5-degree precision to allow cache hits on minor pans.
 */
function viewportCacheKey(bounds, prefix) {
  const snap = (v) => Math.round(v * 2) / 2;
  return `${prefix}|${snap(bounds.south)}|${snap(bounds.north)}|${snap(bounds.west)}|${snap(bounds.east)}`;
}

/**
 * v3.8.5: High-density adaptive grid computation.
 * Regional zoom: 3131 = 961 pts at ~0.25 spacing (GFS native resolution)
 * Global zoom: 3131 = 961 pts at ~5.5 spacing (cyclone-scale detail)
 *
 * caller param: wind uses full grid, marine capped at 80 lat (API rejects polar regions)
 */
function computeGridPoints(bounds, caller = 'wind') {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const lngSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  const isGlobal = lngSpan > 180 || latSpan > 90;

  // v4.1.0: Increased grid density for precision wind particle advection.
  // 15×15=225 points (desktop), 9×9=81 points (mobile).
  // Still well under Open-Meteo's 600 weighted calls/min rate limit.
  let west, south, east, north, GRID;
  if (isGlobal) {
    if (caller === 'marine') {
      west = -180; east = 180; south = -80; north = 80;
      GRID = isMobile ? 8 : 14;
    } else if (caller === 'pressure') {
      // Higher density for pressure: 31×31 = 961 points gives ~5.5° resolution globally.
      // Per ECMWF IFS and GFS SLP analysis: synoptic-scale pressure systems
      // (500-2000km diameter, ~5-20° across) need at least 5° resolution to reliably
      // resolve. 961 points is still well under Open-Meteo's 10,000 daily limit.
      west = -180; east = 180; south = -85; north = 85;
      GRID = isMobile ? 16 : 30;
    } else {
      west = -180; east = 180; south = -85; north = 85;
      GRID = isMobile ? 8 : 14;
    }
  } else {
    west = bounds.west; east = bounds.east;
    south = bounds.south; north = bounds.north;
    if (caller === 'marine') {
      GRID = isMobile ? 8 : 14;
    } else if (caller === 'pressure') {
      GRID = isMobile ? 16 : 30;
    } else {
      GRID = isMobile ? 8 : 14;
    }
  }

  const latStep = (north - south) / GRID;
  const lngStep = (east - west) / GRID;
  const points = [];
  for (let yi = 0; yi <= GRID; yi++) {
    for (let xi = 0; xi <= GRID; xi++) {
      let lat = south + yi * latStep;
      let lng = west + xi * lngStep;
      let reqLng = lng;
      while (reqLng > 180) reqLng -= 360;
      while (reqLng < -180) reqLng += 360;
      points.push({
        lat: +lat.toFixed(2),
        reqLng: +reqLng.toFixed(2),
        monotonicLng: +lng.toFixed(2)
      });
    }
  }
  return { points, gridSize: GRID + 1, isGlobal, bounds: { west, south, east, north } };
}

// safeNum and getUV are defined at top of file (above hydration code)

// ========================================================================
// EXTRACT WIND DATA AT A GIVEN HOUR OFFSET (from pre-fetched hourly cache)
// This is the critical function that eliminates timeline API calls.
// ========================================================================
function extractWindAtOffset(cache, hourOffset) {
  const { results, points, gridSize, bounds } = cache;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;

  const speedUnit = results[0]?.hourly_units?.wind_speed_10m || 'km/h';

  const vectors = [];
  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      // Always push a zero vector to maintain grid density (vectors.length === cols*rows)
      vectors.push({ lat: pt.lat, lng: pt.monotonicLng, speed: 0, direction: 0, u: 0, v: 0 });
      return;
    }
    let speed = r.hourly.wind_speed_10m?.[idx];
    const dir = r.hourly.wind_direction_10m?.[idx];
    if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) {
      vectors.push({ lat: pt.lat, lng: pt.monotonicLng, speed: 0, direction: 0, u: 0, v: 0 });
      return;
    }
    // Mathematically normalize wind speed to knots
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
  const sample = vectors[0];
  console.log(`[Wind] Timeline re-index: offset=${hourOffset}h, idx=${idx}, ${vectors.length} vectors, sample: speed=${sample.speed.toFixed(1)}`);
  return {
    vectors, bounds, cols: gridSize, rows: gridSize,
    stale: false, source: cache.model || 'GFS', hourOffset
  };
}

function extractPressureAtOffset(cache, hourOffset) {
  const { results, points, gridSize, bounds } = cache;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;

  const pressures = [];
  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      pressures.push({ lat: pt.lat, lng: pt.monotonicLng, pressure: 1013 });
      return;
    }
    const pressure = r.hourly.pressure_msl?.[idx];
    if (pressure == null || isNaN(pressure)) {
      pressures.push({ lat: pt.lat, lng: pt.monotonicLng, pressure: 1013 });
      return;
    }
    pressures.push({ lat: pt.lat, lng: pt.monotonicLng, pressure });
  });

  if (pressures.length === 0) return null;
  const sample = pressures[0];
  console.log(`[Pressure] Timeline re-index: offset=${hourOffset}h, idx=${idx}, ${pressures.length} pressures, sample: pressure=${sample.pressure.toFixed(1)}`);
  return {
    pressures, bounds, cols: gridSize, rows: gridSize,
    stale: false, source: cache.model || 'GFS', hourOffset
  };
}

/** Public accessor for the wind hourly cache (used by WeatherEngine timeline scrub) */
export function getWindHourlyCache() {
  return windHourlyCache;
}

export function getMarineHourlyCache() {
  return marineHourlyCache;
}

export function getPressureHourlyCache() {
  return pressureHourlyCache;
}

/** Public re-index function for timeline scrub (zero API calls) */
export { extractWindAtOffset, extractMarineAtOffset, extractPressureAtOffset };

// ========================================================================
// WIND FETCH
// v3.9.3: Pre-fetches 72h hourly data. Timeline scrub re-indexes locally.
// Logs every decision point. Returns null explicitly on first-load failure
// so the caller (WeatherEngine) knows to retry.
// ========================================================================
export async function fetchWindData(bounds, signal, hourOffset = 0, forceFetch = false, forecastDays = 3, model = null) {
  if (!bounds) { console.log('[Wind] fetchWindData: no bounds'); return lastKnownGoodWind; }

  // Viewport containment caching hit (0ms load from memory)
  if (!forceFetch && isContainedInWindCache(bounds, model)) {
    console.log(`[Wind] Viewport containment HIT: zero-API pan served instantly from memory`);
    return extractWindAtOffset(windHourlyCache, hourOffset);
  }

 // Inflight lock but DON'T return null on first load, return lastKnownGood
  if (windRequestInFlight) {
    console.log('[Wind] fetchWindData: request already inflight, returning cached');
    return lastKnownGoodWind;
  }

  // 429 cooldown check (bypassable by timeline forceFetch)
  if (!forceFetch && isInCooldown('wind')) {
    console.log(`[Wind] fetchWindData: in 429 cooldown, returning cached`);
    return lastKnownGoodWind;
  }

  // Adjust for Antimeridian / Pacific wrap (ensure east is always greater than west)
  let west = bounds.west;
  let east = bounds.east;
  if (east < west) {
    east += 360;
  }

  // Snap bounds
  const { snap, padding } = getSnapConfig(bounds);
  const latMinRaw = Math.floor((bounds.south - padding) / snap) * snap;
  const latMaxRaw = Math.ceil((bounds.north + padding) / snap) * snap;
  const lngMin = Math.floor((west - padding) / snap) * snap;
  const lngMax = Math.ceil((east + padding) / snap) * snap;

  // Clamp requested latitudes to Open-Meteo weather API limits [-85, 85]
  const latMin = Math.max(-85, Math.min(85, latMinRaw));
  const latMax = Math.max(-85, Math.min(85, latMaxRaw));

  if (latMax <= latMin || lngMax <= lngMin) return lastKnownGoodWind;

  const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };

  // v3.9.1: Hourly cache re-index locally instead of making new API call
  // Cache key now includes model so GFS/EURO/ICON don't collide
  const viewHash = viewportCacheKey(snappedBounds, `wind_${model || 'GFS'}`);
  if (windHourlyCache.hash === viewHash &&
      windHourlyCache.model === (model || 'GFS') &&
      Date.now() - windHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    // Exact cache hit: extract data at the requested offset without API call
    console.log(`[Wind] Cache HIT for offset=${hourOffset}h, model=${model || 'GFS'}`);
    return extractWindAtOffset(windHourlyCache, hourOffset);
  }

  // v3.9.5: Stale viewport fallback only if same model
  if (windHourlyCache.hash && windHourlyCache.model === (model || 'GFS') &&
      Date.now() - windHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractWindAtOffset(windHourlyCache, hourOffset);
    if (staleData && staleData.vectors.length > 0) {
      console.log(`[Wind] Stale cache served (viewport mismatch) ${staleData.vectors.length} vectors`);
      lastKnownGoodWind = staleData;
    }
  }

  // Per-offset cache (covers initial load + exact re-visits)
  const cacheKey = viewportCacheKey(snappedBounds, `wind_${model || 'GFS'}_h${hourOffset}`);
  if (WIND_CACHE.has(cacheKey)) {
    const cached = WIND_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) {
      console.log('[Wind] Per-offset cache hit');
      return cached.data;
    }
  }

  if (windAbortController) windAbortController.abort();
  windAbortController = new AbortController();
  const fetchSignal = signal || windAbortController.signal;
  windRequestInFlight = true;

  try {
    const { points, gridSize, bounds: gridBounds } = computeGridPoints(snappedBounds);
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.reqLng);

    // Open-Meteo model identifiers
    const OM_MODELS = { GFS: 'gfs_seamless', EURO: 'ecmwf_ifs', ICON: 'dwd_icon' };

    console.log(`[Wind] POST via proxy: ${points.length} grid points, forecast_days=${forecastDays}, model=${model || 'GFS'}`);

    const body = {
      latitude: lats, longitude: lons,
      wind_speed_unit: 'kn',
      hourly: ['wind_speed_10m', 'wind_direction_10m'],
      forecast_days: forecastDays
    };
    // Add explicit model parameter (enforce global GFS/EURO/ICON explicitly)
    if (model && OM_MODELS[model]) {
      body.models = [OM_MODELS[model]];
    }

    // v3.9.6: Proxy-first, direct fallback
    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'wind', body }),
        signal: fetchSignal
      });
      if (!res.ok) {
        throw new Error(`Proxy returned HTTP ${res.status}`);
      }
      if (res.headers.get('X-Cache') === 'HIT') {
        console.log(`[Wind] Proxy cache HIT (age: ${res.headers.get('X-Cache-Age')}s)`);
      }
    } catch (proxyErr) {
      if (isLocalhost) {
        console.log('[Wind] Proxy unavailable or error, direct API fallback:', proxyErr.message);
        res = await fetch('https://api.open-meteo.com/v1/forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: fetchSignal
        });
      } else {
        console.error('[Wind] Proxy error, direct fallback skipped in production/dev:', proxyErr.message);
        throw proxyErr;
      }
    }

    if (!res.ok) {
      if (res.status === 429) {
        enterCooldown('wind');
 console.warn(`[Wind] 429 rate limited cooldown active`);
        return lastKnownGoodWind;
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    let results = Array.isArray(json) ? json
      : (json?.hourly ? points.map(() => json) : null);
    if (!results) { console.warn('[Wind] Unexpected API response shape'); return lastKnownGoodWind; }

    // Cache the full hourly response for local timeline re-indexing
    windHourlyCache = {
      hash: viewHash, results, points, gridSize,
      bounds: gridBounds,
      timestamp: Date.now(),
      model: model || 'GFS'
    };
    persistCache(LS_WIND_KEY, windHourlyCache);

    const data = extractWindAtOffset(windHourlyCache, hourOffset);
    if (data) {
      WIND_CACHE.set(cacheKey, { data, timestamp: Date.now() });
      lastKnownGoodWind = data;
 if (BOOTSTRAP_WIND) { BOOTSTRAP_WIND = false; console.log('[Wind] BOOTSTRAP complete first valid data received'); }
      console.log(`[Wind] Fetch success: ${data.vectors.length} vectors, ${gridSize}x${gridSize} grid, offset: ${hourOffset}h`);
      return data;
    } else {
      console.warn('[Wind] Zero valid vectors from API');
      return lastKnownGoodWind;
    }
  } catch (err) {
    if (err.name === 'AbortError') return lastKnownGoodWind;
    console.error(`[Wind] Fetch failed: ${err.message}`);
    return lastKnownGoodWind;
  } finally {
    windRequestInFlight = false;
  }
}

// ========================================================================
// EXTRACT MARINE DATA AT A GIVEN HOUR OFFSET (from pre-fetched hourly cache)
// ========================================================================
function extractMarineAtOffset(cache, hourOffset) {
  const { results, points, gridSize, bounds } = cache;
  const timeArray = results[0]?.hourly?.time;
  const targetMs = Date.now() + hourOffset * 3600000;
  const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;

  const activeModel = cache.model || 'GFS';
  const gridVectors = [];
  const features = [];

  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0 }, swell_1: { u: 0, v: 0, speed: 0 },
        swell_2: { u: 0, v: 0, speed: 0 }, wind_waves: { u: 0, v: 0, speed: 0 },
        isOcean: false });
      return;
    }
    const c = {
      wave_height: r.hourly.wave_height?.[idx], wave_direction: r.hourly.wave_direction?.[idx],
      wave_period: r.hourly.wave_period?.[idx],
      swell_wave_height: r.hourly.swell_wave_height?.[idx], swell_wave_direction: r.hourly.swell_wave_direction?.[idx],
      swell_wave_period: r.hourly.swell_wave_period?.[idx],
      secondary_swell_wave_height: r.hourly.secondary_swell_wave_height?.[idx],
      secondary_swell_wave_direction: r.hourly.secondary_swell_wave_direction?.[idx],
      secondary_swell_wave_period: r.hourly.secondary_swell_wave_period?.[idx],
      wind_wave_height: r.hourly.wind_wave_height?.[idx], wind_wave_direction: r.hourly.wind_wave_direction?.[idx],
      wind_wave_period: r.hourly.wind_wave_period?.[idx],
    };
    const w_h = safeNum(c.wave_height), w_d = safeNum(c.wave_direction);
    const s1_h = safeNum(c.swell_wave_height != null ? c.swell_wave_height : (activeModel === 'EURO' ? c.wave_height : 0)), 
          s1_d = safeNum(c.swell_wave_direction != null ? c.swell_wave_direction : (activeModel === 'EURO' ? c.wave_direction : 0));
    const s2_h = safeNum(c.secondary_swell_wave_height != null ? c.secondary_swell_wave_height : 0), 
          s2_d = safeNum(c.secondary_swell_wave_direction != null ? c.secondary_swell_wave_direction : 0);
    const ww_h = safeNum(c.wind_wave_height != null ? c.wind_wave_height : (activeModel === 'EURO' ? c.wave_height : 0)), 
          ww_d = safeNum(c.wind_wave_direction != null ? c.wind_wave_direction : (activeModel === 'EURO' ? c.wave_direction : 0));

    const w_h_raw = r.hourly.wave_height?.[idx];
    const isOcean = (w_h_raw !== null && w_h_raw !== undefined);

    if (w_h === 0 && s1_h === 0 && ww_h === 0) {
      gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0 }, swell_1: { u: 0, v: 0, speed: 0 },
        swell_2: { u: 0, v: 0, speed: 0 }, wind_waves: { u: 0, v: 0, speed: 0 },
        isOcean });
      return;
    }

    gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
      waves: getUV(w_h, w_d), swell_1: getUV(s1_h, s1_d),
      swell_2: getUV(s2_h, s2_d), wind_waves: getUV(ww_h, ww_d),
      isOcean });

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pt.monotonicLng, pt.lat] },
      properties: {
        wave_height: w_h, wave_period: safeNum(c.wave_period), wave_direction: w_d,
        swell_wave_height: s1_h, swell_wave_period: safeNum(c.swell_wave_period != null ? c.swell_wave_period : (activeModel === 'EURO' ? c.wave_period : null)), swell_wave_direction: s1_h > 0 ? s1_d : null,
        secondary_swell_wave_height: s2_h, secondary_swell_wave_period: safeNum(c.secondary_swell_wave_period != null ? c.secondary_swell_wave_period : null), secondary_swell_wave_direction: s2_h > 0 ? s2_d : null,
        wind_wave_height: ww_h, wind_wave_period: safeNum(c.wind_wave_period != null ? c.wind_wave_period : (activeModel === 'EURO' ? c.wave_period : null)), wind_wave_direction: ww_h > 0 ? ww_d : null,
      },
    });
  });

  if (features.length === 0) return null;
  return {
    type: 'FeatureCollection', features,
    grid: { vectors: gridVectors, bounds, cols: gridSize, rows: gridSize, timestamp: Date.now() }
  };
}

// ========================================================================
// MARINE FETCH
// v3.9.1: Pre-fetches 72h hourly data. Timeline scrub re-indexes locally.
// ========================================================================
export async function fetchMarineData(bounds, zoom, signal, hourOffset = 0, forceFetch = false, model = null) {
  if (!bounds) return lastKnownGoodMarine;

  // Viewport containment caching hit (0ms load from memory)
  if (!forceFetch && isContainedInMarineCache(bounds, model)) {
    console.log(`[Marine] Viewport containment HIT: zero-API pan served instantly from memory`);
    return extractMarineAtOffset(marineHourlyCache, hourOffset);
  }

  if (marineRequestInFlight) {
    console.log('[Marine] fetchMarineData: request inflight, returning cached');
    return lastKnownGoodMarine;
  }
  if (!forceFetch && isInCooldown('marine')) {
    console.log('[Marine] fetchMarineData: in cooldown, returning cached');
    return lastKnownGoodMarine;
  }

  // Adjust for Antimeridian / Pacific wrap (ensure east is always greater than west)
  let west = bounds.west;
  let east = bounds.east;
  if (east < west) {
    east += 360;
  }

  // Snap bounds dynamically
  const { snap, padding } = getSnapConfig(bounds);
  const latMinRaw = Math.floor((bounds.south - padding) / snap) * snap;
  const latMaxRaw = Math.ceil((bounds.north + padding) / snap) * snap;
  const lngMin = Math.floor((west - padding) / snap) * snap;
  const lngMax = Math.ceil((east + padding) / snap) * snap;

  // Clamp requested latitudes to Open-Meteo marine API limits [-80, 80]
  // v3.10.0: Clamp to guarantee a 0.5 deg span so polar fetches never hit equal-clamped latMax <= latMin early exits.
  let latMin = Math.max(-80, Math.min(79.5, latMinRaw));
  let latMax = Math.max(-79.5, Math.min(80, latMaxRaw));
  if (latMax <= latMin) {
    latMin = -80;
    latMax = 80;
  }

  if (lngMax <= lngMin) return lastKnownGoodMarine;

  const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };

  // v3.9.3: Hourly cache re-index locally snaped to active model to avoid collisions
  const viewHash = viewportCacheKey(snappedBounds, `marine_${model || 'GFS'}`);
  if (marineHourlyCache.hash === viewHash &&
      marineHourlyCache.model === (model || 'GFS') &&
      Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    console.log(`[Marine] Cache HIT for offset=${hourOffset}h, model=${model || 'GFS'}`);
    return extractMarineAtOffset(marineHourlyCache, hourOffset);
  }

  // v3.9.5: Stale viewport fallback for marine snap to model
  if (marineHourlyCache.hash && marineHourlyCache.model === (model || 'GFS') &&
      Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractMarineAtOffset(marineHourlyCache, hourOffset);
    if (staleData && staleData.features?.length > 0) {
      console.log(`[Marine] Stale cache served (viewport mismatch) ${staleData.features.length} features`);
      lastKnownGoodMarine = staleData;
    }
  }

  // Per-offset cache
  const cacheKey = viewportCacheKey(snappedBounds, `marine_${model || 'GFS'}_h${hourOffset}`);
  if (MARINE_CACHE.has(cacheKey)) {
    const cached = MARINE_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) return cached.data;
  }

  if (marinAbortController) marinAbortController.abort();
  marinAbortController = new AbortController();
  const fetchSignal = signal || marinAbortController.signal;
  marineRequestInFlight = true;

  try {
    const { points, gridSize, bounds: gridBounds } = computeGridPoints(snappedBounds, 'marine');
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.reqLng);

    // Open-Meteo model identifiers for Marine: GFS maps to ncep_gfswave025, ICON maps to gwam, EURO maps to ecmwf_wam025
    const MARINE_OM_MODELS = { GFS: 'ncep_gfswave025', ICON: 'gwam', EURO: 'ecmwf_wam025' };

    // Authoritative mapping of supported marine variables per model to prevent 400s and minimize payload
    const MODEL_SUPPORTED_VARS = {
      'ncep_gfswave025': [
        'wave_height', 'wave_direction', 'wave_period',
        'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
        'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
        'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
      ],
      'gwam': [
        'wave_height', 'wave_direction', 'wave_period',
        'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
        'wind_wave_height', 'wind_wave_direction', 'wind_wave_period'
      ],
      'ecmwf_wam025': [
        'wave_height', 'wave_direction', 'wave_period'
      ]
    };

    const apiModel = (model && MARINE_OM_MODELS[model]) ? MARINE_OM_MODELS[model] : 'ncep_gfswave025';
    const marineVarList = MODEL_SUPPORTED_VARS[apiModel] || MODEL_SUPPORTED_VARS['ncep_gfswave025'];
    const body = { latitude: lats, longitude: lons, hourly: marineVarList, forecast_days: 3 };

    if (model && MARINE_OM_MODELS[model]) {
      body.models = [MARINE_OM_MODELS[model]];
    }

    // v3.9.6: Proxy-first, direct fallback
    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'marine', body }),
        signal: fetchSignal
      });
      if (!res.ok) {
        throw new Error(`Proxy returned HTTP ${res.status}`);
      }
      if (res.headers.get('X-Cache') === 'HIT') {
        console.log(`[Marine] Proxy cache HIT (age: ${res.headers.get('X-Cache-Age')}s)`);
      }
    } catch (proxyErr) {
      if (isLocalhost) {
        console.log('[Marine] Proxy unavailable or error, direct API fallback:', proxyErr.message);
        res = await fetch('https://marine-api.open-meteo.com/v1/marine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: fetchSignal
        });
      } else {
        console.error('[Marine] Proxy error, direct fallback skipped in production/dev:', proxyErr.message);
        throw proxyErr;
      }
    }

    if (!res.ok) {
      if (res.status === 429) { enterCooldown('marine'); return lastKnownGoodMarine; }
      console.error(`[Marine] Fetch failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    let allResults = Array.isArray(data) ? data
      : (data?.hourly ? points.map(() => data) : null);
    if (!allResults) { console.warn('[Marine] Unexpected API response shape'); return lastKnownGoodMarine; }

    // Cache full hourly response
    marineHourlyCache = {
      hash: viewHash, results: allResults, points, gridSize,
      bounds: gridBounds, timestamp: Date.now(),
      model: model || 'GFS'
    };
    persistCache(LS_MARINE_KEY, marineHourlyCache);

    const result = extractMarineAtOffset(marineHourlyCache, hourOffset);
    if (result) {
      MARINE_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
      lastKnownGoodMarine = result;
 if (BOOTSTRAP_MARINE) { BOOTSTRAP_MARINE = false; console.log('[Marine] BOOTSTRAP complete first valid data received'); }
      console.log(`[Marine] Fetch success: ${result.features.length} features, ${gridSize}x${gridSize} grid`);
      return result;
    } else {
      console.warn('[Marine] Zero valid features from API');
      return lastKnownGoodMarine;
    }
  } catch (err) {
    if (err.name === 'AbortError') return lastKnownGoodMarine;
    console.error(`[Marine] Fetch failed: ${err.message}`);
    return lastKnownGoodMarine;
  } finally {
    marineRequestInFlight = false;
  }
}

export async function fetchPressureData(bounds, signal, hourOffset = 0, forceFetch = false, forecastDays = 3, model = null) {
  if (!bounds) { console.log('[Pressure] fetchPressureData: no bounds'); return lastKnownGoodPressure; }

  // Zero-API scrubbing guard: Bypasses fetches during active timeline scrubbing
  if (window.isScrubbingTimeline === true && !forceFetch) {
    console.log(`[Pressure] Timeline scrubbing active: serving cache at offset=${hourOffset}h`);
    return extractPressureAtOffset(pressureHourlyCache, hourOffset);
  }

  // Viewport containment caching hit (0ms load from memory)
  if (!forceFetch && isContainedInPressureCache(bounds, model)) {
    console.log(`[Pressure] Viewport containment HIT: zero-API pan served instantly from memory`);
    return extractPressureAtOffset(pressureHourlyCache, hourOffset);
  }

  // Inflight lock
  if (pressureRequestInFlight) {
    console.log('[Pressure] fetchPressureData: request already inflight, returning cached');
    return lastKnownGoodPressure;
  }

  // 429 cooldown check
  if (!forceFetch && isInCooldown('pressure')) {
    console.log(`[Pressure] fetchPressureData: in 429 cooldown, returning cached`);
    return lastKnownGoodPressure;
  }

  // Adjust for Antimeridian / Pacific wrap
  let west = bounds.west;
  let east = bounds.east;
  if (east < west) {
    east += 360;
  }

  // Snap bounds
  const { snap, padding } = getSnapConfig(bounds);
  const latMinRaw = Math.floor((bounds.south - padding) / snap) * snap;
  const latMaxRaw = Math.ceil((bounds.north + padding) / snap) * snap;
  const lngMin = Math.floor((west - padding) / snap) * snap;
  const lngMax = Math.ceil((east + padding) / snap) * snap;

  // Clamp requested latitudes to Open-Meteo weather API limits [-85, 85]
  const latMin = Math.max(-85, Math.min(85, latMinRaw));
  const latMax = Math.max(-85, Math.min(85, latMaxRaw));

  if (latMax <= latMin || lngMax <= lngMin) return lastKnownGoodPressure;

  const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };

  const viewHash = viewportCacheKey(snappedBounds, `pressure_${model || 'GFS'}`);
  if (pressureHourlyCache.hash === viewHash &&
      pressureHourlyCache.model === (model || 'GFS') &&
      Date.now() - pressureHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    console.log(`[Pressure] Cache HIT for offset=${hourOffset}h, model=${model || 'GFS'}`);
    return extractPressureAtOffset(pressureHourlyCache, hourOffset);
  }

  // Stale viewport fallback only if same model
  if (pressureHourlyCache.hash && pressureHourlyCache.model === (model || 'GFS') &&
      Date.now() - pressureHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractPressureAtOffset(pressureHourlyCache, hourOffset);
    if (staleData && staleData.pressures.length > 0) {
      console.log(`[Pressure] Stale cache served (viewport mismatch) ${staleData.pressures.length} pressures`);
      lastKnownGoodPressure = staleData;
    }
  }

  // Per-offset cache
  const cacheKey = viewportCacheKey(snappedBounds, `pressure_${model || 'GFS'}_h${hourOffset}`);
  if (PRESSURE_CACHE.has(cacheKey)) {
    const cached = PRESSURE_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) {
      console.log('[Pressure] Per-offset cache hit');
      return cached.data;
    }
  }

  if (pressureAbortController) pressureAbortController.abort();
  pressureAbortController = new AbortController();
  const fetchSignal = signal || pressureAbortController.signal;
  pressureRequestInFlight = true;

  try {
    const { points, gridSize, bounds: gridBounds } = computeGridPoints(snappedBounds, 'pressure');
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.reqLng);

    // Open-Meteo model identifiers
    const OM_MODELS = { GFS: 'gfs_seamless', EURO: 'ecmwf_ifs', ICON: 'dwd_icon' };

    console.log(`[Pressure] POST via proxy: ${points.length} grid points, forecast_days=${forecastDays}, model=${model || 'GFS'}`);

    const body = {
      latitude: lats, longitude: lons,
      hourly: ['pressure_msl'],
      forecast_days: forecastDays
    };
    if (model && OM_MODELS[model]) {
      body.models = [OM_MODELS[model]];
    }

    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'wind', body }),  // 'wind' routes to api.open-meteo.com/v1/forecast which also serves pressure_msl
        signal: fetchSignal
      });
      if (!res.ok) {
        throw new Error(`Proxy returned HTTP ${res.status}`);
      }
    } catch (proxyErr) {
      if (isLocalhost) {
        console.log('[Pressure] Proxy unavailable or error, direct API fallback:', proxyErr.message);
        res = await fetch('https://api.open-meteo.com/v1/forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: fetchSignal
        });
      } else {
        console.error('[Pressure] Proxy error, direct fallback skipped in production/dev:', proxyErr.message);
        throw proxyErr;
      }
    }

    if (!res.ok) {
      if (res.status === 429) {
        enterCooldown('pressure');
        return lastKnownGoodPressure;
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    let results = Array.isArray(json) ? json
      : (json?.hourly ? points.map(() => json) : null);
    if (!results) { console.warn('[Pressure] Unexpected API response shape'); return lastKnownGoodPressure; }

    pressureHourlyCache = {
      hash: viewHash, results, points, gridSize,
      bounds: gridBounds,
      timestamp: Date.now(),
      model: model || 'GFS'
    };
    persistCache(LS_PRESSURE_KEY, pressureHourlyCache);

    const data = extractPressureAtOffset(pressureHourlyCache, hourOffset);
    if (data) {
      PRESSURE_CACHE.set(cacheKey, { data, timestamp: Date.now() });
      lastKnownGoodPressure = data;
      if (BOOTSTRAP_PRESSURE) { BOOTSTRAP_PRESSURE = false; console.log('[Pressure] BOOTSTRAP complete first valid data received'); }
      console.log(`[Pressure] Fetch success: ${data.pressures.length} pressures, ${gridSize}x${gridSize} grid, offset: ${hourOffset}h`);
      return data;
    } else {
      console.warn('[Pressure] Zero valid pressures from API');
      return lastKnownGoodPressure;
    }
  } catch (err) {
    if (err.name === 'AbortError') return lastKnownGoodPressure;
    console.error(`[Pressure] Fetch failed: ${err.message}`);
    return lastKnownGoodPressure;
  } finally {
    pressureRequestInFlight = false;
  }
}
