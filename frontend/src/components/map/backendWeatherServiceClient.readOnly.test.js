import { getSharedValidTime, setCachedManifest, latestTimeDiag } from './backendWeatherServiceClient';

const NOW = '2026-09-20T21:00:00.000Z';
const originalFetch = global.fetch;
beforeEach(() => {
  window.__MOCK_DATE_NOW__ = Date.parse(NOW);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ products: [] }) });
  latestTimeDiag.GFS_waves = { sentinel: 'serving diagnostics' };
  setCachedManifest(null);
});
afterEach(async () => {
  await Promise.resolve();
  await Promise.resolve();
  global.fetch = originalFetch;
  delete window.__MOCK_DATE_NOW__;
  delete latestTimeDiag.GFS_waves;
  setCachedManifest(null);
});

test.each([null, { products: [] }])('a read-only time lookup never fetches a missing/empty manifest: %j', manifest => {
  setCachedManifest(manifest);
  expect(getSharedValidTime(0, 'waves', 'GFS', { readOnly: true })).toBe(NOW);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(latestTimeDiag.GFS_waves).toEqual({ sentinel: 'serving diagnostics' });
});

test('read-only resolution uses the existing manifest cadence without changing serving diagnostics', () => {
  setCachedManifest({ products: [{ model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start: NOW }] });
  expect(getSharedValidTime(1, 'waves', 'GFS', { readOnly: true })).toBe(NOW);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(latestTimeDiag.GFS_waves).toEqual({ sentinel: 'serving diagnostics' });
  expect(getSharedValidTime(1, 'waves', 'GFS')).toBe(NOW);
  expect(latestTimeDiag.GFS_waves.requestedValidTime).toBe('2026-09-20T22:00:00.000Z');
});

test('existing serving callers still refresh missing manifests and publish diagnostics', () => {
  expect(getSharedValidTime(0, 'waves', 'GFS')).toBe(NOW);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(latestTimeDiag.GFS_waves.requestedValidTime).toBe(NOW);
});
