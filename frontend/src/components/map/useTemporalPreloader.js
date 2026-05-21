/**
 * useTemporalPreloader.js — Temporal Tile Pre-warmer
 *
 * Prefetches open-meteo tiles for adjacent forecast hours so layer
 * transitions feel instant when the user scrubs the timeline.
 *
 * Fetches a 3×3 tile grid around the viewport center for up to 4
 * future time offsets after the user stops interacting (400 ms debounce).
 *
 * RULES:
 *  - NO import-time side effects
 *  - Best-effort only (AbortController on unmount / re-trigger)
 *  - Never blocks current frame, no state mutations
 */

import { useEffect, useRef } from 'react';
import { LAYER_REGISTRY, MARINE_MODEL_MAP } from './LayerRegistry';

var OM_MODEL_MAP = { GFS: 'ncep_gfs025', EURO: 'ecmwf_ifs025', ICON: 'dwd_icon' };
var PRELOAD_OFFSETS = [1, 2, 3, 6];  // future steps in hours
var PRELOAD_DELAY_MS = 400;           // wait after last interaction
var MAX_CONCURRENT = 4;               // max parallel offset-groups

/**
 * @param {object} opts
 * @param {number}   opts.currentHour  - current forecast hour offset
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

      // Get viewport info
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
      var pending = 0;

      PRELOAD_OFFSETS.forEach(function (offset) {
        var targetHour = currentHour + offset;
        if (targetHour < 0) return;
        if (pending >= MAX_CONCURRENT) return;
        pending++;

        var cacheKey = model + ':' + variable + ':' + targetHour;
        if (cacheRef.current.has(cacheKey)) return;

        // 3×3 tile grid around viewport center
        for (var dx = -1; dx <= 1; dx++) {
          for (var dy = -1; dy <= 1; dy++) {
            var tx = Math.max(0, Math.min(n - 1, cx + dx));
            var ty = Math.max(0, Math.min(n - 1, cy + dy));
            var url = 'https://tiles.open-meteo.com/' + model + '/' + variable
              + '/' + targetHour + '/' + zoom + '/' + tx + '/' + ty + '.png';
            fetch(url, { signal: signal, mode: 'no-cors' })
              .then(function () { cacheRef.current.add(cacheKey); })
              .catch(function () { /* best-effort */ });
          }
        }
      });
    }, PRELOAD_DELAY_MS);

    return function () {
      clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [currentHour, activeLayers, mapInstance, activeModel]);
}
