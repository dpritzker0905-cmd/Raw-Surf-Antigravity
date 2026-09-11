import { Request, Response, Headers } from 'node-fetch';
import { registerOpenMeteoProtocol } from '../components/map/openMeteoProtocol';
import { fetchModelMetadata, LIVE_FETCHED_MODELS, MODEL_METADATA_PROMISES } from '../components/map/mapUtils';

jest.mock('maplibre-gl', () => ({}));
jest.mock('@openmeteo/weather-map-layer', () => ({ defaultOmProtocolSettings: { colorScales: {} } }));
jest.mock('../components/map/WeatherTelemetry', () => ({ WeatherTelemetry: new Proxy({}, { get: () => () => {} }) }));

const legacy = 'https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/';
const publicRoot = 'https://openmeteo.s3.amazonaws.com/data_spatial/ncep_gfs025/';
const tile = '2026/09/11/1200Z/2026-09-11T1200.om';
const manifest = { completed: true, reference_time: '2026-09-11T12:00:00Z', valid_times: ['2026-09-11T12:00:00Z'], variables: ['pressure_msl'] };
const originalFetch = global.fetch;
let transport;

beforeAll(() => { Object.assign(global, { Request, Response, Headers }); });
beforeEach(async () => {
  delete global.__FETCH_INTERCEPTED__;
  LIVE_FETCHED_MODELS.clear();
  transport = jest.fn(async () => new Response(JSON.stringify(manifest), { status: 200 }));
  global.fetch = transport;
  await new Promise(resolve => registerOpenMeteoProtocol(null, resolve, {}));
  transport.mockClear();
});
afterEach(() => { global.fetch = originalFetch; delete global.__FETCH_INTERCEPTED__; });

test.each([
  ['manifest', legacy + 'latest.json?skip_intercept=true', publicRoot + 'latest.json?skip_intercept=true'],
  ['tile', legacy + tile, publicRoot + tile],
  ['URL object', new URL(legacy + tile), publicRoot + tile],
])('%s reaches the public transport while its logical path and query are retained', async (_, input, expected) => {
  await fetch(input);
  expect(String(transport.mock.calls[0][0])).toBe(expected);
});

test('range reads preserve cancellation, headers and options, with the existing no-store policy', async () => {
  const controller = new AbortController();
  const init = { signal: controller.signal, headers: { Range: 'bytes=0-127' }, credentials: 'omit', mode: 'cors' };
  await fetch(legacy + tile, init);
  const [input, options] = transport.mock.calls[0];
  expect(input).toBe(publicRoot + tile);
  expect(options).toEqual({ ...init, cache: 'no-store' });
  expect(options.signal).toBe(controller.signal);
  expect(init).not.toHaveProperty('cache');
});

test('Request input retains method, range header and signal; init overrides still reach fetch', async () => {
  const controller = new AbortController();
  const input = new Request(legacy + tile, { method: 'HEAD', headers: { Range: 'bytes=-64' }, signal: controller.signal });
  await fetch(input, { credentials: 'omit' });
  const [actual, options] = transport.mock.calls[0];
  expect(actual).toBeInstanceOf(Request);
  expect(actual.url).toBe(publicRoot + tile);
  expect(actual.method).toBe('HEAD');
  expect(actual.headers.get('range')).toBe('bytes=-64');
  controller.abort();
  expect(actual.signal.aborted).toBe(true);
  expect(input.url).toBe(legacy + tile);
  expect(options).toEqual({ credentials: 'omit', cache: 'no-store' });
});

test.each([
  'https://api.open-meteo.com/v1/forecast?latitude=26',
  'https://map-tiles.open-meteo.com.evil.invalid/data_spatial/ncep_gfs025/latest.json',
  'https://elsewhere.invalid/?url=https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/latest.json',
  'https://map-tiles.open-meteo.com/unrelated/latest.json',
  'https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/unrelated.txt',
  'https://openmeteo.s3.amazonaws.com/data_spatial/ncep_gfs025/latest.json',
  'om://transparent-tile',
  'om://' + legacy + 'latest.json?time_step=valid_times_0&variable=pressure_msl',
  '/api/weather/tiles',
])('does not rewrite unrelated or virtual identity: %s', async input => {
  await fetch(input);
  expect(transport.mock.calls[0][0]).toBe(input);
});

