/* eslint-disable no-empty */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  findMarineInsertionLayer,
  safeMoveLayer,
  safeSetPaintProperty
} from './mapUtils';

/**
 * OceanMask v16 — Premium Coastline Blending & Staircase Resolution.
 *
 * This version completely resolves the land feature occlusion (covered lakes/parks)
 * by removing the solid land fill layer entirely, exactly like the overall working
 * commit f71aa52. 
 *
 * To hide the blocky, coarse GFS wave model staircasing grid lines near coastlines,
 * we use a high-fidelity organic coastline line buffer (ocean-mask-buffer) styled
 * with the theme's land fillColor and a smooth, blurred edge. This perfectly covers
 * GFS grid bleed without bloating the coastlines.
 */

const NE_LAND_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_land.json';

const MASK_SOURCE = 'ocean-mask-source';
const MASK_BUFFER = 'ocean-mask-buffer';
const MASK_LINE   = 'ocean-mask-line';

const ALL_LAYERS = [
  MASK_LINE,
  MASK_BUFFER
];

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

export function OceanMask({ mapInstance, active: propActive, theme, beforeId }) {
  const [maskData, setMaskData] = useState(null);
  const fetchedRef = useRef(false);
  const syncingRef = useRef(false);
  const timeoutRef = useRef(null);

  const active = propActive !== undefined ? propActive : true;

  console.log('[OceanMask] Render:', { active, propActive, theme });

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

    console.log('[OceanMask] syncLayers running:', { active, theme });

    try {
      const hasBuf  = !!mapInstance.getLayer(MASK_BUFFER);
      const hasLine = !!mapInstance.getLayer(MASK_LINE);
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
              tolerance: 0.005, // High fidelity to follow actual coastline shape organically
            });
          } catch (e) {
            console.error('[OceanMask] Failed to add source:', e);
          }
        }

        const insertBeforeId = beforeId || findMarineInsertionLayer(mapInstance);
        const tc = THEME_COLORS[theme] || THEME_COLORS.dark;
        const fillColor = tc.fill;

        // 1. Coastline blending buffer: Moderately wide outline shifted outward from the land.
        // It covers the jagged GFS grid boundary on land without bloated coastlines.
        if (!hasBuf) {
          try {
            mapInstance.addLayer({
              id: MASK_BUFFER,
              type: 'line',
              source: MASK_SOURCE,
              paint: {
                'line-color': fillColor,
                'line-width': ['interpolate', ['exponential', 1.2], ['zoom'],
                  1, 6,
                  3, 10,
                  5, 16,
                  7, 20,
                  9, 24,
                  14, 2,
                  17, 0
                ],
                'line-offset': ['interpolate', ['linear'], ['zoom'],
                  1, 2,
                  3, 4,
                  5, 6,
                  7, 8,
                  9, 10,
                  14, 0
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'],
                  9.0, 1.0,
                  14.0, 0.40,
                  17.0, 0.0
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
            safeSetPaintProperty(mapInstance, MASK_BUFFER, 'line-color', fillColor);
          } catch (e) {}
        }

        // 2. Thin aesthetic coastline boundary outline
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
                  17, 0.0
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

  // Handle active state changes immediately and synchronously to clean up on toggling off
  useEffect(() => {
    if (!active) {
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

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      for (const lid of ALL_LAYERS) {
        try { mapInstance.removeLayer(lid); } catch (e) {}
      }
      try { mapInstance.removeSource(MASK_SOURCE); } catch (e) {}
    };
  }, [mapInstance]);

  return null;
}

export default OceanMask;
