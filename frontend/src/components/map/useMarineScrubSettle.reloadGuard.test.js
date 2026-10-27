/**
 * The scrub-settle clamp branch stops force-reloading a page it already holds a COVERING frame of (2026-10-23,
 * marineSettleReloadGuard.settleSeriesReloadNeeded). Offline drain replay at z8 on ICON surf: the resident 0.5-deg ICON grid reads
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
import { SETTLE_RELOAD_GAP_MS, SETTLE_RELOAD_MAX, SETTLE_RELOAD_QUICK, _resetSettleReloadGuardForTest, settleReloadKey, settleSeriesReloadNeeded } from './marineSettleReloadGuard';

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
    _resetSettleReloadGuardForTest();
    ensureMarineSeries.mockImplementation(() => Promise.resolve());
    window.__MARINE_ENGINE__ = { _waveData: { waveGrid: resident } };
    delete window.isScrubbingTimeline;
  });
  afterEach(() => { delete window.__MARINE_ENGINE__; delete window.__RAW_DISABLE_SETTLE_RELOAD_GUARD__; delete window.__RAW_SETTLE_RELOAD_HELD__; jest.restoreAllMocks(); });

  it('the scene is the replay: regional_too_coarse, with a covering series frame that is the same coarse grid', () => {
    expect(detectClamp(mkMap())).toMatchObject({ clamp: true, kind: 'regional_too_coarse' });
  });

  it('a covering, not finer, frame: no sharpen, and the reload runs under a budget instead of every tick (it looped)', () => {
    getMarineSeriesFrame.mockImplementation(() => ({ grid: { ...ICON, vectors: vec, hourOffset: 0 }, hourOffset: 0 }));
    let now = 1e12; jest.spyOn(Date, 'now').mockImplementation(() => now);
    const c = ctx();
    for (let i = 0; i < 10; i++) { runScrubSettleCheck(c); now += 1000; }
    expect(c.setMarineData).not.toHaveBeenCalled();
    expect(forced()).toBe(SETTLE_RELOAD_QUICK);                        // 2 at once (a coarse INTERIM may still turn fine)
    expect(window.__RAW_SETTLE_RELOAD_HELD__).toBe(10 - SETTLE_RELOAD_QUICK);
    for (let i = 0; i < 20; i++) { now += SETTLE_RELOAD_GAP_MS / 2; runScrubSettleCheck(c); }
    expect(forced()).toBe(SETTLE_RELOAD_MAX);                          // then one per 30 s, 5 in all, for this view and hour
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

  it('the helper: without a covering frame always; with one, 2 at once then 1 per 30 s, 5 in all, per view and hour; the kill', () => {
    const a = { model: 'ICON', layer: 'waves', hour: 0, vb: VIEW };
    const b = { ...a, vb: { ...VIEW, west: VIEW.west + 1, east: VIEW.east + 1 } };
    expect(settleReloadKey(a)).not.toBe(settleReloadKey(b));
    expect([1, 2, 3, 4].map(() => settleSeriesReloadNeeded(false, a, 0))).toEqual([true, true, true, true]);
    expect([0, 1, 2].map((t) => settleSeriesReloadNeeded(true, a, t))).toEqual([true, true, false]);
    expect(settleSeriesReloadNeeded(true, b, 2)).toBe(true);                                      // another view has its own budget
    expect(settleSeriesReloadNeeded(true, a, 2 + SETTLE_RELOAD_GAP_MS)).toBe(true);
    expect(settleSeriesReloadNeeded(true, a, 3 + SETTLE_RELOAD_GAP_MS)).toBe(false);
    expect(settleSeriesReloadNeeded(true, a, 3 + 2 * SETTLE_RELOAD_GAP_MS)).toBe(true);
    expect(settleSeriesReloadNeeded(true, a, 4 + 3 * SETTLE_RELOAD_GAP_MS)).toBe(true);           // the 5th
    expect(settleSeriesReloadNeeded(true, a, 5 + 9 * SETTLE_RELOAD_GAP_MS)).toBe(false);          // spent
    window.__RAW_DISABLE_SETTLE_RELOAD_GUARD__ = true;
    expect(settleSeriesReloadNeeded(true, a, 6 + 9 * SETTLE_RELOAD_GAP_MS)).toBe(true);
  });

  // PER PAGE (2026-10-24): the budget was per hour, so each wheel step inside one page opened a fresh budget for the same request
  // (the z8 Lake Michigan replay: one GFS 48-frame page asked 5-6 times, one EURO page 4-6 times in 260 s, every answer the same).
  it('per PAGE: two hours of one page share the budget; another page or flavour has its own; the kill restores per hour', () => {
    const h0 = { model: 'GFS', layer: 'waves', hour: 0, vb: VIEW };
    const h1 = { ...h0, hour: 1 };
    const next = { ...h0, hour: 150 };                                                            // the next GFS swell page (144 h each)
    expect(settleReloadKey(h0)).toBe(settleReloadKey(h1));
    expect(settleReloadKey(h0)).not.toBe(settleReloadKey(next));
    expect(settleReloadKey(h0)).toBe(settleReloadKey({ ...h0, vb: { ...VIEW, west: VIEW.west + 0.1 } }));   // same snapped request box
    expect([0, 1].map((t) => settleSeriesReloadNeeded(true, t === 0 ? h0 : h1, t))).toEqual([true, true]);
    expect(settleSeriesReloadNeeded(true, h1, 2)).toBe(false);                                      // the page's budget, not the hour's
    expect(settleSeriesReloadNeeded(true, next, 2)).toBe(true);
    const swellKey = settleReloadKey(h0);
    window.__SURF_MODE__ = true;                                                                  // the surf page is another request
    expect(settleReloadKey(h0)).not.toBe(swellKey);
    delete window.__SURF_MODE__;
    window.__RAW_DISABLE_SETTLE_RELOAD_PAGE_KEY__ = true;
    expect(settleReloadKey(h0)).not.toBe(settleReloadKey(h1));                                    // killed: per hour, as before
    delete window.__RAW_DISABLE_SETTLE_RELOAD_PAGE_KEY__;
  });

  it('wiring: the clamp branch asks the guard with the covering-regional-frame test', () => {
    const src = fs.readFileSync(path.join(__dirname, 'useMarineScrubSettle.js'), 'utf8');
    expect(src).toMatch(/\} else if \(settleSeriesReloadNeeded\(!!\(frame && fw < 340 && frameCovers\), \{ model, layer, hour: currentHour, vb: clampVb \}\)\) \{/);
  });
});
