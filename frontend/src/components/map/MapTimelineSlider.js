import React, { useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Dual-mode timeline control:
 * - RADAR MODE: Frame stepper cycling through RainViewer's ~12 past frames (2h @ 10min)
 * - FORECAST MODE: Standard 14-day slider for OWM/model forecast data
 */
export const MapTimelineSlider = ({
  // Shared
  isPlaying,
  onTogglePlay,
  // Radar mode
  radarMode = false,
  radarFrames = [],
  radarFrameIndex = 0,
  onRadarFrameChange,
  // Forecast mode
  currentTimeOffset,
  onTimeChange,
  userTier = 'tier_1',
  activeLayerLabel,
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const sliderBg = isLight ? 'bg-white/90' : 'bg-black/80';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-500' : 'text-gray-400';

  // Format radar frame timestamp to local time
  const formatRadarTime = (frame) => {
    if (!frame?.time) return '--:--';
    const d = new Date(frame.time * 1000);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  // Format forecast offset
  const formatForecastTime = (offsetHours) => {
    if (offsetHours === 0) return 'Live';
    const d = new Date();
    d.setHours(d.getHours() + offsetHours);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric' });
    return `${dayName} ${time}`;
  };

  const currentFrame = radarFrames[radarFrameIndex];
  const maxPossibleHours = 14 * 24;

  // ==================== RADAR MODE ====================
  if (radarMode && radarFrames.length > 0) {
    const totalFrames = radarFrames.length;
    const progress = ((radarFrameIndex + 1) / totalFrames) * 100;

    return (
      <div className={`absolute bottom-0 left-0 right-0 z-[1000] backdrop-blur-xl border-t ${isLight ? 'border-gray-200' : 'border-zinc-800'} ${sliderBg}`} style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-center w-full px-3 py-2 gap-3 h-14">
          {/* Play/Pause */}
          <button
            onClick={onTogglePlay}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-105 shrink-0 ${isPlaying ? 'bg-rose-500 text-white' : 'bg-cyan-500 text-black'}`}
            aria-label={isPlaying ? 'Pause radar animation' : 'Play radar animation'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          {/* Step backward */}
          <button
            onClick={() => onRadarFrameChange(Math.max(0, radarFrameIndex - 1))}
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'hover:bg-gray-200' : 'hover:bg-zinc-700'} transition-colors`}
            aria-label="Previous radar frame"
          >
            <SkipBack className={`w-3.5 h-3.5 ${textMuted}`} />
          </button>

          {/* Progress bar + time */}
          <div className="flex-1 flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-bold ${textClass}`}>
                {formatRadarTime(currentFrame)}
              </span>
              <span className={`text-[10px] ${textMuted}`}>
                {radarFrameIndex + 1}/{totalFrames}
              </span>
            </div>
            {/* Clickable scrubber */}
            <input
              type="range"
              min={0}
              max={totalFrames - 1}
              step={1}
              value={radarFrameIndex}
              onChange={(e) => onRadarFrameChange(parseInt(e.target.value, 10))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #06b6d4 ${progress}%, ${isLight ? '#e5e7eb' : '#3f3f46'} ${progress}%)`
              }}
              aria-label="Radar frame scrubber"
            />
          </div>

          {/* Step forward */}
          <button
            onClick={() => onRadarFrameChange(Math.min(totalFrames - 1, radarFrameIndex + 1))}
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'hover:bg-gray-200' : 'hover:bg-zinc-700'} transition-colors`}
            aria-label="Next radar frame"
          >
            <SkipForward className={`w-3.5 h-3.5 ${textMuted}`} />
          </button>

          {/* Radar label */}
          <div className={`text-[9px] uppercase tracking-wider font-bold shrink-0 ${textMuted}`}>
            {activeLayerLabel || 'Radar'}
          </div>
        </div>
        <style>{`
          input[type=range]::-webkit-slider-thumb {
            appearance: none; width: 14px; height: 14px;
            background: white; border: 2px solid #06b6d4;
            border-radius: 50%; cursor: pointer;
          }
        `}</style>
      </div>
    );
  }

  // ==================== FORECAST MODE ====================
  return (
    <div className={`absolute bottom-0 left-0 right-0 z-[1000] backdrop-blur-xl border-t ${isLight ? 'border-gray-200' : 'border-zinc-800'} ${sliderBg}`} style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center w-full px-3 py-2 gap-3 h-14">
        {/* Play/Pause */}
        <button
          onClick={onTogglePlay}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-105 shrink-0 ${isPlaying ? 'bg-rose-500 text-white' : 'bg-cyan-500 text-black'}`}
          aria-label={isPlaying ? 'Pause forecast animation' : 'Play forecast animation'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        {/* Time display */}
        <div className="flex flex-col shrink-0 min-w-[80px]">
          <span className={`font-bold text-xs ${textClass}`}>{formatForecastTime(currentTimeOffset)}</span>
          <span className={`text-[9px] uppercase tracking-wider font-semibold ${textMuted}`}>
            {currentTimeOffset === 0 ? 'Current' : 'Forecast'}
          </span>
        </div>

        {/* Slider */}
        <div className="flex-1">
          <input
            type="range"
            min="0"
            max={maxPossibleHours}
            step="3"
            value={currentTimeOffset}
            onChange={(e) => onTimeChange(parseInt(e.target.value, 10))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #06b6d4 ${(currentTimeOffset / maxPossibleHours) * 100}%, ${isLight ? '#e5e7eb' : '#3f3f46'} ${(currentTimeOffset / maxPossibleHours) * 100}%)`
            }}
            aria-label="Forecast timeline scrubber"
          />
        </div>

        {/* Mobile time label */}
        <div className={`sm:hidden font-bold text-[10px] shrink-0 w-16 text-right ${textClass}`}>
          {formatForecastTime(currentTimeOffset)}
        </div>
      </div>
      <style>{`
        input[type=range]::-webkit-slider-thumb {
          appearance: none; width: 14px; height: 14px;
          background: white; border: 2px solid #06b6d4;
          border-radius: 50%; cursor: pointer;
        }
      `}</style>
    </div>
  );
};

export default MapTimelineSlider;
