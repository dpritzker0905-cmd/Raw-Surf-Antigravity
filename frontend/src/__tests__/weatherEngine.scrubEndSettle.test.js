/**
 * R-4 (scrub audit 2026-10-18, T-02): wind must fetch the FINAL hour after a wheel drag.
 *
 * During a drag the wind timeline effect is cache-only and returns on a miss. The wheel dedups its release commit when the final
 * detent was already committed mid-drag, so no new timeOffsetHours arrives after release and the settle path never ran: the
 * particles stayed on the pre-drag hour until a pan. Now an in-drag miss is remembered and `timeline_scrub_end` re-runs the
 * settle path once for it. Kill: __RAW_DISABLE_WIND_SCRUB_END_SETTLE__.
 */
import { renderHook, act } from '@testing-library/react';
import { useWeatherEngine } from '../components/map/WeatherEngine';
import {
  fetchWindData, getModelSafeWind, getBackendWindFlag, getRemainingCooldown, isRenderableWindData,
} from '../components/map/marineController';
import { clampViewportBbox } from '../components/map/backendWeatherServiceClientCoverage';
import { _resetTerminalNoCoverageForTest } from '../components/map/marineControllerCache';
import { shouldResettleWindAfterDrag } from '../components/map/windScrubEndSettle';

jest.mock('../components/map/marineController', () => ({
  fetchWindData: jest.fn(), getRemainingCooldown: jest.fn(), getWindHourlyCache: jest.fn(() => null),
  extractWindAtOffset: jest.fn(() => null), isContainedInWindCache: jest.fn(() => false), getModelSafeWind: jest.fn(),
  getBackendWindFlag: jest.fn(), prewarmSiblingModelWind: jest.fn(), isRenderableWindData: jest.fn(),
}));
jest.mock('../components/map/windGridSeries', () => ({
  ensureWindSeries: jest.fn(), getWindSeriesFrame: jest.fn(() => null), prewarmWindSeries: jest.fn(),
}));
jest.mock('../components/map/backendWeatherServiceClientCoverage', () => ({ clampViewportBbox: jest.fn() }));
jest.mock('../components/map/weatherTruthTracker', () => ({ recordTruthStage: jest.fn() }));
jest.mock('../engine/data/forecast-pipeline', () => ({ onForecastUpdate: jest.fn(() => () => {}) }));

const mapInstance = {
  getBounds: () => ({ getWest: () => -100, getSouth: () => 20, getEast: () => -80, getNorth: () => 40 }),
  on: jest.fn(), off: jest.fn(),
};
const bounds = { west: -100, south: 20, east: -80, north: 40 };
const frameAt = (hour) => ({
  vectors: [{ lat: 28, lng: -80, speed: 5 + hour, direction: 90, u: 1, v: 0 }, { lat: 30, lng: -82, speed: 7, direction: 180, u: 0, v: -1 }],
  bounds, cols: 2, rows: 1, renderable: true, stale: false, hourOffset: hour, nonzeroCount: 2,
});
const baseProps = { activeLayers: ['wind'], mapInstance, timeOffsetHours: 0, activeModel: 'GFS', forecastDays: 3 };

async function dragTo(hour) {
  const view = renderHook((p) => useWeatherEngine(p), { initialProps: baseProps });
  await act(async () => { jest.advanceTimersByTime(10); });
  window.isScrubbingTimeline = true;                     // the wheel's in-drag commit of the final detent: cache-only, misses
  view.rerender({ ...baseProps, timeOffsetHours: hour });
  await act(async () => { jest.advanceTimersByTime(200); });
  await act(async () => {});
  expect(fetchWindData).not.toHaveBeenCalledWith(expect.anything(), null, hour, false, 3, 'GFS');
  // Release: the wheel's final commit is DEDUPED (same detent), so only scrub end arrives.
  window.isScrubbingTimeline = false;
  await act(async () => { window.dispatchEvent(new CustomEvent('timeline_scrub_end')); });
  await act(async () => { jest.advanceTimersByTime(200); });
  await act(async () => {});
  return view;
}

describe('R-4: wind settles the final hour of a drag', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _resetTerminalNoCoverageForTest();
    delete window.__RAW_DISABLE_WIND_SCRUB_END_SETTLE__;
    window.isScrubbingTimeline = false;
    clampViewportBbox.mockReturnValue({ isInside: true, clampedBbox: bounds });
    getRemainingCooldown.mockReturnValue(0);
    getBackendWindFlag.mockReturnValue(true);
    isRenderableWindData.mockImplementation((d) => !!(d && Array.isArray(d.vectors) && d.vectors.length > 0 && d.renderable !== false && !d.stale));
    getModelSafeWind.mockImplementation((model, hour) => (hour === 0 ? frameAt(0) : null));
    fetchWindData.mockImplementation(async (b, s, hour) => frameAt(hour));
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.isScrubbingTimeline;
    delete window.__RAW_DISABLE_WIND_SCRUB_END_SETTLE__;
  });

  it('fetches and commits the final hour after release (was: particles stayed on the pre-drag hour)', async () => {
    const { result, unmount } = await dragTo(12);
    expect(fetchWindData).toHaveBeenCalledWith(expect.anything(), null, 12, false, 3, 'GFS');
    expect(result.current.windData.hourOffset).toBe(12);
    unmount();
  });

  it('an in-drag cache HIT owes nothing at scrub end (no extra fetch)', async () => {
    getModelSafeWind.mockImplementation((model, hour) => frameAt(hour));
    const { result, unmount } = await dragTo(12);
    expect(fetchWindData.mock.calls.filter((c) => c[2] === 12)).toEqual([]);   // the mount's own hour-0 loads are not ours
    expect(result.current.windData.hourOffset).toBe(12);
    unmount();
  });

  it('kill switch __RAW_DISABLE_WIND_SCRUB_END_SETTLE__ restores the old behaviour (the defect: no fetch, still hour 0)', async () => {
    window.__RAW_DISABLE_WIND_SCRUB_END_SETTLE__ = true;
    const { result, unmount } = await dragTo(12);
    expect(fetchWindData).not.toHaveBeenCalledWith(expect.anything(), null, 12, false, 3, 'GFS');
    expect(result.current.windData.hourOffset).toBe(0);
    unmount();
  });
});

describe('shouldResettleWindAfterDrag (pure)', () => {
  it('only when the hour that missed mid-drag is still selected', () => {
    expect(shouldResettleWindAfterDrag(12, 12, {})).toBe(true);
    expect(shouldResettleWindAfterDrag(12, 13, {})).toBe(false);   // a newer hour owns its own settle
    expect(shouldResettleWindAfterDrag(null, 12, {})).toBe(false);
    expect(shouldResettleWindAfterDrag(0, 0, {})).toBe(true);      // hour 0 is a real hour
    expect(shouldResettleWindAfterDrag(12, 12, { __RAW_DISABLE_WIND_SCRUB_END_SETTLE__: true })).toBe(false);
  });
});
