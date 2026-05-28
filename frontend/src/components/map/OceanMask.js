/**
 * OceanMask v13 — Pure Data Mask + Static Layer Generator
 *
 * FCE MIGRATION: OceanMask no longer touches MapLibre layer ordering.
 * It ONLY:
 *   1. Loads Natural Earth land GeoJSON (progressive: 50m → 10m)
 *   2. Generates a land mask for the SimulationField
 *   3. Adds/removes static visual layers (NO positioning, NO beforeId, NO safeMoveLayer)
 *
 * DELETED:
 *   - safeMoveLayer()
 *   - repositionLanduse()
 *   - restoreLanduse()
 *   - styledata event listeners
 *   - beforeId parameter
 *   - marine-raster-anchor dependency
 *   - findMarineInsertionLayer dependency
 *
 * RULE: This component is a PASSIVE renderer. It cannot make stacking decisions.
 */

/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

const MASK_SOURCE = 'ocean-mask-source';
const MASK_BUFFER = 'ocean-mask-buffer';
const MASK_FILL   = 'ocean-mask-fill';
const MASK_LINE   = 'ocean-mask-line';
const MASK_INLAND_WATERWAY = 'ocean-mask-inland-waterway';
const MASK_INLAND_WATER = 'ocean-mask-inland-water';

const ALL_LAYERS = [
  MASK_LINE,
  MASK_FILL,
  MASK_BUFFER,
  MASK_INLAND_WATERWAY,
  MASK_INLAND_WATER
];

const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', line: 'rgba(0, 0, 0, 0.35)', lw: 1.2, ocean: 'rgba(16, 29, 43, 0.90)' },
  light: { fill: 'hsl(0, 0%, 100%)',   line: 'rgba(0, 0, 0, 0.12)', lw: 0.8, ocean: 'rgba(202, 222, 240, 0.92)' },
  beach: { fill: 'hsl(31, 24%, 91%)',  line: 'rgba(0, 0, 0, 0.18)', lw: 1.0, ocean: 'rgba(173, 213, 242, 0.90)' },
};

// Filter: show all water features EXCEPT ocean/sea
const inlandWaterFilter = [
  'any',
  ['!', ['has', 'class']],
  ['match', ['get', 'class'], ['ocean', 'sea'], false, true]
];

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
 * Resolve base-map vector tile source info for inland water overlays.
 */
function resolveWaterSources(style) {
  let waterSource = 'composite', waterSourceLayer = 'water', waterColor = 'hsl(197, 60%, 80%)';
  let waterwaySource = 'composite', waterwaySourceLayer = 'waterway', waterwayColor = 'hsl(197, 15%, 43%)';
  try {
    const baseWater = style?.layers?.find(l => l.id === 'water' || l.id === 'water-depth' || l.id === 'wetland');
    if (baseWater) {
      if (baseWater.source) waterSource = baseWater.source;
      if (baseWater['source-layer']) waterSourceLayer = baseWater['source-layer'];
      if (baseWater.paint?.['fill-color']) waterColor = baseWater.paint['fill-color'];
    }
    const baseWaterway = style?.layers?.find(l => l.id === 'waterway' || l.id.includes('waterway'));
    if (baseWaterway) {
      if (baseWaterway.source) waterwaySource = baseWaterway.source;
      if (baseWaterway['source-layer']) waterwaySourceLayer = baseWaterway['source-layer'];
      if (baseWaterway.paint?.['line-color']) waterwayColor = baseWaterway.paint['line-color'];
    }
  } catch (e) {}
  return { waterSource, waterSourceLayer, waterColor, waterwaySource, waterwaySourceLayer, waterwayColor };
}

