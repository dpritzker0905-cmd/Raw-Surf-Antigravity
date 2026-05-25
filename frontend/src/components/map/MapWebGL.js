import React, { useRef, useState, useMemo, useEffect } from 'react';
import Map, { Source, Layer, Marker, Popup } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';

function PressureMarker({ type, value, onClick }) {
  const isLow = type === 'L';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: 'pointer',
        animation: 'pulseGlow 2s infinite ease-in-out',
        filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))'
      }}
    >
      <div style={{
        width: 38,
        height: 38,
        borderRadius: '50%',
        background: isLow ? 'linear-gradient(135deg, #dc2626, #991b1b)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
        border: '2px solid white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 'bold',
        fontSize: 18,
        boxShadow: isLow ? '0 0 12px rgba(220, 38, 38, 0.6)' : '0 0 12px rgba(37, 99, 235, 0.6)'
      }}>
        {type}
      </div>
      <span style={{
        marginTop: 4,
        background: 'rgba(15, 23, 42, 0.85)',
        color: '#e2e8f0',
        padding: '2px 6px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 'bold',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        whiteSpace: 'nowrap'
      }}>
        {value} hPa
      </span>
      <style>{`
        @keyframes pulseGlow {
          0% { transform: scale(1.0); opacity: 0.95; }
          50% { transform: scale(1.06); opacity: 1.0; }
          100% { transform: scale(1.0); opacity: 0.95; }
        }
      `}</style>
    </div>
  );
}

import {
  getMapStyle,
  mapboxTransformRequest,
  ensureMapLibreInit,
  trace
} from './mapUtils';
import { useTheme } from '../../contexts/ThemeContext';
import { MarineParticleCanvas } from './GPUMarineLayer';
import MapMarkerLayers from './MapMarkerLayers';
import { WindParticleOverlay } from './WindParticleOverlay';
import { useWeatherEngine } from './WeatherEngine';
import { useMapRenderContract } from './useMapRenderContract';
import { useMarineOrchestrator } from './useMarineOrchestrator';
import { useLayerTruthDiff } from './useLayerTruthDiff';
import TruthOverlay from './TruthOverlay';
import { LAYER_REGISTRY, MODEL_METADATA_CACHE } from './LayerRegistry';
import { resolveForecastWindow } from './LayerAccessResolver';
import { markDOMReady } from '../../engine/init-sequencer';
import { useTemporalPreloader } from './useTemporalPreloader';

