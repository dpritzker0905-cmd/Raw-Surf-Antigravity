/**
 * The frame store's REGIONAL show (2026-10-24, z7-9): a window of a pilot tile's stored frame packed EXACTLY as the encoder packs the
 * clip the server (or the bundle) serves, and the runtime showing it while the engine holds a clip of a tile. REAL frames: one per
 * tile (florida_east_coast, us_west_coast_socal, uk_ireland) sliced from the published bundles (marineFrameStoreRegional.realFrames.fixture).
 */
import zlib from 'zlib';
import * as FX from './marineFrameStoreRegional.realFrames.fixture';
import { buildVectors, gridJsonFromFrame, parseFrame, seriesFrameFromFrame } from './staticFrameCodec';
import { cropSeriesFrame, cropVectors } from './staticFrameCrop';
import { regionalClipWindow, regionalGridJson } from './staticRegional';
import { frameWindowOf, packWindow } from './marineFrameStoreCrop';
import { findRegionalFrame, regionalInfoOf } from './marineFrameStoreRegional';
import { encodeMarineTexture } from './WebGLMarineTextureEncoder';
import { trimDeadEdges } from './marineEngineDecisions';
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';

const mockSF = { enabled: true, world: null, regional: {}, hooks: new Set(), loads: [] };
jest.mock('./staticFrames', () => ({
  staticFramesEnabled: () => mockSF.enabled,
  setKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,
  storeSetKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,   // the plain set (no filled set in these mocks)
  getPinnedIndexSync: (k) => (/global_mid$/.test(k) ? mockSF.world : null),            // as the real one: regional keys stay out
  getPinnedRegionalIndexSync: (k) => mockSF.regional[k] || null,
  pinnedRegionalKeys: () => Object.keys(mockSF.regional),
  getPinnedIndex: async () => mockSF.world,
  staticEligible: ({ model }) => String(model).toUpperCase() === 'GFS',
  onStaticFrameParsed: (fn) => { mockSF.hooks.add(fn); return () => mockSF.hooks.delete(fn); },
  loadFrameParsed: (key, frame, signal) => new Promise((resolve) => { mockSF.loads.push({ key, frame, signal, resolve }); }),
}));
import * as RT from './marineFrameStoreRuntime';

const TILES = {
  florida: { fx: FX.REAL_FLORIDA_EAST_COAST_FRAME_GZ_BASE64, meta: FX.REAL_FLORIDA_EAST_COAST_FRAME_META,
    boxes: ['-81.65,27.2,-79.58,28.9', '-84.5,25.5,-80.5,28.5', '-83.01,24.2,-79.3,26.8', '-84.9,29.1,-83.2,30.9'] },
  socal: { fx: FX.REAL_US_WEST_COAST_SOCAL_FRAME_GZ_BASE64, meta: FX.REAL_US_WEST_COAST_SOCAL_FRAME_META,
    boxes: ['-121,33,-117.5,35', '-119.7,33.4,-117.2,34.6', '-124.5,30.5,-119.5,35'] },
  uk: { fx: FX.REAL_UK_IRELAND_FRAME_GZ_BASE64, meta: FX.REAL_UK_IRELAND_FRAME_META, boxes: ['-6.5,50,-2,53', '-10.5,51.2,-5.1,55.7'] },
};
const parsedOf = (b64) => parseFrame(zlib.gunzipSync(Buffer.from(b64, 'base64')));
const vt = (k) => new Date(Date.UTC(2026, 9, 20, 0) + k * 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };
afterEach(() => { ['__WEBGL_MARINE_THEME__', '__RAW_DISABLE_FRAME_STORE_REGIONAL__', '__RAW_DISABLE_FRAME_STORE_CROP__', '__MARINE_DRAWN__'].forEach((k) => delete window[k]); });

