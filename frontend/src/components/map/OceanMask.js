/* eslint-disable no-empty */
import { useEffect, useRef, useCallback } from 'react';
import { findMarineInsertionLayer } from './mapUtils';

/**
 * OceanMask v16 — Robust coastline masking with GeoJSON land fill + vector buffer.
 *
 * Three mask layers (bottom → top):
 *   ocean-mask-land    — GeoJSON fill covering all land masses (ne_50m_land.json)
 *   ocean-mask-buffer  — Wide blurred vector line on water edge (hides raster staircasing)
 *   ocean-mask-line    — Thin aesthetic coastline outline
 *
 * Layer stack (bottom → top):
 *   [water]                ← Base map (recolored dynamically per marine layer)
 *   [marine raster tiles]  ← GFS wave/swell layers
 *   ocean-mask-land        ← Covers land with theme fill color
 *   ocean-mask-buffer      ← Blurred coastline buffer (matches ocean color)
 *   ocean-mask-line        ← Thin outline
 *   [roads/labels]         ← Base map
 */

const MASK_LAND   = 'ocean-mask-land';
const MASK_BUFFER = 'ocean-mask-buffer';
const MASK_LINE   = 'ocean-mask-line';
const MASK_LAND_BUFFER = 'ocean-mask-land-buffer';
const MASK_LAND_SOURCE = 'ocean-mask-land-source';
const ALL_LAYERS  = [MASK_LINE, MASK_BUFFER, MASK_LAND_BUFFER, MASK_LAND];

const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', line: 'rgba(0, 0, 0, 0.35)', lw: 1.2 },
  light: { fill: 'hsl(0, 0%, 100%)',   line: 'rgba(0, 0, 0, 0.12)', lw: 0.8 },
  beach: { fill: 'hsl(34, 40%, 90%)',  line: 'hsla(33, 40%, 50%, 0.25)', lw: 1.0 },
};

const THEME_OCEAN_COLORS = {
  waves: {
    dark:  'hsl(195, 50%, 18%)',
    light: 'hsl(195, 60%, 82%)',
    beach: 'hsl(190, 60%, 75%)',
  },
  swell_1: {
    dark:  'hsl(195, 50%, 18%)',
    light: 'hsl(195, 60%, 82%)',
    beach: 'hsl(190, 60%, 75%)',
  },
  swell_2: {
    dark:  'hsl(270, 25%, 14%)',
    light: 'hsl(270, 40%, 85%)',
    beach: 'hsl(220, 50%, 78%)',
  },
  wind_waves: {
    dark:  'hsl(160, 35%, 14%)',
    light: 'hsl(165, 45%, 85%)',
    beach: 'hsl(165, 55%, 75%)',
  },
  default: {
    dark:  'hsl(220, 16%, 16%)',
    light: 'hsl(210, 20%, 91%)',
    beach: 'hsl(188, 65%, 80%)',
  }
};

const safeMoveLayer = (map, layerId, beforeId) => {
  if (!map || !layerId || !beforeId) return;
  try {
    if (!map.getLayer(layerId) || !map.getLayer(beforeId)) return;
    if (layerId === beforeId) return;
    const layers = map.getStyle()?.layers;
    if (!layers) return;
    const li = layers.findIndex(l => l.id === layerId);
    const bi = layers.findIndex(l => l.id === beforeId);
    if (li !== -1 && bi !== -1 && li === bi - 1) return; // already correct
    map.moveLayer(layerId, beforeId);
  } catch (e) {}
};

// Module-level cache for the land GeoJSON (fetch once, reuse forever)
let _landGeoJsonCache = null;
let _landGeoJsonFetching = false;
const _landGeoJsonCallbacks = [];

function fetchLandGeoJson(callback) {
  if (_landGeoJsonCache) { callback(_landGeoJsonCache); return; }
  _landGeoJsonCallbacks.push(callback);
  if (_landGeoJsonFetching) return;
  _landGeoJsonFetching = true;
  fetch('/ne_50m_land.json')
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(json => {
      _landGeoJsonCache = json;
      _landGeoJsonFetching = false;
      _landGeoJsonCallbacks.forEach(cb => { try { cb(json); } catch(e) {} });
      _landGeoJsonCallbacks.length = 0;
    })
    .catch(err => {
      console.error('[OceanMask] Failed to fetch land GeoJSON:', err);
      _landGeoJsonFetching = false;
      _landGeoJsonCallbacks.length = 0;
    });
}

