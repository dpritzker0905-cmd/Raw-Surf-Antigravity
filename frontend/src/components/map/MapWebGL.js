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
import { LAYER_REGISTRY, resolveRasterSource, PRECIP_MODEL_MAP, MARINE_MODEL_MAP } from './LayerRegistry'; // eslint-disable-line
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
  // v69: initialOmUrls removed — React <Source> now reads omTileUrls directly
  // v70: initialRadarUrl removed — React <Source> reads radarTileUrl directly

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

  // v69: React <Source url={omTileUrls[key]}> now handles URL updates declaratively.
  // The old imperative queueRasterUpdate path is no longer needed — react-map-gl
  // calls setUrl() internally when the url prop changes.

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
    ['ncep_gfs025', 'ncep_gfs013', 'dwd_icon', 'ecmwf_ifs025', 'ecmwf_wam025', 'ncep_gfswave025'].forEach(m => fetchMetadata(m));
  }, [fetchMetadata]);

  // v76: Removed debounce — use timeOffsetHours directly.
  // OOM was mitigated in v73 by only resolving active layers.
  // The 80ms debounce ate slider responsiveness (autoplay worked but drag didn't).

  useEffect(() => {
    // v76: Resolve raster URLs for ACTIVE layers.
    // Rain: per-model via PRECIP_MODEL_MAP (GFS→gfs013, ICON→dwd_icon, EURO→ecmwf)
    // Marine: per-model via MARINE_MODEL_MAP (GFS/ICON→gfswave, EURO→ecmwf_wam)
    // Timeline: always valid_times_N index (never current_time_1H)
    const targetModel = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    let isMounted = true;

    const computeTimeStep = (meta) => {
      const { validTimes } = meta;
      if (!validTimes || !validTimes.length) return 'time_step=valid_times_0';
      const targetMs = Date.now() + timeOffsetHours * 3600000;
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < validTimes.length; i++) {
        const diff = Math.abs(new Date(validTimes[i]).getTime() - targetMs);
        if (diff < minDiff) { minDiff = diff; closestIdx = i; }
      }
      return `time_step=valid_times_${closestIdx}`;
    };

    const resolveAllUrls = async () => {
      try { validateModelAccess(activeModel || 'GFS', userTier); } 
      catch (err) { console.error('[MapWebGL] LAYER_ACCESS_DENIED:', err.message); return; }

      const tasks = Object.keys(LAYER_REGISTRY)
        .filter(k => LAYER_REGISTRY[k].omVariable && activeLayers.includes(k))
        .map(k => ({ layerKey: k, variable: LAYER_REGISTRY[k].omVariable, entry: LAYER_REGISTRY[k] }));

      // v76: Model routing uses the exported maps from LayerRegistry
      const resolveModel = (entry, variable) => {
        // Pinned model (fog → GFS visibility)
        if (entry.omModel) return entry.omModel;
        // Marine layers → MARINE_MODEL_MAP
        if (entry.omModelGroup === 'marine') {
          return MARINE_MODEL_MAP[activeModel] || 'ncep_gfswave025';
        }
        // Rain/cloud → PRECIP_MODEL_MAP (each model has its own precipitation tiles)
        if (variable === 'precipitation' || variable === 'cloud_cover') {
          return PRECIP_MODEL_MAP[activeModel] || 'dwd_icon';
        }
        // Default atmospheric
        return targetModel;
      };

      // Parallel metadata pre-fetch
      const models = [...new Set(tasks.map(t => resolveModel(t.entry, t.variable)))];
      await Promise.all(models.map(m => fetchMetadata(m)));

      const newUrls = {};
      for (const { layerKey, variable, entry } of tasks) {
        let layerModel = resolveModel(entry, variable);
        let meta = await fetchMetadata(layerModel);
        let resolvedVar = variable;
        // Variable fallback chain
        if (!meta.variables.includes(variable)) {
          const VARIABLE_FALLBACKS = {
            'wind_gusts_10m': 'wind_u_component_10m',
            'visibility': 'cloud_cover_low',
            // v76: ECMWF WAM lacks swell/wind_wave → fallback to GFS wave
            'swell_wave_height': null,
            'secondary_swell_wave_height': null,
            'wind_wave_height': null,
          };
          if (variable in VARIABLE_FALLBACKS) {
            if (VARIABLE_FALLBACKS[variable] && meta.variables.includes(VARIABLE_FALLBACKS[variable])) {
              resolvedVar = VARIABLE_FALLBACKS[variable];
              console.log(`[Raster] Variable fallback: ${variable} → ${resolvedVar} for ${layerModel}`);
            } else if (entry.omModelGroup === 'marine') {
              // ECMWF WAM lacks this var → fall back to GFS wave model
              layerModel = 'ncep_gfswave025';
              meta = await fetchMetadata(layerModel);
              if (meta.variables.includes(variable)) {
                resolvedVar = variable;
                console.log(`[Raster] Marine model fallback: ${layerModel} for ${variable}`);
              }
            }
          }
        }
        if (meta.variables.includes(resolvedVar)) {
          const darkParam = (theme === 'dark' || theme === 'beach') ? '&dark=true' : '';
          const urlStr = `om://https://map-tiles.open-meteo.com/data_spatial/${layerModel}/latest.json?${computeTimeStep(meta)}&variable=${resolvedVar}${darkParam}`;
          newUrls[layerKey] = trace(layerKey, 'resolve_raster', 'MapWebGL', urlStr);
        }
      }

      if (isMounted) {
        setOmTileUrls(prev => {
          const merged = {};
          for (const key of activeLayers) {
            if (newUrls[key]) merged[key] = newUrls[key];
            else if (prev[key]) merged[key] = prev[key];
          }
          return merged;
        });
      }
    };
    
    resolveAllUrls();
    
    return () => { isMounted = false; };
  }, [activeModel, theme, timeOffsetHours, fetchMetadata, activeLayers]);

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

  // v70: Radar URL updates handled declaratively via React <Source tiles={[radarTileUrl]}>

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
        />
      </Source>

      {/* v251: Open-Meteo Independent Static Tile Sources */}
      {protocolReady && Object.entries(omTileUrls).map(([layerKey, url]) => (
        <Source
          key={`${layerKey}-source`}
          id={`${layerKey}-source`}
          type="raster"
          url={url}
          maxzoom={LAYER_REGISTRY[layerKey]?.type === 'marine' ? 9 : 12}
        >
          <Layer
            id={`${layerKey}-layer`}
            type="raster"
            layout={{ 
              visibility: activeLayers.includes(layerKey) ? 'visible' : 'none' 
            }}
            paint={{
              // v3.12.5: Ventusky-style opacity — colored bands visible but not overpowering.
              // Satellite needs brightness boost. Wind needs visible color bands.
              // v73: Fog opacity reduced — cloud_cover_low shows ALL low clouds,
              // not just fog. Keep subtle so minor cumulus doesn't look like fog.
              'raster-opacity': ['interpolate', ['linear'], ['zoom'],
                2, layerKey === 'wind' ? 0.35 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.22 : layerKey === 'fog' ? 0.18 : layerKey === 'rain' ? 0.35 : (LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0.28 : 0.22),
                5, layerKey === 'wind' ? 0.42 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.28 : layerKey === 'fog' ? 0.25 : layerKey === 'rain' ? 0.42 : (LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0.35 : 0.28),
                8, layerKey === 'wind' ? 0.48 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.32 : layerKey === 'fog' ? 0.32 : layerKey === 'rain' ? 0.48 : (LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0.40 : 0.35),
                12, layerKey === 'wind' ? 0.52 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.38 : layerKey === 'fog' ? 0.38 : layerKey === 'rain' ? 0.52 : (LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0.45 : 0.40),
              ],
              'raster-resampling': 'linear',
              'raster-hue-rotate': layerKey === 'wind' ? 0 : layerKey === 'waves' ? 30
                : layerKey === 'swell_1' ? 40 : layerKey === 'swell_2' ? 55
                : layerKey === 'wind_waves' ? -10 : layerKey === 'rain' ? -60
                : layerKey === 'pressure' ? -45 : layerKey === 'fog' ? 0 : 0,
              // v75: Fog (visibility) is inverted — low values = fog = should render opaque.
              // Rain/cloud uses standard mapping where high values = precipitation.
              'raster-contrast': layerKey === 'satellite' ? -0.10 : layerKey === 'wind' ? 0.10
                : layerKey === 'pressure' ? 0.08 : layerKey === 'fog' ? 0.30 : 0.10,
              'raster-saturation': layerKey === 'satellite' ? -0.20 : layerKey === 'wind' ? 0.15
                : layerKey === 'fog' ? -0.50 : layerKey === 'pressure' ? 0.10 : 0.12,
              'raster-brightness-min': layerKey === 'satellite' ? 0.15 : layerKey === 'rain' ? 0.03 : 0,
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
