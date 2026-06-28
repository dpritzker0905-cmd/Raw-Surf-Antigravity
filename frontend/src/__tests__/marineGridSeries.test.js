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
});
