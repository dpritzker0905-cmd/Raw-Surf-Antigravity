// WAVE HEIGHT QUANTIZATION: what the height encoding's step costs in colour, per encoding and theme (2026-10-20: the 16 m byte,
// #415; the R16F float height, marineHeightFloat.js).
// One texel decodes to a quantized height; this prices it as the wash DRAWS it (the depth-floor blend under 0.18 m, the ramp, the
// swell lighting at half, world alpha, composited over the theme's water), every 1 mm from 0 to 10 m, against the exact height.
// The calm end dominates: smoothstep(0, 0.18, h) is steep, so a few centimetres there move the colour by many dE00.
//  - light, beach: wave-lib.mjs composite over each theme's own table (marineWavePalette.js): light v2 at 16 m (D-033, D-034;
//    --palette overrides it), beach v1 at 10 m (D-035: the owner locked beach to v1), plus beach v2@16 as D-035's kill draws it;
//  - dark: the shader's OWN ramp (HEATMAP_FS getThemedWaveColor, non-surf: getNonlinearT and the lifted calm c0, mirrored below:
//    keep in sync), its deep-ocean floor, over two grounds: the dark style's sea as read (93, 117, 126; mirror-model.mjs) and the
//    fallback basemap's (11, 29, 46; windDarkRules.js BASE, what the offline harness draws when the dark style is unavailable).
// Encodings: the byte as packed (WebGLMarineTextureEncoder.js: floor at /10, round at /16) and R16F, which stores the encoder's
// heights as they are: fp16 (Float16Array scratch, or fp32 rounded to half on upload), clamped to the same scale as the byte.
// Usage: node wave-quant.mjs [--palette v2@16] [--alpha world]
import { loadPalettes, composite, ALPHAS, ss, dE } from './wave-lib.mjs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const mod = loadPalettes(), id = arg('--palette', 'v2@16'), base = mod.WAVE_PALETTES[id.replace('@16', '')];
const P = id.endsWith('@16') ? mod.widenWavePalette(base) : base, a = ALPHAS[arg('--alpha', 'world')];
const u8 = (s, round) => (h) => (round ? Math.round : Math.floor)(Math.min(1, h / s) * 255) * s / 255;
const half = (h) => { if (h <= 0) return 0; const ulp = Math.pow(2, Math.max(-24, Math.floor(Math.log2(h)) - 10)); return Math.round(h / ulp) * ulp; };
const r16f = (s) => (h) => half(Math.min(h, s));

// Dark: HEATMAP_FS's dark non-surf ramp (c0 lifted 2026-07-04, c1 the 2 ft spring green) and its deep-ocean floor (deepNavy).
const mix = (x, y, t) => x.map((v, i) => v + (y[i] - v) * t);
const DARK_C = [[0.05, 0.19, 0.36], [0.00, 0.82, 0.51], [0.00, 0.92, 1.00], [0.35, 0.15, 1.00], [1.00, 0.10, 0.75], [1, 1, 1]];
const DARK_B = [0, 0.20, 0.46, 0.72, 0.94, 1.0], DARK_FLOOR = [0.005, 0.015, 0.05], LIGHTING = [0.03, 0.05, 0.08];
const tNonlinear = (h) => (h < 0.6 ? (h / 0.6) * 0.20 : h < 1.2 ? 0.20 + ((h - 0.6) / 0.6) * 0.26 : h < 2.4 ? 0.46 + ((h - 1.2) / 1.2) * 0.26
  : h < 5.0 ? 0.72 + ((h - 2.4) / 2.6) * 0.22 : 0.94 + Math.min(1, Math.max(0, (h - 5.0) / 5.0)) * 0.06);
function darkRamp(h) {
  const t = tNonlinear(h);
  for (let i = 0; i < 5; i++) if (t < DARK_B[i + 1] || i === 4) return mix(DARK_C[i], DARK_C[i + 1], (t - DARK_B[i]) / (DARK_B[i + 1] - DARK_B[i]));
  return DARK_C[5];
}
const clamp01 = (c) => c.map((v) => Math.min(1, Math.max(0, v)));
function darkComposite(h, alpha, dir, water) {
  const W = mix(DARK_FLOOR, darkRamp(h), ss(0, 0.18, h)), lit = W.map((v, i) => v + LIGHTING[i] * dir * ss(0.1, 3.0, h));
  return clamp01(clamp01(lit).map((v, i) => v * alpha + (water[i] / 255) * (1 - alpha)));
}

const LB = { 'u8 /10 floor (the 16 m kill)': u8(10, false), 'u8 /16 floor (#415 first push)': u8(16, false), 'u8 /16 round (dev, #415)': u8(16, true),
  'R16F at /16 (this PR)': r16f(16), 'R16F at /10 (this PR, 16 m kill)': r16f(10) };
const AT10 = { 'u8 /10 floor (dev)': u8(10, false), 'R16F at /10 (this PR)': r16f(10) };
const AT16 = { 'u8 /16 round': u8(16, true), 'R16F at /16 (this PR)': r16f(16) };
const DK = { 'u8 /10 floor (dev, #415)': u8(10, false), 'R16F at /10 (this PR)': r16f(10) };
const V1 = mod.WAVE_PALETTES.v1, V2_16 = mod.widenWavePalette(mod.WAVE_PALETTES.v2);
const THEMES = [
  ['light', LB, (h) => composite(P, 'light', h, a, 0.5), `${id}`],
  ['beach', AT10, (h) => composite(V1, 'beach', h, a, 0.5), 'v1, D-035: what beach draws'],
  ['beach', AT16, (h) => composite(V2_16, 'beach', h, a, 0.5), 'v2@16, under D-035\'s kill __RAW_DISABLE_WAVE_BEACH_V1__'],
  ['dark', DK, (h) => darkComposite(h, a, 0.5, [93, 117, 126]), 'shader ramp, style sea 93/117/126'],
  ['dark', DK, (h) => darkComposite(h, a, 0.5, [11, 29, 46]), 'shader ramp, fallback sea 11/29/46'],
];
for (const [theme, enc, draw, what] of THEMES) {
  console.log(`\n${theme}  (${what}, ${arg('--alpha', 'world')} alpha ${a})`);
  for (const [name, q] of Object.entries(enc)) {
    let max = 0, at = 0, sum = 0, n = 0;
    for (let k = 0; k <= 10000; k++) {
      const h = k / 1000, d = dE(draw(h), draw(q(h)));
      if (d > max) { max = d; at = h; }
      sum += d; n++;
    }
    console.log(`  ${name.padEnd(34)} worst texel ${max.toFixed(2)} dE00 at ${at.toFixed(3)} m, mean ${(sum / n).toFixed(3)}`);
  }
}
