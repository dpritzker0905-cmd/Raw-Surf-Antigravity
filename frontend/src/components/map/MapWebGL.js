import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
maplibregl.setWorkerUrl('/maplibre-gl-worker.js');

import { getMapStyle, FLORIDA_CENTER } from './mapUtils';
import { useMarkerClustering } from '../../hooks/useMarkerClustering';
import { useTheme } from '../../contexts/ThemeContext';
import { WindParticleCanvas } from './GPUWindLayer';
import { useWeatherEngine } from './WeatherEngine';
import { useMapRenderContract } from './useMapRenderContract';
import { useRasterTransactions } from './useRasterTransactions';
import { useMarineOrchestrator } from './useMarineOrchestrator';
import { useLayerTruthDiff } from './useLayerTruthDiff';
import TruthOverlay from './TruthOverlay';
import { LAYER_REGISTRY, resolveRasterSource } from './LayerRegistry';
import { validateModelAccess, getUserTier } from './LayerAccessResolver';

// Ensure maplibre-gl CSS is present
import 'maplibre-gl/dist/maplibre-gl.css';

window.__LRCM_EXEC_TRACE__ = [];
window.__RASTER_DEBUG__ = { failFast: true, logMissingVariables: true };
export function trace(layer, action, source, payload) {
  window.__LRCM_EXEC_TRACE__.push({
    layer,
    action,
    source,
    timestamp: Date.now(),
    payload,
    stack: new Error().stack
  });
  return payload;
}

const EMPTY_MARINE_FC = { type: 'FeatureCollection', features: [] };

/**
 * Map Open-Meteo model identifiers to their tile-server paths.
 * Used to construct om:// source URLs.
 */
const OM_MODEL_MAP = {
  GFS:  'ncep_gfs025',
  EURO: 'ecmwf_ifs025',
  ICON: 'dwd_icon',
};

// OM_VARIABLE_MAP has been replaced by LAYER_REGISTRY

// Cache to prevent repetitive manifest fetching during layer toggles
const MODEL_METADATA_CACHE = {};
const MODEL_METADATA_PROMISES = {};

