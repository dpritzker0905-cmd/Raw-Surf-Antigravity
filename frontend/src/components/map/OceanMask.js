/* eslint-disable no-empty */
import { useEffect, useRef, useCallback } from 'react';
import { findMarineInsertionLayer } from './mapUtils';

/**
 * OceanMask v15 — Seamless high-resolution vector coastlines and theme-integrated land buffers.
 *
 * Rather than using a heavy, global offline GeoJSON land mask (which is low-resolution,
 * causes continental staircasing, and bloats land masses if offset into the ocean),
 * this component queries the map's native high-resolution vector tile source (typically 'composite')
 * and dynamically overlays an outward-shifted blurred coastal line buffer based on the 'water' layer.
 *
 * Because standard vector tiles are extremely high-resolution, this guarantees pixel-perfect,
 * vector-sharp coastline clipping at all zoom levels, with absolutely zero staircasing or jaggedness.
 *
 * Polygon directionality:
 * Since the source polygons are 'water' bodies and are wound counter-clockwise (CCW) for outer rings
 * in MapLibre GL JS runtime parsing, a negative line-offset shifts the line INWARD (into water).
 * By setting the line-offset to exactly -line-width / 2, the buffer extends inward onto the water side
 * to cover the coarse GFS marine raster staircasing while keeping the land 100% clean and unmasked.
 *
 * Layer stack (bottom → top):
 *   [water]                  ← Mapbox base (recolored dynamically)
 *   [marine slot raster]     ← GFS wave/swell layers (forced below MASK_BUFFER)
 *   ocean-mask-buffer        ← WIDE outward-shifted blurred theme-matching buffer line (covers land bleed)
 *   ocean-mask-line          ← Thin aesthetic boundary coastline outline
 *   [roads/labels]           ← Mapbox base
 */

const MASK_BUFFER = 'ocean-mask-buffer';
const MASK_LINE   = 'ocean-mask-line';
const ALL_LAYERS  = [MASK_LINE, MASK_BUFFER];

const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', line: 'rgba(0, 0, 0, 0.35)', lw: 1.2 },
  light: { fill: 'hsl(0, 0%, 100%)',   line: 'rgba(0, 0, 0, 0.12)', lw: 0.8 },
  beach: { fill: 'hsl(34, 40%, 90%)',  line: 'hsla(33, 40%, 50%, 0.25)', lw: 1.0 },
};

const THEME_OCEAN_COLORS = {
  waves: {
    dark:  'hsl(195, 50%, 18%)', // Premium, rich coastal blue-teal
    light: 'hsl(195, 60%, 82%)', // Soft beach sky blue
    beach: 'hsl(190, 60%, 75%)', // Vibrant tropical emerald-teal
  },
  swell_1: {
    dark:  'hsl(195, 50%, 18%)',
    light: 'hsl(195, 60%, 82%)',
    beach: 'hsl(190, 60%, 75%)',
  },
  swell_2: {
    dark:  'hsl(270, 25%, 14%)', // Deep, mysterious violet-navy
    light: 'hsl(270, 40%, 85%)',
    beach: 'hsl(220, 50%, 78%)', // Soft royal blue/indigo
  },
  wind_waves: {
    dark:  'hsl(160, 35%, 14%)', // Rich deep emerald-marine
    light: 'hsl(165, 45%, 85%)',
    beach: 'hsl(165, 55%, 75%)', // Rich seafoam/emerald green
  },
  default: {
    dark:  'hsl(220, 16%, 16%)', // Mapbox Navigation Night default water
    light: 'hsl(210, 20%, 91%)', // Mapbox Navigation Day default water
    beach: 'hsl(188, 65%, 80%)', // Stunning tropical lagoon turquoise
  }
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
      if (layerIdx === beforeIdx - 1) {
        return; // Already immediately before beforeId
      }
    }
    mapInstance.moveLayer(layerId, beforeId);
  } catch (e) {}
};

