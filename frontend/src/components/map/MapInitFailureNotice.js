import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { describeWebglFailure } from './mapWebglSupport';

/**
 * The thing the map shows INSTEAD of nothing when it cannot start.
 *
 * 2026-09-22 — before this existed, a map that failed to initialise rendered an empty
 * rectangle inside a working page. The owner reported that as "frozen"; it was not frozen,
 * it was silent. See mapWebglSupport.js for the library-level mechanism.
 *
 * ★ A blank area is not a neutral outcome — it actively misinforms. It looks like the app
 * is still working on it, so the user waits instead of acting. This panel exists to convert
 * that wait into a next step.
 *
 * Theme: light / dark / beach, per the project's three-theme mandate, using the same
 * isLight/isBeach class pattern as MapWeatherControls.
 * Accessibility: role="alert" so the failure is ANNOUNCED rather than merely drawn (a user
 * who cannot see the blank area is exactly the user least served by silence); a real
 * <button> for retry; and the state is carried by text, never by colour alone.
 */
export const MapInitFailureNotice = ({ reason, detail, onRetry }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';

  const bgClass = isLight
    ? 'bg-white/95 border-gray-200 shadow-xl'
    : isBeach
      ? 'bg-black/90 border-cyan-900/50 shadow-cyan-900/20'
      : 'bg-zinc-900/95 border-zinc-800 shadow-2xl';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textMuted = isLight ? 'text-gray-600' : 'text-gray-400';
  const detailClass = isLight ? 'text-gray-500' : 'text-gray-500';
  const btnClass = isLight
    ? 'bg-cyan-600 text-white hover:bg-cyan-700 focus-visible:ring-cyan-700'
    : 'bg-cyan-500 text-black hover:bg-cyan-400 focus-visible:ring-cyan-300';

  const message = describeWebglFailure(reason);

  return (
    <div
      // The map area is the positioning context; this fills it so the failure occupies the
      // same space the map would have, rather than hiding under chrome at one breakpoint.
      className="absolute inset-0 z-20 flex items-center justify-center p-4 pointer-events-none"
      data-testid="map-init-failure"
    >
      <div
        role="alert"
        aria-live="assertive"
        className={`pointer-events-auto w-full max-w-md rounded-xl border p-5 sm:p-6 ${bgClass}`}
      >
        <div className="flex items-start gap-3">
          {/* Decorative only — the heading below carries the same information as text, so a
              screen reader loses nothing by skipping this, and colour is never the signal. */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-6 h-6 shrink-0 text-amber-500"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>

          <div className="min-w-0">
            <h2 className={`text-base sm:text-lg font-semibold ${textClass}`}>
              The map could not start
            </h2>
            <p className={`mt-2 text-sm leading-relaxed ${textMuted}`}>
              {message}
            </p>

            {/* The raw error is kept VISIBLE rather than console-only: the console is exactly
                where the previous failure went to die unread. */}
            {detail ? (
              <p className={`mt-3 text-xs font-mono break-words ${detailClass}`} data-testid="map-init-failure-detail">
                {detail}
              </p>
            ) : null}

            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                aria-label="Retry loading the map"
                className={`mt-4 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold
                  transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
                  focus-visible:ring-offset-transparent ${btnClass}`}
              >
                Try again
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapInitFailureNotice;
