import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

/**
 * OceanMask v5 — Modern coastline masking with land fill + outline.
 *
 * Architecture:
 *   1. NE 10m land polygon FILL — covers marine raster bleed on land
 *   2. NE 10m coastline LINE — draws a clean, modern boundary between
 *      water and land (similar to Ventusky, Windy, etc.)
 *
 * Both layers are positioned ABOVE marine rasters but BELOW roads/labels.
 * Fill color dynamically matches the map background for seamless integration.
 * Line color uses a subtle semi-transparent shade for a modern aesthetic.
 */

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

const MASK_SOURCE_ID = 'ocean-mask-source';
const MASK_FILL_ID   = 'ocean-mask-fill';
const MASK_LINE_ID   = 'ocean-mask-line';

// Theme-aware colors
const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', line: 'rgba(0, 0, 0, 0.35)', lineWidth: 1.2 },
  light: { fill: 'hsl(0, 0%, 100%)',   line: 'rgba(0, 0, 0, 0.15)', lineWidth: 0.8 },
  beach: { fill: 'hsl(31, 24%, 91%)',  line: 'rgba(0, 0, 0, 0.20)', lineWidth: 1.0 },
};

/**
 * Build a GeoJSON FeatureCollection of land polygons.
 */
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

/**
 * Find the layer id to insert mask layers BEFORE.
 * Target: after marine rasters, before roads/labels/buildings.
 */
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

export function OceanMask({ mapInstance, active, theme }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const addedRef   = useRef(false);

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
          console.log('[OceanMask] Loaded NE 10m:', geojson.features.length, 'features');
        }
      })
      .catch(err => {
        console.warn('[OceanMask] Failed to fetch land polygons:', err);
        fetchedRef.current = false;
      });
  }, []);

  // Resolve theme colors
  const colors = useMemo(() => {
    const c = THEME_COLORS[theme] || THEME_COLORS.dark;
    if (mapInstance) {
      try {
        const style = mapInstance.getStyle?.();
        const bg = style?.layers?.find(l => l.type === 'background');
        if (bg?.paint?.['background-color']) {
          return { ...c, fill: bg.paint['background-color'] };
        }
      } catch (e) { /* style not ready */ }
    }
    return c;
  }, [mapInstance, theme]);

  // Sync layers
  const syncLayers = useCallback(() => {
    if (!mapInstance || !maskData) return;
    const style = mapInstance.getStyle?.();
    if (!style) return;

    const sourceExists = !!mapInstance.getSource(MASK_SOURCE_ID);
    const fillExists   = !!mapInstance.getLayer(MASK_FILL_ID);
    const lineExists   = !!mapInstance.getLayer(MASK_LINE_ID);

    if (active) {
      // Add source
      if (!sourceExists) {
        mapInstance.addSource(MASK_SOURCE_ID, {
          type: 'geojson',
          data: maskData,
          tolerance: 0.375,
        });
      }

      const beforeId = findInsertBefore(style);

      // Add fill layer (land mask)
      if (!fillExists) {
        mapInstance.addLayer({
          id: MASK_FILL_ID,
          type: 'fill',
          source: MASK_SOURCE_ID,
          paint: { 'fill-color': colors.fill, 'fill-opacity': 1 },
        }, beforeId || undefined);
      } else {
        try { mapInstance.setPaintProperty(MASK_FILL_ID, 'fill-color', colors.fill); }
        catch (e) { /* transitioning */ }
      }

      // Add line layer (coastline outline) — rendered ON TOP of fill
      if (!lineExists) {
        mapInstance.addLayer({
          id: MASK_LINE_ID,
          type: 'line',
          source: MASK_SOURCE_ID,
          paint: {
            'line-color': colors.line,
            'line-width': ['interpolate', ['linear'], ['zoom'],
              2, colors.lineWidth * 0.5,
              6, colors.lineWidth,
              10, colors.lineWidth * 1.5,
            ],
            'line-opacity': 0.8,
            'line-blur': 0.5,
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        }, beforeId || undefined);
      } else {
        try {
          mapInstance.setPaintProperty(MASK_LINE_ID, 'line-color', colors.line);
          mapInstance.setPaintProperty(MASK_LINE_ID, 'line-width', ['interpolate', ['linear'], ['zoom'],
            2, colors.lineWidth * 0.5,
            6, colors.lineWidth,
            10, colors.lineWidth * 1.5,
          ]);
        } catch (e) { /* ok */ }
      }
      addedRef.current = true;
    } else {
      // Remove in reverse order
      if (lineExists) {
        try { mapInstance.removeLayer(MASK_LINE_ID); } catch (e) { /* ok */ }
      }
      if (fillExists) {
        try { mapInstance.removeLayer(MASK_FILL_ID); } catch (e) { /* ok */ }
      }
      if (sourceExists) {
        try { mapInstance.removeSource(MASK_SOURCE_ID); } catch (e) { /* ok */ }
      }
      addedRef.current = false;
    }
  }, [mapInstance, maskData, active, colors]);

  useEffect(() => { syncLayers(); }, [syncLayers]);

  // Re-sync on style changes (theme switch reloads style)
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => setTimeout(syncLayers, 200);
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      try { mapInstance.removeLayer(MASK_LINE_ID); } catch (e) { /* ok */ }
      try { mapInstance.removeLayer(MASK_FILL_ID); } catch (e) { /* ok */ }
      try { mapInstance.removeSource(MASK_SOURCE_ID); } catch (e) { /* ok */ }
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
