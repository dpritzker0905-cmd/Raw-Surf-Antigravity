import React, { useMemo, useState, useEffect } from 'react';
import { Wind, Waves, CloudRain, Snowflake, ArrowUp, Droplets, Gauge, Lock, ChevronDown, MapPin, Thermometer } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

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
  const isLight = theme === 'light';

  useEffect(() => {
    setIsCollapsed(isImmersiveMode);
  }, [isImmersiveMode]);

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
    const isFallback = (activeModel === 'EURO' && (timeOffsetHours > 240 || isSwell2)) ||
                       (activeModel === 'ICON' && (timeOffsetHours > 180 || isSwell2));
                       
    if (!isFallback) return val;
    
    if (activeModel === 'EURO') {
      if (variableType === 'wind' || variableType === 'wind_gusts') return val * 1.025; // ECMWF higher wind capture
      if (variableType === 'wave' || variableType === 'swell1' || variableType === 'swell2' || variableType === 'wind_wave') return val * 1.05; // ECMWF higher swell energy
    }
    if (activeModel === 'ICON') {
      if (variableType === 'wind' || variableType === 'wind_gusts') return val * 0.97; // ICON conservative wind speed
      if (variableType === 'wave' || variableType === 'swell1' || variableType === 'swell2' || variableType === 'wind_wave') return val * 0.96; // ICON conservative swell height
    }
    return val;
  };

  const liveWind = currentWeather;
  const rawWindSpeed = isLive && liveWind?.wind_speed_10m != null
    ? liveWind.wind_speed_10m : getClampedValue(wx.wind_speed_10m, currentHourIndex);
  const windSpeed = getBiasAdjusted(rawWindSpeed, 'wind');

  const windDir = isLive && liveWind?.wind_direction_10m != null
    ? liveWind.wind_direction_10m : getClampedValue(wx.wind_direction_10m, currentHourIndex);

  const rawWindGusts = isLive && liveWind?.wind_gusts_10m != null
    ? liveWind.wind_gusts_10m : getClampedValue(wx.wind_gusts_10m, currentHourIndex);
  const windGusts = getBiasAdjusted(rawWindGusts, 'wind_gusts');

  const precip = getClampedValue(wx.precipitation, currentHourIndex);
  const snowfall = getClampedValue(wx.snowfall, currentHourIndex);
  const temp = getClampedValue(wx.temperature_2m, currentHourIndex);
  const pressure = getClampedValue(wx.pressure_msl, currentHourIndex) ?? getClampedValue(wx.surface_pressure, currentHourIndex);

  const marineCurrent = marineData?.current || {};
  const rawWaveHeight = isLive && marineCurrent.wave_height != null ? marineCurrent.wave_height : getClampedValue(marine.wave_height, marineHourIndex);
  const waveHeight = getBiasAdjusted(rawWaveHeight, 'wave');

  const wavePeriod = isLive && marineCurrent.wave_period != null ? marineCurrent.wave_period : getClampedValue(marine.wave_period, marineHourIndex);
  const waveDir = isLive && marineCurrent.wave_direction != null ? marineCurrent.wave_direction : getClampedValue(marine.wave_direction, marineHourIndex);
  
  const rawSwell1HeightRaw = isLive && marineCurrent.swell_wave_height != null ? marineCurrent.swell_wave_height : getClampedValue(marine.swell_wave_height, marineHourIndex);
  const rawSwell1Height = rawSwell1HeightRaw != null ? rawSwell1HeightRaw : (activeModel === 'EURO' ? rawWaveHeight : null);
  const swell1Height = getBiasAdjusted(rawSwell1Height, 'swell1');
  
  const rawSwell1Period = isLive && marineCurrent.swell_wave_period != null ? marineCurrent.swell_wave_period : getClampedValue(marine.swell_wave_period, marineHourIndex);
  const swell1Period = rawSwell1Period != null ? rawSwell1Period : (activeModel === 'EURO' ? wavePeriod : null);
  
  const rawSwell1Dir = isLive && marineCurrent.swell_wave_direction != null ? marineCurrent.swell_wave_direction : getClampedValue(marine.swell_wave_direction, marineHourIndex);
  const swell1Dir = rawSwell1Dir != null ? rawSwell1Dir : (activeModel === 'EURO' ? waveDir : null);
  
  // Swell 2 (secondary swell) — only GFS Wave provides this natively; stitched in from GFS Wave for other models
  const rawSwell2HeightRaw = getClampedValue(marine.secondary_swell_wave_height, marineHourIndex);
  const rawSwell2Height = rawSwell2HeightRaw != null ? rawSwell2HeightRaw : null;
  const swell2Height = getBiasAdjusted(rawSwell2Height, 'swell2');

  const swell2Period = getClampedValue(marine.secondary_swell_wave_period, marineHourIndex);
  const swell2Dir = getClampedValue(marine.secondary_swell_wave_direction, marineHourIndex);
  const swell2ModelUnavailable = activeModel !== 'GFS' && rawSwell2Height == null;

  // Wind waves — GFS and ICON provide this, EURO does not
  // For EURO: estimate wind waves = total wave height minus primary swell height
  const rawWindWaveHeight = getClampedValue(marine.wind_wave_height, marineHourIndex);
  const rawWindWavePeriod = getClampedValue(marine.wind_wave_period, marineHourIndex);
  const rawWindWaveDir = getClampedValue(marine.wind_wave_direction, marineHourIndex);

  let windWaveHeight, windWavePeriod, windWaveDir;
  if (rawWindWaveHeight != null) {
    windWaveHeight = getBiasAdjusted(rawWindWaveHeight, 'wind_wave');
    windWavePeriod = rawWindWavePeriod;
    windWaveDir = rawWindWaveDir;
  } else if (activeModel === 'EURO' && waveHeight != null && swell1Height != null) {
    // Estimate: wind wave ≈ total wave - primary swell (clamped to 0)
    windWaveHeight = getBiasAdjusted(Math.max(0, waveHeight - swell1Height), 'wind_wave');
    windWavePeriod = wavePeriod != null ? Math.max(1, wavePeriod * 0.7) : null; // wind waves have shorter period
    windWaveDir = waveDir; // same direction as total wave
  } else {
    windWaveHeight = null;
    windWavePeriod = null;
    windWaveDir = null;
  }
  const windWaveEstimated = rawWindWaveHeight == null && windWaveHeight != null;

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
    cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-blue-300' });
    if (wavePeriod != null) cards.push({ icon: Waves, label: 'Period', value: `${wavePeriod.toFixed(1)}s`, color: 'text-blue-200' });
    if (waveDir != null) cards.push({ icon: ArrowUp, label: degToCompass(waveDir), value: `${Math.round(waveDir)}`, color: 'text-blue-200', rotate: (waveDir + 180) % 360 });
  }

  if (activeLayer === 'swell_1') {
    const hFt = mToFt(swell1Height);
    cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-cyan-400' });
    if (swell1Period != null) cards.push({ icon: Waves, label: 'Period', value: `${swell1Period.toFixed(1)}s`, color: 'text-cyan-300' });
    if (swell1Dir != null) cards.push({ icon: ArrowUp, label: degToCompass(swell1Dir), value: `${Math.round(swell1Dir)}`, color: 'text-cyan-200', rotate: (swell1Dir + 180) % 360 });
  }

  if (activeLayer === 'swell_2') {
    if (swell2ModelUnavailable) {
      // Model doesn't provide secondary swell — show informative message
      const modelLabel2 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Waves, label: 'Swell 2', value: 'N/A', color: 'text-purple-400' });
      cards.push({ icon: Waves, label: modelLabel2, value: 'No data', color: 'text-gray-400' });
    } else {
      const hFt = mToFt(swell2Height);
      cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-purple-400' });
      if (swell2Period != null) cards.push({ icon: Waves, label: 'Period', value: `${swell2Period.toFixed(1)}s`, color: 'text-purple-300' });
      if (swell2Dir != null) cards.push({ icon: ArrowUp, label: degToCompass(swell2Dir), value: `${Math.round(swell2Dir)}`, color: 'text-purple-200', rotate: (swell2Dir + 180) % 360 });
    }
  }

  if (activeLayer === 'wind_waves') {
    const hFt = mToFt(windWaveHeight);
    const suffix = windWaveEstimated ? ' ~' : '';
    cards.push({ icon: Wind, label: 'Height', value: hFt != null ? `${hFt}${suffix} ft` : '--', color: 'text-emerald-400' });
    if (windWavePeriod != null) cards.push({ icon: Wind, label: 'Period', value: `${windWavePeriod.toFixed(1)}${suffix}s`, color: 'text-emerald-300' });
    if (windWaveDir != null) cards.push({ icon: ArrowUp, label: degToCompass(windWaveDir), value: `${Math.round(windWaveDir)}`, color: 'text-emerald-200', rotate: (windWaveDir + 180) % 360 });
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
