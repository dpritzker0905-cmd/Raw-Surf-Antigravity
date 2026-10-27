/**
 * EURO/ICON AT MID ZOOM FROM THE STORE (2026-10-26, the owner's live test: at z4.6-5.3 ICON and EURO scrubbed from /grid_series pages
 * and far jumps waited on /grid, while GFS scrubbed from the store). The server Gulf-fills only a WORLD-span grid (coarse_gulf_fill:
 * span < 350 returns the product as stored), so a viewport clip of EURO/ICON is the PLAIN stored product, windowed. Pins:
 *  - a EURO clip commit becomes the crop resident of the PLAIN set (never the filled one), and a wheel step shows EURO's window bytes;
 *  - a GFS clip resident: a click to EURO shows EURO's window from the plain set (the instant mid-zoom toggle);
 *  - the plain set is a crop source only: a world-sized EURO frame comes from the filled set, and the plain set is never a world resident;
 *  - the kill (__RAW_DISABLE_PLAIN_SET_CROPS__) is today's behaviour: EURO clips are foreign, a step at mid zoom is the normal path.
 * One REAL GFS world frame (marineFramePack's fixture) and a EURO-like variant of it on the same lattice.
 */
import zlib from 'zlib';
import { REAL_GFS_FRAME_GZ_BASE64 } from './marineFramePack.realFrame.fixture';
import { parseFrame } from './staticFrameCodec';
import { midClipWindow } from './staticFrameCrop';
import { frameWindowOf, packWindow } from './marineFrameStoreCrop';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

// The products manifest the parity gate reads (staticFrameCrop.plainClipServable): EURO's world tiers only, unless a test adds a tile.
const prod = (region_id, coverage) => ({ model: 'EURO', domain: 'marine', layer: 'waves', region_id, coverage, valid_time_start: '2026-10-20T00:00:00Z', valid_time_end: '2026-10-21T00:00:00Z' });
const WORLD_ONLY = { products: [prod('global_mid', { west: -180, south: -80, east: 180, north: 85 }), prod('global_coarse', { west: -180, south: -80, east: 180, north: 85 })] };
const mockSF = { enabled: true, byKey: {}, pinned: new Set(), pinAsks: [], hooks: new Set(), loads: [] };
const killed = () => window.__RAW_DISABLE_PLAIN_SET_CROPS__ === true;
jest.mock('./staticFrames', () => ({
  staticFramesEnabled: () => mockSF.enabled,
  // the real rule (staticFrames.storeSetKeyFor / storeCropSetKeyFor / getPinnedIndexSync) for a box in the targeted mode
  storeSetKeyFor: (m, l) => (String(m).toUpperCase() === 'GFS' ? `GFS/marine/${l}/global_mid` : `${String(m).toUpperCase()}/marine/${l}/global_mid_filled`),
  storeCropSetKeyFor: (m, l) => (String(m).toUpperCase() !== 'GFS' && !killed() ? `${String(m).toUpperCase()}/marine/${l}/global_mid` : null),
  getPinnedIndexSync: (k, { crop = false } = {}) => {
    const idx = mockSF.pinned.has(k) ? mockSF.byKey[k] || null : null;
    const guardedPlain = !k.startsWith('GFS/') && !k.endsWith('_filled');
    return idx && guardedPlain && !(crop && !killed()) ? null : idx;
  },
  getPinnedIndex: async (k) => { mockSF.pinAsks.push(k); if (mockSF.byKey[k]) mockSF.pinned.add(k); return mockSF.byKey[k] || null; },
  staticEligible: () => true,
  onStaticFrameParsed: (fn) => { mockSF.hooks.add(fn); return () => mockSF.hooks.delete(fn); },
  loadFrameParsed: (key, frame, signal, opts) => new Promise((resolve) => { mockSF.loads.push({ key, frame, signal, opts, resolve }); }),
}));
import * as RT from './marineFrameStoreRuntime';

jest.setTimeout(20000);   // real world frames are packed (and their chl/bath computed) here

