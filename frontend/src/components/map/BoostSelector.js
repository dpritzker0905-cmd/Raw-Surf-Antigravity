/**
 * BoostSelector - Priority boost selection for dispatch requests
 * Reusable component extracted from MapPage.js
 */
import React from 'react';

const BOOST_OPTIONS = [
  { hours: 1, credits: 5 },
  { hours: 2, credits: 10 },
  { hours: 4, credits: 20 }
];

export const BoostSelector = ({ 
  selectedHours = 0, 
  onSelect,
  variant = 'default' // 'default' | 'compact'
}) => {
  return (
    <div className="p-4 bg-gradient-to-r from-orange-900/30 to-red-900/30 rounded-lg border border-orange-500/30">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🚀</span>
        <span className="text-orange-400 font-bold">Boost Your Request</span>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Jump to the front of the queue! Photographers see boosted requests first.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {BOOST_OPTIONS.map(({ hours, credits }) => (
          <button
            key={hours}
            onClick={() => onSelect(selectedHours === hours ? 0 : hours)}
            className={`p-2 rounded-lg text-center transition-all ${
              selectedHours === hours 
                ? 'bg-orange-500 text-white ring-2 ring-orange-400' 
                : 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'
            }`}
            data-testid={`boost-${hours}h`}
          >
            <div className="text-lg font-bold">{credits}</div>
            <div className="text-xs">credits</div>
            <div className="text-[10px] text-gray-400">{hours} hour{hours > 1 ? 's' : ''}</div>
          </button>
        ))}
      </div>
      {selectedHours > 0 && (
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-orange-400">Boost selected:</span>
          <span className="text-white font-bold">
            {selectedHours}h for {BOOST_OPTIONS.find(o => o.hours === selectedHours)?.credits || 0} credits
          </span>
        </div>
      )}
    </div>
  );
};

export default BoostSelector;
