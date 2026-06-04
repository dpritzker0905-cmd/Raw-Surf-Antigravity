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
        // Register with RenderPlanDispatcher for evolved wave field data
        registerMarineEngine(engine, _gl);
        if (dataRef.current?.vectors?.length) {
          console.log(`[WebGLMarine] Binding initial data onAdd:`, dataRef.current.vectors.length, 'vectors (forecast-authoritative)');
          if (safeUploadRef?.current) {
            safeUploadRef.current('initial_onAdd', _gl, dataRef.current, landGeoJSONRef.current);
          } else {
            engine.setWaveData(_gl, dataRef.current, landGeoJSONRef.current);
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
    
    // The actual hour of the grid currently loaded in the GPU (retained)
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
        const cached = getModelSafeMarine(activeModel, requestedHour, curLayer);
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

    // If active but parity is false, make sure infobox/heatmap status reflects retained/stale
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

  const updateWebGLMarineLayerDiag = (rejectionOrClearReason = null) => {
    if (typeof window === 'undefined') return;
    const engine = engineRef.current;
    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';
    const lastSig = lastUploadedGridRef.current;

    const infoboxModel = window.__MARINE_POINT_DIAG__?.activeModel || 'unknown';
    const infoboxLayer = window.__MARINE_POINT_DIAG__?.activeLayer || 'unknown';
    const infoboxHour = window.__MARINE_POINT_DIAG__?.timeOffsetHours !== undefined ? window.__MARINE_POINT_DIAG__?.timeOffsetHours : -999;
    const infoboxProvider = window.__MARINE_POINT_DIAG__?.provider || 'none';

    const heatmapModel = activeModelRef.current;
    const heatmapLayer = activeMarineLayer;
    const heatmapHour = timeOffsetHoursRef.current;
    const heatmapProvider = lastSig.gridProvider || 'none';

    const matches = infoboxModel === heatmapModel &&
                    infoboxLayer === heatmapLayer &&
                    infoboxHour === heatmapHour &&
                    infoboxProvider === heatmapProvider;
    const isGfsBackend = getBackendWeatherFlag() && (heatmapModel === 'GFS' || !heatmapModel);
    const isIconBackend = getBackendIconMarineFlag() && heatmapModel === 'ICON';
    const isCopernicusBackend = getBackendCopernicusFlag() && heatmapModel === 'EURO';
    const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

    const backendGridVectorCount = isBackendActive ? (lastSig.vectorsLength || 0) : 0;
    const webglSourceVectorCount = lastSig.vectorsLength || 0;
    const particleCount = engine ? (engine.particleRes ** 2) : 0;
    const renderedParticleCount = (engine && engine._waveData) ? (engine.particleRes ** 2) : 0;
    const lastUploadedGridSignature = lastSig.uploadSig || 'none';

    const diag = {
      activeModel: heatmapModel,
      activeMarineLayer: heatmapLayer,
      renderedProvider: heatmapProvider,
      componentLayer: lastSig.componentLayer || 'none',
      backendGridVectorCount,
      webglSourceVectorCount,
      particleCount,
      renderedParticleCount,
      lastUploadedGridSignature,
      waveDataPresent: !!engine?._waveData,
      timeOffsetHours: heatmapHour,
      lastUploadClearRejectionReason: rejectionOrClearReason || window.__WEBGL_MARINE_UPLOAD_REASON__ || 'none',
      infoboxHeatmapParity: matches,
      timestamp: new Date().toISOString()
    };

    window.__WebGLMarineLayer_DIAG__ = diag;
  };

  const safeUploadWaveData = (reason, gl, grid, geojson) => {
    if (!engineRef.current || !gl || !grid || !grid.vectors?.length) return;
    const engine = engineRef.current;

    const gridModel = grid.__sourceModel || activeModelRef.current;
    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';
    const gridProvider = grid.grid?.__gridProvider || grid.__gridProvider || 'none';
    const componentLayer = grid.grid?.__componentLayer || grid.__componentLayer || 'none';
    const boundsStr = grid.bounds ? `${grid.bounds.west.toFixed(2)}:${grid.bounds.south.toFixed(2)}:${grid.bounds.east.toFixed(2)}:${grid.bounds.north.toFixed(2)}` : 'none';

    let nonzeroCount = 0;
    let contentHash = 0;
    const activeML = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
    if (grid.vectors) {
      const len = grid.vectors.length;
      for (let i = 0; i < len; i++) {
        const v = grid.vectors[i];
        const comp = v?.[activeML] || v;
        if (comp && comp.speed > 0) nonzeroCount++;
      }
      contentHash = computeGridContentHash(grid, activeML);
    }

    const geojsonSig = geojson ? `land_${geojson.features?.length || 0}` : 'no_land';
    const themeSig = themeRef.current || 'default_style';
    const uploadSigResidency = `${gridModel}_${componentLayer}_${gridProvider}_${grid.vectors.length}_ch${contentHash}_bnd_${boundsStr}_geo_${geojsonSig}_thm_${themeSig}`;
    const alreadyResident = !!engine._waveData;

    const requestedHour = timeOffsetHoursRef.current;
    const renderedDataHour = grid.hourOffset !== undefined ? grid.hourOffset : (grid.grid?.hourOffset !== undefined ? grid.grid.hourOffset : null);

    // Build the diff diagnostic object
    const prev = lastUploadedGridRef.current || {};
    const hourChanged = prev.renderedDataHour !== renderedDataHour;
    const contentHashChanged = prev.contentHash !== contentHash;

    let shouldSkip = false;
    let skipReason = 'none';

    if (alreadyResident) {
      if (prev.activeModel === gridModel &&
          prev.activeMarineLayer === activeMarineLayer &&
          prev.gridProvider === gridProvider &&
          prev.boundsStr === boundsStr &&
          prev.geojsonSig === geojsonSig &&
          prev.themeSig === themeSig &&
          prev.contentHash === contentHash) {
        
        shouldSkip = true;
        if (renderedDataHour !== requestedHour) {
          skipReason = 'retained_previous_hour';
        } else {
          skipReason = hourChanged ? 'skipped_identical_content_across_hours' : 'duplicate_skipped';
        }
      }
    }

    const diff = {
      model: `${prev.activeModel || 'none'} -> ${gridModel}`,
      layer: `${prev.activeMarineLayer || 'none'} -> ${activeMarineLayer}`,
      hour: `${prev.renderedDataHour !== undefined ? prev.renderedDataHour : 'none'} -> ${requestedHour}`,
      provider: `${prev.gridProvider || 'none'} -> ${gridProvider}`,
      bounds: `${prev.boundsStr || 'none'} -> ${boundsStr}`,
      vectorCount: `${prev.vectorsLength || 0} -> ${grid.vectors.length}`,
      nonzeroCount: `${prev.nonzeroCount || 0} -> ${nonzeroCount}`,
      contentHash: `${prev.contentHash !== undefined ? prev.contentHash : 'none'} -> ${contentHash}`,
      landMask: `${prev.geojsonSig || 'none'} -> ${geojsonSig}`,
      theme: `${prev.themeSig || 'none'} -> ${themeSig}`,
      modelChanged: prev.activeModel !== gridModel,
      layerChanged: prev.activeMarineLayer !== activeMarineLayer,
      hourChanged: hourChanged,
      providerChanged: prev.gridProvider !== gridProvider,
      boundsChanged: prev.boundsStr !== boundsStr,
      vectorCountChanged: prev.vectorsLength !== grid.vectors.length,
      nonzeroCountChanged: prev.nonzeroCount !== nonzeroCount,
      contentHashChanged: contentHashChanged,
      landMaskChanged: prev.geojsonSig !== geojsonSig,
      themeChanged: prev.themeSig !== themeSig,
      alreadyResident: alreadyResident,
      shouldSkip: shouldSkip,
      skipReason: skipReason,
      prevSig: prev.uploadSig || 'none',
      currSig: uploadSigResidency,
      timestamp: new Date().toISOString()
    };
    // Add __MARINE_FORECAST_VECTOR_DIFF__ comparison
    const sampleIndices = [0, 5, 10, 20, 50, 100, 200, 300, 400, 500];
    const prevSamples = prev.samples || [];
    const currSamples = sampleIndices.map(idx => {
      const v = grid.vectors?.[idx];
      const comp = v?.[activeML] || v;
      return comp ? { idx, speed: comp.speed || 0, u: comp.u || 0, v: comp.v || 0, period: comp.period || 0 } : { idx, speed: 0, u: 0, v: 0, period: 0 };
    });

    const diffs = sampleIndices.map((idx, sIdx) => {
      const p = prevSamples[sIdx] || { speed: -1, u: 0, v: 0, period: -1 };
      const c = currSamples[sIdx];
      return {
        index: idx,
        prev: p,
        curr: c,
        identical: p.speed === c.speed && p.u === c.u && p.v === c.v && p.period === c.period
      };
    });

    window.__MARINE_FORECAST_VECTOR_DIFF__ = {
      prevHour: prev.renderedDataHour,
      currHour: requestedHour,
      activeModel: gridModel,
      activeLayer: activeMarineLayer,
      samples: diffs,
      allIdentical: diffs.every(d => d.identical),
      timestamp: new Date().toISOString()
    };

    window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ = diff;

    if (shouldSkip) {
      if (skipReason === 'skipped_identical_content_across_hours') {
        console.log(`[WebGLMarine] Skip upload for hour +${requestedHour}h: content is mathematically identical to hour +${prev.renderedDataHour}h (hash=${contentHash})`);
      } else if (skipReason === 'retained_previous_hour') {
        console.log(`[WebGLMarine] Skip upload for hour +${requestedHour}h: content is retained_previous_hour (+${renderedDataHour}h)`);
      }
      if (!window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__) window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__ = 0;
      window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__++;
      if (window.__MARINE_PIPELINE_TRUTH__?.counters) {
        window.__MARINE_PIPELINE_TRUTH__.counters.duplicateUploadSkipped = window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__;
      }
      window.__WEBGL_MARINE_UPLOAD_REASON__ = skipReason;
      updateWebGLMarineLayerDiag(skipReason);
      return;
    }

    window.__WEBGL_MARINE_UPLOAD_REASON__ = reason;

    let maxS = 0, sumS = 0, cnt = 0;
    for (const vec of grid.vectors) {
      if (vec && vec.speed > 0) { cnt++; sumS += vec.speed; if (vec.speed > maxS) maxS = vec.speed; }
    }
    console.log(`[WebGLMarine] setWaveData (${reason}): ${grid.vectors.length} vectors, max=${maxS.toFixed(2)}m, mean=${cnt > 0 ? (sumS/cnt).toFixed(2) : 0}m (forecast-authoritative)`);

    const uploadStart = Date.now();
    engine._dispatcherActive = false;
    engine.setWaveData(gl, grid, geojson);
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
      nonzeroCount: nonzeroCount,
      contentHash: contentHash,
      timestamp: grid.timestamp || revision || 0,
      renderedDataHour: renderedDataHour,
      geojsonSig: geojsonSig,
      themeSig: themeSig,
      uploadSig: uploadSigResidency,
      samples: currSamples
    };

    if (!window.__WEBGL_MARINE_UPLOAD_COUNT__) window.__WEBGL_MARINE_UPLOAD_COUNT__ = 0;
    window.__WEBGL_MARINE_UPLOAD_COUNT__++;

    if (window.__MARINE_PIPELINE_TRUTH__) {
      window.__MARINE_PIPELINE_TRUTH__.webglUploads = window.__WEBGL_MARINE_UPLOAD_COUNT__;
      if (window.__MARINE_PIPELINE_TRUTH__.counters) {
        window.__MARINE_PIPELINE_TRUTH__.counters.webglUploads = window.__WEBGL_MARINE_UPLOAD_COUNT__;
      }
    }

    const newUploadDiag = {
      uploadCount: window.__WEBGL_MARINE_UPLOAD_COUNT__,
      uploadSignature: uploadSigResidency,
      activeModel: activeModelRef.current, activeLayer: activeMarineLayer,
      timeOffsetHours: timeOffsetHoursRef.current, provider: grid?.__provider || 'none',
      gridProvider, sourceModel: gridModel, componentLayer,
      vectorCount: grid.vectors.length, nonzeroCount, renderAccepted: true,
      rejectionReason: null, elapsedMs: uploadElapsed,
      timestamp: new Date().toISOString()
    };
    window.__WEBGL_MARINE_UPLOAD_DIAG__ = newUploadDiag;

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
      nonzeroCount: nonzeroCount,
      maxHeight: maxS,
      meanHeight: cnt > 0 ? sumS / cnt : 0,
      timestamp: new Date().toISOString()
    };

    window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
      infoboxSource: window.__MARINE_POINT_DIAG__?.source || 'unknown',
      infoboxProvider: window.__MARINE_POINT_DIAG__?.provider || 'unknown',
      heatmapProvider: gridProvider,
      activeModel: activeModelRef.current,
      activeLayer: activeMarineLayer,
      timeOffsetHours: timeOffsetHoursRef.current,
      timestamp: new Date().toISOString()
    };

    window.__MARINE_RENDER_FORENSIC_DIAG__ = {
      activeModel: activeModelRef.current,
      activeLayer: activeMarineLayer,
      timeOffsetHours: timeOffsetHoursRef.current,
      sourcePath: 'direct_mapwebgl',
      marineData: {
        model: gridModel,
        provider: gridProvider,
        gridProvider: gridProvider,
        componentLayer: componentLayer
      },
      field: {
        model: gridModel,
        provider: gridProvider,
        componentLayer: componentLayer
      },
      vectorCount: grid.vectors.length,
      nonzeroCount: nonzeroCount,
      maxHeight: maxS,
      meanHeight: cnt > 0 ? sumS / cnt : 0,
      renderAccepted: true,
      rejectionReason: null,
      clearCalled: false,
      clearReason: null,
      dispatcherActiveBefore: true,
      dispatcherActiveAfter: false,
      waveDataPresentBefore: alreadyResident,
      waveDataPresentAfter: true,
      directUploadBlockedReason: null,
      uploadSource: 'forecast_direct',
      fceOverrideActive: false,
      cacheHit: false,
      cacheSource: 'none',
      networkStatus: 200,
      rateLimitStatus: 'ok',
      timestamp: new Date().toISOString()
    };

    updateWebGLMarineLayerDiag('upload_success');
  };

  safeUploadRef.current = safeUploadWaveData;

  // Load high-resolution land polygons on mount
  useEffect(() => {
    let activeFetch = true;
    landGeoJSONFailedRef.current = false;

    getSharedLandGeoJSON()
      .then(geojson => {
        if (geojson && activeFetch) {
          setLandGeoJSON(geojson);
          landGeoJSONRef.current = geojson;
          console.log('[WebGLMarineLayer] High-resolution land GeoJSON loaded for GPU mask (shared)');
          
          const engine = engineRef.current;
          const gl = glRef.current || mapInstance?.painter?.context?.gl;
          if (engine && gl) {
            engine._landGeoJSON = geojson;
            if (dataRef.current?.vectors?.length) {
              console.log('[WebGLMarineLayer] Upgrading active GPU wave texture to high-resolution land mask (forecast-authoritative)');
              if (safeUploadRef.current) {
                safeUploadRef.current('land_mask_upgrade', gl, dataRef.current, geojson);
              } else {
                engine._dispatcherActive = false;
                engine.setWaveData(gl, dataRef.current, geojson);
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
        console.warn('[WebGLMarineLayer] Failed to load land GeoJSON for high-res masking:', err);
        if (activeFetch) {
          landGeoJSONFailedRef.current = true;
        }
      });
    return () => { activeFetch = false; };
  }, [mapInstance]);

  // Initialize engine + add custom layer (NO ordering logic)
  useEffect(() => {
    if (!mapInstance) return;
    if (!active) return;

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
          if (!targetBeforeId) targetBeforeId = mapInstance.getLayer('spot-geofences-layer') ? 'spot-geofences-layer' : undefined;

          console.log(`[WebGLMarine-Forensic] Adding custom layer ${LAYER_ID} before '${targetBeforeId || 'TOP'}'`);
          mapInstance.addLayer(customLayer, targetBeforeId);
          layerAddedRef.current = true;
          console.log(`[WebGLMarine-Forensic] Layer added BEFORE '${targetBeforeId || 'TOP'}' (${engine.particleRes}^2 = ${engine.particleRes ** 2} particles)`);
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
        console.log(`[WebGLMarine-Forensic] Cleaning up custom layer ${LAYER_ID}`);
        mapInstance.off('styledata', handleStyleData);
        mapInstance.off('style.load', handleStyleData);
        if (mapInstance.getLayer(LAYER_ID)) {
          mapInstance.removeLayer(LAYER_ID);
        }
        if (onAddedChangeRef.current) onAddedChangeRef.current(false);
      } catch (e) { /* map may be disposed */ }
      layerAddedRef.current = false;
      unregisterMarineEngine();
      engine.dispose(mapInstance.painter?.context?.gl);
      engineRef.current = null;
    };
  }, [mapInstance, active]);

  // Update wave data texture when data changes
  useEffect(() => {
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !gl) return;

    if (!data?.vectors?.length) {
      if (data?.__unsupportedLayer === true) {
        console.log(`[WebGLMarine-Clear] Unsupported layer active, clearing buffers immediately`);
        engine.clearBuffers(gl);
        lastUploadedSignatureRef.current = '';
        lastUploadedGridRef.current = {
          activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
          boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
          sampleSum: 0, timestamp: 0, timeOffsetHours: 0
        };
        updateWebGLMarineLayerDiag('unsupported_layer');
        if (mapInstance) mapInstance.triggerRepaint();
        return;
      }

      const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';
      const lastSig = lastUploadedGridRef.current;
      const modelOrLayerOrHourChanged = lastSig.activeModel !== activeModelRef.current ||
                                        lastSig.activeMarineLayer !== activeMarineLayer ||
                                        lastSig.timeOffsetHours !== timeOffsetHoursRef.current;

      if (window.isScrubbingTimeline && !modelOrLayerOrHourChanged) {
        console.log(`[WebGLMarine-Scrub] Holding last valid marine texture during active scrubbing (model/layer/hour unchanged)`);
        return;
      }

      const isFallbackSafeZero = data?.__provider === 'fallback_safe_zero' || data?.grid?.__provider === 'fallback_safe_zero';

      if (isFallbackSafeZero && !modelOrLayerOrHourChanged) {
        console.log(`[WebGLMarine-Hold] Holding last valid marine texture during transient rate-limit/cooldown (model/layer/hour unchanged)`);
        updateWebGLMarineLayerDiag('held_rate_limit');
        return;
      }

      if (!modelOrLayerOrHourChanged) {
        console.log(`[WebGLMarine-Hold] Holding last valid marine texture during empty data frame (model/layer/hour unchanged)`);
        return;
      }

      console.log(`[WebGLMarine-Clear] Stale wave data received or layer switched`);
      const clearTimer = setTimeout(() => {
        if (window.__MARINE_FETCH_PENDING__) { console.log(`[WebGLMarine-Hold] Fetch pending, extending hold`); return; }

        const currentData = dataRef.current;
        const currentActiveMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';
        const currentModelOrLayerOrHourChanged = lastSig.activeModel !== activeModelRef.current ||
                                                 lastSig.activeMarineLayer !== currentActiveMarineLayer ||
                                                 lastSig.timeOffsetHours !== timeOffsetHoursRef.current;
        const currentFallback = currentData?.__provider === 'fallback_safe_zero' || currentData?.grid?.__provider === 'fallback_safe_zero';

        if (currentFallback && !currentModelOrLayerOrHourChanged) {
          console.log(`[WebGLMarine-Hold] Retaining valid texture during rate-limit in clear timer`);
          return;
        }

        if (!currentData?.vectors?.length) {
          console.log(`[WebGLMarine-Clear] Confirmed empty after delay, clearing buffers`);
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
            sampleSum: 0, timestamp: 0, timeOffsetHours: 0
          };
          updateWebGLMarineLayerDiag('forced_clear');
          if (mapInstance) mapInstance.triggerRepaint();
        }
      }, 2000);

      return () => clearTimeout(clearTimer);
    }

    if (window.isScrubbingTimeline) {
      window.lastScrubTime = Date.now();
    }

    const gridModel = data.__sourceModel || activeModel;
    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';
    const gridProvider = data.grid?.__gridProvider || data.__gridProvider || 'none';
    const componentLayer = data.grid?.__componentLayer || data.__componentLayer || 'none';

    const isEuro = activeModelRef.current === 'EURO';
    const isWaves = activeMarineLayer === 'waves';

    let isValid = true;
    if (gridModel !== activeModelRef.current) isValid = false;
    if (isValid) {
      if (gridProvider === 'estimated') {
        if (componentLayer !== activeMarineLayer) isValid = false;
      } else if (isEuro) {
        if (isWaves) {
          if (gridProvider !== 'open-meteo') isValid = false;
        } else {
          // Accept copernicus, estimated, and legacy open-meteo fallback for EURO component layers
          const validEuroComponentProviders = ['copernicus', 'gfs_estimated_backdrop', 'gfs_estimated_fallback', 'open-meteo'];
          if (!validEuroComponentProviders.includes(gridProvider)) {
            isValid = false;
          } else if (gridProvider !== 'open-meteo' && componentLayer !== activeMarineLayer) {
            // For non-legacy providers, also check componentLayer matches
            isValid = false;
          }
        }
      } else {
        if (gridProvider !== 'open-meteo') isValid = false;
      }
    }

    if (!isValid) {
      console.log(`[WebGLMarine-Validate] Grid does not match active intent (model=${gridModel} vs ${activeModelRef.current}, layer=${componentLayer} vs ${activeMarineLayer}, provider=${gridProvider}), skipping commit`);
      updateWebGLMarineLayerDiag(`intent_mismatch: model=${gridModel} vs ${activeModelRef.current}, layer=${componentLayer} vs ${activeMarineLayer}`);
      return;
    }

    if (data.__renderable === false) {
      console.log(`[WebGLMarine-Block] Skipping upload: ${data.__renderBlockedReason || 'not_renderable'}`);
      updateWebGLMarineLayerDiag(`render_blocked: ${data.__renderBlockedReason || 'not_renderable'}`);
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

