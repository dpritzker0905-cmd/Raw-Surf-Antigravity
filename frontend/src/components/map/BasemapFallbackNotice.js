import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Says the basemap is the simplified fallback (A15-17). Without it a user would read the plain
 * land/ocean map as the product working as intended, or as a rendering bug.
 *
 * Not an alert and not a blocker: the map and every forecast layer still work, so this is a
 * polite `role="status"` that never takes pointer events from the map underneath. Text carries
 * the state (never colour alone), and it follows the isLight/isBeach pattern of
 * MapInitFailureNotice so all three themes get a readable surface.
 */
export const BasemapFallbackNotice = ({ reason }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const bgClass = isLight
    ? 'bg-white/95 border-gray-200 text-gray-800 shadow-md'
    : isBeach
      ? 'bg-black/85 border-cyan-900/50 text-cyan-50 shadow-cyan-900/20'
      : 'bg-zinc-900/90 border-zinc-700 text-gray-100 shadow-lg';

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 bottom-28 sm:bottom-6 z-10 px-4 w-full max-w-sm pointer-events-none"
      data-testid="basemap-fallback-notice"
      data-reason={reason || ''}
    >
      <p role="status" aria-live="polite" className={`rounded-lg border px-3 py-2 text-xs sm:text-sm text-center ${bgClass}`}>
        Detailed map unavailable. Showing simplified coastlines; forecasts are unaffected.
      </p>
    </div>
  );
};

export default BasemapFallbackNotice;
