/**
 * Option 1 — marine time-series client. Verifies it is OFF by default (no behavior
 * change), and when enabled: caches frames, returns a ready-to-commit marineData for the
 * nearest hour (snap ≤1.5h), and shapes the frame like a normal cached grid commit.
 */
import {
  isMarineSeriesEnabled,
  ensureMarineSeries,
  getMarineSeriesFrame,
  prewarmMarineSeries,
  padRegionalBbox,
  SERIES_BBOX_PAD_DEG,
  coarseRevalDelayMs,
  _resetMarineSeriesForTest,
} from '../components/map/marineGridSeries';

const bounds = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };

function mockSeriesResponse() {
  const mkVec = (h) => ({ lat: 28, lng: -80, u: 0.1, v: 0.2, speed: h * 0.1, direction: 90, period: 8 });
  return {
    model: 'GFS', domain: 'marine', layer: 'waves', cols: 4, rows: 4,
    frames: [
      { hour_offset: 0, valid_time: '2026-06-20T06:00:00Z', cols: 4, rows: 4, bounds, vectors: [mkVec(0)], provider: 'open-meteo' },
      { hour_offset: 3, valid_time: '2026-06-20T09:00:00Z', cols: 4, rows: 4, bounds, vectors: [mkVec(3)], provider: 'open-meteo' },
      { hour_offset: 6, valid_time: '2026-06-20T12:00:00Z', cols: 4, rows: 4, bounds, vectors: [mkVec(6)], provider: 'open-meteo' },
    ],
  };
}

