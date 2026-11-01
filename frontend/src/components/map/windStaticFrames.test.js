/**
 * Static GFS wind frames (2026-10-22, the wind instant scrub): windStaticFrames.js on ONE REAL frame (the published bytes of the
 * 2026-10-22 12Z run, valid 10-23T00Z, the HRRR lane of 10-22 18Z applied). The golden values below are what the REAL resolver
 * served for the same frame and boxes (serve_synthetic.py --real-wind --real-wind-lane, 2026-10-22): the world response, a
 * mid-zoom clip over CONUS (the lane stamp counted on the clip) and one over Europe (outside_hrrr_domain).
 */
import zlib from 'zlib';

jest.mock('../../lib/apiClient', () => ({ BACKEND_URL: 'https://backend.test' }));
import {
  WIND_SET_KEY, LANE_SETTLE_MS, _resetWindStaticForTest, _setBoxLaneForTest, boxLane, keepRaw, laneVerdict, readBoxLane, staticWindGridSync, tryStaticWindGrid,
  windBoxKind, windIndex, readLanePointer, windStaticEnabled, windViewportNeedsGrid,
} from './windStaticFrames';
import { _resetStaticFramesForTest, STATIC_SETS } from './staticFrames';
import { computeJsDataHash } from './weatherTruthTracker';
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
// /capabilities' GFS wind row as the box reports it (wind_lane.box_state): the frames' own constants.
const BOX = { enabled: true, feather_km: 200, taper_hours: 3 };
// GET /api/weather/wind_lane: the box HOLDS the frames' lane (wind_lane.box_state with the lane in memory).
const HELD = { ...BOX, key: LANE.key, cycle: LANE.cycle, horizon: LANE.horizon, source: LANE.source, refresh_error: null };

