/* eslint-disable no-empty */
import { useEffect, useRef, useCallback } from 'react';
import { findMarineInsertionLayer } from './mapUtils';

/**
 * OceanMask v14 — Asymmetric Native Vector Double-Buffer Coastline Masking.
 *
 * This implementation generates pixel-perfect masks directly from Mapbox/MapLibre's
 * high-resolution base vector-tile water layer. It completely avoids loading any large
 * client-side GeoJSON datasets, resulting in instant rendering, zero network lag,
 * 100% offline support, and pristine, smooth coastline blending.
 *
 * Layer stacking:
 *   [water]                    ← Mapbox base water fill
 *   [marine rasters]           ← GFS wave/swell slot layers (forced below MASK_BUFFER)
 *   ocean-mask-buffer          ← Ocean-side buffer (oceanColor wide blur to smooth raster grid)
 *   ocean-mask-land-buffer     ← Land-side buffer (land fillColor light blur to cover raster bleed)
 *   ocean-mask-line            ← Thin coastline boundary line (aesthetic)
 *   [roads / labels / markers] ← Topmost base map layers
 */

const MASK_BUFFER = 'ocean-mask-buffer';
const MASK_LAND_BUFFER = 'ocean-mask-land-buffer';
const MASK_LINE = 'ocean-mask-line';

const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', line: 'rgba(0, 0, 0, 0.35)', lw: 1.2, ocean: 'rgba(16, 29, 43, 0.90)' },
  light: { fill: 'hsl(0, 0%, 100%)',   line: 'rgba(0, 0, 0, 0.12)', lw: 0.8, ocean: 'rgba(202, 222, 240, 0.92)' },
  beach: { fill: 'hsl(31, 24%, 91%)',  line: 'rgba(0, 0, 0, 0.18)', lw: 1.0, ocean: 'rgba(173, 213, 242, 0.90)' },
};

const safeMoveLayer = (mapInstance, layerId, beforeId) => {
  if (!mapInstance || !layerId || !beforeId) return;
  try {
    if (!mapInstance.getLayer(layerId) || !mapInstance.getLayer(beforeId)) return;
    const style = mapInstance.getStyle();
    if (!style || !style.layers) return;
    const layers = style.layers;
    const layerIdx = layers.findIndex(l => l.id === layerId);
    const beforeIdx = layers.findIndex(l => l.id === beforeId);
    if (layerIdx !== -1 && beforeIdx !== -1) {
      if (layerIdx === beforeIdx - 1) return; // Already immediately before beforeId
    }
    mapInstance.moveLayer(layerId, beforeId);
  } catch (e) {}
};

