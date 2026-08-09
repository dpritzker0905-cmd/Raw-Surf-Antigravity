import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Lock, ChevronDown, MapPin, Check, Info, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { getHeightUnit } from './heightUnits';
import { describeLayerSubstitution, describeStaleHour } from './modelProvenance';
import { resolveDisplayedSlot } from './decodedOmSampler';
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
  getBiasAdjusted,
  hasCacheForModel
} from './forecastSamplers';
import { isLayerSupportedByModel, isGridLayerSupported, isInCooldown } from './marineControllerUtils';
import { getSurfModeFlag } from './backendWeatherServiceClient';
import { compileForecastCards, STATUS_RENDERS } from './forecastCardCompiler';
import { sampleDecodedOmValue } from './decodedOmSampler';
import { computeSurfRating } from './surfRating';
import { computeHeatmapStatus } from './forecastDiagnostics';
import { logPressureTelemetryDiagnostics, checkIsExactPointValid, logForensicAudit } from './MapForecastOverlayDiag';
import { displayMatchesRequested } from './marineTransitionCoordinator';
import { recordTruthStage } from './weatherTruthTracker';
import { getBackendPrecipitationFlag } from './backendPrecipitationServiceClient';
import { getBackendPressureFlag } from './backendPressureServiceClient';
import { useExactPointFetch } from '../../hooks/useExactPointFetch';


