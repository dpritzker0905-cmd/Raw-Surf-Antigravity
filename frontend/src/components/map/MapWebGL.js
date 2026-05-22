import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';

import {
  getMapStyle,
  FLORIDA_CENTER,
  mapboxTransformRequest,
  findMarineInsertionLayer,
  ensureMapLibreInit,
  trace,
  OM_MODEL_MAP,
  fetchModelMetadata,
  safeMoveLayer,
  registerOpenMeteoProtocol
} from './mapUtils';
import { useMarkerClustering } from '../../hooks/useMarkerClustering';
import { useTheme } from '../../contexts/ThemeContext';
import { MarineParticleCanvas } from './GPUMarineLayer';
import MapMarkerLayers from './MapMarkerLayers';
import { WindParticleOverlay } from './WindParticleOverlay';
import { useWeatherEngine } from './WeatherEngine';
import { useMapRenderContract } from './useMapRenderContract';
import { useMarineOrchestrator } from './useMarineOrchestrator';
import { useLayerTruthDiff } from './useLayerTruthDiff';
import TruthOverlay from './TruthOverlay';
import { OceanMask } from './OceanMask';
import { LAYER_REGISTRY, resolveRasterSource, PRECIP_MODEL_MAP, MARINE_MODEL_MAP, MODEL_METADATA_CACHE } from './LayerRegistry'; // eslint-disable-line
import { validateModelAccess, resolveForecastWindow } from './LayerAccessResolver';
import { markDOMReady, markMapReady } from '../../engine/init-sequencer';
import { useTemporalPreloader } from './useTemporalPreloader';

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
  markDOMReady(); // Init sequencer: DOM is ready when component renders
  const innerMapRef = useRef(null);
  const { theme } = useTheme();
  // v163: Ref to avoid stale closure for long-press callback
  const longPressRef = useRef(onMapLongPress);
  
  const [viewState, setViewState] = useState({
    longitude: FLORIDA_CENTER.lng, latitude: FLORIDA_CENTER.lat,
    zoom: 7, pitch: 0, bearing: 0
  });

  const [mapInstance, setMapInstance] = useState(null);
  const resolveTaskIdRef = useRef(0);
  const [metadataRevision, setMetadataRevision] = useState(0);
  const [activeSlots, setActiveSlots] = useState({});
  
  // Shared Weather Animation Controller
  const weatherAnimRef = useRef({ active: false, start: 0, duration: 600 });
  const animFrameRef = useRef(null);
  
  // Weather Engine: Completely decoupled from map lifecycle, runs on strict time intervals
  // v3.12.4: Passes activeModel + tier-based forecastDays for multi-model support
  const forecastDays = useMemo(() => resolveForecastWindow(userTier), [userTier]);
  const { windData, windRevision } = useWeatherEngine({
    activeLayers, mapInstance, timeOffsetHours, activeModel, forecastDays
  });
 // v3.9.9: Temporal preloader prefetch 1hr tiles
  useTemporalPreloader({ currentHour: timeOffsetHours, activeLayers, mapInstance, activeModel, theme });

  const [protocolReady, setProtocolReady] = useState(false);
  useEffect(() => {
    registerOpenMeteoProtocol(maplibregl, setProtocolReady);
  }, []);

  const activeWeatherVariable = useMemo(() => activeLayers[0] ? LAYER_REGISTRY[activeLayers[0]]?.omVariable || null : null, [activeLayers]);

  useEffect(() => {
    trace(activeLayers[0] || 'none', 'toggle_layer', 'MapWebGL', { activeLayers });
    trace('all', 'select_model', 'MapWebGL', { activeModel });
  }, [activeLayers, activeModel]);

 // LRCM: Derived render type drives which renderer pipeline is active
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


  const [omTileUrls, setOmTileUrls] = useState({});
  const closestTimeIdx = useMemo(() => {
    const model = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    const meta = MODEL_METADATA_CACHE[model];
    if (!meta || !meta.validTimes || !meta.validTimes.length) return 0;
    const targetMs = Date.now() + timeOffsetHours * 3600000;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < meta.validTimes.length; i++) {
      const diff = Math.abs(new Date(meta.validTimes[i]).getTime() - targetMs);
      if (diff < minDiff) { minDiff = diff; closestIdx = i; }
    }
    return closestIdx;
  }, [activeModel, timeOffsetHours, metadataRevision]);

 // v69: initialOmUrls removed React <Source> now reads omTileUrls directly
 // v70: initialRadarUrl removed React <Source> reads radarTileUrl directly


 // v242: Global Render Contract single source of truth for map readiness
  const renderContract = useMapRenderContract(mapInstance);

 // Marine Orchestrator single-pipeline data fetching
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
        speed: v[activeMarineLayer]?.speed || 0,
        isOcean: v.isOcean
      }))
    };
  }, [marineData, activeMarineLayer]);

 // v246: Layer Truth Diff Engine declared vs actual state comparison
  // MUST be after all data source declarations (windData, marineData) to avoid TDZ
  const { issues: truthIssues, rasterVisible } = useLayerTruthDiff({
    mapInstance, activeLayers, activeRenderType, windData, marineData
  });

  // v69: React <Source url={omTileUrls[key]}> now handles URL updates declaratively.
 // The old imperative queueRasterUpdate path is no longer needed react-map-gl
  // calls setUrl() internally when the url prop changes.

  const fetchMetadata = useCallback(async (modelToCheck) => {
    return fetchModelMetadata(modelToCheck, MODEL_METADATA_CACHE, () => setMetadataRevision(prev => prev + 1));
  }, []);

  // Pre-warm metadata cache on mount so layer toggles are instant
  useEffect(() => {
    ['ncep_gfs025', 'ncep_gfs013', 'dwd_icon', 'ecmwf_ifs025', 'ecmwf_wam025', 'ncep_gfswave025'].forEach(m => fetchMetadata(m));
  }, [fetchMetadata]);

  // v77: Track logged fallbacks to prevent console spam during timeline scrubbing
  const loggedFallbacks = useRef(new Set());
  // but the heavy metadata fetch only runs when the browser is ready to paint.
  const rafRef = useRef(null);
  const pendingResolve = useRef(null);

  useEffect(() => {
    // v76: Resolve raster URLs for ACTIVE layers.
    // Rain: per-model via PRECIP_MODEL_MAP (GFSgfs013, ICONdwd_icon, EUROecmwf)
    // Marine: per-model via MARINE_MODEL_MAP (GFS/ICONgfswave, EUROecmwf_wam)
    // Timeline: always valid_times_N index (never current_time_1H)
    const targetModel = OM_MODEL_MAP[activeModel] || 'ncep_gfs025';
    let isMounted = true;
    const taskId = ++resolveTaskIdRef.current;

    const getUrlForIndex = (model, variable, idx) => {
      const darkParam = (theme === 'dark' || theme === 'beach') ? '&dark=true' : '';
      return `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?time_step=valid_times_${idx}&variable=${variable}${darkParam}&contours=true`;
    };

    const resolveAllUrls = async () => {
      try { validateModelAccess(activeModel || 'GFS', userTier); } 
      catch (err) { console.error('[MapWebGL] LAYER_ACCESS_DENIED:', err.message); return; }

      const tasks = Object.keys(LAYER_REGISTRY)
        .filter(k => LAYER_REGISTRY[k].omVariable && activeLayers.includes(k))
        .map(k => ({ layerKey: k, variable: LAYER_REGISTRY[k].omVariable, entry: LAYER_REGISTRY[k] }));

      // v76: Model routing uses the exported maps from LayerRegistry
      const resolveModel = (entry, variable) => {
        // Pinned model (fog GFS visibility)
        if (entry.omModel) return entry.omModel;
        // Marine layers MARINE_MODEL_MAP
        if (entry.omModelGroup === 'marine') {
          return MARINE_MODEL_MAP[activeModel] || 'ncep_gfswave025';
        }
        // Rain/cloud PRECIP_MODEL_MAP (each model has its own precipitation tiles)
        if (variable === 'precipitation' || variable === 'cloud_cover') {
          return PRECIP_MODEL_MAP[activeModel] || 'dwd_icon';
        }
        // v77: Wind gusts on ECMWF tiles are unreliable at far-future 3h boundaries.
        // Use wind_u_component_10m instead which is available at all time indices.
        if (variable === 'wind_gusts_10m' && (activeModel === 'EURO')) {
          return targetModel; // resolve normally, variable fallback handles the rest
        }
        // Default atmospheric
        return targetModel;
      };

      // Parallel metadata pre-fetch
      const models = [...new Set(tasks.map(t => resolveModel(t.entry, t.variable)))];
      await Promise.all(models.map(m => fetchMetadata(m)));
      if (taskId !== resolveTaskIdRef.current) return;

      const newUrls = {};
      const newActiveSlots = {};
      for (const { layerKey, variable, entry } of tasks) {
        let layerModel = resolveModel(entry, variable);
        let meta = await fetchMetadata(layerModel);
        if (taskId !== resolveTaskIdRef.current) return;
        let resolvedVar = variable;
        if (!meta.variables.includes(variable)) {
          const VARIABLE_FALLBACKS = {
            'wind_speed_10m': 'wind_gusts_10m', 'wind_gusts_10m': 'wind_u_component_10m', 'visibility': 'cloud_cover_low'
          };
          const fb = VARIABLE_FALLBACKS[variable];
          if (fb && meta.variables.includes(fb)) {
            resolvedVar = fb;
            const fbKey = `${variable}-${layerModel}`;
            if (!loggedFallbacks.current.has(fbKey)) {
              loggedFallbacks.current.add(fbKey);
              console.log(`[Raster] Variable fallback: ${variable} -> ${resolvedVar} for ${layerModel}`);
            }
          } else if (entry.omModelGroup === 'marine') {
            layerModel = 'ncep_gfswave025';
            meta = await fetchMetadata(layerModel);
            if (taskId !== resolveTaskIdRef.current) return;
            if (meta.variables.includes(variable)) {
              resolvedVar = variable;
              const fbKey = `marine-${variable}`;
              if (!loggedFallbacks.current.has(fbKey)) {
                loggedFallbacks.current.add(fbKey);
                console.log(`[Raster] Marine model fallback: ${layerModel} for ${variable}`);
              }
            }
          }
        }
        if (meta.variables.includes(resolvedVar)) {
          const { validTimes } = meta;
          const targetMs = Date.now() + timeOffsetHours * 3600000;
          let closestIdx = 0;
          let minDiff = Infinity;
          if (validTimes && validTimes.length) {
            for (let i = 0; i < validTimes.length; i++) {
              const diff = Math.abs(new Date(validTimes[i]).getTime() - targetMs);
              if (diff < minDiff) { minDiff = diff; closestIdx = i; }
            }
          }
          const slotCurrent = closestIdx % 3;
          newActiveSlots[layerKey] = slotCurrent;
          const slotPrev = (closestIdx - 1 + 3) % 3;
          const slotNext = (closestIdx + 1) % 3;
          newUrls[`${layerKey}-slot-${slotCurrent}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', getUrlForIndex(layerModel, resolvedVar, closestIdx));
          newUrls[`${layerKey}-slot-${slotPrev}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', closestIdx > 0 ? getUrlForIndex(layerModel, resolvedVar, closestIdx - 1) : getUrlForIndex(layerModel, resolvedVar, closestIdx));
          newUrls[`${layerKey}-slot-${slotNext}`] = trace(layerKey, 'resolve_raster', 'MapWebGL', closestIdx < validTimes.length - 1 ? getUrlForIndex(layerModel, resolvedVar, closestIdx + 1) : getUrlForIndex(layerModel, resolvedVar, closestIdx));
        }
      }

      if (isMounted && taskId === resolveTaskIdRef.current) {
        setOmTileUrls(prev => {
          const filtered = {};
          Object.keys(prev).forEach(key => {
            const match = key.match(/^(.+)-slot-(\d+)$/);
            if (match && activeLayers.includes(match[1])) {
              filtered[key] = prev[key];
            }
          });
          return { ...filtered, ...newUrls };
        });
        setActiveSlots(newActiveSlots);
      }
    };
    
    pendingResolve.current = resolveAllUrls;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (pendingResolve.current) pendingResolve.current();
    });
    
    return () => { isMounted = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [activeModel, theme, timeOffsetHours, activeLayers, fetchMetadata, metadataRevision]);

  // Sync ref to parent so useMapActions works
  useEffect(() => {
    if (innerMapRef.current) {
      if (mapInstanceRef) mapInstanceRef.current = innerMapRef.current.getMap();
    }
  }, [mapInstanceRef, innerMapRef.current]);

  const onMove = useCallback(evt => setViewState(evt.viewState), []);

  const moveEndTimerRef = useRef(null);
  const onMoveEnd = useCallback(evt => {
    if (!onMapMoveEnd) return;
    clearTimeout(moveEndTimerRef.current);
    moveEndTimerRef.current = setTimeout(() => onMapMoveEnd({ lat: evt.viewState.latitude, lng: evt.viewState.longitude }), 800);
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

 // Derive bounds for clustering must be an object {west,south,east,north}
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

  // v85: Find the first layer after water for marine raster insertion.
  // Marine rasters sit above water fills, then OceanMask covers land bleed.
  const [marineBeforeId, setMarineBeforeId] = useState(null);
  const [maskLandExists, setMaskLandExists] = useState(false);
  useEffect(() => {
    if (!mapInstance) return;
    const onStyleData = () => {
      setMaskLandExists(!!mapInstance.getLayer('ocean-mask-buffer'));
      const id = findMarineInsertionLayer(mapInstance);
      if (id) {
        setMarineBeforeId(id);
        if (!mapInstance.getLayer('marine-raster-anchor')) {
          try {
            mapInstance.addLayer({
              id: 'marine-raster-anchor',
              type: 'background',
              layout: { visibility: 'none' }
            }, id);
            console.log('[MapWebGL] Added marine-raster-anchor before', id);
          } catch (e) {
            console.error('[MapWebGL] Failed to add marine-raster-anchor:', e);
          }
        }
      }
    };
    mapInstance.on('styledata', onStyleData);
    onStyleData();
    return () => mapInstance.off('styledata', onStyleData);
  }, [mapInstance]);



  // --- WIND PARTICLE ENGINE & MARINE OVERLAYS ---

  // Capture the raw MapLibre instance once the map loads, set initial bounds,
  // and force a repaint so layers render without needing user pan/scroll.
  useEffect(() => {
    const map = innerMapRef.current?.getMap?.();
    if (map && !mapInstance) {
      setMapInstance(map);
      window.map = map;

      // v239: Suppress async AbortErrors from MapLibre's internal tile-fetch pipeline.
      // These fire AFTER setUrl() returns (asynchronous Promise rejection inside workers),
      // so the try-catch in useRasterTransactions cannot intercept them.
      map.on('error', (e) => {
        if (e?.error?.name === 'AbortError' || e?.error?.message?.includes('aborted')) {
 return; // Swallow this is expected during raster source transitions
        }
        console.error('[MapLibre Error]', e?.error || e);
      });
      
      // Force render loop to paint custom-protocol tiles on mount
      markMapReady(); // Init sequencer: map is ready
      setTimeout(() => { try { map.triggerRepaint(); } catch(e) { /* map may not be ready */ } }, 300);

      // v163: Long-press/right-click handler (Ventusky/Windy style map pin)
      map.on('contextmenu', (e) => {
        e.preventDefault();
        if (longPressRef.current) longPressRef.current(e.lngLat);
      });
      // Mobile: detect long-press via touch hold (500ms threshold)
      let touchTimer = null;
      let touchStartPos = null;
      map.getCanvas().addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        touchStartPos = { x: t.clientX, y: t.clientY };
        touchTimer = setTimeout(() => {
          if (!touchStartPos) return;
          const rect = map.getCanvas().getBoundingClientRect();
          const point = map.unproject([touchStartPos.x - rect.left, touchStartPos.y - rect.top]);
          if (longPressRef.current) longPressRef.current({ lat: point.lat, lng: point.lng });
          touchStartPos = null;
        }, 500);
      }, { passive: true });
      map.getCanvas().addEventListener('touchmove', () => { clearTimeout(touchTimer); touchStartPos = null; }, { passive: true });
      map.getCanvas().addEventListener('touchend', () => { clearTimeout(touchTimer); }, { passive: true });
    }
  });

  // v163: Keep long-press ref in sync with latest callback
  useEffect(() => { longPressRef.current = onMapLongPress; }, [onMapLongPress]);

  // v3.13: Marine canvas fade. Wind canvas self-manages via active prop (CSS transition).
  // NOTE: raster setPaintProperty removed — it permanently corrupted the zoom-interpolated
  // opacity expression on every toggle, causing the 'blocked/stuck' layer appearance.
  useEffect(() => {
    if (!mapInstance) return;
    const marineActive = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayers.includes(l));
    const mc = document.getElementById('marine-canvas-layer');
    if (!marineActive && mc) {
      mc.style.opacity = '0';
      try { mc.getContext('2d')?.clearRect(0, 0, mc.width, mc.height); } catch(e) { /* canvas may already be gone */ }
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

  useEffect(() => {
    if (!mapInstance) return;
    try {
      const activeSourceIds = new Set();
      activeLayers.forEach(l => {
        [0, 1, 2].forEach(slot => activeSourceIds.add(`${l}-slot-${slot}-source`));
      });
      const style = mapInstance.getStyle();
      if (style?.sources) {
        Object.keys(style.sources).forEach(sourceId => {
          if (sourceId.includes('-slot-') && !activeSourceIds.has(sourceId)) {
            const layerId = sourceId.replace('-source', '-layer');
            if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
            if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId);
          }
        });
      }
    } catch (e) { /* empty */ }
  }, [mapInstance, activeLayers]);

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
          type="raster"
          layout={{ visibility: activeLayers.includes('satellite') ? 'visible' : 'none' }}
          paint={{ 'raster-opacity': 1.0, 'raster-fade-duration': 0 }}
        />
      </Source>

      {/* v251: Open-Meteo Independent Static Tile Sources with Triple-Source Sliding Ring Buffer */}
      {protocolReady && activeLayers.map(layerKey => {
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
              maxzoom={LAYER_REGISTRY[layerKey]?.type === 'marine' ? 9 : 12}
            >
              <Layer
                id={`${slotKey}-layer`}
                beforeId={
                  LAYER_REGISTRY[layerKey]?.type === 'marine'
                    ? (maskLandExists ? 'ocean-mask-buffer' : marineBeforeId) || undefined
                    : undefined
                }
                type="raster"
                layout={{ 
                  visibility: activeLayers.includes(layerKey) ? 'visible' : 'none' 
                }}
                paint={{
                  // Scale opacity down to 0.0 if not active to keep buffers ready but hidden
                  'raster-opacity': isActive ? (
                    LAYER_REGISTRY[layerKey]?.type === 'marine' ? [
                      'interpolate', ['linear'], ['zoom'],
                      2, 0.70,
                      5, 0.75,
                      9.0, 0.80,
                      12.0, 0.45,
                      17.0, 0.0
                    ] : [
                      'interpolate', ['linear'], ['zoom'],
                      2, layerKey === 'wind' ? 0.17 : layerKey === 'satellite' ? 0.55 : layerKey === 'pressure' ? 0.22 : layerKey === 'fog' ? 0.18 : layerKey === 'rain' ? 0.35 : 0.22,
                      5, layerKey === 'wind' ? 0.21 : layerKey === 'satellite' ? 0.60 : layerKey === 'pressure' ? 0.28 : layerKey === 'fog' ? 0.25 : layerKey === 'rain' ? 0.42 : 0.28,
                      8, layerKey === 'wind' ? 0.26 : layerKey === 'satellite' ? 0.65 : layerKey === 'pressure' ? 0.32 : layerKey === 'fog' ? 0.32 : layerKey === 'rain' ? 0.48 : 0.35,
                      12, layerKey === 'wind' ? 0.30 : layerKey === 'satellite' ? 0.70 : layerKey === 'pressure' ? 0.38 : layerKey === 'fog' ? 0.38 : layerKey === 'rain' ? 0.52 : 0.40,
                    ]
                  ) : 0.0,
                  'raster-resampling': 'linear',
                  'raster-hue-rotate': LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0 : layerKey === 'wind' ? 0 : layerKey === 'rain' ? -60 : layerKey === 'pressure' ? -45 : 0,
                  'raster-contrast': LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0 : layerKey === 'satellite' ? -0.10 : layerKey === 'wind' ? 0.10 : layerKey === 'pressure' ? 0.08 : layerKey === 'fog' ? 0.30 : 0.10,
                  'raster-saturation': LAYER_REGISTRY[layerKey]?.type === 'marine' ? 0 : layerKey === 'satellite' ? -0.20 : layerKey === 'wind' ? 0.15 : layerKey === 'fog' ? -0.50 : layerKey === 'pressure' ? 0.10 : 0.12,
                  'raster-brightness-min': layerKey === 'satellite' ? 0.15 : layerKey === 'rain' ? 0.03 : 0,
                  'raster-fade-duration': 0 // Instant transition between slots
                }}
              />
            </Source>
          );
        });
      })}

      {/* v85: OceanMask — covers marine raster coastline bleed on land.
           In the vector base map, this sits ABOVE marine rasters but BELOW
           roads/labels/buildings, so land detail is preserved. */}
      <OceanMask
        mapInstance={mapInstance}
        active={!!activeMarineLayer}
        activeMarineLayer={activeMarineLayer}
        theme={theme}
        beforeId={marineBeforeId}
      />

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
 WebGLWindLayer DISABLED MapLibre custom layer had WebGL state conflicts
          making particles invisible. Canvas2D overlay uses same proven architecture
          as MarineParticleCanvas and Ventusky.com (5 stacked Canvas2D layers). */}
      <WindParticleOverlay
        id="wind-particle-overlay"
        mapInstance={mapInstance}
        active={activeLayers.includes('wind')}
        data={windData}
        theme={theme}
      />

      {/* v163: Long-press / right-click marker (Ventusky/Windy style) */}
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
