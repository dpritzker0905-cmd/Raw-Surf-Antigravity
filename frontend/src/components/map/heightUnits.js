/**
 * heightUnits.js — the user's wave-height display unit (ft | m), one source of truth (2026-07-12
 * user request: "a m/ft toggle, so people can toggle whether their wave heights are in feet or
 * meters"). Data stays METRIC everywhere internally (grids, ratings, transforms) — this preference
 * only affects DISPLAY formatting (legend stops, labels, readouts). Persisted in localStorage;
 * consumers re-render on the 'rawsurf:height-unit' window event.
 */

export const M_TO_FT = 3.28084;
const KEY = '__RAW_HEIGHT_UNIT__';

/** 'ft' (default — current live behavior) or 'm'. */
export function getHeightUnit() {
  try {
    const v = typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem(KEY);
    return v === 'm' ? 'm' : 'ft';
  } catch (e) {
    return 'ft';
  }
}

export function setHeightUnit(unit) {
  const u = unit === 'm' ? 'm' : 'ft';
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(KEY, u);
  } catch (e) { /* private mode etc. — session-only preference */ }
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rawsurf:height-unit', { detail: { unit: u } }));
  } catch (e) { /* non-fatal */ }
  return u;
}

/** Format a METERS value in the preferred unit. Compact by default (legend stops); pass
 *  {withUnit:true} for readouts ("4.3 ft" / "1.3 m"). */
export function formatHeightFromMeters(meters, unit, opts) {
  if (meters === null || meters === undefined || Number.isNaN(Number(meters))) return '—';
  const u = unit === 'm' ? 'm' : 'ft';
  const val = u === 'ft' ? Number(meters) * M_TO_FT : Number(meters);
  // ONE DECIMAL RULE IN A READOUT (audit 2026-10-27, P2): `toString()` dropped the decimal at whole values, so the infobox
  // printed "4 ft" beside "4.1 ft" (and 0.98 ft read "1.0 ft" while 1.02 ft read "1 ft"). Readouts ({withUnit}) keep the
  // tenth below 10; the rounding is unchanged, only the trailing ".0" is added. Legend stops (compact) are untouched.
  // Kill: window.__RAW_DISABLE_FIXED_HEIGHT_DECIMALS__ = true.
  const fixedTenth = !!(opts && opts.withUnit)
    && !(typeof window !== 'undefined' && window.__RAW_DISABLE_FIXED_HEIGHT_DECIMALS__ === true);
  const tenth = Math.round(val * 10) / 10;
  // `tenth < 10` (was `val < 10`): 9.96 rounds to 10 either way, and now prints "10" with the integers, never "10.0".
  const display = val < 1 ? val.toFixed(1) : (tenth < 10 ? (fixedTenth ? tenth.toFixed(1) : tenth.toString()) : Math.round(val).toString());
  return (opts && opts.withUnit) ? `${display} ${u}` : display;
}
