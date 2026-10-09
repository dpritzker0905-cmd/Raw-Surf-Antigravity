/**
 * windLane.js — which wind model is on the map, by PLACE and TIME (2026-10-09, D-017; backend wind_lane.py).
 *
 * The GFS wind map is HRRR (NOAA's 3 km US model) inside HRRR's domain and inside its horizon (about 48 h), and GFS
 * everywhere else and after that, with a 200 km feather at HRRR's edge and a 3 h hand-off at its horizon. The backend
 * stamps every GFS wind grid with `wind_lane`; this module turns that stamp into the words the controls show, so the
 * model change at the horizon is labelled instead of silent (the scrubber is never capped: past HRRR it is GFS).
 *
 * Kill switch, per session: `window.__RAW_DISABLE_WIND_HRRR_LANE__ = true` (set it, then reload the map) sends
 * `wind_lane=gfs` on every wind /grid and /grid_series request, and the backend serves the GFS-only map.
 */

export function windLaneDisabled(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  return !!(w && w.__RAW_DISABLE_WIND_HRRR_LANE__ === true);
}

/** The query suffix for wind grid requests ('' unless the kill switch is set). */
export function windLaneParam(win) {
  return windLaneDisabled(win) ? '&wind_lane=gfs' : '';
}

/** A cache-key suffix, so frames fetched with and without the lane never stand in for each other. */
export function windLaneTag(win) {
  return windLaneDisabled(win) ? '_gfslane' : '';
}

/** The lane stamp of the wind the engine is drawing: the fine overlay when one is filed, else the base. */
export function windLaneOnScreen(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const eng = w && w.__WIND_ENGINE__;
  if (!eng) return null;
  const fine = eng._windFine && eng._windFine.windGrid && eng._windFine.windGrid.wind_lane;
  const base = eng._windData && eng._windData.windGrid && eng._windData.windGrid.wind_lane;
  return fine || base || null;
}

function fmtHour(iso, timeZone) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', ...(timeZone ? { timeZone } : {}) });
  } catch (e) {
    return new Date(ms).toISOString().slice(0, 13) + 'Z';
  }
}

/**
 * The words for a lane stamp: { short, text } or null when there is nothing to add to the "GFS" chip (no stamp: the
 * lane is off, or the grid is not GFS wind). `short` is what the controls print; `text` is the screen-reader sentence.
 * Words, never colour alone (accessibility mandate).
 */
export function describeWindLane(lane, { timeZone } = {}) {
  if (!lane || typeof lane !== 'object') return null;
  const until = fmtHour(lane.hrrr_horizon, timeZone);
  if (lane.lane === 'hrrr+gfs') {
    const wt = typeof lane.time_weight === 'number' ? lane.time_weight : 1;
    if (wt < 1) {
      return {
        short: 'Wind: HRRR → GFS',
        text: `Wind: handing over from HRRR to GFS${until ? `; HRRR ends ${until}` : ''}.`,
      };
    }
    return {
      short: 'Wind: HRRR + GFS',
      text: `Wind: HRRR, NOAA's 3 km model, near the US${until ? ` until ${until}` : ''}; GFS elsewhere.`,
    };
  }
  if (lane.reason === 'beyond_hrrr_horizon') {
    return {
      short: 'Wind: GFS (HRRR ended)',
      text: `Wind: GFS. This hour is past HRRR's last forecast hour${until ? ` (${until})` : ''}.`,
    };
  }
  if (lane.reason === 'outside_hrrr_domain') {
    return { short: 'Wind: GFS', text: 'Wind: GFS. HRRR covers the United States only.' };
  }
  return { short: 'Wind: GFS', text: 'Wind: GFS for this hour.' };
}
