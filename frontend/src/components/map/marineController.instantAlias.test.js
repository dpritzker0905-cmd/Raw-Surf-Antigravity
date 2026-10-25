/**
 * GRID_INSTANT_KEY through the REAL controller (#426 review, 2026-10-21): the cache-level tests stayed green with both controller
 * call sites deleted, so these drive fetchMarineData and getModelSafeMarine over a mocked fetch and COUNT /grid requests.
 * 3-hourly GFS products at 12, 15, 18Z: offsets 2 and 3 both snap to 15Z, so after +3h has been fetched, +2h is the same request.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '/api', BACKEND_URL: '' }));

import { fetchMarineData, getModelSafeMarine } from './marineController';
import { getPerModelHourCache } from './marineControllerCache';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const T0 = Date.parse('2026-10-20T12:00:00Z');
const iso = (h) => new Date(T0 + h * 3600000).toISOString();
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const gridCalls = () => global.fetch.mock.calls.filter(([u]) => /\/grid\?/.test(String(u)));
const gridCallsFor = (instant) => gridCalls().filter(([u]) => new URL(String(u), 'http://x').searchParams.get('valid_time') === instant);

function gridReply(url) {
  const vt = new URL(String(url), 'http://x').searchParams.get('valid_time');
  return { ok: true, status: 200, json: async () => ({
    provider: 'open-meteo', upstream_provider: 'noaa', source_dataset: 'ncep_gfswave025', region_id: 'global_mid', tile_id: 'global_mid',
    valid_time: vt, served_valid_time: vt, run_time: iso(-6), product_id: `gfs_marine_waves_global_mid_${vt}`,
    grid: { bounds: WORLD, cols: 2, rows: 2, vectors: [
      { lat: -10, lng: -100, speed: 1.2, direction: 90, period: 9 }, { lat: -10, lng: 100, speed: 1.4, direction: 90, period: 9 },
      { lat: 40, lng: -100, speed: 2.1, direction: 90, period: 11 }, { lat: 40, lng: 100, speed: 1.9, direction: 90, period: 10 },
    ] },
  }) };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  getPerModelHourCache().clear();
  window.__MOCK_DATE_NOW__ = T0;
  window.__MARINE_SERIES__ = false;              // no series pages: only the exact /grid path is under test
  window.__MARINE_SIBLING_PREWARM__ = false;
  delete window.__SURF_MODE__;
  delete window.__RAW_DISABLE_GRID_INSTANT_KEY__;
  delete window.__RAW_DISABLE_REQUEST_DIET__;
  setCachedManifest({ products: [0, 3, 6].map((h) => ({ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: iso(h) })) });
  global.fetch = jest.fn(async (url) => (/\/grid\?/.test(String(url)) ? gridReply(url) : { ok: false, status: 503, json: async () => ({}) }));
});
afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
  delete window.__MOCK_DATE_NOW__;
  delete window.__MARINE_SERIES__;
  delete window.__MARINE_SIBLING_PREWARM__;
  delete window.__RAW_DISABLE_GRID_INSTANT_KEY__;
  setCachedManifest(null);
});

describe('fetchMarineData: a held instant is not fetched again', () => {
  test('after +3h, +2h (the same 15Z request) sends no /grid and returns the held grid relabelled', async () => {
    const first = await fetchMarineData(WORLD, 2, undefined, 3, false, 'GFS', 'waves');
    await flush();
    expect(gridCallsFor(iso(3)).length).toBeGreaterThanOrEqual(1);
    const before = gridCalls().length;
    const second = await fetchMarineData(WORLD, 2, undefined, 2, false, 'GFS', 'waves');
    await flush();
    expect(gridCalls().length).toBe(before);                          // no new /grid at all
    expect(second.hourOffset).toBe(2);
    expect(second.grid.vectors).toBe(first.grid.vectors);
  });

  test('the kill switch fetches +2h again (the old hour-keyed miss)', async () => {
    window.__RAW_DISABLE_GRID_INSTANT_KEY__ = true;
    await fetchMarineData(WORLD, 2, undefined, 3, false, 'GFS', 'waves');
    await flush();
    const before = gridCallsFor(iso(3)).length;
    await fetchMarineData(WORLD, 2, undefined, 2, false, 'GFS', 'waves');
    await flush();
    expect(gridCallsFor(iso(3)).length).toBe(before + 1);
  });

  test('a different instant (+1h, 12Z) is fetched as before', async () => {
    await fetchMarineData(WORLD, 2, undefined, 3, false, 'GFS', 'waves');
    await flush();
    await fetchMarineData(WORLD, 2, undefined, 1, false, 'GFS', 'waves');
    await flush();
    expect(gridCallsFor(iso(0)).length).toBe(1);
  });
});

describe('getModelSafeMarine: the scrub path is served the held instant', () => {
  test('after +3h, the selector answers +2h with the exact grid (no nearest-hour stand-in)', async () => {
    const first = await fetchMarineData(WORLD, 2, undefined, 3, false, 'GFS', 'waves');
    await flush();
    const hit = getModelSafeMarine('GFS', 2, 'waves', WORLD);
    expect(hit).toBeTruthy();
    expect(hit.__staleHour).toBeFalsy();
    expect(hit.hourOffset).toBe(2);
    expect(hit.grid.vectors).toBe(first.grid.vectors);
  });

  test('the kill switch: no exact +2h entry (the old selector)', async () => {
    window.__RAW_DISABLE_GRID_INSTANT_KEY__ = true;
    await fetchMarineData(WORLD, 2, undefined, 3, false, 'GFS', 'waves');
    await flush();
    const hit = getModelSafeMarine('GFS', 2, 'waves', WORLD);
    expect(!!(hit && hit.hourOffset === 2 && !hit.__staleHour)).toBe(false);
  });
});
