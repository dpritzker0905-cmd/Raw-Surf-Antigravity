import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import {
  OM_MODEL_MAP,
  fetchModelMetadata,
  registerOpenMeteoProtocol,
  clearOpenMeteoCache,
  safeSetPaintProperty,
  setMapActiveModelLock,
  applyThemePressureScale,
  trace
} from './mapUtils';
import {
  LAYER_REGISTRY,
  PRECIP_MODEL_MAP,
  WIND_MODEL_MAP,
  MARINE_MODEL_MAP,
  MODEL_METADATA_CACHE
} from './LayerRegistry';
import { validateModelAccess } from './LayerAccessResolver';
import { WeatherTelemetry } from './WeatherTelemetry';

const VARIABLE_FALLBACKS = {
  'wind_speed_10m': 'wind_gusts_10m',
  'wind_gusts_10m': 'wind_u_component_10m',
  'visibility': 'cloud_cover_low',
  'secondary_swell_wave_height': 'swell_wave_height',
  'swell_wave_height': 'wave_height',
  'wind_wave_height': 'wave_height'
};

const resolveVariable = (meta, variable) => {
  let curr = variable;
  while (curr && !meta.variables.includes(curr)) {
    curr = VARIABLE_FALLBACKS[curr] || null;
  }
  return (curr && meta.variables.includes(curr)) ? curr : null;
};

const getOpacityExpression = (layerKey, isMarine) => isMarine ? [
  'interpolate', ['linear'], ['zoom'],
  2, 0.45, 5, 0.55, 8, 0.65, 12, 0.70
] : [
  'interpolate', ['linear'], ['zoom'],
  2, layerKey === 'wind' ? 0.24 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.35 : layerKey === 'fog' ? 0.40 : layerKey === 'rain' ? 0.35 : 0.22,
  5, layerKey === 'wind' ? 0.28 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.42 : layerKey === 'fog' ? 0.52 : layerKey === 'rain' ? 0.42 : 0.28,
  8, layerKey === 'wind' ? 0.33 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.48 : layerKey === 'fog' ? 0.60 : layerKey === 'rain' ? 0.48 : 0.35,
  12, layerKey === 'wind' ? 0.38 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.55 : layerKey === 'fog' ? 0.65 : layerKey === 'rain' ? 0.52 : 0.40,
];

// Global transition registry for deduplication (Request 1)
let lastTransitionKey = null;
let lastTransitionTimestamp = 0;

