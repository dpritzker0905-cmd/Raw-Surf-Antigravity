import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * v246 Layer Truth Diff Engine
 * 
 * Compares DECLARED layer state (what React thinks is active) against
 * ACTUAL MapLibre state (what's really rendered). Surfaces mismatches
 * as console errors and returns issues for the debug overlay.
 * 
 * This replaces the standalone [Render Pipeline] trace log with a
 * full declared-vs-actual diff, transient state filter, and render snapshot.
 */

// Layer → expected MapLibre layer ID mapping
const LAYER_MAP = {
  precipitation: { layerId: 'om-weather-layer', sourceId: 'om-weather-source', type: 'raster' },
  pressure:      { layerId: 'om-weather-layer', sourceId: 'om-weather-source', type: 'raster' },
  fog:           { layerId: 'om-weather-layer', sourceId: 'om-weather-source', type: 'raster' },
  satellite:     { layerId: 'om-weather-layer', sourceId: 'om-weather-source', type: 'raster' },
  radar:         { layerId: 'radar-layer', sourceId: 'radar-source', type: 'raster' },
  wind:          { layerId: null, sourceId: null, type: 'canvas' },
  waves:         { layerId: 'marine-heatmap-circles', sourceId: 'marine-data-source', type: 'heatmap' },
  swell_1:       { layerId: 'marine-heatmap-circles', sourceId: 'marine-data-source', type: 'heatmap' },
  swell_2:       { layerId: 'marine-heatmap-circles', sourceId: 'marine-data-source', type: 'heatmap' },
  wind_waves:    { layerId: 'marine-heatmap-circles', sourceId: 'marine-data-source', type: 'heatmap' },
};

// Marine layer property keys expected for each layer
const MARINE_PROPERTY_MAP = {
  waves: 'wave_height',
  swell_1: 'swell_wave_height',
  swell_2: 'secondary_swell_wave_height',
  wind_waves: 'wind_wave_height',
};

/**
 * Filter transient MapLibre states where diffs would be false positives
 */
function isTransientState(mapInstance) {
  if (!mapInstance) return true;
  return (
    mapInstance.isMoving?.() ||
    mapInstance.isZooming?.() ||
    mapInstance.areTilesLoaded?.() === false
  );
}

/**
 * Core diff: Compare declared layer state vs actual MapLibre state
 */
function diffLayerTruth(activeLayer, activeRenderType, mapInstance, windData, marineData) {
  if (!mapInstance || !activeLayer) return [];
  if (isTransientState(mapInstance)) return [];

  const issues = [];
  const expected = LAYER_MAP[activeLayer];

  if (!expected) {
    issues.push({ layerId: activeLayer, type: 'UNKNOWN_LAYER', hint: 'Not in LAYER_MAP registry' });
    return issues;
  }

  // --- MapLibre layer checks (raster/heatmap only) ---
  if (expected.layerId) {
    let style;
    try { style = mapInstance.getStyle(); } catch (e) { return []; }
    if (!style) return [];

    const mapLayer = mapInstance.getLayer(expected.layerId);

    if (!mapLayer) {
      issues.push({
        layerId: activeLayer,
        type: 'MISSING_LAYER_IN_MAP',
        expected: expected.layerId,
      });
    } else {
      // Check visibility
      const vis = mapInstance.getLayoutProperty(expected.layerId, 'visibility');
      if (vis === 'none') {
        issues.push({
          layerId: activeLayer,
          type: 'VISIBILITY_MISMATCH',
          expected: 'visible',
          actual: 'none',
          hint: 'Layer exists but is hidden',
        });
      }

      // v248: SOURCE_MISMATCH (Raster Bleed check)
      const actualSource = mapLayer.source;
      if (expected.sourceId && actualSource && actualSource !== expected.sourceId) {
        issues.push({
          layerId: activeLayer,
          type: 'SOURCE_MISMATCH',
          expected: expected.sourceId,
          actual: actualSource,
          hint: 'Render target identity collision (e.g. pressure showing fog)',
        });
      }
    }
  }

  // --- Wind engine checks ---
  if (activeRenderType === 'wind') {
    const canvas = document.getElementById('wind-canvas-layer');
    if (!canvas) {
      issues.push({ layerId: 'wind', type: 'WIND_CANVAS_MISSING', hint: 'Canvas element not found in DOM' });
    } else {
      const opacity = parseFloat(canvas.style.opacity);
      if (opacity <= 0) {
        issues.push({ layerId: 'wind', type: 'WIND_CANVAS_INVISIBLE', opacity, hint: 'Canvas exists but opacity is 0' });
      }
    }

    if (!windData?.vectors?.length) {
      issues.push({ layerId: 'wind', type: 'WIND_DATA_EMPTY', hint: 'No wind vectors — particles will animate in empty space' });
    } else {
      const sample = windData.vectors[0];
      if (sample.u === 0 && sample.v === 0) {
        issues.push({ layerId: 'wind', type: 'WIND_VECTORS_ZERO', hint: 'Wind u/v are both 0 — no particle movement' });
      }
    }
  }

  // --- Marine heatmap checks ---
  if (activeRenderType === 'marine') {
    if (!marineData?.features?.length) {
      issues.push({ layerId: activeLayer, type: 'MARINE_DATA_EMPTY', hint: 'No GeoJSON features — heatmap will show nothing' });
    } else {
      const expectedProp = MARINE_PROPERTY_MAP[activeLayer];
      if (expectedProp) {
        const sample = marineData.features[0]?.properties;
        if (!sample || !(expectedProp in sample)) {
          issues.push({
            layerId: activeLayer,
            type: 'MARINE_PROPERTY_MISSING',
            expected: expectedProp,
            available: sample ? Object.keys(sample) : [],
            hint: 'Heatmap weight references a missing property — will fall back to dots',
          });
        }
      }
    }
  }

  // v248: RASTER FLASH BUG DETECTOR (Concurrent visibility writes)
  try {
    const style = mapInstance.getStyle();
    if (style && style.layers) {
      // Find all layers using om-weather sources
      const rasterLayers = style.layers.filter(l => l.source?.includes('om-weather'));
      const visibleRasterLayers = rasterLayers.filter(l => {
        const vis = mapInstance.getLayoutProperty(l.id, 'visibility');
        // If undefined, Mapbox/MapLibre defaults to 'visible'
        return vis !== 'none';
      });

      if (visibleRasterLayers.length > 1) {
        issues.push({
          layerId: activeLayer,
          type: 'RASTER_LAYER_CONFLICT_FLASHING',
          hint: `Multiple raster layers visible simultaneously (${visibleRasterLayers.map(l => l.id).join(', ')})`,
        });
      }
    }
  } catch (e) {}

  return issues;
}

/**
 * Render snapshot: Full state dump for debugging
 */
function logRenderSnapshot(activeLayer, activeRenderType, mapInstance, windData, marineData) {
  if (!mapInstance) return;

  // v246: Use string formatting for production console (prevents "Object" collapse)
  const lines = [`📸 RENDER SNAPSHOT | ${activeLayer} → ${activeRenderType}`];

  // MapLibre layer visibility
  try {
    const style = mapInstance.getStyle();
    const checked = ['om-weather-layer', 'radar-layer', 'marine-heatmap-circles'];
    const vis = checked.map(id => {
      const exists = style?.layers?.find(l => l.id === id);
      if (!exists) return `${id}:MISSING`;
      const v = mapInstance.getLayoutProperty(id, 'visibility') || 'visible';
      return `${id}:${v}`;
    });
    lines.push(`MAP: ${vis.join(' | ')}`);
  } catch (e) {}

  // Wind state
  const windCanvas = document.getElementById('wind-canvas-layer');
  lines.push(`WIND: canvas=${!!windCanvas} opacity=${windCanvas?.style?.opacity || 'N/A'} vectors=${windData?.vectors?.length || 0} grid=${windData?.grid || 'N/A'}`);

  // Marine state
  const mKeys = marineData?.features?.[0]?.properties
    ? Object.keys(marineData.features[0].properties).join(',')
    : 'none';
  lines.push(`MARINE: features=${marineData?.features?.length || 0} keys=[${mKeys}]`);

  console.log(lines.join('\n'));
}

/**
 * Hook: useLayerTruthDiff
 * 
 * Runs declared-vs-actual diff on layer changes and exposes issues
 * for the debug overlay. Filters transient states to avoid false positives.
 */
export function useLayerTruthDiff({ mapInstance, activeLayers, activeRenderType, windData, marineData }) {
  const [issues, setIssues] = useState([]);
  const lastSnapshotRef = useRef(null);

  const runDiff = useCallback(() => {
    if (!mapInstance) return;

    const activeLayer = activeLayers[0] || null;
    const diffIssues = diffLayerTruth(activeLayer, activeRenderType, mapInstance, windData, marineData);

    setIssues(diffIssues);

    // Log issues if any found
    if (diffIssues.length > 0) {
      console.group('🚨 LAYER TRUTH VIOLATIONS');
      diffIssues.forEach(i => {
        console.error(`[${i.layerId}]`, i.type, i);
      });
      console.groupEnd();
    }

    // Log snapshot on layer change (debounced to avoid spam)
    const snapshotKey = `${activeLayer}-${activeRenderType}`;
    if (snapshotKey !== lastSnapshotRef.current) {
      lastSnapshotRef.current = snapshotKey;
      logRenderSnapshot(activeLayer, activeRenderType, mapInstance, windData, marineData);
    }
  }, [mapInstance, activeLayers, activeRenderType, windData, marineData]);

  // Run diff on layer change (delayed to let MapLibre settle)
  useEffect(() => {
    const t = setTimeout(runDiff, 500);
    return () => clearTimeout(t);
  }, [runDiff]);

  // Run diff after marine data arrives
  useEffect(() => {
    if (marineData?.features?.length) {
      const t = setTimeout(runDiff, 300);
      return () => clearTimeout(t);
    }
  }, [marineData, runDiff]);

  // Run diff after wind data arrives
  useEffect(() => {
    if (windData?.vectors?.length) {
      const t = setTimeout(runDiff, 300);
      return () => clearTimeout(t);
    }
  }, [windData, runDiff]);

  return { issues, runDiff };
}
