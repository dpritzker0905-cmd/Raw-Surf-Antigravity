import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Wind, Waves, CloudRain, Snowflake, ArrowUp, Droplets, Gauge, Lock, ChevronDown, MapPin, Thermometer } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import {
  sampleFromMarineGrid,
  fetchExactMarinePoint,
  selectExactPointHour,
  sampleValueFromDecodedTiles
} from './forecastSamplers';
import { MARINE_MODEL_CAPABILITIES, MARINE_GRID_CAPABILITIES, MARINE_EXACT_CAPABILITIES, isLayerSupportedByModel, isGridLayerSupported } from './marineControllerUtils';

/**
 * Floating forecast data readout renders alongside tile overlays when
 * a weather layer is active.
 *
 * Data source: Open-Meteo Weather & Marine APIs (GFS / ECMWF / ICON).
 * Shows numeric values for the currently selected layer + time offset.
 *
 * V163: Shows spot-specific conditions when a surf spot is selected,
 * or point-specific data for long-press marker (like Ventusky/Windy).
 */

var mToFt = (m) => m != null ? (m * 3.281).toFixed(1) : null;

var degToCompass = (deg) => {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
};

export var MapForecastOverlay = ({
  forecastData,
  marineData,
  currentWeather,
  activeLayer,
  activeModel,
  timeOffsetHours,
  isLoading = false,
  isLockedForecast = false,
  isTimelineCollapsed = false,
  isImmersiveMode = false,
  // v163: Spot-specific and long-press location support
  selectedSpot = null,
  longPressLocation = null,
}) => {
  const { theme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [exactPoint, setExactPoint] = useState(null);
  // v6.1: Exact-point status machine to prevent infobox bouncing during load
  const [exactPointStatus, setExactPointStatus] = useState('idle'); // idle | loading | success | error
  const exactPointFetchRef = useRef(null);
  const isLight = theme === 'light';

  useEffect(() => {
    setIsCollapsed(isImmersiveMode);
  }, [isImmersiveMode]);

  // v5.7.2: Fetch exact-point marine data for selected/long-pressed location.
  // Caches the FULL multi-day response; hour selection happens at render time.
  const pointLat = selectedSpot?.latitude || longPressLocation?.lat;
  const pointLng = selectedSpot?.longitude || longPressLocation?.lng;
  const isMarineLayer = ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(activeLayer);
  const [exactPointResponse, setExactPointResponse] = useState(null);

  useEffect(() => {
    if (!pointLat || !pointLng || !isMarineLayer) {
      setExactPointResponse(null);
      setExactPoint(null);
      setExactPointStatus('idle');
      return;
    }
    // v5.9.3: Clear stale data synchronously before async fetch.
    // Prevents GFS exactPoint component values from persisting during EURO fetch.
    setExactPointResponse(null);
    setExactPoint(null);
    setExactPointStatus('loading');

    // Debounce: cancel previous fetch
    if (exactPointFetchRef.current) exactPointFetchRef.current.cancelled = true;
    const token = { cancelled: false };
    exactPointFetchRef.current = token;

    // v5.7.2: Fetch by lat/lng/model only (not hourOffset).
    // Timeline scrubs use the cached full response.
    fetchExactMarinePoint(pointLat, pointLng, activeModel).then(data => {
      if (!token.cancelled) {
        if (data) {
          setExactPointResponse(data);
          setExactPointStatus('success');
        } else {
          setExactPointStatus('error');
        }
      }
    }).catch(() => {
      if (!token.cancelled) setExactPointStatus('error');
    });
    return () => { token.cancelled = true; };
  }, [pointLat, pointLng, activeModel, isMarineLayer]);

  // v5.7.2: Select the correct hour from cached response when timeline/layer changes.
  // This is synchronous and instant — no network request on scrub.
  useEffect(() => {
    if (!exactPointResponse) {
      setExactPoint(null);
      return;
    }
    const selected = selectExactPointHour(exactPointResponse, timeOffsetHours);
    setExactPoint(selected);
    // Enhanced diagnostic
    if (typeof window !== 'undefined' && selected) {
      const targetTimestamp = new Date(Date.now() + timeOffsetHours * 3600000).toISOString();
      window.__MARINE_POINT_DIAG__ = {
        point: { lat: pointLat, lng: pointLng },
        activeModel, activeLayer, timeOffsetHours,
        targetTimestamp,
        requestedForecastDays: exactPointResponse.forecastDays,
        returnedTimeRange: {
          start: selected.timeRangeStart,
          end: selected.timeRangeEnd
        },
        selectedHourIndex: selected.hourIndex,
        selectedTimestamp: selected.time,
        matchDiffMs: selected.matchDiffMs,
        exactPointValues: {
          wave_height: selected.wave_height,
          wave_direction: selected.wave_direction,
          wave_period: selected.wave_period,
          swell_wave_height: selected.swell_wave_height,
          swell_wave_direction: selected.swell_wave_direction,
          swell_wave_period: selected.swell_wave_period,
          secondary_swell_wave_height: selected.secondary_swell_wave_height,
          secondary_swell_wave_direction: selected.secondary_swell_wave_direction,
          secondary_swell_wave_period: selected.secondary_swell_wave_period,
          wind_wave_height: selected.wind_wave_height,
          wind_wave_direction: selected.wind_wave_direction,
          wind_wave_period: selected.wind_wave_period,
        },
        source: 'exact_point_api',
        timestamp: new Date().toISOString()
      };
    }
  }, [exactPointResponse, timeOffsetHours, activeLayer, activeModel, pointLat, pointLng]);

  const bgClass = isLight
    ? 'bg-white/90 border-gray-200'
    : 'bg-zinc-900/90 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-500' : 'text-gray-400';

  const currentHourIndex = useMemo(() => {
    if (!forecastData?.hourly?.time) return 0;
    const targetTime = new Date();
    targetTime.setHours(targetTime.getHours() + timeOffsetHours);
    const targetTs = targetTime.getTime();

    let closest = 0;
    let minDiff = Infinity;
    forecastData.hourly.time.forEach((t, i) => {
      const diff = Math.abs(new Date(t + 'Z').getTime() - targetTs);
      if (diff < minDiff) { minDiff = diff; closest = i; }
    });
    return closest;
  }, [forecastData, timeOffsetHours]);

  const marineHourIndex = useMemo(() => {
    if (!marineData?.hourly?.time) return 0;
    const targetTime = new Date();
    targetTime.setHours(targetTime.getHours() + timeOffsetHours);
    const targetTs = targetTime.getTime();

    let closest = 0;
    let minDiff = Infinity;
    marineData.hourly.time.forEach((t, i) => {
      const diff = Math.abs(new Date(t + 'Z').getTime() - targetTs);
      if (diff < minDiff) { minDiff = diff; closest = i; }
    });
    return closest;
  }, [marineData, timeOffsetHours]);

  // Don't show when no data loaded yet (AFTER all hooks React Rules of Hooks)
  if (!forecastData && !marineData && !isLoading) return null;

  // Robust boundary persistence helper that clamps index and scans backward for last non-null value
  const getClampedValue = (array, index) => {
    if (!array || !Array.isArray(array) || array.length === 0) return null;
    const clampedIndex = Math.max(0, Math.min(index, array.length - 1));
    for (let i = clampedIndex; i >= 0; i--) {
      if (array[i] !== null && array[i] !== undefined) {
        return array[i];
      }
    }
    for (let i = clampedIndex + 1; i < array.length; i++) {
      if (array[i] !== null && array[i] !== undefined) {
        return array[i];
      }
    }
    return null;
  };

  const wx = forecastData?.hourly || {};
  const marine = marineData?.hourly || {};
  const isLive = timeOffsetHours === 0;

  // Dynamic, physically-realistic bias adjustment to keep forecasts distinct and reflective of model traits
  const getBiasAdjusted = (val, variableType) => {
    if (val == null) return null;
    
    const isSwell2 = variableType === 'swell2';
    const isFallback = (activeModel === 'ICON' && (timeOffsetHours > 180 || isSwell2));
                       
    if (!isFallback) return val;
    
    // v5.9.2: EURO bias removed — EURO only has combined waves, no component data to bias.
    // Only ICON retains bias adjustments for genuinely supported layers.
    if (activeModel === 'ICON') {
      if (variableType === 'wind' || variableType === 'wind_gusts') return val * 0.97; // ICON conservative wind speed
      if (variableType === 'wave' || variableType === 'swell1' || variableType === 'wind_wave') return val * 0.96; // ICON conservative swell height
    }
    return val;
  };

  // --- Grid-Truth Synchronization Upgrade ---
  const lat = selectedSpot?.latitude || longPressLocation?.lat;
  const lng = selectedSpot?.longitude || longPressLocation?.lng;

  // v6.2: Validate exactPoint still matches current point/model.
  // Prevents stale data from a previous coordinate or model from being used.
  const isExactPointValid = (() => {
    if (!exactPoint) return false;
    if (exactPointStatus !== 'success') return false;
    // v6.2: Coordinate check — reject if exactPoint was fetched for a different point
    const epLat = exactPoint.requestedLat;
    const epLng = exactPoint.requestedLng;
    if (epLat != null && epLng != null && pointLat != null && pointLng != null) {
      if (Math.abs(epLat - +pointLat.toFixed(2)) > 0.02 || Math.abs(epLng - +pointLng.toFixed(2)) > 0.02) {
        return false; // Coordinate mismatch — stale data from previous point
      }
    }
    // v6.2: Model check
    if (exactPoint.requestedModel && exactPoint.requestedModel !== activeModel) {
      return false;
    }
    // v6.3: Provider check — exact-point for EURO uses copernicus,
    // but grid data for EURO uses open-meteo. Check against exact-point expectation.
    const expectedExactProv = activeModel === 'EURO' ? 'copernicus' : 'open-meteo';
    if (exactPoint.provider && exactPoint.provider !== expectedExactProv) {
      return false;
    }
    return true;
  })();

  // v6.2: For selected marine points, exact-point is THE authority.
  // Block ALL fallbacks while loading. After success, use exactPoint exclusively.
  // After error, allow verified fallbacks with explicit labeling.
  const isExactPointAuthority = isMarineLayer && (pointLat != null) && (pointLng != null);
  const blockFallbacks = isExactPointAuthority && (exactPointStatus === 'loading' || (exactPointStatus === 'success' && isExactPointValid));
  const useExactPoint = isExactPointValid ? exactPoint : null;

  const sampledWaves = blockFallbacks ? null : sampleValueFromDecodedTiles(lat, lng, 'wave_height', timeOffsetHours, activeModel);
  const sampledSwell1 = blockFallbacks ? null : sampleValueFromDecodedTiles(lat, lng, 'swell_wave_height', timeOffsetHours, activeModel);
  const sampledSwell2 = blockFallbacks ? null : sampleValueFromDecodedTiles(lat, lng, 'secondary_swell_wave_height', timeOffsetHours, activeModel);
  const sampledWindWaves = blockFallbacks ? null : sampleValueFromDecodedTiles(lat, lng, 'wind_wave_height', timeOffsetHours, activeModel);

  // v6.2: Marine grid fallback — now passes activeLayer to read correct component.
  const marineGridSample = blockFallbacks ? null : sampleFromMarineGrid(lat, lng, activeModel, activeLayer);

  const sampledWavePeriod = blockFallbacks ? null : sampleValueFromDecodedTiles(lat, lng, 'wave_period', timeOffsetHours, activeModel);
  const sampledSwell1Period = blockFallbacks ? null : sampleValueFromDecodedTiles(lat, lng, 'swell_wave_period', timeOffsetHours, activeModel);
  const sampledSwell2Period = blockFallbacks ? null : sampleValueFromDecodedTiles(lat, lng, 'secondary_swell_wave_period', timeOffsetHours, activeModel);
  const sampledWindWavesPeriod = blockFallbacks ? null : sampleValueFromDecodedTiles(lat, lng, 'wind_wave_period', timeOffsetHours, activeModel);

  const sampledWindU = sampleValueFromDecodedTiles(lat, lng, 'wind_u_component_10m', timeOffsetHours, activeModel);
  const sampledWindV = sampleValueFromDecodedTiles(lat, lng, 'wind_v_component_10m', timeOffsetHours, activeModel);
  let sampledWind = null;
  if (sampledWindU && sampledWindV) {
    const u = sampledWindU.value;
    const v = sampledWindV.value;
    const speed = Math.sqrt(u * u + v * v);
    const direction = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
    sampledWind = { value: speed, direction };
  }

  const sampledPressure = sampleValueFromDecodedTiles(lat, lng, 'pressure_msl', timeOffsetHours, activeModel);
  const sampledRain = sampleValueFromDecodedTiles(lat, lng, 'precipitation', timeOffsetHours, activeModel);

  const liveWind = currentWeather;
  const rawWindSpeed = isLive && liveWind?.wind_speed_10m != null
    ? liveWind.wind_speed_10m : getClampedValue(wx.wind_speed_10m, currentHourIndex);
  const windSpeed = (activeLayer === 'wind' && sampledWind)
    ? sampledWind.value
    : getBiasAdjusted(rawWindSpeed, 'wind');

  const windDir = (activeLayer === 'wind' && sampledWind)
    ? sampledWind.direction
    : (isLive && liveWind?.wind_direction_10m != null
      ? liveWind.wind_direction_10m : getClampedValue(wx.wind_direction_10m, currentHourIndex));

  const rawWindGusts = isLive && liveWind?.wind_gusts_10m != null
    ? liveWind.wind_gusts_10m : getClampedValue(wx.wind_gusts_10m, currentHourIndex);
  const windGusts = getBiasAdjusted(rawWindGusts, 'wind_gusts');

  const precip = (activeLayer === 'rain' && sampledRain)
    ? sampledRain.value
    : getClampedValue(wx.precipitation, currentHourIndex);

  const snowfall = getClampedValue(wx.snowfall, currentHourIndex);
  const temp = getClampedValue(wx.temperature_2m, currentHourIndex);
  
  const pressure = (activeLayer === 'pressure' && sampledPressure)
    ? sampledPressure.value
    : (getClampedValue(wx.pressure_msl, currentHourIndex) ?? getClampedValue(wx.surface_pressure, currentHourIndex));

  const marineCurrent = marineData?.current || {};
  const rawWaveHeight = isLive && marineCurrent.wave_height != null ? marineCurrent.wave_height : getClampedValue(marine.wave_height, marineHourIndex);
  // v6.2: Exact-point is authoritative when valid. Fallbacks only when exact-point failed.
  const waveHeight = (activeLayer === 'waves' && useExactPoint?.wave_height != null)
    ? useExactPoint.wave_height
    : (activeLayer === 'waves' && sampledWaves)
      ? sampledWaves.value
      : (activeLayer === 'waves' && marineGridSample)
        ? marineGridSample.value
        : getBiasAdjusted(rawWaveHeight, 'wave');

  const wavePeriod = (activeLayer === 'waves' && useExactPoint?.wave_period != null && useExactPoint.wave_period > 0)
    ? useExactPoint.wave_period
    : (sampledWavePeriod && sampledWavePeriod.value > 0)
      ? sampledWavePeriod.value
      : (activeLayer === 'waves' && marineGridSample?.period > 0)
        ? marineGridSample.period
        : (isLive && marineCurrent.wave_period != null ? marineCurrent.wave_period : getClampedValue(marine.wave_period, marineHourIndex));
  
  const waveDir = (activeLayer === 'waves' && useExactPoint?.wave_direction != null)
    ? useExactPoint.wave_direction
    : (activeLayer === 'waves' && sampledWaves && sampledWaves.direction != null)
      ? sampledWaves.direction
      : (activeLayer === 'waves' && marineGridSample?.direction != null)
        ? marineGridSample.direction
        : (isLive && marineCurrent.wave_direction != null ? marineCurrent.wave_direction : getClampedValue(marine.wave_direction, marineHourIndex));
  
  // v5.9.3: Model capability gate for swell_1 — prevents cross-model leaks
  const swell1Supported = isLayerSupportedByModel(activeModel, 'swell_1');
  let swell1Height, swell1Period, swell1Dir;
  if (!swell1Supported) {
    // Model doesn't support swell_1 decomposition — force all values null
    swell1Height = null;
    swell1Period = null;
    swell1Dir = null;
  } else {
    const rawSwell1HeightRaw = isLive && marineCurrent.swell_wave_height != null ? marineCurrent.swell_wave_height : getClampedValue(marine.swell_wave_height, marineHourIndex);
    const rawSwell1Height = rawSwell1HeightRaw != null ? rawSwell1HeightRaw : null;
    swell1Height = (activeLayer === 'swell_1' && useExactPoint?.swell_wave_height != null)
      ? useExactPoint.swell_wave_height
      : (activeLayer === 'swell_1' && sampledSwell1)
        ? sampledSwell1.value
        : (activeLayer === 'swell_1' && marineGridSample)
          ? marineGridSample.value
          : getBiasAdjusted(rawSwell1Height, 'swell1');

    const rawSwell1Period = isLive && marineCurrent.swell_wave_period != null ? marineCurrent.swell_wave_period : getClampedValue(marine.swell_wave_period, marineHourIndex);
    swell1Period = (useExactPoint?.swell_wave_period != null && useExactPoint.swell_wave_period > 0)
      ? useExactPoint.swell_wave_period
      : (sampledSwell1Period && sampledSwell1Period.value > 0)
        ? sampledSwell1Period.value
        : (rawSwell1Period != null ? rawSwell1Period : null);

    const rawSwell1Dir = isLive && marineCurrent.swell_wave_direction != null ? marineCurrent.swell_wave_direction : getClampedValue(marine.swell_wave_direction, marineHourIndex);
    swell1Dir = (activeLayer === 'swell_1' && useExactPoint?.swell_wave_direction != null)
      ? useExactPoint.swell_wave_direction
      : (activeLayer === 'swell_1' && sampledSwell1 && sampledSwell1.direction != null)
        ? sampledSwell1.direction
        : (activeLayer === 'swell_1' && marineGridSample?.direction != null)
          ? marineGridSample.direction
          : (rawSwell1Dir != null ? rawSwell1Dir : null);
  }
  
  // v5.9.3: Model capability gate for swell_2
  const swell2Supported = isLayerSupportedByModel(activeModel, 'swell_2');
  let swell2Height, swell2Period, swell2Dir;
  const swell2ModelUnavailable = !swell2Supported;
  if (!swell2Supported) {
    swell2Height = null;
    swell2Period = null;
    swell2Dir = null;
  } else {
    const rawSwell2HeightRaw = getClampedValue(marine.secondary_swell_wave_height, marineHourIndex);
    const rawSwell2Height = rawSwell2HeightRaw != null ? rawSwell2HeightRaw : null;
    swell2Height = (activeLayer === 'swell_2' && useExactPoint?.secondary_swell_wave_height != null)
      ? useExactPoint.secondary_swell_wave_height
      : (activeLayer === 'swell_2' && sampledSwell2)
        ? sampledSwell2.value
        : (activeLayer === 'swell_2' && marineGridSample)
          ? marineGridSample.value
          : getBiasAdjusted(rawSwell2Height, 'swell2');

    const rawSwell2Period = getClampedValue(marine.secondary_swell_wave_period, marineHourIndex);
    swell2Period = (activeLayer === 'swell_2' && useExactPoint?.secondary_swell_wave_period != null && useExactPoint.secondary_swell_wave_period > 0)
      ? useExactPoint.secondary_swell_wave_period
      : (sampledSwell2Period && sampledSwell2Period.value > 0)
        ? sampledSwell2Period.value
        : (activeLayer === 'swell_2' && marineGridSample?.period > 0)
          ? marineGridSample.period
          : rawSwell2Period;

    swell2Dir = (activeLayer === 'swell_2' && useExactPoint?.secondary_swell_wave_direction != null)
      ? useExactPoint.secondary_swell_wave_direction
      : (activeLayer === 'swell_2' && sampledSwell2 && sampledSwell2.direction != null)
        ? sampledSwell2.direction
        : (activeLayer === 'swell_2' && marineGridSample?.direction != null)
          ? marineGridSample.direction
          : getClampedValue(marine.secondary_swell_wave_direction, marineHourIndex);
  }

  // Wind waves — only show real data from models that support it (GFS, ICON)
  const rawWindWaveHeight = getClampedValue(marine.wind_wave_height, marineHourIndex);
  const rawWindWavePeriod = getClampedValue(marine.wind_wave_period, marineHourIndex);
  const rawWindWaveDir = getClampedValue(marine.wind_wave_direction, marineHourIndex);

  // v5.9.2: Check if wind_waves is supported by the active model
  const windWavesSupported = isLayerSupportedByModel(activeModel, 'wind_waves');
  let windWaveHeight, windWavePeriod, windWaveDir;
  if (!windWavesSupported) {
    // Model doesn't support wind_wave decomposition — no fake data
    windWaveHeight = null;
    windWavePeriod = null;
    windWaveDir = null;
  } else if (activeLayer === 'wind_waves' && useExactPoint?.wind_wave_height != null) {
    windWaveHeight = useExactPoint.wind_wave_height;
    windWavePeriod = useExactPoint.wind_wave_period > 0 ? useExactPoint.wind_wave_period : rawWindWavePeriod;
    windWaveDir = useExactPoint.wind_wave_direction != null ? useExactPoint.wind_wave_direction : rawWindWaveDir;
  } else if (activeLayer === 'wind_waves' && sampledWindWaves) {
    windWaveHeight = sampledWindWaves.value;
    windWavePeriod = (sampledWindWavesPeriod && sampledWindWavesPeriod.value > 0) ? sampledWindWavesPeriod.value : rawWindWavePeriod;
    windWaveDir = sampledWindWaves.direction != null ? sampledWindWaves.direction : rawWindWaveDir;
  } else if (activeLayer === 'wind_waves' && marineGridSample) {
    windWaveHeight = marineGridSample.value;
    windWavePeriod = marineGridSample.period > 0 ? marineGridSample.period : rawWindWavePeriod;
    windWaveDir = marineGridSample.direction != null ? marineGridSample.direction : rawWindWaveDir;
  } else if (rawWindWaveHeight != null) {
    windWaveHeight = getBiasAdjusted(rawWindWaveHeight, 'wind_wave');
    windWavePeriod = (sampledWindWavesPeriod && sampledWindWavesPeriod.value > 0) ? sampledWindWavesPeriod.value : rawWindWavePeriod;
    windWaveDir = rawWindWaveDir;
  } else {
    windWaveHeight = null;
    windWavePeriod = null;
    windWaveDir = null;
  }
  const windWaveEstimated = false; // v5.9.2: No more estimation

  // v5.9.4: Display source diagnostic — tracks which data source won for each value.
  // Console: window.__MARINE_DISPLAY_SOURCE_DIAG__
  if (typeof window !== 'undefined' && isMarineLayer) {
    // v6.3: Split provider expectations — grid always open-meteo, exact-point EURO→copernicus
    const expectedGridProv = 'open-meteo';
    const expectedExactProv = activeModel === 'EURO' ? 'copernicus' : 'open-meteo';
    window.__MARINE_DISPLAY_SOURCE_DIAG__ = {
      activeModel, activeLayer, timeOffsetHours,
      selectedPoint: (lat != null) ? { lat, lng } : null,
      expectedGridProvider: expectedGridProv,
      expectedExactProvider: expectedExactProv,
      exactPointStatus,
      exactPointValid: isExactPointValid,
      exactPointBelongsTo: useExactPoint ? {
        lat: useExactPoint.requestedLat, lng: useExactPoint.requestedLng,
        model: useExactPoint.requestedModel, provider: useExactPoint.provider
      } : null,
      exactPointTimestamp: useExactPoint?.time || null,
      exactPointLayerValues: useExactPoint ? {
        wave_height: useExactPoint.wave_height, wave_period: useExactPoint.wave_period, wave_direction: useExactPoint.wave_direction,
        swell_wave_height: useExactPoint.swell_wave_height, swell_wave_period: useExactPoint.swell_wave_period, swell_wave_direction: useExactPoint.swell_wave_direction,
        secondary_swell_wave_height: useExactPoint.secondary_swell_wave_height, secondary_swell_wave_period: useExactPoint.secondary_swell_wave_period,
        wind_wave_height: useExactPoint.wind_wave_height, wind_wave_period: useExactPoint.wind_wave_period, wind_wave_direction: useExactPoint.wind_wave_direction
      } : null,
      gridSourceModel: window.__MARINE_WIND_DATA__?.__sourceModel || null,
      gridProvider: window.__MARINE_WIND_DATA__?.__provider || null,
      cacheProvider: marineData?.__provider || null,
      fallbackBlocked: blockFallbacks,
      fallbackBlockedReason: !isExactPointAuthority ? 'not_authority' : (exactPointStatus === 'loading' ? 'loading' : (exactPointStatus === 'success' && isExactPointValid ? 'exact_point_success' : null)),
      decodedTileUsed: !!(sampledWaves && !useExactPoint?.wave_height),
      decodedTileRejectReason: blockFallbacks ? 'exact_point_authority' : (activeModel === 'EURO' ? 'euro_blocked' : (!sampledWaves ? 'no_containing_tile' : null)),
      marineGridUsed: !!(marineGridSample && !useExactPoint?.wave_height && !sampledWaves),
      waveHeight: {
        value: waveHeight, source: (useExactPoint?.wave_height != null) ? 'exact_point' : sampledWaves ? 'decoded_tile' : marineGridSample ? 'marine_grid' : 'raw_hourly',
        finalDisplayedFt: mToFt(waveHeight)
      },
      wavePeriod: {
        value: wavePeriod, source: (useExactPoint?.wave_period != null && useExactPoint.wave_period > 0) ? 'exact_point' : (sampledWavePeriod?.value > 0) ? 'decoded_tile' : (marineGridSample?.period > 0) ? 'marine_grid' : 'raw_hourly'
      },
      waveDir: {
        value: waveDir, source: (useExactPoint?.wave_direction != null) ? 'exact_point' : (sampledWaves?.direction != null) ? 'decoded_tile' : (marineGridSample?.direction != null) ? 'marine_grid' : 'raw_hourly'
      },
      swell1Height: { value: swell1Height, source: swell1Supported ? ((useExactPoint?.swell_wave_height != null) ? 'exact_point' : sampledSwell1 ? 'decoded_tile' : marineGridSample ? 'marine_grid' : 'raw_hourly') : 'unsupported' },
      swell2Height: { value: swell2Height, source: swell2Supported ? ((useExactPoint?.secondary_swell_wave_height != null) ? 'exact_point' : sampledSwell2 ? 'decoded_tile' : marineGridSample ? 'marine_grid' : 'raw_hourly') : 'unsupported' },
      windWaveHeight: { value: windWaveHeight, source: windWavesSupported ? ((useExactPoint?.wind_wave_height != null) ? 'exact_point' : sampledWindWaves ? 'decoded_tile' : marineGridSample ? 'marine_grid' : 'raw_hourly') : 'unsupported' },
      timestamp: new Date().toISOString()
    };

    // v6.2: Active-layer specific value diagnostic
    const layerVarMap = {
      waves: { h: 'wave_height', p: 'wave_period', d: 'wave_direction' },
      swell_1: { h: 'swell_wave_height', p: 'swell_wave_period', d: 'swell_wave_direction' },
      swell_2: { h: 'secondary_swell_wave_height', p: 'secondary_swell_wave_period', d: 'secondary_swell_wave_direction' },
      wind_waves: { h: 'wind_wave_height', p: 'wind_wave_period', d: 'wind_wave_direction' }
    };
    const lv = layerVarMap[activeLayer];
    if (lv) {
      window.__MARINE_LAYER_VALUE_DIAG__ = {
        layer: activeLayer,
        exact: useExactPoint ? { height: useExactPoint[lv.h], period: useExactPoint[lv.p], direction: useExactPoint[lv.d] } : null,
        grid: marineGridSample ? { height: marineGridSample.value, period: marineGridSample.period, direction: marineGridSample.direction } : null,
        raw: {
          height: activeLayer === 'waves' ? rawWaveHeight : activeLayer === 'swell_1' ? getClampedValue(marine.swell_wave_height, marineHourIndex) : activeLayer === 'swell_2' ? getClampedValue(marine.secondary_swell_wave_height, marineHourIndex) : rawWindWaveHeight,
          period: activeLayer === 'waves' ? getClampedValue(marine.wave_period, marineHourIndex) : activeLayer === 'swell_1' ? getClampedValue(marine.swell_wave_period, marineHourIndex) : activeLayer === 'swell_2' ? getClampedValue(marine.secondary_swell_wave_period, marineHourIndex) : rawWindWavePeriod,
          direction: activeLayer === 'waves' ? getClampedValue(marine.wave_direction, marineHourIndex) : activeLayer === 'swell_1' ? getClampedValue(marine.swell_wave_direction, marineHourIndex) : activeLayer === 'swell_2' ? getClampedValue(marine.secondary_swell_wave_direction, marineHourIndex) : rawWindWaveDir
        },
        displayed: {
          height: activeLayer === 'waves' ? waveHeight : activeLayer === 'swell_1' ? swell1Height : activeLayer === 'swell_2' ? swell2Height : windWaveHeight,
          period: activeLayer === 'waves' ? wavePeriod : activeLayer === 'swell_1' ? swell1Period : activeLayer === 'swell_2' ? swell2Period : windWavePeriod,
          direction: activeLayer === 'waves' ? waveDir : activeLayer === 'swell_1' ? swell1Dir : activeLayer === 'swell_2' ? swell2Dir : windWaveDir,
          source: (useExactPoint?.[lv.h] != null) ? 'exact_point' : (marineGridSample) ? 'marine_grid' : 'raw_hourly'
        }
      };
    }
  }

  const cards = [];

  if (activeLayer === 'rain' || activeLayer === 'radar') {
    // Determine precip type from snowfall data and temperature
    const hasSnow = snowfall != null && snowfall > 0;
    const hasRain = precip != null && precip > 0 && (!hasSnow || (temp != null && temp > 2));
    const isSnowOnly = hasSnow && !hasRain;
    const isMixed = hasSnow && hasRain;
    const noPrecip = (precip == null || precip === 0) && (snowfall == null || snowfall === 0);

    if (noPrecip) {
      // No precip — show type hint from temperature
      const precipLabel = temp != null && temp <= 2 ? 'Snow' : 'Rain';
      const precipIcon = temp != null && temp <= 2 ? Snowflake : CloudRain;
      const precipColor = temp != null && temp <= 2 ? 'text-sky-300' : 'text-blue-400';
      cards.push({ icon: precipIcon, label: precipLabel, value: '0.0 mm/h', color: precipColor });
    } else if (isSnowOnly) {
      // Snow only
      cards.push({ icon: Snowflake, label: 'Snow', value: `${snowfall.toFixed(1)} cm/h`, color: 'text-sky-300' });
    } else if (isMixed) {
      // Mixed — show both rain and snow
      const rainAmount = precip != null ? Math.max(0, precip - (snowfall * 0.1)).toFixed(1) : '0.0';
      cards.push({ icon: CloudRain, label: 'Rain', value: `${rainAmount} mm/h`, color: 'text-blue-400' });
      cards.push({ icon: Snowflake, label: 'Snow', value: `${snowfall.toFixed(1)} cm/h`, color: 'text-sky-300' });
    } else {
      // Rain only
      cards.push({ icon: CloudRain, label: 'Rain', value: precip != null ? `${precip.toFixed(1)} mm/h` : '--', color: 'text-blue-400' });
    }
    cards.push({ icon: Droplets, label: 'Prob', value: getClampedValue(wx.precipitation_probability, currentHourIndex) != null ? `${getClampedValue(wx.precipitation_probability, currentHourIndex)}%` : '--', color: 'text-indigo-400' });
    if (temp != null) cards.push({ icon: Thermometer, label: 'Temp', value: `${Math.round(temp * 9/5 + 32)}°F`, color: 'text-amber-400' });
  }

  if (activeLayer === 'wind') {
    if (windSpeed != null) {
      const kts = windSpeed != null ? Math.round(windSpeed) : null;
      cards.push({ icon: Wind, label: isLive ? 'Live Wind' : 'Wind', value: kts != null ? `${kts} kts` : '--', color: 'text-teal-400' });
      if (windDir != null) cards.push({ icon: ArrowUp, label: degToCompass(windDir), value: `${Math.round(windDir)}`, color: 'text-teal-300', rotate: (windDir + 180) % 360 });
      if (windGusts != null) cards.push({ icon: Wind, label: 'Gusts', value: `${Math.round(windGusts)} kts`, color: 'text-orange-400' });
    } else {
      cards.push({ icon: Wind, label: 'Wind', value: isLoading ? 'Loading' : '--', color: 'text-gray-400' });
    }
  }

  if (activeLayer === 'pressure') {
    cards.push({ icon: Gauge, label: 'Pressure', value: pressure != null ? `${Math.round(pressure)} hPa` : '--', color: 'text-rose-400' });
  }

  if (activeLayer === 'waves') {
    const hFt = mToFt(waveHeight);
    cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : (blockFallbacks ? 'Loading...' : '--'), color: 'text-blue-300' });
    // v5.9: Waves layer shows the exact combined wave_period, NOT swell1Period override.
    if (wavePeriod != null) cards.push({ icon: Waves, label: 'Period', value: `${wavePeriod.toFixed(1)}s`, color: 'text-blue-200' });
    // v5.9 Task 4: Peak period shown separately and explicitly labeled
    if (useExactPoint?.wave_peak_period != null && useExactPoint.wave_peak_period > 0) {
      cards.push({ icon: Waves, label: 'Peak', value: `${useExactPoint.wave_peak_period.toFixed(1)}s`, color: 'text-blue-100' });
    }
    if (waveDir != null) cards.push({ icon: ArrowUp, label: degToCompass(waveDir), value: `${Math.round(waveDir)}`, color: 'text-blue-200', rotate: (waveDir + 180) % 360 });
  }

  if (activeLayer === 'swell_1') {
    // v5.9.2: Check model capability before showing component data
    const swell1Supported = isLayerSupportedByModel(activeModel, 'swell_1');
    if (!swell1Supported) {
      const modelLabel1 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Waves, label: 'Swell', value: 'N/A', color: 'text-cyan-400' });
      cards.push({ icon: Waves, label: modelLabel1, value: 'No data', color: 'text-gray-400' });
    } else {
      const swell1LowEnergy = swell1Height == null || swell1Height < 0.05;
      const hFt = mToFt(swell1Height);
      cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-cyan-400' });
      if (!swell1LowEnergy) {
        if (swell1Period != null && swell1Period > 0) cards.push({ icon: Waves, label: 'Period', value: `${swell1Period.toFixed(1)}s`, color: 'text-cyan-300' });
        if (useExactPoint?.swell_wave_peak_period != null && useExactPoint.swell_wave_peak_period > 0) {
          cards.push({ icon: Waves, label: 'Peak', value: `${useExactPoint.swell_wave_peak_period.toFixed(1)}s`, color: 'text-cyan-200' });
        }
        if (swell1Dir != null) cards.push({ icon: ArrowUp, label: degToCompass(swell1Dir), value: `${Math.round(swell1Dir)}`, color: 'text-cyan-200', rotate: (swell1Dir + 180) % 360 });
      } else {
        // v6.5: State-aware status. Strict null check (0.0 is valid Copernicus data).
        const gridHasData = isGridLayerSupported(activeModel, 'swell_1');
        const hasExactData = useExactPoint?.swell_wave_height != null; // strict null, not falsy
        if (exactPointStatus === 'loading') {
          cards.push({ icon: Waves, label: 'Status', value: 'Loading…', color: 'text-cyan-500' });
        } else if (!gridHasData && !hasExactData) {
          cards.push({ icon: Waves, label: 'Status', value: exactPointStatus === 'error' ? 'Unavailable' : 'No data', color: 'text-gray-500' });
        } else {
          cards.push({ icon: Waves, label: 'Status', value: 'Trace', color: 'text-gray-500' });
        }
      }
    }
  }

  if (activeLayer === 'swell_2') {
    // v5.9: Low-energy direction suppression threshold
    const swell2LowEnergy = swell2Height == null || swell2Height < 0.10;
    if (swell2ModelUnavailable) {
      // Model doesn't provide secondary swell — show informative message
      const modelLabel2 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Waves, label: 'Swell 2', value: 'N/A', color: 'text-purple-400' });
      cards.push({ icon: Waves, label: modelLabel2, value: 'No data', color: 'text-gray-400' });
    } else if (swell2LowEnergy) {
      const hFt = mToFt(swell2Height);
      cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '0.0 ft', color: 'text-purple-400' });
      // v6.5: State-aware status with strict null check
      const gridHasSwell2 = isGridLayerSupported(activeModel, 'swell_2');
      const hasExactS2 = useExactPoint?.secondary_swell_wave_height != null;
      if (exactPointStatus === 'loading') {
        cards.push({ icon: Waves, label: 'Status', value: 'Loading…', color: 'text-purple-500' });
      } else if (!gridHasSwell2 && !hasExactS2) {
        cards.push({ icon: Waves, label: 'Status', value: exactPointStatus === 'error' ? 'Unavailable' : 'No data', color: 'text-gray-500' });
      } else {
        cards.push({ icon: Waves, label: 'Status', value: 'Trace', color: 'text-gray-500' });
      }
    } else {
      const hFt = mToFt(swell2Height);
      cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-purple-400' });
      if (swell2Period != null && swell2Period > 0) cards.push({ icon: Waves, label: 'Period', value: `${swell2Period.toFixed(1)}s`, color: 'text-purple-300' });
      if (swell2Dir != null) cards.push({ icon: ArrowUp, label: degToCompass(swell2Dir), value: `${Math.round(swell2Dir)}`, color: 'text-purple-200', rotate: (swell2Dir + 180) % 360 });
    }
  }

  if (activeLayer === 'wind_waves') {
    // v5.9.2: Check model capability before showing component data
    if (!windWavesSupported) {
      const modelLabelWw = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Wind, label: 'Wind Waves', value: 'N/A', color: 'text-emerald-400' });
      cards.push({ icon: Wind, label: modelLabelWw, value: 'No data', color: 'text-gray-400' });
    } else {
      const windWaveLowEnergy = windWaveHeight == null || windWaveHeight < 0.05;
      const hFt = mToFt(windWaveHeight);
      cards.push({ icon: Wind, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-emerald-400' });
      if (!windWaveLowEnergy) {
        if (windWavePeriod != null && windWavePeriod > 0) cards.push({ icon: Wind, label: 'Period', value: `${windWavePeriod.toFixed(1)}s`, color: 'text-emerald-300' });
        if (windWaveDir != null) cards.push({ icon: ArrowUp, label: degToCompass(windWaveDir), value: `${Math.round(windWaveDir)}`, color: 'text-emerald-200', rotate: (windWaveDir + 180) % 360 });
      } else {
        // v6.5: State-aware status with strict null check
        const gridHasWW = isGridLayerSupported(activeModel, 'wind_waves');
        const hasExactWW = useExactPoint?.wind_wave_height != null;
        if (exactPointStatus === 'loading') {
          cards.push({ icon: Wind, label: 'Status', value: 'Loading…', color: 'text-emerald-500' });
        } else if (!gridHasWW && !hasExactWW) {
          cards.push({ icon: Wind, label: 'Status', value: exactPointStatus === 'error' ? 'Unavailable' : 'No data', color: 'text-gray-500' });
        } else {
          cards.push({ icon: Wind, label: 'Status', value: 'Trace', color: 'text-gray-500' });
        }
      }
    }
  }

  // v5.9: Period source chain diagnostics
  if (typeof window !== 'undefined') {
    const decodedTileSwell1P = sampledSwell1Period?.value ?? null;
    const decodedTileWaveP = sampledWavePeriod?.value ?? null;
    window.__MARINE_PERIOD_DIAG__ = {
      point: lat != null ? { lat, lng } : null,
      activeModel,
      activeLayer,
      timeOffsetHours,
      exactPoint: exactPoint ? {
        wave_height: exactPoint.wave_height, wave_period: exactPoint.wave_period, wave_direction: exactPoint.wave_direction,
        swell_wave_height: exactPoint.swell_wave_height, swell_wave_period: exactPoint.swell_wave_period, swell_wave_direction: exactPoint.swell_wave_direction,
        secondary_swell_wave_height: exactPoint.secondary_swell_wave_height, secondary_swell_wave_period: exactPoint.secondary_swell_wave_period, secondary_swell_wave_direction: exactPoint.secondary_swell_wave_direction,
        wind_wave_height: exactPoint.wind_wave_height, wind_wave_period: exactPoint.wind_wave_period, wind_wave_direction: exactPoint.wind_wave_direction,
        selectedTime: exactPoint.time, source: exactPoint.source
      } : null,
      decodedTileSample: { wavePeriod: decodedTileWaveP, swell1Period: decodedTileSwell1P },
      marineGridSample: marineGridSample ? { value: marineGridSample.value, period: marineGridSample.period, direction: marineGridSample.direction, source: marineGridSample.source } : null,
      rawHourlyFallback: { wavePeriod: getClampedValue(marine.wave_period, marineHourIndex), swell1Period: swell1Supported ? getClampedValue(marine.swell_wave_period, marineHourIndex) : null },
      displayedCards: cards.map(c => ({ label: c.label, value: c.value })),
      displayedPeriodSource: activeLayer === 'waves'
        ? (exactPoint?.wave_period != null && exactPoint.wave_period > 0 ? 'exactPoint.wave_period'
          : marineGridSample?.period > 0 ? 'marineGrid.period'
          : decodedTileWaveP > 0 ? 'decodedTile.wave_period'
          : 'rawHourly.wave_period')
        : activeLayer === 'swell_1'
          ? (exactPoint?.swell_wave_period > 0 ? 'exactPoint.swell_wave_period'
            : decodedTileSwell1P > 0 ? 'decodedTile.swell_wave_period'
            : 'rawHourly.swell_wave_period')
          : activeLayer,
      v59_fix: 'Waves layer no longer overrides wave_period with swell1Period; swell1Period now uses exactPoint first',
      lowEnergyThreshold: '0.10m for direction suppression',
      exactPointError: typeof window !== 'undefined' ? window.__MARINE_EXACT_POINT_ERROR__ : null
    };

    // v5.9.2: Model capability diagnostics — confirms no fake/synthetic component data
    window.__MARINE_MODEL_CAPABILITY_DIAG__ = {
      activeModel,
      capabilities: MARINE_MODEL_CAPABILITIES[activeModel] || null,
      layerSupport: {
        waves: isLayerSupportedByModel(activeModel, 'waves'),
        swell_1: isLayerSupportedByModel(activeModel, 'swell_1'),
        swell_2: isLayerSupportedByModel(activeModel, 'swell_2'),
        wind_waves: isLayerSupportedByModel(activeModel, 'wind_waves'),
      },
      displayedValues: {
        waveHeight, swell1Height, swell2Height, windWaveHeight,
        swell2ModelUnavailable,
        windWavesSupported,
      },
      truthContract: 'v6.4: Grid/ExactPoint capability split. No cross-model synthesis.',
    };

    // v6.5: EURO marine provider diagnostics — includes grid source metadata
    const gridMeta = marineData?.grid || {};
    window.__EURO_MARINE_PROVIDER_DIAG__ = {
      model: activeModel,
      activeLayer,
      gridProvider: gridMeta.__gridProvider || 'open-meteo',
      gridSupportsLayer: isGridLayerSupported(activeModel, activeLayer) || !!gridMeta.__gridSupportsLayer,
      exactPointProvider: activeModel === 'EURO' ? 'copernicus' : 'open-meteo',
      exactPointSupportsLayer: isLayerSupportedByModel(activeModel, activeLayer),
      exactPointStatus,
      exactPointValid: isExactPointValid,
      gridCapabilities: MARINE_GRID_CAPABILITIES[activeModel] || null,
      exactCapabilities: MARINE_EXACT_CAPABILITIES[activeModel] || null,
    };
  }

  if (cards.length === 0) return null;

  const modelLabel = { GFS: 'GFS', EURO: 'ECMWF', ICON: 'ICON' }[activeModel] || activeModel;

  // v163: Context-aware label — shows spot name, long-press coords, or time
  const forecastTimeLabel = (() => {
    if (selectedSpot?.name) return selectedSpot.name;
    if (longPressLocation) {
      const lat = longPressLocation.lat.toFixed(2);
      const lng = longPressLocation.lng.toFixed(2);
      return `${lat}°, ${lng}°`;
    }
    if (isLive) return 'Live Conditions';
    const d = new Date();
    d.setHours(d.getHours() + timeOffsetHours);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' });
  })();

  // v163: Show pin icon when displaying spot or long-press location
  const showPinIcon = !!(selectedSpot || longPressLocation);

  return (
    <div
      className={`absolute ${
        isImmersiveMode 
          ? (isTimelineCollapsed ? 'bottom-[80px]' : 'bottom-[170px]') 
          : (isTimelineCollapsed ? 'bottom-[140px]' : 'bottom-[230px]')
      } md:bottom-20 left-4 z-[900] rounded-xl border backdrop-blur-xl shadow-2xl ${bgClass} max-w-[200px] transition-all duration-300`}
      data-testid="forecast-overlay"
    >
      {/* Header */}
      <div 
        className={`px-3 pt-2 pb-1 border-b border-zinc-800/30 flex justify-between items-center cursor-pointer select-none transition-colors ${isCollapsed ? 'pb-2 border-transparent' : ''}`}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div>
          <div className={`text-[9px] uppercase tracking-wider font-bold ${textMuted} flex items-center gap-1`}>
            {showPinIcon && <MapPin className="w-2.5 h-2.5 text-cyan-400" />}
            {modelLabel} {isLive && !selectedSpot && !longPressLocation ? 'Live' : 'Forecast'}
          </div>
          <div className={`text-[10px] font-semibold ${textClass} truncate max-w-[160px]`}>
            {forecastTimeLabel}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 ml-3 ${textMuted} transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
      </div>

      {/* Data cards */}
      <div className={`overflow-hidden transition-all duration-300 ${isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[300px] opacity-100'}`}>
        <div className="px-3 py-2 space-y-1.5 border-t border-transparent">
          {isLockedForecast ? (
            <div className={`text-[11px] font-bold ${textMuted} flex items-center gap-1.5 py-1`}>
              <Lock className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-yellow-500">Premium Only</span>
            </div>
          ) : isLoading ? (
            <div className={`text-xs ${textMuted} flex items-center gap-2`}>
              <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
 Loading
            </div>
          ) : (
            cards.map((card, i) => {
              const Icon = card.icon;
              return (
                <div key={i} className="flex items-center gap-2">
                  <Icon
                    className={`w-3.5 h-3.5 ${card.color} shrink-0 inline-block`}
                    style={card.rotate ? { transform: `rotate(${card.rotate}deg)`, transformOrigin: 'center' } : undefined}
                  />
                  <span className={`text-[10px] ${textMuted} w-12`}>{card.label}</span>
                  <span className={`text-xs font-bold ${textClass}`}>{card.value}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default MapForecastOverlay;
