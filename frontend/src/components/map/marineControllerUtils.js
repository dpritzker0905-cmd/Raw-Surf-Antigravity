/**
 * marineControllerUtils.js
 * 
 * Shared utility functions and constants for wind, marine, and pressure data fetching.
 * Extracted from marineController.js for LOC compliance.
 */

// --- UTILITY FUNCTIONS ---
export var safeNum = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export var getUV = (speed, dir) => {
  if (speed === 0) return { u: 0, v: 0, speed: 0 };
  const rad = dir * (Math.PI / 180);
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
};

// --- PROXY CONFIG ---
// v3.9.6: Route through Netlify serverless proxy to bypass client IP rate limits
export var PROXY_URL = '/api/weather-proxy';
export var isLocalhost = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('192.168.'));

export function findClosestHourIndex(timeArray, targetMs) {
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

// --- HOURLY DATA CACHE TTL ---
export var HOURLY_CACHE_TTL = 60 * 60 * 1000; // 60 min (long cache to minimize API calls)

// --- PERSISTENT CACHE (localStorage) ---
// Survives page reloads eliminates 429s on revisit
export function persistCache(key, cache) {
  try {
    const slim = { hash: cache.hash, results: cache.results, points: cache.points,
      gridSize: cache.gridSize, bounds: cache.bounds, timestamp: cache.timestamp, model: cache.model, isGlobal: cache.isGlobal };
    localStorage.setItem(key, JSON.stringify(slim));
  } catch (e) { /* localStorage full or unavailable ignore */ }
}

export function hydrateCache(key) {
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

// --- 429 COOLDOWN STATE ---
var windCooldownUntil = 0;
var marineCooldownUntil = 0;
var pressureCooldownUntil = 0;
export var COOLDOWN_MS = 300000; // 5 min cooldown — OpenMeteo free tier has aggressive rate limits

/**
 * Check if we are in 429 cooldown for a given domain.
 */
export function isInCooldown(domain) {
  const now = Date.now();
  if (domain === 'wind') return now < windCooldownUntil;
  if (domain === 'marine') return now < marineCooldownUntil;
  if (domain === 'pressure') return now < pressureCooldownUntil;
  return false;
}

export function enterCooldown(domain) {
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
export function getSnapConfig(bounds) {
  const lngSpan = Math.abs(bounds.east - bounds.west);
  const latSpan = Math.abs(bounds.north - bounds.south);
  const maxSpan = Math.max(lngSpan, latSpan);

  // v4.2.0: Coarser snapping grid to maximize regional containment cache hits
  if (maxSpan < 4) return { snap: 4.0, padding: 2.0 };
  if (maxSpan < 12) return { snap: 4.0, padding: 2.0 };
  if (maxSpan < 25) return { snap: 8.0, padding: 4.0 };
  return { snap: 16.0, padding: 8.0 };
}

export function isViewportInsideCachedBounds(viewport, cached) {
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

/**
 * Generate a cache key from viewport bounds.
 * Snaps to 0.5-degree precision to allow cache hits on minor pans.
 */
export function viewportCacheKey(bounds, prefix) {
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
export function computeGridPoints(bounds, caller = 'wind') {
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
      // v3.13.3: Increased from 14 to 20 for better ocean coverage.
      // 21×21=441 points gives ~18° per cell (was ~25°). Eliminates coverage gaps.
      west = -180; east = 180; south = -85; north = 85;
      GRID = isMobile ? 10 : 20;
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
