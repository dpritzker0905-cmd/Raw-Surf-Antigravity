/**
 * Layer-loading performance (audit 14.0) — the wind lane needs the hour-0-first paint lane the
 * marine lane has had since 2026-07-18.
 *
 * THE DEFECT THIS PINS. Enabling Wind issued ONE `/grid_series` covering 15 hours. Measured live
 * 2026-09-20 at z6: it returned 1,339 KB after **25.9 seconds**, and nothing painted until all 15
 * frames landed. It is LATENCY-bound, not bandwidth-bound — 1.3 MB is trivial, but the 1-CPU
 * backend assembles the hours serially. The marine lane already solved exactly this by racing a
 * single-hour "mini" request ahead of the page; the wind lane never got it.
 *
 * The important half is not that the mini is FETCHED — it is that `getWindSeriesFrame` SERVES it.
 * A mini that is fetched, cached under a key nothing reads, and then superseded is dead code that
 * still costs a request. The third test is the one that would catch that.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: 'https://api.test/api' }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => ({}) }));
jest.mock('./seriesAnchor', () => ({ seriesAnchorTag: () => '', seriesAnchorParam: () => '' }));

const BOUNDS = { west: -81.2, south: 27.5, east: -79.7, north: 28.2 };

function frame(hourOffset) {
  return {
    hour_offset: hourOffset,
    valid_time: '2026-09-21T00:00:00Z',
    cols: 2, rows: 2,
    bounds: { west: -81.2, south: 27.5, east: -79.7, north: 28.2 },
    vectors: [{ lat: 27.8, lng: -80.4, speed: 5, direction: 90 }],
  };
}

/** Resolves the mini (hours=<one>) fast and the full page slowly, mirroring the live timing. */
function makeFetch({ pageDelayMs = 50 } = {}) {
  const calls = [];
  const fn = jest.fn((url) => {
    const u = String(url);
    calls.push(u);
    const hours = (new URLSearchParams(u.split('?')[1] || '')).get('hours') || '';
    const isMini = hours.split(',').length === 1;
    const body = { model: 'GFS', frames: isMini ? [frame(0)] : [frame(0), frame(3), frame(6)] };
    const respond = () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
    if (isMini) return Promise.resolve(respond());
    return new Promise((res) => setTimeout(() => res(respond()), pageDelayMs));
  });
  return { fn, calls };
}

describe('wind hour-0-first paint lane', () => {
  let mod;
  beforeEach(() => {
    jest.resetModules();
    window.__WIND_SERIES__ = true;
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
    mod = require('./windGridSeries');
    mod._resetWindSeriesForTest();
  });
  afterEach(() => { delete window.__WIND_SERIES__; jest.resetModules(); });

  const miniCalls = (calls) => calls.filter((u) => {
    const h = (new URLSearchParams(u.split('?')[1] || '')).get('hours') || '';
    return h.split(',').length === 1;
  });

  it('fires a single-hour mini request alongside the multi-hour page', async () => {
    const { fn, calls } = makeFetch();
    global.fetch = fn;
    await mod.ensureWindSeries('GFS', BOUNDS, 0);

    expect(miniCalls(calls)).toHaveLength(1);
    const page = calls.filter((u) => !miniCalls([u]).length);
    expect(page.length).toBeGreaterThan(0);
    // The mini must be a WIND request, not a stray marine one.
    expect(miniCalls(calls)[0]).toContain('domain=wind');
  });

  it('SERVES the mini frame — a mini nothing reads is dead code that still costs a request', async () => {
    // Page never resolves, so ONLY the mini can satisfy the read. This is the whole point: first
    // paint must not wait on the 15-hour page.
    global.fetch = jest.fn((url) => {
      const hours = (new URLSearchParams(String(url).split('?')[1] || '')).get('hours') || '';
      if (hours.split(',').length === 1) {
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ model: 'GFS', frames: [frame(0)] }) });
      }
      return new Promise(() => {});   // the slow page, never lands
    });

    mod.ensureWindSeries('GFS', BOUNDS, 0);
    await new Promise((r) => setTimeout(r, 30));

    const served = mod.getWindSeriesFrame('GFS', BOUNDS, 0);
    expect(served).not.toBeNull();
  });

  it('does not fire the mini when the page is already warm', async () => {
    const { fn } = makeFetch();
    global.fetch = fn;
    await mod.ensureWindSeries('GFS', BOUNDS, 0);      // warms the page
    fn.mockClear();
    await mod.ensureWindSeries('GFS', BOUNDS, 0);      // second pass
    expect(miniCalls(fn.mock.calls.map((c) => String(c[0])))).toHaveLength(0);
  });

  it('honours the __RAW_DISABLE_HOUR0_FIRST__ kill switch', async () => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;
    const { fn, calls } = makeFetch();
    global.fetch = fn;
    await mod.ensureWindSeries('GFS', BOUNDS, 0);
    expect(miniCalls(calls)).toHaveLength(0);
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
  });

  it('a mini failure is silent — the full page remains the safety net', async () => {
    global.fetch = jest.fn((url) => {
      const hours = (new URLSearchParams(String(url).split('?')[1] || '')).get('hours') || '';
      if (hours.split(',').length === 1) return Promise.reject(new TypeError('network'));
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ model: 'GFS', frames: [frame(0), frame(3)] }) });
    });
    await expect(mod.ensureWindSeries('GFS', BOUNDS, 0)).resolves.not.toThrow();
    expect(mod.getWindSeriesFrame('GFS', BOUNDS, 0)).not.toBeNull();   // page still served it
  });
});