// ── the encoder, as marineFrameStoreCrop.test.js reaches it ───────────────────────────────────────────────────────────────────
function conform(vectors, layer = 'waves') {
  return vectors.map((v) => {
    const flat = v && typeof v.speed === 'number' && typeof v.u === 'number';
    const d = v && v[layer] ? v[layer] : (flat ? v : (v[layer] || v.waves));
    const dirConfidence = d && typeof d.dirConfidence === 'number' ? d.dirConfidence : (d && typeof d.dir_confidence === 'number' ? d.dir_confidence
      : (v && typeof v.dirConfidence === 'number' ? v.dirConfidence : (v && typeof v.dir_confidence === 'number' ? v.dir_confidence : null)));
    return { lat: v.lat, lng: v.lng, u: d?.u || 0, v: d?.v || 0, speed: d?.speed || 0, period: d?.period || 0,
      height: d?.height !== undefined ? d.height : (d?.speed || 0), direction: d?.direction !== undefined ? d.direction : undefined, isOcean: v.isOcean,
      dirConfidence, phys_speed: typeof v.phys_speed === 'number' ? v.phys_speed : (d && typeof d.phys_speed === 'number' ? d.phys_speed : undefined), [layer]: d };
  });
}
function encoderBytes(grid) {
  const g = trimDeadEdges(grid) || grid;
  let handle = 0; let bound = null; let flipY = false; const uploads = new Map();
  const gl = {
    TEXTURE_2D: 'TEXTURE_2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UNSIGNED_BYTE', LINEAR: 'LINEAR', NEAREST: 'NEAREST', CLAMP_TO_EDGE: 'CLAMP_TO_EDGE',
    TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG', TEXTURE_BINDING_2D: 'TEXTURE_BINDING_2D',
    UNPACK_FLIP_Y_WEBGL: 'UNPACK_FLIP_Y_WEBGL',
    getParameter: (p) => (p === 'TEXTURE_BINDING_2D' ? bound : p === 'UNPACK_FLIP_Y_WEBGL' ? flipY : null),
    createTexture: () => ({ __tex: ++handle }), deleteTexture: () => {}, bindTexture: (_t, tex) => { bound = tex; },
    texParameteri: () => {}, pixelStorei: (p, val) => { if (p === 'UNPACK_FLIP_Y_WEBGL') flipY = val; },
    texImage2D: (...a) => { if (a.length >= 9 && bound) uploads.set(bound, { width: a[3], height: a[4], data: a[8] ? Uint8Array.from(a[8]) : null }); },
    texSubImage2D: () => {},
  };
  const out = encodeMarineTexture(gl, g, null, {}, undefined);
  const wave = uploads.get(out.u_waveTexture);
  return { bytes: wave.data, cols: wave.width, rows: wave.height };
}
const indexOf = (t, parsed, n = 1) => ({ path: `v1/idx/${t.meta.key}.json`, run: t.meta.run, grid: t.meta.grid, common_meta: { model: 'GFS', provider: 'open-meteo', layer: 'waves' },
  frames: Array.from({ length: n }, (_, k) => ({ valid_time: vt(k), path: `bundle#${k}`, meta: { product_id: `${t.meta.product_id.replace(/\d{8}T\d{6}Z/, vt(k).replace(/[-:]/g, ''))}` } })) });

describe('packWindow on a pilot tile: the clip\'s own encoder bytes (real tile frames, both static lanes, three themes)', () => {
  Object.entries(TILES).forEach(([name, t]) => {
    const PARSED = parsedOf(t.fx);
    const IG = { bounds: PARSED.bounds, cols: PARSED.cols, rows: PARSED.rows };
    const INDEX = indexOf(t, PARSED);
    const VECTORS = buildVectors(PARSED);
    t.boxes.forEach((b) => ['dark', 'light', 'beach'].forEach((theme) => it(`${name} ${b}, ${theme}`, () => {
      window.__WEBGL_MARINE_THEME__ = theme;
      const [w, s, e, n] = b.split(',').map(Number);
      const win = regionalClipWindow(b, INDEX.grid, 'GFS');
      expect(win && win.covers).toBe(true);
      const cropped = cropVectors(VECTORS, IG.cols, win);
      // seam A: the regional /grid JSON -> the mapper -> the conform -> trim -> encode
      const json = regionalGridJson(gridJsonFromFrame(INDEX, INDEX.frames[0], VECTORS, { askIso: vt(0), requestedBbox: { west: w, south: s, east: e, north: n } }), win, cropped, b);
      const mapped = mapNormalizedGridToWebGL(json, { west: w, south: s, east: e, north: n }, 0, 'waves', 'GFS');
      const refA = encoderBytes({ ...mapped.grid, vectors: conform(mapped.grid.vectors) });
      // seam B: the regional series frame -> the conform -> trim -> encode
      const sf = cropSeriesFrame(seriesFrameFromFrame(INDEX, INDEX.frames[0], VECTORS, { hourOffset: 0, askIso: vt(0) }), { ...win, clip: win.snapped }, cropped);
      const refB = encoderBytes({ vectors: conform(sf.vectors), bounds: sf.bounds, cols: sf.cols, rows: sf.rows, __componentLayer: 'waves', __sourceModel: 'GFS' });
      const fw = frameWindowOf({ bounds: win.bounds, cols: win.cols, rows: win.rows }, IG);
      expect(fw).not.toBeNull();
      const p = packWindow(PARSED, fw);
      for (const ref of [refA, refB]) {
        expect([p.cols, p.rows]).toEqual([ref.cols, ref.rows]);
        expect(firstDiff(p.bytes, ref.bytes)).toBe(-1);
      }
    })));
  });
});

