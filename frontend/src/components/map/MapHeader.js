/**
 * MapHeader - Header section with title and live photographer count
 * Extracted from MapPage.js for better organization
 */
import React from 'react';
import { useThemeName } from '../../contexts/ThemeContext';
import { mapChromeTheme } from './mapChromeTheme';
import { responsiveWeatherOn } from './useMapChromeLayout';

export var MapHeader = ({ livePhotographerCount = 0 }) => {
  // Three themes (W-10 R4): the title was text-white in every mode, invisible on the light and beach basemaps.
  const c = mapChromeTheme(useThemeName());
  const responsive = responsiveWeatherOn();
  return (
    <div className={responsive ? 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1 pointer-events-none' : 'flex items-center justify-between mb-3 pointer-events-auto'}>
      <h1
        className={`text-xl ${responsive ? 'whitespace-nowrap' : ''} font-bold ${c.title} font-oswald`}

        data-testid="map-title"
      >
        {responsive ? 'LIVE MAP' : 'Live Map'}
      </h1>
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1 px-3 py-1.5 ${c.surface} backdrop-blur-sm rounded-full`}>
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
          <span className={`text-xs ${c.mutedText}`} data-testid="live-count">
            {livePhotographerCount} shooting
          </span>
        </div>
      </div>
    </div>
  );
};

export default MapHeader;
