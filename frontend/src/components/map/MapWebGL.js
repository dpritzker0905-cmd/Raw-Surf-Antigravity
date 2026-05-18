import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';

import { getMapStyle, FLORIDA_CENTER } from './mapUtils';
import { useMarkerClustering } from '../../hooks/useMarkerClustering';
import { useTheme } from '../../contexts/ThemeContext';
import { WindParticleCanvas } from './GPUWindLayer';
import { MarineParticleCanvas } from './GPUMarineLayer';
import MapMarkerLayers from './MapMarkerLayers';
// v3.12.3: WebGLWindLayer disabled — MapLibre custom layer has WebGL state conflicts
// that prevent reliable particle compositing. Canvas2D overlay (Ventusky technique) used instead.
// import { WebGLWindLayer } from './WebGLWindLayer';
import { WindParticleOverlay } from './WindParticleOverlay';
import { useWeatherEngine } from './WeatherEngine';
import { useMapRenderContract } from './useMapRenderContract';
import { useRasterTransactions } from './useRasterTransactions';
import { useMarineOrchestrator } from './useMarineOrchestrator';
import { useLayerTruthDiff } from './useLayerTruthDiff';
import TruthOverlay from './TruthOverlay';
import { LAYER_REGISTRY, resolveRasterSource } from './LayerRegistry'; // eslint-disable-line
import { validateModelAccess, getUserTier } from './LayerAccessResolver'; // eslint-disable-line
import { markDOMReady, markMapReady } from '../../engine/init-sequencer';
import { useTemporalPreloader } from './useTemporalPreloader';

// Ensure maplibre-gl CSS is present
import 'maplibre-gl/dist/maplibre-gl.css';

