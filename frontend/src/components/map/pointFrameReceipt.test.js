// Exercise the real outer cache and native adapter against one offline HTTP response.
jest.mock('../../lib/apiClient', () => ({ BACKEND_URL: 'https://backend.example.invalid' }));
jest.mock('./backendWeatherServiceClientTrace', () => ({}));
let outer, payload, requests;
beforeEach(() => {
  jest.resetModules(); jest.useFakeTimers('modern');
  jest.setSystemTime(Date.parse('2026-10-05T00:00:00Z'));
  window.localStorage.clear(); window.__USE_BACKEND_WEATHER_SERVICE__ = true;
  window.__USE_BACKEND_MARINE_SYSTEM__ = true;
  delete window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__;
  payload = {
    model: 'GFS', layer: 'waves', provider: 'open-meteo', source_dataset: 'ncep_gfswave025',
    product_id: 'actual-point.json', valid_time: '2026-10-09T02:00:00Z',
    served_valid_time: '2026-10-09T00:00:00Z', model_run_time: '2026-10-05T00:00:00Z',
    model_run_time_status: 'known', is_estimated: false, frame_substituted: true, frame_offset_hours: -2,
    point: { speed: 5.79, direction: 107, period: 9.1, sampled_lat: 30, sampled_lng: -87 },
  };
  requests = 0;
  global.fetch = jest.fn(async url => {
    if (!new URL(url).pathname.endsWith('/point')) {
      return { ok: true, status: 200, json: async () => ({ products: [] }) };
    }
    requests++;
    return { ok: true, status: 200, json: async () => payload };
  });
  require('./backendWeatherServiceClient').setCachedManifest({ products: [] });
  outer = require('./forecastExactPoint');
});
afterEach(() => { jest.useRealTimers(); delete global.fetch; });
const point = () => outer.fetchExactMarinePoint(30, -87, 'GFS', 'waves', null, 98, false);
test('native response retains actual served time, cycle and product through both caches', async () => {
  const data = await point();
  expect(data.frameReceipt).toMatchObject({
    servedValidTime: '2026-10-09T00:00:00.000Z',
    requestedValidTime: '2026-10-09T02:00:00.000Z',
    modelRunTime: '2026-10-05T00:00:00.000Z', modelRunTimeStatus: 'known',
    storedProductId: 'actual-point.json', frameSubstituted: true, frameOffsetHours: -2,
  });
  expect(data.hourly.wave_height[0]).toBe(5.79);
  expect(await point()).toBe(data); expect(requests).toBe(1);
});
test('legacy missing served time and cycle stay unknown instead of borrowing the ask', async () => {
  delete payload.served_valid_time; delete payload.model_run_time; delete payload.model_run_time_status;
  const data = await point();
  expect(data.frameReceipt.servedValidTime).toBeNull();
  expect(data.frameReceipt.modelRunTime).toBeNull();
  expect(data.frameReceipt.modelRunTimeStatus).toBe('missing');
});
