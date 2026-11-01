// BEACH CREST LIFT CHECK (2026-10-22): a SUBTLE change to beach's crests where they share the v1 sea's brightness, with today's
// crest colours kept (owner: "No two-tone, they don't look like real waves"; "It needs to be a subtle improvement").
// In the sand band the crest goes a little deeper (colour x (1 - SAND x w)), in the grey-mauve band a little whiter (mixed toward
// white by MAUVE x w), and inside both its alpha is multiplied by 1 + (ALPHA - 1) x w x (1 - ss(3, 7, zoom)) far out; w is each band's
// weight (1 inside, 0 outside, smooth ramps), so crests elsewhere draw exactly as today. Bands and levels are read from
// src/components/map/marineBeachCrestLift.js, so the numbers here are the shipped ones; --try sand,mauve,alpha adds candidates.
// Wash: the v1 sea (D-035) at PR #425's measured alpha per zoom state with #430's calm hold; the crest at the alpha the engine draws
// (DRAW_VS v_alpha x zoomAlphaScale, DRAW_FS shape x energy boost, cap 0.85), sampled at its centre, body and edge, worst over swell
// lighting 0/0.5/1 and whitecap off/full, every 0.1 m 0.1-10 m.
// Reports, per zoom state: the worst APCA |Lc| (best part vs the wash) inside each band and outside them, and how much the crest
// LOOK changes: mean and max CIEDE2000 of the composited crest pixels against today's, per band (0 outside the ramps by design).
// Usage: node beach-crest-lift.mjs [--json out.json] [--try 0.30,0.35,1.5 --try 0.45,0.5,1.5]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPalettes, composite, apcaLc, dE, ss } from './wave-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', '..', 'src', 'components', 'map', 'marineBeachCrestLift.js'), 'utf8').replace(/^export /gm, '');
const { BEACH_CREST_LIFT, BEACH_LIFT_BANDS, bandWeight } = new Function('window', `${src}; return { BEACH_CREST_LIFT, BEACH_LIFT_BANDS, bandWeight };`)(undefined);
const CANDS = Object.fromEntries(Object.entries(BEACH_CREST_LIFT));
process.argv.forEach((a, i) => {
  if (a === '--try') { const [sand, mauve, alpha] = process.argv[i + 1].split(',').map(Number); CANDS[`try ${process.argv[i + 1]}`] = { sand, mauve, alpha }; }
});

const P = loadPalettes().WAVE_PALETTES.v1;
const CALM = [1.0, 0.45, 0.65], ACTIVE = [0.0, 0.92, 0.85], STORM = [0.8, 0.2, 0.9], FOAM = [0.95, 0.95, 1.0];   // DRAW_FS beach
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const base = (h, wc) => { const e = ss(0, 6, h); const c = e < 0.5 ? mix(CALM, ACTIVE, e * 2) : mix(ACTIVE, STORM, (e - 0.5) * 2); return mix(c, FOAM, wc * ss(0.5, 3.0, h) * 0.45); };
const over = (c, a, u) => c.map((v, i) => Math.min(1, Math.max(0, v)) * a + u[i] * (1 - a));
const blend = (az, z) => { const we = az * 0.72 * (1 - 0.65 * ss(8, 9.5, z)); return () => 1 - (1 - az) * (1 - we); };   // #430 calm hold
const STATES = [['world z2.2', () => 0.65, 0, 2.2], ['regional z4.6', () => 0.68, 1, 4.6], ['z4.6 tile', blend(0.68, 4.6), 1, 4.6],
  ['coastal z7.4 tile', blend(0.75, 7.4), 0, 7.4], ['close z10 tile', blend(0.78, 10), 0, 10]];
const crestAlpha = (h, z, shape) => Math.min(0.85, (0.50 + 0.35 * ss(0, 4, h)) * (0.45 + 0.55 * ss(3, 9, z)) * shape * (1.2 + 0.6 * ss(0, 6, h)));
const selfContrast = (h, band) => Math.max(band, 1 - ss(0.75, 1.05, h));
const ED = [0.05, 0.42, 0.78];

