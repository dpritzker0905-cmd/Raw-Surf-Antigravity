import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { getMapStyle, FLORIDA_CENTER } from './mapUtils';
import { useMarkerClustering } from '../../hooks/useMarkerClustering';

// Ensure maplibre-gl CSS is present
import 'maplibre-gl/dist/maplibre-gl.css';

// --- Open-Meteo Weather Tile Protocol ---
// Registers the `om://` custom protocol for MapLibre at module level.
// This enables raster weather tile overlays powered by Open-Meteo OMfiles
// (precipitation, wind, pressure, cloud cover) for live AND forecast time offsets.
let omProtocolRegistered = false;
try {
  const { omProtocol } = require('@openmeteo/weather-map-layer');
  if (!omProtocolRegistered) {
    maplibregl.addProtocol('om', omProtocol);
    omProtocolRegistered = true;
  }
} catch (e) {
  console.warn('[MapWebGL] @openmeteo/weather-map-layer not available:', e.message);
}

/**
 * Map Open-Meteo model identifiers to their tile-server paths.
 * Used to construct om:// source URLs.
 */
const OM_MODEL_MAP = {
  GFS:  'ncep_gfs025',
  EURO: 'ecmwf_ifs025',
  ICON: 'dwd_icon',
};

/**
 * Map app layer IDs to Open-Meteo tile variable names.
 * `null` means no tile is available (data-card only).
 */
