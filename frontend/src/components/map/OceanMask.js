/* eslint-disable no-empty */
import { useEffect, useRef, useCallback } from 'react';

/**
 * OceanMask v11 — Dynamic base map water recoloring.
 *
 * Rather than loading a heavy, glitched global GeoJSON land mask which
 * draws massive visual artifacts and covers up inland lakes/parks,
 * this component dynamically recolors MapLibre's vector water layers
 * to match the base palette of our active marine rasters.
 *
 * This makes GFS grid transparency near shores perfectly seamless and
 * invisible, while letting Mapbox's high-res vector land layers clip
 * rasters at the precise coastline, leaving all parks, roads, and cities pristine.
 */

const THEME_OCEAN_COLORS = {
  active: {
    dark:  'hsl(218, 25%, 16%)', // Premium, rich deep marine navy
    light: 'hsl(205, 32%, 80%)', // Premium, soft clean coastal blue
    beach: 'hsl(195, 35%, 72%)', // Gorgeous clean tropical teal
  },
  default: {
    dark:  'hsl(220, 16%, 16%)', // Mapbox Navigation Night default water
    light: 'hsl(210, 20%, 91%)', // Mapbox Navigation Day default water
    beach: 'hsl(215, 100%, 90%)', // Mapbox Outdoors default water
  }
};

export function OceanMask({ mapInstance, active, theme }) {
  const lastStateRef = useRef({ active: null, theme: null });

  const syncWaterColor = useCallback((force = false) => {
    if (!mapInstance) return;
    try {
      const style = mapInstance.getStyle();
      if (!style || !style.layers) return;

      // Prevent redundant updates
      if (!force && 
          lastStateRef.current.active === active && 
          lastStateRef.current.theme === theme) {
        return;
      }
      lastStateRef.current = { active, theme };

      const activeColors = THEME_OCEAN_COLORS.active;
      const defaultColors = THEME_OCEAN_COLORS.default;

      const targetColor = active 
        ? (activeColors[theme] || activeColors.dark)
        : (defaultColors[theme] || defaultColors.dark);

      // Find and dynamically update all base map fill layers representing water
      style.layers.forEach(layer => {
        if (layer.type === 'fill' && 
            (layer.id === 'water' || layer.id.includes('water')) && 
            !layer.id.startsWith('ocean-mask-')) {
          try {
            mapInstance.setPaintProperty(layer.id, 'fill-color', targetColor);
          } catch (e) {}
        }
      });
    } catch (e) {}
  }, [mapInstance, active, theme]);

  // Synchronize color on active/theme prop changes
  useEffect(() => {
    syncWaterColor();
  }, [syncWaterColor]);

  // Sync color on map style load/change events (styledata)
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => {
      syncWaterColor(true); // Force update to override new style colors
    };
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncWaterColor]);

  // Restore default water colors on unmount
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      try {
        const style = mapInstance.getStyle();
        if (!style || !style.layers) return;
        const defaultColors = THEME_OCEAN_COLORS.default;
        const targetColor = defaultColors[theme] || defaultColors.dark;

        style.layers.forEach(layer => {
          if (layer.type === 'fill' && (layer.id === 'water' || layer.id.includes('water'))) {
            try {
              mapInstance.setPaintProperty(layer.id, 'fill-color', targetColor);
            } catch (e) {}
          }
        });
      } catch (e) {}
    };
  }, [mapInstance, theme]);

  return null;
}

export default OceanMask;
