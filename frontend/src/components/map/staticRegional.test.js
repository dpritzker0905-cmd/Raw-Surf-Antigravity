/**
 * Regional static frames at z7-9 (2026-10-23, staticRegional.js): one bundle per pilot box per run, read only for a box the tile
 * FULLY covers, sha12 checked on the gzip slice. The seam tests put the repo's one REAL RSWF frame (marineFramePack's 181 x 83
 * fixture) in a bundle under a large test tile, so the slicing, decoding, Step 3 window and JSON shaping all run on real bytes.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {
  _resetStaticFramesForTest, getPinnedIndex, getPinnedIndexSync, staticEligible, staticSeriesFrames, staticSetKeyForBox, tryStaticWorldGrid,
} from './staticFrames';
import { buildVectors, parseFrame } from './staticFrameCodec';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import {
  BUNDLE_BACKOFF_MS, BUNDLE_DEAD_MS, BUNDLE_TIMEOUT_MS, PILOT_BOXES, _setRegionalCodecForTest, bundleTimeoutMs, insidePilotBox,
  isRegionalSetKey, noteBackendAnswer, regionalCapable,
  normalizeBundleIndex, pickRegionalTile, regionalClipWindow, regionalFrameBytes, regionalManifestPending, regionalSetKey,
  REGIONAL_BUNDLES_DEFAULT_ON,
} from './staticRegional';
import {
  MANIFEST_WAIT_MS, REGIONAL_BACKGROUND_FILL_CELLS, REGIONAL_FULL_PAGE_CELLS, regionalFullPage, regionalSeriesWait, staticOwnsWorldPage,
} from './marineSeriesStatic';
import { _resetProductsManifestFetchForTest } from './backendWeatherServiceClient';

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

let calls; let prios;
// `bin`: how the bundle answers (default the bytes; a number = that HTTP status; { status, retryAfter } = that status with a
// Retry-After header; 'throw' = a network / CORS error; 'hang' = never, until the request is aborted).
function cdn({ index = INDEX, bundle = BUNDLE, bin = null } = {}) {
  calls = []; prios = [];
  global.fetch = jest.fn(async (url, opts = {}) => {
    calls.push(url);
    if (url.endsWith('.bin')) prios.push(opts.priority || null);
    const ok = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [KEY]: { index: index.path, bundle: index.bundle, run: 'r' } } });
    if (url === BASE + index.path) return ok(index);
    if (url === BASE + index.bundle.path) {
      if (typeof bin === 'number') return { ok: false, status: bin, arrayBuffer: async () => new ArrayBuffer(0) };
      if (bin && typeof bin === 'object') {
        return { ok: false, status: bin.status, headers: { get: (h) => (h === 'Retry-After' ? bin.retryAfter : null) }, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      if (bin === 'throw') throw new TypeError('Failed to fetch');
      if (bin === 'hang') {
        return new Promise((resolve, reject) => {
          if (opts.signal) opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(bundle).buffer };
    }
    return { ok: false, status: 400, json: async () => ({}) };
  });
}
const bins = () => calls.filter((u) => u.endsWith('.bin')).length;
const latests = () => calls.filter((u) => u.endsWith('latest.json')).length;

const realFetch = global.fetch;
let killBefore;
beforeEach(() => {
  killBefore = window.__RAW_DISABLE_STATIC_FRAMES__;      // setupTests turns static frames off for every other suite
  delete window.__RAW_DISABLE_STATIC_FRAMES__;
  _resetStaticFramesForTest();
  _setRegionalCodecForTest({ sha12: async (b) => sha12(b), gunzip: async (b) => Uint8Array.from(zlib.gunzipSync(Buffer.from(b))).buffer });
  window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
  window.__RAW_STATIC_FRAMES_BASE__ = BASE;
  window.__RAW_ENABLE_REGIONAL_BUNDLES__ = true;              // dark by default since 2026-10-23 evening: these tests opt in
  setCachedManifest(MANIFEST);
  jest.spyOn(Date, 'now').mockImplementation(() => Date.parse(VT));
  cdn();
});
afterEach(() => {
  window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
  ['__RAW_STATIC_FRAMES_BASE__', '__RAW_DISABLE_REGIONAL_BUNDLES__', '__RAW_ENABLE_REGIONAL_BUNDLES__', '__RAW_DISABLE_STATIC_FRAMES_SETS__',
    '__RAW_DISABLE_REGIONAL_MANIFEST_WAIT__', '__RAW_DISABLE_REGIONAL_PILOT_FALLBACK__'].forEach((k) => delete window[k]);
  _resetProductsManifestFetchForTest();
  jest.useRealTimers();
  _setRegionalCodecForTest();
  setCachedManifest(null);
  if (killBefore === undefined) delete window.__RAW_DISABLE_STATIC_FRAMES__; else window.__RAW_DISABLE_STATIC_FRAMES__ = killBefore;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('dark by default (the live parity failed, 2026-10-23 evening)', () => {
  it('without the opt-in no box is regional: no pick, no wait, the world / crop rules as before #491', () => {
    delete window.__RAW_ENABLE_REGIONAL_BUNDLES__;
    expect(REGIONAL_BUNDLES_DEFAULT_ON).toBe(false);
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-90,20,-80,30' })).toBeNull();
    expect(staticSetKeyForBox({ model: 'GFS', layer: 'waves', bbox: { west: -90, south: 20, east: -80, north: 30 } })).toBe('GFS/marine/waves/global_mid');
    setCachedManifest(null);
    expect(regionalManifestPending({ model: 'GFS', layer: 'waves', bbox: { west: -83, south: 26, east: -80, north: 28.5 } })).toBe(false);
    window.__RAW_ENABLE_REGIONAL_BUNDLES__ = true;
    window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true;                                          // the kill wins over the opt-in
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-90,20,-80,30' })).toBeNull();
  });
});

describe('which box reads a regional bundle', () => {
  it('set keys: a pilot box is regional, the world tiers are not; phase 1 is GFS waves', () => {
    expect(isRegionalSetKey('GFS/marine/waves/florida_east_coast')).toBe(true);
    expect(isRegionalSetKey('GFS/marine/waves/global_mid')).toBe(false);
    expect(isRegionalSetKey('GFS/marine/swell_1/florida_east_coast')).toBe(true);
    expect(isRegionalSetKey('GFS/marine/wind_waves/us_west_coast_socal')).toBe(true);
    expect(isRegionalSetKey('GFS/marine/wind/florida_east_coast')).toBe(false);
    expect(isRegionalSetKey('GFS/wind/wind/florida_east_coast')).toBe(false);
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
  it('a tile whose data edge is not a whole degree: a box whose SNAPPED box leaves the data is not covered', () => {
    // us_southeast_midatlantic: coverage east -74.4, the last 0.25-deg node -74.5. The server's dynamic cache is keyed on the
    // snapped box, so a full cover snapping past the data shares its key with partial covers (whose sharpen fills it).
    const SE_GRID = { bounds: { west: -82, south: 31, east: -74.5, north: 37.5 }, cols: 31, rows: 27 };
    const inside = regionalClipWindow('-78.2,33.1,-75.3,35.8', SE_GRID, 'GFS');           // snaps to -79,33,-75,36: inside the data
    expect([inside.covers, inside.snapInside]).toEqual([true, true]);
    const nearEdge = regionalClipWindow('-76.5,33.1,-74.6,35.8', SE_GRID, 'GFS');         // inside the data, snaps east to -74
    expect(nearEdge.bounds.east).toBe(-74.5);
    expect([nearEdge.covers, nearEdge.snapInside]).toEqual([false, false]);
    const pastData = regionalClipWindow('-76.5,33.1,-74.45,35.8', SE_GRID, 'GFS');        // inside the coverage, past the last node
    expect(pastData.covers).toBe(false);
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

describe('a failed bundle: remembered with a backoff, its real status passed on, never decoded unchecked', () => {
  const frame = () => normalizeBundleIndex(JSON.parse(JSON.stringify(INDEX))).frames[0];
  it('a 429: one request, then the backoff answers at once (no request), then one retry after it', async () => {
    cdn({ bin: 429 });
    expect(await regionalFrameBytes(BASE, frame())).toMatchObject({ status: 429, error: 'bundle_http_429' });
    expect(await regionalFrameBytes(BASE, frame())).toMatchObject({ status: 'backoff', error: 'bundle_backoff' });
    expect(bins()).toBe(1);
    Date.now.mockImplementation(() => Date.parse(VT) + BUNDLE_BACKOFF_MS + 1);
    expect((await regionalFrameBytes(BASE, frame())).status).toBe(429);
    expect(bins()).toBe(2);
    expect((await regionalFrameBytes(BASE, frame())).status).toBe('backoff');                // the backoff doubled
    expect(window.__RAW_STATIC_REGIONAL__.misses).toMatchObject({ bundle_http_429: 2, bundle_backoff: 2 });
  });

  it('a longer Retry-After wins over the 30 s step; a 404 is a dead path for 30 min; a bad sha12 too, as integrity', async () => {
    cdn({ bin: { status: 429, retryAfter: '300' } });
    expect((await regionalFrameBytes(BASE, frame())).status).toBe(429);
    Date.now.mockImplementation(() => Date.parse(VT) + 31000);
    expect((await regionalFrameBytes(BASE, frame())).status).toBe('backoff');                // 300 s, not 30 s
    Date.now.mockImplementation(() => Date.parse(VT) + 301000);
    expect((await regionalFrameBytes(BASE, frame())).status).toBe(429);
    expect(bins()).toBe(2);
    _resetStaticFramesForTest();
    Date.now.mockImplementation(() => Date.parse(VT));
    cdn({ bin: 404 });
    expect((await regionalFrameBytes(BASE, frame())).status).toBe(404);
    Date.now.mockImplementation(() => Date.parse(VT) + BUNDLE_DEAD_MS - 1);
    expect((await regionalFrameBytes(BASE, frame())).status).toBe('backoff');
    expect(bins()).toBe(1);
    _resetStaticFramesForTest();
    Date.now.mockImplementation(() => Date.parse(VT));
    cdn();
    const bad = await regionalFrameBytes(BASE, { ...frame(), bundle: { ...frame().bundle, sha12: '000000000000' } });
    expect(bad).toMatchObject({ error: 'sha12_mismatch', status: 'integrity' });
    expect((await regionalFrameBytes(BASE, frame())).status).toBe('backoff');                // the bundle is dropped, dead for the pin
  });

  it('seam A: a sha12 mismatch re-pins (forced latest.json re-read), as a 404 does', async () => {
    const BOX = { west: -90, south: 20, east: -80, north: 30 };
    const badIndex = JSON.parse(JSON.stringify(INDEX));
    badIndex.frames[0].sha12 = '000000000000';
    cdn({ index: badIndex });
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX })).toBeNull();
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX })).toBeNull();
    expect(latests()).toBe(2);
    expect(bins()).toBe(1);
  });

  it('fetch priority: the /grid seam asks the bundle at high, a background series fill at low', async () => {
    const BOX = { west: -90, south: 20, east: -80, north: 30 };
    await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX });
    expect(prios).toEqual(['high']);
    _resetStaticFramesForTest();
    cdn();
    await staticSeriesFrames({ model: 'GFS', layer: 'waves', bbox: BOX, hours: [0], anchorMs: Date.parse(VT), onFrames: () => {}, priority: 'low' });
    expect(prios).toEqual(['low']);
  });

  it('the timeout floor is 8 s; a large bundle gets its size at 150 KB/s', () => {
    expect(bundleTimeoutMs(120370)).toBe(BUNDLE_TIMEOUT_MS);
    expect(BUNDLE_TIMEOUT_MS).toBe(8000);
    expect(bundleTimeoutMs(2500000)).toBe(16667);
  });

  it('a browser that cannot check or inflate slices picks no tile, waits for nothing and downloads nothing', () => {
    _setRegionalCodecForTest();
    const saved = global.DecompressionStream;
    delete global.DecompressionStream;
    try {
      expect(regionalCapable()).toBe(false);
      expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-90,20,-80,30' })).toBeNull();
      expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: { west: -90, south: 20, east: -80, north: 30 } })).toBe(false);
      setCachedManifest(null);
      expect(regionalManifestPending({ model: 'GFS', layer: 'waves', bbox: { west: -83, south: 26, east: -80, north: 28.5 } })).toBe(false);
      expect(bins()).toBe(0);
    } finally {
      if (saved !== undefined) global.DecompressionStream = saved;
    }
  });

  it('a network / CORS error is status 0 and backs off too; concurrent asks share one request', async () => {
    cdn({ bin: 'throw' });
    const got = await Promise.all([regionalFrameBytes(BASE, frame()), regionalFrameBytes(BASE, frame()), regionalFrameBytes(BASE, frame())]);
    expect(got.map((g) => g.status)).toEqual([0, 0, 0]);
    expect(bins()).toBe(1);
    expect((await regionalFrameBytes(BASE, frame())).status).toBe('backoff');
    cdn();
    const ok = await Promise.all([regionalFrameBytes(BASE, { ...frame(), bundle: { ...frame().bundle, path: 'v1/other.bin' } })]);
    expect(ok[0].error).toBeTruthy();                                                        // another path is its own fetch
  });

  it('a bundle that never answers is aborted after BUNDLE_TIMEOUT_MS (status 0, bundle_timeout)', async () => {
    jest.useFakeTimers();
    cdn({ bin: 'hang' });
    let got = null;
    regionalFrameBytes(BASE, frame()).then((g) => { got = g; });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    jest.advanceTimersByTime(BUNDLE_TIMEOUT_MS - 1);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(got).toBeNull();
    jest.advanceTimersByTime(1);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(got).toMatchObject({ status: 0, error: 'bundle_timeout' });
  });

  it('a truncated bundle, a gzip error and a missing digest are refused (fail closed), never thrown', async () => {
    cdn({ bundle: BUNDLE.subarray(0, 10) });
    expect((await regionalFrameBytes(BASE, frame())).error).toBe('slice_out_of_range');
    _resetStaticFramesForTest();
    cdn();
    _setRegionalCodecForTest({ sha12: async (b) => sha12(b), gunzip: async () => { throw new TypeError('incorrect header check'); } });
    expect((await regionalFrameBytes(BASE, frame())).error).toBe('gunzip_error');
    _setRegionalCodecForTest({ sha12: async () => null, gunzip: async (b) => Uint8Array.from(zlib.gunzipSync(Buffer.from(b))).buffer });
    expect((await regionalFrameBytes(BASE, frame())).error).toBe('sha12_unavailable');
  });

  it('seam A: a 429 does not mark the pin stale (no forced latest.json re-read); a real 404 does, once', async () => {
    const BOX = { west: -90, south: 20, east: -80, north: 30 };
    cdn({ bin: 429 });
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX })).toBeNull();
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX })).toBeNull();
    expect([latests(), bins()]).toEqual([1, 1]);
    _resetStaticFramesForTest();
    cdn({ bin: 404 });
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX })).toBeNull();
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX })).toBeNull();   // re-pins
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX })).toBeNull();   // backoff
    expect([latests(), bins()]).toEqual([2, 1]);
  });

  it('seam B: a page whose bundle fails serves nothing and is NOT claimed (null: the caller asks /grid_series)', async () => {
    const BOX = { west: -90, south: 20, east: -80, north: 30 };
    cdn({ bin: 503 });
    const frames = [];
    expect(await staticSeriesFrames({ model: 'GFS', layer: 'waves', bbox: BOX, hours: [0, 1, 2], anchorMs: Date.parse(VT), onFrames: (f) => frames.push(...f) })).toBeNull();
    expect(frames).toHaveLength(0);
    expect(await staticSeriesFrames({ model: 'GFS', layer: 'waves', bbox: BOX, hours: [0, 1, 2], anchorMs: Date.parse(VT), onFrames: (f) => frames.push(...f) })).toBeNull();
    expect(bins()).toBe(1);                                                                  // the second page: the backoff, no request
    expect(window.__RAW_STATIC_REGIONAL__.misses).toMatchObject({ page_failed: 1, page_not_servable: 1 });
  });
});

describe('the seams answer a fully covered box from the bundle, and nothing else', () => {
  const BOX = { west: -90, south: 20, east: -80, north: 30 };          // inside test_big; the 2-deg lattice window covers it
  it('seam A: Step 3 shaped JSON, the real frame cropped to the window, requested_bbox = the snapped box', async () => {
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: BOX })).toBe(true);
    const json = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: BOX });
    expect(json).toMatchObject({ coverage_scope: 'regional', coverage_mode: 'regional_tile', partial_coverage: false,
      requested_bbox: '-90.0000,20.0000,-80.0000,30.0000', query_bbox: '-90,20,-80,30', requested_bbox_original: '-90,20,-80,30',
      served_bbox: '-90.0000,20.0000,-80.0000,30.0000', product_id: 'gfs_marine_waves_test_big_20261020T000000Z.json' });
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
    expect(frames[0].static_index).toBe(INDEX.path);                                         // the run the page holds
    expect(calls.filter((u) => u.endsWith('.bin'))).toHaveLength(1);
  });

  it('the frame store never takes a regional set (phase 1); the box resolves to its regional key', async () => {
    expect(staticSetKeyForBox({ model: 'GFS', layer: 'waves', bbox: BOX })).toBe(KEY);
    expect(staticSetKeyForBox({ model: 'GFS', layer: 'waves', bbox: BOX, surf: true })).toBe('GFS/marine/waves/global_mid');   // surf: never
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

describe('at the map opening, before the products manifest has loaded (the z9 Florida trace, 2026-10-23)', () => {
  const FBOX = { west: -83, south: 26, east: -80, north: 28.5 };                 // the owner's z9 series box, inside florida_east_coast
  const BOX = { west: -90, south: 20, east: -80, north: 30 };                    // inside test_big, in no pilot box
  const WORLD = { west: -180, south: -80, east: 180, north: 85 };
  it('only a box inside a pilot box waits for the manifest, then picks its tile; other boxes and the kill never wait', async () => {
    setCachedManifest(null);
    _resetProductsManifestFetchForTest();
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-83,26,-80,28.5' })).toBeNull();   // what every early page saw
    expect(regionalManifestPending({ model: 'GFS', layer: 'swell_1', bbox: FBOX })).toBe(true);
    expect(regionalManifestPending({ model: 'GFS', layer: 'waves', bbox: BOX })).toBe(false);           // no pilot box: never waits
    expect(regionalManifestPending({ model: 'GFS', layer: 'waves', bbox: WORLD })).toBe(false);
    expect(regionalManifestPending({ model: 'ICON', layer: 'waves', bbox: FBOX })).toBe(false);
    expect(regionalManifestPending({ model: 'GFS', layer: 'waves', bbox: FBOX, surf: true })).toBe(false);
    window.__RAW_DISABLE_REGIONAL_MANIFEST_WAIT__ = true;
    expect(regionalSeriesWait('GFS', 'waves', FBOX, false)).toBeNull();
    delete window.__RAW_DISABLE_REGIONAL_MANIFEST_WAIT__;
    const cdnFetch = global.fetch;
    global.fetch = jest.fn(async (url) => (String(url).includes('/products') ? { ok: true, status: 200, json: async () => MANIFEST } : cdnFetch(url)));
    const wait = regionalSeriesWait('GFS', 'waves', FBOX, false);
    expect(wait).not.toBeNull();
    await expect(wait).resolves.toBe(true);
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-83,26,-80,28.5' })).toMatchObject({ id: 'florida_east_coast' });
    expect(regionalSeriesWait('GFS', 'waves', FBOX, false)).toBeNull();                                // loaded: nothing awaited
  });

  it('once latest.json lists a pilot box set, a box inside it is picked from that box before the manifest (no wait)', async () => {
    const FL_KEY = regionalSetKey('GFS', 'waves', 'florida_east_coast');
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      if (url === BASE + 'v1/latest.json') return { ok: true, status: 200, json: async () => ({ version: 1, sets: { [FL_KEY]: { index: 'v1/fl.json', run: 'r' } } }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    setCachedManifest(null);
    expect(regionalManifestPending({ model: 'GFS', layer: 'waves', bbox: FBOX })).toBe(true);        // nothing read yet: it waits
    expect(await getPinnedIndex('GFS/marine/waves/global_mid')).toBeNull();                            // reads latest.json
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-83,26,-80,28.5' }))
      .toMatchObject({ id: 'florida_east_coast', key: FL_KEY, provisional: true });
    expect(regionalManifestPending({ model: 'GFS', layer: 'waves', bbox: FBOX })).toBe(false);       // decides now
    expect(pickRegionalTile({ model: 'GFS', layer: 'swell_1', bboxStr: '-83,26,-80,28.5' })).toBeNull();   // that set is not listed
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-84,30,-78,32' })).toBeNull();        // not inside one box
    window.__RAW_DISABLE_REGIONAL_PILOT_FALLBACK__ = true;
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-83,26,-80,28.5' })).toBeNull();
    expect(regionalManifestPending({ model: 'GFS', layer: 'waves', bbox: FBOX })).toBe(true);
    delete window.__RAW_DISABLE_REGIONAL_PILOT_FALLBACK__;
    setCachedManifest({ products: MANIFEST.products.filter((p) => p.region_id !== 'florida_east_coast') });   // the manifest decides
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-83,26,-80,28.5' })).toMatchObject({ id: 'test_big' });
  });

  it('a manifest that never arrives costs at most MANIFEST_WAIT_MS, then the page decides as before', async () => {
    setCachedManifest(null);
    _resetProductsManifestFetchForTest();
    jest.useFakeTimers();
    global.fetch = jest.fn(() => new Promise(() => {}));
    let done = false;
    regionalSeriesWait('GFS', 'waves', FBOX, false).then(() => { done = true; });
    await Promise.resolve();
    jest.advanceTimersByTime(MANIFEST_WAIT_MS - 1);
    await Promise.resolve();
    expect(done).toBe(false);
    jest.advanceTimersByTime(1);
    for (let i = 0; i < 10; i++) await Promise.resolve();                                              // race -> then -> then
    expect(done).toBe(true);
  });

  it('the pilot boxes are the backend pilot_regions.py boxes (the hint never drifts from the tiles)', () => {
    const py = fs.readFileSync(path.join(__dirname, '../../../../backend/services/weather_pipeline/pilot_regions.py'), 'utf8');
    const re = /"(\w+)":\s*\{\s*"west":\s*(-?[\d.]+),\s*"south":\s*(-?[\d.]+),\s*"east":\s*(-?[\d.]+),\s*"north":\s*(-?[\d.]+)/g;
    const fromPy = [...py.matchAll(re)].map((m) => [m[1], +m[2], +m[3], +m[4], +m[5]]);
    const sort = (a) => [...a].sort((x, y) => x[0].localeCompare(y[0]));
    expect(sort(PILOT_BOXES)).toEqual(sort(fromPy));
    expect(insidePilotBox(FBOX)).toBe(true);
    expect(insidePilotBox(BOX)).toBe(false);
  });

  it('the hour-0 mini stands down only while the PINNED index can serve the page (never held for the manifest)', async () => {
    expect(staticOwnsWorldPage('GFS', 'waves', BOX, false)).toBe(false);                               // nothing pinned yet
    expect(await getPinnedIndex(KEY)).not.toBeNull();
    expect(staticOwnsWorldPage('GFS', 'waves', BOX, false)).toBe(true);
    expect(getPinnedIndexSync(KEY)).toBeNull();
    window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true;
    expect(staticOwnsWorldPage('GFS', 'waves', BOX, false)).toBe(false);
    delete window.__RAW_DISABLE_REGIONAL_BUNDLES__;
    cdn({ bin: 429 });                                                                                 // the bundle backs off
    await regionalFrameBytes(BASE, normalizeBundleIndex(JSON.parse(JSON.stringify(INDEX))).frames[0]);
    expect(staticOwnsWorldPage('GFS', 'waves', BOX, false)).toBe(false);
  });
});

describe('a viewed regional page fills every hour while its box is small', () => {
  it('a z9-sized box inside a pilot tile: whole page; a wider box, a world box and the kill: the window', () => {
    const z9 = { west: -90, south: 20, east: -87.9, north: 21.5 };                        // ~ the owner's z9 series box
    expect(regionalFullPage('GFS', 'waves', z9, false)).toBe(true);
    const wide = { west: -95, south: 15, east: -80, north: 30 };                          // (60+2) x (60+2) nodes > the cap
    expect((60 + 2) * (60 + 2)).toBeGreaterThan(REGIONAL_FULL_PAGE_CELLS);
    expect(regionalFullPage('GFS', 'waves', wide, false)).toBe(false);
    expect(regionalFullPage('GFS', 'waves', { west: -180, south: -80, east: 180, north: 85 }, false)).toBe(false);
    expect(regionalFullPage('GFS', 'waves', { west: -150, south: 20, east: -148, north: 21 }, false)).toBe(false);   // no tile
    const z7 = { west: -95, south: 15, east: -88, north: 20 };                            // (28+2) x (20+2) = 660 nodes
    expect(regionalFullPage('GFS', 'waves', z7, false)).toBe(true);                     // the viewed page
    expect(regionalFullPage('GFS', 'waves', z7, false, REGIONAL_BACKGROUND_FILL_CELLS)).toBe(false);   // a background page
    expect(regionalFullPage('GFS', 'waves', z9, false, REGIONAL_BACKGROUND_FILL_CELLS)).toBe(true);
    window.__RAW_DISABLE_REGIONAL_FULL_PAGE__ = true;
    expect(regionalFullPage('GFS', 'waves', z9, false)).toBe(false);
    delete window.__RAW_DISABLE_REGIONAL_FULL_PAGE__;
  });
});
