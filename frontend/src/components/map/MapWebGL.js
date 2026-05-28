import React, { useRef, useState, useMemo, useEffect } from 'react';
import Map, { Source, Layer, Marker, Popup } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { WeatherTelemetry } from './WeatherTelemetry';


import { getMapStyle, mapboxTransformRequest, ensureMapLibreInit, trace } from './mapUtils';
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
import { resolveForecastWindow } from './LayerAccessResolver';
import { markDOMReady, getInitState, onStateChange } from '../../engine/init-sequencer';
import { initEngine } from '../../engine/engine-bootstrap';
import { useTemporalPreloader } from './useTemporalPreloader';

// FCE: Field Composition Engine + Live Simulation Bridge
import { useSimulationField } from '../../engine/useSimulationField';
import { useRenderPlanBridge } from '../../engine/useRenderPlanBridge';
import { getDispatcherDiagnostics } from '../../engine/RenderPlanDispatcher';

// Custom Hooks for Modularization (Rule <800 LOC Compliance)
import { useMapInitialization } from './useMapInitialization';
import { useMapViewState } from './useMapViewState';
import { useMapLongPress } from './useMapLongPress';
import { useSpotClusteringData } from './useSpotClusteringData';
import { useSatelliteBackgroundSync } from './useSatelliteBackgroundSync';
import { useOpenMeteoTileUrls } from './useOpenMeteoTileUrls';
import { useMapObservability } from './useMapObservability';

