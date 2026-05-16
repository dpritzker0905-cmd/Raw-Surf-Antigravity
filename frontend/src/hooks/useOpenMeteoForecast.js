import { useState, useEffect, useRef, useCallback } from 'react';
import logger from '../utils/logger';

/**
 * Open-Meteo Weather + Marine forecast hook (v3.9.0).
 *
 * v3.9 CRITICAL FIX: This hook was the #1 cause of 429 rate limiting.
 * - Old: fetched on every mapCenter change (per-pan) with .toFixed(1) dedup
 * - New: 5s debounce + .toFixed(0) dedup (1° grid) + min 30s between fetches
 *
 * This prevents spot forecasts from consuming the entire Open-Meteo rate budget,
 * which was blocking wind/marine grid fetches and breaking the forecast slider.
 */

const MODEL_MAP = {
  GFS:  'gfs_seamless',
  EURO: 'ecmwf_ifs025',
  ICON: 'icon_seamless',
};

const WEATHER_VARS = [
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'surface_pressure',
].join(',');

const CURRENT_WEATHER_VARS = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m';

const MARINE_VARS = [
  'wave_height', 'wave_period', 'wave_direction',
  'swell_wave_height', 'swell_wave_period', 'swell_wave_direction',
  'secondary_swell_wave_height', 'secondary_swell_wave_period', 'secondary_swell_wave_direction',
  'wind_wave_height', 'wind_wave_period', 'wind_wave_direction',
].join(',');

const CURRENT_MARINE_VARS = 'wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction';

// v3.9: Module-level rate limiter — shared across all instances
let lastGlobalFetchTime = 0;
const MIN_FETCH_INTERVAL = 30_000; // 30s between forecast fetches

export const useOpenMeteoForecast = ({ latitude, longitude, activeModel = 'GFS', enabled = true }) => {
  const [forecastData, setForecastData] = useState(null);
  const [marineData, setMarineData] = useState(null);
  const [currentWeather, setCurrentWeather] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const abortRef = useRef(null);
  const lastFetchKey = useRef('');
  const debounceRef = useRef(null);

  const fetchForecast = useCallback(async () => {
    if (!latitude || !longitude || !enabled) return;

    // v3.9: Coarser dedup grid (1° instead of 0.1°) — prevents 30+ fetches while panning
    const fetchKey = `${latitude.toFixed(0)}_${longitude.toFixed(0)}_${activeModel}`;
    if (fetchKey === lastFetchKey.current) return;

    // v3.9: Global rate limit — min 30s between any forecast fetch
    const now = Date.now();
    if (now - lastGlobalFetchTime < MIN_FETCH_INTERVAL) {
      return; // Silently skip — grid engine needs the rate budget
    }

    lastFetchKey.current = fetchKey;
    lastGlobalFetchTime = now;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);

    const modelParam = MODEL_MAP[activeModel] || MODEL_MAP.GFS;

    try {
      // Helper: fetch with signal, retry without if service worker can't clone Request
      const safeFetch = async (url) => {
        try {
          return await fetch(url, { signal: controller.signal });
        } catch (e) {
          if (e.name === 'DataCloneError' || e.message?.includes('could not be cloned')) {
            if (process.env.NODE_ENV === 'development') logger.debug?.('[OpenMeteo] SW clone retry');
            return await fetch(url);
          }
          throw e;
        }
      };

      // Fetch weather
      const wxRes = await safeFetch(
        `https://api.open-meteo.com/v1/forecast?` +
        `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
        `&hourly=${WEATHER_VARS}` +
        `&current=${CURRENT_WEATHER_VARS}` +
        `&models=${modelParam}` +
        `&forecast_days=16` +
        `&wind_speed_unit=kn`
      ).then(r => ({ status: 'fulfilled', value: r }))
       .catch(e => ({ status: 'rejected', reason: e }));

      // Stagger marine call by 3s to avoid simultaneous 429 with grid engine
      await new Promise(r => setTimeout(r, 3000));

      const marineRes = await safeFetch(
        `https://marine-api.open-meteo.com/v1/marine?` +
        `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
        `&hourly=${MARINE_VARS}` +
        `&current=${CURRENT_MARINE_VARS}` +
        `&forecast_days=16`
      ).then(r => ({ status: 'fulfilled', value: r }))
       .catch(e => ({ status: 'rejected', reason: e }));

      // Weather: preserve last valid on failure
      if (wxRes.status === 'fulfilled' && wxRes.value.ok) {
        const data = await wxRes.value.json();
        setForecastData(data);
        if (data.current) setCurrentWeather(data.current);
        setIsStale(false);
      } else {
        const status = wxRes.value?.status || wxRes.reason;
        logger.warn(`[OpenMeteo] Weather fetch failed (${status}). Preserving last valid data.`);
        setIsStale(true);
      }

      // Marine: preserve last valid on failure
      if (marineRes.status === 'fulfilled' && marineRes.value.ok) {
        const data = await marineRes.value.json();
        setMarineData(data);
      } else {
        const status = marineRes.value?.status || marineRes.reason;
        logger.warn(`[OpenMeteo] Marine fetch failed (${status}). Preserving last valid data.`);
        setIsStale(true);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error('[OpenMeteo] Fetch error:', err);
        setIsStale(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [latitude, longitude, activeModel, enabled]);

  // v3.9: 5s debounce instead of immediate fetch — lets the map settle
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchForecast();
    }, 5000);
    return () => clearTimeout(debounceRef.current);
  }, [fetchForecast]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { forecastData, marineData, currentWeather, isLoading, isStale, refetch: fetchForecast };
};

export default useOpenMeteoForecast;
