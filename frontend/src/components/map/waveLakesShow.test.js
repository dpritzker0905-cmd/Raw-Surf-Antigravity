/**
 * waveLakesShow.js (2026-10-23): a GFS frame shown from the GPU frame store (no commit, no encoder) must never draw under a mask
 * with EURO's carried lakes cut in. The show swaps the stashed plain-land mask in by reference in the same show, or declines and
 * leaves everything (mask AND wave bytes) as it was, so the normal commit draws.
 */
import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import { parseFrame } from './staticFrameCodec';
import { packStaticFrame } from './marineFramePack';
import { maskCanvasWidthForSpan } from './WebGLMarineMaskRenderer';
import { stampMaskPatch, maskGridKey } from './maskPatchKeep';
import { stashServes } from './maskTextureStash';
import { _setWaveLakesForTest, cutLakes } from './waveLakes';
import { lakeShowPlan, applyLakeSwap } from './waveLakesShow';

const mockSF = { byKey: {}, hooks: new Set(), loads: [] };
jest.mock('./staticFrames', () => ({
  staticFramesEnabled: () => true,
  setKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,
  storeSetKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,   // the plain set (no filled set in these mocks)
  storeCropSetKeyFor: () => null,   // one set per model in these mocks: no separate mid-zoom crop set (2026-10-26)
  getPinnedIndexSync: (k) => mockSF.byKey[k] || null,
  getPinnedIndex: async (k) => mockSF.byKey[k] || null,
  staticEligible: ({ model }) => String(model).toUpperCase() === 'GFS',
  onStaticFrameParsed: (fn) => { mockSF.hooks.add(fn); return () => mockSF.hooks.delete(fn); },
  loadFrameParsed: (key, frame) => new Promise((resolve) => { mockSF.loads.push({ key, frame, resolve }); }),
}));
import * as RT from './marineFrameStoreRuntime';

jest.setTimeout(20000);

const ccw = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const LAND = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ccw(-100, 30, -60, 60)] } }] };
const LAKE = { id: 'big', name: 'Big Lake', bbox: [-90, 40, -80, 50], g50: [ccw(-90, 40, -80, 50)], g10: [ccw(-90, 40, -80, 50)], anchors: [[-85, 45]] };
const WORLD = { west: -180, south: -80, east: 180, north: 84 };
const DIMS = { w: maskCanvasWidthForSpan(360), h: maskCanvasWidthForSpan(360) / 2 };
let LAKE_GEO = null;

