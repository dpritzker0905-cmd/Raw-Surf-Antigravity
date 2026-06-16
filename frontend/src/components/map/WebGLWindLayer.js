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
function createCustomLayer(engine, activeRef, mapRef, glRef, onErrorRef, themeRef) {
  let errorCount = 0;
  let lastErrorTime = 0; // v3.15: Track error time for recovery
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
          // v3.15: NEVER use modelViewProjectionMatrix — it's in a different coordinate space and causes projection glitches
          _matrix = matrixArg.defaultProjectionData?.mainMatrix || matrixArg.mercatorMatrix || matrixArg.mainMatrix;
          if (!_matrix || !_matrix.length) {
            // Fallback: search all values for a Float32Array/Float64Array of length 16
            // but EXCLUDE modelViewProjectionMatrix which is in a different coordinate space
            for (var k in matrixArg) {
              if (k === 'modelViewProjectionMatrix') continue; // v3.15: Skip — wrong coord space
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
        // v3.15: Never use modelViewProjectionMatrix — wrong coordinate space
        _matrix = glOrArgs.defaultProjectionData?.mainMatrix || glOrArgs.mercatorMatrix || glOrArgs.matrix;
      } else {
        _gl = glOrArgs;
        _matrix = matrixArg;
      }
      if (this._renderLogged === undefined) {
        this._renderLogged = true;
        console.log("[WebGLWindLayer] render init: matrix", _matrix?.constructor?.name, "len:", _matrix?.length, "active:", activeRef.current);
      }

      // v3.15: Error recovery — reset count after 10s of no errors
      if (errorCount > 0 && (Date.now() - lastErrorTime) > 10000) {
        errorCount = 0;
      }

      if (!activeRef.current || errorCount > 5) {
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

        // Calculate visible world offsets to handle wrapping across all zoom levels and pans
        let worldOffsets = [0.0];
        try {
          const center = map.getCenter();
          if (center && typeof center.lng === 'number') {
            const centerLng = center.lng;
            // Calculate visible longitude span using the viewport width and zoom level
            const span = (canvas.width * 360.0) / (256.0 * Math.pow(2.0, zoom));
            
            // Add padding: 180 degrees at low zoom to pre-render adjacent worlds; 10 degrees at high zoom
            const padding = zoom < 3.5 ? 180.0 : 10.0;
            const west = centerLng - (span / 2.0) - padding;
            const east = centerLng + (span / 2.0) + padding;
            
            const minOffset = Math.floor((west + 180.0) / 360.0) * 360.0;
            const maxOffset = Math.ceil((east - 180.0) / 360.0) * 360.0;
            const computedOffsets = [];
            for (let offset = minOffset; offset <= maxOffset; offset += 360.0) {
              computedOffsets.push(offset);
            }
            if (computedOffsets.length > 0) {
              worldOffsets = computedOffsets;
            }
          }
        } catch (boundsErr) {
          console.warn('[WebGLWindLayer] Failed to calculate dynamic offsets:', boundsErr);
        }

        // v3.16: Compute viewport bounds for viewport-biased particle respawning
        let viewportBounds = null;
        try {
          const mapBounds = map.getBounds();
          if (mapBounds) {
            viewportBounds = [
              mapBounds.getWest(),
              mapBounds.getSouth(),
              mapBounds.getEast(),
              mapBounds.getNorth()
            ];
          }
        } catch (vbErr) {
          // Fallback: global bounds
        }

        engine.render(_gl, _matrix, canvas.width, canvas.height, zoom, themeRef.current, worldOffsets, viewportBounds);
        // Request continuous repainting while active
        map.triggerRepaint();
      } catch (e) {
        errorCount++;
        lastErrorTime = Date.now();
        if (errorCount <= 5) {
          console.warn(`[WebGLWind] Render error (${errorCount}/5):`, e.message);
        }
        if (errorCount === 5) {
          console.error('[WebGLWind] Too many errors, temporarily disabling GPU particles (will retry in 10s).');
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

export function WebGLWindLayer({ mapInstance, active, data, revision, onError, theme }) {
  const engineRef = useRef(null);
  const activeRef = useRef(active);
  const mapRef = useRef(mapInstance);
  const layerAddedRef = useRef(false);
  const onErrorRef = useRef(onError);
  const glRef = useRef(null);
  const pendingDataRef = useRef(null); // Stash data that arrives before GL is ready
  const themeRef = useRef(theme);
  const dataRef = useRef(data);

  // Keep refs in sync
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { mapRef.current = mapInstance; }, [mapInstance]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Initialize engine + add custom layer
  useEffect(() => {
    if (!mapInstance) return;

    const engine = new WebGLWindEngine();
    engineRef.current = engine;

 // v3.11.2: Increased particle density 384 = 147k desktop, 192 = 37k mobile
    const isMobile = window.innerWidth < 768;
    engine.particleRes = isMobile ? 192 : 384; // 36,864 or 147,456 particles

    const customLayer = createCustomLayer(engine, activeRef, mapRef, glRef, onErrorRef, themeRef);

    // v3.13: After GL is ready, apply any pending wind data that arrived before onAdd
    const origOnAdd = customLayer.onAdd.bind(customLayer);
    customLayer.onAdd = function(_mapOrArgs, glArg) {
      origOnAdd(_mapOrArgs, glArg);
      // Apply pending data now that GL is available
      const gl = glRef.current;
      const dataToApply = pendingDataRef.current || dataRef.current;
      if (gl && dataToApply?.vectors?.length) {
        try {
          engine.setWindData(gl, dataToApply);
          if (typeof engine.reinitParticles === 'function') {
            engine.reinitParticles(gl);
          }
          pendingDataRef.current = null;
          mapInstance.triggerRepaint();
        } catch (e) {
          console.warn('[WebGLWind] Deferred setWindData error:', e.message);
        }
      }
    };

    // Dynamic layer style data sync: add layer and keep it present across style/theme reloads
    const handleStyleData = () => {
      if (!mapInstance || !mapInstance.style) return;

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
    mapInstance.on('style.load', handleStyleData);
    handleStyleData();

    return () => {
      try {
        mapInstance.off('styledata', handleStyleData);
        mapInstance.off('style.load', handleStyleData);
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
    if (!engine || !mapInstance) return;

    if (!data?.vectors?.length || data.renderable === false) {
      if (gl) {
        if (engine._windData?.texture) {
          gl.deleteTexture(engine._windData.texture);
        }
        engine._windData = null;
        engine.clearBuffers(gl);
        mapInstance.triggerRepaint();
      }
      return;
    }

    // v3.13: If GL isn't ready yet (onAdd hasn't fired), stash data for deferred application
    if (!gl) {
      pendingDataRef.current = data;
      return;
    }

    try {
      console.log(`[WebGLWind] setWindData triggered by effect:`, data.vectors.length, 'vectors');
      
      const oldBounds = engine._windData?.bounds;
      const newBounds = data.bounds;
      let boundsChanged = false;
      if (!oldBounds && newBounds) {
        boundsChanged = true;
      } else if (oldBounds && newBounds) {
        const getLongitudeSpan = (b) => {
          const crosses = b.west > b.east;
          return crosses ? (b.east + 360.0) - b.west : b.east - b.west;
        };
        const oldSpan = getLongitudeSpan(oldBounds);
        const newSpan = getLongitudeSpan(newBounds);
        const dw = Math.abs(newSpan - oldSpan);
        const dh = Math.abs((newBounds.north - newBounds.south) - (oldBounds.north - oldBounds.south));
        let dx = Math.abs(newBounds.west - oldBounds.west);
        if (dx > 180.0) dx = 360.0 - dx;
        const dy = Math.abs(newBounds.south - oldBounds.south);
        if (dw > 2.0 || dh > 2.0 || dx > 2.0 || dy > 2.0) {
          boundsChanged = true;
        }
      }

      engine.setWindData(gl, data);

      if (boundsChanged) {
        if (typeof engine.reinitParticles === 'function') {
          engine.reinitParticles(gl);
        }
      }

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
