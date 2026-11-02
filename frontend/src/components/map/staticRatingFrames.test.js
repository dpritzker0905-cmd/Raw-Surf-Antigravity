/**
 * The Surf Rating band from RATED static frames (staticRatingFrames.js, 2026-11-01, item 10; ON by default since D-057).
 * Pins: the u32 RATING plane decodes in both layouts; buildVectors rebuilds the overlay's rated / masked vectors from it; the lever is
 * ON by default (D-057), off per browser (localStorage 0), killed by __RAW_DISABLE_RATING_FRAMES__; a surf ask is served only for a crop box /grid answers
 * from global_mid (never a world box, never a box the surf-only regional preference could hand a tile), only at an ask the frame
 * lists in ask_offsets_h, with the overlay's tag and per-box counts; the series lane never takes a surf page.
 */
import {
  _resetStaticFramesForTest, getPinnedRegionalIndexSync, pinnedRegionalKeys, staticEligible, staticSeriesEligible, staticSeriesFrames, tryStaticWorldGrid,
} from './staticFrames';
import { FIELD, RATING_CODE, buildVectors, parseFrame, ratingCounts } from './staticFrameCodec';
import { askOffsetServed, isRatedKey, ratedRegionalTile, ratedSetKey, ratingFramesOn, serverTileFirstSurf, surfRegionalMayWin } from './staticRatingFrames';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';
import { _setRegionalCodecForTest } from './staticRegional';

const BASE = 'https://cdn.test/weather-frames/';
const KEY = ratedSetKey('GFS', 'waves');
const VT = '2026-11-01T12:00:00Z';
const COLS = 181; const ROWS = 83;
const BOUNDS = { west: -180, south: -80, east: 180, north: 84 };

/** A minimal RSWF v1 encoder (frame_binary.encode_frame's layout) for test frames. */
function encodeFrame(planes, { cols = COLS, rows = ROWS, bounds = BOUNDS, validMs = Date.parse(VT) } = {}) {
  const n = cols * rows;
  const headerBytes = 72 + 24 * planes.length;
  const size = headerBytes + planes.reduce((a, p) => a + n * p.nb, 0);
  const buf = new ArrayBuffer(size); const dv = new DataView(buf); const u8 = new Uint8Array(buf);
  [0x52, 0x53, 0x57, 0x46].forEach((b, i) => { u8[i] = b; });
  dv.setUint16(4, 1, true); dv.setUint16(6, 1, true); dv.setUint16(8, cols, true); dv.setUint16(10, rows, true);
  dv.setUint32(12, planes.reduce((m, p) => m | (1 << p.id), 0), true);
  dv.setUint8(18, planes.length); dv.setUint8(19, 0); dv.setUint32(20, headerBytes, true);
  [bounds.west, bounds.south, bounds.east, bounds.north].forEach((v, i) => dv.setFloat64(24 + 8 * i, v, true));
  dv.setFloat64(56, validMs / 1000, true); dv.setFloat64(64, validMs / 1000 - 12 * 3600, true);
  let pos = headerBytes;
  planes.forEach((p, f) => {
    const d = 72 + 24 * f;
    dv.setUint8(d, p.id); dv.setUint8(d + 1, p.nb); dv.setUint8(d + 2, p.layout); dv.setUint32(d + 4, p.missing, true);
    dv.setFloat64(d + 8, p.scale, true); dv.setFloat64(d + 16, p.offset, true);
    for (let k = 0; k < n; k++) {
      const c = p.codes[k];
      for (let j = 0; j < p.nb; j++) {
        const byte = Math.floor(c / 256 ** j) % 256;
        if (p.layout === 1) u8[pos + j * n + k] = byte; else u8[pos + p.nb * k + j] = byte;
      }
    }
    pos += n * p.nb;
  });
  return buf;
}

