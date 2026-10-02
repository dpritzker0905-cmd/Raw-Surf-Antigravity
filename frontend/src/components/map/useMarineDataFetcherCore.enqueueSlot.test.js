/**
 * The zoom-out's world grid that was never requested (2026-10-01, audit F-23; marineEnqueueSlot.js), through the REAL enqueueMarineUpdate.
 *
 * The defect when this is missing: after a zoom-out `moveend` enqueues 'moveend' on the fetcher's single dispatch slot, whose dispatch arms a
 * 300 ms stable-delay timer. A series page landing in that window fires marine_series_revalidated -> enqueueMarineUpdate('series_upgrade'), a
 * CACHE-ONLY lane: it cleared the pending timer and ran in its place, so the world /grid was never requested and the map kept its frame
 * until the next gesture. The mirror order (the lane scheduled first, a fetch-capable enqueue second) dropped the fetch at the slot check.
 * Replayed offline with the fetcher's events recorded: 6 of 6 landings inside the window lost the grid, 0 of 12 outside it.
 *
 * What these tests read: updateMarineGrid is driven for real, with a viewport hash that is always degenerate, so it stops at its first gate and
 * logs the source it was called with ("... Skipping fetch (source=moveend)"). Which sources ran, in what order, is the observable.
 */
import { renderHook } from '@testing-library/react';
import { useMarineDataFetcherCore } from './useMarineDataFetcherCore';
import { forensicDump, forensicReset } from './marineForensics';

const ref = (v) => ({ current: v });

const mkParams = () => ({
  mapInstance: {
    getBounds: () => ({ getWest: () => -81, getEast: () => -80, getSouth: () => 27, getNorth: () => 28 }),
    getZoom: () => 4, isMoving: () => false, isZooming: () => false, once: jest.fn(), off: jest.fn(),
  },
  activeMarineLayerRef: ref('waves'), timeOffsetRef: ref(147), activeModelRef: ref('GFS'),
  marineData: null, setMarineData: jest.fn(), marineRevision: ref(0), marineRequestIdRef: ref(1),
  abortControllerRef: ref(null), inFlight: { find: () => null },
  activeMarineLayersRef: ref(['waves']),
  marineFetchLocksRef: ref({ isFetching: false, activeSource: null, fetchStartedAt: 0, lastHash: null, lastTime: 0, manualFetchActiveUntil: 0 }),
  isCommittingDataRef: ref(false), isInternalMapUpdateRef: ref(false), internalUpdateTimerRef: ref(null),
  swrTimerRef: ref(null), swrRetryCountRef: ref(0), cooldownRetryRef: ref(null),
  clearAllTimers: jest.fn(), scheduleSWRRevalidation: jest.fn(), scheduleCooldownRetry: jest.fn(), scheduleDegenerateRetry: jest.fn(),
  resetRetryCounts: jest.fn(), updateMarineGridRef: ref(null), enqueueMarineUpdateRef: ref(null),
  consecutiveFailuresRef: ref(0), abortRecoveryRetryCountRef: ref(0), lastFetchedModelRef: ref(null), pendingMarineIntentRef: ref(null),
  pipelineEventsRef: ref([]), pipelineCountersRef: ref({}), lastCommittedSigRef: ref(null), orchestratorInFlight: ref(new Map()),
  scheduledRef: ref(false), timeoutIdRef: ref(null), moveendDebounceRef: ref({ timer: null }), scrubDebounceRef: ref(null),
  detachedWaitTimerRef: ref(null),
  getViewportHash: () => null,            // the first gate of updateMarineGrid: it names its source in a log line and returns
  logPipelineEventHelper: jest.fn(), marineDataRef: ref(null), lastInvocationRef: ref(null),
});

let logSpy;
let enqueue;
beforeEach(() => {
  jest.useFakeTimers();
  forensicReset();
  delete window.isScrubbingTimeline;
  delete window.__RAW_DISABLE_SU_NO_CANCEL__;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { result } = renderHook(() => useMarineDataFetcherCore(mkParams()));
  enqueue = result.current.enqueueMarineUpdate;
});
afterEach(() => {
  jest.useRealTimers();
  logSpy.mockRestore();
  delete window.__RAW_DISABLE_SU_NO_CANCEL__;
});

/** The sources updateMarineGrid ran with, in order. */
const ran = () => logSpy.mock.calls
  .map((c) => String(c[0]).match(/Skipping fetch \(source=([^)]+)\)/))
  .filter(Boolean)
  .map((m) => m[1]);
const events = (type) => forensicDump().events.filter((e) => e.type === type);

