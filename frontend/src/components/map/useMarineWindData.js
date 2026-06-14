import { useMemo, useRef } from 'react';
import { isGridLayerSupported } from './marineControllerUtils';

export function useMarineWindData({ marineData, activeMarineLayer, activeModel, timeOffsetHours, mapInstance, viewState }) {
  const lastValidDataRef = useRef(null);

  return useMemo(() => {
    if (!marineData?.grid?.vectors || !activeMarineLayer) {
      lastValidDataRef.current = null;
      return null;
    }

    // Verify viewport overlap ratio to prevent clamped regional grid rendering
    if (mapInstance && marineData?.grid?.bounds) {
      const g = marineData.grid;
      const isGlobalGrid = Math.abs(g.bounds.east - g.bounds.west) >= 350;
      if (!isGlobalGrid) {
        try {
          const mb = mapInstance.getBounds();
          const ew = mb.getWest(), ee = mb.getEast(), es = mb.getSouth(), en = mb.getNorth();
          const gw = g.bounds.west, ge = g.bounds.east, gs = g.bounds.south, gn = g.bounds.north;
          
          const intWest = Math.max(ew, gw);
          const intEast = Math.min(ee, ge);
          const intSouth = Math.max(es, gs);
          const intNorth = Math.min(en, gn);
          
          let overlapRatio = 0;
          if (intWest < intEast && intSouth < intNorth) {
            const intersectionArea = (intEast - intWest) * (intNorth - intSouth);
            const viewportArea = (ee - ew) * (en - es);
            if (viewportArea > 0) {
              overlapRatio = intersectionArea / viewportArea;
            }
          }
          if (overlapRatio < 0.15) {
            if (typeof window !== 'undefined') {
              window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
                hasData: true,
                hasGrid: true,
                overlapRatio,
                mismatch: true,
                mismatchReason: `Viewport moved away from regional grid bounds (overlap: ${overlapRatio.toFixed(2)} < 0.15)`,
                timestamp: new Date().toISOString()
              };
              window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_DISPLAY_SOURCE_DIAG__;
            }
            lastValidDataRef.current = null;
            return null;
          }
        } catch (e) {
          // ignore mapInstance getBounds errors
        }
      }
    }

    if (marineData.__renderable === false || marineData.grid?.__renderable === false) {
      if (marineData.__unsupportedLayer || marineData.grid?.__unsupportedLayer) {
        return {
          bounds: marineData.grid?.bounds || { west: -180, south: -80, east: 180, north: 85 },
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
      return null;
    }

    const gridModel = marineData.grid.__sourceModel || marineData.__sourceModel;
    const gridProvider = marineData.grid.__gridProvider || 'none';
    const isEuroComponent = activeModel === 'EURO' && ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(activeMarineLayer);
    const isTransitioning = typeof window !== 'undefined' && (!!window.__MARINE_TRANSITIONING__ || !!window.__MARINE_FETCH_PENDING__);

    // 1. Cross-model mismatch check: if the grid source model does not match the active model, return null to clear visual buffers.
    if (gridModel !== activeModel) {
      if (typeof window !== 'undefined') {
        window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
          hasData: !!marineData,
          hasGrid: !!marineData?.grid,
          gridProvider,
          componentLayer: marineData.grid.__componentLayer || 'none',
          activeMarineLayer,
          activeModel,
          isEuroComponent,
          hasCopernicusGrid: false,
          mismatch: true,
          mismatchReason: `Model mismatch: activeModel is ${activeModel} but grid sourceModel is ${gridModel || 'none'}`,
          timestamp: new Date().toISOString()
        };
        window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_DISPLAY_SOURCE_DIAG__;
      }
      if (isTransitioning && lastValidDataRef.current) {
        return lastValidDataRef.current;
      }
      return null;
    }

    // 2. Cross-layer mismatch check: if we expect the global waves grid (non-component) but the current grid is a regional Copernicus component grid, return null.
    if (!isEuroComponent && gridProvider === 'copernicus') {
      if (typeof window !== 'undefined') {
        window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
          hasData: !!marineData,
          hasGrid: !!marineData?.grid,
          gridProvider,
          componentLayer: marineData.grid.__componentLayer || 'none',
          activeMarineLayer,
          activeModel,
          isEuroComponent,
          hasCopernicusGrid: false,
          mismatch: true,
          mismatchReason: `Expected global waves grid but received Copernicus component grid (${marineData.grid.__componentLayer || 'none'})`,
          timestamp: new Date().toISOString()
        };
        window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_DISPLAY_SOURCE_DIAG__;
      }
      if (isTransitioning && lastValidDataRef.current) {
        return lastValidDataRef.current;
      }
      return null;
    }
    
    const hasEstimatedGrid = marineData?.grid?.__gridProvider === 'estimated' &&
                             marineData?.grid?.__gridSupportsLayer === true &&
                             marineData?.grid?.__componentLayer === activeMarineLayer &&
                             (activeModel === 'EURO' || activeModel === 'ICON');

    const isGridEstimated = marineData?.grid?.is_estimated || marineData?.grid?.isEstimated || marineData?.is_estimated || marineData?.isEstimated || false;

    // v6.6: Tight dynamic grid capability validation: if Copernicus regional grid provided component data,
    // it MUST match the active model and component layer exactly.
    const hasCopernicusGrid = ((['copernicus', 'backend-weather-service', 'test-fixture'].includes(marineData?.grid?.__gridProvider)) &&
                              marineData?.grid?.__gridSupportsLayer === true &&
                              marineData?.grid?.__componentLayer === activeMarineLayer &&
                              activeModel === 'EURO') || hasEstimatedGrid ||
                              // v7.0: Accept GFS estimated backdrop/fallback for EURO components (honest provenance)
                              ((['gfs_estimated_backdrop', 'gfs_estimated_fallback'].includes(marineData?.grid?.__gridProvider)) &&
                               marineData?.grid?.__gridSupportsLayer === true &&
                               marineData?.grid?.__componentLayer === activeMarineLayer &&
                               activeModel === 'EURO') ||
                              // v7.1: Accept legacy open-meteo fallback for EURO waves/components when backend is unavailable
                              ((['open-meteo', 'estimated'].includes(marineData?.grid?.__gridProvider)) &&
                               activeModel === 'EURO' &&
                               (activeMarineLayer === 'waves' || isGridEstimated));

    // If it's a EURO component layer and the Copernicus grid componentLayer doesn't match yet,
    // return null synchronously to trigger/await fetch and avoid rendering stale/zero data.
    if (isEuroComponent && !hasCopernicusGrid) {
      if (typeof window !== 'undefined') {
        window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
          hasData: !!marineData,
          hasGrid: !!marineData?.grid,
          gridProvider: marineData?.grid?.__gridProvider || 'none',
          componentLayer: marineData?.grid?.__componentLayer || 'none',
          activeMarineLayer,
          activeModel,
          isEuroComponent,
          hasCopernicusGrid,
          mismatch: true,
          mismatchReason: `EURO component layer ${activeMarineLayer} requested but Copernicus grid componentLayer is ${marineData?.grid?.__componentLayer || 'none'}`,
          timestamp: new Date().toISOString()
        };
        window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_DISPLAY_SOURCE_DIAG__;
      }
      if (isTransitioning && lastValidDataRef.current) {
        return lastValidDataRef.current;
      }
      return null;
    }

    const layerSupported = isGridLayerSupported(activeModel, activeMarineLayer) || hasCopernicusGrid;
    const res = {
      bounds: marineData.grid.bounds,
      cols: marineData.grid.cols,
      rows: marineData.grid.rows,
      vectors: marineData.grid.vectors.map(v => {
        // Only fall back to 'waves' if the model's GRID natively supports this layer.
        // For unsupported grid layers (EURO swell/wind_waves), use the layer's own data
        // (zeroed from API) to avoid rendering a misleading heatmap.
        const hasFlat = v && typeof v.speed === 'number' && typeof v.u === 'number';
        const layerData = hasFlat
          ? v
          : (layerSupported
              ? (v[activeMarineLayer] || v['waves'])
              : v[activeMarineLayer]); // no fallback — will be {u:0,v:0,speed:0}
        return {
          lat: v.lat,
          lng: v.lng,
          u: layerData?.u || 0,
          v: layerData?.v || 0,
          speed: layerData?.speed || 0,
          period: layerData?.period || 0,
          isOcean: v.isOcean
        };
      })
    };
    res.__sourceModel = activeModel;
    res.__provider = marineData?.grid?.provider || 'unknown';
    res.__gridProvider = marineData?.grid?.__gridProvider || marineData?.grid?.provider || 'none';
    res.__componentLayer = marineData?.grid?.__componentLayer || 'none';
    res.__gridSupportsLayer = layerSupported;
    res.productId = marineData.grid.productId || marineData.productId || null;
    res.is_dynamic_viewport_product = marineData.grid.is_dynamic_viewport_product || false;
    res.coverage_scope = marineData.grid.coverage_scope || null;
    res.activeMarineLayer = activeMarineLayer;
    res.activeModel = activeModel;
    res.hourOffset = marineData.grid.hourOffset !== undefined ? marineData.grid.hourOffset : timeOffsetHours;
    res.valid_time = marineData.valid_time || marineData.grid.valid_time;
    res.validTime = marineData.validTime || marineData.grid.validTime;
    res.run_time = marineData.run_time || marineData.grid.run_time || marineData.runTime || marineData.grid.runTime || null;
    res.runTime = res.run_time;
    res.truthTag = marineData.truthTag || marineData.grid.truthTag || null;

    // v7.4: Active-layer truth guard — don't upload any all-zero active-layer grid as a valid heatmap
    let nonzeroCount = 0, maxHeight = 0;
    for (const v of res.vectors) {
      if (v.speed > 0) { nonzeroCount++; if (v.speed > maxHeight) maxHeight = v.speed; }
    }
    res.__nonzeroCount = nonzeroCount;
    res.__maxHeight = maxHeight;
    const upstreamRenderable = marineData?.grid?.__renderable !== false;
    if (res.vectors.length === 0) {
      res.__renderBlockedReason = 'empty_vectors';
      res.__renderable = false;
    } else if (!upstreamRenderable) {
      res.__renderBlockedReason = marineData?.grid?.__noDataReason || 'upstream_not_renderable';
      res.__renderable = false;
    } else {
      res.__renderable = true;
    }

    const gp = res.__gridProvider;
    const isLayerSupported = layerSupported || (gp !== 'open-meteo' && gp !== 'none');
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
        isEuroComponent, hasCopernicusGrid, nonzeroCount, maxHeight,
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
      if (isTransitioning && lastValidDataRef.current) {
        return lastValidDataRef.current;
      }
      return null;
    }
    lastValidDataRef.current = res;
    return res;
  }, [marineData, activeMarineLayer, activeModel, timeOffsetHours, mapInstance, viewState]);
}
