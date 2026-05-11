import React, { useMemo } from 'react';
import { Wind, Waves, CloudRain, Thermometer, ArrowUp, Droplets, Gauge } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Floating forecast data readout — renders alongside tile overlays when
 * a weather layer is active.
 *
 * Data source: Open-Meteo Weather & Marine APIs (GFS / ECMWF / ICON).
 * Shows numeric values for the currently selected layer + time offset.
 * Map tile visualization is handled by the om:// protocol in MapWebGL.
 */
export const MapForecastOverlay = ({
  forecastData,
  marineData,
  activeLayer,
  activeModel,
  timeOffsetHours,
  isLoading = false,
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Always show data readout when layer is active (tiles + numeric data)

  // Don't show when no data loaded yet
  if (!forecastData && !marineData) return null;

  const bgClass = isLight
    ? 'bg-white/90 border-gray-200'
    : 'bg-zinc-900/90 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-500' : 'text-gray-400';

  // Find the data point closest to the requested time offset
  const currentHourIndex = useMemo(() => {
    if (!forecastData?.hourly?.time) return 0;
    const targetTime = new Date();
    targetTime.setHours(targetTime.getHours() + timeOffsetHours);
    const targetTs = targetTime.getTime();

    let closest = 0;
    let minDiff = Infinity;
    forecastData.hourly.time.forEach((t, i) => {
      const diff = Math.abs(new Date(t).getTime() - targetTs);
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
      const diff = Math.abs(new Date(t).getTime() - targetTs);
      if (diff < minDiff) { minDiff = diff; closest = i; }
    });
    return closest;
  }, [marineData, timeOffsetHours]);

  // Extract values
  const wx = forecastData?.hourly || {};
  const marine = marineData?.hourly || {};

  const precip = wx.precipitation?.[currentHourIndex];
  const windSpeed = wx.wind_speed_10m?.[currentHourIndex];
  const windDir = wx.wind_direction_10m?.[currentHourIndex];
  const pressure = wx.surface_pressure?.[currentHourIndex];
  const waveHeight = marine.wave_height?.[marineHourIndex];
  const wavePeriod = marine.wave_period?.[marineHourIndex];
  const swellHeight = marine.swell_wave_height?.[marineHourIndex];
  const swellPeriod = marine.swell_wave_period?.[marineHourIndex];
  const swellDir = marine.swell_wave_direction?.[marineHourIndex];

  // Show relevant data based on activeLayer
  const cards = [];

  if (activeLayer === 'precipitation' || activeLayer === 'radar') {
    cards.push({ icon: CloudRain, label: 'Precip', value: precip != null ? `${precip.toFixed(1)} mm/h` : '--', color: 'text-blue-400' });
    cards.push({ icon: Droplets, label: 'Prob', value: wx.precipitation_probability?.[currentHourIndex] != null ? `${wx.precipitation_probability[currentHourIndex]}%` : '--', color: 'text-indigo-400' });
  }
  if (activeLayer === 'wind') {
    cards.push({ icon: Wind, label: 'Wind', value: windSpeed != null ? `${Math.round(windSpeed * 0.539957)} kts` : '--', color: 'text-teal-400' });
    if (windDir != null) cards.push({ icon: ArrowUp, label: 'Dir', value: `${Math.round(windDir)}°`, color: 'text-teal-300', rotate: windDir });
  }
  if (activeLayer === 'pressure') {
    cards.push({ icon: Gauge, label: 'Pressure', value: pressure != null ? `${Math.round(pressure)} hPa` : '--', color: 'text-rose-400' });
  }
  if (activeLayer === 'swell_height') {
    const h = swellHeight ?? waveHeight;
    cards.push({ icon: Waves, label: 'Wave Ht', value: h != null ? `${(h * 3.281).toFixed(1)} ft` : '--', color: 'text-blue-300' });
    if (swellDir != null) cards.push({ icon: ArrowUp, label: 'Dir', value: `${Math.round(swellDir)}°`, color: 'text-blue-200', rotate: swellDir });
  }
  if (activeLayer === 'swell_period') {
    const p = swellPeriod ?? wavePeriod;
    cards.push({ icon: Waves, label: 'Period', value: p != null ? `${p.toFixed(1)}s` : '--', color: 'text-cyan-400' });
    const h = swellHeight ?? waveHeight;
    cards.push({ icon: Waves, label: 'Height', value: h != null ? `${(h * 3.281).toFixed(1)} ft` : '--', color: 'text-blue-300' });
  }

  if (cards.length === 0) return null;

  const modelLabel = { GFS: 'GFS', EURO: 'ECMWF', ICON: 'ICON' }[activeModel] || activeModel;
  const forecastTimeLabel = (() => {
    const d = new Date();
    d.setHours(d.getHours() + timeOffsetHours);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' });
  })();

  return (
    <div
      className={`absolute bottom-20 left-4 z-[900] rounded-xl border backdrop-blur-xl shadow-2xl ${bgClass} max-w-[200px] transition-all duration-300`}
      data-testid="forecast-overlay"
    >
      {/* Header */}
      <div className="px-3 pt-2 pb-1 border-b border-zinc-800/30">
        <div className={`text-[9px] uppercase tracking-wider font-bold ${textMuted}`}>
          {modelLabel} Forecast
        </div>
        <div className={`text-[10px] font-semibold ${textClass}`}>
          {forecastTimeLabel}
        </div>
      </div>

      {/* Data cards */}
      <div className="px-3 py-2 space-y-1.5">
        {isLoading ? (
          <div className={`text-xs ${textMuted} flex items-center gap-2`}>
            <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            Loading…
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
  );
};

export default MapForecastOverlay;
