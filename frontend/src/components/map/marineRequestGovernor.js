/**
 * marineRequestGovernor.js
 *
 * One centralized marine proxy request governor used by all marine fetch paths.
 * Enforces:
 *   - global marine cooldown
 *   - single-flight request deduplication
 *   - grid fetch priority over exact point fetches
 *   - no exact point fetches while a grid fetch is in flight
 *   - no Copernicus requests while a previous Copernicus request is in flight
 *   - recent failure TTL per request key (30s)
 *   - Copernicus 502 failure cooldown TTL (30s)
 */

import { isInCooldown, enterCooldown } from './marineControllerUtils';

// Global ledger tracking last 50 attempted requests
if (typeof window !== 'undefined') {
  if (!window.__MARINE_PROXY_LEDGER__) {
    window.__MARINE_PROXY_LEDGER__ = [];
  }
}

// In-flight requests registry: requestKey -> Promise
const inFlightRequests = new Map();

// Failure memory registry: key -> timestamp (30s TTL)
const failureMemory = new Map();
const FAILURE_TTL = 30000;

// Copernicus specific cooldown: timestamp
let copernicusCooldownUntil = 0;
const COPERNICUS_COOLDOWN_DURATION = 30000;

// Active grid fetches counter
let activeGridFetchesCount = 0;

// Active Copernicus requests counter
let activeCopernicusRequestsCount = 0;

export function getProxyLedger() {
  if (typeof window !== 'undefined') {
    return window.__MARINE_PROXY_LEDGER__;
  }
  return [];
}

function addToLedger(entry) {
  if (typeof window !== 'undefined') {
    window.__MARINE_PROXY_LEDGER__.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
    if (window.__MARINE_PROXY_LEDGER__.length > 50) {
      window.__MARINE_PROXY_LEDGER__.shift();
    }
  }
}

/**
 * Centrally governs and executes every frontend POST request of type "marine" or "copernicus_marine"
 *
 * @param {Object} options
 * @param {string} options.source - Caller module name/function label
 * @param {string} options.type - 'marine' | 'copernicus_marine'
 * @param {Object} options.body - Body object to stringify
 * @param {AbortSignal} [options.signal] - Abort signal
 * @param {string} options.model - 'GFS' | 'ICON' | 'EURO'
 * @param {string} options.layer - 'waves' | 'swell_1' | 'swell_2' | 'wind_waves'
 * @param {string} options.category - 'grid' | 'copernicus_grid' | 'exact_point' | 'extended_estimate'
 * @param {number} [options.lat] - Latitude for exact point
 * @param {number} [options.lng] - Longitude for exact point
 * @returns {Promise<Response>} Fetch Response or mock rate-limited/error structure
 */