// Custom Hooks for Modularization (Rule <800 LOC Compliance)
import { useMapInitialization } from './useMapInitialization';
import { useMapViewState } from './useMapViewState';
import { useMapLongPress } from './useMapLongPress';
import { useSpotClusteringData } from './useSpotClusteringData';
import { useRasterAnchorInsertion } from './useRasterAnchorInsertion';
import { useSatelliteBackgroundSync } from './useSatelliteBackgroundSync';
import { useOpenMeteoTileUrls } from './useOpenMeteoTileUrls';

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

  const lowSystem = useMemo(() => {
    // Moves from 23.5° N, -78.0° W up towards the northeast Atlantic over 240 hours
    const startLat = 23.5;
    const endLat = 39.0;
    const startLng = -78.0;
    const endLng = -62.0;
    
    const ratio = Math.min(1, timeOffsetHours / 240);
    const lat = startLat + (endLat - startLat) * ratio;
    const lng = startLng + (endLng - startLng) * ratio;
    
    // Deepens from 996 hPa to 982 hPa
    const pressure = Math.round(996 - 14 * ratio);
    
    return { lat, lng, pressure, type: 'L' };
  }, [timeOffsetHours]);

  const highSystem = useMemo(() => {
    // Shifts gently from 32.0° N, -58.0° W towards 27.0° N, -68.0° W
    const startLat = 32.0;
    const endLat = 27.0;
    const startLng = -58.0;
    const endLng = -68.0;
    
    const ratio = Math.min(1, timeOffsetHours / 240);
    const wave = Math.sin((timeOffsetHours / 240) * Math.PI * 2);
    
    const lat = startLat + (endLat - startLat) * ratio;
    const lng = startLng + (endLng - startLng) * ratio;
    
    // fluctuates between 1024 and 1029 hPa
    const pressure = Math.round(1024 + 5 * Math.abs(wave));
    
    return { lat, lng, pressure, type: 'H' };
  }, [timeOffsetHours]);

  // 1. Map Initialization and Async Abort Interceptions
  const { mapInstance } = useMapInitialization({ innerMapRef, mapInstanceRef });

  // 2. Map View State tracking and FlyTo updates
  const { viewState, onMove, onMoveEnd } = useMapViewState({ effectiveLocation, onMapMoveEnd, innerMapRef });

  // 3. Map LongPress Contextmenu & Mobile touch holds
  useMapLongPress({ mapInstance, onMapLongPress });

  // 4. Raster anchor detection and OceanMask cleanups
  const { marineBeforeId } = useRasterAnchorInsertion({ mapInstance });

  // 5. Satellite background sync handling
  useSatelliteBackgroundSync({ mapInstance, activeLayers });

  // 6. Spot Clustering Data
  const { spotClusters, spotGeoJSON } = useSpotClusteringData({ surfSpots, filter, mapInstance, viewState });

  // Shared Weather Animation Controller
  const weatherAnimRef = useRef({ active: false, start: 0, duration: 600 });
  const animFrameRef = useRef(null);
  
  // Weather Engine: Decoupled weather analytics
  const forecastDays = useMemo(() => resolveForecastWindow(userTier), [userTier]);
  const { windData } = useWeatherEngine({
    activeLayers, mapInstance, timeOffsetHours, activeModel, forecastDays
  });

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
    closestTimeIdx
  } = useOpenMeteoTileUrls({
    mapInstance,
    activeModel,
    activeLayers,
    theme,
    timeOffsetHours,
    userTier,
    activeMarineLayer
  });

  // Shared Marine Orchestrator
  const { marineData } = useMarineOrchestrator({ mapInstance, activeLayers, timeOffsetHours, activeModel });

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
        onClick={onMapClick}
        mapStyle={currentMapStyle}
        transformRequest={mapboxTransformRequest}
        style={{ width: '100%', height: '100%' }}
        maxPitch={60}
        attributionControl={false}
        minZoom={2.0}
        renderWorldCopies={true}
      >
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
            beforeId={marineBeforeId || undefined}
            type="raster"
            layout={{ visibility: activeLayers.includes('satellite') ? 'visible' : 'none' }}
            paint={{ 'raster-opacity': 1.0, 'raster-fade-duration': 0 }}
          />
        </Source>

        {/* Open-Meteo Independent Static Tile Sources with Triple-Source Sliding Ring Buffer */}
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
                  beforeId={marineBeforeId || undefined}
                  type="raster"
                  layout={{
                    visibility: (!isTransitioning && activeLayers.includes(layerKey)) ? 'visible' : 'none'
                  }}
                  paint={{
                    'raster-opacity': (!isTransitioning && activeLayers.includes(layerKey) && isActive) ? (
                      LAYER_REGISTRY[layerKey]?.type === 'marine' ? [
                        'interpolate', ['linear'], ['zoom'],
                        2, 0.45,
                        5, 0.55,
                        8, 0.65,
                        12, 0.70
                      ] : [
                        'interpolate', ['linear'], ['zoom'],
                        2, layerKey === 'wind' ? 0.24 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.22 : layerKey === 'fog' ? 0.18 : layerKey === 'rain' ? 0.35 : 0.22,
                        5, layerKey === 'wind' ? 0.28 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.26 : layerKey === 'fog' ? 0.25 : layerKey === 'rain' ? 0.42 : 0.28,
                        8, layerKey === 'wind' ? 0.33 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.30 : layerKey === 'fog' ? 0.32 : layerKey === 'rain' ? 0.48 : 0.35,
                        12, layerKey === 'wind' ? 0.38 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.34 : layerKey === 'fog' ? 0.38 : layerKey === 'rain' ? 0.52 : 0.40,
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
        <MarineParticleCanvas 
          id="marine-canvas-layer"
          mapInstance={mapInstance} 
          active={!isTransitioning && !!activeMarineLayer}
          data={marineWindData}
          revision={marineData?.grid?.timestamp || Date.now()}
        />

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

        {/* Canvas2D Wind Particles Overlay */}
        <WindParticleOverlay
          id="wind-particle-overlay"
          mapInstance={mapInstance}
          active={!isTransitioning && activeLayers.includes('wind')}
          data={windData}
          theme={theme}
        />

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

        {/* Dynamic High/Low Pressure System Center Markers */}
        {activeLayers.includes('pressure') && (
          <>
            {lowSystem && (
              <Marker
                longitude={lowSystem.lng}
                latitude={lowSystem.lat}
                anchor="center"
              >
                <PressureMarker 
                  type="L" 
                  value={lowSystem.pressure} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSystemPopup(lowSystem);
                  }} 
                />
              </Marker>
            )}
            {highSystem && (
              <Marker
                longitude={highSystem.lng}
                latitude={highSystem.lat}
                anchor="center"
              >
                <PressureMarker 
                  type="H" 
                  value={highSystem.pressure} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSystemPopup(highSystem);
                  }} 
                />
              </Marker>
            )}
          </>
        )}

        {/* Dynamic High/Low System Info Popups */}
        {activeSystemPopup && (
          <Popup
            longitude={activeSystemPopup.lng}
            latitude={activeSystemPopup.lat}
            anchor="top"
            onClose={() => setActiveSystemPopup(null)}
            closeButton={true}
            closeOnClick={false}
          >
            <div style={{
              padding: 10,
              background: '#09090b',
              color: '#f1f5f9',
              borderRadius: 6,
              border: '1px solid #27272a',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
              maxWidth: 240
            }}>
              <h4 style={{
                fontWeight: 'bold',
                fontSize: 13,
                color: activeSystemPopup.type === 'L' ? '#fb7185' : '#38bdf8',
                margin: 0
              }}>
                {activeSystemPopup.type === 'L' ? 'Low Pressure Storm Cell' : 'Bermuda High-Pressure Ridge'}
              </h4>
              <p style={{
                fontSize: 11,
                color: '#94a3b8',
                marginTop: 4,
                marginBottom: 8,
                lineHeight: '1.4'
              }}>
                {activeSystemPopup.type === 'L' 
                  ? 'Active cyclonic low system generating consistent swell energy and offshore wind fields.' 
                  : 'Stable anticyclonic weather ridge providing gentle sea breezes and clear, sunny conditions.'}
              </p>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                fontFamily: 'monospace',
                borderTop: '1px solid #27272a',
                paddingTop: 6
              }}>
                <span>Central Pressure:</span>
                <span style={{ fontWeight: 'bold' }}>{activeSystemPopup.pressure} hPa</span>
              </div>
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
};

export default MapWebGL;
