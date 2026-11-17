import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { readRatedRunState, readWindStaleState } from './staleLayerState';

/**
 * THE STALE-LAYER CHIP on the COLLAPSED phone timeline header (2026-11-16; David approved it 08:54 EST via the advisor, and gave it
 * to the rating-band lane 10:31 EST via the director; gate: log 2026-11-15-claude-rating-band-sota.md section 12).
 * With the drawer collapsed a phone shows no status line, so "the surf ratings are a run old" was invisible there. This chip says it
 * where the reader is looking: a clock icon plus a few words ("Ratings 6 h old"; wind: "Wind: nearest stored time"), only while the
 * painted layer lags. Its accessible name is the status line's own full sentence, and a tap opens the drawer where that line is.
 * ONE SOURCE: staleLayerState.js (the same reader ForecastTimeStatus uses), so the chip and the line can never disagree.
 * Informational, never a warning colour, never colour alone. Kill: window.__RAW_DISABLE_STALE_CHIP__ = true.
 */
export const staleChipKilled = () => typeof window !== 'undefined' && window.__RAW_DISABLE_STALE_CHIP__ === true;

/** What the chip says now, or null: the rating band's run age first, then (wind on) wind's nearest stored / held state. */
export function readStaleChip({ model, hour, windOn } = {}) {
  if (staleChipKilled()) return null;
  const rated = readRatedRunState();
  if (rated) return { kind: 'ratings', short: rated.short, text: rated.text };
  if (windOn) {
    const wind = readWindStaleState({ model, hour });
    if (wind) return { kind: 'wind', short: wind.short, text: wind.text };
  }
  return null;
}

/** HOLD (advisor, #978): during a scrub the band is briefly held between hours, so the reader clears for a moment; without a hold the
 * chip (its own row) would unmount and remount and the collapsed header would change height. A cleared state is kept HOLD_MS before
 * the chip goes; the kill switch still removes it at once, and the drawer opening unmounts it with the header. */
export const HOLD_MS = 1500;

export default function StaleLayerChip({ stale, onOpen, textClass = '' }) {
  const { model, layer, hour, windOn } = stale || {};
  const last = useRef({ state: null, at: 0, key: null });
  const key = `${model}|${layer}|${windOn}`;   // a new model / layer / wind choice is a new subject: no hold carries over
  const read = () => {
    const now = Date.now();
    if (last.current.key !== key) last.current = { state: null, at: 0, key };   // the hour alone (a scrub) keeps the hold
    const s = stale ? readStaleChip({ model, layer, hour, windOn }) : null;
    if (s) { last.current = { state: s, at: now, key }; return s; }
    if (staleChipKilled() || !last.current.state || now - last.current.at > HOLD_MS) { last.current = { state: null, at: 0, key }; return null; }
    return last.current.state;   // inside the hold: keep the last words
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    const timer = setInterval(() => setState(read()), 500);   // the engine publishes the painted grid; polled like the status line
    return () => clearInterval(timer);
  }, [model, layer, hour, windOn]);
  if (!state) return null;
  return (
    <div className="weather-stale-chip-row flex justify-center pb-1">
      <button type="button" data-stale-chip={state.kind} aria-label={`${state.short}. ${state.text}`} title={state.text}
        aria-expanded={false} aria-controls="weather-mobile-timeline-body" onClick={onOpen}
        className={`weather-stale-chip inline-flex items-center gap-1 max-w-full truncate text-[11px] leading-4 px-2 py-0.5 rounded-full border border-current focus:outline-none focus-visible:ring-2 focus-visible:ring-current ${textClass}`}>
        <Clock className="w-3 h-3 shrink-0" aria-hidden="true" focusable="false" />
        <span className="truncate">{state.short}</span>
      </button>
    </div>
  );
}
