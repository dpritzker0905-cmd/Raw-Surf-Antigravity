/**
 * useTemporalPreloader.js — Temporal Tile Preloading (±1hr)
 *
 * Prefetches raster tile manifests and first-viewport tiles for adjacent
 * time steps, so layer transitions feel instant when the user scrubs the
 * forecast timeline.
 *
 * RULES:
 *   - NO import-time side effects
 *   - Prefetch is best-effort (AbortController on unmount)
 *   - Never blocks current frame
 *   - Cache-only (no state mutations)
 */

import { useEffect, useRef, useCallback } from 'react';

var PRELOAD_OFFSETS = [-1, 1]; // hours relative to current
var PRELOAD_DELAY_MS = 2000;   // wait 2s after last interaction
var MAX_CONCURRENT = 2;

/**
 * Preload raster tile URLs for adjacent timesteps.
 *
 * @param {Object} options
 * @param {number} options.currentHour - current forecast hour offset
 * @param {string} options.model - e.g. 'ncep_gfs025'
 * @param {string} options.variable - e.g. 'precipitation'
 * @param {Object} options.bounds - { west, south, east, north }
 * @param {number} options.zoom - current map zoom level
 * @param {boolean} options.enabled - whether preloading is active
 */
export function useTemporalPreloader({
  currentHour,
  model,
  variable,
  bounds,
  zoom,
  enabled = true,
}) {
  var abortRef = useRef(null);
  var timerRef = useRef(null);
  var cacheRef = useRef(new Set());

  var preloadTiles = useCallback(function() {
    if (!enabled || !model || !variable || !bounds) return;

    // Abort any in-flight preloads
    if (abortRef.current) abortRef.current.abort();
    var controller = new AbortController();
    abortRef.current = controller;

    var signal = controller.signal;
    var pending = 0;

    PRELOAD_OFFSETS.forEach(function(offset) {
      var targetHour = currentHour + offset;
      if (targetHour < 0) return;

      var cacheKey = model + ':' + variable + ':' + targetHour;
      if (cacheRef.current.has(cacheKey)) return;
      if (pending >= MAX_CONCURRENT) return;
      pending++;

      // Build the tile URL for the center of the current viewport
      var centerLat = (bounds.south + bounds.north) / 2;
      var centerLng = (bounds.west + bounds.east) / 2;
      var tileZ = Math.max(1, Math.min(6, Math.floor(zoom)));
      var tileX = Math.floor((centerLng + 180) / 360 * Math.pow(2, tileZ));
      var latRad = centerLat * Math.PI / 180;
      var tileY = Math.floor((1 - Math.log(Math.tan(latRad) +
        1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, tileZ));

      var url = 'https://tiles.open-meteo.com/' + model +
        '/' + variable + '/' + targetHour +
        '/' + tileZ + '/' + tileX + '/' + tileY + '.png';

      // Best-effort fetch — cache only, no state mutation
      fetch(url, { signal: signal, mode: 'no-cors' })
        .then(function() {
          cacheRef.current.add(cacheKey);
        })
        .catch(function(e) {
          if (e.name !== 'AbortError') {
            // Silent fail — preloading is best-effort
          }
        });
    });
  }, [currentHour, model, variable, bounds, zoom, enabled]);

  // Debounced preload after user stops interacting
  useEffect(function() {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(preloadTiles, PRELOAD_DELAY_MS);
    return function() {
      clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [preloadTiles]);

  return {
    /** @returns {boolean} Whether a given hour is already cached */
    isPreloaded: function(hour) {
      var key = model + ':' + variable + ':' + hour;
      return cacheRef.current.has(key);
    },
    /** Clear the preload cache */
    clearCache: function() { cacheRef.current.clear(); },
    /** Number of preloaded timesteps */
    cacheSize: cacheRef.current.size,
  };
}
