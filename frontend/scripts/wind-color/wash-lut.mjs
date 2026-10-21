// WASH LUT for ../offline-backend/wash_alpha.py (2026-10-20): the light/beach wave-height wash BEFORE its alpha, per palette, read
// through wave-lib.mjs (the model wave-check.mjs and the crest solvers use), so the fitter can lay it at any alpha over any water.
// Row: [h (m), swell lighting 0..1, R, G, B (0..1, encoded sRGB)] = clamp01(mix(depth floor, W(h), smoothstep(0, 0.18, h))
// + (0.03, 0.05, 0.08) * dir * smoothstep(0.1, 3.0, h)), i.e. wave-lib composite()'s lit colour; composite(P, theme, h, a, dir) is
// exactly lit * a + water * (1 - a). Above a palette's cap (P.over) one more row per lighting at h = cap + 1.
// Also written: wave-lib's BASEMAP water and ALPHAS, so the fitter reports the model the checkers run.
// Usage (from this folder): node wash-lut.mjs <out.json> [--themes light,beach] [--palettes v2,v1] [--step 0.025]
import fs from 'fs';
import { ALPHAS, BASEMAP, loadPalettes, composite } from './wave-lib.mjs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = args[0];
if (!out || out.startsWith('--')) throw new Error('usage: node wash-lut.mjs <out.json> [--themes light,beach] [--palettes v2,v1] [--step 0.025]');
const themes = arg('--themes', 'light,beach').split(','), ids = arg('--palettes', 'v2,v1').split(','), step = Number(arg('--step', 0.025));
const P = loadPalettes().WAVE_PALETTES, DIRS = [0, 0.25, 0.5, 0.75, 1];
const lut = { alphas: ALPHAS, basemap: BASEMAP, palettes: {} };
for (const id of ids) {
  if (!P[id]) throw new Error(`wash-lut.mjs: no palette ${id} in marineWavePalette.js (${Object.keys(P).join(', ')})`);
  const pal = P[id], cap = pal.cap, hs = [];
  for (let k = 0; k * step <= cap + 1e-9; k++) hs.push(+(k * step).toFixed(4));
  if (pal.over) hs.push(cap + 1);
  lut.palettes[id] = { cap, over: !!pal.over };
  for (const theme of themes) {
    const rows = [];
    for (const h of hs) for (const dir of DIRS) rows.push([h, dir, ...composite(pal, theme, h, 1, dir)]);   // a = 1: the lit colour itself
    // Self-check: the row laid at the model's alpha over the model's water is wave-lib's composite (no clamp lost at a = 1).
    const w = BASEMAP[theme].water.map((v) => v / 255);
    for (const [h, dir, ...c] of rows.filter((_, i) => i % 97 === 0)) {
      const want = composite(pal, theme, h, ALPHAS.regional, dir), got = c.map((v, i) => v * ALPHAS.regional + w[i] * (1 - ALPHAS.regional));
      if (got.some((v, i) => Math.abs(v - want[i]) > 1e-9)) throw new Error(`wash-lut.mjs: lit * a + water * (1 - a) != composite at ${theme} ${id} h ${h}`);
    }
    lut.palettes[id][theme] = rows;
  }
}
fs.writeFileSync(out, JSON.stringify(lut));
console.log(`wrote ${out}: ${ids.join(', ')} x ${themes.join(', ')}; ALPHAS ${JSON.stringify(ALPHAS)}`);
