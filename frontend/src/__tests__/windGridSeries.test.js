/**
 * F3 — wind time-series client. Verifies it is OFF by default (no behavior change), and when
 * enabled: caches frames, serves the nearest-hour frame shaped like fetchBackendWindGrid's
 * result (mapped vectors {lat,lng,speed,direction,u,v}), and pages around the requested hour.
 */
import {
  isWindSeriesEnabled,
  ensureWindSeries,
  getWindSeriesFrame,
  _resetWindSeriesForTest,
} from '../components/map/windGridSeries';

const bounds = { west: -180, south: -80, east: 180, north: 85 };

function mockSeriesResponse() {
  const mkVec = (h) => ({ lat: 28, lng: -80, u: 0.1, v: 0.2, speed: h * 0.1 + 1, direction: 90 });
  return {
    model: 'GFS', domain: 'wind', layer: 'wind', cols: 4, rows: 4,
    frames: [
      { hour_offset: 0, cols: 4, rows: 4, bounds, vectors: [mkVec(0)], provider: 'backend-weather-service' },
      { hour_offset: 3, cols: 4, rows: 4, bounds, vectors: [mkVec(3)], provider: 'backend-weather-service' },
      { hour_offset: 6, cols: 4, rows: 4, bounds, vectors: [mkVec(6)], provider: 'backend-weather-service' },
    ],
  };
}

describe('windGridSeries — flag-gated wind time-series client', () => {
  beforeEach(() => {
    _resetWindSeriesForTest();
    delete window.__WIND_SERIES__;
    global.fetch = jest.fn();
  });
  afterEach(() => { delete window.__WIND_SERIES__; });

  it('is ON by default — ensure loads the series', async () => {
    expect(isWindSeriesEnabled()).toBe(true);
    global.fetch.mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });
    await ensureWindSeries('GFS', bounds, 0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('is OFF when window.__WIND_SERIES__ is false — ensure/get are no-ops, no fetch', async () => {
    window.__WIND_SERIES__ = false;
    expect(isWindSeriesEnabled()).toBe(false);
    await ensureWindSeries('GFS', bounds, 0);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getWindSeriesFrame('GFS', bounds, 3)).toBeNull();
  });

  it('when enabled: loads the series and serves the nearest-hour frame as commit-ready windData', async () => {
    window.__WIND_SERIES__ = true;
    global.fetch.mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });

    await ensureWindSeries('GFS', bounds, 0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('/weather/grid_series');
    expect(url).toContain('domain=wind');
    expect(url).toContain('model=GFS');

    const f3 = getWindSeriesFrame('GFS', bounds, 3);
    expect(f3).not.toBeNull();
    expect(f3.hourOffset).toBe(3);
    expect(f3.renderable).toBe(true);
    expect(f3.source).toBe('GFS');
    expect(f3.__fromSeries).toBe(true);
    // Mapped wind vector fields present.
    expect(f3.vectors[0]).toEqual(expect.objectContaining({ lat: 28, lng: -80, speed: expect.any(Number), direction: 90, u: 0.1, v: 0.2 }));

    // Snap to nearest within 1.5h: 4h -> frame 3
    expect(getWindSeriesFrame('GFS', bounds, 4).hourOffset).toBe(3);
    // Too far -> null
    expect(getWindSeriesFrame('GFS', bounds, 50)).toBeNull();
  });

  it('pages around the requested hour — a far hour loads ITS page (not hour 0)', async () => {
    window.__WIND_SERIES__ = true;
    const mkVec = (s) => ({ lat: 28, lng: -80, u: 0, v: 0, speed: s, direction: 90 });
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({
      model: 'GFS', domain: 'wind', layer: 'wind', cols: 4, rows: 4,
      frames: [{ hour_offset: 300, cols: 4, rows: 4, bounds, vectors: [mkVec(3)], provider: 'backend-weather-service' }],
    }) });

    await ensureWindSeries('GFS', bounds, 300);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('hours=288');
    expect(url).not.toContain('hours=0,');
    expect(getWindSeriesFrame('GFS', bounds, 300).hourOffset).toBe(300);
    expect(getWindSeriesFrame('GFS', bounds, 0)).toBeNull();
  });

  it('dedupes concurrent loads for the same key', async () => {
    window.__WIND_SERIES__ = true;
    let resolve;
    global.fetch.mockReturnValue(new Promise((r) => { resolve = () => r({ ok: true, json: async () => mockSeriesResponse() }); }));
    const a = ensureWindSeries('GFS', bounds, 0);
    const b = ensureWindSeries('GFS', bounds, 0);
    resolve();
    await Promise.all([a, b]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
