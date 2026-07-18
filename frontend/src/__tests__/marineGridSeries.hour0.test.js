/**
 * HOUR-0-FIRST PAINT LANE goldens (2026-07-18 time-to-fine arc — see
 * HANDOFF-2026-07-18-hour0-first-paint-lane-design.md). On a COLD page, ensureMarineSeries races
 * a 1-hour mini series load ahead of the 48-hour page (storm-immune 0.3 s vs 2.5-3.3 s, proven);
 * the mini entry lives under a '_h0' key, is served by getMarineSeriesFrame's containment
 * fallback until the full page supersedes it, and fires the same 'marine_series_revalidated'
 * event the page lane uses for event-driven sharpen. Kill: __RAW_DISABLE_HOUR0_FIRST__.
 */
import {
  ensureMarineSeries,
  getMarineSeriesFrame,
  _resetMarineSeriesForTest,
} from '../components/map/marineGridSeries';

const bounds = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };

const mkVec = () => ({ lat: 28, lng: -80, u: 0.1, v: 0.2, speed: 1.1, direction: 90, period: 8 });
const frame = (h, b = bounds) => ({
  hour_offset: h, valid_time: '2026-06-20T06:00:00Z', cols: 4, rows: 4, bounds: b,
  vectors: [mkVec()], provider: 'open-meteo',
});
const pageResponse = (hours) => ({ model: 'GFS', domain: 'marine', layer: 'waves', frames: hours.map((h) => frame(h)) });

describe('marineGridSeries — hour-0-first paint lane', () => {
  beforeEach(() => {
    _resetMarineSeriesForTest();
    delete window.__MARINE_SERIES__;
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
    window.__MARINE_SERIES__ = true;
    delete window.__MARINE_SERIES_DIAG__;
    global.fetch = jest.fn();
  });
  afterEach(() => {
    delete window.__MARINE_SERIES__;
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
  });

  it('COLD page: fires the mini (single-hour) request ahead of the page request', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => pageResponse([0]) });
    await ensureMarineSeries('GFS', 'waves', bounds, 0);
    expect(global.fetch.mock.calls.length).toBe(2);
    const urls = global.fetch.mock.calls.map((c) => c[0]);
    const mini = urls.find((u) => /hours=0(&|$)/.test(u));
    const page = urls.find((u) => /hours=0,3,/.test(u));
    expect(mini).toBeDefined();     // exactly one hour
    expect(page).toBeDefined();     // the full page still loads
    expect(urls.indexOf(mini)).toBeLessThan(urls.indexOf(page));   // mini FIRST
  });

  it('mini frame is served by getMarineSeriesFrame while the page is still cold, and dispatches marine_series_revalidated', async () => {
    const events = [];
    const listener = () => events.push('revalidated');
    window.addEventListener('marine_series_revalidated', listener);
    // mini resolves; the page request never resolves (in-storm) — serve must come from the mini
    let call = 0;
    global.fetch.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: true, json: async () => pageResponse([0]) });
      return new Promise(() => {});   // page hangs (the 2.5-3.3s storm)
    });
    const p = ensureMarineSeries('GFS', 'waves', bounds, 0);
    await new Promise((r) => setTimeout(r, 20));    // let the mini land while the page hangs
    const served = getMarineSeriesFrame('GFS', 'waves', bounds, 0);
    expect(served).not.toBeNull();
    expect(served.grid).toBeDefined();
    expect(events).toContain('revalidated');
    expect(window.__MARINE_SERIES_DIAG__.h0Loads).toBe(1);
    window.removeEventListener('marine_series_revalidated', listener);
    p.catch(() => {});
  });

  it('kill switch __RAW_DISABLE_HOUR0_FIRST__ restores the single page request', async () => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;
    global.fetch.mockResolvedValue({ ok: true, json: async () => pageResponse([0, 3]) });
    await ensureMarineSeries('GFS', 'waves', bounds, 0);
    expect(global.fetch.mock.calls.length).toBe(1);
  });

  it('WARM page: no mini fires (the race exists only for the cold window)', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => pageResponse([0, 3]) });
    await ensureMarineSeries('GFS', 'waves', bounds, 0);   // cold: mini + page
    const callsAfterCold = global.fetch.mock.calls.length;
    await ensureMarineSeries('GFS', 'waves', bounds, 0);   // warm: TTL dedup, nothing
    expect(global.fetch.mock.calls.length).toBe(callsAfterCold);
  });

  it('a GLOBAL coarse mini response for a regional viewport is NOT stored (clamp class stays out)', async () => {
    const globalBounds = { west: -180, south: -80, east: 180, north: 85 };
    let call = 0;
    global.fetch.mockImplementation((u) => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: true, json: async () => ({ frames: [frame(0, globalBounds)] }) });
      return new Promise(() => {});
    });
    const p = ensureMarineSeries('GFS', 'waves', bounds, 0);
    await new Promise((r) => setTimeout(r, 20));
    // regional viewport must NOT be served the global mini (getMarineSeriesFrame's own guard would
    // also refuse — this asserts the entry was never stored: nothing to serve at all)
    expect(getMarineSeriesFrame('GFS', 'waves', bounds, 0)).toBeNull();
    p.catch(() => {});
  });

  it('mini failure is silent — the page load is untouched (safety-net contract)', async () => {
    let call = 0;
    global.fetch.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve({ ok: true, json: async () => pageResponse([0, 3]) });
    });
    await ensureMarineSeries('GFS', 'waves', bounds, 0);
    const served = getMarineSeriesFrame('GFS', 'waves', bounds, 0);
    expect(served).not.toBeNull();   // page frame serves normally
  });
});