describe('the cache-only series lane never displaces a pending run (first order: the lane arrives second)', () => {
  it('a series page landing inside the stable delay does not cancel the zoom-out fetch: moveend runs, the lane does not', () => {
    enqueue('moveend');
    jest.advanceTimersByTime(20);                    // the next frame: the dispatch armed the 300 ms timer
    enqueue('series_upgrade');                       // the page lands inside the window
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['moveend']);
    expect(events('series_upgrade_skipped_pending')).toEqual([expect.objectContaining({ slotted: false })]);
  });

  it('the same when the page lands late in the window (the run is 20 ms away)', () => {
    enqueue('moveend');
    jest.advanceTimersByTime(20 + 270);
    enqueue('series_upgrade');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['moveend']);
  });

  it('a page landing in the same frame as the enqueue is skipped too (the slot is held, not yet dispatched)', () => {
    enqueue('moveend');
    enqueue('series_upgrade');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['moveend']);
    expect(events('series_upgrade_skipped_pending')).toEqual([expect.objectContaining({ slotted: true })]);
  });
});

describe('a fetch-capable enqueue is never dropped behind the cache-only lane (second order: the lane arrives first)', () => {
  it('moveend enqueued in the frame the lane was scheduled in runs, and the lane does not', () => {
    enqueue('series_upgrade');
    enqueue('moveend');                              // the slot is held by the cache-only enqueue
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['moveend']);
    expect(events('cache_only_slot_superseded')).toEqual([expect.objectContaining({ by: 'moveend' })]);
  });

  it('the superseded dispatch does not leave the slot free early or run twice: one run, and a later enqueue still works', () => {
    enqueue('series_upgrade');
    enqueue('moveend');
    jest.advanceTimersByTime(2000);                  // the superseded dispatch's 1.5 s fallback has fired as well
    expect(ran()).toEqual(['moveend']);
    enqueue('zoomend');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['moveend', 'zoomend']);
  });

  it('a hidden tab (no animation frames): the superseded dispatch\'s 1.5 s fallback does nothing, the slot stays with the fetch until its own fallback', () => {
    const raf = global.requestAnimationFrame;
    global.requestAnimationFrame = jest.fn();        // a hidden tab never calls back
    try {
      enqueue('series_upgrade');                     // t=0: slot held by the cache-only enqueue, its fallback at 1500
      jest.advanceTimersByTime(400);
      enqueue('moveend');                            // t=400: supersedes it, its own fallback at 1900
      jest.advanceTimersByTime(1100 + 100);          // t=1600: the superseded fallback has fired
      expect(ran()).toEqual([]);                     // it did not arm a cache-only run
      enqueue('zoomend');                            // the slot is still the fetch's: this one is dropped, as any second fetch-capable enqueue
      jest.advanceTimersByTime(2000);
      expect(ran()).toEqual(['moveend']);
    } finally {
      global.requestAnimationFrame = raf;
    }
  });
});

describe('what did not change', () => {
  it('the lane still runs when nothing is pending', () => {
    enqueue('series_upgrade');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['series_upgrade']);
    expect(events('series_upgrade_skipped_pending')).toEqual([]);
  });

  it('the lane runs after the pending run has gone out (a page that lands later still upgrades the frame)', () => {
    enqueue('moveend');
    jest.advanceTimersByTime(400);
    jest.advanceTimersByTime(900);                   // past the 800 ms same-source dedupe window of the enqueue gate
    enqueue('series_upgrade');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['moveend', 'series_upgrade']);
  });

  it('a fetch-capable enqueue still replaces a pending fetch-capable run in a later frame (latest wins)', () => {
    enqueue('moveend');
    jest.advanceTimersByTime(20);
    enqueue('zoomend');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['zoomend']);
  });

  it('two fetch-capable enqueues in one frame: the first one owns the slot (the second is dropped, no forensic event)', () => {
    enqueue('moveend');
    enqueue('zoomend');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['moveend']);
    expect(forensicDump().events.filter((e) => /skipped_pending|superseded/.test(e.type))).toEqual([]);
  });

  it('a fetch in flight still makes the lane return before the slot is looked at (the existing guard)', () => {
    const params = mkParams();
    params.marineFetchLocksRef.current.isFetching = true;
    params.marineFetchLocksRef.current.fetchStartedAt = Date.now();
    const { result } = renderHook(() => useMarineDataFetcherCore(params));
    result.current.enqueueMarineUpdate('series_upgrade');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual([]);
    expect(events('series_upgrade_skipped_pending')).toEqual([]);
  });
});

describe('kill switch __RAW_DISABLE_SU_NO_CANCEL__ restores both old behaviours', () => {
  it('first order: the lane cancels the pending zoom-out fetch and runs in its place (the defect)', () => {
    window.__RAW_DISABLE_SU_NO_CANCEL__ = true;
    enqueue('moveend');
    jest.advanceTimersByTime(20);
    enqueue('series_upgrade');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['series_upgrade']);
    expect(events('series_upgrade_skipped_pending')).toEqual([]);
  });

  it('second order: the fetch-capable enqueue is dropped behind the lane (the defect)', () => {
    window.__RAW_DISABLE_SU_NO_CANCEL__ = true;
    enqueue('series_upgrade');
    enqueue('moveend');
    jest.advanceTimersByTime(400);
    expect(ran()).toEqual(['series_upgrade']);
    expect(events('cache_only_slot_superseded')).toEqual([]);
  });
});
