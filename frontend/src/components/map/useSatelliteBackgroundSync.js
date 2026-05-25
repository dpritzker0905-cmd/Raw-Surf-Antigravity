import { useEffect } from 'react';
import { safeSetPaintProperty } from './mapUtils';

export function useSatelliteBackgroundSync({ mapInstance, activeLayers }) {
  useEffect(() => {
    if (!mapInstance) return;
    const handleBackgroundClear = () => {
      try {
        if (activeLayers.includes('satellite')) {
          if (mapInstance.getLayer('background')) {
            safeSetPaintProperty(mapInstance, 'background', 'background-opacity', 0);
          }
        } else {
          if (mapInstance.getLayer('background')) {
            safeSetPaintProperty(mapInstance, 'background', 'background-opacity', 1.0);
          }
        }
      } catch (e) {}
    };

    if (mapInstance.isStyleLoaded()) {
      handleBackgroundClear();
    } else {
      mapInstance.once('style.load', handleBackgroundClear);
    }
  }, [mapInstance, activeLayers]);
}
