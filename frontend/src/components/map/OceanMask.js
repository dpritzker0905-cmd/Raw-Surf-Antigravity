/**
 * OceanMask v13 — Pure Data Mask + Static Layer Generator
 *
 * FCE Architecture: OceanMask is a PASSIVE renderer.
 * It ONLY:
 *   1. Loads Natural Earth land GeoJSON (progressive: 50m → 10m)
 *   2. Generates a land mask for the SimulationField
 *   3. Adds/removes static visual layers
 *
 * RULE: This component cannot make stacking decisions.
 */

/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';
import { getSharedLandGeoJSON } from './WebGLMarineLayer';
import { safeSetPaintProperty } from './mapUtils';

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

export function OceanMask({ mapInstance, active: propActive, activeMarineLayer, theme, activeLayers = [] }) {
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
      try {
        const geojson = await getSharedLandGeoJSON();
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Land GeoJSON loaded and conformed (' + geojson.features.length + ' features)');
        }
      } catch (e) {
        console.error('[OceanMask] All land GeoJSON load attempts failed', e);
        fetchedRef.current = false;
      }
    };
    loadLand();
  }, []);

  // ================================================================
  // PHASE 2: Add/Remove STATIC visual layers (NO ordering logic)
  // ================================================================
  useEffect(() => {
    if (!mapInstance || typeof mapInstance.getLayer !== 'function') return;

    /**
     * Find the first base-map layer that should render ABOVE the land fill.
     * This includes landuse (parks, green areas), POIs, roads, labels.
     * Returns null if no suitable layer found (layers go on top).
     *
     * NOTE: This is a ONE-TIME lookup for initial layer placement.
     * It is NOT reactive re-ordering — it does not listen to styledata
     * or re-run when the style changes. This is architecturally safe.
     */
    const findInsertionPoint = () => {
      try {
        if (typeof mapInstance.getStyle !== 'function') return null;
        const style = mapInstance.getStyle();
        if (!style?.layers?.length) return null;

        // Find the index of the 'water' layer
        let waterIndex = -1;
        for (let i = 0; i < style.layers.length; i++) {
          if (style.layers[i].id === 'water') {
            waterIndex = i;
            break;
          }
        }

        if (waterIndex !== -1) {
          // Find the first layer after 'water' that is a land feature, road, label, etc.
          for (let i = waterIndex + 1; i < style.layers.length; i++) {
            const layer = style.layers[i];
            const id = layer.id;
            // Skip our own layers
            if (id.startsWith('ocean-mask-') || id.endsWith('-layer') || id.endsWith('-source')) continue;
            // Skip other water-related features if they happen to be grouped
            if (id === 'water-depth' || id === 'wetland' || id.includes('waterway')) continue;

            console.log(`[OceanMask] Insertion point (above water): BEFORE '${id}'`);
            return id;
          }
        }

        // Fallback: insert BEFORE the first landuse/park/landcover/building layer
        for (const layer of style.layers) {
          const id = layer.id;
          // Skip our own layers and react-map-gl layers
          if (id.startsWith('ocean-mask-') || id.endsWith('-layer') || id.endsWith('-source')) continue;
          if (id === 'background' || id === 'water' || id === 'water-depth' || id === 'wetland') continue;

          if (id.includes('landuse') || id.includes('park') || id.includes('landcover') ||
              id.includes('national') || id.includes('land-structure') ||
              id.includes('building') || id.includes('poi') ||
              layer.type === 'symbol') {
            console.log(`[OceanMask] Fallback insertion: BEFORE '${id}'`);
            return id;
          }
        }

        // Fallback: insert BEFORE the first symbol layer (labels should always be on top)
        for (const layer of style.layers) {
          if (layer.type === 'symbol' && !layer.id.startsWith('ocean-mask-')) {
            console.log(`[OceanMask] Fallback insertion: BEFORE symbol '${layer.id}'`);
            return layer.id;
          }
        }

        console.warn('[OceanMask] No insertion point found — mask will be added at TOP (may occlude features)');
      } catch (e) {
        console.warn('[OceanMask] findInsertionPoint error:', e);
      }
      return null;
    };

    const addLayers = () => {
      if (!maskData || !active) return;
      if (!mapInstance || typeof mapInstance.getStyle !== 'function' || typeof mapInstance.getLayer !== 'function') return;

      const isMarineActive = !!activeMarineLayer;
      console.log(`[OceanMask-Forensic] addLayers: theme=${theme}, isSatellite=${activeLayers.includes('satellite')}, isMarineActive=${isMarineActive}`);

      let style;
      try {
        style = mapInstance.getStyle();
        if (!style) return;
      } catch (e) { return; }

      const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
      const { waterSource, waterSourceLayer, waterColor, waterwaySource, waterwaySourceLayer, waterwayColor } = resolveWaterSources(style);

      // One-time insertion point: BELOW parks/landuse, ABOVE water
      const insertBefore = findInsertionPoint();

      // Source
      if (typeof mapInstance.getSource === 'function' && !mapInstance.getSource(MASK_SOURCE)) {
        try {
          if (typeof mapInstance.addSource === 'function') {
            mapInstance.addSource(MASK_SOURCE, { type: 'geojson', data: maskData, tolerance: 0.375 });
          }
        } catch (e) {}
      } else {
        try { if (typeof mapInstance.getSource === 'function') mapInstance.getSource(MASK_SOURCE)?.setData(maskData); } catch (e) {}
      }

      const isSatellite = activeLayers.includes('satellite');
      const fillOpacity = 0.0; // Force transparent to expose all native high-res land cover and parks
      const lineOpacity = isSatellite ? 0.0 : 1.0;

      // 1. Coastline buffer (ocean-colored vignette) — inserted BELOW parks
      if (typeof mapInstance.addLayer === 'function' && !mapInstance.getLayer(MASK_BUFFER)) {
        try {
          console.log(`[OceanMask-Forensic] Adding layer ${MASK_BUFFER}`);
          mapInstance.addLayer({
            id: MASK_BUFFER, type: 'line', source: MASK_SOURCE,
            paint: {
              'line-color': tc.ocean,
              'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 1, 4, 3, 6, 5, 8, 7, 6, 9, 4, 14, 1],
              'line-offset': ['interpolate', ['linear'], ['zoom'], 1, 2, 5, 3, 9, 2, 14, 0],
              'line-opacity': (isSatellite || isMarineActive) ? 0.0 : ['interpolate', ['linear'], ['zoom'], 2, 0.5, 5, 0.4, 9, 0.3, 14, 0.0],
              'line-blur': ['interpolate', ['linear'], ['zoom'], 2, 1.5, 7, 1.0, 9, 0.5, 14, 0.0],
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          }, insertBefore);
        } catch (e) {}
      } else if (typeof mapInstance.setPaintProperty === 'function' && mapInstance.getLayer(MASK_BUFFER)) {
        try {
          safeSetPaintProperty(mapInstance, MASK_BUFFER, 'line-color', tc.ocean);
          safeSetPaintProperty(mapInstance, MASK_BUFFER, 'line-opacity', (isSatellite || isMarineActive) ? 0.0 : ['interpolate', ['linear'], ['zoom'], 2, 0.5, 5, 0.4, 9, 0.3, 14, 0.0]);
        } catch (e) {}
      }

      // 2. Solid land fill — inserted BELOW parks so they render on top
      if (typeof mapInstance.addLayer === 'function' && !mapInstance.getLayer(MASK_FILL)) {
        try {
          console.log(`[OceanMask-Forensic] Adding layer ${MASK_FILL}`);
          mapInstance.addLayer({
            id: MASK_FILL, type: 'fill', source: MASK_SOURCE,
            paint: { 'fill-color': tc.fill, 'fill-opacity': fillOpacity },
          }, insertBefore);
        } catch (e) {}
      } else if (typeof mapInstance.setPaintProperty === 'function' && mapInstance.getLayer(MASK_FILL)) {
        try {
          safeSetPaintProperty(mapInstance, MASK_FILL, 'fill-color', tc.fill);
          safeSetPaintProperty(mapInstance, MASK_FILL, 'fill-opacity', fillOpacity);
        } catch (e) {}
      }

      // 3. Inland water (lakes) — ABOVE fill to punch through, but BELOW roads/bridges
      if (typeof mapInstance.addLayer === 'function' && !mapInstance.getLayer(MASK_INLAND_WATER)) {
        try {
          console.log(`[OceanMask-Forensic] Adding layer ${MASK_INLAND_WATER}`);
          mapInstance.addLayer({
            id: MASK_INLAND_WATER, type: 'fill', source: waterSource, 'source-layer': waterSourceLayer,
            filter: inlandWaterFilter,
            paint: { 'fill-color': waterColor, 'fill-opacity': isSatellite ? 0.0 : 1.0 },
          }, insertBefore);
        } catch (e) {}
      } else if (typeof mapInstance.setPaintProperty === 'function' && mapInstance.getLayer(MASK_INLAND_WATER)) {
        try {
          safeSetPaintProperty(mapInstance, MASK_INLAND_WATER, 'fill-color', waterColor);
          safeSetPaintProperty(mapInstance, MASK_INLAND_WATER, 'fill-opacity', isSatellite ? 0.0 : 1.0);
        } catch (e) {}
      }

      // 4. Waterways (rivers) — BELOW roads/bridges
      if (typeof mapInstance.addLayer === 'function' && !mapInstance.getLayer(MASK_INLAND_WATERWAY)) {
        try {
          console.log(`[OceanMask-Forensic] Adding layer ${MASK_INLAND_WATERWAY}`);
          mapInstance.addLayer({
            id: MASK_INLAND_WATERWAY, type: 'line', source: waterwaySource, 'source-layer': waterwaySourceLayer,
            paint: {
              'line-color': waterwayColor,
              'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 13, 1.5, 18, 6],
              'line-opacity': isSatellite ? 0.0 : 1.0,
            },
          }, insertBefore);
        } catch (e) {}
      } else if (typeof mapInstance.setPaintProperty === 'function' && mapInstance.getLayer(MASK_INLAND_WATERWAY)) {
        try {
          safeSetPaintProperty(mapInstance, MASK_INLAND_WATERWAY, 'line-color', waterwayColor);
          safeSetPaintProperty(mapInstance, MASK_INLAND_WATERWAY, 'line-opacity', isSatellite ? 0.0 : 1.0);
        } catch (e) {}
      }

      // 5. Coastline outline — BELOW roads/bridges
      if (typeof mapInstance.addLayer === 'function' && !mapInstance.getLayer(MASK_LINE)) {
        try {
          console.log(`[OceanMask-Forensic] Adding layer ${MASK_LINE}`);
          mapInstance.addLayer({
            id: MASK_LINE, type: 'line', source: MASK_SOURCE,
            paint: {
              'line-color': tc.line,
              'line-width': ['interpolate', ['linear'], ['zoom'], 2, tc.lw * 0.5, 6, tc.lw, 10, tc.lw * 1.5],
              'line-opacity': isSatellite ? 0.0 : ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 0.0],
              'line-blur': 0.5,
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          }, insertBefore);
        } catch (e) {}
      } else if (typeof mapInstance.setPaintProperty === 'function' && mapInstance.getLayer(MASK_LINE)) {
        try {
          safeSetPaintProperty(mapInstance, MASK_LINE, 'line-opacity', isSatellite ? 0.0 : ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 0.0]);
        } catch (e) {}
      }
    };

    const removeLayers = () => {
      if (!mapInstance || typeof mapInstance.getLayer !== 'function') return;
      console.log('[OceanMask-Forensic] removeLayers: Removing all custom layers');
      for (const lid of ALL_LAYERS) {
        try {
          if (mapInstance.getLayer(lid)) {
            if (typeof mapInstance.removeLayer === 'function') {
              mapInstance.removeLayer(lid);
            }
          }
        } catch (e) {}
      }
      try {
        if (typeof mapInstance.getSource === 'function' && mapInstance.getSource(MASK_SOURCE)) {
          if (typeof mapInstance.removeSource === 'function') {
            mapInstance.removeSource(MASK_SOURCE);
          }
        }
      } catch (e) {}
    };

    const handleStyleData = () => {
      if (active && maskData) {
        addLayers();
      }
    };

    if (mapInstance) {
      mapInstance.on('styledata', handleStyleData);
      mapInstance.on('style.load', handleStyleData);
    }

    if (active && maskData) {
      addLayers();
    } else {
      removeLayers();
    }

    // Cleanup on unmount
    return () => {
      if (mapInstance) {
        mapInstance.off('styledata', handleStyleData);
        mapInstance.off('style.load', handleStyleData);
      }
      removeLayers();
    };
  }, [mapInstance, active, theme, maskData, activeLayers]);

  return null;
}

export default OceanMask;
