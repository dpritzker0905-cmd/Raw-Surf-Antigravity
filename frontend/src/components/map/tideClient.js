/**
 * tideClient.js — tide state + formatting for the spot rating card's tide line (2026-07-18).
 *
 * Tide display RIDES THE RATING TOGGLE (user decision 2026-07-18: no standalone Tides pill) —
 * Rating ON puts tide on the glyph cards, Rating OFF removes the cards entirely. The
 * ONLY tide rides the spot-ratings payload (backend RATING_TIDE lane, baked by the ratings
 * precompute and consistent with the scores it shaped). A payload without it shows NO tide line
 * ("tide unavailable"): the browser-side Open-Meteo fallback that used to fill the gap was removed
 * 2026-11-22 (the owner's licence rule, D-082: no Open-Meteo in any user data).
 */
import { formatHeightFromMeters } from './heightUnits';
import { ratingTide, minusTideWord } from './tideDatum';

// Python round(value, 1) rounds the original binary float, including ties-to-even.
// toFixed uses that original float too, but exact quarter-degree ties require
// an even decimal neighbour rather than its usual away-from-zero tie rule.
function roundTideCoordinate(value) {
  const coordinate = Number(value);
  const fraction = Math.abs(coordinate) % 1;
  if (fraction === 0.25 || fraction === 0.75) {
    const lower = Math.floor(Math.abs(coordinate) * 10);
    return Math.sign(coordinate) * (lower + lower % 2) / 10;
  }
  return Number(coordinate.toFixed(1));
}

/** ~0.1° cell key so nearby spots share the backend tide._round_key cell. */
export function tideCellKey(lat, lng) {
  return `${roundTideCoordinate(lat)},${roundTideCoordinate(lng)}`;
}

const TREND_ARROW = { rising: '↑', falling: '↓', slack: '→' };

/** Decorative arrow for a tide trend (render aria-hidden — the trend WORD is the accessible signal). */
export function trendArrow(trend) {
  return TREND_ARROW[trend] || '';
}

/**
 * Format a tide state ({height_m, trend}) for a readout in the user's ft/m display unit:
 * "-0.2 ft falling" / "0.6 m rising". Plain words only (screen-reader safe — callers add
 * trendArrow visually). Null when the payload carries no usable tide.
 */
export function formatTideLine(tide, heightUnit) {
  if (!tide || tide.height_m == null || Number.isNaN(Number(tide.height_m))) return null;
  // The display datum (tide_datum, one composition): a US rating tide carries display_height_m above MLLW; the
  // payload-less fallback above is an MSL level. Either way the datum is NAMED, never left for the reader to guess.
  const { heightM, datum } = ratingTide(tide);
  const height = formatHeightFromMeters(heightM, heightUnit, { withUnit: true });
  const minus = minusTideWord(heightM, datum);
  const trend = TREND_ARROW[tide.trend] ? tide.trend : null;
  const base = `${height} ${datum.short}${minus ? ` (${minus})` : ''}`;
  return trend ? `${base} ${trend}` : base;
}
