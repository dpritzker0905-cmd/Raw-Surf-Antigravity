import React, { useRef, useState, useMemo, useEffect } from 'react';
import Map, { Source, Layer, Marker, Popup } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { WeatherTelemetry } from './WeatherTelemetry';
import { getMapStyle, mapboxTransformRequest, ensureMapLibreInit, trace, findMarineInsertionLayer, configureWaterTransparency } from './mapUtils';
import { useTheme } from '../../contexts/ThemeContext';
import { MarineParticleCanvas } from './GPUMarineLayer';
import MapMarkerLayers from './MapMarkerLayers';
import { WindParticleOverlay } from './WindParticleOverlay';
import { WebGLWindLayer } from './WebGLWindLayer';
import { WebGLMarineLayer } from './WebGLMarineLayer';
import { OceanMask } from './OceanMask';
import { useWeatherEngine } from './WeatherEngine';
import { useMapRenderContract } from './useMapRenderContract';
import { useMarineOrchestrator } from './useMarineOrchestrator';
import { useLayerTruthDiff } from './useLayerTruthDiff';
import TruthOverlay from './TruthOverlay';
import { LAYER_REGISTRY, MODEL_METADATA_CACHE } from './LayerRegistry';
import { isGridLayerSupported } from './marineControllerUtils';
import { resolveForecastWindow } from './LayerAccessResolver';
import { markDOMReady, getInitState, onStateChange } from '../../engine/init-sequencer';
import { initEngine, shutdownEngine } from '../../engine/engine-bootstrap';
import { useTemporalPreloader } from './useTemporalPreloader';
import { useSimulationField } from '../../engine/useSimulationField';
import { useRenderPlanBridge } from '../../engine/useRenderPlanBridge';
import { getDispatcherDiagnostics } from '../../engine/RenderPlanDispatcher';
import { useMapInitialization } from './useMapInitialization';
import { useMapViewState } from './useMapViewState';
import { useMapLongPress } from './useMapLongPress';
import { useSpotClusteringData } from './useSpotClusteringData';
import { useSatelliteBackgroundSync } from './useSatelliteBackgroundSync';
import { useOpenMeteoTileUrls } from './useOpenMeteoTileUrls';
import { useMapObservability } from './useMapObservability';
import { useMapDebugTools } from './useMapDebugTools';
import 'maplibre-gl/dist/maplibre-gl.css';

