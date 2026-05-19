import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

/**
 * OceanMask v4 — Hybrid pixel-clipping + polygon backup coastline masking.
 *
 * Architecture (v86 two-tier):
 *   1. PRIMARY: om-marine:// protocol pixel-level clipping (in MapWebGL.js)
 *      — NE 10m land polygons clip each raster tile in the OM worker pipeline
 *      — eliminates blocky GFS grid-cell bleed at coastlines
 *      — only applied to marine layers (waves, swell, wind_waves)
 *
 *   2. BACKUP (this component): NE 10m land polygon fill layer
 *      — covers any residual bleed from pixels not caught by tile clipping
 *      — positioned ABOVE marine rasters, BELOW roads/labels
 *      — dynamically syncs fill color with map background
 *
 * Note: The NE 10m data is fetched ONCE and shared between both tiers
 * (the protocol fetches its own copy; this component fetches independently).
 */

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

const MASK_SOURCE_ID = 'ocean-mask-source';
const MASK_LAYER_ID  = 'ocean-mask-layer';

// Theme-aware land fill colors (must EXACTLY match base map background)
const LAND_COLORS = {
  dark:  'hsl(214, 17%, 31%)',
  light: 'hsl(0, 0%, 100%)',
  beach: 'hsl(31, 24%, 91%)',
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

export function OceanMask({ mapInstance, active, theme }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef    = useRef(false);
  const layerAddedRef = useRef(false);

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
        if (mask) setMaskData(mask);
      })
      .catch(err => {
        console.warn('[OceanMask] Failed to fetch land polygons:', err);
        fetchedRef.current = false;
      });
  }, []);

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

  // Add/remove the mask layer
  const syncLayer = useCallback(() => {
    if (!mapInstance || !maskData) return;
    const style = mapInstance.getStyle?.();
    if (!style) return;

    const sourceExists = !!mapInstance.getSource(MASK_SOURCE_ID);
    const layerExists  = !!mapInstance.getLayer(MASK_LAYER_ID);

    if (active) {
      if (!sourceExists) {
        mapInstance.addSource(MASK_SOURCE_ID, {
          type: 'geojson',
          data: maskData,
          tolerance: 0.375,
        });
      }

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
          paint: { 'fill-color': fillColor, 'fill-opacity': 1 },
        }, beforeId || undefined);
        layerAddedRef.current = true;
      } else {
        try { mapInstance.setPaintProperty(MASK_LAYER_ID, 'fill-color', fillColor); }
        catch (e) { /* transitioning */ }
      }
    } else {
      if (layerExists) {
        try { mapInstance.removeLayer(MASK_LAYER_ID); } catch (e) { /* ok */ }
        layerAddedRef.current = false;
      }
      if (sourceExists) {
        try { mapInstance.removeSource(MASK_SOURCE_ID); } catch (e) { /* ok */ }
      }
    }
  }, [mapInstance, maskData, active, fillColor]);

  useEffect(() => { syncLayer(); }, [syncLayer]);

  // Re-sync on style changes (theme switch)
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => setTimeout(syncLayer, 200);
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayer]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      try { mapInstance.removeLayer(MASK_LAYER_ID); } catch (e) { /* ok */ }
      try { mapInstance.removeSource(MASK_SOURCE_ID); } catch (e) { /* ok */ }
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
