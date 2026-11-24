import React, { useEffect, useState } from 'react';
import StaleLayerChip from './StaleLayerChip';
import { readRunAge } from './runAgeReadout';

/** The served run's age for the collapsed header (runAgeReadout.js; reliability lane 2026-11-24): the phone with the drawer shut
 * shows no status line, so "GFS run 15 h" rides on the always-visible time button. Kill: window.__RAW_DISABLE_RUN_AGE_LABEL__. */
function useRunAge(model, layer) {
  const read = () => (model && layer && layer !== 'radar' ? readRunAge({ model, layer }) : null);
  const [run, setRun] = useState(read);
  useEffect(() => {
    setRun(read());
    const timer = setInterval(() => setRun(read()), 60000);
    const t0 = setTimeout(() => setRun(read()), 3000);   // capabilities may land after mount
    return () => { clearInterval(timer); clearTimeout(t0); };
  }, [model, layer]);
  return run;
}

/** Retain the original paired surfboard handles with equal left/right inset. */
/** `stale` ({ model, layer, hour, windOn }): the selection the stale-layer chip reads (StaleLayerChip.js); shown only while collapsed. */
export default function TimelineDrawerHeader({ expanded, onToggle, timeLabel, textClass = '', stale = null }) {
  const run = useRunAge(stale && stale.model, stale && stale.layer);
  const verb = expanded ? 'Close timeline' : 'Timeline';
  const handle = side => <button type="button" className={`weather-surfboard-handle group rounded-lg ${textClass}`}
    aria-label={`${expanded ? 'Close' : 'Open'} timeline, ${side} surfboard handle`} aria-expanded={expanded}
    aria-controls="weather-mobile-timeline-body" onClick={onToggle}>
    <svg viewBox="0 0 120 40" className={`weather-surfboard-icon ${side === 'right' ? 'weather-surfboard-mirrored' : ''}`} fill="none" aria-hidden="true" focusable="false">
      <path d="M 85 18 C 86 5, 95 2, 98 2 C 95 10, 95 16, 95 20 Z" className="fill-current opacity-90 group-hover:fill-cyan-400" />
      <path d="M 10 24 C 30 14, 90 14, 110 24 C 113 25, 113 27, 110 28 C 90 20, 30 20, 10 28 C 7 27, 7 25, 10 24 Z" className="fill-current opacity-80 group-hover:fill-blue-500" />
      <path d="M 10 26 C 30 17, 90 17, 110 26" className="stroke-zinc-800 group-hover:stroke-amber-600" strokeWidth="0.5" />
    </svg>
  </button>;
  const header = <div className="weather-compact-timeline-header">
    {handle('left')}
    <button type="button" className={`weather-drawer-time text-[11px] rounded-lg ${textClass}`} aria-expanded={expanded}
      aria-controls="weather-mobile-timeline-body" onClick={onToggle}
      aria-label={run ? `${verb}, ${timeLabel}. ${run.text}` : undefined} data-run-age={run ? (run.stale ? 'stale' : 'ok') : undefined}>
      {`${verb} \u00b7 ${timeLabel}${run ? ` \u00b7 ${run.model} run ${run.ageH} h` : ''}`}</button>
    {handle('right')}
  </div>;
  if (expanded || !stale) return header;
  return <>{header}<StaleLayerChip stale={stale} onOpen={onToggle} textClass={textClass} /></>;
}
