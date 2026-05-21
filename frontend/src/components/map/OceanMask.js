/* eslint-disable no-empty */
import { useEffect, useRef, useCallback } from 'react';

/**
 * OceanMask v12 — Dynamic base map water recoloring.
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
  waves: {
    dark:  'hsl(195, 50%, 18%)', // Premium, rich coastal blue-teal
    light: 'hsl(195, 60%, 82%)', // Soft beach sky blue
    beach: 'hsl(192, 65%, 75%)', // Tropical beach teal
  },
  swell_1: {
    dark:  'hsl(195, 50%, 18%)', // Premium, rich coastal blue-teal (same as waves)
    light: 'hsl(195, 60%, 82%)',
    beach: 'hsl(192, 65%, 75%)',
  },
  swell_2: {
    dark:  'hsl(270, 25%, 14%)', // Deep, mysterious violet-navy
    light: 'hsl(270, 40%, 85%)',
    beach: 'hsl(265, 45%, 80%)',
  },
  wind_waves: {
    dark:  'hsl(160, 35%, 14%)', // Rich deep emerald-marine
    light: 'hsl(165, 45%, 85%)',
    beach: 'hsl(160, 50%, 80%)',
  },
  default: {
    dark:  'hsl(220, 16%, 16%)', // Mapbox Navigation Night default water
    light: 'hsl(210, 20%, 91%)', // Mapbox Navigation Day default water
    beach: 'hsl(215, 100%, 90%)', // Mapbox Outdoors default water
  }
};

export function OceanMask({ mapInstance, activeMarineLayer, theme }) {
  const lastStateRef = useRef({ activeMarineLayer: null, theme: null });

  const syncWaterColor = useCallback((force = false) => {
    if (!mapInstance) return;
    try {
      const style = mapInstance.getStyle();
      if (!style || !style.layers) return;

      // Prevent redundant updates
      if (!force && 
          lastStateRef.current.activeMarineLayer === activeMarineLayer && 
          lastStateRef.current.theme === theme) {
        return;
      }
      lastStateRef.current = { activeMarineLayer, theme };

      const colors = THEME_OCEAN_COLORS[activeMarineLayer] || THEME_OCEAN_COLORS.default;
      const targetColor = colors[theme] || colors.dark;

      // Find and dynamically update all base map fill layers representing water
      style.layers.forEach(layer => {
        if (layer.type === 'fill' && 
            (layer.id === 'water' || layer.id.includes('water')) && 
            !layer.id.startsWith('ocean-mask-')) {
          try {
            // CRITICAL OPTIMIZATION: Check before setting to prevent infinite loop of styledata events
            const currentColor = mapInstance.getPaintProperty(layer.id, 'fill-color');
            if (currentColor !== targetColor) {
              mapInstance.setPaintProperty(layer.id, 'fill-color', targetColor);
            }
          } catch (e) {}
        }
      });
    } catch (e) {}
  }, [mapInstance, activeMarineLayer, theme]);

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
              const currentColor = mapInstance.getPaintProperty(layer.id, 'fill-color');
              if (currentColor !== targetColor) {
                mapInstance.setPaintProperty(layer.id, 'fill-color', targetColor);
              }
            } catch (e) {}
          }
        });
      } catch (e) {}
    };
  }, [mapInstance, theme]);

  return null;
}

export default OceanMask;
