/**
 * WebGLMarineLayer.js
 * React wrapper bridging WebGLMarineEngine to MapLibre's CustomLayerInterface.
 * Receives evolved wave field data from RenderPlanDispatcher.
 * Added once as a MapLibre custom layer — no stacking decisions.
 */
import { useEffect, useRef, useState } from 'react';
import WebGLMarineEngine from './WebGLMarineEngine';
import { registerMarineEngine, unregisterMarineEngine } from '../../engine/RenderPlanDispatcher';

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


function createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef, timeOffsetHoursRef) {
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
          console.log(`[WebGLMarine] Binding initial data onAdd:`, dataRef.current.vectors.length, 'vectors (FCE direct-grid)');
          engine.setWaveData(_gl, dataRef.current, landGeoJSONRef.current);
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
          
          // Force active wave texture upgrade to high-res land mask immediately
          const engine = engineRef.current;
          const gl = glRef.current || mapInstance?.painter?.context?.gl;
          if (engine && gl) {
            engine._landGeoJSON = geojson;
            if (!engine._dispatcherActive && dataRef.current?.vectors?.length) {
              console.log('[WebGLMarineLayer] Upgrading active GPU wave texture to high-resolution land mask');
              engine.setWaveData(gl, dataRef.current, geojson);
              if (mapInstance) mapInstance.triggerRepaint();
            } else {
              console.log('[WebGLMarineLayer] High-resolution land mask stashed; background dispatcher will apply it on the next frame');
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

    const customLayer = createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef, timeOffsetHoursRef);

    // Add layer once when style is loaded. Re-add on theme/style changes.
    const handleStyleData = () => {
      if (!mapInstance || !mapInstance.style) return;

      // Only add the layer if it doesn't already exist to prevent re-entrant infinite loops
      if (!mapInstance.getLayer(LAYER_ID)) {
        layerAddedRef.current = false;
        try {
          // Insert BEFORE beforeId or ocean-mask-fill so land mask renders on top, naturally clipping any bleed.
          // Falls back to landuse or spot-geofences-layer if mask layer doesn't exist yet.
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
        // Safeguard: ensure the layer is positioned BEFORE targetBeforeId or 'ocean-mask-fill' if it exists.
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

    // Expose forensic diagnostics detailing active states
    if (typeof window !== 'undefined') {
      const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';
      const dispatcherActive = !!engine?._dispatcherActive;
      const visualSource = dispatcherActive ? 'render_plan_dispatcher' : 'direct_mapwebgl';
      
      let maxH = 0, sumH = 0, cntH = 0;
      if (data?.vectors) {
        for (const vec of data.vectors) {
          if (vec && vec.speed > 0) {
            cntH++; sumH += vec.speed; if (vec.speed > maxH) maxH = vec.speed;
          }
        }
      }

      window.__MARINE_RENDER_FORENSIC_DIAG__ = {
        activeModel: activeModelRef.current,
        activeLayer: activeMarineLayer,
        timeOffsetHours: timeOffsetHoursRef.current,
        sourcePath: visualSource,
        marineData: {
          model: data?.__sourceModel || 'unknown',
          provider: data?.__provider || 'none',
          gridProvider: data?.__gridProvider || 'none',
          componentLayer: data?.__componentLayer || 'none'
        },
        field: {
          model: activeModelRef.current,
          provider: data?.__gridProvider || 'none',
          componentLayer: data?.__componentLayer || 'none'
        },
        vectorCount: data?.vectors?.length || 0,
        nonzeroCount: cntH,
        maxHeight: maxH,
        meanHeight: cntH > 0 ? sumH / cntH : 0,
        renderAccepted: !!data?.vectors?.length,
        rejectionReason: data?.vectors?.length ? null : 'Empty vector data',
        clearCalled: false,
        clearReason: null,
        dispatcherActiveBefore: dispatcherActive,
        dispatcherActiveAfter: dispatcherActive,
        waveDataPresentBefore: !!engine?._waveData,
        waveDataPresentAfter: !!engine?._waveData,
        directUploadBlockedReason: dispatcherActive ? 'RenderPlanDispatcher is active' : null,
        cacheHit: false,
        cacheSource: 'none',
        networkStatus: data ? 200 : 502,
        rateLimitStatus: 'ok',
        timestamp: new Date().toISOString()
      };
    }

    if (!data?.vectors?.length) {
      const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';
      const lastSig = lastUploadedGridRef.current;
      const modelOrLayerChanged = lastSig.activeModel !== activeModelRef.current ||
                                  lastSig.activeMarineLayer !== activeMarineLayer;

      if (window.isScrubbingTimeline && !modelOrLayerChanged) {
        console.log(`[WebGLMarine-Scrub] Holding last valid marine texture during active scrubbing (model/layer unchanged)`);
        return;
      }

      const isFallbackSafeZero = data?.__provider === 'fallback_safe_zero' || data?.grid?.__provider === 'fallback_safe_zero';

      if (isFallbackSafeZero || !modelOrLayerChanged) {
        console.log(`[WebGLMarine-Hold] Holding last valid marine texture during transient error or empty data (model/layer unchanged)`);
        return; // DO NOT CLEAR TEXTURES! Just hold last good resident state!
      }

      console.log(`[WebGLMarine-Clear] Stale wave data received or layer switched, clearing active textures`);
      if (typeof window !== 'undefined') {
        const dispatcherActive = !!engine?._dispatcherActive;
        const waveDataPresentBefore = !!engine?._waveData;

        window.__WEBGL_MARINE_UPLOAD_DIAG__ = {
          activeModel: activeModelRef.current,
          activeLayer: activeMarineLayer,
          timeOffsetHours: timeOffsetHoursRef.current,
          provider: 'none',
          gridProvider: 'none',
          sourceModel: 'none',
          componentLayer: 'none',
          vectorCount: 0,
          nonzeroCount: 0,
          renderAccepted: false,
          rejectionReason: 'Empty grid data or layer switched (buffers cleared)',
          timestamp: new Date().toISOString()
        };

        window.__MARINE_RENDER_FORENSIC_DIAG__ = {
          activeModel: activeModelRef.current,
          activeLayer: activeMarineLayer,
          timeOffsetHours: timeOffsetHoursRef.current,
          sourcePath: isFallbackSafeZero ? 'held_last_good' : 'cleared',
          marineData: {
            model: activeModelRef.current,
            provider: isFallbackSafeZero ? 'fallback_safe_zero' : 'none',
            gridProvider: isFallbackSafeZero ? 'fallback_safe_zero' : 'none',
            componentLayer: 'none'
          },
          field: {
            model: activeModelRef.current,
            provider: 'none',
            componentLayer: 'none'
          },
          vectorCount: 0,
          nonzeroCount: 0,
          maxHeight: 0,
          meanHeight: 0,
          renderAccepted: false,
          rejectionReason: 'Empty grid data or layer switched',
          clearCalled: !isFallbackSafeZero && modelOrLayerChanged,
          clearReason: !isFallbackSafeZero && modelOrLayerChanged ? 'Layer switched or stale grid' : null,
          dispatcherActiveBefore: dispatcherActive,
          dispatcherActiveAfter: dispatcherActive,
          waveDataPresentBefore: waveDataPresentBefore,
          waveDataPresentAfter: isFallbackSafeZero || !modelOrLayerChanged ? waveDataPresentBefore : false,
          directUploadBlockedReason: null,
          cacheHit: false,
          cacheSource: 'none',
          networkStatus: isFallbackSafeZero ? 429 : 502,
          rateLimitStatus: isFallbackSafeZero ? 'rate_limited' : 'ok',
          timestamp: new Date().toISOString()
        };
      }
      lastUploadedGridRef.current = {
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
      };
      engine.clearBuffers(gl);
      if (mapInstance) {
        mapInstance.triggerRepaint();
      }
      return;
    }

    if (engine._dispatcherActive && !window.isScrubbingTimeline) {
      console.log(`[WebGLMarine] Skipping React effect setWaveData because RenderPlanDispatcher is active`);
      return;
    }

    const gridModel = data.__sourceModel || activeModel;
    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';
    const gridProvider = data.grid?.__gridProvider || data.__gridProvider || 'none';
    const componentLayer = data.grid?.__componentLayer || data.__componentLayer || 'none';
    const boundsStr = data.bounds ? `${data.bounds.west.toFixed(2)}:${data.bounds.south.toFixed(2)}:${data.bounds.east.toFixed(2)}:${data.bounds.north.toFixed(2)}` : 'none';

    // Make sure we have vectors and they match the active model and active marine layer
    const isEuro = activeModelRef.current === 'EURO';
    const isWaves = activeMarineLayer === 'waves';
    const isComponent = ['swell_1', 'swell_2', 'wind_waves'].includes(activeMarineLayer);

    // Validate that the grid is matching the active view intent
    let isValid = true;
    if (gridModel !== activeModelRef.current) {
      isValid = false;
    }
    if (isValid) {
      if (gridProvider === 'estimated') {
        if (componentLayer !== activeMarineLayer) {
          isValid = false;
        }
      } else if (isEuro) {
        if (isWaves) {
          if (gridProvider !== 'open-meteo') {
            isValid = false;
          }
        } else {
          if (gridProvider !== 'copernicus' || componentLayer !== activeMarineLayer) {
            isValid = false;
          }
        }
      } else {
        if (gridProvider !== 'open-meteo') {
          isValid = false;
        }
      }
    }

    if (!isValid) {
      console.log(`[WebGLMarine-Validate] Grid does not match active intent (model=${gridModel} vs ${activeModelRef.current}, layer=${componentLayer} vs ${activeMarineLayer}, provider=${gridProvider}), skipping commit`);
      if (typeof window !== 'undefined') {
        let nzCount = 0;
        if (data.vectors) {
          for (const vec of data.vectors) {
            if (vec && vec.speed > 0) nzCount++;
          }
        }
        window.__WEBGL_MARINE_UPLOAD_DIAG__ = {
          activeModel: activeModelRef.current,
          activeLayer: activeMarineLayer,
          timeOffsetHours: timeOffsetHoursRef.current,
          provider: data?.__provider || 'none',
          gridProvider,
          sourceModel: gridModel,
          componentLayer,
          vectorCount: data.vectors?.length || 0,
          nonzeroCount: nzCount,
          renderAccepted: false,
          rejectionReason: `Grid does not match active intent (model=${gridModel} vs ${activeModelRef.current}, layer=${componentLayer} vs ${activeMarineLayer}, provider=${gridProvider})`,
          timestamp: new Date().toISOString()
        };

        const dispatcherActive = !!engine?._dispatcherActive;
        const waveDataPresentBefore = !!engine?._waveData;
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
          vectorCount: data.vectors?.length || 0,
          nonzeroCount: nzCount,
          maxHeight: 0,
          meanHeight: 0,
          renderAccepted: false,
          rejectionReason: `Grid does not match active intent (model=${gridModel} vs ${activeModelRef.current}, layer=${componentLayer} vs ${activeMarineLayer}, provider=${gridProvider})`,
          clearCalled: false,
          clearReason: null,
          dispatcherActiveBefore: dispatcherActive,
          dispatcherActiveAfter: dispatcherActive,
          waveDataPresentBefore: waveDataPresentBefore,
          waveDataPresentAfter: waveDataPresentBefore,
          directUploadBlockedReason: null,
          cacheHit: false,
          cacheSource: 'none',
          networkStatus: 502,
          rateLimitStatus: 'ok',
          timestamp: new Date().toISOString()
        };
      }
      return;
    }

    let nonzeroCount = 0;
    let sampleSum = 0;
    if (data.vectors) {
      const len = data.vectors.length;
      for (let i = 0; i < len; i++) {
        const v = data.vectors[i];
        if (v && v.speed > 0) nonzeroCount++;
      }
      if (len > 0) {
        const step = Math.max(1, Math.floor(len / 10));
        for (let i = 0; i < len; i += step) {
          const v = data.vectors[i];
          if (v) {
            sampleSum += (v.speed || 0) + (v.u || 0) + (v.v || 0) + (v.period || 0);
          }
        }
      }
    }

    const currentTimestamp = data.timestamp || revision || 0;
    const lastSig = lastUploadedGridRef.current;

    const gridChanged = lastSig.activeModel !== gridModel ||
                        lastSig.activeMarineLayer !== activeMarineLayer ||
                        lastSig.gridProvider !== gridProvider ||
                        lastSig.componentLayer !== componentLayer ||
                        lastSig.boundsStr !== boundsStr ||
                        lastSig.cols !== data.cols ||
                        lastSig.rows !== data.rows ||
                        lastSig.vectorsLength !== data.vectors.length ||
                        lastSig.nonzeroCount !== nonzeroCount ||
                        Math.abs(lastSig.sampleSum - sampleSum) > 0.001 ||
                        lastSig.timeOffsetHours !== timeOffsetHoursRef.current;

    if (!gridChanged) {
      // Data is identical, skip setWaveData upload to avoid rendering churn
      return;
    }

    lastUploadedGridRef.current = {
      activeModel: gridModel,
      activeMarineLayer: activeMarineLayer,
      gridProvider: gridProvider,
      componentLayer: componentLayer,
      boundsStr: boundsStr,
      cols: data.cols,
      rows: data.rows,
      vectorsLength: data.vectors.length,
      nonzeroCount: nonzeroCount,
      sampleSum: sampleSum,
      timestamp: currentTimestamp,
      timeOffsetHours: timeOffsetHoursRef.current
    };

    const doUpload = () => {
      try {
        // Diagnostic: expose marine data props for console verification
        if (typeof window !== 'undefined') {
          window.__MARINE_DATA_PROPS__ = {
            vectorCount: data.vectors.length,
            cols: data.cols,
            rows: data.rows,
            bounds: data.bounds,
            sampleSpeed: data.vectors[0]?.speed,
            timestamp: Date.now()
          };
        }
        // FORENSIC: Log what FCE direct-grid is uploading
        let maxS = 0, sumS = 0, cnt = 0;
        for (const vec of data.vectors) {
          if (vec && vec.speed > 0) { cnt++; sumS += vec.speed; if (vec.speed > maxS) maxS = vec.speed; }
        }
        console.log(`[WebGLMarine] setWaveData: ${data.vectors.length} vectors, max=${maxS.toFixed(2)}m, mean=${cnt > 0 ? (sumS/cnt).toFixed(2) : 0}m (FCE direct-grid)`);
        
        const uploadStart = Date.now();
        engine.setWaveData(gl, data, landGeoJSONRef.current);
        const uploadElapsed = Date.now() - uploadStart;

        if (typeof window !== 'undefined') {
          window.__WEBGL_MARINE_UPLOAD_DIAG__ = {
            activeModel: activeModelRef.current,
            activeLayer: activeMarineLayer,
            timeOffsetHours: timeOffsetHoursRef.current,
            provider: data?.__provider || 'none',
            gridProvider,
            sourceModel: gridModel,
            componentLayer,
            vectorCount: data.vectors.length,
            nonzeroCount: nonzeroCount,
            renderAccepted: true,
            rejectionReason: null,
            elapsedMs: uploadElapsed,
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
            bounds: data.bounds ? { ...data.bounds } : null,
            cols: data.cols,
            rows: data.rows,
            vectorCount: data.vectors.length,
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

          // Populate unified forensic diagnostics
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
            vectorCount: data.vectors.length,
            nonzeroCount: nonzeroCount,
            maxHeight: maxS,
            meanHeight: cnt > 0 ? sumS / cnt : 0,
            renderAccepted: true,
            rejectionReason: null,
            clearCalled: false,
            clearReason: null,
            dispatcherActiveBefore: !!engine?._dispatcherActive,
            dispatcherActiveAfter: !!engine?._dispatcherActive,
            waveDataPresentBefore: !!engine?._waveData,
            waveDataPresentAfter: true,
            directUploadBlockedReason: null,
            cacheHit: false,
            cacheSource: 'none',
            networkStatus: 200,
            rateLimitStatus: 'ok',
            timestamp: new Date().toISOString()
          };
        }

        if (mapInstance) {
          mapInstance.triggerRepaint();
        }
      } catch (e) {
        console.warn('[WebGLMarine] setWaveData error:', e.message);
        if (typeof window !== 'undefined') {
          window.__WEBGL_MARINE_UPLOAD_DIAG__ = {
            activeModel: activeModelRef.current,
            activeLayer: activeMarineLayer,
            timeOffsetHours: timeOffsetHoursRef.current,
            provider: data?.__provider || 'none',
            gridProvider,
            sourceModel: gridModel,
            componentLayer,
            vectorCount: data.vectors?.length || 0,
            nonzeroCount: nonzeroCount,
            renderAccepted: false,
            rejectionReason: `Upload Exception: ${e.message}`,
            timestamp: new Date().toISOString()
          };
        }
      }
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
      if (scrubUploadTimeoutRef.current) {
        clearTimeout(scrubUploadTimeoutRef.current);
      }
    };
  }, [data, revision, mapInstance, landGeoJSON]);

  // Enforce layer order safeguard ONLY on beforeId or active or mapInstance changes (NOT high-frequency data/revision)
  useEffect(() => {
    if (!mapInstance || !active) return;
    safeMoveLayer(mapInstance, LAYER_ID, beforeId);
  }, [mapInstance, active, beforeId]);

  return null;
}

export default WebGLMarineLayer;
