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

      // RULE 1: only ONE raster source active at a time (unless it's different sources entirely, but we mostly reuse om-weather-source)
      // Actually, rule 1 is specifically for catching multiple VISIBLE raster layers that shouldn't be.
      // Let's refine this: If we have > 1 om-weather-source visible
      const omSourcesVisible = s.visibleRasterSources.filter(src => src === 'om-weather-source');
      if (omSourcesVisible.length > 1) {
        violations.push({
          layerId: s.activeLayer,
          type: "RASTER_OVERLAP",
          sources: s.visibleRasterSources,
          hint: "Multiple OM weather layers visible simultaneously"
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
      if (["waves","swell_1","swell_2","wind_waves"].includes(s.activeLayer)) {
        if (!s.marine?.features?.length) {
          violations.push({
            layerId: s.activeLayer,
            type: "MARINE_EMPTY_RENDER",
            hint: "Marine layer active but GeoJSON features are empty"
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
        // v250: Batch violations to prevent console spam
        violations.forEach(v => {
          violationBufferRef.current.push(v);
        });

        if (violationBufferRef.current.length === violations.length) {
          setTimeout(() => {
            if (!violationBufferRef.current.length) return;
            console.groupCollapsed(`🚨 TRUTH VIOLATIONS (${violationBufferRef.current.length})`);
            violationBufferRef.current.forEach(v => {
              console.log(v.type, {
                layer: v.layerId,
                details: v.hint,
                topology: v.topology,
                source: v.source,
                ...v
              });
            });
            console.groupEnd();
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

  return { issues };
}
