/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';
import { findMarineInsertionLayer } from './mapUtils';

/**
 * OceanMask v13 — Dynamic base map water recoloring and lightweight land mask.
 *
 * Rather than loading a heavy, glitched global GeoJSON land mask which
 * draws massive visual artifacts and covers up inland lakes/parks,
 * this component dynamically recolors MapLibre's vector water layers
 * to match the base palette of our active marine rasters, AND uses a
 * highly-optimized, lightweight local 110m land mask (127 polygons)
 * to clip the 25km coarse GFS marine rasters cleanly at the sandy beaches
 * without blocky visual staircasing on land.
 *
 * Layer stack (bottom → top):
 *   [water]                  ← Mapbox base (recolored dynamically)
 *   [marine slot raster]     ← GFS wave/swell layers (forced below MASK_BUFFER)
 *   ocean-mask-buffer        ← WIDE outward-shifted blurred theme-matching buffer line (smooth edges)
 *   ocean-mask-fill          ← NE 110m solid land fill polygons
 *   ocean-mask-inland-water  ← High-resolution vector inland lakes/reservoirs on top of fill
 *   ocean-mask-inland-waterway ← High-resolution vector rivers/canals on top of fill
 *   ocean-mask-line          ← Thin aesthetic boundary coastline outline
 *   [roads/labels]           ← Mapbox base
 */

const LOCAL_NE_LAND_URL = '/ne_50m_land.json';
const CDN_NE_LAND_URL   = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/50m/physical/ne_50m_land.json';

const MASK_SOURCE = 'ocean-mask-source';
const MASK_BUFFER = 'ocean-mask-buffer';
const MASK_FILL   = 'ocean-mask-fill';
const MASK_LINE   = 'ocean-mask-line';
const MASK_INLAND_WATERWAY = 'ocean-mask-inland-waterway';
const MASK_INLAND_WATER = 'ocean-mask-inland-water';
const ALL_LAYERS  = [MASK_LINE, MASK_FILL, MASK_BUFFER, MASK_INLAND_WATERWAY, MASK_INLAND_WATER];

const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', line: 'rgba(0, 0, 0, 0.35)', lw: 1.2 },
  light: { fill: 'hsl(0, 0%, 100%)',   line: 'rgba(0, 0, 0, 0.12)', lw: 0.8 },
  beach: { fill: 'hsl(31, 24%, 91%)',  line: 'rgba(0, 0, 0, 0.18)', lw: 1.0 },
};

