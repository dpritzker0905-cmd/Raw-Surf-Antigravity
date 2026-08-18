import { resolveLandAwareFetch, setLandAwareFetchUniforms } from './marineLandAwareFetch';
import { HEATMAP_FS } from './WebGLMarineShaders';

/**
 * The land-aware wave fetch — the island halo fix (2026-08-18).
 *
 * WHAT IT IS FOR. The wave grid is ~22.5 km per cell, so a small island IS a cell or three. Those
 * land cells are filled by extrapolateOceanData with the MEAN of their ocean neighbours, which at
 * Madeira mixes the sheltered lee (1.12 m) with the exposed north (1.60 m). gl.LINEAR then spreads
 * that ~1.1 outward and the windward shore ramps down over a full cell — the halo. Rendered height
 * is H = sum(w_i h_i), the defect is dH/dh_land > 0, and the fix zeroes those weights.
 */
const fakeGl = () => {
  const calls = { u2: {}, u1: {}, order: [] };
  return {
    calls,
    getUniformLocation: (p, n) => ({ p, n }),
    uniform2f: (loc, a, b) => { calls.u2[loc.n] = [a, b]; calls.order.push(loc.n); },
    uniform1f: (loc, a) => { calls.u1[loc.n] = a; calls.order.push(loc.n); },
  };
};

const ON = { __RAW_ENABLE_LAND_AWARE_FETCH__: true };

describe('resolveLandAwareFetch', () => {
  it('is OFF BY DEFAULT — the enabled leg measured WORSE than the control (see the module note)', () => {
    expect(resolveLandAwareFetch({ cols: 8, rows: 7 }, {}).on).toBe(false);
    expect(resolveLandAwareFetch({ cols: 8, rows: 7 }).on).toBe(false);
  });

  it('is on for a real grid and reports its dimensions', () => {
    expect(resolveLandAwareFetch({ cols: 8, rows: 7 }, ON)).toEqual({ on: true, cols: 8, rows: 7 });
  });

  it('is off under the kill switch', () => {
    expect(resolveLandAwareFetch({ cols: 8, rows: 7 }, { ...ON, __RAW_DISABLE_LAND_AWARE_FETCH__: true }))
      .toEqual({ on: false, cols: null, rows: null });
  });

  it('fails safe on grids with no interior 2x2 footprint, and on junk', () => {
    for (const g of [null, undefined, {}, { cols: 1, rows: 7 }, { cols: 8, rows: 1 },
      { cols: 0, rows: 0 }, { cols: NaN, rows: 7 }, { cols: '8', rows: '7' }]) {
      expect(resolveLandAwareFetch(g, ON).on).toBe(false);
    }
  });
});

describe('setLandAwareFetchUniforms', () => {
  it('writes the reciprocal texel size and the enable flag', () => {
    const gl = fakeGl();
    setLandAwareFetchUniforms(gl, {}, { cols: 8, rows: 7 }, ON);
    expect(gl.calls.u2.u_waveTexel[0]).toBeCloseTo(1 / 8, 10);
    expect(gl.calls.u2.u_waveTexel[1]).toBeCloseTo(1 / 7, 10);
    expect(gl.calls.u1.u_landAwareFetch).toBe(1);
  });

  describe('THE INVARIANT THAT WOULD BREAK SILENTLY', () => {
    // The coarse wash and the main heatmap share ONE program and GL uniforms persist between draws.
    // A call that sets neither, or only one, leaves the PREVIOUS pass's stride in place — the coarse
    // texture would then be sampled at the main grid's texel size, reading neighbours at the wrong
    // stride. Nothing throws; the coastline just smears. So: ALWAYS both, on every path.
    it('sets BOTH uniforms even when disabled', () => {
      const gl = fakeGl();
      setLandAwareFetchUniforms(gl, {}, { cols: 8, rows: 7 }, { ...ON, __RAW_DISABLE_LAND_AWARE_FETCH__: true });
      expect(gl.calls.u2.u_waveTexel).toEqual([0, 0]);
      expect(gl.calls.u1.u_landAwareFetch).toBe(0);
    });

    it('sets BOTH uniforms even when the grid is missing', () => {
      const gl = fakeGl();
      setLandAwareFetchUniforms(gl, {}, null, ON);
      expect(gl.calls.u2.u_waveTexel).toEqual([0, 0]);
      expect(gl.calls.u1.u_landAwareFetch).toBe(0);
      expect(gl.calls.order).toEqual(['u_waveTexel', 'u_landAwareFetch']);
    });
  });

  it('does not throw without a gl or program (render must survive a missing context)', () => {
    expect(() => setLandAwareFetchUniforms(null, null, { cols: 4, rows: 4 }, ON)).not.toThrow();
    expect(setLandAwareFetchUniforms(null, null, { cols: 4, rows: 4 }, ON).on).toBe(true);
  });
});

