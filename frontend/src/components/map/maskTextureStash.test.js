import { encodeMarineTexture } from './WebGLMarineTextureEncoder';
import { stashServes, carryWouldAddTruth, stashResidentMask, takeMaskStash, freeMaskStash, isStashedMaskTex, releaseSwappedMask, maskStashEnabled } from './maskTextureStash';
import { safeDeleteTexture } from './WebGLWindUtils';

// jsdom has no canvas: the mask "canvas" is its dims, and the upload of it is what costs (4096 x 2048 RGBA = 32 MB).
jest.mock('./WebGLMarineMaskRenderer', () => ({
  ...jest.requireActual('./WebGLMarineMaskRenderer'),
  renderMaskToCanvas: (_geo, b) => {
    const w = jest.requireActual('./WebGLMarineMaskRenderer').maskCanvasWidthForSpan((b.east < b.west ? b.east + 360 : b.east) - b.west);
    return { width: w, height: w / 2 };
  },
}));
jest.mock('./maskCoastSDF', () => ({ writeCoastDistanceField: () => false }));

/**
 * ★ WHY THIS EXISTS (2026-10-19, measured in the offline harness: scn_mask_cost.js over serve_synthetic.py --regions
 * florida_east_coast,us_southeast_midatlantic --dynamic 1). Zoomed in, layer / model switches alternate the committed grid
 * between the world series frame and the viewport's own grid, and each alternation rebuilt the 4096 x 2048 land mask (9 in a
 * dozen zoomed-in switches, 57-242 ms of setWaveData each on desktop). The same two bounds kept coming back, so the outgoing
 * mask is kept in a one-slot stash and swapped back in. These tests pin WHEN that is allowed.
 */
const WORLD = { west: -180, south: -80, east: 180, north: 84 };
const WORLD_80 = { west: -180, south: -80, east: 180, north: 80 };
const FL = { west: -81, south: 24, east: -73, north: 30 };            // a measured viewport grid (8 deg -> 4096 tier)
const FL2 = { west: -82, south: 25, east: -78, north: 28 };
const LAND = { type: 'FeatureCollection', features: [] };

function makeGL() {
  let bound = null; let flipY = false; const maskUploads = []; const deleted = [];
  const gl = {
    TEXTURE_2D: 'T2', RGBA: 'RGBA', UNSIGNED_BYTE: 'UB', LINEAR: 'LIN', CLAMP_TO_EDGE: 'CE',
    TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG',
    TEXTURE_BINDING_2D: 'TB', UNPACK_FLIP_Y_WEBGL: 'FY',
    getParameter: (p) => (p === 'TB' ? bound : flipY),
    createTexture: () => ({ id: Math.random() }), deleteTexture: (t) => { deleted.push(t); }, bindTexture: (_t, tex) => { bound = tex; },
    texParameteri: () => {}, pixelStorei: (p, v) => { if (p === 'FY') flipY = v; },
    texImage2D: (...a) => { if (a.length === 6 && a[5] && a[5].width >= 512) maskUploads.push(a[5].width); },
    texSubImage2D: () => {},
  };
  return { gl, maskUploads, deleted };
}
function grid(bounds) {
  const cols = 4; const rows = 3;
  return {
    cols, rows,
    vectors: Array.from({ length: cols * rows }, () => ({ direction: 270, speed: 2, height: 2, period: 10, is_valid: true })),
    __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 0, __renderable: true,
    coverage_scope: (bounds.east - bounds.west) >= 340 ? 'global' : 'regional', productId: 'p', bounds,
  };
}
const encode = (h, engine, b, geo = LAND) => encodeMarineTexture(h.gl, grid(b), geo, engine, undefined);
const MASK = 4096 * 2048 * 4;
// The estimate also counts the tiny 4 x 3 data textures each encode makes; masks are 32 MB each, so count whole masks.
const masksHeld = () => Math.floor(window.__RAW_GPU__.gpuMemoryEstimate / MASK);

