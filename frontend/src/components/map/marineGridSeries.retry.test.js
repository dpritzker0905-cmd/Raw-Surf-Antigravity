/**
 * §4.3(b) SERIES-PAGE FETCH RESILIENCE goldens (2026-07-13, round-12): a failed grid_series
 * page (deploy-window 500, network error, 45s local timeout) retries on the bounded exponential
 * backoff instead of silently vanishing until the next gesture (the "series misses climbing"
 * tier-thrash aggravator). Caller-signal aborts (superseded viewport) never retry.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null }));

import {
  ensureMarineSeries,
  coarseRevalDelayMs,
  _resetMarineSeriesForTest,
} from './marineGridSeries';

const BOUNDS = { west: -81, south: 27, east: -80, north: 28 };

const okFramesResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    frames: [{
      hour_offset: 0,
      vectors: [{ lat: 27.5, lng: -80.5, u: 0, v: -1, speed: 1.0, direction: 0, period: 8 }],
      cols: 1, rows: 1,
      bounds: { west: -81, south: 27, east: -80, north: 28 },
    }],
  }),
});

// flush the fire-and-forget retry chain after advancing fake timers
async function advanceAndFlush(ms) {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('marineGridSeries §4.3(b) page-failure retry', () => {
  beforeEach(() => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = true; // these suites test the PAGE lane in isolation (hour-0 lane has its own suite)
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    delete window.__RAW_SERIES_RETRY_DISABLED__;
    window.__MARINE_SERIES_DIAG__ = { loads: 0, hits: 0, misses: 0 };
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries a 500 page on the backoff and succeeds on the second attempt', async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 500, json: async () => ({}) };
      return okFramesResponse();
    };

    await ensureMarineSeries('GFS', 'waves', BOUNDS, 0, undefined, true);
    expect(calls).toBe(1);
    expect(window.__MARINE_SERIES_DIAG__.pageRetries).toBe(1);
    expect(window.__MARINE_SERIES_DIAG__.lastRetryReason).toBe('http_500');

    await advanceAndFlush(coarseRevalDelayMs(1));
    expect(calls).toBe(2);
    expect(window.__MARINE_SERIES_DIAG__.loads).toBe(1); // the retry landed frames
  });

  it('retries a network error, then stops after SERIES_FAIL_RETRY_MAX exhausted', async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      throw Object.assign(new Error('boom'), { name: 'TypeError' });
    };

    await ensureMarineSeries('GFS', 'waves', BOUNDS, 0, undefined, true);
    expect(calls).toBe(1);
    // 4 retries fire (bounded), then the 5th failure marks exhausted with no further timer
    for (let n = 1; n <= 5; n++) await advanceAndFlush(coarseRevalDelayMs(n));
    expect(calls).toBe(5); // initial + 4 retries
    expect(window.__MARINE_SERIES_DIAG__.pageRetries).toBe(4);
    expect(window.__MARINE_SERIES_DIAG__.pageFailsExhausted).toBe(1);
    await advanceAndFlush(60000);
    expect(calls).toBe(5); // budget spent — no zombie timers
  });

  it('never retries a superseded viewport (caller-signal abort)', async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    const ac = new AbortController();
    ac.abort(); // superseded before/while in flight

    await ensureMarineSeries('GFS', 'waves', BOUNDS, 0, ac.signal, true);
    await advanceAndFlush(60000);
    expect(calls).toBeLessThanOrEqual(1);
    expect(window.__MARINE_SERIES_DIAG__.pageRetries).toBeUndefined();
  });

  it('treats a local AbortError WITHOUT a caller abort as a timeout and retries it', async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return okFramesResponse();
    };

    await ensureMarineSeries('GFS', 'waves', BOUNDS, 0, undefined, true);
    expect(window.__MARINE_SERIES_DIAG__.lastRetryReason).toBe('timeout_45s');
    await advanceAndFlush(coarseRevalDelayMs(1));
    expect(calls).toBe(2);
    expect(window.__MARINE_SERIES_DIAG__.loads).toBe(1);
  });

  it('kill switch __RAW_SERIES_RETRY_DISABLED__ restores the silent legacy behavior', async () => {
    window.__RAW_SERIES_RETRY_DISABLED__ = true;
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return { ok: false, status: 502, json: async () => ({}) };
    };

    await ensureMarineSeries('GFS', 'waves', BOUNDS, 0, undefined, true);
    await advanceAndFlush(60000);
    expect(calls).toBe(1);
    expect(window.__MARINE_SERIES_DIAG__.pageRetries).toBeUndefined();
  });

  it('a successful page resets the failure budget for that key', async () => {
    let calls = 0;
    let failNext = true;
    global.fetch = async () => {
      calls++;
      if (failNext) { failNext = false; return { ok: false, status: 500, json: async () => ({}) }; }
      return okFramesResponse();
    };

    await ensureMarineSeries('GFS', 'waves', BOUNDS, 0, undefined, true);
    await advanceAndFlush(coarseRevalDelayMs(1)); // retry succeeds -> budget reset
    expect(calls).toBe(2);
    expect(window.__MARINE_SERIES_DIAG__.pageRetries).toBe(1);
  });
});

/**
 * §7j COVERAGE-AWARE TTL DEDUP goldens (2026-07-13): spans >15° share the 'global' viewportKey
 * but store the SERVED mid-clip bounds — the TTL dedup then refused refetches for 5 minutes
 * while pans left the clip (user live wedge: misses 36→52 under the clamp backstop).
 */
