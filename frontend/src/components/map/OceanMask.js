/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';
import { findMarineInsertionLayer } from './mapUtils';

/**
 * OceanMask v12 — Pixel-Perfect Native Vector-Tile Coastline Blending & Land Masking.
 *
 * Stacking stack (bottom → top):
 *   [water]                    mapBase map water fill
 *   [marine rasters]           OM wave/swell slot layers (forced below MASK_BUFFER)
 *   ocean-mask-buffer          WIDE line shifted outward into the ocean (ocean-colored blur vignette)
 *   ocean-mask-fill            Natural Earth 10m land fill (solid theme land color)
 *   [landuse / parks / wood]   Mapbox base landuse polygons (moved on top of land fill dynamically)
 *   ocean-mask-inland-water    Base map lakes/reservoirs (brought back on top of land fill & parks)
 *   ocean-mask-inland-waterway Base map rivers/streams (brought back on top of land fill & parks)
 *   ocean-mask-line            Thin aesthetic coastline boundary outline
 *   [roads / labels / houses]  Topmost base map layers
 */

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

const landuseKeywords = ['landuse', 'park', 'wood', 'forest', 'glacier', 'sand', 'pitch', 'grass', 'cemetery', 'hospital', 'school', 'university'];

const safeMoveLayer = (mapInstance, layerId, beforeId) => {
  if (!mapInstance || !layerId || !beforeId) return;
  try {
    if (!mapInstance.getLayer(layerId) || !mapInstance.getLayer(beforeId)) return;
    const style = mapInstance.getStyle();
    if (!style || !style.layers) return;
    const layers = style.layers;
    const layerIdx = layers.findIndex(l => l.id === layerId);
    const beforeIdx = layers.findIndex(l => l.id === beforeId);
    if (layerIdx !== -1 && beforeIdx !== -1) {
      if (layerIdx === beforeIdx - 1) {
        return; // Already immediately before beforeId
      }
    }
    mapInstance.moveLayer(layerId, beforeId);
  } catch (e) {}
};

