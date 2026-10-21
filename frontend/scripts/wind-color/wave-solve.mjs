// WAVE PALETTE SOLVER: searches a wave-height table for one theme whose lightness FALLS with height, that never runs through
// grey, and whose neighbouring stops sit as far apart as they can as COMPOSITED over that theme's water (normal vision and the
// three dichromats, light-path-lib.mjs's port of coloraide). Scored with wave-lib.mjs, the checker's own model; every table it
// writes is still read by wave-check.mjs (the authority) and Jest before it ships.
//
// The search: differential evolution over each anchor's CIELAB LCh. Lightness is laid as a top value and per-step falls (so
// the wash's L* falls by construction); hue as a start and per-step turns of 0 to 60 degrees in one direction (so a step never
// crosses grey's side of the hue circle); the above-cap colour is free in hue, at or below the cap's lightness.
// Families (the two candidates the owner A/Bs): A starts pale yellow-green to aqua and ends blue to indigo; B starts pale sky
// and ends magenta to crimson.
//
// Usage: node wave-solve.mjs --theme light|beach --family A|B|V [--heights 0,0.61,1.22,2.44,3.66,6.1,10] [--cap 10]
//                            [--gens 1500] [--np 80] [--seed 1] [--crest-weight 0.7] [--legend-lc 15] [--hend 315,350] [--pin-h i:lo:hi,...] [--turn lo,hi] [--comp-c 14] [--out table.json]   (out: merged into that table's file)
import fs from 'fs';
import { BASEMAP, ALPHAS, washAt, composite, crestOver, oklab, apcaLc, dE, allDE, chromaStar } from './wave-lib.mjs';
import { rgbOfLch, lchOf } from './light-path-lib.mjs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const theme = arg('--theme', 'light'), family = arg('--family', 'A');
const H = arg('--heights', '0,0.61,1.22,2.44,3.66,6.1,10').split(',').map(Number), cap = Number(arg('--cap', H[H.length - 1]));
const GENS = Number(arg('--gens', 1500)), NP = Number(arg('--np', 80)), CREST_W = Number(arg('--crest-weight', 0.7)), LC_FLOOR = Number(arg('--legend-lc', 15)), COMP_C = Number(arg('--comp-c', 14));   // composite C* the search aims to keep: under ~14 a mid-tone reads dusty
let seed = Number(arg('--seed', 1));
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const n = H.length;
// Beach's A starts at aqua, not yellow-green: a yellow or olive sea sits beside its sand land (the solver found that first).
// V (2026-10-20, owner: "the old beach colours in a steadily darkening order"): v1's hue path, aqua -> sand -> orange -> maroon,
// turning the OTHER way round the circle (negative turns), with v2's lightness law.
const FAM = { A: { h0: theme === 'beach' ? [170, 215] : [95, 200], hEnd: [265, 310] }, B: { h0: [200, 255], hEnd: [335, 400] },
  V: { h0: [180, 215], hEnd: [10, 45], turn: [-45, -8] } }[family];
// --hend 315,350: where the hue may end. Light's B ended in red at first, and a red wash with 35% of light's cyan water showing
// through it is its complement: the composite went a muddy grey-mauve (2026-10-20 swatch read).
if (arg('--hend', null)) FAM.hEnd = arg('--hend').split(',').map(Number);
// --pin-h 2:65:85,3:50:70: an anchor's hue window (CIELAB, along the path's unwrapped hue), e.g. a sand that stays sand.
const PIN_H = (arg('--pin-h', '') || '').split(',').filter(Boolean).map((t) => t.split(':').map(Number));
// Bounds of one candidate: [L0, fall x (n-1), C0, chroma step x (n-1), h0, turn x (n-1), overFall, overC, overH].
// SMOOTH BY CONSTRUCTION (2026-10-20): a free chroma per anchor let the search zig-zag (C* 85 -> 14 -> 70 between neighbours) to
// buy colour-blind distance, a pulsing ramp. Falls of 4-16 L*, chroma steps of at most 12, hue turns of 8-45 degrees.
// --turn lo,hi: the per-step hue turn window (CIELAB degrees; V's default -45,-8). Wider turns buy hue distance between neighbours.
const TURN = arg('--turn', null) ? arg('--turn').split(',').map(Number) : (FAM.turn || [8, 45]);
const L0 = arg('--l0', null) ? Number(arg('--l0')) : (theme === 'light' ? 80 : 82);   // --l0: the calm's lowest L* (a lighter calm widens the range)
const lo = [L0, ...Array(n - 1).fill(4), 12, ...Array(n - 1).fill(-12), FAM.h0[0], ...Array(n - 1).fill(TURN[0]), 2, 10, 0];
const hi = [97, ...Array(n - 1).fill(16), 60, ...Array(n - 1).fill(12), FAM.h0[1], ...Array(n - 1).fill(TURN[1]), 18, 80, 360];
const W = BASEMAP[theme], land = W.land.map((v) => v / 255), panel = W.panel.map((v) => v / 255);

