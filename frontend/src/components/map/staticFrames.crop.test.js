/**
 * Static frames, mid-zoom crops (2026-10-22): a viewport box the resolver answers from global_mid is served as a crop of the
 * pinned frame, on both seams; anything else is unchanged. Uses one REAL world frame (181 x 83, marineFramePack's fixture).
 */
import zlib from 'zlib';
import {
  _resetStaticFramesForTest, setKeyFor, staticCropPageKey, staticEligible, staticSeriesFrames, tryStaticWorldGrid,
} from './staticFrames';
import { buildVectors, parseFrame } from './staticFrameCodec';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';

const BASE = 'https://cdn.test/weather-frames/';
const KEY = setKeyFor('GFS', 'waves');
const VT = '2026-10-20T00:00:00Z';
const RAW = zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64'));
const rawBuffer = () => Uint8Array.from(RAW).buffer;     // an ArrayBuffer of THIS realm (a Node Buffer's is not instanceof it)
const WORLD_VECTORS = buildVectors(parseFrame(rawBuffer()));
const INDEX = {
  version: 1, encoding_version: 1, transform_version: 1, path: 'v1/idx/real.json', run: '2026-10-19T18:00:00Z',
  grid: { cols: 181, rows: 83, bounds: { west: -180, south: -80, east: 180, north: 84 } },
  common_meta: { model: 'GFS', provider: 'open-meteo', domain: 'marine', layer: 'waves', is_estimated: false, coverage: { west: -180, south: -80, east: 180, north: 85 } },
  frames: [{ valid_time: VT, is_estimated: false, path: `v1/f/${VT}.bin`, meta: { product_id: 'gfs_marine_waves_global_mid_20261020T000000Z.json' } }],
};
const MANIFEST = { products: [
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'global_mid', coverage: { west: -180, south: -80, east: 180, north: 85 } },
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: { west: -85, south: 24, east: -79, north: 31 } },
] };
const VIEW = { west: -95, south: 20, east: -65, north: 35 };          // the owner's 27 x 20 clip
const WORLD = { west: -180, south: -80, east: 180, north: 85 };

let calls;
function cdn() {
  calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [KEY]: { index: INDEX.path, run: 'r' } } });
    if (url === BASE + INDEX.path) return ok(INDEX);
    if (url.endsWith('.bin')) return { ok: true, status: 200, arrayBuffer: async () => rawBuffer() };
    return { ok: false, status: 400, json: async () => ({}) };
  });
}

const realFetch = global.fetch;
let killBefore;
beforeEach(() => {
  killBefore = window.__RAW_DISABLE_STATIC_FRAMES__;      // setupTests turns static frames off for every other suite
  delete window.__RAW_DISABLE_STATIC_FRAMES__;
  _resetStaticFramesForTest();
  window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
  window.__RAW_STATIC_FRAMES_BASE__ = BASE;
  setCachedManifest(MANIFEST);
  jest.spyOn(Date, 'now').mockImplementation(() => Date.parse(VT));
  cdn();
});
afterEach(() => {
  window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
  delete window.__RAW_STATIC_FRAMES_BASE__;
  delete window.__RAW_DISABLE_STATIC_MID_CROP__;
  setCachedManifest(null);
  if (killBefore === undefined) delete window.__RAW_DISABLE_STATIC_FRAMES__; else window.__RAW_DISABLE_STATIC_FRAMES__ = killBefore;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

test('a viewport box the mid tier answers is eligible; a world box still is; a narrow or tile-sized one is not', () => {
  expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: VIEW })).toBe(true);
  expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD })).toBe(true);
  expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: { west: -84, south: 25, east: -80, north: 30 } })).toBe(false);
  expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: VIEW, surf: true })).toBe(false);
  window.__RAW_DISABLE_STATIC_MID_CROP__ = true;
  expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: VIEW })).toBe(false);
  expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD })).toBe(true);
});

test('seam A: /grid for a viewport box comes from the CDN frame, cropped to the clip, node for node', async () => {
  const json = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T01:00:00.000Z', clampedBbox: VIEW });
  expect(json).not.toBeNull();
  expect([json.grid.cols, json.grid.rows]).toEqual([27, 20]);
  expect(json.grid.bounds).toEqual({ west: -106, south: 8, east: -54, north: 46 });
  expect(json.served_bbox).toBe('-106.0000,8.0000,-54.0000,46.0000');
  expect(json.requested_bbox).toBe('-107.0000,8.0000,-53.0000,47.0000');
  expect(json.coverage).toEqual(json.grid.bounds);
  expect(json.grid.diagnostics.mid_res_tier).toBe(true);
  expect(json.product_id).toBe('gfs_marine_waves_global_mid_20261020T000000Z.json');
  expect(json.served_valid_time).toBe(VT);
  // every node is the world frame's node at the same place
  for (let r = 0; r < 20; r++) {
    for (let c = 0; c < 27; c++) {
      expect(json.grid.vectors[r * 27 + c]).toEqual(WORLD_VECTORS[(r + 44) * 181 + (c + 37)]);
    }
  }
  expect(json.grid.vectors[0]).toMatchObject({ lat: 8, lng: -106 });
  expect(calls.some((u) => u.includes('/api/'))).toBe(false);
  expect(window.__RAW_STATIC_FRAMES__.crops).toBe(1);
});

