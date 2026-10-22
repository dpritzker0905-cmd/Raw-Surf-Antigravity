/**
 * Stage A of the GPU-resident frames (2026-10-22): a frame shown with its OWN chl/bath (marineFrameAux), so a MODEL SWITCH puts the
 * new model's stored frame on screen at the click, and a step after a /grid fallback commit re-enters the fast path. Warm frames of
 * the other published waves sets are prefetched at the cursor on a capable desktop.
 */
import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import { parseFrame } from './staticFrameCodec';
import { packStaticFrame } from './marineFramePack';
import { auxForPack } from './marineFrameAux';

const mockSF = { enabled: true, byKey: {}, eligible: ['GFS'], hooks: new Set(), loads: [], pins: [] };
jest.mock('./staticFrames', () => ({
  staticFramesEnabled: () => mockSF.enabled,
  setKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,
  getPinnedIndexSync: (k) => mockSF.byKey[k] || null,
  getPinnedIndex: async (k) => { mockSF.pins.push(k); return mockSF.byKey[k] || null; },
  staticEligible: ({ model }) => mockSF.eligible.includes(String(model).toUpperCase()),
  onStaticFrameParsed: (fn) => { mockSF.hooks.add(fn); return () => mockSF.hooks.delete(fn); },
  loadFrameParsed: (key, frame, signal) => new Promise((resolve) => { mockSF.loads.push({ key, frame, signal, resolve }); }),
}));
import * as RT from './marineFrameStoreRuntime';