let pointer;
let box;
const extraJson = {};                                                      // more CDN JSON objects a test serves (path -> body)
function cdn() {
  global.fetch = jest.fn(async (url) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [WIND_SET_KEY]: { index: INDEX.path, run: INDEX.run } } });
    if (url === BASE + INDEX.path) return ok(INDEX);
    if (url.startsWith(BASE) && extraJson[url.slice(BASE.length)]) return ok(extraJson[url.slice(BASE.length)]);
    if (url === BASE + 'v1/wind_lane.json') return pointer ? ok(pointer) : { ok: false, status: 400, json: async () => ({}) };
    if (url === 'https://backend.test/api/weather/wind_lane') return box ? ok(box) : { ok: false, status: 503, json: async () => ({}) };
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
  window.__WEATHER_CAPABILITIES__ = [{ model: 'GFS', domain: 'wind', layer: 'wind', wind_lane: BOX }];
  box = HELD;
  _setBoxLaneForTest(HELD);                                                  // read at NOW: fresh
  cdn();
});
afterEach(() => {
  window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
  delete window.__RAW_STATIC_FRAMES_BASE__;
  delete window.__RAW_DISABLE_WIND_STATIC_FRAMES__;
  delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__;
  window.__RAW_DISABLE_STATIC_FRAMES__ = killBefore;
  delete window.__WEATHER_CAPABILITIES__;
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

  test('the truth tag names a content-addressed frame by its sha256 (+ crop), not by hashing 15k vectors; the kill hashes them', async () => {
    const vectorHash = (j) => computeJsDataHash([...j.grid.vectors], 'wind');     // a copy: no cached key, the full walk
    FRAME.sha256 = 'ab'.repeat(32);
    try {
      const world = await ask(WORLD);
      const clip = await ask({ west: -104, south: 8, east: -54, north: 50 });
      expect(world.truthTag && world.truthTag.traceId).toBeTruthy();
      expect(world.grid.vectors.__jsDataHash_wind).toMatch(/^[0-9a-f]{8}$/);
      expect(world.grid.vectors.__jsDataHash_wind).not.toBe(vectorHash(world));
      expect(clip.grid.vectors.__jsDataHash_wind).not.toBe(world.grid.vectors.__jsDataHash_wind);
      FRAME.sha256 = 'cd'.repeat(32);                                             // other bytes: another hash
      _resetStaticFramesForTest(); _resetWindStaticForTest(); _setBoxLaneForTest(HELD);
      expect((await ask(WORLD)).grid.vectors.__jsDataHash_wind).not.toBe(world.grid.vectors.__jsDataHash_wind);
      window.__RAW_DISABLE_WIND_FRAME_HASH_SEED__ = true;
      _resetStaticFramesForTest(); _resetWindStaticForTest(); _setBoxLaneForTest(HELD);
      const killed = await ask(WORLD);
      expect(killed.grid.vectors.__jsDataHash_wind).toBe(vectorHash(killed));
    } finally {
      delete FRAME.sha256;
      delete window.__RAW_DISABLE_WIND_FRAME_HASH_SEED__;
    }
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
    // Beyond both windows the frame is GFS on both sides, and the stamp names the lane the BOX holds (here still the frames'),
    // as /grid stamps it, not the newer one the pointer names.
    expect(laneVerdict(INDEX, INDEX.frames[1], other, now)).toEqual({ stamp: { lane: 'gfs', feather_km: 200, taper_hours: 3,
      hrrr_cycle: LANE.cycle, hrrr_horizon: LANE.horizon, source: LANE.source, valid_time: '2026-10-28T00:00:00Z', reason: 'beyond_hrrr_horizon' } });
    expect(laneVerdict(INDEX, FRAME, null, now)).toEqual({ refuse: 'no_lane_pointer' });
    window.__RAW_DISABLE_WIND_STATIC_LANE_HOURS__ = true;                 // the box may hold an older lane: lane hours ask /grid
    expect(laneVerdict(INDEX, FRAME, { ...LANE, written_at: '2026-10-22T20:00:00Z' }, now)).toEqual({ refuse: 'lane_hours_killed' });
    expect(laneVerdict(INDEX, INDEX.frames[1], other, now).stamp.reason).toBe('beyond_hrrr_horizon');   // later hours stay static
    delete window.__RAW_DISABLE_WIND_STATIC_LANE_HOURS__;
  });

  test('lane hours need the BOX to hold the frames\' lane: a box on an older cycle sends them to /grid (live, 2026-10-23)', () => {
    const now = NOW;
    const ptr = { ...LANE, written_at: '2026-10-22T20:00:00Z' };   // the pointer names the frames' lane, settled
    const caps = (lane) => [{ model: 'GFS', domain: 'marine', layer: 'waves' }, { model: 'GFS', domain: 'wind', layer: 'wind', ...(lane ? { wind_lane: lane } : {}) }];
    expect(boxLane()).toEqual(HELD);
    expect(laneVerdict(INDEX, FRAME, ptr, now)).toEqual({ stamp: STAMP });
    // The incident: L2 and the pointer named the new cycle, the box still blended a 12 h older one.
    const older = { ...HELD, key: 'wind_lane/hrrr-2026102206.json', cycle: '2026-10-22T06:00:00Z', horizon: '2026-10-24T06:00:00Z' };
    _setBoxLaneForTest(older);
    expect(laneVerdict(INDEX, FRAME, ptr, now)).toEqual({ refuse: 'box_lane_differs' });
    // Past both windows the frame is GFS on both sides; /grid's stamp names the lane the BOX holds, not the pointer's.
    expect(laneVerdict(INDEX, INDEX.frames[1], ptr, now)).toEqual({ stamp: { lane: 'gfs', feather_km: 200, taper_hours: 3,
      hrrr_cycle: older.cycle, hrrr_horizon: older.horizon, source: LANE.source, valid_time: '2026-10-28T00:00:00Z', reason: 'beyond_hrrr_horizon' } });
    _setBoxLaneForTest({ ...HELD, feather_km: 350 });                                             // a Render override
    expect(laneVerdict(INDEX, FRAME, ptr, now)).toEqual({ refuse: 'box_lane_differs' });
    _setBoxLaneForTest({ ...HELD, key: null, cycle: null, horizon: null });                       // no lane loaded yet
    expect(laneVerdict(INDEX, FRAME, ptr, now)).toEqual({ refuse: 'box_lane_unconfirmed' });
    _setBoxLaneForTest(null);                                                                     // no box read: /capabilities
    expect(boxLane()).toEqual(BOX);                                                               // constants only, never a key
    expect(laneVerdict(INDEX, FRAME, ptr, now)).toEqual({ refuse: 'box_lane_unconfirmed' });
    try {
      window.__WEATHER_CAPABILITIES__ = caps({ ...HELD });                                        // a key there is a page-load snapshot
      expect(boxLane().key).toBe(undefined);
      window.__WEATHER_CAPABILITIES__ = caps({ enabled: false, feather_km: 200, taper_hours: 3 });  // WIND_HRRR_LANE=0 on the box
      expect(laneVerdict(INDEX, INDEX.frames[1], ptr, now)).toEqual({ refuse: 'box_lane_off' });
    } finally {
      window.__WEATHER_CAPABILITIES__ = caps(BOX);   // afterEach removes it
    }
  });

  test('the pointer\'s lane-window rebuild of the SAME run replaces the published index; another run or the kill keeps it', async () => {
    const NEW = { ...LANE, key: 'wind_lane/hrrr-2026102221.json', cycle: '2026-10-22T21:00:00Z', horizon: '2026-10-24T21:00:00Z' };
    const REBUILT = { ...INDEX, path: 'v1/gfs/wind/wind/global_mid/index/r-rebuilt.json', wind_lane: NEW };
    extraJson[REBUILT.path] = REBUILT;
    const point = (run) => ({ ...NEW, written_at: '2026-10-22T20:00:00Z', frames: { index: REBUILT.path, run, lane: NEW.key } });
    try {
      pointer = point(INDEX.run);
      _resetWindStaticForTest(); await readLanePointer(true);
      expect((await windIndex()).path).toBe(REBUILT.path);                 // the frames now carry the pointer's (the box's) lane
      _setBoxLaneForTest({ ...HELD, key: NEW.key, cycle: NEW.cycle, horizon: NEW.horizon });
      expect(laneVerdict(REBUILT, REBUILT.frames[0], pointer).stamp).toBeTruthy();                // served for the new lane
      window.__RAW_DISABLE_WIND_LANE_REBUILT_INDEX__ = true;                // the kill: the published index only
      _resetWindStaticForTest(); await readLanePointer(true);
      expect((await windIndex()).path).toBe(INDEX.path);
      delete window.__RAW_DISABLE_WIND_LANE_REBUILT_INDEX__;
      pointer = point('2026-10-22T06:00:00Z');                              // a rebuild of ANOTHER run: never mixed in
      _resetWindStaticForTest(); await readLanePointer(true);
      expect((await windIndex()).path).toBe(INDEX.path);
      pointer = { ...point(INDEX.run), key: LANE.key };                     // frames.lane is not the pointer's lane
      _resetWindStaticForTest(); await readLanePointer(true);
      expect((await windIndex()).path).toBe(INDEX.path);
    } finally {
      delete window.__RAW_DISABLE_WIND_LANE_REBUILT_INDEX__;
      delete extraJson[REBUILT.path];
    }
  });

  test('a box whose lane refresh FAILED keeps an older lane: lane hours go to /grid, later hours name the box lane', async () => {
    // What /api/weather/wind_lane reports when the box could not read L2 (wind_lane.refresh -> refresh_error) and still holds
    // the previous cycle, while the frames and the pointer name the new one.
    box = { ...HELD, key: 'wind_lane/hrrr-2026102212.json', cycle: '2026-10-22T12:00:00Z', horizon: '2026-10-24T12:00:00Z',
      refresh_error: 'IndexUnreadable' };
    _resetWindStaticForTest();
    expect(await ask(WORLD)).toBe(null);                                                          // the caller asks /grid
    expect(window.__RAW_WIND_STATIC__.misses.box_lane_differs).toBeGreaterThan(0);
    box = HELD;                                                                                   // the refresh recovers
    _resetWindStaticForTest();
    expect(await ask(WORLD)).not.toBe(null);
  });

  test('the box read: GET /api/weather/wind_lane on the pointer\'s TTL; too old or failed confirms nothing', async () => {
    _resetWindStaticForTest();
    expect(await readBoxLane()).toEqual(HELD);
    expect(global.fetch).toHaveBeenCalledWith('https://backend.test/api/weather/wind_lane', { credentials: 'omit' });
    expect(boxLane()).toEqual(HELD);
    Date.now.mockImplementation(() => NOW + 301000);                                              // older than 300 s
    expect(boxLane()).toEqual(BOX);                                                               // back to constants only
    box = null;                                                                                   // the box errors
    expect(await readBoxLane(true)).toBe(null);
    expect(boxLane()).toEqual(BOX);
    expect(laneVerdict(INDEX, FRAME, { ...LANE, written_at: '2026-10-22T20:00:00Z' })).toEqual({ refuse: 'box_lane_unconfirmed' });
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
