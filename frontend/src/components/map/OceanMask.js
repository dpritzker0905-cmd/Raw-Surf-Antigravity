import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * OceanMask — Clips marine raster layers to ocean boundaries.
 *
 * Architecture: Uses Natural Earth 50m land polygons to create an inverted
 * mask (world minus land = ocean). Rendered as a MapLibre `fill` layer
 * positioned ABOVE marine raster tiles, painting land areas with the map
 * background color. This makes marine raster data appear only over ocean.
 *
 * Why not om-marine:// protocol?
 *   MapLibre's Web Worker tile pipeline can't serialize custom protocol
 *   wrappers via postMessage. Protocol-level clipping causes DataCloneError.
 *   This layer-based approach runs entirely in the GPU render pipeline.
 */

// Natural Earth 50m land polygons — good coastline detail without excessive size (~800KB)
const NE_LAND_URL = 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_land.geojson';

// World bounding box (outer ring for inverted polygon)
const WORLD_RING = [[-180, 90], [180, 90], [180, -90], [-180, -90], [-180, 90]];

const MASK_SOURCE_ID = 'ocean-mask-source';
const MASK_LAYER_ID = 'ocean-mask-layer';

// Theme-aware land fill colors (must match base map land tones)
const LAND_COLORS = {
  dark: '#1a1c20',   // Navigation Night land tone
  light: '#e8e0d8',  // Navigation Day land tone
  beach: '#e5ddd0',  // Outdoors land tone
};

/**
 * Build an inverted GeoJSON polygon: world exterior with land polygons as holes.
 * Result: a polygon that covers ONLY land areas (the inverse of ocean).
 */
function buildLandMask(landGeoJSON) {
  if (!landGeoJSON?.features?.length) return null;

  // Collect all land polygon rings as holes in the world polygon
  const polygons = [];
  for (const feature of landGeoJSON.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    if (geom.type === 'Polygon') {
      // Each polygon's outer ring becomes a hole
      polygons.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          // World ring as outer, land ring as inner (hole)
          coordinates: [WORLD_RING, ...geom.coordinates]
        },
        properties: {}
      });
    } else if (geom.type === 'MultiPolygon') {
      // Each sub-polygon becomes its own masked feature
      for (const poly of geom.coordinates) {
        polygons.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [WORLD_RING, ...poly]
          },
          properties: {}
        });
      }
    }
  }

  return { type: 'FeatureCollection', features: polygons };
}

/**
 * OceanMask component — adds/removes the land mask layer imperatively.
 *
 * Props:
 *   mapInstance  — raw MapLibre map object
 *   active       — whether any marine layer is currently active
 *   theme        — 'dark' | 'light' | 'beach'
 */
export function OceanMask({ mapInstance, active, theme }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const layerAddedRef = useRef(false);

  // Fetch land polygons once (cached across re-renders)
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

  // Resolve the fill color based on current theme
  const fillColor = LAND_COLORS[theme] || LAND_COLORS.dark;

  // Add/remove the mask layer imperatively when conditions change
  const syncLayer = useCallback(() => {
    if (!mapInstance || !maskData) return;

    const style = mapInstance.getStyle?.();
    if (!style) return;

    const sourceExists = !!mapInstance.getSource(MASK_SOURCE_ID);
    const layerExists = !!mapInstance.getLayer(MASK_LAYER_ID);

    if (active) {
      // Ensure source exists
      if (!sourceExists) {
        mapInstance.addSource(MASK_SOURCE_ID, {
          type: 'geojson',
          data: maskData
        });
      }

      // Ensure layer exists
      if (!layerExists) {
        // v85: Position the mask AFTER marine rasters but BEFORE land-structure.
        // In vector styles: water → [marine rasters] → [THIS MASK] → land-structure → roads → labels
        // The mask covers marine raster bleed on land. Roads/labels render ON TOP.
        const layers = style.layers || [];
        let beforeId = null;
        // Find the first layer after water that's part of the land/road/label stack
        for (const l of layers) {
          if (l.id === 'land-structure-polygon' || l.id === 'land-structure-line' ||
              l.id === 'building-outline' || l.id === 'building' ||
              l.id.startsWith('tunnel-') || l.id.startsWith('road-')) {
            beforeId = l.id;
            break;
          }
        }

        mapInstance.addLayer({
          id: MASK_LAYER_ID,
          type: 'fill',
          source: MASK_SOURCE_ID,
          paint: {
            'fill-color': fillColor,
            'fill-opacity': 1,
          }
        }, beforeId || undefined);

        layerAddedRef.current = true;
      } else {
        // Update paint if theme changed
        try {
          mapInstance.setPaintProperty(MASK_LAYER_ID, 'fill-color', fillColor);
        } catch (e) { /* layer may be transitioning */ }
      }
    } else {
      // Remove the layer when no marine layer is active
      if (layerExists) {
        try { mapInstance.removeLayer(MASK_LAYER_ID); } catch (e) { /* ok */ }
        layerAddedRef.current = false;
      }
      if (sourceExists) {
        try { mapInstance.removeSource(MASK_SOURCE_ID); } catch (e) { /* ok */ }
      }
    }
  }, [mapInstance, maskData, active, fillColor]);

  // Run sync whenever dependencies change
  useEffect(() => {
    syncLayer();
  }, [syncLayer]);

  // Also sync on map style changes (theme switch causes full style reload)
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => {
      // Small delay to let the new style fully load
      setTimeout(syncLayer, 200);
    };
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      try { mapInstance.removeLayer(MASK_LAYER_ID); } catch (e) { /* ok */ }
      try { mapInstance.removeSource(MASK_SOURCE_ID); } catch (e) { /* ok */ }
    };
  }, [mapInstance]);

  return null; // Imperative-only, no JSX
}

export default OceanMask;