function decode(x) {
  let L = x[0], h = x[n * 2];
  const Ls = [L], hs = [h];
  for (let i = 1; i < n; i++) { L -= x[i]; Ls.push(L); h += x[n * 2 + i]; hs.push(h); }
  const Cs = [x[n]]; for (let i = 1; i < n; i++) Cs.push(Math.min(85, Math.max(8, Cs[i - 1] + x[n + i])));
  const gamut = [];
  const rgb = Ls.map((l, i) => { const c = rgbOfLch(l, Cs[i], hs[i] % 360); gamut.push(c); return c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)); });
  const oc = rgbOfLch(Ls[n - 1] - x[3 * n], x[3 * n + 1], x[3 * n + 2]); gamut.push(oc);
  const over = oc.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
  const excess = gamut.flat().reduce((s, v) => s + Math.max(0, v - 1) + Math.max(0, -v), 0);
  return { P: { heights: H, cap, over: { [theme]: over }, [theme]: rgb }, hs, excess };
}

function score(x, report = false) {
  const { P, hs, excess } = decode(x);
  const r = {}; let pen = excess * 200;
  if (!(hs[n - 1] >= FAM.hEnd[0] && hs[n - 1] <= FAM.hEnd[1])) pen += 2 * Math.min(Math.abs(hs[n - 1] - FAM.hEnd[0]), Math.abs(hs[n - 1] - FAM.hEnd[1]));
  for (const [i, lo2, hi2] of PIN_H) { const h = hs[i]; if (h < lo2) pen += 2 * (lo2 - h); else if (h > hi2) pen += 2 * (h - hi2); }   // --pin-h
  // Neighbouring stops, and the above-cap state, as composited (the weakest of normal + three dichromats, every view).
  let adj = Infinity, over = Infinity; const all = [];
  for (const a of Object.values(ALPHAS)) {
    const c = H.map((h) => composite(P, theme, h, a, 0.5, false));   // the stops themselves, not the shader's depth floor under 0.18 m
    for (let i = 0; i + 1 < n; i++) { const d = allDE(c[i], c[i + 1]).de; adj = Math.min(adj, d); all.push(d); }
    const d = allDE(c[n - 1], composite(P, theme, cap + 1, a)).de; over = Math.min(over, d); all.push(d);
  }
  r.adj = adj; r.over = over;
  // Soft minimum (T 0.5): the weakest pair leads, and the next-weakest still pull, so the search has a slope to climb.
  r.soft = -0.5 * Math.log(all.reduce((s, d) => s + Math.exp(-d / 0.5), 0));
  // Lightness falls along the path (the composite at world and coastal alpha, swell lighting off and full; the wash itself).
  let rise = 0, lastW = Infinity;
  for (let h = 0; h <= cap + 1e-9; h += 0.05) { const l = oklab(washAt(P, theme, h)).L; if (l >= lastW) rise += l - lastW + 1e-4; lastW = l; }
  for (const a of [ALPHAS.world, ALPHAS.coastal]) for (const dir of [0, 1]) {
    let last = Infinity;
    for (let h = 0.18; h <= cap + 1e-9; h += 0.05) { const l = oklab(composite(P, theme, h, a, dir)).L; if (l >= last - 2e-4) rise += l - last + 2e-4; last = l; }
  }
  if (oklab(washAt(P, theme, cap + 1)).L > oklab(washAt(P, theme, cap)).L) rise += oklab(washAt(P, theme, cap + 1)).L - oklab(washAt(P, theme, cap)).L;
  r.rise = rise; pen += rise * 3000;
  // No grey (D-019), land against sea, crests against the wash.
  let wC = Infinity, cC = Infinity, ls = Infinity, cr = Infinity, crC = Infinity;
  for (let h = 0; h <= cap + 1e-9; h += 0.1) {
    wC = Math.min(wC, chromaStar(washAt(P, theme, h)));
    for (const a of [ALPHAS.world, ALPHAS.coastal]) {
      const u = composite(P, theme, h, a);
      if (h >= 0.18) cC = Math.min(cC, chromaStar(u));
      ls = Math.min(ls, dE(h < 0.18 ? composite(P, theme, h, a, 0.5, false) : u, land));
      if (h >= 0.2) for (const wc of [0, 1]) { const o = crestOver(theme, h, u, wc); cr = Math.min(cr, dE(o, u)); crC = Math.min(crC, allDE(o, u).de); }
    }
  }
  for (const a of [ALPHAS.world, ALPHAS.coastal]) { const o = composite(P, theme, cap + 1, a); ls = Math.min(ls, dE(o, land)); cC = Math.min(cC, chromaStar(o)); }   // the above-cap state is no grey either
  Object.assign(r, { wC, cC, ls, cr, crC });
  pen += Math.max(0, 15 - wC) * 3 + Math.max(0, COMP_C - cC) * 3 + Math.max(0, 15 - ls) * 2 + Math.max(0, 15 - cr) * CREST_W + Math.max(0, 5 - crC) * CREST_W * 0.5;
  // The legend on its panel: every stop and the arrow at |Lc| >= 15.
  const lcs = [...H.map((h) => washAt(P, theme, h)), washAt(P, theme, cap + 1)].map((c) => Math.abs(apcaLc(c, panel)));
  r.lc = Math.min(...lcs); pen += Math.max(0, LC_FLOOR - r.lc) * 1.5;
  // The cap no darker than L* 22 (a near-black storm sea read as a hole in the map), the above-cap state no darker than 10.
  const capL = lchOf(washAt(P, theme, cap)).L, overL = lchOf(washAt(P, theme, cap + 1)).L;
  pen += Math.max(0, 22 - capL) + Math.max(0, 10 - overL);
  r.f = r.soft - pen;
  return report ? { ...r, P } : r.f;
}

