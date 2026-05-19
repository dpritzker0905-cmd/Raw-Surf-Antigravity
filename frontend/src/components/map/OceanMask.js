import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

/**
 * OceanMask v3 — Hybrid coastline clipping for marine rasters.
 *
 * Architecture: Two-tier masking system:
 *   1. PRIMARY: Natural Earth 10m land polygons (jsDelivr CDN, ~4.6MB)
 *      — covers 95%+ of global coastlines with high detail
 *   2. SUPPLEMENTARY: Mapbox `composite` vector tile layers (landuse/landcover)
 *      — adds coverage for barrier islands, narrow peninsulas, and other
 *        features missing from NE 10m at high zoom levels
 *
 * Both layers paint land areas with the map background color, positioned
 * ABOVE marine rasters but BELOW roads/labels/buildings.
 */

// Natural Earth 10m land polygons via jsDelivr CDN
const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

const MASK_SOURCE_ID  = 'ocean-mask-source';
const MASK_LAYER_ID   = 'ocean-mask-layer';
const SUPP_LAYER_PREFIX = 'ocean-mask-supp';

// Theme-aware land fill colors (must EXACTLY match base map background)
const LAND_COLORS = {
  dark:  'hsl(214, 17%, 31%)',   // Navigation Night background
  light: 'hsl(0, 0%, 100%)',     // Navigation Day background
  beach: 'hsl(31, 24%, 91%)',    // Outdoors background
};

/**
 * Supplementary vector-tile layers from the Mapbox `composite` source.
 * These cover land features that NE 10m misses (barrier islands, parks,
 * airports, buildings). Each entry creates a fill layer painted with
 * the background color, positioned alongside the primary NE 10m mask.
 */
const SUPP_LAYERS = [
  { id: `${SUPP_LAYER_PREFIX}-landuse`,    sourceLayer: 'landuse',    minzoom: 5 },
  { id: `${SUPP_LAYER_PREFIX}-landcover`,  sourceLayer: 'landcover',  minzoom: 0, maxzoom: 8 },
  { id: `${SUPP_LAYER_PREFIX}-building`,   sourceLayer: 'building',   minzoom: 13 },
];

/**
 * Build a GeoJSON FeatureCollection from NE 10m land polygons.
 * Returns raw land features — no inversion needed.
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
 * Target: after marine rasters, before land-structure/roads/labels.
 */
function findInsertionPoint(style) {
  const layers = style?.layers || [];
  for (const l of layers) {
    if (['land-structure-polygon', 'land-structure-line',
         'building-outline', 'building'].includes(l.id) ||
        l.id.startsWith('tunnel-') || l.id.startsWith('road-')) {
      return l.id;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  React component                                                    */
/* ------------------------------------------------------------------ */

export function OceanMask({ mapInstance, active, theme }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef   = useRef(false);
  const layerAddedRef = useRef(false);
  const suppAddedRef  = useRef(false);

  // ─── Fetch NE 10m land polygons once ───
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
        if (mask) setMaskData(mask);
      })
      .catch(err => {
        console.warn('[OceanMask] Failed to fetch land polygons:', err);
        fetchedRef.current = false; // Allow retry
      });
  }, []);

  // ─── Resolve fill color from active style or theme fallback ───
  const fillColor = useMemo(() => {
    if (mapInstance) {
      try {
        const style = mapInstance.getStyle?.();
        const bg = style?.layers?.find(l => l.type === 'background');
        if (bg?.paint?.['background-color']) return bg.paint['background-color'];
      } catch (e) { /* style not ready */ }
    }
    return LAND_COLORS[theme] || LAND_COLORS.dark;
  }, [mapInstance, theme]);

  // ─── Sync supplementary vector-tile layers ───
  const syncSuppLayers = useCallback((beforeId) => {
    if (!mapInstance) return;

    if (active) {
      for (const cfg of SUPP_LAYERS) {
        if (mapInstance.getLayer(cfg.id)) {
          // Update color on existing layer
          try { mapInstance.setPaintProperty(cfg.id, 'fill-color', fillColor); }
          catch (e) { /* ok */ }
          continue;
        }
        try {
          mapInstance.addLayer({
            id: cfg.id,
            type: 'fill',
            source: 'composite',
            'source-layer': cfg.sourceLayer,
            minzoom: cfg.minzoom || 0,
            ...(cfg.maxzoom ? { maxzoom: cfg.maxzoom } : {}),
            paint: {
              'fill-color': fillColor,
              'fill-opacity': 1,
            },
          }, beforeId || undefined);
        } catch (e) {
          // Source layer might not exist in this style
        }
      }
      suppAddedRef.current = true;
    } else {
      for (const cfg of SUPP_LAYERS) {
        if (mapInstance.getLayer(cfg.id)) {
          try { mapInstance.removeLayer(cfg.id); } catch (e) { /* ok */ }
        }
      }
      suppAddedRef.current = false;
    }
  }, [mapInstance, active, fillColor]);

  // ─── Sync primary NE 10m mask layer ───
  const syncLayer = useCallback(() => {
    if (!mapInstance || !maskData) return;

    const style = mapInstance.getStyle?.();
    if (!style) return;

    const sourceExists = !!mapInstance.getSource(MASK_SOURCE_ID);
    const layerExists  = !!mapInstance.getLayer(MASK_LAYER_ID);
    const beforeId = findInsertionPoint(style);

    if (active) {
      if (!sourceExists) {
        mapInstance.addSource(MASK_SOURCE_ID, {
          type: 'geojson',
          data: maskData,
          tolerance: 0.375,
        });
      }

      if (!layerExists) {
        mapInstance.addLayer({
          id: MASK_LAYER_ID,
          type: 'fill',
          source: MASK_SOURCE_ID,
          paint: {
            'fill-color': fillColor,
            'fill-opacity': 1,
          },
        }, beforeId || undefined);
        layerAddedRef.current = true;
      } else {
        try { mapInstance.setPaintProperty(MASK_LAYER_ID, 'fill-color', fillColor); }
        catch (e) { /* transitioning */ }
      }

      // Add supplementary vector-tile layers
      syncSuppLayers(beforeId);
    } else {
      // Remove primary
      if (layerExists) {
        try { mapInstance.removeLayer(MASK_LAYER_ID); } catch (e) { /* ok */ }
        layerAddedRef.current = false;
      }
      if (sourceExists) {
        try { mapInstance.removeSource(MASK_SOURCE_ID); } catch (e) { /* ok */ }
      }
      // Remove supplementary
      syncSuppLayers(null);
    }
  }, [mapInstance, maskData, active, fillColor, syncSuppLayers]);

  // Run sync whenever dependencies change
  useEffect(() => { syncLayer(); }, [syncLayer]);

  // Re-sync on map style changes (theme switch causes full style reload)
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => setTimeout(syncLayer, 200);
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      try { mapInstance.removeLayer(MASK_LAYER_ID); } catch (e) { /* ok */ }
      try { mapInstance.removeSource(MASK_SOURCE_ID); } catch (e) { /* ok */ }
      for (const cfg of SUPP_LAYERS) {
        try { mapInstance.removeLayer(cfg.id); } catch (e) { /* ok */ }
      }
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
