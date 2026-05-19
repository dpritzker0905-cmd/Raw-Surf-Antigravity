import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * OceanMask v8 — Three-layer coastline masking system.
 *
 * Layer stack (bottom → top):
 *   [water]               ← Mapbox base (ocean fill)
 *   [marine rasters]      ← OM wave/swell tiles
 *   ocean-mask-buffer     ← NE 10m THICK coastline line (covers GFS grid bleed)
 *   ocean-mask-fill       ← NE 10m land fill (solid land coverage)
 *   ocean-mask-line       ← NE 10m thin outline (aesthetic boundary)
 *   [roads/labels]        ← Mapbox base (untouched)
 *
 * The BUFFER layer is the key innovation: GFS marine raster tiles have
 * ~28km grid cells that straddle coastlines, producing a green/teal band
 * where the raster extends past the NE 10m polygon edge into the ocean.
 * A thick line in the background color, painted BELOW the fill, extends
 * outward from the coastline to cover this bleed zone.
 */

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

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
  for (const l of style?.layers || []) {
    if (['land-structure-polygon', 'land-structure-line',
         'building-outline', 'building'].includes(l.id) ||
        l.id.startsWith('tunnel-') || l.id.startsWith('road-')) {
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

export function OceanMask({ mapInstance, active, theme }) {
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
      const hasSrc  = !!mapInstance.getSource(MASK_SOURCE);

      if (active) {
        if (!hasSrc) {
          mapInstance.addSource(MASK_SOURCE, {
            type: 'geojson', data: maskData, tolerance: 0.375,
          });
        }

        const beforeId = findInsertBefore(style);
        const fillColor = resolveFillColor(mapInstance, theme);

        // Layer 1: THICK coastline buffer — covers GFS grid cell bleed zone.
        // At zoom 3, GFS cells are ~100px → need ~50px buffer.
        // At zoom 7, cells are ~8px → need ~10px buffer.
        // At zoom 12+, cells are sub-pixel → 3px is enough.
        if (!hasBuf) {
          mapInstance.addLayer({
            id: MASK_BUFFER,
            type: 'line',
            source: MASK_SOURCE,
            paint: {
              'line-color': fillColor,
              'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
                2, 6,
                5, 12,
                7, 16,
                10, 10,
                14, 4,
              ],
              'line-opacity': 1,
              'line-blur': ['interpolate', ['linear'], ['zoom'], 3, 2, 8, 1, 12, 0],
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          }, beforeId || undefined);
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
          }, beforeId || undefined);
        } else {
          try { mapInstance.setPaintProperty(MASK_FILL, 'fill-color', fillColor); } catch (e) {}
        }

        // Layer 3: Thin coastline outline — aesthetic boundary
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
          }, beforeId || undefined);
        }
      } else {
        // --- REMOVE ---
        for (const lid of ALL_LAYERS) {
          if (mapInstance.getLayer(lid)) { try { mapInstance.removeLayer(lid); } catch (e) {} }
        }
        if (hasSrc) { try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {} }
      }
    } finally {
      setTimeout(() => { syncingRef.current = false; }, 500);
    }
  }, [mapInstance, maskData, active, theme, tc]);

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
