import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';

import { getMapStyle, FLORIDA_CENTER, mapboxTransformRequest } from './mapUtils';
import { useMarkerClustering } from '../../hooks/useMarkerClustering';
import { useTheme } from '../../contexts/ThemeContext';
import MapMarkerLayers from './MapMarkerLayers';
import { useWeatherEngine } from './WeatherEngine';
import { useMarineOrchestrator } from './useMarineOrchestrator';
import { markDOMReady, markMapReady } from '../../engine/init-sequencer';
import { resolveForecastWindow } from './LayerAccessResolver';
import WebGLSynchronizedOverlay from './WebGLSynchronizedOverlay';

import 'maplibre-gl/dist/maplibre-gl.css';

if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl('/maplibre-gl-worker.js');
}

export function MapWebGL({
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
}) {
  const innerMapRef = useRef(null);
  const { theme } = useTheme();
  const longPressRef = useRef(onMapLongPress);
  
  useEffect(() => {
    longPressRef.current = onMapLongPress;
  }, [onMapLongPress]);

  const [viewState, setViewState] = useState({
    longitude: FLORIDA_CENTER.lng,
    latitude: FLORIDA_CENTER.lat,
    zoom: 7,
    pitch: 0,
    bearing: 0
  });

  const [mapInstance, setMapInstance] = useState(null);

  // Sync ref to parent so useMapActions works
  useEffect(() => {
    if (innerMapRef.current && mapInstanceRef) {
      mapInstanceRef.current = innerMapRef.current.getMap();
    }
  }, [mapInstanceRef, innerMapRef.current]);

  const forecastDays = useMemo(() => resolveForecastWindow(userTier), [userTier]);
  
  // Weather grid vector pipelines (used directly in WebGL engines)
  const { windData } = useWeatherEngine({
    activeLayers,
    mapInstance,
    timeOffsetHours,
    activeModel,
    forecastDays
  });

  const { marineData } = useMarineOrchestrator({
    mapInstance,
    activeLayers,
    timeOffsetHours
  });

  useEffect(() => {
    markDOMReady();
  }, []);

  const onMove = useCallback(evt => {
    setViewState(evt.viewState);
  }, []);

  const moveEndTimerRef = useRef(null);
  const handleMoveEnd = useCallback((evt) => {
    if (onMapMoveEnd) {
      clearTimeout(moveEndTimerRef.current);
      moveEndTimerRef.current = setTimeout(() => {
        const { latitude, longitude } = evt.viewState;
        onMapMoveEnd({ lat: latitude, lng: longitude });
      }, 800);
    }
  }, [onMapMoveEnd]);

  useEffect(() => {
    if (effectiveLocation && innerMapRef.current) {
      const zoom = effectiveLocation.source === 'gps' ? 12 : 9;
      innerMapRef.current.flyTo({
        center: [effectiveLocation.lng, effectiveLocation.lat],
        zoom
      });
    }
  }, [effectiveLocation]);

  const spotsToCluster = useMemo(() => 
    (filter === 'all' || filter === 'spots') ? surfSpots : [], 
    [filter, surfSpots]
  );

  const currentBounds = useMemo(() => {
    if (!mapInstance) return { west: -180, south: -85, east: 180, north: 85 };
    const b = mapInstance.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }, [mapInstance, viewState.longitude, viewState.latitude, viewState.zoom]);

  const { clusters: spotClusters } = useMarkerClustering(
    spotsToCluster,
    currentBounds,
    viewState.zoom,
    useMemo(() => ({ radius: 60, maxZoom: 14 }), [])
  );

  const spotGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: spotsToCluster.map(spot => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [spot.longitude, spot.latitude] },
        properties: {
          id: spot.id,
          geofence_radius: spot.geofence_radius || 200
        }
      }))
    };
  }, [spotsToCluster]);

  const radarTileUrl = useMemo(() => {
    if (!radarFrames?.length || radarFrameIndex == null) return null;
    const frame = radarFrames[radarFrameIndex];
    if (!frame?.path) return null;
    return `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/7/1_0.png`;
  }, [radarFrames, radarFrameIndex]);

  const currentMapStyle = useMemo(() => 
    getMapStyle(theme, false), 
    [theme]
  );

  const handleMapRef = useCallback((refVal) => {
    innerMapRef.current = refVal;
    if (refVal) {
      const map = refVal.getMap();
      if (map && map !== mapInstance) {
        setMapInstance(map);
        window.map = map;
      }
    }
  }, [mapInstance]);

  useEffect(() => {
    if (!mapInstance) return;
    markMapReady();

    mapInstance.on('contextmenu', (e) => {
      e.preventDefault();
      if (longPressRef.current) longPressRef.current(e.lngLat);
    });

    let touchTimer = null;
    let touchStartPos = null;
    const canvas = mapInstance.getCanvas();

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touchStartPos = { x: t.clientX, y: t.clientY };
      touchTimer = setTimeout(() => {
        if (!touchStartPos) return;
        const rect = canvas.getBoundingClientRect();
        const point = mapInstance.unproject([touchStartPos.x - rect.left, touchStartPos.y - rect.top]);
        if (longPressRef.current) longPressRef.current({ lat: point.lat, lng: point.lng });
        touchStartPos = null;
      }, 500);
    };

    const onTouchMove = () => {
      clearTimeout(touchTimer);
      touchStartPos = null;
    };

    const onTouchEnd = () => {
      clearTimeout(touchTimer);
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [mapInstance]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Map
        ref={handleMapRef}
        mapLib={maplibregl}
        {...viewState}
        onMove={onMove}
        onMoveEnd={handleMoveEnd}
        onClick={onMapClick}
        mapStyle={currentMapStyle}
        transformRequest={mapboxTransformRequest}
        style={{ width: '100%', height: '100%' }}
        maxPitch={60}
        attributionControl={false}
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

        {/* Live Radar (RainViewer animated frames) */}
        {radarTileUrl && (
          <Source id="radar-source" type="raster" tiles={[radarTileUrl]} tileSize={256} maxzoom={7}>
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
          />
        </Source>

        {/* Spot and cluster markers */}
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

        {/* Long-press custom pin marker */}
        {longPressLocation && (
          <Marker longitude={longPressLocation.lng} latitude={longPressLocation.lat} anchor="bottom">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))', animation: 'markerDrop 0.3s ease-out' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50% 50% 50% 0', background: 'linear-gradient(135deg, #06b6d4, #0891b2)', transform: 'rotate(-45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid white' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'white', transform: 'rotate(45deg)' }} />
              </div>
              <div style={{ width: 2, height: 6, background: 'rgba(6,182,212,0.6)', borderRadius: 1, marginTop: -2 }} />
              <style>{`@keyframes markerDrop { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
            </div>
          </Marker>
        )}
      </Map>

      {/* Standalone Absolute WebGL Synchronized Canvas Overlay (Option A) */}
      <WebGLSynchronizedOverlay
        mapInstance={mapInstance}
        activeLayers={activeLayers}
        windData={windData}
        marineData={marineData}
        theme={theme}
      />
    </div>
  );
}

export default MapWebGL;
