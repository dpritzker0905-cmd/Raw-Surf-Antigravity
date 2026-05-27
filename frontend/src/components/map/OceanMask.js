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

// Reposition base map landuse/park fills dynamically on top of the solid land mask.
// Returns an array of { id, beforeId } records so we can restore them on deactivation.
const repositionLanduse = (mapInstance, movedRef) => {
  if (!mapInstance) return;
  try {
    const style = mapInstance.getStyle();
    if (!style || !style.layers) return;
    const layers = style.layers;

    const maskFillIdx = layers.findIndex(l => l.id === MASK_FILL);
    if (maskFillIdx === -1) return;

    // Use MASK_INLAND_WATER or MASK_LINE as the anchor boundary
    const anchorId = mapInstance.getLayer(MASK_INLAND_WATER) ? MASK_INLAND_WATER : (mapInstance.getLayer(MASK_LINE) ? MASK_LINE : null);
    if (!anchorId) return;

    const moved = [];
    for (let i = 0; i < maskFillIdx; i++) {
      const layer = layers[i];
      const id = layer.id.toLowerCase();
      const isLanduse = landuseKeywords.some(kw => id.includes(kw));
      if (isLanduse && layer.type === 'fill') {
        // Record original position: the layer that was immediately AFTER this one
        const nextLayer = (i + 1 < layers.length) ? layers[i + 1].id : null;
        moved.push({ id: layer.id, beforeId: nextLayer });
        safeMoveLayer(mapInstance, layer.id, anchorId);
      }
    }
    if (movedRef && moved.length > 0) {
      movedRef.current = moved;
    }
  } catch (e) {
    console.warn('[OceanMask] Failed to reposition landuse layers:', e);
  }
};

