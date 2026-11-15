// The next hour's fine grid on a dwell (marineFinePrefetch.js) and the regional coarse-series upgrade (marineExactUpgrade.js),
// each with its kill's off path. Gate: docs/weather-program/log/2026-11-15-opus-first-visit-fine.md (F4).
import { renderHook, act } from '@testing-library/react';

const mockFetch = jest.fn(() => Promise.resolve({}));
let mockCached = false;
jest.mock('./marineController', () => ({
  fetchMarineData: (...a) => mockFetch(...a),
  isContainedInMarineCache: () => mockCached,
}));
let mockSurf = false;
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => mockSurf }));

const { planFinePrefetch, useFineDwellPrefetch, FINE_PREFETCH_DWELL_MS, _resetFinePrefetchForTest } = require('./marineFinePrefetch');
const { planExactUpgrade, noteFineGrid, isCoarseRegionalSeries, _resetExactUpgradeForTest } = require('./marineExactUpgrade');

const map = { getBounds: () => ({ getWest: () => -81, getSouth: () => 28, getEast: () => -79, getNorth: () => 29 }), getZoom: () => 8 };
const refs = (hour) => ({ timeOffsetRef: { current: hour }, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' }, activeMarineLayersRef: { current: true } });

beforeEach(() => { jest.useFakeTimers(); mockFetch.mockClear(); mockCached = false; mockSurf = false; _resetFinePrefetchForTest(); _resetExactUpgradeForTest(); });
afterEach(() => {
  jest.useRealTimers();
  delete window.__RAW_DISABLE_FINE_PREFETCH_NEXT__; delete window.__RAW_DISABLE_FINE_UPGRADE_REGIONAL__; delete window.isScrubbingTimeline;
});

describe('planFinePrefetch', () => {
  const base = { on: true, hour: 4, dir: 1, scrubbing: false, pending: false, hidden: false, surf: false, cached: false, asked: false };
  test('a settled dwell asks the next hour in the step direction', () => {
    expect(planFinePrefetch(base)).toEqual({ go: true, next: 5, reason: 'dwelt' });
    expect(planFinePrefetch({ ...base, dir: -1 })).toEqual({ go: true, next: 3, reason: 'dwelt' });
  });
  test.each([['scrubbing'], ['pending', 'fetch_pending'], ['hidden'], ['surf'], ['cached'], ['asked']])('%s: no prefetch', (k, reason) => {
    expect(planFinePrefetch({ ...base, [k]: true })).toEqual({ go: false, reason: reason || k });
  });
  test('never before hour 0; off when killed', () => {
    expect(planFinePrefetch({ ...base, hour: 0, dir: -1 }).reason).toBe('before_start');
    expect(planFinePrefetch({ ...base, on: false }).reason).toBe('disabled');
  });
});

describe('useFineDwellPrefetch', () => {
  const mount = (hour, r) => renderHook((p) => useFineDwellPrefetch({ mapInstance: map, ...r, hour: p.hour }), { initialProps: { hour } });

  test('one prefetch after a 1.5 s dwell, cache-only (isPrefetch, noSideWarm), for the next hour', () => {
    const r = refs(4); mount(4, r);
    act(() => { jest.advanceTimersByTime(FINE_PREFETCH_DWELL_MS - 1); });
    expect(mockFetch).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const a = mockFetch.mock.calls[0];
    expect(a[3]).toBe(5); expect(a[5]).toBe('GFS'); expect(a[6]).toBe('waves'); expect(a[7]).toBe(true); expect(a[8]).toEqual({ noSideWarm: true });
    act(() => { jest.advanceTimersByTime(10000); });
    expect(mockFetch).toHaveBeenCalledTimes(1);   // once per dwell
  });

  test('a drag (an hour change every 150 ms) asks nothing; the stop then asks one', () => {
    const r = refs(0); const { rerender } = mount(0, r);
    for (let h = 1; h <= 12; h += 1) { act(() => { jest.advanceTimersByTime(150); }); r.timeOffsetRef.current = h; rerender({ hour: h }); }
    expect(mockFetch).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(FINE_PREFETCH_DWELL_MS); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][3]).toBe(13);
  });

  test('a step back prefetches backwards; an already cached hour is not asked', () => {
    const r = refs(6); const { rerender } = mount(6, r);
    r.timeOffsetRef.current = 5; rerender({ hour: 5 });
    act(() => { jest.advanceTimersByTime(FINE_PREFETCH_DWELL_MS); });
    expect(mockFetch.mock.calls[0][3]).toBe(4);
    mockCached = true; r.timeOffsetRef.current = 4; rerender({ hour: 4 });
    act(() => { jest.advanceTimersByTime(FINE_PREFETCH_DWELL_MS); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('no prefetch while the timeline is being dragged, or in surf mode', () => {
    window.isScrubbingTimeline = true; mount(4, refs(4));
    act(() => { jest.advanceTimersByTime(FINE_PREFETCH_DWELL_MS); });
    delete window.isScrubbingTimeline; mockSurf = true; mount(7, refs(7));
    act(() => { jest.advanceTimersByTime(FINE_PREFETCH_DWELL_MS); });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('OFF PATH: __RAW_DISABLE_FINE_PREFETCH_NEXT__ asks nothing', () => {
    window.__RAW_DISABLE_FINE_PREFETCH_NEXT__ = true; mount(4, refs(4));
    act(() => { jest.advanceTimersByTime(10000); });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('regional coarse-series upgrade', () => {
  const fine = { bounds: { west: -81, east: -79, south: 28, north: 29 }, cols: 7, rows: 4, vectors: [1] };          // 0.29 deg cells
  const coarse = { bounds: { west: -81, east: -79, south: 28, north: 29 }, cols: 5, rows: 3, vectors: [1], __fromSeries: true, hourOffset: 3 }; // 0.40 deg
  const veryCoarse = { ...coarse, cols: 3 };   // 0.67 deg
  const ctx = (grid) => ({ marineData: { grid }, currentHour: 3, scrubbing: false, wideView: false, fetchPendingForHour: false, attempts: null, nowMs: 0, disabled: false, engineGrid: null });

  test('a series frame coarser than 1.5x the last fine grid arms at a zoomed-in view; one that is not, does not', () => {
    expect(isCoarseRegionalSeries(veryCoarse)).toBe(false);   // nothing fine known yet: no upgrade
    noteFineGrid(fine);
    expect(isCoarseRegionalSeries(veryCoarse)).toBe(true);
    expect(isCoarseRegionalSeries(coarse)).toBe(false);       // 0.40 / 0.29 = 1.4x: not sharper enough to ask
    expect(planExactUpgrade(ctx(veryCoarse))).toEqual({ upgrade: true, reason: 'coarse_regional_series_settled' });
    expect(planExactUpgrade({ ...ctx(veryCoarse), scrubbing: true }).upgrade).toBe(false);
    expect(planExactUpgrade(ctx(fine)).upgrade).toBe(false);
  });

  test('a series grid does not count as the fine reference', () => {
    noteFineGrid({ ...veryCoarse, cols: 50 });
    expect(isCoarseRegionalSeries(veryCoarse)).toBe(false);
  });

  test('OFF PATH: __RAW_DISABLE_FINE_UPGRADE_REGIONAL__ leaves a coarse regional series frame alone', () => {
    noteFineGrid(fine);
    window.__RAW_DISABLE_FINE_UPGRADE_REGIONAL__ = true;
    expect(isCoarseRegionalSeries(veryCoarse)).toBe(false);
    expect(planExactUpgrade(ctx(veryCoarse))).toEqual({ upgrade: false, reason: 'resident_not_thinned_world' });
  });
});
