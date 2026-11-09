/**
 * crestTexelRank.js: which crests DRAW_VS keeps at a given density, chosen by a continuous rank of the particle's state texel,
 * with a soft edge so a zoom fades crests in and out instead of popping them. ON by default.
 * Kill: window.__RAW_DISABLE_CREST_TEXEL_RANK__ = true -> the old hard cut `particleHash > densityThreshold`, byte for byte.
 *
 * WHY: the density cull compared particleHash = fract(sin(index * 12.9898) * 43758.5453) with the threshold tau. Its sine argument
 * reaches ~1.1e6 for 296^2 particles and GPUs range-reduce it in float32: read back from the d3d11 GPU it takes only 821 distinct
 * values (SwiftShader 779), one value holding 2.38% of all crests, so the kept share F(tau) moves in STEPS as tau sweeps with zoom
 * (crest-hash-staircase, 2026-10-21; L4 2026-11-02). Each step pops a block of crests at once.
 *
 * THE RANK: the R2 lattice sequence on the texel, rank = fract(0.7548776662 col + 0.5698402910 row) (Roberts 2018, the plastic
 * number's low-discrepancy pair). 60,503 distinct values over 296^2 texels, its kept share within 7e-5 of any threshold. With
 * stratified reseeding ON (the default since 2026-07-02) a texel's particle lives in its own patch of the tile, so a texel rank is
 * a SPATIAL rank: the kept set is spread evenly (mean nearest-neighbour / spacing 0.78-0.91 at 0.12-0.25, vs 0.50-0.64 for the hash).
 *
 * THE COUNT MUST NOT DROP: the hash does not keep tau, it keeps more at low tau (measured on the d3d11 GPU: 1.24-1.40 tau from 0.08
 * to 0.20, where the z2-4 views sit). A rank cut at tau would thin those views by up to 29%. So the rank's share follows the hash's
 * measured share from above: share(tau) = tau * ratio(tau), ratio piecewise linear through CREST_RANK_KNOTS (the hash's largest
 * F(t) / t near each knot, less the soft edge's margin), never below tau. The number of crests DRAWN is share * (1 + EDGE) >= the
 * hash's at every tau (crestTexelRank.test.js, against the GPU read-back), and the alpha-weighted share is `share`, smooth in tau.
 *
 * THE SOFT EDGE: alpha *= 1 - smoothstep(share (1 - EDGE), share (1 + EDGE), rank); a crest is culled only above share (1 + EDGE).
 * particleHash keeps every other job it had (size, brightness and heading jitter), so a crest looks exactly as it did.
 */
import { uniformLoc } from './glUniformCache';

export const CREST_TEXEL_RANK_KILL = '__RAW_DISABLE_CREST_TEXEL_RANK__';
export const CREST_RANK_EDGE = 0.075;                 // half-width of the soft edge, as a share of the kept share
export const R2_A1 = 0.7548776662, R2_A2 = 0.5698402910;
// share / tau at each knot (fit_rank.js over the d3d11 read-back of particleHash, L4 hash_gpu.json, 2026-11-03)
export const CREST_RANK_KNOTS = [[0.02, 1.101], [0.05, 1.2784], [0.08, 1.2784], [0.10, 1.2611], [0.12, 1.2348], [0.13, 1.3033], [0.15, 1.3033],
  [0.17, 1.2401], [0.20, 1.2401], [0.23, 1.2238], [0.27, 1.078], [0.35, 1.032], [0.5, 1.0008], [0.7, 1.0], [0.97, 1.0]];

// Set before the map loads, the kill leaves DRAW_VS's text exactly as before (CREST_RANK_SPLICE); set later, u_texelRank = 0.
const WIN = typeof window === 'undefined' ? {} : window;
export const CREST_RANK_AT_LOAD = WIN[CREST_TEXEL_RANK_KILL] !== true;
const winOf = (w) => (w !== undefined ? w : (typeof window !== 'undefined' ? window : null));
export function crestTexelRankOn(win) { const w = winOf(win); return CREST_RANK_AT_LOAD && !(w && w[CREST_TEXEL_RANK_KILL] === true); }
export function applyCrestRankUniforms(gl, program) { gl.uniform1f(uniformLoc(gl, program, 'u_texelRank'), crestTexelRankOn() ? 1 : 0); }

