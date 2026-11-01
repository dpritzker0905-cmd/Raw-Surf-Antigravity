import React from 'react';
import { useWindDrawnFrame } from './marineDrawnFrame';
import { describeDrawnFrame, latticeNearestMaxHours } from './drawnFrameReadout';
import { getSeriesAnchorMs, getSharedValidTime } from './backendWeatherServiceClient';

// W-1 for WIND (2026-10-19, visual lab on dev 697ad069: wind off-lattice hours held the nearest frame with no words): what
// the wind engine DREW against the hour the user SELECTED, published at WebGLWindLayer's handoff (marineDrawnFrame.js
// publishWindDrawn). Compares by instant (#267). HRRR drawn under a GFS selection is the wind lane by design (D-017,
// WindLaneStatus names it), not a pending switch. Kill: window.__RAW_DISABLE_WIND_DRAWN_READOUT__ = true.
export function windReadout({ model, hour }, drawn) {
  if (!drawn || (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_DRAWN_READOUT__ === true)) return null;
  let instantMs = null;
  try { instantMs = Date.parse(getSharedValidTime(hour, 'wind', model, { readOnly: true })); } catch (e) { instantMs = null; }
  const laneModel = drawn.model === 'HRRR' && model === 'GFS' ? 'HRRR' : model;
  // Half the stored wind lattice step: 3-hourly series frames are never more than 1 h from the selection (EURO's 6-hourly
  // tail past model step 144: 3 h). Further away is a fetch still owed, so it reads "Loading", never "nearest" (lab run B2, 2026-10-19).
  const labelMs = Number.isFinite(hour) ? getSeriesAnchorMs() + hour * 3600000 : null;   // the selection's own instant (drawnFrameReadout)
  const nearestMaxHours = latticeNearestMaxHours(model, hour, { selectedMs: labelMs, runMs: drawn.runMs, layer: 'wind' });   // the drawn frame's run
  return describeDrawnFrame({ model: laneModel, layer: 'wind', hour, instantMs, labelMs, nearestMaxHours }, drawn);
}

export default function WindTimeStatus({ model, hour, theme, active }) {
  const drawn = useWindDrawnFrame();
  if (typeof window !== 'undefined' && active) window.__RAW_SELECTED_WIND__ = { model, hour };
  const readout = active ? windReadout({ model, hour }, drawn) : null;
  if (!readout) return null;
  const tone = readout.state === 'pending' || readout.state === 'held'   // a hold is a caveat, worded like a load
    ? (theme === 'light' ? 'text-amber-800' : 'text-amber-200')
    : (theme === 'light' ? 'text-slate-600' : theme === 'beach' ? 'text-cyan-100' : 'text-slate-300');
  return (
    <div role="status" aria-live="polite" data-drawn-state={readout.state} data-testid="wind-time-status" className={`mt-1 text-xs ${tone}`}>
      {readout.text}
    </div>
  );
}