const N = COLS * ROWS;
// A coastal band: column 50 rated (score 61.2 -> speed 6.12), column 51 masked, the rest untouched; height 1.5 m everywhere.
const ratingCode = (i) => (i % COLS === 50 ? RATING_CODE.RATED_BASE + 61200 : i % COLS === 51 ? RATING_CODE.MASKED : 0);
const PLANES = (layout = 1) => [
  { id: FIELD.HEIGHT, nb: 2, layout: 1, missing: 0, scale: 0.001, offset: -0.001, codes: Array.from({ length: N }, () => 1501) },
  { id: FIELD.DIRECTION, nb: 2, layout: 1, missing: 0xFFFFFFFF, scale: 0.01, offset: 0, codes: Array.from({ length: N }, () => 9000) },
  { id: FIELD.PERIOD, nb: 2, layout: 1, missing: 0xFFFF, scale: 0.01, offset: 0, codes: Array.from({ length: N }, () => 1100) },
  { id: FIELD.DIR_CONFIDENCE, nb: 1, layout: 0, missing: 0xFF, scale: 1 / 254, offset: 0, codes: Array.from({ length: N }, () => 254) },
  { id: FIELD.RATING, nb: 4, layout, missing: 0xFFFFFFFF, scale: 1, offset: 0, codes: Array.from({ length: N }, (_, i) => ratingCode(i)) },
];
const FRAME = encodeFrame(PLANES());
const INDEX = {
  version: 1, encoding_version: 1, transform_version: 1, path: 'v1/gfs/marine/waves/global_mid_rated/index/r.json', run: '2026-11-01T00:00:00Z',
  grid: { cols: COLS, rows: ROWS, bounds: BOUNDS },
  common_meta: {
    model: 'GFS', provider: 'test', domain: 'marine', layer: 'waves', is_estimated: true, ask_offsets_h: [-1, 0, 1],
    coverage: { west: -180, south: -80, east: 180, north: 85 },
    diagnostics: { surf_transform: { value_kind: 'surf_rating', wind: true, local_size: false, obs_gate: false } },
  },
  frames: [{ valid_time: VT, is_estimated: false, path: `v1/r/${VT}.bin`, meta: { product_id: 'gfs_marine_waves_global_mid_20261101T120000Z.json' } }],
};
const MANIFEST = { products: [
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'global_mid', coverage: { west: -180, south: -80, east: 180, north: 85 } },
  { model: 'GFS', domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: { west: -85, south: 24, east: -79, north: 31 } },
] };
const CROP = { west: -95 + 160, south: 20, east: -65 + 160, north: 35 };   // a 30 x 15 clip away from every regional tile
const WORLD = { west: -180, south: -80, east: 180, north: 85 };

beforeEach(() => {
  delete window.__RAW_DISABLE_STATIC_FRAMES__;
  delete window.__RAW_DISABLE_RATING_FRAMES__;
  delete window.__RAW_RATING_FRAMES__;
  delete window.__RAW_STATIC_FRAMES_RATED__;
  _resetStaticFramesForTest();
  window.localStorage.setItem('__RAW_STATIC_FRAMES__', 'true');
  window.localStorage.removeItem('__RAW_RATING_FRAMES__');
  window.__RAW_STATIC_FRAMES_BASE__ = BASE;
  setCachedManifest(MANIFEST);
  jest.spyOn(Date, 'now').mockImplementation(() => Date.parse(VT));
  global.fetch = jest.fn(async (url) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url === BASE + 'v1/latest.json') return ok({ version: 1, sets: { [KEY]: { index: INDEX.path, run: 'r' } } });
    if (url === BASE + INDEX.path) return ok(INDEX);
    if (url.endsWith('.bin')) return { ok: true, status: 200, arrayBuffer: async () => FRAME.slice(0) };
    return { ok: false, status: 400, json: async () => ({}) };
  });
});
afterEach(() => {
  window.localStorage.removeItem('__RAW_STATIC_FRAMES__');
  window.localStorage.removeItem('__RAW_RATING_FRAMES__');
  delete window.__RAW_STATIC_FRAMES_BASE__;
  window.__RAW_DISABLE_STATIC_FRAMES__ = true;
  jest.restoreAllMocks();
});

describe('the RATING plane and the rebuild', () => {
  test('u32 codes decode in both layouts, past 16 bits', () => {
    for (const layout of [0, 1]) {
      const planes = PLANES(layout);
      planes[4].codes[7] = 16777217; planes[4].codes[8] = 100002;
      const parsed = parseFrame(encodeFrame(planes));
      expect(parsed.fields[FIELD.RATING][7]).toBe(16777217);
      expect(parsed.fields[FIELD.RATING][8]).toBe(100002);
      expect(parsed.fields[FIELD.RATING][50]).toBe(RATING_CODE.RATED_BASE + 61200);
    }
  });

  test('buildVectors rebuilds the overlay: rated speed = score / 10 with phys_speed, masked = no data with phys_speed', () => {
    const v = buildVectors(parseFrame(FRAME));
    expect(v[50]).toMatchObject({ speed: 6.12, phys_speed: 1.5, is_valid: true, direction: 90, period: 11 });
    expect(v[51]).toMatchObject({ speed: 1.5, phys_speed: 1.5, is_valid: false });
    expect(v[52].phys_speed).toBeUndefined();
    expect(v[52]).toMatchObject({ speed: 1.5, is_valid: true });
    expect(ratingCounts(v)).toEqual({ rated: ROWS, masked: ROWS });
    const plain = parseFrame(FRAME); delete plain.fields[FIELD.RATING];
    expect(buildVectors(plain)[50]).toMatchObject({ speed: 1.5, is_valid: true });     // no plane: the stored product
  });
});

