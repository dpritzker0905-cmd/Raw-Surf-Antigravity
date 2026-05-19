import { useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * OceanMask v2 — Dynamic vector-tile coastline clipping for marine rasters.
 *
 * Architecture: Extracts water polygons from the Mapbox `composite` vector
 * tile source (OSM-resolution coastlines), then builds an inverted mask:
 * a world-covering polygon with water areas punched out as holes.
 * Rendered as a MapLibre `fill` layer positioned ABOVE marine rasters,
 * painting LAND with the map background color while leaving ocean transparent.
 *
 * v86: Replaces static NE 10m GeoJSON approach. Dynamic extraction gives
 * barrier islands, narrow peninsulas, lagoons, and other features that
 * Natural Earth 10m data omits.
 */

const MASK_SOURCE_ID = 'ocean-mask-source';
const MASK_LAYER_ID  = 'ocean-mask-layer';

// Performance caps
const MAX_RINGS       = 600;
const REBUILD_DELAY   = 200;  // ms debounce on moveend
const SETTLE_DELAY    = 800;  // ms wait for tiles to finish loading

// World-covering outer ring (counterclockwise per RFC 7946)
const WORLD_RING = [
  [-180.1, -85.1], [180.1, -85.1], [180.1, 85.1], [-180.1, 85.1], [-180.1, -85.1]
];

// Theme-aware land fill colors (must match base map background exactly)
const LAND_COLORS = {
  dark:  'hsl(214, 17%, 31%)',   // Navigation Night
  light: 'hsl(0, 0%, 100%)',     // Navigation Day
  beach: 'hsl(31, 24%, 91%)',    // Outdoors
};

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Compute signed area of a ring using the shoelace formula.
 * Positive = clockwise in lon/lat space, Negative = counterclockwise.
 */
function signedArea(ring) {
  let area = 0;
  for (let i = 0, len = ring.length - 1; i < len; i++) {
    area += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
  }
  return area;
}

/** Ensure a ring winds clockwise (GeoJSON hole convention). */
function ensureClockwise(ring) {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}

/**
 * Extract water polygon outer rings from the Mapbox `composite` vector
 * tile source. Returns clockwise-wound rings for use as polygon holes.
 */
function extractWaterRings(mapInstance) {
  let features;
  try {
    features = mapInstance.querySourceFeatures('composite', {
      sourceLayer: 'water',
    });
  } catch (e) {
    return [];
  }
  if (!features?.length) return [];

  const rings = [];
  for (const f of features) {
    if (rings.length >= MAX_RINGS) break;
    const geom = f.geometry;
    if (!geom) continue;

    if (geom.type === 'Polygon') {
      const outer = geom.coordinates[0];
      if (outer?.length >= 4) rings.push(ensureClockwise(outer));
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (rings.length >= MAX_RINGS) break;
        const outer = poly[0];
        if (outer?.length >= 4) rings.push(ensureClockwise(outer));
      }
    }
  }
  return rings;
}

/**
 * Build an inverted mask GeoJSON: world polygon with water holes.
 * Result: fills LAND (world minus water) with background color,
 * leaving ocean areas transparent so marine rasters show through.
 */
function buildInvertedMask(waterRings) {
  if (!waterRings.length) return null;

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [WORLD_RING, ...waterRings],
      },
    }],
  };
}

/* ------------------------------------------------------------------ */
/*  React component                                                    */
/* ------------------------------------------------------------------ */

/**
 * OceanMask component — imperative layer management for the land mask.
 *
 * Props:
 *   mapInstance  — raw MapLibre map object
 *   active       — whether any marine layer is currently active
 *   theme        — 'dark' | 'light' | 'beach'
 */
export function OceanMask({ mapInstance, active, theme }) {
  const layerAddedRef   = useRef(false);
  const rebuildTimerRef = useRef(null);
  const settleTimerRef  = useRef(null);

  // Resolve fill color from active style or theme fallback
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

  // Rebuild the mask from current vector tile water features
  const rebuildMask = useCallback(() => {
    if (!mapInstance || !active) return;
    try {
      const source = mapInstance.getSource(MASK_SOURCE_ID);
      if (!source) return;

      const rings = extractWaterRings(mapInstance);
      const mask = buildInvertedMask(rings);
      if (mask) {
        source.setData(mask);
      }
    } catch (e) {
      console.warn('[OceanMask] Rebuild error:', e);
    }
  }, [mapInstance, active]);

  // Debounced rebuild for viewport changes
  const debouncedRebuild = useCallback(() => {
    clearTimeout(rebuildTimerRef.current);
    rebuildTimerRef.current = setTimeout(rebuildMask, REBUILD_DELAY);
  }, [rebuildMask]);

  // Add or remove the mask layer
  const syncLayer = useCallback(() => {
    if (!mapInstance) return;
    const style = mapInstance.getStyle?.();
    if (!style) return;

    const sourceExists = !!mapInstance.getSource(MASK_SOURCE_ID);
    const layerExists  = !!mapInstance.getLayer(MASK_LAYER_ID);

    if (active) {
      // Ensure source exists
      if (!sourceExists) {
        mapInstance.addSource(MASK_SOURCE_ID, {
          type: 'geojson',
          data: EMPTY_FC,
        });
      }

      // Ensure layer exists
      if (!layerExists) {
        // Position: AFTER marine rasters, BEFORE land-structure/roads/labels
        const layers = style.layers || [];
        let beforeId = null;
        for (const l of layers) {
          if (['land-structure-polygon', 'land-structure-line',
               'building-outline', 'building'].includes(l.id) ||
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
          },
        }, beforeId || undefined);

        layerAddedRef.current = true;
      } else {
        // Update paint if theme changed
        try {
          mapInstance.setPaintProperty(MASK_LAYER_ID, 'fill-color', fillColor);
        } catch (e) { /* layer may be transitioning */ }
      }

      // Build mask immediately, then again after tiles settle
      rebuildMask();
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(rebuildMask, SETTLE_DELAY);
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
  }, [mapInstance, active, fillColor, rebuildMask]);

  // Run sync whenever dependencies change
  useEffect(() => {
    syncLayer();
  }, [syncLayer]);

  // Rebuild mask on viewport changes and tile loads
  useEffect(() => {
    if (!mapInstance || !active) return;

    mapInstance.on('moveend', debouncedRebuild);
    mapInstance.on('idle', rebuildMask);

    return () => {
      mapInstance.off('moveend', debouncedRebuild);
      mapInstance.off('idle', rebuildMask);
      clearTimeout(rebuildTimerRef.current);
      clearTimeout(settleTimerRef.current);
    };
  }, [mapInstance, active, debouncedRebuild, rebuildMask]);

  // Re-sync on style changes (theme switch causes full style reload)
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