export function OceanMask({ mapInstance, activeMarineLayer, theme, beforeId }) {
  const syncingRef = useRef(false);
  const lastPropsRef = useRef({ activeMarineLayer: null, theme: null, beforeId: null });

  const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
  const active = !!activeMarineLayer;

  const syncLayers = useCallback(() => {
    if (!mapInstance) return;

    const oceanColors = active ? (THEME_OCEAN_COLORS[activeMarineLayer] || THEME_OCEAN_COLORS.default) : THEME_OCEAN_COLORS.default;
    const targetOceanColor = oceanColors[theme] || oceanColors.dark;

    // Base map water layers dynamic recoloring
    try {
      const style = mapInstance.getStyle();
      if (style && style.layers) {
        style.layers.forEach(layer => {
          if (layer.type === 'fill' && 
              (layer.id === 'water' || layer.id.includes('water')) && 
              !ALL_LAYERS.includes(layer.id)) {
            try {
              const currentColor = mapInstance.getPaintProperty(layer.id, 'fill-color');
              if (currentColor !== targetOceanColor) {
                mapInstance.setPaintProperty(layer.id, 'fill-color', targetOceanColor);
              }
            } catch (e) {}
          }
        });
      }
    } catch (e) {}

    const propsChanged =
      activeMarineLayer !== lastPropsRef.current.activeMarineLayer ||
      theme !== lastPropsRef.current.theme ||
      beforeId !== lastPropsRef.current.beforeId;

    if (syncingRef.current && !propsChanged) return;
    syncingRef.current = true;

    try {
      lastPropsRef.current = { activeMarineLayer, theme, beforeId };
      const style = mapInstance.getStyle?.();
      if (!style) return;

      const hasBuf  = !!mapInstance.getLayer(MASK_BUFFER);
      const hasLine = !!mapInstance.getLayer(MASK_LINE);

      if (active) {
        // Resolve active vector source dynamically from the map style by finding
        // the vector source that actually contains the 'water' layer.
        let vectorSourceId = 'composite';
        if (style.layers) {
          const waterLayer = style.layers.find(l => 
            l['source-layer'] === 'water' && 
            l.id !== MASK_BUFFER && 
            l.id !== MASK_LINE
          );
          if (waterLayer && waterLayer.source) {
            vectorSourceId = waterLayer.source;
          }
        }

        const insertBeforeId = beforeId || findMarineInsertionLayer(mapInstance);

        // Layer 1: Coastline buffer shifted INWARD (into water) to mask GFS staircasing beautifully
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: vectorSourceId,
              'source-layer': 'water',
              paint: {
                'line-color': targetOceanColor,
                'line-width': ['interpolate', ['linear'], ['zoom'],
                  1, 6,
                  4, 6,
                  5, 8,
                  7, 14,
                  8, 18,
                  9, 0.0
                ],
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, -3,   // Exactly -line-width / 2 to shift inward (into water)
                  4, -3,
                  5, -4,
                  7, -7,
                  8, -9,
                  9, 0.0
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  7.5, 1.0,
                  9.0, 0.0
                ],
                'line-blur': ['interpolate', ['linear'], ['zoom'],
                  2, 2.0,
                  7.5, 1.5,
                  9.0, 0.0
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
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', targetOceanColor);
          } catch (e) {}
        }

        // Layer 2: Thin boundary coastline outline centered perfectly
        if (!hasLine) {
          try {
            mapInstance.addLayer({
              id: MASK_LINE,
              type: 'line',
              source: vectorSourceId,
              'source-layer': 'water',
              paint: {
                'line-color': tc.line,
                'line-width': ['interpolate', ['linear'], ['zoom'],
                  2, tc.lw * 0.5, 6, tc.lw, 10, tc.lw * 1.5,
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  7.5, 0.8,
                  9.0, 0.0
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

        // Reposition all active sliding marine layers below the land mask buffer
        const styleLayers = style?.layers || [];
        styleLayers.forEach(l => {
          if (l.id.includes('-slot-') && l.id.endsWith('-layer')) {
            const isMarineLayer = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(prefix => l.id.startsWith(prefix));
            if (isMarineLayer) {
              safeMoveLayer(mapInstance, l.id, MASK_BUFFER);
            }
          }
        });

      } else {
        // Clean up land mask if not active
        ALL_LAYERS.forEach(lid => {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        });
      }
    } finally {
      setTimeout(() => { syncingRef.current = false; }, 300);
    }
  }, [mapInstance, activeMarineLayer, active, theme, tc, beforeId]);

  // Synchronize on active layer, theme, beforeId changes
  useEffect(() => {
    syncLayers();
  }, [syncLayers]);

  // Re-sync layers on map style load/change events (styledata)
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => {
      if (!syncingRef.current) {
        setTimeout(syncLayers, 100);
      }
    };
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayers]);

  // Listen to styledata specifically to reposition raster buffers beneath the mask buffer
  useEffect(() => {
    if (!mapInstance) return;
    const repositionLayers = () => {
      if (!mapInstance.getLayer(MASK_BUFFER)) return;
      const style = mapInstance.getStyle();
      const styleLayers = style?.layers || [];
      styleLayers.forEach(l => {
        if (l.id.includes('-slot-') && l.id.endsWith('-layer')) {
          const isMarineLayer = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(prefix => l.id.startsWith(prefix));
          if (isMarineLayer) {
            safeMoveLayer(mapInstance, l.id, MASK_BUFFER);
          }
        }
      });
    };
    mapInstance.on('styledata', repositionLayers);
    return () => mapInstance.off('styledata', repositionLayers);
  }, [mapInstance]);

  // Restore default water colors and remove layers on unmount
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      try {
        ALL_LAYERS.forEach(lid => {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        });

        const style = mapInstance.getStyle();
        if (style && style.layers) {
          const defaultColors = THEME_OCEAN_COLORS.default;
          const targetColor = defaultColors[theme] || defaultColors.dark;

          style.layers.forEach(layer => {
            if (layer.type === 'fill' && 
                (layer.id === 'water' || layer.id.includes('water')) && 
                !ALL_LAYERS.includes(layer.id)) {
              try {
                mapInstance.setPaintProperty(layer.id, 'fill-color', targetColor);
              } catch (e) {}
            }
          });
        }
      } catch (e) {}
    };
  }, [mapInstance, theme]);

  return null;
}

export default OceanMask;
