/* eslint-disable no-empty */
import { useEffect, useRef, useCallback } from 'react';
import {
  findMarineInsertionLayer,
  safeMoveLayer,
  safeSetPaintProperty
} from './mapUtils';

/**
 * OceanMask v20 — Premium Pixel-Perfect Double-Sided Vector Coastline Blending.
 *
 * This version completely resolves the GFS wave raster "coastal bleed" (on land)
 * and "GPS staircasing gaps" (in water) by creating a double-sided vector boundary
 * vignette.
 *
 * Instead of low-resolution land GeoJSON files, it binds directly to the active
 * high-resolution base map vector tiles ('water' layer) via positive and negative offsets:
 *
 * 1. ocean-mask-land-buffer (Positive offset, Land-colored, shifted onto land)
 *    - Fully covers GFS wave heatmaps bleeding onto the land.
 *    - Sits below roads, parks, and labels, so no base land features are occluded.
 * 2. ocean-mask-buffer (Negative offset, Ocean-colored, shifted into ocean)
 *    - Wide, soft blurred vignette drawn in the nearshore water.
 *    - Seamlessly fades wave colors out before they reach jagged coastal boundaries.
 * 3. ocean-mask-line (Coastline outline, thin aesthetic boundary)
 *
 * Stacking order (bottom → top):
 *   [water]                    ← Base Map water
 *   [marine rasters]           ← Waves/Swell slots
 *   ocean-mask-buffer          ← Ocean-Side soft water vignette
 *   ocean-mask-land-buffer     ← Land-Side bleed cover
 *   ocean-mask-line            ← Thin aesthetic outline
 *   [roads / parks / labels]   ← Topmost Mapbox layers
 */

const MASK_BUFFER      = 'ocean-mask-buffer';
const MASK_LAND_BUFFER = 'ocean-mask-land-buffer';
const MASK_LINE        = 'ocean-mask-line';

const ALL_LAYERS = [MASK_BUFFER, MASK_LAND_BUFFER, MASK_LINE];
const LEGACY_LAYERS = [
  'ocean-mask-fill',
  'ocean-mask-inland-water',
  'ocean-mask-inland-waterway'
];

const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', line: 'rgba(0, 0, 0, 0.35)', lw: 1.2, ocean: 'rgb(27, 40, 56)' },
  light: { fill: 'hsl(0, 0%, 100%)',   line: 'rgba(0, 0, 0, 0.12)', lw: 0.8, ocean: 'rgb(202, 210, 218)' },
  beach: { fill: 'hsl(31, 24%, 91%)',  line: 'rgba(0, 0, 0, 0.18)', lw: 1.0, ocean: 'hsl(196, 80%, 70%)' },
};

// Filter out lakes, rivers, canals, etc., to only target the ocean/sea coastlines
const waterFilter = [
  'match',
  ['get', 'class'],
  ['lake', 'river', 'canal', 'stream', 'reservoir', 'pool', 'pond', 'spring', 'waterfall'],
  false,
  true
];

