import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import { parseFrame } from './staticFrameCodec';
import { packStaticFrame } from './marineFramePack';

// #422's loader, controlled: the pinned index, the parsed-frame hook and the prefetch load.
const mockSF = { enabled: true, index: null, hooks: new Set(), loads: [] };
jest.mock('./staticFrames', () => ({
  staticFramesEnabled: () => mockSF.enabled,
  setKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,
  getPinnedIndexSync: () => mockSF.index,
  onStaticFrameParsed: (fn) => { mockSF.hooks.add(fn); return () => mockSF.hooks.delete(fn); },
  loadFrameParsed: (key, frame, signal) => new Promise((resolve) => { mockSF.loads.push({ key, frame, signal, resolve }); }),
}));
import * as RT from './marineFrameStoreRuntime';

const PARSED = parseFrame(zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64')));
const vt = (k) => new Date(Date.UTC(2026, 9, 20, 0) + k * 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const KEY = 'GFS/marine/waves/global_mid';
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

function indexWith(n, unbuiltAt = []) {
  return { path: 'v1/idx/run.json', run: '2026-10-20T00:00:00Z', common_meta: { model: 'GFS', layer: 'waves', run_time: 'ingest-time' },
    frames: Array.from({ length: n }, (_, k) => (unbuiltAt.includes(k) ? { valid_time: vt(k), path: null, unbuilt: 'refused' }
      : { valid_time: vt(k), path: `v1/f/${k}.bin`, meta: { product_id: `p${k}` } })) };
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
    texSubImage3D: (...a) => calls.push(['texSubImage3D', a[4]]), framebufferTextureLayer: (...a) => calls.push(['layer', a[4]]),
  };
  if (webgl2) gl.texStorage3D = () => calls.push(['texStorage3D']);
  return { gl, calls };
}
// The engine holds the TRIMMED frame (trimDeadEdges); take its size from the packer, which trims the same way.
function engine() {
  const { cols, rows } = packStaticFrame(PARSED);
  return { _residentWaveTex: { wave: true }, _texWidth: cols, _texHeight: rows,
    _waveData: { waveGrid: { cols, rows, hourOffset: 0, served_valid_time: vt(0), __sourceModel: 'GFS', __componentLayer: 'waves' } } };
}
function setup({ webgl2 = false, n = 12, unbuiltAt = [] } = {}) {
  mockSF.index = indexWith(n, unbuiltAt);
  const { gl, calls } = fakeGL(webgl2);
  const eng = engine();
  const map = { triggerRepaint: jest.fn() };
  RT.registerFrameStoreTarget({ getEngine: () => eng, getGl: () => gl, getMap: () => map });
  return { gl, calls, eng, map };
}
// A frame lands: through the prefetcher's own pending load when it owns the request, else through #422's parse hook.
async function land(k) {
  const l = mockSF.loads.find((x) => x.frame.valid_time === vt(k) && !x.done);
  if (l) { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); await flush(); } else await parse(k);
}
async function parse(k, parsed = PARSED) { for (const fn of mockSF.hooks) fn({ key: KEY, frame: mockSF.index.frames[k], parsed, buffer: null }); await flush(); }
const commitHour = (eng, k) => RT.noteCommitted({ served_valid_time: vt(k), cols: 181, rows: 83, __sourceModel: 'GFS', __componentLayer: 'waves' }, { hour: k * 3, model: 'GFS', layer: 'waves' });

beforeEach(() => { RT._resetFrameStoreRuntimeForTest(); mockSF.enabled = true; mockSF.hooks.clear(); mockSF.loads = [];
  ['__RAW_DISABLE_FRAME_STORE__', '__RAW_DISABLE_FRAME_PREFETCH__', '__RAW_DISABLE_FRAME_STORE_GPU__', '__RAW_DISABLE_FRAME_IDLE_FILL__',
    '__WEBGL_MARINE_THEME__', '__MARINE_DRAWN__'].forEach((k) => delete window[k]); });

