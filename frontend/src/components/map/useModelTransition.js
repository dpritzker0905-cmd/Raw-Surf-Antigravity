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
    
    // Synced immediately to prevent the 50ms race condition
    setMapActiveModelLock(activeModel);
    
    if (modelDebounceTimeoutRef.current) {
      clearTimeout(modelDebounceTimeoutRef.current);
    }
    
    let active = true;
    
    modelDebounceTimeoutRef.current = setTimeout(() => {
      if (!active) return;
      
      console.log(`[MODEL] Model changed to ${activeModel}, transitioning and wiping block cache...`);
      setIsTransitioning(true);
      cacheBustRef.current = Date.now();
      setMapActiveModelLock(activeModel);
      
      if (mapInstance && mapInstance.isStyleLoaded()) {
        safeSetPaintProperty(mapInstance, 'wind-particle-overlay', 'raster-opacity', 0);
        safeSetPaintProperty(mapInstance, 'marine-canvas-layer', 'raster-opacity', 0);
      }

      clearOpenMeteoCache().then(() => {
        if (!active) return;

        const finishTransition = () => {
          setTimeout(() => {
            requestAnimationFrame(() => {
              if (!active) return;
              console.log(`[TRANSITION] Transition finished, activeModel: ${activeModel}`);
              
              if (mapInstance && mapInstance.isStyleLoaded()) {
                try {
                  const currentActiveLayers = activeLayersRef.current || [];
                  const currentActiveSlots = activeSlotsRef.current || {};
                  const currentClosestTimeIdx = closestTimeIdxRef.current || 0;
                  
                  currentActiveLayers.forEach(layerKey => {
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
                        mapInstance.setLayoutProperty(layerId, 'visibility', 'visible');
                        mapInstance.setPaintProperty(layerId, 'raster-opacity', isActive ? finalOpacity : 0.0);
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
          if (mapInstance.isStyleLoaded()) {
            finishTransition();
          } else {
            mapInstance.once('load', finishTransition);
            setTimeout(() => {
              if (active) {
                const now = Date.now();
                let allowed = false;
                const layers = activeLayersRef.current || [];
                layers.forEach(layerKey => {
                  const lastTime = fallbackTimestamps[layerKey] || 0;
                  if (now - lastTime >= 2000) {
                    fallbackTimestamps[layerKey] = now;
                    allowed = true;
                  }
                });

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
    };
  }, [activeModel, mapInstance]);
}
