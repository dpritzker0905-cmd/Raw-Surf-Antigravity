import React from 'react';

/**
 * Floating card showing the nearest surf spot relative to user's GPS location.
 * Appears in the bottom-right corner of the map.
 */
export const NearestSpotCard = ({
  nearestSpot,
  userLocation,
  onSpotSelect,
}) => {
  if (!nearestSpot || !userLocation) return null;

  return (
    <div className="absolute bottom-24 left-4 z-[1000] pointer-events-auto">
      <div
        className="bg-zinc-800/95 backdrop-blur-sm rounded-lg p-3 max-w-[180px] shadow-lg border border-zinc-700/50 cursor-pointer hover:bg-zinc-700/95 transition-colors"
        onClick={() => onSpotSelect(nearestSpot)}
        data-testid="nearest-spot-card"
      >
        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Nearest spot</p>
        <p className="text-sm font-semibold text-white truncate">{nearestSpot.name}</p>
        <p className="text-xs text-cyan-400 font-medium">{nearestSpot.distance?.toFixed(1)} km away</p>
      </div>
    </div>
  );
};
