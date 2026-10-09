/**
 * KEEP THE BETTER FINE OVERLAY (2026-10-09): the owner's "light wind bar and L shaped artifacts" near the coast at z~8.
 * The cases below are the owner's log: a covering 0.25-deg 17x17 resident, a coarser 11x9 non-covering arrival.
 */
import fs from 'fs';
import path from 'path';
import { keepResidentFine, viewCoverFrac, cellDeg, OVERLAY_KEEP } from './windOverlayKeep';

// The owner's view (screenshot geometry, 2026-10-09 ~20:52Z) and the two grids from the log.
const VIEW = { west: -89.70, south: 29.23, east: -86.66, north: 30.83 };
const RESIDENT_17 = { active: true, bounds: { west: -90, south: 28, east: -86, north: 32 }, cols: 17, rows: 17 };
const INCOMING_11 = { bounds: { west: -89.5, south: 26.5, east: -84.5, north: 30.5 }, cols: 11, rows: 9 };

describe('the owner\'s case', () => {
  it('the resident 17x17 covers the whole view; the 11x9 about three quarters of it, coarser', () => {
    expect(viewCoverFrac(RESIDENT_17.bounds, VIEW)).toBeCloseTo(1, 6);
    expect(viewCoverFrac(INCOMING_11.bounds, VIEW)).toBeGreaterThan(0.7);
    expect(viewCoverFrac(INCOMING_11.bounds, VIEW)).toBeLessThan(0.8);
    expect(cellDeg(INCOMING_11.bounds, 11)).toBeCloseTo(0.5, 9);
    expect(cellDeg(RESIDENT_17.bounds, 17)).toBeCloseTo(0.25, 9);
  });
  it('keeps the covering finer resident: the 11x9 edges (the L) never reach the screen', () => {
    expect(keepResidentFine(RESIDENT_17, INCOMING_11, VIEW, {})).toBe(true);
  });
  it('POSITIVE CONTROL: the kill switch restores the old pass-through (the L comes back)', () => {
    expect(keepResidentFine(RESIDENT_17, INCOMING_11, VIEW, { __RAW_DISABLE_WIND_OVERLAY_KEEP__: true })).toBe(false);
  });
});

describe('it never blocks a better picture', () => {
  it('the resident scrolled away (< 70% of the view): coverage wins, the incoming passes', () => {
    const away = { west: -86.0, south: 29.2, east: -83.0, north: 30.8 };
    expect(viewCoverFrac(RESIDENT_17.bounds, away)).toBeLessThan(OVERLAY_KEEP.minCover);
    expect(keepResidentFine(RESIDENT_17, { bounds: { west: -87, south: 28, east: -82, north: 31 }, cols: 11 }, away, {})).toBe(false);
  });
  it('an incoming that shows more of the view passes, whatever its grid', () => {
    const partial = { active: true, bounds: { west: -89.0, south: 29.0, east: -86.5, north: 31.0 }, cols: 11 };
    expect(keepResidentFine(partial, { bounds: { west: -89.8, south: 29.0, east: -86.6, north: 31.0 }, cols: 9 }, VIEW, {})).toBe(false);
  });
  it('a markedly finer incoming (>= 1.5x) takes over even at equal or lower coverage', () => {
    const fine = { bounds: { west: -89.6, south: 29.3, east: -86.7, north: 30.8 }, cols: 59 }; // 0.05 deg
    expect(keepResidentFine(RESIDENT_17, fine, VIEW, {})).toBe(false);
  });
  it('no resident, an inactive one, a malformed one, or an antimeridian box: never blocks', () => {
    expect(keepResidentFine(null, INCOMING_11, VIEW, {})).toBe(false);
    expect(keepResidentFine({ active: false }, INCOMING_11, VIEW, {})).toBe(false);
    expect(keepResidentFine({ active: true, bounds: RESIDENT_17.bounds, cols: 1 }, INCOMING_11, VIEW, {})).toBe(false);
    const dateline = { active: true, bounds: { west: 175, south: -20, east: -175, north: -10 }, cols: 41 };
    expect(keepResidentFine(dateline, INCOMING_11, VIEW, {})).toBe(false);
  });
});

describe('wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, 'WeatherEngine.js'), 'utf8');
  it('the CHOKE consults the engine\'s resident fine overlay before passing a non-covering grid as the fine overlay', () => {
    expect(src).toContain("import { keepResidentFine } from './windOverlayKeep';");
    expect(src).toContain("if (keepResidentFine(typeof window !== 'undefined' ? window.__WIND_FINE_OVERLAY__ : null, data, vp)) { console.log('[WeatherEngine] commitWindData CHOKE: kept the resident fine overlay (it shows more of the view, as fine or finer)'); return; }");
    const keepAt = src.indexOf('if (keepResidentFine('), passAt = src.indexOf("non-covering grid passes as FINE OVERLAY over the resident global base");
    expect(keepAt).toBeGreaterThan(0);
    expect(keepAt).toBeLessThan(passAt);
  });
});
