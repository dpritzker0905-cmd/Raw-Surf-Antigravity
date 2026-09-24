// seriesAnchor.js — the ONE place the series lanes turn the forecast anchor into a request
// parameter and a cache-key fragment.
//
// F-01 (audit 14.0) gave `/grid_series` an absolute `base_time` so the browser's anchor and the
// backend's stop being two independent clocks. The marine lane got it first and grew these two
// helpers locally; the wind lane then needed exactly the same pair. Copying them would have
// recreated the very shape F-01 was about — two lanes each deriving the same quantity — so they
// live here and both lanes import them.
//
// ⚠️ DELIBERATELY ITS OWN MODULE, not part of backendWeatherServiceClient. Several suites
// `jest.mock('./backendWeatherServiceClient')`, and CRA's `resetMocks: true` then strips the mock
// implementations, so `getSeriesAnchorIso` becomes a spy returning `undefined`. These wrappers must
// survive that: if they lived in the mocked module they would be mocked away too, and the guard
// below would be worthless.

import { getSeriesAnchorIso } from './backendWeatherServiceClient';

/**
 * `@<iso>` for a cache key, or `''` when the anchor cannot be resolved.
 *
 * NEVER THROWS. This is reached from scrub, cancellation and slot-accounting paths; an exception
 * here would abort a fetch mid-flight and strand its concurrency slot. A missing anchor degrades to
 * the pre-2026-09-20 single-bucket behaviour — a stale-cache risk at the hour rollover, not a crash.
 */
export function seriesAnchorTag() {
  try {
    const iso = (typeof getSeriesAnchorIso === 'function') ? getSeriesAnchorIso() : null;
    return iso ? `@${iso}` : '';
  } catch (e) {
    return '';
  }
}

/**
 * `&base_time=<encoded iso>` for a request URL, or `''` when the anchor cannot be resolved.
 *
 * Omitted rather than sent empty: `base_time` is an OPTIONAL query parameter, and a backend that
 * receives none keeps its own clock (the documented legacy behaviour) instead of parsing a
 * malformed value and rejecting it.
 */
export function seriesAnchorParam() {
  const tag = seriesAnchorTag();
  return tag ? `&base_time=${encodeURIComponent(tag.slice(1))}` : '';
}
