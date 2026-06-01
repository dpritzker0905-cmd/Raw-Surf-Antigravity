import { useState, useEffect, useRef, useCallback } from 'react';
import logger from '../utils/logger';
import { isInCooldown } from '../components/map/marineControllerUtils';

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
  EURO: 'ecmwf_ifs',
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
  'pressure_msl',
].join(',');

const CURRENT_WEATHER_VARS = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m';

const MODEL_SUPPORTED_MARINE_VARS = {
  'ncep_gfswave025': [
    'wave_height', 'wave_period', 'wave_direction',
    'swell_wave_height', 'swell_wave_period', 'swell_wave_direction',
    'secondary_swell_wave_height', 'secondary_swell_wave_period', 'secondary_swell_wave_direction',
    'wind_wave_height', 'wind_wave_period', 'wind_wave_direction'
  ],
  'gwam': [
    'wave_height', 'wave_period', 'wave_direction',
    'swell_wave_height', 'swell_wave_period', 'swell_wave_direction',
    'wind_wave_height', 'wind_wave_period', 'wind_wave_direction'
  ],
  'ecmwf_wam025': [
    'wave_height', 'wave_period', 'wave_direction'
  ]
};

const CURRENT_MARINE_VARS = 'wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction';

// Module-level rate limiter and shared forecast cache / request deduplicator
let lastGlobalFetchTime = 0;
let lastGlobalModel = '';
const MIN_FETCH_INTERVAL = 2_000;

