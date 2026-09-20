import React, { useCallback, useEffect, useState } from 'react';
import { evaluateMarineTimelineCoverage, readMarineTimelineRenderEvidence, reconcileMarineTimelineCoverage } from './marineTimelineCoverage';

// A derived diagnostic, never another forecast clock or a trigger for a network request.
export default function ForecastTimeStatus({ model, layer, hour, theme }) {
  const readStatus = useCallback(() => {
    if (typeof window === 'undefined') return 'unknown';
    const timeline = window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
    if (!timeline || timeline.activeModel !== model || timeline.activeLayer !== layer) return 'unknown';
    reconcileMarineTimelineCoverage();
    return evaluateMarineTimelineCoverage(timeline, readMarineTimelineRenderEvidence(model, layer), hour).temporalStatus;
  }, [model, layer, hour]);
  const [status, setStatus] = useState(readStatus);
  useEffect(() => {
    setStatus(readStatus());
    const timer = setInterval(() => setStatus(readStatus()), 500);
    return () => clearInterval(timer);
  }, [readStatus]);
  const mismatch = status === 'response_time_mismatch' || status === 'render_time_mismatch';
  if (!mismatch && status !== 'render_time_unverified') return null;
  return (
    <div role="status" aria-live="polite" className={`mt-1 text-xs ${theme === 'light' ? 'text-amber-800' : 'text-amber-200'}`}>
      {mismatch ? 'Forecast time does not match this selection.' : 'Verifying displayed forecast time.'}
    </div>
  );
}