describe('the weighting math, on the measured Madeira numbers', () => {
  // A JS mirror of sampleWaveLandAware's weight algebra. This does not execute GLSL — it pins the
  // INTENT, so a future edit that changes the semantics fails here rather than in a screenshot.
  const blend = (h, ocean, fx, fy, landAware) => {
    let w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    if (landAware) w = w.map((x, i) => x * (ocean[i] ? 1 : 0));
    const s = w.reduce((a, b) => a + b, 0);
    if (s < 0.0001) return null;
    return w.reduce((acc, x, i) => acc + x * h[i], 0) / s;
  };

  // 2x2 footprint on Madeira's windward side: one land cell carrying the lee-contaminated 1.1,
  // three open-ocean cells at 1.6.
  const H = [1.1, 1.6, 1.6, 1.6];
  const OCEAN = [0, 1, 1, 1];

  it('plain bilinear drags the windward value down — the halo', () => {
    expect(blend(H, OCEAN, 0.5, 0.5, false)).toBeCloseTo(1.475, 3);
    expect(blend(H, OCEAN, 0.1, 0.1, false)).toBeCloseTo(1.1 * 0.81 + 1.6 * 0.19, 3); // ≈1.195
  });

  it('land-aware returns the pure water value regardless of position in the cell', () => {
    for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.2], [0.25, 0.75]]) {
      expect(blend(H, OCEAN, fx, fy, true)).toBeCloseTo(1.6, 10);
    }
  });

  it('recovers the full 1.1 -> 1.6 error close to the coast (~31% low before, exact after)', () => {
    const before = blend(H, OCEAN, 0.1, 0.1, false);
    const after = blend(H, OCEAN, 0.1, 0.1, true);
    expect(1 - before / after).toBeGreaterThan(0.24);   // measured ~25% at this position
    expect(after).toBeCloseTo(1.6, 10);
  });

  it('falls back rather than inventing a value when all four texels are land', () => {
    expect(blend(H, [0, 0, 0, 0], 0.5, 0.5, true)).toBeNull();
  });

  it('is a no-op where no land is involved — open ocean must be byte-identical', () => {
    const allSea = [1.5, 1.6, 1.7, 1.8];
    for (const [fx, fy] of [[0.3, 0.4], [0.0, 0.0], [0.9, 0.9]]) {
      expect(blend(allSea, [1, 1, 1, 1], fx, fy, true)).toBeCloseTo(blend(allSea, [1, 1, 1, 1], fx, fy, false), 10);
    }
  });
});

describe('HEATMAP_FS wiring', () => {
  it('routes the wave read through the land-aware fetch, and only there', () => {
    expect(HEATMAP_FS).toContain('vec4 waveData = sampleWaveLandAware(grid_uv);');
    // the only remaining direct reads are the four footprint fetches inside the helper itself
    expect((HEATMAP_FS.match(/texture2D\(u_waveTexture/g) || []).length).toBe(5);
  });

  it('reads the ocean flag from chlorophyll ALPHA at texel centres, not the interpolated fetch', () => {
    expect(HEATMAP_FS).toContain('texture2D(u_chlorophyllTexture, c0).a');
    expect(HEATMAP_FS).toContain('step(0.5,');
    // centres are (floor(tc) + 0.5) * texel — an offset of 0.5 texel is what makes the flag exact
    expect(HEATMAP_FS).toContain('(floor(tc) + 0.5) * u_waveTexel');
  });

  it('declares both uniforms and honours the disable path inside the shader', () => {
    expect(HEATMAP_FS).toContain('uniform vec2 u_waveTexel;');
    expect(HEATMAP_FS).toContain('uniform float u_landAwareFetch;');
    expect(HEATMAP_FS).toContain('if (u_landAwareFetch < 0.5');
    expect(HEATMAP_FS).toContain('return plain;');
  });

  it('guards against a zero stride, which would collapse every fetch onto one texel', () => {
    expect(HEATMAP_FS).toContain('u_waveTexel.x <= 0.0 || u_waveTexel.y <= 0.0');
  });
});

describe('the flag must be the TRUE land mask, not the post-extrapolation one', () => {
  const { getMarineGeoData } = require('./WebGLMarineGeoData');
  const COLS = 4, ROWS = 4, N = COLS * ROWS;
  // cell 5 is land in truth, but extrapolateOceanData filled it and flipped its flag to ocean
  const postExtrap = new Uint8Array(N).fill(1);
  const truth = new Uint8Array(N).fill(1); truth[5] = 0;

  it('marks the filled cell as LAND in chlorophyll alpha when the true mask is supplied', () => {
    const { dataChl } = getMarineGeoData(COLS, ROWS, { west: -18, east: -16, south: 32, north: 34 },
      postExtrap, N, false, null, truth);
    expect(dataChl[5 * 4 + 3]).toBe(0);        // the whole point: excluded from the blend
    expect(dataChl[6 * 4 + 3]).toBe(255);      // a genuine ocean neighbour is untouched
  });

  it('REGRESSION — without the true mask the flag says ocean, and the fix is silently inert', () => {
    const { dataChl } = getMarineGeoData(COLS, ROWS, { west: -18, east: -16, south: 32, north: 34 },
      postExtrap, N, false, null, undefined);
    // This is what shipped in bcd8eb3e: every cell reads ocean, so no weight is ever zeroed.
    expect(dataChl[5 * 4 + 3]).toBe(255);
  });

  it('leaves dataMask on the post-extrapolation array — that contract is unchanged', () => {
    const { dataMask } = getMarineGeoData(COLS, ROWS, { west: -18, east: -16, south: 32, north: 34 },
      postExtrap, N, false, null, truth);
    expect(dataMask[5 * 4 + 0]).toBe(255);
  });
});
