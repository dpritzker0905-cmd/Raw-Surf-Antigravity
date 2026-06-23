/**
 * WebGLMarineLayer.js
 * React wrapper bridging WebGLMarineEngine to MapLibre's CustomLayerInterface.
 * Receives evolved wave field data from RenderPlanDispatcher.
 * Added once as a MapLibre custom layer — no stacking decisions.
 */
import { useEffect, useRef, useState } from 'react';
import WebGLMarineEngine from './WebGLMarineEngine';
import { registerMarineEngine, unregisterMarineEngine, updateMarineTruthTrace } from '../../engine/RenderPlanDispatcher';
import { isInCooldown, findClosestHourIndex } from './marineControllerUtils';
import { getMarineHourlyCache, getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getModelSafeMarine } from './marineController';
import { getSharedLandGeoJSON, safeMoveLayer } from './mapUtils';
import { recordClear } from './marineTransitionCoordinator';
import { updateWebGLMarineLayerDiag, computeVectorDiffAndLog } from './WebGLMarineLayerDiag';
import { createCustomLayer, LAYER_ID } from './WebGLMarineCustomLayer';

// createCustomLayer and getLongitudinalOverlap helper functions are imported from WebGLMarineCustomLayer.js

export function WebGLMarineLayer({ mapInstance, active, data, revision, onAddedChange, onError, beforeId, theme, activeLayers, activeModel = 'GFS', timeOffsetHours = 0 }) {
  const engineRef = useRef(null);
  const activeRef = useRef(active);
  const mapRef = useRef(mapInstance);
  const layerAddedRef = useRef(false);
  const onAddedChangeRef = useRef(onAddedChange);
  const onErrorRef = useRef(onError);
  const dataRef = useRef(data);
  const glRef = useRef(null);
  const themeRef = useRef(theme);
  const beforeIdRef = useRef(beforeId);
  const activeLayersRef = useRef(activeLayers);
  const activeModelRef = useRef(activeModel);
  const timeOffsetHoursRef = useRef(timeOffsetHours);
  const safeUploadRef = useRef(null);
  const lastUploadedSignatureRef = useRef('');
  const lastUploadedGridRef = useRef({
    activeModel: '',
    activeMarineLayer: '',
    gridProvider: '',
    componentLayer: '',
    boundsStr: '',
    cols: 0,
    rows: 0,
    vectorsLength: 0,
    nonzeroCount: 0,
    contentHash: 0,
    timestamp: 0,
    renderedDataHour: null
  });
  const scrubUploadTimeoutRef = useRef(null);

  const [landGeoJSON, setLandGeoJSON] = useState(null);
  const landGeoJSONRef = useRef(null);
  const landGeoJSONFailedRef = useRef(false);

  useEffect(() => {
    activeRef.current = active;
    mapRef.current = mapInstance;
    onAddedChangeRef.current = onAddedChange;
    onErrorRef.current = onError;
    dataRef.current = data;
    themeRef.current = theme;
    beforeIdRef.current = beforeId;
    activeLayersRef.current = activeLayers;
    activeModelRef.current = activeModel;
    timeOffsetHoursRef.current = timeOffsetHours;
  }, [active, mapInstance, onAddedChange, onError, data, theme, beforeId, activeLayers, activeModel, timeOffsetHours]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const requestedHour = timeOffsetHours;
    const lastSig = lastUploadedGridRef.current;
    
    const renderedDataHour = lastSig.vectorsLength > 0 ? lastSig.renderedDataHour : null;
    const parity = active && renderedDataHour !== null && requestedHour === renderedDataHour;
    
    let reason = 'parity_match';
    if (!active) {
      reason = 'layer_inactive';
    } else if (renderedDataHour === null) {
      reason = 'no_data_rendered';
    } else if (!parity) {
      let coverageMissing = false;
      const isGfsBackend = getBackendWeatherFlag() && (activeModel === 'GFS' || !activeModel);
      const isIconBackend = getBackendIconMarineFlag() && activeModel === 'ICON';
      const isCopernicusBackend = getBackendCopernicusFlag() && activeModel === 'EURO';
      const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

      if (isBackendActive) {
        const curLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
        let vpBounds = null;
        if (mapInstance) {
          try {
            const b = mapInstance.getBounds();
            vpBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
          } catch (e) {
            vpBounds = null;
          }
        }
        const cached = getModelSafeMarine(activeModel, requestedHour, curLayer, vpBounds);
        if (!cached || cached.__staleHour || cached.__failureReason || cached.grid?.__failureReason) {
          coverageMissing = true;
        }
      } else {
        const cache = getMarineHourlyCache ? getMarineHourlyCache() : null;
        if (cache?.results?.length) {
          const timeArray = cache.results[0]?.hourly?.time;
          const targetMs = Date.now() + requestedHour * 3600000;
          const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
          if (timeArray?.[idx]) {
            const cachedMs = new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').getTime();
            if (Math.abs(cachedMs - targetMs) > 3 * 3600000) {
              coverageMissing = true;
            }
          } else {
            coverageMissing = true;
          }
        } else {
          coverageMissing = true;
        }
      }

      if (coverageMissing) {
        reason = 'coverageMissing';
      } else if (isInCooldown('marine')) {
        reason = 'cooldownActive';
      } else {
        reason = 'retained_previous';
      }
    }
    
    window.__MARINE_RENDER_HOUR_PARITY__ = {
      requestedHour,
      renderedDataHour,
      parity,
      reason
    };

    if (active && !parity) {
      let statusValue = 'retained_previous_hour';
      if (reason === 'cooldownActive') {
        statusValue = 'rate_limited_cached';
      } else if (reason === 'coverageMissing') {
        statusValue = activeModel === 'EURO' ? 'no_copernicus_coverage' : 'no_backend_coverage';
      }
      window.__MARINE_HEATMAP_STATUS__ = {
        status: statusValue,
        model: activeModel,
        layer: activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves',
        hour: requestedHour,
        renderedHour: renderedDataHour,
        retainedPrevious: true
      };
    } else if (active && parity) {
      if (window.__MARINE_HEATMAP_STATUS__?.status === 'retained_previous_hour' ||
          window.__MARINE_HEATMAP_STATUS__?.status === 'no_copernicus_coverage' ||
          window.__MARINE_HEATMAP_STATUS__?.status === 'no_backend_coverage') {
        window.__MARINE_HEATMAP_STATUS__ = null;
      }
    }
  }, [timeOffsetHours, revision, active, activeModel]);

  const runDiagnosticsUpdate = (rejectionOrClearReason = null) => {
    updateWebGLMarineLayerDiag(
      engineRef.current,
      activeModelRef.current,
      activeLayersRef.current,
      timeOffsetHoursRef.current,
      lastUploadedGridRef.current
    );
  };

  const safeUploadWaveData = (reason, gl, grid, geojson) => {
    if (!engineRef.current || !gl || !grid || !grid.vectors?.length) return;
    const engine = engineRef.current;

    if (typeof window !== 'undefined') {
      window.__WEBGL_MARINE_THEME__ = themeRef.current || 'default';
      const z = mapRef.current ? mapRef.current.getZoom() : 6;
      let opacity = 0.65;
      if (z <= 2) opacity = 0.55;
      else if (z <= 5) opacity = 0.55 + (z - 2) / 3 * 0.10;
      else if (z <= 8) opacity = 0.65 + (z - 5) / 3 * 0.10;
      else if (z <= 12) opacity = 0.75 + (z - 8) / 4 * 0.05;
      else opacity = 0.85;
      window.__WEBGL_MARINE_OPACITY__ = opacity;
    }

    const gridModel = grid.__sourceModel || activeModelRef.current;
    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
    const gridProvider = grid.grid?.__gridProvider || grid.__gridProvider || 'none';
    const componentLayer = grid.grid?.__componentLayer || grid.__componentLayer || 'none';
    const actualBounds = grid.grid?.bounds || grid.bounds;
    const boundsStr = actualBounds ? `${actualBounds.west.toFixed(2)}:${actualBounds.south.toFixed(2)}:${actualBounds.east.toFixed(2)}:${actualBounds.north.toFixed(2)}` : 'none';


    const geojsonSig = geojson ? `land_${geojson.features?.length || 0}` : 'no_land';
    const themeSig = themeRef.current || 'default_style';
    const uploadSigResidency = `${gridModel}_${componentLayer}_${gridProvider}_${grid.vectors.length}_geo_${geojsonSig}_thm_${themeSig}`;
    const alreadyResident = !!engine._waveData;

    const requestedHour = timeOffsetHoursRef.current;
    const renderedDataHour = grid.hourOffset !== undefined ? grid.hourOffset : (grid.grid?.hourOffset !== undefined ? grid.grid.hourOffset : null);

    const diffResult = computeVectorDiffAndLog({
      grid,
      prev: lastUploadedGridRef.current,
      activeModel: gridModel,
      activeLayers: activeLayersRef.current,
      timeOffsetHours: requestedHour,
      gridProvider,
      componentLayer,
      boundsStr,
      geojsonSig,
      themeSig,
      uploadSigResidency,
      alreadyResident,
      activeML: activeMarineLayer
    });

    if (diffResult.shouldSkip) {
      if (diffResult.skipReason === 'skipped_identical_content_across_hours') {
        console.log(`[WebGLMarine] Skip upload for hour +${requestedHour}h: content is mathematically identical to hour +${lastUploadedGridRef.current.renderedDataHour}h`);
      }
      if (!window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__) window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__ = 0;
      window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__++;
      if (window.__MARINE_PIPELINE_TRUTH__?.counters) {
        window.__MARINE_PIPELINE_TRUTH__.counters.duplicateUploadSkipped = window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__;
      }
      window.__WEBGL_MARINE_UPLOAD_REASON__ = diffResult.skipReason;
      runDiagnosticsUpdate(diffResult.skipReason);
      return;
    }

    window.__WEBGL_MARINE_UPLOAD_REASON__ = reason;

    if (grid.__maxHeight === undefined) {
      let maxS = 0, sumS = 0, cnt = 0;
      for (const vec of grid.vectors) {
        if (vec && vec.speed > 0) { cnt++; sumS += vec.speed; if (vec.speed > maxS) maxS = vec.speed; }
      }
      grid.__maxHeight = maxS;
      grid.__meanHeight = cnt > 0 ? sumS / cnt : 0;
    }
    const maxS = grid.__maxHeight;
    const meanHeight = grid.__meanHeight;
    console.log(`[WebGLMarine] setWaveData (${reason}): ${grid.vectors.length} vectors, max=${maxS.toFixed(2)}m (forecast-authoritative)`);

    const uploadStart = Date.now();
    engine._dispatcherActive = false;
    try {
      engine.setWaveData(gl, grid, geojson);
    } catch (err) {
      console.error('[WebGLMarine] Texture encoding failed:', err.message);
      if (window.__WEATHER_TELEMETRY__) {
        window.__WEATHER_TELEMETRY__.trackTextureEncodingError(gridModel, activeMarineLayer, requestedHour, err.message);
      }
      lastUploadedSignatureRef.current = '';
      runDiagnosticsUpdate('upload_failed');
      return;
    }
    const uploadElapsed = Date.now() - uploadStart;

    updateMarineTruthTrace('upload', grid, activeModelRef.current, activeMarineLayer, timeOffsetHoursRef.current, 'forecast_direct', null, true);

    lastUploadedSignatureRef.current = uploadSigResidency;
    lastUploadedGridRef.current = {
      activeModel: gridModel,
      activeMarineLayer: activeMarineLayer,
      gridProvider: gridProvider,
      componentLayer: componentLayer,
      boundsStr: boundsStr,
      cols: grid.cols,
      rows: grid.rows,
      vectorsLength: grid.vectors.length,
      nonzeroCount: diffResult.nonzeroCount,
      contentHash: diffResult.contentHash,
      timestamp: grid.timestamp || revision || 0,
      renderedDataHour: renderedDataHour,
      geojsonSig: geojsonSig,
      themeSig: themeSig,
      uploadSig: uploadSigResidency,
      samples: diffResult.currSamples
    };

    if (!window.__WEBGL_MARINE_UPLOAD_COUNT__) window.__WEBGL_MARINE_UPLOAD_COUNT__ = 0;
    window.__WEBGL_MARINE_UPLOAD_COUNT__++;

    if (window.__MARINE_PIPELINE_TRUTH__) {
      window.__MARINE_PIPELINE_TRUTH__.webglUploads = window.__WEBGL_MARINE_UPLOAD_COUNT__;
      if (window.__MARINE_PIPELINE_TRUTH__.counters) {
        window.__MARINE_PIPELINE_TRUTH__.counters.webglUploads = window.__WEBGL_MARINE_UPLOAD_COUNT__;
      }
    }

    window.__WEBGL_MARINE_UPLOAD_DIAG__ = {
      uploadCount: window.__WEBGL_MARINE_UPLOAD_COUNT__,
      uploadSignature: uploadSigResidency,
      activeModel: activeModelRef.current, activeLayer: activeMarineLayer,
      timeOffsetHours: timeOffsetHoursRef.current, provider: grid?.__provider || 'none',
      gridProvider, sourceModel: gridModel, componentLayer,
      vectorCount: grid.vectors.length, nonzeroCount: diffResult.nonzeroCount, renderAccepted: true,
      rejectionReason: null, elapsedMs: uploadElapsed,
      timestamp: new Date().toISOString()
    };

    window.__MARINE_RENDER_SOURCE_DIAG__ = {
      sourcePath: 'direct_mapwebgl',
      heatmapProvider: gridProvider,
      gridProvider,
      sourceModel: gridModel,
      componentLayer,
      activeModel: activeModelRef.current,
      activeLayer: activeMarineLayer,
      timeOffsetHours: timeOffsetHoursRef.current,
      bounds: actualBounds ? { ...actualBounds } : null,
      cols: grid.cols,
      rows: grid.rows,
      vectorCount: grid.vectors.length,
      nonzeroCount: diffResult.nonzeroCount,
      maxHeight: maxS,
      meanHeight: meanHeight,
      timestamp: new Date().toISOString()
    };

    runDiagnosticsUpdate('upload_success');
  };

  safeUploadRef.current = safeUploadWaveData;

  useEffect(() => {
    let activeFetch = true;
    landGeoJSONFailedRef.current = false;

    getSharedLandGeoJSON()
      .then(geojson => {
        if (geojson && activeFetch) {
          setLandGeoJSON(geojson);
          landGeoJSONRef.current = geojson;
          
          const engine = engineRef.current;
          const gl = glRef.current || mapInstance?.painter?.context?.gl;
          if (engine && gl) {
            engine._landGeoJSON = geojson;
            if (dataRef.current?.vectors?.length) {
              if (safeUploadRef.current) {
                safeUploadRef.current('land_mask_upgrade', gl, dataRef.current, geojson);
              } else {
                try {
                  window.__WEBGL_MARINE_UPLOAD_REASON__ = 'land_mask_upgrade';
                  engine._dispatcherActive = false;
                  engine.setWaveData(gl, dataRef.current, geojson);
                } catch (err) {
                  console.error('[WebGLMarine] Texture encoding failed:', err.message);
                  if (window.__WEATHER_TELEMETRY__) {
                    const gridModel = dataRef.current?.__sourceModel || activeModelRef.current;
                    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
                    const requestedHour = timeOffsetHoursRef.current;
                    window.__WEATHER_TELEMETRY__.trackTextureEncodingError(gridModel, activeMarineLayer, requestedHour, err.message);
                  }
                }
              }
              if (mapInstance) mapInstance.triggerRepaint();
            }
          }
          if (mapInstance) {
            mapInstance.triggerRepaint();
          }
        }
      })
      .catch(err => {
        console.warn('[WebGLMarineLayer] Failed to load land GeoJSON:', err);
      });
    return () => { activeFetch = false; };
  }, [mapInstance]);

  useEffect(() => {
    if (!mapInstance) return;

    const engine = new WebGLMarineEngine();
    engineRef.current = engine;

    const isMobile = window.innerWidth < 768;
    engine.particleRes = isMobile ? 192 : 296;

    const customLayer = createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef, timeOffsetHoursRef, safeUploadRef, activeModelRef);

    const handleStyleData = () => {
      if (!mapInstance || !mapInstance.style) return;

      if (!mapInstance.getLayer(LAYER_ID)) {
        layerAddedRef.current = false;
        try {
          let targetBeforeId = beforeIdRef.current;
          if (!targetBeforeId) targetBeforeId = mapInstance.getLayer('ocean-mask-fill') ? 'ocean-mask-fill' : undefined;
          if (!targetBeforeId) targetBeforeId = mapInstance.getLayer('landuse') ? 'landuse' : undefined;

          mapInstance.addLayer(customLayer, targetBeforeId);
          layerAddedRef.current = true;
          if (onAddedChangeRef.current) onAddedChangeRef.current(true);
        } catch (e) {
          console.warn('[WebGLMarine-Forensic] Failed to add layer:', e.message);
        }
      } else {
        safeMoveLayer(mapInstance, LAYER_ID, beforeIdRef.current);
      }
    };

    mapInstance.on('styledata', handleStyleData);
    mapInstance.on('style.load', handleStyleData);
    handleStyleData();

    return () => {
      try {
        mapInstance.off('styledata', handleStyleData);
        mapInstance.off('style.load', handleStyleData);
        if (mapInstance.getLayer(LAYER_ID)) {
          mapInstance.removeLayer(LAYER_ID);
        }
        if (onAddedChangeRef.current) onAddedChangeRef.current(false);
      } catch (e) { /* map disposed */ }
      layerAddedRef.current = false;
      unregisterMarineEngine();
      const gl = glRef.current || mapInstance?.painter?.context?.gl;
      if (gl) {
        engine.dispose(gl);
      }
      engineRef.current = null;
    };
  }, [mapInstance]);

  useEffect(() => {
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !gl) return;

    if (!active) {
      if (engine._waveData) {
        engine.clearBuffers(gl);
        lastUploadedSignatureRef.current = '';
        lastUploadedGridRef.current = {
          activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
          boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
          sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
        };
        if (mapInstance) mapInstance.triggerRepaint();
      }
      return;
    }

    const currentData = dataRef.current;
    const isRenderable = currentData && currentData.vectors?.length > 0 && currentData.__renderable !== false;

    if (!isRenderable) {
      if (currentData?.__unsupportedLayer === true) {
        if (engine._waveData) {
          recordClear('unsupported_layer');
          engine.clearBuffers(gl);
          lastUploadedSignatureRef.current = '';
          lastUploadedGridRef.current = {
            activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
            boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
            sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
          };
          if (mapInstance) mapInstance.triggerRepaint();
        }
        runDiagnosticsUpdate('unsupported_layer');
        return;
      }

      const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
      const lastSig = lastUploadedGridRef.current;
      const modelOrLayerChanged = lastSig.activeModel !== activeModelRef.current ||
                                   lastSig.activeMarineLayer !== activeMarineLayer;
      const hourChanged = lastSig.timeOffsetHours !== timeOffsetHoursRef.current;

      const isScrubbing = window.isScrubbingTimeline || (window.lastScrubTime && (Date.now() - window.lastScrubTime < 1500));
      if (isScrubbing) {
        return;
      }

      const isFallbackSafeZero = currentData?.__provider === 'fallback_safe_zero' || currentData?.grid?.__provider === 'fallback_safe_zero';

      if (isFallbackSafeZero && !modelOrLayerChanged && !hourChanged) {
        runDiagnosticsUpdate('held_rate_limit');
        return;
      }

      // v8.0: During model/layer transitions, skip clearing and retain existing heatmap
      // until the new data arrives. This prevents the visual flash-clear that occurs
      // when the orchestrator is fetching new data and temporarily sets __renderable=false.
      const isTransitionGuard = typeof window !== 'undefined' && (
        !!window.__MARINE_TRANSITIONING__ ||
        !!window.__MARINE_FETCH_PENDING__ ||
        !!window.__MARINE_FETCH_DEBOUNCING__
      );
      // v8.1: Also hold for a TRANSIENT non-renderable commit on the SAME model/layer we're
      // already displaying (e.g. a settled-scrub refetch or aborted refetch that briefly
      // returns __renderable=false while the transition flags happen to be unset). Clearing
      // in that no-flags window is what caused the intermittent blank after scrubbing.
      // Truth-safe: same model/layer, so the held frame is NOT mislabeled — this is the
      // existing stale-good-frame retention intent. A real model/LAYER switch
      // (modelOrLayerChanged) still falls through and clears, so we never hold one layer's
      // frame under another. The next renderable commit always replaces the held frame.
      const sameTargetTransient = !modelOrLayerChanged && !!engine._waveData;
      if ((isTransitionGuard || sameTargetTransient) && lastUploadedSignatureRef.current) {
        runDiagnosticsUpdate('transition_hold');
        return;
      }

      if (engine._waveData) {
        recordClear('non_renderable_terminal');
        engine.clearBuffers(gl);
        lastUploadedSignatureRef.current = '';
        lastUploadedGridRef.current = {
          activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
          boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
          sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
        };

        if (!window.__WEBGL_MARINE_CLEAR_COUNT__) window.__WEBGL_MARINE_CLEAR_COUNT__ = 0;
        window.__WEBGL_MARINE_CLEAR_COUNT__++;
        if (window.__MARINE_PIPELINE_TRUTH__) {
          window.__MARINE_PIPELINE_TRUTH__.webglClears = window.__WEBGL_MARINE_CLEAR_COUNT__;
          if (window.__MARINE_PIPELINE_TRUTH__.counters) {
            window.__MARINE_PIPELINE_TRUTH__.counters.webglClears = window.__WEBGL_MARINE_CLEAR_COUNT__;
          }
        }

        window.__WEBGL_MARINE_UPLOAD_REASON__ = 'forced_clear';
        if (mapInstance) mapInstance.triggerRepaint();
      }
      runDiagnosticsUpdate('forced_clear');
      return;
    }

    if (window.isScrubbingTimeline) {
      window.lastScrubTime = Date.now();
    }

    const gridModel = currentData.__sourceModel || activeModel;
    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
    const gridProvider = currentData.grid?.__gridProvider || currentData.__gridProvider || 'none';
    const componentLayer = currentData.grid?.__componentLayer || currentData.__componentLayer || 'none';

    const isEuro = activeModelRef.current === 'EURO';
    const isGfsOrIcon = activeModelRef.current === 'GFS' || activeModelRef.current === 'ICON';
    const isWaves = activeMarineLayer === 'waves';

    let isValid = true;
    if (gridModel !== activeModelRef.current) isValid = false;
    if (isValid) {
      if (isGfsOrIcon) {
        if (gridProvider !== 'open-meteo' && gridProvider !== 'backend-weather-service' && gridProvider !== 'estimated' && gridProvider !== 'test-fixture') {
          isValid = false;
        } else if ((gridProvider === 'backend-weather-service' || gridProvider === 'estimated' || gridProvider === 'test-fixture') && componentLayer !== activeMarineLayer) {
          isValid = false;
        }
      } else if (isEuro) {
        const isFallbackProvider = ['gfs_estimated_fallback', 'gfs_estimated_backdrop', 'open-meteo', 'estimated', 'test-fixture'].includes(gridProvider);
        if (isWaves) {
          if (gridProvider !== 'copernicus' && gridProvider !== 'backend-weather-service' && !isFallbackProvider) {
            isValid = false;
          } else if (componentLayer !== activeMarineLayer) {
            isValid = false;
          }
        } else {
          const validEuroComponentProviders = ['copernicus', 'backend-weather-service', 'gfs_estimated_fallback', 'gfs_estimated_backdrop', 'open-meteo', 'estimated', 'test-fixture'];
          if (!validEuroComponentProviders.includes(gridProvider)) {
            isValid = false;
          } else if (componentLayer !== activeMarineLayer) {
            isValid = false;
          }
        }
      }
    }

    if (!isValid) {
      // Retain the current WebGL buffers during transition and mismatch
      // until new valid data for the active model/layer is successfully loaded and committed.
      return;
    }

    if (currentData.__renderable === false) {
      runDiagnosticsUpdate(`render_blocked: ${currentData.__renderBlockedReason || 'not_renderable'}`);
      return;
    }

    const doUpload = () => {
      const reason = window.isScrubbingTimeline ? 'scrub_settle' : 'data_commit';
      safeUploadWaveData(reason, gl, currentData, landGeoJSONRef.current);
    };

    if (scrubUploadTimeoutRef.current) clearTimeout(scrubUploadTimeoutRef.current);
    if (typeof window !== 'undefined' && window.isScrubbingTimeline) {
      // During active scrubbing, debounce the GPU texture upload so frames the user scrubs
      // past are skipped instead of each triggering encodeMarineTexture + texImage2D.
      scrubUploadTimeoutRef.current = setTimeout(doUpload, 60);
    } else {
      doUpload();
    }

    return () => {
      if (scrubUploadTimeoutRef.current) clearTimeout(scrubUploadTimeoutRef.current);
    };
  }, [revision, activeModel, timeOffsetHours, mapInstance, landGeoJSON, active]);

  useEffect(() => {
    if (!mapInstance || !active) return;
    safeMoveLayer(mapInstance, LAYER_ID, beforeId);
  }, [mapInstance, active, beforeId]);

  return null;
}

export default WebGLMarineLayer;
