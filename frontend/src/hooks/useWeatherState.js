import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { resolveForecastWindow } from '../components/map/LayerAccessResolver';
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
  const [activeModel, setActiveModel] = useState('GFS');
  const [activeLayers, setActiveLayers] = useState([]);
  const [timeOffsetHours, setTimeOffsetHours] = useState(0);
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);
  const [showWeatherControls, setShowWeatherControls] = useState(false);
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(false);

  // --- Radar animation state (RainViewer) ---
  const [radarFrames, setRadarFrames] = useState([]);
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const radarIntervalRef = useRef(null);
  const forecastIntervalRef = useRef(null);

  // Fetch RainViewer radar frames once on mount (satellite IR discontinued Jan 2026)
  useEffect(() => {
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(r => r.json())
      .then(data => {
 // Nowcast discontinued Jan 2026 only past frames available
        const past = data?.radar?.past || [];
        if (past.length > 0) {
          setRadarFrames(past);
          setRadarFrameIndex(past.length - 1);
        }
      })
      .catch(err => logger.error('[MAP] RainViewer fetch failed:', err));
  }, []);

  // --- Derived booleans ---
  const isRadarActive = activeLayers.includes('radar');
  const isRadarOrSat = isRadarActive; // Satellite IR discontinued

  // --- Subscription-gated max forecast hours ---
  const maxHoursForUser = useMemo(() => {
    const forecastDays = resolveForecastWindow(user);
    return forecastDays * 24;
  }, [user]);

  const isLockedForecast = timeOffsetHours > maxHoursForUser;

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
    setTimeOffsetHours(0);
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
