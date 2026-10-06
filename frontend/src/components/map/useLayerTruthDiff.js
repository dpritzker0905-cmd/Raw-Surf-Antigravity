import { useEffect, useRef, useState } from 'react';
import { marineEmptyVerdict } from './marineEmptyGrace';

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
  // W-32: when the current "marine active, no vectors" spell began, and the one re-check that fires
  // when its grace ends (a map that goes idle would otherwise never look again). See marineEmptyGrace.
  const marineEmptySinceRef = useRef(null);
  const marineEmptyTimerRef = useRef(null);

  useEffect(() => {
    if (!mapInstance) return;
    let disposed = false, frameTimer = null, moveEndTimer = null;
    let lastFrameCheck = performance.now();
    const cancelFrameCheck = () => {
      if (frameTimer !== null) clearTimeout(frameTimer);
      frameTimer = null;
    };

    const captureSnapshot = (label) => {
      if (disposed) return;
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
        // B2 (audit #19): rules must see EVERY active layer, not just the first —
        // multi-layer states were only partially checked.
        activeLayersAll: Array.isArray(activeLayers) ? [...activeLayers] : [],
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
      // Suppress WIND_DATA_EMPTY while a wind fetch is in flight (mirror of RULE 3's transition
      // suppression): the window between layer activation and first commit is DESIGNED to be
      // empty — flagging it fired on every activation/model switch (user log 07-10) and trains
      // readers to ignore the detector. WIND_TOPOLOGY_INVALID stays unsuppressed (data present
      // with wrong shape is always real).
      const isWindFetchPending = typeof window !== 'undefined' && (window.__WIND_FETCH_PENDING__ || 0) > 0;
      if (s.activeLayersAll.includes("wind")) {
        if (!s.wind?.vectors?.length && !isWindFetchPending) {
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
      const activeMarineLayers = ["waves","swell_1","swell_2","wind_waves"].filter(l => s.activeLayersAll.includes(l));
      // W-32: the flags above clear in the fetch's `finally`, ~0.7 s before the grid commits, so the
      // condition must HOLD for the grace before it is a violation (marineEmptyGrace.js).
      const emptyVerdict = marineEmptyVerdict({
        empty: activeMarineLayers.length > 0 && !s.marine?.grid?.vectors?.length,
        transitioning: isTransitioning,
        since: marineEmptySinceRef.current,
        now: Date.now(),
        disabled: typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_EMPTY_GRACE__ === true,
      });
      marineEmptySinceRef.current = emptyVerdict.since;
      if (emptyVerdict.recheckInMs !== null && !marineEmptyTimerRef.current) {
        marineEmptyTimerRef.current = setTimeout(() => {
          marineEmptyTimerRef.current = null;
          captureSnapshot("empty-grace");
        }, emptyVerdict.recheckInMs + 50);
      }
      if (emptyVerdict.report) {
        violations.push({
          layerId: activeMarineLayers[0],
          type: "MARINE_EMPTY_RENDER",
          hint: "Marine layer active but no vector data present"
        });
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
            // Downgraded from emoji console.groupCollapsed to quiet debug log.
            // B1 (audit #19): NOT dev-gated — prod builds were silent, so violations never appeared
            // in shared live logs. Fires only when violations exist and stays 250ms-batched.
            console.debug(`[TruthDiff] ${violationBufferRef.current.length} violation(s):`,
              violationBufferRef.current.map(v => `${v.type}:${v.layerId}`));
            violationBufferRef.current = [];
          }, 250);
        }
      }
      
      return violations;
    }

    // MapLibre may emit idle after EACH animated custom-layer render. Both events must share
    // the style-serialization budget; throttling render alone leaves idle doing frame-rate work.
    const inspectFrame = label => {
      if (disposed) return;
      if (typeof window !== 'undefined' && window.isScrubbingTimeline) return;
      const now = performance.now();
      const remaining = 250 - (now - lastFrameCheck);
      if (remaining <= 0) {
        cancelFrameCheck();
        lastFrameCheck = now;
        captureSnapshot(label);
      } else if (label === 'idle' && frameTimer === null) {
        // A final settled idle still gets checked even if no subsequent frame is requested.
        frameTimer = setTimeout(() => {
          frameTimer = null;
          inspectFrame('idle');
        }, remaining);
      }
    };
    const onRender = () => inspectFrame('render');
    const onIdle = () => inspectFrame('idle');
    const onMoveEnd = () => {
      if (moveEndTimer !== null) clearTimeout(moveEndTimer);
      moveEndTimer = setTimeout(() => {
        moveEndTimer = null;
        cancelFrameCheck();
        lastFrameCheck = performance.now();
        captureSnapshot('post-moveend');
      }, 100);
    };

    mapInstance.on("render", onRender);
    mapInstance.on("idle", onIdle);
    mapInstance.on("moveend", onMoveEnd);

    // Initial capture
    captureSnapshot("mount/update");

    return () => {
      disposed = true;
      cancelFrameCheck();
      if (moveEndTimer !== null) clearTimeout(moveEndTimer);
      mapInstance.off("render", onRender);
      mapInstance.off("idle", onIdle);
      mapInstance.off("moveend", onMoveEnd);
      // The re-check closes over THIS effect's captureSnapshot; the next run arms its own.
      if (marineEmptyTimerRef.current) {
        clearTimeout(marineEmptyTimerRef.current);
        marineEmptyTimerRef.current = null;
      }
    };
  }, [mapInstance, activeLayers, activeRenderType, windData, marineData]);

  // Export raster visibility from the latest snapshot
  const latestSnapshot = historyRef.current[historyRef.current.length - 1];
  const rasterVisible = latestSnapshot?.visibleRasterSources?.length > 0 || false;

  return { issues, rasterVisible };
}
