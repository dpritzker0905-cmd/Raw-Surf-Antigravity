/*
====================================================
 Raw Surf OS — Forecast Provider
 UNIFIED GFS / ICON / EURO ABSTRACTION LAYER
====================================================

This is a DATA ROUTER — not a renderer, not an engine.
Provides a unified interface for fetching and normalizing
forecast data from multiple meteorological models.

NO engine init, NO rendering, NO DOM, NO RAF
var/function only (TDZ-immune)
====================================================
*/

// ─── MODEL ENDPOINTS ─────────────────────────────────────────────────────────

var MODEL_ENDPOINTS = {
  GFS:  '/api/forecast/gfs',
  ICON: '/api/forecast/icon',
  EURO: '/api/forecast/euro',
};

// ─── REQUEST CACHE (prevents duplicate fetches) ──────────────────────────────

var _requestCache = new Map();
var _cacheMaxAge = 5 * 60 * 1000; // 5 minutes

/**
 * Generate cache key from request params.
 * @param {{ lat: number, lon: number, model: string, timestep?: number }} req
 * @returns {string}
 */
function cacheKey(req) {
  return req.model + ':' + req.lat.toFixed(2) + ',' + req.lon.toFixed(2) +
    (req.timestep !== undefined ? ':' + req.timestep : '');
}

/**
 * Fetch forecast data from a specific model.
 *
 * @param {{
 *   lat: number,
 *   lon: number,
 *   model: 'GFS'|'ICON'|'EURO',
 *   timestep?: number
 * }} request
 * @returns {Promise<Object>} normalized forecast data
 */
function fetchForecast(request) {
  var key = cacheKey(request);

  // Return cached if fresh
  var cached = _requestCache.get(key);
  if (cached && (Date.now() - cached.timestamp < _cacheMaxAge)) {
    return Promise.resolve(cached.data);
  }

  var endpoint = MODEL_ENDPOINTS[request.model];
  if (!endpoint) {
    return Promise.reject(new Error('[ForecastProvider] Unknown model: ' + request.model));
  }

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: request.lat,
      lon: request.lon,
      timestep: request.timestep,
    }),
  })
  .then(function(res) {
    if (!res.ok) throw new Error('[ForecastProvider] HTTP ' + res.status);
    return res.json();
  })
  .then(function(raw) {
    var normalized = normalizeForecast(raw, request.model);
    _requestCache.set(key, { data: normalized, timestamp: Date.now() });
    return normalized;
  });
}

/**
 * Normalize raw model output into a unified format.
 * Different models use different field names / units.
 *
 * @param {Object} raw - raw API response
 * @param {string} model - model identifier
 * @returns {{
 *   model: string,
 *   wind: Object|null,
 *   waves: Object|null,
 *   pressure: Object|null,
 *   rain: Object|null,
 *   timestamp: number
 * }}
 */
function normalizeForecast(raw, model) {
  return {
    model: model,
    wind: raw.wind || raw.windData || null,
    waves: raw.waves || raw.waveData || null,
    pressure: raw.pressure || raw.pressureData || null,
    rain: raw.rain || raw.precipitation || null,
    timestamp: raw.time || raw.timestamp || Date.now(),
  };
}

/**
 * Fetch from multiple models simultaneously for comparison.
 * Returns first successful response (fastest model wins).
 *
 * @param {{ lat: number, lon: number, timestep?: number }} params
 * @param {Array<string>} [models] - models to query (default: all)
 * @returns {Promise<Object>}
 */
function fetchBestAvailable(params, models) {
  var targets = models || ['GFS', 'ICON', 'EURO'];
  var promises = [];
  for (var i = 0; i < targets.length; i++) {
    promises.push(
      fetchForecast({
        lat: params.lat,
        lon: params.lon,
        model: targets[i],
        timestep: params.timestep,
      })
    );
  }
  // Return fastest successful response
  return Promise.any(promises);
}

/**
 * Fetch from all models for multi-model comparison/ensemble.
 *
 * @param {{ lat: number, lon: number, timestep?: number }} params
 * @returns {Promise<Array>}
 */
function fetchAllModels(params) {
  var models = ['GFS', 'ICON', 'EURO'];
  var promises = [];
  for (var i = 0; i < models.length; i++) {
    promises.push(
      fetchForecast({ lat: params.lat, lon: params.lon, model: models[i], timestep: params.timestep })
        .catch(function(err) { return { model: models[i], error: err.message }; })
    );
  }
  return Promise.all(promises);
}

/**
 * Clear the forecast cache.
 */
function clearForecastCache() {
  _requestCache.clear();
}

/**
 * Get cache stats.
 * @returns {{ size: number }}
 */
function getForecastCacheStats() {
  return { size: _requestCache.size };
}

export {
  fetchForecast,
  normalizeForecast,
  fetchBestAvailable,
  fetchAllModels,
  clearForecastCache,
  getForecastCacheStats,
  MODEL_ENDPOINTS,
};
