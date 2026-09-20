import { Response } from 'node-fetch';

jest.mock('maplibre-gl', () => ({}));
jest.mock('../components/map/WeatherTelemetry', () => ({
  WeatherTelemetry: new Proxy({}, { get: () => () => {} }),
}));

const MODEL = 'ncep_gfswave025';
const MANIFEST_URL = `https://map-tiles.open-meteo.com/data_spatial/${MODEL}/latest.json`;
const TILE_URL = `om://${MANIFEST_URL}?time_step=valid_times_1&variable=wave_height&webgl_fallback=true`;
const bootstrap = () => ({
  variables: ['wave_height'],
  validTimes: ['2026-09-20T06:00:00Z', '2026-09-20T07:00:00Z'],
  referenceTime: '2026-09-20T06:00:00Z',
});
const manifest = () => ({
  completed: true,
  reference_time: '2026-09-20T12:00:00Z',
  valid_times: ['2026-09-20T12:00:00Z', '2026-09-20T13:00:00Z'],
  variables: ['wave_height', 'wind_u_component_10m', 'wind_v_component_10m'],
  crs_wkt: 'provider CRS',
  last_modified_time: '2026-09-20T16:00:00Z',
  provider_extension: { revision: 42 },
});
const response = data => new Response(JSON.stringify(data), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});
const flushPromises = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

let originalFetch;
let originalResponse;
let originalLandmaskFlag;
let originalBroadcastChannel;
let api;
let normalizeUrl;
let registerOpenMeteoProtocol;
let cache;

beforeEach(() => {
  jest.resetModules(); // Also clears the real decoder's private, 60-second manifest cache.
  jest.useFakeTimers();
  originalFetch = global.fetch;
  originalResponse = global.Response;
  originalLandmaskFlag = global.__RAW_WT_LANDMASK_DISABLED__;
  originalBroadcastChannel = global.BroadcastChannel;
  global.Response = Response;
  global.__RAW_WT_LANDMASK_DISABLED__ = true;
  global.BroadcastChannel = class {};
  delete global.__FETCH_INTERCEPTED__;
  delete window.__OM_BROADCAST_CHANNEL__;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  api = require('../components/map/mapUtils');
  ({ registerOpenMeteoProtocol } = require('../components/map/openMeteoProtocol'));
  // Exercise the installed library's actual URL decoder and its private metadata cache.
  // Do not mock this module or reimplement parseMetaJson in the test.
  ({ normalizeUrl } = require('@openmeteo/weather-map-layer'));
  cache = { [MODEL]: bootstrap() };
});

