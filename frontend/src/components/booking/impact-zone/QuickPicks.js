import React from 'react';
import { Star, Anchor } from 'lucide-react';

export var QuickPicks = ({
  location,
  photographerHomeBreak,
  handleHomeBreakSelect,
  nearestPier,
  handleNearestPierSelect,
  userCoords,
  textPrimary,
  textSecondary
}) => {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={handleHomeBreakSelect}
        className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all text-left ${
          location?.type === 'home_break' || location?.preset_id === 'home'
            ? 'border-yellow-500 bg-yellow-500/10' 
            : 'border-zinc-700 hover:border-zinc-600'
        }`}
      >
        <Star className={`w-3.5 h-3.5 flex-shrink-0 ${
          location?.type === 'home_break' || location?.preset_id === 'home' ? 'text-yellow-400' : 'text-gray-500'
        }`} />
        <div className="flex-1 min-w-0">
          <span className={`text-xs font-medium ${textPrimary} block truncate`}>
            {photographerHomeBreak ? photographerHomeBreak.split(',')[0].trim() : 'Home Break'}
          </span>
          <span className={`text-[10px] ${textSecondary} truncate block`}>No travel fee</span>
        </div>
      </button>
      
      <button
        onClick={handleNearestPierSelect}
        disabled={!userCoords && !nearestPier}
        className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all text-left ${
          nearestPier && location?.spot_id === nearestPier.id
            ? 'border-cyan-500 bg-cyan-500/10' 
            : !userCoords
              ? 'border-zinc-700 opacity-60'
              : 'border-zinc-700 hover:border-zinc-600'
        }`}
      >
        <Anchor className={`w-3.5 h-3.5 flex-shrink-0 ${
          nearestPier && location?.spot_id === nearestPier.id ? 'text-cyan-400' : 'text-gray-500'
        }`} />
        <div className="flex-1 min-w-0">
          <span className={`text-xs font-medium ${textPrimary} block truncate`}>
            {nearestPier ? nearestPier.name : 'Nearest Pier'}
          </span>
          <span className={`text-[10px] ${textSecondary} truncate block`}>
            {nearestPier 
              ? `${nearestPier.distance_miles?.toFixed(1) || '?'} mi away`
              : userCoords 
                ? 'No pier nearby' 
                : 'Use GPS first'
            }
          </span>
        </div>
      </button>
    </div>
  );
};
