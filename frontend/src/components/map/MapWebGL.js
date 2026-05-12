import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { getMapStyle, FLORIDA_CENTER } from './mapUtils';
import { useMarkerClustering } from '../../hooks/useMarkerClustering';
import { useTheme } from '../../contexts/ThemeContext';
import { useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { useGPUWindLayer } from './GPUWindLayer';
import { useGPUWaveLayer } from './GPUWaveLayer';

// Ensure maplibre-gl CSS is present
import 'maplibre-gl/dist/maplibre-gl.css';

import { omProtocol } from '@openmeteo/weather-map-layer';

function DeckGLOverlay(props) {
  const overlay = useControl(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// --- Open-Meteo Weather Tile Protocol ---
// The `om://` custom protocol is now registered inside the MapWebGL component via useEffect
// to prevent Webpack module-level TDZ (Temporal Dead Zone) ReferenceErrors during chunk initialization.

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
  wind:          null,             // Raster disabled; canvas particle engine now paints its own dynamic color layer
  pressure:      'pressure_msl',
  fog:           'cloud_cover_low', // Better proxy for fog than visibility
  satellite:     'cloud_cover',    // Cloud cover tiles = satellite-style cloud visualization
  waves:         null,             // Marine models use GeoJSON heatmap
  swell_1:       null,
  swell_2:       null,
  wind_waves:    null,
};

// Cache to prevent repetitive manifest fetching during layer toggles
const MODEL_METADATA_CACHE = {};
const MODEL_METADATA_PROMISES = {};

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
  onMapClick,
}) => {
  const innerMapRef = useRef(null);
  const { theme } = useTheme();
  const isBeach = theme === 'beach';
  
  // Instantiate the WebGL GPU layers unconditionally
  const gpuWindLayer = useGPUWindLayer({
    active: activeLayers.includes('wind') || activeLayers.includes('pressure'),
    timeOffsetHours,
    isLight
  });
  
  const gpuWaveLayer = useGPUWaveLayer({
    active: ['waves','swell_1','swell_2','wind_waves'].some(l => activeLayers.includes(l)),
    activeLayer: activeLayers.find(l => ['waves','swell_1','swell_2','wind_waves'].includes(l)) || 'waves',
    timeOffsetHours,
    isLight
  });

  // Register Open-Meteo protocol safely on mount
  useEffect(() => {
    if (maplibregl && maplibregl.addProtocol) {
      try {
        maplibregl.addProtocol('om', omProtocol);
      } catch (e) {
        // Ignore if already registered
      }
    }
  }, []);
  const [viewState, setViewState] = useState({
    longitude: FLORIDA_CENTER.lng,
    latitude: FLORIDA_CENTER.lat,
    zoom: 7,
    pitch: 0,
    bearing: 0
  });
  
  const [bounds, setBounds] = useState(null);

  // Open-Meteo tile source URL — built dynamically after checking model capabilities
  // Track the active weather variable for stable Source IDs
  const activeWeatherVariable = useMemo(() => {
    if (!activeLayers.length) return null;
    return OM_VARIABLE_MAP[activeLayers[0]] || null;
  }, [activeLayers]);
  const [omTileUrl, setOmTileUrl] = useState(null);

  /** Fetch and cache model metadata (variables + valid_times) using Promises to prevent races */
  const fetchMetadata = useCallback(async (modelToCheck) => {
    if (MODEL_METADATA_CACHE[modelToCheck]) return MODEL_METADATA_CACHE[modelToCheck];

    if (!MODEL_METADATA_PROMISES[modelToCheck]) {
      MODEL_METADATA_PROMISES[modelToCheck] = fetch(`https://map-tiles.open-meteo.com/data_spatial/${modelToCheck}/latest.json`)
        .then(res => {
          if (!res.ok) throw new Error('Fetch failed');
          return res.json();
        })
        .then(data => {
          const result = {
            variables: data.variables || [],
            validTimes: data.valid_times || [],
            referenceTime: data.reference_time || null,
          };
          MODEL_METADATA_CACHE[modelToCheck] = result;
          return result;
        })
        .catch(err => {
          console.warn(`[MapWebGL] Failed to fetch latest.json for ${modelToCheck}`, err);
          return { variables: [], validTimes: [], referenceTime: null };
        });
    }
    return MODEL_METADATA_PROMISES[modelToCheck];
  }, []);

  // Pre-warm metadata cache on mount so layer toggles are instant
  useEffect(() => {
    ['ncep_gfs025', 'dwd_icon'].forEach(m => fetchMetadata(m));
  }, [fetchMetadata]);

  useEffect(() => {
    if (!activeLayers.length) { setOmTileUrl(null); return; }
    const activeLayer = activeLayers[0];
    
    // Radar uses RainViewer, not Open-Meteo tiles
    if (activeLayer === 'radar') { setOmTileUrl(null); return; }
    
    const variable = OM_VARIABLE_MAP[activeLayer];
    if (!variable) { setOmTileUrl(null); return; }
    
    const targetModel = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    let isMounted = true;

    /** Compute time_step param from timeOffsetHours using cached valid_times. */
    const computeTimeStep = (meta) => {
      if (timeOffsetHours === 0) return 'time_step=current_time_1H';
      const { validTimes } = meta;
      if (!validTimes.length) return 'time_step=current_time_1H';
      const targetMs = Date.now() + timeOffsetHours * 3600000;
      let closestTs = validTimes[0];
      let minDiff = Infinity;
      for (let i = 0; i < validTimes.length; i++) {
        const diff = Math.abs(new Date(validTimes[i]).getTime() - targetMs);
        if (diff < minDiff) { minDiff = diff; closestTs = validTimes[i]; }
      }
      return `time_step=${closestTs}`;
    };

    const resolveUrl = async () => {
      let meta = await fetchMetadata(targetModel);
      let finalModel = targetModel;
      let isValid = meta.variables.includes(variable);
      
      // Dynamic Fallback chain: primary → DWD ICON → GFS → wave models
      if (!isValid && finalModel !== 'dwd_icon') {
        meta = await fetchMetadata('dwd_icon');
        if (meta.variables.includes(variable)) { isValid = true; finalModel = 'dwd_icon'; }
      }
      if (!isValid && finalModel !== 'ncep_gfs025') {
        meta = await fetchMetadata('ncep_gfs025');
        if (meta.variables.includes(variable)) { isValid = true; finalModel = 'ncep_gfs025'; }
      }
      if (!isValid) {
        meta = await fetchMetadata('gfs_wave');
        if (meta.variables.includes(variable)) { isValid = true; finalModel = 'gfs_wave'; }
      }
      if (!isValid) {
        meta = await fetchMetadata('meteofrance_wave');
        if (meta.variables.includes(variable)) { isValid = true; finalModel = 'meteofrance_wave'; }
      }
      
      if (isMounted) {
        if (isValid) {
          const darkParam = !isLight ? '&dark=true' : '';
          const timeParam = computeTimeStep(meta);
          const url = `om://https://map-tiles.open-meteo.com/data_spatial/${finalModel}/latest.json?${timeParam}&variable=${variable}${darkParam}`;
          setOmTileUrl(url);
        } else {
          console.warn(`[MapWebGL] Variable ${variable} unsupported across all models. Skipping tile layer.`);
          setOmTileUrl(null);
        }
      }
    };
    
    resolveUrl();
    
    return () => { isMounted = false; };
  }, [activeLayers, activeModel, isLight, timeOffsetHours, fetchMetadata]);

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

  // Compute radar tile URL from frames + index (2026 hash-based format)
  const radarTileUrl = useMemo(() => {
    if (!radarFrames?.length || radarFrameIndex == null) return null;
    const frame = radarFrames[radarFrameIndex];
    if (!frame?.path) return null;
    // 2026 API: color=7 (Universal Blue), smooth=1, snow=0, max zoom=7
    return `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/7/1_0.png`;
  }, [radarFrames, radarFrameIndex]);

  // Fix Map Dragging Bug: Memoize map style to prevent full map re-render on ViewState change
  const currentMapStyle = useMemo(() => getMapStyle(isLight, false), [isLight]);

  // Unique revision counter for marine data to force Source remount on data change
  const marineRevision = useRef(0);

  // --- WIND PARTICLE ENGINE & MARINE OVERLAYS ---
  const [mapInstance, setMapInstance] = useState(null);
  const [marineData, setMarineData] = useState(null);
  const isFetchingMarine = useRef(false);

  // Capture the raw MapLibre instance once the map loads
  useEffect(() => {
    const map = innerMapRef.current?.getMap?.();
    if (map && !mapInstance) setMapInstance(map);
  });

  // Fetch dynamic, global marine data with strict 1.2s debounce
  // Uses a sparse 8x8 grid (64 points) to fit within a single Open-Meteo API call (<100 points).
  // Heatmap rendering handles massive interpolation to display a beautiful global color map.
  useEffect(() => {
    if (!mapInstance) return;
    const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
    const hasMarine = MARINE_LAYERS.some(l => activeLayers.includes(l));
    if (!hasMarine) {
      if (marineData) setMarineData(null);
      return;
    }

    let timeoutId;
    const updateMarineGrid = async () => {
      if (isFetchingMarine.current) return;
      isFetchingMarine.current = true;
      
      try {
        const bounds = mapInstance.getBounds();
        const latMin = Math.max(-80, bounds.getSouth() - 5);
        const latMax = Math.min(80, bounds.getNorth() + 5);
        const lngMin = bounds.getWest() - 5;
        const lngMax = bounds.getEast() + 5;

        // Sparse 8x8 global grid (64 points total)
        const latStep = Math.max(1, (latMax - latMin) / 8);
        const lngStep = Math.max(1, (lngMax - lngMin) / 8);

        const latSteps = [];
        for (let lat = latMax; lat >= latMin; lat -= latStep) latSteps.push(Number(lat.toFixed(2)));
        
        const lngSteps = [];
        for (let lng = lngMin; lng <= lngMax; lng += lngStep) {
          let normLng = lng;
          while (normLng > 180) normLng -= 360;
          while (normLng < -180) normLng += 360;
          lngSteps.push(Number(normLng.toFixed(2)));
        }

        const allPoints = [];
        for (const lat of latSteps) {
          for (const lng of lngSteps) { allPoints.push({ lat, lng }); }
        }

        // Limit strictly to 95 points just to be safe (Open-Meteo limit is 100)
        const safePoints = allPoints.slice(0, 95);
        const lats = safePoints.map(p => p.lat).join(',');
        const lons = safePoints.map(p => p.lng).join(',');

        const res = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&current=wave_height,wave_period`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        const allResults = Array.isArray(data) ? data : [data];

        const features = safePoints.map((pt, i) => {
          const r = allResults[i];
          if (!r || !r.current) return null;
          const wh = r.current.wave_height;
          const wp = r.current.wave_period;
          if (wh == null && wp == null) return null; // Ignore land masses
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
            properties: { wave_height: wh ?? 0, wave_period: wp ?? 0 },
          };
        }).filter(Boolean);

        if (features.length > 0) {
          marineRevision.current += 1;
          setMarineData({ type: 'FeatureCollection', features });
        }
      } catch (err) {
        console.warn('[MapWebGL] Global marine sparse fetch failed:', err);
      } finally {
        isFetchingMarine.current = false;
      }
    };

    const debouncedUpdate = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(updateMarineGrid, 1200); // 1.2s debounce prevents rate limit 429
    };

    // Initial fetch
    debouncedUpdate();

    // Re-fetch when map stops moving
    mapInstance.on('moveend', debouncedUpdate);
    return () => {
      clearTimeout(timeoutId);
      mapInstance.off('moveend', debouncedUpdate);
    };
  }, [activeLayers, mapInstance]);

  // Coastline border enhancement via OpenMapTiles country-boundary vector overlay
  // The base map uses Mapbox raster tiles (no individual vector layers to modify),
  // so we add a lightweight vector tile source with boundary lines on top.
  useEffect(() => {
    if (!mapInstance) return;
    const addCoastlines = () => {
      try {
        if (!mapInstance.getStyle()) return;
        const lineColor = isLight ? 'rgba(0,0,0,0.45)' : isBeach ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)';
        const lineWidth = 1.2;

        // If layer already exists, just update paint properties
        if (mapInstance.getLayer('coastline-overlay')) {
          mapInstance.setPaintProperty('coastline-overlay', 'line-color', lineColor);
          return;
        }

        // Add OpenMapTiles vector source (free, no key required for low traffic)
        if (!mapInstance.getSource('omtiles')) {
          mapInstance.addSource('omtiles', {
            type: 'vector',
            url: 'https://demotiles.maplibre.org/tiles/tiles.json',
          });
        }

        mapInstance.addLayer({
          id: 'coastline-overlay',
          type: 'line',
          source: 'omtiles',
          'source-layer': 'countries',
          paint: {
            'line-color': lineColor,
            'line-width': lineWidth,
            'line-opacity': 1,
          },
        });
      } catch (e) { /* layer may already exist during hot reload */ }
    };

    // MapLibre fires 'styledata' after style loads; safe to add layers
    if (mapInstance.isStyleLoaded()) {
      addCoastlines();
    } else {
      mapInstance.once('styledata', addCoastlines);
    }
    // Also re-run on theme change in case style has reloaded
    mapInstance.on('styledata', addCoastlines);
    return () => mapInstance.off('styledata', addCoastlines);
  }, [mapInstance, isLight, isBeach]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Map
      ref={innerMapRef}
      mapLib={maplibregl}
      {...viewState}
      onMove={onMove}
      onClick={onMapClick}
      mapStyle={currentMapStyle}
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

      {/* Open-Meteo Animated Weather Tiles — stable Source ID, keyed on variable for clean swap */}
      {omTileUrl && (
        <Source
          key={omTileUrl}
          id="om-weather-source"
          type="raster"
          url={omTileUrl}
          maxzoom={12}
        >
          <Layer
            id="om-weather-layer"
            type="raster"
            paint={{ 
              'raster-opacity': activeLayers.includes('pressure') ? 0.45 : 0.7, 
              'raster-fade-duration': 300 
            }}
          />
        </Source>
      )}

      {/* Marine Wave Heatmap & Data Labels — stable IDs, keyed on revision for clean data swap */}
      {marineData && ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayers.includes(l)) && (
        <Source 
          key={`marine-src-${marineRevision.current}`}
          id="marine-data-source"
          type="geojson" 
          data={marineData}
        >
          <Layer
            id="marine-heatmap-circles"
            type="circle"
            paint={{
              'circle-color': [
                'interpolate', ['linear'],
                ['get', 'wave_height'],
                0, 'rgba(0,0,0,0)',
                0.5, '#93c5fd',
                1.5, '#22d3ee',
                2.5, '#2563eb',
                3.5, '#9333ea',
                5.0, '#be123c'
              ],
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 30, 3, 50, 6, 80, 10, 120],
              'circle-blur': 0.65,
              'circle-opacity': 0.7
            }}
          />
          <Layer
            id="marine-data-labels"
            type="symbol"
            layout={{
              'text-field': [
                'concat',
                ['to-string', ['get', 'wave_height']],
                'm'
              ],
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 0, 0, 2, 10, 6, 14, 10, 18],
              'text-anchor': 'center',
              'text-allow-overlap': true
            }}
            paint={{
              'text-color': '#ffffff',
              'text-halo-color': 'rgba(0,0,0,0.7)',
              'text-halo-width': 1.5
            }}
          />
        </Source>
      )}



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

      <DeckGLOverlay layers={[gpuWindLayer, gpuWaveLayer].filter(Boolean)} interleaved={true} />
    </Map>
    </div>
  );
};

export default MapWebGL;