describe('which tile frame is a committed grid', () => {
  const t = TILES.florida;
  const info = regionalInfoOf('GFS/marine/waves/florida_east_coast', indexOf(t, null, 4));
  it('regionalInfoOf: a key engineHolds can read (model / layer first), the run in it, frames by product id', () => {
    expect(info.key).toBe(`GFS/waves/florida_east_coast/${t.meta.run}`);
    expect(info.regional).toBe(true);
    expect(info.validTimes).toHaveLength(4);
  });
  it('by product id only: a dynamic viewport product, a global_mid clip and a grid without an id are none', () => {
    const pid = [...info.byPid.keys()][2];
    expect(findRegionalFrame([info], { productId: pid })).toMatchObject({ validTime: vt(2) });
    expect(findRegionalFrame([info], { __servedProductId: pid }).validTime).toBe(vt(2));
    expect(findRegionalFrame([info], { __storedProductId: pid, __fromSeries: true }).validTime).toBe(vt(2));   // a series commit (the conform carries it)
    expect(findRegionalFrame([info], { productId: 'viewport_gfs_marine_waves_-82.00_27.00_-79.00_29.00' })).toBeNull();
    expect(findRegionalFrame([info], { productId: 'gfs_marine_waves_global_mid_20261020T060000Z.json' })).toBeNull();
    expect(findRegionalFrame([info], {})).toBeNull();
  });
});