const PARSED = parseFrame(zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64')));
const vt = (k) => new Date(Date.UTC(2026, 9, 20, 0) + k * 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const GFS = 'GFS/marine/waves/global_mid';
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

function fakeGL() {
  const calls = []; const st = { tex: null, flip: false, pre: false };
  const gl = {
    TEXTURE_2D: 'T2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UB', TEXTURE_BINDING_2D: 'B2D', UNPACK_FLIP_Y_WEBGL: 'FLIP', UNPACK_PREMULTIPLY_ALPHA_WEBGL: 'PRE',
    getParameter: (p) => ({ B2D: st.tex, FLIP: st.flip, PRE: st.pre })[p],
    createTexture: () => ({}), deleteTexture: (t) => calls.push(['deleteTexture', t]),
    bindTexture: (t, x) => { st.tex = x; }, pixelStorei: (p, v) => { if (p === 'FLIP') st.flip = v; if (p === 'PRE') st.pre = v; }, texParameteri: () => {},
    texSubImage2D: (...a) => calls.push(['texSubImage2D', st.tex, a[8]]),
  };
  return { gl, calls };
}
// The engine after an EURO commit at world zoom: the lake mask is resident, the plain-land world mask sits in the stash.
function lakeEngine({ stash = true } = {}) {
  const { cols, rows, bounds } = packStaticFrame(PARSED);
  const wave = { id: 'wave' }; const chl = { id: 'chl' }; const bath = { id: 'bath' }; const lakeTex = { id: 'lake' };
  return { _residentWaveTex: wave, _residentChlTex: chl, _residentBathTex: bath, _texWidth: cols, _texHeight: rows,
    _cachedMaskTex: lakeTex, _cachedMaskTexDims: { ...DIMS }, _cachedMaskBounds: { ...WORLD }, _cachedMaskGeoJSON: LAKE_GEO, _cachedMaskHasSDF: false,
    _maskStash: stash ? { tex: { id: 'plain' }, dims: { ...DIMS }, bounds: { ...WORLD }, geojson: LAND, hasSDF: false } : null,
    _waveData: { u_waveTexture: wave, u_chlorophyllTexture: chl, u_bathymetryTexture: bath, u_oceanMaskTexture: lakeTex, bounds: { ...bounds },
      waveGrid: { cols, rows, bounds: { ...bounds }, hourOffset: 0, served_valid_time: vt(0), __sourceModel: 'EURO', __componentLayer: 'waves' } } };
}
function setupStore(eng) {
  mockSF.byKey = { [GFS]: { path: 'v1/idx/gfs.json', run: '2026-10-20T00:00:00Z', common_meta: { model: 'GFS', layer: 'waves', provider: 'gfs' },
    frames: Array.from({ length: 12 }, (_, k) => ({ valid_time: vt(k), path: `v1/gfs/${k}.bin`, meta: { product_id: `gfs${k}` } })) } };
  const { gl, calls } = fakeGL();
  RT.registerFrameStoreTarget({ getEngine: () => eng, getGl: () => gl, getMap: () => ({ triggerRepaint: () => {} }) });
  return { gl, calls };
}
async function parse(k) { for (const fn of mockSF.hooks) fn({ key: GFS, frame: mockSF.byKey[GFS].frames[k], parsed: PARSED, buffer: null }); await flush(); }
const toGfs = (k) => RT.tryShowStoredFrameForSwitch({ model: 'GFS', layer: 'waves', hourOffset: k * 3, requestedValidTime: vt(k) });
const KILLS = ['__RAW_DISABLE_WAVE_LAKES__', '__RAW_DISABLE_MASK_STASH__', '__RAW_FRAME_STORE_TIER__', '__RAW_WAVE_LAKES__', '__MARINE_DRAWN__'];

beforeEach(() => {
  _setWaveLakesForTest({ lakes: [LAKE] });
  LAKE_GEO = cutLakes(LAND, [LAKE], 50);
  RT._resetFrameStoreRuntimeForTest(); mockSF.hooks.clear(); mockSF.loads = [];
  KILLS.forEach((k) => delete window[k]);
  window.__RAW_FRAME_STORE_TIER__ = 'desktop';
});
afterEach(() => { _setWaveLakesForTest(null); KILLS.forEach((k) => delete window[k]); });

describe('the plan', () => {
  it('keeps a plain mask, and a lake mask under the lake model; swaps for GFS/ICON when the stash serves; declines otherwise', () => {
    const eng = lakeEngine();
    expect(LAKE_GEO.__waveLakes).toEqual(['big']);
    expect(lakeShowPlan(eng, 'EURO')).toBe('keep');
    expect(lakeShowPlan(eng, 'GFS')).toBe('swap');
    expect(lakeShowPlan(eng, 'ICON')).toBe('swap');
    expect(lakeShowPlan({ ...eng, _cachedMaskGeoJSON: LAND }, 'GFS')).toBe('keep');                        // no lake cut in
    expect(lakeShowPlan(lakeEngine({ stash: false }), 'GFS')).toBe('decline');                             // nothing to swap to
    expect(lakeShowPlan({ ...eng, _maskStash: { ...eng._maskStash, geojson: { features: [] } } }, 'GFS')).toBe('decline');   // another land
    expect(lakeShowPlan({ ...eng, _regionalPatchState: { degraded: true, gridKey: maskGridKey(WORLD) } }, 'GFS')).toBe('decline');
    window.__RAW_DISABLE_MASK_STASH__ = true;
    expect(lakeShowPlan(eng, 'GFS')).toBe('decline');
    window.__RAW_DISABLE_WAVE_LAKES__ = true;
    expect(lakeShowPlan(eng, 'GFS')).toBe('keep');                                                       // kill: never a lake
  });
});

describe('the swap', () => {
  it('binds the plain mask by reference, stashes the lake mask, and switching back is a swap too', () => {
    const eng = lakeEngine(); const { gl, calls } = fakeGL();
    const lakeTex = eng._cachedMaskTex; const plain = eng._maskStash.tex;
    expect(applyLakeSwap(gl, eng)).toBe(true);
    expect(eng._waveData.u_oceanMaskTexture).toBe(plain);
    expect(eng._cachedMaskTex).toBe(plain);
    expect(eng._cachedMaskGeoJSON).toBe(LAND);
    expect(eng._maskStash).toMatchObject({ tex: lakeTex, geojson: LAKE_GEO });
    expect(calls).toEqual([]);                                                                          // no upload, no delete
    expect(lakeShowPlan(eng, 'GFS')).toBe('keep');
    expect(stashServes(eng._maskStash, LAKE_GEO, WORLD, null)).toBe(true);                              // EURO again: the encoder swaps back
    expect(window.__RAW_WAVE_LAKES__.showSwaps).toBe(1);
  });
  it('the plain mask in the stash\'s variant slot serves the swap too', () => {
    const eng = lakeEngine(); const { gl } = fakeGL();
    const plain = eng._maskStash;
    eng._maskStash2 = plain; eng._maskStash = { tex: { id: 'other' }, dims: { w: 2048, h: 1024 }, bounds: { west: -90, south: 40, east: -80, north: 45 }, geojson: LAND, hasSDF: false };
    expect(lakeShowPlan(eng, 'GFS')).toBe('swap');
    expect(applyLakeSwap(gl, eng)).toBe(true);
    expect(eng._waveData.u_oceanMaskTexture).toBe(plain.tex);
    expect(eng._maskStash2 && eng._maskStash2.tex.id).toBe('other');                         // the slot-1 entry moved down
    expect(eng._maskStash.tex.id).toBe('lake');                                              // the lake mask is held for EURO
  });
  it('the swapped-in mask brings back its own clean paint record; none -> null', () => {
    const eng = lakeEngine(); const { gl } = fakeGL();
    const rec = { gridKey: maskGridKey(WORLD), box: { ...WORLD }, degraded: false };
    stampMaskPatch(eng._maskStash.tex, rec);
    eng._regionalPatchState = { gridKey: maskGridKey(WORLD), box: { ...WORLD }, degraded: false, of: 'lake' };
    applyLakeSwap(gl, eng);
    expect(eng._regionalPatchState).toBe(rec);
    const eng2 = lakeEngine(); eng2._regionalPatchState = { gridKey: maskGridKey(WORLD), of: 'lake' };
    applyLakeSwap(gl, eng2);
    expect(eng2._regionalPatchState).toBe(null);
  });
});

describe('the frame store\'s EURO -> GFS switch', () => {
  it('shows the GFS frame AND the plain mask in the same show', async () => {
    const eng = lakeEngine(); const { calls } = setupStore(eng);
    const plain = eng._maskStash.tex;
    await parse(2);
    calls.length = 0;
    expect(toGfs(2)).toBe(true);
    expect(eng._waveData.waveGrid).toMatchObject({ __sourceModel: 'GFS', served_valid_time: vt(2) });
    expect(eng._waveData.u_oceanMaskTexture).toBe(plain);
    expect(calls.some((c) => c[0] === 'texSubImage2D' && c[1] === eng._residentWaveTex)).toBe(true);
    expect(window.__RAW_WAVE_LAKES__.showSwaps).toBe(1);
  });
  it('with no plain mask ready it declines and changes nothing: no wave bytes, no mask, no grid', async () => {
    const eng = lakeEngine({ stash: false }); const { calls } = setupStore(eng);
    const lakeTex = eng._cachedMaskTex; const grid = eng._waveData.waveGrid;
    await parse(2);
    calls.length = 0;
    expect(toGfs(2)).toBe(false);
    expect(window.__RAW_FRAME_STORE__.shows.misses.lake_mask).toBe(1);
    expect(calls).toEqual([]);
    expect(eng._waveData.u_oceanMaskTexture).toBe(lakeTex);
    expect(eng._waveData.waveGrid).toBe(grid);
  });
  it('kill switch: the show runs as before and leaves the mask alone (no lake was ever cut in that build)', async () => {
    const eng = lakeEngine(); setupStore(eng);
    const lakeTex = eng._cachedMaskTex;
    await parse(2);
    window.__RAW_DISABLE_WAVE_LAKES__ = true;
    expect(toGfs(2)).toBe(true);
    expect(eng._waveData.u_oceanMaskTexture).toBe(lakeTex);
  });
});