// DELETED: useRasterAnchorInsertion — no more layer ordering hacks

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

  // DELETED: useRasterAnchorInsertion — no more beforeId/marineBeforeId

  // 5. Satellite background sync handling
  useSatelliteBackgroundSync({ mapInstance, activeLayers });

  // 6. Spot Clustering Data
  const { spotClusters, spotGeoJSON } = useSpotClusteringData({ surfSpots, filter, mapInstance, viewState });

  // Shared Weather Animation Controller
  const weatherAnimRef = useRef({ active: false, start: 0, duration: 600 });
  const animFrameRef = useRef(null);
  
  // Temporal Preloader
  useTemporalPreloader({ currentHour: timeOffsetHours, activeLayers, mapInstance, activeModel, theme });

  const activeMarineLayer = useMemo(() => {
    return ['waves', 'swell_1', 'swell_2', 'wind_waves'].find(l => activeLayers.includes(l));
  }, [activeLayers]);

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
    timeOffsetHours: debouncedTimeOffsetHours,
    activeModel
  });

  // ============================================================
  // FCE: Field Composition Engine — Single Source of Truth
  // SimulationField merges all data sources into unified state.
  // SimulationLoop runs RK4 physics at 60Hz, produces RenderPlan.
  // useRenderPlanBridge exposes the live RenderPlan to React.
  // ============================================================
  const { field: simulationField, diagnostics: fieldDiagnostics } = useSimulationField({
    windData,
    marineData,
    pressureData: null,
    activeModel,
    timeOffsetHours: debouncedTimeOffsetHours,
    enableLogging: true,
  });

  // Live simulation bridge — drives RK4 physics independently of React
  const simConfig = useMemo(() => ({
    activeLayers,
    activeMarineLayer,
    theme,
    oceanMaskEnabled: true,
  }), [activeLayers, activeMarineLayer, theme]);

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
  if (typeof window !== 'undefined') {
    window.__FCE_FIELD__ = simulationField;
    window.__FCE_RENDER_PLAN__ = renderPlan;
    window.__FCE_DIAGNOSTICS__ = fieldDiagnostics;
    window.__SIM_DIAGNOSTICS__ = simDiagnostics;
    window.__SIM_FRAME__ = simFrameIndex;
    window.__SIM_EVOLUTION__ = renderPlan?.evolution || null;
    window.__GPU_DISPATCHER__ = getDispatcherDiagnostics();
  }

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
    return {
      bounds: marineData.grid.bounds,
      cols: marineData.grid.cols,
      rows: marineData.grid.rows,
      vectors: marineData.grid.vectors.map(v => {
        const layerData = v[activeMarineLayer] || v['waves'];
        return {
          lat: v.lat,
          lng: v.lng,
          u: layerData?.u || 0,
          v: layerData?.v || 0,
          speed: layerData?.speed || 0,
          isOcean: v.isOcean
        };
      })
    };
  }, [marineData, activeMarineLayer]);

  // v3.17: Imperative marine raster opacity sync
  useEffect(() => {
    if (!mapInstance || !activeMarineLayer) return;
    const marineOpacity = [
      'interpolate', ['linear'], ['zoom'],
      2, 0.45, 5, 0.55, 8, 0.65, 12, 0.70
    ];
    const slots = [0, 1, 2];
    const activeSlotIdx = activeSlots[activeMarineLayer];
    for (const s of slots) {
      const layerId = `${activeMarineLayer}-slot-${s}-layer`;
      if (!mapInstance.getLayer(layerId)) continue;
      const isActive = activeSlotIdx !== undefined ? activeSlotIdx === s : false;
      try {
        mapInstance.setPaintProperty(layerId, 'raster-opacity', isActive ? marineOpacity : 0);
      } catch (e) {}
    }
  }, [mapInstance, activeMarineLayer, activeSlots, isTransitioning]);

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

    const tryInit = () => {
      const state = getInitState();
      if (state === 'map-ready' || state === 'engine-ready' || state === 'layers-ready' || state === 'complete') {
        try {
          console.log('[MapWebGL] Sequencer is map-ready! Bootstrapping Weather Engine...');
          initEngine({
            mapInstance,
            config: { userTier }
          });
          return true;
        } catch (err) {
          console.error('[MapWebGL] Weather Engine bootstrap error:', err);
        }
      }
      return false;
    };

    if (tryInit()) return;

    const unsubscribe = onStateChange((state) => {
      if (state === 'map-ready') {
        if (tryInit()) {
          unsubscribe();
        }
      }
    });

    return () => unsubscribe();
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
        {/* Ocean Mask — Static land/ocean layers. NO ordering logic, NO beforeId. */}
        <OceanMask
          mapInstance={mapInstance}
          active={renderPlan ? renderPlan.oceanMask.active : !!activeMarineLayer}
          activeMarineLayer={activeMarineLayer}
          theme={theme}
        />

        {/* Geofence Visual Layer */}
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

        {/* ESRI True Satellite Imagery — NO beforeId */}
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
          />
        </Source>

        {/* Open-Meteo Raster Tile Layers — NO beforeId, pure static stack */}
        {protocolReady && Object.keys(LAYER_REGISTRY).filter(k => LAYER_REGISTRY[k].omVariable).map(layerKey => {
          return [0, 1, 2].map(slotIdx => {
            const slotKey = `${layerKey}-slot-${slotIdx}`;
            const url = omTileUrls[slotKey];
            if (!url) return null;
            const isActive = activeSlots[layerKey] !== undefined
              ? activeSlots[layerKey] === slotIdx
              : (closestTimeIdx % 3) === slotIdx;

            return (
              <Source
                key={`${slotKey}-source`}
                id={`${slotKey}-source`}
                type="raster"
                url={url}
                tileSize={512}
                maxzoom={LAYER_REGISTRY[layerKey]?.type === 'marine' ? 9 : 12}
              >
                <Layer
                  id={`${slotKey}-layer`}
                  type="raster"
                  layout={{
                    visibility: (!isTransitioning && activeLayers.includes(layerKey)) ? 'visible' : 'none'
                  }}
                  paint={{
                    'raster-opacity': (!isTransitioning && activeLayers.includes(layerKey) && isActive) ? (
                      LAYER_REGISTRY[layerKey]?.type === 'marine' ? [
                        'interpolate', ['linear'], ['zoom'],
                        2, 0.45, 5, 0.55, 8, 0.65, 12, 0.70
                      ] : [
                        'interpolate', ['linear'], ['zoom'],
                        2, layerKey === 'wind' ? 0.24 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.35 : layerKey === 'fog' ? 0.40 : layerKey === 'rain' ? 0.35 : 0.22,
                        5, layerKey === 'wind' ? 0.28 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.42 : layerKey === 'fog' ? 0.52 : layerKey === 'rain' ? 0.42 : 0.28,
                        8, layerKey === 'wind' ? 0.33 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.48 : layerKey === 'fog' ? 0.60 : layerKey === 'rain' ? 0.48 : 0.35,
                        12, layerKey === 'wind' ? 0.38 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.55 : layerKey === 'fog' ? 0.65 : layerKey === 'rain' ? 0.52 : 0.40,
                      ]
                    ) : 0.0,
                    'raster-resampling': 'linear',
                    'raster-fade-duration': 150
                  }}
                />
              </Source>
            );
          });
        })}

        {/* Marine Foam/Crest Engine */}
        {(!webglMarineFailed && !!activeMarineLayer) ? (
          <WebGLMarineLayer
            mapInstance={mapInstance}
            active={!!activeMarineLayer}
            data={marineWindData}
            revision={marineData?.grid?.timestamp || 0}
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
            revision={marineData?.grid?.timestamp || Date.now()}
          />
        )}

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

        {/* Wind Particles */}
        {(!webglWindFailed && activeLayers.includes('wind')) ? (
          <WebGLWindLayer
            mapInstance={mapInstance}
            active={activeLayers.includes('wind')}
            data={windData}
            revision={windRevision?.current || 0}
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

        {/* Long-press / right-click map pin marker */}
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
