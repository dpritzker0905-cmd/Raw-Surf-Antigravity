/**
 * WebGLMarineLayer.js
 * React wrapper bridging WebGLMarineEngine to MapLibre's CustomLayerInterface.
 * Strictly under 200 Lines of Code.
 */
import { useEffect, useRef } from 'react';
import WebGLMarineEngine from './WebGLMarineEngine';
import { findMarineInsertionLayer } from './mapUtils';

var LAYER_ID = 'webgl-marine-particles';

function createCustomLayer(engine, activeRef, mapRef, dataRef, glRef) {
  let errorCount = 0;
  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '2d',
    engine, // expose engine reference for debugging

    onAdd(_map, gl) {
      glRef.current = gl;
      try {
        engine.init(gl);
        if (dataRef.current?.vectors?.length) {
          console.log(`[WebGLMarine] Binding initial data onAdd:`, dataRef.current.vectors.length, 'vectors');
          engine.setWaveData(gl, dataRef.current);
        }
      } catch (e) {
        console.error('[WebGLMarine] Init failed:', e.message);
      }
    },

    render(gl, matrix) {
      if (!activeRef.current || errorCount > 3) {
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
        map.triggerRepaint();
      } catch (e) {
        errorCount++;
        if (errorCount <= 3) {
          console.warn(`[WebGLMarine] Render error (${errorCount}/3):`, e.message);
        }
        if (errorCount === 3) {
          console.error('[WebGLMarine] Too many errors, disabling GPU marine particles.');
        }
      }
    },

    onRemove(_map, gl) {
      engine.dispose(gl);
      glRef.current = null;
    }
  };
}

function safeMoveLayer(map, layerId, beforeId) {
  if (!map || !layerId || !map.getLayer(layerId)) return;
  if (beforeId && map.getLayer(beforeId)) {
    try {
      const layers = map.getStyle()?.layers || [];
      const idxLayer = layers.findIndex(l => l.id === layerId);
      const idxBefore = layers.findIndex(l => l.id === beforeId);
      if (idxLayer !== -1 && idxBefore !== -1 && idxLayer >= idxBefore) {
        map.moveLayer(layerId, beforeId);
      }
    } catch (e) {
      console.warn(`[WebGLMarine] safeMoveLayer error:`, e);
    }
  }
}

export function WebGLMarineLayer({ mapInstance, active, data, revision, onAddedChange }) {
  const engineRef = useRef(null);
  const activeRef = useRef(active);
  const mapRef = useRef(mapInstance);
  const layerAddedRef = useRef(false);
  const onAddedChangeRef = useRef(onAddedChange);
  const dataRef = useRef(data);
  const glRef = useRef(null);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { mapRef.current = mapInstance; }, [mapInstance]);
  useEffect(() => { onAddedChangeRef.current = onAddedChange; }, [onAddedChange]);
  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    if (!mapInstance) return;

    // v3.12.9: MapLibre doesn't always schedule continuous repaints reliably for custom layers
    // We enforce an animation loop when active to guarantee the shaders receive time ticks
    let frameId;
    const renderLoop = () => {
      if (activeRef.current && mapInstance) {
        mapInstance.triggerRepaint();
        frameId = requestAnimationFrame(renderLoop);
      }
    };
    if (active) {
      frameId = requestAnimationFrame(renderLoop);
    }

    const engine = new WebGLMarineEngine();
    engineRef.current = engine;

    const isMobile = window.innerWidth < 768;
    engine.particleRes = isMobile ? 128 : 256;

    const customLayer = createCustomLayer(engine, activeRef, mapRef, dataRef, glRef);

    // Dynamic layer ordering: insert wave particles directly before ocean-mask-buffer or marineBeforeId
    const handleStyleData = () => {
      if (!mapInstance) return;
      if (!mapInstance.isStyleLoaded?.()) return;

      const hasMaskBuffer = !!mapInstance.getLayer('ocean-mask-buffer');
      const insertionId = hasMaskBuffer ? 'ocean-mask-buffer' : findMarineInsertionLayer(mapInstance);

      const beforeExists = !!(insertionId && mapInstance.getLayer(insertionId));
      if (!mapInstance.getLayer(LAYER_ID)) {
        layerAddedRef.current = false;
        try {
          mapInstance.addLayer(customLayer, beforeExists ? insertionId : undefined);
          layerAddedRef.current = true;
          console.log(`[WebGLMarine] Layer added (${engine.particleRes}^2 = ${engine.particleRes ** 2} particles)`);
          if (onAddedChangeRef.current) onAddedChangeRef.current(true);
        } catch (e) {
          console.warn('[WebGLMarine] Failed to add layer:', e.message);
        }
      } else if (beforeExists) {
        safeMoveLayer(mapInstance, LAYER_ID, insertionId);
      }

      // Move any active marine raster layer below the custom webgl-marine-particles layer
      const marineRasterLayers = ['waves-layer', 'swell_1-layer', 'swell_2-layer', 'wind_waves-layer'];
      for (const rasterId of marineRasterLayers) {
        safeMoveLayer(mapInstance, rasterId, LAYER_ID);
      }
    };

    mapInstance.on('styledata', handleStyleData);
    handleStyleData();

    return () => {
      try {
        mapInstance.off('styledata', handleStyleData);
        if (layerAddedRef.current && mapInstance.getLayer(LAYER_ID)) {
          mapInstance.removeLayer(LAYER_ID);
          if (onAddedChangeRef.current) onAddedChangeRef.current(false);
        }
      } catch (e) { /* map may be disposed */ }
      layerAddedRef.current = false;
      engine.dispose(mapInstance.painter?.context?.gl);
      engineRef.current = null;
    };
  }, [mapInstance]);

  useEffect(() => {
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !data?.vectors?.length || !gl) return;

    try {
      console.log(`[WebGLMarine] setWaveData triggered by effect:`, data.vectors.length, 'vectors');
      engine.setWaveData(gl, data);
      if (mapInstance) {
        mapInstance.triggerRepaint();
      }
    } catch (e) {
      console.warn('[WebGLMarine] setWaveData error:', e.message);
    }
  }, [data, mapInstance]);

  // Trigger repaints and ensure layer ordering when activated
  useEffect(() => {
    if (active && mapInstance) {
      mapInstance.triggerRepaint();
      const marineRasterLayers = ['waves-layer', 'swell_1-layer', 'swell_2-layer', 'wind_waves-layer'];
      for (const rasterId of marineRasterLayers) {
        safeMoveLayer(mapInstance, rasterId, LAYER_ID);
      }
    }
  }, [active, mapInstance]);

  return null;
}

export default WebGLMarineLayer;
