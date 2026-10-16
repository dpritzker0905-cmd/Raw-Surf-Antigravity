import { encodeMarineTexture } from './WebGLMarineTextureEncoder';
import { maskCoversWorldFrame } from './maskCoverReuse';

// The mask is rasterised (jsdom has no canvas) and its upload is what costs: 4096 x 2048 RGBA for a world frame.
jest.mock('./WebGLMarineMaskRenderer', () => ({
  ...jest.requireActual('./WebGLMarineMaskRenderer'),
  renderMaskToCanvas: (_geo, b) => {
    const span = (b.east < b.west ? b.east + 360 : b.east) - b.west;
    return { width: span >= 340 ? 4096 : 2048, height: span >= 340 ? 2048 : 1024 };
  },
}));
jest.mock('./maskCoastSDF', () => ({ writeCoastDistanceField: () => false }));

/**
 * ★ WHY THIS EXISTS (2026-10-16, measured on the real renderer with the offline harness, frontend/scripts/offline-backend).
 * With the server's SERIES_THIN_NODE_BOUNDS on, a thinned world frame carries the bounds of the cells it kept (north 80) while the
 * exact frame keeps north 84. The encoder's mask cache compared bounds strictly, so every thinned <-> exact swap rebuilt the
 * 4096 x 2048 world mask: 23 mask-sized texture uploads against 3 over a six-jump scrub, 4 to 8 extra per forward jump.
 * The engine samples the mask by its OWN cached bounds (u_maskBounds), so a cached world mask whose bounds COVER the incoming
 * world frame is geometrically right for it: reuse it. World frames only; every regional path is untouched.
 */
const WORLD_84 = { west: -180, south: -80, east: 180, north: 84 };
const WORLD_80 = { west: -180, south: -80, east: 180, north: 80 };
const DIMS = { w: 4096, h: 2048 };

describe('maskCoversWorldFrame (the rule)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_MASK_COVER_REUSE__; });

  test('a cached world mask covers a thinned world frame with a smaller north edge', () => {
    expect(maskCoversWorldFrame(WORLD_84, DIMS, WORLD_80)).toBe(true);
  });
  test('identical bounds are covered too', () => {
    expect(maskCoversWorldFrame(WORLD_84, DIMS, WORLD_84)).toBe(true);
  });
  test('a cached mask that is SMALLER than the incoming frame does not cover it (it rebuilds once)', () => {
    expect(maskCoversWorldFrame(WORLD_80, DIMS, WORLD_84)).toBe(false);
  });
  test.each([
    ['south', { ...WORLD_84, south: -70 }],
    ['west', { ...WORLD_84, west: -170 }],
    ['east', { ...WORLD_84, east: 170 }],
  ])('a cached mask short on the %s edge does not cover', (_edge, cached) => {
    expect(maskCoversWorldFrame(cached, DIMS, WORLD_84)).toBe(false);
  });
  test('REGIONAL frames are never reused by this rule, whatever the cache holds', () => {
    const regional = { west: -82, south: 26, east: -78, north: 30 };
    expect(maskCoversWorldFrame(WORLD_84, DIMS, regional)).toBe(false);
    expect(maskCoversWorldFrame(regional, { w: 2048, h: 1024 }, regional)).toBe(false);
  });
  test('a cached mask coarser than a rebuild would be does not cover', () => {
    expect(maskCoversWorldFrame(WORLD_84, { w: 1024, h: 512 }, WORLD_80)).toBe(false);
  });
  test('an antimeridian-crossing window is left to the rebuild', () => {
    expect(maskCoversWorldFrame({ west: 170, south: -80, east: -170, north: 84 }, DIMS, WORLD_80)).toBe(false);
  });
  test.each([[null, DIMS, WORLD_80], [WORLD_84, null, WORLD_80], [WORLD_84, DIMS, null]])('missing input (%#) never covers', (a, b, c) => {
    expect(maskCoversWorldFrame(a, b, c)).toBe(false);
  });
  test('the kill switch window.__RAW_DISABLE_MASK_COVER_REUSE__ restores the strict compare', () => {
    window.__RAW_DISABLE_MASK_COVER_REUSE__ = true;
    expect(maskCoversWorldFrame(WORLD_84, DIMS, WORLD_80)).toBe(false);
  });
});