test('seam A: kill switch, no manifest, or a box the server could answer with a tile -> null (the caller asks /grid)', async () => {
  window.__RAW_DISABLE_STATIC_MID_CROP__ = true;
  expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: VIEW })).toBeNull();
  delete window.__RAW_DISABLE_STATIC_MID_CROP__;
  setCachedManifest(null);
  expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: VIEW })).toBeNull();
  setCachedManifest({ products: [...MANIFEST.products,
    { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'wide_pilot', coverage: { west: -100, south: 10, east: -60, north: 40 } }] });
  expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: VIEW })).toBeNull();
  expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(0);
  // the world box is untouched by all of it
  const world = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: WORLD });
  expect([world.grid.cols, world.grid.rows, world.grid.vectors.length]).toEqual([181, 83, 181 * 83]);
  expect(world.requested_bbox).toBe('-180.0000,-80.0000,180.0000,85.0000');
});

test('seam B: series frames for a crop page are cropped the same way (the /grid_series URL prints 4 dp)', async () => {
  const anchorMs = Date.parse(VT);
  const got = [];
  const missing = await staticSeriesFrames({ model: 'GFS', layer: 'waves', bbox: VIEW, hours: [0, 1], anchorMs, focusHour: 0,
    onFrames: (f) => got.push(...f) });
  expect(missing).toEqual([]);
  expect(got.map((f) => [f.hour_offset, f.cols, f.rows])).toEqual([[0, 27, 20], [1, 27, 20]]);
  expect(got[0].bounds).toEqual({ west: -106, south: 8, east: -54, north: 46 });
  expect(got[0].static_crop).toBe('-107.0000,8.0000,-53.0000,47.0000');
  expect(got[0].vectors[0]).toEqual(WORLD_VECTORS[44 * 181 + 37]);
});

test('a crop page has its own series key (viewports over 15 deg all share "global" with the world page); others keep theirs', () => {
  const base = 'GFS_waves_swell_global_p0@2026-10-20T00:00:00Z';
  expect(staticCropPageKey(base, { model: 'GFS', layer: 'waves', reqBox: VIEW, surf: false }))
    .toBe(`${base}|crop:-107.0000,8.0000,-53.0000,47.0000`);
  expect(staticCropPageKey(base, { model: 'GFS', layer: 'waves', reqBox: WORLD, surf: false })).toBe(base);
  expect(staticCropPageKey(base, { model: 'GFS', layer: 'waves', reqBox: VIEW, surf: true })).toBe(base);
  window.__RAW_DISABLE_STATIC_MID_CROP__ = true;
  expect(staticCropPageKey(base, { model: 'GFS', layer: 'waves', reqBox: VIEW, surf: false })).toBe(base);
});

test('every world set takes the crop rules (#453 eight sets + #459): per model and layer; a non-waves series page keeps its key', () => {
  const GLOBAL = { west: -180, south: -80, east: 180, north: 85 };
  setCachedManifest({ products: [
    ...MANIFEST.products,
    { model: 'ICON', domain: 'marine', layer: 'waves', region_id: 'global_mid', coverage: GLOBAL },
    { model: 'EURO', domain: 'marine', layer: 'waves', region_id: 'global_mid', coverage: GLOBAL },
    { model: 'EURO', domain: 'marine', layer: 'waves', region_id: 'us_west_coast_socal', coverage: { west: -125, south: 30, east: -115, north: 38 } },
    { model: 'GFS', domain: 'marine', layer: 'swell_1', region_id: 'global_mid', coverage: GLOBAL },
  ] });
  // ICON waves: no ICON regional tile overlaps the view -> the resolver answers from global_mid -> a crop
  expect(staticEligible({ model: 'ICON', layer: 'waves', bbox: VIEW })).toBe(true);
  // EURO waves: its SoCal tile is far from this view, so it crops here; a view over SoCal refuses (estimated regional tails)
  expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: VIEW })).toBe(true);
  expect(staticEligible({ model: 'EURO', layer: 'waves', bbox: { west: -135, south: 25, east: -105, north: 45 } })).toBe(false);
  // not one of the eight sets (EURO swells are global_coarse + serve-time Gulf fill): never, at any box
  expect(staticEligible({ model: 'EURO', layer: 'swell_1', bbox: VIEW })).toBe(false);
  // GFS swell_1: seam A crops it, but the series lane is waves-only, so its series page keeps the /grid_series key
  const base = 'GFS_swell_1_swell_global_p0@2026-10-20T00:00:00Z';
  expect(staticEligible({ model: 'GFS', layer: 'swell_1', bbox: VIEW })).toBe(true);
  expect(staticCropPageKey(base, { model: 'GFS', layer: 'swell_1', reqBox: VIEW, surf: false })).toBe(base);
  // the per-set kill reaches the crop too
  window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = [setKeyFor('ICON', 'waves')];
  expect(staticEligible({ model: 'ICON', layer: 'waves', bbox: VIEW })).toBe(false);
  delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
});