export function OceanMask({ mapInstance, active: propActive, theme, beforeId }) {
  const syncingRef = useRef(false);
  const timeoutRef = useRef(null);

  const active = propActive !== undefined ? propActive : true;

  console.log('[OceanMask] Render:', { active, theme });

  // Maintain stateRef to prevent stale closure races
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

    console.log('[OceanMask] syncLayers running:', { active, theme });

    try {
      const style = mapInstance.getStyle();
      if (!style) return;

      const hasBuf     = !!mapInstance.getLayer(MASK_BUFFER);
      const hasLandBuf = !!mapInstance.getLayer(MASK_LAND_BUFFER);
      const hasLine    = !!mapInstance.getLayer(MASK_LINE);

      if (active) {
        // Dynamically resolve the active vector tile source ID (typically 'composite')
        let vectorSourceId = 'composite';
        if (style.sources) {
          const found = Object.keys(style.sources).find(id => style.sources[id].type === 'vector');
          if (found) {
            vectorSourceId = found;
          }
        }

        const insertBeforeId = beforeId || findMarineInsertionLayer(mapInstance);
        const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
        const fillColor = tc.fill;

        // Dynamically resolve the active style's water fill color if available
        let waterColor = tc.ocean;
        try {
          const baseWater = style?.layers?.find(l => l.id === 'water' || l.id === 'water-depth' || l.id === 'wetland');
          if (baseWater && baseWater.paint?.['fill-color']) {
            waterColor = baseWater.paint['fill-color'];
          }
        } catch (e) {}

        // 1. Ocean-Side Vignette Buffer (shifted into the ocean using negative offset)
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: vectorSourceId,
              'source-layer': 'water',
              filter: waterFilter,
              paint: {
                'line-color': waterColor,
                'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                  1, 8,
                  5, 16,
                  6, 24,
                  7, 36,
                  8, 64,
                  9, 120,
                  10, 200,
                  12, 360,
                  14, 0
                ],
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, 4,
                  5, 8,
                  6, 12,
                  7, 18,
                  8, 32,
                  9, 60,
                  10, 100,
                  12, 180,
                  14, 0
                ],
                'line-blur': ['interpolate', ['linear'], ['zoom'],
                  5, 1.0,
                  8, 2.0,
                  10, 3.0,
                  12, 4.0
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  5, 1.0,
                  10, 1.0,
                  12, 0.8,
                  14, 0.0
                ]
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' }
            }, insertBeforeId || undefined);
            console.log('[OceanMask] Added ocean-mask-buffer');
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_BUFFER:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_BUFFER, insertBeforeId);
            safeSetPaintProperty(mapInstance, MASK_BUFFER, 'line-color', waterColor);
          } catch (e) {}
        }

        // 2. Land-Side Masking Buffer (shifted onto land using positive offset)
        if (!hasLandBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_LAND_BUFFER,
              type: 'line',
              source: vectorSourceId,
              'source-layer': 'water',
              filter: waterFilter,
              paint: {
                'line-color': fillColor,
                'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                  1, 6,
                  5, 12,
                  6, 18,
                  7, 24,
                  8, 48,
                  9, 96,
                  10, 160,
                  12, 300,
                  14, 0
                ],
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, -3,
                  5, -6,
                  6, -9,
                  7, -12,
                  8, -24,
                  9, -48,
                  10, -80,
                  12, -150,
                  14, 0
                ],
                'line-blur': ['interpolate', ['linear'], ['zoom'],
                  5, 0.5,
                  9, 1.0,
                  12, 2.0
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  5, 1.0,
                  10, 1.0,
                  12, 0.8,
                  14, 0.0
                ]
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' }
            }, insertBeforeId || undefined);
            console.log('[OceanMask] Added ocean-mask-land-buffer');
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_LAND_BUFFER:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_LAND_BUFFER, insertBeforeId);
            safeSetPaintProperty(mapInstance, MASK_LAND_BUFFER, 'line-color', fillColor);
          } catch (e) {}
        }

        // 3. Thin aesthetic coastline outline
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
                  2, tc.lw * 0.5,
                  6, tc.lw,
                  10, tc.lw * 1.5
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  9, 0.8,
                  14, 0.0
                ],
                'line-blur': 0.5
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' }
            }, insertBeforeId || undefined);
            console.log('[OceanMask] Added ocean-mask-line');
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_LINE:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_LINE, insertBeforeId);
            safeSetPaintProperty(mapInstance, MASK_LINE, 'line-color', tc.line);
          } catch (e) {}
        }

        // Clean up legacy layers if present
        for (const lid of LEGACY_LAYERS) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        }
        if (mapInstance.getSource('ocean-mask-source')) {
          try { mapInstance.removeSource('ocean-mask-source'); } catch (e) {}
        }
      } else {
        // Active is false: remove all layers immediately and synchronously
        for (const lid of [...ALL_LAYERS, ...LEGACY_LAYERS]) {
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

  // Handle active state changes immediately and synchronously to clean up on toggling off
  useEffect(() => {
    const { mapInstance, active } = stateRef.current;
    if (!active) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (mapInstance) {
        console.log('[OceanMask] Deactivating: removing layers immediately');
        syncingRef.current = true;
        for (const lid of [...ALL_LAYERS, ...LEGACY_LAYERS]) {
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

  // Re-run sync on styledata changes
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

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      for (const lid of [...ALL_LAYERS, ...LEGACY_LAYERS]) {
        try { mapInstance.removeLayer(lid); } catch (e) {}
      }
      try { mapInstance.removeSource('ocean-mask-source'); } catch (e) {}
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