const OM_VARIABLE_MAP = {
  precipitation: 'precipitation',
  wind:          'wind_speed_10m',
  pressure:      'surface_pressure',
  swell_height:  null,  // Marine models don't have tile coverage yet
  swell_period:  null,
};
const MapWebGL = ({
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
}) => {
  const innerMapRef = useRef(null);
  const [viewState, setViewState] = useState({
    longitude: FLORIDA_CENTER.lng,
    latitude: FLORIDA_CENTER.lat,
    zoom: 7,
    pitch: 0,
    bearing: 0
  });
  
  const [bounds, setBounds] = useState(null);

  // Open-Meteo tile source URL — builds om:// URL for the active weather layer
  const omTileUrl = useMemo(() => {
    if (!activeLayers.length) return null;
    const activeLayer = activeLayers[0];
    // Radar + satellite use RainViewer, not Open-Meteo tiles
    if (activeLayer === 'radar' || activeLayer === 'satellite') return null;
    const variable = OM_VARIABLE_MAP[activeLayer];
    if (!variable) return null; // swell layers — no tile data
    const model = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    const darkParam = !isLight ? '&dark=true' : '';
    return `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?variable=${variable}${darkParam}`;
  }, [activeLayers, activeModel, isLight]);

  // Sync ref to parent so useMapActions works
  useEffect(() => {
    if (innerMapRef.current) {
      if (mapInstanceRef) mapInstanceRef.current = innerMapRef.current.getMap();
    }
  }, [mapInstanceRef, innerMapRef.current]);

  const onMove = useCallback(evt => {
    setViewState(evt.viewState);
    const mapBounds = evt.target.getBounds();
    setBounds({
      west: mapBounds.getWest(),
      south: mapBounds.getSouth(),
      east: mapBounds.getEast(),
      north: mapBounds.getNorth()
    });
  }, []);

  // Sync to effectiveLocation initially
  useEffect(() => {
    if (effectiveLocation && innerMapRef.current) {
      const zoom = effectiveLocation.source === 'gps' ? 12 : 9;
      innerMapRef.current.flyTo({
        center: [effectiveLocation.lng, effectiveLocation.lat],
        zoom
      });
    }
  }, [effectiveLocation]);

  // Use the existing supercluster hook
  const clusteringOptions = useMemo(() => ({ radius: 60, maxZoom: 14 }), []);
  
  const spotsToCluster = useMemo(() => 
    (filter === 'all' || filter === 'spots') ? surfSpots : [], 
  [filter, surfSpots]);

  const { clusters: spotClusters, supercluster } = useMarkerClustering(
    spotsToCluster, bounds, viewState.zoom, clusteringOptions
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

  // Compute radar tile URL from frames + index
  const radarTileUrl = useMemo(() => {
    if (!radarFrames?.length || radarFrameIndex == null) return null;
    const frame = radarFrames[radarFrameIndex];
    if (!frame?.path) return null;
    return `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  }, [radarFrames, radarFrameIndex]);

  return (
    <Map
      ref={innerMapRef}
      {...viewState}
      onMove={onMove}
      mapStyle={getMapStyle(isLight, activeLayers?.includes('satellite'))}
      style={{ width: '100%', height: '100%' }}
      maxPitch={60}
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

      {/* Live Radar (RainViewer — animated frames) */}
      {activeLayers.includes('radar') && radarTileUrl && (
        <Source
          key={`radar-${radarFrameIndex}`}
          id="radar-source"
          type="raster"
          tiles={[radarTileUrl]}
          tileSize={256}
          maxzoom={7}
        >
          <Layer id="radar-layer" type="raster" paint={{ 'raster-opacity': 0.65 }} />
        </Source>
      )}

      {/* Open-Meteo Animated Weather Tiles (precipitation, wind, pressure) */}
      {/* Uses the om:// custom protocol — works for both live AND forecast time offsets */}
      {omTileUrl && (
        <Source
          key={`om-weather-${omTileUrl}`}
          id="om-weather-source"
          type="raster"
          url={omTileUrl}
          maxzoom={12}
        >
          <Layer
            id="om-weather-layer"
            type="raster"
            paint={{ 'raster-opacity': 0.7, 'raster-fade-duration': 300 }}
          />
        </Source>
      )}

      {/* Wave/Swell layers — no raster tiles available yet, handled by data-card overlay */}

      {/* Spot Clusters */}
      {spotClusters.map(cluster => {
        const [lng, lat] = [cluster.longitude, cluster.latitude];
        if (cluster.isCluster) {
          return (
            <Marker key={cluster.id} longitude={lng} latitude={lat} anchor="center">
              <div 
                className="w-10 h-10 rounded-full bg-cyan-500 bg-opacity-80 flex items-center justify-center text-white font-bold border-2 border-white shadow-lg cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  innerMapRef.current.flyTo({
                    center: [lng, lat],
                    zoom: cluster.expansionZoom
                  });
                }}
              >
                {cluster.pointCount}
              </div>
            </Marker>
          );
        }

        // Single Spot Marker
        const hasPhotographers = cluster.active_photographers_count > 0;
        const isWithinGeofence = cluster.is_within_geofence;
        return (
          <Marker 
            key={`spot-${cluster.id}`} 
            longitude={lng} 
            latitude={lat} 
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              if (onSpotClick) onSpotClick(cluster.spot);
              // Cinematic 3D swoop
              innerMapRef.current.flyTo({
                center: [lng, lat],
                zoom: 14,
                pitch: 45,
                duration: 1500
              });
            }}
          >
            <div className="relative cursor-pointer">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md ${
                !isWithinGeofence
                  ? 'bg-zinc-800 border-2 border-zinc-600 opacity-60'
                  : hasPhotographers 
                    ? 'bg-gradient-to-r from-emerald-400 to-yellow-400' 
                    : 'bg-zinc-700 border-2 border-zinc-500'
              }`}>
                <svg className={`w-4 h-4 ${hasPhotographers && isWithinGeofence ? 'text-black' : 'text-gray-300'}`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
              </div>
              {hasPhotographers && isWithinGeofence && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold animate-pulse motion-reduce:animate-none">
                  {cluster.active_photographers_count}
                </div>
              )}
            </div>
          </Marker>
        );
      })}

      {/* Photographer Markers (Unclustered for instant visibility) */}
      {(filter === 'all' || filter === 'photographers') && livePhotographers.map(p => {
        if (!p.latitude || !p.longitude) return null;
        const isPulsing = pulsingMarkers?.has(p.id);
        const isShootingLive = p.is_streaming || p.is_live;
        const isOnDemand = p.on_demand_available || p.is_available_on_demand;
        const isBoth = isShootingLive && isOnDemand;

        return (
          <Marker 
            key={`photo-${p.id}`} 
            longitude={p.longitude} 
            latitude={p.latitude} 
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              if (onPhotographerClick) onPhotographerClick(p);
            }}
          >
            <div className="relative w-12 h-12 cursor-pointer">
              {isPulsing && (
                <div className="absolute inset-0 w-16 h-16 -top-2 -left-2 rounded-full animate-ping motion-reduce:animate-none motion-reduce:hidden opacity-60 bg-cyan-400"></div>
              )}
              <div className={`relative w-12 h-12 rounded-full p-[3px] shadow-lg ${
                isBoth ? 'bg-purple-500' : isShootingLive ? 'bg-red-500' : isOnDemand ? 'bg-green-500' : 'bg-gradient-to-r from-cyan-400 to-blue-500'
              }`}>
                <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                  {p.avatar_url 
                    ? <img src={p.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                    : <span className="text-lg text-white">{p.full_name?.charAt(0) || '?'}</span>
                  }
                </div>
              </div>
            </div>
          </Marker>
        );
      })}

      {/* User Location Marker */}
      {effectiveLocation && effectiveLocation.lat && effectiveLocation.lng && (
        <Marker longitude={effectiveLocation.lng} latitude={effectiveLocation.lat} anchor="center">
          <div className="relative">
            <div className="absolute inset-0 w-6 h-6 rounded-full bg-blue-500 animate-ping motion-reduce:animate-none motion-reduce:opacity-10 opacity-30"></div>
            <div className="w-6 h-6 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center shadow-lg">
              <div className="w-2 h-2 bg-white rounded-full"></div>
            </div>
          </div>
        </Marker>
      )}

      {/* Dispatch Tracking (Photographer) */}
      {activeDispatch?.photographer_location?.lat && activeDispatch?.photographer_location?.lng && (
        <Marker longitude={activeDispatch.photographer_location.lng} latitude={activeDispatch.photographer_location.lat} anchor="bottom">
          <div className="relative animate-bounce motion-reduce:animate-none">
            <div className="w-12 h-12 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4z"/>
                <circle cx="10" cy="11" r="3"/>
              </svg>
            </div>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-cyan-500 rounded-full text-xs text-white font-bold whitespace-nowrap shadow-sm">
              {activeDispatch.estimated_arrival_minutes || '?'} min
            </div>
          </div>
        </Marker>
      )}

      {/* Dispatch Tracking (Surfer / Requester) */}
      {activeDispatch?.requester_location?.lat && activeDispatch?.requester_location?.lng && (
        <Marker longitude={activeDispatch.requester_location.lng} latitude={activeDispatch.requester_location.lat} anchor="bottom">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg ring-4 ring-yellow-400/30">
              <span className="text-xl">{'\u{1F30A}'}</span>
            </div>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-yellow-500 rounded-full text-[10px] text-black font-bold shadow-sm">
              YOU
            </div>
          </div>
        </Marker>
      )}

      {/* Friends on Map */}
      {friendsOnMap && friendsOnMap.length > 0 && friendsOnMap.map(friend => (
        <Marker key={`friend-${friend.id}`} longitude={friend.longitude} latitude={friend.latitude} anchor="bottom">
          <div className="relative cursor-pointer hover:scale-110 transition-transform motion-reduce:transition-none">
            <div className="w-10 h-10 rounded-full p-[2px] bg-gradient-to-r from-pink-500 to-rose-400 shadow-lg">
              <div className="w-full h-full rounded-full bg-black overflow-hidden border border-zinc-800">
                {friend.avatar_url ? (
                  <img src={friend.avatar_url} alt="friend" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white bg-zinc-800">
                    {friend.full_name?.charAt(0) || '?'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Marker>
      ))}
    </Map>
  );
};

export default MapWebGL;