// marineController is now consumed via useMarineOrchestrator hook

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
  userTier = 'tier_1',
  onMapClick,
}) => {
  const innerMapRef = useRef(null);
  const { theme } = useTheme();
  
  const [viewState, setViewState] = useState({
    longitude: FLORIDA_CENTER.lng, latitude: FLORIDA_CENTER.lat,
    zoom: 7, pitch: 0, bearing: 0
  });

  const [mapInstance, setMapInstance] = useState(null);
  
  // Shared Weather Animation Controller
  const weatherAnimRef = useRef({ active: false, start: 0, duration: 600 });
  const animFrameRef = useRef(null);
  
  // Weather Engine: Completely decoupled from map lifecycle, runs on strict time intervals
  const { windData, windRevision } = useWeatherEngine({
    activeLayers,
    mapInstance
  });

  const [protocolReady, setProtocolReady] = useState(false);
  useEffect(() => {
    import('@openmeteo/weather-map-layer').then(({ omProtocol }) => {
      if (maplibregl?.addProtocol) { try { maplibregl.addProtocol('om', omProtocol); } catch (e) {} }
      setProtocolReady(true);
    });
    const suppressAbortRejections = (event) => {
      const reason = event?.reason;
      if (reason?.name === 'AbortError' || reason?.message?.includes('aborted')) event.preventDefault();
    };
    window.addEventListener('unhandledrejection', suppressAbortRejections);
    return () => window.removeEventListener('unhandledrejection', suppressAbortRejections);
  }, []);

  const activeWeatherVariable = useMemo(() => {
    if (!activeLayers.length) return null;
    const layer = LAYER_REGISTRY[activeLayers[0]];
    return layer?.omVariable || null;
  }, [activeLayers]);

  useEffect(() => {
    trace(activeLayers[0] || 'none', 'toggle_layer', 'MapWebGL', { activeLayers });
  }, [activeLayers]);

  useEffect(() => {
    trace('all', 'select_model', 'MapWebGL', { activeModel });
  }, [activeModel]);

  // LRCM: Derived render type — drives which renderer pipeline is active
  const activeRenderType = useMemo(() => {
    const layerId = activeLayers[0];
    if (!layerId) return 'none';
    const layer = LAYER_REGISTRY[layerId];
    if (!layer) return 'none';
    if (layer.type === 'raster') return layer.id === 'radar' ? 'radar' : 'raster';
    if (layer.type === 'marine') return 'marine';
    if (layer.type === 'canvas' && layer.id === 'wind') return 'wind';
    return 'none';
  }, [activeLayers]);


  const [omTileUrls, setOmTileUrls] = useState({});
  const [initialOmUrls, setInitialOmUrls] = useState({});
  const [initialRadarUrl, setInitialRadarUrl] = useState(null);

  // v242: Global Render Contract — single source of truth for map readiness
  const renderContract = useMapRenderContract(mapInstance);

  // Raster Transaction Layer — now gated by render contract
  const { queueRasterUpdate } = useRasterTransactions(mapInstance, renderContract);

  // Marine Orchestrator — single-pipeline data fetching
  const { marineData } = useMarineOrchestrator({ mapInstance, activeLayers });

  const activeMarineLayer = useMemo(() => {
    return ['waves', 'swell_1', 'swell_2', 'wind_waves'].find(l => activeLayers.includes(l));
  }, [activeLayers]);

  const marineWindData = useMemo(() => {
    if (!marineData?.grid?.vectors || !activeMarineLayer) return null;
    return {
      bounds: marineData.grid.bounds,
      cols: marineData.grid.cols,
      rows: marineData.grid.rows,
      vectors: marineData.grid.vectors.map(v => ({
        lat: v.lat,
        lng: v.lng,
        u: v[activeMarineLayer]?.u || 0,
        v: v[activeMarineLayer]?.v || 0,
        speed: v[activeMarineLayer]?.speed || 0
      }))
    };
  }, [marineData, activeMarineLayer]);

  // v246: Layer Truth Diff Engine — declared vs actual state comparison
  // MUST be after all data source declarations (windData, marineData) to avoid TDZ
  const { issues: truthIssues, rasterVisible } = useLayerTruthDiff({
    mapInstance, activeLayers, activeRenderType, windData, marineData
  });

  // Bootstrapping and Transacting Open-Meteo
  useEffect(() => {
    Object.keys(omTileUrls).forEach(layerKey => {
      const url = omTileUrls[layerKey];
      if (!initialOmUrls[layerKey]) {
        setInitialOmUrls(prev => ({ ...prev, [layerKey]: url }));
      } else if (initialOmUrls[layerKey] !== url) {
        // v251: Mutating time step on dedicated source
        queueRasterUpdate(`${layerKey}-source`, url, false);
      }
    });
  }, [omTileUrls, initialOmUrls, queueRasterUpdate]);

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
    // v251: Generate URLs for ALL OM variables, decoupling from activeLayers.
    // This allows dedicated static sources for each variable to prevent stale texture bleeds.
    const targetModel = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    let isMounted = true;

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

    const resolveAllUrls = async () => {
      try { validateModelAccess(activeModel || 'GFS', userTier); } 
      catch (err) { console.error('[MapWebGL] LAYER_ACCESS_DENIED:', err.message); return; }

      const newUrls = {};
      const variablesToResolve = Object.keys(LAYER_REGISTRY).filter(k => LAYER_REGISTRY[k].omVariable).map(k => [k, LAYER_REGISTRY[k].omVariable]);

      for (const [layerKey, variable] of variablesToResolve) {
        let layerModel = targetModel;
        // v257: GFS map tiles lack precipitation, cloud_cover, and cloud_cover_low; fallback these specific variables to ICON
        if (layerModel === 'ncep_gfs025' && (variable === 'precipitation' || variable === 'cloud_cover' || variable === 'cloud_cover_low')) {
          layerModel = 'dwd_icon';
        }

        let meta = await fetchMetadata(layerModel);
        if (meta.variables.includes(variable)) {
          const darkParam = !isLight ? '&dark=true' : '';
          const urlStr = `om://https://map-tiles.open-meteo.com/data_spatial/${layerModel}/latest.json?${computeTimeStep(meta)}&variable=${variable}${darkParam}`;
          newUrls[layerKey] = trace(layerKey, 'resolve_raster', 'MapWebGL', urlStr);
        } else if (window.__RASTER_DEBUG__?.failFast !== false) {
          if (window.__RASTER_DEBUG__?.logMissingVariables) console.warn(`[Raster] MISSING VARIABLE: ${variable} in ${layerModel}`);
          if (activeLayers.includes(layerKey)) {
            throw new Error("MISSING_RASTER_VARIABLE: " + variable);
          }
        }
      }

      if (isMounted) {
        setOmTileUrls(newUrls);
      }
    };
    
    resolveAllUrls();
    
    return () => { isMounted = false; };
  }, [activeModel, isLight, timeOffsetHours, fetchMetadata]);

  // Sync ref to parent so useMapActions works
  useEffect(() => {
    if (innerMapRef.current) {
      if (mapInstanceRef) mapInstanceRef.current = innerMapRef.current.getMap();
    }
  }, [mapInstanceRef, innerMapRef.current]);

  const onMove = useCallback(evt => {
    setViewState(evt.viewState);
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

  // Derive bounds for clustering directly from the map instance on each render
  const currentBounds = useMemo(() => {
    if (!mapInstance) return [-180, -85, 180, 85];
    const b = mapInstance.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }, [mapInstance, viewState.longitude, viewState.latitude, viewState.zoom]);

  const { clusters: spotClusters, supercluster } = useMarkerClustering(
    spotsToCluster, currentBounds, viewState.zoom, clusteringOptions
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

  // Bootstrapping and Transacting Radar
  useEffect(() => {
    if (radarTileUrl) {
      if (!initialRadarUrl) {
        setInitialRadarUrl(radarTileUrl);
      } else {
        queueRasterUpdate('radar-source', [radarTileUrl], true);
      }
    }
  }, [radarTileUrl, initialRadarUrl, queueRasterUpdate]);

  // Fix Map Dragging Bug: Memoize map style to prevent full map re-render on ViewState change
  const currentMapStyle = useMemo(() => trace('map', 'resolve_style', 'MapWebGL', getMapStyle(isLight, false)), [isLight]);

  // --- WIND PARTICLE ENGINE & MARINE OVERLAYS ---

  // Capture the raw MapLibre instance once the map loads, set initial bounds,
  // and force a repaint so layers render without needing user pan/scroll.
  useEffect(() => {
    const map = innerMapRef.current?.getMap?.();
    if (map && !mapInstance) {
      setMapInstance(map);

      // v239: Suppress async AbortErrors from MapLibre's internal tile-fetch pipeline.
      // These fire AFTER setUrl() returns (asynchronous Promise rejection inside workers),
      // so the try-catch in useRasterTransactions cannot intercept them.
      map.on('error', (e) => {
        if (e?.error?.name === 'AbortError' || e?.error?.message?.includes('aborted')) {
          return; // Swallow — this is expected during raster source transitions
        }
        console.error('[MapLibre Error]', e?.error || e);
      });
      
      // Force render loop to paint custom-protocol tiles on mount
      setTimeout(() => {
        try { map.triggerRepaint(); } catch(e) {}
      }, 300);
    }
  });

  useEffect(() => {
    if (!mapInstance) return;
    weatherAnimRef.current = { active: true, start: performance.now(), duration: 600 };
    const MARINE_LAYERS = ['marine-wave-height-layer', 'marine-swell-primary-layer', 'marine-swell-secondary-layer', 'marine-wind-wave-layer'];
    const animateWeatherLayers = () => {
      const anim = weatherAnimRef.current;
      if (!anim.active) return;
      let t = (performance.now() - anim.start) / anim.duration;
      if (t >= 1) { anim.active = false; t = 1; }
      const p = 1 - Math.pow(1 - t, 3);
      if (mapInstance.getStyle()) {
        try {
          if (activeRenderType === 'raster') {
            const lk = activeLayers[0], lid = `${lk}-layer`;
            if (lk && mapInstance.getLayer(lid)) {
              const base = lk === 'pressure' ? 0.45 : lk === 'satellite' ? 1.0 : 0.7;
              mapInstance.setPaintProperty(lid, 'raster-opacity', base * p);
            }
          }
          if (activeRenderType === 'radar' && mapInstance.getLayer('radar-layer')) mapInstance.setPaintProperty('radar-layer', 'raster-opacity', 0.65 * p);
        } catch (e) {}
      }
      if (activeLayers.includes('wind')) { 
        const wc = document.getElementById('wind-canvas-layer'); 
        if (wc) wc.style.opacity = p; 
      }
      
      const hasMarine = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayers.includes(l));
      if (hasMarine) { 
        const mc = document.getElementById('marine-canvas-layer'); 
        if (mc) mc.style.opacity = p; 
      }
      if (t < 1) { try { mapInstance.triggerRepaint(); } catch(e) {} animFrameRef.current = requestAnimationFrame(animateWeatherLayers); }
    };
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(animateWeatherLayers);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [mapInstance, activeLayers, activeRenderType]);

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
      {initialRadarUrl && (
        <Source
          id="radar-source"
          type="raster"
          tiles={[initialRadarUrl]}
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
        />
      </Source>

      {/* v251: Open-Meteo Independent Static Tile Sources */}
      {protocolReady && Object.entries(initialOmUrls).map(([layerKey, url]) => (
        <Source
          key={`${layerKey}-source`}
          id={`${layerKey}-source`}
          type="raster"
          url={url}
          maxzoom={12}
        >
          <Layer
            id={`${layerKey}-layer`}
            type="raster"
            layout={{ 
              visibility: activeLayers.includes(layerKey) ? 'visible' : 'none' 
            }}
            paint={{ 
              'raster-opacity': layerKey === 'pressure' ? 0.45 : 0.7, 
              // Set raster-fade-duration to 0 to let our Shared Clock drive the transition
              'raster-fade-duration': 0 
            }}
          />
        </Source>
      ))}

      {/* Marine Vector Particle Engine */}
      <WindParticleCanvas 
        id="marine-canvas-layer"
        mapInstance={mapInstance} 
        active={!!activeMarineLayer}
        data={marineWindData}
        revision={marineData?.grid?.timestamp || Date.now()}
        isMarine={true}
        theme={theme}
      />

      {/* Spot Clusters */}
      {spotClusters.map(cluster => {
        const [lng, lat] = [cluster.longitude, cluster.latitude];
        if (cluster.isCluster) {
          return (
            <Marker key={cluster.id} longitude={lng} latitude={lat} anchor="center">
              <div 
                className="w-10 h-10 rounded-full bg-orange-500 bg-opacity-80 flex items-center justify-center text-white font-bold border-2 border-white shadow-lg cursor-pointer"
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

      {/* Wind Particle Advection Engine */}
      <WindParticleCanvas 
        mapInstance={mapInstance} 
        active={activeLayers.includes('wind')}
        data={windData}
        revision={windRevision.current}
        theme={theme}
      />
    </Map>
    </div>
  );
};

export default MapWebGL;
