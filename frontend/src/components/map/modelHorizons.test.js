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