describe('the encoder with the mask stash', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {});
    window.__RAW_GPU__ = { textureCount: 0, gpuMemoryEstimate: 0 };
  });
  afterEach(() => {
    jest.restoreAllMocks();
    ['__RAW_DISABLE_MASK_STASH__', '__RAW_DISABLE_MASK_PATCH_CARRY__', '__RAW_GPU__', '__RAW_MASK_STASH_SWAP__'].forEach((k) => delete window[k]);
  });

  test('world -> viewport -> world -> viewport: TWO mask builds, then swaps (the measured alternation)', () => {
    const h = makeGL(); const engine = {};
    encode(h, engine, WORLD); encode(h, engine, FL);
    expect(h.maskUploads).toEqual([4096, 4096]);
    encode(h, engine, WORLD);
    expect(engine._lastMaskEncodeMode).toBe('stash_swap');
    expect(engine._cachedMaskBounds).toEqual(WORLD);
    encode(h, engine, FL);
    expect(engine._lastMaskEncodeMode).toBe('stash_swap');
    expect(engine._cachedMaskBounds).toEqual(FL);
    expect(h.maskUploads).toEqual([4096, 4096]);                       // no third or fourth upload
    expect(h.deleted).toEqual([]);                                     // nothing freed: both live in the cache
    expect(window.__RAW_MASK_STASH_SWAP__).toBe(2);
  });

  test('GPU accounting holds both entries and drops on eviction', () => {
    const h = makeGL(); const engine = {};
    encode(h, engine, WORLD); encode(h, engine, FL);
    expect(masksHeld()).toBe(2);
    encode(h, engine, FL2);                                            // a third geography: the outgoing box is freed
    expect(h.deleted).toHaveLength(1);
    expect(masksHeld()).toBe(2);
    expect(engine._maskStash.bounds).toEqual(WORLD);                   // the world mask stays pinned (next test)
    freeMaskStash(h.gl, engine);
    expect(masksHeld()).toBe(1);
    expect(engine._maskStash).toBeNull();
  });

  test('WORLD PIN: viewport boxes arriving between world frames never evict the stashed world mask (the z9 sequence)', () => {
    const h = makeGL(); const engine = {};
    const C = { west: -82, south: 24, east: -79, north: 29 };
    [WORLD, FL, FL2, C, WORLD].forEach((b) => encode(h, engine, b));
    expect(engine._lastMaskEncodeMode).toBe('stash_swap');
    expect(h.maskUploads).toEqual([4096, 4096, 4096, 4096]);           // one world build, three boxes, no second world
    expect(engine._maskStash.bounds).toEqual(C);                       // the outgoing box takes the slot on the world swap
    encode(h, engine, C);
    expect(engine._lastMaskEncodeMode).toBe('stash_swap');
  });

  test('the pin holds only for the CURRENT world geojson: after a land-geojson swap the box may displace it', () => {
    const h = makeGL(); const engine = {};
    encode(h, engine, WORLD); encode(h, engine, FL);
    const LAND2 = { type: 'FeatureCollection', features: [] };
    encode(h, engine, FL2, LAND2);                                     // the world stash is of the old geojson: not pinned
    expect(engine._maskStash.bounds).toEqual(FL);
  });

  test('a stashed WORLD mask also serves a thinned world frame it covers (the #347 rule)', () => {
    const h = makeGL(); const engine = {};
    encode(h, engine, WORLD); encode(h, engine, FL); encode(h, engine, WORLD_80);
    expect(engine._lastMaskEncodeMode).toBe('stash_swap');
    expect(engine._cachedMaskBounds).toEqual(WORLD);                   // the texture keeps its own geography
    expect(h.maskUploads).toEqual([4096, 4096]);
  });

  test('a different land geojson object never swaps (the 50m -> 10m upgrade rebuilds)', () => {
    const h = makeGL(); const engine = {};
    encode(h, engine, WORLD); encode(h, engine, FL);
    encode(h, engine, WORLD, { type: 'FeatureCollection', features: [] });
    expect(engine._lastMaskEncodeMode).toBe('rebuild');
    expect(h.maskUploads).toEqual([4096, 4096, 4096]);
  });

  test('kill switch: every alternation rebuilds and the outgoing mask is freed, as before', () => {
    window.__RAW_DISABLE_MASK_STASH__ = true;
    const h = makeGL(); const engine = {};
    encode(h, engine, WORLD); encode(h, engine, FL); encode(h, engine, WORLD); encode(h, engine, FL);
    expect(h.maskUploads).toEqual([4096, 4096, 4096, 4096]);
    expect(h.deleted).toHaveLength(3);
    expect(engine._maskStash == null).toBe(true);
    expect(masksHeld()).toBe(1);
  });

  test('the retain guards still decide FIRST: a src-not-ready retain keeps the resident and leaves the stash alone', () => {
    const h = makeGL(); const engine = {};
    encode(h, engine, FL); encode(h, engine, FL2);                     // resident FL2, stash FL
    const stash = engine._maskStash;
    engine._maskSourceReady = false; engine._maskRetainPatchedOk = true;
    encode(h, engine, { west: -81.5, south: 25.5, east: -78.5, north: 27.5 });
    expect(engine._lastMaskEncodeMode).toBe('retain_patched_src_not_ready');
    expect(engine._maskStash).toBe(stash);
    expect(engine._cachedMaskBounds).toEqual(FL2);
  });

  test('a resident carrying a DEGRADED basemap-water paint is freed, never stashed', () => {
    const h = makeGL(); const engine = {};
    encode(h, engine, FL);
    engine._regionalPatchState = { gridKey: `${FL.west}_${FL.south}_${FL.east}_${FL.north}`, degraded: true };
    encode(h, engine, WORLD);
    expect(engine._maskStash == null).toBe(true);
    expect(h.deleted).toHaveLength(1);
  });

  test('the old frame that bound the stashed mask cannot free it through the engine cleanup path', () => {
    const h = makeGL(); const engine = {};
    encode(h, engine, WORLD); encode(h, engine, FL);
    const tex = engine._maskStash.tex;
    expect(isStashedMaskTex(engine, tex)).toBe(true);
    safeDeleteTexture(h.gl, tex, engine);
    expect(h.deleted).toEqual([]);
    safeDeleteTexture(h.gl, tex, null);                               // teardown (engine arg null) still frees
    expect(h.deleted).toEqual([tex]);
  });
});

