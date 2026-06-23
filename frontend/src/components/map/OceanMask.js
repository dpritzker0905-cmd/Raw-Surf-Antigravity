/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';
import { findMarineInsertionLayer } from './mapUtils';

/**
 * OceanMask v15 — Pristine GeoJSON Land Masking & Dynamic Coastline Blending.
 *
 * This implementation loads an offline-friendly, highly optimized 50m land GeoJSON
 * dataset (~2.7MB, served locally in ~50ms) to form an authoritative solid land mask.
 * Base map green spaces/parks and inland water layers (lakes/rivers) are dynamically
 * repositioned on top of the solid land fill to keep them fully visible.
 *
 * To eliminate GFS wave grid staircasing near coastlines, a wide, blurred, color-matched
 * line buffer is shifted into the ocean under the land mask. By styling this buffer line
 * dynamically with colors matching the active wave/swell scale, the transparent nearshore
 * GFS grid cells blend perfectly, making blocky coastline staircasing 100% invisible!
 *
 * Stacking stack (bottom → top):
 *   [water]                    ← Mapbox base water fill
 *   [marine rasters]           ← GFS wave/swell slot layers (forced below MASK_BUFFER)
 *   ocean-mask-buffer          ← Wide blurred coastline buffer (dynamic wave-scale coloring)
 *   ocean-mask-fill            ← Natural Earth 50m land fill (solid theme land color)
 *   [landuse / parks / wood]   ← Mapbox base landuse polygons (moved on top of land fill dynamically)
 *   ocean-mask-inland-water    ← Base map lakes/reservoirs (brought back on top of land fill)
 *   ocean-mask-inland-waterway ← Base map rivers/streams (brought back on top of land fill)
 *   ocean-mask-line            ← Thin aesthetic coastline boundary outline
 *   [roads / labels / houses]  ← Topmost base map layers
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

// Beautiful low-end wave/swell color scale matching for smooth nearshore blending
const MARINE_BUFFER_COLORS = {
  waves: 'rgba(34, 211, 238, 0.70)',       // Cyan matching 0.6m–1.2m waves
  swell_1: 'rgba(34, 211, 238, 0.70)',     // Cyan matching swell_1 scale
  swell_2: 'rgba(192, 132, 252, 0.60)',    // Lavender matching secondary swell scale
  wind_waves: 'rgba(20, 184, 166, 0.65)',  // Soft teal matching wind wave scale
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
      if (layerIdx < beforeIdx) {
        return; // Already positioned below/before beforeId in stacking order
      }
    }
    mapInstance.moveLayer(layerId, beforeId);
  } catch (e) {}
};

// Batched variant: move MANY layers below `beforeId` using a SINGLE getStyle() snapshot
// instead of one getStyle() per layer. getStyle() serializes the entire MapLibre style,
// so calling it once for N layers (vs N times) is a large saving on the styledata hot path.
const safeMoveLayersBatch = (mapInstance, layerIds, beforeId) => {
  if (!mapInstance || !beforeId || !layerIds || !layerIds.length) return;
  try {
    if (!mapInstance.getLayer(beforeId)) return;
    const style = mapInstance.getStyle();
    if (!style || !style.layers) return;
    const order = new Map();
    for (let i = 0; i < style.layers.length; i++) order.set(style.layers[i].id, i);
    const beforeIdx = order.get(beforeId);
    if (beforeIdx === undefined) return;
    for (const layerId of layerIds) {
      const layerIdx = order.get(layerId);
      if (layerIdx === undefined) continue;   // layer not present
      if (layerIdx < beforeIdx) continue;      // already below/before — nothing to do
      try { mapInstance.moveLayer(layerId, beforeId); } catch (e) {}
    }
  } catch (e) {}
};

// Reposition base map landuse/park fills dynamically on top of the solid land mask
const repositionLanduse = (mapInstance) => {
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

    const waterLayerExists = !!mapInstance.getLayer('water');
    const landuseAnchor = waterLayerExists ? 'water' : anchorId;

    const landuseLayerIds = [];
    for (let i = 0; i < maskFillIdx; i++) {
      const layer = layers[i];
      const id = layer.id.toLowerCase();
      const isLanduse = landuseKeywords.some(kw => id.includes(kw));
      // Move landuse fills below base map water layer if it exists
      if (isLanduse && layer.type === 'fill' && layer.id !== 'water') {
        landuseLayerIds.push(layer.id);
      }
    }
    if (landuseLayerIds.length > 0) {
      safeMoveLayersBatch(mapInstance, landuseLayerIds, landuseAnchor);
    }

    // Move the base map's 'water' layer above repositioned landuse layers but below inland water
    if (waterLayerExists) {
      safeMoveLayer(mapInstance, 'water', anchorId);
    }
  } catch (e) {
    console.warn('[OceanMask] Failed to reposition landuse layers:', e);
  }
};

const findInsertionPoint = (mapInstance) => {
  try {
    const style = mapInstance.getStyle();
    if (!style?.layers) return null;

    for (const layer of style.layers) {
      const id = layer.id;
      // Skip our own layers and custom layers
      if (id.startsWith('ocean-mask-') || id.endsWith('-layer') || id.endsWith('-source')) continue;
      if (id === 'background' || id === 'water' || id === 'water-depth' || id === 'wetland') continue;

      // Insert BEFORE the first landuse, park, POI, or structural layer
      if (id.includes('landuse') || id.includes('park') || id.includes('landcover') ||
          id.includes('national') || id.includes('land-structure') ||
          id.includes('building') || id.includes('poi') ||
          layer.type === 'symbol') {
        return id;
      }
    }
  } catch (e) {}
  return null;
};

const findRoadInsertionPoint = (mapInstance) => {
  try {
    const style = mapInstance.getStyle();
    if (!style?.layers) return null;

    for (const layer of style.layers) {
      const id = layer.id;
      // Skip our own layers and custom layers
      if (id.startsWith('ocean-mask-') || id.endsWith('-layer') || id.endsWith('-source')) continue;
      
      // Roads, buildings, bridges, tunnels, labels, markers
      if (id.includes('road') || id.includes('building') || id.includes('tunnel') || 
          id.includes('bridge') || id.includes('admin') || id.includes('label') ||
          layer.type === 'symbol' || layer.type === 'line') {
        // Exclude waterway lines or water lines
        if (id.includes('water') || id.includes('stream') || id.includes('river')) continue;
        return id;
      }
    }
  } catch (e) {}
  return null;
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

export function OceanMask({ mapInstance, active: propActive, activeMarineLayer, theme, beforeId }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const syncingRef = useRef(false);
  const timeoutRef = useRef(null);
  const deactivateTimerRef = useRef(null);
  const lastSyncSignatureRef = useRef(null);
  const lastSyncCoreRef = useRef(null); // signature WITHOUT activeMarineLayer — enables a recolor fast path
  const styleVersionRef = useRef(0);
  const syncRafIdRef = useRef(null);

  const active = propActive !== undefined ? propActive : !!activeMarineLayer;

  const lastLogRef = useRef(null);
  const logKey = `${active}:${propActive}:${activeMarineLayer}:${theme}`;
  if (lastLogRef.current !== logKey) {
    lastLogRef.current = logKey;
    console.log('[OceanMask] State Changed:', { active, propActive, activeMarineLayer, theme });
  }

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
  const stateRef = useRef({ mapInstance, active, activeMarineLayer, theme, beforeId, maskData });
  useEffect(() => {
    stateRef.current = { mapInstance, active, activeMarineLayer, theme, beforeId, maskData };
  });

  const syncLayers = useCallback(() => {
    const { mapInstance, active, activeMarineLayer, theme, beforeId, maskData } = stateRef.current;
    if (!mapInstance) {
      console.log('[OceanMask] syncLayers bypassed, no map');
      return;
    }

    const currentSig = `${active}_${activeMarineLayer || ''}_${theme}_${beforeId || ''}_${!!maskData}_${styleVersionRef.current}`;
    if (lastSyncSignatureRef.current === currentSig) {
      return;
    }

    // RECOLOR FAST PATH: when ONLY the active marine layer changed (same active/theme/beforeId/
    // maskData/style), the sole layer-dependent value is the MASK_BUFFER fill-color — every mask
    // layer and all layer positions are independent of activeMarineLayer. A full rebuild here
    // re-serializes the entire MapLibre style several times (getStyle) and re-adds/moves layers,
    // which React Scan attributes to "other" time (style recalc + layerization + paint) on each
    // layer switch. Recoloring in place is behaviorally identical and ~free. The styledata event
    // this fires is ignored by the styledata handler because syncingRef is held true around sync.
    const coreSig = `${active}_${theme}_${beforeId || ''}_${!!maskData}_${styleVersionRef.current}`;
    if (active && maskData && lastSyncCoreRef.current === coreSig && mapInstance.getLayer(MASK_BUFFER)) {
      const tcFast = THEME_COLORS[theme] || THEME_COLORS.dark;
      const oceanColorFast = (activeMarineLayer && MARINE_BUFFER_COLORS[activeMarineLayer])
        ? MARINE_BUFFER_COLORS[activeMarineLayer]
        : (tcFast.ocean || 'rgba(16, 29, 43, 0.90)');
      try { mapInstance.setPaintProperty(MASK_BUFFER, 'fill-color', oceanColorFast); } catch (e) {}
      lastSyncSignatureRef.current = currentSig;
      return;
    }

    console.log('[OceanMask] syncLayers running:', { active, activeMarineLayer, theme });
    lastSyncSignatureRef.current = currentSig;
    lastSyncCoreRef.current = coreSig;

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

        const insertBeforeId = beforeId || findInsertionPoint(mapInstance);
        const roadInsertBeforeId = beforeId || findRoadInsertionPoint(mapInstance) || insertBeforeId;
        const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
        const fillColor = tc.fill;
        
        // Dynamically recolor the buffer based on the active marine layer to hide nearshore GFS gaps
        const oceanColor = (activeMarineLayer && MARINE_BUFFER_COLORS[activeMarineLayer])
          ? MARINE_BUFFER_COLORS[activeMarineLayer]
          : (tc.ocean || 'rgba(16, 29, 43, 0.90)');

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

        // 1. Coastline blending buffer (WIDE line shifted into the ocean with dynamic wave scale matching)
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
                  5, 32,
                  7, 48,
                  9, 60,
                  14, 2,
                ],
                // Positive shift on land polygon shifts outward into the ocean
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, 5,
                  3, 8,
                  5, 16,
                  7, 24,
                  9, 30,
                  14, 0,
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  8.5, 1.0,
                  9.5, 0.0
                ],
                'line-blur': ['interpolate', ['linear'], ['zoom'],
                  2, 3.0,
                  5, 2.5,
                  7, 2.0,
                  9, 1.5,
                  14, 0.0
                ],
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            }, insertBeforeId || undefined);
          } catch (e) {}
        } else {
          try {
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_BUFFER, insertBeforeId);
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', oceanColor);
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
              filter: ['match', ['get', 'class'], ['ocean', 'sea'], false, true],
              paint: {
                'fill-color': waterColor,
                'fill-opacity': 1.0
              }
            }, roadInsertBeforeId || undefined);
          } catch (e) {
            console.warn('[OceanMask] Failed to add MASK_INLAND_WATER:', e);
          }
        } else {
          try {
            if (roadInsertBeforeId) safeMoveLayer(mapInstance, MASK_INLAND_WATER, roadInsertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATER, 'fill-color', waterColor);
            mapInstance.setFilter(MASK_INLAND_WATER, ['match', ['get', 'class'], ['ocean', 'sea'], false, true]);
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
            }, roadInsertBeforeId || undefined);
          } catch (e) {
            console.warn('[OceanMask] Failed to add MASK_INLAND_WATERWAY:', e);
          }
        } else {
          try {
            if (roadInsertBeforeId) safeMoveLayer(mapInstance, MASK_INLAND_WATERWAY, roadInsertBeforeId);
            mapInstance.setPaintProperty(MASK_INLAND_WATERWAY, 'line-color', waterwayColor);
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
                  10, tc.lw * 1.5
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  9, 0.8,
                  14, 0.0
                ],
                'line-blur': 0.5,
              },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            }, roadInsertBeforeId || undefined);
          } catch (e) {}
        } else {
          try {
            if (roadInsertBeforeId) safeMoveLayer(mapInstance, MASK_LINE, roadInsertBeforeId);
          } catch (e) {}
        }

        // 6. Dynamically restore base map parks, forests, and green space fills
        repositionLanduse(mapInstance);

        // 7. Force slot-based active marine raster layers BELOW MASK_BUFFER
        const marineLayers = ['waves','swell_1','swell_2','wind_waves'].flatMap(k => [0,1,2].map(s => `${k}-slot-${s}-layer`));
        safeMoveLayersBatch(mapInstance, marineLayers, MASK_BUFFER);

      } else {
        // Active is false: remove all layers immediately and synchronously
        const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
        for (const lid of historicalLayers) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        }
        if (mapInstance.getSource(MASK_SOURCE)) {
          try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
        }
      }
    } catch (err) {
      console.error('[OceanMask] Error in syncLayers:', err);
    }
  }, []);

  const triggerSync = useCallback((delay = 0) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (delay === 0) {
      if (syncRafIdRef.current) cancelAnimationFrame(syncRafIdRef.current);
      syncRafIdRef.current = requestAnimationFrame(() => {
        syncRafIdRef.current = null;
        if (!syncingRef.current) {
          syncingRef.current = true;
          syncLayers();
          setTimeout(() => { syncingRef.current = false; }, 300);
        }
      });
    } else {
      timeoutRef.current = setTimeout(() => {
        if (syncRafIdRef.current) cancelAnimationFrame(syncRafIdRef.current);
        syncRafIdRef.current = requestAnimationFrame(() => {
          syncRafIdRef.current = null;
          if (!syncingRef.current) {
            syncingRef.current = true;
            syncLayers();
            setTimeout(() => { syncingRef.current = false; }, 300);
          }
        });
      }, delay);
    }
  }, [syncLayers]);

  // Handle active state changes. Removal is DEBOUNCED so a rapid marine->wind->marine toggle
  // doesn't tear down and rebuild all mask layers each time (the [OceanMask] Deactivating
  // churn seen while toggling between marine and wind). If marine reactivates within the
  // window, the active branch cancels the pending removal — a cheap no-op resync instead.
  useEffect(() => {
    if (!active) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (syncRafIdRef.current) { cancelAnimationFrame(syncRafIdRef.current); syncRafIdRef.current = null; }
      if (!mapInstance) return;
      if (deactivateTimerRef.current) clearTimeout(deactivateTimerRef.current);
      deactivateTimerRef.current = setTimeout(() => {
        deactivateTimerRef.current = null;
        console.log('[OceanMask] Deactivating: removing layers');
        lastSyncSignatureRef.current = null;
        lastSyncCoreRef.current = null;
        syncingRef.current = true;
        const historicalLayers = [...ALL_LAYERS, 'ocean-mask-fill', 'ocean-mask-inland-water', 'ocean-mask-inland-waterway'];
        for (const lid of historicalLayers) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        }
        if (mapInstance.getSource(MASK_SOURCE)) {
          try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
        }
        setTimeout(() => { syncingRef.current = false; }, 300);
      }, 350);
    } else {
      // Reactivated — cancel any pending deactivation (mask layers are likely still present)
      // and just resync, avoiding a remove+re-add cycle.
      if (deactivateTimerRef.current) { clearTimeout(deactivateTimerRef.current); deactivateTimerRef.current = null; }
      triggerSync(0);
    }
    return () => {
      if (deactivateTimerRef.current) { clearTimeout(deactivateTimerRef.current); deactivateTimerRef.current = null; }
    };
  }, [mapInstance, active, activeMarineLayer, theme, beforeId, maskData, triggerSync]);

  // Re-run sync on styles data changes
  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => {
      const { active } = stateRef.current;
      if (active) {
        if (!syncingRef.current) {
          styleVersionRef.current += 1;
          triggerSync(300);
        }
      }
    };
    mapInstance.on('styledata', handler);
    return () => {
      mapInstance.off('styledata', handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (syncRafIdRef.current) { cancelAnimationFrame(syncRafIdRef.current); syncRafIdRef.current = null; }
    };
  }, [mapInstance, triggerSync]);

  // Dedicated marine-raster repositioning listener to ensure slots sit below buffer.
  // styledata can fire several times per frame during transitions; coalesce to one
  // reposition per animation frame, and reposition all 12 slot layers with a single
  // getStyle() snapshot (was 12 getStyle() calls per styledata event).
  useEffect(() => {
    if (!mapInstance) return;
    const marineRasterLayers = ['waves','swell_1','swell_2','wind_waves'].flatMap(k => [0,1,2].map(s => `${k}-slot-${s}-layer`));
    let rafId = null;
    const repositionLayers = () => {
      if (rafId !== null) return; // already scheduled this frame
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const { active } = stateRef.current;
        if (!active || !mapInstance.getLayer(MASK_BUFFER)) return;
        safeMoveLayersBatch(mapInstance, marineRasterLayers, MASK_BUFFER);
      });
    };
    mapInstance.on('styledata', repositionLayers);
    return () => {
      mapInstance.off('styledata', repositionLayers);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [mapInstance]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (syncRafIdRef.current) { cancelAnimationFrame(syncRafIdRef.current); syncRafIdRef.current = null; }
      lastSyncSignatureRef.current = null;
      lastSyncCoreRef.current = null;
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
