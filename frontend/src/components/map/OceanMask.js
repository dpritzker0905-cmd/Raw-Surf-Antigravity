/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * OceanMask v10 — Coastline masking with outward-shifted buffer.
 *
 * Layer stack (bottom → top):
 *   [water]               ← Mapbox base
 *   [marine rasters]      ← OM wave/swell tiles (forced below MASK_BUFFER)
 *   ocean-mask-buffer     ← WIDE line shifted outward from land (covers GFS bleed)
 *   ocean-mask-fill       ← NE 10m land fill (solid coverage)
 *   [landuse/parks]       ← Moved above MASK_FILL but below lakes/rivers for visibility
 *   ocean-mask-inland-water ← Bring high-resolution lakes back on top of landuse/parks
 *   ocean-mask-inland-waterway ← Bring high-resolution rivers back on top of landuse/parks
 *   ocean-mask-line       ← Thin coastline outline (aesthetic)
 *   [roads/labels]        ← Mapbox base
 */

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

const MASK_SOURCE = 'ocean-mask-source';
const MASK_BUFFER = 'ocean-mask-buffer';
const MASK_FILL   = 'ocean-mask-fill';
const MASK_LINE   = 'ocean-mask-line';
const MASK_INLAND_WATERWAY = 'ocean-mask-inland-waterway';
const MASK_INLAND_WATER = 'ocean-mask-inland-water';
const ALL_LAYERS  = [MASK_LINE, MASK_FILL, MASK_BUFFER, MASK_INLAND_WATERWAY, MASK_INLAND_WATER];

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
  const layers = style?.layers || [];
  const waterIdx = layers.findIndex(l => l.id === 'water' || l.id === 'water-depth' || l.id === 'wetland');
  const startIndex = waterIdx !== -1 ? waterIdx + 1 : 0;
  for (let i = startIndex; i < layers.length; i++) {
    const l = layers[i];
    if (['landuse', 'national-park', 'park', 'natural', 'wood', 'glacier', 'sand', 'pitch',
         'land-structure-polygon', 'land-structure-line',
         'building-outline', 'building'].includes(l.id) ||
        l.id.startsWith('tunnel-') || l.id.startsWith('road-') || l.id.startsWith('landuse')) {
      return l.id;
    }
  }
  return null;
}

function resolveFillColor(mapInstance, theme) {
  const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
  return tc.fill;
}

