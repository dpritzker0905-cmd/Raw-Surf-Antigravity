// W-01/W-02: real outer cache + real adapters, with an offline HTTP boundary.
jest.mock('../../lib/apiClient', () => ({ BACKEND_URL: 'https://backend.example.invalid' }));
jest.mock('./backendWeatherServiceClientTrace', () => ({}));
const BASE = Date.parse('2026-10-04T00:29:00Z');
let client, outer, requests, manifestClock;

beforeEach(() => {
  process.env.REACT_APP_POINT_REQUEST_IDENTITY = 'true';
  jest.resetModules();
  jest.useFakeTimers('modern'); jest.setSystemTime(BASE);
  window.localStorage.clear();
  for (const flag of ['WEATHER', 'ICON_MARINE', 'COPERNICUS', 'WIND', 'PRESSURE', 'PRECIPITATION']) {
    window[`__USE_BACKEND_${flag}_SERVICE__`] = true;
  }
  window.__USE_BACKEND_MARINE_SYSTEM__ = true;
  delete window.__MARINE_PROJECTION_DIAG__; delete window.__WIND_PROJECTION_DIAG__;
  delete window.__RAW_DISABLE_POINT_REQUEST_IDENTITY__; delete window.__MOCK_DATE_NOW__;
  delete window.map;
  requests = []; manifestClock = false;
  global.fetch = jest.fn(async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/products')) {
      if (manifestClock) jest.setSystemTime(BASE + 120000);
      return {ok: true, status: 200, json: async () => ({products: []})};
    }
    const q = Object.fromEntries(parsed.searchParams);
    requests.push(q);
    return {ok: true, status: 200, json: async () => ({
      model: q.model, domain: q.domain, layer: q.layer, valid_time: q.valid_time,
      product_id: q.grid_product_id || `${q.model}_${q.valid_time}`, provider: 'fixture',
      coverage_status: 'inside_regional_tile', is_estimated: false,
      point: {speed: requests.length, value: 1000 + requests.length, direction: 90, period: 10,
        sampled_lat: 28, sampled_lng: -80, interpolation_method: 'bilinear'}
    })};
  });
  client = require('./backendWeatherServiceClient');
  client.setCachedManifest({products: []});
  outer = require('./forecastExactPoint');
});
afterEach(() => {
  jest.useRealTimers(); delete global.fetch; delete process.env.REACT_APP_POINT_REQUEST_IDENTITY;
  delete window.__RAW_DISABLE_POINT_REQUEST_IDENTITY__;
});

async function point(model = 'GFS', layer = 'waves', force = false, id = null, bbox = null) {
  return outer.fetchExactMarinePoint(28, -80, model, layer, null, 0, force, id, bbox);
}

test.each(['waves', 'wind', 'pressure'])('%s h0 crosses UTC rounding boundary without reusing previous frame', async layer => {
  await point('GFS', layer);
  jest.setSystemTime(BASE + 120000);
  const result = await point('GFS', layer);
  expect(requests).toHaveLength(2);
  expect(requests[0].valid_time).toBe('2026-10-04T00:00:00.000Z');
  expect(requests[1].valid_time).toBe('2026-10-04T01:00:00.000Z');
  expect(result.hourly.time[0]).toBe('2026-10-04T01:00:00Z');
});

test.each([['GFS', 'waves'], ['ICON', 'waves'], ['EURO', 'waves'], ['GFS', 'wind'],
  ['GFS', 'pressure'], ['EURO', 'precipitation']])('%s %s force bypasses both caches; next normal call reuses new result', async (model, layer) => {
  const first = await point(model, layer);
  const cached = await point(model, layer);
  expect(cached).toBe(first); expect(requests).toHaveLength(1);
  jest.setSystemTime(BASE + 1000);
  const fresh = await point(model, layer, true);
  expect(requests).toHaveLength(2);
  expect(fresh).not.toBe(first);
  expect(await point(model, layer)).toBe(fresh);
  expect(requests).toHaveLength(2);
});

