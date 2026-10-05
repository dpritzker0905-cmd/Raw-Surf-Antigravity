const mockDecode = jest.fn();
jest.mock('@openmeteo/weather-map-layer', () => ({
  omProtocol: (...args) => mockDecode(...args), defaultOmProtocolSettings: { colorScales: {} },
  GridFactory: {}, clearBlockCache: () => Promise.resolve(),
}));
jest.mock('./WeatherTelemetry', () => ({ WeatherTelemetry: new Proxy({}, { get: () => jest.fn() }) }));
import { registerOpenMeteoProtocol, clearOpenMeteoCache } from './openMeteoProtocol';
const params = (variable = 'temperature_2m', extra = '') => ({ type: 'arrayBuffer', url: `om://https://offline.invalid/v1/ncep_gfs025/latest.json/0/0/0.om?variable=${variable}${extra}` });
const bytes = () => ({ data: new Uint8Array([0, 23, 61]).buffer });
let callback;
beforeEach(async () => {
  process.env.REACT_APP_RASTER_WORK_BOUNDS = 'true';
  mockDecode.mockReset(); mockDecode.mockResolvedValue(bytes());
  global.BroadcastChannel = class { close() {} };
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await clearOpenMeteoCache();
  await new Promise(resolve => registerOpenMeteoProtocol({ addProtocol: (_, cb) => { callback = cb; } }, resolve, new Map()));
});
afterEach(() => { delete process.env.REACT_APP_RASTER_WORK_BOUNDS; jest.restoreAllMocks(); });

test('actual registered raster callback decodes duplicate concurrent tiles once', async () => {
  let release; mockDecode.mockImplementation(() => new Promise(r => { release = r; }));
  const a = callback(params(), new AbortController()), b = callback(params(), new AbortController());
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(mockDecode).toHaveBeenCalledTimes(1); release(bytes());
  const [one, two] = await Promise.all([a, b]);
  expect(one.data).not.toBe(two.data); expect(new Uint8Array(one.data)).toEqual(new Uint8Array([0, 23, 61]));
  const cached = await callback(params(), new AbortController());
  expect(mockDecode).toHaveBeenCalledTimes(1); expect(cached.data).not.toBe(one.data);
});
test('actual callback retains marine per-request decoder callbacks', async () => {
  await Promise.all([callback(params('wave_height'), new AbortController()), callback(params('wave_height'), new AbortController())]);
  expect(mockDecode).toHaveBeenCalledTimes(2);
});
test('a canceled duplicate does not abort its surviving raster decode', async () => {
  let release; mockDecode.mockImplementation(() => new Promise(r => { release = r; }));
  const c = new AbortController();
  const a = callback(params(), c).catch(e => e.name), b = callback(params(), new AbortController());
  for (let i = 0; i < 8; i++) await Promise.resolve();
  c.abort(); expect(mockDecode.mock.calls[0][1].signal.aborted).toBe(false);
  release(bytes()); expect(await a).toBe('AbortError'); expect((await b).data.byteLength).toBe(3);
});
test('actual hot tile survives 150-entry pressure', async () => {
  const hot = params('temperature_2m', '&tile=hot'); await callback(hot, new AbortController());
  for (let i = 0; i < 149; i++) await callback(params('temperature_2m', `&tile=${i}`), new AbortController());
  await callback(hot, new AbortController()); await callback(params('temperature_2m', '&tile=new'), new AbortController());
  const count = mockDecode.mock.calls.length; await callback(hot, new AbortController()); expect(mockDecode).toHaveBeenCalledTimes(count);
});
test('default-off callback retains independent duplicate decodes', async () => {
  delete process.env.REACT_APP_RASTER_WORK_BOUNDS;
  await Promise.all([callback(params(), new AbortController()), callback(params(), new AbortController())]);
  expect(mockDecode).toHaveBeenCalledTimes(2);
});
