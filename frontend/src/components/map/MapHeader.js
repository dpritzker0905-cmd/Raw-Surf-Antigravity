/**
 * MapHeader - Header section with title and live photographer count
 * Extracted from MapPage.js for better organization
 */
import React from 'react';

export const MapHeader = ({ livePhotographerCount = 0 }) => {
  return (
    <div className="flex items-center justify-between mb-3 pointer-events-auto">
      <h1 
        className="text-xl font-bold text-white drop-shadow-lg" 
        style={{ fontFamily: 'Oswald' }}
        data-testid="map-title"
      >
        Live Map
      </h1>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800/90 backdrop-blur-sm rounded-full">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
          <span className="text-xs text-gray-300" data-testid="live-count">
            {livePhotographerCount} shooting
          </span>
        </div>
      </div>
    </div>
  );
};

export default MapHeader;
