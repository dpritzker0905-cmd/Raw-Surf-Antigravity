/**
 * Regional static frames at z7-9 (2026-10-23, staticRegional.js): one bundle per pilot box per run, read only for a box the tile
 * FULLY covers, sha12 checked on the gzip slice. The seam tests put the repo's one REAL RSWF frame (marineFramePack's 181 x 83
 * fixture) in a bundle under a large test tile, so the slicing, decoding, Step 3 window and JSON shaping all run on real bytes.
 */
import crypto from 'crypto';
import zlib from 'zlib';
import {
  _resetStaticFramesForTest, getPinnedIndex, getPinnedIndexSync, staticEligible, staticSeriesFrames, staticSetKeyForBox, tryStaticWorldGrid,
} from './staticFrames';
import { buildVectors, parseFrame } from './staticFrameCodec';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import {
  _setRegionalCodecForTest, isRegionalSetKey, noteBackendAnswer, normalizeBundleIndex, pickRegionalTile, regionalClipWindow,
  regionalFrameBytes, regionalSetKey,
} from './staticRegional';

const BASE = 'https://cdn.test/weather-frames/';
const VT = '2026-10-20T00:00:00Z';
const GZ = Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64');
const sha12 = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex').slice(0, 12);
const WORLD_VECTORS = buildVectors(parseFrame(Uint8Array.from(zlib.gunzipSync(GZ)).buffer));
const FLORIDA = { west: -85, south: 24, east: -79, north: 31 };
const BIG = { west: -100, south: 10, east: -60, north: 40 };                      // a test tile on the frame's own 2-deg lattice
const MANIFEST = { products: [
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'global_mid', coverage: { west: -180, south: -80, east: 180, north: 85 } },
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: FLORIDA },
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'test_big', coverage: BIG },
] };
const KEY = regionalSetKey('GFS', 'waves', 'test_big');

// The bundle: the real frame's gzip member, then a decoy member (the second frame's bytes are never read for VT).
const DECOY = zlib.gzipSync(Buffer.from('decoy'));
const BUNDLE = Buffer.concat([GZ, DECOY]);
const INDEX = {
  version: 1, encoding_version: 1, transform_version: 1, path: 'v1/gfs/marine/waves/test_big/index/r-abc.json', run: '2026-10-19T18:00:00Z',
  grid: { cols: 181, rows: 83, bounds: { west: -180, south: -80, east: 180, north: 84 } },
  common_meta: { model: 'GFS', provider: 'noaa', domain: 'marine', layer: 'waves', is_estimated: false, region_id: 'test_big' },
  bundle: { path: 'v1/gfs/marine/waves/test_big/20261019T180000Z/bundle-x.bin', bytes: BUNDLE.length, sha12: sha12(BUNDLE) },
  frames: [
    { valid_time: VT, is_estimated: false, meta: { product_id: 'gfs_marine_waves_test_big_20261020T000000Z.json' }, source: 's',
      offset: 0, length: GZ.length, sha12: sha12(GZ) },
    { valid_time: '2026-10-20T06:00:00Z', is_estimated: false, meta: {}, source: 's', offset: null, length: null, sha12: null, unbuilt: 'not_on_disk' },
  ],
};

let calls;
function cdn({ index = INDEX, bundle = BUNDLE } = {}) {
  calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [KEY]: { index: index.path, bundle: index.bundle, run: 'r' } } });
    if (url === BASE + index.path) return ok(index);
    if (url === BASE + index.bundle.path) return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(bundle).buffer };
    return { ok: false, status: 400, json: async () => ({}) };
  });
}