const THEME_OCEAN_COLORS = {
  waves: {
    dark:  'hsl(195, 50%, 18%)', // Premium, rich coastal blue-teal
    light: 'hsl(195, 60%, 82%)', // Soft beach sky blue
    beach: 'hsl(192, 65%, 75%)', // Tropical beach teal
  },
  swell_1: {
    dark:  'hsl(195, 50%, 18%)', // Same as waves
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

function buildLandMask(landGeoJSON) {
  if (!landGeoJSON?.features?.length) return null;
  const polygons = [];
  for (const feature of landGeoJSON.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      polygons.push({ type: 'Feature', geometry: geom, properties: {} });
    }
  }
  return { type: 'FeatureCollection', features: polygons };
}

export function OceanMask({ mapInstance, activeMarineLayer, theme, beforeId }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const syncingRef = useRef(false);
  const lastPropsRef = useRef({ activeMarineLayer: null, theme: null, beforeId: null });

  // Fetch the Natural Earth 110m land polygons
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    fetch(LOCAL_NE_LAND_URL)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(geojson => {
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log(`[OceanMask] Loaded offline-friendly 110m land mask: ${mask.features.length} features`);
        }
      })
      .catch(err => {
        console.warn('[OceanMask] Local land mask failed, attempting CDN fallback:', err.message);
        fetch(CDN_NE_LAND_URL)
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then(geojson => {
            const mask = buildLandMask(geojson);
            if (mask) {
              setMaskData(mask);
              console.log(`[OceanMask] Loaded CDN fallback 110m land mask: ${mask.features.length} features`);
            }
          })
          .catch(cdnErr => {
            console.error('[OceanMask] CDN fallback land mask failed:', cdnErr.message);
            fetchedRef.current = false;
          });
      });
  }, []);

  const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
  const active = !!activeMarineLayer;

  const syncLayers = useCallback(() => {
    if (!mapInstance) return;

    // Base map water layers dynamic recoloring
    try {
      const style = mapInstance.getStyle();
      if (style && style.layers) {
        const oceanColors = active ? (THEME_OCEAN_COLORS[activeMarineLayer] || THEME_OCEAN_COLORS.default) : THEME_OCEAN_COLORS.default;
        const targetOceanColor = oceanColors[theme] || oceanColors.dark;

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

    // Land masking source and layers
    if (!maskData) return;

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
      const hasFill = !!mapInstance.getLayer(MASK_FILL);
      const hasLine = !!mapInstance.getLayer(MASK_LINE);
      const hasWaterway = !!mapInstance.getLayer(MASK_INLAND_WATERWAY);
      const hasWater = !!mapInstance.getLayer(MASK_INLAND_WATER);
      const hasSrc  = !!mapInstance.getSource(MASK_SOURCE);

      if (active) {
        if (!hasSrc) {
          try {
            mapInstance.addSource(MASK_SOURCE, {
              type: 'geojson', data: maskData, tolerance: 0.005,
            });
          } catch (e) {
            console.error('[OceanMask] Failed to add source:', e);
          }
        }

        const insertBeforeId = beforeId || findMarineInsertionLayer(mapInstance);
        const fillColor = tc.fill;

        // Layer 1: Coastline buffer with outward shift (soft blur transition to map background)
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: MASK_SOURCE,
              paint: {
                'line-color': fillColor,
                'line-width': ['interpolate', ['linear'], ['zoom'],
                  1, 10,
                  5, 22,
                  7, 12,
                  9, 0.5,
                  14, 0.0
                ],
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, 5,
                  5, 9,
                  7, 4,
                  9, 0.0,
                  14, 0.0
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
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', fillColor);
          } catch (e) {}
        }

        // Layer 2: Natural Earth 110m land fill (solid landmass background block)
        if (!hasFill) {
          try {
            mapInstance.addLayer({
              id: MASK_FILL,
              type: 'fill',
              source: MASK_SOURCE,
              paint: {
                'fill-color': fillColor,
                'fill-opacity': ['interpolate', ['linear'], ['zoom'],
                  7.5, 1.0,
                  9.0, 0.0
                ]
              },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_FILL:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_FILL, insertBeforeId);
            mapInstance.setPaintProperty(MASK_FILL, 'fill-color', fillColor);
            mapInstance.setPaintProperty(MASK_FILL, 'fill-opacity', ['interpolate', ['linear'], ['zoom'],
              7.5, 1.0,
              9.0, 0.0
            ]);
          } catch (e) {}
        }

        // Layer 3: Recover high-resolution inland water (lakes, reservoirs) on top of mask
        let waterSource = 'composite';
        let waterSourceLayer = 'water';
        const defaultColors = THEME_OCEAN_COLORS.default;
        const waterColor = defaultColors[theme] || defaultColors.dark;

        try {
          const baseWater = style?.layers?.find(l => l.id === 'water' || l.id === 'water-depth' || l.id === 'wetland');
          if (baseWater) {
            if (baseWater.source) waterSource = baseWater.source;
            if (baseWater['source-layer']) waterSourceLayer = baseWater['source-layer'];
          }
        } catch (e) {}

        if (!hasWater) {
          try {
            mapInstance.addLayer({
              id: MASK_INLAND_WATER,
              type: 'fill',
              source: waterSource,
              'source-layer': waterSourceLayer,
              filter: ['all', ['has', 'class'], ['!=', ['get', 'class'], 'ocean'], ['!=', ['get', 'class'], 'sea']],
              paint: {
                'fill-color': waterColor,
                'fill-opacity': ['interpolate', ['linear'], ['zoom'],
                  7.5, 1.0,
                  9.0, 0.0
                ]
              }
            }, insertBeforeId || undefined);
          } catch (e) {
            console.warn('[OceanMask] Failed to add MASK_INLAND_WATER:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_INLAND_WATER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATER, 'fill-color', waterColor);
            mapInstance.setPaintProperty(MASK_INLAND_WATER, 'fill-opacity', ['interpolate', ['linear'], ['zoom'],
              7.5, 1.0,
              9.0, 0.0
            ]);
            mapInstance.setFilter(MASK_INLAND_WATER, ['all', ['has', 'class'], ['!=', ['get', 'class'], 'ocean'], ['!=', ['get', 'class'], 'sea']]);
          } catch (e) {}
        }

        // Layer 4: Recover high-resolution waterways (rivers, streams) on top of mask
        let waterwaySource = 'composite';
        let waterwaySourceLayer = 'waterway';
        let waterwayColor = 'hsl(197, 15%, 43%)';

        try {
          const baseWaterway = style?.layers?.find(l => l.id === 'waterway' || l.id.includes('waterway'));
          if (baseWaterway) {
            if (baseWaterway.source) waterwaySource = baseWaterway.source;
            if (baseWaterway['source-layer']) waterwaySourceLayer = baseWaterway['source-layer'];
            if (baseWaterway.paint?.['line-color']) waterwayColor = baseWaterway.paint['line-color'];
          }
        } catch (e) {}

        if (!hasWaterway) {
          try {
            mapInstance.addLayer({
              id: MASK_INLAND_WATERWAY,
              type: 'line',
              source: waterwaySource,
              'source-layer': waterwaySourceLayer,
              paint: {
                'line-color': waterwayColor,
                'line-width': ['interpolate', ['linear'], ['zoom'],
                  8, 0.5,
                  13, 1.5,
                  18, 6
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  7.5, 1.0,
                  9.0, 0.0
                ]
              }
            }, insertBeforeId || undefined);
          } catch (e) {
            console.warn('[OceanMask] Failed to add MASK_INLAND_WATERWAY:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_INLAND_WATERWAY, insertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATERWAY, 'line-color', waterwayColor);
            mapInstance.setPaintProperty(MASK_INLAND_WATERWAY, 'line-opacity', ['interpolate', ['linear'], ['zoom'],
              7.5, 1.0,
              9.0, 0.0
            ]);
          } catch (e) {}
        }

        // Layer 5: Thin boundary coastline outline
        if (!hasLine) {
          try {
            mapInstance.addLayer({
              id: MASK_LINE,
              type: 'line',
              source: MASK_SOURCE,
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
        if (mapInstance.getSource(MASK_SOURCE)) {
          try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
        }
      }
    } finally {
      setTimeout(() => { syncingRef.current = false; }, 300);
    }
  }, [mapInstance, maskData, activeMarineLayer, active, theme, tc, beforeId]);

  // Synchronize on active layer, theme, beforeId or maskData changes
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
        if (mapInstance.getSource(MASK_SOURCE)) {
          try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
        }

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
