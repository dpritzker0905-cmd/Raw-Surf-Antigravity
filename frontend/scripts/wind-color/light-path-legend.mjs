#!/usr/bin/env node
// LIGHT PATH, the legend: the bar's 3 to 27 kn rows moved onto the hues the field now draws (the field and the legend move together or
// not at all: LESSONS L-V45).
//
//   node light-path-legend.mjs [--seeds 3] [--gens 3000] [--tol 10] [--json out.json]
//
// WHAT IS SOLVED. The six legend rows 3, 6, 10, 16, 21 and 27 kn as bare colours (L*, C*, hue); calm (cloud white) and every row from
// 33 kn (gold) are the legend's own. THE BARS, the palette checker's own:
//   hue      each row within --tol degrees of the field's hue ON SCREEN over light's muted land at that stop, and at every half knot from
//            3 to 40 kn the bar's colour within 30 degrees of the field's, over land AND sea (check.mjs's "tint sits > 30 deg off the
//            legend's own hue" line must print none);
//   bands    neighbouring rows from calm to 33 kn at least 9 dE2000 apart in normal vision and 5.0 for protan, deutan and tritan;
//   shape    lightness never rising from calm to 33 kn; one chroma crest; every row displayable.
// THE AIM: the colour-blind distance (to 5.4), then the normal-vision distance, then colour.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { groundOf, sample, tintOver, drawnField, ramps } from './mirror-model.mjs';
import { lchOf, rgbOfLch, cvdDE, normalDE } from './light-path-lib.mjs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const STOPS = [3, 6, 10, 16, 21, 27], IDX = [1, 2, 3, 4, 5, 6], ALPHA = [0.75, 0.78, 0.80, 0.82, 0.84, 0.86];
const BEFORE = { __RAW_DISABLE_WIND_LIGHT_PATH__: true };
const LEGEND = ramps.resolveLegendRamp('light', BEFORE);   // the bar before the path (the particle ramp): calm and 33 kn up are kept
const FIELD = drawnField('light', {}), LAND = groundOf('light', 'land'), WATER = groundOf('light', 'water');
const on = (kn, bm) => tintOver('light', kn, sample(FIELD, kn), bm);
const fieldHue = STOPS.map((kn) => lchOf(on(kn, LAND)).h);
const arc = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
const TOL = Number(arg('--tol', 10));

