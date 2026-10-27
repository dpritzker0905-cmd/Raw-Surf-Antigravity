/**
 * INSTANT MODEL TOGGLES AT MID ZOOM (2026-10-22, #458 on #459): the resident is a viewport clip of one model's frame; a model click
 * shows the same window of the new model's frame with the window's OWN chl/bath, and that clip becomes the crop resident.
 * One REAL GFS world frame (marineFramePack's fixture) and a model-like variant of it on the same lattice.
 */
import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import { parseFrame } from './staticFrameCodec';
import { midClipWindow } from './staticFrameCrop';
import { frameWindowOf, packWindow } from './marineFrameStoreCrop';
import { auxForPack } from './marineFrameAux';

const mockSF = { enabled: true, byKey: {}, eligible: ['GFS', 'ICON'], hooks: new Set(), loads: [] };
jest.mock('./staticFrames', () => ({
  staticFramesEnabled: () => mockSF.enabled,
  setKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,
  storeSetKeyFor: (m, l) => `${String(m).toUpperCase()}/marine/${String(l).toLowerCase()}/global_mid`,   // the plain set (no filled set in these mocks)
  getPinnedIndexSync: (k) => mockSF.byKey[k] || null,
  getPinnedIndex: async (k) => mockSF.byKey[k] || null,
  staticEligible: ({ model }) => mockSF.eligible.includes(String(model).toUpperCase()),
  onStaticFrameParsed: (fn) => { mockSF.hooks.add(fn); return () => mockSF.hooks.delete(fn); },
  loadFrameParsed: (key, frame, signal, opts) => new Promise((resolve) => { mockSF.loads.push({ key, frame, signal, opts, resolve }); }),
}));
import * as RT from './marineFrameStoreRuntime';

// These pack REAL world frames and compute their chl/bath (~63 ms each): under a full parallel run a case can pass 5 s.
jest.setTimeout(20000);