/** The crest's centre, body and edge [colour, alpha] as DRAW_FS draws them today, then the lift (t = { sand, mauve, alpha } or null). */
function parts(t, h, wc, band, z) {
  // DRAW_FS order: the lift right after the whitecap mix (the finalColor line), then the engine's self-contrast, then the alpha.
  const wS = t ? bandWeight('sand', h) : 0, wM = t ? bandWeight('mauve', h) : 0;
  const aK = t ? 1 + (t.alpha - 1) * (wS + wM) * (1 - ss(3, 7, z)) : 1;
  const c = mix(base(h, wc), [1, 1, 1], t ? t.mauve * wM : 0).map((v) => v * (1 - (t ? t.sand * wS : 0)));
  const eff = selfContrast(h, band), core = (ed) => 1 - ss(0.15, 0.85, ed);
  const sc = (k) => mix(c, c.map((v, i) => v * (0.55 + 0.75 * k) + FOAM[i] * k * 0.18), eff);
  return ED.map((ed) => [sc(core(ed)), crestAlpha(h, z, (1 - ss(0.55, 1.0, ed)) * aK)]);
}
const BANDS = Object.entries(BEACH_LIFT_BANDS).map(([id, b]) => [id, b.from, b.to]);
const inBand = (h) => BANDS.findIndex(([, lo, hi]) => h >= lo - 1e-9 && h <= hi + 1e-9);

const out = {};
for (const name of ['today', ...Object.keys(CANDS)]) {
  const t = name === 'today' ? null : CANDS[name], res = {};
  for (const [state, A, band, z] of STATES) {
    const rows = [];
    for (let h = 0.1; h <= 10.0001; h += 0.1) {
      let vis = Infinity, dsum = 0, dmax = 0, n = 0;
      for (const dir of [0, 0.5, 1]) for (const wc of [0, 1]) {
        const u = composite(P, 'beach', h, A(h), dir), px = parts(t, h, wc, band, z).map(([c, a]) => over(c, a, u));
        vis = Math.min(vis, Math.max(...px.map((p) => Math.abs(apcaLc(p, u)))));
        const p0 = parts(null, h, wc, band, z).map(([c, a]) => over(c, a, u));
        px.forEach((p, k) => { const d = dE(p, p0[k]); dsum += d; dmax = Math.max(dmax, d); n++; });
      }
      rows.push({ h: +h.toFixed(1), lc: +vis.toFixed(1), dE: +(dsum / n).toFixed(2), dEmax: +dmax.toFixed(2), band: inBand(+h.toFixed(1)) });
    }
    const summary = {};
    for (const [i, [label]] of [...BANDS.entries(), [-1, ['outside']]]) {
      const r = rows.filter((x) => x.band === i);
      summary[label] = { worst: r.reduce((m, x) => (x.lc < m.lc ? x : m)), under30: r.filter((x) => x.lc < 30).length, n: r.length,
        dEmean: +(r.reduce((s, x) => s + x.dE, 0) / r.length).toFixed(2), dEmax: Math.max(...r.map((x) => x.dEmax)) };
    }
    res[state] = { summary, rows };
  }
  out[name] = res;
  const what = t ? `: sand x${(1 - t.sand).toFixed(2)} deeper, grey-mauve ${t.mauve} toward white, alpha x${t.alpha} far out (x1 by z7), only inside the bands` : ': as dev draws it';
  console.log('');
  console.log(`=== ${name}${what}`);
  for (const [state, r] of Object.entries(res)) {
    console.log(`  ${state.padEnd(18)} ` + Object.entries(r.summary).map(([k, s]) => `${k}: worst ${String(s.worst.lc).padStart(4)} at ${s.worst.h} m, ${s.under30}/${s.n} under 30, look dE ${s.dEmean} (max ${s.dEmax})`).join(' | '));
  }
}
const j = process.argv.indexOf('--json');
if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out));
