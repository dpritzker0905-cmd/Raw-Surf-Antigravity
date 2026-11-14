import React from 'react';

/** Retain the original paired surfboard handles with equal left/right inset. */
export default function TimelineDrawerHeader({ expanded, onToggle, timeLabel, textClass = '' }) {
  const handle = side => <button type="button" className={`weather-surfboard-handle group rounded-lg ${textClass}`}
    aria-label={`${expanded ? 'Close' : 'Open'} timeline, ${side} surfboard handle`} aria-expanded={expanded}
    aria-controls="weather-mobile-timeline-body" onClick={onToggle}>
    <svg viewBox="0 0 120 40" className={`weather-surfboard-icon ${side === 'right' ? 'weather-surfboard-mirrored' : ''}`} fill="none" aria-hidden="true" focusable="false">
      <path d="M 85 18 C 86 5, 95 2, 98 2 C 95 10, 95 16, 95 20 Z" className="fill-current opacity-90 group-hover:fill-cyan-400" />
      <path d="M 10 24 C 30 14, 90 14, 110 24 C 113 25, 113 27, 110 28 C 90 20, 30 20, 10 28 C 7 27, 7 25, 10 24 Z" className="fill-current opacity-80 group-hover:fill-blue-500" />
      <path d="M 10 26 C 30 17, 90 17, 110 26" className="stroke-zinc-800 group-hover:stroke-amber-600" strokeWidth="0.5" />
    </svg>
  </button>;
  return <div className="weather-compact-timeline-header">
    {handle('left')}
    <button type="button" className={`weather-drawer-time text-[11px] rounded-lg ${textClass}`} aria-expanded={expanded}
      aria-controls="weather-mobile-timeline-body" onClick={onToggle}>{`${expanded ? 'Close timeline' : 'Timeline'} \u00b7 ${timeLabel}`}</button>
    {handle('right')}
  </div>;
}
