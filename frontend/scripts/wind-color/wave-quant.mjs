// WAVE HEIGHT QUANTIZATION: what the height byte's step costs in colour, per encoding (2026-10-20, the 16 m encoding, #415).
// One texel decodes to a quantized height; this prices it as the wash DRAWS it (wave-lib.mjs composite: the depth-floor blend under
// 0.18 m, the table, the swell lighting at half, world alpha), every 1 mm from 0 to 10 m, against the exact height.
// The calm end dominates: smoothstep(0, 0.18, h) is steep, so a few centimetres there move the colour by many dE00.
// Usage: node wave-quant.mjs [--palette v2@16] [--alpha world]
import { loadPalettes, composite, ALPHAS, dE } from './wave-lib.mjs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const mod = loadPalettes(), id = arg('--palette', 'v2@16'), base = mod.WAVE_PALETTES[id.replace('@16', '')];
const P = id.endsWith('@16') ? mod.widenWavePalette(base) : base, a = ALPHAS[arg('--alpha', 'world')];
const u8 = (s, round) => (h) => (round ? Math.round : Math.floor)(Math.min(1, h / s) * 255) * s / 255;
const half = (h) => { if (h <= 0) return 0; const ulp = Math.pow(2, Math.floor(Math.log2(h)) - 10); return Math.round(h / ulp) * ulp; };   // R16F
const ENC = { 'u8 /10 floor (dev, dark, rating)': u8(10, false), 'u8 /16 floor': u8(16, false), 'u8 /16 round (#415)': u8(16, true), 'R16F (half float)': half };
for (const theme of ['light', 'beach']) {
  console.log(`\n${theme}  (${id}, ${arg('--alpha', 'world')} alpha ${a})`);
  for (const [name, q] of Object.entries(ENC)) {
    let max = 0, at = 0, sum = 0, n = 0;
    for (let h = 0; h <= 10 + 1e-9; h += 0.001) { const d = dE(composite(P, theme, h, a, 0.5), composite(P, theme, q(h), a, 0.5)); if (d > max) { max = d; at = h; } sum += d; n++; }
    console.log(`  ${name.padEnd(34)} worst texel ${max.toFixed(2)} dE00 at ${at.toFixed(3)} m, mean ${(sum / n).toFixed(3)}`);
  }
}
