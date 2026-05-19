import React, { useMemo, useState } from 'react';
import { Wind, Waves, CloudRain, ArrowUp, Droplets, Gauge, Lock, ChevronDown, MapPin } from 'lucide-react';
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

  const wx = forecastData?.hourly || {};
  const marine = marineData?.hourly || {};
  const isLive = timeOffsetHours === 0;

  const liveWind = currentWeather;
  const windSpeed = isLive && liveWind?.wind_speed_10m != null
    ? liveWind.wind_speed_10m : wx.wind_speed_10m?.[currentHourIndex];
  const windDir = isLive && liveWind?.wind_direction_10m != null
    ? liveWind.wind_direction_10m : wx.wind_direction_10m?.[currentHourIndex];
  const windGusts = isLive && liveWind?.wind_gusts_10m != null
    ? liveWind.wind_gusts_10m : wx.wind_gusts_10m?.[currentHourIndex];

  const precip = wx.precipitation?.[currentHourIndex];
  const pressure = wx.surface_pressure?.[currentHourIndex];

  const marineCurrent = marineData?.current || {};
  const waveHeight = isLive && marineCurrent.wave_height != null ? marineCurrent.wave_height : marine.wave_height?.[marineHourIndex];
  const wavePeriod = isLive && marineCurrent.wave_period != null ? marineCurrent.wave_period : marine.wave_period?.[marineHourIndex];
  const waveDir = isLive && marineCurrent.wave_direction != null ? marineCurrent.wave_direction : marine.wave_direction?.[marineHourIndex];
  
  const swell1Height = isLive && marineCurrent.swell_wave_height != null ? marineCurrent.swell_wave_height : marine.swell_wave_height?.[marineHourIndex];
  const swell1Period = isLive && marineCurrent.swell_wave_period != null ? marineCurrent.swell_wave_period : marine.swell_wave_period?.[marineHourIndex];
  const swell1Dir = isLive && marineCurrent.swell_wave_direction != null ? marineCurrent.swell_wave_direction : marine.swell_wave_direction?.[marineHourIndex];
  
  const swell2Height = marine.secondary_swell_wave_height?.[marineHourIndex];
  const swell2Period = marine.secondary_swell_wave_period?.[marineHourIndex];
  const swell2Dir = marine.secondary_swell_wave_direction?.[marineHourIndex];
  const windWaveHeight = marine.wind_wave_height?.[marineHourIndex];
  const windWavePeriod = marine.wind_wave_period?.[marineHourIndex];
  const windWaveDir = marine.wind_wave_direction?.[marineHourIndex];

  const cards = [];

  if (activeLayer === 'rain' || activeLayer === 'radar') {
    cards.push({ icon: CloudRain, label: 'Precip', value: precip != null ? `${precip.toFixed(1)} mm/h` : '--', color: 'text-blue-400' });
    cards.push({ icon: Droplets, label: 'Prob', value: wx.precipitation_probability?.[currentHourIndex] != null ? `${wx.precipitation_probability[currentHourIndex]}%` : '--', color: 'text-indigo-400' });
  }

  if (activeLayer === 'wind') {
    if (windSpeed != null) {
      const kts = windSpeed != null ? Math.round(windSpeed) : null;
      cards.push({ icon: Wind, label: isLive ? 'Live Wind' : 'Wind', value: kts != null ? `${kts} kts` : '--', color: 'text-teal-400' });
 if (windDir != null) cards.push({ icon: ArrowUp, label: degToCompass(windDir), value: `${Math.round(windDir)}`, color: 'text-teal-300', rotate: windDir });
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
 if (waveDir != null) cards.push({ icon: ArrowUp, label: degToCompass(waveDir), value: `${Math.round(waveDir)}`, color: 'text-blue-200', rotate: waveDir });
  }

  if (activeLayer === 'swell_1') {
    const hFt = mToFt(swell1Height);
    cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-cyan-400' });
    if (swell1Period != null) cards.push({ icon: Waves, label: 'Period', value: `${swell1Period.toFixed(1)}s`, color: 'text-cyan-300' });
 if (swell1Dir != null) cards.push({ icon: ArrowUp, label: degToCompass(swell1Dir), value: `${Math.round(swell1Dir)}`, color: 'text-cyan-200', rotate: swell1Dir });
  }

  if (activeLayer === 'swell_2') {
    const hFt = mToFt(swell2Height);
    cards.push({ icon: Waves, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-purple-400' });
    if (swell2Period != null) cards.push({ icon: Waves, label: 'Period', value: `${swell2Period.toFixed(1)}s`, color: 'text-purple-300' });
 if (swell2Dir != null) cards.push({ icon: ArrowUp, label: degToCompass(swell2Dir), value: `${Math.round(swell2Dir)}`, color: 'text-purple-200', rotate: swell2Dir });
  }

  if (activeLayer === 'wind_waves') {
    const hFt = mToFt(windWaveHeight);
    cards.push({ icon: Wind, label: 'Height', value: hFt != null ? `${hFt} ft` : '--', color: 'text-emerald-400' });
    if (windWavePeriod != null) cards.push({ icon: Wind, label: 'Period', value: `${windWavePeriod.toFixed(1)}s`, color: 'text-emerald-300' });
 if (windWaveDir != null) cards.push({ icon: ArrowUp, label: degToCompass(windWaveDir), value: `${Math.round(windWaveDir)}`, color: 'text-emerald-200', rotate: windWaveDir });
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
          ? (isTimelineCollapsed ? 'bottom-[64px]' : 'bottom-[134px]') 
          : (isTimelineCollapsed ? 'bottom-[120px]' : 'bottom-[190px]')
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
                    className={`w-3.5 h-3.5 ${card.color} shrink-0`}
                    style={card.rotate ? { transform: `rotate(${card.rotate}deg)` } : undefined}
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
