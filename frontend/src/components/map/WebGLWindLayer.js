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
function createCustomLayer(engine, activeRef, mapRef, glRef, onErrorRef) {
  let errorCount = 0;
  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map, gl) {
      glRef.current = gl;
      try {
        engine.init(gl);
      } catch (e) {
        console.error('[WebGLWind] Init failed:', e.message);
        if (onErrorRef.current) onErrorRef.current();
      }
    },

    render(gl, matrix) {
      if (this._renderLogged === undefined) {
        this._renderLogged = true;
        console.log("[WebGLWindLayer] render called! activeRef:", activeRef.current, "errorCount:", errorCount);
      }
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
        const zoom = map.getZoom();
        engine.render(gl, matrix, canvas.width, canvas.height, zoom);
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

    onRemove(_map, gl) {
      engine.dispose(gl);
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
      engine.dispose(mapInstance.painter?.context?.gl);
      engineRef.current = null;
    };
  }, [mapInstance]);

  // Update wind data texture when data changes
  useEffect(() => {
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !data?.vectors?.length || !mapInstance || !gl) return;

    try {
      console.log(`[WebGLWind] setWindData triggered by effect:`, data.vectors.length, 'vectors');
      engine.setWindData(gl, data);
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
