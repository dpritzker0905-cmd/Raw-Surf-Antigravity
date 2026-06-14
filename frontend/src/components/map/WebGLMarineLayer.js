/**
 * WebGLMarineLayer.js
 * React wrapper bridging WebGLMarineEngine to MapLibre's CustomLayerInterface.
 * Receives evolved wave field data from RenderPlanDispatcher.
 * Added once as a MapLibre custom layer — no stacking decisions.
 */
import { useEffect, useRef, useState } from 'react';
import WebGLMarineEngine from './WebGLMarineEngine';
import { registerMarineEngine, unregisterMarineEngine, updateMarineTruthTrace } from '../../engine/RenderPlanDispatcher';
import { computeGridContentHash } from './marineGridHash';
import { isInCooldown, findClosestHourIndex } from './marineControllerUtils';
import { getMarineHourlyCache, getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getModelSafeMarine } from './marineController';
import { getSharedLandGeoJSON, safeMoveLayer } from './mapUtils';
import { updateWebGLMarineLayerDiag, computeVectorDiffAndLog } from './WebGLMarineLayerDiag';

var LAYER_ID = 'webgl-marine-particles';

function createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef, timeOffsetHoursRef, safeUploadRef) {
  let errorCount = 0;
  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '2d',
    engine,

    onAdd(_mapOrArgs, glArg) {
      var _gl = (glArg) ? glArg : (_mapOrArgs?.gl || _mapOrArgs?.painter?.context?.gl);
      glRef.current = _gl;
      try {
        engine.init(_gl);
        registerMarineEngine(engine, _gl);
        if (dataRef.current?.vectors?.length) {
          console.log(`[WebGLMarine] Binding initial data onAdd:`, dataRef.current.vectors.length, 'vectors (forecast-authoritative)');
          if (safeUploadRef?.current) {
            safeUploadRef.current('initial_onAdd', _gl, dataRef.current, landGeoJSONRef.current);
          } else {
            try {
              window.__WEBGL_MARINE_UPLOAD_REASON__ = 'initial_onAdd';
              engine.setWaveData(_gl, dataRef.current, landGeoJSONRef.current);
            } catch (err) {
              console.error('[WebGLMarine] Texture encoding failed:', err.message);
              if (window.__WEATHER_TELEMETRY__) {
                const gridModel = dataRef.current?.__sourceModel || 'GFS';
                const activeMarineLayer = 'waves';
                window.__WEATHER_TELEMETRY__.trackTextureEncodingError(gridModel, activeMarineLayer, 0, err.message);
              }
            }
          }
        }
      } catch (e) {
        console.error('[WebGLMarine] Init failed:', e.message);
        if (onErrorRef.current) onErrorRef.current();
      }
    },

    render(glOrArgs, matrixArg) {
      var _gl, _matrix;
      var isWebGLCtx = (glOrArgs instanceof WebGLRenderingContext || glOrArgs instanceof WebGL2RenderingContext);
      if (isWebGLCtx) {
        _gl = glOrArgs;
        if (matrixArg && matrixArg.length >= 16) {
          _matrix = matrixArg;
        } else if (matrixArg && typeof matrixArg === 'object') {
          _matrix = matrixArg.defaultProjectionData?.mainMatrix || matrixArg.mercatorMatrix || matrixArg.mainMatrix || matrixArg.modelViewProjectionMatrix;
          if (!_matrix || !_matrix.length) {
            for (var k in matrixArg) {
              var v = matrixArg[k];
              if (v && (v instanceof Float32Array || v instanceof Float64Array) && v.length === 16) {
                _matrix = v;
                break;
              }
            }
          }
          if (!_matrix || !_matrix.length) {
            var _mapFb = mapRef.current;
            if (_mapFb) {
              try { _matrix = _mapFb.transform?.mercatorMatrix || _mapFb.transform?.projMatrix; } catch(e) {}
            }
          }
        }
        if (_matrix && _matrix instanceof Float64Array) {
          _matrix = new Float32Array(_matrix);
        }
      } else if (glOrArgs && typeof glOrArgs === 'object' && glOrArgs.gl) {
        _gl = glOrArgs.gl;
        _matrix = glOrArgs.defaultProjectionData?.mainMatrix || glOrArgs.modelViewProjectionMatrix || glOrArgs.matrix;
      } else {
        _gl = glOrArgs;
        _matrix = matrixArg;
      }
      if (this._renderLogged === undefined) {
        this._renderLogged = true;
        console.log("[WebGLMarineLayer] render called! activeRef:", activeRef.current, "errorCount:", errorCount, "matrixType:", typeof _matrix, "matrixLen:", _matrix?.length);
      }
      if (!activeRef.current || errorCount > 3) {
        if (this._wasActive) {
          engine.clearBuffers(_gl);
          this._wasActive = false;
        }
        return;
      }

      this._wasActive = true;
      const map = mapRef.current;
      if (!map) return;

      try {
        const canvas = map.getCanvas();
        const zoom = map.getZoom();

        engine.render(_gl, _matrix, canvas.width, canvas.height, zoom, themeRef.current);
        map.triggerRepaint();
      } catch (e) {
        errorCount++;
        if (errorCount <= 3) {
          console.warn(`[WebGLMarine] Render error (${errorCount}/3):`, e.message);
        }
        if (errorCount === 3) {
          console.error('[WebGLMarine] Too many errors, disabling GPU marine particles.');
          if (onErrorRef.current) onErrorRef.current();
        }
      }
    },

    onRemove(_mapOrArgs, glArg) {
      var _gl = (glArg) ? glArg : (_mapOrArgs?.gl || _mapOrArgs?.painter?.context?.gl);
      engine.dispose(_gl);
      glRef.current = null;
    }
  };
}

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

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { mapRef.current = mapInstance; }, [mapInstance]);
  useEffect(() => { onAddedChangeRef.current = onAddedChange; }, [onAddedChange]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { beforeIdRef.current = beforeId; }, [beforeId]);
  useEffect(() => { activeLayersRef.current = activeLayers; }, [activeLayers]);
  useEffect(() => { activeModelRef.current = activeModel; }, [activeModel]);
  useEffect(() => { timeOffsetHoursRef.current = timeOffsetHours; }, [timeOffsetHours]);

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
  }, [data, timeOffsetHours, revision, active, activeModel]);

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
    const boundsStr = grid.bounds ? `${grid.bounds.west.toFixed(2)}:${grid.bounds.south.toFixed(2)}:${grid.bounds.east.toFixed(2)}:${grid.bounds.north.toFixed(2)}` : 'none';

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

    let maxS = 0, sumS = 0, cnt = 0;
    for (const vec of grid.vectors) {
      if (vec && vec.speed > 0) { cnt++; sumS += vec.speed; if (vec.speed > maxS) maxS = vec.speed; }
    }
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
      bounds: grid.bounds ? { ...grid.bounds } : null,
      cols: grid.cols,
      rows: grid.rows,
      vectorCount: grid.vectors.length,
      nonzeroCount: diffResult.nonzeroCount,
      maxHeight: maxS,
      meanHeight: cnt > 0 ? sumS / cnt : 0,
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

    const customLayer = createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef, timeOffsetHoursRef, safeUploadRef);

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
      engine.dispose(mapInstance.painter?.context?.gl);
      engineRef.current = null;
    };
  }, [mapInstance]);

  useEffect(() => {
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !gl) return;

    if (!data?.vectors?.length) {
      if (data?.__unsupportedLayer === true) {
        engine.clearBuffers(gl);
        lastUploadedSignatureRef.current = '';
        lastUploadedGridRef.current = {
          activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
          boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
          sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
        };
        runDiagnosticsUpdate('unsupported_layer');
        if (mapInstance) mapInstance.triggerRepaint();
        return;
      }

      const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
      const lastSig = lastUploadedGridRef.current;
      const modelOrLayerChanged = lastSig.activeModel !== activeModelRef.current ||
                                   lastSig.activeMarineLayer !== activeMarineLayer;
      const hourChanged = lastSig.timeOffsetHours !== timeOffsetHoursRef.current;

      if (window.isScrubbingTimeline) {
        return;
      }

      const isFallbackSafeZero = data?.__provider === 'fallback_safe_zero' || data?.grid?.__provider === 'fallback_safe_zero';

      if (isFallbackSafeZero && !modelOrLayerChanged && !hourChanged) {
        runDiagnosticsUpdate('held_rate_limit');
        return;
      }

      if (modelOrLayerChanged) {
        engine.clearBuffers(gl);
        lastUploadedSignatureRef.current = '';
        lastUploadedGridRef.current = {
          activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
          boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
          sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
        };
        runDiagnosticsUpdate('instant_clear_model_layer');
        if (mapInstance) mapInstance.triggerRepaint();
        return;
      }


      const clearTimer = setTimeout(() => {
        if (window.__MARINE_FETCH_PENDING__) return;

        const currentData = dataRef.current;
        const currentActiveMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
        const currentModelOrLayerOrHourChanged = lastSig.activeModel !== activeModelRef.current ||
                                                 lastSig.activeMarineLayer !== currentActiveMarineLayer ||
                                                 lastSig.timeOffsetHours !== timeOffsetHoursRef.current;
        const currentFallback = currentData?.__provider === 'fallback_safe_zero' || currentData?.grid?.__provider === 'fallback_safe_zero';

        if (currentFallback && !currentModelOrLayerOrHourChanged) {
          return;
        }

        if (!currentData?.vectors?.length) {
          engine.clearBuffers(gl);

          if (!window.__WEBGL_MARINE_CLEAR_COUNT__) window.__WEBGL_MARINE_CLEAR_COUNT__ = 0;
          window.__WEBGL_MARINE_CLEAR_COUNT__++;

          if (window.__MARINE_PIPELINE_TRUTH__) {
            window.__MARINE_PIPELINE_TRUTH__.webglClears = window.__WEBGL_MARINE_CLEAR_COUNT__;
            if (window.__MARINE_PIPELINE_TRUTH__.counters) {
              window.__MARINE_PIPELINE_TRUTH__.counters.webglClears = window.__WEBGL_MARINE_CLEAR_COUNT__;
            }
          }

          window.__WEBGL_MARINE_UPLOAD_REASON__ = 'forced_clear';
          lastUploadedSignatureRef.current = '';
          lastUploadedGridRef.current = {
            activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
            boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
            sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
          };
          runDiagnosticsUpdate('forced_clear');
          if (mapInstance) mapInstance.triggerRepaint();
        }
      }, 2000);

      return () => clearTimeout(clearTimer);
    }

    if (window.isScrubbingTimeline) {
      window.lastScrubTime = Date.now();
    }

    const gridModel = data.__sourceModel || activeModel;
    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
    const gridProvider = data.grid?.__gridProvider || data.__gridProvider || 'none';
    const componentLayer = data.grid?.__componentLayer || data.__componentLayer || 'none';

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
        if (isWaves) {
          if (gridProvider !== 'copernicus' && gridProvider !== 'backend-weather-service' && gridProvider !== 'open-meteo' && gridProvider !== 'estimated' && gridProvider !== 'test-fixture' && gridProvider !== 'gfs_estimated_fallback' && gridProvider !== 'gfs_estimated_backdrop') {
            isValid = false;
          } else if (gridProvider !== 'open-meteo' && gridProvider !== 'test-fixture' && gridProvider !== 'gfs_estimated_fallback' && gridProvider !== 'gfs_estimated_backdrop' && componentLayer !== activeMarineLayer) {
            isValid = false;
          }
        } else {
          const validEuroComponentProviders = ['copernicus', 'gfs_estimated_backdrop', 'gfs_estimated_fallback', 'backend-weather-service', 'open-meteo', 'estimated', 'test-fixture'];
          if (!validEuroComponentProviders.includes(gridProvider)) {
            isValid = false;
          } else if (componentLayer !== activeMarineLayer) {
            isValid = false;
          }
        }
      }
    }

    if (!isValid) {
      console.log(`[WebGLMarine-Validate] Grid mismatch: model=${gridModel} vs ${activeModelRef.current}`);
      engine.clearBuffers(gl);
      lastUploadedSignatureRef.current = '';
      lastUploadedGridRef.current = {
        activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
        boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
        sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
      };
      runDiagnosticsUpdate(`intent_mismatch: model=${gridModel}`);
      if (mapInstance) mapInstance.triggerRepaint();
      return;
    }

    if (data.__renderable === false) {
      runDiagnosticsUpdate(`render_blocked: ${data.__renderBlockedReason || 'not_renderable'}`);
      return;
    }

    const doUpload = () => {
      const reason = window.isScrubbingTimeline ? 'scrub_settle' : 'data_commit';
      safeUploadWaveData(reason, gl, data, landGeoJSONRef.current);
    };

    if (window.isScrubbingTimeline) {
      if (scrubUploadTimeoutRef.current) clearTimeout(scrubUploadTimeoutRef.current);
      scrubUploadTimeoutRef.current = setTimeout(() => {
        doUpload();
      }, 80);
    } else {
      if (scrubUploadTimeoutRef.current) clearTimeout(scrubUploadTimeoutRef.current);
      doUpload();
    }

    return () => {
      if (scrubUploadTimeoutRef.current) clearTimeout(scrubUploadTimeoutRef.current);
    };
  }, [data, revision, mapInstance, landGeoJSON]);

  useEffect(() => {
    if (!mapInstance || !active) return;
    safeMoveLayer(mapInstance, LAYER_ID, beforeId);
  }, [mapInstance, active, beforeId]);

  return null;
}

export default WebGLMarineLayer;
