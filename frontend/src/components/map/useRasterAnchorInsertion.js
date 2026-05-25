import { useState, useEffect } from 'react';
import { findMarineInsertionLayer } from './mapUtils';

export function useRasterAnchorInsertion({ mapInstance }) {
  const [marineBeforeId, setMarineBeforeId] = useState(null);
  const [maskLandExists, setMaskLandExists] = useState(false);

  useEffect(() => {
    if (!mapInstance) return;

    const onStyleData = () => {
      setMaskLandExists(!!mapInstance.getLayer('ocean-mask-fill'));
      
      let id = null;
      try {
        const style = mapInstance.getStyle();
        if (style && style.layers && style.layers.length > 0) {
          const layers = style.layers;
          const layerIds = layers.map(l => l.id);
          
          if (layerIds.includes('tunnel-minor-case-navigation')) {
            id = 'tunnel-minor-case-navigation';
          } else {
            const fallbackTargets = ['building', 'road-label', 'land-structure-polygon', 'road-structure-polygon'];
            for (const target of fallbackTargets) {
              const foundId = layerIds.find(lid => lid && (lid.includes(target) || target.includes(lid)));
              if (foundId) {
                id = foundId;
                break;
              }
            }
            
            if (!id) {
              const symbolLayer = layers.find(l => l.type === 'symbol');
              if (symbolLayer) {
                id = symbolLayer.id;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[MapWebGL] Anchor target validation failed, falling back...', err);
      }

      if (!id) {
        id = findMarineInsertionLayer(mapInstance);
      }

      if (id) {
        setMarineBeforeId(id);
        if (!mapInstance.getLayer('marine-raster-anchor')) {
          try {
            const layerId = 'marine-raster-anchor';
            if (!mapInstance.getLayer(layerId)) {
              mapInstance.addLayer({
                id: layerId,
                type: 'background',
                layout: { visibility: 'none' }
              }, id);
              console.log('[MapWebGL] Added marine-raster-anchor before', id);
            }
          } catch (err) {
            console.error(`[MapWebGL] Layer insertion caught exception for layer marine-raster-anchor:`, err.message);
          }
        }
      }
    };

    mapInstance.on('styledata', onStyleData);
    onStyleData();

    return () => {
      mapInstance.off('styledata', onStyleData);
    };
  }, [mapInstance]);

  // Clean leftover OceanMask styles
  useEffect(() => {
    if (!mapInstance) return;

    const cleanup = () => {
      const staleIds = [
        'ocean-mask-buffer', 'ocean-mask-fill', 'ocean-mask-line',
        'ocean-mask-inland-water', 'ocean-mask-inland-waterway'
      ];
      for (const lid of staleIds) {
        try {
          if (mapInstance.getLayer(lid)) {
            mapInstance.removeLayer(lid);
            console.log('[MapWebGL] Removed stale OceanMask layer:', lid);
          }
        } catch (e) {}
      }
      try {
        if (mapInstance.getSource('ocean-mask-land')) {
          mapInstance.removeSource('ocean-mask-land');
          console.log('[MapWebGL] Removed stale OceanMask source');
        }
      } catch (e) {}
    };

    if (mapInstance.isStyleLoaded()) {
      cleanup();
    } else {
      mapInstance.once('styledata', cleanup);
    }
  }, [mapInstance]);

  return { marineBeforeId, maskLandExists };
}
