/**
 * pointRatingClient.js — the map infobox's surf-quality verdict from GET /api/weather/point-rating
 * (A15-05(b), 2026-09-26).
 *
 * The infobox badge used to be graded HERE, in the browser, by surfRating.js computeSurfRating: the
 * backend's breaking height, but the browser's Open-Meteo wind and no break depth, so it could
 * disagree with the glyph beside it about the same spot-hour. The backend now answers with what the
 * app already shows: the glyph's own precomputed item at a catalogued spot, rate_one_spot + the
 * observation gate anywhere else (services/weather_pipeline/point_rating.py). This module only
 * fetches and shapes that answer; it computes nothing.
 */
import { BACKEND_URL } from '../../lib/apiClient';

export const POINT_RATING_URL = `${BACKEND_URL}/api/weather/point-rating`;

/** One key per coordinate (4 dp, ~11 m, the backend's own rounding) + model + hour, or null. */
export function pointRatingKey({ lat, lng, model, validTime }) {
  if (lat == null || lng == null || !validTime) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return `${(model || 'GFS').toUpperCase()}|${validTime}|${la.toFixed(4)}|${ln.toFixed(4)}`;
}

/** Throws on a non-2xx (503 = the live lane is at capacity) or an aborted request. */
export async function fetchPointRating({ lat, lng, model = 'GFS', validTime, signal }) {
  const url = `${POINT_RATING_URL}?lat=${Number(lat).toFixed(4)}&lng=${Number(lng).toFixed(4)}`
    + `&valid_time=${encodeURIComponent(validTime)}&model=${encodeURIComponent((model || 'GFS').toUpperCase())}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`point-rating ${res.status}`);
  return res.json();
}

/**
 * PURE: the badge's rating from the response, or null when there is no verdict to show. The card
 * reads { score, level }; source/servedValidTime say whether it came from a (possibly stale) frame.
 */
export function mapPointRatingResponse(json) {
  const r = json && json.rating;
  if (!r || r.score == null || !r.level || r.level === 'unknown') return null;
  return {
    score: r.score,
    level: r.level,
    source: json.source || null,
    servedValidTime: json.served_valid_time || null,
    why: r.why || null,
    limiter: r.limiter || null,
  };
}