afterEach(() => {
  global.fetch = originalFetch;
  global.Response = originalResponse;
  global.__RAW_WT_LANDMASK_DISABLED__ = originalLandmaskFlag;
  global.BroadcastChannel = originalBroadcastChannel;
  delete global.__FETCH_INTERCEPTED__;
  delete window.__OM_BROADCAST_CHANNEL__;
  delete window.__OM_PROTOCOL_SETTINGS__;
  delete window.__FETCH_OM_TILE__;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const installProtocol = () => new Promise(resolve => registerOpenMeteoProtocol(null, resolve, cache));

test('cold metadata demands share and await the provider request before replacing bootstrap axes', async () => {
  let deliver;
  const transport = jest.fn(() => new Promise(resolve => { deliver = resolve; }));
  global.fetch = transport;
  const changed = jest.fn();
  let settled = false;
  const first = api.fetchModelMetadata(MODEL, cache, changed).then(result => { settled = true; return result; });
  const second = api.fetchModelMetadata(MODEL, cache, changed);
  await flushPromises();
  const settledBeforeProvider = settled;
  deliver(response(manifest()));
  const results = await Promise.all([first, second]);
  // Await pending work even on the old implementation so a baseline failure cannot leak it.
  await api.MODEL_METADATA_PROMISES[MODEL];

  expect(settledBeforeProvider).toBe(false);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(results[0]).toBe(results[1]);
  expect(results[0]).toBe(cache[MODEL]);
  expect(results[0].referenceTime).toBe(manifest().reference_time);
  expect(changed).toHaveBeenCalledTimes(1);
});

test('the actual decoder never caches guessed run/time paths while a cold provider manifest is pending', async () => {
  const deliveries = [];
  global.fetch = jest.fn(() => new Promise(resolve => { deliveries.push(resolve); }));
  await installProtocol();
  const demand = api.fetchModelMetadata(MODEL, cache);
  let decoded = false;
  const firstTile = normalizeUrl(TILE_URL).then(url => { decoded = true; return url; });
  await flushPromises();
  const decodedBeforeProvider = decoded;
  deliveries.forEach(deliver => deliver(response(manifest())));
  const [, firstUrl] = await Promise.all([demand, firstTile]);
  await api.MODEL_METADATA_PROMISES[MODEL];
  const cachedUrl = await normalizeUrl(TILE_URL);

  expect(decodedBeforeProvider).toBe(false);
  expect(firstUrl).toContain('/2026/09/20/1200Z/2026-09-20T1300.om');
  expect(cachedUrl).toBe(firstUrl);
  expect(cachedUrl).toContain('webgl_fallback=true');
  expect(cache[MODEL].referenceTime).toBe(manifest().reference_time);
});

test('a verified warm manifest reaches the decoder verbatim without fetching or adding UI aliases', async () => {
  const provider = manifest();
  const transport = jest.fn(async () => response(provider));
  global.fetch = transport;
  await api.fetchModelMetadata(MODEL, cache);
  await api.MODEL_METADATA_PROMISES[MODEL];
  const before = transport.mock.calls.length;
  await installProtocol();
  const decoderManifest = await global.fetch(MANIFEST_URL).then(res => res.json());
  const decoded = await normalizeUrl(TILE_URL);

  expect(cache[MODEL].variables).toContain('wind_speed_10m');
  expect(decoderManifest).toEqual(provider);
  expect(decoderManifest.variables).not.toContain('wind_speed_10m');
  expect(decoded).toContain('/2026/09/20/1200Z/2026-09-20T1300.om');
  expect(transport).toHaveBeenCalledTimes(before);
});

test.each([
  ['unfinished run', { completed: false }],
  ['missing completion proof', { completed: undefined }],
  ['invalid reference time', { reference_time: 'not-a-date' }],
  ['empty time axis', { valid_times: [] }],
  ['invalid valid time', { valid_times: ['not-a-date'] }],
  ['missing variables', { variables: undefined }],
])('rejects %s without promoting bootstrap metadata or suppressing a later retry', async (_, overrides) => {
  const seeded = cache[MODEL];
  const changed = jest.fn();
  const transport = jest.fn()
    .mockResolvedValueOnce(response({ ...manifest(), ...overrides }))
    .mockResolvedValueOnce(response(manifest()));
  global.fetch = transport;
  await api.fetchModelMetadata(MODEL, cache, changed);
  await api.MODEL_METADATA_PROMISES[MODEL];
  const rejected = !api.LIVE_FETCHED_MODELS.has(MODEL);
  const preserved = cache[MODEL] === seeded;
  const changedOnInvalid = changed.mock.calls.length;
  await api.fetchModelMetadata(MODEL, cache, changed);
  await api.MODEL_METADATA_PROMISES[MODEL];

  expect(rejected).toBe(true);
  expect(preserved).toBe(true);
  expect(changedOnInvalid).toBe(0);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(api.LIVE_FETCHED_MODELS.has(MODEL)).toBe(true);
  expect(cache[MODEL].referenceTime).toBe(manifest().reference_time);
});

test('failed metadata transport cannot become fabricated success in the actual decoder', async () => {
  global.fetch = jest.fn(async () => { throw new Error('provider unavailable'); });
  await api.fetchModelMetadata(MODEL, cache);
  await api.MODEL_METADATA_PROMISES[MODEL];
  await installProtocol();

  expect(api.LIVE_FETCHED_MODELS.has(MODEL)).toBe(false);
  expect(cache[MODEL]).toEqual(bootstrap());
  await expect(normalizeUrl(TILE_URL)).rejects.toThrow('provider unavailable');
});

test('healthy live metadata remains a deduplicated warm-cache hit', async () => {
  const transport = jest.fn(async () => response(manifest()));
  global.fetch = transport;
  const changed = jest.fn();
  await api.fetchModelMetadata(MODEL, cache, changed);
  await api.MODEL_METADATA_PROMISES[MODEL];
  const current = cache[MODEL];

  expect(await api.fetchModelMetadata(MODEL, cache, changed)).toBe(current);
  expect(api.LIVE_FETCHED_MODELS.has(MODEL)).toBe(true);
  expect(current.validTimes).toEqual(manifest().valid_times);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(1);
});
