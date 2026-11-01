/**
 * Series pages from static CROPS (2026-10-22). A series page over 15 deg asks the WORLD box (marineBboxGeometry
 * .normalizeRequestBbox), so only a 12-15 deg page is a viewport clip the resolver cuts from global_mid. Such a page is filled
 * from crops of the static frame under a key carrying its clip (staticFrames.staticCropPageKey), so it can never stand in for,
 * or be replaced by, another page; the world view keeps the world frame; neither asks the backend. One REAL GFS world frame
 * (marineFramePack's fixture) stands for the run.
 */
import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';

jest.mock('../../lib/apiClient', () => ({ API_BASE: 'https://api.test/api' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));
jest.mock('./seriesAnchor', () => ({
  ...jest.requireActual('./seriesAnchor'),
  seriesAnchorTag: () => '@2026-10-20T00:00:00.000Z', seriesAnchorParam: () => '', seriesGridPhase: () => 0,
}));
import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';
import { _resetStaticFramesForTest, getPinnedIndex } from './staticFrames';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

const BASE = 'https://cdn.test/weather-frames/';
const RAW = zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64'));
const INDEX = { version: 1, encoding_version: 1, transform_version: 1, path: 'v1/idx/real.json', run: 'r',
  grid: { cols: 181, rows: 83, bounds: { west: -180, south: -80, east: 180, north: 84 } },
  common_meta: { model: 'GFS', provider: 'open-meteo', domain: 'marine', layer: 'waves', is_estimated: false },
  frames: [{ valid_time: '2026-10-20T00:00:00Z', is_estimated: false, path: 'v1/f/0.bin', meta: { product_id: 'gfs_marine_waves_global_mid_20261020T000000Z.json' } }] };
const MANIFEST = { products: [
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'global_mid', coverage: { west: -180, south: -80, east: 180, north: 85 } },
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: { west: -85, south: 24, east: -79, north: 31 } },
] };
const VIEW = { west: -94, south: 20, east: -80, north: 28 };               // a 14 x 8 deg view: the 14 x 11 clip (pad 7)
const WORLD = { west: -170, south: -60, east: 170, north: 75 };            // a world view (the request box is the whole world)
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let calls; let killBefore; const realFetch = global.fetch;
beforeEach(() => {
  killBefore = window.__RAW_DISABLE_STATIC_FRAMES__;               // setupTests turns static frames off for every other suite
  delete window.__RAW_DISABLE_STATIC_FRAMES__;
  window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
  window.__RAW_STATIC_FRAMES_BASE__ = BASE;
  _resetStaticFramesForTest(); _resetMarineSeriesForTest();
  setCachedManifest(MANIFEST);
  calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { 'GFS/marine/waves/global_mid': { index: INDEX.path, run: 'r' } } });
    if (url === BASE + INDEX.path) return ok(INDEX);
    if (url.endsWith('.bin')) return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(RAW).buffer };
    return { ok: false, status: 500, json: async () => ({}) };      // the backend: never asked
  });
});
afterEach(() => {
  window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
  delete window.__RAW_STATIC_FRAMES_BASE__; delete window.__RAW_DISABLE_STATIC_MID_CROP__;
  if (killBefore === undefined) delete window.__RAW_DISABLE_STATIC_FRAMES__; else window.__RAW_DISABLE_STATIC_FRAMES__ = killBefore;
  setCachedManifest(null);
  global.fetch = realFetch;
});

test('the viewport page fills with the clip, the world page with the world frame, under different keys, from the CDN only', async () => {
  // Once an index is pinned (at the very first open the hour-0 mini still asks the backend once, as it does for world pages).
  await getPinnedIndex('GFS/marine/waves/global_mid');
  await ensureMarineSeries('GFS', 'waves', VIEW, 0, undefined, true);
  await flush();
  const clip = getMarineSeriesFrame('GFS', 'waves', VIEW, 0);
  expect(clip).not.toBeNull();
  expect([clip.grid.cols, clip.grid.rows]).toEqual([14, 11]);
  expect(clip.grid.bounds).toMatchObject({ west: -100, south: 14, east: -74, north: 34 });
  expect(getMarineSeriesFrame('GFS', 'waves', VIEW, 3).grid.cols).toBe(14);       // 03Z asks the same stored frame (nearest)

  await ensureMarineSeries('GFS', 'waves', WORLD, 0, undefined, true);
  await flush();
  expect(getMarineSeriesFrame('GFS', 'waves', WORLD, 0).grid.cols).toBe(181);
  expect(getMarineSeriesFrame('GFS', 'waves', VIEW, 0).grid.cols).toBe(14);         // the world page did not replace the clip
  expect(calls.some((u) => u.startsWith('https://api.test'))).toBe(false);
  expect(window.__RAW_STATIC_FRAMES__.crops).toBeGreaterThanOrEqual(2);
});

test('kill switch: the viewport page goes to /grid_series as before (and the world page is still static)', async () => {
  window.__RAW_DISABLE_STATIC_MID_CROP__ = true;
  await ensureMarineSeries('GFS', 'waves', VIEW, 0, undefined, true);
  await flush();
  expect(calls.some((u) => u.startsWith('https://api.test/api/weather/grid_series'))).toBe(true);
  expect(window.__RAW_STATIC_FRAMES__ ? (window.__RAW_STATIC_FRAMES__.crops || 0) : 0).toBe(0);
});
