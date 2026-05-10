import React, { useMemo } from 'react';
import { Play, Pause, ChevronRight, Lock } from 'lucide-react';
import { Button } from '../ui/button';

export const MapTimelineSlider = ({
  currentTimeOffset, // in hours from now
  onTimeChange,
  isPlaying,
  onTogglePlay,
  userTier = 'tier_1',
  onUpgradeClick
}) => {
  // Define max hours based on tier
  const maxHours = useMemo(() => {
    if (userTier === 'tier_3' || userTier === 'admin') return 14 * 24; // 14 days
    if (userTier === 'tier_2') return 7 * 24; // 7 days
    return 24; // 1 day
  }, [userTier]);

  const maxPossibleHours = 14 * 24;

  const handleSliderChange = (e) => {
    const value = parseInt(e.target.value, 10);
    if (value > maxHours) {
      // Trigger upgrade if dragging into locked territory
      if (onUpgradeClick) onUpgradeClick();
      onTimeChange(maxHours);
    } else {
      onTimeChange(value);
    }
  };

  // Format the currently selected time
  const formatTime = (offsetHours) => {
    if (offsetHours === 0) return 'Live / Now';
    const d = new Date();
    d.setHours(d.getHours() + offsetHours);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${dayName} ${time}`;
  };

  return (
    <div className="absolute bottom-20 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl z-[1000]">
      <div className="bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl p-4 flex flex-col gap-3">
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              onClick={onTogglePlay}
              className="w-10 h-10 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black flex items-center justify-center p-0"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-1" />}
            </Button>
            <div className="flex flex-col">
              <span className="text-white font-bold text-sm">{formatTime(currentTimeOffset)}</span>
              <span className="text-gray-400 text-xs">
                {currentTimeOffset > 0 ? `+${currentTimeOffset} hrs forecast` : 'Current conditions'}
              </span>
            </div>
          </div>
          
          {maxHours < maxPossibleHours && (
            <button
              onClick={onUpgradeClick}
              className="flex items-center gap-1 text-xs font-bold text-yellow-400 hover:text-yellow-300 transition-colors bg-yellow-400/10 px-3 py-1.5 rounded-full"
            >
              <Lock className="w-3 h-3" />
              Unlock 14-Day
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="relative pt-2 pb-1">
          {/* Locked region visual overlay */}
          {maxHours < maxPossibleHours && (
            <div 
              className="absolute h-1.5 top-3.5 bg-zinc-800 rounded-r-full overflow-hidden"
              style={{
                left: `${(maxHours / maxPossibleHours) * 100}%`,
                right: 0
              }}
            >
              <div className="w-full h-full opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.2) 5px, rgba(255,255,255,0.2) 10px)' }} />
            </div>
          )}

          <input
            type="range"
            min="0"
            max={maxPossibleHours}
            step="3"
            value={currentTimeOffset}
            onChange={handleSliderChange}
            className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-cyan-500 relative z-10"
            style={{
              background: `linear-gradient(to right, #06b6d4 ${(currentTimeOffset / maxPossibleHours) * 100}%, #3f3f46 ${(currentTimeOffset / maxPossibleHours) * 100}%)`
            }}
          />
          
          <div className="flex justify-between text-[10px] text-gray-500 font-medium mt-2 px-1">
            <span>Now</span>
            <span>+1 Day</span>
            <span>+7 Days</span>
            <span>+14 Days</span>
          </div>
        </div>
        
      </div>
    </div>
  );
};

export default MapTimelineSlider;
