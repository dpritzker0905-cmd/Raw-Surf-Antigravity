import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import {
  OM_MODEL_MAP,
  fetchModelMetadata,
  registerOpenMeteoProtocol,
  clearOpenMeteoCache,
  safeSetPaintProperty,
  setMapActiveModelLock,
  trace
} from './mapUtils';
import {
  LAYER_REGISTRY,
  PRECIP_MODEL_MAP,
  MARINE_MODEL_MAP,
  MODEL_METADATA_CACHE
} from './LayerRegistry';
import { validateModelAccess } from './LayerAccessResolver';

export function useOpenMeteoTileUrls({
  mapInstance,
  activeModel,
  activeLayers,
  theme,
  timeOffsetHours,
  userTier,
  activeMarineLayer
}) {
  const [protocolReady, setProtocolReady] = useState(false);
  const [metadataRevision, setMetadataRevision] = useState(0);
  const [activeSlots, setActiveSlots] = useState({});
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [omTileUrls, setOmTileUrls] = useState({});

  const cacheBustRef = useRef(Date.now());
  const modelDebounceTimeoutRef = useRef(null);
  
  const activeSlotsRef = useRef(activeSlots);
  activeSlotsRef.current = activeSlots;
  
  const closestTimeIdxRef = useRef(0);
  const activeLayersRef = useRef(activeLayers);
  activeLayersRef.current = activeLayers;

  // Protocol registration
  useEffect(() => {
    registerOpenMeteoProtocol(maplibregl, setProtocolReady);
  }, []);

  const fetchMetadata = useCallback(async (modelToCheck, signal) => {
    return fetchModelMetadata(
      modelToCheck,
      MODEL_METADATA_CACHE,
      () => setMetadataRevision(prev => prev + 1),
      signal
    );
  }, []);

  // Pre-warm active model and wave fallbacks immediately, and defer the rest
  useEffect(() => {
    const activeModelCode = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    // 1. Prioritize active model and active wave model metadata immediately
    fetchMetadata(activeModelCode);
    fetchMetadata('ncep_gfswave025'); // Default wave model
    
    // 2. Defer other models by 2 seconds using a non-blocking setTimeout
    const timer = setTimeout(() => {
      const remainingModels = [
        'ncep_gfs013', 'dwd_icon', 'ecmwf_ifs025',
        'ecmwf_wam025', 'dwd_gwam'
      ].filter(m => m !== activeModelCode);
      
      // Load remaining models in the background
      remainingModels.forEach(m => fetchMetadata(m));
    }, 2000);

    return () => clearTimeout(timer);
  }, [fetchMetadata, activeModel]);

  // Closest time index computation
  const closestTimeIdx = useMemo(() => {
    const model = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    const meta = MODEL_METADATA_CACHE[model];
    if (!meta || !meta.validTimes || !meta.validTimes.length) return 0;
    const targetMs = Date.now() + timeOffsetHours * 3600000;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < meta.validTimes.length; i++) {
      const diff = Math.abs(new Date(meta.validTimes[i]).getTime() - targetMs);
      if (diff < minDiff) { minDiff = diff; closestIdx = i; }
    }
    return Math.max(0, Math.min(meta.validTimes.length - 1, closestIdx));
  }, [activeModel, timeOffsetHours, metadataRevision]);
  
  useEffect(() => {
    closestTimeIdxRef.current = closestTimeIdx;
  }, [closestTimeIdx]);

  // Debounced model transition and block cache clear
  useEffect(() => {
    if (!activeModel) return;
    
    if (modelDebounceTimeoutRef.current) {
      clearTimeout(modelDebounceTimeoutRef.current);
    }
    
    let active = true;
    
    modelDebounceTimeoutRef.current = setTimeout(() => {
      if (!active) return;
      
      console.log(`[Raster] Model changed to ${activeModel}, transitioning and wiping block cache...`);
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
              console.log(`[Raster] Transition finished, activeModel: ${activeModel}`);
              
              if (mapInstance && mapInstance.isStyleLoaded()) {
                try {
                  const currentActiveLayers = activeLayersRef.current || [];
                  const currentActiveSlots = activeSlotsRef.current || {};
                  const currentClosestTimeIdx = closestTimeIdxRef.current || 0;
                  
                  currentActiveLayers.forEach(layerKey => {
                    const isMarine = LAYER_REGISTRY[layerKey]?.type === 'marine';
                    const opacityExpression = isMarine ? [
                      'interpolate', ['linear'], ['zoom'],
                      2, 0.45, 5, 0.55, 8, 0.65, 12, 0.70
                    ] : [
                      'interpolate', ['linear'], ['zoom'],
                      2, layerKey === 'wind' ? 0.24 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.22 : layerKey === 'fog' ? 0.18 : layerKey === 'rain' ? 0.35 : 0.22,
                      5, layerKey === 'wind' ? 0.28 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.28 : layerKey === 'fog' ? 0.25 : layerKey === 'rain' ? 0.42 : 0.28,
                      8, layerKey === 'wind' ? 0.33 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.32 : layerKey === 'fog' ? 0.32 : layerKey === 'rain' ? 0.48 : 0.35,
                      12, layerKey === 'wind' ? 0.38 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.38 : layerKey === 'fog' ? 0.38 : layerKey === 'rain' ? 0.52 : 0.40,
                    ];
                    
                    const dampingFactor = timeOffsetHours > 240
                      ? Math.max(0.3, 1.0 - (timeOffsetHours - 240) * 0.005)
                      : 1.0;
                    const finalOpacity = dampingFactor !== 1.0
                      ? opacityExpression.map((val, idx) => (idx > 2 && typeof val === 'number' ? val * dampingFactor : val))
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
                  if (activeMarineLayer && mapInstance.getLayer('marine-canvas-layer')) {
                    mapInstance.setLayoutProperty('marine-canvas-layer', 'visibility', 'visible');
                    mapInstance.setPaintProperty('marine-canvas-layer', 'raster-opacity', 0.85);
                  }
                } catch (err) {
                  console.warn('[MapWebGL] Transition rendering synchronization caught warning:', err.message);
                }
              }

              setIsTransitioning(false);
              if (mapInstance) {
                try { mapInstance.triggerRepaint(); } catch(e) {}
              }
            });
          }, 120);
        };

        if (mapInstance) {
          if (mapInstance.isStyleLoaded()) {
            finishTransition();
          } else {
            mapInstance.once('load', finishTransition);
            setTimeout(() => {
              if (active) {
                console.log('[Raster] Style load safety fallback triggered');
                finishTransition();
              }
            }, 2000);
          }
        }
      });
    }, 300);

    return () => {
      active = false;
      if (modelDebounceTimeoutRef.current) {
        clearTimeout(modelDebounceTimeoutRef.current);
      }
    };
  }, [activeModel, mapInstance, activeMarineLayer]);

  // URL resolution logic
  const loggedFallbacks = useRef(new Set());
  const rafRef = useRef(null);
  const pendingResolve = useRef(null);

  useEffect(() => {
    const targetModel = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    let isMounted = true;
    
    // Simple stateful taskId generation
    const taskId = Date.now();
    const controller = new AbortController();
    const { signal } = controller;

    const getUrlForIndex = (model, variable, idx) => {
      const meta = MODEL_METADATA_CACHE[model];
      const len = meta?.validTimes?.length || 0;
      const clampedIdx = len > 0 ? Math.max(0, Math.min(len - 1, idx)) : 0;
      const darkParam = (theme === 'dark' || theme === 'beach') ? '&dark=true' : '';
      const cacheBuster = cacheBustRef.current ? `&_cb=${cacheBustRef.current}` : '';
      return `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?time_step=valid_times_${clampedIdx}&variable=${variable}${darkParam}&contours=true${cacheBuster}`;
    };

    const resolveAllUrls = async () => {
      try {
        try { validateModelAccess(activeModel || 'GFS', userTier); } 
        catch (err) { console.error('[MapWebGL] LAYER_ACCESS_DENIED:', err.message); return; }

        const tasks = Object.keys(LAYER_REGISTRY)
          .filter(k => LAYER_REGISTRY[k].omVariable && activeLayers.includes(k))
          .map(k => ({ layerKey: k, variable: LAYER_REGISTRY[k].omVariable, entry: LAYER_REGISTRY[k] }));

        const resolveModel = (entry, variable) => {
          if (entry.omModel) return entry.omModel;
          if (entry.omModelGroup === 'marine') {
            const baseModel = MARINE_MODEL_MAP[activeModel] || 'ncep_gfswave025';
            // Strategy 1 Fallback: DWD GWAM / ECMWF WAM run out at 180 / 240 hours.
            // Dynamically upgrade to GFS wave (ncep_gfswave025) if past 180 hours
            if (timeOffsetHours > 180 && baseModel !== 'ncep_gfswave025') {
              return 'ncep_gfswave025';
            }
            return baseModel;
          }
          if (variable === 'precipitation' || variable === 'cloud_cover') {
            const baseModel = PRECIP_MODEL_MAP[activeModel] || 'dwd_icon';
            if (timeOffsetHours > 180 && baseModel === 'dwd_icon') {
              return 'ncep_gfs013'; // GFS precipitation runs up to 10 days
            }
            return baseModel;
          }
          if (timeOffsetHours > 180 && targetModel === 'dwd_icon') {
            return 'ncep_gfs025'; // Fallback to GFS atmospheric
          }
          return targetModel;
        };

        const models = [...new Set(tasks.map(t => resolveModel(t.entry, t.variable)))];
        window.__OM_ACTIVE_MODELS__ = models;
        await Promise.all(models.map(m => fetchMetadata(m, signal)));
        if (!isMounted) return;

        const newUrls = {};
        const newActiveSlots = {};
        for (const { layerKey, variable, entry } of tasks) {
          let layerModel = resolveModel(entry, variable);
          let meta = await fetchMetadata(layerModel, signal);
          if (!isMounted) return;
          let resolvedVar = variable;
          if (!meta.variables.includes(variable)) {
            const VARIABLE_FALLBACKS = {
              'wind_speed_10m': 'wind_gusts_10m', 'wind_gusts_10m': 'wind_u_component_10m', 'visibility': 'cloud_cover_low'
            };
            let currentVar = variable;
            while (currentVar && !meta.variables.includes(currentVar)) {
              const fb = VARIABLE_FALLBACKS[currentVar];
              if (fb) currentVar = fb;
              else break;
            }
            if (meta.variables.includes(currentVar)) {
              resolvedVar = currentVar;
              const fbKey = `${variable}-${layerModel}`;
              if (!loggedFallbacks.current.has(fbKey)) {
                loggedFallbacks.current.add(fbKey);
                console.log(`[Raster] Variable fallback: ${variable} -> ${resolvedVar} for ${layerModel}`);
              }
            } else if (entry.omModelGroup === 'marine') {
              layerModel = 'ncep_gfswave025';
              if (window.__OM_ACTIVE_MODELS__ && !window.__OM_ACTIVE_MODELS__.includes(layerModel)) {
                window.__OM_ACTIVE_MODELS__.push(layerModel);
              }
              meta = await fetchMetadata(layerModel, signal);
              if (!isMounted) return;
              if (meta.variables.includes(variable)) {
                resolvedVar = variable;
                const fbKey = `marine-${variable}`;
                if (!loggedFallbacks.current.has(fbKey)) {
                  loggedFallbacks.current.add(fbKey);
                  console.log(`[Raster] Marine model fallback: ${layerModel} for ${variable}`);
                }
              }
            }
          }
          if (meta.variables.includes(resolvedVar)) {
            const { validTimes } = meta;
            const targetMs = Date.now() + timeOffsetHours * 3600000;
            let closestIdx = 0;
            let minDiff = Infinity;
            if (validTimes && validTimes.length) {
              for (let i = 0; i < validTimes.length; i++) {
                const diff = Math.abs(new Date(validTimes[i]).getTime() - targetMs);
                if (diff < minDiff) { minDiff = diff; closestIdx = i; }
              }
            }
            closestIdx = Math.max(0, Math.min(validTimes.length - 1, closestIdx));
            const slotCurrent = closestIdx % 3;
            newActiveSlots[layerKey] = slotCurrent;
            const slotPrev = (closestIdx - 1 + 3) % 3;
            const slotNext = (closestIdx + 1) % 3;
            newUrls[`${layerKey}-slot-${slotCurrent}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', getUrlForIndex(layerModel, resolvedVar, closestIdx));
            newUrls[`${layerKey}-slot-${slotPrev}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', closestIdx > 0 ? getUrlForIndex(layerModel, resolvedVar, closestIdx - 1) : getUrlForIndex(layerModel, resolvedVar, closestIdx));
            newUrls[`${layerKey}-slot-${slotNext}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', closestIdx < validTimes.length - 1 ? getUrlForIndex(layerModel, resolvedVar, closestIdx + 1) : getUrlForIndex(layerModel, resolvedVar, closestIdx));
          }
        }

        if (isMounted) {
          setOmTileUrls(prev => {
            const filtered = {};
            Object.keys(prev).forEach(key => {
              const match = key.match(/^(.+)-slot-(\d+)$/);
              if (match && activeLayers.includes(match[1])) {
                filtered[key] = prev[key];
              }
            });
            return { ...filtered, ...newUrls };
          });
          setActiveSlots(newActiveSlots);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[Raster] resolveAllUrls error:', err);
      }
    };
    
    pendingResolve.current = resolveAllUrls;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (pendingResolve.current) {
        pendingResolve.current().catch(e => {
          if (e.name !== 'AbortError') console.error('[Raster] RAF resolve error:', e);
        });
      }
    });
    
    return () => { 
      isMounted = false; 
      controller.abort(); 
      if (rafRef.current) cancelAnimationFrame(rafRef.current); 
    };
  }, [activeModel, theme, timeOffsetHours, activeLayers, fetchMetadata, metadataRevision, userTier]);

  // Unified Opacity Blending and Sliding Sync
  useEffect(() => {
    if (!mapInstance) return;
    try {
      activeLayers.forEach(layerKey => {
        const isMarine = LAYER_REGISTRY[layerKey]?.type === 'marine';
        const opacityExpression = isMarine ? [
          'interpolate', ['linear'], ['zoom'],
          2, 0.45, 5, 0.55, 8, 0.65, 12, 0.70
        ] : [
          'interpolate', ['linear'], ['zoom'],
          2, layerKey === 'wind' ? 0.24 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.22 : layerKey === 'fog' ? 0.18 : layerKey === 'rain' ? 0.35 : 0.22,
          5, layerKey === 'wind' ? 0.28 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.28 : layerKey === 'fog' ? 0.25 : layerKey === 'rain' ? 0.42 : 0.28,
          8, layerKey === 'wind' ? 0.33 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.32 : layerKey === 'fog' ? 0.32 : layerKey === 'rain' ? 0.48 : 0.35,
          12, layerKey === 'wind' ? 0.38 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.38 : layerKey === 'fog' ? 0.38 : layerKey === 'rain' ? 0.52 : 0.40,
        ];
        
        const dampingFactor = timeOffsetHours > 240
          ? Math.max(0.3, 1.0 - (timeOffsetHours - 240) * 0.005)
          : 1.0;
        const finalOpacity = dampingFactor !== 1.0
          ? opacityExpression.map((val, idx) => (idx > 2 && typeof val === 'number' ? val * dampingFactor : val))
          : opacityExpression;
        
        [0, 1, 2].forEach(slot => {
          const slotLayerId = `${layerKey}-slot-${slot}-layer`;
          if (mapInstance.getLayer(slotLayerId)) {
            safeSetPaintProperty(mapInstance, slotLayerId, 'raster-fade-duration', 150);
            const isActive = activeSlots[layerKey] !== undefined
              ? activeSlots[layerKey] === slot
              : (closestTimeIdxRef.current % 3) === slot;
            if (!isTransitioning) {
              safeSetPaintProperty(mapInstance, slotLayerId, 'raster-opacity', isActive ? finalOpacity : 0.0);
            } else {
              safeSetPaintProperty(mapInstance, slotLayerId, 'raster-opacity', 0.0);
            }
          }
        });
      });
    } catch (e) {
      console.warn('[MapWebGL] Failed to apply explicit blend parameter:', e);
    }
  }, [mapInstance, activeLayers, activeSlots, isTransitioning]);

  // Paint repainting on Url/Layer updates
  useEffect(() => {
    if (mapInstance) {
      try { mapInstance.triggerRepaint(); } catch (e) {}
    }
  }, [mapInstance, activeLayers, omTileUrls]);

  return {
    protocolReady,
    omTileUrls,
    activeSlots,
    isTransitioning,
    closestTimeIdx
  };
}
