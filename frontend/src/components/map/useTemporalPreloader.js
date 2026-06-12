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
import { LAYER_REGISTRY, MARINE_MODEL_MAP, WIND_MODEL_MAP, PRECIP_MODEL_MAP, MODEL_METADATA_CACHE } from './LayerRegistry';
import { LIVE_FETCHED_MODELS } from './mapUtils';

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
export function useTemporalPreloader({ currentHour, activeLayers, mapInstance, activeModel = 'GFS', theme }) {
  var abortRef = useRef(null);
  var timerRef = useRef(null);
  var cacheRef = useRef(new Set());

  useEffect(function () {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(function () {
      if (typeof window !== 'undefined' && window.isScrubbingTimeline) return;
      var lk = activeLayers?.[0];
      if (!lk || !mapInstance) return;
      var entry = LAYER_REGISTRY[lk];
      if (!entry?.omVariable) return;

      // Resolve model and variable for this layer
      var variable = entry.omVariable;
      var model;
      if (entry.omModel) {
        model = entry.omModel;
      } else if (entry.omModelGroup === 'marine') {
        model = MARINE_MODEL_MAP[activeModel] || 'ncep_gfswave025';
      } else if (variable === 'wind_u_component_10m') {
        model = WIND_MODEL_MAP[activeModel] || 'ncep_gfs013';
        if (model === 'dwd_icon' && currentHour > 216) {
          model = 'ncep_gfs013';
        } else if (model === 'ecmwf_ifs025' && currentHour > 228) {
          model = 'ncep_gfs013';
        }
      } else if (variable === 'precipitation' || variable === 'cloud_cover') {
        model = PRECIP_MODEL_MAP[activeModel] || 'dwd_icon';
        if (model === 'dwd_icon' && currentHour > 216) {
          model = 'ncep_gfs013';
        } else if (model === 'ecmwf_ifs025' && currentHour > 228) {
          model = 'ncep_gfs013';
        }
      } else {
        model = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
        if (model === 'dwd_icon' && currentHour > 216) {
          model = 'ncep_gfs025';
        } else if (model === 'ecmwf_ifs025' && currentHour > 228) {
          model = 'ncep_gfs025';
        }
      }

      // Use live metadata from shared cache
      var meta = MODEL_METADATA_CACHE[model];
      if (!meta?.validTimes?.length || meta.validTimes.length < 2) return;

      // Variable fallback matching MapWebGL.js
      var resolvedVar = variable;
      if (!meta.variables.includes(variable)) {
        var VARIABLE_FALLBACKS = {
          'wind_speed_10m': 'wind_gusts_10m',
          'wind_gusts_10m': 'wind_u_component_10m',
          'visibility': 'cloud_cover_low',
          'swell_wave_height': null,
          'secondary_swell_wave_height': null,
          'wind_wave_height': null
        };
        var fb = VARIABLE_FALLBACKS[variable];
        if (fb && meta.variables.includes(fb)) {
          resolvedVar = fb;
        } else if (entry.omModelGroup === 'marine') {
          model = 'ncep_gfswave025';
          meta = MODEL_METADATA_CACHE[model];
          if (!meta?.validTimes?.length || meta.validTimes.length < 2) return;
          if (meta.variables.includes(variable)) {
            resolvedVar = variable;
          }
        }
      }

      if (!meta.variables.includes(resolvedVar)) return;

      // Guard: skip if metadata is still the fake pre-populated defaults (not live-fetched)
      if (!LIVE_FETCHED_MODELS.has(model)) return;

      // Compute closest valid_times index to the current forecast target
      var now = Date.now() + currentHour * 3600000;
      var closestIdx = 0, minDiff = Infinity;
      for (var i = 0; i < meta.validTimes.length; i++) {
        var diff = Math.abs(new Date(meta.validTimes[i]).getTime() - now);
        if (diff < minDiff) { minDiff = diff; closestIdx = i; }
      }

      if (abortRef.current) abortRef.current.abort();
      var controller = new AbortController();
      abortRef.current = controller;
      var signal = controller.signal;

      // v7.4: Marine temporal preloading disabled — competes with direct-grid pipeline
      // and contributes to 429 rate limit pressure. Marine heatmaps use custom WebGL grid, not tiles.
      if (entry.omModelGroup === 'marine') {
        return; // Skip marine GRIB pre-fetching entirely
      }



      // Pre-fetch raw spatial JSON chunks for surrounding steps (past and future) to pre-warm the connection pool
      var steps = [-2, -1, 1, 2, 3];
      for (var s = 0; s < steps.length; s++) {
        var targetIdx = closestIdx + steps[s];
        if (targetIdx < 0 || targetIdx >= meta.validTimes.length) continue;

        var cacheKey = model + ':' + resolvedVar + ':' + targetIdx;
        if (cacheRef.current.has(cacheKey)) continue;
        cacheRef.current.add(cacheKey);

        var darkParam = (theme === 'dark' || theme === 'beach') ? '&dark=true' : '';
        var url = 'https://map-tiles.open-meteo.com/data_spatial/' + model
          + '/latest.json?time_step=valid_times_' + targetIdx + '&variable=' + resolvedVar + darkParam;
        fetch(url, { signal: signal }).catch(function () { /* best-effort */ });
      }
    }, PRELOAD_DELAY_MS);

    return function () {
      clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [currentHour, activeLayers, mapInstance, activeModel, theme]);
}
