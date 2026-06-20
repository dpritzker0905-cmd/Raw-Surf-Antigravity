/**
 * marineEmptyGridRetry.test.js
 *
 * Forensic root cause (verified via live backend curls 2026-06-20): after a fresh
 * model run lands, far-hour ICON marine slices return HTTP 200 with an EMPTY
 * `vectors` array for a few minutes while the backend ingests them. The frontend
 * (a) cached those empty grids and (b) never retried a non-stale empty grid, so a
 * scrub/model-switch into that window blanked the heatmap permanently until the
 * user re-interacted. These two guards make the empty grid uncached + auto-retried
 * so the heatmap self-heals once ingestion completes. Truth-safe: it only retries
 * to OBTAIN the right data; it never displays the wrong model/layer/hour.
 */
import { renderHook } from '@testing-library/react';
import { _cacheMarineResult, getPerModelHourCache } from '../components/map/marineControllerCache';
import { useMarineRevalidation } from '../hooks/useMarineRevalidation';

const makeGrid = ({ vectors = [], renderable = vectors.length > 0, stale = false, status = 'ok', unsupported = false } = {}) => ({
  stale,
  status,
  grid: {
    vectors,
    cols: 9, rows: 9,
    bounds: { west: -85, south: 24, east: -79, north: 31 },
    renderable,
    stale,
    status,
    __unsupportedLayer: unsupported,
  },
});

describe('_cacheMarineResult — does not cache empty/non-renderable grids', () => {
  beforeEach(() => { getPerModelHourCache().clear(); });

  it('skips an empty (zero-vector, non-renderable) grid', () => {
    _cacheMarineResult('ICON', 152, makeGrid({ vectors: [], renderable: false }), 'waves');
    expect(getPerModelHourCache().size).toBe(0);
  });

  it('still caches a grid that has vectors', () => {
    _cacheMarineResult('ICON', 12, makeGrid({ vectors: [{ lat: 28, lng: -80, speed: 1.2 }] }), 'waves');
    expect(getPerModelHourCache().size).toBe(1);
  });

  it('still caches a stale grid as long as it carries vectors', () => {
    _cacheMarineResult('GFS', 6, makeGrid({ vectors: [{ lat: 28, lng: -80, speed: 0.4 }], stale: true }), 'waves');
    expect(getPerModelHourCache().size).toBe(1);
  });
});

describe('scheduleSWRRevalidation — retries a transient empty grid', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

  it('schedules a bounded retry for an empty/non-renderable (non-stale) grid', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();

    result.current.scheduleSWRRevalidation(makeGrid({ vectors: [], renderable: false }), updateFn);
    expect(updateFn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2500);
    expect(updateFn).toHaveBeenCalledWith('swr_revalidation');
  });

  it('does NOT retry a terminal no_coverage empty grid', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();

    result.current.scheduleSWRRevalidation(
      makeGrid({ vectors: [], renderable: false, status: 'no_coverage' }),
      updateFn
    );
    jest.advanceTimersByTime(5000);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('does NOT retry an unsupported-layer empty grid', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();

    result.current.scheduleSWRRevalidation(
      makeGrid({ vectors: [], renderable: false, unsupported: true }),
      updateFn
    );
    jest.advanceTimersByTime(5000);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('stops after 3 retries (does not poll forever)', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    const empty = makeGrid({ vectors: [], renderable: false });

    for (let i = 0; i < 5; i++) {
      result.current.scheduleSWRRevalidation(empty, updateFn);
      jest.advanceTimersByTime(2500);
    }
    expect(updateFn.mock.calls.length).toBe(3);
  });

  it('a renderable grid clears the retry state (no retry scheduled)', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();

    result.current.scheduleSWRRevalidation(makeGrid({ vectors: [{ lat: 28, lng: -80, speed: 1 }] }), updateFn);
    jest.advanceTimersByTime(5000);
    expect(updateFn).not.toHaveBeenCalled();
  });
});
