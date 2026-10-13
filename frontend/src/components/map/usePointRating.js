/**
 * usePointRating — the infobox badge's surf-quality verdict for one coordinate + hour, from the
 * backend (see pointRatingClient.js). Returns { score, level, ... } or null.
 *
 * null while the answer is pending, when the backend has no verdict, or when the request failed:
 * the Rating card is then simply absent. There is deliberately NO browser-side fallback — a second
 * rating computed here is exactly the divergence this hook exists to remove (A15-05(b)).
 * A rating is only ever returned for the key it was fetched for, so a new hour or a new point never
 * shows the previous one's verdict.
 */
import { useEffect, useState } from 'react';
import { getSharedValidTime } from './backendWeatherServiceClient';
import { fetchPointRating, mapPointRatingResponse, pointRatingKey } from './pointRatingClient';

const CACHE_MAX = 200;
const _cache = new Map();   // key -> mapped rating (null included: "no verdict" is an answer)

function remember(key, rating) {
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, rating);
}

/** Test hook: forget every remembered answer. */
export function clearPointRatingCache() {
  _cache.clear();
}

export function usePointRating({ enabled, lat, lng, model, timeOffsetHours }) {
  let validTime = null;
  if (enabled) {
    // The glyph's own hour key (useSpotRatings: getSharedValidTime(offset, 'waves', model)). readOnly
    // because this runs during render: same answer, without a manifest refresh or diagnostic write.
    try { validTime = getSharedValidTime(timeOffsetHours, 'waves', model || 'GFS', { readOnly: true }); } catch (e) { validTime = null; }
  }
  const key = enabled ? pointRatingKey({ lat, lng, model, validTime }) : null;
  const [state, setState] = useState({ key: null, rating: null });

  useEffect(() => {
    if (!key || _cache.has(key)) return undefined;
    const controller = new AbortController();
    fetchPointRating({ lat, lng, model, validTime, signal: controller.signal })
      .then((json) => {
        const rating = mapPointRatingResponse(json);
        remember(key, rating);
        setState({ key, rating });
      })
      .catch((e) => {
        if (e && e.name === 'AbortError') return;
        // Not remembered: a 503 (live lane at capacity) is retried the next time this key is asked.
        setState({ key, rating: null });
      });
    return () => controller.abort();
  }, [key, lat, lng, model, validTime]);

  if (!key) return null;
  if (_cache.has(key)) return _cache.get(key);
  return state.key === key ? state.rating : null;
}
