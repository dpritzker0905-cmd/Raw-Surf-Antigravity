import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Lock, ChevronDown, MapPin } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import {
  sampleFromMarineGrid,
  fetchExactMarinePoint,
  selectExactPointHour,
  sampleValueFromDecodedTiles,
  writeOverlayDiagnostics,
  mToFt,
  degToCompass,
  findHourIndex,
  getClampedValue,
  getBiasAdjusted
} from './forecastSamplers';
import { isLayerSupportedByModel, isGridLayerSupported, isInCooldown } from './marineControllerUtils';
import { compileForecastCards } from './forecastCardCompiler';

export var MapForecastOverlay = ({
  forecastData,
  marineData,
  renderMarineData,
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
  defaultSnappedLat = null,
  defaultSnappedLng = null,
}) => {
  const { theme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [exactPoint, setExactPoint] = useState(null);
  // v6.7: Exact-point status machine: idle | exact_loading | exact_success | exact_timeout | exact_backend_error | exact_empty | exact_stale_rejected
  const [exactPointStatus, setExactPointStatus] = useState('idle');
  const exactPointFetchRef = useRef(null);
  const isLight = theme === 'light';

  useEffect(() => {
    setIsCollapsed(isImmersiveMode);
  }, [isImmersiveMode]);

  // v5.7.2: Fetch exact-point marine data for selected/long-pressed location.
  // Caches the FULL multi-day response; hour selection happens at render time.
  const pointLat = selectedSpot?.latitude || longPressLocation?.lat || defaultSnappedLat;
  const pointLng = selectedSpot?.longitude || longPressLocation?.lng || defaultSnappedLng;
  const isMarineLayer = ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(activeLayer);
  const [exactPointResponse, setExactPointResponse] = useState(null);

  // v6.7: Clear stale exact-point state synchronously using refs instead of render-time setState.
  // This blocks the old state from leaking even for a single frame, preventing React hooks ordering crashes.
  const isEuroComponentLayer = activeModel === 'EURO' && ['swell_1', 'swell_2', 'wind_waves'].includes(activeLayer);
  const currentPointKey = `${pointLat ?? ''}_${pointLng ?? ''}_${activeModel}_${isEuroComponentLayer ? 'EURO_COMPONENTS' : activeLayer}`;
  const prevPointKeyRef = useRef(currentPointKey);
  const isStale = currentPointKey !== prevPointKeyRef.current;

  const effectiveExactPointResponse = isStale ? null : exactPointResponse;
  const effectiveExactPoint = isStale ? null : exactPoint;
  const effectiveExactPointStatus = (() => {
    if (isStale) {
      return (pointLat && pointLng && isMarineLayer ? 'exact_stale_rejected' : 'idle');
    }
    if (exactPointStatus === 'exact_success' && effectiveExactPoint?.status) {
      return effectiveExactPoint.status;
    }
    return exactPointStatus;
  })();

  // Decoupled refs to prevent high-frequency grid updates and timeline scrubbing from triggering redundant fetches
  const marineDataRef = useRef(marineData);
  useEffect(() => {
    marineDataRef.current = marineData;
  }, [marineData]);

  const timeOffsetHoursRef = useRef(timeOffsetHours);
  useEffect(() => {
    timeOffsetHoursRef.current = timeOffsetHours;
  }, [timeOffsetHours]);

  useEffect(() => {
    // Update the ref to currentPointKey inside the coordinate/model/layer-change useEffect
    prevPointKeyRef.current = currentPointKey;

    if (!pointLat || !pointLng || !isMarineLayer) {
      setExactPointResponse(null);
      setExactPoint(null);
      setExactPointStatus('idle');
      return;
    }

    const isUserExplicitSelection = !!(selectedSpot || longPressLocation);
    const hasGrid = marineDataRef.current?.grid?.vectors?.length > 0;

    // v7.0: Eager default snap request mitigation
    if (!isUserExplicitSelection && !hasGrid) {
      setExactPointResponse(null);
      setExactPoint(null);
      setExactPointStatus('idle');
      return;
    }

    // background/default snapped exact-point requests should be heavily throttled and never run while marine grid fetch is failing/cooling down
    if (!isUserExplicitSelection && typeof isInCooldown === 'function' && isInCooldown('marine')) {
      console.log("[Forecast] Suppressing background snap prewarm because marine fetch is cooling down/failing");
      setExactPointResponse(null);
      setExactPoint(null);
      setExactPointStatus('idle');
      return;
    }

    setExactPointResponse(null);
    setExactPoint(null);
    setExactPointStatus('exact_loading');

    // Debounce: cancel previous fetch
    if (exactPointFetchRef.current) exactPointFetchRef.current.cancelled = true;
    const token = { cancelled: false };
    exactPointFetchRef.current = token;

    const controller = new AbortController();
    const debounceTime = isUserExplicitSelection ? 200 : 3000;

    const timeoutId = setTimeout(() => {
      if (token.cancelled) return;

      const fetchTimeoutId = setTimeout(() => {
        controller.abort();
      }, 18000);

      fetchExactMarinePoint(pointLat, pointLng, activeModel, activeLayer, controller.signal, timeOffsetHoursRef.current).then(data => {
        clearTimeout(fetchTimeoutId);
        if (!token.cancelled) {
          if (data) {
            if (data.status === 'timeout') {
              setExactPointStatus('exact_timeout');
            } else if (data.status === 'error') {
              setExactPointStatus('exact_backend_error');
            } else if (data.status === 'empty') {
              setExactPointStatus('exact_empty');
            } else if (['copernicus_credentials_missing', 'copernicus_backend_502', 'copernicus_timeout', 'rate_limited'].includes(data.status)) {
              setExactPointStatus(data.status);
            } else {
              setExactPointResponse(data);
              setExactPointStatus('exact_success');
            }
          } else {
            setExactPointStatus('exact_backend_error');
          }
        }
      }).catch(err => {
        clearTimeout(fetchTimeoutId);
        if (!token.cancelled) {
          if (err.name === 'AbortError') {
            setExactPointStatus('exact_timeout');
          } else {
            setExactPointStatus('exact_backend_error');
          }
        }
      });
    }, debounceTime);

    return () => {
      token.cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [pointLat, pointLng, activeModel, isMarineLayer, currentPointKey, selectedSpot, longPressLocation]);

  // v5.7.2: Select the correct hour from cached response when timeline/layer changes.
  // This is synchronous and instant — no network request on scrub.
  useEffect(() => {
    if (!effectiveExactPointResponse) {
      setExactPoint(null);
      return;
    }
    const selected = selectExactPointHour(effectiveExactPointResponse, timeOffsetHours);
    setExactPoint(selected);

    // Enhanced diagnostic and Scrubber Truth logging
    if (selected) {
      const targetTs = Date.now() + timeOffsetHours * 3600000;
      const targetTimestamp = new Date(targetTs).toISOString();
      const selectedTimestamp = selected.time;
      const selectedHourIndex = selected.hourIndex;
      const provider = selected.provider;
      const returnedTimeRange = `${selected.timeRangeStart} to ${selected.timeRangeEnd}`;
      
      let sourceStr = 'exact_point_api';
      if (selected.status === 'exact_no_time_coverage') {
        sourceStr = 'no_coverage';
      }

      console.log(
        `%c[FORECAST SCRUBBER TRUTH] InfoBox Sync:\n` +
        `  - activeModel: ${activeModel}\n` +
        `  - activeLayer: ${activeLayer}\n` +
        `  - marker lat/lng: ${pointLat?.toFixed(4)}, ${pointLng?.toFixed(4)}\n` +
        `  - timeOffsetHours: ${timeOffsetHours}\n` +
        `  - targetTimestamp: ${targetTimestamp}\n` +
        `  - selectedTimestamp: ${selectedTimestamp}\n` +
        `  - selectedHourIndex: ${selectedHourIndex}\n` +
        `  - provider: ${provider}\n` +
        `  - returned time range: ${returnedTimeRange}\n` +
        `  - source: ${sourceStr}`,
        'color: #22c55e; font-weight: bold;'
      );

      if (typeof window !== 'undefined') {
        window.__MARINE_POINT_DIAG__ = {
          point: { lat: pointLat, lng: pointLng },
          activeModel, activeLayer, timeOffsetHours,
          targetTimestamp,
          requestedForecastDays: effectiveExactPointResponse.forecastDays,
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
          source: sourceStr,
          timestamp: new Date().toISOString()
        };
      }
    }
  }, [effectiveExactPointResponse, timeOffsetHours, activeLayer, activeModel, pointLat, pointLng]);

  const bgClass = isLight
    ? 'bg-white/90 border-gray-200'
    : 'bg-zinc-900/90 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-500' : 'text-gray-400';

  const currentHourIndex = useMemo(() => findHourIndex(forecastData?.hourly?.time, timeOffsetHours), [forecastData, timeOffsetHours]);
  const marineHourIndex = useMemo(() => findHourIndex(marineData?.hourly?.time, timeOffsetHours), [marineData, timeOffsetHours]);

  const wx = forecastData?.hourly || {};
  const marine = marineData?.hourly || {};
  const isLive = timeOffsetHours === 0;

  const getBiasAdjustedLocal = (val, variableType) => getBiasAdjusted(val, variableType, activeModel, timeOffsetHours);

  // --- Grid-Truth Synchronization Upgrade ---
  const lat = selectedSpot?.latitude || longPressLocation?.lat;
  const lng = selectedSpot?.longitude || longPressLocation?.lng;

  // v6.2: Validate exactPoint still matches current point/model.
  const isExactPointValid = (() => {
    if (!effectiveExactPoint) return false;
    if (effectiveExactPointStatus !== 'exact_success' && 
        effectiveExactPointStatus !== 'exact_stale_available' &&
        effectiveExactPointStatus !== 'exact_no_time_coverage' &&
        effectiveExactPointStatus !== 'euro_extended_estimate' &&
        effectiveExactPointStatus !== 'icon_extended_estimate') return false;
    // v6.6: Stricter coordinate check — reject if exactPoint was fetched for a different point
    const epLat = effectiveExactPoint.requestedLat;
    const epLng = effectiveExactPoint.requestedLng;
    if (epLat == null || epLng == null || pointLat == null || pointLng == null) return false;
    if (Math.abs(epLat - +pointLat.toFixed(2)) > 0.01 || Math.abs(epLng - +pointLng.toFixed(2)) > 0.01) {
      return false; // Coordinate mismatch — stale data from previous point
    }
    // Model check
    if (effectiveExactPoint.requestedModel !== activeModel) {
      return false;
    }
    // Provider check
    const expectedExactProv = activeModel === 'EURO' ? 'copernicus' : 'open-meteo';
    const isEstimated = effectiveExactPointStatus === 'euro_extended_estimate' || 
                        effectiveExactPointStatus === 'icon_extended_estimate' || 
                        effectiveExactPoint.provider === 'estimated';
    if (!isEstimated) {
      if (effectiveExactPoint.provider !== expectedExactProv && !(activeModel === 'EURO' && activeLayer === 'waves')) {
        return false;
      }
    }
    return true;
  })();

  const isExactPointLoading = ['exact_loading', 'exact_stale_rejected'].includes(effectiveExactPointStatus);
  const isExactPointTimeout = ['exact_timeout', 'copernicus_timeout'].includes(effectiveExactPointStatus);
  const isExactPointError = ['exact_backend_error', 'exact_empty', 'exact_error', 'error', 'copernicus_credentials_missing', 'copernicus_backend_502', 'rate_limited'].includes(effectiveExactPointStatus);

  // v6.6: For selected marine points, exact-point is THE authority.
  // Block ALL fallbacks while loading or if exact point is valid/success.
  const isUserExplicitSelection = !!(selectedSpot || longPressLocation);
  const isExactPointAuthority = isMarineLayer && isUserExplicitSelection && (pointLat != null) && (pointLng != null);
  
  // v6.9: Grid Fallback on Point Error: if exact point is loading, failed, timed out,
  // or has no coverage, but the visual/blended heatmap grid is valid, use the grid sample.
  const useExactPoint = isExactPointValid ? effectiveExactPoint : null;
  const useGridFallback = isExactPointAuthority && !useExactPoint && (isExactPointLoading || isExactPointTimeout || isExactPointError || effectiveExactPointStatus === 'exact_no_time_coverage');
  
  const blockFallbacks = isExactPointAuthority && !useGridFallback;

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
    : getBiasAdjustedLocal(rawWindSpeed, 'wind');

  const windDir = (activeLayer === 'wind' && sampledWind)
    ? sampledWind.direction
    : (isLive && liveWind?.wind_direction_10m != null
      ? liveWind.wind_direction_10m : getClampedValue(wx.wind_direction_10m, currentHourIndex));

  const rawWindGusts = isLive && liveWind?.wind_gusts_10m != null
    ? liveWind.wind_gusts_10m : getClampedValue(wx.wind_gusts_10m, currentHourIndex);
  const windGusts = getBiasAdjustedLocal(rawWindGusts, 'wind_gusts');

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
  // v6.6: Exact-point is authoritative when valid. Fallbacks only when exact-point failed.
  const waveHeight = isExactPointAuthority
    ? (useExactPoint?.wave_height ?? (useGridFallback && marineGridSample ? marineGridSample.value : null))
    : (activeLayer === 'waves' && sampledWaves)
      ? sampledWaves.value
      : (activeLayer === 'waves' && marineGridSample)
        ? marineGridSample.value
        : getBiasAdjustedLocal(rawWaveHeight, 'wave');

  const wavePeriod = isExactPointAuthority
    ? (useExactPoint?.wave_period > 0 ? useExactPoint.wave_period : (useGridFallback && marineGridSample?.period > 0 ? marineGridSample.period : null))
    : (sampledWavePeriod && sampledWavePeriod.value > 0)
      ? sampledWavePeriod.value
      : (activeLayer === 'waves' && marineGridSample?.period > 0)
        ? marineGridSample.period
        : (isLive && marineCurrent.wave_period != null ? marineCurrent.wave_period : getClampedValue(marine.wave_period, marineHourIndex));
  
  const waveDir = isExactPointAuthority
    ? (useExactPoint?.wave_direction ?? (useGridFallback && marineGridSample ? marineGridSample.direction : null))
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
    swell1Height = isExactPointAuthority
      ? (useExactPoint?.swell_wave_height ?? (useGridFallback && marineGridSample ? marineGridSample.value : null))
      : (activeLayer === 'swell_1' && sampledSwell1)
        ? sampledSwell1.value
        : (activeLayer === 'swell_1' && marineGridSample)
          ? marineGridSample.value
          : getBiasAdjustedLocal(rawSwell1Height, 'swell1');

    const rawSwell1Period = isLive && marineCurrent.swell_wave_period != null ? marineCurrent.swell_wave_period : getClampedValue(marine.swell_wave_period, marineHourIndex);
    swell1Period = isExactPointAuthority
      ? (useExactPoint?.swell_wave_period > 0 ? useExactPoint.swell_wave_period : (useGridFallback && marineGridSample?.period > 0 ? marineGridSample.period : null))
      : (sampledSwell1Period && sampledSwell1Period.value > 0)
        ? sampledSwell1Period.value
        : (rawSwell1Period != null ? rawSwell1Period : null);

    const rawSwell1Dir = isLive && marineCurrent.swell_wave_direction != null ? marineCurrent.swell_wave_direction : getClampedValue(marine.swell_wave_direction, marineHourIndex);
    swell1Dir = isExactPointAuthority
      ? (useExactPoint?.swell_wave_direction ?? (useGridFallback && marineGridSample ? marineGridSample.direction : null))
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
    swell2Height = isExactPointAuthority
      ? (useExactPoint?.secondary_swell_wave_height ?? (useGridFallback && marineGridSample ? marineGridSample.value : null))
      : (activeLayer === 'swell_2' && sampledSwell2)
        ? sampledSwell2.value
        : (activeLayer === 'swell_2' && marineGridSample)
          ? marineGridSample.value
          : getBiasAdjustedLocal(rawSwell2Height, 'swell2');

    const rawSwell2Period = getClampedValue(marine.secondary_swell_wave_period, marineHourIndex);
    swell2Period = isExactPointAuthority
      ? (useExactPoint?.secondary_swell_wave_period > 0 ? useExactPoint.secondary_swell_wave_period : (useGridFallback && marineGridSample?.period > 0 ? marineGridSample.period : null))
      : (sampledSwell2Period && sampledSwell2Period.value > 0)
        ? sampledSwell2Period.value
        : (activeLayer === 'swell_2' && marineGridSample?.period > 0)
          ? marineGridSample.period
          : rawSwell2Period;

    swell2Dir = isExactPointAuthority
      ? (useExactPoint?.secondary_swell_wave_direction ?? (useGridFallback && marineGridSample ? marineGridSample.direction : null))
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
  } else {
    windWaveHeight = isExactPointAuthority
      ? (useExactPoint?.wind_wave_height ?? (useGridFallback && marineGridSample ? marineGridSample.value : null))
      : (activeLayer === 'wind_waves' && sampledWindWaves)
        ? sampledWindWaves.value
        : (activeLayer === 'wind_waves' && marineGridSample)
          ? marineGridSample.value
          : (rawWindWaveHeight != null ? getBiasAdjustedLocal(rawWindWaveHeight, 'wind_wave') : null);

    windWavePeriod = isExactPointAuthority
      ? (useExactPoint?.wind_wave_period > 0 ? useExactPoint.wind_wave_period : (useGridFallback && marineGridSample?.period > 0 ? marineGridSample.period : null))
      : (sampledWindWavesPeriod && sampledWindWavesPeriod.value > 0)
        ? sampledWindWavesPeriod.value
        : (activeLayer === 'wind_waves' && marineGridSample?.period > 0)
          ? marineGridSample.period
          : rawWindWavePeriod;

    windWaveDir = isExactPointAuthority
      ? (useExactPoint?.wind_wave_direction ?? (useGridFallback && marineGridSample ? marineGridSample.direction : null))
      : (activeLayer === 'wind_waves' && sampledWindWaves && sampledWindWaves.direction != null)
        ? sampledWindWaves.direction
        : (activeLayer === 'wind_waves' && marineGridSample?.direction != null)
          ? marineGridSample.direction
          : rawWindWaveDir;
  }
  const windWaveEstimated = false; // v5.9.2: No more estimation



  const cards = compileForecastCards({
    activeLayer,
    activeModel,
    timeOffsetHours,
    isLive,
    currentHourIndex,
    marineHourIndex,
    wx,
    marine,
    currentWeather,
    isExactPointAuthority,
    isExactPointLoading,
    isExactPointTimeout,
    isExactPointError,
    exactPointStatus: effectiveExactPointStatus,
    useExactPoint,
    waveHeight,
    wavePeriod,
    waveDir,
    swell1Supported,
    swell1Height,
    swell1Period,
    swell1Dir,
    swell2ModelUnavailable,
    swell2Supported,
    swell2Height,
    swell2Period,
    swell2Dir,
    windWavesSupported,
    windWaveHeight,
    windWavePeriod,
    windWaveDir,
    snowfall,
    temp,
    precip,
    windSpeed,
    windDir,
    windGusts,
    pressure,
    sampledWind,
    sampledRain,
    sampledPressure,
    mToFt,
    degToCompass,
    getClampedValue,
    getBiasAdjustedLocal,
    isLoading
  });

  // v6.6: Console forensic log on activation / load
  useEffect(() => {
    if (isMarineLayer && pointLat && pointLng) {
      console.log(`%c[Forensic Audit] Infobox display data source for ${activeLayer} (Model: ${activeModel})`, 'color: #06b6d4; font-weight: bold;');
      console.log(`Coords: ${pointLat.toFixed(4)}, ${pointLng.toFixed(4)} | Status: ${effectiveExactPointStatus}`);
      if (effectiveExactPointStatus === 'exact_success' && effectiveExactPoint) {
        console.table({
          height: { displayedValue: cards.find(c => c.label === 'Height')?.value, isAuthoritative: isExactPointAuthority, source: 'exact_point_api' },
          period: { displayedValue: cards.find(c => c.label === 'Period')?.value, isAuthoritative: isExactPointAuthority, source: 'exact_point_api' },
          direction: { displayedValue: cards.find(c => c.label === 'Dir' || c.label === degToCompass(waveDir || swell1Dir || swell2Dir || windWaveDir))?.value, isAuthoritative: isExactPointAuthority, source: 'exact_point_api' }
        });
      } else if (effectiveExactPointStatus === 'exact_loading') {
        console.log('[Forensic Audit] Exact point is loading — fallbacks blocked.');
      } else {
        console.log(`[Forensic Audit] Exact point failed/unavailable: ${effectiveExactPointStatus}`);
      }
    }
  }, [pointLat, pointLng, activeModel, activeLayer, effectiveExactPointStatus, effectiveExactPoint]);

  // v6.6: Call external diagnostics helper to keep component extremely lightweight
  if (typeof window !== 'undefined') {
    writeOverlayDiagnostics({
      lat, lng, activeModel, activeLayer, timeOffsetHours, exactPoint: effectiveExactPoint,
      sampledSwell1Period, sampledWavePeriod, marineGridSample, marine,
      marineHourIndex, swell1Supported, cards, waveHeight, swell1Height,
      swell2Height, windWaveHeight, swell2ModelUnavailable, windWavesSupported,
      marineData: renderMarineData,
      exactPointStatus: effectiveExactPointStatus, isExactPointValid, wavePeriod, waveDir,
      swell1Dir, swell2Dir, windWaveDir, blockFallbacks, isExactPointAuthority,
      sampledWaves, sampledSwell1, sampledSwell2, sampledWindWaves,
      sampledSwell2Period, sampledWindWavesPeriod, useExactPoint,
      rawWaveHeight, mToFt, degToCompass,
      currentHourIndex, wx, exactPointResponse: effectiveExactPointResponse
    });
  }

  const heatmapStatus = useMemo(() => {
    if (activeModel !== 'EURO' || !['swell_1', 'swell_2', 'wind_waves'].includes(activeLayer)) {
      return null;
    }
    
    const webglDiag = typeof window !== 'undefined' ? window.__WebGLMarineLayer_DIAG__ : null;
    const isWebGLRendered = webglDiag?.renderedProvider === 'copernicus' && 
                            webglDiag?.activeMarineLayer === activeLayer && 
                            webglDiag?.componentLayer === activeLayer &&
                            webglDiag?.renderedVectorCount > 0 &&
                            webglDiag?.renderedNonzeroCount > 0;

    if (isWebGLRendered) {
      return 'ready';
    }
    
    // Check if the backend request skipped/failed
    const diag = typeof window !== 'undefined' ? window.__COPERNICUS_GRID_DIAG__ : null;
    if (diag && diag.layer === activeLayer && diag.skipped) {
      if (diag.skippedReason === 'copernicus_no_nonzero_vectors' || diag.skippedReason === 'no_nonzero_vectors') {
        return 'copernicus_no_nonzero_vectors';
      }
      return diag.skippedReason || 'unavailable';
    }
    
    return 'loading';
  }, [renderMarineData, activeModel, activeLayer]);

  if (!forecastData && !marineData && !isLoading) return null;
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
            <>
              {cards.map((card, i) => {
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
              })}
              {heatmapStatus === 'loading' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-cyan-400 font-semibold flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  <span>Heatmap Loading...</span>
                </div>
              )}
              {heatmapStatus === 'ready' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-emerald-400 font-semibold flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-emerald-400" />
                  <span>Heatmap Ready (CMEMS)</span>
                </div>
              )}
              {heatmapStatus === 'zoom_too_low' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-amber-400 font-semibold flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>Zoom In for Heatmap</span>
                </div>
              )}
              {heatmapStatus === 'copernicus_credentials_missing' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-rose-400 font-semibold flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-rose-400" />
                  <span>Config Error (Credentials)</span>
                </div>
              )}
              {heatmapStatus === 'copernicus_backend_502' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-rose-400 font-semibold flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-rose-400" />
                  <span>Heatmap Backend Error (502)</span>
                </div>
              )}
              {heatmapStatus === 'copernicus_timeout' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-rose-400 font-semibold flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-rose-400" />
                  <span>Heatmap Timeout</span>
                </div>
              )}
              {heatmapStatus === 'copernicus_empty_time_range' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-rose-400 font-semibold flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-rose-400" />
                  <span>Out of Time Range</span>
                </div>
              )}
              {heatmapStatus === 'copernicus_no_nonzero_vectors' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-amber-400 font-semibold flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>Calm/Zero Data (No Waves)</span>
                </div>
              )}
              {heatmapStatus === 'unavailable' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-rose-400 font-semibold flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-rose-400" />
                  <span>Heatmap Error/Timeout</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MapForecastOverlay;
