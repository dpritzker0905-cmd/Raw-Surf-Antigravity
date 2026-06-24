import { useMemo, useRef } from 'react';
import { isGridLayerSupported } from './marineControllerUtils';
import { markDisplayed } from './marineTransitionCoordinator';

function getLongitudinalOverlap(w1, e1, w2, e2) {
  const vpWidth = (e1 < w1) ? (e1 + 360) - w1 : e1 - w1;
  if (vpWidth >= 360.0 - 1e-5) {
    return (e2 < w2) ? (e2 + 360) - w2 : e2 - w2;
  }
  const norm = lng => ((lng % 360) + 360) % 360;
  const nw1 = norm(w1), ne1 = norm(e1);
  const nw2 = norm(w2), ne2 = norm(e2);
  const getSegments = (s, e) => s <= e ? [[s, e]] : [[s, 360], [0, e]];
  const segs1 = getSegments(nw1, ne1);
  const segs2 = getSegments(nw2, ne2);
  let overlap = 0;
  for (const seg1 of segs1) {
    for (const seg2 of segs2) {
      const start = Math.max(seg1[0], seg2[0]);
      const end = Math.min(seg1[1], seg2[1]);
      if (start < end) overlap += (end - start);
    }
  }
  return overlap;
}

// Max time the heatmap may keep displaying the PREVIOUS model's frame while a model switch is
// in flight. The hold prevents a flash on fast switches, but an UNBOUNDED hold (the new model's
// fetch is slow on the 1-CPU backend) shows the wrong model's heatmap for seconds — the "every
// model shows the same heatmap" report. After this, stop holding so a stale wrong-model frame is
// never presented as current truth (blank + infobox "updating" instead). Layer-only mismatches
// (same model, e.g. swell switch) are NOT capped — they resolve fast and never mislabel the model.
const CROSS_MODEL_HOLD_MS = 1500;

