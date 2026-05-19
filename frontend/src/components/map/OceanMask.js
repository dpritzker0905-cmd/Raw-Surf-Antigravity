import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

/**
 * OceanMask v6 — Three-layer coastline masking system.
 *
 * Layer stack (bottom → top):
 *   [water]               ← Mapbox base (ocean fill)
 *   [marine rasters]      ← OM wave/swell tiles
 *   ocean-mask-fill       ← NE 10m land fill (covers raster bleed on land)
 *   ocean-mask-water      ← Composite `water` source-layer (restores lakes/rivers/lagoons)
 *   ocean-mask-line       ← NE 10m coastline outline (modern boundary)
 *   [roads/labels]        ← Mapbox base (untouched)
 *
 * Why three layers?
 *   - NE 10m polygons are solid continental shapes (no lake cutouts)
 *   - The composite source's `water` source-layer HAS lake/river/lagoon polygons
 *   - Painting water ON TOP of the land fill restores all inland water features
 */

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

const MASK_SOURCE  = 'ocean-mask-source';
const MASK_FILL    = 'ocean-mask-fill';
const MASK_WATER   = 'ocean-mask-water';
const MASK_LINE    = 'ocean-mask-line';

// Theme-aware colors
const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', water: 'hsl(205, 33%, 18%)', line: 'rgba(0, 0, 0, 0.35)', lw: 1.2 },
  light: { fill: 'hsl(0, 0%, 100%)',   water: 'hsl(205, 56%, 73%)', line: 'rgba(0, 0, 0, 0.12)', lw: 0.8 },
  beach: { fill: 'hsl(31, 24%, 91%)',  water: 'hsl(205, 56%, 73%)', line: 'rgba(0, 0, 0, 0.18)', lw: 1.0 },
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

/** Read the base map's water and background colors from the live style. */
function resolveColors(mapInstance, theme) {
  const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
  let fillColor = tc.fill;
  let waterColor = tc.water;

  if (mapInstance) {
    try {
      const style = mapInstance.getStyle?.();
      if (style?.layers) {
        // Read background color for fill
        const bg = style.layers.find(l => l.type === 'background');
        if (bg?.paint?.['background-color']) fillColor = bg.paint['background-color'];

        // Read water color from base map's water layer
        const wl = style.layers.find(l => l.id === 'water' && l.type === 'fill');
        if (wl?.paint?.['fill-color']) waterColor = wl.paint['fill-color'];
      }
    } catch (e) { /* style not ready */ }
  }
  return { fill: fillColor, water: waterColor, line: tc.line, lw: tc.lw };
}

export function OceanMask({ mapInstance, active, theme }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);

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

  const colors = useMemo(() => resolveColors(mapInstance, theme), [mapInstance, theme]);

  // Main sync: add/remove all three layers
  const syncLayers = useCallback(() => {
    if (!mapInstance || !maskData) return;
    const style = mapInstance.getStyle?.();
    if (!style) return;

    const hasFill  = !!mapInstance.getLayer(MASK_FILL);
    const hasWater = !!mapInstance.getLayer(MASK_WATER);
    const hasLine  = !!mapInstance.getLayer(MASK_LINE);
    const hasSrc   = !!mapInstance.getSource(MASK_SOURCE);

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

      // Layer 1: NE 10m land fill (covers marine raster bleed)
      if (!hasFill) {
        mapInstance.addLayer({
          id: MASK_FILL,
          type: 'fill',
          source: MASK_SOURCE,
          paint: { 'fill-color': colors.fill, 'fill-opacity': 1 },
        }, beforeId || undefined);
      } else {
        try { mapInstance.setPaintProperty(MASK_FILL, 'fill-color', colors.fill); } catch (e) {}
      }

      // Layer 2: Water restoration — uses Mapbox composite source's water polygons
      // This restores lakes, rivers, lagoons that the NE 10m fill covered
      if (!hasWater && mapInstance.getSource('composite')) {
        mapInstance.addLayer({
          id: MASK_WATER,
          type: 'fill',
          source: 'composite',
          'source-layer': 'water',
          paint: { 'fill-color': colors.water, 'fill-opacity': 1 },
        }, beforeId || undefined);
        console.log('[OceanMask] Water restoration layer added (lakes/rivers/lagoons)');
      } else if (hasWater) {
        try { mapInstance.setPaintProperty(MASK_WATER, 'fill-color', colors.water); } catch (e) {}
      }

      // Layer 3: Coastline outline — modern boundary line
      if (!hasLine) {
        mapInstance.addLayer({
          id: MASK_LINE,
          type: 'line',
          source: MASK_SOURCE,
          paint: {
            'line-color': colors.line,
            'line-width': ['interpolate', ['linear'], ['zoom'],
              2, colors.lw * 0.5,
              6, colors.lw,
              10, colors.lw * 1.5,
            ],
            'line-opacity': 0.8,
            'line-blur': 0.5,
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        }, beforeId || undefined);
      } else {
        try {
          mapInstance.setPaintProperty(MASK_LINE, 'line-color', colors.line);
        } catch (e) {}
      }
    } else {
      // --- REMOVE (reverse order) ---
      if (hasLine) { try { mapInstance.removeLayer(MASK_LINE); } catch (e) {} }
      if (hasWater) { try { mapInstance.removeLayer(MASK_WATER); } catch (e) {} }
      if (hasFill) { try { mapInstance.removeLayer(MASK_FILL); } catch (e) {} }
      if (hasSrc) { try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {} }
    }
  }, [mapInstance, maskData, active, colors]);

  useEffect(() => { syncLayers(); }, [syncLayers]);

  // Re-sync on style changes (theme switch reloads the entire style)
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => setTimeout(syncLayers, 250);
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      try { mapInstance.removeLayer(MASK_LINE); } catch (e) {}
      try { mapInstance.removeLayer(MASK_WATER); } catch (e) {}
      try { mapInstance.removeLayer(MASK_FILL); } catch (e) {}
      try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
