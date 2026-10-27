/**
 * The shared regional-coverage fraction (2026-10-22): the backstop's retained-regional test and the fetcher's regional clear read the
 * guard's and the display gate's 0.6, so a tile the gate shows is never called display-empty (re-driven every 6 s) or cleared.
 */
import { DOWNGRADE_COVER_FRAC, LEGACY_COVER_FRAC, alignedCoverFrac } from './marineZoomThresholds';
import { isRetainedRegionalZoomedOut } from './useMarineScrubSettle';
import { checkShouldClearRegionalGrid } from './useMarineDataFetcherHelpers';

const KEYS = ['__RAW_DOWNGRADE_COVER_FRAC__', '__RAW_DISABLE_COVER_FRAC_ALIGN__'];
afterEach(() => KEYS.forEach((k) => delete window[k]));

// A wide view (20 x 20 deg at z5) and a regional grid covering 70 % of it: inside the 0.6-0.8 band the readers disagreed on.
const VIEW = { west: -90, south: 20, east: -70, north: 40 };
const GRID = { bounds: { west: -90, south: 20, east: -76, north: 40 }, cols: 57, rows: 81, vectors: [{ speed: 1 }] };
const map = { getBounds: () => ({ getWest: () => VIEW.west, getEast: () => VIEW.east, getSouth: () => VIEW.south, getNorth: () => VIEW.north }), getZoom: () => 5 };
const engine = { _waveData: { waveGrid: GRID } };
const clear = () => checkShouldClearRegionalGrid({ marineData: { grid: GRID }, bounds: VIEW, zoom: 5, model: 'GFS', layer: 'waves' });

it('one constant: 0.6 by default, the live lever wins, the kill restores 0.8 for the aligned readers', () => {
  expect(DOWNGRADE_COVER_FRAC).toBe(0.6);
  expect(alignedCoverFrac()).toBe(0.6);
  window.__RAW_DOWNGRADE_COVER_FRAC__ = 0.75;
  expect(alignedCoverFrac()).toBe(0.75);
  delete window.__RAW_DOWNGRADE_COVER_FRAC__;
  window.__RAW_DISABLE_COVER_FRAC_ALIGN__ = true;
  expect(alignedCoverFrac()).toBe(LEGACY_COVER_FRAC);
});

it('a tile covering 70 % of a wide view is neither display-empty to the backstop nor cleared by the fetcher (the gate shows it)', () => {
  expect(isRetainedRegionalZoomedOut(engine, map)).toBe(false);
  expect(clear()).toBe(false);
  window.__RAW_DISABLE_COVER_FRAC_ALIGN__ = true;                    // the old 0.8: flagged and cleared (the 6 s re-drive)
  expect(isRetainedRegionalZoomedOut(engine, map)).toBe(true);
  expect(clear()).toBe(true);
});

it('below 60 % both still act: a tile that is a minority of the view hands over to the world field', () => {
  const thin = { ...GRID, bounds: { ...GRID.bounds, east: -80 } };   // 50 %
  expect(isRetainedRegionalZoomedOut({ _waveData: { waveGrid: thin } }, map)).toBe(true);
  expect(checkShouldClearRegionalGrid({ marineData: { grid: thin }, bounds: VIEW, zoom: 5, model: 'GFS', layer: 'waves' })).toBe(true);
});

it('wiring: the wind-data conform reads the same fraction', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'useMarineWindData.js'), 'utf8');
  expect(src).toMatch(/const _coverFrac = alignedCoverFrac\(\);/);
  expect(src).not.toMatch(/__RAW_DOWNGRADE_COVER_FRAC__\)\) \|\| 0\.8/);
});
