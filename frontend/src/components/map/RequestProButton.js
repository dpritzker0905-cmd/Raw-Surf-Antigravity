import React from 'react';
import { useThemeName } from '../../contexts/ThemeContext';
import { mapChromeTheme } from './mapChromeTheme';

export var RequestProButton = ({
  userLocation,
  requestProLocationLoading,
  setPendingRequestPro,
  setRequestProLocationLoading,
  setLocationDenied,
  getUserLocation,
  setShowRequestProModal
}) => {
  const c = mapChromeTheme(useThemeName());     // three themes (W-10 R4): it was zinc-800 in every mode
  return (
    <div className="mt-2 pointer-events-auto">
      <button
        onClick={() => {
          if (!userLocation) {
            setPendingRequestPro(true);
            setRequestProLocationLoading(true);
            setLocationDenied(false);
            getUserLocation();
          } else {
            setShowRequestProModal(true);
          }
        }}
        disabled={requestProLocationLoading}
        className={`px-4 py-2 rounded-full text-sm font-medium transition-all backdrop-blur-sm border border-cyan-500/50 ${
          requestProLocationLoading 
            ? 'bg-cyan-600/50 text-white cursor-wait' 
            : c.requestIdle
        }`}
        data-testid="request-pro-btn"
      >
        {requestProLocationLoading ? (
          <span className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Finding location...
          </span>
        ) : (
          // 'Request a <camera emoji>' until da30f15d (2026-05-18) stripped the emoji and left 'Request a ',
          // shipped to production that way. Named in words, as the modal it opens names itself.
          'Request a Pro'
        )}
      </button>
    </div>
  );
};
