/**
 * marineController.js — v3.0.0
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

// --- PROXY CONFIG ---
// v3.9.6: Route through Netlify serverless proxy to bypass client IP rate limits
const PROXY_URL = '/api/weather-proxy';

// --- CACHES ---
const MARINE_CACHE = new Map();
const WIND_CACHE = new Map();

// --- HOURLY DATA CACHE (pre-fetched for timeline scrub) ---
// Stores full API responses keyed by viewport hash so timeline
// changes re-index locally instead of making new API calls.
let windHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0 };
let marineHourlyCache = { hash: null, results: null, points: null, gridSize: 0, bounds: null, timestamp: 0 };
const HOURLY_CACHE_TTL = 30 * 60 * 1000; // 30 min (increased from 10 to reduce API calls)

// --- PERSISTENT CACHE (localStorage) ---
// Survives page reloads — eliminates 429s on revisit
const LS_WIND_KEY = 'rawsurf_wind_cache_v1';
const LS_MARINE_KEY = 'rawsurf_marine_cache_v1';

function persistCache(key, cache) {
  try {
    const slim = { hash: cache.hash, results: cache.results, points: cache.points,
      gridSize: cache.gridSize, bounds: cache.bounds, timestamp: cache.timestamp };
    localStorage.setItem(key, JSON.stringify(slim));
  } catch (e) { /* localStorage full or unavailable — ignore */ }
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
const _hydratedWind = hydrateCache(LS_WIND_KEY);
if (_hydratedWind) {
  windHourlyCache = _hydratedWind;
  console.log(`[Wind] Hydrated from localStorage: ${_hydratedWind.points?.length} pts, age ${Math.round((Date.now() - _hydratedWind.timestamp)/1000)}s`);
}
const _hydratedMarine = hydrateCache(LS_MARINE_KEY);
if (_hydratedMarine) {
  marineHourlyCache = _hydratedMarine;
  console.log(`[Marine] Hydrated from localStorage: ${_hydratedMarine.points?.length} pts, age ${Math.round((Date.now() - _hydratedMarine.timestamp)/1000)}s`);
}

// --- LAST KNOWN GOOD FIELDS ---
// Pre-populated from localStorage hydrated cache if available
let lastKnownGoodWind = _hydratedWind ? extractWindAtOffset(_hydratedWind, 0) : null;
let lastKnownGoodMarine = _hydratedMarine ? extractMarineAtOffset(_hydratedMarine, 0) : null;
if (lastKnownGoodWind) console.log(`[Wind] Pre-populated lastKnownGood: ${lastKnownGoodWind.vectors.length} vectors`);
if (lastKnownGoodMarine) console.log(`[Marine] Pre-populated lastKnownGood: ${lastKnownGoodMarine.features?.length} features`);

// --- 429 COOLDOWN STATE ---
let windCooldownUntil = 0;
let marineCooldownUntil = 0;
const COOLDOWN_MS = 60000; // 60s — longer cooldown to let Open-Meteo rate limit recover

// --- INFLIGHT ABORT CONTROLLERS ---
let windAbortController = null;
let marinAbortController = null;

// --- INFLIGHT LOCKS ---
let windRequestInFlight = false;
let marineRequestInFlight = false;

// --- BOOTSTRAP MODE ---
// First-load safety: always accept first valid response regardless of quality
let BOOTSTRAP_WIND = true;
let BOOTSTRAP_MARINE = true;

/**
 * Check if we are in 429 cooldown for a given domain.
 */
function isInCooldown(domain) {
  const now = Date.now();
  if (domain === 'wind') return now < windCooldownUntil;
  if (domain === 'marine') return now < marineCooldownUntil;
  return false;
}

function enterCooldown(domain) {
  const until = Date.now() + COOLDOWN_MS;
  if (domain === 'wind') windCooldownUntil = until;
  if (domain === 'marine') marineCooldownUntil = until;
  console.warn(`[${domain}] 429 cooldown activated for ${COOLDOWN_MS / 1000}s`);
}

/**
 * Get remaining cooldown time for scheduling retries.
 */