describe('marineGridSeries — flag-gated time-series client', () => {
  beforeEach(() => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = true; // these suites test the PAGE lane in isolation (hour-0 lane has its own suite)
    _resetMarineSeriesForTest();
    delete window.__MARINE_SERIES__;
    global.fetch = jest.fn();
  });
  afterEach(() => { delete window.__MARINE_SERIES__; });

  it('can be disabled explicitly — ensure/get are no-ops, no fetch', async () => {
    window.__MARINE_SERIES__ = false;
    expect(isMarineSeriesEnabled()).toBe(false);
    await ensureMarineSeries('GFS', 'waves', bounds);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getMarineSeriesFrame('GFS', 'waves', bounds, 3)).toBeNull();
  });

  it('is ON by default', () => {
    expect(isMarineSeriesEnabled()).toBe(true);
  });

  it('when enabled: loads the series and serves the nearest-hour frame as commit-ready marineData', async () => {
    window.__MARINE_SERIES__ = true;
    global.fetch.mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });

    await ensureMarineSeries('GFS', 'waves', bounds);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('/weather/grid_series');
    expect(calledUrl).toContain('model=GFS');
    expect(calledUrl).toContain('layer=waves');

    // Exact hour
    const f3 = getMarineSeriesFrame('GFS', 'waves', bounds, 3);
    expect(f3).not.toBeNull();
    expect(f3.grid.hourOffset).toBe(3);
    expect(f3.grid.__renderable).toBe(true);
    expect(f3.grid.__componentLayer).toBe('waves');
    expect(f3.grid.__sourceModel).toBe('GFS');
    expect(f3.grid.__fromSeries).toBe(true);
    expect(f3.grid.vectors.length).toBe(1);

    // Snap to nearest within 1.5h: 4h -> frame 3
    expect(getMarineSeriesFrame('GFS', 'waves', bounds, 4).grid.hourOffset).toBe(3);
    // Too far from any frame (>1.5h from 6 is the nearest) -> null
    expect(getMarineSeriesFrame('GFS', 'waves', bounds, 50)).toBeNull();
  });

  it('containment fallback: a contained (zoomed-in/panned) viewport is served by a wider warmed series', async () => {
    window.__MARINE_SERIES__ = true;
    global.fetch.mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });

    const wide = { west: -82, south: 27, east: -79, north: 29 };
    await ensureMarineSeries('GFS', 'waves', wide); // warm the WIDE view
    expect(global.fetch).toHaveBeenCalled();

    // A narrower viewport CONTAINED in `wide` has a DIFFERENT viewport key, so the exact-key
    // lookup misses — but containment serves it (the wider grid covers it). This is the zoom-in/
    // small-pan re-warm window that used to fall through to a per-hour fetch.
    const narrow = { west: -80.6, south: 28.0, east: -80.0, north: 28.4 };
    const f = getMarineSeriesFrame('GFS', 'waves', narrow, 3);
    expect(f).not.toBeNull();
    expect(f.grid.hourOffset).toBe(3);

    // A viewport NOT contained (panned fully outside the warmed bbox) still misses — truth-safe.
    const outside = { west: -90, south: 40, east: -88, north: 42 };
    expect(getMarineSeriesFrame('GFS', 'waves', outside, 3)).toBeNull();
  });

  it('serves a GLOBAL frame to a regional viewport only as a LAST RESORT (no frozen scrub in serve-only)', async () => {
    window.__MARINE_SERIES__ = true;
    const globalBounds = { west: -180, south: -80, east: 180, north: 80 };
    const mkVec = (h, b = globalBounds) => ({ lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2, u: 0.1, v: 0.2, speed: h * 0.1, direction: 90, period: 8 });
    const globalResp = {
      model: 'GFS', domain: 'marine', layer: 'waves', cols: 4, rows: 4,
      frames: [
        { hour_offset: 0, valid_time: '2026-06-20T06:00:00Z', cols: 4, rows: 4, bounds: globalBounds, vectors: [mkVec(0)], provider: 'open-meteo' },
        { hour_offset: 3, valid_time: '2026-06-20T09:00:00Z', cols: 4, rows: 4, bounds: globalBounds, vectors: [mkVec(3)], provider: 'open-meteo' },
      ],
    };
    global.fetch.mockResolvedValue({ ok: true, json: async () => globalResp });
    await ensureMarineSeries('GFS', 'waves', globalBounds); // warm a GLOBAL series (like the global-zoom prewarm)

    // Decoupled/serve-only: the global-coarse is often the ONLY cached product (the regional grid_series
    // returns 0 frames / times out). It MUST be served as a last resort so scrub + layer/model switches
    // still render and track per hour — returning null here froze the heatmap (the regression this guards).
    const regional = { west: -81, south: 27.5, east: -80, north: 28.5 };
    expect(getMarineSeriesFrame('GFS', 'waves', regional, 3)).not.toBeNull();

    // But a REGIONAL series that contains the viewport is PREFERRED over the global-coarse fallback.
    const regBounds = { west: -82, south: 27, east: -79, north: 29 };
    const regResp = {
      model: 'GFS', domain: 'marine', layer: 'waves', cols: 4, rows: 4,
      frames: [
        { hour_offset: 3, valid_time: '2026-06-20T09:00:00Z', cols: 4, rows: 4, bounds: regBounds, vectors: [mkVec(7, regBounds)], provider: 'open-meteo' },
      ],
    };
    global.fetch.mockResolvedValue({ ok: true, json: async () => regResp });
    await ensureMarineSeries('GFS', 'waves', regBounds);
    expect(getMarineSeriesFrame('GFS', 'waves', regional, 3)).not.toBeNull();

    // A (near-)global viewport still accepts the global frame — global-zoom scrub is unaffected.
    const nearGlobal = { west: -170, south: -70, east: 170, north: 70 };
    expect(getMarineSeriesFrame('GFS', 'waves', nearGlobal, 3)).not.toBeNull();
  });

  it('a GLOBAL coarse-preview under the exact viewport key does NOT mask a warmed regional tile (clamp repro 2026-06-28)', async () => {
    window.__MARINE_SERIES__ = true;
    const globalBounds = { west: -180, south: -80, east: 180, north: 80 };
    const regBounds = { west: -82, south: 27, east: -79, north: 29 };
    const mkVec = (s, b) => ({ lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2, u: 0, v: 0, speed: s, direction: 90, period: 8 });

    // 1) The backend serves a GLOBAL coarse-preview for a TIGHT (zoomed-in) request → cached UNDER THE TIGHT
    //    viewport key but with global bounds (the SWR preview while it builds the regional grid). speed=9.
    const tight = { west: -80.6, south: 28.0, east: -80.0, north: 28.4 };
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({
      model: 'GFS', layer: 'waves', cols: 4, rows: 4,
      frames: [{ hour_offset: 3, cols: 4, rows: 4, bounds: globalBounds, vectors: [mkVec(9, globalBounds)], provider: 'open-meteo' }],
    }) });
    await ensureMarineSeries('GFS', 'waves', tight, 3);

    // 2) A wider REGIONAL tile that CONTAINS the tight viewport is also warmed (the earlier zoom-out warm). speed=7.
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({
      model: 'GFS', layer: 'waves', cols: 4, rows: 4,
      frames: [{ hour_offset: 3, cols: 4, rows: 4, bounds: regBounds, vectors: [mkVec(7, regBounds)], provider: 'open-meteo' }],
    }) });
    await ensureMarineSeries('GFS', 'waves', regBounds, 3);

    // The fix: the tight viewport must resolve to the REGIONAL frame (7), NOT the global exact-key preview (9)
    // — the exact-key global preview must defer to the containment fallback so the heatmap sharpens.
    const f = getMarineSeriesFrame('GFS', 'waves', tight, 3);
    expect(f).not.toBeNull();
    expect(f.grid.vectors[0].speed).toBe(7);
  });

  it('pages around the requested hour — a far hour loads ITS page (not hour 0) and serves it', async () => {
    window.__MARINE_SERIES__ = true;
    const mkVec = (s) => ({ lat: 28, lng: -80, u: 0, v: 0, speed: s, direction: 90, period: 8 });
    const farResponse = {
      model: 'GFS', domain: 'marine', layer: 'waves', cols: 4, rows: 4,
      frames: [
        { hour_offset: 297, cols: 4, rows: 4, bounds, vectors: [mkVec(2)], provider: 'open-meteo' },
        { hour_offset: 300, cols: 4, rows: 4, bounds, vectors: [mkVec(3)], provider: 'open-meteo' },
      ],
    };
    global.fetch.mockResolvedValue({ ok: true, json: async () => farResponse });

    // Scrub to +300h -> page 2 (288..336), NOT page 0.
    await ensureMarineSeries('GFS', 'waves', bounds, 300);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('hours=288');     // page 2 starts at 288h
    expect(url).not.toContain('hours=0,');  // did NOT start the request at hour 0

    const f = getMarineSeriesFrame('GFS', 'waves', bounds, 300);
    expect(f).not.toBeNull();
    expect(f.grid.hourOffset).toBe(300);

    // Hour 0 lives in a different (unloaded) page -> miss, falls back to per-hour path.
    expect(getMarineSeriesFrame('GFS', 'waves', bounds, 0)).toBeNull();
  });

  it('prewarmMarineSeries loads ALL pages (concurrency-capped) for far-hour scrub', async () => {
    window.__MARINE_SERIES__ = true;
    global.fetch.mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });

    prewarmMarineSeries('GFS', 'waves', bounds);
    // Concurrency-capped (1-CPU backend): pages load ~2 at a time, NOT all synchronously — but
    // ALL 3 pages (0..141 / 144..285 / 288..336) still complete as the queue drains.
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(3);
    const urls = global.fetch.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes('hours=0,'))).toBe(true);
    expect(urls.some((u) => u.includes('hours=144,'))).toBe(true);
    expect(urls.some((u) => u.includes('hours=288,'))).toBe(true);
  });

  it('prewarmMarineSeries skips EURO (slow per-hour Copernicus) to protect the backend', async () => {
    window.__MARINE_SERIES__ = true;
    global.fetch.mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });

    prewarmMarineSeries('EURO', 'waves', bounds);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('dedupes concurrent loads for the same key', async () => {
    window.__MARINE_SERIES__ = true;
    let resolve;
    global.fetch.mockReturnValue(new Promise((r) => { resolve = () => r({ ok: true, json: async () => mockSeriesResponse() }); }));
    const a = ensureMarineSeries('GFS', 'waves', bounds);
    const b = ensureMarineSeries('GFS', 'waves', bounds);
    resolve();
    await Promise.all([a, b]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // #8 clamp fix (2026-07-01): after a pan beyond warmed tiles the engine is HELD on a stale non-covering
  // regional tile; the covering tile the backend serves never lands because the TTL dedup refuses to re-fetch
  // the same viewport key. `force` (used by the clamp backstop) bypasses the TTL dedup so the covering tile
  // is re-fetched, while a normal re-request stays deduped (no storm during ordinary re-drives).
  it('force bypasses the TTL dedup so a stuck clamp can re-fetch the covering tile (#8)', async () => {
    window.__MARINE_SERIES__ = true;
    global.fetch.mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });

    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);          // warm (1 fetch)
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);          // normal re-request → TTL-deduped
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true, true);    // force=true → re-fetches (the fix)
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  // Degree-boundary clamp fix (live 2026-06-28): the request bbox is padded outward so the backend's
  // degree-snapped tile contains the viewport (+ same-0.5°-key pans), instead of failing strict containment.
  it('propagates the backend rating_mode flag onto the committed grid (rating band on series frames)', async () => {
    window.__MARINE_SERIES__ = true;
    const rated = mockSeriesResponse();
    rated.frames.forEach((f) => { f.rating_mode = true; });   // backend marked these surf-rating frames
    global.fetch.mockResolvedValue({ ok: true, json: async () => rated });
    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);
    const frame = getMarineSeriesFrame('GFS', 'waves', bounds, 0);
    expect(frame).toBeTruthy();
    expect(frame.grid.ratingMode).toBe(true);                 // shader/glyph gate sees it
    // a non-rating series (no flag) stays false (honest swell)
    _resetMarineSeriesForTest();
    global.fetch.mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });
    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);
    expect(getMarineSeriesFrame('GFS', 'waves', bounds, 0).grid.ratingMode).toBe(false);
  });

  it('requests a PADDED bbox so the served tile contains the viewport', async () => {
    window.__MARINE_SERIES__ = true;
    global.fetch.mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });
    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);
    const url = global.fetch.mock.calls[0][0];
    // bounds = {west:-81.7, south:27.8, east:-79.6, north:28.8}; padded by 0.5 → -82.2,27.3,-79.1,29.3
    expect(url).toContain(`bbox=${(bounds.west - 0.5).toFixed(4)},${(bounds.south - 0.5).toFixed(4)},${(bounds.east + 0.5).toFixed(4)},${(bounds.north + 0.5).toFixed(4)}`);
  });
});