export function OceanMask({ mapInstance, active: propActive, activeMarineLayer, theme }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);

  const active = propActive !== undefined ? propActive : !!activeMarineLayer;

  // ================================================================
  // PHASE 1: Load Natural Earth land GeoJSON (progressive 50m → 10m)
  // ================================================================
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const loadLand = async () => {
      let phase1Loaded = false;

      // Phase 1: Fast local load (50m)
      try {
        const r = await fetch('/ne_50m_land.json');
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const geojson = await r.json();
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          phase1Loaded = true;
          console.log('[OceanMask] Phase 1: 50m land loaded (' + geojson.features.length + ' features)');
        }
      } catch (e) {
        try {
          const r = await fetch('/ne_110m_land.json');
          if (!r.ok) throw new Error(`Status ${r.status}`);
          const geojson = await r.json();
          const mask = buildLandMask(geojson);
          if (mask) {
            setMaskData(mask);
            phase1Loaded = true;
            console.log('[OceanMask] Phase 1: 110m fallback loaded');
          }
        } catch (e2) {}
      }

      // Phase 2: Upgrade to 10m from CDN
      try {
        const r = await fetch(NE_LAND_URL);
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const geojson = await r.json();
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Phase 2: 10m land UPGRADED (' + geojson.features.length + ' features)');
        }
      } catch (e) {
        if (!phase1Loaded) {
          console.error('[OceanMask] All land GeoJSON load attempts failed');
          fetchedRef.current = false;
        }
      }
    };
    loadLand();
  }, []);

  // ================================================================
  // PHASE 2: Add/Remove STATIC visual layers (NO ordering logic)
  // ================================================================
  useEffect(() => {
    if (!mapInstance) return;

    const addLayers = () => {
      if (!maskData || !active) return;
      try {
        const style = mapInstance.getStyle();
        if (!style) return;
      } catch (e) { return; }

      const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
      const { waterSource, waterSourceLayer, waterColor, waterwaySource, waterwaySourceLayer, waterwayColor } = resolveWaterSources(mapInstance.getStyle());

      // Source
      if (!mapInstance.getSource(MASK_SOURCE)) {
        try {
          mapInstance.addSource(MASK_SOURCE, { type: 'geojson', data: maskData, tolerance: 0.375 });
        } catch (e) {}
      } else {
        try { mapInstance.getSource(MASK_SOURCE)?.setData(maskData); } catch (e) {}
      }

      // 1. Coastline buffer (ocean-colored vignette)
      if (!mapInstance.getLayer(MASK_BUFFER)) {
        try {
          mapInstance.addLayer({
            id: MASK_BUFFER, type: 'line', source: MASK_SOURCE,
            paint: {
              'line-color': tc.ocean,
              'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 1, 10, 3, 16, 5, 22, 7, 22, 9, 20, 14, 2],
              'line-offset': ['interpolate', ['linear'], ['zoom'], 1, 5, 5, 9, 9, 12, 14, 0],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 1.0, 14, 0.0],
              'line-blur': ['interpolate', ['linear'], ['zoom'], 2, 2.0, 7, 1.5, 9, 1.0, 14, 0.0],
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          });
        } catch (e) {}
      } else {
        try { mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', tc.ocean); } catch (e) {}
      }

      // 2. Solid land fill
      if (!mapInstance.getLayer(MASK_FILL)) {
        try {
          mapInstance.addLayer({
            id: MASK_FILL, type: 'fill', source: MASK_SOURCE,
            paint: { 'fill-color': tc.fill, 'fill-opacity': 1.0 },
          });
        } catch (e) {}
      } else {
        try { mapInstance.setPaintProperty(MASK_FILL, 'fill-color', tc.fill); } catch (e) {}
      }

      // 3. Inland water (lakes)
      if (!mapInstance.getLayer(MASK_INLAND_WATER)) {
        try {
          mapInstance.addLayer({
            id: MASK_INLAND_WATER, type: 'fill', source: waterSource, 'source-layer': waterSourceLayer,
            filter: inlandWaterFilter,
            paint: { 'fill-color': waterColor, 'fill-opacity': 1.0 },
          });
        } catch (e) {}
      } else {
        try { mapInstance.setPaintProperty(MASK_INLAND_WATER, 'fill-color', waterColor); } catch (e) {}
      }

      // 4. Waterways (rivers)
      if (!mapInstance.getLayer(MASK_INLAND_WATERWAY)) {
        try {
          mapInstance.addLayer({
            id: MASK_INLAND_WATERWAY, type: 'line', source: waterwaySource, 'source-layer': waterwaySourceLayer,
            paint: {
              'line-color': waterwayColor,
              'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 13, 1.5, 18, 6],
              'line-opacity': 1.0,
            },
          });
        } catch (e) {}
      } else {
        try { mapInstance.setPaintProperty(MASK_INLAND_WATERWAY, 'line-color', waterwayColor); } catch (e) {}
      }

      // 5. Coastline outline
      if (!mapInstance.getLayer(MASK_LINE)) {
        try {
          mapInstance.addLayer({
            id: MASK_LINE, type: 'line', source: MASK_SOURCE,
            paint: {
              'line-color': tc.line,
              'line-width': ['interpolate', ['linear'], ['zoom'], 2, tc.lw * 0.5, 6, tc.lw, 10, tc.lw * 1.5],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 0.0],
              'line-blur': 0.5,
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          });
        } catch (e) {}
      }
    };

    const removeLayers = () => {
      for (const lid of ALL_LAYERS) {
        if (mapInstance.getLayer(lid)) {
          try { mapInstance.removeLayer(lid); } catch (e) {}
        }
      }
      if (mapInstance.getSource(MASK_SOURCE)) {
        try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
      }
    };

    if (active && maskData) {
      addLayers();
    } else {
      removeLayers();
    }

    // Cleanup on unmount
    return () => {
      removeLayers();
    };
  }, [mapInstance, active, theme, maskData]);

  return null;
}

export default OceanMask;
