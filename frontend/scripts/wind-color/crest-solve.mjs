// BEACH CREST SOLVER: searches the colours DRAW_FS mixes for a beach crest (calm -> active at 3 m -> storm at 6 m and up,
// energy = smoothstep(0, 6, h)) so a crest's core stands off the wash under it at EVERY height, for normal vision (a floor) and
// as far as it can for the three dichromats, against each named wave-palette beach table at once (default v2, the owner's pick,
// D-033). Scored with wave-lib.mjs's crestOver/composite, the checker's own model; what it finds is still judged by
// wave-check.mjs (and coloraide) and confirmed in the real engine (scn_wave_palette_ab.js + offline-backend/crest_contrast.py).
//
// Two families:
//  - smooth (default): three colours, one ramp. Every such ramp that holds colour contrast crosses the wash's luminance somewhere
//    (crest lighter at storms, darker at calm), and near 2 m, the commonest sea, its APCA |Lc| falls to 0. Direction of motion is
//    lost at isoluminance (Lindsey & Teller 1990), and a crest is a moving mark.
//  - --polarity: the crest's calm and active colours switch from a DARK pair to a LIGHT pair at a height (DRAW_FS
//    `mix(below, above, step(h, v_wave_height))`), where the wash's luminance passes mid-grey (APCA Y 0.352 on v2: 1.8-2.4 m by zoom
//    and swell lighting). The objective adds the APCA |Lc| soft minimum (whitecap off) and a floor on it (--lc).
// Both keep the crest's own path colourful (C* floor: v1's orchid -> turquoise mix went through a grey cyan) and the top stops
// apart (--stop-de: without it the search lays active = storm, a crest that stops telling 3 m from 6 m).
//
// Usage: node crest-solve.mjs [--palettes v2] [--floor 18] [--path-c 30] [--stop-de 20] [--seed 1] [--gens 700] [--np 60] [--out f]
//   smooth:   [--keep-calm] [--calm-h lo,hi] [--active-h lo,hi] [--storm-h lo,hi] [--calm-l lo,hi] ...   (CIELAB windows; lo > hi wraps)
//   polarity: --polarity [--lc 40] [--lc-w 0.5] [--switch 1.6,2.8] [--dark-l 15,50] [--light-l 72,99] [--dark-h lo,hi] [--light-h lo,hi]
import fs from 'fs';
import { ALPHAS, loadPalettes, composite, crestOver, CRESTS, apcaLc } from './wave-lib.mjs';
import { rgbOfLch, lchOf, labOf, simLab, de2000, KINDS } from './light-path-lib.mjs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PAL = arg('--palettes', 'v2').split(','), FLOOR = Number(arg('--floor', 18)), PATH_C = Number(arg('--path-c', 30));
const STOP_DE = Number(arg('--stop-de', 20)), POLAR = args.includes('--polarity'), LC = Number(arg('--lc', 40)), LC_W = Number(arg('--lc-w', 0.5));
const GENS = Number(arg('--gens', 700)), NP = Number(arg('--np', 60)), KEEP_CALM = args.includes('--keep-calm');
let seed = Number(arg('--seed', 1));
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const win = (k, d) => arg(k, d).split(',').map(Number);
const { WAVE_PALETTES } = loadPalettes();
const FOAM = CRESTS.v1[3];

// Every under-colour the crest can sit on: each palette, the world and coastal alpha (the regional one lies between), the swell
// lighting at half (and off and full in polarity mode, which moves the wash's luminance near the switch), heights 0.2-10 m
// every 0.2 m, plus the above-cap state (a 10 m+ crest is all storm colour there).
const SAMPLES = [];
for (const id of PAL) {
  const P = WAVE_PALETTES[id];
  for (const a of [ALPHAS.world, ALPHAS.coastal]) for (const dir of POLAR ? [0, 0.5, 1] : [0.5]) {
    const hs = []; for (let h = 0.2; h <= P.cap + 1e-9; h += 0.2) hs.push(h);
    for (const h of hs) SAMPLES.push({ id, h, under: composite(P, 'beach', h, a, dir) });
    if (P.over) SAMPLES.push({ id, h: P.cap, under: composite(P, 'beach', P.cap + 1, a, dir), over: true });
  }
}
for (const s of SAMPLES) { s.lab = labOf(s.under); s.sim = KINDS.map((k) => simLab(s.under, k)); }

// Parameters: per colour [L*, C*, hue offset 0..1 inside its window]; polarity adds the switch height last.
const COLOURS = POLAR
  ? [['calm', '--dark-l', '15,50', '--dark-h'], ['active', '--dark-l', '15,50', '--dark-h'], ['calmUp', '--light-l', '72,99', '--light-h'],
    ['activeUp', '--light-l', '72,99', '--light-h'], ['storm', '--light-l', '72,99', '--storm-h']]
  : ['calm', 'active', 'storm'].filter((n) => !(KEEP_CALM && n === 'calm')).map((n) => [n, `--${n}-l`, '25,97', `--${n}-h`]);
const lo = [], hi = [];
for (const [, lk, ld] of COLOURS) { const [l0, l1] = win(lk, ld); lo.push(l0, 20, 0); hi.push(l1, 110, 1); }
if (POLAR) { const [s0, s1] = win('--switch', '1.6,2.8'); lo.push(s0); hi.push(s1); }
const hueOf = (key, t) => { const [a, b] = win(key, '0,360'); const span = b >= a ? b - a : b + 360 - a; return (a + t * span) % 360; };
const two = (c) => c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100);   // the shader's two decimals

