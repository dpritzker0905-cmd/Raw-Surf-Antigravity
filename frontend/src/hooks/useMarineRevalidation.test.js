import { renderHook } from '@testing-library/react';
import { useMarineRevalidation } from './useMarineRevalidation';
import { SWR_BACKOFF_FAST_ASKS, SWR_KEY_FORGET_MS, _resetSwrKeysForTest, swrKeyAttempt } from '../components/map/marineRequestDiet';

const FAST = Array(SWR_BACKOFF_FAST_ASKS).fill(1500);          // the first asks keep the old cadence
const FAST_EMPTY = Array(SWR_BACKOFF_FAST_ASKS).fill(2500);

// The stale grid the zoom-out mid-res preview commits (data.stale=true) → schedules a re-drive.
const STALE = { stale: true, grid: { stale: true, cols: 5, rows: 5 } };
// A good (non-stale, renderable) grid → clears the timer + resets the retry counter.
const GOOD = { stale: false, grid: { stale: false, renderable: true, vectors: [1, 2, 3], cols: 40, rows: 40 } };
const TUNABLES = ['__RAW_MARINE_SWR_STALE_DELAYS__', '__RAW_MARINE_SWR_MAX_RETRIES__', '__RAW_DISABLE_SWR_BACKOFF__',
  '__RAW_DISABLE_REQUEST_DIET__', '__MARINE_REQUEST_DIET__'];

// One re-drive per call: schedule against `data`, then expect the timer to fire after exactly `ms` (not 1 ms sooner).
function expectNextRedriveAfter(result, updateFn, ms, data = STALE) {
  result.current.scheduleSWRRevalidation(data, updateFn);
  const before = updateFn.mock.calls.length;
  jest.advanceTimersByTime(ms - 1);
  expect(updateFn).toHaveBeenCalledTimes(before);
  jest.advanceTimersByTime(1);
  expect(updateFn).toHaveBeenCalledTimes(before + 1);
  expect(updateFn).toHaveBeenLastCalledWith('swr_revalidation');
}