describe('GPU-resident frames runtime', () => {
  it('does nothing while static frames are off or the store is killed', async () => {
    mockSF.enabled = false;
    const { calls } = setup();
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);
    mockSF.enabled = true; window.__RAW_DISABLE_FRAME_STORE__ = true;
    await parse(1);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses until a normal commit records that the resident is this set, then copies the stored frame and updates the identity', async () => {
    const { calls, eng, map } = setup();
    await parse(0); await parse(1);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);
    expect(window.__RAW_FRAME_STORE__.shows.misses.resident_not_this_set).toBe(1);
    commitHour(eng, 0);
    expect(window.__RAW_FRAME_STORE__.resident).toMatchObject({ cols: eng._texWidth, rows: eng._texHeight });
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);
    const up = calls.find((c) => c[0] === 'texSubImage2D');                 // WebGL1: the CPU bytes into the RESIDENT texture
    expect(up[1]).toBe(eng._residentWaveTex);
    expect(up[2].byteLength).toBe(eng._texWidth * eng._texHeight * 4);
    expect(eng._waveData.waveGrid).toMatchObject({ hourOffset: 3, served_valid_time: vt(1), valid_time: vt(1), productId: 'p1', __fromFrameStore: true });
    expect(window.__MARINE_DRAWN__).toMatchObject({ hour: 3, validTime: vt(1), model: 'GFS', layer: 'waves' });
    expect(map.triggerRepaint).toHaveBeenCalled();
  });

  it('a /grid-lane commit (no served time: the conform drops it) is recognised by its product id through the run index', async () => {
    const { eng } = setup();
    await parse(0); await parse(1);
    RT.noteCommitted({ productId: 'p0', valid_time: vt(0), cols: 181, rows: 83, __sourceModel: 'GFS', __componentLayer: 'waves' }, { hour: 0, model: 'GFS', layer: 'waves' });
    expect(window.__RAW_FRAME_STORE__.commits).toEqual({ resident: 1 });
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);
    RT.noteCommitted({ valid_time: vt(0), cols: 181, rows: 83, __sourceModel: 'GFS', __componentLayer: 'waves' }, { hour: 0, model: 'GFS', layer: 'waves' });
    expect(window.__RAW_FRAME_STORE__.commits.no_served_time).toBe(1);        // an ask echo alone never names a frame
    expect(eng._texWidth).toBeGreaterThan(0);
  });

  it('a commit that lands before its own frame is packed becomes the resident when the pack lands', async () => {
    const { eng } = setup();
    await parse(1);
    commitHour(eng, 0);                                                      // frame 0 not packed yet: the commit's plan fetches it
    expect(window.__RAW_FRAME_STORE__.commits.not_packed_inflight).toBe(1);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);
    mockSF.loads.find((l) => l.frame.valid_time === vt(0)).resolve({ parsed: PARSED, buffer: null, wire: 1 });
    await flush();                                                           // its pack lands
    expect(window.__RAW_FRAME_STORE__.commits.resident_late).toBe(1);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);
  });

  it('a step whose frame is still loading is shown the moment its pack lands (deferred show), unless superseded', async () => {
    const { eng } = setup();
    await parse(0);
    commitHour(eng, 0);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 6, requestedValidTime: vt(2) })).toBe(false);
    expect(window.__RAW_FRAME_STORE__.shows.misses.not_ready).toBe(1);
    await land(2);                                                            // frame 2 lands
    expect(window.__RAW_FRAME_STORE__.shows.deferred).toBe(1);
    expect(eng._waveData.waveGrid).toMatchObject({ hourOffset: 6, served_valid_time: vt(2) });
    // Superseded: a newer step before the frame lands -> no deferred show of the old one.
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 9, requestedValidTime: vt(3) })).toBe(false);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 12, requestedValidTime: vt(4) })).toBe(false);
    await land(3);
    expect(window.__RAW_FRAME_STORE__.shows.deferred).toBe(1);
    expect(eng._waveData.waveGrid.hourOffset).toBe(6);
    // And a normal commit supersedes it too.
    commitHour(eng, 0);
    await land(4);
    expect(window.__RAW_FRAME_STORE__.shows.deferred).toBe(1);
  });

  it('on WebGL2 the frame is copied from its texture-array layer (no CPU upload on the step)', async () => {
    const { calls, eng } = setup({ webgl2: true });
    await parse(0); await parse(2);
    commitHour(eng, 0);
    calls.length = 0;
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 6, requestedValidTime: vt(2) })).toBe(true);
    expect(calls.map((c) => c[0])).toEqual(['layer', 'copyTexSubImage2D']);
    expect(calls[0][1]).toBe(2);                                             // the layer is the frame's index in the run
    expect(window.__RAW_FRAME_STORE__.gpu).toMatchObject({ uploads: 2, copies: 1 });
  });

  it('an unbuilt frame (path null) is a miss: /grid serves that hour, never a neighbour', async () => {
    const { eng } = setup({ unbuiltAt: [4] });
    await parse(0); await parse(3); await parse(5);
    commitHour(eng, 0);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 12, requestedValidTime: vt(4) })).toBe(false);
    expect(window.__RAW_FRAME_STORE__.shows.misses.unbuilt_frame).toBe(1);
  });

  it('refuses when the stored frame\'s validity pattern differs from the resident\'s (chl / bath / mask would not match)', async () => {
    const { eng } = setup();
    await parse(0);
    const other = { ...PARSED, fields: { ...PARSED.fields, 0: Float64Array.from(PARSED.fields[0], (h, i) => (i === 9000 ? NaN : h)) } };
    await parse(1, other);
    commitHour(eng, 0);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);
    expect(window.__RAW_FRAME_STORE__.shows.misses.validity_differs).toBe(1);
  });

  it('a theme change (another height scale) retires the set: the old resident no longer qualifies', async () => {
    const { eng } = setup();
    window.__WEBGL_MARINE_THEME__ = 'dark';
    await parse(0); await parse(1);
    commitHour(eng, 0);
    window.__WEBGL_MARINE_THEME__ = 'light';                                // 16 m scale: a new pack signature
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);
  });

  it('prefetch starts only after the first marine draw, through the shared loader, nearest the cursor first', async () => {
    const { eng } = setup({ n: 30 });
    eng._waveData = null;
    RT.noteStep({ model: 'GFS', layer: 'waves', requestedValidTime: vt(10) });
    expect(mockSF.loads).toHaveLength(0);
    eng._waveData = { waveGrid: { cols: eng._texWidth, rows: eng._texHeight } };
    RT.noteStep({ model: 'GFS', layer: 'waves', requestedValidTime: vt(10) });
    expect(mockSF.loads.map((l) => l.frame.valid_time)).toEqual([vt(10), vt(11), vt(9), vt(12), vt(8), vt(13)]);
    mockSF.loads[0].resolve({ parsed: PARSED, buffer: null, wire: 55589 });
    await flush();
    expect(window.__RAW_FRAME_STORE__.prefetch).toMatchObject({ landed: 1, bytes: 55589 });
    expect(window.__RAW_FRAME_STORE__.sets[0]).toMatchObject({ packed: 1, inflight: 6 });  // the landing started the next one
    expect(mockSF.loads).toHaveLength(7);
    window.__RAW_DISABLE_FRAME_PREFETCH__ = true;
    const before = mockSF.loads.length;
    RT.noteStep({ model: 'GFS', layer: 'waves', requestedValidTime: vt(20) });
    expect(mockSF.loads.length).toBe(before);
  });
});

