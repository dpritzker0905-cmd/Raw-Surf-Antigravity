jest.mock('../../lib/apiClient', () => ({ API_BASE: '/api', BACKEND_URL: '' }));
import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';
import { prewarmGlobalMarineGrid } from './marineController';
import { getPerModelHourCache } from './marineControllerCache';
import { _resetGlobalPrewarmDedupeForTest } from './marineGlobalPrewarm';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

const WORLD = { west: -180, east: 180, south: -80, north: 85 };
const frame = (stride = 4) => ({ hour_offset: 6, bounds: WORLD, cols: 46, rows: 20, decimated_stride: stride,
  vectors: [{ lat: 28, lng: -80, u: 0, v: -1, speed: 2, direction: 0, period: 8 }],
  provider: 'open-meteo', valid_time: '2026-10-04T06:00:00Z', served_valid_time: '2026-10-04T06:00:00Z' });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(Date.UTC(2026, 9, 4)); localStorage.clear();
  _resetMarineSeriesForTest(); _resetGlobalPrewarmDedupeForTest(); getPerModelHourCache().clear();
  window.__MARINE_SERIES__ = true; window.__MARINE_SIBLING_PREWARM__ = true; window.__RAW_DISABLE_HOUR0_FIRST__ = true;
  window.__MOCK_DATE_NOW__ = Date.UTC(2026, 9, 4);
  process.env.REACT_APP_GFS_EXACT_PLAYBACK = 'true';
  setCachedManifest({ products: [{ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: frame().valid_time }] });
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
});
afterEach(() => {
  _resetMarineSeriesForTest(); _resetGlobalPrewarmDedupeForTest(); setCachedManifest(null);
  jest.clearAllTimers(); jest.useRealTimers(); delete process.env.REACT_APP_GFS_EXACT_PLAYBACK;
  for (const key of ['__MOCK_DATE_NOW__', '__RAW_DISABLE_HOUR0_FIRST__', '__RAW_DISABLE_GFS_EXACT_PLAYBACK__']) delete window[key];
});
async function warm(model = 'GFS', layer = 'waves', stride = 4) {
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ frames: [frame(stride)] }) });
  await ensureMarineSeries(model, layer, WORLD, 6, undefined, true); await flush(); global.fetch.mockClear();
}
test('manual scrub cannot commit the thin world placeholder as the requested GFS wave frame', async () => {
  await warm(); expect(getMarineSeriesFrame('GFS', 'waves', WORLD, 6)).toBeNull();
});
test.each([['GFS', 'waves', 1], ['ICON', 'waves', 4], ['GFS', 'swell_1', 4]])('retains ready %s %s stride %s controls', async (model, layer, stride) => {
  await warm(model, layer, stride); expect(getMarineSeriesFrame(model, layer, WORLD, 6)?.grid.__decimatedStride || 1).toBe(stride);
});
test.each(['unset', 'kill'])('thin series remains available under %s rollback', async control => {
  if (control === 'unset') delete process.env.REACT_APP_GFS_EXACT_PLAYBACK;
  else window.__RAW_DISABLE_GFS_EXACT_PLAYBACK__ = true;
  await warm(); expect(getMarineSeriesFrame('GFS', 'waves', WORLD, 6)).not.toBeNull();
});
test('playback warm serves a wide view with one grid request and no series-page request', async () => {
  prewarmGlobalMarineGrid('GFS', 6, WORLD, 'waves', { playback: true, gridFirst: true }); await flush();
  expect(global.fetch.mock.calls.filter(([url]) => /\/grid\?/.test(url))).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([url]) => /\/grid_series\?/.test(url))).toHaveLength(0);
});
test('prefetching the next exact frame cannot stage it into the currently drawn bridge', async () => {
  window.__MARINE_ENGINE__ = {};
  await warm('GFS', 'waves', 1);
  prewarmGlobalMarineGrid('GFS', 6, WORLD, 'waves', { playback: true, gridFirst: true }); await flush();
  expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeUndefined();
  expect(getPerModelHourCache().size).toBeGreaterThan(0);
  delete window.__MARINE_ENGINE__;
});