export function OceanMask({ mapInstance, active, theme, beforeId }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // Fetch land mask
    fetch(NE_LAND_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(geojson => {
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Loaded NE 10m land:', geojson.features.length, 'land features');
        }
      })
      .catch(err => { console.warn('[OceanMask] Land fetch failed:', err); fetchedRef.current = false; });
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
      const hasWaterway = !!mapInstance.getLayer(MASK_INLAND_WATERWAY);
      const hasWater = !!mapInstance.getLayer(MASK_INLAND_WATER);
      const hasSrc  = !!mapInstance.getSource(MASK_SOURCE);

      if (active) {
        if (!hasSrc) {
          try {
            mapInstance.addSource(MASK_SOURCE, {
              type: 'geojson', data: maskData, tolerance: 0.375,
            });
          } catch (e) {
            console.error('[OceanMask] Failed to add source:', e);
          }
        }

        const insertBeforeId = beforeId || findInsertBefore(style);
        const fillColor = resolveFillColor(mapInstance, theme);

        // Layer 1: WIDE coastline buffer with outward shift.
        // GFS marine tiles bleed 1-3 grid cells (~28-84km) past coastlines.
        // Shrink the width of MASK_BUFFER at mid-to-high zoom levels to prevent it from invading coastal waters.
        // Use soft blur for a clean, premium transition where water meets the edge of land.
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: MASK_SOURCE,
              paint: {
                'line-color': fillColor,
                'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                  1, 10,
                  3, 16,
                  5, 22,
                  7, 22,
                  9, 20,
                  14, 2,
                ],
                // Shift the buffer line outward into the ocean to cover GFS tile bleed
                // (GFS grid ~25km resolution bleeds 1-3 cells past actual coastline)
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, 5,
                  5, 9,
                  9, 12,
                  14, 0,
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  9, 1.0,
                  14, 0.0
                ],
                'line-blur': ['interpolate', ['linear'], ['zoom'],
                  2, 2.0,
                  7, 1.5,
                  9, 1.0,
                  14, 0.0
                ],
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_BUFFER:', e);
          }
        } else {
          try {
            if (insertBeforeId) mapInstance.moveLayer(MASK_BUFFER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', fillColor);
          } catch (e) {}
        }

        // Layer 2: NE 10m land fill
        if (!hasFill) {
          try {
            mapInstance.addLayer({
              id: MASK_FILL,
              type: 'fill',
              source: MASK_SOURCE,
              paint: { 'fill-color': fillColor, 'fill-opacity': 1 },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_FILL:', e);
          }
        } else {
          try {
            if (insertBeforeId) mapInstance.moveLayer(MASK_FILL, insertBeforeId);
            mapInstance.setPaintProperty(MASK_FILL, 'fill-color', fillColor);
          } catch (e) {}
        }

        // Layer 3: Bring high-resolution inland water (lakes/reservoirs) back to top
        // Dynamically resolve source and source-layer from base style's 'water' layer
        let waterSource = 'composite';
        let waterSourceLayer = 'water';
        let waterColor = 'hsl(197, 60%, 80%)';
        try {
          const baseWater = style?.layers?.find(l => l.id === 'water' || l.id === 'water-depth' || l.id === 'wetland');
          if (baseWater) {
            if (baseWater.source) waterSource = baseWater.source;
            if (baseWater['source-layer']) waterSourceLayer = baseWater['source-layer'];
            if (baseWater.paint?.['fill-color']) waterColor = baseWater.paint['fill-color'];
          }
        } catch (e) {}

        if (!hasWater) {
          try {
            mapInstance.addLayer({
              id: MASK_INLAND_WATER,
              type: 'fill',
              source: waterSource,
              'source-layer': waterSourceLayer,
              filter: ['all', ['!=', ['get', 'class'], 'ocean'], ['!=', ['get', 'class'], 'sea']],
              paint: {
                'fill-color': waterColor,
                'fill-opacity': 1.0
              }
            }, insertBeforeId || undefined);
          } catch (e) {
            console.warn('[OceanMask] Failed to add MASK_INLAND_WATER:', e);
          }
        } else {
          try {
            if (insertBeforeId) mapInstance.moveLayer(MASK_INLAND_WATER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATER, 'fill-color', waterColor);
          } catch (e) {}
        }

        // Layer 4: Bring high-resolution waterways (rivers/streams as lines) back to top
        // Dynamically resolve source and source-layer from base style's 'waterway' layer
        let waterwaySource = 'composite';
        let waterwaySourceLayer = 'waterway';
        let waterwayColor = 'hsl(197, 15%, 43%)';
        try {
          const baseWaterway = style?.layers?.find(l => l.id === 'waterway' || l.id.includes('waterway'));
          if (baseWaterway) {
            if (baseWaterway.source) waterwaySource = baseWaterway.source;
            if (baseWaterway['source-layer']) waterwaySourceLayer = baseWaterway['source-layer'];
            if (baseWaterway.paint?.['line-color']) waterwayColor = baseWaterway.paint['line-color'];
          }
        } catch (e) {}

        if (!hasWaterway) {
          try {
            mapInstance.addLayer({
              id: MASK_INLAND_WATERWAY,
              type: 'line',
              source: waterwaySource,
              'source-layer': waterwaySourceLayer,
              paint: {
                'line-color': waterwayColor,
                'line-width': ['interpolate', ['linear'], ['zoom'],
                  8, 0.5,
                  13, 1.5,
                  18, 6
                ],
                'line-opacity': 1.0
              }
            }, insertBeforeId || undefined);
          } catch (e) {
            console.warn('[OceanMask] Failed to add MASK_INLAND_WATERWAY:', e);
          }
        } else {
          try {
            if (insertBeforeId) mapInstance.moveLayer(MASK_INLAND_WATERWAY, insertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATERWAY, 'line-color', waterwayColor);
          } catch (e) {}
        }

        // Layer 5: Thin coastline outline — aesthetic boundary
        if (!hasLine) {
          try {
            mapInstance.addLayer({
              id: MASK_LINE,
              type: 'line',
              source: MASK_SOURCE,
              paint: {
                'line-color': tc.line,
                'line-width': ['interpolate', ['linear'], ['zoom'],
                  2, tc.lw * 0.5, 6, tc.lw, 10, tc.lw * 1.5,
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  9, 0.8,
                  14, 0.0
                ],
                'line-blur': 0.5,
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_LINE:', e);
          }
        } else {
          try {
            if (insertBeforeId) mapInstance.moveLayer(MASK_LINE, insertBeforeId);
          } catch (e) {}
        }

        // v90: Strictly force active marine raster layers BELOW the MASK_BUFFER layer
        const marineLayers = ['waves-layer', 'swell_1-layer', 'swell_2-layer', 'wind_waves-layer'];
        for (const ml of marineLayers) {
          if (mapInstance.getLayer(ml) && mapInstance.getLayer(MASK_BUFFER)) {
            try {
              mapInstance.moveLayer(ml, MASK_BUFFER);
            } catch (e) {}
          }
        }

        // v90: Move vector land layers ABOVE MASK_FILL but BELOW MASK_INLAND_WATER/MASK_LINE to preserve visibility of parks/forests
        try {
          const targetBeforeId = mapInstance.getLayer(MASK_INLAND_WATER) ? MASK_INLAND_WATER : (mapInstance.getLayer(MASK_LINE) ? MASK_LINE : null);
          if (targetBeforeId) {
            const currentStyle = mapInstance.getStyle();
            if (currentStyle && currentStyle.layers) {
              const landusePatterns = [
                'landuse', 'national-park', 'landcover', 'park', 'natural', 'wood', 
                'glacier', 'sand', 'pitch', 'cemetery', 'hospital', 'school',
                'scrub', 'grass', 'crop', 'agriculture'
              ];
              for (const l of currentStyle.layers) {
                const id = l.id;
                const isLandFeature = landusePatterns.some(pat => id.toLowerCase().includes(pat));
                const isMaskLayer = ALL_LAYERS.includes(id);
                const isOutline = l.type === 'line' || id.toLowerCase().includes('outline') || id.toLowerCase().includes('border') || id.toLowerCase().includes('boundary') || id.toLowerCase().includes('line');
                if (isLandFeature && !isMaskLayer && !isOutline) {
                  try {
                    mapInstance.moveLayer(id, targetBeforeId);
                  } catch (e) {}
                }
              }
            }
          }
        } catch (e) {
          console.warn('[OceanMask] Error rearranging vector land layers:', e);
        }
      } else {
        for (const lid of ALL_LAYERS) {
          if (mapInstance.getLayer(lid)) { try { mapInstance.removeLayer(lid); } catch (e) {} }
        }
        if (hasSrc) { try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {} }
      }
    } finally {
      setTimeout(() => { syncingRef.current = false; }, 500);
    }
  }, [mapInstance, maskData, active, theme, tc, beforeId]);

  useEffect(() => { syncLayers(); }, [syncLayers]);

  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => { if (!syncingRef.current) setTimeout(syncLayers, 300); };
    mapInstance.on('styledata', handler);
    return () => mapInstance.off('styledata', handler);
  }, [mapInstance, syncLayers]);

  // v91: Dedicated marine-raster repositioning listener — runs WITHOUT syncingRef guard.
  // Fixes the race where react-map-gl adds swell_1-layer / waves-layer a few ms after
  // syncLayers fires (syncingRef is still true), so the blocked styledata handler
  // never calls moveLayer for those layers and they render above MASK_FILL (over land).
  useEffect(() => {
    if (!mapInstance) return;
    const marineRasterLayers = ['waves-layer', 'swell_1-layer', 'swell_2-layer', 'wind_waves-layer'];
    const repositionLayers = () => {
      if (!mapInstance.getLayer(MASK_BUFFER)) return;
      for (const ml of marineRasterLayers) {
        if (mapInstance.getLayer(ml)) {
          try { mapInstance.moveLayer(ml, MASK_BUFFER); } catch (e) {}
        }
      }
    };
    mapInstance.on('styledata', repositionLayers);
    return () => mapInstance.off('styledata', repositionLayers);
  }, [mapInstance]);

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
