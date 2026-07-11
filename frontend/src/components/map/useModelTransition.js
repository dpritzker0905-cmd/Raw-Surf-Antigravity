/**
 * useModelTransition.js
 *
 * Model transition orchestration hook, extracted from useOpenMeteoTileUrls.js for LOC compliance.
 * Handles model switching, cache busting, opacity restoration, and transition state management.
 */

import { useEffect, useRef, useCallback } from 'react';
import {
  safeSetPaintProperty,
  setMapActiveModelLock,
  clearOpenMeteoCache,
} from './mapUtils';
import { LAYER_REGISTRY } from './LayerRegistry';
import { validateModelAccess } from './LayerAccessResolver';

// --- Shared Constants (also used by useOpenMeteoTileUrls) ---

export const VARIABLE_FALLBACKS = {
  'wind_speed_10m': 'wind_gusts_10m',
  'wind_gusts_10m': 'wind_u_component_10m',
  'visibility': 'cloud_cover_low',
  'secondary_swell_wave_height': 'swell_wave_height',
  'swell_wave_height': 'wave_height',
  'wind_wave_height': 'wave_height'
};

export const resolveVariable = (meta, variable) => {
  let curr = variable;
  while (curr && !meta.variables.includes(curr)) {
    curr = VARIABLE_FALLBACKS[curr] || null;
  }
  return (curr && meta.variables.includes(curr)) ? curr : null;
};

export const getOpacityExpression = (layerKey, isMarine) => isMarine ? [
  'interpolate', ['linear'], ['zoom'],
  2, 0.45, 5, 0.55, 8, 0.65, 12, 0.70
] : [
  'interpolate', ['linear'], ['zoom'],
  2, layerKey === 'wind' ? 0.24 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.35 : layerKey === 'fog' ? 0.40 : layerKey === 'rain' ? 0.35 : 0.22,
  5, layerKey === 'wind' ? 0.28 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.42 : layerKey === 'fog' ? 0.52 : layerKey === 'rain' ? 0.42 : 0.28,
  8, layerKey === 'wind' ? 0.33 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.48 : layerKey === 'fog' ? 0.60 : layerKey === 'rain' ? 0.48 : 0.35,
  12, layerKey === 'wind' ? 0.38 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.55 : layerKey === 'fog' ? 0.65 : layerKey === 'rain' ? 0.52 : 0.40,
];

// Global fallback rate limiter (1 fallback per layer per 2 seconds max) (Request 4)
// NOTE: Entries initialize as undefined (not Date.now()) so the first transition per layer
// is never rate-limited. This prevents the abort→rate-limit deadlock on fresh page load.
const fallbackTimestamps = {};

/**
 * Hook that manages model transition lifecycle:
 * - Debounced model switching
 * - Cache busting on model change
 * - Opacity zero-out during transition
 * - Opacity restoration after tiles load
 * - Safety fallback timeout
 */
