// windSeriesWarm.js
// The wind timeline warm: on settle, scrub start and first mount, ask windGridSeries for the series
// pages of the CURRENT view. Lifted out of WeatherEngine.js so the pan-session replay
// (windSeriesPan.replay.test.js) drives this exact code, and so the component is not the only place
// the wiring can be checked.
//
// The change from the version that lived in WeatherEngine: the work now belongs to the view that
// asked for it. One AbortController for the whole effect meant a pan never cancelled the previous
// pan's 14-day timeline (a mini plus two 48-frame pages, ~20 s of the 1-CPU box each; see the note
// above windSeriesSupersedeEnabled in windGridSeries.js). `intent.signalFor(identity)` returns a
// signal that is aborted when the view moves to another regional series key, and shares one
// lifetime signal for every wide ('global') view, whose series is reused by every pan.
//
// Kill: window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__ = true makes signalFor return the lifetime
// signal, which is the previous single-controller behaviour.

import {
  ensureWindSeries, prewarmWindSeries, windSeriesViewportIdentity, windSeriesSupersedeEnabled,
} from './windGridSeries';
import { createSeriesViewportIntent } from './marineSeriesWorkPolicy';

function viewportOf(map) {
  const b = map.getBounds();
  return { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) };
}

/**
 * Start the warm for `model` on `map`. `hour` is the hour offset the effect was created with (the
 * same value the inline effect closed over). Returns a stop function (effect cleanup).
 */
export function startWindSeriesWarm({ map, model, hour = 0 }) {
  if (!map) return () => {};
  let cancelled = false;
  const intent = createSeriesViewportIntent(windSeriesSupersedeEnabled);

  const kick = () => {
    if (cancelled) return;
    try {
      const bounds = viewportOf(map);
      ensureWindSeries(model, bounds, hour, intent.signalFor(windSeriesViewportIdentity(model, bounds)));
    } catch (e) { /* map not ready — ignore */ }
  };
  // On scrub start, eagerly load EVERY page so any hour the user jumps to during a fast drag
  // is already cached (the during-drag path reads getWindSeriesFrame synchronously). This is what
  // keeps the 14-day scrubber whole now that the adjacent page is no longer prefetched blind.
  const onScrubStart = () => {
    if (cancelled) return;
    try {
      const bounds = viewportOf(map);
      prewarmWindSeries(model, bounds, intent.signalFor(windSeriesViewportIdentity(model, bounds)));
    } catch (e) { /* map not ready — ignore */ }
  };

  const timer = setTimeout(kick, 600);
  map.on('moveend', kick);
  if (typeof window !== 'undefined') window.addEventListener('timeline_scrub_start', onScrubStart);

  return () => {
    cancelled = true;
    clearTimeout(timer);
    intent.abort();
    try { map.off('moveend', kick); } catch (e) { /* map may be disposed */ }
    if (typeof window !== 'undefined') window.removeEventListener('timeline_scrub_start', onScrubStart);
  };
}