const PARSED = parseFrame(zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64')));
// Another model's frame: same grid, its own land and ice (200 ocean cells invalid: far past the one-run tolerance of 64).
// Cells from mid-grid, so no edge row empties and the trimmed size stays the same as GFS's (a real ICON world frame: same grid).
const oceanCells = (n) => { const out = new Set(); const H = PARSED.fields[0]; for (let i = H.length >> 1; i < H.length && out.size < n; i += 7) if (!Number.isNaN(H[i]) && H[i] > 0) out.add(i); return out; };
const ICON_CELLS = oceanCells(200);
const ICON_PARSED = { ...PARSED, fields: { ...PARSED.fields, 0: Float64Array.from(PARSED.fields[0], (h, i) => (ICON_CELLS.has(i) ? NaN : h * 1.1)) } };
const vt = (k) => new Date(Date.UTC(2026, 9, 20, 0) + k * 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const GFS = 'GFS/marine/waves/global_mid';
const ICON = 'ICON/marine/waves/global_mid';
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

function indexFor(model, n) {
  const tag = model.toLowerCase();
  return { path: `v1/idx/${tag}.json`, run: '2026-10-20T00:00:00Z', common_meta: { model, layer: 'waves', provider: `${tag}-provider` },
    frames: Array.from({ length: n }, (_, k) => ({ valid_time: vt(k), path: `v1/${tag}/${k}.bin`, meta: { product_id: `${tag}${k}` } })) };
}
function fakeGL(webgl2) {
  const calls = []; const st = { tex: null, arr: null, read: null, flip: false, pre: false };
  const gl = {
    TEXTURE_2D: 'T2D', TEXTURE_2D_ARRAY: 'T2DA', READ_FRAMEBUFFER: 'RFB', COLOR_ATTACHMENT0: 'CA0', RGBA: 'RGBA', RGBA8: 'RGBA8', UNSIGNED_BYTE: 'UB',
    NEAREST: 'N', CLAMP_TO_EDGE: 'C', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG', TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT',
    MAX_ARRAY_TEXTURE_LAYERS: 'MAXL', TEXTURE_BINDING_2D_ARRAY: 'B2DA', TEXTURE_BINDING_2D: 'B2D', READ_FRAMEBUFFER_BINDING: 'BRFB',
    UNPACK_FLIP_Y_WEBGL: 'FLIP', UNPACK_PREMULTIPLY_ALPHA_WEBGL: 'PRE',
    getParameter: (p) => ({ MAXL: 2048, B2DA: st.arr, B2D: st.tex, BRFB: st.read, FLIP: st.flip, PRE: st.pre })[p],
    createTexture: () => ({}), deleteTexture: () => {}, createFramebuffer: () => ({}), deleteFramebuffer: () => {},
    bindTexture: (t, x) => { if (t === 'T2DA') st.arr = x; else st.tex = x; }, bindFramebuffer: (t, f) => { st.read = f; },
    pixelStorei: (p, v) => { if (p === 'FLIP') st.flip = v; if (p === 'PRE') st.pre = v; }, texParameteri: () => {},
    texSubImage2D: (...a) => calls.push(['texSubImage2D', st.tex, a[8]]),
    copyTexSubImage2D: () => calls.push(['copyTexSubImage2D', st.tex]),
    texSubImage3D: (...a) => calls.push(['texSubImage3D', st.arr, a[4]]), framebufferTextureLayer: (...a) => calls.push(['layer', a[4]]),
  };
  if (webgl2) gl.texStorage3D = () => calls.push(['texStorage3D']);
  return { gl, calls };
}
// The engine as encodeMarineTexture leaves it on a world commit: the resident wave/chl/bath textures are the ones it samples.
function engine() {
  const { cols, rows, bounds } = packStaticFrame(PARSED);
  const wave = { id: 'wave' }; const chl = { id: 'chl' }; const bath = { id: 'bath' };
  return { _residentWaveTex: wave, _residentChlTex: chl, _residentBathTex: bath, _texWidth: cols, _texHeight: rows,
    _waveData: { u_waveTexture: wave, u_chlorophyllTexture: chl, u_bathymetryTexture: bath, bounds: { ...bounds },
      waveGrid: { cols, rows, bounds: { ...bounds }, hourOffset: 0, served_valid_time: vt(0), __sourceModel: 'GFS', __componentLayer: 'waves' } } };
}
function setup({ n = 12, models = ['GFS', 'ICON'], webgl2 = false } = {}) {
  mockSF.byKey = {};
  for (const m of models) mockSF.byKey[`${m}/marine/waves/global_mid`] = indexFor(m, n);
  const { gl, calls } = fakeGL(webgl2);
  const eng = engine();
  const map = { triggerRepaint: jest.fn() };
  RT.registerFrameStoreTarget({ getEngine: () => eng, getGl: () => gl, getMap: () => map });
  return { gl, calls, eng, map };
}
async function parse(key, k, parsed) {
  for (const fn of mockSF.hooks) fn({ key, frame: mockSF.byKey[key].frames[k], parsed: parsed || (key === ICON ? ICON_PARSED : PARSED), buffer: null });
  await flush();
}
// A frame the prefetcher asked for lands.
async function landLoad(key, k, parsed) {
  const l = mockSF.loads.find((x) => x.key === key && x.frame.valid_time === vt(k) && !x.done);
  l.done = true; l.resolve({ parsed: parsed || (key === ICON ? ICON_PARSED : PARSED), buffer: null, wire: 1 });
  await flush();
}
// Land the active GFS window until the warm ICON frames are asked for.
async function landGfsUntilWarm(want = 3) {
  for (let i = 0; i < 10 && mockSF.loads.filter((l) => l.key === ICON).length < want; i++) {
    mockSF.loads.filter((l) => !l.done && l.key === GFS).forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); });
    await flush();
  }
}
const commitGfs = (k) => RT.noteCommitted({ served_valid_time: vt(k), cols: 181, rows: 83, __sourceModel: 'GFS', __componentLayer: 'waves' }, { hour: k * 3, model: 'GFS', layer: 'waves' });
const toIcon = (k) => RT.tryShowStoredFrameForSwitch({ model: 'ICON', layer: 'waves', hourOffset: k * 3, requestedValidTime: vt(k) });
const snap = () => window.__RAW_FRAME_STORE__;
const KILLS = ['__RAW_DISABLE_FRAME_STORE__', '__RAW_DISABLE_FRAME_PREFETCH__', '__RAW_DISABLE_FRAME_STORE_GPU__', '__RAW_DISABLE_FRAME_IDLE_FILL__',
  '__RAW_DISABLE_FRAME_MODEL_TOGGLE__', '__RAW_DISABLE_FRAME_AUX_SHOW__', '__RAW_FRAME_WARM_REST_MS__', '__RAW_FRAME_STORE_TIER__', '__WEBGL_MARINE_THEME__', '__MARINE_DRAWN__'];

beforeEach(() => {
  RT._resetFrameStoreRuntimeForTest();
  Object.assign(mockSF, { enabled: true, eligible: ['GFS', 'ICON'], loads: [], pins: [] }); mockSF.hooks.clear();
  KILLS.forEach((k) => delete window[k]);
});

