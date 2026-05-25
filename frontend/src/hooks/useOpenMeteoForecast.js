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
  'snowfall',
  'precipitation_probability',
  'temperature_2m',
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
        ? 'dwd_gwam'
        : 'ncep_gfswave025';
    const hourlyMarineVars = MARINE_VARS;
    const currentMarineVars = CURRENT_MARINE_VARS;

    try {
      // Direct Open-Meteo URLs (fallback when Netlify proxy unavailable, e.g. local dev)
      const DIRECT_URLS = {
        wind: 'https://api.open-meteo.com/v1/forecast',
        marine: 'https://marine-api.open-meteo.com/v1/marine',
      };

      // Helper: fetch via proxy, fall back to direct Open-Meteo if proxy returns HTML/404
      const safeFetch = async (url, directType, directParams) => {
        try {
          const res = await fetch(url, { signal: controller.signal });
          // If proxy returns HTML (e.g. CRA index.html for unknown route), fall back
          const ct = res.headers.get('content-type') || '';
          if (!res.ok || ct.includes('text/html')) {
            console.log(`[OpenMeteo] Proxy unavailable (${res.status}), falling back to direct API for ${directType}`);
            return await fetch(`${DIRECT_URLS[directType]}?${directParams}`, { signal: controller.signal });
          }
          return res;
        } catch (e) {
          if (e.name === 'DataCloneError' || e.message?.includes('could not be cloned')) {
            if (process.env.NODE_ENV === 'development') logger.debug?.('[OpenMeteo] SW clone retry');
            return await fetch(url);
          }
          // Network error — try direct
          if (e.name !== 'AbortError') {
            console.log(`[OpenMeteo] Proxy error (${e.message}), falling back to direct API for ${directType}`);
            return await fetch(`${DIRECT_URLS[directType]}?${directParams}`, { signal: controller.signal });
          }
          throw e;
        }
      };

      const wxParams = `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&hourly=${WEATHER_VARS}&current=${CURRENT_WEATHER_VARS}&models=${modelParam}&forecast_days=${forecastDays}&wind_speed_unit=kn`;
      const marineParams = `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&hourly=${hourlyMarineVars}&current=${currentMarineVars}&models=${marineModel}&forecast_days=${Math.min(forecastDays, 16)}`;

      const needBaseGfs = activeModel !== 'GFS';
      const gfsWxParams = `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&hourly=${WEATHER_VARS}&current=${CURRENT_WEATHER_VARS}&models=gfs_seamless&forecast_days=16&wind_speed_unit=kn`;
      const gfsMarineParams = `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&hourly=${hourlyMarineVars}&current=${currentMarineVars}&models=ncep_gfswave025&forecast_days=16`;

      const fetchQueue = [];

      // 1. Weather Selected
      fetchQueue.push(
        safeFetch(`/api/weather-proxy?type=wind&${wxParams}`, 'wind', wxParams)
          .then(r => ({ type: 'wx_sel', ok: r.ok, value: r }))
          .catch(e => ({ type: 'wx_sel', ok: false, reason: e }))
      );

      // 2. Marine Selected
      fetchQueue.push(
        safeFetch(`/api/weather-proxy?type=marine&${marineParams}`, 'marine', marineParams)
          .then(r => ({ type: 'marine_sel', ok: r.ok, value: r }))
          .catch(e => ({ type: 'marine_sel', ok: false, reason: e }))
      );

      if (needBaseGfs) {
        // 3. Weather Base GFS (16 days)
        fetchQueue.push(
          safeFetch(`/api/weather-proxy?type=wind&${gfsWxParams}`, 'wind', gfsWxParams)
            .then(r => ({ type: 'wx_base', ok: r.ok, value: r }))
            .catch(e => ({ type: 'wx_base', ok: false, reason: e }))
        );

        // 4. Marine Base GFS (16 days)
        fetchQueue.push(
          safeFetch(`/api/weather-proxy?type=marine&${gfsMarineParams}`, 'marine', gfsMarineParams)
            .then(r => ({ type: 'marine_base', ok: r.ok, value: r }))
            .catch(e => ({ type: 'marine_base', ok: false, reason: e }))
        );
      }

      const results = await Promise.all(fetchQueue);
      const rx = {};
      results.forEach(res => {
        rx[res.type] = res;
      });

      // Weather Stitching:
      let finalForecastData = null;
      if (rx.wx_sel.ok) {
        finalForecastData = await rx.wx_sel.value.json();
        
        if (needBaseGfs && rx.wx_base?.ok) {
          const baseData = await rx.wx_base.value.json();
          if (finalForecastData.hourly && baseData.hourly) {
            const selHourly = finalForecastData.hourly;
            const baseHourly = baseData.hourly;
            const selLen = selHourly.time?.length || 0;
            const baseLen = baseHourly.time?.length || 0;
            
            Object.keys(baseHourly).forEach(key => {
              if (Array.isArray(baseHourly[key])) {
                if (!selHourly[key] || selHourly[key].length === 0) {
                  // Fall back and copy the entire base GFS array if the regional model lacks this variable entirely
                  selHourly[key] = [...baseHourly[key]];
                } else {
                  const stitchedArray = [...selHourly[key]];
                  for (let i = selLen; i < baseLen; i++) {
                    stitchedArray.push(baseHourly[key][i]);
                  }
                  selHourly[key] = stitchedArray;
                }
              }
            });
          }
        }
      } else if (needBaseGfs && rx.wx_base?.ok) {
        // Fallback to base GFS weather data if the selected model failed (e.g. rate limit, 502/503/504)
        finalForecastData = await rx.wx_base.value.json();
        console.log(`[Forecast] Selected weather model failed, falling back to base GFS weather data`);
      }

      // Marine Stitching:
      let finalMarineData = null;
      if (rx.marine_sel.ok) {
        finalMarineData = await rx.marine_sel.value.json();
        
        if (needBaseGfs && rx.marine_base?.ok) {
          const baseData = await rx.marine_base.value.json();
          if (finalMarineData.hourly && baseData.hourly) {
            const selHourly = finalMarineData.hourly;
            const baseHourly = baseData.hourly;
            const selLen = selHourly.time?.length || 0;
            const baseLen = baseHourly.time?.length || 0;
            
            Object.keys(baseHourly).forEach(key => {
              if (Array.isArray(baseHourly[key])) {
                if (!selHourly[key] || selHourly[key].length === 0) {
                  // Fall back and copy the entire base GFS Wave array if the regional model lacks this variable entirely
                  selHourly[key] = [...baseHourly[key]];
                } else {
                  const stitchedArray = [...selHourly[key]];
                  for (let i = selLen; i < baseLen; i++) {
                    stitchedArray.push(baseHourly[key][i]);
                  }
                  selHourly[key] = stitchedArray;
                }
              }
            });
          }
        }
      } else if (needBaseGfs && rx.marine_base?.ok) {
        // Fallback to base GFS marine data if selected model failed (e.g. due to land mask boundary differences)
        finalMarineData = await rx.marine_base.value.json();
        console.log(`[Forecast] Selected marine model failed, falling back to base GFS Wave data`);
      }

      // Weather Application:
      if (finalForecastData) {
        setForecastData(finalForecastData);
        if (finalForecastData.current) setCurrentWeather(finalForecastData.current);
        setIsStale(false);
        console.log(`[Forecast] OK ${activeModel} (Stitched): ${finalForecastData.hourly?.wind_speed_10m?.length || 0}h records`);
      } else {
        lastFetchKey.current = ''; // Reset lock on error
        const status = rx.wx_sel.value?.status || rx.wx_sel.reason;
        logger.warn(`[OpenMeteo] Weather fetch failed (${status}).`);
        setIsStale(true);
        if (isCoordinateMoved || isExplicit) {
          setForecastData(null);
          setCurrentWeather(null);
        }
      }

      // Marine Application:
      if (finalMarineData) {
        setMarineData(finalMarineData);
      } else {
        lastFetchKey.current = ''; // Reset lock on error
        const status = rx.marine_sel.value?.status || rx.marine_sel.reason;
        const is400 = rx.marine_sel.value?.status === 400;
        logger.warn(`[OpenMeteo] Marine fetch failed (${status}).`);
        setIsStale(true);
        if (isCoordinateMoved || isExplicit || is400) {
          setMarineData(null);
        }
      }
    } catch (err) {
      lastFetchKey.current = ''; // Reset lock on abort/error
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