const forecastCache = new Map();
const inFlightRequests = new Map();
const CACHE_TTL = 120_000; // 2 minutes

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

    // Scrubbing mode hard freeze (Request 3)
    if (window.isScrubbingTimeline) {
      console.log("[SCRUB] [FETCH] Spot forecast fetch suppressed during active scrubbing");
      return;
    }

    // Suppress background updates if active marine cooldown is active
    if (!isExplicit && isInCooldown('marine')) {
      console.log("[Forecast] Suppressing background center snapped forecast fetch during active marine cooldown");
      return;
    }

    const fetchKey = `${latitude.toFixed(4)}_${longitude.toFixed(4)}_${activeModel}_${isExplicit ? 'explicit' : 'auto'}`;
    
    // 1. Check in-memory cache
    const cached = forecastCache.get(fetchKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      console.log(`[CACHE] [Forecast] Serving cached forecast for ${fetchKey}`);
      setForecastData(cached.forecastData);
      setMarineData(cached.marineData);
      setCurrentWeather(cached.currentWeather);
      setIsStale(false);
      setIsLoading(false);
      return;
    }

    // 2. Check in-flight requests
    if (inFlightRequests.has(fetchKey)) {
      console.log(`[DEDUPE] [Forecast] Reusing in-flight request for ${fetchKey}`);
      setIsLoading(true);
      try {
        const result = await inFlightRequests.get(fetchKey);
        setForecastData(result.forecastData);
        setMarineData(result.marineData);
        setCurrentWeather(result.currentWeather);
        setIsStale(result.isStale);
      } catch (e) {
        // Ignored
      } finally {
        setIsLoading(false);
      }
      return;
    }

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

    const shouldBypassRateLimit = isModelSwitch || isExplicit;
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
    // Optimize: background center snaps only fetch 3 days to protect rate limits and load faster
    const baseDays = MODEL_FORECAST_DAYS[activeModel] || 16;
    const forecastDays = isExplicit ? baseDays : 3;
    console.log(`[FETCH] [Forecast] Fetching ${activeModel} (${modelParam}), ${forecastDays}d (explicit=${isExplicit})`);

    const marineModel = activeModel === 'EURO'
      ? 'ecmwf_wam025'
      : activeModel === 'ICON'
        ? 'gwam'
        : 'ncep_gfswave025';
    
    const supportedVars = MODEL_SUPPORTED_MARINE_VARS[marineModel] || MODEL_SUPPORTED_MARINE_VARS['ncep_gfswave025'];
    const currentMarineVars = CURRENT_MARINE_VARS.split(',').filter(v => supportedVars.includes(v)).join(',');

    const fetchPromise = (async () => {
      try {
        const isLocalhost = typeof window !== 'undefined' && 
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('192.168.'));

        // Helper: fetch via POST proxy, wrapping point requests in coordinate-arrays to hit deep Netlify POST caching
        const safeFetch = async (type, body) => {
          try {
            const res = await fetch('/api/weather-proxy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type, body }),
              signal: controller.signal
            });
            const ct = res.headers.get('content-type') || '';
            if (res.status === 429) {
              console.warn(`[OpenMeteo] Rate limited (429) for ${type}, not retrying`);
              return res;
            }
            if (!res.ok || ct.includes('text/html')) {
              if (isLocalhost) {
                console.log(`[OpenMeteo] Proxy unavailable (${res.status}), falling back to direct API for ${type}`);
                const directUrl = type === 'wind'
                  ? 'https://api.open-meteo.com/v1/forecast'
                  : 'https://marine-api.open-meteo.com/v1/marine';
                return await fetch(directUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                  signal: controller.signal
                });
              }
              throw new Error(`Proxy unavailable (${res.status})`);
            }
            return res;
          } catch (e) {
            if (e.name !== 'AbortError') {
              if (isLocalhost) {
                console.log(`[OpenMeteo] Proxy error (${e.message}), falling back to direct API for ${type}`);
                const directUrl = type === 'wind'
                  ? 'https://api.open-meteo.com/v1/forecast'
                  : 'https://marine-api.open-meteo.com/v1/marine';
                return await fetch(directUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                  signal: controller.signal
                });
              }
              throw e;
            }
            throw e;
          }
        };

        const wxBody = {
          latitude: [+latitude.toFixed(4)],
          longitude: [+longitude.toFixed(4)],
          hourly: WEATHER_VARS,
          current: CURRENT_WEATHER_VARS,
          models: [modelParam],
          forecast_days: forecastDays,
          wind_speed_unit: 'kn'
        };

        const marineBody = {
          latitude: [+latitude.toFixed(4)],
          longitude: [+longitude.toFixed(4)],
          hourly: supportedVars,
          current: currentMarineVars,
          models: [marineModel],
          forecast_days: Math.min(forecastDays, 16)
        };

        const fetchQueue = [];

        // 1. Weather Selected
        fetchQueue.push(
          safeFetch('wind', wxBody)
            .then(r => ({ type: 'wx_sel', ok: r.ok, value: r }))
            .catch(e => ({ type: 'wx_sel', ok: false, reason: e }))
        );

        // 2. Marine Selected
        if (isExplicit) {
          fetchQueue.push(
            safeFetch('marine', marineBody)
              .then(r => ({ type: 'marine_sel', ok: r.ok, value: r }))
              .catch(e => ({ type: 'marine_sel', ok: false, reason: e }))
          );
        } else {
          fetchQueue.push(
            Promise.resolve({ type: 'marine_sel', ok: false, skipped: true })
          );
        }

        const results = await Promise.all(fetchQueue);
        const rx = {};
        results.forEach(res => {
          rx[res.type] = res;
        });

        // Weather Stitching:
        let finalForecastData = null;
        let finalCurrentWeather = null;
        if (rx.wx_sel.ok) {
          const rawData = await rx.wx_sel.value.json();
          // Unwrap coordinate-array result
          finalForecastData = Array.isArray(rawData) ? rawData[0] : rawData;
          if (finalForecastData?.current) {
            finalCurrentWeather = finalForecastData.current;
          }
        }

        // Marine Stitching:
        let finalMarineData = null;
        if (rx.marine_sel.ok) {
          const rawData = await rx.marine_sel.value.json();
          // Unwrap coordinate-array result
          finalMarineData = Array.isArray(rawData) ? rawData[0] : rawData;
        }

        return {
          forecastData: finalForecastData,
          marineData: finalMarineData,
          currentWeather: finalCurrentWeather,
          isStale: !finalForecastData || (isExplicit ? !finalMarineData : false)
        };

      } catch (err) {
        if (err.name !== 'AbortError') {
          logger.error('[OpenMeteo] Fetch error:', err);
        }
        throw err;
      }
    })();

    inFlightRequests.set(fetchKey, fetchPromise);

    try {
      const result = await fetchPromise;
      
      if (result.forecastData) {
        setForecastData(result.forecastData);
        if (result.currentWeather) setCurrentWeather(result.currentWeather);
        setIsStale(false);
        console.log(`[FETCH] [Forecast] OK ${activeModel} (Stitched): ${result.forecastData.hourly?.wind_speed_10m?.length || 0}h records`);
      } else {
        lastFetchKey.current = '';
        setIsStale(true);
        if (isCoordinateMoved || isExplicit) {
          setForecastData(null);
          setCurrentWeather(null);
        }
      }

      if (result.marineData) {
        setMarineData(result.marineData);
      } else {
        lastFetchKey.current = '';
        if (isExplicit) {
          setIsStale(true);
        }
        if (isCoordinateMoved || isExplicit) {
          setMarineData(null);
        }
      }

      if (result.forecastData || result.marineData) {
        forecastCache.set(fetchKey, {
          forecastData: result.forecastData,
          marineData: result.marineData,
          currentWeather: result.currentWeather,
          timestamp: Date.now()
        });
        
        if (forecastCache.size > 30) {
          const oldestKey = [...forecastCache.keys()][0];
          forecastCache.delete(oldestKey);
        }
      }

    } catch (err) {
      lastFetchKey.current = '';
      if (err.name !== 'AbortError') {
        setIsStale(true);
        if (isCoordinateMoved || isExplicit) {
          setForecastData(null);
          setCurrentWeather(null);
          setMarineData(null);
        }
      }
    } finally {
      inFlightRequests.delete(fetchKey);
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
    const debounceDuration = useFastDebounce ? 50 : 2500;

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

