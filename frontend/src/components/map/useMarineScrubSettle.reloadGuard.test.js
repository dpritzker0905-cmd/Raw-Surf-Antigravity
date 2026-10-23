/**
 * The scrub-settle clamp branch stops force-reloading a page it already holds a COVERING frame of (2026-10-23,
 * marineSeriesPanGuard.settleSeriesReloadNeeded). Offline drain replay at z8 on ICON surf: the resident 0.5-deg ICON grid reads
 * regional_too_coarse, the covering series frame is that same grid (not finer), so no sharpen, and the branch force-reloaded the
 * view's page on every settle tick: one box asked 117 times, one 16-frame surf page right after another. A reload of the same
 * product can never sharpen; the capped fuller-tile /grid upgrade below it still runs.
 */
jest.mock('./marineGridSeries', () => ({
  ...jest.requireActual('./marineGridSeries'),
  getMarineSeriesFrame: jest.fn(),
  ensureMarineSeries: jest.fn(() => Promise.resolve()),
}));
import fs from 'fs';
import path from 'path';
import { getMarineSeriesFrame, ensureMarineSeries } from './marineGridSeries';
import { runScrubSettleCheck, detectClamp } from './useMarineScrubSettle';

const VIEW = { west: -79.79, south: 25.5, east: -77.64, north: 26.46 };                 // the replay's z8 view at 21 s
const ICON = { bounds: { west: -82, south: 24, east: -76, north: 30 }, cols: 13, rows: 13 };   // 0.46-deg cells: covers, too coarse
const vec = [{ lat: 26, lng: -79, speed: 1.2, u: 0.1, v: 0.1, direction: 0, period: 9 }];
const mkMap = () => ({
  getZoom: () => 8,
  getBounds: () => ({ getWest: () => VIEW.west, getEast: () => VIEW.east, getSouth: () => VIEW.south, getNorth: () => VIEW.north }),
});
const resident = { ...ICON, vectors: vec, hourOffset: 0, __renderable: true, __sourceModel: 'ICON', __componentLayer: 'waves' };
const ctx = () => ({
  marineData: { grid: resident, hourOffset: 0, __sourceModel: 'ICON' }, mapInstance: mkMap(), setMarineData: jest.fn(),
  timeOffsetRef: { current: 0 }, activeModelRef: { current: 'ICON' }, activeMarineLayerRef: { current: 'waves' },
  safetyNetRetryRef: { current: { key: '', count: 0 } }, clampRefetchRef: { current: { key: '', count: 0 } },
  marineFetchLocksRef: { current: {} }, updateMarineGridRef: null, marineRevision: { current: 0 }, lastCommittedSigRef: { current: null },
});
const forced = () => ensureMarineSeries.mock.calls.filter((c) => c[6] === true).length;

describe('the settle check does not force-reload a page it holds a covering frame of', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureMarineSeries.mockImplementation(() => Promise.resolve());
    window.__MARINE_ENGINE__ = { _waveData: { waveGrid: resident } };
    delete window.isScrubbingTimeline;
  });
  afterEach(() => { delete window.__MARINE_ENGINE__; delete window.__RAW_DISABLE_SETTLE_RELOAD_GUARD__; });

  it('the scene is the replay: regional_too_coarse, with a covering series frame that is the same coarse grid', () => {
    expect(detectClamp(mkMap())).toMatchObject({ clamp: true, kind: 'regional_too_coarse' });
  });

  it('a covering, not finer, frame: no sharpen and NO forced reload (it looped every tick)', () => {
    getMarineSeriesFrame.mockImplementation(() => ({ grid: { ...ICON, vectors: vec, hourOffset: 0 }, hourOffset: 0 }));
    const c = ctx();
    for (let i = 0; i < 5; i++) runScrubSettleCheck(c);
    expect(c.setMarineData).not.toHaveBeenCalled();
    expect(forced()).toBe(0);
  });

  it('no covering frame yet: the reload it exists for still happens', () => {
    getMarineSeriesFrame.mockImplementation(() => null);
    runScrubSettleCheck(ctx());
    expect(forced()).toBe(1);
    expect(ensureMarineSeries.mock.calls[0].slice(0, 2)).toEqual(['ICON', 'waves']);
  });

  it('positive control: with the guard killed the covering frame is force-reloaded on every tick, as before', () => {
    window.__RAW_DISABLE_SETTLE_RELOAD_GUARD__ = true;
    getMarineSeriesFrame.mockImplementation(() => ({ grid: { ...ICON, vectors: vec, hourOffset: 0 }, hourOffset: 0 }));
    const c = ctx();
    for (let i = 0; i < 5; i++) runScrubSettleCheck(c);
    expect(forced()).toBe(5);
  });

  it('wiring: the clamp branch asks the guard with the covering-regional-frame test', () => {
    const src = fs.readFileSync(path.join(__dirname, 'useMarineScrubSettle.js'), 'utf8');
    expect(src).toMatch(/\} else if \(settleSeriesReloadNeeded\(!!\(frame && fw < 340 && frameCovers\)\)\) \{/);
  });
});
