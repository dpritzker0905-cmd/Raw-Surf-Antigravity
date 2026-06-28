/**
 * spotRatingsClient.js — fetch per-spot surf-quality ratings from the P1 backend endpoint
 * (GET /api/weather/spot-ratings). This is the ACCURATE source for the map's rating glyphs: the backend
 * resolves each surf spot at its PRECISE location (best-resolution tile + bathymetry + wind) instead of the
 * frontend sampling the coarse rating grid (which is wrong at remote/unwarmed spots). See useSpotRatings.js.
 */
import { BACKEND_URL } from '../../lib/apiClient';
import { RATING_COLOR, RATING_LABEL } from './surfRating';

export const SPOT_RATINGS_URL = `${BACKEND_URL}/api/weather/spot-ratings`;

/**
 * Fetch ratings for every active surf spot in the viewport bbox at the given forecast time + model.
 * Returns the raw response { model, valid_time, count, source, spots:[{spot_id, score, level, ...}] }.
 * Throws on a non-2xx / aborted request (the caller keeps the prior ratings on failure).
 */
export async function fetchSpotRatings({ bbox, validTime, model = 'GFS', limit = 60, signal }) {
  if (!bbox || !validTime) throw new Error('fetchSpotRatings: bbox + validTime required');
  const url = `${SPOT_RATINGS_URL}?bbox=${encodeURIComponent(bbox)}`
    + `&valid_time=${encodeURIComponent(validTime)}&model=${encodeURIComponent(model)}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`spot-ratings ${res.status}`);
  return res.json();
}

/**
 * Map the endpoint's `spots` array to the glyph-rating shape MapMarkerLayers consumes, keyed by spot id.
 * Only spots with a real score become glyphs (a null score = no rideable surf → plain pin, the same graceful
 * fallback as the grid-sample path). Pure + unit-testable.
 */
export function mapSpotRatingsResponse(spots) {
  const out = {};
  if (!Array.isArray(spots)) return out;
  for (const sp of spots) {
    if (!sp || sp.spot_id == null) continue;
    if (sp.score == null) continue;                 // unrated → no glyph
    const level = sp.level || 'unknown';
    out[sp.spot_id] = {
      score: Math.round(sp.score),
      level,
      color: RATING_COLOR[level],
      label: RATING_LABEL[level],
      confidence: sp.confidence || 'low',
      why: sp.why || null,
      source: 'endpoint',
    };
  }
  return out;
}
