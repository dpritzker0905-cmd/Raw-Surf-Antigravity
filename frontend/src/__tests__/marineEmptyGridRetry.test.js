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
import {
  _cacheMarineResult, getPerModelHourCache,
  recordTerminalNoCoverage, isTerminalNoCoverage, _resetTerminalNoCoverageForTest,
} from '../components/map/marineControllerCache';
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

  it('does NOT retry an EURO no_copernicus_coverage safe-zero grid (grid.__failureReason)', () => {
    // The EURO out-of-coverage fallback is a 0-vector safe-zero grid carrying the reason on
    // __failureReason (not status). Retrying it just re-fires the doomed 404 (the EURO churn).
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    result.current.scheduleSWRRevalidation(
      { __failureReason: 'no_copernicus_coverage',
        grid: { vectors: [], cols: 27, rows: 27, renderable: false, __failureReason: 'no_copernicus_coverage' } },
      updateFn
    );
    jest.advanceTimersByTime(8000);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('does NOT retry a no_backend_coverage safe-zero grid', () => {
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    result.current.scheduleSWRRevalidation(
      { __failureReason: 'no_backend_coverage',
        grid: { vectors: [], cols: 27, rows: 27, renderable: false, __failureReason: 'no_backend_coverage' } },
      updateFn
    );
    jest.advanceTimersByTime(8000);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('STILL retries a generic backend_fetch_failed empty grid (transient, may self-heal)', () => {
    // A non-coverage failure is treated as transient — it can resolve on retry, so we keep it.
    const { result } = renderHook(() => useMarineRevalidation());
    const updateFn = jest.fn();
    result.current.scheduleSWRRevalidation(
      { __failureReason: 'backend_fetch_failed',
        grid: { vectors: [], cols: 27, rows: 27, renderable: false, __failureReason: 'backend_fetch_failed' } },
      updateFn
    );
    jest.advanceTimersByTime(2500);
    expect(updateFn).toHaveBeenCalledWith('swr_revalidation');
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

describe('terminal no-coverage tracker (§7.6 far-horizon scrub churn)', () => {
  // The far-horizon case the __failureReason bypass CANNOT catch: past a model's horizon the fetcher
  // holds a STALE renderable grid (no __failureReason), so the scrub-settle backstop re-drives the doomed
  // 404 forever = the "10-day slowdown". The fetcher records the terminal (model,layer,hour); the settle
  // reads it and stops re-driving while the held frame keeps displaying.
  beforeEach(() => { _resetTerminalNoCoverageForTest(); delete window.__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__; });
  afterEach(() => { _resetTerminalNoCoverageForTest(); delete window.__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__; });

  it('records + reports a terminal (model,layer,hour)', () => {
    expect(isTerminalNoCoverage('EURO', 'waves', 327)).toBe(false);
    recordTerminalNoCoverage('EURO', 'waves', 327);
    expect(isTerminalNoCoverage('EURO', 'waves', 327)).toBe(true);
  });

  it('is keyed per model/layer/hour — no false positives on neighbours', () => {
    recordTerminalNoCoverage('EURO', 'waves', 327);
    expect(isTerminalNoCoverage('EURO', 'waves', 300)).toBe(false);   // different hour (still in coverage)
    expect(isTerminalNoCoverage('GFS', 'waves', 327)).toBe(false);    // GFS is native to 336h
    expect(isTerminalNoCoverage('EURO', 'swell_1', 327)).toBe(false); // different layer
  });

  it('expires after the TTL so a later run that ingests the estimates re-tries', () => {
    const realNow = Date.now;
    let t = 1_000_000;
    Date.now = () => t;
    try {
      recordTerminalNoCoverage('EURO', 'waves', 327);
      expect(isTerminalNoCoverage('EURO', 'waves', 327)).toBe(true);
      t += 15 * 60 * 1000 + 1;
      expect(isTerminalNoCoverage('EURO', 'waves', 327)).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it('the kill switch forces it off (instant revert)', () => {
    recordTerminalNoCoverage('EURO', 'waves', 327);
    window.__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__ = true;
    expect(isTerminalNoCoverage('EURO', 'waves', 327)).toBe(false);
  });
});