describe('the runtime shows the tile window of the stepped-to frame', () => {
  const t = TILES.florida;
  const PARSED = parsedOf(t.fx);
  const IG = { bounds: PARSED.bounds, cols: PARSED.cols, rows: PARSED.rows };
  const KEY = 'GFS/marine/waves/florida_east_coast';
  const BOX = '-81.65,27.2,-79.58,28.9';
  const WIN = regionalClipWindow(BOX, IG, 'GFS');
  const pidOf = (k) => `gfs_marine_waves_florida_east_coast_${vt(k).replace(/[-:]/g, '')}.json`;
  const GRID = (k, extra = {}) => ({ bounds: WIN.bounds, cols: WIN.cols, rows: WIN.rows, productId: pidOf(k), served_valid_time: vt(k), __sourceModel: 'GFS', __componentLayer: 'waves', ...extra });
  const PACK = packWindow(PARSED, frameWindowOf(GRID(0), IG));

  function setup(n = 8, run = 'r1') {
    RT._resetFrameStoreRuntimeForTest(); mockSF.hooks.clear(); mockSF.loads = []; mockSF.enabled = true;
    mockSF.world = { path: 'v1/idx/world.json', run: 'w', grid: { bounds: { west: -180, south: -80, east: 180, north: 84 }, cols: 181, rows: 83 },
      frames: Array.from({ length: n }, (_, k) => ({ valid_time: vt(k), path: `v1/w/${k}.bin`, meta: { product_id: `world${k}` } })) };
    mockSF.regional = { [KEY]: { path: 'v1/idx/fl.json', run, grid: IG, frames: Array.from({ length: n }, (_, k) => ({ valid_time: vt(k), path: `bundle#${k}`, meta: { product_id: pidOf(k) } })) } };
    const calls = [];
    const gl = { TEXTURE_2D: 'T2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UB', TEXTURE_BINDING_2D: 'B2D', UNPACK_FLIP_Y_WEBGL: 'FLIP', UNPACK_PREMULTIPLY_ALPHA_WEBGL: 'PRE',
      getParameter: () => null, bindTexture: () => {}, pixelStorei: () => {}, texSubImage2D: (...a) => calls.push(a[8]) };
    const eng = { _residentWaveTex: { wave: true }, _texWidth: PACK.cols, _texHeight: PACK.rows,
      _waveData: { waveGrid: { cols: PACK.cols, rows: PACK.rows, bounds: { ...PACK.bounds }, hourOffset: 0, __sourceModel: 'GFS', __componentLayer: 'waves' } } };
    RT.registerFrameStoreTarget({ getEngine: () => eng, getGl: () => gl, getMap: () => ({ triggerRepaint: jest.fn() }) });
    return { calls, eng };
  }
  const settle = async () => { for (let i = 0; i < 10; i++) { mockSF.loads.filter((l) => !l.done).forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); }); await flush(); } };
  const step = (k, m = 'GFS', l = 'waves') => RT.tryShowStoredFrame({ model: m, layer: l, hourOffset: k * 3, requestedValidTime: vt(k) });
  const commit0 = () => RT.noteCommitted(GRID(0), { hour: 0, model: 'GFS', layer: 'waves' });

  it('a tile clip becomes the resident once its window pack exists; a step shows the next frame\'s window, exactly', async () => {
    const { calls, eng } = setup();
    commit0();
    expect(window.__RAW_FRAME_STORE__.commits.resident_crop_regional).toBe(1);
    await settle();
    expect(window.__RAW_FRAME_STORE__.crop.resident).toMatchObject({ crop: true, regional: true, window: { cols: WIN.cols, rows: WIN.rows }, cols: PACK.cols, rows: PACK.rows });
    expect(step(1)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(firstDiff(calls[0], PACK.bytes)).toBe(-1);
    expect(eng._waveData.waveGrid).toMatchObject({ hourOffset: 3, served_valid_time: vt(1), productId: pidOf(1), __fromFrameStore: true, bounds: PACK.bounds });
    expect(window.__RAW_FRAME_STORE__.shows.regional).toBe(1);
  });

  async function drain(max = 400) {
    for (let i = 0, quiet = 0; i < max && quiet < 3; i++) {
      const open = mockSF.loads.filter((l) => !l.done);
      open.forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); });
      quiet = open.length ? 0 : quiet + 1;
      await flush();
    }
  }

  it('the whole run\'s window packs are built from the bundle in memory, in idle time, with no store entry and no extra set', async () => {
    setup(40);
    commit0();
    await drain();
    expect(window.__RAW_FRAME_STORE__.crop.built).toBe(40);
    expect(step(39)).toBe(true);
    expect(step(20)).toBe(true);
    expect(window.__RAW_FRAME_STORE__.shows.misses.crop_not_ready).toBeUndefined();
  }, 60000);

  it('a step to a frame whose pack is not built misses, builds it and shows it when it lands', async () => {
    const { calls } = setup();
    commit0();
    mockSF.loads.forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); });   // only the resident's own frame
    for (let i = 0; i < 8; i++) await Promise.resolve();             // microtasks only: the idle build-ahead chains have not issued a load yet
    expect(window.__RAW_FRAME_STORE__.crop.resident).not.toBeNull();
    expect(step(5)).toBe(false);
    expect(window.__RAW_FRAME_STORE__.shows.misses.crop_not_ready).toBe(1);
    await settle();
    expect(calls).toHaveLength(1);                                    // the deferred show
    expect(window.__RAW_FRAME_STORE__.shows.deferred).toBe(1);
  });

  it('fail closed: a dynamic viewport product of the same box, a rating grid and another model or layer are never the resident', async () => {
    const { calls } = setup();
    RT.noteCommitted(GRID(0, { productId: 'viewport_gfs_marine_waves_-82.00_27.00_-79.00_29.00' }), { hour: 0, model: 'GFS', layer: 'waves' });
    RT.noteCommitted(GRID(0, { ratingMode: true }), { hour: 0, model: 'GFS', layer: 'waves' });
    RT.noteCommitted(GRID(0), { hour: 0, model: 'ICON', layer: 'waves' });
    RT.noteCommitted(GRID(0), { hour: 0, model: 'GFS', layer: 'swell_1' });
    await settle();
    expect(window.__RAW_FRAME_STORE__.crop.resident).toBeNull();
    expect(step(1)).toBe(false);
    expect(calls).toHaveLength(0);
    commit0(); await settle();
    expect(step(1, 'ICON')).toBe(false);                             // another model: the normal path
    expect(step(1, 'GFS', 'swell_1')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('kill switch: nothing is taken or shown (the world store behaves as before)', async () => {
    const { calls } = setup();
    window.__RAW_DISABLE_FRAME_STORE_REGIONAL__ = true;
    commit0(); await settle();
    expect(window.__RAW_FRAME_STORE__.commits.resident_crop_regional).toBeUndefined();
    expect(step(1)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  // Three scenarios, three tests: each one pays a full commit0 + settle (the resident's window pack is real encoding work, ~0.7 s on a
  // quiet box), and chained in ONE test they took ~2.4 s against Jest's 5 s limit, so a loaded full-tree run timed it out
  // (2026-10-25). One scenario per test keeps every assertion and gives each its own budget.
  it('a re-pinned run ends it: the packs are of the old run', async () => {
    const first = setup();
    commit0(); await settle();
    expect(step(1)).toBe(true);
    mockSF.regional = { [KEY]: { ...mockSF.regional[KEY], path: 'v1/idx/fl2.json', run: 'r2' } };   // re-pinned: the packs are of the old run
    expect(step(2)).toBe(false);
    expect(first.calls).toHaveLength(1);
  });

  it('a set killed after the pin ends it', async () => {
    setup(); commit0(); await settle();
    mockSF.regional = {};                                              // the set was killed after the pin
    expect(step(1)).toBe(false);
  });

  it('a world frame the engine took ends it', async () => {
    const third = setup(); commit0(); await settle();
    Object.assign(third.eng, { _texWidth: 181, _texHeight: 81 });
    expect(step(1)).toBe(false);                                       // the engine no longer holds the clip (zoom-out)
    expect(window.__RAW_FRAME_STORE__.crop.resident).toBeNull();
  });

  it('a frame the shared loader parses while the window is resident gets its window pack at once (the parse hook)', async () => {
    setup(8);
    commit0();
    mockSF.loads.forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); });   // only the resident's own frame
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const before = window.__RAW_FRAME_STORE__.crop.built;
    const fn = [...mockSF.hooks][0];
    fn({ key: KEY, frame: mockSF.regional[KEY].frames[6], parsed: PARSED, buffer: null });
    await flush();
    expect(window.__RAW_FRAME_STORE__.crop.built).toBeGreaterThan(before);
    expect(step(6)).toBe(true);
  });

  it('a re-pinned run is not the resident: the step does not wait on packs of the old run', async () => {
    setup();
    commit0(); await settle();
    mockSF.regional = { [KEY]: { ...mockSF.regional[KEY], path: 'v1/idx/fl2.json', run: 'r2' } };
    expect(step(2)).toBe(false);
    expect(window.__RAW_FRAME_STORE__.shows.misses.crop_not_ready).toBeUndefined();
  });

  it('another tile\'s frame (same lattice) gets no pack of this tile\'s window', async () => {
    setup();
    const KEY2 = 'GFS/marine/waves/florida_other';
    mockSF.regional[KEY2] = { ...mockSF.regional[KEY], path: 'v1/idx/fl_other.json', frames: mockSF.regional[KEY].frames.map((f) => ({ ...f, meta: { product_id: `o_${f.meta.product_id}` } })) };
    commit0(); await settle();
    const before = window.__RAW_FRAME_STORE__.crop.built;
    for (const fn of mockSF.hooks) fn({ key: KEY2, frame: mockSF.regional[KEY2].frames[3], parsed: PARSED, buffer: null });
    await flush();
    expect(window.__RAW_FRAME_STORE__.crop.built).toBe(before);
  });

  it('a regional window never takes a world set\'s frame, and a world window never takes a tile\'s', async () => {
    setup();
    commit0(); await settle();
    const wi = { key: 'GFS/waves/world/r', staticKey: 'GFS/marine/waves/global_mid', index: mockSF.world, byVt: new Map(), validTimes: [] };
    expect(window.__RAW_FRAME_STORE__.crop.window.regional).toBe(true);
    // a world frame parsed while the tile window is resident must not get a pack of that window
    const before = window.__RAW_FRAME_STORE__.crop.built;
    for (const fn of mockSF.hooks) fn({ key: 'GFS/marine/waves/global_mid', frame: mockSF.world.frames[3], parsed: PARSED, buffer: null });
    await flush();
    expect(window.__RAW_FRAME_STORE__.crop.built).toBe(before);
    expect(wi.key).toBeTruthy();
  });
});
