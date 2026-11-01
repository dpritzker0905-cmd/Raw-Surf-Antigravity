import { getSeriesAnchorMs } from './backendWeatherServiceClient';

/**
 * W-5 / T-09 (scrub audit 2026-10-18): the per-hour marine cache (30 min) and WIND_CACHE (10 min) are keyed by hour OFFSET,
 * and an offset names an instant only relative to THE anchor (getSeriesAnchorMs: now rounded to the hour, which flips at
 * hh:30). After a flip, offset N names an instant one hour later, so an entry written before it would be served one hour
 * off under the same label (always for hourly wind; at a snap boundary for 3-hourly marine) and parity would read true.
 * Rather than re-key ~20 string-built sites, each cache calls this at its entry points: when the anchor has moved since
 * the cache last looked, the cache is dropped (series pages are anchor-keyed already, F-01, so scrubbing stays warm).
 * Kill: window.__RAW_DISABLE_OFFSET_CACHE_ROLL__ = true. Counter: window.__OFFSET_CACHE_ROLL__[name].
 */
const lastAnchor = new Map();

/** THE anchor, or null where it cannot be read (a partial module mock): no anchor means no roll, never a throw. */
export function readAnchorMs() {
  try { return typeof getSeriesAnchorMs === 'function' ? getSeriesAnchorMs() : null; } catch (e) { return null; }
}

export function rollOffsetCache(name, clear) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_OFFSET_CACHE_ROLL__ === true) return false;
  const anchor = readAnchorMs();
  if (anchor === null) return false;
  const prev = lastAnchor.get(name);
  lastAnchor.set(name, anchor);
  if (prev === undefined || prev === anchor) return false;
  clear();
  if (typeof window !== 'undefined') {
    const d = (window.__OFFSET_CACHE_ROLL__ = window.__OFFSET_CACHE_ROLL__ || {});
    d[name] = (d[name] || 0) + 1;
  }
  return true;
}

/** True when the anchor moved since `anchorMs` was read: a result fetched across the flip must not be cached under its offset. */
export function anchorMovedSince(anchorMs) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_OFFSET_CACHE_ROLL__ === true) return false;
  const now = readAnchorMs();
  return now !== null && anchorMs !== null && now !== anchorMs;
}

export function _resetOffsetCacheAnchorForTest() { lastAnchor.clear(); }
