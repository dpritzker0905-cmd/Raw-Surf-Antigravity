/**
 * The frame store's CROP show (2026-10-22): a window of the static frame packed EXACTLY as the encoder packs the clip, and the
 * runtime showing it when a clip of the same frame lattice is resident. One REAL GFS world frame (marineFramePack's fixture).
 */
import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import { buildVectors, gridJsonFromFrame, parseFrame, seriesFrameFromFrame } from './staticFrameCodec';
import { cropGridJson, cropSeriesFrame, cropVectors, midClipWindow } from './staticFrameCrop';
import { CROP_AHEAD, CROP_AHEAD_RUN, CROP_AHEAD_SMALL, cropAheadCount, cropAheadOrder, cropToleranceCells, frameWindowOf, packWindow, createCropPacks } from './marineFrameStoreCrop';
import { encodeMarineTexture } from './WebGLMarineTextureEncoder';
import { trimDeadEdges } from './marineEngineDecisions';
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';

const mockSF = { enabled: true, index: null, hooks: new Set(), loads: [] };
jest.mock('./staticFrames', () => ({
  staticFramesEnabled: () => mockSF.enabled,
  setKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,
  storeSetKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,   // the plain set (no filled set in these mocks)
  getPinnedIndexSync: () => mockSF.index,
  getPinnedIndex: async () => mockSF.index,
  staticEligible: ({ model }) => String(model).toUpperCase() === 'GFS',   // #458's model-toggle warm reads it: one published set
  onStaticFrameParsed: (fn) => { mockSF.hooks.add(fn); return () => mockSF.hooks.delete(fn); },
  loadFrameParsed: (key, frame, signal) => new Promise((resolve) => { mockSF.loads.push({ key, frame, signal, resolve }); }),
}));
import * as RT from './marineFrameStoreRuntime';

