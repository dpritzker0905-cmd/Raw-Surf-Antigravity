import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import { parseFrame } from './staticFrameCodec';
import { packStaticFrame } from './marineFramePack';

// #422's loader, controlled: the pinned index, the parsed-frame hook and the prefetch load.
const mockSF = { enabled: true, index: null, hooks: new Set(), loads: [] };
jest.mock('./staticFrames', () => ({
  staticFramesEnabled: () => mockSF.enabled,
  setKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,
  storeSetKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,   // the plain set (no filled set in these mocks)
  storeCropSetKeyFor: () => null,   // one set per model in these mocks: no separate mid-zoom crop set (2026-10-26)
  getPinnedIndexSync: () => mockSF.index,
  getPinnedIndex: async () => mockSF.index,
  staticEligible: ({ model }) => String(model).toUpperCase() === 'GFS',   // one published set: no warm frames of other models
  onStaticFrameParsed: (fn) => { mockSF.hooks.add(fn); return () => mockSF.hooks.delete(fn); },
  loadFrameParsed: (key, frame, signal, opts) => new Promise((resolve) => { mockSF.loads.push({ key, frame, signal, opts, resolve }); }),
}));
import * as RT from './marineFrameStoreRuntime';
// (this file: the same controlled loader as marineFrameStoreRuntime.test.js, for the non-waves marine layers)

// These pack REAL world frames (the idle-fill cases pack a whole run): under a full parallel run a case can pass 5 s.
jest.setTimeout(20000);

const PARSED = parseFrame(zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64')));
const vt = (k) => new Date(Date.UTC(2026, 9, 20, 0) + k * 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
let KEY = 'GFS/marine/waves/global_mid';
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
const commitHour = (eng, k, layer) => RT.noteCommitted({ served_valid_time: vt(k), cols: 181, rows: 83, __sourceModel: 'GFS', __componentLayer: layer }, { hour: k * 3, model: 'GFS', layer });

beforeEach(() => { RT._resetFrameStoreRuntimeForTest(); mockSF.enabled = true; mockSF.hooks.clear(); mockSF.loads = [];
  ['__RAW_DISABLE_FRAME_STORE__', '__RAW_DISABLE_FRAME_PREFETCH__', '__RAW_DISABLE_FRAME_STORE_GPU__', '__RAW_DISABLE_FRAME_IDLE_FILL__',
    '__WEBGL_MARINE_THEME__', '__MARINE_DRAWN__', '__RAW_DISABLE_FRAME_STORE_ALL_LAYERS__'].forEach((k) => delete window[k]); });


// EVERY MARINE LAYER (2026-11-12, move 3): the store packs, holds and shows swell_1 / swell_2 / wind_waves frames the way it does
// waves (their bytes are the encoder's: marineFramePack.parity.test.js), and the kill puts it back to waves only.
describe('GPU-resident frames runtime: every marine layer', () => {
  const engineFor = (eng, layer) => { eng._waveData.waveGrid.__componentLayer = layer; return eng; };

  it.each(['swell_1', 'swell_2', 'wind_waves'])('%s: a step after a commit of the same set shows the stored frame at once', async (layer) => {
    KEY = `GFS/marine/${layer}/global_mid`;
    const { calls, eng } = setup();
    engineFor(eng, layer);
    await parse(0); await parse(1);
    commitHour(eng, 0, layer);
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer, hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);
    const up = calls.find((c) => c[0] === 'texSubImage2D');
    expect(up[2].byteLength).toBe(eng._texWidth * eng._texHeight * 4);
    expect(Array.from(up[2])).toEqual(Array.from(packStaticFrame(PARSED, { layer }).bytes));   // the packer's exact bytes for this layer
    expect(window.__MARINE_DRAWN__).toMatchObject({ hour: 3, validTime: vt(1), model: 'GFS', layer });
  });

  it('OFF PATH: __RAW_DISABLE_FRAME_STORE_ALL_LAYERS__ = true leaves a swell step to the normal path; waves still shows', async () => {
    window.__RAW_DISABLE_FRAME_STORE_ALL_LAYERS__ = true;
    KEY = 'GFS/marine/swell_1/global_mid';
    const { calls, eng } = setup();
    engineFor(eng, 'swell_1');
    await parse(0); await parse(1);
    commitHour(eng, 0, 'swell_1');
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'swell_1', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);
    expect(calls.filter((c) => c[0] === 'texSubImage2D')).toEqual([]);

    RT._resetFrameStoreRuntimeForTest(); mockSF.hooks.clear(); mockSF.loads = [];
    KEY = 'GFS/marine/waves/global_mid';
    const w = setup();
    engineFor(w.eng, 'waves');
    await parse(0); await parse(1);
    commitHour(w.eng, 0, 'waves');
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);
  });
});
