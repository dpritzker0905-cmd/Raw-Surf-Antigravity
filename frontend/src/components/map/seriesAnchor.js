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

/**
 * Hours the anchor sits PAST the model's UTC cadence grid: `anchorHourUTC % cadenceHours`, in
 * [0, cadenceHours). NEVER THROWS; an unresolvable anchor returns 0, which is exactly the
 * pre-2026-09-23 lattice.
 *
 * T-01 (audit 14.1): marine products exist only at 00/03/06/... UTC, but the series lane
 * requested offsets 0,3,6 from an HOUR-ROUNDED anchor, so at a 01:00 anchor its frames landed
 * at 01/04/07 — instants no stored product has. The wheel then drew 04:00 while the coverage
 * lane selected 06:00 for the same handle (measured live). Offsets must sit on the grid.
 */
export function seriesGridPhase(cadenceHours = 3) {
  try {
    const iso = (typeof getSeriesAnchorIso === 'function') ? getSeriesAnchorIso() : null;
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t) || !(cadenceHours > 1)) return 0;
    const hour = Math.floor(t / 3600000);
    return ((hour % cadenceHours) + cadenceHours) % cadenceHours;
  } catch (e) {
    return 0;
  }
}

/**
 * The grid-aligned hour offset NEAREST to `hourOffset` (offsets stay relative to the anchor, so
 * every existing consumer keeps its meaning). Offsets are integers and the grid spacing is 3, so
 * the nearest point is always unique — the same instant the manifest lane picks.
 */
export function alignToCadenceGrid(hourOffset, cadenceHours = 3, phase = seriesGridPhase(cadenceHours)) {
  const h = Number(hourOffset) || 0;
  return Math.round((h + phase) / cadenceHours) * cadenceHours - phase;
}