describe('the lever: ON by default (D-057), killable', () => {
  test('on by default, off per browser, the kill wins', () => {
    expect(ratingFramesOn()).toBe(true);
    window.localStorage.setItem('__RAW_RATING_FRAMES__', '0');
    expect(ratingFramesOn()).toBe(false);
    window.localStorage.setItem('__RAW_RATING_FRAMES__', '1');
    expect(ratingFramesOn()).toBe(true);
    window.__RAW_DISABLE_RATING_FRAMES__ = true;
    expect(ratingFramesOn()).toBe(false);
  });

  test('a surf ask is never static while killed (the /grid path)', async () => {
    window.__RAW_DISABLE_RATING_FRAMES__ = true;
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: CROP, surf: true })).toBe(false);
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: CROP, surf: true })).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('with the lever on', () => {
  beforeEach(() => { window.__RAW_RATING_FRAMES__ = true; });

  test('a crop box is served from the rated set with the overlay tag and its per-box counts', async () => {
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: CROP, surf: true })).toBe(true);
    const json = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: CROP, surf: true });
    expect(json).not.toBeNull();
    const st = json.grid.diagnostics.surf_transform;
    expect(st).toMatchObject({ value_kind: 'surf_rating', wind: true });
    expect(json.is_estimated).toBe(true);
    expect(json.grid.diagnostics.mid_res_tier).toBe(true);
    expect(st.rated + st.masked).toBe(0);                    // the crop (lng 65..95) holds no band column (lng -80, -78)
    expect(window.__RAW_STATIC_FRAMES_RATED__.hits).toBe(1);
    const band = await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: VT, clampedBbox: { west: -85 + 3 * 2 - 30, south: 20, east: -85 + 6, north: 35 }, surf: true });
    // lng -109..-79 holds column 50 (lng -80): its rated cells come back as the overlay serves them
    expect(band.grid.diagnostics.surf_transform.rated).toBeGreaterThan(0);
    expect(band.grid.vectors.some((v) => v.phys_speed === 1.5 && v.speed === 6.12)).toBe(true);
  });

  test('world boxes, regional-preference boxes and other asks keep /grid', async () => {
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: WORLD, surf: true })).toBe(false);
    const nearFl = { west: -90, south: 22, east: -76, north: 33 };            // <= 15 deg and over florida_east_coast
    expect(surfRegionalMayWin({ model: 'GFS', layer: 'waves', bboxStr: '-90,22,-76,33' })).toBe(true);
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: nearFl, surf: true })).toBe(false);
    const ask2h = new Date(Date.parse(VT) + 2 * 3600000).toISOString();     // picks the frame (nearest within 3 h), not rated for it
    expect(askOffsetServed(INDEX, INDEX.frames[0], Date.parse(ask2h))).toBe(false);
    expect(await tryStaticWorldGrid({ model: 'GFS', layer: 'waves', validTimeStr: ask2h, clampedBbox: CROP, surf: true })).toBeNull();
    expect(window.__RAW_STATIC_FRAMES_RATED__.misses.ask_offset).toBe(1);
    window.__RAW_DISABLE_RATING_FRAMES__ = true;
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: CROP, surf: true })).toBe(false);
  });

  test('the series lane never takes a surf page', async () => {
    expect(staticSeriesEligible({ model: 'GFS', layer: 'waves', bbox: CROP, surf: true })).toBe(false);
    expect(await staticSeriesFrames({ model: 'GFS', layer: 'waves', bbox: CROP, surf: true, hours: [0], anchorMs: Date.parse(VT), onFrames: () => {} })).toBeNull();
  });
});

describe('pilot boxes: the RATED regional bundles (0.25 deg, what the band paints from)', () => {
  const INSIDE_FL = { west: -82.5, south: 27.2, east: -80.2, north: 29.3 };          // a z8 box the florida_east_coast tile contains
  const caps = (on) => { window.__WEATHER_CAPABILITIES__ = [{ model: 'GFS', domain: 'marine', layer: 'waves', regional_tile_first_surf: on }]; };
  beforeEach(() => { window.__RAW_RATING_FRAMES__ = true; _setRegionalCodecForTest({ sha12: async () => 'x', gunzip: async (b) => b }); });   // jsdom: no crypto.subtle
  afterEach(() => { delete window.__WEATHER_CAPABILITIES__; _setRegionalCodecForTest(); });

  test('only while /capabilities reports regional_tile_first_surf: the tile key + _rated', () => {
    caps(false);
    expect(ratedRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-82.5,27.2,-80.2,29.3' })).toBeNull();
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: INSIDE_FL, surf: true })).toBe(false);   // /grid, as today
    caps(true);
    expect(serverTileFirstSurf()).toBe(true);
    const tile = ratedRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: '-82.5,27.2,-80.2,29.3' });
    expect(tile && tile.key).toBe('GFS/marine/waves/florida_east_coast_rated');
    expect(isRatedKey(tile.key)).toBe(true);
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: INSIDE_FL, surf: true })).toBe(true);
    window.__RAW_DISABLE_RATING_FRAMES__ = true;
    expect(staticEligible({ model: 'GFS', layer: 'waves', bbox: INSIDE_FL, surf: true })).toBe(false);
  });

  test('a rated bundle is never a waves source for the GPU store\'s regional crop show', () => {
    expect(pinnedRegionalKeys('GFS', 'waves').some(isRatedKey)).toBe(false);
    expect(getPinnedRegionalIndexSync('GFS/marine/waves/florida_east_coast_rated')).toBeNull();
  });
});