export function useMarineWindData({ marineData, activeMarineLayer, activeModel, timeOffsetHours, mapInstance, viewState }) {
  const lastValidDataRef = useRef(null);
  // Identity of the frame held in lastValidDataRef, so a held frame is never reclassified
  // as the newly-selected target. When we hand back a held frame during a transition we
  // report THIS identity (the previous target) to the coordinator, not the requested one.
  const lastValidKeyRef = useRef(null);
  // Timestamp when the current cross-MODEL hold began (0 = not currently holding a wrong-model
  // frame). Used to cap the hold at CROSS_MODEL_HOLD_MS.
  const crossModelHoldSinceRef = useRef(0);

  // Hand back the held frame for rendering (better than a blank heatmap) while telling the
  // coordinator the screen still shows the PREVIOUS identity — the infobox parity gate then
  // shows "updating" instead of relabeling old values as the new model/layer/hour.
  const returnHeld = () => {
    if (lastValidKeyRef.current) markDisplayed(lastValidKeyRef.current);
    return lastValidDataRef.current;
  };

  // 1. Memoize the conformed vectors so they are only re-mapped when the underlying grid/layer/model changes.
  const conformedGridBase = useMemo(() => {
    if (!marineData?.grid?.vectors || !activeMarineLayer) {
      return null;
    }

    const hasEstimatedGrid = marineData?.grid?.__gridProvider === 'estimated' &&
                             marineData?.grid?.__gridSupportsLayer === true &&
                             marineData?.grid?.__componentLayer === activeMarineLayer &&
                             (activeModel === 'EURO' || activeModel === 'ICON');

    const isGridEstimated = marineData?.grid?.is_estimated || marineData?.grid?.isEstimated || marineData?.is_estimated || marineData?.isEstimated || false;

    const hasCopernicusGrid = ((['copernicus', 'backend-weather-service', 'test-fixture', 'open-meteo'].includes(marineData?.grid?.__gridProvider)) &&
                              marineData?.grid?.__gridSupportsLayer === true &&
                              marineData?.grid?.__componentLayer === activeMarineLayer &&
                              activeModel === 'EURO') || hasEstimatedGrid ||
                              ((['gfs_estimated_backdrop', 'gfs_estimated_fallback'].includes(marineData?.grid?.__gridProvider)) &&
                               marineData?.grid?.__gridSupportsLayer === true &&
                               marineData?.grid?.__componentLayer === activeMarineLayer &&
                               activeModel === 'EURO') ||
                              ((['open-meteo', 'estimated'].includes(marineData?.grid?.__gridProvider)) &&
                               activeModel === 'EURO' &&
                               (activeMarineLayer === 'waves' || isGridEstimated));

    const layerSupported = isGridLayerSupported(activeModel, activeMarineLayer) || hasCopernicusGrid;
    const vectors = marineData.grid.vectors.map(v => {
      // Only fall back to 'waves' if the model's GRID natively supports this layer.
      // For unsupported grid layers (EURO swell/wind_waves), use the layer's own data
      // (zeroed from API) to avoid rendering a misleading heatmap.
      const hasFlat = v && typeof v.speed === 'number' && typeof v.u === 'number';
      const hasSubData = activeMarineLayer && v && v[activeMarineLayer];
      
      // Prioritize specific sub-layer data (e.g. swell_1, wind_waves) over top-level conjoined wave data
      const layerData = hasSubData
        ? v[activeMarineLayer]
        : (hasFlat
            ? v
            : (layerSupported
                ? (v[activeMarineLayer] || v['waves'])
                : v[activeMarineLayer])); // no fallback — will be {u:0,v:0,speed:0}
                
      return {
        lat: v.lat,
        lng: v.lng,
        u: layerData?.u || 0,
        v: layerData?.v || 0,
        speed: layerData?.speed || 0,
        period: layerData?.period || 0,
        height: layerData?.height !== undefined ? layerData.height : (layerData?.speed || 0),
        direction: layerData?.direction !== undefined ? layerData.direction : undefined,
        isOcean: v.isOcean,
        [activeMarineLayer]: layerData
      };
    });

    let nonzeroCount = 0, maxHeight = 0;
    for (const v of vectors) {
      if (v.speed > 0) { nonzeroCount++; if (v.speed > maxHeight) maxHeight = v.speed; }
    }

    return {
      bounds: marineData.grid.bounds,
      cols: marineData.grid.cols,
      rows: marineData.grid.rows,
      vectors,
      // Truthful data origin: the model the grid was actually built for, NOT the currently
      // selected activeModel. During a transition the stale frame keeps its real source so it
      // is never relabeled as the new target (and model mismatch can actually be detected —
      // previously this was always activeModel, so the model-mismatch check was dead code).
      __sourceModel: marineData?.grid?.__sourceModel || marineData?.__sourceModel || marineData?.model || activeModel,
      __provider: marineData?.grid?.provider || 'unknown',
      __gridProvider: marineData?.grid?.__gridProvider || marineData?.grid?.provider || 'none',
      __componentLayer: marineData?.grid?.__componentLayer || 'none',
      __gridSupportsLayer: layerSupported,
      is_estimated: isGridEstimated,
      isEstimated: isGridEstimated,
      provider: marineData?.provider || marineData?.grid?.provider || null,
      source_dataset: marineData?.source_dataset || marineData?.grid?.source_dataset || null,
      estimate_basis: marineData?.estimate_basis || marineData?.grid?.estimate_basis || null,
      productId: marineData.grid.productId || marineData.productId || null,
      is_dynamic_viewport_product: marineData.grid.is_dynamic_viewport_product || false,
      coverage_scope: marineData.grid.coverage_scope || null,
      activeMarineLayer,
      activeModel,
      valid_time: marineData.valid_time || marineData.grid.valid_time,
      validTime: marineData.validTime || marineData.grid.validTime,
      run_time: marineData.run_time || marineData.grid.run_time || marineData.runTime || marineData.grid.runTime || null,
      runTime: marineData.run_time || marineData.grid.run_time || marineData.runTime || marineData.grid.runTime || null,
      truthTag: marineData.truthTag || marineData.grid.truthTag || null,
      __nonzeroCount: nonzeroCount,
      __maxHeight: maxHeight,
      hasCopernicusGrid,
      isEuroComponent: activeModel === 'EURO' && ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(activeMarineLayer)
    };
  }, [marineData, activeMarineLayer, activeModel]);

  // 2. Perform the lightweight viewport bounds and overlap checks.
  return useMemo(() => {
    if (!conformedGridBase) {
      // v8.0: During transitions, preserve last valid data to prevent heatmap flash-clearing
      const isTransitioningEarly = typeof window !== 'undefined' && (
        !!window.__MARINE_TRANSITIONING__ ||
        !!window.__MARINE_FETCH_PENDING__ ||
        !!window.__MARINE_FETCH_DEBOUNCING__
      );
      if (isTransitioningEarly && lastValidDataRef.current) {
        return returnHeld();
      }
      lastValidDataRef.current = null;
      lastValidKeyRef.current = null;
      return null;
    }

    const isTransitioning = typeof window !== 'undefined' && (
      !!window.__MARINE_TRANSITIONING__ || 
      !!window.__MARINE_FETCH_PENDING__ || 
      !!window.__MARINE_FETCH_DEBOUNCING__
    );

    // Verify viewport overlap ratio to prevent clamped regional grid rendering
    if (mapInstance && conformedGridBase.bounds) {
      const isGlobalGrid = Math.abs(conformedGridBase.bounds.east - conformedGridBase.bounds.west) >= 350;
      if (!isGlobalGrid) {
        const gw = conformedGridBase.bounds.west, ge = conformedGridBase.bounds.east, gs = conformedGridBase.bounds.south, gn = conformedGridBase.bounds.north;
        const gridWidth = (ge < gw) ? (ge + 360) - gw : ge - gw;
        // EURO has a global (estimated) product for ALL marine components — not just waves —
        // so a regional EURO grid (e.g. a Florida tile fetched while zoomed in) must be
        // rejected when zoomed out instead of rendering as a clamped rectangle. Previously
        // only EURO waves was treated as global-supported, so EURO swell/wind_waves clamped.
        const isGlobalSupported = (activeModel === 'GFS' || activeModel === 'ICON' || activeModel === 'EURO');
        try {
          const mb = mapInstance.getBounds();
          const ew = mb.getWest(), ee = mb.getEast(), es = mb.getSouth(), en = mb.getNorth();
          
          const overlapWidth = getLongitudinalOverlap(ew, ee, gw, ge);
          const intSouth = Math.max(es, gs);
          const intNorth = Math.min(en, gn);
          
          let overlapRatio = 0;
          if (overlapWidth > 0 && intSouth < intNorth) {
            const intersectionArea = overlapWidth * (intNorth - intSouth);
            const vpWidth = (ee < ew) ? (ee + 360) - ew : ee - ew;
            const viewportArea = vpWidth * (en - es);
            if (viewportArea > 0) {
              overlapRatio = intersectionArea / viewportArea;
            }
          }
          const vpWidth = (ee < ew) ? (ee + 360) - ew : ee - ew;
          const vpHeight = en - es;

          const currentZoom = viewState?.zoom ?? mapInstance.getZoom();
          const isViewportZoomedOut = (currentZoom <= 6.5) || (vpWidth > 15.0 || vpHeight > 15.0);

          const isGridRegional = gridWidth < 340.0;
          let isContained = true;
          if (isGridRegional) {
            let vWest = ew;
            let vEast = ee;
            if (vEast < vWest) vEast += 360;

            let gWest = gw;
            let gEast = ge;
            if (gEast < gWest) gEast += 360;

            isContained = es >= gs && en <= gn && vWest >= gWest && vEast <= gEast;
          }

          let shouldReject = false;
          if (isGridRegional) {
            shouldReject = isGlobalSupported
              ? (isViewportZoomedOut ? (!isContained || gridWidth < 340.0 || overlapRatio < 0.15) : (overlapWidth <= 0 || intSouth >= intNorth))
              : (overlapWidth <= 0 || intSouth >= intNorth);

            const canBypassRegionalRejection = !isViewportZoomedOut || !isGlobalSupported;
            if ((conformedGridBase.__isAcceptableRegional || gridWidth < 340.0) && canBypassRegionalRejection) {
              shouldReject = isGlobalSupported
                ? (isViewportZoomedOut ? (!isContained || overlapWidth <= 0 || intSouth >= intNorth) : (overlapWidth <= 0 || intSouth >= intNorth))
                : (overlapWidth <= 0 || intSouth >= intNorth);
            }
          } else {
            shouldReject = (overlapWidth <= 0 || intSouth >= intNorth);
          }

          if (shouldReject) {
            // Don't HOLD a regional grid that's being rejected because we zoomed out — holding it
            // renders it as a clamped rectangle (the brief post-scrub clamp on zoom-out: a scrub
            // leaves __MARINE_TRANSITIONING__ true, so this held path fired and re-showed the
            // regional grid clamped). Return blank until the global grid loads instead. Still hold
            // for other rejections (genuine transition flash prevention).
            const isZoomedOutRegionalReject = isGridRegional && isGlobalSupported && isViewportZoomedOut;
            if (isTransitioning && lastValidDataRef.current && !isZoomedOutRegionalReject) {
              return returnHeld();
            }
            if (typeof window !== 'undefined') {
              window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
                hasData: true,
                hasGrid: true,
                overlapRatio,
                mismatch: true,
                mismatchReason: isGlobalSupported && isViewportZoomedOut && gridWidth < 340.0
                  ? `Grid is smaller than global threshold (gridWidth: ${gridWidth.toFixed(1)} < 340.0)`
                  : (overlapWidth <= 0 || intSouth >= intNorth)
                    ? `Regional grid is completely outside viewport bounds`
                    : `Viewport moved away from regional grid bounds (overlap: ${overlapRatio.toFixed(2)} < 0.15)`,
                timestamp: new Date().toISOString()
              };
              window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_DISPLAY_SOURCE_DIAG__;
            }
            lastValidDataRef.current = null;
            return null;
          }
        } catch (e) {
          // ignore mapInstance getBounds errors, but apply zoom-based fallback
          const currentZoom = viewState?.zoom ?? mapInstance.getZoom();
          if (currentZoom <= 6.5 && isGlobalSupported && gridWidth < 340.0) {
            lastValidDataRef.current = null;
            return null;
          }
        }
      }
    }

    if (marineData.__renderable === false || marineData.grid?.__renderable === false) {
      if (marineData.__unsupportedLayer || marineData.grid?.__unsupportedLayer) {
        return {
          bounds: conformedGridBase.bounds,
          cols: 0,
          rows: 0,
          vectors: [],
          __unsupportedLayer: true,
          __renderable: false,
          __sourceModel: activeModel,
          __gridProvider: 'none',
          __componentLayer: activeMarineLayer,
          __gridSupportsLayer: false
        };
      }
      // v8.0: During transitions (fetch pending, abort recovery), preserve stale heatmap
      // instead of returning null which triggers WebGL clearBuffers and visual flash
      const isSameTarget = lastValidKeyRef.current &&
                           lastValidKeyRef.current.model === activeModel &&
                           lastValidKeyRef.current.layer === activeMarineLayer;
      if ((isTransitioning || isSameTarget) && lastValidDataRef.current) {
        return returnHeld();
      }
      return null;
    }

    const isMismatch = conformedGridBase.__sourceModel !== activeModel ||
                       (conformedGridBase.__componentLayer && conformedGridBase.__componentLayer !== activeMarineLayer);

    if (isMismatch) {
      if (typeof window !== 'undefined') {
        window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
          hasData: !!marineData,
          hasGrid: !!marineData?.grid,
          gridProvider: conformedGridBase.__gridProvider,
          componentLayer: conformedGridBase.__componentLayer || 'none',
          activeMarineLayer,
          activeModel,
          isEuroComponent: conformedGridBase.isEuroComponent,
          hasCopernicusGrid: false,
          mismatch: true,
          mismatchReason: conformedGridBase.__sourceModel !== activeModel
            ? `Model mismatch: activeModel is ${activeModel} but grid sourceModel is ${conformedGridBase.__sourceModel || 'none'}`
            : `Layer mismatch: active layer is ${activeMarineLayer} but grid componentLayer is ${conformedGridBase.__componentLayer || 'none'}`,
          timestamp: new Date().toISOString()
        };
        window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_DISPLAY_SOURCE_DIAG__;
      }
      // Hold the previous frame ONLY while a transition is in flight. Outside a transition a
      // model/layer mismatch is a genuine error, not a transient — returning stale data then
      // would silently present old values as current truth.
      if (isTransitioning && lastValidDataRef.current) {
        // Cap the hold for a MODEL mismatch (held frame is a DIFFERENT model than selected) so a
        // slow model switch can't keep displaying the wrong model's heatmap indefinitely — the
        // "every model shows the same heatmap" report. A layer-only mismatch (same model) is not
        // capped (resolves fast, never mislabels the model).
        const isModelMismatch = conformedGridBase.__sourceModel !== activeModel;
        if (isModelMismatch) {
          if (!crossModelHoldSinceRef.current) crossModelHoldSinceRef.current = Date.now();
          if (Date.now() - crossModelHoldSinceRef.current > CROSS_MODEL_HOLD_MS) {
            return null; // stop displaying the previous model's frame; show loading/blank instead
          }
        }
        return returnHeld();
      }
      return null;
    }
    // Reached only when the grid's model AND layer match the selection — clear any cross-model
    // hold timer so the next model switch gets a fresh hold window.
    crossModelHoldSinceRef.current = 0;

    if (conformedGridBase.isEuroComponent && !conformedGridBase.hasCopernicusGrid) {
      if (typeof window !== 'undefined') {
        window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
          hasData: !!marineData,
          hasGrid: !!marineData?.grid,
          gridProvider: conformedGridBase.__gridProvider,
          componentLayer: conformedGridBase.__componentLayer || 'none',
          activeMarineLayer,
          activeModel,
          isEuroComponent: conformedGridBase.isEuroComponent,
          hasCopernicusGrid: false,
          mismatch: true,
          mismatchReason: `EURO component layer ${activeMarineLayer} requested but Copernicus grid componentLayer is ${conformedGridBase.__componentLayer || 'none'}`,
          timestamp: new Date().toISOString()
        };
        window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_DISPLAY_SOURCE_DIAG__;
      }
      // Hold the previous frame ONLY during a transition (see model/layer mismatch note above).
      if (isTransitioning && lastValidDataRef.current) {
        return returnHeld();
      }
      return null;
    }

    const res = {
      ...conformedGridBase,
      hourOffset: marineData.grid.hourOffset !== undefined ? marineData.grid.hourOffset : timeOffsetHours,
    };

    const upstreamRenderable = marineData?.grid?.__renderable !== false;
    if (res.vectors.length === 0) {
      res.__renderBlockedReason = 'empty_vectors';
      res.__renderable = false;
    } else if (!upstreamRenderable) {
      res.__renderBlockedReason = marineData?.grid?.__noDataReason || 'upstream_not_renderable';
      res.__renderable = false;
    } else if (res.__nonzeroCount === 0) {
      // All-zero guard: a full-shape grid (vectors present) whose every active-layer ocean
      // vector reads exactly 0 is a conformed-empty / no-coverage placeholder, NOT real data —
      // a real forecast grid always carries some signal (the forensic encoder shows min≈0.02m).
      // Without this, such a grid passes as renderable and uploads an all-zero texture that
      // BLANKS the heatmap (the "heatmap cleared on ICON after auto-play scrub" report: a
      // per-hour global fetch starved on the 1-CPU box during auto-play returned max=0.00m).
      // Marking it non-renderable routes it into the hold-stale path below (returnHeld on the
      // same model/layer), so the good frame stays up. NOT terminal: scrub-settle/SWR still
      // retry and recover real data once the backend is idle.
      res.__renderBlockedReason = 'all_zero_grid';
      res.__renderable = false;
    } else {
      res.__renderable = true;
    }

    const isLayerSupported = conformedGridBase.__gridSupportsLayer || (conformedGridBase.__gridProvider !== 'open-meteo' && conformedGridBase.__gridProvider !== 'none');
    if (!isLayerSupported) {
      res.__renderable = false;
      res.__renderBlockedReason = 'unsupported_model_layer';
    }

    if (typeof window !== 'undefined') {
      window.__MARINE_WIND_DATA__ = res.__renderable ? res : null;
      if (res.__renderable) {
        window.__MARINE_WIND_DATA__.__sourceModel = activeModel;
        window.__MARINE_WIND_DATA__.__provider = res.__provider;
      }
      window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
        hasData: true, hasGrid: true, gridProvider: res.__gridProvider,
        componentLayer: res.__componentLayer, activeMarineLayer, activeModel,
        isEuroComponent: res.isEuroComponent, hasCopernicusGrid: res.hasCopernicusGrid,
        nonzeroCount: res.__nonzeroCount, maxHeight: res.__maxHeight,
        renderable: res.__renderable, renderBlockedReason: res.__renderBlockedReason || null,
        activeLayerNonzeroCount: marineData?.grid?.__activeLayerNonzeroCount,
        activeLayerMax: marineData?.grid?.__activeLayerMax,
        oceanMaskCount: marineData?.grid?.__oceanMaskCount,
        heatmapProvider: res.__provider,
        infoboxProvider: (window.__FORECAST_TIMELINE_COVERAGE_DIAG__?.isEstimated) ? 'estimated' : res.__provider,
        timestamp: new Date().toISOString()
      };
      window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_DISPLAY_SOURCE_DIAG__;
    }
    
    if (!res.__renderable) {
      const isSameTarget = lastValidKeyRef.current &&
                           lastValidKeyRef.current.model === activeModel &&
                           lastValidKeyRef.current.layer === activeMarineLayer;
      if ((isTransitioning || isSameTarget) && lastValidDataRef.current) {
        return returnHeld();
      }
      return null;
    }
    // Fresh renderable frame: it passed the mismatch checks above, so its identity IS the
    // currently requested {model, layer, hour}. Tag the held slot and report it as displayed.
    lastValidDataRef.current = res;
    lastValidKeyRef.current = { model: activeModel, layer: activeMarineLayer, hour: res.hourOffset };
    markDisplayed(lastValidKeyRef.current);
    return res;
  }, [conformedGridBase, timeOffsetHours, mapInstance, viewState, marineData]);
}
