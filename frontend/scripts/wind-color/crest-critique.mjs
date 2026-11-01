// CREST CRITIQUE TABLE (2026-10-21, owner: "run a structured design critique with colour-harmony checks across all three crests").
// For each theme, the crest core against the wash it rides over, as drawn (wave-lib.mjs crestOver: DRAW_FS's colour mix by energy,
// laid at 0.85), at representative heights and every opacity and swell lighting: APCA |Lc| (lightness contrast, what keeps a moving
// mark visible: direction of motion is lost at isoluminance), the weakest colour-blind dE00, and the HUE RELATIONSHIP of crest and wash
// (OKLCH hue difference: analogous < 30, adjacent 30-75, triadic 75-135, complementary 135-180), the colour-harmony read a painter makes.
//  - light: the spectrum (D-037) under V2's colours switching at 1.55 m (what this branch draws), and v2 under V2 at 3.05 m (today);
//  - beach: v1 (D-035) under its shader crests (orchid-pink, electric turquoise, sunset magenta);
//  - dark: the shader's own ramp (mirrored from wave-quant.mjs) under its crests (mint, yellow-gold, fiery orange), over the dark style's
//    sea as read (93,117,126) and the fallback basemap's (11,29,46).
// The core includes DRAW_FS's low-height self-contrast term (selfContrast(h), zoom band off).
// Usage: node crest-critique.mjs [--json out.json]
import fs from 'fs';
import { loadPalettes, composite, crestOver, ALPHAS, apcaLc, allDE, oklab, ss, selfContrast, LIGHT_CRESTS, CRESTS } from './wave-lib.mjs';

const mod = loadPalettes(), HS = [0.3, 0.8, 1.5, 2.5, 4, 6, 9, 13], DIRS = [0, 0.5, 1];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), clamp01 = (c) => c.map((v) => Math.min(1, Math.max(0, v)));
// dark: HEATMAP_FS's non-surf ramp and deep-ocean floor (wave-quant.mjs), composited over the dark water
const DARK_C = [[0.05, 0.19, 0.36], [0.00, 0.82, 0.51], [0.00, 0.92, 1.00], [0.35, 0.15, 1.00], [1.00, 0.10, 0.75], [1, 1, 1]], DARK_B = [0, 0.20, 0.46, 0.72, 0.94, 1.0];
const tNl = (h) => (h < 0.6 ? (h / 0.6) * 0.20 : h < 1.2 ? 0.20 + ((h - 0.6) / 0.6) * 0.26 : h < 2.4 ? 0.46 + ((h - 1.2) / 1.2) * 0.26 : h < 5.0 ? 0.72 + ((h - 2.4) / 2.6) * 0.22 : 0.94 + Math.min(1, Math.max(0, (h - 5.0) / 5.0)) * 0.06);
const darkRamp = (h) => { const t = tNl(Math.min(h, 10)); for (let i = 0; i < 5; i++) if (t < DARK_B[i + 1] || i === 4) return mix(DARK_C[i], DARK_C[i + 1], (t - DARK_B[i]) / (DARK_B[i + 1] - DARK_B[i])); return DARK_C[5]; };
const darkWash = (water) => (h, a, dir) => {
  const W = mix([0.005, 0.015, 0.05], darkRamp(h), ss(0, 0.18, h)), lit = W.map((v, i) => v + [0.03, 0.05, 0.08][i] * dir * ss(0.1, 3.0, h));
  return clamp01(clamp01(lit).map((v, i) => v * a + (water[i] / 255) * (1 - a)));
};
// dark's crest lines in DRAW_FS: mint-green, yellow-gold, fiery orange, white foam
const DARK_CREST = [[0.10, 0.95, 0.60], [1.00, 0.80, 0.10], [1.00, 0.40, 0.10], [1.00, 1.00, 1.00]];
const darkCrestOver = (h, under, wc, sc = null) => crestOver('dark', h, under, wc, DARK_CREST, sc);
const hueOf = (rgb) => { const o = oklab(rgb); return o.C < 0.02 ? null : o.h; };
const relation = (a, b) => {
  if (a === null || b === null) return 'neutral';
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d < 30 ? 'analogous' : d < 75 ? 'adjacent' : d < 135 ? 'triadic' : 'complementary';
};
const hueDiff = (a, b) => (a === null || b === null ? null : Math.abs(((a - b + 540) % 360) - 180));
const SETS = [
  { name: 'light: spectrum + V2 crests switching at 1.55 m (this PR)', wash: (h, a, d) => composite(mod.WAVE_PALETTES.spectrum, 'light', h, a, d), crest: (h, u, wc, sc) => crestOver('light', h, u, wc, LIGHT_CRESTS.v2s, sc) },
  { name: 'light: v2 + V2 crests switching at 3.05 m (today)', wash: (h, a, d) => composite(mod.widenWavePalette(mod.WAVE_PALETTES.v2), 'light', h, a, d), crest: (h, u, wc, sc) => crestOver('light', h, u, wc, LIGHT_CRESTS.v2, sc) },
  { name: 'beach: v1 + its shader crests (today, D-035)', wash: (h, a, d) => composite(mod.WAVE_PALETTES.v1, 'beach', h, a, d), crest: (h, u, wc, sc) => crestOver('beach', h, u, wc, CRESTS.v1, sc) },
  { name: 'dark: shader ramp + its crests (today), style sea 93,117,126', wash: darkWash([93, 117, 126]), crest: darkCrestOver },
  { name: 'dark: shader ramp + its crests (today), fallback sea 11,29,46', wash: darkWash([11, 29, 46]), crest: darkCrestOver },
];
const out = {};
for (const set of SETS) {
  const rows = HS.map((h) => {
    let w = { lc: Infinity };
    for (const a of Object.values(ALPHAS)) for (const dir of DIRS) for (const wc of [0, 1]) {
      // the core as DRAW_FS draws it: the low-height self-contrast (core x 1.30 + foam x 0.18 below 0.75 m, fading out by 1.05 m)
      const under = set.wash(h, a, dir), sc = { eff: selfContrast(h), core: 1 }, core = set.crest(h, under, wc, sc);
      const lc = Math.abs(apcaLc(core, under)), cvd = allDE(core, under).de;
      if (lc < w.lc) w = { lc, cvd, under, core };
    }
    const hu = hueOf(w.under), hc = hueOf(w.core);
    return { h, lc: +w.lc.toFixed(1), cvd: +w.cvd.toFixed(1), relation: relation(hu, hc), hueDiff: hueDiff(hu, hc) === null ? null : Math.round(hueDiff(hu, hc)),
      wash: w.under.map((v) => Math.round(v * 255)), crest: w.core.map((v) => Math.round(v * 255)) };
  });
  out[set.name] = rows;
  const weakest = rows.reduce((m, r) => (r.lc < m.lc ? r : m));
  console.log(`\n${set.name}\n  weakest |Lc| ${weakest.lc} at ${weakest.h} m (${weakest.relation}); colour-blind weakest ${Math.min(...rows.map((r) => r.cvd))}`);
  rows.forEach((r) => console.log(`  ${String(r.h).padStart(4)} m  |Lc| ${String(r.lc).padStart(5)}  cvd ${String(r.cvd).padStart(5)}  ${r.relation.padEnd(13)} (${r.hueDiff ?? '-'} deg)  wash ${r.wash.join(',')}  crest ${r.crest.join(',')}`));
}
const i = process.argv.indexOf('--json'); if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 1));
