/**
 * WebGLMarineLayer.js
 * React wrapper bridging WebGLMarineEngine to MapLibre's CustomLayerInterface.
 * Receives evolved wave field data from RenderPlanDispatcher.
 * Added once as a MapLibre custom layer — no stacking decisions.
 */
import { useEffect, useRef, useState } from 'react';
import WebGLMarineEngine from './WebGLMarineEngine';
import { registerMarineEngine, unregisterMarineEngine, updateMarineTruthTrace } from '../../engine/RenderPlanDispatcher';

var LAYER_ID = 'webgl-marine-particles';

export function getSharedLandGeoJSON() {
  if (typeof window === 'undefined') return Promise.resolve(null);

  if (window.__LAND_GEOJSON_CACHE__) {
    return Promise.resolve(window.__LAND_GEOJSON_CACHE__);
  }

  if (!window.__LAND_GEOJSON_PROMISE__) {
    window.__LAND_GEOJSON_PROMISE__ = fetch('/ne_50m_land.json')
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .catch(() => fetch('/ne_110m_land.json').then(res => res.json()))
      .then(geojson => {
        window.__LAND_GEOJSON_CACHE__ = geojson;
        return geojson;
      });
  }

  return window.__LAND_GEOJSON_PROMISE__;
}


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

export function safeMoveLayer(mapInstance, layerId, beforeId) {
  if (!mapInstance || !layerId) return;
  try {
    if (!mapInstance.getLayer(layerId)) return;
    
    // Resolve beforeId or fallbacks
    let targetBefore = beforeId;
    if (!targetBefore) targetBefore = mapInstance.getLayer('ocean-mask-fill') ? 'ocean-mask-fill' : undefined;
    if (!targetBefore) targetBefore = mapInstance.getLayer('landuse') ? 'landuse' : undefined;
    if (!targetBefore) targetBefore = mapInstance.getLayer('spot-geofences-layer') ? 'spot-geofences-layer' : undefined;

    if (targetBefore && !mapInstance.getLayer(targetBefore)) {
      targetBefore = undefined;
    }

    const style = mapInstance.getStyle();
    if (!style || !style.layers) return;

    const layers = style.layers;
    const layerIdx = layers.findIndex(l => l.id === layerId);
    const beforeIdx = targetBefore ? layers.findIndex(l => l.id === targetBefore) : layers.length;

    if (layerIdx === -1) return;

    // Already in correct position immediately before targetBefore
    if (layerIdx === beforeIdx - 1) {
      return;
    }

    mapInstance.moveLayer(layerId, targetBefore);
    console.log(`[WebGLMarine-Forensic] Moved layer '${layerId}' before '${targetBefore || 'TOP'}' (was at index ${layerIdx}, target before index ${beforeIdx})`);
  } catch (e) {
    console.warn(`[WebGLMarine-Forensic] safeMoveLayer error:`, e.message);
  }
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
    sampleSum: 0,
    timestamp: 0,
    timeOffsetHours: 0
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

    const diag = {
      activeModel: heatmapModel,
      activeMarineLayer: heatmapLayer,
      renderedProvider: heatmapProvider,
      componentLayer: lastSig.componentLayer || 'none',
      renderedVectorCount: lastSig.vectorsLength || 0,
      renderedNonzeroCount: lastSig.nonzeroCount || 0,
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
    let sampleSum = 0;
    if (grid.vectors) {
      const len = grid.vectors.length;
      const activeML = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
      for (let i = 0; i < len; i++) {
        const v = grid.vectors[i];
        const comp = v?.[activeML] || v;
        if (comp && comp.speed > 0) nonzeroCount++;
      }
      if (len > 0) {
        const step = Math.max(1, Math.floor(len / 10));
        for (let i = 0; i < len; i += step) {
          const v = grid.vectors[i];
          if (v) {
            const comp = v[activeML] || v;
            sampleSum += (comp?.speed || 0) + (comp?.u || 0) + (comp?.v || 0) + (comp?.period || 0);
          }
        }
      }
    }

    const geojsonSig = geojson ? `land_${geojson.features?.length || 0}` : 'no_land';
    const themeSig = themeRef.current || 'default_style';
    const uploadSigResidency = `${gridModel}_${componentLayer}_${gridProvider}_${grid.vectors.length}_nz${nonzeroCount}_ss${sampleSum.toFixed(1)}_bnd_${boundsStr}_geo_${geojsonSig}_thm_${themeSig}`;
    const alreadyResident = !!engine._waveData;

    // Build the diff diagnostic object
    const prev = lastUploadedGridRef.current || {};
    const diff = {
      model: `${prev.activeModel || 'none'} -> ${gridModel}`,
      layer: `${prev.activeMarineLayer || 'none'} -> ${activeMarineLayer}`,
      hour: `${prev.timeOffsetHours !== undefined ? prev.timeOffsetHours : 'none'} -> ${timeOffsetHoursRef.current}`,
      provider: `${prev.gridProvider || 'none'} -> ${gridProvider}`,
      bounds: `${prev.boundsStr || 'none'} -> ${boundsStr}`,
      vectorCount: `${prev.vectorsLength || 0} -> ${grid.vectors.length}`,
      nonzeroCount: `${prev.nonzeroCount || 0} -> ${nonzeroCount}`,
      sampleSum: `${prev.sampleSum?.toFixed?.(1) || '0.0'} -> ${sampleSum.toFixed(1)}`,
      landMask: `${prev.geojsonSig || 'none'} -> ${geojsonSig}`,
      theme: `${prev.themeSig || 'none'} -> ${themeSig}`,
      modelChanged: prev.activeModel !== gridModel,
      layerChanged: prev.activeMarineLayer !== activeMarineLayer,
      hourChanged: prev.timeOffsetHours !== timeOffsetHoursRef.current,
      providerChanged: prev.gridProvider !== gridProvider,
      boundsChanged: prev.boundsStr !== boundsStr,
      vectorCountChanged: prev.vectorsLength !== grid.vectors.length,
      nonzeroCountChanged: prev.nonzeroCount !== nonzeroCount,
      sampleSumChanged: Math.abs((prev.sampleSum || 0) - sampleSum) > 0.01,
      landMaskChanged: prev.geojsonSig !== geojsonSig,
      themeChanged: prev.themeSig !== themeSig,
      alreadyResident: alreadyResident,
      prevSig: prev.uploadSig || 'none',
      currSig: uploadSigResidency,
      timestamp: new Date().toISOString()
    };
    window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ = diff;

    if (lastUploadedSignatureRef.current === uploadSigResidency && alreadyResident) {
      if (!window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__) window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__ = 0;
      window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__++;
      if (window.__MARINE_PIPELINE_TRUTH__?.counters) {
        window.__MARINE_PIPELINE_TRUTH__.counters.duplicateUploadSkipped = window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__;
      }
      window.__WEBGL_MARINE_UPLOAD_REASON__ = 'duplicate_skipped';
      updateWebGLMarineLayerDiag('duplicate_skipped');
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
      sampleSum: sampleSum,
      timestamp: grid.timestamp || revision || 0,
      timeOffsetHours: timeOffsetHoursRef.current,
      geojsonSig: geojsonSig,
      themeSig: themeSig,
      uploadSig: uploadSigResidency
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
      uploadSignature: uploadSig,
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
          const validEuroComponentProviders = ['copernicus', 'gfs_estimated_backdrop', 'gfs_estimated_fallback'];
          if (!validEuroComponentProviders.includes(gridProvider) || componentLayer !== activeMarineLayer) {
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

