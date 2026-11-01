/**
 * SERIES_PAINT_WHILE_PENDING through the REAL settle check (#426 review, 2026-10-21): the direct paintSeriesWhilePending tests stayed
 * green with its only call site deleted, so these drive runScrubSettleCheck with a /grid pending for the selected hour. Also pins
 * the review's regional rule: a world-width series frame is never painted over a drawn frame at a regional view.
 */
import { runScrubSettleCheck } from './useMarineScrubSettle';
import { getMarineSeriesFrame } from './marineGridSeries';
import { _resetSeriesPaintForTest } from './marineSeriesWhilePending';
import { _resetExactUpgradeForTest } from './marineExactUpgrade';

jest.mock('./marineGridSeries', () => ({ getMarineSeriesFrame: jest.fn(), ensureMarineSeries: jest.fn() }));

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const REGION = { west: -81.5, south: 27, east: -79.5, north: 29 };
const vec = [{ lat: 28, lng: -80, speed: 1, u: 0, v: 1 }];
const frame = (bounds, hour, cols = 181) => ({ hourOffset: hour, valid_time: '2026-10-21T12:00:00Z',
  grid: { bounds, cols, rows: 83, vectors: vec, hourOffset: hour, __fromSeries: true, __sourceModel: 'GFS', __componentLayer: 'waves' } });
const mkMap = (zoom, b) => ({ getZoom: () => zoom,
  getBounds: () => ({ getWest: () => b.west, getEast: () => b.east, getSouth: () => b.south, getNorth: () => b.north }) });
const mkCtx = ({ marineData = null, hour = 0, zoom = 3.5, view = { west: -160, south: -10, east: 0, north: 55 } } = {}) => ({
  marineData, mapInstance: mkMap(zoom, view), setMarineData: jest.fn(),
  timeOffsetRef: { current: hour }, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' },
  safetyNetRetryRef: { current: { key: '', count: 0 } }, clampRefetchRef: { current: { key: '', count: 0 } },
  marineFetchLocksRef: { current: { isFetching: true, lastHash: 'h' } }, updateMarineGridRef: { current: jest.fn() },
  marineRevision: { current: 0 }, lastCommittedSigRef: { current: null },
});
const pending = (hour) => { window.__MARINE_FETCH_PENDING__ = { model: 'GFS', layer: 'waves', hour, timestamp: new Date().toISOString() }; };

beforeEach(() => {
  jest.clearAllMocks();
  _resetSeriesPaintForTest();
  _resetExactUpgradeForTest();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  delete window.__MARINE_ENGINE__;
  delete window.__RAW_DISABLE_SERIES_PAINT_WHILE_PENDING__;
  delete window.__RAW_DISABLE_REQUEST_DIET__;
  delete window.__MARINE_REQUEST_DIET__;
  window.isScrubbingTimeline = false;
});
afterEach(() => { jest.restoreAllMocks(); delete window.__MARINE_FETCH_PENDING__; });

test('load: nothing drawn, the /grid for hour 0 pending, the mini landed -> the settle check commits it (stamped) and fetches nothing', () => {
  const f = frame(WORLD, 0);
  getMarineSeriesFrame.mockReturnValue(f);
  pending(0);
  const ctx = mkCtx();
  runScrubSettleCheck(ctx);
  expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
  const committed = ctx.setMarineData.mock.calls[0][0];
  expect(committed.grid).toBe(f.grid);
  expect(committed.__commitLane).toBe('series_pending');
  expect(committed.__commitRevision).toBe(1);
  expect(ctx.updateMarineGridRef.current).not.toHaveBeenCalled();     // the pending /grid is the only request
});

test('the kill switch restores the hold: nothing committed while the /grid is pending', () => {
  window.__RAW_DISABLE_SERIES_PAINT_WHILE_PENDING__ = true;
  getMarineSeriesFrame.mockReturnValue(frame(WORLD, 0));
  pending(0);
  const ctx = mkCtx();
  runScrubSettleCheck(ctx);
  expect(ctx.setMarineData).not.toHaveBeenCalled();
});

test('regional view (z8), a fine frame drawn, the hour moved: a WORLD-width series frame is not painted over it', () => {
  getMarineSeriesFrame.mockReturnValue(frame(WORLD, 150, 46));
  pending(150);
  const resident = { hourOffset: 100, grid: { bounds: REGION, cols: 9, rows: 9, vectors: vec, hourOffset: 100, valid_time: '2026-10-25T16:00:00Z',
    __sourceModel: 'GFS', __componentLayer: 'waves' } };
  const ctx = mkCtx({ marineData: resident, hour: 150, zoom: 8, view: REGION });
  runScrubSettleCheck(ctx);
  expect(ctx.setMarineData).not.toHaveBeenCalled();
  expect(window.__MARINE_REQUEST_DIET__.last.series_paint_miss.reason).toBe('world_frame_at_regional_view');
});

test('regional view with NOTHING drawn: the world frame is painted (a coarse frame beats none)', () => {
  getMarineSeriesFrame.mockReturnValue(frame(WORLD, 150, 46));
  pending(150);
  const ctx = mkCtx({ hour: 150, zoom: 8, view: REGION });
  runScrubSettleCheck(ctx);
  expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
});

test('regional view, a regional series frame for the new hour: painted over the drawn frame', () => {
  const regional = frame(REGION, 150, 9);
  getMarineSeriesFrame.mockReturnValue(regional);
  pending(150);
  const resident = { hourOffset: 100, grid: { bounds: REGION, cols: 9, rows: 9, vectors: vec, hourOffset: 100, valid_time: '2026-10-25T16:00:00Z',
    __sourceModel: 'GFS', __componentLayer: 'waves' } };
  const ctx = mkCtx({ marineData: resident, hour: 150, zoom: 8, view: REGION });
  runScrubSettleCheck(ctx);
  expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
  expect(ctx.setMarineData.mock.calls[0][0].grid).toBe(regional.grid);
});