const PARSED = parseFrame(zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64')));
const IG = { bounds: PARSED.bounds, cols: PARSED.cols, rows: PARSED.rows };
const GFS = 'GFS/marine/waves/global_mid';
const ICON = 'ICON/marine/waves/global_mid';
const vt = (k) => new Date(Date.UTC(2026, 9, 20, 0) + k * 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };

const WIN = midClipWindow('-95,20,-65,35', IG, 'GFS');
const CLIP = (model, k) => ({ bounds: WIN.bounds, cols: WIN.cols, rows: WIN.rows, served_valid_time: vt(k), __sourceModel: model, __componentLayer: 'waves' });
const W0 = frameWindowOf(CLIP('GFS', 0), IG);
// ICON on the same lattice with its own field: heights x1.1 and a few more invalid cells deep inside the window (its trim unchanged).
const inner = new Set(); for (let r = W0.r0 + 5; r < W0.r0 + 9; r++) for (let c = W0.c0 + 8; c < W0.c0 + 12; c++) inner.add(r * IG.cols + c);
const ICON_PARSED = { ...PARSED, fields: { ...PARSED.fields, 0: Float64Array.from(PARSED.fields[0], (h, i) => (inner.has(i) ? NaN : h * 1.1)) } };
const GFS_PACK = packWindow(PARSED, W0);
const ICON_PACK = packWindow(ICON_PARSED, W0);

const indexFor = (model, grid = IG) => ({ path: `v1/idx/${model}.json`, run: 'r', grid, common_meta: { model, layer: 'waves', provider: `${model.toLowerCase()}-p` },
  frames: Array.from({ length: 8 }, (_, k) => ({ valid_time: vt(k), path: `v1/${model}/${k}.bin`, meta: { product_id: `${model}${k}` } })) });

function setup({ iconGrid } = {}) {
  RT._resetFrameStoreRuntimeForTest(); mockSF.hooks.clear(); mockSF.loads = []; mockSF.enabled = true; mockSF.eligible = ['GFS', 'ICON'];
  mockSF.byKey = { [GFS]: indexFor('GFS'), [ICON]: indexFor('ICON', iconGrid) };
  const calls = []; let bound = null;
  const gl = { TEXTURE_2D: 'T2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UB', TEXTURE_BINDING_2D: 'B2D', UNPACK_FLIP_Y_WEBGL: 'FLIP', UNPACK_PREMULTIPLY_ALPHA_WEBGL: 'PRE',
    getParameter: () => null, bindTexture: (t, x) => { bound = x; }, pixelStorei: () => {}, texSubImage2D: (...a) => calls.push([bound, a[8]]) };
  const wave = { id: 'wave' }; const chl = { id: 'chl' }; const bath = { id: 'bath' };
  const eng = { _residentWaveTex: wave, _residentChlTex: chl, _residentBathTex: bath, _texWidth: GFS_PACK.cols, _texHeight: GFS_PACK.rows,
    _waveData: { u_waveTexture: wave, u_chlorophyllTexture: chl, u_bathymetryTexture: bath, bounds: { ...GFS_PACK.bounds },
      waveGrid: { cols: GFS_PACK.cols, rows: GFS_PACK.rows, bounds: { ...GFS_PACK.bounds }, hourOffset: 0, __sourceModel: 'GFS', __componentLayer: 'waves' } } };
  RT.registerFrameStoreTarget({ getEngine: () => eng, getGl: () => gl, getMap: () => ({ triggerRepaint: () => {} }) });
  return { calls, eng };
}
const landAll = async (pick = () => true, parsedFor = (l) => (l.key === ICON ? ICON_PARSED : PARSED)) => {
  for (let i = 0; i < 10; i++) { mockSF.loads.filter((l) => !l.done && pick(l)).forEach((l) => { l.done = true; l.resolve({ parsed: parsedFor(l), buffer: null, wire: 1 }); }); await flush(); }
};
const parse = async (key, k, parsed) => { for (const fn of mockSF.hooks) fn({ key, frame: mockSF.byKey[key].frames[k], parsed, buffer: null }); await flush(); };
const residentGfsClip = async () => { RT.noteCommitted(CLIP('GFS', 0), { hour: 0, model: 'GFS', layer: 'waves' }); await landAll((l) => l.key === GFS); };
const toIcon = (k) => RT.tryShowStoredFrameForSwitch({ model: 'ICON', layer: 'waves', hourOffset: k * 3, requestedValidTime: vt(k) });
const snap = () => window.__RAW_FRAME_STORE__;
const KILLS = ['__RAW_DISABLE_FRAME_MODEL_TOGGLE__', '__RAW_DISABLE_FRAME_AUX_SHOW__', '__RAW_DISABLE_FRAME_STORE_CROP__', '__RAW_FRAME_STORE_TIER__', '__MARINE_DRAWN__', '__RAW_DISABLE_FRAME_STASH_SUPERSEDE__'];
afterEach(() => KILLS.forEach((k) => delete window[k]));

describe('a model click on a mid-zoom clip shows the new model\'s window with its own chl/bath', () => {
  it('uploads ICON\'s window bytes and the window\'s exact chl/bath, and the ICON clip becomes the crop resident', async () => {
    const { calls, eng } = setup();
    await residentGfsClip();
    expect(snap().crop.resident).toMatchObject({ setKey: expect.stringContaining('GFS'), cols: GFS_PACK.cols, rows: GFS_PACK.rows });
    await parse(ICON, 2, ICON_PARSED);                                   // ICON's frame lands while the GFS clip is resident
    calls.length = 0;
    expect(toIcon(2)).toBe(true);
    const aux = auxForPack(ICON_PACK);
    const to = (tex) => calls.filter((c) => c[0] === tex).map((c) => c[1]);
    expect(firstDiff(to(eng._residentWaveTex)[0], ICON_PACK.bytes)).toBe(-1);   // the encoder's bytes for ICON's clip
    expect(firstDiff(to(eng._residentChlTex)[0], aux.chl)).toBe(-1);
    expect(firstDiff(to(eng._residentBathTex)[0], aux.bath)).toBe(-1);
    expect(firstDiff(ICON_PACK.bytes, GFS_PACK.bytes)).not.toBe(-1);    // a real change of model
    expect(eng._waveData.waveGrid).toMatchObject({ __sourceModel: 'ICON', served_valid_time: vt(2), productId: 'ICON2', provider: 'icon-p', __fromFrameStore: true });
    expect(window.__MARINE_DRAWN__).toMatchObject({ model: 'ICON', validTime: vt(2) });
    expect(snap().crop.resident).toMatchObject({ setKey: expect.stringContaining('ICON'), validityHash: ICON_PACK.validityHash });
    expect(snap().crop.window).toMatchObject({ setKey: expect.stringContaining('ICON'), key: W0.key });   // the window is ICON's now
    expect(snap().shows).toMatchObject({ cropSwitch: 1, crossModel: 1 });
    expect(snap().switches).toMatchObject({ asked: 1, shown: 1 });
  });

  it('after the click, an ICON wheel step takes the crop path on ICON\'s own window packs', async () => {
    const { calls } = setup();
    await residentGfsClip();
    await parse(ICON, 2, ICON_PARSED);
    expect(toIcon(2)).toBe(true);
    await parse(ICON, 3, ICON_PARSED);
    calls.length = 0;
    expect(RT.tryShowStoredFrame({ model: 'ICON', layer: 'waves', hourOffset: 9, requestedValidTime: vt(3) })).toBe(true);
    expect(calls).toHaveLength(1);                                       // wave bytes only: the clip's chl/bath are ICON's already
    expect(firstDiff(calls[0][1], ICON_PACK.bytes)).toBe(-1);
    expect(snap().crop.shows).toBe(2);
  });

  it('the click supersedes a stashed downgrade reject of the previous model (it must never resurrect under ICON)', async () => {
    const { eng } = setup();
    await residentGfsClip();
    await parse(ICON, 2, ICON_PARSED);
    eng._pendingDowngrade = { __sourceModel: 'GFS', __componentLayer: 'waves', productId: 'GFS0', hourOffset: 0, cols: 181, rows: 83 };
    expect(toIcon(2)).toBe(true);
    expect(eng._pendingDowngrade).toBeNull();
    expect(snap().shows.stashSuperseded).toBe(1);
  });

  it('a step keeps a stash of the SAME product (another extent of the frame now drawn: a zoom-out brings it back)', async () => {
    const { eng } = setup();
    await residentGfsClip();
    await parse(GFS, 1, PARSED);
    const stash = { __sourceModel: 'GFS', __componentLayer: 'waves', productId: 'GFS1', hourOffset: 3, cols: 181, rows: 83 };
    eng._pendingDowngrade = stash;
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);
    expect(eng._pendingDowngrade).toBe(stash);
  });

  it('a step supersedes a stash of another hour; the kill switch keeps it', async () => {
    const { eng } = setup();
    await residentGfsClip();
    await parse(GFS, 1, PARSED); await parse(GFS, 2, PARSED);
    eng._pendingDowngrade = { __sourceModel: 'GFS', __componentLayer: 'waves', productId: 'GFS0', hourOffset: 0, cols: 181, rows: 83 };
    window.__RAW_DISABLE_FRAME_STASH_SUPERSEDE__ = true;
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);
    expect(eng._pendingDowngrade).not.toBeNull();
    delete window.__RAW_DISABLE_FRAME_STASH_SUPERSEDE__;
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 6, requestedValidTime: vt(2) })).toBe(true);
    expect(eng._pendingDowngrade).toBeNull();
  });

  // #461: the store indexes no EURO/ICON set (/grid's world Gulf fill), so their clips arrive by the normal path only.
  const euroClipCommit = (eng, k) => {
    eng._waveData.waveGrid = { ...eng._waveData.waveGrid, __sourceModel: 'EURO', productId: `EURO${k}`, hourOffset: k * 3 };
    RT.noteCommitted(CLIP('EURO', k), { hour: k * 3, model: 'EURO', layer: 'waves' });
  };

  it('a click to a model the store does not index (EURO since #461) is the normal path: no show, no loads', async () => {
    const { calls } = setup();
    await residentGfsClip();
    calls.length = 0; const before = mockSF.loads.length;
    expect(RT.tryShowStoredFrameForSwitch({ model: 'EURO', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);
    expect(snap().shows.misses.no_index).toBe(1);
    expect(calls).toEqual([]);
    expect(mockSF.loads.length).toBe(before);
  });

  it('a normal EURO clip commit ends the GFS clip resident (same box, other model), and a click back to GFS shows GFS\'s window with its own chl/bath', async () => {
    const { calls, eng } = setup();
    await residentGfsClip();
    await parse(GFS, 1, PARSED);
    euroClipCommit(eng, 1);
    expect(snap().commits.no_index).toBe(1);
    expect(snap().crop.resident).toMatchObject({ foreign: true, model: 'EURO' });
    calls.length = 0;
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);   // a step never
    expect(calls).toEqual([]);
    expect(RT.tryShowStoredFrameForSwitch({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(true);   // the click
    const P1 = packWindow(PARSED, W0); const aux = auxForPack(P1);
    const to = (tex) => calls.filter((c) => c[0] === tex).map((c) => c[1]);
    expect(firstDiff(to(eng._residentWaveTex)[0], P1.bytes)).toBe(-1);
    expect(firstDiff(to(eng._residentChlTex)[0], aux.chl)).toBe(-1);
    expect(firstDiff(to(eng._residentBathTex)[0], aux.bath)).toBe(-1);
    expect(eng._waveData.waveGrid.__sourceModel).toBe('GFS');
    expect(snap().crop.resident).toMatchObject({ setKey: expect.stringContaining('GFS') });
  });

  it('a rating grid of the same box ends the clip resident: no window pack is written over it', async () => {
    const { calls, eng } = setup();
    await residentGfsClip();
    await parse(GFS, 1, PARSED);
    eng._waveData.waveGrid = { ...eng._waveData.waveGrid, ratingMode: true };
    RT.noteCommitted({ ...CLIP('GFS', 0), ratingMode: true }, { hour: 0, model: 'GFS', layer: 'waves' });
    calls.length = 0;
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 3, requestedValidTime: vt(1) })).toBe(false);
    expect(calls).toEqual([]);
  });

  it("crop builds ask 'high' for the frame a commit, a step or a click needs and 'low' for build-ahead (fetch priority)", async () => {
    setup();
    await parse(GFS, 1, PARSED); await parse(GFS, 2, PARSED);           // stored before the window: build-ahead re-reads them
    RT.noteCommitted(CLIP('GFS', 0), { hour: 0, model: 'GFS', layer: 'waves' });
    await flush();
    const builds = () => mockSF.loads.filter((l) => !l.signal);           // the prefetcher's loads carry an AbortSignal; crop builds none
    expect(builds()[0]).toMatchObject({ key: GFS, opts: { priority: 'high' } });
    expect(builds()[0].frame.valid_time).toBe(vt(0));                     // the committed frame's own window pack
    await landAll((l) => !l.signal && l.frame.valid_time === vt(0));
    expect(builds().slice(1).length).toBeGreaterThan(0);
    expect(builds().slice(1).every((l) => l.opts.priority === 'low')).toBe(true);   // build-ahead
    const n = builds().length;
    expect(RT.tryShowStoredFrame({ model: 'GFS', layer: 'waves', hourOffset: 21, requestedValidTime: vt(7) })).toBe(false);   // not built yet
    const miss = builds().slice(n).find((l) => l.frame.valid_time === vt(7));
    expect(miss).toMatchObject({ opts: { priority: 'high' } });
  });

  it('a wheel step (not a click) never crosses models on a clip', async () => {
    const { calls } = setup();
    await residentGfsClip();
    await parse(ICON, 2, ICON_PARSED);
    calls.length = 0;
    expect(RT.tryShowStoredFrame({ model: 'ICON', layer: 'waves', hourOffset: 6, requestedValidTime: vt(2) })).toBe(false);
    expect(calls).toEqual([]);
  });

  it.each([
    ['the exact-aux kill', () => { window.__RAW_DISABLE_FRAME_AUX_SHOW__ = true; }],
    ['the crop kill', () => { window.__RAW_DISABLE_FRAME_STORE_CROP__ = true; }],
    ['the model-toggle kill', () => { window.__RAW_DISABLE_FRAME_MODEL_TOGGLE__ = true; }],
    ['the engine sampling non-resident chl', (eng) => { eng._waveData.u_chlorophyllTexture = { other: true }; }],
    ['the engine sampling non-resident bathymetry', (eng) => { eng._waveData.u_bathymetryTexture = { other: true }; }],
    ['the engine sampling a non-resident wave texture', (eng) => { eng._waveData.u_waveTexture = { other: true }; }],
    ['a rating grid resident', (eng) => { eng._waveData.waveGrid.ratingMode = true; }],
  ])('refuses with %s (nothing uploaded, the GFS clip stays)', async (_, arrange) => {
    const { calls, eng } = setup();
    await residentGfsClip();
    await parse(ICON, 2, ICON_PARSED);
    arrange(eng);
    calls.length = 0;
    expect(toIcon(2)).toBe(false);
    expect(calls).toEqual([]);
    expect(eng._waveData.waveGrid.__sourceModel).toBe('GFS');
  });

  it('a new model on ANOTHER lattice is never cut by the window', async () => {
    const other = { bounds: { ...IG.bounds, south: IG.bounds.south + 2 }, cols: IG.cols, rows: IG.rows };
    const { calls, eng } = setup({ iconGrid: other });
    await residentGfsClip();
    await parse(ICON, 2, ICON_PARSED);
    calls.length = 0;
    expect(toIcon(2)).toBe(false);
    expect(calls).toEqual([]);
    expect(eng._waveData.waveGrid.__sourceModel).toBe('GFS');
  });

  it('a click before ICON\'s window pack exists misses, builds it, and shows it the moment it lands (with its chl/bath)', async () => {
    const { calls, eng } = setup();
    await residentGfsClip();
    expect(toIcon(4)).toBe(false);
    expect(snap().shows.misses.crop_not_ready).toBe(1);
    RT.noteStep({ model: 'ICON', layer: 'waves', requestedValidTime: vt(4) });   // the seam moves the prefetch to ICON
    calls.length = 0;
    await landAll((l) => l.key === ICON && l.frame.valid_time === vt(4));
    expect(snap().shows.deferred).toBe(1);
    expect(eng._waveData.waveGrid).toMatchObject({ __sourceModel: 'ICON', served_valid_time: vt(4) });
    expect(calls.map((c) => c[0])).toEqual([eng._residentChlTex, eng._residentBathTex, eng._residentWaveTex]);
  });

  it('warm ICON frames that landed BEFORE the window (at world zoom) get its packs when the window becomes resident', async () => {
    window.__RAW_FRAME_STORE_TIER__ = 'desktop';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    const { eng } = setup();
    await parse(ICON, 0, ICON_PARSED); await parse(ICON, 1, ICON_PARSED);   // packed before any window exists
    RT.noteCommitted(CLIP('GFS', 0), { hour: 0, model: 'GFS', layer: 'waves' });   // the clip: a fresh window
    await landAll((l) => l.key === ICON || (l.key === GFS && l.frame.valid_time === vt(0)));   // no further step or replan
    const before = mockSF.loads.length;
    expect(toIcon(0)).toBe(true);
    expect(mockSF.loads.length).toBe(before);                            // ready at the click
    expect(eng._waveData.waveGrid.__sourceModel).toBe('ICON');
    delete document.visibilityState;
  });

  it('on a desktop, the warm ICON frames get the window\'s packs, so the click builds nothing', async () => {
    window.__RAW_FRAME_STORE_TIER__ = 'desktop';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    const { eng } = setup();
    await residentGfsClip();
    // the commit's plan: GFS around the cursor, then ICON warm at the cursor +-1; land them all
    await landAll();
    expect(mockSF.loads.some((l) => l.key === ICON)).toBe(true);
    const before = mockSF.loads.length;
    expect(toIcon(0)).toBe(true);
    expect(mockSF.loads.slice(before).filter((l) => l.key === ICON && l.frame.valid_time === vt(0))).toEqual([]);   // nothing loaded at the click
    expect(eng._waveData.waveGrid.__sourceModel).toBe('ICON');
    delete document.visibilityState;
  });
});