// Restore landuse layers to their original positions in the basemap stack
const restoreLanduse = (mapInstance, movedRef) => {
  if (!mapInstance || !movedRef?.current?.length) return;
  try {
    // Find a stable base-map anchor to place landuse layers before.
    // 'marine-raster-anchor' is inserted at the correct base-map boundary.
    // Fallback to 'building' or 'building-outline' which are always above landuse in base styles.
    const anchorCandidates = ['marine-raster-anchor', 'building', 'building-outline', 'aeroway-polygon'];
    let stableAnchor = null;
    for (const c of anchorCandidates) {
      if (mapInstance.getLayer(c)) { stableAnchor = c; break; }
    }

    // Restore in reverse order to maintain relative ordering
    const records = [...movedRef.current].reverse();
    for (const { id } of records) {
      if (!mapInstance.getLayer(id)) continue;
      try {
        if (stableAnchor) {
          mapInstance.moveLayer(id, stableAnchor);
        }
      } catch (e) {}
    }
    movedRef.current = [];
  } catch (e) {
    console.warn('[OceanMask] Failed to restore landuse layers:', e);
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

// Filter: show all water features EXCEPT ocean/sea (which are handled by the base water layer)
// Many water features (e.g., Lake Okeechobee) have no 'class' property at all,
// so we must NOT use ['has', 'class'] as a guard — that rejects classless features.
const inlandWaterFilter = [
  'any',
  ['!', ['has', 'class']],                                    // no class → treat as inland water (lakes etc.)
  ['match', ['get', 'class'], ['ocean', 'sea'], false, true]   // has class → exclude ocean/sea only
];

export function OceanMask({ mapInstance, active: propActive, activeMarineLayer, theme, beforeId }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const syncingRef = useRef(false);
  const timeoutRef = useRef(null);
  const syncLogRef = useRef(0);
  const movedLanduseRef = useRef([]);

  const active = propActive !== undefined ? propActive : !!activeMarineLayer;

  // Debug removed: was causing excessive console spam on every render

  // Load the Natural Earth land GeoJSON once at mount (local-first fallback chain)
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const loadLand = async () => {
      // === PROGRESSIVE LAND LOADING STRATEGY ===
      // Phase 1: Load 50m instantly for fast initial display (~50ms)
      // Phase 2: Upgrade to 10m from CDN in background for pixel-perfect coastlines

      let phase1Loaded = false;

      // Phase 1: Fast local load (50m or 110m)
      try {
        console.log('[OceanMask] Phase 1: Loading local ne_50m_land.json (instant)...');
        const r = await fetch('/ne_50m_land.json');
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const geojson = await r.json();
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          phase1Loaded = true;
          console.log('[OceanMask] Phase 1 complete: 50m land loaded (' + geojson.features.length + ' features). Upgrading to 10m...');
        }
      } catch (e) {
        console.warn('[OceanMask] Phase 1: 50m fetch failed, trying 110m:', e);
        try {
          const r = await fetch('/ne_110m_land.json');
          if (!r.ok) throw new Error(`Status ${r.status}`);
          const geojson = await r.json();
          const mask = buildLandMask(geojson);
          if (mask) {
            setMaskData(mask);
            phase1Loaded = true;
            console.log('[OceanMask] Phase 1 complete: 110m fallback loaded. Upgrading to 10m...');
          }
        } catch (e2) {
          console.warn('[OceanMask] Phase 1: 110m fallback also failed:', e2);
        }
      }

      // Phase 2: Upgrade to 10m from CDN (runs regardless of Phase 1 success)
      try {
        console.log('[OceanMask] Phase 2: Fetching 10m land from CDN for precision coastlines...');
        const r = await fetch(NE_LAND_URL);
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const geojson = await r.json();
        const mask = buildLandMask(geojson);
        if (mask) {
          setMaskData(mask);
          console.log('[OceanMask] Phase 2 complete: 10m land UPGRADED (' + geojson.features.length + ' features). Coastline precision maximized.');
          return;
        }
      } catch (e) {
        if (phase1Loaded) {
          console.warn('[OceanMask] Phase 2: 10m CDN unavailable, staying on Phase 1 data. Coastline precision limited.');
        } else {
          console.error('[OceanMask] All land GeoJSON load attempts failed:', e);
          fetchedRef.current = false;
        }
      }
    };

    loadLand();
  }, []);

  // Maintain a stateRef updated on every render to completely prevent stale closure races
  const stateRef = useRef({ mapInstance, active, theme, beforeId, maskData });
  useEffect(() => {
    stateRef.current = { mapInstance, active, theme, beforeId, maskData };
  });

  const syncLayers = useCallback(() => {
    const { mapInstance, active, theme, beforeId, maskData } = stateRef.current;
    if (!mapInstance) {
      console.log('[OceanMask] syncLayers bypassed, no map');
      return;
    }

    // Throttled log to prevent console spam (syncLayers fires on every styledata event)
    syncLogRef.current++;
    if (syncLogRef.current <= 3 || syncLogRef.current % 50 === 0) {
      console.log('[OceanMask] syncLayers running:', { active, syncCount: syncLogRef.current });
    }

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
        } else {
          // Hot-swap source data for progressive loading (50m → 10m upgrade)
          try {
            const src = mapInstance.getSource(MASK_SOURCE);
            if (src && src.setData) {
              src.setData(maskData);
            }
          } catch (e) {}
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
                'fill-opacity': 1.0
              },
            }, insertBeforeId || undefined);
          } catch (e) {
            console.error('[OceanMask] Failed to add MASK_FILL:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_FILL, insertBeforeId);
            mapInstance.setPaintProperty(MASK_FILL, 'fill-color', fillColor);
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
              filter: inlandWaterFilter,
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
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_INLAND_WATER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATER, 'fill-color', waterColor);
            mapInstance.setFilter(MASK_INLAND_WATER, inlandWaterFilter);
            mapInstance.setLayoutProperty(MASK_INLAND_WATER, 'visibility', 'visible');
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
                'line-opacity': 1.0
              }
            }, insertBeforeId || undefined);
          } catch (e) {
            console.warn('[OceanMask] Failed to add MASK_INLAND_WATERWAY:', e);
          }
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_INLAND_WATERWAY, insertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATERWAY, 'line-color', waterwayColor);
            mapInstance.setLayoutProperty(MASK_INLAND_WATERWAY, 'visibility', 'visible');
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
        repositionLanduse(mapInstance, movedLanduseRef);

        // 7. Force slot-based active marine raster layers ABOVE buffer but BELOW land fill
        const marineLayers = ['waves','swell_1','swell_2','wind_waves'].flatMap(k => [0,1,2].map(s => `${k}-slot-${s}-layer`));
        marineLayers.push('webgl-marine-particles'); // Include WebGL custom marine particle layer
        for (const ml of marineLayers) {
          safeMoveLayer(mapInstance, ml, MASK_FILL);
        }

      } else {
        // Active is false: Restore landuse layers to original positions, then hide mask layers
        restoreLanduse(mapInstance, movedLanduseRef);
        const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
        for (const lid of historicalLayers) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.setLayoutProperty(lid, 'visibility', 'none'); } catch (e) {}
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
        console.log('[OceanMask] Deactivating: restoring landuse + hiding mask layers');
        syncingRef.current = true;
        restoreLanduse(mapInstance, movedLanduseRef);
        const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
        for (const lid of historicalLayers) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.setLayoutProperty(lid, 'visibility', 'none'); } catch (e) {}
          }
        }
        setTimeout(() => { syncingRef.current = false; }, 300);
      }
    } else {
      // Force-clear syncing lock from any previous deactivation cooldown
      syncingRef.current = false;
      triggerSync(0);
      // Retry after potential race window to guarantee visibility
      triggerSync(350);
    }
  }, [mapInstance, active, theme, beforeId, maskData, triggerSync]);

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
    marineRasterLayers.push('webgl-marine-particles');
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
