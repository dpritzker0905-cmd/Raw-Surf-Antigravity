// LIGHT CREST STYLE CHECK (2026-10-21): how visible light's ORIGINAL crests (deep navy -> amber-gold -> crimson red, white foam; the
// default again since D-041) are on light's wash as the engine draws it, today and under the luminance-only two-tone in
// src/components/map/marineLightCrestStyle.js (read from that module), plus any --try rim,centre,alpha candidates.
// Washes: v2 (light's wash on dev), with PR #425's measured alpha law as dev draws it since #430 (D-038): no regional tile world 0.65,
// z4.6 0.68; with one (BLEND BOTH) a = 1 - (1 - a_z)(1 - washEff), washEff = a_z 0.72 (1 - 0.65 ss(8,9.5,z)), a_z 0.68 / 0.75 / 0.78 at
// z4.6 / 7.4 / 10 (the law #433 fitted, which reproduces light's measured 0.84 / 0.877 / 0.80 within 0.02); and #431's SPECTRUM (not on
// dev; its stops, opacity law, water and lighting as #431's session sent them 2026-10-21, at its world / regional / coastal bases, no
// blend states). A crest is sampled at its centre (ellipseDist 0.05), body (0.42) and edge (0.78) as DRAW_FS shades them, at the alpha
// the engine gives it: DRAW_VS v_alpha = mix(0.50, 0.85, ss(0,4,h)) x zoomAlphaScale (mix(0.45, 1, ss(3,9,z))), x DRAW_FS's shape and
// energy boost mix(1.2, 1.8, e), capped at 0.85. Outer edge = the best of the three parts vs the wash, APCA |Lc|, worst over swell
// lighting 0/0.5/1 and whitecap off/full, every 0.1 m from 0.1 to 14 m; inner edge = centre vs edge. Colour-blind: best part, dE00.
// Usage: node light-crest-style.mjs [--json out.json] [--try 0.30,0.75,1 --try 0.25,0.80,2]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPalettes, composite, apcaLc, allDE, ss } from './wave-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', '..', 'src', 'components', 'map', 'marineLightCrestStyle.js'), 'utf8').replace(/^export /gm, '');
const { LIGHT_CREST_STYLES } = new Function(`${src}; return { LIGHT_CREST_STYLES };`)();
const STYLES = { ...LIGHT_CREST_STYLES };
process.argv.forEach((a, i) => {
  if (a === '--try') { const [rim, centre, alpha] = process.argv[i + 1].split(',').map(Number); STYLES[`try ${process.argv[i + 1]}`] = { rim, centre, alpha }; }
});
const V2 = loadPalettes().WAVE_PALETTES.v2;
const CALM = [0.05, 0.15, 0.45], ACTIVE = [0.85, 0.50, 0.00], STORM = [0.75, 0.10, 0.05], FOAM = [1, 1, 1];   // DRAW_FS light (original)
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (c) => c.map((v) => Math.min(1, Math.max(0, v)));
const base = (h, wc) => { const e = ss(0, 6, h); const c = e < 0.5 ? mix(CALM, ACTIVE, e * 2) : mix(ACTIVE, STORM, (e - 0.5) * 2); return mix(c, FOAM, wc * ss(0.5, 3.0, h) * 0.45); };
const over = (c, a, u) => clamp01(c).map((v, i) => v * a + u[i] * (1 - a));

// #431's spectrum (light only): stops, its opacity law (no deep-ocean floor), light water and swell lighting added before compositing.
const SPEC_H = [0, 0.5, 1.25, 2.5, 4, 4.5, 5, 5.5, 6, 9, 14];
const SPEC_RGB = [[0, 202, 144], [0, 202, 144], [0, 156, 222], [80, 109, 246], [128, 60, 235], [142, 58, 206], [156, 52, 176], [169, 38, 147], [181, 0, 118], [164, 0, 26], [90, 20, 0]];
const WATER = [144, 223, 254].map((v) => v / 255), LIGHTING = [0.03, 0.05, 0.08];
function spectrum(h, baseA, dir) {
  const hh = Math.min(14, Math.max(0, h));
  let k = SPEC_H.findIndex((x) => x >= hh); if (k <= 0) k = 1;
  const t = (hh - SPEC_H[k - 1]) / (SPEC_H[k] - SPEC_H[k - 1]);
  const c = mix(SPEC_RGB[k - 1], SPEC_RGB[k], t).map((v) => v / 255);
  const lit = clamp01(c.map((v, i) => v + LIGHTING[i] * dir * ss(0.1, 3.0, h)));
  const tt = Math.min(1, Math.max(0, Math.log(Math.max(h, 0.5) / 0.5) / Math.log(12)));
  const a = (baseA + (1 - baseA) * 0.4286 * tt) * ss(0, 0.5, h);
  return clamp01(lit.map((v, i) => v * a + WATER[i] * (1 - a)));
}

