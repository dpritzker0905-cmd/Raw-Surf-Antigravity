import { useState, useEffect, useRef, useCallback } from 'react';
import logger from '../utils/logger';

/**
 * Open-Meteo Weather + Marine forecast hook (v3.12.5).
 *
 * v3.12.5 FIXES:
 * - Model switches bypass global rate limit (GFS->EURO updates instantly)
 * - Debounce reduced to 3s initial, 500ms for model switches
 * - forecast_days matches model capability (GFS: 16, ECMWF: 10, ICON: 7)
 */

const MODEL_MAP = {
  GFS:  'gfs_seamless',
  EURO: 'ecmwf_ifs025',
  ICON: 'dwd_icon',
};

const MODEL_FORECAST_DAYS = { GFS: 16, EURO: 10, ICON: 7 };

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

// Module-level rate limiter shared across all instances
let lastGlobalFetchTime = 0;
let lastGlobalModel = '';
const MIN_FETCH_INTERVAL = 2_000;

export const useOpenMeteoForecast = ({ latitude, longitude, activeModel = 'GFS', enabled = true, isExplicit = false }) => {
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

    const fetchKey = `${latitude.toFixed(4)}_${longitude.toFixed(4)}_${activeModel}_${isExplicit ? 'explicit' : 'auto'}`;
    if (fetchKey === lastFetchKey.current) return;

    // Rate limit - bypass when model changes (user action, must be responsive)
    const now = Date.now();
    const isModelSwitch = lastGlobalModel !== '' && lastGlobalModel !== activeModel;

    let isCoordinateMoved = false;
    if (lastFetchKey.current) {
      const parts = lastFetchKey.current.split('_');
      if (parts.length >= 2) {
        const lastLat = parseFloat(parts[0]);
        const lastLng = parseFloat(parts[1]);
        if (!isNaN(lastLat) && !isNaN(lastLng)) {
          const dist = Math.sqrt(Math.pow(latitude - lastLat, 2) + Math.pow(longitude - lastLng, 2));
          if (dist > 0.0001) {
            isCoordinateMoved = true;
          }
        }
      }
    }

    const shouldBypassRateLimit = isModelSwitch || isExplicit || isCoordinateMoved;
    if (!shouldBypassRateLimit && now - lastGlobalFetchTime < MIN_FETCH_INTERVAL) {
      return;
    }

    lastFetchKey.current = fetchKey;
    lastGlobalFetchTime = now;
    lastGlobalModel = activeModel;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    if (isCoordinateMoved || isExplicit) {
      setForecastData(null);
      setMarineData(null);
      setCurrentWeather(null);
    }

    const modelParam = MODEL_MAP[activeModel] || MODEL_MAP.GFS;
    const forecastDays = MODEL_FORECAST_DAYS[activeModel] || 16;
    console.log(`[Forecast] Fetching ${activeModel} (${modelParam}), ${forecastDays}d`);

    const marineModel = activeModel === 'EURO'
      ? 'ecmwf_wam025'
      : activeModel === 'ICON'
        ? 'gwam'
        : 'ncep_gfswave025';
    const hourlyMarineVars = MARINE_VARS;
    const currentMarineVars = CURRENT_MARINE_VARS;

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

      // Fetch weather and marine in parallel
      const [wxRes, marineRes] = await Promise.all([
        safeFetch(
          `https://api.open-meteo.com/v1/forecast?` +
          `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
          `&hourly=${WEATHER_VARS}` +
          `&current=${CURRENT_WEATHER_VARS}` +
          `&models=${modelParam}` +
          `&forecast_days=${forecastDays}` +
          `&wind_speed_unit=kn`
        ).then(r => ({ status: 'fulfilled', value: r }))
         .catch(e => ({ status: 'rejected', reason: e })),

        safeFetch(
          `https://marine-api.open-meteo.com/v1/marine?` +
          `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
          `&hourly=${hourlyMarineVars}` +
          `&current=${currentMarineVars}` +
          `&models=${marineModel}` +
          `&forecast_days=${Math.min(forecastDays, 16)}`
        ).then(r => ({ status: 'fulfilled', value: r }))
         .catch(e => ({ status: 'rejected', reason: e }))
      ]);

      // Weather:
      if (wxRes.status === 'fulfilled' && wxRes.value.ok) {
        const data = await wxRes.value.json();
        setForecastData(data);
        if (data.current) setCurrentWeather(data.current);
        setIsStale(false);
        console.log(`[Forecast] OK ${activeModel}: ${data.hourly?.wind_speed_10m?.length || 0}h records`);
      } else {
        const status = wxRes.value?.status || wxRes.reason;
        logger.warn(`[OpenMeteo] Weather fetch failed (${status}).`);
        setIsStale(true);
        if (isCoordinateMoved || isExplicit) {
          setForecastData(null);
          setCurrentWeather(null);
        }
      }

      // Marine:
      if (marineRes.status === 'fulfilled' && marineRes.value.ok) {
        const data = await marineRes.value.json();
        setMarineData(data);
      } else {
        const status = marineRes.value?.status || marineRes.reason;
        const is400 = marineRes.value?.status === 400;
        logger.warn(`[OpenMeteo] Marine fetch failed (${status}).`);
        setIsStale(true);
        if (isCoordinateMoved || isExplicit || is400) {
          setMarineData(null);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error('[OpenMeteo] Fetch error:', err);
        setIsStale(true);
        if (isCoordinateMoved || isExplicit) {
          setForecastData(null);
          setCurrentWeather(null);
          setMarineData(null);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [latitude, longitude, activeModel, enabled, isExplicit]);

  // v3.12.5: Fast debounce for model switches (500ms), 300ms for explicit spots/markers, 3s for pan
  const prevModelRef = useRef(activeModel);
  const prevCoordsRef = useRef({ latitude, longitude });

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const isModelSwitch = prevModelRef.current !== activeModel;
    
    prevModelRef.current = activeModel;
    prevCoordsRef.current = { latitude, longitude };

    const useFastDebounce = isExplicit || isModelSwitch;
    const debounceDuration = useFastDebounce ? 50 : 1000;

    debounceRef.current = setTimeout(() => {
      fetchForecast();
    }, debounceDuration);
    return () => clearTimeout(debounceRef.current);
  }, [fetchForecast, isExplicit, activeModel, latitude, longitude]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { forecastData, marineData, currentWeather, isLoading, isStale, refetch: fetchForecast };
};

export default useOpenMeteoForecast;

