/* eslint-disable no-empty */
import { useEffect, useRef, useCallback } from 'react';
import { findMarineInsertionLayer } from './mapUtils';

/**
 * OceanMask v11 — Pixel-perfect Native Vector-Tile Coastline Blending.
 *
 * This version binds directly to Mapbox's high-resolution native vector 'water' layer,
 * eliminating the need for external GeoJSON datasets. It shifts a wide, blurred, ocean-colored
 * buffer entirely into the ocean (using a negative line-offset of exactly -width/2).
 * It preserves inland lakes/parks by filtering out non-ocean water bodies.
 */

const MASK_BUFFER = 'ocean-mask-buffer';
const MASK_LINE   = 'ocean-mask-line';
const ALL_LAYERS  = [MASK_LINE, MASK_BUFFER];

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
      if (layerIdx === beforeIdx - 1) {
        return; // Already immediately before beforeId
      }
    }
    mapInstance.moveLayer(layerId, beforeId);
  } catch (e) {}
};

// Filter out lakes, rivers, canals, etc., to keep inland water bodies sharp and untouched.
const waterFilter = [
  'match',
  ['get', 'class'],
  ['lake', 'river', 'canal', 'stream', 'reservoir', 'pool', 'pond', 'spring', 'waterfall'],
  false,
  true
];