const PARSED = parseFrame(zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64')));
const IG = { bounds: PARSED.bounds, cols: PARSED.cols, rows: PARSED.rows };
const KEY = 'GFS/marine/waves/global_mid';
const vt = (k) => new Date(Date.UTC(2026, 9, 20, 0) + k * 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
afterEach(() => { ['__WEBGL_MARINE_THEME__', '__RAW_DISABLE_FRAME_STORE_CROP__', '__MARINE_DRAWN__', '__RAW_DISABLE_DIR_DILATION__'].forEach((k) => delete window[k]); });

// ── the encoder, as marineFramePack.parity.test.js reaches it ─────────────────────────────────────────────────────────────────
function conform(vectors, layer = 'waves') {          // the useMarineWindData conform, waves layer, flat vectors (the reference copy)
  return vectors.map((v) => {
    const hasFlat = v && typeof v.speed === 'number' && typeof v.u === 'number';
    const layerData = v && v[layer] ? v[layer] : (hasFlat ? v : (v[layer] || v.waves));
    const dirConfidence = layerData && typeof layerData.dirConfidence === 'number' ? layerData.dirConfidence
      : (layerData && typeof layerData.dir_confidence === 'number' ? layerData.dir_confidence
        : (v && typeof v.dirConfidence === 'number' ? v.dirConfidence : (v && typeof v.dir_confidence === 'number' ? v.dir_confidence : null)));
    return {
      lat: v.lat, lng: v.lng, u: layerData?.u || 0, v: layerData?.v || 0, speed: layerData?.speed || 0, period: layerData?.period || 0,
      height: layerData?.height !== undefined ? layerData.height : (layerData?.speed || 0),
      direction: layerData?.direction !== undefined ? layerData.direction : undefined, isOcean: v.isOcean, dirConfidence,
      phys_speed: typeof v.phys_speed === 'number' ? v.phys_speed : (layerData && typeof layerData.phys_speed === 'number' ? layerData.phys_speed : undefined),
      [layer]: layerData,
    };
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
const INDEX = { path: 'v1/idx/real.json', run: 'r', grid: IG, common_meta: { model: 'GFS', provider: 'open-meteo', layer: 'waves' },
  frames: [{ valid_time: '2026-10-20T00:00:00Z', path: 'v1/f/0.bin', meta: { product_id: 'p0' } }] };
const VECTORS = buildVectors(PARSED);
function laneA(bboxStr, box) {      // seam A: the cropped /grid JSON -> the mapper -> the conform -> trim -> encode
  const win = midClipWindow(bboxStr, IG, 'GFS');
  const json = cropGridJson(gridJsonFromFrame(INDEX, INDEX.frames[0], VECTORS, { askIso: '2026-10-20T00:00:00Z', requestedBbox: box }), win, cropVectors(VECTORS, IG.cols, win));
  const mapped = mapNormalizedGridToWebGL(json, box, 0, 'waves', 'GFS');
  return { win, ref: encoderBytes({ ...mapped.grid, vectors: conform(mapped.grid.vectors) }) };
}
function laneB(bboxStr) {           // seam B: the cropped series frame -> the conform -> trim -> encode
  const win = midClipWindow(bboxStr, IG, 'GFS');
  const f = cropSeriesFrame(seriesFrameFromFrame(INDEX, INDEX.frames[0], VECTORS, { hourOffset: 0, askIso: '2026-10-20T00:00:00Z' }), win, cropVectors(VECTORS, IG.cols, win));
  return { win, ref: encoderBytes({ vectors: conform(f.vectors), bounds: f.bounds, cols: f.cols, rows: f.rows, __componentLayer: 'waves', __sourceModel: 'GFS' }) };
}
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };

describe('packWindow: the clip\'s own encoder bytes, not a copy of the world texture', () => {
  // the owner's 27 x 20, a polar window (dead edge rows the engine trims), one touching -180, one on land-heavy Asia, a small one
  const BOXES = ['-95,20,-65,35', '10.5,-70.25,48.75,-50.1', '-180,-5,-152.5,25', '95,5,125,30', '-30.0001,0.0001,-10.0001,14.9999'];
  const THEMES = ['dark', 'light', 'beach'];
  BOXES.forEach((b) => THEMES.forEach((theme) => it(`${b}, ${theme}`, () => {
    window.__WEBGL_MARINE_THEME__ = theme;
    const [w, s, e, n] = b.split(',').map(Number);
    for (const { win, ref } of [laneA(b, { west: w, south: s, east: e, north: n }), laneB(b)]) {
      const p = packWindow(PARSED, frameWindowOf({ bounds: win.bounds, cols: win.cols, rows: win.rows }, IG));
      expect([p.cols, p.rows]).toEqual([ref.cols, ref.rows]);
      expect(firstDiff(p.bytes, ref.bytes)).toBe(-1);
    }
  })));

  it('the world texture cut to the same window is NOT those bytes (why the show packs the window)', () => {
    const { win, ref } = laneB('95,5,125,30');
    const { packStaticFrame } = require('./marineFramePack');
    const world = packStaticFrame(PARSED);
    const tc0 = Math.round((world.bounds.west - IG.bounds.west) / 2); const tr0 = Math.round((world.bounds.south - IG.bounds.south) / 2);
    let diff = 0;
    for (let r = 0; r < ref.rows; r++) for (let c = 0; c < ref.cols; c++) for (let k = 0; k < 4; k++) {
      if (ref.bytes[(r * ref.cols + c) * 4 + k] !== world.bytes[((win.r0 - tr0 + r) * world.cols + (win.c0 - tc0 + c)) * 4 + k]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('frameWindowOf: a clip of the lattice is a window; the world frame, another lattice or a misaligned box is not', () => {
    const win = midClipWindow('-95,20,-65,35', IG, 'GFS');
    expect(frameWindowOf({ bounds: win.bounds, cols: win.cols, rows: win.rows }, IG)).toEqual({ c0: 37, r0: 44, cols: 27, rows: 20,
      key: '37,44,27,20@181x83', lattice: { cols: 181, rows: 83, bounds: IG.bounds } });
    expect(frameWindowOf({ bounds: IG.bounds, cols: IG.cols, rows: IG.rows }, IG)).toBeNull();
    expect(frameWindowOf({ bounds: { west: -81, south: 25, east: -79, north: 27 }, cols: 9, rows: 9 }, IG)).toBeNull();     // 0.25 deg
    expect(frameWindowOf({ bounds: { west: -105, south: 8, east: -53, north: 46 }, cols: 27, rows: 20 }, IG)).toBeNull();   // off-lattice
    expect(frameWindowOf({ bounds: { west: 170, south: 8, east: 190, north: 46 }, cols: 11, rows: 20 }, IG)).toBeNull();    // past +180
  });

  it('a frame on another lattice is never sliced by the window (packWindow refuses it)', () => {
    const win = frameWindowOf({ bounds: midClipWindow('-95,20,-65,35', IG, 'GFS').bounds, cols: 27, rows: 20 }, IG);
    expect(packWindow(PARSED, win)).not.toBeNull();
    expect(packWindow({ ...PARSED, bounds: { ...PARSED.bounds, west: -179, east: 181 } }, win)).toBeNull();
    expect(packWindow({ ...PARSED, cols: 180 }, win)).toBeNull();
  });

  it('the validity tolerance scales to the window (64 cells is 0.4 % of the world, 12 % of a 27 x 20 clip)', () => {
    expect(cropToleranceCells(27 * 20)).toBe(3);
    expect(cropToleranceCells(4)).toBe(1);
    expect(cropToleranceCells(181 * 81)).toBe(59);
    expect(cropToleranceCells(1e6)).toBe(64);
  });

  it('the LRU keys by set, time and window, and refuses a pack of another signature (theme, kill switches)', () => {
    const lru = createCropPacks(2);
    lru.put('s', 't1', 'w', { signature: 'a' }); lru.put('s', 't2', 'w', { signature: 'a' }); lru.put('s', 't3', 'w', { signature: 'a' });
    expect(lru.get('s', 't1', 'w', 'a')).toBeNull();
    expect(lru.get('s', 't3', 'w', 'a')).toEqual({ signature: 'a' });
    expect(lru.get('s', 't3', 'w', 'b')).toBeNull();
    expect(lru.size()).toBe(2);
  });
});

describe('build-ahead: how many stored frames get the pack of a new window, and in what order (2026-10-22, pass 2)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_CROP_AHEAD_RUN__; });
  it('a desktop that fills the run builds every stored frame; elsewhere the cursor +-24 / +-8, as before', () => {
    expect(cropAheadCount({ tier: 'desktop', fills: true })).toBe(CROP_AHEAD_RUN);
    expect(CROP_AHEAD_RUN).toBeGreaterThanOrEqual(115);                              // a whole GFS / ICON run
    expect(cropAheadCount({ tier: 'desktop', fills: false })).toBe(CROP_AHEAD);       // Save-Data, 2g, a hidden tab
    expect(cropAheadCount({ tier: 'webgl1', fills: false })).toBe(CROP_AHEAD);
    expect(cropAheadCount({ tier: 'handheld', fills: false })).toBe(CROP_AHEAD_SMALL);
    expect(cropAheadCount({ tier: 'constrained', fills: false })).toBe(CROP_AHEAD_SMALL);
    window.__RAW_DISABLE_CROP_AHEAD_RUN__ = true;
    expect(cropAheadCount({ tier: 'desktop', fills: true })).toBe(CROP_AHEAD);
  });
  it('the queue: nearest the window first, the later frame first on a tie, unknown frames last', () => {
    const at = new Map([['a', 0], ['b', 1], ['c', 2], ['d', 3], ['e', 4]]);
    expect(cropAheadOrder(['a', 'b', 'c', 'd', 'e', 'x'], (v) => at.get(v), 2)).toEqual(['c', 'd', 'b', 'e', 'a', 'x']);
    expect(cropAheadOrder(['a', 'b', 'c', 'd', 'e'], (v) => at.get(v), 4)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
});

describe('the runtime shows the window of the stepped-to frame', () => {
  const WIN = midClipWindow('-95,20,-65,35', IG, 'GFS');
  const CROP_GRID = (k) => ({ bounds: WIN.bounds, cols: WIN.cols, rows: WIN.rows, served_valid_time: vt(k), __sourceModel: 'GFS', __componentLayer: 'waves' });
  const PACK = packWindow(PARSED, frameWindowOf(CROP_GRID(0), IG));
  function setup(n = 8) {
    RT._resetFrameStoreRuntimeForTest(); mockSF.hooks.clear(); mockSF.loads = []; mockSF.enabled = true;
    mockSF.index = { path: 'v1/idx/run.json', run: 'r', grid: IG, common_meta: { model: 'GFS', layer: 'waves' },
      frames: Array.from({ length: n }, (_, k) => ({ valid_time: vt(k), path: `v1/f/${k}.bin`, meta: { product_id: `p${k}` } })) };
    const calls = [];
    const gl = { TEXTURE_2D: 'T2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UB', TEXTURE_BINDING_2D: 'B2D', UNPACK_FLIP_Y_WEBGL: 'FLIP', UNPACK_PREMULTIPLY_ALPHA_WEBGL: 'PRE',
      getParameter: () => null, bindTexture: () => {}, pixelStorei: () => {}, texSubImage2D: (...a) => calls.push(a[8]) };
    const eng = { _residentWaveTex: { wave: true }, _texWidth: PACK.cols, _texHeight: PACK.rows,
      _waveData: { waveGrid: { cols: PACK.cols, rows: PACK.rows, bounds: { ...PACK.bounds }, hourOffset: 0, __sourceModel: 'GFS', __componentLayer: 'waves' } } };
    const map = { triggerRepaint: jest.fn() };
    RT.registerFrameStoreTarget({ getEngine: () => eng, getGl: () => gl, getMap: () => map });
    return { calls, eng };
  }
  const settle = async () => { for (let i = 0; i < 10; i++) { mockSF.loads.filter((l) => !l.done).forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); }); await flush(); } };
  const step = (k) => RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: k * 3, requestedValidTime: vt(k) });

  it('a resident clip becomes the store\'s resident once its window pack exists, and a step shows the next frame\'s window', async () => {
    const { calls, eng } = setup();
    RT.noteCommitted(CROP_GRID(0), { hour: 0, model: 'GFS', layer: 'waves' });
    expect(window.__RAW_FRAME_STORE__.commits.resident_crop).toBe(1);
    await settle();
    expect(window.__RAW_FRAME_STORE__.crop.resident).toMatchObject({ crop: true, window: { c0: 37, r0: 44, cols: 27, rows: 20 }, cols: PACK.cols, rows: PACK.rows });
    for (const fn of mockSF.hooks) fn({ key: KEY, frame: mockSF.index.frames[1], parsed: PARSED, buffer: null });   // frame 1 lands
    await flush();
    expect(step(1)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(firstDiff(calls[0], PACK.bytes)).toBe(-1);
    expect(eng._waveData.waveGrid).toMatchObject({ hourOffset: 3, served_valid_time: vt(1), productId: 'p1', __fromFrameStore: true, bounds: PACK.bounds });
    expect(window.__RAW_FRAME_STORE__.crop.shows).toBe(1);
  });

  it('a step to a frame whose window pack is not built yet misses, builds it, and shows it the moment it lands', async () => {
    const { calls } = setup();
    RT.noteCommitted(CROP_GRID(0), { hour: 0, model: 'GFS', layer: 'waves' });
    await settle();
    expect(step(5)).toBe(false);
    expect(window.__RAW_FRAME_STORE__.shows.misses.crop_not_ready).toBe(1);
    await settle();
    expect(calls).toHaveLength(1);                                   // the deferred show
    expect(window.__RAW_FRAME_STORE__.shows.deferred).toBe(1);
  });

  const WORLD_COMMIT = () => RT.noteCommitted({ bounds: IG.bounds, cols: IG.cols, rows: IG.rows, served_valid_time: vt(0), __sourceModel: 'GFS',
    __componentLayer: 'waves' }, { hour: 0, model: 'GFS', layer: 'waves' });

  // The same frame with `n` ocean cells inside the window turned to land (a mask that changed between hours).
  function withLand(n) {
    const H = Float64Array.from(PARSED.fields[0]); let left = n;
    for (let r = WIN.r0 + 5; r < WIN.r0 + 15 && left; r++) for (let c = WIN.c0 + 5; c < WIN.c0 + 20 && left; c++) {
      if (!Number.isNaN(H[r * IG.cols + c])) { H[r * IG.cols + c] = NaN; left -= 1; }
    }
    return { ...PARSED, fields: { ...PARSED.fields, 0: H } };
  }

  it('a step whose mask differs from the resident clip by more than the window tolerance is refused; within it, shown', async () => {
    const { calls } = setup();
    RT.noteCommitted(CROP_GRID(0), { hour: 0, model: 'GFS', layer: 'waves' });
    await settle();
    for (const fn of mockSF.hooks) fn({ key: KEY, frame: mockSF.index.frames[2], parsed: withLand(2), buffer: null });
    for (const fn of mockSF.hooks) fn({ key: KEY, frame: mockSF.index.frames[3], parsed: withLand(5), buffer: null });
    await flush();
    expect(step(2)).toBe(true);                                       // 2 cells: within the 27 x 20 window's 3
    expect(window.__RAW_FRAME_STORE__.shows.maskTolerated).toBe(1);
    expect(step(3)).toBe(false);                                      // 5 cells: refused (the normal commit brings its own mask)
    expect(window.__RAW_FRAME_STORE__.shows.misses.validity_differs).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('kill switch: a clip commit is not taken, and no step is shown from a window', async () => {
    const { calls } = setup();
    window.__RAW_DISABLE_FRAME_STORE_CROP__ = true;
    RT.noteCommitted(CROP_GRID(0), { hour: 0, model: 'GFS', layer: 'waves' });
    await settle();
    expect(window.__RAW_FRAME_STORE__.commits.resident_crop).toBeUndefined();
    expect(window.__RAW_FRAME_STORE__.crop.resident).toBeNull();
    expect(step(1)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('a commit the engine refused leaves the clip resident; a world frame the engine took ends it', async () => {
    const { calls, eng } = setup();
    RT.noteCommitted(CROP_GRID(0), { hour: 0, model: 'GFS', layer: 'waves' });
    await settle();
    WORLD_COMMIT();                                                  // the guard refused it: the engine still holds the clip
    expect(window.__RAW_FRAME_STORE__.crop.resident).not.toBeNull();
    for (const fn of mockSF.hooks) fn({ key: KEY, frame: mockSF.index.frames[2], parsed: PARSED, buffer: null });
    await flush();
    expect(step(2)).toBe(true);
    expect(calls).toHaveLength(1);
    Object.assign(eng, { _texWidth: 181, _texHeight: 81 });          // now the engine holds a world frame
    eng._waveData.waveGrid = { ...eng._waveData.waveGrid, cols: 181, rows: 81, bounds: { west: -180, south: -78, east: 180, north: 82 } };
    WORLD_COMMIT();
    expect(window.__RAW_FRAME_STORE__.crop.resident).toBeNull();
    expect(window.__RAW_FRAME_STORE__.crop.window).toBeNull();
    expect(step(3)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('a clip commit the engine did not take (it holds another box) is never the resident', async () => {
    const { eng } = setup();
    eng._waveData.waveGrid.bounds = { west: -100, south: 10, east: -60, north: 40 };
    RT.noteCommitted(CROP_GRID(0), { hour: 0, model: 'GFS', layer: 'waves' });
    await settle();
    expect(window.__RAW_FRAME_STORE__.crop.resident).toBeNull();
    expect(window.__RAW_FRAME_STORE__.commits.crop_not_resident).toBe(1);
  });
  // A run whose frames were all parsed while the WORLD frame was resident (no window then), so none has a window pack yet.
  const N = 60;
  const idxOf = (l) => mockSF.index.frames.findIndex((f) => f.valid_time === l.frame.valid_time);
  async function drain(max = 400) {
    for (let i = 0, quiet = 0; i < max && quiet < 3; i++) {
      const open = mockSF.loads.filter((l) => !l.done);
      open.forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); });
      quiet = open.length ? 0 : quiet + 1;
      await flush();
    }
  }
  async function aheadRun({ tier = 'desktop', hidden = false, kill = false } = {}) {
    window.__RAW_FRAME_STORE_TIER__ = tier;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    if (kill) window.__RAW_DISABLE_CROP_AHEAD_RUN__ = true;
    setup(N);
    for (const f of mockSF.index.frames) for (const fn of mockSF.hooks) fn({ key: KEY, frame: f, parsed: PARSED, buffer: null });
    await flush();
    RT.noteCommitted(CROP_GRID(30), { hour: 90, model: 'GFS', layer: 'waves' });
  }
  const cleanAhead = () => { delete document.visibilityState; ['__RAW_FRAME_STORE_TIER__', '__RAW_DISABLE_CROP_AHEAD_RUN__'].forEach((k) => delete window[k]); };

  it('a desktop that fills the run builds the pack of a new window for EVERY stored frame (the far jumps stop missing)', async () => {
    try {
      await aheadRun();
      await drain();
      expect(window.__RAW_FRAME_STORE__.crop.built).toBe(N);
      expect(window.__RAW_FRAME_STORE__.crop.queued).toBe(0);
      expect(step(0)).toBe(true);                                      // the far end of the run, 30 frames from the cursor
      expect(step(N - 1)).toBe(true);
      expect(window.__RAW_FRAME_STORE__.shows.misses.crop_not_ready).toBeUndefined();
    } finally { cleanAhead(); }
  }, 30000);

  it('the kill switch, a hidden tab and a phone keep the old build-ahead (+-24, +-24, +-8)', async () => {
    try {
      for (const [opts, n] of [[{ kill: true }, CROP_AHEAD], [{ hidden: true }, CROP_AHEAD], [{ tier: 'handheld' }, CROP_AHEAD_SMALL]]) {
        await aheadRun(opts);
        await drain();
        expect([opts, window.__RAW_FRAME_STORE__.crop.built]).toEqual([opts, n]);
        cleanAhead();
      }
    } finally { cleanAhead(); }
  }, 60000);

  it('a new window builds its own neighbourhood first: two chains on a desktop that fills the run, one elsewhere', async () => {
    try {
      for (const [tier, open] of [['desktop', [29, 30, 31]], ['handheld', [30, 31]]]) {
        await aheadRun({ tier });
        await flush();
        expect([tier, mockSF.loads.filter((l) => !l.done).map(idxOf).sort((a, b) => a - b)]).toEqual([tier, open]);
        await drain();
        cleanAhead();
      }
    } finally { cleanAhead(); }
  }, 60000);
});
