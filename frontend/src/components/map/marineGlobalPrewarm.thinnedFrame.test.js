/**
 * A THINNED world series frame is not the world grid (2026-10-01).
 *
 * The global prewarm reused a world series frame as "the world grid" for its hour ("zero network, identical pixels"). That is
 * true only for an unthinned frame. The backend thins a 48-frame world page to 46 x 21 (`decimated_stride: 4`, an 8° lattice) to
 * fit its vector budget, with the SAME product id and valid time as the exact frame, so the controller cache handed the thin
 * frame to every later zoom-out and the exact frame was never fetched (Wed 15Z, Florida: 1.34 m against 2.33 m exact).
 * The thin frame still seeds the zoom-out bridge (right hour, placeholder quality); the exact grid is fetched.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '/api', BACKEND_URL: '' }));

import { prewarmGlobalMarineGrid, getModelSafeMarine } from './marineController';
import { getPerModelHourCache } from './marineControllerCache';
import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const COAST = { west: -81.2, south: 27.9, east: -79.95, north: 28.95 };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const frame = (hour, overrides = {}) => ({
  hour_offset: hour, bounds: WORLD, cols: 2, rows: 2,
  vectors: [{ lat: 28, lng: -80, u: 0, v: -1, speed: 2, direction: 0, period: 8 }],
  provider: 'open-meteo', valid_time: `2026-09-20T${String(hour).padStart(2, '0')}:00:00Z`,
  served_valid_time: `2026-09-20T${String(hour).padStart(2, '0')}:00:00Z`,
  model_run_time: '2026-09-20T00:00:00Z', model_run_time_status: 'verified',
  ...overrides,
});
const gridRequests = () => global.fetch.mock.calls.filter(([url]) => /\/grid\?/.test(url));
async function warm(model, frames) {
  global.fetch.mockImplementation(async (url) => /\/grid_series\?/.test(url)
    ? { ok: true, status: 200, json: async () => ({ frames }) }
    : { ok: false, status: 503, json: async () => ({}) });
  await ensureMarineSeries(model, 'waves', WORLD, 0, undefined, true);
  await flush();
  global.fetch.mockClear();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  getPerModelHourCache().clear();
  _resetMarineSeriesForTest();
  window.localStorage.clear();
  window.__MARINE_ENGINE__ = {};
  window.__MARINE_SERIES__ = true;
  window.__MARINE_SIBLING_PREWARM__ = true;
  window.__RAW_DISABLE_HOUR0_FIRST__ = true;
  window.__MOCK_DATE_NOW__ = Date.parse('2026-09-20T00:00:00Z');
  setCachedManifest({ products: [0, 3, 6].map(h => ({
    model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: frame(h).valid_time,
  })) });
  delete window.isScrubbingTimeline;
  delete window.__SURF_MODE__;
  global.fetch = jest.fn();
});
afterEach(() => {
  _resetMarineSeriesForTest();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete global.fetch;
  delete window.__MARINE_ENGINE__;
  delete window.__RAW_DISABLE_HOUR0_FIRST__;
  delete window.__SURF_MODE__;
  delete window.__MOCK_DATE_NOW__;
  setCachedManifest(null);
});

// EURO's world grid goes through the Copernicus client (its own transport, off in this test env), so only the NOT-cached and
// bridge-seed facts are asserted for it; GFS and ICON also pin that the exact /grid request is made.
test.each([['GFS', 1], ['ICON', 1], ['EURO', null]])('a THINNED world frame is not cached as the %s world grid: the exact grid is fetched and the thin frame only seeds the bridge', async (model, requests) => {
  await warm(model, [0, 3, 6].map(h => frame(h, { decimated_stride: 4 })));
  const source = getMarineSeriesFrame(model, 'waves', WORLD, 3);
  expect(source.grid.__decimatedStride).toBe(4);              // the setup: the client really holds a thinned frame
  prewarmGlobalMarineGrid(model, 3, COAST, 'waves');
  await flush();
  if (requests !== null) expect(gridRequests()).toHaveLength(requests);   // the exact world grid is requested (503 here: only the attempt matters)
  expect(getModelSafeMarine(model, 3, 'waves', WORLD)).toBeNull();                       // ...and the thin frame is NOT the cached world grid
  expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(source.grid);             // right-hour placeholder still seeds the bridge
});

test.each([['no stamp', {}], ['stride 1', { decimated_stride: 1 }]])('an UNTHINNED frame (%s) is still reused with zero network', async (_label, over) => {
  await warm('GFS', [0, 3, 6].map(h => frame(h, over)));
  const source = getMarineSeriesFrame('GFS', 'waves', WORLD, 3);
  expect(source.grid.__decimatedStride).toBe(0);
  prewarmGlobalMarineGrid('GFS', 3, COAST, 'waves');
  await flush();
  expect(gridRequests()).toHaveLength(0);
  expect(getModelSafeMarine('GFS', 3, 'waves', WORLD)).toBe(source);
  expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(source.grid);
});
