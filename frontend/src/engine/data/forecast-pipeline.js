/**
 * Forecast Pipeline Unified Multi-Model Orchestration
 *
 * Ties together:
 *   forecast-provider.js (fetch)
 *   model-normalizers.js (normalize)
 *   tile-streaming-system.js (cache)
 *
 * Delivers ONLY normalized data to the engine. Raw model data
 * NEVER reaches the rendering layer.
 *
 * RULES:
 *   - NO rendering
 *   - NO DOM
 *   - NO React
 *   - NO import-time side effects
 *   - Pure data orchestration
 */

import { fetchForecast, fetchBestAvailable, normalizeToTypedField } from './forecast-provider';

// PIPELINE STATE 
const _subscribers = [];       // fn(normalizedField) callbacks
let _lastField = null;         // Most recent normalized field
let _activeFetch = null;       // Dedup in-flight fetches
let _preferredModel = 'GFS';   // Default model preference

/**
 * Set the preferred forecast model.
 * @param {'GFS'|'ICON'|'EURO'} model
 */
export function setPreferredModel(model) {
  _preferredModel = model;
}

/**
 * Subscribe to normalized forecast data updates.
 * Callback receives the typed field contract:
 *   { u: Float32Array, v: Float32Array, scalar: Float32Array,
 *     grid: { x, y }, timestep, source, bounds }
 *
 * @param {Function} fn
 * @returns {Function} unsubscribe
 */
export function onForecastUpdate(fn) {
  _subscribers.push(fn);
  // Immediately deliver last known field if available
  if (_lastField) fn(_lastField);
  return () => {
    const idx = _subscribers.indexOf(fn);
    if (idx >= 0) _subscribers.splice(idx, 1);
  };
}

/**
 * Notify all subscribers with a new normalized field.
 * @param {Object} field
 */
function _notify(field) {
  _lastField = field;
  for (let i = 0; i < _subscribers.length; i++) {
    try { _subscribers[i](field); } catch (e) {
      console.warn('[ForecastPipeline] Subscriber error:', e.message);
    }
  }
}

/**
 * Fetch Normalize Deliver pipeline.
 * This is the SINGLE entry point for all forecast data.
 *
 * @param {{
 *   lat: number, lon: number,
 *   model?: 'GFS'|'ICON'|'EURO',
 *   timestep?: number,
 *   grid?: { width: number, height: number, bounds: Object }
 * }} request
 * @returns {Promise<Object>} normalized typed field
 */
export async function fetchNormalized(request) {
  const model = request.model || _preferredModel;
  const grid = request.grid || { width: 64, height: 64 };

  // Dedup: if same request is in-flight, return it
  const key = `${model}:${request.lat.toFixed(2)},${request.lon.toFixed(2)}:${request.timestep || 0}`;
  if (_activeFetch && _activeFetch.key === key) {
    return _activeFetch.promise;
  }

  const promise = (async () => {
    try {
      // Step 1: Fetch raw data from provider
      const raw = await fetchForecast({
        lat: request.lat,
        lon: request.lon,
        model: model,
        timestep: request.timestep,
      });

      // Step 2: Normalize to typed field contract
      const field = normalizeToTypedField(raw, grid);
      field.source = model;

      // Step 3: Deliver to subscribers
      _notify(field);

      return field;
    } catch (err) {
      console.warn('[ForecastPipeline] Fetch failed:', model, err.message);
      return _lastField; // Return stale data on failure
    } finally {
      if (_activeFetch && _activeFetch.key === key) {
        _activeFetch = null;
      }
    }
  })();

  _activeFetch = { key, promise };
  return promise;
}

/**
 * Fetch from the fastest available model.
 * Uses Promise.any across GFS/ICON/EURO.
 *
 * @param {{ lat: number, lon: number, timestep?: number, grid?: Object }} request
 * @returns {Promise<Object>} normalized typed field
 */
export async function fetchBestNormalized(request) {
  const grid = request.grid || { width: 64, height: 64 };

  try {
    const raw = await fetchBestAvailable({
      lat: request.lat,
      lon: request.lon,
      timestep: request.timestep,
    });

    const field = normalizeToTypedField(raw, grid);
    field.source = raw.model || 'BEST';
    _notify(field);
    return field;
  } catch (err) {
    console.warn('[ForecastPipeline] Best-available failed:', err.message);
    return _lastField;
  }
}

/**
 * Get the most recent normalized forecast field.
 * Returns null if no data has been fetched yet.
 * @returns {Object|null}
 */
export function getLastField() {
  return _lastField;
}

/**
 * Pipeline diagnostics.
 */
export function getPipelineStats() {
  return {
    hasData: !!_lastField,
    subscribers: _subscribers.length,
    preferredModel: _preferredModel,
    lastSource: _lastField?.source || null,
    lastTimestep: _lastField?.timestep || null,
    hasPendingFetch: !!_activeFetch,
  };
}