export const MapForecastOverlay = ({
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
  isPlaying = false,
}) => {
  const { theme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isLight = theme === 'light';
  // ⚠️ This file computed only `isLight`, so BEACH rendered with dark-mode colours -- a
  // pre-existing violation of the three-theme mandate. New elements below must not extend it,
  // so the substitution notice branches on all three (house pattern: MapWeatherControls).
  const isBeach = theme === 'beach';
  // ft/m display preference — the heightUnits.js house pattern, identical to MapMarkerLayers'.
  // Until 2026-08-09 this file listened for nothing: the toggle reached the legends and the marker
  // tooltip while the infobox cards beside them stayed in feet, so one screen could show the same
  // wave in two units. Re-reading on the event (not on mount alone) is what makes the pill live.
  const [heightUnit, setHeightUnit] = useState(() => getHeightUnit());
  useEffect(() => {
    const onUnit = () => setHeightUnit(getHeightUnit());
    window.addEventListener('rawsurf:height-unit', onUnit);
    return () => window.removeEventListener('rawsurf:height-unit', onUnit);
  }, []);

  useEffect(() => {
    setIsCollapsed(isImmersiveMode);
  }, [isImmersiveMode]);

  // v5.7.2: Fetch exact-point marine data for selected/long-pressed location.
  // Caches the FULL multi-day response; hour selection happens at render time.
  const pointLat = selectedSpot?.latitude || longPressLocation?.lat || defaultSnappedLat;
  const pointLng = selectedSpot?.longitude || longPressLocation?.lng || defaultSnappedLng;
  const isMarineLayer = ['waves', 'swell_1', 'swell_2', 'wind_waves', 'wind'].includes(activeLayer);
  const isPressureBackendActive = activeLayer === 'pressure' && typeof getBackendPressureFlag === 'function' && getBackendPressureFlag();
  const isPrecipBackendActive = (activeLayer === 'rain' || activeLayer === 'precipitation') && typeof getBackendPrecipitationFlag === 'function' && getBackendPrecipitationFlag();
  const isExactPointRequired = isMarineLayer || isPressureBackendActive || isPrecipBackendActive;

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [settledOffset, setSettledOffset] = useState(timeOffsetHours);

  useEffect(() => {
    setIsScrubbing(true);
    const handler = setTimeout(() => {
      setIsScrubbing(false);
      setSettledOffset(timeOffsetHours);
    }, 200);
    return () => clearTimeout(handler);
  }, [timeOffsetHours]);

  const {
    exactPoint: effectiveExactPoint,
    exactPointStatus: effectiveExactPointStatus,
    exactPointResponse: effectiveExactPointResponse,
    setExactPointStatus,
    setExactPointResponse,
    setEstimateTrigger
  } = useExactPointFetch({
    pointLat,
    pointLng,
    isExactPointRequired,
    activeModel,
    activeLayer,
    settledOffset,
    selectedSpot,
    longPressLocation,
    isScrubbing,
    isPlaying,
    timeOffsetHours,
    marineData
  });

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
  const lat = selectedSpot?.latitude || longPressLocation?.lat || defaultSnappedLat;
  const lng = selectedSpot?.longitude || longPressLocation?.lng || defaultSnappedLng;

  // v6.2: Validate exactPoint still matches current point/model.
  const isExactPointValid = checkIsExactPointValid({
    effectiveExactPoint,
    effectiveExactPointStatus,
    pointLat,
    pointLng,
    activeModel,
    activeLayer
  });

  const isExactPointLoading = ['exact_loading', 'exact_stale_rejected'].includes(effectiveExactPointStatus);
  const isExactPointTimeout = ['exact_timeout', 'copernicus_timeout'].includes(effectiveExactPointStatus);
  const isExactPointError = ['exact_backend_error', 'exact_empty', 'exact_error', 'error', 'copernicus_credentials_missing', 'copernicus_backend_502', 'rate_limited', 'estimate_pending_sources'].includes(effectiveExactPointStatus);

  // v6.6: For selected marine points, exact-point is THE authority.
  // Block ALL fallbacks while loading or if exact point is valid/success.
  const isUserExplicitSelection = !!(selectedSpot || longPressLocation);
  const isExactPointAuthority = isExactPointRequired && isUserExplicitSelection && (pointLat != null) && (pointLng != null);
  
  // v6.9: Grid Fallback on Point Error: if exact point is loading, failed, timed out,
  // or has no coverage, but the visual/blended heatmap grid is valid, use the grid sample.
  // v7.0: Also fall back to grid immediately during scrubbing or when point has null height to prevent flickering.
  // v8.0: Also fall back during exact_loading WITHOUT grid parity to prevent "odd data" flash
  //       from stale forecast data being shown before the exact point API response arrives.
  // Grid parity = the heatmap hour parity flag AND the heatmap frame on screen actually
  // matches the requested {model, layer, hour}. Without BOTH, a grid/forecast sample would
  // be relabeled as the newly-selected target — the v8 regression this gate prevents.
  const hasGridParity = typeof window !== 'undefined' && window.__MARINE_RENDER_HOUR_PARITY__?.parity === true;
  const gridParityOk = hasGridParity && displayMatchesRequested({ model: activeModel, layer: activeLayer, hour: timeOffsetHours });

  // FLASH FIX (2026-07-08): an exact_stale_available hit is 3-12h OFF the requested hour. When the
  // on-screen heatmap IS at the requested hour (grid parity), that parity-grid sample is MORE
  // time-accurate than the stale point, so prefer it — nulling the stale point here lets the value
  // chain fall through to the grid (via useGridFallback below). Without parity the stale point is the
  // best available and is kept (shown with the "(latest)" marker). Kill: __RAW_INFOBOX_STALE_TIGHTEN_DISABLED__.
  const isExactPointStale = effectiveExactPointStatus === 'exact_stale_available';
  const staleTightenOff = typeof window !== 'undefined' && window.__RAW_INFOBOX_STALE_TIGHTEN_DISABLED__ === true;
  const preferGridOverStale = isExactPointStale && gridParityOk && !staleTightenOff;
  const useExactPoint = (isExactPointValid && !preferGridOverStale) ? effectiveExactPoint : null;

  const allExactValuesNull = !!useExactPoint &&
    useExactPoint.wave_height === null && useExactPoint.swell_wave_height === null &&
    useExactPoint.wind_speed_10m === null && useExactPoint.pressure_msl === null && useExactPoint.precipitation === null;

  // Terminal exact-point failures: no response is coming, so the visual grid is the best
  // available source — fall back to it. Transient waits (still loading / not yet valid /
  // all-null): only fall back when grid parity holds; otherwise let the card show its
  // existing "updating" state rather than relabeling a stale frame as the new target.
  const isTerminalExactFailure = isExactPointTimeout || isExactPointError || effectiveExactPointStatus === 'exact_no_time_coverage';
  const isTransientExactWait = isExactPointLoading || !useExactPoint || allExactValuesNull;
  const useGridFallback = isExactPointAuthority && (
    isScrubbing ||
    isTerminalExactFailure ||
    (isTransientExactWait && gridParityOk)
  );
  
  const blockFallbacks = isExactPointAuthority && !useGridFallback;

  // Transient exact-point wait with NO grid parity: there is no authoritative source for the
  // requested {model,layer,hour}. The marine height must NOT fall through to forecastMarineData
  // (Open-Meteo), which would relabel a different dataset as the selected model. Null the height
  // so the card shows its existing "Loading…"/updating state instead. (wind_waves already nulls.)
  const isMarineUpdatingNoParity = isExactPointAuthority && isTransientExactWait &&
    !gridParityOk && !isScrubbing && !isTerminalExactFailure;

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
    const direction = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
    sampledWind = { value: speed, direction };
  }

  const sampledPressure = sampleValueFromDecodedTiles(lat, lng, 'pressure_msl', timeOffsetHours, activeModel);
  const sampledRain = sampleValueFromDecodedTiles(lat, lng, 'precipitation', timeOffsetHours, activeModel);
  const sampledCloudCover = sampleValueFromDecodedTiles(lat, lng, 'cloud_cover', timeOffsetHours, activeModel);
  // ⚠️ visibility is sampled from the RENDERED slot, not from `activeModel`. LayerRegistry pins
  // fog to `ncep_gfs025` on ALL THREE models, so deriving the model from the selector matched no
  // decoded tile on EURO/ICON and the card read '--' at every hour while a full GFS fog raster
  // was on screen. `sampleDecodedOmValue` reads the active slot's om:// URL, which names the
  // model actually painting -- the same pattern the two temperature layers already use.
  // It returns a BARE number (not {value}); the compiler reads `?.value`, so wrap it.
  const _visRaw = sampleDecodedOmValue({ variable: 'visibility', layerKey: 'fog',
                                         lat: pointLat, lng: pointLng });
  const sampledVisibility = _visRaw == null ? null : { value: _visRaw };
  // WHICH MODEL IS ACTUALLY ON SCREEN. Fixing the number without this would trade 'no value'
  // for 'a GFS value labelled ECMWF' -- and the house rule (marine variable refusal) is to
  // refuse rather than mislabel. Absent unless the families genuinely differ.
  const modelSubstitution = describeLayerSubstitution(activeModel, activeLayer);
  // THE QUIETER HALF. When the model does NOT swap but its time axis runs out, the tile lane
  // clamps to the last frame and paints it under whatever hour the scrubber says. The model
  // substitution notice above is structurally blind to that (nothing swapped), so ask the
  // RENDERED slot's model whether it actually carries the requested hour.
  const _slotNow = (typeof window !== 'undefined' && (window.map || window.__MAP_INSTANCE__))
    ? resolveDisplayedSlot(window.map || window.__MAP_INSTANCE__, activeLayer) : null;
  const staleHour = _slotNow ? describeStaleHour(_slotNow.model, timeOffsetHours) : null;

  const liveWind = currentWeather;
  const rawWindSpeed = isLive && liveWind?.wind_speed_10m != null
    ? liveWind.wind_speed_10m : getClampedValue(wx.wind_speed_10m, currentHourIndex);
  const windSpeed = (isExactPointAuthority && activeLayer === 'wind')
    ? (useExactPoint?.wind_speed_10m ?? sampledWind?.value ?? getBiasAdjustedLocal(rawWindSpeed, 'wind'))
    : (activeLayer === 'wind' && sampledWind)
      ? sampledWind.value
      : getBiasAdjustedLocal(rawWindSpeed, 'wind');

  const fallbackWindDir = isLive && liveWind?.wind_direction_10m != null
    ? liveWind.wind_direction_10m : getClampedValue(wx.wind_direction_10m, currentHourIndex);
  const windDir = (isExactPointAuthority && activeLayer === 'wind')
    ? (useExactPoint?.wind_direction_10m ?? sampledWind?.direction ?? fallbackWindDir)
    : (activeLayer === 'wind' && sampledWind)
      ? sampledWind.direction
      : fallbackWindDir;

  const rawWindGusts = isLive && liveWind?.wind_gusts_10m != null
    ? liveWind.wind_gusts_10m : getClampedValue(wx.wind_gusts_10m, currentHourIndex);
  const windGusts = getBiasAdjustedLocal(rawWindGusts, 'wind_gusts');

  const precip = (isExactPointAuthority && (activeLayer === 'rain' || activeLayer === 'precipitation'))
    ? (useExactPoint?.precipitation ?? sampledRain?.value ?? getClampedValue(wx.precipitation, currentHourIndex))
    : ((activeLayer === 'rain' || activeLayer === 'precipitation') && sampledRain)
      ? sampledRain.value
      : getClampedValue(wx.precipitation, currentHourIndex);

  const snowfall = getClampedValue(wx.snowfall, currentHourIndex);
  const temp = getClampedValue(wx.temperature_2m, currentHourIndex);
  
  const pressure = (isExactPointAuthority && activeLayer === 'pressure')
    ? (useExactPoint?.pressure_msl ?? sampledPressure?.value ?? (getClampedValue(wx.pressure_msl, currentHourIndex) ?? getClampedValue(wx.surface_pressure, currentHourIndex)))
    : (activeLayer === 'pressure' && sampledPressure)
      ? sampledPressure.value
      : (getClampedValue(wx.pressure_msl, currentHourIndex) ?? getClampedValue(wx.surface_pressure, currentHourIndex));

  const marineCurrent = marineData?.current || {};
  const rawWaveHeight = isLive && marineCurrent.wave_height != null ? marineCurrent.wave_height : getClampedValue(marine.wave_height, marineHourIndex);
  // v6.6: Exact-point is authoritative when valid. Fallbacks only when exact-point failed or loading/scrubbing.
  const waveHeight = isExactPointAuthority
    ? (useExactPoint?.wave_height ?? sampledWaves?.value ?? marineGridSample?.value ?? (isMarineUpdatingNoParity ? null : getBiasAdjustedLocal(rawWaveHeight, 'wave')))
    : (activeLayer === 'waves' && sampledWaves)
      ? sampledWaves.value
      : (activeLayer === 'waves' && marineGridSample)
        ? marineGridSample.value
        : getBiasAdjustedLocal(rawWaveHeight, 'wave');

  const wavePeriod = isExactPointAuthority
    ? (useExactPoint?.wave_period > 0 ? useExactPoint.wave_period : (sampledWavePeriod?.value > 0 ? sampledWavePeriod.value : (marineGridSample?.period > 0 ? marineGridSample.period : (isLive && marineCurrent.wave_period != null ? marineCurrent.wave_period : getClampedValue(marine.wave_period, marineHourIndex)))))
    : (sampledWavePeriod && sampledWavePeriod.value > 0)
      ? sampledWavePeriod.value
      : (activeLayer === 'waves' && marineGridSample?.period > 0)
        ? marineGridSample.period
        : (isLive && marineCurrent.wave_period != null ? marineCurrent.wave_period : getClampedValue(marine.wave_period, marineHourIndex));
  
  const waveDir = isExactPointAuthority
    ? (useExactPoint?.wave_direction ?? sampledWaves?.direction ?? marineGridSample?.direction ?? (isLive && marineCurrent.wave_direction != null ? marineCurrent.wave_direction : getClampedValue(marine.wave_direction, marineHourIndex)))
    : (activeLayer === 'waves' && sampledWaves && sampledWaves.direction != null)
      ? sampledWaves.direction
      : (activeLayer === 'waves' && marineGridSample?.direction != null)
        ? marineGridSample.direction
        : (isLive && marineCurrent.wave_direction != null ? marineCurrent.wave_direction : getClampedValue(marine.wave_direction, marineHourIndex));
  
  const isLegacyEuroFallback = activeModel === 'EURO' && 
    (marineData?.grid?.__gridProvider === 'open-meteo' || marineData?.grid?.__gridProvider === 'none');

  // v5.9.3: Model capability gate for swell_1 — prevents cross-model leaks
  const swell1Supported = isLayerSupportedByModel(activeModel, 'swell_1') && !isLegacyEuroFallback;
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
      ? (useExactPoint?.swell_wave_height ?? sampledSwell1?.value ?? marineGridSample?.value ?? (isMarineUpdatingNoParity ? null : getBiasAdjustedLocal(rawSwell1Height, 'swell1')))
      : (activeLayer === 'swell_1' && sampledSwell1)
        ? sampledSwell1.value
        : (activeLayer === 'swell_1' && marineGridSample)
          ? marineGridSample.value
          : getBiasAdjustedLocal(rawSwell1Height, 'swell1');

    const rawSwell1Period = isLive && marineCurrent.swell_wave_period != null ? marineCurrent.swell_wave_period : getClampedValue(marine.swell_wave_period, marineHourIndex);
    swell1Period = isExactPointAuthority
      ? (useExactPoint?.swell_wave_period > 0 ? useExactPoint.swell_wave_period : (sampledSwell1Period?.value > 0 ? sampledSwell1Period.value : (marineGridSample?.period > 0 ? marineGridSample.period : (rawSwell1Period != null ? rawSwell1Period : null))))
      : (sampledSwell1Period && sampledSwell1Period.value > 0)
        ? sampledSwell1Period.value
        : (rawSwell1Period != null ? rawSwell1Period : null);

    const rawSwell1Dir = isLive && marineCurrent.swell_wave_direction != null ? marineCurrent.swell_wave_direction : getClampedValue(marine.swell_wave_direction, marineHourIndex);
    swell1Dir = isExactPointAuthority
      ? (useExactPoint?.swell_wave_direction ?? sampledSwell1?.direction ?? marineGridSample?.direction ?? (rawSwell1Dir != null ? rawSwell1Dir : null))
      : (activeLayer === 'swell_1' && sampledSwell1 && sampledSwell1.direction != null)
        ? sampledSwell1.direction
        : (activeLayer === 'swell_1' && marineGridSample?.direction != null)
          ? marineGridSample.direction
          : (rawSwell1Dir != null ? rawSwell1Dir : null);
  }
  
  // v5.9.3: Model capability gate for swell_2
  const swell2Supported = isLayerSupportedByModel(activeModel, 'swell_2') && !isLegacyEuroFallback;
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
      ? (useExactPoint?.secondary_swell_wave_height ?? sampledSwell2?.value ?? marineGridSample?.value ?? (isMarineUpdatingNoParity ? null : getBiasAdjustedLocal(rawSwell2Height, 'swell2')))
      : (activeLayer === 'swell_2' && sampledSwell2)
        ? sampledSwell2.value
        : (activeLayer === 'swell_2' && marineGridSample)
          ? marineGridSample.value
          : getBiasAdjustedLocal(rawSwell2Height, 'swell2');

    const rawSwell2Period = getClampedValue(marine.secondary_swell_wave_period, marineHourIndex);
    swell2Period = isExactPointAuthority
      ? (useExactPoint?.secondary_swell_wave_period > 0 ? useExactPoint.secondary_swell_wave_period : (sampledSwell2Period?.value > 0 ? sampledSwell2Period.value : (marineGridSample?.period > 0 ? marineGridSample.period : rawSwell2Period)))
      : (sampledSwell2Period && sampledSwell2Period.value > 0)
        ? sampledSwell2Period.value
        : (activeLayer === 'swell_2' && marineGridSample?.period > 0)
          ? marineGridSample.period
          : rawSwell2Period;

    const rawSwell2DirRaw = getClampedValue(marine.secondary_swell_wave_direction, marineHourIndex);
    const rawSwell2Dir = rawSwell2DirRaw != null ? rawSwell2DirRaw : null;
    swell2Dir = isExactPointAuthority
      ? (useExactPoint?.secondary_swell_wave_direction ?? sampledSwell2?.direction ?? marineGridSample?.direction ?? rawSwell2Dir)
      : (activeLayer === 'swell_2' && sampledSwell2 && sampledSwell2.direction != null)
        ? sampledSwell2.direction
        : (activeLayer === 'swell_2' && marineGridSample?.direction != null)
          ? marineGridSample.direction
          : rawSwell2Dir;
  }

  // Wind waves — only show real data from models that support it (GFS, ICON)
  const rawWindWaveHeight = getClampedValue(marine.wind_wave_height, marineHourIndex);
  const rawWindWavePeriod = getClampedValue(marine.wind_wave_period, marineHourIndex);
  const rawWindWaveDir = getClampedValue(marine.wind_wave_direction, marineHourIndex);

  // v5.9.2: Check if wind_waves is supported by the active model
  const windWavesSupported = isLayerSupportedByModel(activeModel, 'wind_waves') && !isLegacyEuroFallback;
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



  // Surf-quality rating (very_poor..epic): size + period + wind (offshore/onshore/sideshore) + swell-ANGLE
  // exposure. Frontend mirror of surf_rating.py, fed by the backend surf_height_m + shore_normal_deg. Degrades
  // gracefully — speed-only wind + full exposure when no shore-normal, neutral when no wind. windSpeed is in
  // KNOTS (display unit) -> convert to m/s. swell-from uses the primary swell dir, falling back to the combined.
  // RATING-MODE GATE (2026-07-05, item ③): the Rating card renders ONLY when the surf-rating overlay
  // toggle is ON — the same __SURF_MODE__ source of truth the shader band + glyphs key on. In plain
  // Swell mode the infobox shows the honest physical values without a quality verdict.
  const surfRating = getSurfModeFlag()
    ? computeSurfRating(
        useExactPoint?.surf_height_m,
        wavePeriod,
        windSpeed != null ? windSpeed / 1.943844 : null,
        windDir,
        useExactPoint?.shore_normal_deg,
        useExactPoint?.swell_wave_direction ?? useExactPoint?.wave_direction ?? null,
        // tideNorm / bestTide / breakerXi: null = neutral, matching the hub's waived factors
        // (test_rating_composition_parity.py is the registry).
        null, null, null,
        // referenceSizeM WAS ALSO null, and that stopped being neutral on 2026-08-01. Waiving it
        // graded this badge on the global 1.2 m curve while RATING_LOCAL_SIZE made the glyph and
        // the band grade against the spot's own good day — measured at a median 4.9 and up to 58.1
        // points, on 47.6% of spot-hours, between two surfaces showing the same spot-hour.
        // ★★ A WAIVER IS NOT A CONSTANT: it is only as neutral as the flag it silently shadows, and
        // the structural parity guard cannot see that — "declares null" stays a valid declaration
        // while the thing null MEANS changes underneath it.
        // The backend serves the per-CELL reference here (same blob the band uses at this
        // coordinate); null keeps the legacy global curve, so this is safe before it deploys.
        useExactPoint?.reference_size_m ?? null,
        // The trains the served surf_height_m ran on (SURF_PARTITIONS on; null otherwise). Without
        // this the badge grades the blended field while the glyph — computed by the backend from
        // the SAME response family — grades the spectrum: a fair glyph under a good badge at the
        // same spot-hour (2026-07-30 review). surfRating.js already implements the factors.
        useExactPoint?.partitions ?? null
      )
    : null;

  // Temp-pair infobox v2: Water Temp samples the client-decoded grid the raster renders from
  // (display-consistent — the active slot URL names model+timeIndex; SST is on no point lane).
  const sampledWaterTempC = activeLayer === 'water_temp'
    ? sampleDecodedOmValue({ variable: 'surface_temperature', layerKey: 'water_temp', lat: pointLat, lng: pointLng })
    : null;
  // Air Temp fallback from the same decoded grid the raster renders (wx.temperature_2m can be
  // absent — e.g. a cold/failed point fetch); primary stays the point forecast when present.
  const sampledAirTempC = activeLayer === 'temperature'
    ? sampleDecodedOmValue({ variable: 'temperature_2m', layerKey: 'temperature', lat: pointLat, lng: pointLng })
    : null;

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
    surfRating,
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
    sampledCloudCover,
    sampledVisibility,
    sampledWaterTempC,
    sampledAirTempC,
    mToFt,
    heightUnit,
    degToCompass,
    getClampedValue,
    getBiasAdjustedLocal,
    isLoading
  });

  // v6.6: Console forensic log on activation / load
  // v7.1: Forensic audit effect — stabilized deps to prevent flooding during scrubbing.
  // Removed `cards` (new array each render) and `effectiveExactPoint` (object reference).
  const forensicKey = `${pointLat}_${pointLng}_${activeModel}_${activeLayer}_${effectiveExactPointStatus}_${isExactPointAuthority}_${blockFallbacks}`;
  useEffect(() => {
    logForensicAudit({
      isExactPointRequired,
      pointLat,
      pointLng,
      activeLayer,
      activeModel,
      effectiveExactPointStatus,
      effectiveExactPoint,
      cards,
      isExactPointAuthority,
      waveDir, swell1Dir, swell2Dir, windWaveDir,
      degToCompass,
      blockFallbacks
    });
  }, [forensicKey]);

  // v6E: Telemetry diagnostics for active pressure layer alignment
  // v7.1: Pressure telemetry — stabilized deps. Only fire when pressure layer + key inputs change.
  useEffect(() => {
    if (activeLayer !== 'pressure') return;
    logPressureTelemetryDiagnostics({
      activeLayer,
      isExactPointAuthority,
      effectiveExactPointResponse,
      useExactPoint,
      timeOffsetHours,
      activeModel,
      pressure,
      exactPointStatus: effectiveExactPointStatus,
      exactPointResponse: effectiveExactPointResponse
    });
  }, [activeLayer, isExactPointAuthority, effectiveExactPointStatus, timeOffsetHours, activeModel]);

  useEffect(() => {
    if (effectiveExactPointResponse && timeOffsetHours === 0) {
      const isGfsWaves = activeModel === 'GFS' && activeLayer === 'waves';
      const isWind = activeLayer === 'wind';
      if (isGfsWaves || isWind) {
        recordTruthStage('infoboxDisplay', {
          model: activeModel,
          domain: isWind ? 'wind' : 'marine',
          layer: activeLayer,
          valid_time: effectiveExactPointResponse.valid_time || effectiveExactPointResponse.validTime,
          run_time: effectiveExactPointResponse.run_time || effectiveExactPointResponse.runTime,
          product_id: effectiveExactPointResponse.product_id || effectiveExactPointResponse.productId,
          is_dynamic_viewport_product: effectiveExactPointResponse.is_dynamic_viewport_product,
          coverage_scope: effectiveExactPointResponse.coverage_scope,
          requested_bbox: effectiveExactPointResponse.requested_bbox,
          served_bbox: effectiveExactPointResponse.served_bbox,
          truthTag: effectiveExactPointResponse.truthTag
        }, 'MapForecastOverlay.js', 'effectiveExactPointResponse useEffect');
      }
    }
  }, [effectiveExactPointResponse, activeModel, activeLayer, timeOffsetHours]);

  // v6.6: Call external diagnostics helper to keep component extremely lightweight
  // v7.1: Skip render-phase diagnostics during scrubbing to prevent flooding
  if (typeof window !== 'undefined' && !isScrubbing) {
    const hasGfs = (lat != null && lng != null) ? hasCacheForModel(lat, lng, 'GFS', activeLayer, timeOffsetHours) : false;
    const hasIcon = (lat != null && lng != null) ? hasCacheForModel(lat, lng, 'ICON', activeLayer, timeOffsetHours) : false;

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
      currentHourIndex, wx, exactPointResponse: effectiveExactPointResponse,
      hasGfs, hasIcon
    });
  }

  const heatmapStatus = useMemo(() => {
    return computeHeatmapStatus({ activeModel, activeLayer, renderMarineData });
  }, [renderMarineData, activeModel, activeLayer]);

  if (cards.length === 0 && !isLoading) {
    cards.push({ icon: MapPin, label: 'Data', value: 'No data', color: 'text-gray-400' });
  }

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
    const offset = isNaN(Number(timeOffsetHours)) ? 0 : Number(timeOffsetHours);
    const d = new Date();
    d.setHours(d.getHours() + offset);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' });
  })();

  // v163: Show pin icon when displaying spot or long-press location
  const showPinIcon = !!(selectedSpot || longPressLocation);

  // v7.1: Don't render the infobox at all when no location is selected.
  // It will appear only after a user selects a surf spot, places a marker, or taps GPS.
  if (pointLat == null || pointLng == null) {
    return null;
  }

  return (
    <div
      className={`absolute ${
        isImmersiveMode 
          ? (isTimelineCollapsed ? 'bottom-[80px]' : 'bottom-[170px]') 
          : (isTimelineCollapsed ? 'bottom-[140px]' : 'bottom-[230px]')
      } md:bottom-20 left-4 z-[900] rounded-xl border backdrop-blur-xl shadow-2xl ${bgClass} max-w-[200px] transition-all duration-300`}
      data-testid="forecast-overlay"
    >
      {/* Header — a real <button> with aria-expanded (was a bare div-with-onClick: invisible to
          screen readers and keyboard-unreachable; ACCESSIBILITY mandate 2026-07-14 §0a item 2).
          The visible model/time text is the accessible name; Enter/Space toggle collapse. */}
      <button
        type="button"
        aria-expanded={!isCollapsed}
        className={`w-full text-left bg-transparent px-3 pt-2 pb-1 border-0 border-b border-zinc-800/30 flex justify-between items-center cursor-pointer select-none transition-colors rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${isCollapsed ? 'pb-2 border-transparent rounded-b-xl' : ''}`}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div>
          <div className={`text-[9px] uppercase tracking-wider font-bold ${textMuted} flex items-center gap-1`}>
            {showPinIcon && <MapPin className="w-2.5 h-2.5 text-cyan-400" aria-hidden="true" />}
            {modelLabel} {isLive && !selectedSpot && !longPressLocation ? 'Live' : 'Forecast'}
          </div>
          <div className={`text-[10px] font-semibold ${textClass} truncate max-w-[160px]`}>
            {forecastTimeLabel}
          </div>
        </div>
        <ChevronDown aria-hidden="true" className={`w-4 h-4 ml-3 ${textMuted} transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
      </button>

      {/* Data cards */}
      <div className={`overflow-hidden transition-all duration-300 ${isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[300px] opacity-100'}`}>
        {/* role=list + listitem rows: without it the cards are anonymous divs and a screen reader
            reads a run of bare numbers with no indication that 'Swell' and 'Surf' are different
            quantities in the same units (2026-07-14 accessibility mandate). */}
        <div role="list" aria-label="Forecast conditions at this point"
             className="px-3 py-2 space-y-1.5 border-t border-transparent">
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
                  // ACCESSIBILITY (2026-07-14 mandate): each row is a listitem carrying its own
                  // label+value as accessible text, so a screen reader hears "Surf, 2.1 feet
                  // estimated" rather than an orphaned number. `ariaLabel` lets a card spell the
                  // quantity out in full where the visible label is abbreviated for width — which
                  // matters most here, since 'Swell' and 'Surf' are DIFFERENT QUANTITIES in the
                  // same units and the distinction must survive being read aloud.
                  <div key={i} role="listitem"
                       aria-label={card.ariaLabel || `${card.label}: ${card.value}`}
                       className="flex items-center gap-2">
                    <Icon
                      aria-hidden="true"
                      className={`w-3.5 h-3.5 ${card.color} shrink-0 inline-block`}
                      style={(card.rotate !== undefined && card.rotate !== null) ? { transform: `rotate(${card.rotate}deg)`, transformOrigin: 'center' } : undefined}
                    />
                    <span aria-hidden="true" className={`text-[10px] ${textMuted} w-12`}>{card.label}</span>
                    {card.badgeColor ? (
                      // Rating is conveyed by COLOR + TEXT, never colour alone (mandate): the pill's
                      // text is the level name, and the row's aria-label repeats it.
                      <span aria-hidden="true" className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: card.badgeColor, color: '#fff' }}>{card.value}</span>
                    ) : (
                      // Provisional (grid-sampled) values render dimmed alongside their '…' text
                      // marker until the exact-point authority lands; works in all three themes.
                      <span aria-hidden="true" className={`text-xs font-bold ${textClass} transition-opacity duration-300${card.provisional ? ' opacity-60' : ''}`}>{card.value}</span>
                    )}
                  </div>
                );
              })}
              {(effectiveExactPointStatus === 'estimate_pending_sources' || 
                (activeModel === 'EURO' && effectiveExactPointStatus === 'no_copernicus_coverage' && timeOffsetHours > 27)) && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[10px] text-amber-400 font-semibold flex flex-col gap-1">
                  <span>{effectiveExactPointStatus === 'estimate_pending_sources' ? 'Estimate pending source data' : 'Copernicus native coverage ends at +27h'}</span>
                  <button 
                    onClick={() => {
                      if (pointLat && pointLng) {
                        console.log("[Forecast Overlay] Explicit user action: loading background GFS/ICON data for estimate.");
                        setExactPointStatus('exact_loading');
                        const gfsPromise = fetchExactMarinePoint(pointLat, pointLng, 'GFS', activeLayer, null, timeOffsetHours);
                        const iconPromise = activeModel === 'EURO' ? fetchExactMarinePoint(pointLat, pointLng, 'ICON', activeLayer, null, timeOffsetHours) : Promise.resolve(null);
                        Promise.all([gfsPromise, iconPromise]).then(() => {
                          setEstimateTrigger(prev => prev + 1);
                        });
                      }
                    }}
                    className="px-2 py-0.5 mt-1 bg-amber-500/20 hover:bg-amber-500/30 text-[9px] text-amber-300 font-bold border border-amber-500/30 rounded active:scale-95 transition-transform text-center"
                  >
                    {effectiveExactPointStatus === 'estimate_pending_sources' ? 'Load missing data' : 'Compute Extended Estimate (Load GFS/ICON)'}
                  </button>
                </div>
              )}
              {!modelSubstitution && staleHour && (
                <div
                  className={`pt-1.5 mt-1.5 border-t text-[9px] font-semibold flex items-center gap-1.5 ${
                    isLight ? 'border-gray-200 text-amber-700'
                      : isBeach ? 'border-cyan-900/50 text-amber-300'
                        : 'border-zinc-800/20 text-amber-400'}`}
                >
                  <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>{staleHour.text}</span>
                </div>
              )}
              {modelSubstitution && (
                <div
                  className={`pt-1.5 mt-1.5 border-t text-[9px] font-semibold flex items-center gap-1.5 ${
                    isLight ? 'border-gray-200 text-amber-700'
                      : isBeach ? 'border-cyan-900/50 text-amber-300'
                        : 'border-zinc-800/20 text-amber-400'}`}
                >
                  <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>{modelSubstitution.text}</span>
                </div>
              )}
              {heatmapStatus === 'loading' && (
                <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] text-cyan-400 font-semibold flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  <span>Heatmap Loading...</span>
                </div>
              )}
              {STATUS_RENDERS[heatmapStatus] && (() => {
                const IconComponent = heatmapStatus === 'ready' ? Check 
                  : ['zoom_too_low', 'no_copernicus_coverage', 'no_backend_coverage'].includes(heatmapStatus) ? Info 
                  : AlertTriangle;
                return (
                  <div className={`pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[9px] ${STATUS_RENDERS[heatmapStatus].color} font-semibold flex items-center gap-1.5`}>
                    <IconComponent className={`w-3 h-3 ${STATUS_RENDERS[heatmapStatus].color}`} />
                    <span>{STATUS_RENDERS[heatmapStatus].text}</span>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MapForecastOverlay;