export function getRemainingCooldown(domain) {
  const now = Date.now();
  if (domain === 'wind') return Math.max(0, windCooldownUntil - now);
  if (domain === 'marine') return Math.max(0, marineCooldownUntil - now);
  return 0;
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
 * Regional zoom: 31×31 = 961 pts at ~0.25° spacing (GFS native resolution)
 * Global zoom: 31×31 = 961 pts at ~5.5° spacing (cyclone-scale detail)
 *
 * caller param: wind uses full grid, marine capped at ±80 lat (API rejects polar regions)
 */
function computeGridPoints(bounds, caller = 'wind') {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const lngSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  const isGlobal = lngSpan > 100 || latSpan > 60;

  // v3.9.4: Reduced grid density — Open-Meteo weights POST requests by
  // point count (961 pts ≈ 961 weighted calls, exceeding 600/min limit)
  let west, south, east, north, GRID;
  if (isGlobal) {
    if (caller === 'marine') {
      west = -180; east = 180; south = -80; north = 80;
      GRID = isMobile ? 10 : 16; // 17×17=289 (desktop), 11×11=121 (mobile)
    } else {
      west = -180; east = 180; south = -85; north = 85;
      GRID = isMobile ? 14 : 20; // 21×21=441 (desktop), 15×15=225 (mobile)
    }
  } else {
    west = bounds.west; east = bounds.east;
    south = bounds.south; north = bounds.north;
    if (caller === 'marine') {
      GRID = isMobile ? 8 : 16; // 17×17=289 (desktop), 9×9=81 (mobile)
    } else {
      GRID = isMobile ? 12 : 20; // 21×21=441 (desktop), 13×13=169 (mobile)
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
  return { points, gridSize: GRID + 1, isGlobal };
}

const safeNum = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const getUV = (speed, dir) => {
  if (speed === 0) return { u: 0, v: 0, speed: 0 };
  const rad = dir * (Math.PI / 180);
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
};

// ========================================================================
// EXTRACT WIND DATA AT A GIVEN HOUR OFFSET (from pre-fetched hourly cache)
// This is the critical function that eliminates timeline API calls.
// ========================================================================
function extractWindAtOffset(cache, hourOffset) {
  const { results, points, gridSize, bounds } = cache;
  const nowHour = new Date().getUTCHours();
  const idx = Math.min(nowHour + hourOffset, 71); // max 72h of data (index 0-71)

  const vectors = [];
  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) return;
    const speed = r.hourly.wind_speed_10m?.[idx];
    const dir = r.hourly.wind_direction_10m?.[idx];
    if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) return;
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
    stale: false, source: 'cache', hourOffset
  };
}