export function OceanMask({ mapInstance, active: propActive, activeMarineLayer, theme, beforeId }) {
  const syncingRef = useRef(false);
  const timeoutRef = useRef(null);

  const active = propActive !== undefined ? propActive : !!activeMarineLayer;

  console.log('[OceanMask] Render:', { active, propActive, activeMarineLayer, theme });

  // Update a stateRef on every render to completely prevent stale closure races
  const stateRef = useRef({ mapInstance, active, theme, beforeId });
  useEffect(() => {
    stateRef.current = { mapInstance, active, theme, beforeId };
  });

  const syncLayers = useCallback(() => {
    const { mapInstance, active, theme, beforeId } = stateRef.current;
    if (!mapInstance) {
      console.log('[OceanMask] syncLayers bypassed, no map');
      return;
    }

    console.log('[OceanMask] syncLayers running:', { active });

    try {
      const style = mapInstance.getStyle();
      if (!style) return;

      const hasBuf  = !!mapInstance.getLayer(MASK_BUFFER);
      const hasLine = !!mapInstance.getLayer(MASK_LINE);

      if (active) {
        // Dynamically find the active vector tile source ID (typically 'composite')
        let vectorSourceId = 'composite';
        if (style.sources) {
          if (style.sources['composite'] && style.sources['composite'].type === 'vector') {
            vectorSourceId = 'composite';
          } else if (style.sources['mapbox'] && style.sources['mapbox'].type === 'vector') {
            vectorSourceId = 'mapbox';
          } else {
            const found = Object.keys(style.sources).find(id => 
              style.sources[id].type === 'vector' && 
              !id.toLowerCase().includes('traffic')
            );
            if (found) {
              vectorSourceId = found;
            }
          }
        }

        const insertBeforeId = beforeId || findMarineInsertionLayer(mapInstance);
        const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
        const oceanColor = tc.ocean || 'rgba(16, 29, 43, 0.90)';

        // 1. Coastline buffer (shifted into the ocean using negative line-offset)
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: vectorSourceId,
              'source-layer': 'water',
              filter: waterFilter,
              paint: {
                'line-color': oceanColor,
                'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                  1, 10,
                  4, 12,
                  5, 16,
                  7, 36,
                  8, 54,
                  9, 80,
                  10, 100,
                  12, 0.0
                ],
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, -5,    // Shifted exactly -line-width / 2 into the ocean
                  4, -6,
                  5, -8,
                  7, -18,
                  8, -27,
                  9, -40,
                  10, -50,
                  12, 0.0
                ],
                'line-blur': ['interpolate', ['linear'], ['zoom'],
                  2, 2.0,
                  7.5, 3.0,
                  10.0, 4.0,
                  12.0, 0.0
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  7.5, 1.0,
                  10.0, 1.0,
                  12.0, 0.0
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
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-width', ['interpolate', ['exponential', 1.2], ['zoom'],
              1, 10,
              4, 12,
              5, 16,
              7, 36,
              8, 54,
              9, 80,
              10, 100,
              12, 0.0
            ]);
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-offset', ['interpolate', ['linear'], ['zoom'],
              1, -5,
              4, -6,
              5, -8,
              7, -18,
              8, -27,
              9, -40,
              10, -50,
              12, 0.0
            ]);
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-blur', ['interpolate', ['linear'], ['zoom'],
              2, 2.0,
              7.5, 3.0,
              10.0, 4.0,
              12.0, 0.0
            ]);
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-opacity', ['interpolate', ['linear'], ['zoom'],
              7.5, 1.0,
              10.0, 1.0,
              12.0, 0.0
            ]);
          } catch (e) {}
        }

        // 2. Thin aesthetic coastline line
        if (!hasLine) {
          try {
            mapInstance.addLayer({
              id: MASK_LINE,
              type: 'line',
              source: vectorSourceId,
              'source-layer': 'water',
              filter: waterFilter,
              paint: {
                'line-color': tc.line,
                'line-width': ['interpolate', ['linear'], ['zoom'],
                  2, tc.lw * 0.5, 6, tc.lw, 10, tc.lw * 1.5,
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

        // Force active marine raster layers BELOW the MASK_BUFFER layer
        const marineLayers = ['waves-layer', 'swell_1-layer', 'swell_2-layer', 'wind_waves-layer'];
        for (const ml of marineLayers) {
          safeMoveLayer(mapInstance, ml, MASK_BUFFER);
        }
      } else {
        // Active is false: remove all layers immediately and synchronously
        const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
        for (const lid of historicalLayers) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        }
        if (mapInstance.getSource('ocean-mask-source')) {
          try { mapInstance.removeSource('ocean-mask-source'); } catch (e) {}
        }
      }
    } catch (err) {
      console.error('[OceanMask] Error in syncLayers:', err);
    }
  }, []);

  const triggerSync = useCallback((delay = 0) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (delay === 0) {
      if (!syncingRef.current) {
        syncingRef.current = true;
        syncLayers();
        setTimeout(() => { syncingRef.current = false; }, 300);
      }
    } else {
      timeoutRef.current = setTimeout(() => {
        if (!syncingRef.current) {
          syncingRef.current = true;
          syncLayers();
          setTimeout(() => { syncingRef.current = false; }, 300);
        }
      }, delay);
    }
  }, [syncLayers]);

  // Handle active state changes immediately and synchronously
  useEffect(() => {
    if (!active) {
      // Immediate synchronous cleanup on deactivation
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (mapInstance) {
        console.log('[OceanMask] Deactivating: removing layers immediately');
        syncingRef.current = true;
        const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
        for (const lid of historicalLayers) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        }
        if (mapInstance.getSource('ocean-mask-source')) {
          try { mapInstance.removeSource('ocean-mask-source'); } catch (e) {}
        }
        setTimeout(() => { syncingRef.current = false; }, 300);
      }
    } else {
      triggerSync(0);
    }
  }, [mapInstance, active, theme, beforeId, triggerSync]);

  // Styledata event listener (only runs when active, ignores styledata event storms on deactivation)
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => {
      const { active } = stateRef.current;
      if (active && !syncingRef.current) {
        triggerSync(300);
      }
    };
    mapInstance.on('styledata', handler);
    return () => {
      mapInstance.off('styledata', handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [mapInstance, triggerSync]);

  // Dedicated marine-raster repositioning listener
  useEffect(() => {
    if (!mapInstance) return;
    const marineRasterLayers = ['waves-layer', 'swell_1-layer', 'swell_2-layer', 'wind_waves-layer'];
    const repositionLayers = () => {
      const { active } = stateRef.current;
      if (!active || !mapInstance.getLayer(MASK_BUFFER)) return;
      for (const ml of marineRasterLayers) {
        safeMoveLayer(mapInstance, ml, MASK_BUFFER);
      }
    };
    mapInstance.on('styledata', repositionLayers);
    return () => mapInstance.off('styledata', repositionLayers);
  }, [mapInstance]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
      for (const lid of historicalLayers) {
        try { mapInstance.removeLayer(lid); } catch (e) {}
      }
      try { mapInstance.removeSource('ocean-mask-source'); } catch (e) {}
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