const PARSED = parseFrame(zlib.gunzipSync(Buffer.from(REAL_GFS_FRAME_GZ_BASE64, 'base64')));
const IG = { bounds: PARSED.bounds, cols: PARSED.cols, rows: PARSED.rows };
const GFS = 'GFS/marine/waves/global_mid';
const EURO = 'EURO/marine/waves/global_mid';
const EURO_FILLED = 'EURO/marine/waves/global_mid_filled';
const vt = (k) => new Date(Date.UTC(2026, 9, 20, 0) + k * 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };

const WIN = midClipWindow('-95,20,-65,35', IG, 'GFS');
const CLIP = (model, k) => ({ bounds: WIN.bounds, cols: WIN.cols, rows: WIN.rows, served_valid_time: vt(k), __sourceModel: model, __componentLayer: 'waves' });
const W0 = frameWindowOf(CLIP('GFS', 0), IG);
const EURO_PARSED = { ...PARSED, fields: { ...PARSED.fields, 0: Float64Array.from(PARSED.fields[0], (h) => h * 0.9) } };
const GFS_PACK = packWindow(PARSED, W0);
const EURO_PACK = packWindow(EURO_PARSED, W0);

const indexFor = (model, tag) => ({ path: `v1/idx/${tag}.json`, run: 'r', grid: IG, common_meta: { model, layer: 'waves', provider: `${tag}-p` },
  frames: Array.from({ length: 8 }, (_, k) => ({ valid_time: vt(k), path: `v1/${tag}/${k}.bin`, meta: { product_id: `${tag}${k}` } })) });

function setup({ model = 'GFS' } = {}) {
  RT._resetFrameStoreRuntimeForTest(); mockSF.hooks.clear(); mockSF.loads = []; mockSF.enabled = true; setCachedManifest(WORLD_ONLY);
  mockSF.byKey = { [GFS]: indexFor('GFS', 'gfs'), [EURO]: indexFor('EURO', 'euro'), [EURO_FILLED]: indexFor('EURO', 'eurofilled') };
  mockSF.pinned = new Set(Object.keys(mockSF.byKey)); mockSF.pinAsks = [];
  const calls = []; let bound = null;
  const gl = { TEXTURE_2D: 'T2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UB', TEXTURE_BINDING_2D: 'B2D', UNPACK_FLIP_Y_WEBGL: 'FLIP', UNPACK_PREMULTIPLY_ALPHA_WEBGL: 'PRE',
    getParameter: () => null, bindTexture: (t, x) => { bound = x; }, pixelStorei: () => {}, texSubImage2D: (...a) => calls.push([bound, a[8]]) };
  const wave = { id: 'wave' }; const chl = { id: 'chl' }; const bath = { id: 'bath' };
  const eng = { _residentWaveTex: wave, _residentChlTex: chl, _residentBathTex: bath, _texWidth: GFS_PACK.cols, _texHeight: GFS_PACK.rows,
    _waveData: { u_waveTexture: wave, u_chlorophyllTexture: chl, u_bathymetryTexture: bath, bounds: { ...GFS_PACK.bounds },
      waveGrid: { cols: GFS_PACK.cols, rows: GFS_PACK.rows, bounds: { ...GFS_PACK.bounds }, hourOffset: 0, __sourceModel: model, __componentLayer: 'waves' } } };
  RT.registerFrameStoreTarget({ getEngine: () => eng, getGl: () => gl, getMap: () => ({ triggerRepaint: () => {} }) });
  return { calls, eng };
}
const landAll = async (pick = () => true) => {
  for (let i = 0; i < 10; i++) {
    mockSF.loads.filter((l) => !l.done && pick(l)).forEach((l) => { l.done = true; l.resolve({ parsed: l.key.startsWith('EURO') ? EURO_PARSED : PARSED, buffer: null, wire: 1 }); });
    await flush();
  }
};
const parse = async (key, k, parsed) => { for (const fn of mockSF.hooks) fn({ key, frame: mockSF.byKey[key].frames[k], parsed, buffer: null }); await flush(); };
const euroStep = (k) => RT.tryShowStoredFrame({ model: 'EURO', layer: 'waves', hourOffset: k * 3, requestedValidTime: vt(k) });
const snap = () => window.__RAW_FRAME_STORE__;
afterEach(() => { ['__RAW_DISABLE_PLAIN_SET_CROPS__', '__MARINE_DRAWN__'].forEach((k) => delete window[k]); setCachedManifest(null); });

