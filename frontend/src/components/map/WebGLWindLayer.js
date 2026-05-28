/**
 * WebGLWindLayer MapLibre custom layer integration for GPU wind particles
 *
 * v3.8: React component wrapping WebGLWindEngine as a MapLibre CustomLayerInterface.
 * Replaces Canvas2D GPUWindLayer when wind data is available.
 *
 * Props:
 *   - mapInstance: MapLibre map ref
 *   - active: boolean - whether wind layer is toggled on
 *   - data: wind grid object { vectors, cols, rows, bounds }
 *   - revision: cache-bust revision ID
 */
import { useEffect, useRef } from 'react';
import WebGLWindEngine from './WebGLWindEngine';
import { registerWindEngine, unregisterWindEngine } from '../../engine/RenderPlanDispatcher';

var LAYER_ID = 'webgl-wind-particles';

/**
 * Creates a MapLibre CustomLayerInterface that delegates rendering
 * to the WebGLWindEngine.
 */
function createCustomLayer(engine, activeRef, mapRef, glRef, onErrorRef) {
  let errorCount = 0;
  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    onAdd(_mapOrArgs, glArg) {
      // v5 compat: MapLibre v5 may pass args object
      var _gl = (glArg) ? glArg : (_mapOrArgs?.gl || _mapOrArgs?.painter?.context?.gl);
      glRef.current = _gl;
      try {
        engine.init(_gl);
        // Register with RenderPlanDispatcher for evolved field data
        registerWindEngine(engine, _gl);
      } catch (e) {
        console.error('[WebGLWind] Init failed:', e.message);
        if (onErrorRef.current) onErrorRef.current();
      }
    },

    render(glOrArgs, matrixArg) {
      // v5 compat: MapLibre v5 passes (gl, matrixObj) where matrixObj is a wrapper
      // v4 API was (gl, Float32Array)
      var _gl, _matrix;
      var isWebGLCtx = (glOrArgs instanceof WebGLRenderingContext || glOrArgs instanceof WebGL2RenderingContext);
      if (isWebGLCtx) {
        // v4 or v5 with positional args — gl is a real WebGL context
        _gl = glOrArgs;
        // In v5, matrix may be a wrapper object instead of Float32Array
        if (matrixArg && matrixArg.length >= 16) {
          _matrix = matrixArg; // v4 style: Float32Array(16)
        } else if (matrixArg && typeof matrixArg === 'object') {
          // v5 style: Object with matrix properties
          // Our shader expects mercator [0,1] coords → clip space, which is defaultProjectionData.mainMatrix (= mercatorMatrix)
          // modelViewProjectionMatrix is NOT suitable (it's in a different coordinate space)
          _matrix = matrixArg.defaultProjectionData?.mainMatrix || matrixArg.mercatorMatrix || matrixArg.mainMatrix || matrixArg.modelViewProjectionMatrix;
          if (!_matrix || !_matrix.length) {
            // Fallback: search all values for a Float32Array/Float64Array of length 16
            for (var k in matrixArg) {
              var v = matrixArg[k];
              if (v && (v instanceof Float32Array || v instanceof Float64Array) && v.length === 16) {
                _matrix = v;
                break;
              }
            }
          }
          // Ultimate fallback: build matrix from map transform
          if (!_matrix || !_matrix.length) {
            var _mapFb = mapRef.current;
            if (_mapFb) {
              try {
                _matrix = _mapFb.transform?.mercatorMatrix || _mapFb.transform?.projMatrix;
              } catch(e) { /* ignore */ }
            }
          }
        }
        // Convert Float64Array → Float32Array for gl.uniformMatrix4fv compatibility
        if (_matrix && _matrix instanceof Float64Array) {
          _matrix = new Float32Array(_matrix);
        }
      } else if (glOrArgs && typeof glOrArgs === 'object' && glOrArgs.gl) {
        // Pure v5 args-object style
        _gl = glOrArgs.gl;
        _matrix = glOrArgs.defaultProjectionData?.mainMatrix || glOrArgs.modelViewProjectionMatrix || glOrArgs.matrix;
      } else {
        _gl = glOrArgs;
        _matrix = matrixArg;
      }
      if (this._renderLogged === undefined) {
        this._renderLogged = true;
        console.log("[WebGLWindLayer] render init: matrix", _matrix?.constructor?.name, "len:", _matrix?.length, "active:", activeRef.current);
      }
      if (!activeRef.current || errorCount > 3) {
        // v3.11.2r1: Clear FBOs when deactivated to prevent trail residue
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
        engine.render(_gl, _matrix, canvas.width, canvas.height, zoom);
        // Request continuous repainting while active
        map.triggerRepaint();
      } catch (e) {
        errorCount++;
        if (errorCount <= 3) {
          console.warn(`[WebGLWind] Render error (${errorCount}/3):`, e.message);
        }
        if (errorCount === 3) {
          console.error('[WebGLWind] Too many errors, disabling GPU particles. Canvas2D fallback active.');
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

export function WebGLWindLayer({ mapInstance, active, data, revision, onError }) {
  const engineRef = useRef(null);
  const activeRef = useRef(active);
  const mapRef = useRef(mapInstance);
  const layerAddedRef = useRef(false);
  const onErrorRef = useRef(onError);
  const glRef = useRef(null);
  const pendingDataRef = useRef(null); // Stash data that arrives before GL is ready

  // Keep refs in sync
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { mapRef.current = mapInstance; }, [mapInstance]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Initialize engine + add custom layer
  useEffect(() => {
    if (!mapInstance) return;

    const engine = new WebGLWindEngine();
    engineRef.current = engine;

 // v3.11.2: Increased particle density 384 = 147k desktop, 192 = 37k mobile
    const isMobile = window.innerWidth < 768;
    engine.particleRes = isMobile ? 192 : 384; // 36,864 or 147,456 particles

    const customLayer = createCustomLayer(engine, activeRef, mapRef, glRef, onErrorRef);

    // v3.13: After GL is ready, apply any pending wind data that arrived before onAdd
    const origOnAdd = customLayer.onAdd.bind(customLayer);
    customLayer.onAdd = function(_mapOrArgs, glArg) {
      origOnAdd(_mapOrArgs, glArg);
      // Apply pending data now that GL is available
      const gl = glRef.current;
      if (gl && pendingDataRef.current?.vectors?.length) {
        try {
          engine.setWindData(gl, pendingDataRef.current);
          pendingDataRef.current = null;
          mapInstance.triggerRepaint();
        } catch (e) {
          console.warn('[WebGLWind] Deferred setWindData error:', e.message);
        }
      }
    };

    // Dynamic layer style data sync: add layer and keep it present across style/theme reloads
    const handleStyleData = () => {
      if (!mapInstance) return;
      if (!mapInstance.isStyleLoaded?.()) return;

      if (!mapInstance.getLayer(LAYER_ID)) {
        layerAddedRef.current = false;
        try {
          mapInstance.addLayer(customLayer);
          layerAddedRef.current = true;
          console.log(`[WebGLWind] Layer added (${engine.particleRes}^2 = ${engine.particleRes ** 2} particles)`);
        } catch (e) {
          console.warn('[WebGLWind] Failed to add layer:', e.message);
        }
      }
    };

    mapInstance.on('styledata', handleStyleData);
    handleStyleData();

    return () => {
      try {
        mapInstance.off('styledata', handleStyleData);
        if (layerAddedRef.current && mapInstance.getLayer(LAYER_ID)) {
          mapInstance.removeLayer(LAYER_ID);
        }
      } catch (e) { /* map may be disposed */ }
      layerAddedRef.current = false;
      unregisterWindEngine();
      engine.dispose(mapInstance.painter?.context?.gl);
      engineRef.current = null;
    };
  }, [mapInstance]);

  // Update wind data texture when data changes
  useEffect(() => {
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !data?.vectors?.length || !mapInstance) return;

    // v3.13: If GL isn't ready yet (onAdd hasn't fired), stash data for deferred application
    if (!gl) {
      pendingDataRef.current = data;
      return;
    }

    try {
      console.log(`[WebGLWind] setWindData triggered by effect:`, data.vectors.length, 'vectors');
      engine.setWindData(gl, data);
      pendingDataRef.current = null;
      mapInstance.triggerRepaint();
    } catch (e) {
      console.warn('[WebGLWind] setWindData error:', e.message);
    }
  }, [data, mapInstance]);

  // Trigger repaints when activated
  useEffect(() => {
    if (active && mapInstance) {
      mapInstance.triggerRepaint();
    }
  }, [active, mapInstance]);

 // No DOM element this renders directly into MapLibre's WebGL context
  return null;
}

export default WebGLWindLayer;
