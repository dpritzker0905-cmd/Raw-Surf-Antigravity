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

var LAYER_ID = 'webgl-wind-particles';

/**
 * Creates a MapLibre CustomLayerInterface that delegates rendering
 * to the WebGLWindEngine.
 */
function createCustomLayer(engine, activeRef, mapRef) {
  let errorCount = 0;
  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    onAdd(_map, gl) {
      try {
        engine.init(gl);
      } catch (e) {
        console.error('[WebGLWind] Init failed:', e.message);
      }
    },

    render(gl, matrix) {
      if (!activeRef.current || errorCount > 3) {
        // v3.11.2r1: Clear FBOs when deactivated to prevent trail residue
        if (this._wasActive) {
          engine.clearBuffers(gl);
          this._wasActive = false;
        }
        return;
      }
      this._wasActive = true;
      const map = mapRef.current;
      if (!map) return;

      try {
        const canvas = map.getCanvas();
        engine.render(gl, matrix, canvas.width, canvas.height);
        // Request continuous repainting while active
        map.triggerRepaint();
      } catch (e) {
        errorCount++;
        if (errorCount <= 3) {
          console.warn(`[WebGLWind] Render error (${errorCount}/3):`, e.message);
        }
        if (errorCount === 3) {
          console.error('[WebGLWind] Too many errors, disabling GPU particles. Canvas2D fallback active.');
        }
      }
    },

    onRemove(_map, gl) {
      engine.dispose(gl);
    }
  };
}

export function WebGLWindLayer({ mapInstance, active, data, revision }) {
  const engineRef = useRef(null);
  const activeRef = useRef(active);
  const mapRef = useRef(mapInstance);
  const layerAddedRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { mapRef.current = mapInstance; }, [mapInstance]);

  // Initialize engine + add custom layer
  useEffect(() => {
    if (!mapInstance) return;

    const engine = new WebGLWindEngine();
    engineRef.current = engine;

 // v3.11.2: Increased particle density 384 = 147k desktop, 192 = 37k mobile
    const isMobile = window.innerWidth < 768;
    engine.particleRes = isMobile ? 192 : 384; // 36,864 or 147,456 particles

    const customLayer = createCustomLayer(engine, activeRef, mapRef);

    // Dynamic layer ordering: insert wind particles directly before the first symbol layer
    const handleStyleData = () => {
      if (!mapInstance) return;

      const layers = mapInstance.getStyle()?.layers || [];
      let firstSymbolId = undefined;
      for (const l of layers) {
        if (l.type === 'symbol') {
          firstSymbolId = l.id;
          break;
        }
      }

      if (!mapInstance.getLayer(LAYER_ID)) {
        layerAddedRef.current = false;
        try {
          mapInstance.addLayer(customLayer, firstSymbolId);
          layerAddedRef.current = true;
          console.log(`[WebGLWind] Layer added (${engine.particleRes}^2 = ${engine.particleRes ** 2} particles)`);
        } catch (e) {
          console.warn('[WebGLWind] Failed to add layer:', e.message);
        }
      } else if (firstSymbolId) {
        try {
          mapInstance.moveLayer(LAYER_ID, firstSymbolId);
        } catch (e) {}
      }

      // v3.12.6: Move raster wind-layer below custom webgl-wind-particles layer
      if (mapInstance.getLayer('wind-layer') && mapInstance.getLayer(LAYER_ID)) {
        try {
          mapInstance.moveLayer('wind-layer', LAYER_ID);
        } catch (e) {}
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
      engine.dispose(mapInstance.painter?.context?.gl);
      engineRef.current = null;
    };
  }, [mapInstance]);

  // Update wind data texture when data changes
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !data?.vectors?.length || !mapInstance) return;

    try {
      const gl = mapInstance.painter?.context?.gl;
      if (gl) {
        engine.setWindData(gl, data);
        mapInstance.triggerRepaint();
      }
    } catch (e) {
      console.warn('[WebGLWind] setWindData error:', e.message);
    }
  }, [data, mapInstance]);

  // Trigger repaints and ensure layer ordering when activated
  useEffect(() => {
    if (active && mapInstance) {
      mapInstance.triggerRepaint();
      if (mapInstance.getLayer('wind-layer') && mapInstance.getLayer(LAYER_ID)) {
        try {
          mapInstance.moveLayer('wind-layer', LAYER_ID);
        } catch (e) {}
      }
    }
  }, [active, mapInstance]);

 // No DOM element this renders directly into MapLibre's WebGL context
  return null;
}

export default WebGLWindLayer;
