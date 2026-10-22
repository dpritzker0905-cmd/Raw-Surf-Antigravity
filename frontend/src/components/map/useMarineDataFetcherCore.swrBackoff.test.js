/**
 * SWR_BACKOFF's call site through the REAL updateMarineGrid (first written for #426's SWR_RETRY_CAP, 2026-10-21; the re-implemented
 * loop in marineRequestDiet.test.js stayed green with the fetcher's call site reverted, so this drives useMarineDataFetcherCore
 * itself). The part ships ON (kill window.__RAW_DISABLE_SWR_BACKOFF__): the SWR re-drive keeps its attempt count so the ladder
 * climbs; every other source resets it, and under the kill every run resets it, exactly as before. Harness:
 * useMarineDataFetcherCore.race.test.js's mount, with the viewport hash already current so the viewport-change reset (a separate,
 * legitimate reset) stays out of the count.
 */
import { renderHook, act } from '@testing-library/react';
import { useMarineDataFetcherCore } from './useMarineDataFetcherCore';
import { fetchMarineData, getRemainingCooldown, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { getMarineSeriesFrame } from './marineGridSeries';
import { isInCooldown } from './marineControllerUtils';
import { getTarget } from './marineTransitionCoordinator';
import { handleRegionalGridClearing, commitMarineData } from './useMarineDataFetcherHelpers';

jest.mock('./marineController', () => ({
  fetchMarineData: jest.fn(), getRemainingCooldown: jest.fn(() => 0),
  getModelSafeMarine: jest.fn(() => null), isContainedInMarineCache: jest.fn(() => false),
}));
jest.mock('./marineGridSeries', () => ({ getMarineSeriesFrame: jest.fn(() => null) }));
jest.mock('./marineControllerUtils', () => ({ ...jest.requireActual('./marineControllerUtils'), isInCooldown: jest.fn(() => false) }));
jest.mock('./marineTransitionCoordinator', () => ({ getTarget: jest.fn(() => null), endTransition: jest.fn(), recordChurn: jest.fn() }));
jest.mock('./useMarineDataFetcherHelpers', () => {
  const actual = jest.requireActual('./useMarineDataFetcherHelpers');
  return { ...actual, handleRegionalGridClearing: jest.fn(() => ({ west: -82, south: 25, east: -78, north: 29 })), commitMarineData: jest.fn() };
});

const ref = (v) => ({ current: v });
function mount() {
  const p = {
    mapInstance: { getBounds: () => ({ getWest: () => -82, getEast: () => -78, getSouth: () => 25, getNorth: () => 29 }),
      getZoom: () => 6, isMoving: () => false, isZooming: () => false, once: jest.fn(), off: jest.fn() },
    activeMarineLayerRef: ref('waves'), timeOffsetRef: ref(0), activeModelRef: ref('GFS'),
    marineData: null, setMarineData: jest.fn(), marineRevision: ref(0), marineRequestIdRef: ref(0),
    abortControllerRef: ref(null), activeMarineLayersRef: ref(['waves']),
    inFlight: { registerForeground: jest.fn(), find: jest.fn(() => null), detach: jest.fn(), markWanted: jest.fn(),
      complete: jest.fn(() => ({ shouldWake: false })), noteWakeEnqueued: jest.fn(), key: (i) => JSON.stringify(i) },
    // lastHash already the current viewport: only the run-top reset (the SWR_BACKOFF site) can call resetRetryCounts.
    marineFetchLocksRef: ref({ isFetching: false, activeSource: null, fetchStartedAt: 0, lastHash: 'vp-1', lastTime: 0 }),
    isCommittingDataRef: ref(false), isInternalMapUpdateRef: ref(false), internalUpdateTimerRef: ref(null),
    swrTimerRef: ref(null), swrRetryCountRef: ref(2), cooldownRetryRef: ref(null),
    clearAllTimers: jest.fn(), scheduleSWRRevalidation: jest.fn(), scheduleCooldownRetry: jest.fn(), scheduleDegenerateRetry: jest.fn(),
    resetRetryCounts: jest.fn(), updateMarineGridRef: ref(null), enqueueMarineUpdateRef: ref(null),
    consecutiveFailuresRef: ref(0), abortRecoveryRetryCountRef: ref(0), lastFetchedModelRef: ref(null), pendingMarineIntentRef: ref(null),
    pipelineEventsRef: ref([]), pipelineCountersRef: ref({}), lastCommittedSigRef: ref(null), orchestratorInFlight: ref(new Map()),
    scheduledRef: ref(false), timeoutIdRef: ref(null), moveendDebounceRef: ref({ timer: null }), scrubDebounceRef: ref(null),
    detachedWaitTimerRef: ref(null), getViewportHash: () => 'vp-1', logPipelineEventHelper: jest.fn(),
    marineDataRef: ref(null), lastInvocationRef: ref(null),
  };
  const { result } = renderHook(() => useMarineDataFetcherCore(p));
  return { p, update: result.current.updateMarineGrid };
}

let logSpy; let errSpy; let warnSpy;
beforeEach(() => {
  jest.useFakeTimers();
  getRemainingCooldown.mockReturnValue(0);
  getModelSafeMarine.mockReturnValue(null);
  isContainedInMarineCache.mockReturnValue(false);
  getMarineSeriesFrame.mockReturnValue(null);
  isInCooldown.mockReturnValue(false);
  getTarget.mockReturnValue(null);
  handleRegionalGridClearing.mockReturnValue({ west: -82, south: 25, east: -78, north: 29 });
  commitMarineData.mockImplementation(() => {});
  fetchMarineData.mockResolvedValue(null);
  window.isScrubbingTimeline = false;
  delete window.__RAW_DISABLE_SWR_BACKOFF__;
  delete window.__RAW_DISABLE_REQUEST_DIET__;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  logSpy.mockRestore(); errSpy.mockRestore(); warnSpy.mockRestore();
  delete window.__RAW_DISABLE_SWR_BACKOFF__;
  delete window.__RAW_DISABLE_REQUEST_DIET__;
  delete window.isScrubbingTimeline;
});

const run = async (source) => {
  const { p, update } = mount();
  await act(async () => { await update(source); });
  return p.resetRetryCounts.mock.calls.length;
};

test('by default (SWR_BACKOFF on) the SWR re-drive keeps its count (no reset), so the ladder climbs', async () => {
  expect(await run('swr_revalidation')).toBe(0);
});

test('every other source still starts the ladder again', async () => {
  expect(await run('moveend')).toBe(1);
  expect(await run('timeline_scrub')).toBe(1);
});

test('under the kill (or the umbrella) every run resets the counts at the top, as before', async () => {
  window.__RAW_DISABLE_SWR_BACKOFF__ = true;
  expect(await run('swr_revalidation')).toBe(1);
  delete window.__RAW_DISABLE_SWR_BACKOFF__;
  window.__RAW_DISABLE_REQUEST_DIET__ = true;
  expect(await run('swr_revalidation')).toBe(1);
});
