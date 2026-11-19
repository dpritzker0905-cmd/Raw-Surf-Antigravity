/**
 * marineAllLandRedrive.js: the engine-empty render backstop, capped when the view is ALL LAND (2026-11-18; log
 * docs/weather-program/log/2026-11-19-opus-all-land-backoff.md).
 *
 * WHY. When every height in the committed grid is zero (the view holds no ocean), the WebGL layer correctly refuses it
 * (`__MARINE_RENDER_SOURCE_DIAG__.renderBlockedReason === 'all_zero_grid'`) and the engine stays empty. The render backstop in
 * useMarineScrubSettle then re-drove the settle check every ~6 s for as long as the view stayed put, and a re-drive that misses the
 * series cache asks `/grid` of the 1-CPU box that also serves production.
 *
 * WHAT. Only for that case (engine empty AND the render diagnostics say all-zero): re-drive with exponential backoff
 * (BACKOFF_MS: 6, 12, 24, 48, 96 s) and stop after MAX_REDRIVES for the same EPISODE (model, layer, hour, view at 0.5 deg). Any change
 * of episode re-arms. An empty engine for any other reason (a cold load) is untouched: the caller's 6 s cadence applies.
 * Kill: window.__RAW_DISABLE_ALL_LAND_BACKOFF__ = true. Telemetry: window.__RAW_ALL_LAND_REDRIVE__ { fired, held, stopped }.
 */
export const BACKOFF_MS = [6000, 12000, 24000, 48000, 96000];
export const MAX_REDRIVES = BACKOFF_MS.length;

export const allLandBackoffOn = (w = (typeof window !== 'undefined' ? window : {})) => w.__RAW_DISABLE_ALL_LAND_BACKOFF__ !== true;

/** The view, at 0.5 deg, with model, layer and hour: a re-drive budget belongs to one of these. */
export function allLandEpisode({ model, layer, hour, bounds }) {
  const r5 = (v) => (Math.round(Number(v) * 2) / 2).toFixed(1);
  const b = bounds ? [bounds.west, bounds.south, bounds.east, bounds.north].map(r5).join(',') : 'none';
  return `${model || 'GFS'}|${layer || 'waves'}|${hour}|${b}`;
}

/**
 * Decide one backstop tick for an all-zero view. `state` is { episode, count, lastAt } (mutated by the caller with `next`).
 * Returns { fire, next, reason }: fire = re-drive now; next = the state after this tick.
 */
export function planAllLandRedrive({ on, allZero, episode, state, nowMs }) {
  const s = state && state.episode === episode ? state : { episode, count: 0, lastAt: -Infinity };
  if (!on || !allZero) return { fire: true, next: { episode, count: 0, lastAt: nowMs }, reason: on ? 'not_all_zero' : 'disabled' };
  if (s.count >= MAX_REDRIVES) return { fire: false, next: s, reason: 'stopped' };
  const gap = s.count === 0 ? 0 : BACKOFF_MS[s.count - 1];
  if (nowMs - s.lastAt < gap) return { fire: false, next: s, reason: 'backoff' };
  return { fire: true, next: { episode, count: s.count + 1, lastAt: nowMs }, reason: 'all_zero_redrive' };
}

export function noteAllLand(reason) {
  if (typeof window === 'undefined') return;
  const t = window.__RAW_ALL_LAND_REDRIVE__ = window.__RAW_ALL_LAND_REDRIVE__ || { fired: 0, held: 0, stopped: 0 };
  if (reason === 'all_zero_redrive') t.fired += 1; else if (reason === 'backoff') t.held += 1; else if (reason === 'stopped') t.stopped += 1;
}
