/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * OceanMask v9 — Coastline masking with outward-shifted buffer.
 *
 * Layer stack (bottom → top):
 *   [water]               ← Mapbox base
 *   [marine rasters]      ← OM wave/swell tiles
 *   ocean-mask-buffer     ← WIDE line shifted outward from land (covers GFS bleed)
 *   ocean-mask-fill       ← NE 10m land fill (solid coverage)
 *   ocean-mask-line       ← Thin coastline outline (aesthetic)
 *   [roads/labels]        ← Mapbox base
 *
 * The buffer uses `line-translate` to shift the entire line outward from
 * land, ensuring maximum coverage of the GFS grid cell bleed zone that
 * creates a green/teal band along coastlines.
 */

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

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
  for (const l of style?.layers || []) {
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
  if (mapInstance) {
    try {
      const style = mapInstance.getStyle?.();
      const bg = style?.layers?.find(l => l.type === 'background');
      if (bg?.paint?.['background-color']) return bg.paint['background-color'];
    } catch (e) { /* style not ready */ }
  }
  return tc.fill;
}

export function OceanMask({ mapInstance, active, theme, beforeId }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    fetch(NE_LAND_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(geojson => {
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Loaded NE 10m:', geojson.features.length, 'land features');
        }
      })
      .catch(err => { console.warn('[OceanMask] Fetch failed:', err); fetchedRef.current = false; });
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
      const hasWaterway = !!mapInstance.getLayer(MASK_INLAND_WATERWAY);
      const hasWater = !!mapInstance.getLayer(MASK_INLAND_WATER);
      const hasSrc  = !!mapInstance.getSource(MASK_SOURCE);

      if (active) {
        if (!hasSrc) {
          mapInstance.addSource(MASK_SOURCE, {
            type: 'geojson', data: maskData, tolerance: 0.375,
          });
        }

        const insertBeforeId = beforeId || findInsertBefore(style);
        const fillColor = resolveFillColor(mapInstance, theme);

        // Layer 1: WIDE coastline buffer with outward shift.
        // GFS marine tiles bleed 1-3 grid cells (~28-84km) past coastlines.
        // Shrink the width of MASK_BUFFER at mid-to-high zoom levels to prevent it from invading coastal waters.
        // Use soft blur for a clean, premium transition where water meets the edge of land.
        if (!hasBuf) {
          mapInstance.addLayer({
            id: MASK_BUFFER,
            type: 'line',
            source: MASK_SOURCE,
            paint: {
              'line-color': fillColor,
              'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                1, 5,
                3, 8,
                5, 12,
                7, 16,
                9, 20,
                11, 24,
                14, 28,
              ],
              'line-opacity': 1,
              'line-blur': ['interpolate', ['linear'], ['zoom'],
                2, 2.0,
                7, 1.5,
                11, 1.0,
                14, 0.5
              ],
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          }, insertBeforeId || undefined);
        } else {
          try { mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', fillColor); } catch (e) {}
        }

        // Layer 2: NE 10m land fill
        if (!hasFill) {
          mapInstance.addLayer({
            id: MASK_FILL,
            type: 'fill',
            source: MASK_SOURCE,
            paint: { 'fill-color': fillColor, 'fill-opacity': 1 },
          }, insertBeforeId || undefined);
        } else {
          try { mapInstance.setPaintProperty(MASK_FILL, 'fill-color', fillColor); } catch (e) {}
        }

        // Layer 3: Bring high-resolution inland water (lakes/reservoirs) back to top
        if (!hasWater) {
          let waterColor = 'hsl(197, 60%, 80%)';
          try {
            const baseWater = style?.layers?.find(l => l.id === 'water');
            if (baseWater?.paint?.['fill-color']) {
              waterColor = baseWater.paint['fill-color'];
            }
          } catch (e) {}

          mapInstance.addLayer({
            id: MASK_INLAND_WATER,
            type: 'fill',
            source: 'composite',
            'source-layer': 'water',
            filter: ['all', ['has', 'class'], ['!=', ['get', 'class'], 'ocean']],
            paint: {
              'fill-color': waterColor,
              'fill-opacity': 1.0
            }
          }, insertBeforeId || undefined);
        } else {
          try {
            const baseWater = style?.layers?.find(l => l.id === 'water');
            if (baseWater?.paint?.['fill-color']) {
              mapInstance.setPaintProperty(MASK_INLAND_WATER, 'fill-color', baseWater.paint['fill-color']);
            }
          } catch (e) {}
        }

        // Layer 4: Bring high-resolution waterways (rivers/streams as lines) back to top
        if (!hasWaterway) {
          let waterwayColor = 'hsl(197, 15%, 43%)';
          try {
            const baseWaterway = style?.layers?.find(l => l.id === 'waterway');
            if (baseWaterway?.paint?.['line-color']) {
              waterwayColor = baseWaterway.paint['line-color'];
            }
          } catch (e) {}

          mapInstance.addLayer({
            id: MASK_INLAND_WATERWAY,
            type: 'line',
            source: 'composite',
            'source-layer': 'waterway',
            paint: {
              'line-color': waterwayColor,
              'line-width': ['interpolate', ['linear'], ['zoom'],
                8, 0.5,
                13, 1.5,
                18, 6
              ],
              'line-opacity': 1.0
            }
          }, insertBeforeId || undefined);
        } else {
          try {
            const baseWaterway = style?.layers?.find(l => l.id === 'waterway');
            if (baseWaterway?.paint?.['line-color']) {
              mapInstance.setPaintProperty(MASK_INLAND_WATERWAY, 'line-color', baseWaterway.paint['line-color']);
            }
          } catch (e) {}
        }

        // Layer 5: Thin coastline outline — aesthetic boundary
        if (!hasLine) {
          mapInstance.addLayer({
            id: MASK_LINE,
            type: 'line',
            source: MASK_SOURCE,
            paint: {
              'line-color': tc.line,
              'line-width': ['interpolate', ['linear'], ['zoom'],
                2, tc.lw * 0.5, 6, tc.lw, 10, tc.lw * 1.5,
              ],
              'line-opacity': 0.8,
              'line-blur': 0.5,
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          }, insertBeforeId || undefined);
        }

        // Dynamically move vector layers matching landuse etc. above MASK_FILL/MASK_BUFFER and below MASK_LINE
        try {
          if (mapInstance.getLayer(MASK_LINE)) {
            const currentStyle = mapInstance.getStyle();
            if (currentStyle && currentStyle.layers) {
              for (const l of currentStyle.layers) {
                const id = l.id;
                const isLandFeature = ['landuse', 'national-park', 'landcover', 'park', 'natural', 'wood'].some(pat => id.toLowerCase().includes(pat));
                const isMaskLayer = ALL_LAYERS.includes(id);
                if (isLandFeature && !isMaskLayer) {
                  try {
                    mapInstance.moveLayer(id, MASK_LINE);
                  } catch (e) {}
                }
              }
            }
          }
        } catch (e) {
          console.warn('[OceanMask] Error rearranging vector land layers:', e);
        }
      } else {
        for (const lid of ALL_LAYERS) {
          if (mapInstance.getLayer(lid)) { try { mapInstance.removeLayer(lid); } catch (e) {} }
        }
        if (hasSrc) { try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {} }
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
      if (!mapInstance) return;
      for (const lid of ALL_LAYERS) { try { mapInstance.removeLayer(lid); } catch (e) {} }
      try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