export async function governMarineRequest({
  source,
  type,
  body,
  signal,
  model,
  layer,
  category,
  lat = null,
  lng = null
}) {
  const now = Date.now();
  const rLat = lat != null ? +lat.toFixed(2) : null;
  const rLng = lng != null ? +lng.toFixed(2) : null;
  const forecastDays = body.forecast_days || 1;
  const provider = type === 'copernicus_marine' ? 'copernicus' : 'open-meteo';

  // Construct request key
  let requestKey = '';
  if (category === 'exact_point') {
    requestKey = `exact_${rLat}_${rLng}_${model}_${layer}_fd${forecastDays}_${provider}`;
  } else {
    const coordsHash = body.latitude 
      ? `${body.latitude[0]}_${body.latitude[body.latitude.length - 1]}_${body.longitude[0]}_${body.longitude[body.longitude.length - 1]}`
      : 'global';
    requestKey = `grid_${model}_${layer}_fd${forecastDays}_${provider}_${coordsHash}`;
  }

  // Common ledger logging helper
  const logAttempt = (status, extra = {}) => {
    addToLedger({
      source,
      type,
      model,
      layer,
      pointCount: body.latitude ? (Array.isArray(body.latitude) ? body.latitude.length : 1) : 0,
      variableCount: body.hourly ? (Array.isArray(body.hourly) ? body.hourly.length : 0) : 0,
      forecastDays,
      provider,
      requestKey,
      cooldownBefore: isInCooldown('marine'),
      category,
      lat: rLat,
      lng: rLng,
      status,
      ...extra
    });
  };

  // 1. Enforce Global Marine Cooldown
  if (isInCooldown('marine')) {
    console.warn(`[Governor] Blocked request for ${requestKey}: Global Marine Cooldown active.`);
    logAttempt('cooldown_blocked', { cooldownActive: true });
    throw new Error('cooldown_active');
  }

  // 2. Enforce Copernicus-specific Cooldown
  if (provider === 'copernicus' && now < copernicusCooldownUntil) {
    console.warn(`[Governor] Blocked request for ${requestKey}: Copernicus 502/Timeout Cooldown active.`);
    logAttempt('copernicus_cooldown_blocked', { copernicusCooldownActive: true });
    throw new Error('copernicus_cooldown_active');
  }

  // 3. Enforce Recent Failure TTL (30s)
  const failureTime = failureMemory.get(requestKey);
  if (failureTime && now - failureTime < FAILURE_TTL) {
    console.warn(`[Governor] Blocked request for ${requestKey}: Recent failed request in TTL window.`);
    logAttempt('failure_ttl_blocked', { remainingTtlMs: FAILURE_TTL - (now - failureTime) });
    throw new Error('failure_ttl_active');
  }

  // 4. Enforce Exact Point vs Grid Priority
  if (category === 'exact_point' && activeGridFetchesCount > 0) {
    console.warn(`[Governor] Blocked exact point request for ${requestKey}: Grid/Horizon fetch is active in-flight.`);
    logAttempt('grid_priority_blocked', { activeGridFetches: activeGridFetchesCount });
    throw new Error('grid_fetch_in_flight');
  }

  // 5. Enforce Copernicus component request concurrency
  if ((category === 'copernicus_grid' || provider === 'copernicus') && activeCopernicusRequestsCount > 0) {
    console.warn(`[Governor] Blocked Copernicus request for ${requestKey}: Another Copernicus component request is in-flight.`);
    logAttempt('copernicus_concurrency_blocked', { activeCopernicusRequests: activeCopernicusRequestsCount });
    throw new Error('copernicus_concurrency_active');
  }

  // 6. Enforce Single-Flight request deduplication
  if (inFlightRequests.has(requestKey)) {
    console.log(`[Governor] Sharing in-flight request for: ${requestKey}`);
    logAttempt('shared_inflight');
    return inFlightRequests.get(requestKey);
  }

  // Update counters
  const isGrid = category === 'grid' || category === 'copernicus_grid';
  if (isGrid) activeGridFetchesCount++;
  if (provider === 'copernicus') activeCopernicusRequestsCount++;

  const fetchPromise = (async () => {
    const startTime = Date.now();
    try {
      logAttempt('network_fetch_started');
      const res = await fetch('/api/weather-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, body }),
        signal
      });

      const elapsedMs = Date.now() - startTime;

      if (!res.ok) {
        let errText = '';
        try { errText = await res.clone().text(); } catch(e) {}
        console.error(`[Governor] Network request failed with HTTP ${res.status}:`, errText.substring(0, 300));
        
        failureMemory.set(requestKey, Date.now());

        if (res.status === 429 || errText.toLowerCase().includes('rate limit') || errText.toLowerCase().includes('429')) {
          enterCooldown('marine');
          logAttempt(`failed_429`, { httpStatus: res.status, elapsedMs, errText: errText.substring(0, 100) });
        } else if (res.status === 502 || res.status === 504 || errText.toLowerCase().includes('timeout') || errText.toLowerCase().includes('gateway')) {
          if (provider === 'copernicus') {
            copernicusCooldownUntil = Date.now() + COPERNICUS_COOLDOWN_DURATION;
            console.warn(`[Governor] Copernicus backend failure/timeout detected. Cooldown activated for ${COPERNICUS_COOLDOWN_DURATION / 1000}s.`);
          }
          logAttempt(`failed_502_504`, { httpStatus: res.status, elapsedMs, errText: errText.substring(0, 100) });
        } else {
          logAttempt(`failed_http_${res.status}`, { httpStatus: res.status, elapsedMs, errText: errText.substring(0, 100) });
        }
        
        return res;
      }

      logAttempt('success', { elapsedMs });
      return res;

    } catch (err) {
      const elapsedMs = Date.now() - startTime;
      if (err.name === 'AbortError') {
        logAttempt('aborted', { elapsedMs });
      } else {
        console.error(`[Governor] Fetch exception captured:`, err.message);
        failureMemory.set(requestKey, Date.now());
        logAttempt('exception', { elapsedMs, exceptionMessage: err.message });
      }
      throw err;
    } finally {
      inFlightRequests.delete(requestKey);
      if (isGrid) activeGridFetchesCount = Math.max(0, activeGridFetchesCount - 1);
      if (provider === 'copernicus') activeCopernicusRequestsCount = Math.max(0, activeCopernicusRequestsCount - 1);
    }
  })();

  inFlightRequests.set(requestKey, fetchPromise);
  return fetchPromise;
}
