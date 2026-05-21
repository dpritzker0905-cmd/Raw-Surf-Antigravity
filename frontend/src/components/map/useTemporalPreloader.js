/**
 * useTemporalPreloader.js — Temporal Tile Pre-warmer
 *
 * Prefetches open-meteo tiles for the next 3 valid model time steps so
 * layer transitions feel instant when the user scrubs the timeline.
 *
 * Fetches a 3×3 tile grid around the viewport center after the user stops
 * interacting (400 ms debounce).
 *
 * KEY FIX (v3.13): Uses live MODEL_METADATA_CACHE validTimes to compute
 * the correct CDN index instead of raw hour offsets. The open-meteo CDN
 * uses the valid_times_N index from the model's OWN valid_times array
 * (3h for GFS, 6h for wave model) — NOT an arbitrary hour offset.
 * Pre-populating fake hourly valid_times caused 100+ 404s/session and
 * saturated the browser connection pool, blocking actual marine tile loads.
 *
 * Guard: only pre-fetches when live metadata is available (step ≥ 3h).
 *
 * RULES:
 *  - NO import-time side effects
 *  - Best-effort only (AbortController on unmount / re-trigger)
 *  - Never blocks current frame, no state mutations
 */

import { useEffect, useRef } from 'react';
import { LAYER_REGISTRY, MARINE_MODEL_MAP, MODEL_METADATA_CACHE } from './LayerRegistry';

var OM_MODEL_MAP = { GFS: 'ncep_gfs025', EURO: 'ecmwf_ifs025', ICON: 'dwd_icon' };
var PRELOAD_STEPS = 3;    // number of future valid model steps to preload
var PRELOAD_DELAY_MS = 400;
var MIN_STEP_MS = 3 * 3600 * 1000; // 3h minimum — guards against fake hourly defaults

/**
 * @param {object} opts
 * @param {number}   opts.currentHour  - current forecast hour offset (timeOffsetHours)
 * @param {Array}    opts.activeLayers - active layer IDs from MapWebGL
 * @param {object}   opts.mapInstance  - raw MapLibre map instance
 * @param {string}   [opts.activeModel='GFS'] - GFS | EURO | ICON
 */
export function useTemporalPreloader({ currentHour, activeLayers, mapInstance, activeModel = 'GFS' }) {
  var abortRef = useRef(null);
  var timerRef = useRef(null);
  var cacheRef = useRef(new Set());

  useEffect(function () {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(function () {
      var lk = activeLayers?.[0];
      if (!lk || !mapInstance) return;
      var entry = LAYER_REGISTRY[lk];
      if (!entry?.omVariable) return;

      // Resolve model and variable for this layer
      var model = entry.omModelGroup === 'marine'
        ? (MARINE_MODEL_MAP[activeModel] || 'ncep_gfswave025')
        : (OM_MODEL_MAP[activeModel] || 'ncep_gfs025');
      var variable = entry.omVariable;

      // Use live metadata from shared cache — MUST have real (non-hourly) step intervals
      var meta = MODEL_METADATA_CACHE[model];
      if (!meta?.validTimes?.length || meta.validTimes.length < 2) return;

      // Guard: skip if metadata is still the fake hourly defaults (step < 3h)
      var stepMs = new Date(meta.validTimes[1]).getTime() - new Date(meta.validTimes[0]).getTime();
      if (stepMs < MIN_STEP_MS) return;

      // Compute closest valid_times index to the current forecast target
      var now = Date.now() + currentHour * 3600000;
      var closestIdx = 0, minDiff = Infinity;
      for (var i = 0; i < meta.validTimes.length; i++) {
        var diff = Math.abs(new Date(meta.validTimes[i]).getTime() - now);
        if (diff < minDiff) { minDiff = diff; closestIdx = i; }
      }

      // Get viewport info for tile coordinate math
      if (!mapInstance.getBounds) return;
      var b = mapInstance.getBounds();
      var west = b.getWest(), east = b.getEast();
      var south = b.getSouth(), north = b.getNorth();
      var zoom = Math.max(1, Math.min(6, Math.floor(mapInstance.getZoom() || 6)));
      var n = Math.pow(2, zoom);

      // Center tile coords
      var centerLng = (west + east) / 2;
      var centerLat = (south + north) / 2;
      var cx = Math.floor((centerLng + 180) / 360 * n);
      var latRad = centerLat * Math.PI / 180;
      var cy = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);

      if (abortRef.current) abortRef.current.abort();
      var controller = new AbortController();
      abortRef.current = controller;
      var signal = controller.signal;

      // Pre-fetch 3×3 tile grid for each of the next PRELOAD_STEPS valid model steps
      for (var step = 1; step <= PRELOAD_STEPS; step++) {
        var targetIdx = closestIdx + step;
        if (targetIdx >= meta.validTimes.length) break;

        var cacheKey = model + ':' + variable + ':' + targetIdx;
        if (cacheRef.current.has(cacheKey)) continue;
        cacheRef.current.add(cacheKey);

        for (var dx = -1; dx <= 1; dx++) {
          for (var dy = -1; dy <= 1; dy++) {
            var tx = Math.max(0, Math.min(n - 1, cx + dx));
            var ty = Math.max(0, Math.min(n - 1, cy + dy));
            var url = 'https://tiles.open-meteo.com/' + model + '/' + variable
              + '/' + targetIdx + '/' + zoom + '/' + tx + '/' + ty + '.png';
            fetch(url, { signal: signal, mode: 'no-cors' }).catch(function () { /* best-effort */ });
          }
        }
      }
    }, PRELOAD_DELAY_MS);

    return function () {
      clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [currentHour, activeLayers, mapInstance, activeModel]);
}
