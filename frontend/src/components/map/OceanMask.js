/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';
import { findMarineInsertionLayer } from './mapUtils';

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
const MASK_LINE   = 'ocean-mask-line';
const ALL_LAYERS  = [
  MASK_LINE,
  MASK_BUFFER,
  'ocean-mask-fill',
  'ocean-mask-inland-water',
  'ocean-mask-inland-waterway'
];

const THEME_COLORS = {
  dark:  { fill: 'hsl(214, 17%, 31%)', line: 'rgba(0, 0, 0, 0.35)', lw: 1.2 },
  light: { fill: 'hsl(0, 0%, 100%)',   line: 'rgba(0, 0, 0, 0.12)', lw: 0.8 },
  beach: { fill: 'hsl(31, 24%, 91%)',  line: 'rgba(0, 0, 0, 0.18)', lw: 1.0 },
};

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

function resolveFillColor(mapInstance, theme) {
  const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
  return tc.fill;
}

export function OceanMask({ mapInstance, active: propActive, activeMarineLayer, theme, beforeId }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const syncingRef = useRef(false);
  const timeoutRef = useRef(null);

  const active = propActive !== undefined ? propActive : !!activeMarineLayer;

  console.log('[OceanMask] Render:', { active, propActive, activeMarineLayer, theme, hasMaskData: !!maskData });

  // Update a stateRef on every render to completely prevent stale closure races
  const stateRef = useRef({ mapInstance, maskData, active, theme, beforeId });
  useEffect(() => {
    stateRef.current = { mapInstance, maskData, active, theme, beforeId };
  });

  useEffect(() => {
    if (!active) {
      console.log('[OceanMask] Passive; skipping fetch');
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    console.log('[OceanMask] Fetching land mask from CDN:', NE_LAND_URL);
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
  }, [active]);

  const syncLayers = useCallback(() => {
    const { mapInstance, maskData, active, theme, beforeId } = stateRef.current;
    if (!mapInstance || !maskData) {
      console.log('[OceanMask] syncLayers bypassed, no map or no maskData');
      return;
    }

    console.log('[OceanMask] syncLayers running:', { active });

    try {
      const hasBuf  = !!mapInstance.getLayer(MASK_BUFFER);
      const hasLine = !!mapInstance.getLayer(MASK_LINE);
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

        const insertBeforeId = beforeId || findMarineInsertionLayer(mapInstance);
        const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
        const fillColor = tc.fill;

        // Coastline buffer (shifted slightly into the ocean)
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: MASK_SOURCE,
              paint: {
                'line-color': fillColor,
                'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                  1, 4,
                  3, 5,
                  5, 6,
                  7, 6,
                  9, 5,
                  14, 1,
                ],
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, 2,
                  5, 3,
                  9, 2,
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
            mapInstance.setPaintProperty(MASK_BUFFER, 'line-color', fillColor);
          } catch (e) {}
        }

        // Thin aesthetic coastline line
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
            if (insertBeforeId) safeMoveLayer(mapInstance, MASK_LINE, insertBeforeId);
          } catch (e) {}
        }

        // Force active marine raster layers BELOW the MASK_BUFFER layer
        const marineLayers = ['waves-layer', 'swell_1-layer', 'swell_2-layer', 'wind_waves-layer'];
        for (const ml of marineLayers) {
          safeMoveLayer(mapInstance, ml, MASK_BUFFER);
        }
      } else {
        // Active is false: remove all layers immediately and synchronously
        for (const lid of ALL_LAYERS) {
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

  // Handle active state changes immediately and synchronously
  useEffect(() => {
    if (!active) {
      // Immediate synchronous cleanup on deactivation
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (mapInstance) {
        console.log('[OceanMask] Deactivating: removing layers immediately');
        syncingRef.current = true;
        for (const lid of ALL_LAYERS) {
          if (mapInstance.getLayer(lid)) {
            try { mapInstance.removeLayer(lid); } catch (e) {}
          }
        }
        if (mapInstance.getSource(MASK_SOURCE)) {
          try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
        }
        setTimeout(() => { syncingRef.current = false; }, 300);
      }
    } else {
      triggerSync(0);
    }
  }, [mapInstance, maskData, active, theme, beforeId, triggerSync]);

  // Styledata event listener (only runs when active, ignores styledata event storms on deactivation)
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

  // Dedicated marine-raster repositioning listener
  useEffect(() => {
    if (!mapInstance) return;
    const marineRasterLayers = ['waves-layer', 'swell_1-layer', 'swell_2-layer', 'wind_waves-layer'];
    const repositionLayers = () => {
      const { active } = stateRef.current;
      if (!active || !mapInstance.getLayer(MASK_BUFFER)) return;
      for (const ml of marineRasterLayers) {
        safeMoveLayer(mapInstance, ml, MASK_BUFFER);
      }
    };
    mapInstance.on('styledata', repositionLayers);
    return () => mapInstance.off('styledata', repositionLayers);
  }, [mapInstance]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      for (const lid of ALL_LAYERS) {
        try { mapInstance.removeLayer(lid); } catch (e) {}
      }
      try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
