import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { resolveForecastWindow, getUserTier, getAllowedModels } from '../components/map/LayerAccessResolver';
import { radarFutureFramesForModel, radarRegionForCenter } from '../components/map/radarForecastSources';
import logger from '../utils/logger';

/**
 * useWeatherState Manages all weather/forecast layer state for the Map.
 *
 * Extracted from MapPage.js to reduce its LOC and isolate weather logic.
 * Handles: model selection, layer toggling, radar frame animation,
 * forecast time-offset animation, and subscription-gated timeline limits.
 */
export function useWeatherState({ user }) {
  // --- Core weather state ---
  const [activeModel, setActiveModel] = useState(() => {
    try {
      return localStorage.getItem('rawsurf-active-model') || 'GFS';
    } catch {
      return 'GFS';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('rawsurf-active-model', activeModel);
    } catch (e) {
      logger.error('Failed to save activeModel to localStorage:', e);
    }
  }, [activeModel]);

  const [capabilitiesVersion, setCapabilitiesVersion] = useState(0);

  // Safety check to validate allowed models for the user tier
  useEffect(() => {
    const allowed = getAllowedModels(user);
    if (allowed.length > 0 && !allowed.includes(activeModel)) {
      const fallback = allowed.includes('GFS') ? 'GFS' : allowed[0];
      logger.warn(`[useWeatherState] activeModel "${activeModel}" is not allowed for user tier, falling back to "${fallback}"`);
      setActiveModel(fallback);
    }
  }, [user, activeModel, capabilitiesVersion]);

  const [activeLayers, setActiveLayers] = useState([]);
  const [timeOffsetHours, setTimeOffsetHours] = useState(0);
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);
  const [showWeatherControls, setShowWeatherControls] = useState(false);
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(false);

  // --- Radar animation state (RainViewer past + model-aware forecast frames) ---
  const [radarPastFrames, setRadarPastFrames] = useState([]);
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const radarIntervalRef = useRef(null);
  const forecastIntervalRef = useRef(null);

  // Fetch RainViewer radar frames on mount AND on a refresh interval (2026-07-06): the catalog
  // rotates every ~10 min and old frame paths EXPIRE — a mount-only fetch left stale paths that
  // 404'd tile-by-tile (the tilecache 404 + MapLibre error storm in the 07-06 console capture).
  // Refresh keeps paths live; the frame index is re-pinned to "now" only on the first load so a
  // user mid-scrub isn't yanked.
  useEffect(() => {
    let disposed = false;
    let first = true;
    const loadCatalog = () => {
      fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(r => r.json())
        .then(data => {
 // Nowcast discontinued Jan 2026 only past frames available
          const past = data?.radar?.past || [];
          if (!disposed && past.length > 0) {
            setRadarPastFrames(past);
            if (first) { setRadarFrameIndex(past.length - 1); first = false; }
          }
        })
        .catch(err => logger.error('[MAP] RainViewer fetch failed:', err));
    };
    loadCatalog();
    const refresh = setInterval(loadCatalog, 5 * 60 * 1000);
    return () => { disposed = true; clearInterval(refresh); };
  }, []);

  // RADAR REGION (2026-07-06 v2): forecast-radar feeds are REGIONAL (HRRR = CONUS, DWD = EU) —
  // the feed must follow the VIEWPORT or out-of-footprint tiles render transparent ("clears past
  // the nowcast", the Florida-on-EURO report). Tracked with a light 2s poll of the map center
  // while the radar layer is active; state only changes on region-label transitions (continental
  // pans), so re-renders are rare.
  const [radarRegion, setRadarRegion] = useState('CONUS');
  useEffect(() => {
    if (!activeLayers.includes('radar')) return;
    const tick = () => {
      try {
        const c = window.__MAP_INSTANCE__ && window.__MAP_INSTANCE__.getCenter && window.__MAP_INSTANCE__.getCenter();
        if (c) {
          const r = radarRegionForCenter(c.lng, c.lat);
          setRadarRegion(prev => (prev === r ? prev : r));
        }
      } catch (e) { /* map not ready — keep the last region */ }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [activeLayers]);

  // RADAR FORECAST FRAMES (2026-07-06): RainViewer's nowcast is gone, so the timeline extends
  // into the future via region+model-aware forecast feeds (see radarForecastSources.js). Same
  // exported name — consumers see one longer frame list with the "now" frame still at
  // radarPastFrames.length - 1. Kill: __RAW_RADAR_FUTURE_DISABLED__.
  const radarFrames = useMemo(
    () => [...radarPastFrames, ...radarFutureFramesForModel(activeModel, Date.now(), undefined, radarRegion)],
    [radarPastFrames, activeModel, radarRegion]
  );

  // Model switches can shorten the composed list — keep the index in range.
  useEffect(() => {
    if (radarFrameIndex >= radarFrames.length && radarFrames.length > 0) {
      setRadarFrameIndex(radarFrames.length - 1);
    }
  }, [radarFrames.length, radarFrameIndex]);

  // --- Derived booleans ---
  const isRadarActive = activeLayers.includes('radar');
  const isRadarOrSat = isRadarActive; // Satellite IR discontinued

  useEffect(() => {
    const handleCapabilities = () => {
      setCapabilitiesVersion(prev => prev + 1);
    };
    window.addEventListener('weatherCapabilitiesLoaded', handleCapabilities);
    return () => {
      window.removeEventListener('weatherCapabilitiesLoaded', handleCapabilities);
    };
  }, []);

  const maxHoursForUser = useMemo(() => {
    const forecastDays = resolveForecastWindow(user, activeModel, activeLayers && activeLayers[0]);
    return forecastDays * 24;
  }, [user, activeModel, activeLayers, capabilitiesVersion]);

  const isLockedForecast = useMemo(() => {
    if (getUserTier(user) === 'premium') return false;
    return timeOffsetHours > maxHoursForUser;
  }, [timeOffsetHours, maxHoursForUser, user]);

  // Clamp timeOffsetHours if it exceeds the max allowed hours for the active model/layer
  useEffect(() => {
    if (timeOffsetHours > maxHoursForUser) {
      setTimeOffsetHours(maxHoursForUser);
    }
  }, [maxHoursForUser, timeOffsetHours]);

  // --- Radar/Satellite frame animation ---
  useEffect(() => {
    if (isPlayingTimeline && isRadarOrSat && radarFrames.length > 1) {
      radarIntervalRef.current = setInterval(() => {
        setRadarFrameIndex(prev => (prev + 1) % radarFrames.length);
      }, 800);
    }
    return () => {
      if (radarIntervalRef.current) clearInterval(radarIntervalRef.current);
    };
  }, [isPlayingTimeline, isRadarOrSat, radarFrames.length]);

  // --- Forecast time-step animation (non-radar layers) ---
 // v3.9: Wind/marine need ~3s per fetch 4s interval with 6h steps
  // Raster-only layers (rain/fog/pressure/satellite) use faster 1.5s (no API call needed)
  useEffect(() => {
    if (isPlayingTimeline && !isRadarOrSat && activeLayers.length > 0) {
      const activeLayer = activeLayers[0];
      const isRasterOnly = ['rain', 'fog', 'pressure', 'satellite'].includes(activeLayer);
      const stepHours = isRasterOnly ? 1 : 6;
      const intervalMs = isRasterOnly ? 800 : 4000;

      forecastIntervalRef.current = setInterval(() => {
        setTimeOffsetHours(prev => {
          const next = prev + stepHours;
          return next > maxHoursForUser ? 0 : next;
        });
      }, intervalMs);
    }
    return () => {
      if (forecastIntervalRef.current) clearInterval(forecastIntervalRef.current);
    };
  }, [isPlayingTimeline, isRadarOrSat, activeLayers, maxHoursForUser]);

  // --- Layer toggling ---
  const toggleLayer = useCallback((layerId) => {
    setActiveLayers(prev =>
      prev.includes(layerId) ? [] : [layerId]
    );
    setIsPlayingTimeline(false);
  }, []);

  return {
    // State
    activeModel,
    setActiveModel,
    activeLayers,
    setActiveLayers,
    timeOffsetHours,
    setTimeOffsetHours,
    isPlayingTimeline,
    setIsPlayingTimeline,
    showWeatherControls,
    setShowWeatherControls,
    isTimelineCollapsed,
    setIsTimelineCollapsed,
    // Radar
    radarFrames,
    radarFrameIndex,
    setRadarFrameIndex,
    // Derived
    isRadarActive,
    isRadarOrSat,
    maxHoursForUser,
    isLockedForecast,
    // Actions
    toggleLayer,
  };
}

export default useWeatherState;