const blend = (az, z) => { const we = az * 0.72 * (1 - 0.65 * ss(8, 9.5, z)); return () => 1 - (1 - az) * (1 - we); };
const STATES = {
  v2: [['world z2.2', () => 0.65, 0, 2.2], ['regional z4.6', () => 0.68, 1, 4.6], ['z4.6 tile', blend(0.68, 4.6), 1, 4.6],
    ['coastal z7.4 tile', blend(0.75, 7.4), 0, 7.4], ['close z10 tile', blend(0.78, 10), 0, 10]],
  spectrum: [['world z2.2', 0.65, 0, 2.2], ['regional z4.6', 0.70, 1, 4.6], ['coastal z7.4', 0.77, 0, 7.4], ['close z10', 0.77, 0, 10]],
};
const wash = (pal, st, h, dir) => (pal === 'v2' ? composite(V2, 'light', h, st[1](h), dir) : spectrum(h, st[1], dir));
const crestAlpha = (h, z, shape) => Math.min(0.85, (0.50 + 0.35 * ss(0, 4, h)) * (0.45 + 0.55 * ss(3, 9, z)) * shape * (1.2 + 0.6 * ss(0, 6, h)));
const shapeAt = (ed, edge) => 1 - ss(edge, 1.0, ed);
const selfContrast = (h, band) => Math.max(band, 1 - ss(0.75, 1.05, h));
const ED = [0.05, 0.42, 0.78];

function parts(style, h, wc, band, z) {
  const c = base(h, wc), t = STYLES[style];
  if (t) {
    const col = (ed) => mix(mix(c, c.map((v) => v * t.rim), ss(0.55, 0.72, ed)), [1, 1, 1], t.centre * (1 - ss(0.12, 0.32, ed)));
    const boost = 1 + ((t.alpha || 1) - 1) * (1 - ss(3, 9, z));   // DRAW_FS: mix(alpha, 1, smoothstep(3, 9, u_zoom))
    return ED.map((ed) => [col(ed), crestAlpha(h, z, shapeAt(ed, 0.80) * boost)]);
  }
  const eff = selfContrast(h, band), core = (ed) => 1 - ss(0.15, 0.85, ed);
  const sc = (k) => mix(c, c.map((v, i) => v * (0.55 + 0.75 * k) + FOAM[i] * k * 0.18), eff);
  return ED.map((ed) => [sc(core(ed)), crestAlpha(h, z, shapeAt(ed, 0.55))]);
}

const out = {};
for (const pal of ['v2', 'spectrum']) {
  out[pal] = {};
  for (const style of ['today', ...Object.keys(STYLES)]) {
    const res = { states: {}, cvdMin: Infinity, innerMin: Infinity };
    for (const st of STATES[pal]) {
      const [name, , band, z] = st, lc = [];
      for (let h = 0.1; h <= 14.0001; h += 0.1) {
        let vis = Infinity;
        for (const dir of [0, 0.5, 1]) for (const wc of [0, 1]) {
          const u = wash(pal, st, h, dir), px = parts(style, h, wc, band, z).map(([c, a]) => over(c, a, u));
          vis = Math.min(vis, Math.max(...px.map((p) => Math.abs(apcaLc(p, u)))));
          res.cvdMin = Math.min(res.cvdMin, Math.max(...px.map((p) => allDE(p, u).de)));
          if (style !== 'today') res.innerMin = Math.min(res.innerMin, Math.abs(apcaLc(px[0], px[2])));
        }
        lc.push({ h: +h.toFixed(1), lc: +vis.toFixed(1) });
      }
      const n = lc.length;
      res.states[name] = { worst: lc.reduce((m, x) => (x.lc < m.lc ? x : m)), under15: lc.filter((x) => x.lc < 15).length, under30: lc.filter((x) => x.lc < 30).length, under45: lc.filter((x) => x.lc < 45).length, n, lc };
    }
    out[pal][style] = res;
    console.log(`\n=== ${pal} / ${style}: colour-blind (best part) >= ${res.cvdMin.toFixed(1)} dE00${Number.isFinite(res.innerMin) ? `; inner edge min |Lc| ${res.innerMin.toFixed(1)}` : ''}`);
    for (const [name, r] of Object.entries(res.states)) console.log(`  ${name.padEnd(18)} worst |Lc| ${String(r.worst.lc).padStart(5)} at ${String(r.worst.h).padStart(4)} m; under 15 / 30 / 45 at ${r.under15} / ${r.under30} / ${r.under45} of ${r.n}`);
  }
}
const j = process.argv.indexOf('--json');
if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out));
