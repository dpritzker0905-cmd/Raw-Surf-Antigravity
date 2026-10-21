/**
 * SERIES_PAINT_WHILE_PENDING (request diet 2026-10-20): a series frame that landed for the selected hour is drawn while the /grid for
 * that hour is still in flight, and the landing itself re-runs the settle check while a fetch is pending. The kill switch is the
 * control arm.
 */
import { renderHook } from '@testing-library/react';
import { getMarineSeriesFrame } from './marineGridSeries';
import { _resetSeriesPaintForTest, paintSeriesWhilePending, useSeriesPaintWhilePending } from './marineSeriesWhilePending';

jest.mock('./marineGridSeries', () => ({ getMarineSeriesFrame: jest.fn() }));

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const map = { getBounds: () => ({ getWest: () => -160, getSouth: () => -10, getEast: () => 0, getNorth: () => 55 }) };
const ref = (current) => ({ current });
const frame = (cols = 181) => ({ hourOffset: 0, valid_time: '2026-10-20T12:00:00Z',
  grid: { bounds: WORLD, cols, rows: 83, vectors: [{ lat: 1, lng: 1, speed: 1 }], hourOffset: 0, __fromSeries: true } });
const ctx = (extra = {}) => ({ marineData: null, mapInstance: map, activeModelRef: ref('GFS'), activeMarineLayerRef: ref('waves'),
  currentHour: 0, commit: jest.fn(), ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  _resetSeriesPaintForTest();
  delete window.__RAW_DISABLE_SERIES_PAINT_WHILE_PENDING__;
  delete window.__RAW_DISABLE_REQUEST_DIET__;
  delete window.__MARINE_REQUEST_DIET__;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.isScrubbingTimeline;
  delete window.map;
});

test('a landed frame for the selected hour is committed while the /grid is pending', () => {
  const f = frame();
  getMarineSeriesFrame.mockReturnValue(f);
  const c = ctx();
  expect(paintSeriesWhilePending(c)).toBe(true);
  expect(c.commit).toHaveBeenCalledWith(f, 'waves');
  expect(getMarineSeriesFrame).toHaveBeenCalledWith('GFS', 'waves', { west: -160, south: -10, east: 0, north: 55 }, 0);
  expect(window.__MARINE_REQUEST_DIET__.counts.series_painted_while_pending).toBe(1);
});

test('the settle closure that still holds a null map (before the first commit) uses the published map', () => {
  getMarineSeriesFrame.mockReturnValue(frame());
  window.map = map;
  const c = ctx({ mapInstance: null });
  expect(paintSeriesWhilePending(c)).toBe(true);
  expect(c.commit).toHaveBeenCalledTimes(1);
});

test('nothing landed, the same frame already shown, or the kill: no commit (the old hold)', () => {
  getMarineSeriesFrame.mockReturnValue(null);
  const c1 = ctx();
  expect(paintSeriesWhilePending(c1)).toBe(false);
  const f = frame();
  getMarineSeriesFrame.mockReturnValue(f);
  const c2 = ctx({ marineData: { grid: f.grid } });
  expect(paintSeriesWhilePending(c2)).toBe(false);
  window.__RAW_DISABLE_SERIES_PAINT_WHILE_PENDING__ = true;
  const c3 = ctx();
  expect(paintSeriesWhilePending(c3)).toBe(false);
  expect(c1.commit).not.toHaveBeenCalled();
  expect(c2.commit).not.toHaveBeenCalled();
  expect(c3.commit).not.toHaveBeenCalled();
});

test('a thinned world frame never replaces the exact frame of the same data', () => {
  const thin = { hourOffset: 0, valid_time: '2026-10-20T12:00:00Z',
    grid: { bounds: WORLD, cols: 46, rows: 21, vectors: [{ lat: 1, lng: 1, speed: 1 }], __decimatedStride: 4, valid_time: '2026-10-20T12:00:00Z' } };
  getMarineSeriesFrame.mockReturnValue(thin);
  const exact = { hourOffset: 3, served_valid_time: '2026-10-20T12:00:00Z',
    grid: { bounds: WORLD, cols: 181, rows: 83, vectors: [{ lat: 1, lng: 1, speed: 1 }], served_valid_time: '2026-10-20T12:00:00Z' } };
  const c = ctx({ marineData: exact });
  expect(paintSeriesWhilePending(c)).toBe(false);
  expect(c.commit).not.toHaveBeenCalled();
});

test('two re-runs of the check for one landing commit the frame once', () => {
  getMarineSeriesFrame.mockReturnValue(frame());
  const c = ctx();
  expect(paintSeriesWhilePending(c)).toBe(true);
  expect(paintSeriesWhilePending(c)).toBe(true);      // the second closure still holds the pre-commit marineData
  expect(c.commit).toHaveBeenCalledTimes(1);
});

describe('the landing re-runs the settle check only while a fetch is pending', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('pending: runs; idle, scrubbing, no active layer or the kill: does not', () => {
    const check = jest.fn();
    const layer = ref('waves');
    renderHook(() => useSeriesPaintWhilePending(ref(check), layer));
    const land = () => { window.dispatchEvent(new Event('marine_series_revalidated')); jest.runOnlyPendingTimers(); };
    land();
    expect(check).not.toHaveBeenCalled();              // nothing pending: the existing listeners own this
    window.__MARINE_FETCH_PENDING__ = { model: 'GFS', layer: 'waves', hour: 0 };
    land();
    expect(check).toHaveBeenCalledTimes(1);
    window.isScrubbingTimeline = true; land(); window.isScrubbingTimeline = false;
    layer.current = null; land(); layer.current = 'waves';
    window.__RAW_DISABLE_SERIES_PAINT_WHILE_PENDING__ = true; land();
    expect(check).toHaveBeenCalledTimes(1);
    delete window.__RAW_DISABLE_SERIES_PAINT_WHILE_PENDING__;
    // Once the engine draws something the settle hook's own listener owns the landing: a second run here spent the
    // clamp_resharpen budget twice per landing (#426 review).
    window.__MARINE_ENGINE__ = { _waveData: { waveGrid: {} } };
    land();
    expect(check).toHaveBeenCalledTimes(1);
    delete window.__MARINE_ENGINE__;
    land();
    expect(check).toHaveBeenCalledTimes(2);
  });
});