describe('useMarineRevalidation.scheduleSWRRevalidation — SWR_BACKOFF ladder (default) and the live tunables', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    TUNABLES.forEach((k) => { delete window[k]; });
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    TUNABLES.forEach((k) => { delete window[k]; });
  });

  test('the first stale re-drive still fires at exactly 1500ms', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    expectNextRedriveAfter(result, jest.fn(), 1500);
  });

  test('the ladder: 10 asks at 1.5 s, then 3, 6, 12, 24, 48 s, then 48 s held', () => {
    expect(SWR_BACKOFF_FAST_ASKS).toBe(10);
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    for (const ms of [...FAST, 3000, 6000, 12000, 24000, 48000, 48000, 48000]) expectNextRedriveAfter(result, updateFn, ms);
  });

  test('it never stops: 25 stale commits in a row each schedule a re-drive (the old cap of 3 is gone)', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    for (let i = 0; i < 25; i++) {
      result.current.scheduleSWRRevalidation(STALE, updateFn);
      jest.advanceTimersByTime(48000);
    }
    expect(updateFn).toHaveBeenCalledTimes(25);
    expect(window.__MARINE_REQUEST_DIET__.counts.swr_redrive_scheduled).toBe(25);
  });

  test('a good commit clears the pending timer and restarts the ladder at 1.5 s', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    const climbed = [...FAST, 3000, 6000];
    for (const ms of climbed) expectNextRedriveAfter(result, updateFn, ms);
    result.current.scheduleSWRRevalidation(STALE, updateFn);   // arm the 12 s rung
    result.current.scheduleSWRRevalidation(GOOD, updateFn);    // cancels it
    jest.advanceTimersByTime(60000);
    expect(updateFn).toHaveBeenCalledTimes(climbed.length);
    expectNextRedriveAfter(result, updateFn, 1500);
  });

  test('empty/cold-ingestion transients climb their own ladder from 2.5 s', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    const EMPTY = { grid: { renderable: false, vectors: [], cols: 2, rows: 2 } };
    for (const ms of [...FAST_EMPTY, 5000, 10000, 20000, 40000, 48000]) expectNextRedriveAfter(result, updateFn, ms, EMPTY);
  });

  test('OVERRIDE rungs: __RAW_MARINE_SWR_STALE_DELAYS__ replaces the stale ladder and its last entry is held, never stopping', () => {
    window.__RAW_MARINE_SWR_STALE_DELAYS__ = [700, 1200];
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    for (const ms of [700, 1200, 1200, 1200, 1200]) expectNextRedriveAfter(result, updateFn, ms);
  });

  test('OVERRIDE cap: __RAW_MARINE_SWR_MAX_RETRIES__ is a hard stop on top of the ladder', () => {
    window.__RAW_MARINE_SWR_MAX_RETRIES__ = 3;
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    for (const ms of [1500, 1500, 1500]) expectNextRedriveAfter(result, updateFn, ms);
    result.current.scheduleSWRRevalidation(STALE, updateFn);
    jest.advanceTimersByTime(600000);
    expect(updateFn).toHaveBeenCalledTimes(3);
  });

  // SWR_KEY_LADDER (2026-10-24): the z8 Lake Michigan replay asked one /grid key 31 times at ~2 s: the one count was zeroed by every
  // other run (toggles, wheel steps, backstop re-drives), so the ladder read #1 again and again. It now climbs per ask.
  describe('SWR_KEY_LADDER: the ladder climbs per ask, whoever asked', () => {
    beforeEach(() => { _resetSwrKeysForTest(); delete window.__RAW_DISABLE_SWR_KEY_LADDER__; });
    afterEach(() => { delete window.__RAW_DISABLE_SWR_KEY_LADDER__; });
    const delayOf = (result, key, data = STALE) => {
      const fn = jest.fn();
      result.current.scheduleSWRRevalidation(data, fn, key);
      let ms = 0;
      while (!fn.mock.calls.length && ms < 600000) { jest.advanceTimersByTime(500); ms += 500; }
      return ms;
    };

    test('every stale answer to an ask moves its ladder, even when another run cancels the timer before it fires (the loop)', () => {
      const { result } = renderHook(() => useMarineRevalidation());
      for (let i = 0; i < SWR_BACKOFF_FAST_ASKS; i++) {
        result.current.scheduleSWRRevalidation(STALE, jest.fn(), 'A');
        clearTimeout(result.current.swrTimerRef.current); result.current.swrTimerRef.current = null;   // a backstop re-drive's run
        result.current.resetRetryCounts();                                                              // ... and its reset
      }
      expect(swrKeyAttempt('A')).toBe(SWR_BACKOFF_FAST_ASKS);
      expect(delayOf(result, 'A')).toBe(3000);                       // the 11th stale answer: the next rung, not #1 at 1.5 s
      expect(delayOf(result, 'A')).toBe(6000);
    });

    test('another ask has its own ladder; the pending re-ask is named on the timer ref', () => {
      const { result } = renderHook(() => useMarineRevalidation());
      for (let i = 0; i < SWR_BACKOFF_FAST_ASKS; i++) delayOf(result, 'A');
      expect(delayOf(result, 'B')).toBe(1500);
      const fn = jest.fn();
      result.current.scheduleSWRRevalidation(STALE, fn, 'A');
      expect(result.current.swrTimerRef.askKey).toBe('A');
      jest.advanceTimersByTime(12000);
      expect(fn).toHaveBeenCalledWith('swr_revalidation');
    });

    test('a fresh answer cancels the pending re-ask but does not restart the ladder; it is forgotten after SWR_KEY_FORGET_MS', () => {
      const { result } = renderHook(() => useMarineRevalidation());
      for (let i = 0; i < SWR_BACKOFF_FAST_ASKS; i++) delayOf(result, 'A');
      const fn = jest.fn();
      result.current.scheduleSWRRevalidation(STALE, fn, 'A');
      result.current.scheduleSWRRevalidation(GOOD, fn, 'A');
      jest.advanceTimersByTime(60000);
      expect(fn).not.toHaveBeenCalled();
      expect(delayOf(result, 'A')).toBe(6000);                       // a return to the ask climbs on (its 12th stale answer)
      jest.advanceTimersByTime(SWR_KEY_FORGET_MS + 1);
      expect(delayOf(result, 'A')).toBe(1500);                       // a new run's preview is re-asked fast again
    });

    test('positive control: killed, one count for the fetcher, zeroed by every other run (as before)', () => {
      window.__RAW_DISABLE_SWR_KEY_LADDER__ = true;
      const { result } = renderHook(() => useMarineRevalidation());
      for (let i = 0; i < SWR_BACKOFF_FAST_ASKS; i++) {
        result.current.scheduleSWRRevalidation(STALE, jest.fn(), 'A');
        result.current.resetRetryCounts();
      }
      expect(delayOf(result, 'A')).toBe(1500);
      expect(result.current.swrTimerRef.askKey).toBe(null);
    });
  });

  describe('kill switch window.__RAW_DISABLE_SWR_BACKOFF__ (and the umbrella): the old rule, byte-identical', () => {
    for (const kill of ['__RAW_DISABLE_SWR_BACKOFF__', '__RAW_DISABLE_REQUEST_DIET__']) {
      test(`${kill}: fixed 1500ms, and the hook-level cap of 3`, () => {
        window[kill] = true;
        const { result } = renderHook(() => useMarineRevalidation());
        const updateFn = jest.fn();
        for (let i = 0; i < 3; i++) expectNextRedriveAfter(result, updateFn, 1500);
        result.current.scheduleSWRRevalidation(STALE, updateFn);
        jest.advanceTimersByTime(10000);
        expect(updateFn).toHaveBeenCalledTimes(3);
      });
    }

    test('killed, the old override ladder and cap behave as before (clamp to the last entry; a raised cap)', () => {
      window.__RAW_DISABLE_SWR_BACKOFF__ = true;
      window.__RAW_MARINE_SWR_STALE_DELAYS__ = [700, 1200];
      window.__RAW_MARINE_SWR_MAX_RETRIES__ = 4;
      const { result } = renderHook(() => useMarineRevalidation());
      const updateFn = jest.fn();
      for (const ms of [700, 1200, 1200, 1200]) expectNextRedriveAfter(result, updateFn, ms);
      result.current.scheduleSWRRevalidation(STALE, updateFn);
      jest.advanceTimersByTime(10000);
      expect(updateFn).toHaveBeenCalledTimes(4);
    });

    test('killed, the empty transient keeps its fixed 2500ms', () => {
      window.__RAW_DISABLE_SWR_BACKOFF__ = true;
      const { result } = renderHook(() => useMarineRevalidation());
      const updateFn = jest.fn();
      const EMPTY = { grid: { renderable: false, vectors: [], cols: 2, rows: 2 } };
      for (let i = 0; i < 3; i++) expectNextRedriveAfter(result, updateFn, 2500, EMPTY);
    });
  });
});