describe('instant model toggle: the new model\'s stored frame with its own chl/bath', () => {
  beforeEach(() => { window.__RAW_FRAME_STORE_TIER__ = 'desktop'; });   // the tier that may compute chl/bath at the click
  it('shows the ICON frame over a GFS resident, uploading the frame\'s exact chl/bath beside its wave bytes', async () => {
    const { calls, eng, map } = setup();
    await parse(GFS, 0); await parse(ICON, 2);
    commitGfs(0);
    calls.length = 0;
    expect(toIcon(2)).toBe(true);
    const iconPack = packStaticFrame(ICON_PARSED);
    const want = auxForPack(iconPack);
    const up = (tex) => calls.filter((c) => c[0] === 'texSubImage2D' && c[1] === tex).map((c) => c[2]);
    expect(up(eng._residentChlTex)).toHaveLength(1);
    expect(Buffer.from(up(eng._residentChlTex)[0]).equals(Buffer.from(want.chl))).toBe(true);    // the encoder's bytes, exactly
    expect(Buffer.from(up(eng._residentBathTex)[0]).equals(Buffer.from(want.bath))).toBe(true);
    expect(Buffer.from(up(eng._residentWaveTex)[0]).equals(Buffer.from(iconPack.bytes))).toBe(true);
    expect(eng._waveData.waveGrid).toMatchObject({ __sourceModel: 'ICON', served_valid_time: vt(2), productId: 'icon2', provider: 'icon-provider', __fromFrameStore: true });
    expect(window.__MARINE_DRAWN__).toMatchObject({ model: 'ICON', hour: 6, validTime: vt(2) });
    expect(map.triggerRepaint).toHaveBeenCalled();
    expect(snap().resident).toMatchObject({ setKey: expect.stringContaining('ICON'), validityHash: iconPack.validityHash });
    expect(snap().switches).toMatchObject({ asked: 1, shown: 1 });
    expect(snap().shows).toMatchObject({ aux: 1, crossModel: 1 });
  });

  it('after the switch, an ICON step takes the resident path (no second chl/bath compute)', async () => {
    setup();
    await parse(GFS, 0); await parse(ICON, 2); await parse(ICON, 3);
    commitGfs(0);
    expect(toIcon(2)).toBe(true);
    expect(RT.tryShowStoredFrame({ model: 'ICON', layer: 'waves', hourOffset: 9, requestedValidTime: vt(3) })).toBe(true);
    expect(snap().aux.computed).toBe(1);
    expect(snap().shows.aux).toBe(1);
  });

  it('kill switches: the toggle kill refuses the switch; the aux kill refuses every exact chl/bath show', async () => {
    const { calls } = setup();
    await parse(GFS, 0); await parse(ICON, 2);
    commitGfs(0);
    calls.length = 0;
    window.__RAW_DISABLE_FRAME_MODEL_TOGGLE__ = true;
    expect(toIcon(2)).toBe(false);
    delete window.__RAW_DISABLE_FRAME_MODEL_TOGGLE__;
    window.__RAW_DISABLE_FRAME_AUX_SHOW__ = true;
    expect(toIcon(2)).toBe(false);
    expect(snap().shows.misses.resident_not_this_set).toBe(1);
    expect(snap().shows.auxMiss).toEqual({ killed: 1 });
    expect(calls).toEqual([]);                                             // nothing touched the GPU
  });

  it.each([
    ['the engine samples a non-resident chlorophyll texture', (eng) => { eng._waveData.u_chlorophyllTexture = { other: true }; }, 'textures'],
    ['the engine samples a non-resident bathymetry texture', (eng) => { eng._waveData.u_bathymetryTexture = { other: true }; }, 'textures'],
    ['the engine samples a non-resident wave texture', (eng) => { eng._waveData.u_waveTexture = { other: true }; }, 'textures'],
    ['a rating grid is resident', (eng) => { eng._waveData.waveGrid.ratingMode = true; }, 'flavor'],
    ['another layer is resident', (eng) => { eng._waveData.waveGrid.__componentLayer = 'swell_1'; }, 'flavor'],
    ['a regional tile of the same size is resident', (eng) => { eng._waveData.bounds = { west: -130, east: -60, south: 10, north: 60 }; }, 'bounds'],
    ['another size is resident', (eng) => { eng._texWidth += 1; }, 'dims'],
  ])('refuses when %s (nothing is uploaded)', async (_, arrange, reason) => {
    const { calls, eng } = setup();
    await parse(GFS, 0); await parse(ICON, 2);
    commitGfs(0);
    arrange(eng);
    calls.length = 0;
    expect(toIcon(2)).toBe(false);
    expect(snap().shows.auxMiss).toEqual({ [reason]: 1 });
    expect(calls).toEqual([]);
    expect(eng._waveData.waveGrid.__sourceModel).toBe('GFS');
  });

  it('a phone never computes chl/bath on the main thread: without warm bytes the switch is the normal path', async () => {
    window.__RAW_FRAME_STORE_TIER__ = 'handheld';
    const { calls, eng } = setup();
    await parse(GFS, 0); await parse(ICON, 2);
    commitGfs(0);
    calls.length = 0;
    expect(toIcon(2)).toBe(false);
    expect(snap().shows.auxMiss).toEqual({ aux_not_ready: 1 });
    expect(snap().aux.computed).toBe(0);
    expect(calls).toEqual([]);
    expect(eng._waveData.waveGrid.__sourceModel).toBe('GFS');
  });

  it('a switch to a frame still loading is shown when it lands (deferred), with its chl/bath', async () => {
    const { eng } = setup();
    await parse(GFS, 0);
    commitGfs(0);
    expect(toIcon(4)).toBe(false);
    expect(snap().shows.misses.not_ready).toBe(1);
    RT.noteStep({ model: 'ICON', layer: 'waves', requestedValidTime: vt(4) });   // the seam moves the prefetch to ICON
    await landLoad(ICON, 4);
    expect(snap().shows.deferred).toBe(1);
    expect(eng._waveData.waveGrid).toMatchObject({ __sourceModel: 'ICON', served_valid_time: vt(4) });
  });
});

