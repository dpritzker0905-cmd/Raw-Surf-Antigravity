/**
 * marineSiblingWarm.js on the REAL series chain (marineGridSeries + the A15-11 limiter; only fetch is mocked): while the
 * visible layer's 48-frame page is on the box, no sibling request starts; then the toggle frames come from the 1-hour minis,
 * and the sibling pages follow one at a time. Live z9 Florida (the lead's read, 2026-10-23): swell_1 6.3 s, swell_2 6.6 s,
 * wind_waves 11.1 s of /grid_series for layers not shown, on the same 1-CPU box as the visible series.
 */
import { prewarmSiblingMarineSeries, getModelSafeMarine } from './marineController';
import { getPerModelHourCache } from './marineControllerCache';
import { _resetMarineSeriesForTest, ensureMarineSeries } from './marineGridSeries';
import { _resetSiblingWarmForTest, _setSiblingWarmTimingForTest } from './marineSiblingWarm';

const bounds = { west: -81.65, south: 27.6, east: -79.58, north: 28.5 };   // the map's opening view (z9, Florida east coast)
const layerOf = (url) => (String(url).match(/[?&]layer=([^&]+)/) || [])[1];
const isPage = (url) => /hours=\d+,/.test(String(url));

function body() {
  const vec = { lat: 28, lng: -80, u: 0.1, v: 0.2, speed: 1.2, direction: 90, period: 8 };
  return {
    model: 'GFS', domain: 'marine', cols: 4, rows: 4,
    frames: [0, 3].map((h) => ({ hour_offset: h, valid_time: '2026-06-20T06:00:00Z', cols: 4, rows: 4, bounds, vectors: [vec], provider: 'open-meteo' })),
  };
}
async function waitFor(pred, tries = 500, ms = 10) {
  for (let i = 0; i < tries; i++) { if (pred()) return true; await new Promise((r) => setTimeout(r, ms)); }
  return pred();
}

describe('the sibling warm on the real series chain', () => {
  let log; let open; let maxSiblingPages; let releaseVisible;
  beforeEach(() => {
    window.__MOCK_DATE_NOW__ = Date.UTC(2026, 8, 23, 3, 10, 0);     // the historic 0,3,6 lattice (see marineSiblingPrewarm.test.js)
    _resetMarineSeriesForTest();
    _resetSiblingWarmForTest();
    _setSiblingWarmTimingForTest({ poll: 40, quiet: 120 });   // the real 400 / 2000 ms are in marineSiblingWarm.test.js
    getPerModelHourCache().clear();
    window.__USE_BACKEND_MARINE_SYSTEM__ = true;
    window.__USE_BACKEND_WEATHER_SERVICE__ = true;
    log = []; open = 0; maxSiblingPages = 0;
    const visibleGate = new Promise((r) => { releaseVisible = r; });
    global.fetch = jest.fn((url) => {
      if (!String(url).includes('/grid_series')) return new Promise(() => {});        // only the series lane is under test
      const rec = { layer: layerOf(url), page: isPage(url) };
      log.push(rec);
      const sibling = rec.page && rec.layer !== 'waves';
      if (sibling) { open += 1; maxSiblingPages = Math.max(maxSiblingPages, open); }
      const wait = rec.layer === 'waves' && rec.page ? visibleGate : new Promise((r) => setTimeout(r, 25));
      return wait.then(() => { if (sibling) open -= 1; return { ok: true, json: async () => body() }; });
    });
  });
  afterEach(() => {
    _resetSiblingWarmForTest();
    delete window.__USE_BACKEND_MARINE_SYSTEM__; delete window.__USE_BACKEND_WEATHER_SERVICE__; delete window.__MOCK_DATE_NOW__;
    delete window.__RAW_DISABLE_SIBLING_IDLE_PAGES__;
  });

  it('nothing for a hidden layer while the visible page is on the box; then minis first, the pages one at a time', async () => {
    const visible = ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);     // the visible layer's page, in flight
    prewarmSiblingMarineSeries('GFS', 0, bounds, 'waves', undefined);                    // its /grid commit's sibling warm
    await new Promise((r) => setTimeout(r, 1200));                                       // ~30 poll ticks, 10 quiet windows
    expect(log.filter((r) => r.layer !== 'waves')).toEqual([]);                          // not even a mini
    releaseVisible();
    await visible;
    const ready = await waitFor(() => ['swell_1', 'swell_2', 'wind_waves'].every((l) => getModelSafeMarine('GFS', 0, l, bounds)));
    expect(ready).toBe(true);
    const firstPage = log.findIndex((r) => r.page && r.layer !== 'waves');
    const minis = log.filter((r) => !r.page && r.layer !== 'waves');
    expect(minis).toHaveLength(3);
    expect(firstPage === -1 || log.slice(0, firstPage).filter((r) => !r.page && r.layer !== 'waves').length === 3).toBe(true);
    expect(await waitFor(() => log.filter((r) => r.page && r.layer !== 'waves').length === 3)).toBe(true);
    expect(maxSiblingPages).toBe(1);
  });

  it('positive control: with the kill switch the sibling pages go at once, beside each other in the limiter\'s queue', async () => {
    window.__RAW_DISABLE_SIBLING_IDLE_PAGES__ = true;
    releaseVisible();
    await ensureMarineSeries('GFS', 'waves', bounds, 0, undefined, true);
    log.length = 0;
    prewarmSiblingMarineSeries('GFS', 0, bounds, 'waves', undefined);
    expect(await waitFor(() => log.filter((r) => r.page).length === 3, 200, 5)).toBe(true);
    // all three pages were asked for within a second (before: no idle wait), and the frames came after them
    expect(log.filter((r) => !r.page)).toHaveLength(3);
    expect(await waitFor(() => ['swell_1', 'swell_2', 'wind_waves'].every((l) => getModelSafeMarine('GFS', 0, l, bounds)))).toBe(true);
  });
});
