import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import {
  OM_MODEL_MAP,
  fetchModelMetadata,
  registerOpenMeteoProtocol,
  applyThemePressureScale,
  applyThemeWaveScale,
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
import { useModelTransition, resolveVariable } from './useModelTransition';

// Global transition registry for deduplication (Request 1)
let lastTransitionKey = null;
let lastTransitionTimestamp = 0;

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

  // NOTE: Marine mask upgrade listener REMOVED in Phase 4A.
  // Marine rendering is now 100% GPU-driven — no mask polygon, no tile cache busting.
  // The om-mask-upgraded event is no longer dispatched.
  
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

    // Hard Scrub Lock: Disable all raster transitions while timeline scrubbing is active to prevent tile flood
    if (window.isScrubbingTimeline || isScrubbingRef.current) {
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
          const urlsMatch = mapSource && mapSource.url === targetUrl;
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
    if (pendingTransitionsTimeoutRef.current) {
      clearTimeout(pendingTransitionsTimeoutRef.current);
    }
    pendingTransitionsTimeoutRef.current = setTimeout(() => {
      runTransitionsAudit();
    }, 50);
  }, [runTransitionsAudit]);

  // Bind MapLibre events and run audit when active/target slots differ
  useEffect(() => {
    if (!mapInstance) return;

    mapInstance.on('sourcedata', checkPendingTransitions);
    mapInstance.on('idle', checkPendingTransitions);
    checkPendingTransitions();

    return () => {
      mapInstance.off('sourcedata', checkPendingTransitions);
      mapInstance.off('idle', checkPendingTransitions);
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


  // Dynamic theme pressure and wave color scale synchronizer
  useEffect(() => {
    applyThemePressureScale(theme);
    applyThemeWaveScale(theme);
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
  
  const activeMarineLayerRef = useRef(activeMarineLayer);
  const debouncedTimeOffsetHoursRef = useRef(debouncedTimeOffsetHours);
  useEffect(() => {
    activeMarineLayerRef.current = activeMarineLayer;
    debouncedTimeOffsetHoursRef.current = debouncedTimeOffsetHours;
    closestTimeIdxRef.current = closestTimeIdx;
  }, [activeMarineLayer, debouncedTimeOffsetHours, closestTimeIdx]);

  // Model transition hook (extracted for LOC compliance)
  useModelTransition({
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
  });

  // URL resolution logic
  const loggedFallbacks = useRef(new Set());
  const rafRef = useRef(null);
  const pendingResolve = useRef(null);

  useEffect(() => {
    const targetModel = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    let isMounted = true;
    
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
      // Hard check during timeline scrubbing to suppress network tile storm
      if (window.isScrubbingTimeline || isScrubbingRef.current) {
        return;
      }
      try {
        try { validateModelAccess(activeModel || 'GFS', userTier); } 
        catch (err) { console.error('[TRANSITION] LAYER_ACCESS_DENIED:', err.message); return; }

        const tasks = Object.keys(LAYER_REGISTRY)
          .filter(k => LAYER_REGISTRY[k].omVariable && LAYER_REGISTRY[k].type === 'raster') // Strict isolation: visual raster layers only
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
            if (baseModel === 'dwd_icon' && debouncedTimeOffsetHours > 120) {
              return 'ncep_gfs013';
            }
            if (baseModel === 'ecmwf_ifs025' && debouncedTimeOffsetHours > 228) {
              return 'ncep_gfs013';
            }
            return baseModel;
          }
          if (entry.omModelGroup === 'marine') {
            const baseModel = MARINE_MODEL_MAP[activeModel] || 'ncep_gfswave025';
            return baseModel;
          }
          if (variable === 'precipitation' || variable === 'cloud_cover') {
            const baseModel = PRECIP_MODEL_MAP[activeModel] || 'dwd_icon';
            if (baseModel === 'dwd_icon' && debouncedTimeOffsetHours > 168) {
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
          if (targetModel === 'dwd_icon' && debouncedTimeOffsetHours > 168) {
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
            if (entry.omModelGroup === 'marine') {
              // v5.9.2: If the active marine model lacks the requested variable
              // (e.g. ecmwf_wam025 lacks swell_wave_height), render transparent tile
              // instead of silently serving GFS Wave data labeled as ECMWF.
              // The infobox capability check (isLayerSupportedByModel) will show "N/A".
              const fbKey = `marine-${variable}`;
              if (!loggedFallbacks.current.has(fbKey)) {
                loggedFallbacks.current.add(fbKey);
                console.log(`[MODEL] Marine variable ${variable} unavailable on ${layerModel} — transparent tile (no cross-model fallback)`);
              }
              // Force transparent tile — skip URL generation for this layer
              newActiveSlots[layerKey] = 0;
              newUrls[`${layerKey}-slot-0`] = 'om://transparent-tile';
              newUrls[`${layerKey}-slot-1`] = 'om://transparent-tile';
              newUrls[`${layerKey}-slot-2`] = 'om://transparent-tile';
              continue;
            } else {
              const fb = resolveVariable(meta, variable);
              if (fb) {
                resolvedVar = fb;
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

  // NOTE: Imperative opacity/fade override removed. All raster paint properties
  // (raster-opacity, raster-fade-duration) are controlled EXCLUSIVELY via
  // declarative JSX paint props in MapWebGL.js. Any imperative setPaintProperty
  // calls create a dual-control race that causes heatmap disappearance.

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
