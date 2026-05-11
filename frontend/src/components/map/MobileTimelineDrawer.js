import React, { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronUp, ChevronDown } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * MobileTimelineDrawer — Collapsible forecast/radar timeline for mobile.
 *
 * Sits above the bottom nav bar (bottom: 64px) as a persistent mini-bar
 * when any weather layer is active. Tapping the chevron expands it to show
 * the full scrubber + legend — essentially a "drawer under the key."
 *
 * Collapsed: [Play] [Time Label] .............. [Expand ^]
 * Expanded:  [Legend gradient bar]
 *            [Play] [<<] [====slider====] [>>] [Time]
 */
const MobileTimelineDrawer = ({
  radarMode = false,
  radarFrames = [],
  radarFrameIndex = 0,
  onRadarFrameChange,
  currentTimeOffset = 0,
  onTimeChange,
  isPlaying = false,
  onTogglePlay,
  activeLayer = null,
}) => {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const isLight = theme === 'light';
  const isBeach = theme === 'beach';

  // Theme tokens
  const bgClass = isLight
    ? 'bg-white/95 border-gray-200'
    : isBeach
      ? 'bg-black/90 border-cyan-900/40'
      : 'bg-zinc-900/95 border-zinc-800';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-500' : 'text-gray-400';
  const btnHover = isLight ? 'hover:bg-gray-200' : 'hover:bg-zinc-700';
  const trackBg = isLight ? '#e5e7eb' : '#3f3f46';

  // Legend config per layer
  const legendConfig = {
    satellite:     { label: 'Cloud Cover (%)', gradient: 'from-transparent via-gray-300 via-gray-400 to-white', stops: ['0','20','40','60','80','100'] },
    swell_height:  { label: 'Waves (ft)', gradient: 'from-blue-100 via-cyan-400 via-blue-600 via-purple-600 to-rose-700', stops: ['0','2','4','8','12','20+'] },
    swell_period:  { label: 'Period (s)', gradient: 'from-blue-100 via-cyan-400 via-blue-600 via-purple-600 to-rose-700', stops: ['0','4','8','12','16','20+'] },
    fog:           { label: 'Visibility (m)', gradient: 'from-gray-700 via-gray-400 to-transparent', stops: ['0','1k','5k','10k','24k'] },
    wind:          { label: 'Wind (kts)', gradient: 'from-teal-100 via-emerald-400 via-yellow-400 via-orange-500 to-rose-600', stops: ['0','5','10','20','30','50+'] },
    precipitation: { label: 'Rain (in/h)', gradient: 'from-gray-300 via-blue-400 via-indigo-500 via-purple-600 to-fuchsia-600', stops: ['0','.1','.3','.5','1.0','2+'] },
    radar:         { label: 'Rain (in/h)', gradient: 'from-gray-300 via-blue-400 via-indigo-500 via-purple-600 to-fuchsia-600', stops: ['0','.1','.3','.5','1.0','2+'] },
    pressure:      { label: 'Pressure (hPa)', gradient: 'from-gray-100 via-blue-300 via-emerald-300 via-yellow-400 to-red-600', stops: ['980','990','1000','1010','1020','1030'] },
  };

  const legend = activeLayer ? legendConfig[activeLayer] : null;
  const maxForecastHours = 14 * 24;

  // Format helpers
  const formatRadarTime = (frame) => {
    if (!frame?.time) return '--:--';
    const d = new Date(frame.time * 1000);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatForecastTime = (h) => {
    if (h === 0) return 'Live';
    const d = new Date();
    d.setHours(d.getHours() + h);
    return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric' })}`;
  };

  // Current display values
  const isRadar = radarMode && radarFrames.length > 0;
  const currentFrame = radarFrames[radarFrameIndex];
  const timeLabel = isRadar ? formatRadarTime(currentFrame) : formatForecastTime(currentTimeOffset);
  const statusLabel = isRadar
    ? `${radarFrameIndex + 1}/${radarFrames.length}`
    : currentTimeOffset === 0 ? 'Current' : 'Forecast';

  // Slider progress
  const progress = isRadar
    ? ((radarFrameIndex + 1) / radarFrames.length) * 100
    : (currentTimeOffset / maxForecastHours) * 100;

  return (
    <div
      className={`absolute left-0 right-0 z-[1001] backdrop-blur-xl border-t ${bgClass} md:hidden transition-all duration-300 ease-in-out`}
      style={{ bottom: '64px' }}
    >
      {/* ---- COLLAPSED BAR ---- */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/* Play/Pause */}
        <button
          onClick={onTogglePlay}
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 ${isPlaying ? 'bg-rose-500 text-white' : 'bg-cyan-500 text-black'}`}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
        </button>

        {/* Time + status */}
        <div className="flex flex-col min-w-0 shrink-0">
          <span className={`text-xs font-bold leading-tight truncate ${textPrimary}`}>{timeLabel}</span>
          <span className={`text-[9px] uppercase tracking-wider font-semibold leading-tight ${textMuted}`}>{statusLabel}</span>
        </div>

        {/* Mini progress bar (collapsed only) */}
        {!expanded && (
          <div className="flex-1 mx-2">
            <div className={`h-1 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} overflow-hidden`}>
              <div className="h-full bg-cyan-500 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Expand/collapse toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${btnHover} transition-colors`}
          aria-label={expanded ? 'Collapse timeline' : 'Expand timeline'}
          aria-expanded={expanded}
        >
          {expanded
            ? <ChevronDown className={`w-4 h-4 ${textMuted}`} />
            : <ChevronUp className={`w-4 h-4 ${textMuted}`} />
          }
        </button>
      </div>

      {/* ---- EXPANDED CONTENT ---- */}
      {expanded && (
        <div className="px-3 pb-2 animate-fadeIn">
          {/* Legend strip */}
          {legend && (
            <div className="mb-2">
              <div className={`text-[9px] ${textMuted} mb-0.5`}>{legend.label}</div>
              <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${legend.gradient}`} />
              <div className={`flex justify-between text-[8px] ${textMuted} mt-0.5`}>
                {legend.stops.map((s, i) => <span key={i}>{s}</span>)}
              </div>
            </div>
          )}

          {/* Full scrubber row */}
          <div className="flex items-center gap-2">
            {/* Step back */}
            {isRadar && (
              <button
                onClick={() => onRadarFrameChange(Math.max(0, radarFrameIndex - 1))}
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${btnHover}`}
                aria-label="Previous frame"
              >
                <SkipBack className={`w-3.5 h-3.5 ${textMuted}`} />
              </button>
            )}

            {/* Slider */}
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={isRadar ? Math.max(radarFrames.length - 1, 0) : maxForecastHours}
                step={isRadar ? 1 : 3}
                value={isRadar ? radarFrameIndex : currentTimeOffset}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  isRadar ? onRadarFrameChange(val) : onTimeChange(val);
                }}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #06b6d4 ${progress}%, ${trackBg} ${progress}%)`
                }}
                aria-label={isRadar ? 'Radar frame scrubber' : 'Forecast timeline'}
              />
            </div>

            {/* Step forward */}
            {isRadar && (
              <button
                onClick={() => onRadarFrameChange(Math.min(radarFrames.length - 1, radarFrameIndex + 1))}
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${btnHover}`}
                aria-label="Next frame"
              >
                <SkipForward className={`w-3.5 h-3.5 ${textMuted}`} />
              </button>
            )}

            {/* Time readout */}
            <span className={`text-[10px] font-bold shrink-0 min-w-[52px] text-right ${textPrimary}`}>
              {timeLabel}
            </span>
          </div>
        </div>
      )}

      <style>{`
        input[type=range]::-webkit-slider-thumb {
          appearance: none; width: 16px; height: 16px;
          background: white; border: 2px solid #06b6d4;
          border-radius: 50%; cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
      `}</style>
    </div>
  );
};

export default MobileTimelineDrawer;