describe('review fixes (2026-10-19)', () => {
  afterEach(() => { delete window.__RAW_GPU__; delete window.__RAW_MASK_STASH_HANDHELD__; jest.restoreAllMocks(); });

  test('F8: a rollback after a swap frees the swapped-in mask with its accounting (no 32 MB strand)', () => {
    window.__RAW_GPU__ = { textureCount: 1, gpuMemoryEstimate: 4096 * 2048 * 4 };
    const gl = { deleteTexture: jest.fn() }; const S = {};
    const engine = { _lastMaskEncodeMode: 'stash_swap', _cachedMaskTex: S, _cachedMaskTexDims: { w: 4096, h: 2048 }, _waveData: { u_oceanMaskTexture: {} } };
    releaseSwappedMask(gl, engine);
    expect(gl.deleteTexture).toHaveBeenCalledWith(S);
    expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(0);
    expect(engine._cachedMaskTex).toBeNull();
  });
  test('F8: a texture the live frame still binds (a swap from an earlier call) is left alone', () => {
    const gl = { deleteTexture: jest.fn() }; const S = {};
    const engine = { _lastMaskEncodeMode: 'stash_swap', _cachedMaskTex: S, _cachedMaskTexDims: { w: 4096, h: 2048 }, _waveData: { u_oceanMaskTexture: S } };
    releaseSwappedMask(gl, engine);
    expect(gl.deleteTexture).not.toHaveBeenCalled();
  });
  test('F8: any other mode is a no-op', () => {
    const gl = { deleteTexture: jest.fn() };
    releaseSwappedMask(gl, { _lastMaskEncodeMode: 'rebuild', _cachedMaskTex: {}, _cachedMaskTexDims: { w: 1, h: 1 } });
    expect(gl.deleteTexture).not.toHaveBeenCalled();
  });
  test('handheld gate: off on a phone unless opted in; on for a desktop', () => {
    expect(maskStashEnabled()).toBe(true);                               // jsdom's UA is not handheld
    jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile');
    expect(maskStashEnabled()).toBe(false);
    window.__RAW_MASK_STASH_HANDHELD__ = true;
    expect(maskStashEnabled()).toBe(true);
  });
});

