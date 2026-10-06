// Real outer cache and weather adapters; only the HTTP provider is offline.
jest.mock('../../lib/apiClient', () => ({ BACKEND_URL: 'https://backend.example.invalid' }));
jest.mock('./backendWeatherServiceClientTrace', () => ({}));
let outer, requests;
const LANES = [['GFS', 'waves'], ['ICON', 'waves'], ['EURO', 'waves'],
  ['GFS', 'wind'], ['GFS', 'pressure'], ['EURO', 'precipitation']];
const MODES = ['true', 'false'];

beforeEach(() => {
  jest.resetModules(); jest.useFakeTimers('modern');
  jest.setSystemTime(Date.parse('2026-10-05T00:00:00Z'));
  window.localStorage.clear();
  for (const flag of ['WEATHER', 'ICON_MARINE', 'COPERNICUS', 'WIND', 'PRESSURE', 'PRECIPITATION']) {
    window[`__USE_BACKEND_${flag}_SERVICE__`] = true;
  }
  window.__USE_BACKEND_MARINE_SYSTEM__ = true;
  delete window.__MARINE_PROJECTION_DIAG__; delete window.__WIND_PROJECTION_DIAG__;
  delete window.__RAW_DISABLE_POINT_REQUEST_IDENTITY__; delete window.__MOCK_DATE_NOW__;
  delete window.map;
  requests = [];
  global.fetch = jest.fn(async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/products')) {
      return { ok: true, status: 200, json: async () => ({ products: [] }) };
    }
    const q = Object.fromEntries(parsed.searchParams);
    requests.push(q);
    return { ok: true, status: 200, json: async () => ({
      model: q.model, domain: q.domain, layer: q.layer, valid_time: q.valid_time,
      product_id: q.grid_product_id || `${q.model}_${q.valid_time}`, provider: 'fixture',
      coverage_status: 'inside_regional_tile', is_estimated: false,
      point: { speed: 5.79, value: 1000, direction: 107, period: 9.1,
        sampled_lat: Number(q.lat), sampled_lng: Number(q.lng), interpolation_method: 'bilinear' }
    }) };
  });
  require('./backendWeatherServiceClient').setCachedManifest({ products: [] });
  outer = require('./forecastExactPoint');
});
afterEach(() => {
  jest.useRealTimers(); delete global.fetch; delete process.env.REACT_APP_POINT_REQUEST_IDENTITY;
});

const WORLDS = MODES.flatMap(mode => LANES.flatMap(([model, layer]) =>
  [-720, -360, 0, 360, 720].map(offset => [mode, model, layer, offset])));
test.each(WORLDS)('identity%s %s/%s world%p sends geographic longitude and shares cache',
  async (mode, model, layer, offset) => {
    process.env.REACT_APP_POINT_REQUEST_IDENTITY = mode;
    const result = await outer.fetchExactMarinePoint(30.04, -87.41 + offset, model, layer, null, 98);
    expect(result).not.toBeNull();
    expect(requests).toHaveLength(1);
    expect(Number(requests[0].lat)).toBe(30.04);
    expect(Number(requests[0].lng)).toBe(-87.41);
    expect(outer.getCachedPointResponse(30.04, -87.41, model, layer, 98)).toBe(result);
    expect(outer.getCachedPointResponse(30.04, -87.41 + offset, model, layer, 98)).toBe(result);
    expect(await outer.fetchExactMarinePoint(30.04, -87.41, model, layer, null, 98)).toBe(result);
    expect(requests).toHaveLength(1);
  });

const INVALID = [[null, -87], [30, undefined], [NaN, -87], [Infinity, -87],
  [91, -87], [-91, -87], ['30', -87], [30, '-87'], [30, NaN], [30, Infinity]];
test.each(MODES.flatMap(mode => INVALID.map(pair => [mode, ...pair])))(
'identity%s invalid %p/%p starts no weather work', async (mode, lat, lng) => {
  process.env.REACT_APP_POINT_REQUEST_IDENTITY = mode;
  expect(await outer.fetchExactMarinePoint(lat, lng, 'GFS')).toBeNull();
  expect(outer.getCachedPointResponse(lat, lng, 'GFS')).toBeNull();
  expect(requests).toHaveLength(0);
});

test.each(MODES.flatMap(mode => [[180, 180], [-180, -180], [540, 180], [-540, -180]]
  .map(([lng, expected]) => [mode, lng, expected])))(
'identity%s dateline %p preserves geographic endpoint %p', async (mode, lng, expected) => {
  process.env.REACT_APP_POINT_REQUEST_IDENTITY = mode;
  const result = await outer.fetchExactMarinePoint(30, lng, 'GFS');
  expect(result).not.toBeNull();
  expect(requests).toHaveLength(1);
  expect(Number(requests[0].lng)).toBe(expected);
});

test.each(MODES.flatMap(mode => [-360, 0, 360].map(offset => [mode, offset])))(
'identity%s legacy serialization world%p normalizes payload and cache', async (mode, offset) => {
  process.env.REACT_APP_POINT_REQUEST_IDENTITY = mode;
  window.__USE_BACKEND_WEATHER_SERVICE__ = false;
  global.fetch = jest.fn(async (url, options) => {
    expect(new URL(url, 'https://offline.invalid').pathname).toBe('/api/weather/grid-legacy-proxy-disabled');
    const query = JSON.parse(options.body).body;
    requests.push(query);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({
      latitude: Number(query.latitude), longitude: Number(query.longitude),
      hourly: { time: ['2026-10-05T00:00'], wave_height: [5.79],
        wave_direction: [107], wave_period: [9.1] }
    }) };
  });
  const result = await outer.fetchExactMarinePoint(30.04, -87.41 + offset, 'GFS');
  expect(result).not.toBeNull();
  expect(Number(requests[0].latitude)).toBe(30.04);
  expect(Number(requests[0].longitude)).toBe(-87.41);
  expect(result.hourly.wave_height).toEqual([5.79]);
  expect(outer.getCachedPointResponse(30.04, -87.41, 'GFS')).toBe(result);
  expect(requests).toHaveLength(1);
});