// v3.9.7: Lazy init — moved from module-level to prevent TDZ in webpack concatenation
var _mapLibreWorkerSet = false;
function ensureMapLibreInit() {
  if (!_mapLibreWorkerSet) {
    maplibregl.setWorkerUrl('/maplibre-gl-worker.js');
    if (!window.__LRCM_EXEC_TRACE__) window.__LRCM_EXEC_TRACE__ = [];
    if (!window.__RASTER_DEBUG__) window.__RASTER_DEBUG__ = { failFast: true, logMissingVariables: true };
    _mapLibreWorkerSet = true;
  }
}
export function trace(layer, action, source, payload) {
  if (!window.__LRCM_EXEC_TRACE__) window.__LRCM_EXEC_TRACE__ = [];
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

var EMPTY_MARINE_FC = { type: 'FeatureCollection', features: [] };

/**
 * Map Open-Meteo model identifiers to their tile-server paths.
 * Used to construct om:// source URLs.
 */
var OM_MODEL_MAP = {
  GFS:  'ncep_gfs025',
  EURO: 'ecmwf_ifs025',
  ICON: 'dwd_icon',
};

// Cache to prevent repetitive manifest fetching during layer toggles
var MODEL_METADATA_CACHE = {};
var MODEL_METADATA_PROMISES = {};

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
}) => {
  // v3.9.7: Explicit init — never at import time
  ensureMapLibreInit();
  markDOMReady(); // Init sequencer: DOM is ready when component renders
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
  // v3.12.4: Passes activeModel + tier-based forecastDays for multi-model support
  const forecastDays = useMemo(() => {
    var { resolveForecastWindow: rfw } = require('./LayerAccessResolver');
    return rfw(userTier);
  }, [userTier]);
  const { windData, windRevision } = useWeatherEngine({
    activeLayers, mapInstance, timeOffsetHours, activeModel, forecastDays
  });
  // v3.9.9: Temporal preloader — prefetch ±1hr tiles
  useTemporalPreloader({ currentHour: timeOffsetHours, activeLayers, mapInstance });

  const [protocolReady, setProtocolReady] = useState(false);
  useEffect(() => {
    import('@openmeteo/weather-map-layer').then(({ omProtocol }) => {
      if (maplibregl?.addProtocol) { try { maplibregl.addProtocol('om', omProtocol); } catch (e) { /* already registered */ } }
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
  const { marineData } = useMarineOrchestrator({ mapInstance, activeLayers, timeOffsetHours });

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
    ['ncep_gfs025', 'dwd_icon', 'ecmwf_wam025', 'ncep_gfswave025'].forEach(m => fetchMetadata(m));
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
        // v3.2: Marine layers use dedicated wave tile models, not atmospheric
        const registryEntry = LAYER_REGISTRY[layerKey];
        let layerModel = registryEntry?.omModel || targetModel;
        // v257: GFS map tiles lack precipitation, cloud_cover, and cloud_cover_low; fallback these specific variables to ICON
        if (layerModel === 'ncep_gfs025' && (variable === 'precipitation' || variable === 'cloud_cover' || variable === 'cloud_cover_low')) {
          layerModel = 'dwd_icon';
        }

        let meta = await fetchMetadata(layerModel);
        if (meta.variables.includes(variable)) {
          const darkParam = (theme === 'dark' || theme === 'beach') ? '&dark=true' : '';
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
  }, [activeModel, theme, timeOffsetHours, fetchMetadata]);

  // Sync ref to parent so useMapActions works
  useEffect(() => {
    if (innerMapRef.current) {
      if (mapInstanceRef) mapInstanceRef.current = innerMapRef.current.getMap();
    }
  }, [mapInstanceRef, innerMapRef.current]);

  const onMove = useCallback(evt => {
    setViewState(evt.viewState);
  }, []);

  // v3.7: Debounced moveend callback to update map center for forecast overlay
  const moveEndTimerRef = useRef(null);
  const onMoveEnd = useCallback((evt) => {
    if (onMapMoveEnd) {
      clearTimeout(moveEndTimerRef.current);
      moveEndTimerRef.current = setTimeout(() => {
        const { latitude, longitude } = evt.viewState;
        onMapMoveEnd({ lat: latitude, lng: longitude });
      }, 800);
    }
  }, [onMapMoveEnd]);

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

  // Derive bounds for clustering — must be an object {west,south,east,north}
  // to match useMarkerClustering's bbox extraction (NOT a flat array)
  const currentBounds = useMemo(() => {
    if (!mapInstance) return { west: -180, south: -85, east: 180, north: 85 };
    const b = mapInstance.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
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
  const currentMapStyle = useMemo(() => trace('map', 'resolve_style', 'MapWebGL', getMapStyle(theme, false)), [theme]);

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
      markMapReady(); // Init sequencer: map is ready
      setTimeout(() => { try { map.triggerRepaint(); } catch(e) { /* map may not be ready */ } }, 300);
    }
  });

  useEffect(() => {
    if (!mapInstance) return;

    // v3.11.2r1: Immediately reset canvas opacity for layers NOT in activeLayers
    // This prevents stale particles from persisting visually after layer switch
    const windActive = activeLayers.includes('wind');
    const marineActive = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayers.includes(l));
    const wc = document.getElementById('wind-canvas-layer');
    const mc = document.getElementById('marine-canvas-layer');
    if (!windActive && wc) {
      wc.style.opacity = '0';
      // Clear the canvas content to prevent flash on re-enable
      try { wc.getContext('2d')?.clearRect(0, 0, wc.width, wc.height); } catch(e) {}
    }
    if (!marineActive && mc) {
      mc.style.opacity = '0';
      try { mc.getContext('2d')?.clearRect(0, 0, mc.width, mc.height); } catch(e) {}
    }

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
          // v3.2: OM raster tiles for marine + wind layers (canvas particles overlay separately)
          if (activeRenderType === 'marine' || activeRenderType === 'wind') {
            const lk = activeLayers[0], lid = `${lk}-layer`;
            if (lk && mapInstance.getLayer(lid)) {
              mapInstance.setPaintProperty(lid, 'raster-opacity', 0.7 * p);
            }
          }
          if (activeRenderType === 'radar' && mapInstance.getLayer('radar-layer')) mapInstance.setPaintProperty('radar-layer', 'raster-opacity', 0.65 * p);
        } catch (e) { /* layer may have been removed */ }
      }
      if (windActive && wc) wc.style.opacity = p;
      if (marineActive && mc) mc.style.opacity = p;
      if (t < 1) { try { mapInstance.triggerRepaint(); } catch(e) { /* map disposed */ } animFrameRef.current = requestAnimationFrame(animateWeatherLayers); }
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
      onMoveEnd={onMoveEnd}
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
              // v3.12.4: Reduced opacity — no land mask, tiles visible everywhere.
              // Wind: very subtle (particles are primary). Marine: ocean-emphasis.
              'raster-opacity': ['interpolate', ['linear'], ['zoom'],
                2, layerKey === 'wind' ? 0.10 : layerKey === 'pressure' ? 0.18 : (LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0.22 : 0.18),
                5, layerKey === 'wind' ? 0.12 : layerKey === 'pressure' ? 0.22 : (LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0.28 : 0.22),
                8, layerKey === 'wind' ? 0.15 : layerKey === 'pressure' ? 0.25 : (LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0.32 : 0.28),
                12, layerKey === 'wind' ? 0.18 : layerKey === 'pressure' ? 0.30 : (LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0.38 : 0.32),
              ],
              'raster-resampling': 'linear',
              'raster-hue-rotate': layerKey === 'wind' ? 0 : layerKey === 'waves' ? 30
                : layerKey === 'swell_1' ? 40 : layerKey === 'swell_2' ? 55
                : layerKey === 'wind_waves' ? -10 : layerKey === 'rain' ? -60
                : layerKey === 'pressure' ? -45 : layerKey === 'fog' ? 180 : 0,
              'raster-contrast': layerKey === 'wind' ? 0.05 : layerKey === 'pressure' ? 0.08
                : layerKey === 'fog' ? 0.03 : layerKey === 'satellite' ? 0.15 : 0.10,
              'raster-saturation': layerKey === 'wind' ? 0.08 : layerKey === 'fog' ? -0.3
                : layerKey === 'satellite' ? -0.10 : layerKey === 'pressure' ? 0.10 : 0.12,
              'raster-brightness-min': layerKey === 'rain' ? 0.03 : 0,
              'raster-fade-duration': 300
            }}
          />
        </Source>
      ))}


      {/* Marine Foam/Crest Engine (architecturally separated from wind) */}
      <MarineParticleCanvas 
        id="marine-canvas-layer"
        mapInstance={mapInstance} 
        active={!!activeMarineLayer}
        data={marineWindData}
        revision={marineData?.grid?.timestamp || Date.now()}
      />

      {/* v3.11.1: Extracted marker rendering for LOC compliance */}
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

      {/* v3.12.3: Canvas2D wind particles (Ventusky technique).
          WebGLWindLayer DISABLED — MapLibre custom layer had WebGL state conflicts
          making particles invisible. Canvas2D overlay uses same proven architecture
          as MarineParticleCanvas and Ventusky.com (5 stacked Canvas2D layers). */}
      <WindParticleOverlay
        id="wind-particle-overlay"
        mapInstance={mapInstance}
        active={activeLayers.includes('wind')}
        data={windData}
      />
    </Map>
    </div>
  );
};

export default MapWebGL;
