/**
 * The Surf Rating band toggle through the REAL fetcher (2026-10-26, the owner's live test: "the surf rating band stays on for a few
 * seconds, when its turned off"; console: "[Abort-Gate] Preserving high-priority fetch (timeline_scrub) against low-priority request
 * (flavor_toggle)" and an 18 s "[Marine] Stranded fetch-pending released" wedge). marineFlavorToggle.js, offline repro scn_band_toggle.js.
 *   F-1 PRIORITY: a toggle while a scrub fetch is in flight SUPERSEDES it (releases it and asks again with the new flavor) instead of being
 *       buffered behind it. Kill __RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__ restores the old gate (asserted below).
 *   F-2 THE WEDGE: a toggle that releases an active fetch used to leave that fetch's __MARINE_FETCH_PENDING__ stamp set (a detached fetch only
 *       clears it when it finishes); with the new ask then dropped by the dedupe (OFF then ON: the resident matches the flag again) that is
 *       pending set, nothing fetching, nothing re-driving until the 18 s watchdog. The stamp is now LEASED for 300 ms at release (clearing it at
 *       once blanked the resident: the orchestrator read 'model switch, nothing pending') and cleared when the lease ends with nothing fetching.
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

function mount(opts = {}) {
  const state = { current: null, writes: [] };
  const setMarineData = jest.fn((v) => { state.current = typeof v === 'function' ? v(state.current) : v; state.writes.push(state.current); });
  const p = {
    mapInstance: { getBounds: () => ({ getWest: () => -82, getEast: () => -78, getSouth: () => 25, getNorth: () => 29 }),
      getZoom: () => 6, isMoving: () => false, isZooming: () => false, once: jest.fn(), off: jest.fn() },
    activeMarineLayerRef: ref('waves'), timeOffsetRef: ref(0), activeModelRef: ref('GFS'),
    marineData: opts.marineData || null, setMarineData, marineRevision: ref(0), marineRequestIdRef: ref(0),
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
    marineDataRef: ref(opts.marineData || null), lastInvocationRef: ref(null),
  };
  const { result } = renderHook(() => useMarineDataFetcherCore(p));
  return { p, state, update: result.current.updateMarineGrid, enqueue: result.current.enqueueMarineUpdate };
}


let logSpy; let errSpy;
beforeEach(() => {
  jest.useFakeTimers();
  getRemainingCooldown.mockReturnValue(0);
  getModelSafeMarine.mockReturnValue(null);
  isContainedInMarineCache.mockReturnValue(false);
  getMarineSeriesFrame.mockReturnValue(null);
  isInCooldown.mockReturnValue(false);
  getTarget.mockReturnValue(null);
  handleRegionalGridClearing.mockReturnValue({ west: -82, south: 25, east: -78, north: 29 });
  commitMarineData.mockImplementation(({ data, setMarineData }) => setMarineData(data));
  window.isScrubbingTimeline = false;
  window.__SURF_MODE__ = false;
  window.__MARINE_FETCH_PENDING__ = null;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  logSpy.mockRestore(); errSpy.mockRestore();
  delete window.__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__;
  delete window.isScrubbingTimeline;
  delete window.__SURF_MODE__;
  window.__MARINE_FETCH_PENDING__ = null;
});

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const tick = async (ms) => { await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); }); };
const preserved = () => logSpy.mock.calls.some((c) => /Preserving high-priority/.test(String(c[0])));

describe('F-1: a toggle supersedes an in-flight scrub fetch', () => {
  async function scrubThenToggle() {
    const calls = deferredFetches();
    const { p, enqueue, update } = mount();
    p.timeOffsetRef.current = 120;
    update('timeline_scrub'); await flush();                     // the scrub's fetch (old flavor) is in flight
    expect(calls).toHaveLength(1);
    window.__SURF_MODE__ = true;                                  // the toggle flips the flag, then fires the event the fetcher listens to
    enqueue('flavor_toggle'); await tick(400);
    return { calls, p };
  }
  it('releases the scrub fetch and asks again at once (the new flavor, the current hour)', async () => {
    const { calls } = await scrubThenToggle();
    expect(calls.length).toBe(2);
    expect(calls[1].hour).toBe(120);
    expect(preserved()).toBe(false);
  });
  it('the kill switch restores the old gate: the toggle is dropped behind the scrub fetch (the bug)', async () => {
    window.__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__ = true;
    const { calls } = await scrubThenToggle();
    expect(calls.length).toBe(1);
    expect(preserved()).toBe(true);
  });
});

describe('F-2: the wedge — a released fetch leaves no stranded pending stamp', () => {
  const rated = () => { const f = frame('GFS', 0); f.grid.ratingMode = true; return f; };
  // The owner's sequence: the band flips OFF (a fetch for the honest flavor goes out), then ON again before it lands. The resident is a rating
  // grid and now matches the flag, so the dedupe drops the new ask: the released fetch's stamp is all that is left.
  async function offThenOn() {
    const calls = deferredFetches();
    const { p, enqueue, update } = mount({ marineData: rated() });
    window.__SURF_MODE__ = false;                                   // OFF: resident rated, flag off: the flavor mismatch bypasses the dedupe
    update('flavor_toggle'); await flush();
    expect(calls).toHaveLength(1);
    expect(window.__MARINE_FETCH_PENDING__).not.toBeNull();
    Object.assign(p.marineFetchLocksRef.current, { lastHash: 'vp-1', lastTime: Date.now() });   // a fetch for this very viewport just ran
    window.__SURF_MODE__ = true;                                    // ON again: the resident matches the flag now
    enqueue('flavor_toggle');                                       // releases the OFF fetch (it detaches and keeps running)
    const pendingRightAfterRelease = window.__MARINE_FETCH_PENDING__;
    await tick(400);
    return { calls, p, pendingRightAfterRelease };
  }
  it('leases the pending stamp over the release (no model-switch-with-nothing-pending gap), then clears it: nothing left pending with nothing fetching', async () => {
    const { p, pendingRightAfterRelease } = await offThenOn();
    expect(pendingRightAfterRelease).not.toBeNull();                // leased: the orchestrator still sees a fetch pending in the gap
    expect(window.__MARINE_FETCH_PENDING__).toBeNull();             // the replacement ask was dropped (the dedupe), the lease ended
    expect(p.marineFetchLocksRef.current.isFetching).toBe(false);
  });
  it('the kill switch reproduces the wedge: stamp left set, nothing fetching, nothing re-driving', async () => {
    window.__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__ = true;
    const { calls, p, pendingRightAfterRelease } = await offThenOn();
    expect(pendingRightAfterRelease).not.toBeNull();
    expect(window.__MARINE_FETCH_PENDING__).not.toBeNull();         // still set after the new ask was dropped ...
    expect(p.marineFetchLocksRef.current.isFetching).toBe(false);   // ... with nothing fetching: the 18 s wedge until the watchdog
    expect(calls.length).toBe(1);
  });
});
