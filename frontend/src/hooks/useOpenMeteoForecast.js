import { useState, useEffect, useRef, useCallback } from 'react';
import logger from '../utils/logger';

/**
 * Open-Meteo Weather + Marine forecast hook.
 *
 * - Free, no API key required
 * - Supports GFS, ECMWF (EURO), ICON model selection
 * - Weather: precipitation, wind, pressure up to 16 days
 * - Marine: full swell decomposition (primary, secondary, wind waves) up to 16 days
 * - LIVE mode: uses `current` endpoint for observational-level accuracy
 *
 * API Docs:
 *   Weather: https://open-meteo.com/en/docs
 *   Marine:  https://open-meteo.com/en/docs/marine-weather-api
 */

// Model ID mapping for Open-Meteo
const MODEL_MAP = {
  GFS:  'gfs_seamless',
  EURO: 'ecmwf_ifs025',
  ICON: 'icon_seamless',
};

// Weather variables — hourly forecast timeline
const WEATHER_VARS = [
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'surface_pressure',
].join(',');

// Current weather variables — for LIVE (timeOffset=0) observational accuracy
const CURRENT_WEATHER_VARS = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m';

// Marine variables — full swell decomposition
// Primary swell, secondary swell, wind waves + combined totals
const MARINE_VARS = [
  'wave_height',
  'wave_period',
  'wave_direction',
  'swell_wave_height',
  'swell_wave_period',
  'swell_wave_direction',
  'secondary_swell_wave_height',
  'secondary_swell_wave_period',
  'secondary_swell_wave_direction',
  'wind_wave_height',
  'wind_wave_period',
  'wind_wave_direction',
].join(',');

// Current marine variables — for LIVE readout
const CURRENT_MARINE_VARS = 'wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction';

export const useOpenMeteoForecast = ({ latitude, longitude, activeModel = 'GFS', enabled = true }) => {
  const [forecastData, setForecastData] = useState(null);
  const [marineData, setMarineData] = useState(null);
  const [currentWeather, setCurrentWeather] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef(null);
  const lastFetchKey = useRef('');

  const fetchForecast = useCallback(async () => {
    if (!latitude || !longitude || !enabled) return;

    // Deduplicate: don't refetch for the same params (uses ref, not stale state)
    const fetchKey = `${latitude.toFixed(2)}_${longitude.toFixed(2)}_${activeModel}`;
    if (fetchKey === lastFetchKey.current) return;
    lastFetchKey.current = fetchKey;

    // Abort previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);

    const modelParam = MODEL_MAP[activeModel] || MODEL_MAP.GFS;

    try {
      // Parallel fetch: weather (hourly + current) + marine (hourly + current)
      const [wxRes, marineRes] = await Promise.allSettled([
        fetch(
          `https://api.open-meteo.com/v1/forecast?` +
          `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
          `&hourly=${WEATHER_VARS}` +
          `&current=${CURRENT_WEATHER_VARS}` +
          `&models=${modelParam}` +
          `&forecast_days=16` +
          `&wind_speed_unit=kn`
        ),
        fetch(
          `https://marine-api.open-meteo.com/v1/marine?` +
          `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
          `&hourly=${MARINE_VARS}` +
          `&current=${CURRENT_MARINE_VARS}` +
          `&forecast_days=16`
        )
      ]);

      if (wxRes.status === 'fulfilled' && wxRes.value.ok) {
        const data = await wxRes.value.json();
        setForecastData(data);
        if (data.current) setCurrentWeather(data.current);
      } else {
        logger.warn('[OpenMeteo] Weather fetch failed:', wxRes.reason || wxRes.value?.status);
      }

      if (marineRes.status === 'fulfilled' && marineRes.value.ok) {
        const data = await marineRes.value.json();
        setMarineData(data);
      } else {
        logger.warn('[OpenMeteo] Marine fetch failed:', marineRes.reason || marineRes.value?.status);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error('[OpenMeteo] Fetch error:', err);
      }
    } finally {
      setIsLoading(false);
    }
  }, [latitude, longitude, activeModel, enabled]);

  // Fetch when coordinates or model change
  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { forecastData, marineData, currentWeather, isLoading, refetch: fetchForecast };
};

export default useOpenMeteoForecast;
