/**
 * Model-switch wind-series prewarm (2026-07-10, open-queue #1 — mirror of marine's model-switch
 * prewarm). The scrub-start prewarm fires only on a DRAG and series pages are per-model, so a
 * switched-to model's series stayed cold and every click-jump/landed hour fell to a per-hour
 * fetch. Verifies the new effect: warms on first wind landing + on each model switch, never on
 * hour ticks, and is disabled by __RAW_WIND_MODEL_PREWARM_DISABLED__.
 */
import { renderHook } from '@testing-library/react';
import { useWeatherEngine } from '../components/map/WeatherEngine';
import { prewarmWindSeries } from '../components/map/windGridSeries';
import { clampViewportBbox } from '../components/map/backendWeatherServiceClientCoverage';

jest.mock('../components/map/marineController', () => ({
  fetchWindData: jest.fn(async () => null),
  getRemainingCooldown: jest.fn(() => 0),
  getWindHourlyCache: jest.fn(() => null),
  extractWindAtOffset: jest.fn(() => null),
  isContainedInWindCache: jest.fn(() => false),
  getModelSafeWind: jest.fn(() => null),
  getBackendWindFlag: jest.fn(() => false),
  prewarmSiblingModelWind: jest.fn(),
  isRenderableWindData: jest.fn(() => false),
}));

jest.mock('../components/map/windGridSeries', () => ({
  ensureWindSeries: jest.fn(),
  getWindSeriesFrame: jest.fn(() => null),
  prewarmWindSeries: jest.fn(),
}));

// Keep the primary fetch loop out of the way: outside coverage -> clear + slow retry, no network.
jest.mock('../components/map/backendWeatherServiceClientCoverage', () => ({
  clampViewportBbox: jest.fn(() => ({ isInside: false, fallbackReason: 'test_out_of_coverage' })),
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

const baseProps = {
  activeLayers: ['wind'],
  mapInstance,
  timeOffsetHours: 0,
  activeModel: 'GFS',
  forecastDays: 3,
};

describe('useWeatherEngine — model-switch wind-series prewarm', () => {
  beforeEach(() => {
    // CRA jest runs with resetMocks:true — re-arm implementations the factories set.
    clampViewportBbox.mockReturnValue({ isInside: false, fallbackReason: 'test_out_of_coverage' });
    delete window.__RAW_WIND_MODEL_PREWARM_DISABLED__;
    delete window.__WIND_MODEL_PREWARM_COUNT__;
  });

  it('warms the series on the FIRST wind landing (not only on drag-start)', () => {
    const { unmount } = renderHook((p) => useWeatherEngine(p), { initialProps: baseProps });
    expect(prewarmWindSeries).toHaveBeenCalledTimes(1);
    const [model, bounds, signal] = prewarmWindSeries.mock.calls[0];
    expect(model).toBe('GFS');
    expect(bounds).toEqual({ west: -100, south: 20, east: -80, north: 40 });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(window.__WIND_MODEL_PREWARM_COUNT__).toBe(1);
    unmount();
  });

  it('warms the NEW model on a model switch, and aborts the previous warm', () => {
    const { rerender, unmount } = renderHook((p) => useWeatherEngine(p), { initialProps: baseProps });
    const firstSignal = prewarmWindSeries.mock.calls[0][2];
    rerender({ ...baseProps, activeModel: 'EURO' });
    expect(prewarmWindSeries).toHaveBeenCalledTimes(2);
    expect(prewarmWindSeries.mock.calls[1][0]).toBe('EURO');
    // The GFS warm's controller is aborted so still-queued pages drop off the 1-CPU backend.
    expect(firstSignal.aborted).toBe(true);
    unmount();
  });

  it('does NOT re-warm on hour ticks (ref-guarded to model changes)', () => {
    const { rerender, unmount } = renderHook((p) => useWeatherEngine(p), { initialProps: baseProps });
    expect(prewarmWindSeries).toHaveBeenCalledTimes(1);
    rerender({ ...baseProps, timeOffsetHours: 48 });
    rerender({ ...baseProps, timeOffsetHours: 96 });
    expect(prewarmWindSeries).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('kill switch __RAW_WIND_MODEL_PREWARM_DISABLED__ disables it entirely', () => {
    window.__RAW_WIND_MODEL_PREWARM_DISABLED__ = true;
    const { rerender, unmount } = renderHook((p) => useWeatherEngine(p), { initialProps: baseProps });
    rerender({ ...baseProps, activeModel: 'ICON' });
    expect(prewarmWindSeries).not.toHaveBeenCalled();
    expect(window.__WIND_MODEL_PREWARM_COUNT__).toBeUndefined();
    unmount();
  });

  it('does nothing while wind is inactive, then warms on activation', () => {
    const inactive = { ...baseProps, activeLayers: ['waves'] };
    const { rerender, unmount } = renderHook((p) => useWeatherEngine(p), { initialProps: inactive });
    expect(prewarmWindSeries).not.toHaveBeenCalled();
    rerender(baseProps);
    expect(prewarmWindSeries).toHaveBeenCalledTimes(1);
    unmount();
  });
});
