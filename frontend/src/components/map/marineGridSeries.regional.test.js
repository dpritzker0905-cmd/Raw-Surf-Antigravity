/**
 * Series pages from a REGIONAL bundle, through the real loader (2026-10-23, the z7-9 bundle client; the lead's review of #491).
 * One REAL GFS world frame (marineFramePack's fixture) in a bundle stands for the run of a florida_east_coast set. Each test fails
 * when its guard is removed:
 *   - the hour-0 mini (the first-paint lane) is never held for the products manifest; the page is, bounded, then served;
 *   - a box whose snapped box leaves the tile's data (a fractional data edge) is not claimed: its page asks /grid_series;
 *   - a failing bundle costs one request per backoff, is not claimed, and never forces a latest.json re-read;
 *   - static pages are bounded like /grid_series pages (SERIES_MAX);
 *   - a page holds frames of one run.
 */
import crypto from 'crypto';
import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';

jest.mock('../../lib/apiClient', () => ({ API_BASE: 'https://api.test/api' }));
jest.mock('./backendWeatherServiceClient', () => ({
  getSurfModeFlag: () => global.__surf === true, fetchProductsManifest: (...a) => global.__manifestFetch(...a),
}));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));
jest.mock('./seriesAnchor', () => ({
  ...jest.requireActual('./seriesAnchor'),
  seriesAnchorTag: () => '@2026-10-20T00:00:00.000Z', seriesAnchorParam: () => '', seriesGridPhase: () => 0,
}));
import { ensureMarineSeries, getMarineSeriesFrame, _marineSeriesCacheState, _resetMarineSeriesForTest } from './marineGridSeries';
import { _resetStaticFramesForTest, getPinnedIndex } from './staticFrames';
import { _setRegionalCodecForTest } from './staticRegional';
import { runStaticPageFlight } from './marineSeriesStatic';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

const BASE = 'https://cdn.test/weather-frames/';
const VT = '2026-10-20T00:00:00Z';
const GZ = Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64');
const sha12 = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex').slice(0, 12);
const FL = { west: -85, south: 24, east: -79, north: 31 };
const KEY = 'GFS/marine/waves/florida_east_coast';
const MANIFEST = { products: [
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'global_mid', coverage: { west: -180, south: -80, east: 180, north: 85 } },
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: FL },
] };
const index = (grid) => ({
  version: 1, encoding_version: 1, transform_version: 1, path: 'v1/gfs/marine/waves/florida_east_coast/index/r.json', run: 'r',
  grid, common_meta: { model: 'GFS', provider: 'noaa', domain: 'marine', layer: 'waves', is_estimated: false, region_id: 'florida_east_coast' },
  bundle: { path: 'v1/gfs/marine/waves/florida_east_coast/r/bundle-x.bin', bytes: GZ.length, sha12: sha12(GZ) },
  frames: [{ valid_time: VT, is_estimated: false, meta: { product_id: 'gfs_marine_waves_florida_east_coast_20261020T000000Z.json' },
    source: 's', offset: 0, length: GZ.length, sha12: sha12(GZ) }],
});
// The real frame's own lattice (2 deg, world): every box inside the tile is covered.
const WORLD_LATTICE = { cols: 181, rows: 83, bounds: { west: -180, south: -80, east: 180, north: 84 } };
// A 0.25-deg Florida lattice whose last node is -79.75 (a fractional data edge, as us_southeast_midatlantic's -74.5).
const EDGE_LATTICE = { cols: 22, rows: 29, bounds: { west: -85, south: 24, east: -79.75, north: 31 } };
// Series boxes (the view padded 0.5 deg) on EVEN degrees: the fixture is a 2-deg lattice, and an odd edge would leave the served
// window short of the request (not covered, exactly as the server would clip it).
const VIEW = { west: -83.5, south: 26.5, east: -80.5, north: 27.5 };     // series box -84,26,-80,28
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };

let calls; let killBefore; const realFetch = global.fetch;
function cdn({ idx = index(WORLD_LATTICE), bin = null } = {}) {
  calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [KEY]: { index: idx.path, bundle: idx.bundle, run: 'r' } } });
    if (url === BASE + idx.path) return ok(idx);
    if (url.endsWith('.bin')) {
      if (typeof bin === 'number') return { ok: false, status: bin, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(GZ).buffer };
    }
    return { ok: false, status: 500, json: async () => ({}) };      // the backend
  });
}
const backend = () => calls.filter((u) => u.startsWith('https://api.test'));
const seriesAsks = () => backend().filter((u) => u.includes('/grid_series'));
const pageAsks = () => seriesAsks().filter((u) => /[?&]hours=[^&]*,/.test(u));         // a multi-hour page (not the hour-0 mini)
const miniAsks = () => seriesAsks().filter((u) => !/[?&]hours=[^&]*,/.test(u));

