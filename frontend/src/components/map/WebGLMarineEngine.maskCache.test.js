/**
 * The coarse base's world mask outlives the set that rasterized it (2026-10-23; marineCoarseMaskCache.js).
 *
 * Live (the lead's trace of dev, 2026-10-23) the capture rasterized its 4096 x 2048 mask again and again: 63-140 ms each, on the main
 * thread. Offline, where every world grid has one bounds box, the LRU's shared mask made the same capture 3-13 ms. Two world grids of
 * one model|layer whose bounds differ (a static/series frame and a /grid or prewarm-seed frame) supersede each other in the LRU slot;
 * the superseded set is freed with its mask, so each alternation rasterized again. Runs the REAL _captureCoarseBase and _freeCoarseBase
 * on a fake `this` with the texture encoder stubbed (the WebGLMarineEngine.baseHold.test.js pattern).
 */
import WebGLMarineEngine, { coarseBaseKey } from './WebGLMarineEngine';
import { encodeMarineTexture } from './WebGLMarineTextureEncoder';
import { coarseMaskKey, findCachedCoarseMask, MAX_MASKS, rememberCoarseMask, releaseCoarseMaskCache } from './marineCoarseMaskCache';

jest.mock('./WebGLMarineTextureEncoder', () => ({
  ...jest.requireActual('./WebGLMarineTextureEncoder'),
  encodeMarineTexture: jest.fn(),
}));

const capture = WebGLMarineEngine.prototype._captureCoarseBase;
const freeAll = WebGLMarineEngine.prototype._freeCoarseBase;
const LAND = { type: 'FeatureCollection', features: [] };
const STATIC_BOX = { west: -180, south: -80, east: 180, north: 84 };   // the static / series frames (live index 2026-10-23)
const REQUEST_BOX = { west: -180, south: -80, east: 180, north: 85 };  // a /grid world request box
const grid = (bounds, hour) => ({ __sourceModel: 'GFS', __componentLayer: 'waves', hourOffset: hour, bounds, cols: 181, rows: 83,
  valid_time: new Date(Date.UTC(2026, 9, 23, hour)).toISOString(), vectors: [{ lat: 0, lng: 0, speed: 1 }] });

let rasters; let deleted;
function makeEngine() {
  const eng = { _coarseBaseLru: new Map(), _coarseBaseData: null, _landGeoJSON: LAND,
    _coarseBaseLruEnabled: WebGLMarineEngine.prototype._coarseBaseLruEnabled };
  eng._freeCoarseBase = freeAll;
  return eng;
}
const GL = { deleteTexture: (t) => { deleted.push(t); } };
const take = (eng, g) => capture.call(eng, GL, g, coarseBaseKey(g));

beforeEach(() => {
  rasters = 0; deleted = [];
  let n = 0;
  encodeMarineTexture.mockReset();
  encodeMarineTexture.mockImplementation((gl, g, land, engine, opts) => {
    n += 1;
    if (opts && opts.reuseMaskTex) return { u_waveTexture: { id: `wave${n}` }, u_oceanMaskTexture: opts.reuseMaskTex, __maskCanvasDims: opts.reuseMaskDims };
    rasters += 1;
    return { u_waveTexture: { id: `wave${n}` }, u_oceanMaskTexture: { id: `mask${rasters}` }, __maskCanvasDims: { w: 4096, h: 2048 } };
  });
  window.__RAW_GPU__ = {};
});
afterEach(() => {
  delete window.__RAW_GPU__;
  delete window.__RAW_DISABLE_COARSE_MASK_CACHE__;
});

const alternate = (eng) => {
  take(eng, grid(STATIC_BOX, 1));
  take(eng, grid(REQUEST_BOX, 2));   // supersedes the static-box set in the GFS|waves|r0 slot
  take(eng, grid(STATIC_BOX, 3));
  take(eng, grid(REQUEST_BOX, 4));
  take(eng, grid(STATIC_BOX, 5));
};

