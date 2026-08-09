/**
 * The cross-fall cutovers: values pinned, and the SOURCE scanned so they cannot drift back inline.
 *
 * These eight numbers decide whose forecast a user is actually looking at. They were bare literals
 * inside resolveModel while four other files carried disagreeing copies, so the preloader could
 * warm one model while the renderer painted another. The value assertions are a change-detector;
 * the source scan is the part that stops the drift returning.
 */
import fs from 'fs';
import path from 'path';

import {
  ICON_WIND_CUTOVER_H, EURO_WIND_CUTOVER_H,
  ICON_MARINE_RASTER_CUTOVER_H, EURO_MARINE_RASTER_CUTOVER_H,
  ICON_ATMOSPHERIC_CUTOVER_H, EURO_ATMOSPHERIC_CUTOVER_H,
  closestAxisIndex, isBeyondAxis, axisHorizonHours,
} from './modelHorizons';

const SRC = fs.readFileSync(path.join(__dirname, 'useOpenMeteoTileUrls.js'), 'utf8');
const RESOLVE_MODEL = (() => {
  const start = SRC.indexOf('const resolveModel = (entry, variable) =>');
  expect(start).toBeGreaterThan(-1);          // setup assertion: a moved function must not pass silently
  const end = SRC.indexOf('\n        };', start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
})();

describe('the cutover values (change-detector: moving one is a PRODUCT change)', () => {
  it('holds the values the inline literals had, unchanged by the extraction', () => {
    expect(ICON_WIND_CUTOVER_H).toBe(120);
    expect(EURO_WIND_CUTOVER_H).toBe(228);
    expect(ICON_MARINE_RASTER_CUTOVER_H).toBe(168);
    expect(EURO_MARINE_RASTER_CUTOVER_H).toBe(240);
    expect(ICON_ATMOSPHERIC_CUTOVER_H).toBe(168);
    expect(EURO_ATMOSPHERIC_CUTOVER_H).toBe(228);
  });

  it('⛔ ICON atmospheric is NOT 216 — that number is a TAIL LENGTH, not an hour', () => {
    // capabilities.py declares ICON wind native 120 / estimated 216 / max 336, and 120+216=336.
    // Two files store 216 as if it were an hour. Anyone "fixing" this constant to match them is
    // reading an estimated-tail length as a horizon. Measure the real axis first.
    expect(ICON_ATMOSPHERIC_CUTOVER_H).not.toBe(216);
  });

  it('wind cuts over BEFORE atmospheric on ICON — they are separate axes, not one horizon', () => {
    // The single most load-bearing fact here: one model id, two different real horizons. A
    // "simplification" that collapses them to a single per-model number is a behaviour change.
    expect(ICON_WIND_CUTOVER_H).toBeLessThan(ICON_ATMOSPHERIC_CUTOVER_H);
  });
});

describe('the source scan — the literals may not come back', () => {
  it('resolveModel compares hours against NAMED constants only', () => {
    const comparisons = RESOLVE_MODEL.match(/debouncedTimeOffsetHours\s*>\s*[A-Za-z0-9_]+/g) || [];
    expect(comparisons.length).toBeGreaterThanOrEqual(8);   // setup: the branches still exist
    for (const c of comparisons) {
      const rhs = c.split('>')[1].trim();
      expect(rhs).not.toMatch(/^\d/);                        // a bare number is the defect returning
      expect(rhs).toMatch(/CUTOVER_H$/);
    }
  });

  it('every constant it names is actually exported here (no phantom import)', () => {
    const named = new Set((RESOLVE_MODEL.match(/[A-Z_]+_CUTOVER_H/g) || []));
    expect(named.size).toBeGreaterThanOrEqual(5);
    const exported = {
      ICON_WIND_CUTOVER_H, EURO_WIND_CUTOVER_H,
      ICON_MARINE_RASTER_CUTOVER_H, EURO_MARINE_RASTER_CUTOVER_H,
      ICON_ATMOSPHERIC_CUTOVER_H, EURO_ATMOSPHERIC_CUTOVER_H,
    };
    for (const n of named) expect(typeof exported[n]).toBe('number');
  });
});


// ── PROOF OF THE UNDISCLOSED STALE FRAME ─────────────────────────────────────────────────────
// These assert the CURRENT shipped behaviour, including the part that is wrong. They are the
// before-measurement for the live-axis floor: when that lands, the saturation test stays true
// (the selector is still the selector) while a caller consulting isBeyondAxis stops painting the
// stale frame unlabelled.
describe('closestAxisIndex — and what it does past the end of the axis', () => {
  const T0 = Date.parse('2026-08-09T00:00:00Z');
  const axis = (n) => Array.from({ length: n }, (_, i) =>
    new Date(T0 + i * 3600000).toISOString());          // hourly, n entries from T0

  it('picks the nearest hour inside the axis', () => {
    expect(closestAxisIndex(axis(169), T0 + 100 * 3600000)).toBe(100);
    expect(closestAxisIndex(axis(169), T0 + 100.4 * 3600000)).toBe(100);
    expect(closestAxisIndex(axis(169), T0 + 100.6 * 3600000)).toBe(101);
  });

  it('⚠️ SATURATES past the end — hour 300 on a 168 h axis returns the 168 h FRAME', () => {
    // This is the defect, stated as an executable fact: the user asked for 300 and the map paints
    // 168 with nothing saying so. The clamp cannot distinguish "nearest" from "off the end".
    const a = axis(169);                                 // 0..168 h
    expect(closestAxisIndex(a, T0 + 300 * 3600000)).toBe(168);
    expect(closestAxisIndex(a, T0 + 169 * 3600000)).toBe(168);
    expect(closestAxisIndex(a, T0 + 168 * 3600000)).toBe(168);   // legitimately the last hour
  });

  it('isBeyondAxis SEPARATES the two cases the clamp conflates', () => {
    const a = axis(169);
    expect(isBeyondAxis(a, T0 + 168 * 3600000)).toBe(false);     // exactly the last hour: real
    expect(isBeyondAxis(a, T0 + 169 * 3600000)).toBe(true);      // one hour past: a stand-in
    expect(isBeyondAxis(a, T0 + 300 * 3600000)).toBe(true);
  });

  it('an UNKNOWN axis is not evidence of absence', () => {
    // A bootstrap placeholder or a not-yet-fetched model must never be read as "no data here".
    expect(isBeyondAxis([], T0)).toBe(false);
    expect(isBeyondAxis(null, T0)).toBe(false);
    expect(isBeyondAxis(['not-a-date'], T0)).toBe(false);
    expect(axisHorizonHours([], T0)).toBeNull();
    expect(axisHorizonHours(null, T0)).toBeNull();
  });

  it('axisHorizonHours gives the floor a declared cutover should be min()d against', () => {
    const a = axis(169);
    expect(axisHorizonHours(a, T0)).toBe(168);
    expect(axisHorizonHours(a, T0 + 100 * 3600000)).toBe(68);
    expect(axisHorizonHours(a, T0 + 500 * 3600000)).toBe(0);     // never negative
  });

  it('THE POINT: the declared ICON atmospheric cutover would be capped by a shorter real axis', () => {
    const short = axis(121);                                     // a model only carrying 120 h
    expect(Math.min(ICON_ATMOSPHERIC_CUTOVER_H, axisHorizonHours(short, T0))).toBe(120);
    const long = axis(337);
    expect(Math.min(ICON_ATMOSPHERIC_CUTOVER_H, axisHorizonHours(long, T0)))
      .toBe(ICON_ATMOSPHERIC_CUTOVER_H);                         // normal case: nothing changes
  });
});


describe('the shipped code uses THIS selector — otherwise the proof above is about a replica', () => {
  it('both former inline copies in useOpenMeteoTileUrls are gone', () => {
    // The nearest-index search existed twice, inline. If either copy returns, the tests above stop
    // describing what ships and quietly become fiction.
    expect(SRC).not.toMatch(/minDiff/);
    expect(SRC.match(/closestAxisIndex\(/g) || []).toHaveLength(2);
  });
});