// Global fallback rate limiter (1 fallback per layer per 2 seconds max) (Request 4)
const fallbackTimestamps = {};

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

  const [debouncedTimeOffsetHours, setDebouncedTimeOffsetHours] = useState(timeOffsetHours);
  const lastTimeOffsetChangeRef = useRef(0);
  const debounceTimerRef = useRef(null);
  const isScrubbingRef = useRef(false);
  const pendingTransitionsTimeoutRef = useRef(null);
  const lastProcessedModelRef = useRef(null);

  useEffect(() => {
    const now = Date.now();
    const diff = now - lastTimeOffsetChangeRef.current;
    lastTimeOffsetChangeRef.current = now;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (diff < 120) {
      // Rapid dragging / scrubbing timeline slider: debounce by 300ms (Fix 4)
      isScrubbingRef.current = true;
      window.isScrubbingTimeline = true;
      WeatherTelemetry.trackAnimationScrub(timeOffsetHours);
      debounceTimerRef.current = setTimeout(() => {
        isScrubbingRef.current = false;
        window.isScrubbingTimeline = false;
        setDebouncedTimeOffsetHours(timeOffsetHours);
      }, 300);
    } else {
      // Single click/tap or slow adjustment: update instantly
      isScrubbingRef.current = false;
      window.isScrubbingTimeline = false;
      WeatherTelemetry.trackTimelineSeek(timeOffsetHours);
      setDebouncedTimeOffsetHours(timeOffsetHours);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [timeOffsetHours]);

  const prevModelRef = useRef(activeModel);
  const prevLayersRef = useRef(activeLayers);
  useEffect(() => {
    if (activeModel !== prevModelRef.current) WeatherTelemetry.trackModelSwitch(activeModel);
    prevModelRef.current = activeModel;
  }, [activeModel]);
  useEffect(() => {
    const prev = prevLayersRef.current || [];
    activeLayers.filter(x => !prev.includes(x)).forEach(x => WeatherTelemetry.trackLayerAttach(x));
    prev.filter(x => !activeLayers.includes(x)).forEach(x => WeatherTelemetry.trackLayerDetach(x));
    prevLayersRef.current = activeLayers;
  }, [activeLayers]);

  const cacheBustRef = useRef(Date.now());
  const modelDebounceTimeoutRef = useRef(null);
  
  const activeSlotsRef = useRef(activeSlots);
  activeSlotsRef.current = activeSlots;

  const targetSlotsRef = useRef({});
  const lastTargetSlotsRef = useRef({});
  const transitionStartTimesRef = useRef({});
  const omTileUrlsRef = useRef(omTileUrls);
  omTileUrlsRef.current = omTileUrls;

  const closestTimeIdxRef = useRef(0);
  const activeLayersRef = useRef(activeLayers);
  activeLayersRef.current = activeLayers;

  // transitionQueue system for de-duplicating and batching transitions in a single frame tick (Fix 2 & 5)
  const transitionQueueRef = useRef([]);

  const runTransitionsAudit = useCallback(() => {
    if (!mapInstance) return;

    // Hard Scrub Lock: Disable all raster transitions while timeline scrubbing is active (Fix 1)
    if (window.isScrubbingTimeline) {
      return;
    }

    const currentActive = activeSlotsRef.current || {};
    const targets = targetSlotsRef.current || {};
    const urls = omTileUrlsRef.current || {};
    let changed = false;
    const now = Date.now();

    Object.keys(targets).forEach(layerKey => {
      const targetSlot = targets[layerKey];
      if (targetSlot === undefined) return;

      const activeSlot = currentActive[layerKey];

      // Track target changes during high-velocity scrubs to reset the safety transition start time
      const lastTarget = lastTargetSlotsRef.current[layerKey];
      if (lastTarget !== targetSlot) {
        lastTargetSlotsRef.current[layerKey] = targetSlot;
        transitionStartTimesRef.current[layerKey] = now;
      }

      if (!transitionStartTimesRef.current[layerKey]) {
        transitionStartTimesRef.current[layerKey] = now;
      }

      const elapsed = now - transitionStartTimesRef.current[layerKey];
      const sourceId = `${layerKey}-slot-${targetSlot}-source`;
      const targetUrl = urls[`${layerKey}-slot-${targetSlot}`];

      const isTransparent = targetUrl === 'om://transparent-tile';
      let isLoaded = false;
      try {
        if (mapInstance.getSource(sourceId)) {
          const mapSource = mapInstance.getSource(sourceId);
          const sourceUrl = mapSource.url || mapSource.options?.url || (mapSource.tiles && mapSource.tiles[0]);
          const urlsMatch = mapSource && sourceUrl === targetUrl;
          if (urlsMatch && mapInstance.isSourceLoaded(sourceId) === true) {
            isLoaded = true;
          }
        }
      } catch (e) {
        // Safe fallback
      }
      const isTimeout = elapsed > 2000;

      // If a layer has no active slot (cold start)
      if (activeSlot === undefined) {
        if (isLoaded || isTransparent || isTimeout) {
          const transitionKey = `${layerKey}-undefined-${targetSlot}-${activeModel}`;
          const nowMs = Date.now();
          if (lastTransitionKey === transitionKey && (nowMs - lastTransitionTimestamp) < 300) {
            console.log(`[TRANSITION] Skip duplicate transition for key: ${transitionKey} within 300ms`);
            return;
          }
          lastTransitionKey = transitionKey;
          lastTransitionTimestamp = nowMs;

          // Push cold-start transition to the batched queue (Fix 2)
          const exists = transitionQueueRef.current.some(t => t.layerKey === layerKey && t.targetSlot === targetSlot);
          if (!exists) {
            transitionQueueRef.current.push({
              layerKey,
              activeSlot: undefined,
              targetSlot,
              timestamp: nowMs
            });
            delete transitionStartTimesRef.current[layerKey];
            changed = true;
          }
        }
        return;
      }

      if (activeSlot === targetSlot) {
        delete transitionStartTimesRef.current[layerKey];
        return;
      }

      if (isLoaded || isTransparent || isTimeout) {
        const transitionKey = `${layerKey}-${activeSlot}-${targetSlot}-${activeModel}`;
        const nowMs = Date.now();
        if (lastTransitionKey === transitionKey && (nowMs - lastTransitionTimestamp) < 300) {
          console.log(`[TRANSITION] Skip duplicate transition for key: ${transitionKey} within 300ms`);
          return;
        }
        lastTransitionKey = transitionKey;
        lastTransitionTimestamp = nowMs;

        // Push standard transition to the batched queue (Fix 2)
        const exists = transitionQueueRef.current.some(t => t.layerKey === layerKey && t.targetSlot === targetSlot);
        if (!exists) {
          transitionQueueRef.current.push({
            layerKey,
            activeSlot,
            targetSlot,
            timestamp: nowMs
          });
          delete transitionStartTimesRef.current[layerKey];
          changed = true;
        }
      }
    });

    if (changed && transitionQueueRef.current.length > 0) {
      // Coalesce / batch all transitions in a single frame tick (Fix 2 & 5)
      requestAnimationFrame(() => {
        if (window.isScrubbingTimeline) {
          transitionQueueRef.current = [];
          return;
        }

        const nextActive = { ...activeSlotsRef.current };
        let applied = false;

        transitionQueueRef.current.forEach(t => {
          if (nextActive[t.layerKey] !== t.targetSlot) {
            console.log(`[TRANSITION] [Raster Queue Transition] Processing layer '${t.layerKey}' from slot ${t.activeSlot} to ${t.targetSlot}.`);
            nextActive[t.layerKey] = t.targetSlot;
            applied = true;
          }
        });

        transitionQueueRef.current = [];

        if (applied) {
          setActiveSlots(nextActive);
        }
      });
    }
  }, [mapInstance, activeModel]);

  const checkPendingTransitions = useCallback(() => {
    if (pendingTransitionsTimeoutRef.current) clearTimeout(pendingTransitionsTimeoutRef.current);
    pendingTransitionsTimeoutRef.current = setTimeout(runTransitionsAudit, 50);
  }, [runTransitionsAudit]);

  // Bind MapLibre events and run polling when active/target slots differ
  useEffect(() => {
    if (!mapInstance) return;

    mapInstance.on('sourcedata', checkPendingTransitions);
    mapInstance.on('idle', checkPendingTransitions);
    checkPendingTransitions();

    let intervalId = null;
    const activeKeys = Object.keys(activeSlots);
    const targetKeys = Object.keys(targetSlotsRef.current || {});

    const hasDifference = activeKeys.length !== targetKeys.length || activeKeys.some(k => activeSlots[k] !== targetSlotsRef.current[k]);

    if (hasDifference) {
      intervalId = setInterval(checkPendingTransitions, 100);
    }

    return () => {
      mapInstance.off('sourcedata', checkPendingTransitions);
      mapInstance.off('idle', checkPendingTransitions);
      if (intervalId) clearInterval(intervalId);
    };
  }, [mapInstance, activeSlots, omTileUrls, checkPendingTransitions]);

  // Protocol registration, Telemetry state, and Pressure scale syncs
  useEffect(() => { registerOpenMeteoProtocol(maplibregl, setProtocolReady, MODEL_METADATA_CACHE); }, []);
  useEffect(() => { WeatherTelemetry.updateState(activeModel, activeLayers, debouncedTimeOffsetHours); }, [activeModel, activeLayers, debouncedTimeOffsetHours]);
  useEffect(() => { applyThemePressureScale(theme); }, [theme]);

  const fetchMetadata = useCallback(async (modelToCheck, signal) => {
    return fetchModelMetadata(
      modelToCheck,
      MODEL_METADATA_CACHE,
      () => setMetadataRevision(prev => prev + 1),
      signal
    );
  }, []);

  // Pre-warm ALL model metadata immediately upon mount to eliminate layer activation latency completely
  useEffect(() => {
    const allModels = [
      'ncep_gfs025', 'ncep_gfs013', 'ncep_gfswave025',
      'ecmwf_ifs025', 'ecmwf_wam025',
      'dwd_icon', 'dwd_gwam'
    ];
    allModels.forEach(m => fetchMetadata(m));
  }, [fetchMetadata]);

  // Closest time index computation
  const closestTimeIdx = useMemo(() => {
    const model = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    const meta = MODEL_METADATA_CACHE[model];
    if (!meta || !Array.isArray(meta.validTimes) || !meta.validTimes.length) return 0;
    const targetMs = Date.now() + debouncedTimeOffsetHours * 3600000;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < meta.validTimes.length; i++) {
      const diff = Math.abs(new Date(meta.validTimes[i]).getTime() - targetMs);
      if (diff < minDiff) { minDiff = diff; closestIdx = i; }
    }
    const maxAllowedIdx = meta.validTimes.length - 1;
    const resultIdx = Math.max(0, Math.min(maxAllowedIdx, closestIdx));
    return isNaN(resultIdx) ? 0 : resultIdx;
  }, [activeModel, debouncedTimeOffsetHours, metadataRevision]);
  
  const activeMarineLayerRef = useRef(activeMarineLayer);
  useEffect(() => {
    activeMarineLayerRef.current = activeMarineLayer;
  }, [activeMarineLayer]);

  const debouncedTimeOffsetHoursRef = useRef(debouncedTimeOffsetHours);
  useEffect(() => {
    debouncedTimeOffsetHoursRef.current = debouncedTimeOffsetHours;
  }, [debouncedTimeOffsetHours]);

  useEffect(() => {
    closestTimeIdxRef.current = closestTimeIdx;
  }, [closestTimeIdx]);

  // Debounced model transition and block cache clear
  useEffect(() => {
    if (!activeModel) return;
    
    // Model Set Dedupe Guard (Request 2)
    if (lastProcessedModelRef.current === activeModel) {
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
                const now = Date.now(), layers = activeLayersRef.current || [];
                let allowed = false;
                layers.forEach(layerKey => {
                  if (now - (fallbackTimestamps[layerKey] || 0) >= 2000) {
                    fallbackTimestamps[layerKey] = now;
                    allowed = true;
                  }
                });
                if (allowed) console.log('[TRANSITION] Style load safety fallback triggered');
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
      const len = Array.isArray(meta?.validTimes) ? meta.validTimes.length : 0;
      const clampedIdx = len > 0 ? Math.max(0, Math.min(len - 1, Number(idx) || 0)) : 0;
      const darkParam = (theme === 'dark' || theme === 'beach') ? '&dark=true' : '';
      const cacheBuster = cacheBustRef.current ? `&_cb=${cacheBustRef.current}` : '';
      return `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?time_step=valid_times_${clampedIdx}&variable=${variable}${darkParam}&contours=true${cacheBuster}`;
    };

    const resolveAllUrls = async () => {
      // Hard check during timeline scrubbing (Fix 1)
      if (window.isScrubbingTimeline) {
        return;
      }
      try {
        try { validateModelAccess(activeModel || 'GFS', userTier); } 
        catch (err) { console.error('[TRANSITION] LAYER_ACCESS_DENIED:', err.message); return; }

        const tasks = Object.keys(LAYER_REGISTRY)
          .filter(k => LAYER_REGISTRY[k].omVariable)
          .map(k => ({
            layerKey: k,
            variable: LAYER_REGISTRY[k].omVariable,
            entry: LAYER_REGISTRY[k],
            isActive: activeLayers.includes(k)
          }));

        const resolveModel = (entry, variable) => {
          if (entry.omModel) return entry.omModel;
          if (variable === 'wind_u_component_10m') {
            const baseModel = WIND_MODEL_MAP[activeModel] || 'ncep_gfs013';
            if (baseModel === 'dwd_icon' && debouncedTimeOffsetHours > 115) {
              return 'ncep_gfs013';
            }
            if (baseModel === 'ecmwf_ifs025' && debouncedTimeOffsetHours > 228) {
              return 'ncep_gfs013';
            }
            return baseModel;
          }
          if (entry.omModelGroup === 'marine') {
            const baseModel = MARINE_MODEL_MAP[activeModel] || 'ncep_gfswave025';
            if (baseModel === 'ecmwf_wam025' && debouncedTimeOffsetHours > 228) {
              return 'ncep_gfswave025';
            }
            if (baseModel === 'dwd_gwam' && debouncedTimeOffsetHours > 168) {
              return 'ncep_gfswave025';
            }
            return baseModel;
          }
          if (variable === 'precipitation' || variable === 'cloud_cover') {
            const baseModel = PRECIP_MODEL_MAP[activeModel] || 'dwd_icon';
            if (baseModel === 'dwd_icon' && debouncedTimeOffsetHours > 115) {
              return 'ncep_gfs013';
            }
            if (baseModel === 'ecmwf_ifs025' && debouncedTimeOffsetHours > 228) {
              return 'ncep_gfs013';
            }
            return baseModel;
          }
          if (targetModel === 'ecmwf_ifs025' && debouncedTimeOffsetHours > 228) {
            return 'ncep_gfs025'; // Fallback to GFS atmospheric
          }
          if (targetModel === 'dwd_icon' && debouncedTimeOffsetHours > 115) {
            return 'ncep_gfs025'; // Fallback to GFS atmospheric
          }
          return targetModel;
        };

        const activeTasks = tasks.filter(t => t.isActive);
        const models = [...new Set(activeTasks.map(t => resolveModel(t.entry, t.variable)))];
        window.__OM_ACTIVE_MODELS__ = models;

        const allCached = models.every(m => MODEL_METADATA_CACHE[m] && Array.isArray(MODEL_METADATA_CACHE[m].validTimes) && MODEL_METADATA_CACHE[m].validTimes.length);
        if (!allCached) {
          // Asynchronous slow-path (only used if cache is cold)
          await Promise.all(models.map(m => fetchMetadata(m)));
          if (!isMounted) return;
        }

        const newUrls = {};
        const newActiveSlots = {};
        for (const { layerKey, variable, entry, isActive } of tasks) {
          if (!isActive) {
            newActiveSlots[layerKey] = 0;
            newUrls[`${layerKey}-slot-0`] = 'om://transparent-tile';
            newUrls[`${layerKey}-slot-1`] = 'om://transparent-tile';
            newUrls[`${layerKey}-slot-2`] = 'om://transparent-tile';
            continue;
          }
          let layerModel = resolveModel(entry, variable);
          let meta = MODEL_METADATA_CACHE[layerModel] || { variables: [], validTimes: [] };
          let resolvedVar = variable;
          if (!meta.variables.includes(variable)) {
            const fb = resolveVariable(meta, variable);
            if (fb) {
              resolvedVar = fb;
            } else if (entry.omModelGroup === 'marine') {
              layerModel = 'ncep_gfswave025';
              if (!allCached) {
                meta = await fetchMetadata(layerModel);
                if (!isMounted) return;
              } else {
                meta = MODEL_METADATA_CACHE[layerModel] || meta;
              }
              const fb2 = resolveVariable(meta, variable);
              if (fb2) {
                resolvedVar = fb2;
                const fbKey = `marine-${variable}`;
                if (!loggedFallbacks.current.has(fbKey)) {
                  loggedFallbacks.current.add(fbKey);
                  console.log(`[MODEL] Marine model fallback: ${layerModel} for ${variable}`);
                }
              }
            }
          }

          if (meta.variables.includes(resolvedVar)) {
            const { validTimes } = meta;
            const targetMs = Date.now() + debouncedTimeOffsetHours * 3600000;
            let closestIdx = 0;
            let minDiff = Infinity;
            if (Array.isArray(validTimes) && validTimes.length) {
              for (let i = 0; i < validTimes.length; i++) {
                const diff = Math.abs(new Date(validTimes[i]).getTime() - targetMs);
                if (diff < minDiff) { minDiff = diff; closestIdx = i; }
              }
            }
            const maxAllowedIdx = (validTimes?.length || 1) - 1;
            closestIdx = Math.max(0, Math.min(maxAllowedIdx, closestIdx));
            if (isNaN(closestIdx)) closestIdx = 0;

            const targetUrl = trace(layerKey, 'resolve_raster', 'MapWebGL', getUrlForIndex(layerModel, resolvedVar, closestIdx));
            const currentUrls = omTileUrlsRef.current || {};
            const currentActiveSlot = activeSlotsRef.current[layerKey];

            let targetSlot = -1;
            for (let s = 0; s < 3; s++) {
              if (currentUrls[`${layerKey}-slot-${s}`] === targetUrl) {
                targetSlot = s;
                break;
              }
            }

            if (targetSlot === -1) {
              targetSlot = currentActiveSlot !== undefined ? (currentActiveSlot + 1) % 3 : 0;
            }

            newActiveSlots[layerKey] = targetSlot;
            newUrls[`${layerKey}-slot-${targetSlot}`] = targetUrl;

            if (currentActiveSlot !== undefined && currentActiveSlot !== targetSlot) {
              newUrls[`${layerKey}-slot-${currentActiveSlot}`] = currentUrls[`${layerKey}-slot-${currentActiveSlot}`] || 'om://transparent-tile';
              const thirdSlot = 3 - currentActiveSlot - targetSlot;
              if (isScrubbingRef.current) {
                newUrls[`${layerKey}-slot-${thirdSlot}`] = currentUrls[`${layerKey}-slot-${thirdSlot}`] || 'om://transparent-tile';
              } else {
                const slotPrevIdx = closestIdx - 1;
                const slotNextIdx = closestIdx + 1;
                const totalLen = Array.isArray(validTimes) ? validTimes.length : 0;
                const preloadIdx = (closestIdx % 2 === 0)
                  ? (slotNextIdx < totalLen ? slotNextIdx : slotPrevIdx)
                  : (slotPrevIdx >= 0 ? slotPrevIdx : slotNextIdx);
                if (preloadIdx >= 0 && preloadIdx < totalLen) {
                  newUrls[`${layerKey}-slot-${thirdSlot}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', getUrlForIndex(layerModel, resolvedVar, preloadIdx));
                } else {
                  newUrls[`${layerKey}-slot-${thirdSlot}`] = 'om://transparent-tile';
                }
              }
            } else if (currentActiveSlot === undefined) {
              newUrls[`${layerKey}-slot-1`] = 'om://transparent-tile';
              newUrls[`${layerKey}-slot-2`] = 'om://transparent-tile';
            }
          }
        }

        if (isMounted) {
          setOmTileUrls(prev => {
            const filtered = {};
            Object.keys(prev).forEach(key => {
              const match = key.match(/^(.+)-slot-(\d+)$/);
              if (match) {
                filtered[key] = prev[key];
              }
            });
            return { ...filtered, ...newUrls };
          });
          targetSlotsRef.current = newActiveSlots;
          
          setActiveSlots(prev => {
            const next = { ...prev };
            let changed = false;
            Object.keys(prev).forEach(k => {
              if (newActiveSlots[k] === undefined) {
                delete next[k];
                changed = true;
              }
            });
            return changed ? next : prev;
          });

          checkPendingTransitions();
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[FETCH] resolveAllUrls error:', err);
      }
    };
    
    pendingResolve.current = resolveAllUrls;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (pendingResolve.current) {
        pendingResolve.current().catch(e => {
          if (e.name !== 'AbortError') console.error('[FETCH] RAF resolve error:', e);
        });
      }
    });
    
    return () => { 
      isMounted = false; 
      controller.abort(); 
      if (rafRef.current) cancelAnimationFrame(rafRef.current); 
    };
  }, [activeModel, theme, debouncedTimeOffsetHours, activeLayers, fetchMetadata, metadataRevision, userTier]);

  // Unified Opacity Blending and Sliding Sync
  useEffect(() => {
    if (!mapInstance) return;
    try {
      activeLayers.forEach(layerKey => {
        const isMarine = LAYER_REGISTRY[layerKey]?.type === 'marine';
        const opacityExpression = getOpacityExpression(layerKey, isMarine);
        
        const dampingFactor = debouncedTimeOffsetHours > 240
          ? Math.max(0.3, 1.0 - (debouncedTimeOffsetHours - 240) * 0.005)
          : 1.0;
        const finalOpacity = dampingFactor !== 1.0
          ? opacityExpression.map((val, idx) => (idx >= 4 && idx % 2 === 0 && typeof val === 'number' ? val * dampingFactor : val))
          : opacityExpression;
        
        [0, 1, 2].forEach(slot => {
          const slotLayerId = `${layerKey}-slot-${slot}-layer`;
          if (mapInstance.getLayer(slotLayerId)) {
            safeSetPaintProperty(mapInstance, slotLayerId, 'raster-fade-duration', 150);
            safeSetPaintProperty(mapInstance, slotLayerId, 'raster-opacity-transition', { duration: 150 });
            const isActive = activeSlots[layerKey] !== undefined
              ? activeSlots[layerKey] === slot
              : (closestTimeIdxRef.current % 3) === slot;
            // Removed isTransitioning opacity zero-out to prevent solid blank-out during model changes
            safeSetPaintProperty(mapInstance, slotLayerId, 'raster-opacity', isActive ? finalOpacity : 0.0);
          }
        });
      });
    } catch (e) {
      console.warn('[TRANSITION] Failed to apply explicit blend parameter:', e);
    }
  }, [mapInstance, activeLayers, activeSlots, isTransitioning, debouncedTimeOffsetHours]);

  useEffect(() => {
    if (mapInstance) { try { mapInstance.triggerRepaint(); } catch (e) {} }
  }, [mapInstance, activeLayers, omTileUrls]);

  return {
    protocolReady,
    omTileUrls,
    activeSlots,
    isTransitioning,
    closestTimeIdx,
    debouncedTimeOffsetHours
  };

}
