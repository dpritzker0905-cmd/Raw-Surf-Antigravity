/**
 * spotHubP1.js: spot-hub phase 1 (2026-11-03). One home for the hub, drawer, explore and infobox
 * pieces that changed together: the forecast window per tier, the day-scroll index, the "—" for a
 * missing value, and the tide's honest label. Nothing here computes a forecast number.
 *
 * ⭐ ONE TIER RESOLVER. Every hub surface used to carry its own tier ladder (SpotHub 3/7/14,
 * SpotConditions 3/7/10, the server's 3/7/10 "days after today"), none of them the map's. The map's
 * picker and scrubber take their window from LayerAccessResolver.resolveForecastWindow (clamped by
 * /capabilities) and their models from getAllowedModels; this module asks the same two functions and
 * nothing else, so a hub can never offer a day the scrubber cannot reach, or hide one it can.
 *
 * ⚠️ THE WINDOW IS ROLLING, as the scrubber's is: free = the next 72 h, not "today + 2 calendar
 * days". A daily row (one 12:00 UTC sample, see forecastCalendar.js) is open when that sample is at
 * most `days * 24` hours from now, which is exactly the hour the scrubber can reach. A calendar
 * definition is an owner decision still open; change it in the resolver, not here.
 *
 * Kill switch: window.__RAW_DISABLE_SPOT_HUB_P1__ = true restores every surface's previous output.
 */
import { getAllowedModels, getUserTier, resolveForecastWindow } from '../map/LayerAccessResolver';

// The display and tide helpers live in spotHubP1Format.js (no resolver import, so the map's point
// client can use them); re-exported here so the hub surfaces have one import.
export * from './spotHubP1Format';

// The hub's rows are wave rows, so the window is clamped by the model's `waves` capability row, the
// same row the map's wave layer is clamped by.
export const HUB_CAPABILITY_LAYER = 'waves';
const HOUR_MS = 3600 * 1000;

/**
 * The window the map would give this user on this model: { tier, days, hours, model, modelAllowed }.
 * A model the tier may not use (getAllowedModels) falls back to the first one it may, as the map's
 * picker does, so the hub never asks for, or labels, a model the user cannot select.
 */
export function hubForecastWindow(userOrTier, model = 'GFS') {
  const tier = getUserTier(userOrTier);
  const allowedModels = getAllowedModels(userOrTier);
  const requested = String(model || 'GFS').toUpperCase();
  const modelAllowed = allowedModels.includes(requested);
  const effectiveModel = modelAllowed ? requested : (allowedModels[0] || 'GFS');
  const days = resolveForecastWindow(userOrTier, effectiveModel, HUB_CAPABILITY_LAYER);
  return { tier, days, hours: days * 24, model: effectiveModel, modelAllowed, isPremium: tier === 'premium' };
}

/**
 * The hours to split by: the resolver's, never more than the server says it applied
 * (`forecast_horizon_hours`). Reflection review (2026-11-03): the two compute the same window from
 * two clocks (and the client's capabilities may not be loaded yet), so near the boundary they could
 * disagree; taking the smaller keeps a row the server withheld from ever being counted as open. PURE.
 */
export function effectiveWindowHours(resolverHours, serverHours) {
  const s = Number(serverHours);
  return serverHours != null && Number.isFinite(s) && s >= 0 ? Math.min(resolverHours, s) : resolverHours;
}

/** The instant a daily row stands for (its 12:00 UTC sample), or NaN for a malformed date. PURE. */
export function rowInstantMs(dateId) {
  if (typeof dateId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateId)) return NaN;
  return Date.parse(`${dateId}T12:00:00Z`);
}

/**
 * Split daily rows into the ones the window opens and the locked previews. PURE.
 * `lockedDates` are the dates a server that no longer sends beyond-window data still names, so the
 * upsell previews survive; a locked entry carries its date and nothing else, whatever arrived.
 */
export function splitForecastWindow(forecast, hours, nowMs = Date.now(), lockedDates = []) {
  const open = [];
  const locked = [];
  const seen = new Set();
  for (const row of Array.isArray(forecast) ? forecast : []) {
    const t = rowInstantMs(row && row.date);
    if (!Number.isFinite(t) || seen.has(row.date)) continue;
    seen.add(row.date);
    if (t - nowMs <= hours * HOUR_MS) open.push(row);
    else locked.push({ date: row.date, locked: true });
  }
  for (const d of Array.isArray(lockedDates) ? lockedDates : []) {
    if (Number.isFinite(rowInstantMs(d)) && !seen.has(d)) {
      seen.add(d);
      locked.push({ date: d, locked: true });
    }
  }
  locked.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { open, locked };
}

/**
 * The row the map's hour falls in, or -1 when it falls before the first row (today: the hub shows
 * today as current conditions, not as a forecast card). Rows are UTC dates, so the hour is placed by
 * its UTC date; past the last row it is the last row. PURE.
 * ⛔ The old `Math.floor(offset / 24)` indexed a tomorrow-first array, so +24 h scrolled to the day
 * AFTER tomorrow and +0 h to tomorrow.
 */
export function forecastDayIndexForOffset(rows, offsetHours, nowMs = Date.now()) {
  if (!Array.isArray(rows) || rows.length === 0) return -1;
  const off = Number(offsetHours);
  const target = new Date(nowMs + (Number.isFinite(off) ? off : 0) * HOUR_MS).toISOString().slice(0, 10);
  const i = rows.findIndex((r) => r && r.date === target);
  if (i >= 0) return i;
  if (target < rows[0].date) return -1;
  return rows.length - 1;
}