// Reposition base map landuse/park fills dynamically on top of the solid land mask
const repositionLanduse = (mapInstance, active) => {
  if (!mapInstance || active) return;
  try {
    const style = mapInstance.getStyle();
    if (!style || !style.layers) return;
    const layers = style.layers;

    const maskFillIdx = layers.findIndex(l => l.id === MASK_FILL);
    if (maskFillIdx === -1) return;

    // Use MASK_INLAND_WATER or MASK_LINE as the anchor boundary
    const anchorId = mapInstance.getLayer(MASK_INLAND_WATER) ? MASK_INLAND_WATER : (mapInstance.getLayer(MASK_LINE) ? MASK_LINE : null);
    if (!anchorId) return;

    for (let i = 0; i < maskFillIdx; i++) {
      const layer = layers[i];
      const id = layer.id.toLowerCase();
      const isLanduse = landuseKeywords.some(kw => id.includes(kw));
      if (isLanduse && layer.type === 'fill') {
        safeMoveLayer(mapInstance, layer.id, anchorId);
      }
    }
  } catch (e) {
    console.warn('[OceanMask] Failed to reposition landuse layers:', e);
  }
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

// Filter out inland lakes/rivers to keep buffer exclusively on ocean coastlines
const waterFilter = [
  'match',
  ['get', 'class'],
  ['lake', 'river', 'canal', 'stream', 'reservoir', 'pool', 'pond', 'spring', 'waterfall'],
  false,
  true
];

export function OceanMask({ mapInstance, active: propActive, activeMarineLayer, theme, beforeId, activeLayers = [] }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const syncingRef = useRef(false);
  const timeoutRef = useRef(null);

  const active = propActive !== undefined ? propActive : !!activeMarineLayer;

  // Debug removed: was causing excessive console spam on every render

  // Load the Natural Earth land GeoJSON once at mount (local-first fallback chain)
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const loadLand = async () => {
      // 1. Try local 50m land GeoJSON (2.76 MB, served locally in ~50ms, 100% reliable)
      try {
        console.log('[OceanMask] Loading local ne_50m_land.json...');
        const r = await fetch('/ne_50m_land.json');
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const geojson = await r.json();
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Loaded local 50m land:', geojson.features.length, 'land features');
          return;
        }
      } catch (e) {
        console.warn('[OceanMask] Local 50m land fetch failed:', e);
      }

      // 2. Try local 110m land GeoJSON fallback (219 KB)
      try {
        console.log('[OceanMask] Loading local ne_110m_land.json fallback...');
        const r = await fetch('/ne_110m_land.json');
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const geojson = await r.json();
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Loaded local 110m land fallback:', geojson.features.length, 'land features');
          return;
        }
      } catch (e) {
        console.warn('[OceanMask] Local 110m land fallback fetch failed:', e);
      }

      // 3. Try remote 10m land CDN as final fallback (18.29 MB)
      try {
        console.log('[OceanMask] Loading remote 10m land CDN as final fallback...');
        const r = await fetch(NE_LAND_URL);
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const geojson = await r.json();
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Loaded remote 10m land:', geojson.features.length, 'land features');
          return;
        }
      } catch (e) {
        console.error('[OceanMask] All land GeoJSON load attempts failed:', e);
        fetchedRef.current = false;
      }
    };

    loadLand();
  }, []);

  // Maintain a stateRef updated on every render to completely prevent stale closure races
  const stateRef = useRef({ mapInstance, active, theme, beforeId, maskData, activeLayers });
  useEffect(() => {
    stateRef.current = { mapInstance, active, theme, beforeId, maskData, activeLayers };
  });

  const syncLayers = useCallback(() => {
    const { mapInstance, active, theme, beforeId, maskData, activeLayers } = stateRef.current;
    if (!mapInstance) {
      console.log('[OceanMask] syncLayers bypassed, no map');
      return;
    }

    console.log('[OceanMask] syncLayers running:', { active });

    try {
      const style = mapInstance.getStyle();
      if (!style) return;

      const hasBuf  = !!mapInstance.getLayer(MASK_BUFFER);
      const hasFill = !!mapInstance.getLayer(MASK_FILL);
      const hasLine = !!mapInstance.getLayer(MASK_LINE);
      const hasWaterway = !!mapInstance.getLayer(MASK_INLAND_WATERWAY);
      const hasWater = !!mapInstance.getLayer(MASK_INLAND_WATER);
      const hasSrc  = !!mapInstance.getSource(MASK_SOURCE);

      if (active) {
        if (!maskData) {
          console.log('[OceanMask] syncLayers active but maskData not loaded yet, skipping add');
          return;
        }

        if (!hasSrc) {
          try {
            mapInstance.addSource(MASK_SOURCE, {
              type: 'geojson',
              data: maskData,
              tolerance: 0.375,
            });
          } catch (e) {
            console.error('[OceanMask] Failed to add source:', e);
          }
        }

        const insertBeforeId = beforeId || findMarineInsertionLayer(mapInstance);
        const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
        const fillColor = tc.fill;
        const oceanColor = tc.ocean || 'rgba(16, 29, 43, 0.90)';

        // Resolve base vector water properties from the Mapbox style dynamically
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

        // 1. Coastline blending buffer (WIDE line shifted into the ocean, oceanColor matches background water)
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: MASK_SOURCE,
              paint: {
                'line-color': oceanColor,
                'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                  1, 10,
                  3, 16,
                  5, 22,
                  7, 22,
                  9, 20,
                  14, 2,
                ],
                // Positive shift on land polygon shifts outward into the ocean
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
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_BUFFER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', oceanColor);
            mapInstance.setLayoutProperty(MASK_BUFFER, 'visibility', 'visible');
          } catch (e) {}
        }

        // 2. Solid Land Mask fill
        if (!hasFill) {
          try {
            mapInstance.addLayer({
              id: MASK_FILL,
              type: 'fill',
              source: MASK_SOURCE,
              paint: {
                'fill-color': fillColor,
                'fill-opacity': 0.0
              },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_FILL:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_FILL, insertBeforeId);
            mapInstance.setPaintProperty(MASK_FILL, 'fill-color', fillColor);
            mapInstance.setPaintProperty(MASK_FILL, 'fill-opacity', 0.0);
            mapInstance.setLayoutProperty(MASK_FILL, 'visibility', 'visible');
          } catch (e) {}
        }

        // 3. Bring high-resolution inland water (lakes/reservoirs) back to the top
        if (!hasWater) {
          try {
            mapInstance.addLayer({
              id: MASK_INLAND_WATER,
              type: 'fill',
              source: waterSource,
              'source-layer': waterSourceLayer,
              filter: ['all', ['has', 'class'], ['match', ['get', 'class'], ['ocean', 'sea'], false, true]],
              paint: {
                'fill-color': waterColor,
                'fill-opacity': 0.0
              },
              layout: {
                visibility: 'none'
              }
            }, insertBeforeId || undefined);
          } catch (e) {
            console.warn('[OceanMask] Failed to add MASK_INLAND_WATER:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_INLAND_WATER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATER, 'fill-color', waterColor);
            mapInstance.setPaintProperty(MASK_INLAND_WATER, 'fill-opacity', 0.0);
            mapInstance.setFilter(MASK_INLAND_WATER, ['all', ['has', 'class'], ['match', ['get', 'class'], ['ocean', 'sea'], false, true]]);
            mapInstance.setLayoutProperty(MASK_INLAND_WATER, 'visibility', 'none');
          } catch (e) {}
        }

        // 4. Bring high-resolution waterways (rivers/streams) back to the top
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
                'line-opacity': 0.0
              },
              layout: {
                visibility: 'none'
              }
            }, insertBeforeId || undefined);
          } catch (e) {
            console.warn('[OceanMask] Failed to add MASK_INLAND_WATERWAY:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_INLAND_WATERWAY, insertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATERWAY, 'line-color', waterwayColor);
            mapInstance.setPaintProperty(MASK_INLAND_WATERWAY, 'line-opacity', 0.0);
            mapInstance.setLayoutProperty(MASK_INLAND_WATERWAY, 'visibility', 'none');
          } catch (e) {}
        }

        // 5. Thin aesthetic coastline outline
        if (!hasLine) {
          try {
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
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_LINE, insertBeforeId);
            mapInstance.setLayoutProperty(MASK_LINE, 'visibility', 'visible');
          } catch (e) {}
        }

        // 6. Dynamically restore base map parks, forests, and green space fills
        repositionLanduse(mapInstance, active);

        // Toggle base map fill layers containing landuse/park keywords
        const isParksEnabled = activeLayers.includes('parks') || activeLayers.includes('landuse');
        if (style && style.layers) {
          for (const layer of style.layers) {
            const id = layer.id.toLowerCase();
            const isLanduse = landuseKeywords.some(kw => id.includes(kw));
            if (isLanduse && layer.type === 'fill') {
              if (active && !isParksEnabled) {
                try { mapInstance.setLayoutProperty(layer.id, 'visibility', 'none'); } catch (e) {}
              } else {
                try { mapInstance.setLayoutProperty(layer.id, 'visibility', 'visible'); } catch (e) {}
              }
            }
          }
        }

        // 7. Force slot-based active marine raster layers ABOVE buffer but BELOW land fill
        const marineLayers = ['waves','swell_1','swell_2','wind_waves'].flatMap(k => [0,1,2].map(s => `${k}-slot-${s}-layer`));
        for (const ml of marineLayers) {
          safeMoveLayer(mapInstance, ml, MASK_FILL);
        }

      } else {
        // Active is false: Enforce permanent layer presence. Set visibility to 'none' instead of removing layers
        const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
        for (const lid of historicalLayers) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.setLayoutProperty(lid, 'visibility', 'none'); } catch (e) {}
          }
        }

        // Also restore all base map fill layers containing landuse/park keywords to visible
        if (style && style.layers) {
          for (const layer of style.layers) {
            const id = layer.id.toLowerCase();
            const isLanduse = landuseKeywords.some(kw => id.includes(kw));
            if (isLanduse && layer.type === 'fill') {
              try { mapInstance.setLayoutProperty(layer.id, 'visibility', 'visible'); } catch (e) {}
            }
          }
        }
      }
    } catch (err) {
      console.error('[OceanMask] Error in syncLayers:', err);
    }
  }, []);

  const triggerSync = useCallback((delay = 0) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (delay === 0) {
      if (!syncingRef.current) {
        syncingRef.current = true;
        syncLayers();
        setTimeout(() => { syncingRef.current = false; }, 300);
      }
    } else {
      timeoutRef.current = setTimeout(() => {
        if (!syncingRef.current) {
          syncingRef.current = true;
          syncLayers();
          setTimeout(() => { syncingRef.current = false; }, 300);
        }
      }, delay);
    }
  }, [syncLayers]);

  // Handle active state changes immediately and synchronously to clean up on toggling off
  useEffect(() => {
    if (!active) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (mapInstance) {
        console.log('[OceanMask] Deactivating: setting visibility to none instead of removing layers immediately');
        syncingRef.current = true;
        const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
        for (const lid of historicalLayers) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.setLayoutProperty(lid, 'visibility', 'none'); } catch (e) {}
          }
        }

        // Restore all base map fill layers containing landuse/park keywords to visible
        try {
          const style = mapInstance.getStyle();
          if (style && style.layers) {
            for (const layer of style.layers) {
              const id = layer.id.toLowerCase();
              const isLanduse = landuseKeywords.some(kw => id.includes(kw));
              if (isLanduse && layer.type === 'fill') {
                try { mapInstance.setLayoutProperty(layer.id, 'visibility', 'visible'); } catch (e) {}
              }
            }
          }
        } catch (e) {}

        setTimeout(() => { syncingRef.current = false; }, 300);
      }
    } else {
      triggerSync(0);
    }
  }, [mapInstance, active, theme, beforeId, maskData, triggerSync, activeLayers]);

  // Re-run sync on styles data changes
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => {
      const { active } = stateRef.current;
      if (active && !syncingRef.current) {
        triggerSync(300);
      }
    };
    mapInstance.on('styledata', handler);
    return () => {
      mapInstance.off('styledata', handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [mapInstance, triggerSync]);

  // Dedicated marine-raster repositioning listener to ensure slots sit above buffer but below land fill
  useEffect(() => {
    if (!mapInstance) return;
    const marineRasterLayers = ['waves','swell_1','swell_2','wind_waves'].flatMap(k => [0,1,2].map(s => `${k}-slot-${s}-layer`));
    const repositionLayers = () => {
      const { active } = stateRef.current;
      if (!active || !mapInstance.getLayer(MASK_FILL)) return;
      for (const ml of marineRasterLayers) {
        safeMoveLayer(mapInstance, ml, MASK_FILL);
      }
    };
    mapInstance.on('styledata', repositionLayers);
    return () => mapInstance.off('styledata', repositionLayers);
  }, [mapInstance]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
      for (const lid of historicalLayers) {
        try { mapInstance.removeLayer(lid); } catch (e) {}
      }
      try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
