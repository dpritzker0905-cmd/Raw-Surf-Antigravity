jest.mock('../../lib/apiClient', () => ({ BACKEND_URL: 'https://backend.example.invalid' }));
jest.mock('./backendWeatherServiceClientTrace', () => ({}));
const BASE = Date.parse('2026-10-04T00:00:00Z');
let client, select, compile, payload;
beforeEach(() => {
  process.env.REACT_APP_MARINE_VALUE_VALIDITY = 'true';
  jest.resetModules(); jest.useFakeTimers('modern'); jest.setSystemTime(BASE);
  delete window.__RAW_DISABLE_MARINE_VALUE_VALIDITY__;
  delete window.__MARINE_PROJECTION_DIAG__;
  client = require('./backendWeatherServiceClient');
  client.setCachedManifest({products: []});
  select = require('./forecastSamplers').selectExactPointHour;
  compile = require('./forecastCardCompiler').compileForecastCards;
  payload = {valid_time: new Date(BASE).toISOString(), product_id: 'fixture.json',
    point: {speed: 1.5, direction: 0, period: 11, interpolation_method: 'bilinear'},
    surf_height_m: 1.5, surf_regime: 'shelf', surf_nearshore: false};
  global.fetch = jest.fn(async url => ({ok: true, status: 200,
    json: async () => url.includes('/products') ? {products: []} : payload}));
});
afterEach(() => {jest.useRealTimers(); delete global.fetch; delete process.env.REACT_APP_MARINE_VALUE_VALIDITY;});

async function read(layer = 'swell_1', model = 'EURO') {
  const data = model === 'EURO'
    ? await client.fetchBackendExactCopernicusPoint(28, -80, 0, null, layer)
    : await client.fetchBackendExactPoint(28, -80, 0, null, layer, model);
  const selected = select(data, 0);
  const cards = compile({activeModel: model, activeLayer: layer, timeOffsetHours: 0,
    wx: {}, marine: {}, currentWeather: {}, isExactPointAuthority: true,
    isExactPointLoading: false, isExactPointTimeout: false, isExactPointError: false,
    exactPointStatus: selected.status, useExactPoint: selected,
    waveHeight: selected.wave_height, wavePeriod: selected.wave_period, waveDir: selected.wave_direction,
    swell1Height: selected.swell_wave_height, swell1Period: selected.swell_wave_period, swell1Dir: selected.swell_wave_direction,
    swell2Height: selected.secondary_swell_wave_height, swell2Period: selected.secondary_swell_wave_period,
    windWaveHeight: selected.wind_wave_height, windWavePeriod: selected.wind_wave_period,
    swell1Supported: true, swell2Supported: true, windWavesSupported: true,
    degToCompass: () => 'N', getClampedValue: () => null, getBiasAdjustedLocal: v => v});
  return {data, selected, cards};
}

test.each(['waves', 'swell_1', 'swell_2', 'wind_waves'])('%s unavailable is unknown, never measured zero/Trace', async layer => {
  payload.point = {speed: 0, direction: 0, period: 0, interpolation_method: 'unavailable'};
  const {data, cards} = await read(layer);
  const heights = ['wave_height', 'swell_wave_height', 'secondary_swell_wave_height', 'wind_wave_height'];
  for (const key of heights) expect(data.hourly[key][0]).toBeNull();
  expect(cards.some(c => c.value === 'Trace')).toBe(false);
  expect(cards.some(c => c.value === 'No data' || c.value === 'Unavailable')).toBe(true);
});
test.each([null, NaN, Infinity, -1])('invalid height %s cannot become a real calm value', async height => {
  payload.point.speed = height;
  const {data, cards} = await read();
  expect(data.hourly.swell_wave_height[0]).toBeNull();
  expect(cards.some(c => c.value === 'Trace')).toBe(false);
});
test('a measured zero is retained and can show Trace', async () => {
  payload.point.speed = 0;
  const {selected, cards} = await read();
  expect(selected.swell_wave_height).toBe(0);
  expect(cards.some(c => c.value === 'Trace')).toBe(true);
});
test.each(['GFS', 'ICON', 'EURO'])('%s explicit nearshore false survives selection and suppresses Surf', async model => {
  const {selected, cards} = await read('waves', model);
  expect(selected.surf_nearshore).toBe(false);
  expect(cards.some(c => c.label === 'Surf')).toBe(false);
});
test.each([true, null, undefined])('nearshore %s keeps the established positive/null compatibility', async near => {
  payload.surf_nearshore = near;
  const {cards} = await read('waves');
  expect(cards.some(c => c.label === 'Surf')).toBe(true);
});
test.each([11, 13])('mean-only period %s is not presented as Peak', async period => {
  payload.point.period = period;
  const {data, cards} = await read();
  expect(data.hourly.swell_wave_period[0]).toBe(period);
  expect(data.hourly.swell_wave_peak_period[0]).toBeNull();
  expect(cards.some(c => c.label === 'Peak')).toBe(false);
  expect(cards.find(c => c.label === 'Period').value).toBe(`${period.toFixed(1)}s`);
});
test('missing direction and period stay missing; zero direction remains north', async () => {
  payload.point.direction = null; payload.point.period = null;
  const {data} = await read();
  expect(data.hourly.swell_wave_direction[0]).toBeNull();
  expect(data.hourly.swell_wave_period[0]).toBeNull();
});
test('default-off preserves the old EURO mapping', async () => {
  delete process.env.REACT_APP_MARINE_VALUE_VALIDITY;
  payload.point.interpolation_method = 'unavailable'; payload.point.speed = 0;
  const {data} = await read();
  expect(data.hourly.swell_wave_height[0]).toBe(0);
  expect(data.hourly.swell_wave_peak_period[0]).toBe(11);
});
test.each(['GFS', 'ICON', 'EURO'])('%s entirely missing point stays unavailable through the cards', async model => {
  payload.point = null;
  const {data, cards} = await read('waves', model);
  expect(data.hourly.wave_height[0]).toBeNull();
  expect(cards.some(c => c.value === 'Unavailable')).toBe(true);
});
test('explicit invalid point cannot supply a height', async () => {
  payload.point.is_valid = false;
  expect((await read()).data.hourly.swell_wave_height[0]).toBeNull();
});
test('runtime kill preserves the legacy period alias', async () => {
  window.__RAW_DISABLE_MARINE_VALUE_VALIDITY__ = true;
  expect((await read()).data.hourly.swell_wave_peak_period[0]).toBe(11);
});
