import React, { useState } from 'react';
import { MapPin, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Floating card showing the nearest surf spot relative to user's GPS location.
 * Positioned bottom-left on both mobile and desktop. Collapsible.
 */
export var NearestSpotCard = ({
  nearestSpot,
  userLocation,
  onSpotSelect,
  isHidden,
  hasActiveLayers,
  isTimelineCollapsed
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!nearestSpot || !userLocation) return null;

  const hiddenClass = isHidden ? 'hidden md:block' : '';
  
  // Calculate dynamic bottom spacing to avoid collision with forecast overlay and timeline
  let bottomClass = 'bottom-24 md:bottom-24';
  if (hasActiveLayers) {
    bottomClass = isTimelineCollapsed ? 'bottom-[280px] md:bottom-[280px]' : 'bottom-[350px] md:bottom-[280px]';
  }

  // Collapsed: show a small pill that can be re-expanded
  if (isCollapsed) {
    return (
      <div className={`absolute ${bottomClass} left-4 z-[1000] pointer-events-auto transition-all duration-300 ${hiddenClass}`}>
        <button
          onClick={() => setIsCollapsed(false)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/90 backdrop-blur-sm rounded-full shadow-lg border border-zinc-700/50 hover:bg-zinc-700/90 transition-colors"
          aria-label="Show nearest spot"
          aria-expanded={false}
          data-testid="nearest-spot-expand-btn"
        >
          <MapPin className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs text-white font-medium truncate max-w-[100px]">{nearestSpot.name}</span>
          <ChevronUp className="w-3 h-3 text-gray-400" />
        </button>
      </div>
    );
  }

  // Expanded: full info card
  return (
    <div className={`absolute ${bottomClass} left-4 z-[1000] pointer-events-auto transition-all duration-300 ${hiddenClass}`}>
      <div
        className="bg-zinc-800/95 backdrop-blur-sm rounded-lg shadow-lg border border-zinc-700/50 overflow-hidden max-w-[200px]"
        data-testid="nearest-spot-card"
      >
        {/* Header with collapse button */}
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Nearest spot</p>
          <button
            onClick={(e) => { e.stopPropagation(); setIsCollapsed(true); }}
            className="p-0.5 rounded hover:bg-zinc-700 transition-colors"
            aria-label="Collapse nearest spot"
            aria-expanded={true}
            data-testid="nearest-spot-collapse-btn"
          >
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>
        {/* Body — clickable to navigate */}
        <div
          className="px-3 pb-2.5 cursor-pointer hover:bg-zinc-700/50 transition-colors"
          onClick={() => onSpotSelect(nearestSpot)}
        >
          <p className="text-sm font-semibold text-white truncate">{nearestSpot.name}</p>
          <p className="text-xs text-cyan-400 font-medium">{nearestSpot.distance?.toFixed(1)} km away</p>
        </div>
      </div>
    </div>
  );
};
