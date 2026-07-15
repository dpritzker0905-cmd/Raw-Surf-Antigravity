import { renderHook } from '@testing-library/react';
import { useMarineRevalidation } from './useMarineRevalidation';

// The stale grid the zoom-out mid-res preview commits (data.stale=true) → schedules a re-drive.
const STALE = { stale: true, grid: { stale: true, cols: 5, rows: 5 } };
// A good (non-stale, renderable) grid → clears the timer + resets the retry counter.
const GOOD = { stale: false, grid: { stale: false, renderable: true, vectors: [1, 2, 3], cols: 40, rows: 40 } };

describe('useMarineRevalidation.scheduleSWRRevalidation — live-tunable re-drive ladder', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    delete window.__RAW_MARINE_SWR_STALE_DELAYS__;
    delete window.__RAW_MARINE_SWR_MAX_RETRIES__;
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    delete window.__RAW_MARINE_SWR_STALE_DELAYS__;
    delete window.__RAW_MARINE_SWR_MAX_RETRIES__;
  });

  test('DEFAULT is byte-identical: stale re-drive fires at exactly 1500ms', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    result.current.scheduleSWRRevalidation(STALE, updateFn);

    jest.advanceTimersByTime(1499);
    expect(updateFn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(updateFn).toHaveBeenCalledWith('swr_revalidation');
  });

  test('DEFAULT retry cap is 3: a 4th scheduling schedules no further timer', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    for (let i = 0; i < 3; i++) {
      result.current.scheduleSWRRevalidation(STALE, updateFn);
      jest.advanceTimersByTime(1500);
    }
    expect(updateFn).toHaveBeenCalledTimes(3);

    // 4th attempt: retry counter is now 3, cap is 3 → no new timer.
    result.current.scheduleSWRRevalidation(STALE, updateFn);
    jest.advanceTimersByTime(10000);
    expect(updateFn).toHaveBeenCalledTimes(3);
  });

  test('empty/cold-ingestion transient keeps its own 2500ms cadence (unchanged)', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    const EMPTY = { grid: { renderable: false, vectors: [], cols: 2, rows: 2 } };
    result.current.scheduleSWRRevalidation(EMPTY, updateFn);
    jest.advanceTimersByTime(2499);
    expect(updateFn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(updateFn).toHaveBeenCalledWith('swr_revalidation');
  });

  test('a good commit resets the retry counter and clears any pending timer', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    result.current.scheduleSWRRevalidation(STALE, updateFn);   // arm a timer
    result.current.scheduleSWRRevalidation(GOOD, updateFn);    // should cancel it
    jest.advanceTimersByTime(5000);
    expect(updateFn).not.toHaveBeenCalled();
  });

  test('OVERRIDE ladder: per-retry delays are honored and clamp to the last entry', () => {
    window.__RAW_MARINE_SWR_STALE_DELAYS__ = [700, 1200];
    window.__RAW_MARINE_SWR_MAX_RETRIES__ = 4;
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();

    // retry #1 → ladder[0] = 700ms
    result.current.scheduleSWRRevalidation(STALE, updateFn);
    jest.advanceTimersByTime(699);
    expect(updateFn).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(1);
    expect(updateFn).toHaveBeenCalledTimes(1);

    // retry #2 → ladder[1] = 1200ms
    result.current.scheduleSWRRevalidation(STALE, updateFn);
    jest.advanceTimersByTime(1199);
    expect(updateFn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(updateFn).toHaveBeenCalledTimes(2);

    // retry #3 → past the ladder end → clamps to last entry (1200ms), and the raised cap allows it
    result.current.scheduleSWRRevalidation(STALE, updateFn);
    jest.advanceTimersByTime(1200);
    expect(updateFn).toHaveBeenCalledTimes(3);
  });

  test('OVERRIDE cap: raising max retries permits a 4th+ re-drive', () => {
    window.__RAW_MARINE_SWR_MAX_RETRIES__ = 5;
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    for (let i = 0; i < 5; i++) {
      result.current.scheduleSWRRevalidation(STALE, updateFn);
      jest.advanceTimersByTime(1500);
    }
    expect(updateFn).toHaveBeenCalledTimes(5);
  });
});