describe('EURO/ICON mid-zoom clips come from the PLAIN set (a viewport /grid is never Gulf-filled)', () => {
  it('a EURO clip commit is the crop resident of the plain set, and a wheel step shows EURO\'s own window bytes from the store', async () => {
    const { calls, eng } = setup({ model: 'EURO' });
    RT.noteCommitted(CLIP('EURO', 0), { hour: 0, model: 'EURO', layer: 'waves' });
    await landAll((l) => l.key === EURO);
    expect(snap().commits).toEqual({ resident_crop: 1 });
    expect(snap().crop.resident.setKey).toMatch(/^EURO\/waves\/world\//);          // the PLAIN set ('world', not 'world_filled')
    expect(mockSF.loads.every((l) => l.key === EURO)).toBe(true);                    // the filled set was never read for a clip
    await parse(EURO, 1, EURO_PARSED);
    calls.length = 0;
    expect(euroStep(1)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(firstDiff(calls[0][1], EURO_PACK.bytes)).toBe(-1);                       // the encoder's bytes for EURO's window of frame 1
    expect(eng._waveData.waveGrid).toMatchObject({ served_valid_time: vt(1), productId: 'euro1', __fromFrameStore: true });
  });

  it('with a GFS clip resident, a click to EURO shows EURO\'s window from the plain set (the instant mid-zoom toggle)', async () => {
    const { calls, eng } = setup({ model: 'GFS' });
    RT.noteCommitted(CLIP('GFS', 0), { hour: 0, model: 'GFS', layer: 'waves' });
    await landAll((l) => l.key === GFS);
    await parse(EURO, 2, EURO_PARSED);                    // EURO's plain frame lands (the warm plan or the seam) while the GFS clip is resident
    calls.length = 0;
    expect(RT.tryShowStoredFrameForSwitch({ model: 'EURO', layer: 'waves', hourOffset: 6, requestedValidTime: vt(2) })).toBe(true);
    expect(firstDiff(calls.find((c) => c[0] === eng._residentWaveTex)[1], EURO_PACK.bytes)).toBe(-1);
    expect(eng._waveData.waveGrid).toMatchObject({ __sourceModel: 'EURO', productId: 'euro2', __fromFrameStore: true });
    expect(snap().crop.resident.setKey).toMatch(/^EURO\/waves\/world\//);
  });

  it('the plain set is a crop source only: a world-sized EURO commit reads the FILLED set, and the plain one never becomes a world resident', async () => {
    const { eng } = setup({ model: 'EURO' });
    const world = { bounds: { ...IG.bounds }, cols: IG.cols, rows: IG.rows, served_valid_time: vt(0), __sourceModel: 'EURO', __componentLayer: 'waves' };
    eng._waveData.waveGrid = { ...world, hourOffset: 0 }; eng._waveData.bounds = { ...IG.bounds };
    RT.noteCommitted(world, { hour: 0, model: 'EURO', layer: 'waves' });
    await flush();
    expect(Object.keys(snap().commits)).toHaveLength(1);
    expect(snap().commits.resident_crop).toBeUndefined();
    expect([...new Set(mockSF.loads.map((l) => l.key))]).toEqual([EURO_FILLED]);   // a world box: the filled set only
    // A clip commit whose window cannot be cut (a lattice the plain set does not mirror) must not fall through to a world resident.
    const odd = { ...CLIP('EURO', 1), cols: WIN.cols + 3 };
    eng._waveData.waveGrid = { ...odd, hourOffset: 3 };
    RT.noteCommitted(odd, { hour: 3, model: 'EURO', layer: 'waves' });
    expect(snap().commits.crop_only_set).toBe(1);
    expect(snap().resident).toBeNull();
    expect(euroStep(1)).toBe(false);
    expect(snap().shows.misses.crop_only_set).toBe(1);                              // the show refuses it too
  });

  it('nothing else pins the plain set at mid zoom (the seam refuses those boxes): the store pins it, and the next clip commit is resident', async () => {
    setup({ model: 'EURO' });
    mockSF.pinned.delete(EURO);                                                    // the live state: only the seam's own sets are pinned
    RT.noteCommitted(CLIP('EURO', 0), { hour: 0, model: 'EURO', layer: 'waves' });
    expect(snap().commits).toEqual({ no_index: 1 });
    await flush();
    expect(mockSF.pinAsks).toEqual([EURO]);                                        // one index read, for the PLAIN set only
    RT.noteCommitted(CLIP('EURO', 1), { hour: 3, model: 'EURO', layer: 'waves' });
    await landAll((l) => l.key === EURO);
    expect(snap().commits).toEqual({ no_index: 1, resident_crop: 1 });
    RT.noteCommitted({ ...CLIP('EURO', 2) }, { hour: 6, model: 'EURO', layer: 'waves' });   // a third commit asks nothing again
    expect(mockSF.pinAsks).toEqual([EURO]);
  });

  // PARITY GATE: under a 15-deg request (a clip of 30 deg or less) the resolver may serve a covering regional tile instead of the
  // global_mid clip (product_selection keeps globals only above 15 deg), so a plain EURO/ICON window is not taken there.
  it('PARITY GATE: a narrow EURO clip (request <= 15 deg) is never a crop resident, and a narrow GFS window is never switched to EURO', async () => {
    const NARROW = midClipWindow('-82,25,-74,31', IG, 'GFS');                       // an 8-deg request: a 16 x 14 deg clip
    const narrow = (model, k) => ({ bounds: NARROW.bounds, cols: NARROW.cols, rows: NARROW.rows, served_valid_time: vt(k), __sourceModel: model, __componentLayer: 'waves' });
    const { eng } = setup({ model: 'EURO' });
    eng._texWidth = NARROW.cols; eng._texHeight = NARROW.rows;
    eng._waveData.waveGrid = { ...narrow('EURO', 0), hourOffset: 0 };
    RT.noteCommitted(narrow('EURO', 0), { hour: 0, model: 'EURO', layer: 'waves' });
    await landAll((l) => l.key === EURO);
    expect(snap().commits).toEqual({ crop_only_narrow: 1 });
    expect(snap().crop.resident).toMatchObject({ foreign: true, setKey: null });   // remembered as foreign (today's EURO clip), never the plain set's
    // GFS has no such gate (no estimated regional tails): its narrow window is resident, but a click to EURO there is the normal path.
    eng._waveData.waveGrid = { ...narrow('GFS', 0), hourOffset: 0 };
    RT.noteCommitted(narrow('GFS', 0), { hour: 0, model: 'GFS', layer: 'waves' });
    await landAll((l) => l.key === GFS);
    expect(snap().crop.resident.setKey).toMatch(/^GFS\//);
    await parse(EURO, 2, EURO_PARSED);
    expect(RT.tryShowStoredFrameForSwitch({ model: 'EURO', layer: 'waves', hourOffset: 6, requestedValidTime: vt(2) })).toBe(false);
    expect(snap().shows.misses.crop_only_narrow).toBe(1);
  });

  it('PARITY GATE: a regional EURO tile covering 70% of the request refuses even a wide clip; without a manifest, closed', async () => {
    setup({ model: 'EURO' });
    setCachedManifest({ products: [...WORLD_ONLY.products, prod('big_pilot', { west: -110, south: 10, east: -50, north: 45 })] });
    RT.noteCommitted(CLIP('EURO', 0), { hour: 0, model: 'EURO', layer: 'waves' });
    expect(snap().commits).toEqual({ crop_only_narrow: 1 });
    setCachedManifest(null);
    RT.noteCommitted(CLIP('EURO', 1), { hour: 3, model: 'EURO', layer: 'waves' });
    expect(snap().commits).toEqual({ crop_only_narrow: 2 });
  });

  it('KILL: __RAW_DISABLE_PLAIN_SET_CROPS__ is today\'s behaviour (the EURO clip is foreign, a step is the normal path)', async () => {
    setup({ model: 'EURO' });
    window.__RAW_DISABLE_PLAIN_SET_CROPS__ = true;
    RT.noteCommitted(CLIP('EURO', 0), { hour: 0, model: 'EURO', layer: 'waves' });
    await landAll();
    expect(snap().commits.resident_crop).toBeUndefined();
    expect(mockSF.loads.filter((l) => l.key === EURO)).toHaveLength(0);
    expect(euroStep(1)).toBe(false);
  });
});
