/**
 * Static GFS wind frames (2026-10-22, the wind instant scrub): windStaticFrames.js on ONE REAL frame (the published bytes of the
 * 2026-10-22 12Z run, valid 10-23T00Z, the HRRR lane of 10-22 18Z applied). The golden values below are what the REAL resolver
 * served for the same frame and boxes (serve_synthetic.py --real-wind --real-wind-lane, 2026-10-22): the world response, a
 * mid-zoom clip over CONUS (the lane stamp counted on the clip) and one over Europe (outside_hrrr_domain).
 */
import zlib from 'zlib';
import {
  WIND_SET_KEY, LANE_SETTLE_MS, _resetWindStaticForTest, keepRaw, laneVerdict, staticWindGridSync, tryStaticWindGrid,
  windBoxKind, windIndex, readLanePointer, windStaticEnabled, windViewportNeedsGrid,
} from './windStaticFrames';
import { _resetStaticFramesForTest, STATIC_SETS } from './staticFrames';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';
import { REAL_GFS_WIND_FRAME_GZ_BASE64, REAL_GFS_WIND_FRAME_VALID as VT } from './windStaticFrames.realFrame.fixture';

const BASE = 'https://cdn.test/weather-frames/';
const RAW = zlib.gunzipSync(Buffer.from(REAL_GFS_WIND_FRAME_GZ_BASE64, 'base64'));
const rawBuffer = () => Uint8Array.from(RAW).buffer;
const LANE = { key: 'wind_lane/hrrr-2026102218.json', cycle: '2026-10-22T18:00:00Z', horizon: '2026-10-24T18:00:00Z', feather_km: 200,
  taper_hours: 3, source: 'NOAA HRRR CONUS 3 km (AWS Open Data), 0.25-deg area mean, rotated to earth' };
const STAMP = { feather_km: 200, hrrr_cells: 429, hrrr_cycle: LANE.cycle, hrrr_full_cells: 352, hrrr_horizon: LANE.horizon,
  lane: 'hrrr+gfs', max_weight: 1, source: LANE.source, taper_hours: 3, time_weight: 1, valid_time: VT };
const FRAME = { valid_time: VT, is_estimated: false, path: 'v1/gfs/wind/wind/global_mid/20261022T120000Z/20261023T000000Z-40db05c00c61.bin',
  meta: { product_id: 'gfs_wind_wind_global_mid_20261023T000000Z.json', valid_time: VT, wind_lane: STAMP } };
const INDEX = {
  version: 1, encoding_version: 1, transform_version: 1, path: 'v1/gfs/wind/wind/global_mid/index/r.json', run: '2026-10-22T12:00:00Z',
  domain: 'wind', layer: 'wind', model: 'GFS', wind_lane: LANE,
  grid: { cols: 181, rows: 83, bounds: { west: -180, south: -80, east: 180, north: 84 } },
  common_meta: { model: 'GFS', provider: 'open-meteo', domain: 'wind', layer: 'wind', is_estimated: false, region_id: 'global_mid',
    model_run_time: '2026-10-22T12:00:00Z', model_run_time_status: 'known', value_kind: 'wind_speed', value_unit: 'kn',
    display_unit_hint: 'kn', coverage: { west: -180, south: -80, east: 180, north: 85 } },
  frames: [FRAME,
    { valid_time: '2026-10-28T00:00:00Z', is_estimated: false, path: 'v1/x/beyond.bin',
      meta: { wind_lane: { ...STAMP, lane: 'gfs', reason: 'beyond_hrrr_horizon', valid_time: '2026-10-28T00:00:00Z' } } },
    { valid_time: '2026-10-28T03:00:00Z', is_estimated: false, path: null, unbuilt: 'not_local' }],
};
const WIND_MANIFEST = { products: [
  { model: 'GFS', domain: 'wind', layer: 'wind', region_id: 'global_mid', coverage: { west: -180, south: -80, east: 180, north: 85 } },
  { model: 'GFS', domain: 'wind', layer: 'wind', region_id: 'florida_east_coast', coverage: { west: -85, south: 24, east: -79, north: 31 } },
] };
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const NOW = Date.parse('2026-10-22T22:00:00Z');

let pointer;
function cdn() {
  global.fetch = jest.fn(async (url) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [WIND_SET_KEY]: { index: INDEX.path, run: INDEX.run } } });
    if (url === BASE + INDEX.path) return ok(INDEX);
    if (url === BASE + 'v1/wind_lane.json') return pointer ? ok(pointer) : { ok: false, status: 400, json: async () => ({}) };
    if (url === BASE + FRAME.path) return { ok: true, status: 200, arrayBuffer: async () => rawBuffer() };
    return { ok: false, status: 400, json: async () => ({}) };
  });
}

