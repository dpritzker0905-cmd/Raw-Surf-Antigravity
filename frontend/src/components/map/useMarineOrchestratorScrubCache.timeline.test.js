import { renderHook } from '@testing-library/react';
import { useMarineOrchestratorScrubCache } from './useMarineOrchestratorScrubCache';
import { getModelSafeMarine } from './marineController';
import { getMarineSeriesFrame } from './marineGridSeries';
import { getSharedValidTime } from './backendWeatherServiceClient';
import { updateProjectionDiag } from './backendWeatherServiceClientDiag';

jest.mock('./marineController', () => ({ getMarineHourlyCache: jest.fn(),
  getModelSafeMarine: jest.fn(), extractMarineAtOffset: jest.fn() }));
jest.mock('./marineGridSeries', () => ({ getMarineSeriesFrame: jest.fn() }));
jest.mock('./backendWeatherServiceClient', () => ({
  getBackendWeatherFlag: () => true, getBackendIconMarineFlag: () => false,
  getBackendCopernicusFlag: () => false,
  getSharedValidTime: jest.fn(hour => hour === 18 ? '2026-09-21T15:00:00Z' : '2026-09-20T21:00:00Z'),
}));
jest.mock('./useMarineDataFetcherHelpers', () => ({ DISPLAY_ICON_MAX_HOURS: 336,
  DISPLAY_EURO_WAVES_MAX_HOURS: 336, DISPLAY_EURO_COMPONENT_MAX_HOURS: 336 }));

const BOX = { west: -82, south: 26, east: -79, north: 30 };
const ref = current => ({ current });
const frame = hour => ({ hourOffset: hour, product_id: `series-GFS-${hour}`,
  valid_time: hour === 18 ? '2026-09-21T15:00:00Z' : '2026-09-20T21:00:00Z',
  model_run_time: '2026-09-20T06:00:00Z',
  grid: { __sourceModel: 'GFS', __componentLayer: 'waves', __renderable: true,
    cols: 1, rows: 1, bounds: BOX, vectors: [{ lat: 27, lng: -80, speed: 1, u: 0, v: 1 }] } });
const params = () => ({
  timeOffsetHours: 18, mapInstance: { getZoom: () => 9,
    getBounds: () => ({ getWest: () => BOX.west, getEast: () => BOX.east,
      getSouth: () => BOX.south, getNorth: () => BOX.north }) },
  activeMarineLayersRef: ref(true), prevTimeOffsetRef: ref(18), timeOffsetRef: ref(18),
  activeModelRef: ref('GFS'), activeMarineLayerRef: ref('waves'), lastCommittedSigRef: ref('old'),
  marineRevision: ref(1), marineFetchLocksRef: ref({ lastHash: 'old', lastTime: 1 }),
  setMarineData: jest.fn(), logPipelineEventHelper: jest.fn(), getViewportHash: () => 'viewport',
  updateMarineGridRef: ref(jest.fn()), enqueueMarineUpdate: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  getSharedValidTime.mockImplementation(hour => hour === 18 ? '2026-09-21T15:00:00Z' : '2026-09-20T21:00:00Z');
  getModelSafeMarine.mockReturnValue(null);
  getMarineSeriesFrame.mockReturnValue(null);
  window.isScrubbingTimeline = false;
  delete window.__MARINE_RENDER_HOUR_PARITY__;
  delete window.__MARINE_ENGINE__;
  window.__FORECAST_TIMELINE_COVERAGE_DIAG__ = { timeOffsetHours: 18,
    requestedValidTime: '2026-09-21T15:00:00Z', selectedValidTime: '2026-09-21T15:00:00Z',
    gridProductId: 'series-GFS-18', coverage_status: 'full_coverage' };
});

test('reset commits the actual current series identity and leaves the single time owner at zero', () => {
  getMarineSeriesFrame.mockReturnValue(frame(0));
  const args = params();
  const { rerender } = renderHook(p => useMarineOrchestratorScrubCache(p), { initialProps: args });
  rerender({ ...args, timeOffsetHours: 0 });
  expect(args.timeOffsetRef.current).toBe(0);
  expect(args.setMarineData).toHaveBeenCalledWith(expect.objectContaining({ hourOffset: 0 }));
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__).toMatchObject({ timeOffsetHours: 0,
    selectedValidTime: '2026-09-20T21:00:00Z', gridProductId: 'series-GFS-0',
    model_run_time: '2026-09-20T06:00:00Z', temporalStatus: 'aligned' });
  expect(args.enqueueMarineUpdate).not.toHaveBeenCalled();
});

test('a current-hour cache miss retains the old selected time but cannot retain green temporal coverage', () => {
  const args = params();
  const { rerender } = renderHook(p => useMarineOrchestratorScrubCache(p), { initialProps: args });
  rerender({ ...args, timeOffsetHours: 0 });
  expect(args.timeOffsetRef.current).toBe(0);
  expect(args.enqueueMarineUpdate).toHaveBeenCalledWith('timeline_scrub_deferred');
  expect(args.setMarineData).not.toHaveBeenCalled();
  expect(getSharedValidTime).toHaveBeenCalledTimes(1);
  expect(getSharedValidTime).toHaveBeenCalledWith(0, 'waves', 'GFS', { readOnly: true });
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__).toMatchObject({ timeOffsetHours: 0,
    requestedValidTime: '2026-09-20T21:00:00Z', selectedValidTime: '2026-09-21T15:00:00Z',
    coverage_status: 'stale_time_mismatch', temporalStatus: 'response_time_mismatch' });
});

test('A to B to A cache transitions publish the selected identity on every commit without a fetch', () => {
  getMarineSeriesFrame.mockImplementation((model, layer, bounds, hour) => frame(hour));
  const args = params();
  const { rerender } = renderHook(p => useMarineOrchestratorScrubCache(p), { initialProps: args });
  for (const hour of [0, 18, 0]) {
    rerender({ ...args, timeOffsetHours: hour });
    expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__).toMatchObject({
      timeOffsetHours: hour, gridProductId: `series-GFS-${hour}`, temporalStatus: 'aligned',
    });
  }
  expect(args.setMarineData.mock.calls.map(([data]) => data.hourOffset)).toEqual([0, 18, 0]);
  expect(args.enqueueMarineUpdate).not.toHaveBeenCalled();
});

test('a stale cache writer cannot overwrite the requested hour before the stale hit is rejected', () => {
  const retainedTime = '2026-09-21T00:00:00Z';
  getModelSafeMarine.mockImplementation(() => {
    // The real getModelSafeMarine calls its cache diagnostic writer with returnedHour, not wantedHour.
    updateProjectionDiag('marine', { activeModel: 'GFS', activeLayer: 'waves', timeOffsetHours: 3,
      requestedValidTime: retainedTime, validTime: retainedTime, requestedViewportBounds: BOX,
      clampedBbox: BOX, responseGridBounds: BOX, cols: 1, rows: 1, vectorCount: 1, renderable: true });
    return { ...frame(3), valid_time: retainedTime, __staleHour: true };
  });
  const args = params();
  const { rerender } = renderHook(p => useMarineOrchestratorScrubCache(p), { initialProps: args });
  rerender({ ...args, timeOffsetHours: 0 });
  expect(args.setMarineData).not.toHaveBeenCalled();
  expect(args.enqueueMarineUpdate).toHaveBeenCalledWith('timeline_scrub_deferred');
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__).toMatchObject({
    timeOffsetHours: 0, requestedValidTime: '2026-09-20T21:00:00Z', selectedValidTime: retainedTime,
    coverage_status: 'stale_time_mismatch',
  });
});