describe('padRegionalBbox — degree-boundary clamp fix', () => {
  it('pads a regional bbox outward by SERIES_BBOX_PAD_DEG on every edge', () => {
    const out = padRegionalBbox({ west: -81.7, south: 27.8, east: -79.6, north: 28.8 });
    expect(out).toEqual({ west: -82.2, south: 27.3, east: -79.1, north: 29.3 });
    expect(SERIES_BBOX_PAD_DEG).toBe(0.5);
  });

  it('makes the padded box contain a same-key viewport that straddles a whole-degree boundary', () => {
    // The live failure: tile warmed at south≥28 didn't contain a later viewport at south 27.96.
    const padded = padRegionalBbox({ west: -81.45, south: 28.0, east: -79.78, north: 28.7 });
    const laterViewport = { west: -81.45, south: 27.96, east: -79.78, north: 28.7 };
    // floor/ceil snapping aside, the padded south (27.5) already covers 27.96.
    expect(padded.south).toBeLessThanOrEqual(laterViewport.south);
  });

  it('does NOT pad wide/near-wide viewports (avoids the 15° global-coarse threshold)', () => {
    const wide = { west: -100, south: 10, east: -82, north: 28 };  // 18° span
    expect(padRegionalBbox(wide)).toBe(wide);
  });

  it('clamps latitude to [-89.5, 89.5] when a REGIONAL box sits against a pole', () => {
    const south = padRegionalBbox({ west: 0, south: -89.4, east: 2, north: -86 }); // 3.4° span → padded
    expect(south.south).toBe(-89.5);   // -89.9 clamped
    const north = padRegionalBbox({ west: 0, south: 86, east: 2, north: 89.4 });
    expect(north.north).toBe(89.5);    // 89.9 clamped
  });
});

