/**
 * Series-based sibling-layer prewarm for INSTANT marine layer toggles (TASK #2).
 *
 * DEFAULT ON (2026-06-26; kill switch window.__MARINE_SIBLING_PREWARM__ === false). At a REGIONAL
 * viewport, after a marine layer commits we warm the OTHER component layers' regional SERIES frames
 * and cache them in the per-model-hour cache, so a subsequent toggle is an INSTANT getModelSafeMarine
 * hit (the orchestrator's switch instant-commit path) — no round-trip, no blank.
 *
 * These tests exercise the REAL bridge end-to-end (grid_series fetch → series cache → frame →
 * _cacheMarineResult → getModelSafeMarine) — the piece that can't be timed on a hidden audit tab.
 */
import { prewarmSiblingMarineSeries, getModelSafeMarine } from '../components/map/marineController';
import { getPerModelHourCache } from '../components/map/marineControllerCache';
import { _resetMarineSeriesForTest } from '../components/map/marineGridSeries';

const bounds = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 }; // regional, ~2.1° × 1.0°

function mockSeriesResponse() {
  const mkVec = (h) => ({ lat: 28, lng: -80, u: 0.1, v: 0.2, speed: 1 + h * 0.1, direction: 90, period: 8 });
  return {
    model: 'GFS', domain: 'marine', cols: 4, rows: 4,
    frames: [
      { hour_offset: 0, valid_time: '2026-06-20T06:00:00Z', cols: 4, rows: 4, bounds, vectors: [mkVec(0)], provider: 'open-meteo' },
      { hour_offset: 3, valid_time: '2026-06-20T09:00:00Z', cols: 4, rows: 4, bounds, vectors: [mkVec(3)], provider: 'open-meteo' },
    ],
  };
}

// Flush the prewarm's fire-and-forget promise chain (fetch is mocked-resolved; the series
// concurrency gate serializes the 3rd sibling, so poll until the predicate holds).
async function waitFor(pred, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 0));
  }
  return pred();
}
const flush = () => waitFor(() => false, 4); // ~4 macrotasks, used for "nothing should happen" cases

describe('prewarmSiblingMarineSeries — default-on series-based sibling prewarm', () => {
  beforeEach(() => {
    _resetMarineSeriesForTest();
    getPerModelHourCache().clear();
    delete window.__MARINE_SIBLING_PREWARM__;
    delete window.__MARINE_SERIES__;
    delete window.isScrubbingTimeline;
    window.__USE_BACKEND_MARINE_SYSTEM__ = true;
    window.__USE_BACKEND_WEATHER_SERVICE__ = true;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => mockSeriesResponse() });
  });
  afterEach(() => {
    delete window.__MARINE_SIBLING_PREWARM__;
    delete window.__USE_BACKEND_MARINE_SYSTEM__;
    delete window.__USE_BACKEND_WEATHER_SERVICE__;
    delete window.__USE_BACKEND_ICON_MARINE_SERVICE__;
    delete window.isScrubbingTimeline;
  });

  it('is a NO-OP when killed (flag === false): no series fetch, no sibling cached', async () => {
    window.__MARINE_SIBLING_PREWARM__ = false;
    prewarmSiblingMarineSeries('GFS', 0, bounds, 'waves', undefined);
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getModelSafeMarine('GFS', 0, 'swell_1', bounds)).toBeNull();
  });

  it('default (no flag) + regional: warms sibling SERIES and caches their REGIONAL frames so a toggle is an instant getModelSafeMarine hit', async () => {
    // no flag set — relies on the new 2026-06-26 default-on
    prewarmSiblingMarineSeries('GFS', 0, bounds, 'waves', undefined);

    const ok = await waitFor(() =>
      getModelSafeMarine('GFS', 0, 'swell_1', bounds) &&
      getModelSafeMarine('GFS', 0, 'swell_2', bounds) &&
      getModelSafeMarine('GFS', 0, 'wind_waves', bounds));
    expect(ok).toBe(true);

    // the ACTIVE layer is never prewarmed
    expect(getModelSafeMarine('GFS', 0, 'waves', bounds)).toBeNull();

    // a cached sibling is a REGIONAL, renderable, non-stale frame (a toggle commits it instantly)
    const sw1 = getModelSafeMarine('GFS', 0, 'swell_1', bounds);
    expect(sw1.grid.__renderable).toBe(true);
    expect(sw1.__staleHour).toBeFalsy();
    expect(sw1.grid.__fromSeries).toBe(true);
    expect(sw1.grid.bounds.east - sw1.grid.bounds.west).toBeLessThan(340);

    // Per sibling: one PAGE fetch (currentPageOnly — no adjacent-page fan-out, no active-layer
    // refetch: the original 1-CPU contract) plus one 1-hour HOUR-0 mini (2026-07-18 lane: 36 KB,
    // storm-immune, gives sibling toggles an instant first frame). The guarded class is the
    // 48-frame page fan-out — minis are not that class.
    const seriesCalls = global.fetch.mock.calls.filter((c) => String(c[0]).includes('/grid_series'));
    const pageCalls = seriesCalls.filter((c) => /hours=\d+,/.test(String(c[0])));
    const miniCalls = seriesCalls.filter((c) => /hours=\d+(&|$)/.test(String(c[0])));
    expect(pageCalls).toHaveLength(3);
    expect(miniCalls).toHaveLength(3);
    const layersFetched = new Set(
      pageCalls.map((c) => (String(c[0]).match(/[?&]layer=([^&]+)/) || [])[1])
    );
    expect(layersFetched).toEqual(new Set(['swell_1', 'swell_2', 'wind_waves']));
  });

  it('skips at a GLOBAL / zoomed-out viewport (series frames are regional)', async () => {
    window.__MARINE_SIBLING_PREWARM__ = true;
    prewarmSiblingMarineSeries('GFS', 0, { west: -180, south: -80, east: 180, north: 85 }, 'waves', undefined);
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips during scrub (does not compete with the active scrub series load)', async () => {
    window.__MARINE_SIBLING_PREWARM__ = true;
    window.isScrubbingTimeline = true;
    prewarmSiblingMarineSeries('GFS', 0, bounds, 'waves', undefined);
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('aborts cleanly: a pre-aborted signal caches nothing', async () => {
    window.__MARINE_SIBLING_PREWARM__ = true;
    const ac = new AbortController();
    ac.abort();
    prewarmSiblingMarineSeries('GFS', 0, bounds, 'waves', ac.signal);
    await flush();
    expect(getModelSafeMarine('GFS', 0, 'swell_1', bounds)).toBeNull();
  });

  it('ICON omits the secondary swell (no native swell_2): warms only waves/swell_1/wind_waves', async () => {
    window.__MARINE_SIBLING_PREWARM__ = true;
    window.__USE_BACKEND_ICON_MARINE_SERVICE__ = true;
    prewarmSiblingMarineSeries('ICON', 0, bounds, 'waves', undefined);

    const ok = await waitFor(() =>
      getModelSafeMarine('ICON', 0, 'swell_1', bounds) &&
      getModelSafeMarine('ICON', 0, 'wind_waves', bounds));
    expect(ok).toBe(true);
    expect(getModelSafeMarine('ICON', 0, 'swell_2', bounds)).toBeNull(); // never warmed for ICON
  });
});