describe('a step after a /grid fallback commit (no stored frame resident)', () => {
  beforeEach(() => { window.__RAW_FRAME_STORE_TIER__ = 'desktop'; });
  it('shows the stored frame with its own chl/bath, then later steps take the resident path', async () => {
    const { eng } = setup({ models: ['GFS'] });
    await parse(GFS, 0); await parse(GFS, 1); await parse(GFS, 2);
    RT.noteCommitted({ valid_time: vt(0), cols: 181, rows: 83, __sourceModel: 'GFS', __componentLayer: 'waves' }, { hour: 0, model: 'GFS', layer: 'waves' });
    expect(snap().commits.no_served_time).toBe(1);                       // the /grid frame names no stored frame
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 6, requestedValidTime: vt(2) })).toBe(true);
    expect(snap().aux).toMatchObject({ computed: 1, sync: 1 });
    expect(snap().shows).toMatchObject({ n: 2, aux: 1 });
    expect(eng._waveData.waveGrid.served_valid_time).toBe(vt(2));
  });

  it('a scrub step computes chl/bath at most once a second (a drag never pays it on every step)', async () => {
    setup({ models: ['GFS'] });
    await parse(GFS, 0); await parse(GFS, 1); await parse(GFS, 2);
    const gridCommit = () => RT.noteCommitted({ valid_time: vt(0), cols: 181, rows: 83, __sourceModel: 'GFS', __componentLayer: 'waves' }, { hour: 0, model: 'GFS', layer: 'waves' });
    gridCommit();
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);
    gridCommit();                                                           // another /grid frame lands at once
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 6, requestedValidTime: vt(2) })).toBe(false);
    expect(snap().shows.auxMiss).toEqual({ aux_not_ready: 1 });
    expect(snap().shows.misses.resident_not_this_set).toBe(1);
  });
});