describe('stashServes / carryWouldAddTruth (the rule)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_MASK_PATCH_CARRY__; delete window.__RAW_DISABLE_MASK_STASH__; });
  const entry = (bounds, w = 4096) => ({ tex: {}, dims: { w, h: w / 2 }, bounds, geojson: LAND });
  const patched = (bounds, box) => ({ canvas: { width: 4096, height: 2048 }, bounds, box });

  test('identical bounds, same geojson, the tier a rebuild would draw: serves', () => {
    expect(stashServes(entry(FL), LAND, FL, null)).toBe(true);
  });
  test('different bounds (not a covered world frame) do not serve', () => {
    expect(stashServes(entry(FL), LAND, FL2, null)).toBe(false);
  });
  test('a stash at another width tier than a rebuild would draw does not serve', () => {
    expect(stashServes(entry(FL, 2048), LAND, FL, null)).toBe(false);
  });
  test('a regional stash never serves a world frame, nor a world stash a regional one', () => {
    expect(stashServes(entry(FL), LAND, WORLD, null)).toBe(false);
    expect(stashServes(entry(WORLD), LAND, FL, null)).toBe(false);
  });
  test('patch truth painted on OTHER bounds that overlaps this rebuild: decline (the rebuild carries it)', () => {
    const last = patched(FL2, { west: -80.5, south: 25.5, east: -79.5, north: 26.5 });
    expect(carryWouldAddTruth(last, FL, FL)).toBe(true);
    expect(stashServes(entry(FL), LAND, FL, last)).toBe(false);
  });
  test('patch truth painted on THIS geography: the stash holds it, serve', () => {
    const last = patched(FL, { west: -80.5, south: 25.5, east: -79.5, north: 26.5 });
    expect(stashServes(entry(FL), LAND, FL, last)).toBe(true);
  });
  test('patch truth that does not overlap, or a carry that would not run, does not block', () => {
    expect(stashServes(entry(FL), LAND, FL, patched(FL2, { west: 10, south: 10, east: 11, north: 11 }))).toBe(true);
    window.__RAW_DISABLE_MASK_PATCH_CARRY__ = true;
    expect(stashServes(entry(FL), LAND, FL, patched(FL2, { west: -80.5, south: 25.5, east: -79.5, north: 26.5 }))).toBe(true);
  });
  test('world rebuilds never take a carry, so a world stash is never blocked by one', () => {
    expect(carryWouldAddTruth(patched(FL, { west: -80.5, south: 25.5, east: -79.5, north: 26.5 }), WORLD, WORLD)).toBe(false);
  });
  test('missing pieces never serve; the kill switch empties takeMaskStash and stashResidentMask', () => {
    expect(stashServes(null, LAND, FL, null)).toBe(false);
    expect(stashServes(entry(FL), LAND, null, null)).toBe(false);
    window.__RAW_DISABLE_MASK_STASH__ = true;
    const engine = { _maskStash: entry(FL) };
    expect(takeMaskStash(engine, LAND, FL)).toBeNull();
    const gl = { deleteTexture: jest.fn() };
    Object.assign(engine, { _cachedMaskTex: {}, _cachedMaskTexDims: { w: 4096, h: 2048 }, _cachedMaskBounds: FL2 });
    expect(stashResidentMask(gl, engine)).toBe(false);
    expect(engine._maskStash).toBeNull();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);               // the old stash is released, not held forever
  });
});
