/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * OceanMask v10 — Coastline masking with outward-shifted buffer.
 *
 * Layer stack (bottom → top):
 *   [water]               ← Mapbox base
 *   [marine rasters]      ← OM wave/swell tiles (forced below MASK_BUFFER)
 *   ocean-mask-buffer     ← WIDE line shifted outward from land (covers GFS bleed)
 *   ocean-mask-fill       ← NE 10m land fill (solid coverage)
 *   [landuse/parks]       ← Moved above MASK_FILL but below lakes/rivers for visibility
 *   ocean-mask-inland-water ← Bring high-resolution lakes back on top of landuse/parks
 *   ocean-mask-inland-waterway ← Bring high-resolution rivers back on top of landuse/parks
 *   ocean-mask-line       ← Thin coastline outline (aesthetic)
 *   [roads/labels]        ← Mapbox base
 */

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/50m/physical/ne_50m_land.json';

const MASK_SOURCE = 'ocean-mask-source';
const MASK_BUFFER = 'ocean-mask-buffer';
const MASK_FILL   = 'ocean-mask-fill';
const MASK_LINE   = 'ocean-mask-line';
const ALL_LAYERS  = [MASK_LINE, MASK_FILL, MASK_BUFFER];

const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', line: 'rgba(0, 0, 0, 0.35)', lw: 1.2 },
  light: { fill: 'hsl(0, 0%, 100%)',   line: 'rgba(0, 0, 0, 0.12)', lw: 0.8 },
  beach: { fill: 'hsl(31, 24%, 91%)',  line: 'rgba(0, 0, 0, 0.18)', lw: 1.0 },
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


function findInsertBefore(style) {
  const layers = style?.layers || [];
  const waterIdx = layers.findIndex(l => l.id === 'water' || l.id === 'water-depth' || l.id === 'wetland');
  const startIndex = waterIdx !== -1 ? waterIdx + 1 : 0;
  for (let i = startIndex; i < layers.length; i++) {
    const l = layers[i];
    if (['landuse', 'national-park', 'park', 'natural', 'wood', 'glacier', 'sand', 'pitch',
         'land-structure-polygon', 'land-structure-line',
         'building-outline', 'building'].includes(l.id) ||
        l.id.startsWith('tunnel-') || l.id.startsWith('road-') || l.id.startsWith('landuse')) {
      return l.id;
    }
  }
  return null;
}

function resolveFillColor(mapInstance, theme) {
  const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
  return tc.fill;
}

function safeMoveLayer(map, layerId, beforeId) {
  if (!map || !layerId || !map.getLayer(layerId)) return;
  if (beforeId && map.getLayer(beforeId)) {
    try {
      const layers = map.getStyle()?.layers || [];
      const idxLayer = layers.findIndex(l => l.id === layerId);
      const idxBefore = layers.findIndex(l => l.id === beforeId);
      if (idxLayer !== -1 && idxBefore !== -1 && idxLayer >= idxBefore) {
        map.moveLayer(layerId, beforeId);
      }
    } catch (e) {
      console.warn(`[OceanMask] safeMoveLayer error:`, e);
    }
  }
}

