import React, { useCallback, useEffect, useState } from 'react';
import { evaluateMarineTimelineCoverage, readMarineTimelineRenderEvidence, reconcileMarineTimelineCoverage } from './marineTimelineCoverage';
import { useMarineDrawnFrame } from './marineDrawnFrame';
import { describeDrawnFrame, latticeNearestMaxHours } from './drawnFrameReadout';
import { getSharedValidTime } from './backendWeatherServiceClient';
import { HOLD_INDICATOR_MS, holdNoDimKilled } from './marineStaleHour';

// What the map DRAWS against what the user SELECTED, in words, in the same frame (W-1, scrub audit 2026-10-18): the
// drawn-frame record is published by WebGLMarineLayer at the upload (marineDrawnFrame.js), so this line no longer waits
// for a 500 ms poll to notice a switch or a nearest-frame hold (T-05's lag). The older coverage check stays as the
// fallback for a mismatch the drawn record cannot see. Kill: window.__RAW_DISABLE_DRAWN_FRAME_READOUT__ = true.
// A derived diagnostic, never another forecast clock or a trigger for a network request.
// HOLD WITHOUT DIMMING (2026-10-22): the map now holds the last drawn frame at full strength while the selected hour loads
// (marineStaleHour.resolveStaleWorldDim), so this line carries the honesty alone: "Loading <selected>… still showing <drawn>".
// When that has been pending for HOLD_INDICATOR_MS, a small pulsing dot joins it (aria-hidden: the words are the status; it does
// not pulse under prefers-reduced-motion). Kill: window.__RAW_DISABLE_HOLD_NO_DIM__ = true (the dim returns, no dot).
export default function ForecastTimeStatus({ model, layer, hour, theme }) {
  const drawn = useMarineDrawnFrame();
  const readoutOff = typeof window !== 'undefined' && window.__RAW_DISABLE_DRAWN_FRAME_READOUT__ === true;
  let instantMs = null;   // what a fetch for the selected hour asks for now: the app's own hour -> instant mapping (read-only)
  try { instantMs = Date.parse(getSharedValidTime(hour, layer, model, { readOnly: true })); } catch (e) { instantMs = null; }
  // Half the stored marine lattice step (3-hourly; EURO WAM 6-hourly past 144 h): a frame further off is an exact upgrade
  // still owed, so it reads "Loading", never "nearest" (same rule as WindTimeStatus, 2026-10-19).
  const nearestMaxHours = latticeNearestMaxHours(model, hour);
  const readout = readoutOff ? null : describeDrawnFrame({ model, layer, hour, instantMs, nearestMaxHours }, drawn);
  if (typeof window !== 'undefined') window.__RAW_SELECTED_FRAME__ = { model, layer, hour, instantMs };   // instruments compare by instant

  const readStatus = useCallback(() => {
    if (typeof window === 'undefined') return 'unknown';
    const timeline = window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
    if (!timeline || timeline.activeModel !== model || timeline.activeLayer !== layer) return 'unknown';
    reconcileMarineTimelineCoverage();
    return evaluateMarineTimelineCoverage(timeline, readMarineTimelineRenderEvidence(model, layer), hour).temporalStatus;
  }, [model, layer, hour]);
  const [status, setStatus] = useState(readStatus);
  const pendingKey = readout && readout.state === 'pending' ? readout.text : null;
  const [longPending, setLongPending] = useState(false);
  useEffect(() => {
    setLongPending(false);
    if (!pendingKey || holdNoDimKilled()) return undefined;
    const t = setTimeout(() => setLongPending(true), HOLD_INDICATOR_MS);
    return () => clearTimeout(t);
  }, [pendingKey]);
  useEffect(() => {
    setStatus(readStatus());
    const timer = setInterval(() => setStatus(readStatus()), 500);
    return () => clearInterval(timer);
  }, [readStatus]);

  const tone = theme === 'light' ? 'text-amber-800' : 'text-amber-200';
  const quiet = theme === 'light' ? 'text-slate-600' : 'text-slate-300';
  if (readout) {
    return (
      <div role="status" aria-live="polite" data-drawn-state={readout.state} aria-busy={readout.state === 'pending' ? true : undefined}
        data-hold-indicator={longPending ? 'on' : undefined}
        className={`mt-1 text-xs ${readout.state === 'pending' ? tone : quiet}`}>
        {longPending && (
          <span aria-hidden="true" data-testid="hold-indicator"
            className="inline-block w-1.5 h-1.5 mr-1.5 align-middle rounded-full bg-current animate-pulse motion-reduce:animate-none" />
        )}
        {readout.text}
      </div>
    );
  }
  const mismatch = status === 'response_time_mismatch' || status === 'render_time_mismatch';
  if (!mismatch && status !== 'render_time_unverified') return null;
  return (
    <div role="status" aria-live="polite" className={`mt-1 text-xs ${tone}`}>
      {mismatch ? 'Forecast time does not match this selection.' : 'Verifying displayed forecast time.'}
    </div>
  );
}
