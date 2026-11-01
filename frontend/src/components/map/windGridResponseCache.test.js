/**
 * The same wind /grid ask is answered once (2026-10-24, the wind pan diet; the worldwide matrix's cell 7: Norway z5 re-asked one
 * close-zoom box and hour 3x, ~5 s apart, after each zoom / pan re-entry of the hour-0 fetch). backendWindServiceClient keeps a
 * completed, non-stale answer 2 min under its full URL.
 */
jest.mock('./backendWeatherServiceClient', () => ({
  GRID_URL: 'https://backend.test/api/weather/grid',
  POINT_URL: 'https://backend.test/api/weather/point',
  getSharedValidTime: jest.fn((h) => new Date(Date.parse('2026-10-24T00:00:00Z') + Math.round(h / 3) * 3 * 3600000).toISOString()),
  clampViewportBbox: jest.fn((b) => ({ isInside: true, clampedBbox: { west: 0, south: 67, east: 20, north: 73 }, coverageBounds: b })),
  getBackendWindFlag: jest.fn(() => true),
  latestTimeDiag: {},
  updateProjectionDiag: jest.fn(),
  PILOT_COVERAGE: { west: -180, south: -80, east: 180, north: 85 },
  fetchProductsManifest: jest.fn(async () => null),
}));
jest.mock('./windStaticFrames', () => ({
  tryStaticWindGrid: jest.fn(async () => null), staticWindGridSync: jest.fn(() => null),
  windBoxKind: jest.fn(() => null), windStaticEnabled: jest.fn(() => false),
}));
jest.mock('./weatherTruthTracker', () => ({ recordTruthStage: jest.fn() }));

const { fetchBackendWindGrid, _resetWindGridResponseCacheForTest } = require('./backendWindServiceClient');
const svc = require('./backendWeatherServiceClient');
const wsf = require('./windStaticFrames');

const BOX = { west: 0, south: 67, east: 20, north: 73 };
const body = (stale = false) => ({ model: 'GFS', stale, valid_time: '2026-10-24T03:00:00Z', product_id: 'p',
  grid: { cols: 2, rows: 1, bounds: BOX, vectors: [{ lat: 70, lng: 5, u: 3, v: 4, speed: 5, direction: 10, is_valid: true },
    { lat: 70, lng: 15, u: 1, v: 1, speed: 2, direction: 20, is_valid: true }] } });

beforeEach(() => {
  // CRA resets mock implementations before each test: arm them here
  svc.getSharedValidTime.mockImplementation((h) => new Date(Date.parse('2026-10-24T00:00:00Z') + Math.round(h / 3) * 3 * 3600000).toISOString());
  svc.clampViewportBbox.mockImplementation((b) => ({ isInside: true, clampedBbox: { west: 0, south: 67, east: 20, north: 73 }, coverageBounds: b }));
  svc.getBackendWindFlag.mockReturnValue(true);
  svc.fetchProductsManifest.mockImplementation(async () => null);
  wsf.tryStaticWindGrid.mockImplementation(async () => null);
  wsf.windBoxKind.mockReturnValue(null);
  wsf.windStaticEnabled.mockReturnValue(false);
  _resetWindGridResponseCacheForTest();
  delete window.__RAW_DISABLE_WIND_GRID_RESPONSE_CACHE__;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body() }));
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('the same ask is fetched once; an hour that shares the frame gets the frame under its own hour', async () => {
  const a = await fetchBackendWindGrid(BOX, 2, undefined, null, 'controller', 'GFS');
  const b = await fetchBackendWindGrid(BOX, 3, undefined, null, 'controller', 'GFS');   // 2 and 3 snap to the same 03Z
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(a.hourOffset).toBe(2);
  expect(b.hourOffset).toBe(3);                                         // never another hour's label
  expect(b.vectors).toBe(a.vectors);
  expect(window.__RAW_WIND_GRID_CACHE__.hits).toBe(1);
});

test('a stale answer is never kept, another hour is another ask, and the kill asks every time', async () => {
  global.fetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => body(true) }));
  await fetchBackendWindGrid(BOX, 3, undefined, null, 'controller', 'GFS');
  await fetchBackendWindGrid(BOX, 3, undefined, null, 'controller', 'GFS');
  expect(global.fetch).toHaveBeenCalledTimes(2);                        // the SWR re-ask owns a stale answer
  global.fetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => body(false) }));
  await fetchBackendWindGrid(BOX, 6, undefined, null, 'controller', 'GFS');
  expect(global.fetch).toHaveBeenCalledTimes(3);                        // 06Z: a new URL
  window.__RAW_DISABLE_WIND_GRID_RESPONSE_CACHE__ = true;
  await fetchBackendWindGrid(BOX, 6, undefined, null, 'controller', 'GFS');
  expect(global.fetch).toHaveBeenCalledTimes(4);
});

test('an answer older than 2 minutes is asked again', async () => {
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValue(1000000);
  await fetchBackendWindGrid(BOX, 3, undefined, null, 'controller', 'GFS');
  now.mockReturnValue(1000000 + 121000);
  await fetchBackendWindGrid(BOX, 3, undefined, null, 'controller', 'GFS');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
