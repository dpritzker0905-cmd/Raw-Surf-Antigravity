/**
 * Out-of-order resolution through the REAL updateMarineGrid (scrub audit 2026-10-18, W-2 tests R-1 and R-2).
 *
 * Until this file no test drove updateMarineGrid with responses resolving in a different order from their requests
 * (lane-temporal §8: the other useMarineDataFetcherCore.*.test.js files pin helpers). Each fetchMarineData call here returns a
 * deferred the test resolves or rejects by hand; commitMarineData is replaced by a plain state write so what reaches the
 * display is the observable.
 *
 * R-1 (pin): hours 48 -> 6 -> 72 -> 18 requested, answered 48, 72, 18, 6. Only h18 may commit.
 * R-2 (T-03): GFS h48 requested, the user switches to EURO h48, EURO lands, THEN the abandoned GFS request throws a non-abort
 * error. The error path checked the hour only, so it ran `setMarineData(prev => prev is another model ? null : ...)` and
 * blanked the EURO frame. Kill switch __RAW_DISABLE_MARINE_ERROR_IDENTITY__ restores that (asserted below).
 */
import { renderHook, act } from '@testing-library/react';
import { useMarineDataFetcherCore } from './useMarineDataFetcherCore';
import { fetchMarineData, getRemainingCooldown, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { getMarineSeriesFrame } from './marineGridSeries';
import { isInCooldown } from './marineControllerUtils';
import { getTarget } from './marineTransitionCoordinator';
import { handleRegionalGridClearing, commitMarineData } from './useMarineDataFetcherHelpers';

jest.mock('./marineController', () => ({
  fetchMarineData: jest.fn(),
  getRemainingCooldown: jest.fn(() => 0),
  getModelSafeMarine: jest.fn(() => null),
  isContainedInMarineCache: jest.fn(() => false),
}));
jest.mock('./marineGridSeries', () => ({ getMarineSeriesFrame: jest.fn(() => null) }));
jest.mock('./marineControllerUtils', () => ({ ...jest.requireActual('./marineControllerUtils'), isInCooldown: jest.fn(() => false) }));
jest.mock('./marineTransitionCoordinator', () => ({ getTarget: jest.fn(() => null), endTransition: jest.fn(), recordChurn: jest.fn() }));
jest.mock('./useMarineDataFetcherHelpers', () => {
  const actual = jest.requireActual('./useMarineDataFetcherHelpers');
  return {
    ...actual,
    handleRegionalGridClearing: jest.fn(() => ({ west: -82, south: 25, east: -78, north: 29 })),
    commitMarineData: jest.fn(({ data, setMarineData }) => setMarineData(data)),
  };
});

const ref = (v) => ({ current: v });
const frame = (model, hour) => ({
  __sourceModel: model, hourOffset: hour,
  grid: { __sourceModel: model, __componentLayer: 'waves', hourOffset: hour, vectors: [{ waves: { speed: 1 } }], cols: 1, rows: 1, renderable: true },
});

function deferredFetches() {
  const calls = [];
  fetchMarineData.mockImplementation((bounds, zoom, signal, hour, _a, model) => new Promise((resolve, reject) => {
    calls.push({ hour, model, resolve, reject, signal });
  }));
  return calls;
}

function inFlightRegistry() {
  return {
    registerForeground: jest.fn(), find: jest.fn(() => null), detach: jest.fn(), markWanted: jest.fn(),
    complete: jest.fn(() => ({ shouldWake: false })), noteWakeEnqueued: jest.fn(), key: (i) => JSON.stringify(i),
  };
}

function mount() {
  const state = { current: null, writes: [] };
  const setMarineData = jest.fn((v) => { state.current = typeof v === 'function' ? v(state.current) : v; state.writes.push(state.current); });
  const p = {
    mapInstance: { getBounds: () => ({ getWest: () => -82, getEast: () => -78, getSouth: () => 25, getNorth: () => 29 }),
      getZoom: () => 6, isMoving: () => false, isZooming: () => false, once: jest.fn(), off: jest.fn() },
    activeMarineLayerRef: ref('waves'), timeOffsetRef: ref(0), activeModelRef: ref('GFS'),
    marineData: null, setMarineData, marineRevision: ref(0), marineRequestIdRef: ref(0),
    abortControllerRef: ref(null), inFlight: inFlightRegistry(), activeMarineLayersRef: ref(['waves']),
    marineFetchLocksRef: ref({ isFetching: false, activeSource: null, fetchStartedAt: 0, lastHash: null, lastTime: 0 }),
    isCommittingDataRef: ref(false), isInternalMapUpdateRef: ref(false), internalUpdateTimerRef: ref(null),
    swrTimerRef: ref(null), swrRetryCountRef: ref(0), cooldownRetryRef: ref(null),
    clearAllTimers: jest.fn(), scheduleSWRRevalidation: jest.fn(), scheduleCooldownRetry: jest.fn(), scheduleDegenerateRetry: jest.fn(),
    resetRetryCounts: jest.fn(), updateMarineGridRef: ref(null), enqueueMarineUpdateRef: ref(null),
    consecutiveFailuresRef: ref(0), abortRecoveryRetryCountRef: ref(0), lastFetchedModelRef: ref(null), pendingMarineIntentRef: ref(null),
    pipelineEventsRef: ref([]), pipelineCountersRef: ref({}), lastCommittedSigRef: ref(null), orchestratorInFlight: ref(new Map()),
    scheduledRef: ref(false), timeoutIdRef: ref(null), moveendDebounceRef: ref({ timer: null }), scrubDebounceRef: ref(null),
    detachedWaitTimerRef: ref(null), getViewportHash: () => 'vp-1', logPipelineEventHelper: jest.fn(),
    marineDataRef: ref(null), lastInvocationRef: ref(null),
  };
  const { result } = renderHook(() => useMarineDataFetcherCore(p));
  return { p, state, update: result.current.updateMarineGrid };
}

let logSpy; let errSpy;
beforeEach(() => {
  jest.useFakeTimers();
  // CRA's jest config sets resetMocks: true, which wipes the factory implementations before every test: re-arm them.
  getRemainingCooldown.mockReturnValue(0);
  getModelSafeMarine.mockReturnValue(null);
  isContainedInMarineCache.mockReturnValue(false);
  getMarineSeriesFrame.mockReturnValue(null);
  isInCooldown.mockReturnValue(false);
  getTarget.mockReturnValue(null);
  handleRegionalGridClearing.mockReturnValue({ west: -82, south: 25, east: -78, north: 29 });
  commitMarineData.mockImplementation(({ data, setMarineData }) => setMarineData(data));
  window.isScrubbingTimeline = false;
  delete window.__RAW_DISABLE_MARINE_ERROR_IDENTITY__;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  logSpy.mockRestore(); errSpy.mockRestore();
  delete window.__RAW_DISABLE_MARINE_ERROR_IDENTITY__;
  delete window.isScrubbingTimeline;
});

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('R-1: out-of-order responses — only the latest selection commits', () => {
  it('48 -> 6 -> 72 -> 18 requested, resolved 48, 72, 18, 6: the display ends on h18 and no older hour ever commits after it', async () => {
    const calls = deferredFetches();
    const { p, state, update } = mount();
    const runs = [];
    for (const h of [48, 6, 72, 18]) {
      p.timeOffsetRef.current = h;
      runs.push(update('timeline_scrub'));
      await flush();
    }
    expect(calls.map((c) => c.hour)).toEqual([48, 6, 72, 18]);
    const byHour = Object.fromEntries(calls.map((c) => [c.hour, c]));
    for (const h of [48, 72, 18, 6]) { byHour[h].resolve(frame('GFS', h)); await flush(); }
    await act(async () => { await Promise.all(runs); });
    expect(state.writes.map((w) => w && w.hourOffset)).toEqual([18]);
    expect(state.current.hourOffset).toBe(18);
    expect(p.marineFetchLocksRef.current.isFetching).toBe(false);
    expect(window.__MARINE_FETCH_PENDING__ == null).toBe(true);
  });
});

describe('R-2 (T-03): a late error from an abandoned request after a model switch', () => {
  async function switchThenStaleError() {
    const calls = deferredFetches();
    const { p, state, update } = mount();
    p.timeOffsetRef.current = 48;
    const gfsRun = update('manual');                 // request 1: GFS h48
    await flush();
    p.activeModelRef.current = 'EURO';
    const euroRun = update('manual');                // request 2: EURO h48 (request 1 is detached, still running)
    await flush();
    expect(calls.map((c) => `${c.model}/${c.hour}`)).toEqual(['GFS/48', 'EURO/48']);
    calls[1].resolve(frame('EURO', 48));
    await act(async () => { await euroRun; });
    expect(state.current.__sourceModel).toBe('EURO');
    calls[0].reject(new Error('boom'));              // a non-abort exception from the abandoned GFS request
    await act(async () => { await gfsRun; });
    return state;
  }

  it('keeps the EURO frame (was: setMarineData(null) blanked it)', async () => {
    const state = await switchThenStaleError();
    expect(state.current).not.toBeNull();
    expect(state.current.__sourceModel).toBe('EURO');
    expect(state.current.stale).toBeUndefined();
  });

  it('the CURRENT request\'s own error still marks a same-model resident stale (the recovery signal is kept)', async () => {
    const calls = deferredFetches();
    const { p, state, update } = mount();
    p.timeOffsetRef.current = 24;
    state.current = frame('GFS', 21);
    const run = update('manual');
    await flush();
    calls[0].reject(new Error('boom'));
    await act(async () => { await run; });
    expect(state.current.stale).toBe(true);
    expect(state.current.__sourceModel).toBe('GFS');
  });

  it('kill switch __RAW_DISABLE_MARINE_ERROR_IDENTITY__ restores the hour-only test (the defect: the EURO frame is blanked)', async () => {
    window.__RAW_DISABLE_MARINE_ERROR_IDENTITY__ = true;
    const state = await switchThenStaleError();
    expect(state.current).toBeNull();
  });
});
