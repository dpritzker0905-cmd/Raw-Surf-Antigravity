/**
 * STEP_PAGE (request diet 2026-10-20): an hour step that misses every cache also asks for the 48-frame page holding that hour
 * (current page only), besides the one exact /grid it always sent. Not while dragging. The kill switch is the control arm.
 */
import { renderHook } from '@testing-library/react';
import { requestStepPage, useMarineOrchestratorScrubCache } from './useMarineOrchestratorScrubCache';
import { getModelSafeMarine } from './marineController';
import { ensureMarineSeries, getMarineSeriesFrame } from './marineGridSeries';

jest.mock('./marineController', () => ({ getMarineHourlyCache: jest.fn(), getModelSafeMarine: jest.fn(), extractMarineAtOffset: jest.fn() }));
jest.mock('./marineGridSeries', () => ({ getMarineSeriesFrame: jest.fn(), ensureMarineSeries: jest.fn() }));
jest.mock('./backendWeatherServiceClient', () => ({
  getBackendWeatherFlag: () => true, getBackendIconMarineFlag: () => true, getBackendCopernicusFlag: () => true,
  getSharedValidTime: jest.fn(() => '2026-10-23T00:00:00Z'),
}));
jest.mock('./useMarineDataFetcherHelpers', () => ({ DISPLAY_ICON_MAX_HOURS: 336,
  DISPLAY_EURO_WAVES_MAX_HOURS: 336, DISPLAY_EURO_COMPONENT_MAX_HOURS: 336 }));

const VIEW = { west: -160, south: -10, east: 0, north: 55 };
const ref = (current) => ({ current });
const params = (hour) => ({
  timeOffsetHours: hour, mapInstance: { getZoom: () => 3.5,
    getBounds: () => ({ getWest: () => VIEW.west, getEast: () => VIEW.east, getSouth: () => VIEW.south, getNorth: () => VIEW.north }) },
  activeMarineLayersRef: ref(true), prevTimeOffsetRef: ref(0), timeOffsetRef: ref(0),
  activeModelRef: ref('EURO'), activeMarineLayerRef: ref('waves'), lastCommittedSigRef: ref(null),
  marineRevision: ref(1), marineFetchLocksRef: ref({ lastHash: 'h', lastTime: 1 }),
  setMarineData: jest.fn(), logPipelineEventHelper: jest.fn(), getViewportHash: () => 'viewport',
  updateMarineGridRef: ref(jest.fn()), enqueueMarineUpdate: jest.fn(),
});
const step = (hour) => { const p = params(0); const { rerender } = renderHook((q) => useMarineOrchestratorScrubCache(q), { initialProps: p });
  const next = { ...p, timeOffsetHours: hour }; rerender(next); return next; };

beforeEach(() => {
  jest.clearAllMocks();
  getModelSafeMarine.mockReturnValue(null);
  getMarineSeriesFrame.mockReturnValue(null);
  window.isScrubbingTimeline = false;
  delete window.__RAW_DISABLE_STEP_PAGE__;
  delete window.__RAW_DISABLE_REQUEST_DIET__;
  delete window.__MARINE_REQUEST_DIET__;
});

test('a step past the loaded pages asks for its page (current page only) as well as its exact grid', () => {
  const p = step(60);
  expect(p.enqueueMarineUpdate).toHaveBeenCalledWith('timeline_scrub_deferred');
  expect(ensureMarineSeries).toHaveBeenCalledTimes(1);
  expect(ensureMarineSeries).toHaveBeenCalledWith('EURO', 'waves', VIEW, 60, undefined, true);
  expect(window.__MARINE_REQUEST_DIET__.counts.step_page_requested).toBe(1);
});

test('the kill switch restores the old step (one exact grid, no page)', () => {
  window.__RAW_DISABLE_STEP_PAGE__ = true;
  const p = step(60);
  expect(p.enqueueMarineUpdate).toHaveBeenCalledWith('timeline_scrub_deferred');
  expect(ensureMarineSeries).not.toHaveBeenCalled();
});

test('a step the cache serves asks for nothing; a drag leaves pages to the drag prewarm', () => {
  getMarineSeriesFrame.mockReturnValue({ hourOffset: 60, product_id: 'series_EURO_waves_h60', valid_time: '2026-10-23T00:00:00Z',
    grid: { __sourceModel: 'EURO', __componentLayer: 'waves', __renderable: true, cols: 46, rows: 21,
      bounds: { west: -180, south: -80, east: 180, north: 85 }, vectors: [{ lat: 1, lng: 1, speed: 1 }] } });
  step(60);
  expect(ensureMarineSeries).not.toHaveBeenCalled();
  getMarineSeriesFrame.mockReturnValue(null);
  expect(requestStepPage('EURO', 'waves', VIEW, 61)).toBe(true);
  window.isScrubbingTimeline = true;
  expect(requestStepPage('EURO', 'waves', VIEW, 62)).toBe(false);
  expect(ensureMarineSeries).toHaveBeenCalledTimes(1);
});