const realFetch = global.fetch;
let killBefore;
beforeEach(() => {
  killBefore = window.__RAW_DISABLE_STATIC_FRAMES__;
  delete window.__RAW_DISABLE_STATIC_FRAMES__;
  _resetStaticFramesForTest();
  _resetWindStaticForTest();
  window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
  window.__RAW_STATIC_FRAMES_BASE__ = BASE;
  setCachedManifest(WIND_MANIFEST);
  jest.spyOn(Date, 'now').mockImplementation(() => NOW);
  pointer = { ...LANE, written_at: '2026-10-22T20:00:00Z' };                // the box re-read it long ago (settled)
  cdn();
});
afterEach(() => {
  window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
  delete window.__RAW_STATIC_FRAMES_BASE__;
  delete window.__RAW_DISABLE_WIND_STATIC_FRAMES__;
  delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
  window.__RAW_DISABLE_STATIC_FRAMES__ = killBefore;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const ask = (b) => tryStaticWindGrid({ model: 'GFS', validTimeStr: VT, clampedBbox: b });

describe('static GFS wind frames', () => {
  test('the world box is the frame as /grid serves it: identity, times, lane stamp, every node', async () => {
    const j = await ask(WORLD);
    expect(j.product_id).toBe('gfs_wind_wind_global_mid_20261023T000000Z.json');
    expect([j.valid_time, j.served_valid_time, j.frame_substituted]).toEqual([VT, VT, false]);
    expect([j.coverage_scope, j.is_dynamic_viewport_product, j.stale]).toEqual(['regional', false, false]);
    expect(j.wind_lane).toEqual(STAMP);
    expect([j.grid.cols, j.grid.rows, j.grid.bounds]).toEqual([181, 83, { west: -180, south: -80, east: 180, north: 84 }]);
    expect(j.grid.vectors).toHaveLength(15023);
    expect(window.__RAW_WIND_STATIC__.hits).toBe(1);
  });

  test('a mid-zoom clip over CONUS is the resolver clip, with the lane stamp counted on the clip (golden: the real resolver)', async () => {
    const j = await ask({ west: -104, south: 8, east: -54, north: 50 });
    expect([j.grid.cols, j.grid.rows, j.grid.bounds]).toEqual([38, 34, { west: -116, south: -4, east: -42, north: 62 }]);
    expect([j.requested_bbox, j.served_bbox]).toEqual(['-116.0000,-4.0000,-42.0000,62.0000', '-116.0000,-4.0000,-42.0000,62.0000']);
    expect(j.wind_lane).toEqual({ ...STAMP, hrrr_cells: 351, hrrr_full_cells: 297, max_weight: 1 });
    const mid = j.grid.vectors[Math.floor(j.grid.vectors.length / 2)];
    expect([mid.lat, mid.lng, mid.direction]).toEqual([30, -116, 317.8]);           // the resolver: 9.8395 kn from 317.8
    expect(Math.abs(mid.speed - 9.8395)).toBeLessThanOrEqual(0.005);
  });

  test('a clip the lane never touches carries outside_hrrr_domain, as /grid stamps it', async () => {
    const j = await ask({ west: -30, south: 30, east: 20, north: 70 });
    expect([j.grid.cols, j.grid.rows]).toEqual([38, 33]);
    const { hrrr_cells: _a, hrrr_full_cells: _b, max_weight: _c, ...info } = STAMP;
    expect(j.wind_lane).toEqual({ ...info, lane: 'gfs', reason: 'outside_hrrr_domain' });
  });

  test('which boxes: the world and clips over the 20-deg sharpen cap; never a close zoom, a crossing, a covering tile', () => {
    expect(windBoxKind('GFS', WORLD)).toBe('world');
    expect(windBoxKind('GFS', { west: -104, south: 8, east: -54, north: 50 })).toBe('crop');
    expect(windBoxKind('GFS', { west: -90, south: 20, east: -70, north: 35 })).toBe(null);          // 20 deg: /grid sharpens
    expect(windBoxKind('GFS', { west: -91, south: 20, east: -70, north: 35 })).toBe('crop');        // 21 deg: the mid tier
    expect(windBoxKind('GFS', { west: 170, south: 0, east: -170, north: 30 })).toBe(null);          // antimeridian
    expect(windBoxKind('ICON', WORLD)).toBe(null);
    setCachedManifest({ products: [...WIND_MANIFEST.products,
      { model: 'GFS', domain: 'wind', layer: 'wind', region_id: 'big', coverage: { west: -120, south: 0, east: -60, north: 50 } }] });
    expect(windBoxKind('GFS', { west: -110, south: 10, east: -70, north: 40 })).toBe(null);         // not wider than a tile
    setCachedManifest(null);
    expect(windBoxKind('GFS', { west: -104, south: 8, east: -54, north: 50 })).toBe(null);          // no manifest: /grid decides
  });

  test('the lane check: served with its own stamp only when the box holds the frames\' lane and has re-read it', () => {
    const now = NOW;
    expect(laneVerdict(INDEX, FRAME, { ...LANE, written_at: '2026-10-22T20:00:00Z' }, now)).toEqual({ stamp: STAMP });
    const fresh = new Date(now - LANE_SETTLE_MS + 60000).toISOString();
    expect(laneVerdict(INDEX, FRAME, { ...LANE, written_at: fresh }, now)).toEqual({ refuse: 'lane_unsettled' });
    const other = { ...LANE, key: 'wind_lane/hrrr-2026102300.json', cycle: '2026-10-23T00:00:00Z', horizon: '2026-10-25T00:00:00Z', written_at: '2026-10-22T20:00:00Z' };
    expect(laneVerdict(INDEX, FRAME, other, now)).toEqual({ refuse: 'lane_mismatch' });
    // Beyond both windows the frame is GFS on both sides, and the stamp names the BOX's lane, as /grid stamps it.
    expect(laneVerdict(INDEX, INDEX.frames[1], other, now)).toEqual({ stamp: { lane: 'gfs', feather_km: 200, taper_hours: 3,
      hrrr_cycle: other.cycle, hrrr_horizon: other.horizon, source: LANE.source, valid_time: '2026-10-28T00:00:00Z', reason: 'beyond_hrrr_horizon' } });
    expect(laneVerdict(INDEX, FRAME, null, now)).toEqual({ refuse: 'no_lane_pointer' });
    window.__RAW_DISABLE_WIND_STATIC_LANE_HOURS__ = true;                 // the box may hold an older lane: lane hours ask /grid
    expect(laneVerdict(INDEX, FRAME, { ...LANE, written_at: '2026-10-22T20:00:00Z' }, now)).toEqual({ refuse: 'lane_hours_killed' });
    expect(laneVerdict(INDEX, INDEX.frames[1], other, now).stamp.reason).toBe('beyond_hrrr_horizon');   // later hours stay static
    delete window.__RAW_DISABLE_WIND_STATIC_LANE_HOURS__;
  });

  test('a mismatched lane, a missing pointer and an unbuilt hour all leave the hour to /grid', async () => {
    pointer = { ...LANE, key: 'wind_lane/hrrr-2026102300.json', cycle: '2026-10-23T00:00:00Z', written_at: '2026-10-22T20:00:00Z' };
    expect(await ask(WORLD)).toBe(null);
    _resetWindStaticForTest(); pointer = null;
    expect(await ask(WORLD)).toBe(null);
    _resetWindStaticForTest(); pointer = { ...LANE, written_at: '2026-10-22T20:00:00Z' };
    expect(await tryStaticWindGrid({ model: 'GFS', validTimeStr: '2026-10-28T03:00:00Z', clampedBbox: WORLD })).toBe(null);
    expect(window.__RAW_WIND_STATIC__.misses.unbuilt_frame).toBe(1);
  });

  test('the synchronous path serves only bytes already here, and the kills switch everything off', async () => {
    await Promise.all([windIndex(), readLanePointer(true)]);
    expect(staticWindGridSync({ model: 'GFS', validTimeStr: VT, clampedBbox: WORLD })).toBe(null);   // nothing fetched yet
    keepRaw(FRAME.path, rawBuffer());
    const j = staticWindGridSync({ model: 'GFS', validTimeStr: VT, clampedBbox: WORLD });
    expect(j && j.grid.cols).toBe(181);
    expect(STATIC_SETS).toContain(WIND_SET_KEY);
    window.__RAW_DISABLE_WIND_STATIC_FRAMES__ = true;
    expect(windStaticEnabled()).toBe(false);
    expect(staticWindGridSync({ model: 'GFS', validTimeStr: VT, clampedBbox: WORLD })).toBe(null);
    delete window.__RAW_DISABLE_WIND_STATIC_FRAMES__;
    window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = [WIND_SET_KEY];
    expect(windStaticEnabled()).toBe(false);
    delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
    window.__RAW_DISABLE_STATIC_FRAMES__ = true;
    expect(windStaticEnabled()).toBe(false);
  });

  test('a close-zoom view still needs /grid (the sharpened product); world and mid-zoom views do not', () => {
    expect(windViewportNeedsGrid('GFS', { west: -82, south: 26, east: -77, north: 30 })).toBe(true);
    expect(windViewportNeedsGrid('GFS', { west: -100, south: 10, east: -60, north: 45 })).toBe(false);
  });
});
