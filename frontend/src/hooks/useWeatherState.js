import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import logger from '../utils/logger';

/**
 * useWeatherState — Manages all weather/forecast layer state for the Map.
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

  // --- Radar animation state (RainViewer) ---
  const [radarFrames, setRadarFrames] = useState([]);
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const radarIntervalRef = useRef(null);
  const forecastIntervalRef = useRef(null);

  // Fetch RainViewer frames once on mount
  useEffect(() => {
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(r => r.json())
      .then(data => {
        const past = data?.radar?.past || [];
        const nowcast = data?.radar?.nowcast || [];
        const allFrames = [...past, ...nowcast];
        if (allFrames.length > 0) {
          setRadarFrames(allFrames);
          setRadarFrameIndex(past.length > 0 ? past.length - 1 : 0);
        }
      })
      .catch(err => logger.error('[MAP] RainViewer fetch failed:', err));
  }, []);

  // --- Derived booleans ---
  const isRadarActive = activeLayers.includes('radar');
  const isSatelliteActive = activeLayers.includes('satellite');
  const isRadarOrSat = isRadarActive || isSatelliteActive;

  // --- Subscription-gated max forecast hours ---
  const maxHoursForUser = useMemo(() => {
    const tier = user?.tier_id || 'tier_1';
    if (tier === 'tier_3' || tier === 'admin') return 14 * 24;
    if (tier === 'tier_2') return 7 * 24;
    return 24;
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
  useEffect(() => {
    if (isPlayingTimeline && !isRadarOrSat && activeLayers.length > 0) {
      forecastIntervalRef.current = setInterval(() => {
        setTimeOffsetHours(prev => {
          const next = prev + 3;
          return next > maxHoursForUser ? 0 : next;
        });
      }, 1200);
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
    // Radar
    radarFrames,
    radarFrameIndex,
    setRadarFrameIndex,
    // Derived
    isRadarActive,
    isSatelliteActive,
    isRadarOrSat,
    maxHoursForUser,
    isLockedForecast,
    // Actions
    toggleLayer,
  };
}

export default useWeatherState;
