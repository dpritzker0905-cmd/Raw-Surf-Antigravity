jest.mock('../../lib/apiClient', () => ({ API_BASE: '/api', BACKEND_URL: '' }));

import { prewarmGlobalMarineGrid, getModelSafeMarine } from './marineController';
import { getPerModelHourCache } from './marineControllerCache';
import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';
import * as backendClient from './backendWeatherServiceClient';

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
async function warm(model = 'GFS', layer = 'waves', frames = [frame(0), frame(3), frame(6)]) {
  global.fetch.mockImplementation(async (url) => /\/grid_series\?/.test(url)
    ? { ok: true, status: 200, json: async () => ({ frames }) }
    : { ok: false, status: 503, json: async () => ({}) });
  await ensureMarineSeries(model, layer, WORLD, 0, undefined, true);
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

test.each(['GFS', 'ICON', 'EURO'])('reuses exact-hour %s world series through the actual controller cache', async model => {
  await warm(model);
  const source = getMarineSeriesFrame(model, 'waves', WORLD, 3);
  expect(getModelSafeMarine(model, 3, 'waves', WORLD)).toBeNull();
  prewarmGlobalMarineGrid(model, 3, COAST, 'waves');
  await flush();
  expect(gridRequests()).toHaveLength(0);
  const cached = getModelSafeMarine(model, 3, 'waves', WORLD);
  expect(cached).toBe(source);
  expect(cached.grid.hourOffset).toBe(3);
  expect(cached.grid.valid_time).toBe('2026-09-20T03:00:00Z');
  expect(cached.grid.model_run_time).toBe('2026-09-20T00:00:00Z');
  expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(source.grid);
});

test('settled exact-hour steps reuse the warm page without per-hour global grids', async () => {
  await warm();
  for (const hour of [0, 3, 6]) {
    prewarmGlobalMarineGrid('GFS', hour, COAST, 'waves');
    await flush();
    expect(getModelSafeMarine('GFS', hour, 'waves', WORLD)?.grid.hourOffset).toBe(hour);
  }
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([1, 3])('an old h0 frame cannot populate requested h%s cache or seed', async hour => {
  await warm('GFS', 'waves', [frame(0)]);
  prewarmGlobalMarineGrid('GFS', hour, COAST, 'waves');
  await flush();
  expect(gridRequests()).toHaveLength(1);
  expect(getModelSafeMarine('GFS', hour, 'waves', WORLD)).toBeNull();
  expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
});

test.each([
  ['earlier valid time', { valid_time: '2026-09-20T00:00:00Z' }],
  ['earlier served time', { served_valid_time: '2026-09-20T00:00:00Z' }],
  ['missing valid time', { valid_time: null }],
  ['invalid valid time', { valid_time: 'invalid' }],
  ['substituted frame', { frame_substituted: true }],
])('does not relabel a same-offset frame with %s', async (_, overrides) => {
  await warm('GFS', 'waves', [frame(3, overrides)]);
  prewarmGlobalMarineGrid('GFS', 3, COAST, 'waves');
  await flush();
  expect(gridRequests()).toHaveLength(1);
  expect(getModelSafeMarine('GFS', 3, 'waves', WORLD)).toBeNull();
  expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
});

test.each(['model', 'layer', 'flavor'])('does not reuse a world series with different %s identity', async mismatch => {
  if (mismatch === 'flavor') window.__SURF_MODE__ = true;
  await warm();
  if (mismatch === 'flavor') window.__SURF_MODE__ = false;
  // Missing series transport remains a miss, so this pins the ordinary per-hour grid fallback.
  global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
  const model = mismatch === 'model' ? 'ICON' : 'GFS';
  const layer = mismatch === 'layer' ? 'swell_1' : 'waves';
  prewarmGlobalMarineGrid(model, 3, COAST, layer);
  await flush();
  expect(gridRequests()).toHaveLength(1);
  expect(getModelSafeMarine(model, 3, layer, WORLD)).toBeNull();
});

test('same relative hour from an earlier timeline base does not become the new valid time', async () => {
  await warm();
  window.__MOCK_DATE_NOW__ = Date.parse('2026-09-20T06:00:00Z');
  setCachedManifest({ products: [{ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: '2026-09-20T09:00:00Z' }] });
  prewarmGlobalMarineGrid('GFS', 3, COAST, 'waves');
  await flush();
  expect(gridRequests()).toHaveLength(1);
  expect(getModelSafeMarine('GFS', 3, 'waves', WORLD)).toBeNull();
  expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
});

test('a regional series frame cannot replace the world bridge seed', async () => {
  await warm('GFS', 'waves', [frame(3, { bounds: COAST })]);
  prewarmGlobalMarineGrid('GFS', 3, COAST, 'waves');
  await flush();
  expect(gridRequests()).toHaveLength(1);
  expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
});

test('a warm controller result remains preferred over the series alternative', async () => {
  await warm();
  const { _cacheMarineResult } = require('./marineControllerCache');
  const existing = { grid: { ...frame(3), hourOffset: 3, __sourceModel: 'GFS', __componentLayer: 'waves' } };
  _cacheMarineResult('GFS', 3, existing, 'waves', true);
  prewarmGlobalMarineGrid('GFS', 3, COAST, 'waves');
  await flush();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(getModelSafeMarine('GFS', 3, 'waves', WORLD)).toBe(existing);
});

test('a cold miss leaves target-time resolution to the ordinary grid fetch', async () => {
  window.__MARINE_SERIES__ = false;
  setCachedManifest(null);
  const resolveTime = jest.spyOn(backendClient, 'getSharedValidTime');
  global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
  prewarmGlobalMarineGrid('GFS', 3, COAST, 'waves');
  await flush();
  expect(gridRequests()).toHaveLength(1);
  // The reuse check must not add a SIDE-EFFECTING resolution (one that can refresh manifests)
  // without a candidate to compare.
  //
  // Updated 2026-09-20 (F-03, audit 14.0): the world-grid dedupe now also resolves the target time,
  // because the request identity is the resolved valid_time and not the hour offset -- three
  // 1-hour wheel steps share one 3-hourly frame and were each re-downloading the same ~2.3 MB
  // world grid. So there are now two calls, and the invariant this test protects is expressed
  // directly: EVERY call beyond the first must pass readOnly, which is the flag that suppresses
  // the manifest refresh and the diagnostic write. Asserting the flag is strictly stronger than
  // asserting the count -- a future side-effecting call would still fail here.
  expect(resolveTime).toHaveBeenCalledTimes(2);
  const sideEffecting = resolveTime.mock.calls.filter((args) => !(args[3] && args[3].readOnly));
  expect(sideEffecting).toHaveLength(1);
});
