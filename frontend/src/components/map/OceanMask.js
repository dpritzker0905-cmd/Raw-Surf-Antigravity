import { useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * OceanMask v3 — Supplementary vector-tile coastline refinement.
 *
 * Architecture: Two-tier masking system:
 *   1. PRIMARY (in MapWebGL.js): Open-Meteo `clippingOptions` clips raster
 *      tiles at the PIXEL level using NE 10m land polygons. This eliminates
 *      the blocky GFS grid-cell bleed that polygon-based masking can't fix.
 *   2. SUPPLEMENTARY (this component): Adds fill layers from the Mapbox
 *      `composite` vector tile source (landuse, landcover, building) to
 *      cover any residual bleed from barrier islands or narrow features
 *      that NE 10m doesn't include.
 *
 * v86: Moved primary clipping to the om:// protocol pipeline.
 * This component now only manages the lightweight supplementary layers.
 */

const SUPP_LAYER_PREFIX = 'ocean-mask-supp';

// Theme-aware land fill colors (must EXACTLY match base map background)
const LAND_COLORS = {
  dark:  'hsl(214, 17%, 31%)',   // Navigation Night background
  light: 'hsl(0, 0%, 100%)',     // Navigation Day background
  beach: 'hsl(31, 24%, 91%)',    // Outdoors background
};

/**
 * Supplementary vector-tile layers from the Mapbox `composite` source.
 * Each entry creates a fill layer painted with the background color.
 */
const SUPP_LAYERS = [
  { id: `${SUPP_LAYER_PREFIX}-landuse`,   sourceLayer: 'landuse',   minzoom: 5 },
  { id: `${SUPP_LAYER_PREFIX}-landcover`, sourceLayer: 'landcover', minzoom: 0, maxzoom: 8 },
  { id: `${SUPP_LAYER_PREFIX}-building`,  sourceLayer: 'building',  minzoom: 13 },
];

/**
 * Find the layer id to insert mask layers BEFORE.
 * Target: after marine rasters, before land-structure/roads/labels.
 */
function findInsertionPoint(style) {
  for (const l of style?.layers || []) {
    if (['land-structure-polygon', 'land-structure-line',
         'building-outline', 'building'].includes(l.id) ||
        l.id.startsWith('tunnel-') || l.id.startsWith('road-')) {
      return l.id;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  React component                                                    */
/* ------------------------------------------------------------------ */

/**
 * OceanMask component — manages supplementary vector-tile fill layers.
 *
 * Props:
 *   mapInstance  — raw MapLibre map object
 *   active       — whether any marine layer is currently active
 *   theme        — 'dark' | 'light' | 'beach'
 */
export function OceanMask({ mapInstance, active, theme }) {
  const addedRef = useRef(false);

  // Resolve fill color from active style or theme fallback
  const fillColor = useMemo(() => {
    if (mapInstance) {
      try {
        const style = mapInstance.getStyle?.();
        const bg = style?.layers?.find(l => l.type === 'background');
        if (bg?.paint?.['background-color']) return bg.paint['background-color'];
      } catch (e) { /* style not ready */ }
    }
    return LAND_COLORS[theme] || LAND_COLORS.dark;
  }, [mapInstance, theme]);

  // Add/remove supplementary layers
  const syncLayers = useCallback(() => {
    if (!mapInstance) return;
    const style = mapInstance.getStyle?.();
    if (!style) return;

    const beforeId = findInsertionPoint(style);

    if (active) {
      for (const cfg of SUPP_LAYERS) {
        if (mapInstance.getLayer(cfg.id)) {
          try { mapInstance.setPaintProperty(cfg.id, 'fill-color', fillColor); }
          catch (e) { /* ok */ }
          continue;
        }
        try {
          mapInstance.addLayer({
            id: cfg.id,
            type: 'fill',
            source: 'composite',
            'source-layer': cfg.sourceLayer,
            minzoom: cfg.minzoom || 0,
            ...(cfg.maxzoom ? { maxzoom: cfg.maxzoom } : {}),
            paint: { 'fill-color': fillColor, 'fill-opacity': 1 },
          }, beforeId || undefined);
        } catch (e) { /* source-layer may not exist */ }
      }
      addedRef.current = true;
    } else {
      for (const cfg of SUPP_LAYERS) {
        if (mapInstance.getLayer(cfg.id)) {
          try { mapInstance.removeLayer(cfg.id); } catch (e) { /* ok */ }
        }
      }
      addedRef.current = false;
    }
  }, [mapInstance, active, fillColor]);

  // Sync on dependency changes
  useEffect(() => { syncLayers(); }, [syncLayers]);

  // Re-sync on style changes (theme switch)
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => setTimeout(syncLayers, 200);
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      for (const cfg of SUPP_LAYERS) {
        try { mapInstance.removeLayer(cfg.id); } catch (e) { /* ok */ }
      }
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