describe('warm frames of the other published models', () => {
  beforeEach(() => {
    window.__RAW_FRAME_STORE_TIER__ = 'desktop'; delete window.navigator.connection;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => { delete window.__RAW_FRAME_STORE_TIER__; delete document.visibilityState; });
  const iconAsked = () => mockSF.loads.filter((l) => l.key === ICON).map((l) => l.frame.valid_time);

  it('a desktop asks for ICON at the cursor +-1 after the GFS window, keeps it in CPU bytes and computes its chl/bath in idle', async () => {
    const { calls } = setup({ n: 30, webgl2: true });
    commitGfs(10);
    const order = mockSF.loads.map((l) => `${l.key === ICON ? 'I' : 'G'}${l.frame.valid_time}`);
    expect(order.slice(0, 4)).toEqual([`G${vt(10)}`, `G${vt(11)}`, `G${vt(9)}`, `G${vt(12)}`]);   // the cursor first
    await landGfsUntilWarm();                                              // the warm ICON frames follow the GFS window
    expect(iconAsked().sort()).toEqual([vt(9), vt(10), vt(11)]);
    calls.length = 0;
    mockSF.loads.filter((l) => l.key === ICON).forEach((l) => { l.done = true; l.resolve({ parsed: ICON_PARSED, buffer: null, wire: 1 }); });
    await flush();
    expect(calls.filter((c) => c[0] === 'texSubImage3D')).toEqual([]);   // no texture array for a warm set
    expect(snap().aux).toMatchObject({ idle: 3, cached: 3 });
    // The click: chl/bath ready, nothing computed on the switch.
    expect(toIcon(10)).toBe(true);
    expect(snap().aux.sync || 0).toBe(0);
  });

  it('warm frames that land after the run fill is planned (the cursor moved) still get their chl/bath in idle', async () => {
    setup({ n: 30 });
    commitGfs(10);
    await landGfsUntilWarm();
    mockSF.loads.filter((l) => l.key === ICON).forEach((l) => { l.done = true; l.resolve({ parsed: ICON_PARSED, buffer: null, wire: 1 }); });
    await flush();
    expect(snap().fill.planned).toBe(true);                               // the fill is granted: no replan follows a landing
    window.__RAW_FRAME_WARM_REST_MS__ = 40;
    RT.noteStep({ model: 'GFS', layer: 'waves', requestedValidTime: vt(20) });   // a step: warm frames follow once the wheel rests
    await flush();
    expect(mockSF.loads.filter((l) => l.key === ICON)).toHaveLength(3);   // moving: nothing new asked of the other models
    await new Promise((r) => setTimeout(r, 120));                         // resting
    for (let i = 0; i < 10 && mockSF.loads.filter((l) => l.key === ICON).length < 6; i++) {
      mockSF.loads.filter((l) => !l.done && l.key === GFS).forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); });
      await flush();
    }
    const fresh = mockSF.loads.filter((l) => l.key === ICON && !l.done);
    expect(fresh.map((l) => l.frame.valid_time).sort()).toEqual([vt(19), vt(20), vt(21)]);
    const before = snap().aux.idle;
    fresh.forEach((l) => { l.done = true; l.resolve({ parsed: ICON_PARSED, buffer: null, wire: 1 }); });
    await flush();
    expect(snap().aux.idle - before).toBe(3);
    expect(RT.tryShowStoredFrameForSwitch({ model: 'ICON', layer: 'waves', hourOffset: 60, requestedValidTime: vt(20) })).toBe(true);
    expect(snap().aux.sync || 0).toBe(0);                                 // nothing computed at the click
  });

  it('a set whose index is not pinned yet is pinned in the background, then planned', async () => {
    setup({ n: 30 });
    const iconIndex = mockSF.byKey[ICON];
    delete mockSF.byKey[ICON];
    commitGfs(10);
    expect(mockSF.pins).toEqual([ICON]);
    expect(iconAsked()).toEqual([]);
    mockSF.byKey[ICON] = iconIndex;                                        // the pin lands: pinWarm's callback replans
    RT.noteStep({ model: 'GFS', layer: 'waves', requestedValidTime: vt(10), commit: true });
    await landGfsUntilWarm();
    expect(iconAsked().sort()).toEqual([vt(9), vt(10), vt(11)]);
  });

  it.each([
    ['a phone tier', () => { window.__RAW_FRAME_STORE_TIER__ = 'handheld'; }],
    ['the model-toggle kill', () => { window.__RAW_DISABLE_FRAME_MODEL_TOGGLE__ = true; }],
    ['a model that is not published (not eligible)', () => { mockSF.eligible = ['GFS']; }],
  ])('no warm frames on %s', async (_, arrange) => {
    arrange();                                                             // before setup: the store takes its tier once
    setup({ n: 30 });
    commitGfs(10);
    for (let i = 0; i < 6; i++) {
      mockSF.loads.filter((l) => !l.done).forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); });
      await flush();
    }
    expect(iconAsked()).toEqual([]);
  });

  it('a drag never aborts the warm requests in flight nor asks the other models for the hours it passes', async () => {
    setup({ n: 30 });
    commitGfs(10);
    await landGfsUntilWarm();
    const warm = mockSF.loads.filter((l) => l.key === ICON);
    expect(warm.length).toBeGreaterThan(0);
    const n = mockSF.loads.filter((l) => l.key === ICON).length;
    for (const k of [11, 12, 13, 14, 15]) RT.noteStep({ model: 'GFS', layer: 'waves', requestedValidTime: vt(k) });   // a drag
    await flush();
    expect(warm.every((l) => !(l.signal && l.signal.aborted))).toBe(true);
    expect(mockSF.loads.filter((l) => l.key === ICON)).toHaveLength(n);
  });

  it('when ICON becomes active its packed frames join the GPU (texture array), and GFS turns warm', async () => {
    const { calls } = setup({ n: 30, webgl2: true });
    commitGfs(10);
    await landGfsUntilWarm();
    mockSF.loads.filter((l) => l.key === ICON).forEach((l) => { l.done = true; l.resolve({ parsed: ICON_PARSED, buffer: null, wire: 1 }); });
    await flush();
    calls.length = 0;
    RT.noteStep({ model: 'ICON', layer: 'waves', requestedValidTime: vt(10) });
    expect(calls.filter((c) => c[0] === 'texSubImage3D')).toHaveLength(3);
  });
});
