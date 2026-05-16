import { useState, useEffect, useRef, useCallback } from 'react';
import logger from '../utils/logger';

/**
 * Open-Meteo Weather + Marine forecast hook (v3.0.0).
 *
 * Conforms to Marine Engine v3 runtime contract:
 * - NO mock data injection in production
 * - Preserves last valid data on failure
 * - Shows stale indicator via isStale flag
 * - 429 cooldown protection
 *
 * API Docs:
 *   Weather: https://open-meteo.com/en/docs
 *   Marine:  https://open-meteo.com/en/docs/marine-weather-api
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

export const useOpenMeteoForecast = ({ latitude, longitude, activeModel = 'GFS', enabled = true }) => {
  const [forecastData, setForecastData] = useState(null);
  const [marineData, setMarineData] = useState(null);
  const [currentWeather, setCurrentWeather] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const abortRef = useRef(null);
  const lastFetchKey = useRef('');

  const fetchForecast = useCallback(async () => {
    if (!latitude || !longitude || !enabled) return;

    const fetchKey = `${latitude.toFixed(1)}_${longitude.toFixed(1)}_${activeModel}`;
    if (fetchKey === lastFetchKey.current) return;
    lastFetchKey.current = fetchKey;

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
            logger.warn('[OpenMeteo] Service worker clone error, retrying without signal');
            return await fetch(url);
          }
          throw e;
        }
      };

      // Fetch weather immediately
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
        // Do NOT clear forecastData — preserve last valid field
      }

      // Marine: preserve last valid on failure
      if (marineRes.status === 'fulfilled' && marineRes.value.ok) {
        const data = await marineRes.value.json();
        setMarineData(data);
      } else {
        const status = marineRes.value?.status || marineRes.reason;
        logger.warn(`[OpenMeteo] Marine fetch failed (${status}). Preserving last valid data.`);
        setIsStale(true);
        // Do NOT clear marineData — preserve last valid field
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

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { forecastData, marineData, currentWeather, isLoading, isStale, refetch: fetchForecast };
};

export default useOpenMeteoForecast;