beforeEach(() => {
  killBefore = window.__RAW_DISABLE_STATIC_FRAMES__;
  delete window.__RAW_DISABLE_STATIC_FRAMES__;
  window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
  window.__RAW_STATIC_FRAMES_BASE__ = BASE;
  window.__RAW_ENABLE_REGIONAL_BUNDLES__ = true;              // dark by default since 2026-10-23 evening: this suite opts in
  // The mock backend answers 500, so every page here that falls to /grid_series schedules the page-failure retry (scheduleFailRetry): a REAL timer of
  // >= 1200 ms that fires inside the test under any 1.2 s event-loop stall (a loaded full-tree run) and adds an ask nobody expects. Retries are not
  // under test anywhere in this file; the app's own kill takes them out for the whole file (2026-10-26: 'a failing bundle' counted 3 page asks, not 2).
  window.__RAW_SERIES_RETRY_DISABLED__ = true;
  _resetStaticFramesForTest(); _resetMarineSeriesForTest();
  _setRegionalCodecForTest({ sha12: async (b) => sha12(b), gunzip: async (b) => Uint8Array.from(zlib.gunzipSync(Buffer.from(b))).buffer });
  setCachedManifest(MANIFEST);
  global.__manifestFetch = jest.fn(async () => MANIFEST);
  cdn();
});
afterEach(() => {
  window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
  delete window.__RAW_STATIC_FRAMES_BASE__; delete window.__RAW_ENABLE_REGIONAL_BUNDLES__;
  if (killBefore === undefined) delete window.__RAW_DISABLE_STATIC_FRAMES__; else window.__RAW_DISABLE_STATIC_FRAMES__ = killBefore;
  _setRegionalCodecForTest();
  setCachedManifest(null);
  global.fetch = realFetch;
  delete global.__manifestFetch;
  delete global.__surf;
  delete window.__RAW_SERIES_RETRY_DISABLED__;
  _resetMarineSeriesForTest();      // deferred retries / prefetches of this test must not fire inside the next one
});

test('an ALL-MISS page (every hour outside the run) is the backend\'s: it asks /grid_series instead of claiming nothing', async () => {
  await getPinnedIndex(KEY);
  await ensureMarineSeries('GFS', 'waves', VIEW, 200, undefined, true);   // page 1: the run's one frame is at hour 0
  await flush();
  expect(pageAsks()).toHaveLength(1);
  expect(window.__RAW_STATIC_REGIONAL__.series).toBe(0);
});

test('surf mode and models without bundles (ICON, EURO) never read a bundle or wait: their existing path', async () => {
  global.__surf = true;
  await getPinnedIndex(KEY);
  setCachedManifest(null);
  global.__manifestFetch = jest.fn(() => new Promise(() => {}));
  await ensureMarineSeries('GFS', 'waves', VIEW, 0, undefined, true);    // surf: rating grids are a server transform
  await flush();
  expect(pageAsks().filter((u) => u.includes('surf=1'))).toHaveLength(1);
  delete global.__surf;
  for (const model of ['ICON', 'EURO']) await ensureMarineSeries(model, 'waves', VIEW, 0, undefined, true);
  await flush();
  expect(pageAsks().filter((u) => /model=(ICON|EURO)/.test(u))).toHaveLength(2);
  expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(0);
  expect(global.__manifestFetch).not.toHaveBeenCalled();
});

test('the opening: the hour-0 mini goes at once; the page waits for the manifest, then is served from the bundle (no page ask)', async () => {
  setCachedManifest(null);
  let land;
  global.__manifestFetch = jest.fn(() => new Promise((resolve) => { land = () => { setCachedManifest(MANIFEST); resolve(MANIFEST); }; }));
  const done = ensureMarineSeries('GFS', 'waves', VIEW, 0, undefined, true);
  await flush();
  expect(miniAsks()).toHaveLength(1);                     // the first-paint lane did not wait
  expect(pageAsks()).toHaveLength(0);                     // the page is waiting for the tile list
  land();
  await done; await flush();
  expect(pageAsks()).toHaveLength(0);
  const f = getMarineSeriesFrame('GFS', 'waves', VIEW, 0);
  expect(f).not.toBeNull();
  expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(1);
});