export function OceanMask({ mapInstance, active: propActive, activeMarineLayer, theme, beforeId }) {
  const active = propActive !== undefined ? propActive : !!activeMarineLayer;
  const stateRef = useRef({ mapInstance, active, theme, beforeId });

  // Update a ref to hold latest rendering state
  useEffect(() => {
    stateRef.current = { mapInstance, active, theme, beforeId };
  });

  const syncLayers = useCallback(() => {
    const { mapInstance, active, theme, beforeId } = stateRef.current;
    if (!mapInstance) return;

    console.log('[OceanMask] syncLayers running:', { active, theme });

    try {
      const style = mapInstance.getStyle();
      if (!style) return;

      const hasBuf = !!mapInstance.getLayer(MASK_BUFFER);
      const hasLandBuf = !!mapInstance.getLayer(MASK_LAND_BUFFER);
      const hasLine = !!mapInstance.getLayer(MASK_LINE);

      if (active) {
        // Resolve base vector water layer details dynamically
        let waterSource = 'composite';
        let waterSourceLayer = 'water';
        try {
          const baseWater = style.layers?.find(l => l.id === 'water' || l.id === 'water-depth' || l.id === 'wetland');
          if (baseWater) {
            if (baseWater.source) waterSource = baseWater.source;
            if (baseWater['source-layer']) waterSourceLayer = baseWater['source-layer'];
          }
        } catch (e) {}

        const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
        const fillColor = tc.fill;
        const oceanColor = tc.ocean || 'rgba(16, 29, 43, 0.90)';
        const insertBeforeId = beforeId || findMarineInsertionLayer(mapInstance);

        // Filter base water layer to draw buffers strictly along ocean coastlines (excluding lakes/rivers)
        const oceanFilter = ['match', ['get', 'class'], ['ocean', 'sea'], true, false];

        // 1. Ocean-Side Buffer: Vignette shifted into water, blending and smoothing GFS staircasing
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: waterSource,
              'source-layer': waterSourceLayer,
              filter: oceanFilter,
              paint: {
                'line-color': oceanColor,
                'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                  1, 15,
                  3, 22,
                  5, 28,
                  7, 28,
                  9, 24,
                  14, 2,
                ],
                // Shifts inward into the water
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, -5,
                  5, -9,
                  9, -12,
                  14, 0,
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  9, 0.9,
                  14, 0.0
                ],
                'line-blur': ['interpolate', ['linear'], ['zoom'],
                  2, 4.0,
                  5, 3.0,
                  7, 2.0,
                  9, 1.0,
                  14, 0.0
                ],
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_BUFFER:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_BUFFER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', oceanColor);
          } catch (e) {}
        }

        // 2. Land-Side Buffer: Land-colored thick cover to block GFS wave bleed on land
        if (!hasLandBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_LAND_BUFFER,
              type: 'line',
              source: waterSource,
              'source-layer': waterSourceLayer,
              filter: oceanFilter,
              paint: {
                'line-color': fillColor,
                'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                  1, 35,
                  3, 45,
                  5, 60,
                  7, 50,
                  9, 30,
                  14, 2,
                ],
                // Shifts outward onto the land
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, 15,
                  3, 20,
                  5, 25,
                  7, 20,
                  9, 10,
                  14, 0,
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  9, 1.0,
                  14, 0.0
                ],
                'line-blur': ['interpolate', ['linear'], ['zoom'],
                  2, 2.0,
                  7, 1.5,
                  9, 1.0,
                  14, 0.0
                ],
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_LAND_BUFFER:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_LAND_BUFFER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_LAND_BUFFER, 'line-color', fillColor);
          } catch (e) {}
        }

        // 3. Aesthetic Coastline Line
        if (!hasLine) {
          try {
            mapInstance.addLayer({
              id: MASK_LINE,
              type: 'line',
              source: waterSource,
              'source-layer': waterSourceLayer,
              filter: oceanFilter,
              paint: {
                'line-color': tc.line,
                'line-width': ['interpolate', ['linear'], ['zoom'],
                  2, tc.lw * 0.5,
                  6, tc.lw,
                  10, tc.lw * 1.5,
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  9, 0.8,
                  14, 0.0
                ],
                'line-blur': 0.5,
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_LINE:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_LINE, insertBeforeId);
          } catch (e) {}
        }

        // 4. Reposition weather/marine raster layers below the MASK_BUFFER
        const marineLayers = ['waves','swell_1','swell_2','wind_waves'].flatMap(k => [0,1,2].map(s => `${k}-slot-${s}-layer`));
        for (const ml of marineLayers) {
          safeMoveLayer(mapInstance, ml, MASK_BUFFER);
        }

      } else {
        // Deactivated: Synchronously remove all layers
        const ourLayers = [MASK_LINE, MASK_LAND_BUFFER, MASK_BUFFER];
        for (const lid of ourLayers) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        }
      }
    } catch (err) {
      console.error('[OceanMask] Error in syncLayers:', err);
    }
  }, []);

  // Synchronize on state or theme changes immediately
  useEffect(() => {
    syncLayers();
  }, [mapInstance, active, theme, beforeId, syncLayers]);

  // Debounced styledata handler to prevent race conditions during heavy map load
  useEffect(() => {
    if (!mapInstance) return;
    const timeoutRef = { current: null };
    const handler = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        syncLayers();
      }, 100);
    };
    mapInstance.on('styledata', handler);
    return () => {
      mapInstance.off('styledata', handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [mapInstance, syncLayers]);

  // Separate repositioning listener for GFS marine rasters
  useEffect(() => {
    if (!mapInstance) return;
    const marineRasterLayers = ['waves','swell_1','swell_2','wind_waves'].flatMap(k => [0,1,2].map(s => `${k}-slot-${s}-layer`));
    const repositionLayers = () => {
      if (!active || !mapInstance.getLayer(MASK_BUFFER)) return;
      for (const ml of marineRasterLayers) {
        safeMoveLayer(mapInstance, ml, MASK_BUFFER);
      }
    };
    mapInstance.on('styledata', repositionLayers);
    return () => mapInstance.off('styledata', repositionLayers);
  }, [mapInstance, active]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      const ourLayers = [MASK_LINE, MASK_LAND_BUFFER, MASK_BUFFER];
      for (const lid of ourLayers) {
        try { mapInstance.removeLayer(lid); } catch (e) {}
      }
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
