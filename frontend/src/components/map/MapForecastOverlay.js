import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Wind, Waves, CloudRain, Snowflake, ArrowUp, Droplets, Gauge, Lock, ChevronDown, MapPin, Thermometer } from 'lucide-react';
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
import { isLayerSupportedByModel, isGridLayerSupported } from './marineControllerUtils';

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

  // v6.6: Clear stale exact-point state synchronously during render when active coordinates/model/layer change.
  // This blocks the old state from leaking even for a single frame.
  const currentPointKey = `${pointLat ?? ''}_${pointLng ?? ''}_${activeModel}_${activeLayer}`;
  const [prevPointKey, setPrevPointKey] = useState(currentPointKey);
  const isStale = currentPointKey !== prevPointKey;

  if (isStale) {
    setPrevPointKey(currentPointKey);
    setExactPointResponse(null);
    setExactPoint(null);
    setExactPointStatus(pointLat && pointLng && isMarineLayer ? 'loading' : 'idle');
  }

  const effectiveExactPointResponse = isStale ? null : exactPointResponse;
  const effectiveExactPoint = isStale ? null : exactPoint;
  const effectiveExactPointStatus = isStale
    ? (pointLat && pointLng && isMarineLayer ? 'loading' : 'idle')
    : exactPointStatus;

  useEffect(() => {
    if (!pointLat || !pointLng || !isMarineLayer) {
      setExactPointResponse(null);
      setExactPoint(null);
      setExactPointStatus('idle');
      return;
    }
    // Synchronously cleared during render, but keep inside effect for safety
    setExactPointResponse(null);
    setExactPoint(null);
    setExactPointStatus('loading');

    // Debounce: cancel previous fetch
    if (exactPointFetchRef.current) exactPointFetchRef.current.cancelled = true;
    const token = { cancelled: false };
    exactPointFetchRef.current = token;

    // v5.7.2: Fetch by lat/lng/model only (not hourOffset).
    // Caches the full response.
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
    if (!effectiveExactPointResponse) {
      setExactPoint(null);
      return;
    }
    const selected = selectExactPointHour(effectiveExactPointResponse, timeOffsetHours);
    setExactPoint(selected);
    // Enhanced diagnostic
    if (typeof window !== 'undefined' && selected) {
      const targetTimestamp = new Date(Date.now() + timeOffsetHours * 3600000).toISOString();
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
        source: 'exact_point_api',
        timestamp: new Date().toISOString()
      };
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
  // Prevents stale data from a previous coordinate or model from being used.
  const isExactPointValid = (() => {
    if (!effectiveExactPoint) return false;
    if (effectiveExactPointStatus !== 'success') return false;
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
    if (effectiveExactPoint.provider !== expectedExactProv) {
      return false;
    }
    return true;
  })();

  // v6.6: For selected marine points, exact-point is THE authority.
  // Block ALL fallbacks while loading or if exact point is valid/success.
  const isExactPointAuthority = isMarineLayer && (pointLat != null) && (pointLng != null);
  const blockFallbacks = isExactPointAuthority;
  const useExactPoint = isExactPointValid ? effectiveExactPoint : null;

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
    ? useExactPoint?.wave_height
    : (activeLayer === 'waves' && sampledWaves)
      ? sampledWaves.value
      : (activeLayer === 'waves' && marineGridSample)
        ? marineGridSample.value
        : getBiasAdjustedLocal(rawWaveHeight, 'wave');

  const wavePeriod = isExactPointAuthority
    ? (useExactPoint?.wave_period > 0 ? useExactPoint.wave_period : null)
    : (sampledWavePeriod && sampledWavePeriod.value > 0)
      ? sampledWavePeriod.value
      : (activeLayer === 'waves' && marineGridSample?.period > 0)
        ? marineGridSample.period
        : (isLive && marineCurrent.wave_period != null ? marineCurrent.wave_period : getClampedValue(marine.wave_period, marineHourIndex));
  
  const waveDir = isExactPointAuthority
    ? useExactPoint?.wave_direction
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
      ? useExactPoint?.swell_wave_height
      : (activeLayer === 'swell_1' && sampledSwell1)
        ? sampledSwell1.value
        : (activeLayer === 'swell_1' && marineGridSample)
          ? marineGridSample.value
          : getBiasAdjustedLocal(rawSwell1Height, 'swell1');

    const rawSwell1Period = isLive && marineCurrent.swell_wave_period != null ? marineCurrent.swell_wave_period : getClampedValue(marine.swell_wave_period, marineHourIndex);
    swell1Period = isExactPointAuthority
      ? (useExactPoint?.swell_wave_period > 0 ? useExactPoint.swell_wave_period : null)
      : (sampledSwell1Period && sampledSwell1Period.value > 0)
        ? sampledSwell1Period.value
        : (rawSwell1Period != null ? rawSwell1Period : null);

    const rawSwell1Dir = isLive && marineCurrent.swell_wave_direction != null ? marineCurrent.swell_wave_direction : getClampedValue(marine.swell_wave_direction, marineHourIndex);
    swell1Dir = isExactPointAuthority
      ? useExactPoint?.swell_wave_direction
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
      ? useExactPoint?.secondary_swell_wave_height
      : (activeLayer === 'swell_2' && sampledSwell2)
        ? sampledSwell2.value
        : (activeLayer === 'swell_2' && marineGridSample)
          ? marineGridSample.value
          : getBiasAdjustedLocal(rawSwell2Height, 'swell2');

    const rawSwell2Period = getClampedValue(marine.secondary_swell_wave_period, marineHourIndex);
    swell2Period = isExactPointAuthority
      ? (useExactPoint?.secondary_swell_wave_period > 0 ? useExactPoint.secondary_swell_wave_period : null)
      : (sampledSwell2Period && sampledSwell2Period.value > 0)
        ? sampledSwell2Period.value
        : (activeLayer === 'swell_2' && marineGridSample?.period > 0)
          ? marineGridSample.period
          : rawSwell2Period;

    swell2Dir = isExactPointAuthority
      ? useExactPoint?.secondary_swell_wave_direction
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
      ? useExactPoint?.wind_wave_height
      : (activeLayer === 'wind_waves' && sampledWindWaves)
        ? sampledWindWaves.value
        : (activeLayer === 'wind_waves' && marineGridSample)
          ? marineGridSample.value
          : (rawWindWaveHeight != null ? getBiasAdjustedLocal(rawWindWaveHeight, 'wind_wave') : null);

    windWavePeriod = isExactPointAuthority
      ? (useExactPoint?.wind_wave_period > 0 ? useExactPoint.wind_wave_period : null)
      : (sampledWindWavesPeriod && sampledWindWavesPeriod.value > 0)
        ? sampledWindWavesPeriod.value
        : (activeLayer === 'wind_waves' && marineGridSample?.period > 0)
          ? marineGridSample.period
          : rawWindWavePeriod;

    windWaveDir = isExactPointAuthority
      ? useExactPoint?.wind_wave_direction
      : (activeLayer === 'wind_waves' && sampledWindWaves && sampledWindWaves.direction != null)
        ? sampledWindWaves.direction
        : (activeLayer === 'wind_waves' && marineGridSample?.direction != null)
          ? marineGridSample.direction
          : rawWindWaveDir;
  }
  const windWaveEstimated = false; // v5.9.2: No more estimation



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
    let displayHeight = '--';
    let displayPeriod = '--';
    let displayPeak = null;
    let displayDir = '--';
    let displayCompass = '';

    if (isExactPointAuthority && effectiveExactPointStatus === 'loading') {
      displayHeight = 'Loading...';
      displayPeriod = 'Loading...';
      displayDir = 'Loading...';
    } else if (isExactPointAuthority && effectiveExactPointStatus === 'error') {
      displayHeight = 'Unavailable';
      displayPeriod = 'Unavailable';
      displayDir = 'Unavailable';
    } else {
      const hFt = mToFt(waveHeight);
      displayHeight = hFt != null ? `${hFt} ft` : '--';
      if (wavePeriod != null) displayPeriod = `${wavePeriod.toFixed(1)}s`;
      if (useExactPoint?.wave_peak_period != null && useExactPoint.wave_peak_period > 0) {
        displayPeak = `${useExactPoint.wave_peak_period.toFixed(1)}s`;
      }
      if (waveDir != null) {
        displayDir = `${Math.round(waveDir)}`;
        displayCompass = degToCompass(waveDir);
      }
    }

    cards.push({ icon: Waves, label: 'Height', value: displayHeight, color: 'text-blue-300' });
    if (displayPeriod !== '--' || displayHeight === 'Loading...' || displayHeight === 'Unavailable') {
      cards.push({ icon: Waves, label: 'Period', value: displayPeriod, color: 'text-blue-200' });
    }
    if (displayPeak) {
      cards.push({ icon: Waves, label: 'Peak', value: displayPeak, color: 'text-blue-100' });
    }
    if (displayDir !== '--' || displayHeight === 'Loading...' || displayHeight === 'Unavailable') {
      cards.push({ icon: ArrowUp, label: displayCompass || 'Dir', value: displayDir, color: 'text-blue-200', rotate: waveDir != null ? (waveDir + 180) % 360 : undefined });
    }
  }

  if (activeLayer === 'swell_1') {
    // v5.9.2: Check model capability before showing component data
    const swell1Supported = isLayerSupportedByModel(activeModel, 'swell_1');
    if (!swell1Supported) {
      const modelLabel1 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Waves, label: 'Swell', value: 'N/A', color: 'text-cyan-400' });
      cards.push({ icon: Waves, label: modelLabel1, value: 'No data', color: 'text-gray-400' });
    } else {
      let displayHeight = '--';
      let displayPeriod = '--';
      let displayPeak = null;
      let displayDir = '--';
      let displayCompass = '';
      let showStatus = null;
      let statusColor = 'text-gray-500';

      if (isExactPointAuthority && effectiveExactPointStatus === 'loading') {
        displayHeight = 'Loading...';
        displayPeriod = 'Loading...';
        displayDir = 'Loading...';
      } else if (isExactPointAuthority && effectiveExactPointStatus === 'error') {
        displayHeight = 'Unavailable';
        displayPeriod = 'Unavailable';
        displayDir = 'Unavailable';
      } else {
        const swell1LowEnergy = swell1Height == null || swell1Height < 0.05;
        const hFt = mToFt(swell1Height);
        displayHeight = hFt != null ? `${hFt} ft` : '--';
        if (!swell1LowEnergy) {
          if (swell1Period != null && swell1Period > 0) displayPeriod = `${swell1Period.toFixed(1)}s`;
          if (useExactPoint?.swell_wave_peak_period != null && useExactPoint.swell_wave_peak_period > 0) {
            displayPeak = `${useExactPoint.swell_wave_peak_period.toFixed(1)}s`;
          }
          if (swell1Dir != null) {
            displayDir = `${Math.round(swell1Dir)}`;
            displayCompass = degToCompass(swell1Dir);
          }
        } else {
          // v6.5: State-aware status. Strict null check (0.0 is valid Copernicus data).
          const gridHasData = isGridLayerSupported(activeModel, 'swell_1');
          const hasExactData = useExactPoint?.swell_wave_height != null; // strict null, not falsy
          if (!gridHasData && !hasExactData) {
            showStatus = 'No data';
          } else {
            showStatus = 'Trace';
          }
        }
      }

      cards.push({ icon: Waves, label: 'Height', value: displayHeight, color: 'text-cyan-400' });
      if (showStatus) {
        cards.push({ icon: Waves, label: 'Status', value: showStatus, color: statusColor });
      } else {
        if (displayPeriod !== '--' || displayHeight === 'Loading...' || displayHeight === 'Unavailable') {
          cards.push({ icon: Waves, label: 'Period', value: displayPeriod, color: 'text-cyan-300' });
        }
        if (displayPeak) {
          cards.push({ icon: Waves, label: 'Peak', value: displayPeak, color: 'text-cyan-200' });
        }
        if (displayDir !== '--' || displayHeight === 'Loading...' || displayHeight === 'Unavailable') {
          cards.push({ icon: ArrowUp, label: displayCompass || 'Dir', value: displayDir, color: 'text-cyan-200', rotate: swell1Dir != null ? (swell1Dir + 180) % 360 : undefined });
        }
      }
    }
  }

  if (activeLayer === 'swell_2') {
    if (swell2ModelUnavailable) {
      // Model doesn't provide secondary swell — show informative message
      const modelLabel2 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Waves, label: 'Swell 2', value: 'N/A', color: 'text-purple-400' });
      cards.push({ icon: Waves, label: modelLabel2, value: 'No data', color: 'text-gray-400' });
    } else {
      let displayHeight = '--';
      let displayPeriod = '--';
      let displayDir = '--';
      let displayCompass = '';
      let showStatus = null;
      let statusColor = 'text-gray-500';

      if (isExactPointAuthority && effectiveExactPointStatus === 'loading') {
        displayHeight = 'Loading...';
        displayPeriod = 'Loading...';
        displayDir = 'Loading...';
      } else if (isExactPointAuthority && effectiveExactPointStatus === 'error') {
        displayHeight = 'Unavailable';
        displayPeriod = 'Unavailable';
        displayDir = 'Unavailable';
      } else {
        const swell2LowEnergy = swell2Height == null || swell2Height < 0.10;
        const hFt = mToFt(swell2Height);
        displayHeight = hFt != null ? `${hFt} ft` : '--';
        if (!swell2LowEnergy) {
          if (swell2Period != null && swell2Period > 0) displayPeriod = `${swell2Period.toFixed(1)}s`;
          if (swell2Dir != null) {
            displayDir = `${Math.round(swell2Dir)}`;
            displayCompass = degToCompass(swell2Dir);
          }
        } else {
          // v6.5: State-aware status with strict null check
          const gridHasSwell2 = isGridLayerSupported(activeModel, 'swell_2');
          const hasExactS2 = useExactPoint?.secondary_swell_wave_height != null;
          if (!gridHasSwell2 && !hasExactS2) {
            showStatus = 'No data';
          } else {
            showStatus = 'Trace';
          }
        }
      }

      cards.push({ icon: Waves, label: 'Height', value: displayHeight, color: 'text-purple-400' });
      if (showStatus) {
        cards.push({ icon: Waves, label: 'Status', value: showStatus, color: statusColor });
      } else {
        if (displayPeriod !== '--' || displayHeight === 'Loading...' || displayHeight === 'Unavailable') {
          cards.push({ icon: Waves, label: 'Period', value: displayPeriod, color: 'text-purple-300' });
        }
        if (displayDir !== '--' || displayHeight === 'Loading...' || displayHeight === 'Unavailable') {
          cards.push({ icon: ArrowUp, label: displayCompass || 'Dir', value: displayDir, color: 'text-purple-200', rotate: swell2Dir != null ? (swell2Dir + 180) % 360 : undefined });
        }
      }
    }
  }

  if (activeLayer === 'wind_waves') {
    // v5.9.2: Check model capability before showing component data
    if (!windWavesSupported) {
      const modelLabelWw = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Wind, label: 'Wind Waves', value: 'N/A', color: 'text-emerald-400' });
      cards.push({ icon: Wind, label: modelLabelWw, value: 'No data', color: 'text-gray-400' });
    } else {
      let displayHeight = '--';
      let displayPeriod = '--';
      let displayDir = '--';
      let displayCompass = '';
      let showStatus = null;
      let statusColor = 'text-gray-500';

      if (isExactPointAuthority && effectiveExactPointStatus === 'loading') {
        displayHeight = 'Loading...';
        displayPeriod = 'Loading...';
        displayDir = 'Loading...';
      } else if (isExactPointAuthority && effectiveExactPointStatus === 'error') {
        displayHeight = 'Unavailable';
        displayPeriod = 'Unavailable';
        displayDir = 'Unavailable';
      } else {
        const windWaveLowEnergy = windWaveHeight == null || windWaveHeight < 0.05;
        const hFt = mToFt(windWaveHeight);
        displayHeight = hFt != null ? `${hFt} ft` : '--';
        if (!windWaveLowEnergy) {
          if (windWavePeriod != null && windWavePeriod > 0) displayPeriod = `${windWavePeriod.toFixed(1)}s`;
          if (windWaveDir != null) {
            displayDir = `${Math.round(windWaveDir)}`;
            displayCompass = degToCompass(windWaveDir);
          }
        } else {
          // v6.5: State-aware status with strict null check
          const gridHasWW = isGridLayerSupported(activeModel, 'wind_waves');
          const hasExactWW = useExactPoint?.wind_wave_height != null;
          if (!gridHasWW && !hasExactWW) {
            showStatus = 'No data';
          } else {
            showStatus = 'Trace';
          }
        }
      }

      cards.push({ icon: Wind, label: 'Height', value: displayHeight, color: 'text-emerald-400' });
      if (showStatus) {
        cards.push({ icon: Wind, label: 'Status', value: showStatus, color: statusColor });
      } else {
        if (displayPeriod !== '--' || displayHeight === 'Loading...' || displayHeight === 'Unavailable') {
          cards.push({ icon: Wind, label: 'Period', value: displayPeriod, color: 'text-emerald-300' });
        }
        if (displayDir !== '--' || displayHeight === 'Loading...' || displayHeight === 'Unavailable') {
          cards.push({ icon: ArrowUp, label: displayCompass || 'Dir', value: displayDir, color: 'text-emerald-200', rotate: windWaveDir != null ? (windWaveDir + 180) % 360 : undefined });
        }
      }
    }
  }

  // v6.6: Console forensic log on activation / load
  useEffect(() => {
    if (isMarineLayer && pointLat && pointLng) {
      console.log(`%c[Forensic Audit] Infobox display data source for ${activeLayer} (Model: ${activeModel})`, 'color: #06b6d4; font-weight: bold;');
      console.log(`Coords: ${pointLat.toFixed(4)}, ${pointLng.toFixed(4)} | Status: ${effectiveExactPointStatus}`);
      if (effectiveExactPointStatus === 'success' && effectiveExactPoint) {
        console.table({
          height: { displayedValue: cards.find(c => c.label === 'Height')?.value, isAuthoritative: isExactPointAuthority, source: 'exact_point_api' },
          period: { displayedValue: cards.find(c => c.label === 'Period')?.value, isAuthoritative: isExactPointAuthority, source: 'exact_point_api' },
          direction: { displayedValue: cards.find(c => c.label === 'Dir' || c.label === degToCompass(waveDir || swell1Dir || swell2Dir || windWaveDir))?.value, isAuthoritative: isExactPointAuthority, source: 'exact_point_api' }
        });
      } else if (effectiveExactPointStatus === 'loading') {
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
      marineData, exactPointStatus: effectiveExactPointStatus, isExactPointValid, wavePeriod, waveDir,
      swell1Dir, swell2Dir, windWaveDir, blockFallbacks, isExactPointAuthority,
      sampledWaves, sampledSwell1, sampledSwell2, sampledWindWaves,
      sampledSwell2Period, sampledWindWavesPeriod, useExactPoint,
      rawWaveHeight, mToFt, degToCompass,
      currentHourIndex, wx
    });
  }

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