const realFetch = global.fetch;
let killBefore;
beforeEach(() => {
  killBefore = window.__RAW_DISABLE_STATIC_FRAMES__;      // setupTests turns static frames off for every other suite
  delete window.__RAW_DISABLE_STATIC_FRAMES__;
  _resetStaticFramesForTest();
  _setRegionalCodecForTest({ sha12: async (b) => sha12(b), gunzip: async (b) => Uint8Array.from(zlib.gunzipSync(Buffer.from(b))).buffer });
  window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
  window.__RAW_STATIC_FRAMES_BASE__ = BASE;
  setCachedManifest(MANIFEST);
  jest.spyOn(Date, 'now').mockImplementation(() => Date.parse(VT));
  cdn();
});
afterEach(() => {
  window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
  ['__RAW_STATIC_FRAMES_BASE__', '__RAW_DISABLE_REGIONAL_BUNDLES__', '__RAW_DISABLE_STATIC_FRAMES_SETS__'].forEach((k) => delete window[k]);
  _setRegionalCodecForTest();
  setCachedManifest(null);
  if (killBefore === undefined) delete window.__RAW_DISABLE_STATIC_FRAMES__; else window.__RAW_DISABLE_STATIC_FRAMES__ = killBefore;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('which box reads a regional bundle', () => {
  it('set keys: a pilot box is regional, the world tiers are not; phase 1 is GFS waves', () => {
    expect(isRegionalSetKey('GFS/marine/waves/florida_east_coast')).toBe(true);
    expect(isRegionalSetKey('GFS/marine/waves/global_mid')).toBe(false);
    expect(isRegionalSetKey('GFS/marine/swell_1/florida_east_coast')).toBe(false);
    expect(isRegionalSetKey('ICON/marine/waves/florida_east_coast')).toBe(false);
  });

  it('the tile Step 3 picks: inside one tile -> it; inside two -> the smaller; on the edge, outside, ICON or killed -> none', () => {
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-82,26,-80,29' }).id).toBe('florida_east_coast');   // also in BIG
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-90,20,-80,30' }).id).toBe('test_big');
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-82,26,-78,30' }).id).toBe('test_big');            // past Florida's east edge
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-120,20,-110,30' })).toBeNull();
    expect(pickRegionalTile({ model: 'ICON', layer: 'waves', bboxStr: '-82,26,-80,29' })).toBeNull();
    window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true;
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-82,26,-80,29' })).toBeNull();
  });

  it('an exact area tie between two tiles is left to /grid', () => {
    setCachedManifest({ products: [...MANIFEST.products, { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'twin', coverage: { ...FLORIDA } }] });
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-82,26,-80,29' })).toBeNull();
  });
});

describe('the Step 3 window on a 0.25-deg tile lattice (snap 1 deg, data-extent clamp, clip_lattice, no pad)', () => {
  const FL_GRID = { bounds: { ...FLORIDA }, cols: 25, rows: 29 };
  it('a box inside the tile: the snapped window, which covers the request', () => {
    const w = regionalClipWindow('-82.3,26.2,-80.1,28.7', FL_GRID, 'GFS');
    expect(w).toMatchObject({ c0: 8, r0: 8, cols: 13, rows: 13, bounds: { west: -83, south: 26, east: -80, north: 29 }, covers: true });
  });
  it('a box past the data edge: clamped to the data, so it does NOT cover (the server serves regional_partial)', () => {
    const w = regionalClipWindow('-80.5,26.2,-78.5,28.7', FL_GRID, 'GFS');
    expect(w.bounds.east).toBe(-79);
    expect(w.covers).toBe(false);
  });
});

describe('the bundle: one fetch, the slice checked on its gzip bytes, then inflated', () => {
  it('a slice decodes to the per-frame object; a bad sha12 is refused; two slices cost one fetch', async () => {
    const idx = normalizeBundleIndex(JSON.parse(JSON.stringify(INDEX)));
    const f = idx.frames[0];
    expect(f.path).toBe(`${INDEX.bundle.path}#0`);
    expect(idx.frames[1].path).toBeNull();
    const got = await regionalFrameBytes(BASE, f);
    expect(Buffer.from(got.buffer).equals(zlib.gunzipSync(GZ))).toBe(true);
    const bad = await regionalFrameBytes(BASE, { ...f, bundle: { ...f.bundle, sha12: '000000000000' } });
    expect(bad.error).toBe('sha12_mismatch');
    expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(1);
    expect(window.__RAW_STATIC_REGIONAL__).toMatchObject({ bundles: 1, slices: 1, misses: { sha12_mismatch: 1 } });
  });
});

describe('the seams answer a fully covered box from the bundle, and nothing else', () => {
  const BOX = { west: -90, south: 20, east: -80, north: 30 };          // inside test_big; the 2-deg lattice window covers it
  it('seam A: Step 3 shaped JSON, the real frame cropped to the window, the request echoed as sent', async () => {
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: BOX })).toBe(true);
    const json = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX });
    expect(json).toMatchObject({ coverage_scope: 'regional', coverage_mode: 'regional_tile', partial_coverage: false,
      requested_bbox: '-90,20,-80,30', served_bbox: '-90.0000,20.0000,-80.0000,30.0000', product_id: 'gfs_marine_waves_test_big_20261020T000000Z.json' });
    expect([json.grid.cols, json.grid.rows]).toEqual([6, 6]);
    const want = WORLD_VECTORS.filter((v) => v.lng >= -90 && v.lng <= -80 && v.lat >= 20 && v.lat <= 30);
    expect(json.grid.vectors.map((v) => [v.lat, v.lng, v.speed])).toEqual(want.map((v) => [v.lat, v.lng, v.speed]));
    expect(window.__RAW_STATIC_REGIONAL__.hits).toBe(1);
    expect(calls.filter((u) => u.includes('/grid'))).toHaveLength(0);
  });

  it('a partial cover, an unbuilt hour and the kill switch all go to /grid (null)', async () => {
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: { ...BOX, east: -79.5 } })).toBeNull();
    expect(window.__RAW_STATIC_REGIONAL__.misses.partial_cover).toBe(1);
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: '2026-10-20T06:00:00Z', clampedBbox: BOX })).toBeNull();
    expect(window.__RAW_STATIC_REGIONAL__.misses.unbuilt_frame).toBe(1);
    window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true;
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: BOX })).toBe(false);
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX })).toBeNull();
  });

  it('the per-set kill and a set not published yet also go to /grid', async () => {
    window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = [KEY];
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: BOX })).toBe(false);
    delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
    setCachedManifest({ products: [...MANIFEST.products, { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'unpublished', coverage: { west: -95, south: 15, east: -75, north: 35 } }] });
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX })).toBeNull();
    expect(window.__RAW_STATIC_REGIONAL__.misses.no_index).toBe(1);
  });

  it('seam B: series frames from the bundle; hours it cannot serve are returned for the per-hour path', async () => {
    const frames = [];
    const missing = await staticSeriesFrames({ model: 'GFS', layer: 'waves', bbox: BOX, hours: [0, 6], anchorMs: Date.parse(VT), focusHour: 0, onFrames: (f) => frames.push(...f) });
    expect(missing).toEqual([6]);
    expect(frames).toHaveLength(1);
    expect([frames[0].cols, frames[0].rows, frames[0].bounds]).toEqual([6, 6, { west: -90, south: 20, east: -80, north: 30 }]);
    expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(1);
  });

  it('the frame store never takes a regional set (phase 1); the box resolves to its regional key', async () => {
    expect(staticSetKeyForBox({ model: 'GFS', layer: 'waves', bbox: BOX })).toBe(KEY);
    expect(await getPinnedIndex(KEY)).not.toBeNull();
    expect(getPinnedIndexSync(KEY)).toBeNull();
  });

  it('the counter: a DYNAMIC /grid answer on a box a bundle covers is counted (expected 0 live); elsewhere it is not', () => {
    noteBackendAnswer({ model: 'GFS', layer: 'waves', bboxStr: '-90,20,-80,30', json: { is_dynamic_viewport_product: true } });
    noteBackendAnswer({ model: 'GFS', layer: 'waves', bboxStr: '-90,20,-80,30', json: { is_dynamic_viewport_product: false } });
    noteBackendAnswer({ model: 'GFS', layer: 'waves', bboxStr: '-120,20,-110,30', json: { is_dynamic_viewport_product: true } });
    expect(window.__RAW_STATIC_REGIONAL__.dynamicOnCovered).toBe(1);
  });
});
