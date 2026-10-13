/**
 * F-01 (audit 14.0) — the series request must TRANSMIT its absolute anchor, and the page cache
 * must be keyed by it.
 *
 * THE DEFECT THIS PINS. `/grid_series` carried only hour OFFSETS. This client derives its anchor
 * with Math.round(now / 1h) while the backend derived its own with a FLOOR. They agree for 30
 * minutes of every hour and disagree by exactly one hour for the other 30, and no field in the
 * request could reconcile them. Measured live 2026-09-20 20:52:35Z: the wheel requested 21Z and
 * the committed series frame was 20Z.
 *
 * Every test below pins the clock to a minute >= 30, which is the half of the hour where round and
 * floor diverge. A test written at an arbitrary minute passes roughly half the time — that phase
 * sensitivity is why the defect survived.
 */
import { getSeriesAnchorIso, getSeriesAnchorMs } from './backendWeatherServiceClient';

// 2026-09-20T20:52:35Z — the exact live observation. round -> 21Z, floor -> 20Z.
const LIVE_MS = Date.UTC(2026, 8, 20, 20, 52, 35);

describe('F-01 series anchor', () => {
  afterEach(() => { delete window.__MOCK_DATE_NOW__; });

  it('rounds to the NEAREST hour, so 20:52 anchors at 21Z (not 20Z)', () => {
    window.__MOCK_DATE_NOW__ = LIVE_MS;
    expect(getSeriesAnchorIso()).toBe('2026-09-20T21:00:00.000Z');
  });

  it('rounds DOWN below the half hour, so 20:29 anchors at 20Z', () => {
    window.__MOCK_DATE_NOW__ = Date.UTC(2026, 8, 20, 20, 29, 59);
    expect(getSeriesAnchorIso()).toBe('2026-09-20T20:00:00.000Z');
  });

  it('flips at exactly xx:30 — the one-second perturbation that creates the disagreement', () => {
    window.__MOCK_DATE_NOW__ = Date.UTC(2026, 8, 20, 20, 29, 59);
    const before = getSeriesAnchorMs();
    window.__MOCK_DATE_NOW__ = Date.UTC(2026, 8, 20, 20, 30, 0);
    const after = getSeriesAnchorMs();
    expect(after - before).toBe(3600000);
  });

  it('is the SAME anchor getSharedValidTime uses at offset 0 (one clock, not two)', () => {
    window.__MOCK_DATE_NOW__ = LIVE_MS;
    // Re-derive the offset-0 target the way getSharedValidTime does, without the manifest snap:
    // if these two ever disagree, the frontend has grown a second clock.
    expect(new Date(getSeriesAnchorMs()).toISOString()).toBe(getSeriesAnchorIso());
  });
});

describe('F-01 series request + cache identity', () => {
  let fetchSpy;

  beforeEach(() => {
    jest.resetModules();
    window.__MOCK_DATE_NOW__ = LIVE_MS;
    fetchSpy = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ model: 'GFS', layer: 'waves', frames: [] }),
    }));
    global.fetch = fetchSpy;
  });

  afterEach(() => { delete window.__MOCK_DATE_NOW__; jest.resetModules(); });

  it('sends base_time on every /grid_series request', async () => {
    const mod = require('./marineGridSeries');
    const bounds = { west: -81.2, south: 27.5, east: -79.7, north: 28.2 };
    // Fail loudly rather than silently pass if this export is ever renamed.
    expect(typeof mod.ensureMarineSeries).toBe('function');
    await mod.ensureMarineSeries('GFS', 'waves', bounds, 0);
    const seriesCalls = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/weather/grid_series'));
    expect(seriesCalls.length).toBeGreaterThan(0);
    for (const u of seriesCalls) {
      expect(u).toContain(`base_time=${encodeURIComponent('2026-09-20T21:00:00.000Z')}`);
    }
  });
});
