import React, { useRef } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { useThemeName } from '../../contexts/ThemeContext';
import MapHeader from './MapHeader';
import { mapChromeTheme } from './mapChromeTheme';
import { responsiveWeatherOn } from './useMapChromeLayout';

/** Keep map identity in view while the search controls disclose below it. */
export default function MapExploreRail({ open, onToggle, onClose, livePhotographerCount, isImmersiveMode = false, status, notice, children }) {
  const c = mapChromeTheme(useThemeName());
  const toggle = useRef(null);
  const responsive = responsiveWeatherOn();
  const closeOnEscape = event => {
      if (!responsive || event.key !== 'Escape' || event.defaultPrevented || !open) return;
      event.preventDefault(); event.stopPropagation(); onClose(); toggle.current?.focus();
  };
  return <div className={`top-rail-container absolute top-0 left-0 right-0 z-[1000] pointer-events-none ${responsive ? '' : `pt-4 transition-opacity duration-300 ${isImmersiveMode ? 'opacity-0' : 'opacity-100'}`}`} inert={!responsive && isImmersiveMode || undefined}>
    <div className={`weather-map-heading ${responsive ? 'px-3' : 'px-4'}`}><MapHeader livePhotographerCount={livePhotographerCount} /></div>
    <div className="weather-explore-controls">
      <button type="button" ref={toggle} onKeyDown={closeOnEscape}
        className={`weather-explorer-toggle mx-3 px-3 py-2 rounded-xl border backdrop-blur-xl text-xs font-semibold ${c.surface} ${c.surfaceText} ${c.rowHover}`}
        aria-expanded={open} aria-controls="map-explore-content" onClick={onToggle}>
        <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 text-left">Map Search &amp; Filters</span>
        <ChevronDown className={`w-3 h-3 shrink-0 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {status && <div className={`weather-map-status pointer-events-auto ${responsive ? 'mx-3 mt-2' : 'mx-4'}`}>{status}</div>}
      <div id="map-explore-content" className={`weather-explore-content ${responsive ? 'px-3' : 'px-4'}`} role="presentation" onKeyDown={closeOnEscape}>{children}</div>
      {notice && <div className={`weather-map-notice pointer-events-auto ${responsive ? 'mx-3 mt-2' : 'mx-4'}`}>{notice}</div>}
    </div>
  </div>;
}
