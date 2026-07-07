import React, { useRef, useState, useMemo, useEffect } from 'react';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
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
import MarineAnimTuner from './MarineAnimTuner';
import { LAYER_REGISTRY, MODEL_METADATA_CACHE } from './LayerRegistry';
import { radarForecastTileUrl } from './radarForecastSources';
// Strike points come via window.__LTG_STRIKES__ / __LTG_REFRESH__ (published by radarTileRecolor
// at protocol registration) — keeps this heavy chunk free of a direct maplibre-gl-importing edge.
import { useMarineWindData } from './useMarineWindData';
import { resolveForecastWindow } from './LayerAccessResolver';
import { markDOMReady, getInitState, onStateChange } from '../../engine/init-sequencer';
import { initEngine, shutdownEngine } from '../../engine/engine-bootstrap';
import { useTemporalPreloader } from './useTemporalPreloader';
import { useSimulationField } from '../../engine/useSimulationField';
import { useRenderPlanBridge } from '../../engine/useRenderPlanBridge';
import { disposeAnimationCoordinator } from './CanvasAnimationCoordinator';
import { useMapInitialization } from './useMapInitialization';
import { useMapViewState } from './useMapViewState';
import { useMapLongPress } from './useMapLongPress';
import { useSpotClusteringData } from './useSpotClusteringData';
import { useSpotRatings, computeClusterRatings } from './useSpotRatings';
import { getSurfModeFlag } from './backendWeatherServiceClient';
import { useSatelliteBackgroundSync } from './useSatelliteBackgroundSync';
import { useOpenMeteoTileUrls } from './useOpenMeteoTileUrls';
import { useMapObservability } from './useMapObservability';
import { useMapDebugTools } from './useMapDebugTools';
import { useWebGLGuardrail } from './useWebGLGuardrail';
import 'maplibre-gl/dist/maplibre-gl.css';
import LongPressMarker from './LongPressMarker';