// ========================================================================
// WIND FETCH
// v3.9.3: Pre-fetches 72h hourly data. Timeline scrub re-indexes locally.
// Logs every decision point. Returns null explicitly on first-load failure
// so the caller (WeatherEngine) knows to retry.
// ========================================================================
export async function fetchWindData(bounds, signal, hourOffset = 0, forceFetch = false) {
  if (!bounds) { console.log('[Wind] fetchWindData: no bounds'); return lastKnownGoodWind; }

  // Inflight lock — but DON'T return null on first load, return lastKnownGood
  if (windRequestInFlight) {
    console.log('[Wind] fetchWindData: request already inflight, returning cached');
    return lastKnownGoodWind;
  }

  // 429 cooldown check (bypassable by timeline forceFetch)
  if (!forceFetch && isInCooldown('wind')) {
    console.log(`[Wind] fetchWindData: in 429 cooldown, returning cached`);
    return lastKnownGoodWind;
  }

  const { west, south, east, north } = bounds;
  if (north <= south || east === west) return lastKnownGoodWind;

  // v3.9.1: Hourly cache — re-index locally instead of making new API call
  const viewHash = viewportCacheKey(bounds, 'wind');
  if (windHourlyCache.hash === viewHash &&
      Date.now() - windHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    // Exact cache hit: extract data at the requested offset without API call
    console.log(`[Wind] Cache HIT for offset=${hourOffset}h`);
    return extractWindAtOffset(windHourlyCache, hourOffset);
  }

  // v3.9.5: Stale viewport fallback — if we have ANY cached data within TTL
  // (e.g. from localStorage hydration with a different viewport), serve it
  // rather than hitting the API (which may 429). Fresh data fetches in background.
  if (windHourlyCache.hash && Date.now() - windHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractWindAtOffset(windHourlyCache, hourOffset);
    if (staleData && staleData.vectors.length > 0) {
      console.log(`[Wind] Stale cache served (viewport mismatch) — ${staleData.vectors.length} vectors`);
      lastKnownGoodWind = staleData;
      // Don't return yet — let the fetch continue in background for fresh data
    }
  }

  // Per-offset cache (covers initial load + exact re-visits)
  const cacheKey = viewportCacheKey(bounds, `wind_h${hourOffset}`);
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
    const { points, gridSize } = computeGridPoints(bounds);
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.reqLng);

    console.log(`[Wind] POST via proxy: ${points.length} grid points, forecast_days=3`);

    const body = {
      latitude: lats, longitude: lons,
      wind_speed_unit: 'kn',
      hourly: ['wind_speed_10m', 'wind_direction_10m'],
      forecast_days: 3
    };

    // v3.9.6: Proxy-first, direct fallback
    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'wind', body }),
        signal: fetchSignal
      });
      if (res.headers.get('X-Cache') === 'HIT') {
        console.log(`[Wind] Proxy cache HIT (age: ${res.headers.get('X-Cache-Age')}s)`);
      }
    } catch (proxyErr) {
      // Proxy unavailable (e.g. localhost dev) — fall back to direct API
      console.log('[Wind] Proxy unavailable, direct API fallback');
      res = await fetch('https://api.open-meteo.com/v1/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: fetchSignal
      });
    }

    if (!res.ok) {
      if (res.status === 429) {
        enterCooldown('wind');
        console.warn(`[Wind] 429 rate limited — cooldown active`);
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
      bounds: { west, south, east, north },
      timestamp: Date.now()
    };
    persistCache(LS_WIND_KEY, windHourlyCache);

    const data = extractWindAtOffset(windHourlyCache, hourOffset);
    if (data) {
      WIND_CACHE.set(cacheKey, { data, timestamp: Date.now() });
      lastKnownGoodWind = data;
      if (BOOTSTRAP_WIND) { BOOTSTRAP_WIND = false; console.log('[Wind] BOOTSTRAP complete — first valid data received'); }
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
  const nowHour = new Date().getUTCHours();
  const idx = Math.min(nowHour + hourOffset, 71);

  const gridVectors = [];
  const features = [];

  points.forEach((pt, i) => {
    const r = results[i];
    if (!r?.hourly) {
      gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0 }, swell_1: { u: 0, v: 0, speed: 0 },
        swell_2: { u: 0, v: 0, speed: 0 }, wind_waves: { u: 0, v: 0, speed: 0 } });
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
    const s1_h = safeNum(c.swell_wave_height), s1_d = safeNum(c.swell_wave_direction);
    const s2_h = safeNum(c.secondary_swell_wave_height), s2_d = safeNum(c.secondary_swell_wave_direction);
    const ww_h = safeNum(c.wind_wave_height), ww_d = safeNum(c.wind_wave_direction);

    if (w_h === 0 && s1_h === 0 && ww_h === 0) {
      gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
        waves: { u: 0, v: 0, speed: 0 }, swell_1: { u: 0, v: 0, speed: 0 },
        swell_2: { u: 0, v: 0, speed: 0 }, wind_waves: { u: 0, v: 0, speed: 0 } });
      return;
    }

    gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng,
      waves: getUV(w_h, w_d), swell_1: getUV(s1_h, s1_d),
      swell_2: getUV(s2_h, s2_d), wind_waves: getUV(ww_h, ww_d) });

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pt.monotonicLng, pt.lat] },
      properties: {
        wave_height: w_h, wave_period: safeNum(c.wave_period), wave_direction: w_d,
        swell_wave_height: s1_h, swell_wave_period: safeNum(c.swell_wave_period), swell_wave_direction: s1_d,
        secondary_swell_wave_height: s2_h, secondary_swell_wave_period: safeNum(c.secondary_swell_wave_period), secondary_swell_wave_direction: s2_d,
        wind_wave_height: ww_h, wind_wave_period: safeNum(c.wind_wave_period), wind_wave_direction: ww_d,
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
export async function fetchMarineData(bounds, zoom, signal, hourOffset = 0, forceFetch = false) {
  if (!bounds) return lastKnownGoodMarine;
  if (marineRequestInFlight) {
    console.log('[Marine] fetchMarineData: request inflight, returning cached');
    return lastKnownGoodMarine;
  }
  if (!forceFetch && isInCooldown('marine')) {
    console.log('[Marine] fetchMarineData: in cooldown, returning cached');
    return lastKnownGoodMarine;
  }

  // Snap bounds
  const snap = 10, padding = 5;
  const latMin = Math.max(-70, Math.floor((bounds.south - padding) / snap) * snap);
  const latMax = Math.min(70, Math.ceil((bounds.north + padding) / snap) * snap);
  const lngMin = Math.floor((bounds.west - padding) / snap) * snap;
  const lngMax = Math.ceil((bounds.east + padding) / snap) * snap;
  if (latMax <= latMin || lngMax <= lngMin) return lastKnownGoodMarine;

  const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };

  // v3.9.3: Hourly cache — re-index locally (removed hourOffset>0 guard)
  const viewHash = viewportCacheKey(snappedBounds, 'marine');
  if (marineHourlyCache.hash === viewHash &&
      Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    console.log(`[Marine] Cache HIT for offset=${hourOffset}h`);
    return extractMarineAtOffset(marineHourlyCache, hourOffset);
  }

  // v3.9.5: Stale viewport fallback for marine
  if (marineHourlyCache.hash && Date.now() - marineHourlyCache.timestamp < HOURLY_CACHE_TTL) {
    const staleData = extractMarineAtOffset(marineHourlyCache, hourOffset);
    if (staleData && staleData.features?.length > 0) {
      console.log(`[Marine] Stale cache served (viewport mismatch) — ${staleData.features.length} features`);
      lastKnownGoodMarine = staleData;
    }
  }

  // Per-offset cache
  const cacheKey = viewportCacheKey(snappedBounds, `marine_h${hourOffset}`);
  if (MARINE_CACHE.has(cacheKey)) {
    const cached = MARINE_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) return cached.data;
  }

  if (marinAbortController) marinAbortController.abort();
  marinAbortController = new AbortController();
  const fetchSignal = signal || marinAbortController.signal;
  marineRequestInFlight = true;

  try {
    const { points, gridSize } = computeGridPoints(snappedBounds, 'marine');
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.reqLng);

    // v3.9.1: ALWAYS fetch hourly for 3 days (72h)
    const marineVarList = ['wave_height','wave_direction','wave_period',
      'swell_wave_height','swell_wave_direction','swell_wave_period',
      'secondary_swell_wave_height','secondary_swell_wave_direction','secondary_swell_wave_period',
      'wind_wave_height','wind_wave_direction','wind_wave_period'];
    const body = { latitude: lats, longitude: lons, hourly: marineVarList, forecast_days: 3 };

    // v3.9.6: Proxy-first, direct fallback
    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'marine', body }),
        signal: fetchSignal
      });
      if (res.headers.get('X-Cache') === 'HIT') {
        console.log(`[Marine] Proxy cache HIT (age: ${res.headers.get('X-Cache-Age')}s)`);
      }
    } catch (proxyErr) {
      console.log('[Marine] Proxy unavailable, direct API fallback');
      res = await fetch('https://marine-api.open-meteo.com/v1/marine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: fetchSignal
      });
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
      bounds: snappedBounds, timestamp: Date.now()
    };
    persistCache(LS_MARINE_KEY, marineHourlyCache);

    const result = extractMarineAtOffset(marineHourlyCache, hourOffset);
    if (result) {
      MARINE_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
      lastKnownGoodMarine = result;
      if (BOOTSTRAP_MARINE) { BOOTSTRAP_MARINE = false; console.log('[Marine] BOOTSTRAP complete — first valid data received'); }
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