const g = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const RATIO_GLSL = CREST_RANK_KNOTS.slice(1).map(([k, r], i) => {
  const [k0, r0] = CREST_RANK_KNOTS[i];
  return `  if (t > ${g(k0)}) r = mix(${g(r0)}, ${g(r)}, clamp((t - ${g(k0)}) / ${g(k - k0 > 0 ? +(k - k0).toFixed(4) : 1)}, 0.0, 1.0));`;
}).join('\n');
// GLSL: > 0 keep (the alpha factor), <= 0 cull. Killed (u_texelRank = 0): 1 or -1 from the old comparison exactly.
const RANK_GLSL = ` uniform float u_texelRank;
float crestRankShare(float t) {
  float r = ${g(CREST_RANK_KNOTS[0][1])};
${RATIO_GLSL}
  return min(1.0, t * r);
}
float crestRankFade(vec2 cr, float hash, float tau) {
  if (u_texelRank < 0.5) return hash > tau ? -1.0 : 1.0;
  if (tau <= 0.0) return -1.0;
  float rank = fract(${R2_A1} * cr.x + ${R2_A2} * cr.y); float s = crestRankShare(tau);
  float hi = min(1.0, s * ${g(1 + CREST_RANK_EDGE)}), lo = s * ${g(1 - CREST_RANK_EDGE)};
  return rank > hi ? -1.0 : 1.0 - smoothstep(lo, hi, rank);
}`;
const ON = CREST_RANK_AT_LOAD;
/** DRAW_VS's splice points (on: the rank and its soft edge; killed at load: the old text verbatim). */
export const CREST_RANK_SPLICE = {
  decl: ON ? RANK_GLSL : '',
  cull: ON ? '  float rankFade = crestRankFade(vec2(col, row), particleHash, densityThreshold);   // texel rank + soft edge (crestTexelRank.js)\n'
    + '  if (!bypassDiscard && rankFade <= 0.0) {' : '  if (!bypassDiscard && particleHash > densityThreshold) {',
  alpha: ON ? '  v_alpha *= (0.9 + particleHash * 0.2) * max(rankFade, bypassDiscard ? 1.0 : 0.0);   // the soft edge of the rank (1.0 when killed)'
    : '  v_alpha *= 0.9 + particleHash * 0.2;',
};
export const CREST_TEXEL_RANK_GLSL = CREST_RANK_SPLICE.decl;

/** JS mirrors, float32 where the GPU's rounding matters. */
export function crestTexelRank(col, row) {
  const f = Math.fround, v = f(f(f(R2_A1) * f(col)) + f(f(R2_A2) * f(row)));
  return f(v - Math.floor(v));
}
export function crestRankShare(tau) {
  let r = CREST_RANK_KNOTS[0][1];
  for (let i = 1; i < CREST_RANK_KNOTS.length; i++) {
    const [k0, r0] = CREST_RANK_KNOTS[i - 1], [k, r1] = CREST_RANK_KNOTS[i];
    if (tau > k0) r = r0 + (r1 - r0) * Math.min(1, Math.max(0, (tau - k0) / (k - k0)));
  }
  return Math.min(1, tau * r);
}
export function crestRankFade(rank, tau) {
  if (tau <= 0) return -1;
  const s = crestRankShare(tau), hi = Math.min(1, s * (1 + CREST_RANK_EDGE)), lo = s * (1 - CREST_RANK_EDGE);
  if (rank > hi) return -1;
  const u = Math.min(1, Math.max(0, (rank - lo) / (hi - lo)));
  return 1 - u * u * (3 - 2 * u);
}
