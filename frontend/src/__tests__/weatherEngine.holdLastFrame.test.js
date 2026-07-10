/**
 * Wind settle hold-last-frame + terminal-skip (2026-07-10, audit queue #2 — wind analog of
 * marine d38a693b). The settle path's old `vectors.length > 0` guard let the 1-vector safe-zero
 * fallback COMMIT (= the "wind clears at 14 days" blank), and doomed no-coverage hours were
 * re-fetched on every landed hour. Now: unrenderable results HOLD the last-good frame
 * (kill: __RAW_WIND_HOLD_LAST_FRAME_DISABLED__ restores clearing), and terminal-recorded hours
 * skip the fetch entirely (kill: __RAW_DISABLE_TERMINAL_NOCOV_BYPASS__, shared with marine).
 */
import { renderHook, act } from '@testing-library/react';
import { useWeatherEngine } from '../components/map/WeatherEngine';
import {
  fetchWindData,
  getModelSafeWind,
  getBackendWindFlag,
  getRemainingCooldown,
  isRenderableWindData,
} from '../components/map/marineController';
import { clampViewportBbox } from '../components/map/backendWeatherServiceClientCoverage';
import {
  recordTerminalNoCoverage,
  _resetTerminalNoCoverageForTest,
} from '../components/map/marineControllerCache';

jest.mock('../components/map/marineController', () => ({
  fetchWindData: jest.fn(),
  getRemainingCooldown: jest.fn(),
  getWindHourlyCache: jest.fn(() => null),
  extractWindAtOffset: jest.fn(() => null),
  isContainedInWindCache: jest.fn(() => false),
  getModelSafeWind: jest.fn(),
  getBackendWindFlag: jest.fn(),
  prewarmSiblingModelWind: jest.fn(),
  isRenderableWindData: jest.fn(),
}));

jest.mock('../components/map/windGridSeries', () => ({
  ensureWindSeries: jest.fn(),
  getWindSeriesFrame: jest.fn(() => null),
  prewarmWindSeries: jest.fn(),
}));

jest.mock('../components/map/backendWeatherServiceClientCoverage', () => ({
  clampViewportBbox: jest.fn(),
}));

jest.mock('../components/map/weatherTruthTracker', () => ({
  recordTruthStage: jest.fn(),
}));

jest.mock('../engine/data/forecast-pipeline', () => ({
  onForecastUpdate: jest.fn(() => () => {}),
}));

const mapInstance = {
  getBounds: () => ({
    getWest: () => -100,
    getSouth: () => 20,
    getEast: () => -80,
    getNorth: () => 40,
  }),
  on: jest.fn(),
  off: jest.fn(),
};

const bounds = { west: -100, south: 20, east: -80, north: 40 };

const frameA = {
  vectors: [
    { lat: 28, lng: -80, speed: 5, direction: 90, u: 1, v: 0 },
    { lat: 30, lng: -82, speed: 7, direction: 180, u: 0, v: -1 },
  ],
  bounds, cols: 2, rows: 1, renderable: true, stale: false, hourOffset: 0, nonzeroCount: 2,
};

const safeZero = (hour) => ({
  vectors: [{ lat: 30, lng: -90, speed: 0, direction: 0, u: 0, v: 0 }],
  bounds, cols: 1, rows: 1, stale: true, renderable: false, hourOffset: hour,
  nonzeroCount: 0, __failureReason: 'no_wind_coverage',
});

const baseProps = {
  activeLayers: ['wind'],
  mapInstance,
  timeOffsetHours: 0,
  activeModel: 'GFS',
  forecastDays: 3,
};

// Mount at hour 0 (primary loop warm-commits frameA), then rerender to `hour` and run the
// 150ms settle timer + flush the async fetch chain.
async function mountAndSettleTo(hour, props = baseProps) {
  const view = renderHook((p) => useWeatherEngine(p), { initialProps: props });
  await act(async () => { jest.advanceTimersByTime(10); });
  expect(view.result.current.windData).toEqual(frameA); // warm commit from getModelSafeWind
  view.rerender({ ...props, timeOffsetHours: hour });
  await act(async () => { jest.advanceTimersByTime(200); });
  await act(async () => {}); // flush the awaited fetch inside the settle timeout
  return view;
}

describe('useWeatherEngine — settle hold-last-frame + terminal no-coverage skip', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _resetTerminalNoCoverageForTest();
    delete window.__RAW_WIND_HOLD_LAST_FRAME_DISABLED__;
    delete window.__WIND_TERMINAL_NOCOV_SKIP_COUNT__;
    window.isScrubbingTimeline = false;
    // CRA jest resetMocks:true — re-arm implementations each test.
    clampViewportBbox.mockReturnValue({ isInside: true, clampedBbox: bounds });
    getRemainingCooldown.mockReturnValue(0);
    getBackendWindFlag.mockReturnValue(true);
    isRenderableWindData.mockImplementation(
      (d) => !!(d && Array.isArray(d.vectors) && d.vectors.length > 0 && d.renderable !== false && !d.stale)
    );
    // Warm cache serves frameA at hour 0 only; other hours miss.
    getModelSafeWind.mockImplementation((model, hour) => (hour === 0 ? frameA : null));
    fetchWindData.mockImplementation(async (b, s, hour) => (hour === 0 ? frameA : safeZero(hour)));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('HOLDS the last-good frame when the settle fetch returns an unrenderable safe-zero (was: committed the blank)', async () => {
    const { result, unmount } = await mountAndSettleTo(272);
    expect(fetchWindData).toHaveBeenCalledWith(expect.anything(), null, 272, false, 3, 'GFS');
    expect(result.current.windData).toEqual(frameA); // held — NOT null, NOT the 1-vector safe-zero
    unmount();
  });

  it('SKIPS the fetch entirely for a terminal-recorded hour and counts the skip', async () => {
    recordTerminalNoCoverage('GFS', 'wind', 300);
    const { result, unmount } = await mountAndSettleTo(300);
    expect(fetchWindData).not.toHaveBeenCalledWith(expect.anything(), null, 300, false, 3, 'GFS');
    expect(window.__WIND_TERMINAL_NOCOV_SKIP_COUNT__).toBe(1);
    expect(result.current.windData).toEqual(frameA); // held frame keeps displaying
    unmount();
  });

  it('kill switch __RAW_WIND_HOLD_LAST_FRAME_DISABLED__ restores the old clear-on-no-coverage', async () => {
    window.__RAW_WIND_HOLD_LAST_FRAME_DISABLED__ = true;
    const { result, unmount } = await mountAndSettleTo(250);
    expect(result.current.windData).toBeNull(); // old behavior: visual cleared
    unmount();
  });

  it('a renderable settle fetch still commits normally', async () => {
    const frameB = { ...frameA, hourOffset: 48 };
    fetchWindData.mockImplementation(async (b, s, hour) => (hour === 48 ? frameB : safeZero(hour)));
    const { result, unmount } = await mountAndSettleTo(48);
    expect(result.current.windData).toEqual(frameB);
    unmount();
  });
});