describe('marineGridSeries §7j coverage-aware TTL dedup', () => {
  const W1 = { west: -100, south: 20, east: -80, north: 36 };   // span 20° → 'global' key
  const W2 = { west: -60, south: 20, east: -40, north: 36 };    // span 20° → SAME 'global' key
  const clipResponse = (b) => ({
    ok: true,
    status: 200,
    json: async () => ({
      frames: [{
        hour_offset: 0,
        vectors: [{ lat: b.south + 1, lng: b.west + 1, u: 0, v: -1, speed: 1.0, direction: 0, period: 8 }],
        cols: 4, rows: 4,
        bounds: b,
      }],
    }),
  });

  beforeEach(() => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = true; // these suites test the PAGE lane in isolation (hour-0 lane has its own suite)
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    window.__MARINE_SERIES_DIAG__ = { loads: 0, hits: 0, misses: 0 };
  });
  afterEach(() => { jest.useRealTimers(); });

  it('a pan off the cached mid-clip bypasses the TTL and refetches (the 15–60° wedge)', async () => {
    let calls = 0;
    const served = [];
    global.fetch = async () => {
      calls++;
      // serve a clip padded around whatever was last requested (mirror the resolver)
      const b = calls === 1
        ? { west: -102, south: 18, east: -78, north: 38 }   // covers W1, NOT W2
        : { west: -62, south: 18, east: -38, north: 38 };   // covers W2
      served.push(b);
      return clipResponse(b);
    };

    await ensureMarineSeries('GFS', 'waves', W1, 0, undefined, true);
    expect(calls).toBe(1);
    // same key, still-covered viewport → TTL dedup holds
    await ensureMarineSeries('GFS', 'waves', W1, 0, undefined, true);
    expect(calls).toBe(1);
    // pan to W2: same 'global' key, cached clip does NOT cover → bypass fires a refetch
    await ensureMarineSeries('GFS', 'waves', W2, 0, undefined, true);
    expect(calls).toBe(2);
    expect(window.__MARINE_SERIES_DIAG__.ttlCoverageBypass).toBe(1);
    // W2 again: entry now covers it → TTL dedup holds again (no thrash when stationary)
    await ensureMarineSeries('GFS', 'waves', W2, 0, undefined, true);
    expect(calls).toBe(2);
  });

  it('a truly WORLD-wide cached entry keeps the TTL skip for every pan (contains everything)', async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return clipResponse({ west: -180, south: -85, east: 180, north: 85 });
    };
    await ensureMarineSeries('GFS', 'waves', W1, 0, undefined, true);
    expect(calls).toBe(1);
    await ensureMarineSeries('GFS', 'waves', W2, 0, undefined, true);
    expect(calls).toBe(1);   // world entry → no bypass, no refetch
    expect(window.__MARINE_SERIES_DIAG__.ttlCoverageBypass).toBeUndefined();
  });
});