// Differential evolution (rand/1/bin).
const dim = lo.length, pop = [], fit = [];
for (let k = 0; k < NP; k++) { const x = lo.map((l, i) => l + rand() * (hi[i] - l)); pop.push(x); fit.push(score(x)); }
for (let g = 0; g < GENS; g++) {
  for (let k = 0; k < NP; k++) {
    let a, b, c; do { a = Math.floor(rand() * NP); } while (a === k); do { b = Math.floor(rand() * NP); } while (b === k || b === a); do { c = Math.floor(rand() * NP); } while (c === k || c === a || c === b);
    const jr = Math.floor(rand() * dim), F = 0.5 + 0.3 * rand();
    const y = pop[k].map((v, j) => (j === jr || rand() < 0.9 ? Math.min(hi[j], Math.max(lo[j], pop[a][j] + F * (pop[b][j] - pop[c][j]))) : v));
    const fy = score(y); if (fy >= fit[k]) { pop[k] = y; fit[k] = fy; }
  }
  if (g % 250 === 0 || g === GENS - 1) { const best = fit.indexOf(Math.max(...fit)); const r = score(pop[best], true); console.log(`gen ${g}: f ${r.f.toFixed(2)} adj ${r.adj.toFixed(1)} over ${r.over.toFixed(1)} rise ${r.rise.toFixed(4)} washC ${r.wC.toFixed(1)} compC ${r.cC.toFixed(1)} land ${r.ls.toFixed(1)} crest ${r.cr.toFixed(1)}/${r.crC.toFixed(1)} legendLc ${r.lc.toFixed(1)}`); }
}
const best = score(pop[fit.indexOf(Math.max(...fit))], true);
console.log(JSON.stringify({ [theme]: best.P[theme], over: best.P.over[theme] }));
console.log('L*/C*/h by anchor:', best.P[theme].map((c) => { const q = lchOf(c.map((v) => v / 255)); return `${q.L.toFixed(0)}/${q.C.toFixed(0)}/${q.h.toFixed(0)}`; }).join('  '), ' over', (() => { const q = lchOf(best.P.over[theme].map((v) => v / 255)); return `${q.L.toFixed(0)}/${q.C.toFixed(0)}/${q.h.toFixed(0)}`; })());
const out = arg('--out', null);
if (out) {
  const t = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { heights: H, cap, over: {} };
  t.heights = H; t.cap = cap; t[theme] = best.P[theme]; t.over = { ...(t.over || {}), [theme]: best.P.over[theme] };
  fs.writeFileSync(out, JSON.stringify(t, null, 1));
}