export function OceanMask({ mapInstance, activeMarineLayer, theme, beforeId }) {
  const landSourceLoadedRef = useRef(false);
  const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
  const active = !!activeMarineLayer;

  // --- Recolor base-map water layers ---
  const recolorWater = useCallback(() => {
    if (!mapInstance) return;
    const oceanColors = active
      ? (THEME_OCEAN_COLORS[activeMarineLayer] || THEME_OCEAN_COLORS.default)
      : THEME_OCEAN_COLORS.default;
    const targetColor = oceanColors[theme] || oceanColors.dark;

    const defaultColors = THEME_OCEAN_COLORS.default;
    const defaultColor = defaultColors[theme] || defaultColors.dark;

    try {
      const style = mapInstance.getStyle();
      if (!style?.layers) return;
      style.layers.forEach(layer => {
        if (layer.type === 'fill' &&
            (layer.id === 'water' || layer.id.includes('water')) &&
            !ALL_LAYERS.includes(layer.id)) {
          try {
            const colorExpr = active
              ? [
                  'case',
                  ['match', ['get', 'class'],
                    ['lake', 'river', 'canal', 'stream', 'reservoir', 'pool', 'pond', 'spring', 'waterfall'],
                    true, false
                  ],
                  defaultColor,
                  targetColor
                ]
              : defaultColor;

            mapInstance.setPaintProperty(layer.id, 'fill-color', colorExpr);
          } catch (e) {}
        }
      });
    } catch (e) {}
  }, [mapInstance, active, activeMarineLayer, theme]);

  // --- Ensure all mask layers exist and are in correct order ---
  const ensureLayers = useCallback(() => {
    if (!mapInstance) return;
    const style = mapInstance.getStyle?.();
    if (!style?.layers) return;

    if (!active) {
      // Remove all mask layers when inactive
      ALL_LAYERS.forEach(lid => {
        if (mapInstance.getLayer(lid)) {
          try { mapInstance.removeLayer(lid); } catch (e) {}
        }
      });
      if (mapInstance.getSource(MASK_LAND_SOURCE)) {
        try { mapInstance.removeSource(MASK_LAND_SOURCE); } catch (e) {}
      }
      landSourceLoadedRef.current = false;
      return;
    }

    // Find the vector source for coastline buffer/line layers
    let vectorSourceId = 'composite';
    const waterLayer = style.layers.find(l =>
      l['source-layer'] === 'water' &&
      !ALL_LAYERS.includes(l.id)
    );
    if (waterLayer?.source) vectorSourceId = waterLayer.source;

    const insertBeforeId = beforeId || findMarineInsertionLayer(mapInstance);
    const waterFilter = ['match', ['get', 'class'],
      ['lake', 'river', 'canal', 'stream', 'reservoir', 'pool', 'pond', 'spring', 'waterfall'],
      false, true
    ];

    const oceanColors = THEME_OCEAN_COLORS[activeMarineLayer] || THEME_OCEAN_COLORS.default;
    const targetOceanColor = oceanColors[theme] || oceanColors.dark;

    // ---- LAYER 0: Land fill (GeoJSON) ----
    if (!mapInstance.getSource(MASK_LAND_SOURCE)) {
      try {
        // Create source with empty data first, then populate via explicit fetch
        mapInstance.addSource(MASK_LAND_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        landSourceLoadedRef.current = false;
        // Fetch and inject the actual land polygons
        fetchLandGeoJson((geojson) => {
          try {
            const src = mapInstance.getSource(MASK_LAND_SOURCE);
            if (src) {
              src.setData(geojson);
              landSourceLoadedRef.current = true;
              console.log('[OceanMask] Land GeoJSON loaded via setData:', geojson.features?.length, 'features');
            }
          } catch (e) {
            console.error('[OceanMask] setData failed:', e);
          }
        });
      } catch (e) {
        console.error('[OceanMask] addSource failed:', e);
      }
    }

    if (!mapInstance.getLayer(MASK_LAND) && mapInstance.getSource(MASK_LAND_SOURCE)) {
      try {
        mapInstance.addLayer({
          id: MASK_LAND,
          type: 'fill',
          source: MASK_LAND_SOURCE,
          paint: {
            'fill-color': tc.fill,
            'fill-opacity': [
              'interpolate', ['linear'], ['zoom'],
              2, 1.0, 8, 1.0, 9.5, 0.0
            ],
            'fill-antialias': false,
          },
        }, insertBeforeId || undefined);
      } catch (e) {
        console.error('[OceanMask] addLayer MASK_LAND failed:', e);
      }
    } else if (mapInstance.getLayer(MASK_LAND)) {
      try { mapInstance.setPaintProperty(MASK_LAND, 'fill-color', tc.fill); } catch (e) {}
    }

    // ---- LAYER 1: Coastline buffer (vector) ----
    if (!mapInstance.getLayer(MASK_BUFFER)) {
      try {
        mapInstance.addLayer({
          id: MASK_BUFFER,
          type: 'line',
          source: vectorSourceId,
          'source-layer': 'water',
          filter: waterFilter,
          paint: {
            'line-color': targetOceanColor,
            'line-width': ['interpolate', ['linear'], ['zoom'],
              1, 4, 4, 6, 5, 8, 7, 14, 8, 20, 9, 28, 10, 36, 12, 0.0
            ],
            'line-offset': ['interpolate', ['linear'], ['zoom'],
              1, -2, 4, -3, 5, -4, 7, -7, 8, -10, 9, -14, 10, -18, 12, 0.0
            ],
            'line-opacity': ['interpolate', ['linear'], ['zoom'],
              7.5, 1.0, 10.0, 1.0, 12.0, 0.0
            ],
            'line-blur': ['interpolate', ['linear'], ['zoom'],
              2, 2.0, 7.5, 3.0, 10.0, 4.0, 12.0, 0.0
            ],
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        }, insertBeforeId || undefined);
      } catch (e) {
        console.error('[OceanMask] addLayer MASK_BUFFER failed:', e);
      }
    } else {
      try {
        mapInstance.setFilter(MASK_BUFFER, waterFilter);
        mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', targetOceanColor);
      } catch (e) {}
    }

    // ---- LAYER 1.5: Land buffer (vector to cover raster coastline bleed) ----
    if (!mapInstance.getLayer(MASK_LAND_BUFFER)) {
      try {
        mapInstance.addLayer({
          id: MASK_LAND_BUFFER,
          type: 'line',
          source: vectorSourceId,
          'source-layer': 'water',
          filter: waterFilter,
          paint: {
            'line-color': tc.fill,
            'line-width': ['interpolate', ['linear'], ['zoom'],
              1, 4, 4, 6, 5, 8, 7, 14, 8, 20, 9, 28, 10, 36, 12, 0.0
            ],
            'line-offset': ['interpolate', ['linear'], ['zoom'],
              1, 2, 4, 3, 5, 4, 7, 7, 8, 10, 9, 14, 10, 18, 12, 0.0
            ],
            'line-opacity': ['interpolate', ['linear'], ['zoom'],
              7.5, 1.0, 10.0, 1.0, 12.0, 0.0
            ],
            'line-blur': ['interpolate', ['linear'], ['zoom'],
              2, 1.0, 7.5, 1.5, 10.0, 2.0, 12.0, 0.0
            ],
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        }, insertBeforeId || undefined);
      } catch (e) {
        console.error('[OceanMask] addLayer MASK_LAND_BUFFER failed:', e);
      }
    } else {
      try {
        mapInstance.setFilter(MASK_LAND_BUFFER, waterFilter);
        mapInstance.setPaintProperty(MASK_LAND_BUFFER, 'line-color', tc.fill);
      } catch (e) {}
    }

    // ---- LAYER 2: Coastline outline (vector) ----
    if (!mapInstance.getLayer(MASK_LINE)) {
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
              7.5, 0.8, 12.0, 0.0
            ],
            'line-blur': 0.5,
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        }, insertBeforeId || undefined);
      } catch (e) {
        console.error('[OceanMask] addLayer MASK_LINE failed:', e);
      }
    } else {
      try {
        mapInstance.setFilter(MASK_LINE, waterFilter);
        mapInstance.setPaintProperty(MASK_LINE, 'line-color', tc.line);
      } catch (e) {}
    }

    // ---- Enforce correct layer order ----
    // Target: ... → marine-raster-anchor → MASK_LAND → MASK_LAND_BUFFER → MASK_BUFFER → MASK_LINE → insertBeforeId → [roads]
    const anchorId = mapInstance.getLayer('marine-raster-anchor') ? 'marine-raster-anchor' : null;
    const refId = insertBeforeId;

    if (refId) {
      safeMoveLayer(mapInstance, MASK_LINE, refId);
      safeMoveLayer(mapInstance, MASK_BUFFER, MASK_LINE);
      if (mapInstance.getLayer(MASK_LAND_BUFFER)) {
        safeMoveLayer(mapInstance, MASK_LAND_BUFFER, MASK_BUFFER);
      }
      if (mapInstance.getLayer(MASK_LAND)) {
        safeMoveLayer(mapInstance, MASK_LAND, mapInstance.getLayer(MASK_LAND_BUFFER) ? MASK_LAND_BUFFER : MASK_BUFFER);
      }
    }

    // Position marine-raster-anchor BELOW the land mask so rasters render under the mask
    if (anchorId) {
      const bottomMask = mapInstance.getLayer(MASK_LAND) ? MASK_LAND
                       : mapInstance.getLayer(MASK_LAND_BUFFER) ? MASK_LAND_BUFFER
                       : mapInstance.getLayer(MASK_BUFFER) ? MASK_BUFFER
                       : refId;
      safeMoveLayer(mapInstance, anchorId, bottomMask);
    }
  }, [mapInstance, active, activeMarineLayer, theme, tc, beforeId]);

  // --- Run on prop changes ---
  useEffect(() => {
    recolorWater();
    ensureLayers();
  }, [recolorWater, ensureLayers]);

  // --- Re-sync on styledata (new layers added, style reload) ---
  useEffect(() => {
    if (!mapInstance) return;
    let debounceTimer = null;
    const handler = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        recolorWater();
        ensureLayers();
      }, 50);
    };
    mapInstance.on('styledata', handler);
    return () => {
      mapInstance.off('styledata', handler);
      clearTimeout(debounceTimer);
    };
  }, [mapInstance, recolorWater, ensureLayers]);

  // --- Also listen for sourcedata to catch land GeoJSON load completion ---
  useEffect(() => {
    if (!mapInstance || !active) return;
    const handler = (e) => {
      if (e.sourceId === MASK_LAND_SOURCE && e.isSourceLoaded) {
        // Source is loaded — ensure the layer exists
        if (!mapInstance.getLayer(MASK_LAND) && mapInstance.getSource(MASK_LAND_SOURCE)) {
          ensureLayers();
        }
      }
    };
    mapInstance.on('sourcedata', handler);
    return () => mapInstance.off('sourcedata', handler);
  }, [mapInstance, active, ensureLayers]);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      try {
        ALL_LAYERS.forEach(lid => {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        });
        if (mapInstance.getSource(MASK_LAND_SOURCE)) {
          try { mapInstance.removeSource(MASK_LAND_SOURCE); } catch (e) {}
        }

        const style = mapInstance.getStyle();
        if (style?.layers) {
          const defaultColors = THEME_OCEAN_COLORS.default;
          const targetColor = defaultColors[theme] || defaultColors.dark;
          style.layers.forEach(layer => {
            if (layer.type === 'fill' &&
                (layer.id === 'water' || layer.id.includes('water')) &&
                !ALL_LAYERS.includes(layer.id)) {
              try { mapInstance.setPaintProperty(layer.id, 'fill-color', targetColor); } catch (e) {}
            }
          });
        }
      } catch (e) {}
    };
  }, [mapInstance, theme]);

  return null;
}

export default OceanMask;
