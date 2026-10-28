/**
 * infoboxFrameTime.js — the infobox's clock, and the words that say which frame its numbers come from
 * (audit 2026-10-27, dev 4bd90d0d9; owner: "Display correct data on heat map and in infobox"). Pure.
 *
 * P1-E  ONE CLOCK. A forecast hour names the instant getSeriesAnchorMs() + hour * 1 h, in UTC: the instant the heatmap,
 *       the series pages and every point ask use. The infobox added hours on the LOCAL wall clock
 *       (`d.setHours(d.getHours() + h)`), which is h + 1 real hours once a DST change falls inside the 14-day wheel
 *       (US DST ends Sun 2026-11-01): past it temperature, gusts, rain and the header time were an hour off for US users.
 *       Kill: window.__RAW_DISABLE_INFOBOX_UTC_HOURS__ = true (local wall-clock arithmetic again).
 * P1-C  WHICH FRAME. A point answer carries the frame the server actually read (served_valid_time) next to the ask; the
 *       infobox now says so in the heatmap's own words (drawnFrameReadout.describeDrawnFrame, #587/#610): "Showing <time>:
 *       the nearest stored forecast", "Holding <time>’s <model> forecast: …", "Estimated forecast: …".
 * P1-D  WHICH HOUR. A /point answer is ONE instant (the hourly array has one row, the ask), so it "matches" any wheel hour
 *       at index 0. While the wheel moves, or after the anchor rolls past the half hour, the box kept the last settled
 *       hour's numbers with no label. An answer whose ask is not this selection's ask is HELD: the values stay (rows that
 *       vanish mid-scrub would be worse), dimmed, with the heatmap's pending words "Loading <selected>… still showing <time>".
 *       Kill for P1-C and P1-D together: window.__RAW_DISABLE_INFOBOX_FRAME_WORDS__ = true.
 * P2    The Rating badge comes from /point-rating, which can answer from another stored frame than the Surf number
 *       (pointRatingClient maps served_valid_time and nothing showed it): the row now says "from <time>" when the two
 *       differ. Kill: window.__RAW_DISABLE_INFOBOX_RATING_TIME__ = true.
 */
import { getSeriesAnchorMs, getSharedValidTime } from './backendWeatherServiceClient';
import { describeDrawnFrame, formatInstant, latticeNearestMaxHours } from './drawnFrameReadout';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const killed = (name) => typeof window !== 'undefined' && window[`__RAW_DISABLE_${name}__`] === true;

/** The instant forecast hour `hour` names (P1-E). */
export function forecastHourMs(hour) {
  const h = Number.isFinite(Number(hour)) ? Number(hour) : 0;
  if (killed('INFOBOX_UTC_HOURS')) {
    const d = new Date();
    d.setHours(d.getHours() + h);
    return d.getTime();
  }
  return getSeriesAnchorMs() + h * HOUR_MS;
}

const parseMs = (iso) => {
  if (!iso) return null;
  const s = String(iso);
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(ms) ? ms : null;
};

/** The instant the point's numbers describe: the frame the server read, else the instant it answered (its ask). */
export function pointDataMs(point) {
  if (!point) return null;
  return parseMs(point.served_valid_time) ?? parseMs(point.time);
}

/**
 * Does this point answer the CURRENT selection? true / false, or null when the question does not apply (a multi-hour
 * response re-selects its own hour, selectExactPointHour; no ask to compare). A one-instant answer answers its ask only.
 */
export function pointAnswersSelection(point, askIso) {
  if (!point || point.timeRangeStart == null || point.timeRangeStart !== point.timeRangeEnd) return null;
  const askedMs = parseMs(point.time);
  const nowAskMs = parseMs(askIso);
  if (askedMs == null || nowAskMs == null) return null;
  return askedMs === nowAskMs;
}

// Words for a point answer that is a model read standing in for the selected model's own data, not an estimate.
export const STAND_IN_WORDS = {
  ecmwf_wam_direct_read: 'EURO stand-in: ECMWF’s own wave model, read directly',
};

/**
 * The infobox's frame words, or null when its numbers are the selection's own frame. { state, text, held, dataMs }
 * held = the numbers answer ANOTHER hour (render them provisional).
 */
