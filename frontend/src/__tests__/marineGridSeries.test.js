/**
 * Option 1 — marine time-series client. Verifies it is OFF by default (no behavior
 * change), and when enabled: caches frames, returns a ready-to-commit marineData for the
 * nearest hour (snap ≤1.5h), and shapes the frame like a normal cached grid commit.
 */
import {
  isMarineSeriesEnabled,
  ensureMarineSeries,
  getMarineSeriesFrame,
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

  it('is OFF by default — ensure/get are no-ops, no fetch', async () => {
    expect(isMarineSeriesEnabled()).toBe(false);
    await ensureMarineSeries('GFS', 'waves', bounds);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getMarineSeriesFrame('GFS', 'waves', bounds, 3)).toBeNull();
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
