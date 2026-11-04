import {
  crestTexelRank, crestRankShare, crestRankFade, crestTexelRankOn, CREST_RANK_EDGE, CREST_RANK_KNOTS, CREST_TEXEL_RANK_GLSL, CREST_RANK_SPLICE,
} from './crestTexelRank';

// Crest density from a texel rank with a soft threshold (L4, 2026-11-02). Pins: the R2 rank is near-continuous over the 296^2
// texels; the kept share is smooth in tau (no staircase, so no pops); the number DRAWN never drops below the old hash's share as
// read back from the d3d11 GPU; the alpha-weighted share is the smooth share; the GLSL matches the mirror; the kill.
const RES = 296;
// particleHash's kept share F(tau) on the real GPU (ANGLE d3d11, AMD Radeon 890M; L4 hash_gpu.json read back through RGBA32F, 2026-11-02)
const GPU_HASH_SHARE = [[0.02, 0.02159], [0.035, 0.03225], [0.05, 0.05361], [0.065, 0.08318], [0.08, 0.09898], [0.09, 0.11618], [0.1, 0.13274],
  [0.11, 0.13971], [0.12, 0.14285], [0.125, 0.1518], [0.128, 0.15998], [0.13, 0.17239], [0.132, 0.18494], [0.135, 0.18537], [0.14, 0.18557],
  [0.15, 0.18579], [0.16, 0.19362], [0.17, 0.21837], [0.185, 0.22821], [0.2, 0.26313], [0.215, 0.26467], [0.23, 0.26531], [0.25, 0.26905],
  [0.27, 0.29953], [0.3, 0.3151], [0.35, 0.36222], [0.4, 0.42068], [0.45, 0.47474], [0.5, 0.50815], [0.6, 0.59574], [0.7, 0.70093],
  [0.8, 0.753], [0.9, 0.88339], [0.97, 0.99217]];
const ranks = (() => { const r = new Float64Array(RES * RES); for (let row = 0; row < RES; row++) for (let col = 0; col < RES; col++) r[row * RES + col] = crestTexelRank(col, row); return r; })();
const sorted = Float64Array.from(ranks).sort();
const keptShare = (t) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= t) lo = m + 1; else hi = m; } return lo / sorted.length; };

describe('the R2 rank on the state texel', () => {
  it('is near-continuous: > 50,000 distinct values, and the share under any threshold is within 1e-4 of it', () => {
    expect(new Set(ranks).size).toBeGreaterThan(50000);
    for (let t = 0.01; t < 1; t += 0.0137) expect(Math.abs(keptShare(t) - t)).toBeLessThan(1e-4);
  });
  it('is spatially even on the texel lattice: no 8x8 block of texels keeps far more or fewer than its share at tau 0.2', () => {
    for (let by = 0; by + 8 <= RES; by += 37) for (let bx = 0; bx + 8 <= RES; bx += 37) {
      let k = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (ranks[(by + y) * RES + bx + x] <= 0.2) k += 1;
      expect(Math.abs(k - 12.8)).toBeLessThanOrEqual(3);
    }
  });
});

describe('the share and the count', () => {
  it('the share is smooth and monotone in tau, never below tau (a zoom sweeps tau: no steps to pop)', () => {
    let prev = 0;
    for (let t = 0.001; t <= 0.97; t += 0.001) {
      const s = crestRankShare(t);
      expect(s).toBeGreaterThanOrEqual(Math.min(1, t) - 1e-12); expect(s).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(s - prev).toBeLessThan(0.004);   // a 0.001 step in tau moves the share by under 0.4%: no 2.38% block at once
      prev = s;
    }
  });
  it('the number DRAWN is at least what the old hash kept on the real GPU, at every measured tau', () => {
    for (const [t, gpu] of GPU_HASH_SHARE) expect(keptShare(Math.min(1, crestRankShare(t) * (1 + CREST_RANK_EDGE)))).toBeGreaterThanOrEqual(gpu - 1e-4);
  });
  it('the alpha-weighted share is the smooth share (the fade is symmetric about it)', () => {
    for (const t of [0.05, 0.13, 0.2, 0.4, 0.7]) {
      let a = 0; for (const r of ranks) { const f = crestRankFade(r, t); if (f > 0) a += f; }
      expect(a / ranks.length).toBeCloseTo(crestRankShare(t), 3);
    }
  });
  it('a crest fades over the edge instead of popping, and tau <= 0 (the big-surf density cut) still culls', () => {
    const t = 0.2, s = crestRankShare(t);
    expect(crestRankFade(s * 0.9, t)).toBe(1);
    expect(crestRankFade(s, t)).toBeCloseTo(0.5, 9);
    expect(crestRankFade(s * (1 + CREST_RANK_EDGE) + 1e-9, t)).toBe(-1);
    expect(crestRankFade(0, -1.9)).toBe(-1);
    expect(crestRankFade(0.5, 0)).toBe(-1);
  });
});

describe('the GLSL and the kill', () => {
  it('the shader carries the same knots, edge and R2 constants as the mirror; killed at runtime it is the old comparison', () => {
    for (const [k] of CREST_RANK_KNOTS.slice(0, -1)) expect(CREST_TEXEL_RANK_GLSL).toContain(`if (t > ${k})`);
    expect(CREST_TEXEL_RANK_GLSL).toContain('fract(0.7548776662 * cr.x + 0.569840291 * cr.y)');
    expect(CREST_TEXEL_RANK_GLSL).toContain('s * 1.075');
    expect(CREST_TEXEL_RANK_GLSL).toContain('if (u_texelRank < 0.5) return hash > tau ? -1.0 : 1.0;');
    expect(CREST_RANK_SPLICE.alpha).toContain('max(rankFade, bypassDiscard ? 1.0 : 0.0)');
    expect(CREST_TEXEL_RANK_GLSL).not.toContain('+=');
    expect(crestTexelRankOn({})).toBe(true); expect(crestTexelRankOn({ __RAW_DISABLE_CREST_TEXEL_RANK__: true })).toBe(false);
  });
  it('particleHash still drives size, brightness and heading jitter (the look of each crest is unchanged)', () => {
    const { DRAW_VS } = require('./WebGLMarineParticleShaders');
    for (const s of ['halfLength *= 0.85 + particleHash * 0.3;', 'halfThickness *= 0.9 + particleHash * 0.2;', '(0.9 + particleHash * 0.2)', 'float jitterAng = (particleHash - 0.5)'])
      expect(DRAW_VS).toContain(s);
  });
});