export function useModelTransition({
  mapInstance,
  activeModel,
  activeLayers,
  activeMarineLayer,
  debouncedTimeOffsetHours,
  closestTimeIdx,
  activeSlots,
  cacheBustRef,
  isScrubbingRef,
  activeLayersRef,
  activeSlotsRef,
  activeMarineLayerRef,
  debouncedTimeOffsetHoursRef,
  closestTimeIdxRef,
  setIsTransitioning,
  userTier,
}) {
  const modelDebounceTimeoutRef = useRef(null);
  const lastProcessedModelRef = useRef(null);
  const lastProcessedMapRef = useRef(null); // Track map instance to prevent early-return deadlock

  // Debounced model transition and block cache clear
  useEffect(() => {
    if (!activeModel) {
      setIsTransitioning(false);
      return;
    }
    
    if (!mapInstance) {
      setIsTransitioning(false);
      return;
    }

    // Validate model access before initiating transition
    try {
      if (userTier !== undefined) {
        validateModelAccess(activeModel, userTier);
      }
    } catch (err) {
      console.warn(`[TRANSITION] Model ${activeModel} is not permitted for this user tier. Skipping transition.`);
      setIsTransitioning(false);
      return;
    }
    
    // Model Set Dedupe Guard (Request 2)
    if (lastProcessedModelRef.current === activeModel && lastProcessedMapRef.current === mapInstance) {
      console.log(`[MODEL] Model ${activeModel} already active, skipping re-init`);
      setIsTransitioning(false); // Safety exit to prevent permanent transition state deadlock
      return;
    }
    
    // Scrubbing freeze guard (Request 3)
    if (isScrubbingRef.current) {
      console.log(`[SCRUB] [MODEL] Model transition frozen during active scrubbing`);
      return;
    }
    
    lastProcessedModelRef.current = activeModel;
    lastProcessedMapRef.current = mapInstance;

    // Audit #31: disarms the finish pair (load listener + fallback timer) on effect teardown.
    let disarmFinish = null;

    // Synced immediately to prevent the 50ms race condition
    setMapActiveModelLock(activeModel);
    
    if (modelDebounceTimeoutRef.current) {
      clearTimeout(modelDebounceTimeoutRef.current);
    }
    
    let active = true;
    
    modelDebounceTimeoutRef.current = setTimeout(() => {
      if (!active) return;
      
      // Audit #11 (2026-07-10, "not snappy on model compare"): the full wipe + `_cb` nonce rotation
      // predate the REAL cross-model-leakage fix (model-keyed decoded caches + model/run-pathed
      // URLs, 9f231d40) — every switch changed EVERY om:// tile URL and cleared every cache, so a
      // switch-BACK refetched + re-decoded all raster tiles. Retention is now the default: caches
      // are model-keyed (collision-impossible) and LRU-bounded. Kill switch
      // window.__RAW_OM_MODEL_WIPE_LEGACY__ = true restores the legacy wipe + nonce rotation exactly.
      const legacyWipe = typeof window !== 'undefined' && window.__RAW_OM_MODEL_WIPE_LEGACY__ === true;
      console.log(`[MODEL] Model changed to ${activeModel}, transitioning${legacyWipe ? ' and wiping block cache' : ' (caches retained, model-keyed)'}...`);
      setIsTransitioning(true);
      if (legacyWipe) {
        cacheBustRef.current = Date.now();
      }
      setMapActiveModelLock(activeModel);

      if (mapInstance && mapInstance.isStyleLoaded()) {
        safeSetPaintProperty(mapInstance, 'wind-particle-overlay', 'raster-opacity', 0);
        safeSetPaintProperty(mapInstance, 'marine-canvas-layer', 'raster-opacity', 0);
      }

      (legacyWipe ? clearOpenMeteoCache() : Promise.resolve()).then(() => {
        if (!active) return;

        // Audit #31 (2026-07-11): the two finish arms (once('load') + 2s fallback) never cancelled
        // each other and finishTransition had no run-once guard — in the boot window BOTH fired
        // ("Transition finished" ×2 in the user's logs) and the un-fired arm leaked per switch.
        let transitionFinished = false;
        let fallbackTimer = null;

        const finishTransition = () => {
          if (transitionFinished) return;
          transitionFinished = true;
          if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
          try { mapInstance.off('load', finishTransition); } catch (e) { /* map disposed */ }
          setTimeout(() => {
            requestAnimationFrame(() => {
              if (!active) return;
              console.log(`[TRANSITION] Transition finished, activeModel: ${activeModel}`);
              
              if (mapInstance && mapInstance.isStyleLoaded()) {
                try {
                  const currentActiveLayers = activeLayersRef.current || [];
                  const currentActiveSlots = activeSlotsRef.current || {};
                  const currentClosestTimeIdx = closestTimeIdxRef.current || 0;

                  // Audit #31: the imperative slot restore pairs with the legacy blank-out ONLY.
                  // Default flow no longer blanks the slots (MapWebGL holds the last frame), and
                  // this loop's opacity table is the pre-bold/pre-temp-pair one — re-applying it
                  // over the declarative paint would stick wrong values (the dual-control race
                  // the useOpenMeteoTileUrls NOTE warns about) now that react-map-gl sees no
                  // isTransitioning diff to overwrite it with.
                  const blankLegacy = typeof window !== 'undefined' && window.__RAW_MODEL_SWITCH_BLANK_LEGACY__ === true;
                  blankLegacy && currentActiveLayers.forEach(layerKey => {
                    const isMarine = LAYER_REGISTRY[layerKey]?.type === 'marine';
                    const opacityExpression = getOpacityExpression(layerKey, isMarine);
                    
                    const dampingFactor = debouncedTimeOffsetHoursRef.current > 240
                      ? Math.max(0.3, 1.0 - (debouncedTimeOffsetHoursRef.current - 240) * 0.005)
                      : 1.0;
                    const finalOpacity = dampingFactor !== 1.0
                      ? opacityExpression.map((val, idx) => (idx >= 4 && idx % 2 === 0 && typeof val === 'number' ? val * dampingFactor : val))
                      : opacityExpression;
                    
                    [0, 1, 2].forEach(slotIdx => {
                      const layerId = `${layerKey}-slot-${slotIdx}-layer`;
                      const isActive = currentActiveSlots[layerKey] !== undefined
                        ? currentActiveSlots[layerKey] === slotIdx
                        : (currentClosestTimeIdx % 3) === slotIdx;
                      
                      if (mapInstance.getLayer(layerId)) {
                        const isPreloaderOnly = ['wind', 'waves', 'swell_1', 'swell_2', 'wind_waves'].includes(layerKey);
                        mapInstance.setLayoutProperty(layerId, 'visibility', 'visible');
                        mapInstance.setPaintProperty(layerId, 'raster-opacity', (isActive && !isPreloaderOnly) ? finalOpacity : 0.0);
                      }
                    });
                  });
                  
                  if (currentActiveLayers.includes('wind') && mapInstance.getLayer('wind-particle-overlay')) {
                    mapInstance.setLayoutProperty('wind-particle-overlay', 'visibility', 'visible');
                    mapInstance.setPaintProperty('wind-particle-overlay', 'raster-opacity', 0.25);
                  }
                  if (activeMarineLayerRef.current && mapInstance.getLayer('marine-canvas-layer')) {
                    mapInstance.setLayoutProperty('marine-canvas-layer', 'visibility', 'visible');
                    mapInstance.setPaintProperty('marine-canvas-layer', 'raster-opacity', 0.85);
                  }
                } catch (err) {
                  console.warn('[TRANSITION] Transition rendering synchronization caught warning:', err.message);
                }
              }

              setIsTransitioning(false);
              if (mapInstance) {
                try { mapInstance.triggerRepaint(); } catch (e) { /* ignore */ }
              }
            });
          }, 30);
        };

        if (mapInstance) {
          disarmFinish = () => {
            if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
            try { mapInstance.off('load', finishTransition); } catch (e) { /* map disposed */ }
          };
          if (mapInstance.isStyleLoaded()) {
            finishTransition();
          } else {
            mapInstance.once('load', finishTransition);
            fallbackTimer = setTimeout(() => {
              if (active) {
                const now = Date.now();
                let allowed = false;
                const layers = activeLayersRef.current || [];
                let hasNeverBeenSet = false;
                layers.forEach(layerKey => {
                  const lastTime = fallbackTimestamps[layerKey];
                  // If this layer has never had a fallback timestamp, this is the first
                  // transition ever — always allow it to prevent the abort→rate-limit deadlock.
                  if (lastTime === undefined || lastTime === 0) {
                    fallbackTimestamps[layerKey] = now;
                    allowed = true;
                    hasNeverBeenSet = true;
                  } else if (now - lastTime >= 2000) {
                    fallbackTimestamps[layerKey] = now;
                    allowed = true;
                  }
                });

                // Bypass transition rate-limiter if the active source is currently LOADING or unknown (no successful data has been rendered yet)
                if (typeof window !== 'undefined') {
                  const isTransitioning = !!window.__MARINE_TRANSITIONING__ || !!window.__MARINE_FETCH_PENDING__ || !!window.__MARINE_FETCH_DEBOUNCING__;
                  const diag = window.__MARINE_RENDER_SOURCE_DIAG__ || window.__MARINE_DISPLAY_SOURCE_DIAG__;
                  const noSuccessfulData = !diag || diag.hasData !== true || diag.renderable !== true || diag.heatmapProvider === 'unknown' || diag.heatmapProvider === 'none' || diag.heatmapProvider === 'fallback_safe_zero';
                  if (isTransitioning || noSuccessfulData) {
                    allowed = true;
                  }
                  // Also allow if the provider is the abort_recovery placeholder — this means
                  // we need to let the transition complete to attempt a real fetch.
                  if (diag && diag.heatmapProvider === 'abort_recovery') {
                    allowed = true;
                  }
                }

                if (allowed) {
                  console.log('[TRANSITION] Style load safety fallback triggered');
                } else {
                  console.log('[TRANSITION] fallback suppressed (rate limited)');
                }
                finishTransition();
              }
            }, 2000);
          }
        }
      });
    }, 50);

    return () => {
      active = false;
      if (modelDebounceTimeoutRef.current) {
        clearTimeout(modelDebounceTimeoutRef.current);
      }
      if (disarmFinish) disarmFinish();
    };
  }, [activeModel, mapInstance, userTier]);
}