test('product change invalidates the outer cache at the same coordinate and time', async () => {
  await point('GFS', 'waves', false, 'gfs-A.json', '-82,26,-78,30');
  const result = await point('GFS', 'waves', false, 'gfs-B.json', '-82,26,-78,30');
  expect(requests.map(q => q.grid_product_id)).toEqual(['gfs-A.json', 'gfs-B.json']);
  expect(result.productId).toBe('gfs-B.json');
});
test('viewport change invalidates the outer cache with the same product', async () => {
  await point('GFS', 'waves', false, 'gfs-A.json', '-82,26,-78,30');
  await point('GFS', 'waves', false, 'gfs-A.json', '-83,26,-78,30');
  expect(requests.map(q => q.grid_bbox)).toEqual(['-82,26,-78,30', '-83,26,-78,30']);
});
test('cache lookup and write agree on the model-scoped ambient hints', async () => {
  window.__MARINE_PROJECTION_DIAG__ = {activeModel: 'GFS', activeLayer: 'waves', productId: 'A.json'};
  await point();
  expect(outer.getCachedPointResponse(28, -80, 'GFS')).not.toBeNull();
  window.__MARINE_PROJECTION_DIAG__.productId = 'B.json';
  expect(outer.getCachedPointResponse(28, -80, 'GFS')).toBeNull();
  await point();
  expect(requests.map(q => q.grid_product_id)).toEqual(['A.json', 'B.json']);
});
test('EURO cannot acquire the ambient ICON grid hint', async () => {
  window.__MARINE_PROJECTION_DIAG__ = {activeModel: 'ICON', activeLayer: 'waves', productId: 'icon.json'};
  await point('EURO');
  expect(requests[0].grid_product_id).toBeUndefined();
});

test.each(['pressure', 'precipitation'])('%s nearest manifest time uses the weather domain', async layer => {
  client.setCachedManifest({products: [{model: 'GFS', domain: 'weather', layer,
    valid_time_start: '2026-10-04T02:00:00Z'}]});
  await point('GFS', layer);
  expect(requests[0].valid_time).toBe('2026-10-04T02:00:00.000Z');
  expect(outer.getCachedPointResponse(28, -80, 'GFS', layer)).not.toBeNull();
});
test('a refreshed manifest invalidates the same h0 cache entry', async () => {
  await point();
  client.setCachedManifest({products: [{model: 'GFS', domain: 'marine', layer: 'waves',
    valid_time_start: '2026-10-04T01:00:00Z'}]});
  await point();
  expect(requests.map(q => q.valid_time)).toEqual(['2026-10-04T00:00:00.000Z', '2026-10-04T01:00:00.000Z']);
});
test('rain and precipitation aliases share the same actual request identity', async () => {
  const result = await point('EURO', 'rain');
  expect(await point('EURO', 'precipitation')).toBe(result);
  expect(requests).toHaveLength(1);
  expect(requests[0].layer).toBe('precipitation');
});
test('coarse hint guard and cache use the same effective request', async () => {
  await point('GFS', 'waves', false, 'global_coarse.json', '-180,-80,180,80');
  await point();
  expect(requests).toHaveLength(1);
  expect(requests[0].grid_product_id).toBeUndefined();
  expect(requests[0].grid_bbox).toBeUndefined();
});
test('aborted refresh propagates cancellation and keeps the previous complete response', async () => {
  const first = await point();
  const error = Object.assign(new Error('aborted'), {name: 'AbortError'});
  global.fetch.mockRejectedValueOnce(error);
  await expect(point('GFS', 'waves', true)).rejects.toBe(error);
  expect(await point()).toBe(first);
});

test.each([[179, 'waves'], [241, 'waves'], [272, 'swell_2']])('ICON %sh %s blend only passes its hint to ICON children', async (hour, layer) => {
  await client.fetchBackendExactPoint(28, -80, hour, null, layer, 'ICON', 'icon.json', '-82,26,-78,30');
  expect(requests.length).toBeGreaterThan(1);
  for (const q of requests) expect(q.grid_product_id).toBe(q.model === 'ICON' ? 'icon.json' : undefined);
});

test.each(['pressure', 'precipitation'])('%s manifest await cannot change the already selected request hour', async layer => {
  manifestClock = true;
  const result = await point('GFS', layer);
  expect(requests[0].valid_time).toBe('2026-10-04T00:00:00.000Z');
  expect(result.hourly.time[0]).toBe('2026-10-04T00:00:00Z');
  expect(outer.getCachedPointResponse(28, -80, 'GFS', layer)).toBeNull();
});

test.each(['unset', 'kill'])('default-off/kill %s retains legacy interception', async mode => {
  if (mode === 'unset') delete process.env.REACT_APP_POINT_REQUEST_IDENTITY;
  else window.__RAW_DISABLE_POINT_REQUEST_IDENTITY__ = true;
  const first = await point();
  jest.setSystemTime(BASE + 120000);
  expect(await point('GFS', 'waves', true)).toBe(first);
  expect(requests).toHaveLength(1);
});