describe('_captureCoarseBase with the mask cache', () => {
  it('two bounds boxes alternating rasterize once each, not on every alternation; the live base keeps a live mask', () => {
    const eng = makeEngine();
    alternate(eng);
    expect(rasters).toBe(2);
    expect(window.__RAW_GPU__.coarseMaskCache).toMatchObject({ rasters: 2, hits: 3, size: 2 });
    const live = eng._coarseBaseData.u_oceanMaskTexture;
    expect(deleted).not.toContain(live);
    expect(deleted.filter((t) => /^mask/.test(t.id))).toEqual([]);   // superseded sets let go of their holds; the cache still holds both
  });

  it('positive control: with the cache killed, every alternation rasterizes again (the live symptom)', () => {
    window.__RAW_DISABLE_COARSE_MASK_CACHE__ = true;
    const eng = makeEngine();
    alternate(eng);
    expect(rasters).toBe(5);
    expect(deleted.filter((t) => /^mask/.test(t.id)).map((t) => t.id)).toEqual(['mask1', 'mask2', 'mask3', 'mask4']);
  });

  it('the LRU share is still first: identical bounds reuse the held set\'s mask and the cache is not consulted', () => {
    const eng = makeEngine();
    take(eng, grid(STATIC_BOX, 1));
    take(eng, grid(STATIC_BOX, 2));
    expect(rasters).toBe(1);
    expect(window.__RAW_GPU__.coarseMaskCache).toMatchObject({ rasters: 1, hits: 0 });
  });

  it('teardown frees each mask exactly once, after the sets (no double delete, no leak)', () => {
    const eng = makeEngine();
    alternate(eng);
    freeAll.call(eng, GL);
    const masks = deleted.filter((t) => /^mask/.test(t.id)).map((t) => t.id).sort();
    expect(masks).toEqual(['mask1', 'mask2']);
    expect(eng._coarseMaskCache.size).toBe(0);
    expect(eng._coarseBaseLru.size).toBe(0);
  });

  it('a new land GeoJSON (the 50 m -> 10 m swap) is a different mask: it rasterizes', () => {
    const eng = makeEngine();
    take(eng, grid(STATIC_BOX, 1));
    take(eng, grid(REQUEST_BOX, 2));
    eng._landGeoJSON = { type: 'FeatureCollection', features: [{}] };
    take(eng, grid(STATIC_BOX, 3));
    expect(rasters).toBe(3);
  });

  it('the grid-mask fallback (no GeoJSON raster, no canvas dims) is never cached: it is built from the grid\'s own data', () => {
    encodeMarineTexture.mockImplementation(() => { rasters += 1; return { u_waveTexture: { id: 'w' }, u_oceanMaskTexture: { id: `grid${rasters}` }, __maskCanvasDims: null }; });
    const eng = makeEngine();
    take(eng, grid(STATIC_BOX, 1));
    take(eng, grid(REQUEST_BOX, 2));
    take(eng, grid(STATIC_BOX, 3));
    expect(rasters).toBe(3);
    expect(eng._coarseMaskCache).toBeUndefined();
  });
});

describe('marineCoarseMaskCache', () => {
  const del = (gl, t) => { deleted.push(t); };
  it('keeps at most MAX_MASKS; the oldest lets go of its hold (deleted only when nothing else holds it)', () => {
    const eng = {}; const a = { id: 'a' }; const b = { id: 'b' }; const c = { id: 'c' };
    rememberCoarseMask(GL, eng, 'A', a, { w: 1, h: 1 }, del);
    rememberCoarseMask(GL, eng, 'B', b, { w: 1, h: 1 }, del);
    expect(MAX_MASKS).toBe(2);
    rememberCoarseMask(GL, eng, 'C', c, { w: 1, h: 1 }, del);         // a's set still holds it (refs 2 -> 1): not deleted
    expect(deleted).toEqual([]);
    expect(a.__rsRefs).toBe(1);
    expect(findCachedCoarseMask(eng, 'A')).toBeNull();
    expect(findCachedCoarseMask(eng, 'B').tex).toBe(b);              // a hit refreshes B: C is now the oldest
    rememberCoarseMask(GL, eng, 'D', { id: 'd' }, { w: 1, h: 1 }, del);
    expect(findCachedCoarseMask(eng, 'C')).toBeNull();
    releaseCoarseMaskCache(GL, eng, del);
    expect(eng._coarseMaskCache.size).toBe(0);
  });

  it('the key names the bounds and the GeoJSON object', () => {
    const l1 = {}; const l2 = {};
    expect(coarseMaskKey(STATIC_BOX, l1)).toBe(coarseMaskKey({ ...STATIC_BOX }, l1));
    expect(coarseMaskKey(STATIC_BOX, l1)).not.toBe(coarseMaskKey(STATIC_BOX, l2));
    expect(coarseMaskKey(STATIC_BOX, l1)).not.toBe(coarseMaskKey(REQUEST_BOX, l1));
    expect(coarseMaskKey(null, l1)).toBeNull();
  });
});