test('a late manifest (the live read: ~4 s): once latest.json is read the page is served from the bundle, no wait', async () => {
  setCachedManifest(null);
  global.__manifestFetch = jest.fn(() => new Promise(() => {}));        // the manifest never lands in this test
  await getPinnedIndex(KEY);                                              // the boot warm-up has read latest.json
  await ensureMarineSeries('GFS', 'waves', VIEW, 0, undefined, true);
  await flush();
  expect(pageAsks()).toHaveLength(0);
  expect(getMarineSeriesFrame('GFS', 'waves', VIEW, 0)).not.toBeNull();
});

test('a box whose snapped box leaves the tile data (fractional data edge) is not claimed: its page and mini ask the backend', async () => {
  cdn({ idx: index(EDGE_LATTICE) });
  await getPinnedIndex(KEY);
  const NEAR = { west: -81, south: 26.5, east: -80.3, north: 28 };       // series box east -79.8: inside the data, snaps to -79
  await ensureMarineSeries('GFS', 'waves', NEAR, 0, undefined, true);
  await flush();
  expect(pageAsks()).toHaveLength(1);
  expect(miniAsks()).toHaveLength(1);
  expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(0);       // nothing was read from the bundle
});

test('a failing bundle: one request, the page goes to /grid_series, the next page backs off, latest.json is read once', async () => {
  cdn({ bin: 429 });
  await getPinnedIndex(KEY);
  await ensureMarineSeries('GFS', 'waves', VIEW, 0, undefined, true);
  await flush();
  await ensureMarineSeries('GFS', 'waves', { west: -83.5, south: 24.5, east: -80.5, north: 25.5 }, 0, undefined, true);
  await flush();
  expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(1);
  expect(pageAsks()).toHaveLength(2);
  expect(calls.filter((u) => u.endsWith('latest.json'))).toHaveLength(1);
});

test('static pages are bounded like /grid_series pages (SERIES_MAX, 48)', async () => {
  await getPinnedIndex(KEY);
  // 60 distinct pages (keys snap to 0.5 deg) whose series boxes the 2-deg lattice covers: floor(west) and ceil(east) even (and
  // the same for latitude), inside the tile.
  const even = (v) => ((v % 2) + 2) % 2 === 0;
  const steps = (lo, hi) => Array.from({ length: Math.round((hi - lo) / 0.5) + 1 }, (_, i) => lo + 0.5 * i);
  const boxes = [];
  for (const w of steps(-85, -81).filter((v) => even(Math.floor(v)))) {
    for (const e of steps(-83, -79).filter((v) => even(Math.ceil(v)) && v - w >= 1.5 && v - w <= 4)) {
      for (const so of steps(24, 28).filter((v) => even(Math.floor(v)))) {
        for (const n of steps(25, 31).filter((v) => even(Math.ceil(v)) && v - so >= 1.5 && v - so <= 4)) {
          if (boxes.length < 60) boxes.push({ west: w + 0.5, south: so + 0.5, east: e - 0.5, north: n - 0.5 });
        }
      }
    }
  }
  expect(boxes).toHaveLength(60);
  for (const view of boxes) await ensureMarineSeries('GFS', 'waves', view, 0, undefined, true);
  await flush();
  expect(backend()).toHaveLength(0);                       // 60 regional pages, all from the bundle
  expect(_marineSeriesCacheState().entries).toBeLessThanOrEqual(48);
});

test('a page holds frames of one run: a frame from another run index drops the earlier ones', async () => {
  await getPinnedIndex(KEY);
  const key = 'page';
  const old = { staticFrames: true, staticIndex: 'v1/old-run.json', frames: new Map([[9, { old: true }]]), hours: [9], ts: Date.now() };
  const cache = new Map([[key, old]]);
  const flight = runStaticPageFlight(key, { model: 'GFS', layer: 'waves', reqBox: { west: -84, south: 26, east: -80, north: 28 },
    surf: false, hours: [0, 9], page: 0, signal: undefined, background: false },   // 9 is held (old run), so only 0 is fetched
  { seriesCache: cache, frameToMarineData: (f) => f, finish: () => {}, evict: () => {} });
  expect(await flight).toBe(true);
  expect([...cache.get(key).frames.keys()]).toEqual([0]);
  expect(cache.get(key).staticIndex).toBe(index(WORLD_LATTICE).path);
});