function makeGL() {
  let bound = null; let flipY = false; const maskUploads = [];
  const gl = {
    TEXTURE_2D: 'T2', RGBA: 'RGBA', UNSIGNED_BYTE: 'UB', LINEAR: 'LIN', CLAMP_TO_EDGE: 'CE',
    TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG',
    TEXTURE_BINDING_2D: 'TB', UNPACK_FLIP_Y_WEBGL: 'FY',
    getParameter: (p) => (p === 'TB' ? bound : flipY),
    createTexture: () => ({}), deleteTexture: () => {}, bindTexture: (_t, tex) => { bound = tex; },
    texParameteri: () => {}, pixelStorei: (p, v) => { if (p === 'FY') flipY = v; },
    // 6-argument form = an uploaded canvas (the mask); the 9-argument form = a data texture.
    texImage2D: (...a) => { if (a.length === 6 && a[5] && a[5].width >= 512) maskUploads.push(a[5].width); },
    texSubImage2D: () => {},
  };
  return { gl, maskUploads };
}

function grid(bounds) {
  const cols = 4; const rows = 3;
  return {
    cols, rows,
    vectors: Array.from({ length: cols * rows }, () => ({ direction: 270, speed: 2, height: 2, period: 10, is_valid: true })),
    __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 0, __renderable: true, coverage_scope: 'global',
    productId: 'p', bounds,
  };
}
const LAND = { type: 'FeatureCollection', features: [] };

describe('encodeMarineTexture: the world mask cache across thinned <-> exact swaps', () => {
  beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { jest.restoreAllMocks(); delete window.__RAW_DISABLE_MASK_COVER_REUSE__; });

  test('exact (north 84) -> thinned (north 80) -> exact: ONE mask build, the cache keeps the larger geography', () => {
    const h = makeGL(); const engine = {};
    encodeMarineTexture(h.gl, grid(WORLD_84), LAND, engine, undefined);
    expect(engine._lastMaskEncodeMode).toBe('rebuild');
    encodeMarineTexture(h.gl, grid(WORLD_80), LAND, engine, undefined);
    expect(engine._lastMaskEncodeMode).toBe('reuse');
    encodeMarineTexture(h.gl, grid(WORLD_84), LAND, engine, undefined);
    expect(engine._lastMaskEncodeMode).toBe('reuse');
    expect(h.maskUploads).toEqual([4096]);
    expect(engine._cachedMaskBounds).toEqual(WORLD_84);            // the texture's geography is unchanged
  });

  test('thinned first (north 80) then exact (north 84): one rebuild to the larger extent, then reuse in both directions', () => {
    const h = makeGL(); const engine = {};
    encodeMarineTexture(h.gl, grid(WORLD_80), LAND, engine, undefined);
    encodeMarineTexture(h.gl, grid(WORLD_84), LAND, engine, undefined);
    expect(engine._lastMaskEncodeMode).toBe('rebuild');
    encodeMarineTexture(h.gl, grid(WORLD_80), LAND, engine, undefined);
    expect(engine._lastMaskEncodeMode).toBe('reuse');
    expect(h.maskUploads).toEqual([4096, 4096]);
    expect(engine._cachedMaskBounds).toEqual(WORLD_84);
  });

  test('a REGIONAL frame after a world mask still rebuilds (its own, denser mask)', () => {
    const h = makeGL(); const engine = {};
    encodeMarineTexture(h.gl, grid(WORLD_84), LAND, engine, undefined);
    encodeMarineTexture(h.gl, { ...grid({ west: -82, south: 26, east: -78, north: 30 }), coverage_scope: 'regional' }, LAND, engine, undefined);
    expect(engine._lastMaskEncodeMode).toBe('rebuild');
    expect(h.maskUploads).toEqual([4096, 2048]);
  });

  test('with the kill switch the strict compare returns: every bounds change rebuilds', () => {
    window.__RAW_DISABLE_MASK_COVER_REUSE__ = true;
    const h = makeGL(); const engine = {};
    encodeMarineTexture(h.gl, grid(WORLD_84), LAND, engine, undefined);
    encodeMarineTexture(h.gl, grid(WORLD_80), LAND, engine, undefined);
    expect(engine._lastMaskEncodeMode).toBe('rebuild');
    expect(h.maskUploads).toEqual([4096, 4096]);
  });
});
