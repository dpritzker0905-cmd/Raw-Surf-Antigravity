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

  useEffect(() => {
    const now = Date.now();
    const diff = now - lastTimeOffsetChangeRef.current;
    lastTimeOffsetChangeRef.current = now;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (diff < 120) {
      // Rapid dragging / scrubbing timeline slider: debounce by 200ms
      WeatherTelemetry.trackAnimationScrub(timeOffsetHours);
      debounceTimerRef.current = setTimeout(() => {
        setDebouncedTimeOffsetHours(timeOffsetHours);
      }, 200);
    } else {
      // Single click/tap or slow adjustment: update instantly
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
  useEffect(() => {
    if (activeModel !== prevModelRef.current) {
      WeatherTelemetry.trackModelSwitch(activeModel);
      prevModelRef.current = activeModel;
    }
  }, [activeModel]);

  const prevLayersRef = useRef(activeLayers);
  useEffect(() => {
    const prev = prevLayersRef.current || [];
    const added = activeLayers.filter(x => !prev.includes(x));
    const removed = prev.filter(x => !activeLayers.includes(x));
    added.forEach(layer => WeatherTelemetry.trackLayerAttach(layer));
    removed.forEach(layer => WeatherTelemetry.trackLayerDetach(layer));
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

  const checkPendingTransitions = useCallback(() => {
    if (!mapInstance) return;

    const currentActive = activeSlotsRef.current || {};
    const targets = targetSlotsRef.current || {};
    const urls = omTileUrlsRef.current || {};
    let changed = false;
    const nextActive = { ...currentActive };
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

      // If a layer has no active slot (cold start)
      if (activeSlot === undefined) {
        nextActive[layerKey] = targetSlot;
        delete transitionStartTimesRef.current[layerKey];
        changed = true;
        return;
      }

      if (activeSlot === targetSlot) {
        delete transitionStartTimesRef.current[layerKey];
        return;
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
          // Only transition if the MapLibre source URL matches the target URL,
          // which ensures MapLibre has processed the react-map-gl commit update,
          // and isSourceLoaded is actually true for the NEW tile set.
          const urlsMatch = mapSource && mapSource.url === targetUrl;
          if (urlsMatch && mapInstance.isSourceLoaded(sourceId) === true) {
            isLoaded = true;
          }
        }
      } catch (e) {
        // Safe fallback
      }
      const isTimeout = elapsed > 800;

      if (isLoaded || isTransparent || isTimeout) {
        console.log(`[Raster Transition] Transitioning layer '${layerKey}' from slot ${activeSlot} to ${targetSlot}. Reason: Loaded=${isLoaded}, Transparent=${isTransparent}, Timeout=${isTimeout} (${elapsed}ms)`);
        nextActive[layerKey] = targetSlot;
        delete transitionStartTimesRef.current[layerKey];
        changed = true;
      }
    });

    if (changed) {
      setActiveSlots(nextActive);
    }
  }, [mapInstance]);

  // Bind MapLibre events and run polling when active/target slots differ
  useEffect(() => {
    if (!mapInstance) return;

    const onSourceData = () => {
      checkPendingTransitions();
    };
    const onIdle = () => {
      checkPendingTransitions();
    };

    mapInstance.on('sourcedata', onSourceData);
    mapInstance.on('idle', onIdle);

    // Initial check
    checkPendingTransitions();

    let intervalId = null;
    const activeKeys = Object.keys(activeSlots);
    const targetKeys = Object.keys(targetSlotsRef.current || {});

    let hasDifference = activeKeys.length !== targetKeys.length;
    if (!hasDifference) {
      for (const key of activeKeys) {
        if (activeSlots[key] !== targetSlotsRef.current[key]) {
          hasDifference = true;
          break;
        }
      }
    }

    if (hasDifference) {
      intervalId = setInterval(() => {
        checkPendingTransitions();
      }, 100);
    }

    return () => {
      mapInstance.off('sourcedata', onSourceData);
      mapInstance.off('idle', onIdle);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [mapInstance, activeSlots, omTileUrls, checkPendingTransitions]);

  // Protocol registration
  useEffect(() => {
    registerOpenMeteoProtocol(maplibregl, setProtocolReady, MODEL_METADATA_CACHE);
  }, []);

  // Sync state changes with the diagnostics telemetry engine
  useEffect(() => {
    WeatherTelemetry.updateState(activeModel, activeLayers, debouncedTimeOffsetHours);
  }, [activeModel, activeLayers, debouncedTimeOffsetHours]);


  // Dynamic theme pressure color scale synchronizer
  useEffect(() => {
    applyThemePressureScale(theme);
  }, [theme]);

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
  
  useEffect(() => {
    closestTimeIdxRef.current = closestTimeIdx;
  }, [closestTimeIdx]);

  // Debounced model transition and block cache clear
  useEffect(() => {
    if (!activeModel) return;
    
    // Synced immediately to prevent the 50ms race condition
    setMapActiveModelLock(activeModel);
    
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
                      2, layerKey === 'wind' ? 0.24 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.35 : layerKey === 'fog' ? 0.40 : layerKey === 'rain' ? 0.35 : 0.22,
                      5, layerKey === 'wind' ? 0.28 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.42 : layerKey === 'fog' ? 0.52 : layerKey === 'rain' ? 0.42 : 0.28,
                      8, layerKey === 'wind' ? 0.33 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.48 : layerKey === 'fog' ? 0.60 : layerKey === 'rain' ? 0.48 : 0.35,
                      12, layerKey === 'wind' ? 0.38 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.55 : layerKey === 'fog' ? 0.65 : layerKey === 'rain' ? 0.52 : 0.40,
                    ];
                    
                    const dampingFactor = debouncedTimeOffsetHours > 240
                      ? Math.max(0.3, 1.0 - (debouncedTimeOffsetHours - 240) * 0.005)
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
                console.log('[Raster] Style load safety fallback triggered');
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
      const len = Array.isArray(meta?.validTimes) ? meta.validTimes.length : 0;
      const clampedIdx = len > 0 ? Math.max(0, Math.min(len - 1, Number(idx) || 0)) : 0;
      const darkParam = (theme === 'dark' || theme === 'beach') ? '&dark=true' : '';
      const cacheBuster = cacheBustRef.current ? `&_cb=${cacheBustRef.current}` : '';
      return `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?time_step=valid_times_${clampedIdx}&variable=${variable}${darkParam}&contours=true${cacheBuster}`;
    };

    const resolveAllUrls = async () => {
      try {
        try { validateModelAccess(activeModel || 'GFS', userTier); } 
        catch (err) { console.error('[MapWebGL] LAYER_ACCESS_DENIED:', err.message); return; }

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

        // FAST-PATH: If all models are warm in cache, resolve SYNCHRONOUSLY to prevent timeline scrubbing delay
        const allCached = models.every(m => MODEL_METADATA_CACHE[m] && Array.isArray(MODEL_METADATA_CACHE[m].validTimes) && MODEL_METADATA_CACHE[m].validTimes.length);
        if (allCached) {
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
            let meta = MODEL_METADATA_CACHE[layerModel];
            let resolvedVar = variable;
            if (!meta.variables.includes(variable)) {
              const VARIABLE_FALLBACKS = {
                'wind_speed_10m': 'wind_gusts_10m',
                'wind_gusts_10m': 'wind_u_component_10m',
                'visibility': 'cloud_cover_low',
                'secondary_swell_wave_height': 'swell_wave_height',
                'swell_wave_height': 'wave_height',
                'wind_wave_height': 'wave_height'
              };
              let currentVar = variable;
              while (currentVar && !meta.variables.includes(currentVar)) {
                const fb = VARIABLE_FALLBACKS[currentVar];
                if (fb) currentVar = fb;
                else break;
              }
              if (meta.variables.includes(currentVar)) {
                resolvedVar = currentVar;
              } else if (entry.omModelGroup === 'marine') {
                layerModel = 'ncep_gfswave025';
                meta = MODEL_METADATA_CACHE[layerModel] || meta;
                if (meta.variables.includes(variable)) {
                  resolvedVar = variable;
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

              const slotCurrent = closestIdx % 3;
              newActiveSlots[layerKey] = slotCurrent;
              const slotPrev = (closestIdx - 1 + 3) % 3;
              const slotNext = (closestIdx + 1) % 3;
              const totalLen = Array.isArray(validTimes) ? validTimes.length : 0;
              newUrls[`${layerKey}-slot-${slotCurrent}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', getUrlForIndex(layerModel, resolvedVar, closestIdx));
              newUrls[`${layerKey}-slot-${slotPrev}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', closestIdx > 0 ? getUrlForIndex(layerModel, resolvedVar, closestIdx - 1) : getUrlForIndex(layerModel, resolvedVar, closestIdx));
              newUrls[`${layerKey}-slot-${slotNext}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', closestIdx < totalLen - 1 ? getUrlForIndex(layerModel, resolvedVar, closestIdx + 1) : getUrlForIndex(layerModel, resolvedVar, closestIdx));
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
            checkPendingTransitions();
          }
          return;
        }

        // Asynchronous slow-path (only used if cache is cold)
        await Promise.all(models.map(m => fetchMetadata(m)));
        if (!isMounted) return;

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
          let meta = await fetchMetadata(layerModel);
          if (!isMounted) return;
          let resolvedVar = variable;
          if (!meta.variables.includes(variable)) {
            const VARIABLE_FALLBACKS = {
              'wind_speed_10m': 'wind_gusts_10m',
              'wind_gusts_10m': 'wind_u_component_10m',
              'visibility': 'cloud_cover_low',
              'secondary_swell_wave_height': 'swell_wave_height',
              'swell_wave_height': 'wave_height',
              'wind_wave_height': 'wave_height'
            };
            let currentVar = variable;
            while (currentVar && !meta.variables.includes(currentVar)) {
              const fb = VARIABLE_FALLBACKS[currentVar];
              if (fb) currentVar = fb;
              else break;
            }
            if (meta.variables.includes(currentVar)) {
              resolvedVar = currentVar;
            } else if (entry.omModelGroup === 'marine') {
              layerModel = 'ncep_gfswave025';
              if (window.__OM_ACTIVE_MODELS__ && !window.__OM_ACTIVE_MODELS__.includes(layerModel)) {
                window.__OM_ACTIVE_MODELS__.push(layerModel);
              }
              meta = await fetchMetadata(layerModel);
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

            const slotCurrent = closestIdx % 3;
            newActiveSlots[layerKey] = slotCurrent;
            const slotPrev = (closestIdx - 1 + 3) % 3;
            const slotNext = (closestIdx + 1) % 3;
            const totalLen = Array.isArray(validTimes) ? validTimes.length : 0;
            newUrls[`${layerKey}-slot-${slotCurrent}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', getUrlForIndex(layerModel, resolvedVar, closestIdx));
            newUrls[`${layerKey}-slot-${slotPrev}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', closestIdx > 0 ? getUrlForIndex(layerModel, resolvedVar, closestIdx - 1) : getUrlForIndex(layerModel, resolvedVar, closestIdx));
            newUrls[`${layerKey}-slot-${slotNext}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', closestIdx < totalLen - 1 ? getUrlForIndex(layerModel, resolvedVar, closestIdx + 1) : getUrlForIndex(layerModel, resolvedVar, closestIdx));
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
          checkPendingTransitions();
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
  }, [activeModel, theme, debouncedTimeOffsetHours, activeLayers, fetchMetadata, metadataRevision, userTier]);

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
          2, layerKey === 'wind' ? 0.24 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.35 : layerKey === 'fog' ? 0.40 : layerKey === 'rain' ? 0.35 : 0.22,
          5, layerKey === 'wind' ? 0.28 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.42 : layerKey === 'fog' ? 0.52 : layerKey === 'rain' ? 0.42 : 0.28,
          8, layerKey === 'wind' ? 0.33 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.48 : layerKey === 'fog' ? 0.60 : layerKey === 'rain' ? 0.48 : 0.35,
          12, layerKey === 'wind' ? 0.38 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.55 : layerKey === 'fog' ? 0.65 : layerKey === 'rain' ? 0.52 : 0.40,
        ];
        
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
      console.warn('[MapWebGL] Failed to apply explicit blend parameter:', e);
    }
  }, [mapInstance, activeLayers, activeSlots, isTransitioning, debouncedTimeOffsetHours]);

  useEffect(() => {
    if (mapInstance) {
      try { mapInstance.triggerRepaint(); } catch (e) { /* ignore */ }
    }
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