// Land every pending prefetch load until nothing new is asked (the idle fill asks in an idle slice after the window lands).
async function landAll() {
  for (let quiet = 0, guard = 0; quiet < 2 && guard < 60; guard++) {
    const open = mockSF.loads.filter((x) => !x.done);
    for (const l of open) { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 55000 }); }
    await flush();
    quiet = open.length ? 0 : quiet + 1;
  }
}
const asked = () => mockSF.loads.map((l) => mockSF.index.frames.findIndex((f) => f.valid_time === l.frame.valid_time));

describe('adaptive idle fill (on demand first, then the rest of the run on a capable desktop)', () => {
  let vis = 'visible';
  beforeEach(() => {
    vis = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
    ['__RAW_DISABLE_FRAME_IDLE_FILL__', '__RAW_FRAME_PREFETCH_EAGER__', 'matchMedia'].forEach((k) => delete window[k]);
    window.__RAW_FRAME_STORE_TIER__ = 'desktop';                            // jsdom's device facts are not a desktop's
    delete window.navigator.connection;
  });
  afterEach(() => { delete document.visibilityState; delete window.navigator.connection; delete window.matchMedia; delete window.__RAW_FRAME_STORE_TIER__; });
  const link = (c) => Object.defineProperty(window.navigator, 'connection', { configurable: true, value: c });

  it('opens with the +-8 window only, then, once it has landed, fills the rest of the run in idle time', async () => {
    const { eng } = setup({ n: 30 });
    commitHour(eng, 10);                                                   // the first draw: plan around frame 10
    expect(asked().every((k) => Math.abs(k - 10) <= 8)).toBe(true);
    expect(window.__RAW_FRAME_STORE__.fill.key).toBeNull();
    await landAll();
    const order = asked();
    expect(new Set(order).size).toBe(30);                                  // the whole run
    expect(order.slice(0, 17).every((k) => Math.abs(k - 10) <= 8)).toBe(true);   // the window first, all of it
    const f = window.__RAW_FRAME_STORE__.fill;
    expect(f.key).toBe(window.__RAW_FRAME_STORE__.sets[0].key);
    expect(f.startedMs).not.toBeNull();
    expect(f.doneMs).not.toBeNull();                                       // every built frame packed
    expect(f.doneMs).toBeGreaterThanOrEqual(f.startedMs);
  });

  it.each([
    ['the kill switch', () => { window.__RAW_DISABLE_FRAME_IDLE_FILL__ = true; }, 'killed'],
    ['a link that turns on Save-Data', () => link({ saveData: true, effectiveType: '4g' }), 'save_data'],
    ['a slow link', () => link({ saveData: false, effectiveType: '3g' }), 'slow_link'],
    ['a coarse primary pointer', () => { window.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' }); }, 'coarse_pointer'],
  ])('stays on demand with %s', async (_, arrange, reason) => {
    const { eng } = setup({ n: 30 });
    arrange();
    commitHour(eng, 10);
    await landAll();
    expect(new Set(asked()).size).toBe(17);                                // the window, nothing more
    expect(window.__RAW_FRAME_STORE__.fill).toMatchObject({ key: null, blocked: reason });
  });

  it('stays on demand on a phone tier (and with Save-Data from the start, the constrained tier)', async () => {
    window.__RAW_FRAME_STORE_TIER__ = 'handheld';
    const { eng } = setup({ n: 30 });
    commitHour(eng, 10);
    await landAll();
    expect(new Set(asked()).size).toBe(17);
    expect(window.__RAW_FRAME_STORE__.fill.blocked).toBe('tier');
  });

  it('a 4G link and no Network Information API both count as fine on a desktop', async () => {
    const { eng } = setup({ n: 20 });
    link({ saveData: false, effectiveType: '4g' });
    commitHour(eng, 5);
    await landAll();
    expect(new Set(asked()).size).toBe(20);
  });

  it('a hidden tab waits; visible again, the fill resumes', async () => {
    const { eng } = setup({ n: 30 });
    vis = 'hidden';
    commitHour(eng, 10);
    await landAll();
    expect(new Set(asked()).size).toBe(17);
    expect(window.__RAW_FRAME_STORE__.fill.blocked).toBe('hidden');
    vis = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await landAll();
    expect(new Set(asked()).size).toBe(30);
  });

  it('hiding the tab mid-fill stops new requests beyond the window', async () => {
    const { eng } = setup({ n: 60 });
    commitHour(eng, 10);
    // Land the window, then the fill's first requests start; hide the tab before they land.
    for (let i = 0; i < 6 && !window.__RAW_FRAME_STORE__.fill.planned; i++) {
      mockSF.loads.filter((x) => !x.done).forEach((l) => { l.done = true; l.resolve({ parsed: PARSED, buffer: null, wire: 1 }); });
      await flush();
    }
    expect(window.__RAW_FRAME_STORE__.fill.planned).toBe(true);
    vis = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(window.__RAW_FRAME_STORE__.fill.planned).toBe(false);
    await landAll();                                                       // the requests already out still land
    expect(new Set(asked()).size).toBeLessThan(60);
  });
});
