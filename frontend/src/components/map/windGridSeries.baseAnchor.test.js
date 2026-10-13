/**
 * F-01 (audit 14.0), wind lane — the wind series must transmit its absolute anchor too.
 *
 * THE DEFECT THIS PINS. F-01 gave `/grid_series` an optional `base_time` so the browser's anchor
 * (`Math.round(now / 1h)`) and the backend's (`.replace(minute=0)`, a FLOOR) stop being two
 * independent clocks. The marine lane was repaired in `caaa5eb8`; the WIND lane was not, so it kept
 * sending bare hour offsets and kept the one-hour disagreement for half of every hour.
 *
 * ⚠️ This is WORSE on wind than on marine. Wind is 1-HOURLY (capability matrix: GFS wind
 * `cadence_hours: 1`), so every wheel step is a real frame and a one-hour anchor error is a
 * directly wrong hour of wind. Marine's 3-hourly cadence frequently absorbed the same error into
 * quantisation, which is part of why it survived there unnoticed.
 *
 * The clock is pinned to a minute >= 30 throughout — the half of the hour where round and floor
 * diverge. At minute < 30 they agree and the defect cannot manifest, so a test written at an
 * arbitrary minute would pass roughly half the time.
 */

// 2026-09-20T23:52:35Z — minute 52. round -> next-day 00:00Z, floor -> 23:00Z.
const LIVE_MS = Date.UTC(2026, 8, 20, 23, 52, 35);
const EXPECTED_ANCHOR = '2026-09-21T00:00:00.000Z';

describe('F-01 wind lane anchor', () => {
  let fetchSpy;

  beforeEach(() => {
    jest.resetModules();
    window.__MOCK_DATE_NOW__ = LIVE_MS;
    try { window.localStorage.setItem('__WIND_SERIES__', 'true'); } catch (e) { /* ignore */ }
    window.__WIND_SERIES__ = true;
    fetchSpy = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ model: 'GFS', frames: [] }),
    }));
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    delete window.__MOCK_DATE_NOW__;
    delete window.__WIND_SERIES__;
    jest.resetModules();
  });

  const seriesUrls = () => fetchSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/weather/grid_series'));

  it('sends base_time on the wind series request', async () => {
    const mod = require('./windGridSeries');
    // Fail loudly rather than silently pass if this export is renamed.
    expect(typeof mod.ensureWindSeries).toBe('function');

    await mod.ensureWindSeries('GFS', { west: -81.2, south: 27.5, east: -79.7, north: 28.2 }, 0);

    const urls = seriesUrls();
    if (urls.length === 0) {
      throw new Error('wind series issued no grid_series request; the lane may be gated off');
    }
    for (const u of urls) {
      expect(u).toContain('domain=wind');
      expect(u).toContain(`base_time=${encodeURIComponent(EXPECTED_ANCHOR)}`);
    }
  });

  it('uses the ROUNDED anchor, not the floored one', async () => {
    const mod = require('./windGridSeries');
    await mod.ensureWindSeries('GFS', { west: -81.2, south: 27.5, east: -79.7, north: 28.2 }, 0);
    const urls = seriesUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      // Assert PRESENCE first. A bare `not.toContain(floored)` is vacuously true when no anchor is
      // sent at all, which is exactly the pre-fix state -- the mutation control caught this test
      // passing against the broken lane, so it now pins the positive fact too.
      expect(u).toContain(`base_time=${encodeURIComponent(EXPECTED_ANCHOR)}`);
      // ...and only then that it is not the FLOORED anchor the backend would derive on its own.
      expect(u).not.toContain(encodeURIComponent('2026-09-20T23:00:00.000Z'));
    }
  });
});

describe('F-01 shared anchor helpers', () => {
  afterEach(() => { delete window.__MOCK_DATE_NOW__; jest.resetModules(); });

  it('both series lanes resolve the SAME anchor (one clock, not three)', () => {
    window.__MOCK_DATE_NOW__ = LIVE_MS;
    const { seriesAnchorParam, seriesAnchorTag } = require('./seriesAnchor');
    expect(seriesAnchorTag()).toBe(`@${EXPECTED_ANCHOR}`);
    expect(seriesAnchorParam()).toBe(`&base_time=${encodeURIComponent(EXPECTED_ANCHOR)}`);
  });

  it('degrades to NO parameter rather than throwing when the anchor is unavailable', () => {
    // CRA sets `resetMocks: true`, so a suite that mocks backendWeatherServiceClient leaves
    // getSeriesAnchorIso as a spy returning undefined. pageKey and the URL builders are on the
    // scrub hot path -- an exception there would abort a fetch mid-flight and strand its
    // concurrency slot, so the contract is "omit the parameter", never "throw".
    jest.resetModules();
    jest.doMock('./backendWeatherServiceClient', () => ({ getSeriesAnchorIso: jest.fn() }));
    const { seriesAnchorParam, seriesAnchorTag } = require('./seriesAnchor');
    expect(seriesAnchorTag()).toBe('');
    expect(seriesAnchorParam()).toBe('');
  });

  it('degrades rather than throwing when the anchor accessor itself throws', () => {
    jest.resetModules();
    jest.doMock('./backendWeatherServiceClient', () => ({
      getSeriesAnchorIso: () => { throw new Error('boom'); },
    }));
    const { seriesAnchorParam } = require('./seriesAnchor');
    expect(seriesAnchorParam()).toBe('');
  });
});