function decode(x) {
  const out = {}; let k = 0, excess = 0;
  for (const [n, , , hk] of COLOURS) {
    const c = rgbOfLch(x[k], x[k + 1], hueOf(hk, x[k + 2])); k += 3;
    excess += c.reduce((s, v) => s + Math.max(0, v - 1) + Math.max(0, -v), 0);
    out[n] = two(c);
  }
  if (KEEP_CALM) out.calm = CRESTS.v1[0];
  const sw = POLAR ? Math.round(x[k] * 100) / 100 : null;
  const crest = [out.calm, out.active, out.storm, FOAM, POLAR ? { h: sw, calm: out.calmUp, active: out.activeUp } : undefined];
  return { crest, out, sw, excess };
}

function score(x, report = false) {
  const { crest, out, sw, excess } = decode(x);
  let pen = excess * 300, normal = Infinity, cvd = Infinity, lcMin = Infinity, soft = 0, softLc = 0, where = null, lcAt = null;
  for (const s of SAMPLES) for (const wc of [0, 1]) {
    const o = crestOver('beach', s.h, s.under, wc, crest);
    const n = de2000(labOf(o), s.lab);
    let c = n; for (let i = 0; i < 3; i++) c = Math.min(c, de2000(simLab(o, KINDS[i]), s.sim[i]));
    if (n < normal) normal = n;
    if (c < cvd) { cvd = c; where = { id: s.id, h: s.h, over: s.over, wc }; }
    soft += Math.exp(-c / 0.7);
    if (wc === 0) { const lc = Math.abs(apcaLc(o, s.under)); if (lc < lcMin) { lcMin = lc; lcAt = s.h; } softLc += Math.exp(-lc / 3); }
  }
  // The crest's own path never runs through grey (CIELAB C* of the bare colour, energy 0 -> 1, each side of a switch).
  const e2h = (e) => { let lo2 = 0, hi2 = 6; for (let i = 0; i < 30; i++) { const m = (lo2 + hi2) / 2, t = m / 6; if (t * t * (3 - 2 * t) < e) lo2 = m; else hi2 = m; } return lo2; };
  let pathC = Infinity;
  for (let e = 0; e <= 1.0001; e += 0.025) {
    const up = POLAR && e2h(e) >= sw, calm = up ? out.calmUp : crest[0], active = up ? out.activeUp : crest[1];
    const [p, q, t] = e < 0.5 ? [calm, active, e * 2] : [active, crest[2], e * 2 - 1];
    pathC = Math.min(pathC, lchOf(p.map((v, i) => v + (q[i] - v) * t)).C);
  }
  const activeTop = POLAR ? out.activeUp : crest[1];
  const stops = POLAR ? de2000(labOf(activeTop), labOf(crest[2])) : Math.min(de2000(labOf(crest[0]), labOf(crest[1])), de2000(labOf(crest[1]), labOf(crest[2])));
  pen += Math.max(0, FLOOR - normal) * 6 + Math.max(0, PATH_C - pathC) * 1.5 + Math.max(0, STOP_DE - stops) * 2;
  let f = -0.7 * Math.log(soft) - pen;
  if (POLAR) f += LC_W * -3 * Math.log(softLc) - Math.max(0, LC - lcMin) * 3;
  return report ? { f, normal, cvd, where, lcMin, lcAt, pathC, stops, out, sw } : f;
}

const dim = lo.length, pop = [], fit = [];
for (let k = 0; k < NP; k++) { const x = lo.map((l, i) => l + rand() * (hi[i] - l)); pop.push(x); fit.push(score(x)); }
const show = (r) => `f ${r.f.toFixed(2)} normal ${r.normal.toFixed(1)} colour-blind ${r.cvd.toFixed(1)} (${r.where.id} ${r.where.h.toFixed(1)} m${r.where.over ? ' above cap' : ''}${r.where.wc ? ' whitecap' : ''}) APCA |Lc| ${r.lcMin.toFixed(1)} at ${r.lcAt.toFixed(1)} m path C* ${r.pathC.toFixed(1)} stops ${r.stops.toFixed(1)}${POLAR ? ` switch ${r.sw} m` : ''}`;
for (let g = 0; g < GENS; g++) {
  for (let k = 0; k < NP; k++) {
    let a, b, c; do { a = Math.floor(rand() * NP); } while (a === k); do { b = Math.floor(rand() * NP); } while (b === k || b === a); do { c = Math.floor(rand() * NP); } while (c === k || c === a || c === b);
    const jr = Math.floor(rand() * dim), F = 0.5 + 0.3 * rand();
    const y = pop[k].map((v, j) => (j === jr || rand() < 0.9 ? Math.min(hi[j], Math.max(lo[j], pop[a][j] + F * (pop[b][j] - pop[c][j]))) : v));
    const fy = score(y); if (fy >= fit[k]) { pop[k] = y; fit[k] = fy; }
  }
  if (g % 100 === 0 || g === GENS - 1) console.log(`gen ${g}: ${show(score(pop[fit.indexOf(Math.max(...fit))], true))}`);
}
const best = score(pop[fit.indexOf(Math.max(...fit))], true);
const lch = (c) => { const q = lchOf(c); return `L*${q.L.toFixed(0)} C*${q.C.toFixed(0)} h${q.h.toFixed(0)}`; };
console.log(JSON.stringify({ ...best.out, switchHeight: best.sw }));
console.log(Object.entries(best.out).map(([n, c]) => `${n} ${lch(c)}`).join(' | '));
const outFile = arg('--out', null);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ ...best.out, switchHeight: best.sw, palettes: PAL, normal: best.normal, cvd: best.cvd, lcMin: best.lcMin, pathC: best.pathC, stops: best.stops }, null, 1));
