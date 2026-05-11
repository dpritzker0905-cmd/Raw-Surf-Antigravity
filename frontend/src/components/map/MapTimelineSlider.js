import React, { useMemo } from 'react';
import { Play, Pause } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

export const MapTimelineSlider = ({
  currentTimeOffset, // in hours from now
  onTimeChange,
  isPlaying,
  onTogglePlay,
  userTier = 'tier_1',
  onUpgradeClick
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  // Total max hours available to scroll
  const maxPossibleHours = 14 * 24;

  const handleSliderChange = (e) => {
    onTimeChange(parseInt(e.target.value, 10));
  };

  // Generate day labels (Now, +1d, +2d, ...)
  const generateDays = () => {
    const days = [];
    for (let i = 0; i <= 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const label = i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' });
      days.push({ offset: i * 24, label });
    }
    return days;
  };

  const days = generateDays();

  // Format the currently selected time
  const formatTime = (offsetHours) => {
    if (offsetHours === 0) return 'Live';
    const d = new Date();
    d.setHours(d.getHours() + offsetHours);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric' });
    return `${dayName} ${time}`;
  };

  const sliderBg = isLight ? 'bg-white/90' : 'bg-black/80';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-500' : 'text-gray-400';

  return (
    <div className={`absolute bottom-0 left-0 right-0 z-[1000] backdrop-blur-xl border-t ${isLight ? 'border-gray-200' : 'border-zinc-800'} ${sliderBg}`}>
      <div className="flex items-center w-full px-2 md:px-4 py-2 gap-2 md:gap-4 h-16">
        
        {/* Play/Pause & Time Display */}
        <div className="flex items-center gap-3 shrink-0 min-w-[120px]">
          <button
            onClick={onTogglePlay}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-105 ${isPlaying ? 'bg-rose-500 text-white' : 'bg-cyan-500 text-black'}`}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-1" />}
          </button>
          <div className="flex flex-col hidden sm:flex">
            <span className={`font-bold text-sm ${textClass}`}>{formatTime(currentTimeOffset)}</span>
            <span className={`text-[10px] uppercase tracking-wider font-semibold ${textMuted}`}>
              {currentTimeOffset === 0 ? 'Current' : 'Forecast'}
            </span>
          </div>
        </div>

        {/* Timeline Slider Area */}
        <div className="flex-1 relative h-full flex flex-col justify-end pb-2">
          
          {/* Day Markers */}
          <div className="absolute top-0 left-0 right-0 flex justify-between px-2">
            {days.map((day, i) => (
              <div 
                key={i} 
                className={`text-[10px] font-medium hidden md:block ${day.offset === 0 ? textClass : textMuted}`}
                style={{ position: 'absolute', left: `${(day.offset / maxPossibleHours) * 100}%`, transform: 'translateX(-50%)' }}
              >
                {day.label}
              </div>
            ))}
          </div>

          <div className="relative mt-5">
            {/* The actual range input */}
            <input
              type="range"
              min="0"
              max={maxPossibleHours}
              step="3"
              value={currentTimeOffset}
              onChange={handleSliderChange}
              className="w-full h-2 rounded-full appearance-none cursor-pointer relative z-10"
              style={{
                background: `linear-gradient(to right, #06b6d4 ${(currentTimeOffset / maxPossibleHours) * 100}%, ${isLight ? '#e5e7eb' : '#3f3f46'} ${(currentTimeOffset / maxPossibleHours) * 100}%)`
              }}
            />
            {/* Custom Thumb is tricky cross-browser via inline styles, but webkit CSS usually handles it if defined globally. 
                Using tailwind accent color works for modern browsers. */}
            <style>{`
              input[type=range]::-webkit-slider-thumb {
                appearance: none;
                width: 16px;
                height: 16px;
                background: white;
                border: 3px solid #06b6d4;
                border-radius: 50%;
                cursor: pointer;
              }
            `}</style>
          </div>
        </div>
        
        {/* Mobile quick time display */}
        <div className={`sm:hidden font-bold text-xs shrink-0 w-20 text-right ${textClass}`}>
          {formatTime(currentTimeOffset)}
        </div>
      </div>
    </div>
  );
};

export default MapTimelineSlider;