export function describeInfoboxFrame({ point, model, layer, hour, askIso, nearestMaxHours, nowMs = Date.now() } = {}) {
  if (!point || killed('INFOBOX_FRAME_WORDS')) return null;
  const dataMs = pointDataMs(point);
  if (dataMs == null) return null;
  const labelMs = forecastHourMs(hour);
  const instantMs = parseMs(askIso);
  const answers = pointAnswersSelection(point, askIso);
  const held = answers === false && Math.abs(dataMs - labelMs) >= HOUR_MS / 2;
  const basisType = point.estimate_basis && point.estimate_basis.type;
  const standIn = STAND_IN_WORDS[basisType] || null;
  const requested = { model, layer, hour: Number(hour), labelMs, instantMs,
    // A held answer is never "the nearest stored forecast": the selection's own frame exists, it is not fetched yet.
    nearestMaxHours: held ? 0 : nearestMaxHours };
  const drawn = { model: point.requestedModel || model, layer: point.activeLayer || layer,
    hour: held ? null : Number(hour), dataMs, estimated: point.is_estimated === true && !standIn, basisType };
  let r = describeDrawnFrame(requested, drawn, { nowMs });
  // "Loading" promises a fetch. For an answer to THIS ask (or a multi-hour response past its own range) none is coming:
  // the frame IS the nearest the server or the response holds, so say that instead.
  // (A large FINITE bound: describeDrawnFrame reads a non-finite one as its 3 h default.)
  if (r && r.state === 'pending' && !held) r = describeDrawnFrame({ ...requested, nearestMaxHours: 1e9 }, drawn, { nowMs });
  if (r) return { ...r, held, dataMs };
  if (standIn) return { state: 'stand_in', text: standIn, held, dataMs };
  return null;
}

/** "Tue, Oct 27, 3 PM": the header's time for the numbers below it. */
export function infoboxTimeLabel(ms) {
  return Number.isFinite(ms) ? formatInstant(ms, true) : '';
}

/**
 * Everything MapForecastOverlay renders about time, in one call: { words, held, dataMs, refMs, timeLabel, timeClass, wordsClass }.
 * `checkAsk`: the layer's point client asks through getSharedValidTime (marine + wind; pressure/rain snap their own ask).
 * The lattice rule is the heatmap status line's (latticeNearestMaxHours on the anchor + hour and the drawn frame's cycle).
 * Classes cover all three themes (the overlay's own muted classes know only light).
 */
export function infoboxFrameView({ point, model, layer, hour, checkAsk = true, runMs = null, theme = 'dark', nowMs } = {}) {
  const h = Number.isFinite(Number(hour)) ? Number(hour) : 0;
  let askIso = null;
  if (checkAsk) {
    try { askIso = getSharedValidTime(h, layer, model, { readOnly: true }); } catch (e) { askIso = null; }
  }
  const nearestMaxHours = latticeNearestMaxHours(model, h, { selectedMs: getSeriesAnchorMs() + h * HOUR_MS, runMs });
  const words = describeInfoboxFrame({ point, model, layer, hour: h, askIso, nearestMaxHours, ...(nowMs != null ? { nowMs } : {}) });
  const dataMs = pointDataMs(point);
  const refMs = dataMs ?? forecastHourMs(h);
  const warn = !!words && (words.state === 'pending' || words.state === 'held');
  const light = theme === 'light';
  const beach = theme === 'beach';
  return {
    words, held: !!(words && words.held), dataMs, refMs,
    timeLabel: infoboxTimeLabel(refMs),
    timeClass: light ? 'text-gray-600' : beach ? 'text-cyan-100' : 'text-gray-300',
    wordsClass: light ? `border-gray-200 ${warn ? 'text-amber-700' : 'text-gray-600'}`
      : beach ? `border-cyan-900/50 ${warn ? 'text-amber-300' : 'text-cyan-100'}`
        : `border-zinc-800/20 ${warn ? 'text-amber-400' : 'text-gray-300'}`,
  };
}

/** The Rating row's note when the badge answered from another frame than `refMs` (the Surf number's), else null. */
export function ratingFrameNote(rating, refMs) {
  if (!rating || killed('INFOBOX_RATING_TIME')) return null;
  const ratingMs = parseMs(rating.servedValidTime);
  if (ratingMs == null || !Number.isFinite(refMs) || Math.abs(ratingMs - refMs) < HOUR_MS / 2) return null;
  const dated = Math.abs(ratingMs - refMs) >= DAY_MS;
  return `from ${formatInstant(ratingMs, dated)}`;
}