export function OceanMask({ mapInstance, active, theme, beforeId }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // Fetch land mask
    fetch(NE_LAND_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(geojson => {
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Loaded NE 50m land:', geojson.features.length, 'land features');
        }
      })
      .catch(err => { console.warn('[OceanMask] Land fetch failed:', err); fetchedRef.current = false; });
  }, []);

  const tc = THEME_COLORS[theme] || THEME_COLORS.dark;

  const syncLayers = useCallback(() => {
    if (!mapInstance || !maskData) return;
    if (syncingRef.current) return;
    syncingRef.current = true;

    try {
      const style = mapInstance.getStyle?.();
      if (!style) return;

      const hasBuf  = !!mapInstance.getLayer(MASK_BUFFER);
      const hasFill = !!mapInstance.getLayer(MASK_FILL);
      const hasLine = !!mapInstance.getLayer(MASK_LINE);
      const hasSrc  = !!mapInstance.getSource(MASK_SOURCE);

      if (active) {
        if (!hasSrc) {
          try {
            mapInstance.addSource(MASK_SOURCE, {
              type: 'geojson', data: maskData, tolerance: 0.01, buffer: 0,
            });
          } catch (e) {
            console.error('[OceanMask] Failed to add source:', e);
          }
        }

        const insertBeforeId = beforeId || findInsertBefore(style);
        const fillColor = resolveFillColor(mapInstance, theme);

        // Layer 1: Coastline buffer with outward shift.
        // GFS marine tiles bleed past coastlines. Dynamic width tapers off at high zooms.
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: MASK_SOURCE,
              paint: {
                'line-color': fillColor,
                'line-width': ['interpolate', ['linear'], ['zoom'],
                  1, 4,
                  4, 3,
                  7, 2,
                  9, 1,
                  12, 0.5,
                  14, 0
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  2, 0.4,
                  8, 0.2,
                  10, 0.0
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
            console.error('[OceanMask] Failed to add MASK_BUFFER:', e);
          }
        } else {
          try {
            safeMoveLayer(mapInstance, MASK_BUFFER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', fillColor);
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-opacity', ['interpolate', ['linear'], ['zoom'],
              2, 0.4,
              8, 0.2,
              10, 0.0
            ]);
          } catch (e) {}
        }

        let isSatellite = theme === 'satellite';
        try {
          if (!isSatellite && mapInstance.getLayer('esri-satellite-layer')) {
            isSatellite = mapInstance.getLayoutProperty('esri-satellite-layer', 'visibility') === 'visible';
          }
        } catch (e) {}
        const fillOpacity = isSatellite ? 0.0 : 1.0;

        // Layer 2: NE 10m land fill
        if (!hasFill) {
          try {
            mapInstance.addLayer({
              id: MASK_FILL,
              type: 'fill',
              source: MASK_SOURCE,
              paint: {
                'fill-color': fillColor,
                'fill-opacity': ['interpolate', ['linear'], ['zoom'],
                  8, fillOpacity,
                  11, 0.0
                ]
              },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_FILL:', e);
          }
        } else {
          try {
            safeMoveLayer(mapInstance, MASK_FILL, insertBeforeId);
            mapInstance.setPaintProperty(MASK_FILL, 'fill-color', fillColor);
            mapInstance.setPaintProperty(MASK_FILL, 'fill-opacity', ['interpolate', ['linear'], ['zoom'],
              8, fillOpacity,
              11, 0.0
            ]);
          } catch (e) {}
        }

        // Layer 3: Thin coastline outline — aesthetic boundary
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
                  6, 0.3,
                  10, 0.0
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
            safeMoveLayer(mapInstance, MASK_LINE, insertBeforeId);
            mapInstance.setPaintProperty(MASK_LINE, 'line-color', tc.line);
            mapInstance.setPaintProperty(MASK_LINE, 'line-opacity', ['interpolate', ['linear'], ['zoom'],
              6, 0.3,
              10, 0.0
            ]);
          } catch (e) {}
        }

        // v90: Strictly force active marine raster layers BELOW the MASK_BUFFER layer
        const marineLayers = ['waves-layer', 'swell_1-layer', 'swell_2-layer', 'wind_waves-layer'];
        for (const ml of marineLayers) {
          if (mapInstance.getLayer(ml) && mapInstance.getLayer(MASK_BUFFER)) {
            try {
              safeMoveLayer(mapInstance, ml, MASK_BUFFER);
            } catch (e) {}
          }
        }
      } else {
        if (mapInstance.getStyle()) {
          for (const lid of ALL_LAYERS) {
            try {
              if (mapInstance.getLayer(lid)) {
                mapInstance.removeLayer(lid);
              }
            } catch (e) {}
          }
          try {
            if (mapInstance.getSource(MASK_SOURCE)) {
              mapInstance.removeSource(MASK_SOURCE);
            }
          } catch (e) {}
        }
      }
    } finally {
      setTimeout(() => { syncingRef.current = false; }, 500);
    }
  }, [mapInstance, maskData, active, theme, tc, beforeId]);

  useEffect(() => { syncLayers(); }, [syncLayers]);

  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => { if (!syncingRef.current) setTimeout(syncLayers, 300); };
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayers]);

  useEffect(() => {
    return () => {
      if (!mapInstance || !mapInstance.getStyle()) return;
      for (const lid of ALL_LAYERS) {
        try {
          if (mapInstance.getLayer(lid)) {
            mapInstance.removeLayer(lid);
          }
        } catch (e) {}
      }
      try {
        if (mapInstance.getSource(MASK_SOURCE)) {
          mapInstance.removeSource(MASK_SOURCE);
        }
      } catch (e) {}
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