test('a missing tile is sent once to the new transport, then blocked by its original cache identity', async () => {
  const missing = legacy + '2026/09/10/0000Z/2026-09-10T0100.om';
  transport.mockResolvedValueOnce(new Response('missing', { status: 404 }));
  expect((await fetch(missing)).status).toBe(404);
  expect((await fetch(missing)).status).toBe(404);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe(missing.replace(legacy, publicRoot));
  await fetch(legacy + tile);
  expect(transport).toHaveBeenCalledTimes(2);
});

test('failed transport remains a rejection and is not cached as a missing tile', async () => {
  transport.mockRejectedValueOnce(new TypeError('controlled network failure'));
  await expect(fetch(legacy + tile)).rejects.toThrow('controlled network failure');
  await fetch(legacy + tile);
  expect(transport).toHaveBeenCalledTimes(2);
});

test('metadata demand works even before protocol registration, preserves deduplication and live provenance', async () => {
  global.fetch = transport;
  delete global.__FETCH_INTERCEPTED__;
  const cache = {};
  const changed = jest.fn();
  await Promise.all([fetchModelMetadata('ncep_gfs025', cache, changed), fetchModelMetadata('ncep_gfs025', cache, changed)]);
  await MODEL_METADATA_PROMISES.ncep_gfs025;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe(publicRoot + 'latest.json?skip_intercept=true');
  expect(cache.ncep_gfs025).toEqual({ variables: ['pressure_msl'], validTimes: manifest.valid_times, referenceTime: manifest.reference_time, sourceMetadata: manifest });
  expect(LIVE_FETCHED_MODELS.has('ncep_gfs025')).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
});

test('cold metadata demand stays pending until the real cycle replaces bootstrap axes', async () => {
  let deliver;
  transport.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
  const cache = { ncep_gfs025: { variables: ['pressure_msl'], validTimes: ['2026-09-01T00:00:00Z'], referenceTime: '2026-09-01T00:00:00Z' } };
  let settled = false;
  const demand = fetchModelMetadata('ncep_gfs025', cache).then(value => { settled = true; return value; });
  await Promise.resolve();
  const premature = settled;
  deliver(new Response(JSON.stringify(manifest)));
  const value = await demand;
  await MODEL_METADATA_PROMISES.ncep_gfs025;
  expect(premature).toBe(false);
  expect(value.referenceTime).toBe(manifest.reference_time);
});

test('the decoder cannot receive bootstrap axes disguised as a completed live manifest', async () => {
  delete global.__FETCH_INTERCEPTED__;
  global.fetch = transport;
  const cache = { ncep_gfs025: { variables: ['pressure_msl'], validTimes: ['2026-09-01T00:00:00Z'], referenceTime: '2026-09-01T00:00:00Z' } };
  await new Promise(resolve => registerOpenMeteoProtocol(null, resolve, cache));
  const response = await fetch(legacy + 'latest.json');
  expect(await response.json()).toEqual(manifest);
  expect(transport).toHaveBeenCalledTimes(1);
});

test('a validated warm manifest is served verbatim without another network demand', async () => {
  const cache = {};
  await fetchModelMetadata('ncep_gfs025', cache);
  delete global.__FETCH_INTERCEPTED__;
  global.fetch = transport;
  await new Promise(resolve => registerOpenMeteoProtocol(null, resolve, cache));
  transport.mockClear();
  expect(await (await fetch(legacy + 'latest.json')).json()).toEqual(manifest);
  expect(transport).not.toHaveBeenCalled();
});

test('warm metadata interception never captures a lookalike hostname', async () => {
  const cache = {};
  await fetchModelMetadata('ncep_gfs025', cache);
  delete global.__FETCH_INTERCEPTED__;
  global.fetch = transport;
  await new Promise(resolve => registerOpenMeteoProtocol(null, resolve, cache));
  transport.mockClear();
  const input = 'https://map-tiles.open-meteo.com.evil.invalid/data_spatial/ncep_gfs025/latest.json';
  await fetch(input);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe(input);
});

test.each([
  { ...manifest, reference_time: null },
  { ...manifest, valid_times: [] },
  { ...manifest, valid_times: ['not-a-date'] },
  { ...manifest, variables: [] },
  { ...manifest, completed: false },
])('invalid or incomplete metadata never becomes live provenance: %j', async invalid => {
  transport.mockResolvedValueOnce(new Response(JSON.stringify(invalid)));
  const cache = {};
  await fetchModelMetadata('ncep_gfs025', cache);
  await MODEL_METADATA_PROMISES.ncep_gfs025;
  expect(LIVE_FETCHED_MODELS.has('ncep_gfs025')).toBe(false);
  expect(cache).not.toHaveProperty('ncep_gfs025');
});
