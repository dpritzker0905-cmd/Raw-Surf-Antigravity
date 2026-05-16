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

// --- CACHES ---
const MARINE_CACHE = new Map();
const WIND_CACHE = new Map();

// --- LAST KNOWN GOOD FIELDS ---
// Start null. Only populated after a SUCCESSFUL API response.
// null means 'never had data' — callers must handle this.
let lastKnownGoodWind = null;
let lastKnownGoodMarine = null;

// --- 429 COOLDOWN STATE ---
let windCooldownUntil = 0;
let marineCooldownUntil = 0;
const COOLDOWN_MS = 120000; // 2 minutes per contract

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
 * v3.5: Adaptive grid computation.
 * Global zoom (viewport > 100°): 8×8 grid covering full globe
 * Regional zoom: 7×7 grid across viewport
 * URL length safe — single request up to 64 points.
 */
function computeGridPoints(bounds) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const lngSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  const isGlobal = lngSpan > 100 || latSpan > 60;

  // Global: fixed worldwide grid. Regional: viewport grid.
  let west, south, east, north, GRID;
  if (isGlobal) {
    west = -180; east = 180; south = -78; north = 78;
    GRID = isMobile ? 5 : 7; // 8x8 = 64 pts (URL safe)
  } else {
    west = bounds.west; east = bounds.east;
    south = bounds.south; north = bounds.north;
    GRID = isMobile ? 4 : 6;
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
// WIND FETCH
// ========================================================================
export async function fetchWindData(bounds, signal) {
  if (!bounds) return lastKnownGoodWind;
  if (windRequestInFlight) {
    console.warn('[Wind] INFLIGHT_VIOLATION: request already active');
    return lastKnownGoodWind;
  }

  // 429 cooldown check
  if (isInCooldown('wind')) {
    console.log('[Wind] In 429 cooldown, returning cached field');
    return lastKnownGoodWind;
  }

  const { west, south, east, north } = bounds;
  if (north <= south || east === west) return lastKnownGoodWind;

  // Cache-first: check before any network request
  const cacheKey = viewportCacheKey(bounds, 'wind');
  if (WIND_CACHE.has(cacheKey)) {
    const cached = WIND_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) { // 5 min TTL
      return cached.data;
    }
  }

  // Cancel previous inflight request
  if (windAbortController) {
    windAbortController.abort();
  }
  windAbortController = new AbortController();
  const fetchSignal = signal || windAbortController.signal;

  windRequestInFlight = true;

  try {
    const { points, gridSize } = computeGridPoints(bounds);
    const lats = points.map(p => p.lat).join(',');
    const lons = points.map(p => p.reqLng).join(',');

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&forecast_days=1&wind_speed_unit=kn`,
      { signal: fetchSignal }
    );

    if (!res.ok) {
      if (res.status === 429) {
        enterCooldown('wind');
        return lastKnownGoodWind; // Preserve last valid field
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();

    // Normalize response (single vs multi-point)
    let results;
    if (Array.isArray(json)) {
      results = json;
    } else if (json?.current) {
      results = points.map(() => json);
    } else {
      console.warn('[Wind] Unexpected API response shape');
      return lastKnownGoodWind;
    }

    const vectors = [];
    points.forEach((pt, i) => {
      const r = results[i];
      if (!r?.current) return;
      const speed = r.current.wind_speed_10m;
      const dir = r.current.wind_direction_10m;
      if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) return;
      const rad = dir * (Math.PI / 180);
      vectors.push({
        lat: pt.lat, lng: pt.monotonicLng, speed, direction: dir,
        u: -speed * Math.sin(rad), v: -speed * Math.cos(rad)
      });
    });

    if (vectors.length > 0) {
      const data = {
        vectors,
        bounds: { west, south, east, north },
        cols: gridSize,
        rows: gridSize,
        stale: false,
        source: 'network'
      };
      // Update caches
      WIND_CACHE.set(cacheKey, { data, timestamp: Date.now() });
      lastKnownGoodWind = data;
      if (BOOTSTRAP_WIND) {
        BOOTSTRAP_WIND = false;
        console.log('[Wind] BOOTSTRAP complete \u2014 first valid data received');
      }
      console.log(`[Wind] Fetch success: ${vectors.length} vectors, ${gridSize}x${gridSize} grid`);
      return data;
    } else {
      console.warn('[Wind] Zero valid vectors from API');
      return lastKnownGoodWind;
    }
  } catch (err) {
    if (err.name === 'AbortError') return lastKnownGoodWind;
    console.error(`[Wind] Fetch failed: ${err.message}`);
    return lastKnownGoodWind; // NEVER return null, preserve last valid
  } finally {
    windRequestInFlight = false;
  }
}

// ========================================================================
// MARINE FETCH
// ========================================================================
export async function fetchMarineData(bounds, zoom, signal) {
  if (!bounds) return lastKnownGoodMarine;
  if (marineRequestInFlight) {
    console.warn('[Marine] INFLIGHT_VIOLATION: request already active');
    return lastKnownGoodMarine;
  }

  // 429 cooldown check
  if (isInCooldown('marine')) {
    console.log('[Marine] In 429 cooldown, returning cached field');
    return lastKnownGoodMarine;
  }

  // Snap bounds with moderate padding for cache reuse
  const snap = 10;
  const padding = 5;
  const latMin = Math.max(-80, Math.floor((bounds.south - padding) / snap) * snap);
  const latMax = Math.min(80, Math.ceil((bounds.north + padding) / snap) * snap);
  const lngMin = Math.floor((bounds.west - padding) / snap) * snap;
  const lngMax = Math.ceil((bounds.east + padding) / snap) * snap;

  if (latMax <= latMin || lngMax <= lngMin) return lastKnownGoodMarine;

  // Cache-first
  const cacheKey = viewportCacheKey(
    { west: lngMin, south: latMin, east: lngMax, north: latMax },
    'marine'
  );
  if (MARINE_CACHE.has(cacheKey)) {
    const cached = MARINE_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) { // 5 min TTL
      return cached.data;
    }
  }

  // Cancel previous inflight
  if (marinAbortController) {
    marinAbortController.abort();
  }
  marinAbortController = new AbortController();
  const fetchSignal = signal || marinAbortController.signal;

  marineRequestInFlight = true;

  try {
    const snappedBounds = { west: lngMin, south: latMin, east: lngMax, north: latMax };
    const { points, gridSize } = computeGridPoints(snappedBounds);
    const lats = points.map(p => p.lat).join(',');
    const lons = points.map(p => p.reqLng).join(',');

    const res = await fetch(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}` +
      `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period` +
      `,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period` +
      `,wind_wave_height,wind_wave_direction,wind_wave_period`,
      { signal: fetchSignal }
    );

    if (!res.ok) {
      if (res.status === 429) {
        enterCooldown('marine');
        return lastKnownGoodMarine; // Preserve last valid field
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    // Normalize
    let allResults;
    if (Array.isArray(data)) {
      allResults = data;
    } else if (data?.current) {
      allResults = points.map(() => data);
    } else {
      console.warn('[Marine] Unexpected API response shape');
      return lastKnownGoodMarine;
    }

    const gridVectors = [];
    const features = [];

    points.forEach((pt, i) => {
      const r = allResults[i];
      if (!r?.current || !Number.isFinite(pt.reqLng) || !Number.isFinite(pt.lat)) {
        gridVectors.push({
          lat: pt.lat, lng: pt.monotonicLng,
          waves: { u: 0, v: 0, speed: 0 },
          swell_1: { u: 0, v: 0, speed: 0 },
          swell_2: { u: 0, v: 0, speed: 0 },
          wind_waves: { u: 0, v: 0, speed: 0 }
        });
        return;
      }
      const c = r.current;
      const w_h = safeNum(c.wave_height), w_d = safeNum(c.wave_direction);
      const s1_h = safeNum(c.swell_wave_height), s1_d = safeNum(c.swell_wave_direction);
      const s2_h = safeNum(c.secondary_swell_wave_height), s2_d = safeNum(c.secondary_swell_wave_direction);
      const ww_h = safeNum(c.wind_wave_height), ww_d = safeNum(c.wind_wave_direction);

      if (w_h === 0 && s1_h === 0 && ww_h === 0) {
        gridVectors.push({
          lat: pt.lat, lng: pt.monotonicLng,
          waves: { u: 0, v: 0, speed: 0 },
          swell_1: { u: 0, v: 0, speed: 0 },
          swell_2: { u: 0, v: 0, speed: 0 },
          wind_waves: { u: 0, v: 0, speed: 0 }
        });
        return;
      }

      gridVectors.push({
        lat: pt.lat, lng: pt.monotonicLng,
        waves: getUV(w_h, w_d),
        swell_1: getUV(s1_h, s1_d),
        swell_2: getUV(s2_h, s2_d),
        wind_waves: getUV(ww_h, ww_d)
      });

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

    if (features.length > 0) {
      const marinePayload = {
        type: 'FeatureCollection',
        features,
        grid: {
          vectors: gridVectors,
          bounds: snappedBounds,
          cols: gridSize,
          rows: gridSize,
          timestamp: Date.now()
        }
      };
      MARINE_CACHE.set(cacheKey, { data: marinePayload, timestamp: Date.now() });
      lastKnownGoodMarine = marinePayload;
      if (BOOTSTRAP_MARINE) {
        BOOTSTRAP_MARINE = false;
        console.log('[Marine] BOOTSTRAP complete \u2014 first valid data received');
      }
      console.log(`[Marine] Fetch success: ${features.length} features, ${gridSize}x${gridSize} grid`);
      return marinePayload;
    } else {
      console.warn('[Marine] Zero valid features from API');
      return lastKnownGoodMarine;
    }
  } catch (err) {
    if (err.name === 'AbortError') return lastKnownGoodMarine;
    console.error(`[Marine] Fetch failed: ${err.message}`);
    return lastKnownGoodMarine; // NEVER return null, preserve last valid
  } finally {
    marineRequestInFlight = false;
  }
}