describe('coarseRevalDelayMs — exponential backoff for the coarse-preview revalidation (sharpen re-drive root, 2026-07-04)', () => {
  it('keeps the early snappiness, doubles per attempt, and caps at 30s', () => {
    expect(coarseRevalDelayMs(1)).toBe(1200);
    expect(coarseRevalDelayMs(2)).toBe(2400);
    expect(coarseRevalDelayMs(3)).toBe(4800);
    expect(coarseRevalDelayMs(4)).toBe(9600);
    expect(coarseRevalDelayMs(5)).toBe(19200);
    expect(coarseRevalDelayMs(6)).toBe(30000);
    expect(coarseRevalDelayMs(13)).toBe(30000);   // stays capped
    expect(coarseRevalDelayMs(0)).toBe(1200);     // degenerate input → base delay
  });

  it('total budget spans the 5-min series TTL — a slow backend regional build is still caught', () => {
    // The wedge: the old fixed 8×1.2s (~10s) budget exhausted while the 1-CPU backend was still
    // building the regional grid, caching the GLOBAL preview for the full TTL with no driver left.
    // 14 attempts under this schedule must cover at least the TTL window (5 min).
    let total = 0;
    for (let n = 1; n <= 14; n++) total += coarseRevalDelayMs(n);
    expect(total).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});

describe('coarse-preview revalidation keeps re-driving past the old 8-attempt budget', () => {
  beforeEach(() => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = true; // these suites test the PAGE lane in isolation (hour-0 lane has its own suite)
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    global.fetch = jest.fn();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.__MARINE_SERIES__;
  });

  // Flush the microtask queue so awaited fetch mocks settle under fake timers.
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

  it('a persistent GLOBAL preview for a REGIONAL request revalidates 15 times on the backoff schedule, then stops', async () => {
    const regional = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };
    const worldBounds = { west: -180, south: -85, east: 180, north: 85 };
    const coarseResp = {
      model: 'GFS', domain: 'marine', layer: 'waves', cols: 4, rows: 4,
      frames: [{ hour_offset: 0, valid_time: '2026-06-20T06:00:00Z', cols: 4, rows: 4, bounds: worldBounds, vectors: [{ lat: 0, lng: 0, u: 0, v: 0, speed: 1, direction: 90, period: 8 }], provider: 'open-meteo' }],
    };
    global.fetch.mockResolvedValue({ ok: true, json: async () => coarseResp });

    await ensureMarineSeries('GFS', 'waves', regional, 0, undefined, true);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);   // initial load → coarse preview, revalCount=1

    // Walk the backoff chain: after N coarse results the next attempt fires coarseRevalDelayMs(N) later.
    for (let n = 1; n < 15; n++) {
      jest.advanceTimersByTime(coarseRevalDelayMs(n));
      await flush();
      expect(global.fetch).toHaveBeenCalledTimes(n + 1);
    }
    // Past the old 10s budget: attempt 9+ proves the wedge fix (old MAX was 8).
    expect(global.fetch.mock.calls.length).toBeGreaterThan(8);

    // Budget exhausted at 15 — a genuinely global-only region cannot loop forever.
    jest.advanceTimersByTime(10 * 60 * 1000);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(15);
  });
});
