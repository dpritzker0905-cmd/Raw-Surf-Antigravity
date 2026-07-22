/**
 * Wind VIEWPORT-refetch stale-HOUR guard (2026-07-22, hunt defect 3.1). The VIEWPORT CHANGE
 * REFETCH effect (WeatherEngine.js ~927) awaits fetchWindData with NO abort signal, so a timeline
 * SCRUB while the fetch is in flight cannot cancel it. The pre-existing model-parity guard (23e544a0)
 * only catches a MODEL switch; an HOUR change slips through, so the OLD hour's covering grid commits
 * and renders AS the newly-scrubbed hour until the scrub effect's own fetch lands. The new guard
 * discards the grid when timeOffsetRef.current !== reqHour (the hour snapshotted at fetch-start).
 * Kill: __RAW_DISABLE_WIND_VIEWPORT_HOUR_GUARD__.
 *
 * Mirrors the harness in weatherEngine.holdLastFrame.test.js. The viewport effect registers a
 * `moveend` listener via mapInstance.on — we capture that handler and drive it directly, holding the
 * hour-0 viewport fetch pending with a manual deferred so we can move the hour mid-flight.
 */
import { renderHook, act } from '@testing-library/react';
import { useWeatherEngine } from '../components/map/WeatherEngine';
import {
  fetchWindData,
  getModelSafeWind,
  getBackendWindFlag,
  getRemainingCooldown,
  isRenderableWindData,
  isContainedInWindCache,
} from '../components/map/marineController';
import { clampViewportBbox } from '../components/map/backendWeatherServiceClientCoverage';

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

// The frame resident before the viewport fetch resolves (warm commit at hour 0).
const frameA = {
  vectors: [
    { lat: 28, lng: -80, speed: 5, direction: 90, u: 1, v: 0 },
    { lat: 30, lng: -82, speed: 7, direction: 180, u: 0, v: -1 },
  ],
  bounds, cols: 2, rows: 1, renderable: true, stale: false, hourOffset: 0, nonzeroCount: 2,
};

// The (renderable) grid the in-flight VIEWPORT fetch returns for hour 0. Distinct object identity so
// we can prove whether it committed or was discarded.
const frameViewport0 = {
  vectors: [
    { lat: 27, lng: -81, speed: 12, direction: 45, u: 2, v: 2 },
    { lat: 29, lng: -83, speed: 9, direction: 270, u: -1, v: 0 },
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

// Manual deferred so the hour-0 viewport fetch can be held pending across the hour change.
let armViewportPending;
let resolveViewport;

// WeatherEngine registers THREE `moveend` handlers (onWindMoveEnd, onIdle, and the VIEWPORT
// CHANGE REFETCH's onMoveEnd). The viewport-refetch effect is the last-defined, so its handler is
// the last registration — that is the one whose stale-hour guard we exercise.
function captureMoveEnd() {
  const calls = mapInstance.on.mock.calls.filter((c) => c[0] === 'moveend');
  return calls.length ? calls[calls.length - 1][1] : null;
}

describe('useWeatherEngine — viewport-refetch stale-HOUR guard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    delete window.__RAW_DISABLE_WIND_VIEWPORT_HOUR_GUARD__;
    delete window.__RAW_WIND_HOLD_LAST_FRAME_DISABLED__;
    window.isScrubbingTimeline = false;
    armViewportPending = false;
    resolveViewport = null;
    mapInstance.on.mockClear();
    mapInstance.off.mockClear();

    clampViewportBbox.mockReturnValue({ isInside: true, clampedBbox: bounds });
    getRemainingCooldown.mockReturnValue(0);
    getBackendWindFlag.mockReturnValue(true);
    isContainedInWindCache.mockReturnValue(false);
    isRenderableWindData.mockImplementation(
      (d) => !!(d && Array.isArray(d.vectors) && d.vectors.length > 0 && d.renderable !== false && !d.stale)
    );
    // Warm cache serves frameA at hour 0 only; other hours miss (forces the scrub path to fetch).
    getModelSafeWind.mockImplementation((model, hour) => (hour === 0 ? frameA : null));
    // hour 0: the viewport fetch we hold pending (when armed); otherwise frameA.
    // hour 48: an UN-renderable scrub result → the scrub path HOLDS frameA (isolates the viewport guard).
    fetchWindData.mockImplementation((b, s, hour) => {
      if (hour === 0 && armViewportPending) {
        armViewportPending = false;
        return new Promise((res) => { resolveViewport = res; });
      }
      if (hour === 0) return Promise.resolve(frameA);
      return Promise.resolve(safeZero(hour)); // hour 48 → unrenderable → scrub holds
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Drive: mount at 0 (warm frameA) → moveend starts a hour-0 viewport fetch (held pending) →
  // rerender to `newHour` (moves timeOffsetRef) → resolve the viewport fetch with frameViewport0.
  async function runInterleave(newHour) {
    const view = renderHook((p) => useWeatherEngine(p), { initialProps: baseProps });
    await act(async () => { jest.advanceTimersByTime(10); });
    expect(view.result.current.windData).toEqual(frameA);

    const onMoveEnd = captureMoveEnd();
    expect(typeof onMoveEnd).toBe('function');

    // Arm + fire moveend at hour 0 → schedules the refetch timer; snapshot reqHour = 0.
    armViewportPending = true;
    act(() => { onMoveEnd(); });
    await act(async () => { jest.advanceTimersByTime(600); }); // fire the 500ms refetch → fetch pending
    expect(resolveViewport).toBeInstanceOf(Function);

    if (newHour !== 0) {
      view.rerender({ ...baseProps, timeOffsetHours: newHour });
      await act(async () => { jest.advanceTimersByTime(300); }); // scrub 150ms timer + flush its fetch
    }

    // Now the in-flight viewport (hour-0) fetch resolves — AFTER the hour has moved.
    await act(async () => { resolveViewport(frameViewport0); });
    await act(async () => {});
    return view;
  }

  it('DISCARDS the stale-hour viewport fetch (hour moved 0→48 mid-flight) — held frame survives', async () => {
    const view = await runInterleave(48);
    // frameViewport0 (hour 0) must NOT have overwritten the display after the scrub to hour 48.
    expect(view.result.current.windData).not.toEqual(frameViewport0);
    expect(view.result.current.windData).toEqual(frameA);
    view.unmount();
  });

  it('kill switch __RAW_DISABLE_WIND_VIEWPORT_HOUR_GUARD__ restores the stale commit (the bug)', async () => {
    window.__RAW_DISABLE_WIND_VIEWPORT_HOUR_GUARD__ = true;
    const view = await runInterleave(48);
    // With the guard disabled, the stale hour-0 grid commits over the current hour (the defect).
    expect(view.result.current.windData).toEqual(frameViewport0);
    view.unmount();
  });

  it('does NOT over-discard: a viewport fetch whose hour is unchanged commits normally', async () => {
    const view = await runInterleave(0); // hour stays 0 → reqHour === timeOffsetRef.current
    expect(view.result.current.windData).toEqual(frameViewport0);
    view.unmount();
  });
});