export function legendOf(v) {   // v: six L, six C, six hue offsets
  return STOPS.map((kn, i) => { const raw = rgbOfLch(v[i], Math.max(1, v[6 + i]), fieldHue[i] + Math.max(-TOL, Math.min(TOL, v[12 + i])));
    return { kn, raw, row: raw.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000) }; });
}
export function score(v) {
  const rows = legendOf(v), over = Math.max(0, ...rows.flatMap((r) => r.raw.map((x) => Math.max(-x, x - 1))));
  const P = LEGEND.map((s) => s.slice()); rows.forEach((r, i) => { P[IDX[i]] = [r.kn, ...r.row, ALPHA[i]]; });
  const band = P.slice(0, 8).map((s) => s.slice(1, 4)), q = band.map(lchOf);
  let cvd = { de: 99 }, normal = { de: 99 };
  for (let i = 1; i < band.length; i++) { const c = cvdDE(band[i - 1], band[i]), n = normalDE(band[i - 1], band[i]), pair = `${P[i - 1][0]}-${P[i][0]}`; if (c.de < cvd.de) cvd = { ...c, pair }; if (n < normal.de) normal = { de: n, pair }; }
  const Pp = ramps.huePathStops(P, {}); let bent = 0, worst = 0;
  for (const bm of [LAND, WATER]) for (let s = 3; s <= 40; s += 0.5) { const p = lchOf(sample(Pp, s)), t = lchOf(on(s, bm)); if (p.C >= 10 && t.C >= 6) { const g = Math.abs(arc(t.h, p.h)); worst = Math.max(worst, g); if (g > 30) bent++; } }
  const rise = Math.max(0, ...q.slice(1).map((c, i) => c.L - q[i].L));
  const cs = q.map((c) => c.C); let uni = Infinity; for (let p = 0; p < cs.length; p++) { let u = 0; for (let i = 1; i < cs.length; i++) u += Math.max(0, i <= p ? cs[i - 1] - cs[i] : cs[i] - cs[i - 1]); uni = Math.min(uni, u); }
  const viol = over * 60 + bent * 0.5 + Math.max(0, worst - 26) * 0.3 + Math.max(0, rise - 0.02) * 8 + uni * 0.5 + Math.max(0, 5.0 - cvd.de) * 8 + Math.max(0, 9.0 - normal.de) * 4;
  const aim = Math.min(cvd.de, 5.4) * 10 + Math.min(normal.de, 12) + Math.min(...cs.slice(1, 7)) * 0.02 - viol * 30;
  return { rows, P, q, cvd, normal, bent, worst, rise, uni, over, viol, aim };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let seed = Number(arg('--seed', 5)); const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const fresh = () => { const L = [78 + rnd() * 8]; for (let i = 1; i < 6; i++) L.push(L[i - 1] - rnd() * 3); return [...L, ...STOPS.map(() => 25 + rnd() * 45), ...STOPS.map(() => (rnd() - 0.5) * 2 * TOL)]; };
  const seeds = Number(arg('--seeds', 3)), gens = Number(arg('--gens', 3000)), NP = 72, found = [];
  for (let n = 0; n < seeds; n++) {
    const pop = Array.from({ length: NP }, fresh), f = pop.map((v) => score(v).aim); let bi = f.indexOf(Math.max(...f));
    for (let g = 0; g < gens; g++) for (let i = 0; i < NP; i++) {
      let a, b, c; do a = Math.floor(rnd() * NP); while (a === i); do b = Math.floor(rnd() * NP); while (b === i || b === a); do c = Math.floor(rnd() * NP); while (c === i || c === a || c === b);
      const F = 0.4 + rnd() * 0.5, CR = 0.5 + rnd() * 0.45, jr = Math.floor(rnd() * 18), toBest = rnd() < 0.3;
      const trial = pop[i].map((x, j) => (rnd() < CR || j === jr ? (toBest ? x + F * (pop[bi][j] - x) + F * (pop[a][j] - pop[b][j]) : pop[a][j] + F * (pop[b][j] - pop[c][j])) : x));
      const ft = score(trial).aim; if (ft >= f[i]) { pop[i] = trial; f[i] = ft; if (ft > f[bi]) bi = i; }
    }
    const s = score(pop[bi]); found.push({ v: pop[bi], aim: f[bi], rows: s.rows.map((r, i) => [r.kn, ...r.row, ALPHA[i]]), cvd: s.cvd, normal: s.normal, viol: s.viol });
    console.log(`\n--- seed ${n}: aim ${f[bi].toFixed(2)}`);
    s.rows.forEach((r, i) => { const c = lchOf(r.row); console.log(`  ${String(r.kn).padStart(2)} kn  L* ${c.L.toFixed(1)}  C* ${c.C.toFixed(1)}  hue ${c.h.toFixed(1)} (field ${fieldHue[i].toFixed(1)})  [${r.row.map((x) => x.toFixed(3)).join(', ')}]`); });
    console.log(`  colour-blind ${s.cvd.de.toFixed(2)} (${s.cvd.pair} kn, ${s.cvd.kind}); normal ${s.normal.de.toFixed(2)} (${s.normal.pair} kn); bar off the field by more than 30 deg at ${s.bent} half-knots (worst ${s.worst.toFixed(1)} deg); lightness rise ${s.rise.toFixed(2)}; off one crest ${s.uni.toFixed(2)}; out of gamut ${s.over.toFixed(4)}; violation ${s.viol.toFixed(3)}`);
  }
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(found.sort((a, b) => b.aim - a.aim), null, 1));
}