var MapWebGL = ({
  isLight,
  userLocation,
  effectiveLocation,
  surfSpots,
  livePhotographers,
  filter,
  pulsingMarkers,
  onSpotClick,
  onPhotographerClick,
  mapInstanceRef,
  activeDispatch,
  friendsOnMap,
  activeModel,
  activeLayers,
  radarFrameIndex,
  radarFrames,
  timeOffsetHours = 0,
  userTier = 'tier_1',
  onMapClick,
  onMapMoveEnd,
  onMapLongPress,
  longPressLocation,
  onMarineDataChange,
}) => {
  // v3.9.7: Explicit init never at import time
  ensureMapLibreInit();
  if (typeof window !== 'undefined') {
    window.__MODEL_METADATA_CACHE__ = MODEL_METADATA_CACHE;
  }
  markDOMReady(); // Init sequencer: DOM is ready when component renders
  
  const innerMapRef = useRef(null);
  const { theme } = useTheme();

  const [activeSystemPopup, setActiveSystemPopup] = useState(null);
  const [webglWindFailed, setWebglWindFailed] = useState(false);
  const [webglMarineFailed, setWebglMarineFailed] = useState(false);

  const handleMapClick = (e) => {
    setActiveSystemPopup(null);
    if (onMapClick) onMapClick(e);
  };

  // 1. Map Initialization and Async Abort Interceptions
  const { mapInstance } = useMapInitialization({ innerMapRef, mapInstanceRef });

  const activeMarineLayer = useMemo(() => {
    return ['waves', 'swell_1', 'swell_2', 'wind_waves'].find(l => activeLayers.includes(l));
  }, [activeLayers]);

  const lowSystems = [];
  const highSystems = [];

  useMapObservability({
    mapInstance,
    activeLayers,
    lowSystems,
    highSystems,
    activeSystemPopup
  });

  // 2. Map View State tracking and FlyTo updates
  const { viewState, onMove, onMoveEnd } = useMapViewState({ effectiveLocation, onMapMoveEnd, innerMapRef });

  // 3. Map LongPress Contextmenu & Mobile touch holds
  useMapLongPress({ mapInstance, onMapLongPress });

  // 5. Satellite background sync handling
  useSatelliteBackgroundSync({ mapInstance, activeLayers });

  // v85: Find the landcover layer — marine rasters insert BELOW it (above background).
  // Then make the water layer semi-transparent so raster/WebGL colors show through ocean.
  const [marineBeforeId, setMarineBeforeId] = useState(null);
  useEffect(() => {
    if (!mapInstance) return;
    const onStyleData = () => {
      var id = findMarineInsertionLayer(mapInstance);
      if (id) {
        setMarineBeforeId(id);
      }
    };
    mapInstance.on('styledata', onStyleData);
    onStyleData();
    return () => {
      if (mapInstance) {
        mapInstance.off('styledata', onStyleData);
      }
    };
  }, [mapInstance]);
  useEffect(() => {
    configureWaterTransparency(mapInstance, !!activeMarineLayer, theme);
  }, [mapInstance, activeMarineLayer, theme]);

  // 6. Spot Clustering Data
  const { spotClusters, spotGeoJSON } = useSpotClusteringData({ surfSpots, filter, mapInstance, viewState });

  // Shared Weather Animation Controller
  const weatherAnimRef = useRef({ active: false, start: 0, duration: 600 });
  const animFrameRef = useRef(null);
  
  // Temporal Preloader
  useTemporalPreloader({ currentHour: timeOffsetHours, activeLayers, mapInstance, activeModel, theme });

  // 7. Open-Meteo Tile Protocol and Sliding URL Ring Buffers

  const {
    protocolReady,
    omTileUrls,
    activeSlots,
    isTransitioning,
    closestTimeIdx,
    debouncedTimeOffsetHours
  } = useOpenMeteoTileUrls({
    mapInstance,
    activeModel,
    activeLayers,
    theme,
    timeOffsetHours,
    userTier,
    activeMarineLayer
  });

  // Weather Engine: Decoupled weather analytics
  const forecastDays = useMemo(() => resolveForecastWindow(userTier), [userTier]);
  const { windData, windRevision } = useWeatherEngine({
    activeLayers,
    mapInstance,
    timeOffsetHours: debouncedTimeOffsetHours,
    activeModel,
    forecastDays
  });

  // Shared Marine Orchestrator
  const { marineData } = useMarineOrchestrator({
    mapInstance,
    activeLayers,
    timeOffsetHours: timeOffsetHours,
    activeModel
  });

  useEffect(() => {
    if (onMarineDataChange) {
      onMarineDataChange(marineData);
    }
  }, [marineData, onMarineDataChange]);
  // FCE: Field Composition Engine — Single Source of Truth
  const { field: simulationField, diagnostics: fieldDiagnostics } = useSimulationField({
    windData,
    marineData,
    pressureData: null,
    activeModel,
    timeOffsetHours: timeOffsetHours,
    enableLogging: true,
    activeMarineLayer,
  });

  // Live simulation bridge — drives RK4 physics independently of React
  const simConfig = useMemo(() => ({
    activeLayers,
    activeMarineLayer,
    activeModel,
    theme,
    oceanMaskEnabled: true,
  }), [activeLayers, activeMarineLayer, activeModel, theme]);

  const {
    renderPlan,
    frameIndex: simFrameIndex,
    diagnostics: simDiagnostics,
  } = useRenderPlanBridge({
    field: simulationField,
    config: simConfig,
    enabled: true,
  });

  // Expose FCE + simulation state for debugging
  useMapDebugTools({
    mapInstance,
    activeLayers,
    activeMarineLayer,
    activeModel,
    debouncedTimeOffsetHours,
    windData,
    marineData,
    simulationField,
    renderPlan,
    fieldDiagnostics,
    simDiagnostics,
    simFrameIndex
  });

  const activeRenderType = useMemo(() => {
    const layerId = activeLayers[0];
    if (!layerId) return 'none';
    const layer = LAYER_REGISTRY[layerId];
    if (!layer) return 'none';
    if (layer.type === 'raster') return layer.id === 'radar' ? 'radar' : 'raster';
    if (layer.type === 'marine') return 'marine';
    if ((layer.type === 'canvas' || layer.type === 'particle') && layer.id === 'wind') return 'wind';
    return 'none';
  }, [activeLayers]);

  const marineWindData = useMemo(() => {
    if (!marineData?.grid?.vectors || !activeMarineLayer) return null;

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
      return null;
    }
    
    const hasEstimatedGrid = marineData?.grid?.__gridProvider === 'estimated' &&
                             marineData?.grid?.__gridSupportsLayer === true &&
                             marineData?.grid?.__componentLayer === activeMarineLayer &&
                             (activeModel === 'EURO' || activeModel === 'ICON');

    // v6.6: Tight dynamic grid capability validation: if Copernicus regional grid provided component data,
    // it MUST match the active model and component layer exactly.
    const hasCopernicusGrid = ((['copernicus', 'backend-weather-service'].includes(marineData?.grid?.__gridProvider)) &&
                              marineData?.grid?.__gridSupportsLayer === true &&
                              marineData?.grid?.__componentLayer === activeMarineLayer &&
                              activeModel === 'EURO') || hasEstimatedGrid ||
                              // v7.0: Accept GFS estimated backdrop/fallback for EURO components (honest provenance)
                              ((['gfs_estimated_backdrop', 'gfs_estimated_fallback'].includes(marineData?.grid?.__gridProvider)) &&
                               marineData?.grid?.__gridSupportsLayer === true &&
                               marineData?.grid?.__componentLayer === activeMarineLayer &&
                               activeModel === 'EURO') ||
                              // v7.1: Accept legacy open-meteo fallback for EURO components when backend is unavailable
                              (marineData?.grid?.__gridProvider === 'open-meteo' &&
                               activeModel === 'EURO');

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
        const layerData = layerSupported
          ? (v[activeMarineLayer] || v['waves'])
          : v[activeMarineLayer]; // no fallback — will be {u:0,v:0,speed:0}
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

    // v7.4: Active-layer truth guard — don't upload any all-zero active-layer grid as a valid heatmap
    let nonzeroCount = 0, maxHeight = 0;
    for (const v of res.vectors) {
      if (v.speed > 0) { nonzeroCount++; if (v.speed > maxHeight) maxHeight = v.speed; }
    }
    res.__nonzeroCount = nonzeroCount;
    res.__maxHeight = maxHeight;
    // Check both local nonzero count AND upstream __renderable from extractMarineAtOffset
    const upstreamRenderable = marineData?.grid?.__renderable !== false;
    if (nonzeroCount === 0 && res.vectors.length > 0) {
      res.__renderBlockedReason = 'all_zero_active_layer';
      res.__renderable = false;
    } else if (!upstreamRenderable) {
      res.__renderBlockedReason = marineData?.grid?.__noDataReason || 'upstream_not_renderable';
      res.__renderable = false;
    } else {
      res.__renderable = true;
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
        infoboxProvider: (window.__EURO_EXTENDED_ESTIMATE_DIAG__?.isEstimated) ? 'estimated' : res.__provider,
        timestamp: new Date().toISOString()
      };
      window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_DISPLAY_SOURCE_DIAG__;
    }
    
    if (!res.__renderable) return null;
    return res;
  }, [marineData, activeMarineLayer, activeModel, timeOffsetHours]);

  // Marine raster opacity is controlled declaratively via JSX paint props (single source of truth).
  // Removed v3.17 imperative setPaintProperty sync — it raced with JSX and could set opacity to 0.

  // Layer Truth Diff Engine
  const { issues: truthIssues, rasterVisible } = useLayerTruthDiff({
    mapInstance, activeLayers, activeRenderType, windData, marineData
  });

  // Compute radar tile URL from frames + index
  const radarTileUrl = useMemo(() => {
    if (!radarFrames?.length || radarFrameIndex == null) return null;
    const frame = radarFrames[radarFrameIndex];
    if (!frame?.path) return null;
    return `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/7/1_0.png`;
  }, [radarFrames, radarFrameIndex]);

  // Memoize map style to prevent full map re-render on ViewState change
  const currentMapStyle = useMemo(() => trace('map', 'resolve_style', 'MapWebGL', getMapStyle(theme, false)), [theme]);

  // Canvas fade effects for marine layer
  useEffect(() => {
    if (!mapInstance) return;
    const marineActive = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayers.includes(l));
    const mc = document.getElementById('marine-canvas-layer');
    if (!marineActive && mc) {
      mc.style.opacity = '0';
      try { mc.getContext('2d')?.clearRect(0, 0, mc.width, mc.height); } catch(e) {}
    }
    if (marineActive && mc) {
      const start = performance.now();
      const fade = () => {
        const t = Math.min(1, (performance.now() - start) / 400);
        mc.style.opacity = String(1 - Math.pow(1 - t, 2));
        if (t < 1) { animFrameRef.current = requestAnimationFrame(fade); }
      };
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(fade);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [mapInstance, activeLayers]);

  // Global Render Contract single source of truth for map readiness
  useMapRenderContract(mapInstance);

  // Controlled Engine Bootstrap v2 Start
  useEffect(() => {
    if (!mapInstance) return;
    let didInit = false;
    let unsubscribe = null;

    const tryInit = () => {
      const state = getInitState();
      if (state === 'map-ready' || state === 'engine-ready' || state === 'layers-ready' || state === 'complete') {
        try {
          console.log('[MapWebGL] Sequencer is map-ready! Bootstrapping Weather Engine...');
          initEngine({
            mapInstance,
            config: { userTier }
          });
          didInit = true;
          return true;
        } catch (err) {
          console.error('[MapWebGL] Weather Engine bootstrap error:', err);
        }
      }
      return false;
    };

    const initialized = tryInit();

    if (!initialized) {
      unsubscribe = onStateChange((state) => {
        if (state === 'map-ready') {
          if (tryInit()) {
            if (unsubscribe) unsubscribe();
          }
        }
      });
    }

    return () => {
      if (didInit) {
        console.log('[MapWebGL] Clean unmount: shutting down weather simulation engine');
        shutdownEngine();
      }
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [mapInstance, userTier]);

  // Self-healing observability for MapLibre errors and WebGL context events
  useEffect(() => {
    if (!mapInstance) return;

    const onError = (e) => {
      console.error('[MapWebGL] Map instance error event:', e);
      WeatherTelemetry.trackMapError(e.error?.message || 'MapError', e.error?.stack || '');
    };

    mapInstance.on('error', onError);

    const canvas = mapInstance.getCanvas();
    let onContextLost = null;
    let onContextRestored = null;

    if (canvas) {
      onContextLost = (e) => {
        e.preventDefault();
        console.warn('[MapWebGL] WebGL context lost detected!');
        WeatherTelemetry.trackWebGLContextLost();
      };

      onContextRestored = () => {
        console.log('[MapWebGL] WebGL context restored successfully!');
        WeatherTelemetry.trackWebGLContextRestored();
      };

      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.addEventListener('webglcontextrestored', onContextRestored);
    }

    return () => {
      mapInstance.off('error', onError);
      if (canvas) {
        if (onContextLost) canvas.removeEventListener('webglcontextlost', onContextLost);
        if (onContextRestored) canvas.removeEventListener('webglcontextrestored', onContextRestored);
      }
    };
  }, [mapInstance]);



  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <TruthOverlay
        activeLayers={activeLayers}
        activeRenderType={activeRenderType}
        marineData={marineData}
        windData={windData}
        truthIssues={truthIssues}
        rasterVisible={rasterVisible}
      />

      <Map
        ref={innerMapRef}
        mapLib={maplibregl}
        {...viewState}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onClick={handleMapClick}
        mapStyle={currentMapStyle}
        transformRequest={mapboxTransformRequest}
        style={{ width: '100%', height: '100%' }}
        maxPitch={60}
        attributionControl={false}
        minZoom={2.0}
        renderWorldCopies={true}
      >
        {/* Ocean Mask — Static land/ocean layers */}
        <OceanMask
          mapInstance={mapInstance}
          active={renderPlan ? renderPlan.oceanMask.active : !!activeMarineLayer}
          activeMarineLayer={activeMarineLayer}
          theme={theme}
          activeLayers={activeLayers}
        />

        {/* --- WEATHER LAYERS --- */}

        {/* Live Radar (RainViewer animated frames) */}
        {radarTileUrl && (
          <Source
            id="radar-source"
            type="raster"
            tiles={[radarTileUrl]}
            tileSize={256}
            maxzoom={7}
          >
            <Layer 
              id="radar-layer" 
              type="raster" 
              layout={{ visibility: activeLayers.includes('radar') ? 'visible' : 'none' }}
              paint={{ 'raster-opacity': 0.65 }} 
            />
          </Source>
        )}

        {/* ESRI True Satellite Imagery */}
        <Source
          id="esri-satellite-source"
          type="raster"
          tiles={['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']}
          tileSize={256}
          maxzoom={19}
        >
          <Layer
            id="esri-satellite-layer"
            type="raster"
            layout={{ visibility: activeLayers.includes('satellite') ? 'visible' : 'none' }}
            paint={{ 'raster-opacity': 1.0, 'raster-fade-duration': 0 }}
            beforeId={marineBeforeId || undefined}
          />
        </Source>

        {/* Open-Meteo Raster Tile Layers — ATMOSPHERIC SLOTS */}
        {protocolReady && Object.keys(LAYER_REGISTRY).filter(k => LAYER_REGISTRY[k].omVariable && LAYER_REGISTRY[k].type === 'raster').map(layerKey => {
          return [0, 1, 2].map(slotIdx => {
            const slotKey = `${layerKey}-slot-${slotIdx}`;
            const url = omTileUrls[slotKey];
            if (!url) return null;
            const isActive = activeSlots[layerKey] !== undefined
              ? activeSlots[layerKey] === slotIdx
              : (closestTimeIdx % 3) === slotIdx;

            // Strict visual isolation: Hide wind and marine layers from MapLibre's built-in raster renderer
            const isVisualRaster = activeLayers.includes(layerKey) && !['wind', 'waves', 'swell_1', 'swell_2', 'wind_waves'].includes(layerKey);

            return (
              <Source
                key={`${slotKey}-source-${url}`}
                id={`${slotKey}-source`}
                type="raster"
                url={url}
                tileSize={512}
                maxzoom={10}
              >
                <Layer
                  id={`${slotKey}-layer`}
                  type="raster"
                  layout={{
                    visibility: (!isTransitioning && activeLayers.includes(layerKey)) ? 'visible' : 'none'
                  }}
                  paint={{
                    'raster-opacity': (!isTransitioning && isVisualRaster && isActive) ? [
                        'interpolate', ['linear'], ['zoom'],
                        2, layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.35 : layerKey === 'fog' ? 0.40 : layerKey === 'rain' ? 0.35 : 0.22,
                        5, layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.42 : layerKey === 'fog' ? 0.52 : layerKey === 'rain' ? 0.42 : 0.28,
                        8, layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.48 : layerKey === 'fog' ? 0.60 : layerKey === 'rain' ? 0.48 : 0.35,
                        12, layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.55 : layerKey === 'fog' ? 0.65 : layerKey === 'rain' ? 0.52 : 0.40,
                      ] : 0.0,
                    'raster-resampling': 'linear',
                    'raster-fade-duration': 0
                  }}
                />
              </Source>
            );
          });
        })}
        {(!webglMarineFailed && !!activeMarineLayer) ? (
          <WebGLMarineLayer
            mapInstance={mapInstance}
            active={!!activeMarineLayer}
            data={marineWindData}
            revision={marineData?.__commitRevision || marineData?.grid?.__activeLayerNonzeroCount || 0}
            beforeId={marineBeforeId}
            theme={theme}
            activeLayers={activeLayers}
            timeOffsetHours={timeOffsetHours}
            activeModel={activeModel}
            onError={() => {
              console.warn('[MapWebGL] Fallback to Canvas2D Marine overlay triggered');
              setWebglMarineFailed(true);
            }}
          />
        ) : (
          <MarineParticleCanvas 
            id="marine-canvas-layer"
            mapInstance={mapInstance} 
            active={!isTransitioning && !!activeMarineLayer}
            data={marineWindData}
            revision={marineData?.__commitRevision || marineData?.grid?.__activeLayerNonzeroCount || 0}
          />
        )}
        <Source id="spot-geofences" type="geojson" data={spotGeoJSON}>
          <Layer 
            id="spot-geofences-layer"
            type="circle"
            paint={{
              'circle-radius': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                10, 5,
                14, 25,
                18, 150
              ],
              'circle-color': '#06b6d4',
              'circle-opacity': 0.1,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#06b6d4',
              'circle-pitch-alignment': 'map'
            }}
          />
        </Source>

        {/* Marker Rendering Layer */}
        <MapMarkerLayers
          spotClusters={spotClusters}
          livePhotographers={livePhotographers}
          effectiveLocation={effectiveLocation}
          activeDispatch={activeDispatch}
          friendsOnMap={friendsOnMap}
          filter={filter}
          pulsingMarkers={pulsingMarkers}
          onSpotClick={onSpotClick}
          onPhotographerClick={onPhotographerClick}
          mapRef={innerMapRef}
        />
        {(!webglWindFailed && activeLayers.includes('wind')) ? (
          <WebGLWindLayer
            mapInstance={mapInstance}
            active={activeLayers.includes('wind')}
            data={windData}
            revision={windRevision?.current || 0}
            theme={theme}
            onError={() => {
              console.warn('[MapWebGL] Fallback to Canvas2D Wind overlay triggered');
              setWebglWindFailed(true);
            }}
          />
        ) : (
          <WindParticleOverlay
            id="wind-particle-overlay"
            mapInstance={mapInstance}
            active={!isTransitioning && activeLayers.includes('wind')}
            data={windData}
            theme={theme}
          />
        )}
        {longPressLocation && (
          <Marker
            longitude={longPressLocation.lng}
            latitude={longPressLocation.lat}
            anchor="bottom"
          >
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
              animation: 'markerDrop 0.3s ease-out',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50% 50% 50% 0',
                background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
                transform: 'rotate(-45deg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid white',
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'white', transform: 'rotate(45deg)',
                }} />
              </div>
              <div style={{
                width: 2, height: 6, background: 'rgba(6,182,212,0.6)',
                borderRadius: 1, marginTop: -2,
              }} />
              <style>{`@keyframes markerDrop {
                from { transform: translateY(-20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
              }`}</style>
            </div>
          </Marker>
        )}

      </Map>
    </div>
  );
};

export default MapWebGL;
