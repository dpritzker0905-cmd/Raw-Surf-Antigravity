import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

/**
 * OceanMask v7 — Two-layer coastline masking system.
 *
 * Layer stack (bottom → top):
 *   [water]               ← Mapbox base (ocean fill)
 *   [marine rasters]      ← OM wave/swell tiles
 *   ocean-mask-fill       ← NE 10m land fill (covers raster bleed on land)
 *   ocean-mask-line       ← NE 10m coastline outline (modern boundary)
 *   [roads/labels]        ← Mapbox base (untouched)
 *
 * NOTE: v6's water restoration layer (composite/water) was REMOVED because
 * the Mapbox `water` source-layer includes OCEAN polygons, which covered
 * the marine raster tiles entirely. Ventusky and Windy also hide inland
 * lakes when marine layers are active — this is an acceptable trade-off.
 */

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

const MASK_SOURCE = 'ocean-mask-source';
const MASK_FILL   = 'ocean-mask-fill';
const MASK_LINE   = 'ocean-mask-line';

// Theme-aware colors
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

/** Find the first structural/road layer to insert BEFORE. */
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

/** Read the base map's background color from the live style. */
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
  const syncingRef = useRef(false); // Debounce guard for styledata loop

  // Fetch NE 10m land polygons once
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    fetch(NE_LAND_URL)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(geojson => {
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Loaded NE 10m:', geojson.features.length, 'land features');
        }
      })
      .catch(err => {
        console.warn('[OceanMask] Fetch failed:', err);
        fetchedRef.current = false;
      });
  }, []);

  const tc = THEME_COLORS[theme] || THEME_COLORS.dark;

  // Main sync: add/remove layers (guarded against re-entry)
  const syncLayers = useCallback(() => {
    if (!mapInstance || !maskData) return;
    if (syncingRef.current) return; // Prevent styledata loop
    syncingRef.current = true;

    try {
      const style = mapInstance.getStyle?.();
      if (!style) return;

      const hasFill = !!mapInstance.getLayer(MASK_FILL);
      const hasLine = !!mapInstance.getLayer(MASK_LINE);
      const hasSrc  = !!mapInstance.getSource(MASK_SOURCE);

      if (active) {
        // --- ADD ---
        if (!hasSrc) {
          mapInstance.addSource(MASK_SOURCE, {
            type: 'geojson',
            data: maskData,
            tolerance: 0.375,
          });
        }

        const beforeId = findInsertBefore(style);
        const fillColor = resolveFillColor(mapInstance, theme);

        // Layer 1: NE 10m land fill (covers marine raster bleed on land)
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

        // Layer 2: Coastline outline — modern boundary line
        if (!hasLine) {
          mapInstance.addLayer({
            id: MASK_LINE,
            type: 'line',
            source: MASK_SOURCE,
            paint: {
              'line-color': tc.line,
              'line-width': ['interpolate', ['linear'], ['zoom'],
                2, tc.lw * 0.5,
                6, tc.lw,
                10, tc.lw * 1.5,
              ],
              'line-opacity': 0.8,
              'line-blur': 0.5,
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          }, beforeId || undefined);
        }
      } else {
        // --- REMOVE ---
        if (hasLine) { try { mapInstance.removeLayer(MASK_LINE); } catch (e) {} }
        if (hasFill) { try { mapInstance.removeLayer(MASK_FILL); } catch (e) {} }
        if (hasSrc) { try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {} }
      }
    } finally {
      // Release guard after a delay (longer than styledata propagation)
      setTimeout(() => { syncingRef.current = false; }, 500);
    }
  }, [mapInstance, maskData, active, theme, tc]);

  useEffect(() => { syncLayers(); }, [syncLayers]);

  // Re-sync on style changes (theme switch reloads the entire style).
  // Uses debounce guard to prevent the infinite loop:
  // addLayer → styledata → syncLayers → addLayer → styledata → ...
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => {
      if (!syncingRef.current) setTimeout(syncLayers, 300);
    };
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      try { mapInstance.removeLayer(MASK_LINE); } catch (e) {}
      try { mapInstance.removeLayer(MASK_FILL); } catch (e) {}
      try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