const MapWebGL = ({
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
  const [webglWindFailed, setWebglWindFailed] = useState(() => typeof window !== 'undefined' && (window.__FORCE_WIND_FALLBACK__ === true || localStorage.getItem('force_wind_fallback') === 'true'));
  const [webglMarineFailed, setWebglMarineFailed] = useState(() => typeof window !== 'undefined' && (window.__FORCE_MARINE_FALLBACK__ === true || localStorage.getItem('force_marine_fallback') === 'true'));

  // Reset temporary WebGL failure flags when model or active layers change
  useEffect(() => {
    const forceWind = typeof window !== 'undefined' && (window.__FORCE_WIND_FALLBACK__ === true || localStorage.getItem('force_wind_fallback') === 'true');
    const forceMarine = typeof window !== 'undefined' && (window.__FORCE_MARINE_FALLBACK__ === true || localStorage.getItem('force_marine_fallback') === 'true');
    
    if (!forceWind) setWebglWindFailed(false);
    if (!forceMarine) setWebglMarineFailed(false);
  }, [activeModel, activeLayers]);

  const handleMapClick = (e) => {
    setActiveSystemPopup(null);
    if (onMapClick) onMapClick(e);
  };

  // 1. Map Initialization and Async Abort Interceptions
  const { mapInstance } = useMapInitialization({ innerMapRef, mapInstanceRef });

  const activeMarineLayer = useMemo(() => {
    return ['waves', 'swell_1', 'swell_2', 'wind_waves'].find(l => activeLayers.includes(l));
  }, [activeLayers]);

  const lowSystems = useMemo(() => [], []);
  const highSystems = useMemo(() => [], []);

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

  // Rating mode (the Swell↔Rating toggle in MapWeatherControls). Tracked reactively here so the spot
  // glyphs + clustering can respond; the toggle persists the flag and fires 'rawsurf:surf-toggle'.
  const [surfMode, setSurfMode] = useState(() => { try { return getSurfModeFlag(); } catch (e) { return false; } });
  useEffect(() => {
    const sync = () => { try { setSurfMode(getSurfModeFlag()); } catch (e) { /* noop */ } };
    if (typeof window !== 'undefined') {
      window.addEventListener('rawsurf:surf-toggle', sync);
      return () => window.removeEventListener('rawsurf:surf-toggle', sync);
    }
  }, []);

  // 6. Spot Clustering Data
  const { spotClusters, spotGeoJSON, supercluster } = useSpotClusteringData({ surfSpots, filter, mapInstance, viewState, surfMode });

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
    activeMarineLayer,
    webglMarineFailed
  });

  // Weather Engine: Decoupled weather analytics
  const forecastDays = useMemo(() => resolveForecastWindow(userTier, activeModel, activeLayers && activeLayers[0]), [userTier, activeModel, activeLayers]);
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

  // Per-spot surf-quality ratings for the Rating-overlay glyphs: the backend /spot-ratings endpoint (precise
  // per-spot resolution) with the rating-grid sample as an instant fallback. See useSpotRatings.js.
  const spotRatings = useSpotRatings({ spotClusters, marineData, surfMode, mapInstance, viewState, activeModel, timeOffsetHours });
  // Aggregate per-spot ratings up to the CLUSTER bubbles so toggling Rating recolours the map even when spots
  // are clustered (zoomed out) — without this the toggle looks like "nothing happens" until you zoom to
  // individual spots. Memoized: recomputes only when the clusters or ratings change (not per frame).
  const clusterRatings = useMemo(
    () => (surfMode ? computeClusterRatings(spotClusters, spotRatings, supercluster) : {}),
    [surfMode, spotClusters, spotRatings, supercluster]
  );
  // FCE: Field Composition Engine — Single Source of Truth
  const { field: simulationField, diagnostics: fieldDiagnostics } = useSimulationField({
    windData,
    marineData,
    pressureData: null,
    activeModel,
    timeOffsetHours: timeOffsetHours,
    enableLogging: typeof window !== 'undefined' && localStorage.getItem('debug-fce') === 'true',
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
    fieldDiagnostics,
    simDiagnostics
  });

  // OceanMask activation is a pure function of layer state — it does NOT need a
  // per-frame RenderPlan. Deriving it directly lets us stop publishing renderPlan
  // into React in normal mode without changing mask behavior. (Mirrors
  // composeRenderPlan's oceanMask.active: oceanMaskEnabled && (hasMarine || hasMarineRaster).)
  const oceanMaskActive = useMemo(() => {
    const hasMarine = !!activeMarineLayer;
    const hasMarineRaster = (activeLayers || []).some(l =>
      ['waves', 'swell', 'wind_waves', 'secondary_swell'].includes(l)
    );
    return hasMarine || hasMarineRaster;
  }, [activeMarineLayer, activeLayers]);

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

  const marineWindData = useMarineWindData({ 
    marineData, 
    activeMarineLayer, 
    activeModel, 
    timeOffsetHours, 
    mapInstance, 
    viewState 
  });

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
    if (!frame) return null;
    // RADAR FORECAST (2026-07-06): future frames come from model-aware forecast WMS feeds
    // (EURO → DWD WN +2h, GFS/ICON → IEM HRRR +4h — radarForecastSources.js); RainViewer's
    // nowcast was discontinued Jan 2026 so past frames stay RainViewer, future swaps feeds.
    if (frame.future) return radarForecastTileUrl(frame);
    if (!frame.path) return null;
    return `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/7/1_0.png`;
  }, [radarFrames, radarFrameIndex]);

  // Lightning strike density companion (2026-07-06): observed NLDN via nowCOAST, same frame
  // index as radar — PAST frames only (observation truth; future frames carry none). The
  // timeline animation steps frames, so detected lightning animates with the radar sweep.
  // Lightning is rendered ONLY as the point-flash layers (imperative effect below); the raster
  // underlay + per-frame tile URL were removed in v3b — the strike feed is a direct viewport
  // GetMap into the extraction registry (see radarTileRecolor.refreshViewportStrikes).

  // LIGHTNING POINT FLASHES (2026-07-07 v3, "the lightning bolts look terrible"): the industry
  // look (Windy live lightning / Ventusky / Blitzortung — all point-fed) is INDIVIDUAL bright
  // white flashes at strike locations with a soft glow halo and fast decay — never a raster
  // strobe. Strike cores are extracted from the density tiles by the ltg-flash protocol
  // (radarTileRecolor.getLightningStrikePoints); this imperative island renders them as a
  // geojson source with GLOW + CORE circle layers, each point on its OWN random flash phase:
  // p = 2% + 6%·intensity per 120ms tick → pop to full, ×0.45 decay to a faint resting ember.
  // Imperative (no React state) — setData every tick is cheap for ≤ a few hundred points.
  // Kill: __RAW_RADAR_LIGHTNING_FLASH_DISABLED__ = true → steady dim points, no flicker.
  useEffect(() => {
    if (!mapInstance || !activeLayers.includes('radar')) return;
    if (typeof window !== 'undefined' && window.__RAW_RADAR_LIGHTNING_DISABLED__ === true) return;
    const SRC = 'lightning-strikes';
    // Strike feed: direct viewport GetMap (radarTileRecolor.refreshViewportStrikes) — the tile
    // pipeline refused the custom-protocol raster (v3b note there). Refresh now, on moveend,
    // and every 60s; the registry TTL ages strikes out between refreshes.
    const refresh = () => { try { window.__LTG_REFRESH__ && window.__LTG_REFRESH__(mapInstance); } catch (e) { /* best-effort */ } };
    refresh();
    const refreshId = setInterval(refresh, 60000);
    mapInstance.on('moveend', refresh);
    // ⚠️ `Map` in this module is react-map-gl's default component import — `new Map()` here
    // constructed the React component ("default is not a constructor", map dead at radar
    // activation, live 2026-07-07). Use the global explicitly.
    const flash = new globalThis.Map();   // point key → current flash value 0..1
    const ensure = () => {
      try {
        if (!mapInstance.getSource(SRC)) {
          mapInstance.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          mapInstance.addLayer({
            id: 'lightning-glow', type: 'circle', source: SRC,
            paint: {
              'circle-radius': ['+', 8, ['*', 10, ['get', 'f']]],
              'circle-color': '#fff7cc', 'circle-blur': 1.2,
              'circle-opacity': ['*', 0.32, ['get', 'f']],
            },
          });
          mapInstance.addLayer({
            id: 'lightning-core', type: 'circle', source: SRC,
            paint: {
              'circle-radius': ['+', 1.2, ['*', 2.2, ['get', 'f']]],
              'circle-color': '#ffffff',
              'circle-opacity': ['min', 0.95, ['*', 1.1, ['get', 'f']]],
            },
          });
        }
        return true;
      } catch (e) { return false; }   // style mid-load — next tick retries
    };
    const staticMode = typeof window !== 'undefined' && window.__RAW_RADAR_LIGHTNING_FLASH_DISABLED__ === true;
    // SUBTLE CADENCE (2026-07-07 v3c, "more subtle, not so fast" — Blitzortung/LightningMaps
    // age strikes over MINUTES with seconds-long fades, never sub-second strobes): 240ms tick,
    // ×0.82 decay ≈ a ~2s fade per flash, and p = 0.6% + 2%·intensity per tick ≈ each strike
    // flashing every ~15-40s (a calm screen-wide shimmer, not a storm of blinking).
    // Levers: __RAW_LTG_TICK_MS__, __RAW_LTG_DECAY__, __RAW_LTG_P_SCALE__.
    const w = typeof window !== 'undefined' ? window : {};
    const tickMs = typeof w.__RAW_LTG_TICK_MS__ === 'number' ? w.__RAW_LTG_TICK_MS__ : 240;
    const decay = typeof w.__RAW_LTG_DECAY__ === 'number' ? w.__RAW_LTG_DECAY__ : 0.82;
    const pScale = typeof w.__RAW_LTG_P_SCALE__ === 'number' ? w.__RAW_LTG_P_SCALE__ : 1.0;
    const id = setInterval(() => {
      if (!ensure()) return;
      try {
        const pts = (typeof window !== 'undefined' && typeof window.__LTG_STRIKES__ === 'function')
          ? window.__LTG_STRIKES__() : [];
        // SCREEN-NORMALIZED flash rate: ~0.35 flashes/second across the WHOLE viewport split
        // over the points (weighted by intensity) — a big storm doesn't strobe harder than a
        // small one, and the overall feel stays at "one calm flash every ~3s somewhere".
        const pBase = ((0.35 * tickMs) / 1000 / Math.max(1, pts.length)) * pScale;
        const features = pts.map((p) => {
          const key = `${p.lng.toFixed(3)},${p.lat.toFixed(3)}`;
          let f;
          if (staticMode) {
            f = 0.5 * p.intensity;
          } else {
            const prev = flash.get(key) || 0;
            f = Math.random() < pBase * (0.5 + p.intensity)
              ? 1.0 : Math.max(0.05 * p.intensity, prev * decay);
            flash.set(key, f);
          }
          return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { f } };
        });
        if (flash.size > 2000) flash.clear();   // bound stale-key growth across long sessions
        mapInstance.getSource(SRC).setData({ type: 'FeatureCollection', features });
      } catch (e) { /* style transition — next tick retries */ }
    }, tickMs);
    return () => {
      clearInterval(id);
      clearInterval(refreshId);
      try { mapInstance.off('moveend', refresh); } catch (e) { /* disposed */ }
      try {
        if (mapInstance.getLayer('lightning-core')) mapInstance.removeLayer('lightning-core');
        if (mapInstance.getLayer('lightning-glow')) mapInstance.removeLayer('lightning-glow');
        if (mapInstance.getSource(SRC)) mapInstance.removeSource(SRC);
      } catch (e) { /* map disposed */ }
    };
  }, [mapInstance, activeLayers]);

  // Memoize map style to prevent full map re-render on ViewState change
  const currentMapStyle = useMemo(() => trace('map', 'resolve_style', 'MapWebGL', getMapStyle(theme, false)), [theme]);

  // Canvas fade effects for marine layer
  useEffect(() => {
    if (!mapInstance) return;
    const marineActive = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayers.includes(l));
    const mc = document.getElementById('marine-canvas-layer');
    if (!marineActive && mc) {
      mc.style.opacity = '0';
      try { mc.getContext('2d')?.clearRect(0, 0, mc.width, mc.height); } catch (e) { /* ignore */ }
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
      disposeAnimationCoordinator();
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
        console.error('[MapWebGL] WebGL context lost detected! Triggering safety fallbacks.');
        WeatherTelemetry.trackWebGLContextLost();
        setWebglWindFailed(true);
        setWebglMarineFailed(true);
      };

      onContextRestored = () => {
        console.log('[MapWebGL] WebGL context restored successfully! Recovering WebGL renderers.');
        WeatherTelemetry.trackWebGLContextRestored();
        
        const forceWind = typeof window !== 'undefined' && (window.__FORCE_WIND_FALLBACK__ === true || localStorage.getItem('force_wind_fallback') === 'true');
        const forceMarine = typeof window !== 'undefined' && (window.__FORCE_MARINE_FALLBACK__ === true || localStorage.getItem('force_marine_fallback') === 'true');
        
        if (!forceWind) setWebglWindFailed(false);
        if (!forceMarine) setWebglMarineFailed(false);
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

  useWebGLGuardrail({
    mapInstance,
    activeLayers,
    setWebglWindFailed,
    setWebglMarineFailed,
    webglWindFailed,
    webglMarineFailed,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__WEBGL_GUARDRAIL_FALLBACK__ = {
      webglWindFailed, webglMarineFailed,
      setWindFailed: (v) => { setWebglWindFailed(v); localStorage.setItem('force_wind_fallback', String(v)); },
      setMarineFailed: (v) => { setWebglMarineFailed(v); localStorage.setItem('force_marine_fallback', String(v)); },
      reset: () => { setWebglWindFailed(false); setWebglMarineFailed(false); localStorage.removeItem('force_wind_fallback'); localStorage.removeItem('force_marine_fallback'); }
    };
    return () => { delete window.__WEBGL_GUARDRAIL_FALLBACK__; };
  }, [webglWindFailed, webglMarineFailed]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <TruthOverlay
        activeLayers={activeLayers}
        activeRenderType={activeRenderType}
        marineData={marineData}
        windData={windData}
        truthIssues={truthIssues}
        rasterVisible={rasterVisible}
        activeModel={activeModel}
        timeOffsetHours={timeOffsetHours}
        simulationField={simulationField}
        renderPlan={renderPlan}
        simFrameIndex={simFrameIndex}
        isTransitioning={isTransitioning}
      />

      {/* Dev-only live marine-animation tuner (renders null unless ?tuner=1 / localStorage.__RAW_TUNER__). */}
      <MarineAnimTuner />

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
        {/* activeLayers prop dropped (2026-07-07, chip task_c5366c79 slice 1): OceanMask never
            consumed it, and the array identity was a needless churn vector against the memo. */}
        <OceanMask
          mapInstance={mapInstance}
          active={oceanMaskActive}
          activeMarineLayer={activeMarineLayer}
          theme={theme}
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

        {/* Lightning (nowCOAST NLDN): point-flash layers only — added imperatively by the
            strike-flash effect; no raster underlay (v3b). */}

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
        {protocolReady && Object.keys(LAYER_REGISTRY).filter(k =>
          LAYER_REGISTRY[k].omVariable && (
            LAYER_REGISTRY[k].type === 'raster' ||
            (LAYER_REGISTRY[k].type === 'marine' && webglMarineFailed)
          )
        ).map(layerKey => {
          return [0, 1, 2].map(slotIdx => {
            const slotKey = `${layerKey}-slot-${slotIdx}`;
            const url = omTileUrls[slotKey];
            if (!url) return null;
            const isActive = activeSlots[layerKey] !== undefined
              ? activeSlots[layerKey] === slotIdx
              : (closestTimeIdx % 3) === slotIdx;

            // Strict visual isolation: Hide wind and marine layers from MapLibre's built-in raster renderer, unless failed
            const isExcludedMarine = ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(layerKey) && !webglMarineFailed;
            const isVisualRaster = activeLayers.includes(layerKey) && !isExcludedMarine && !['wind'].includes(layerKey);

            return (
              <Source
                key={`${slotKey}-source`}
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
        {/* Keep the WebGL marine engine RESIDENT (gated by the `active` prop) instead of
            unmounting it whenever no marine layer is selected. Unmounting disposed the
            87,616-particle GPU engine and remounting rebuilt it — the dominant churn when
            toggling between a marine layer and wind. The custom layer's render() no-ops
            (and clears once) when active=false, so an idle resident engine is cheap. */}
        {!webglMarineFailed ? (
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
          surfMode={surfMode}
          spotRatings={spotRatings}
          clusterRatings={clusterRatings}
        />
        {/* Keep the WebGL wind engine RESIDENT (gated by `active`) — same rationale as the
            marine layer above: avoid disposing/rebuilding the 147,456-particle engine on
            every wind toggle. render() no-ops + clears once when active=false. */}
        {!webglWindFailed ? (
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
        <LongPressMarker location={longPressLocation} />

      </Map>
    </div>
  );
};

export default MapWebGL;
