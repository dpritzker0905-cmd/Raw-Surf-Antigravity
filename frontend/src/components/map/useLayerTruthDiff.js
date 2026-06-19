import { useEffect, useRef, useState } from 'react';

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

/**
 * v249 DEBUG MODE v2 (Hard Truth Inspector)
 * 
 * Replaces the reactive diff checker with a state-locked, frame-synchronized 
 * truth validator. Evaluates causal violations like identity collisions 
 * across the shared raster source lifecycle.
 */
export function useLayerTruthDiff({ mapInstance, activeLayers, activeRenderType, windData, marineData }) {
  const [issues, setIssues] = useState([]);
  const historyRef = useRef([]);
  const violationBufferRef = useRef([]);
  const mountTimeRef = useRef(Date.now());
  // Throttle render event to avoid 60fps getStyle() serialization penalty
  const lastRenderCheck = useRef(0);

  useEffect(() => {
    if (!mapInstance) return;

    const captureSnapshot = (label) => {
      let style;
      try {
        style = mapInstance.getStyle();
      } catch (e) {
        return; // Map not fully initialized
      }

      const snapshot = {
        t: performance.now(),
        label,

        // declared app state
        activeLayer: activeLayers[0],
        activeRenderType,

        // map reality
        mapLayers: style?.layers?.map(l => ({
          id: l.id,
          type: l.type,
          source: l.source,
          visibility: mapInstance.getLayoutProperty(l.id, 'visibility') || 'visible'
        })) || [],

        // computed truths
        visibleRasterSources: (style?.layers || [])
          .filter(l => l.type === 'raster')
          .filter(l => (mapInstance.getLayoutProperty(l.id, 'visibility') || 'visible') !== 'none')
          .map(l => l.source),

        wind: windData,
        marine: marineData,
      };

      historyRef.current.push(snapshot);
      if (historyRef.current.length > 50) historyRef.current.shift();

      const violations = validateSnapshot(snapshot);
      
      // Update React state for debug overlay without infinite loop
      // v249: Use functional state update to prevent breaking array identity
      // when the issues list is empty, which causes React-Map-GL <Source> to thrash
      setIssues(prev => {
        if (prev.length === 0 && violations.length === 0) return prev;
        if (JSON.stringify(prev) === JSON.stringify(violations)) return prev;
        return violations;
      });
      return snapshot;
    };

    function validateSnapshot(s) {
      const violations = [];

      // RULE 1: Only ONE overall weather raster family visible at a time
      // Filter to only our custom sources (they all end with '-source') and ignore the base satellite layer
      const visibleRasters = s.visibleRasterSources.filter(src => 
        typeof src === 'string' && src.endsWith('-source') && src !== 'satellite-source' && src !== 'esri-satellite-source'
      );
      // Group by base layer family (e.g. 'wind', 'waves', 'pressure') to prevent false alerts on slot preloading
      const baseFamilies = Array.from(new Set(visibleRasters.map(src => src.split('-')[0])));
      if (baseFamilies.length > 1) {
        violations.push({
          layerId: s.activeLayer,
          type: "RASTER_OVERLAP",
          sources: visibleRasters,
          hint: `Multiple raster families visible: ${baseFamilies.join(', ')}`
        });
      }

      // RULE 2: wind must have vectors OR be OFF
      if (s.activeLayer === "wind") {
        if (!s.wind?.vectors?.length) {
          violations.push({
            layerId: "wind",
            type: "WIND_DATA_EMPTY",
            hint: "Wind layer active but no vector data present"
          });
        }

        if (s.wind?.cols && s.wind?.rows && s.wind?.vectors &&
            s.wind.vectors.length !== s.wind.cols * s.wind.rows) {
          violations.push({
            layerId: "wind",
            type: "WIND_TOPOLOGY_INVALID",
            cols: s.wind.cols,
            rows: s.wind.rows,
            vectors: s.wind.vectors.length,
            hint: "Vector array size does not match expected interpolation matrix dimensions"
          });
        }
      }

      // RULE 3: marine must NEVER render empty when active
      // Suppress during model/layer transitions — data is expected to be temporarily empty
      // while the pipeline fetches new data from the switched model.
      // Check all three pipeline flags (matching WebGLMarineCustomLayer's suppression logic):
      // - __MARINE_TRANSITIONING__: set immediately on model/layer switch
      // - __MARINE_FETCH_PENDING__: set when a fetch is queued
      // - __MARINE_FETCH_DEBOUNCING__: set during the scheduling debounce window
      const isTransitioning = typeof window !== 'undefined' && (
        window.__MARINE_TRANSITIONING__ === true ||
        !!window.__MARINE_FETCH_PENDING__ ||
        !!window.__MARINE_FETCH_DEBOUNCING__
      );
      if (["waves","swell_1","swell_2","wind_waves"].includes(s.activeLayer)) {
        if (!s.marine?.grid?.vectors?.length && !isTransitioning) {
          violations.push({
            layerId: s.activeLayer,
            type: "MARINE_EMPTY_RENDER",
            hint: "Marine layer active but no vector data present"
          });
        }
      }

      // RULE 4: raster layers must never share same visible source
      const rasterLayers = s.mapLayers.filter(l => l.type === 'raster');
      const rasterGroups = groupBy(rasterLayers, l => l.source);

      Object.entries(rasterGroups).forEach(([source, layers]) => {
        if (!source || source === 'undefined') return;
        const visible = layers.filter(l => l.visibility !== "none");
        if (visible.length > 1) {
          violations.push({
            layerId: s.activeLayer,
            type: "SOURCE_MISMATCH_FLASH",
            source,
            layers: visible.map(l => l.id),
            hint: "Multiple layers are sharing the same visible raster source"
          });
        }
      });

      if (violations.length) {
 // v3.8.5: Suppress during bootstrap (first 3s) data hasn't loaded yet
        if (Date.now() - mountTimeRef.current < 3000) return violations;

        violations.forEach(v => {
          violationBufferRef.current.push(v);
        });

        if (violationBufferRef.current.length === violations.length) {
          setTimeout(() => {
            if (!violationBufferRef.current.length) return;
            // Downgraded from emoji console.groupCollapsed to quiet debug log
            if (process.env.NODE_ENV === 'development') {
              console.debug(`[TruthDiff] ${violationBufferRef.current.length} violation(s):`,
                violationBufferRef.current.map(v => `${v.type}:${v.layerId}`));
            }
            violationBufferRef.current = [];
          }, 250);
        }
      }
      
      return violations;
    }

    // Attach listeners
    const onRender = () => {
      const now = performance.now();
      if (now - lastRenderCheck.current > 250) { // Throttle to 4fps for debug checks to save CPU
        lastRenderCheck.current = now;
        captureSnapshot("render");
      }
    };
    const onIdle = () => captureSnapshot("idle");
    const onMoveEnd = () => setTimeout(() => captureSnapshot("post-moveend"), 100);

    mapInstance.on("render", onRender);
    mapInstance.on("idle", onIdle);
    mapInstance.on("moveend", onMoveEnd);

    // Initial capture
    captureSnapshot("mount/update");

    return () => {
      mapInstance.off("render", onRender);
      mapInstance.off("idle", onIdle);
      mapInstance.off("moveend", onMoveEnd);
    };
  }, [mapInstance, activeLayers, activeRenderType, windData, marineData]);

  // Export raster visibility from the latest snapshot
  const latestSnapshot = historyRef.current[historyRef.current.length - 1];
  const rasterVisible = latestSnapshot?.visibleRasterSources?.length > 0 || false;

  return { issues, rasterVisible };
}
