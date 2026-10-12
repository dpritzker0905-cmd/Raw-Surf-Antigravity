#!/usr/bin/env node
// LIGHT PATH, the solve: light's wind field on dark's one-way hue path, in a light key, with the colour-blind floor as a CONSTRAINT.
//
//   node light-path-solve.mjs [--room 65.2] [--tol 6] [--calm 82] [--seeds 8] [--iters 40000] [--json out.json] [--start file.json]
//   node light-path-solve.mjs --score file.json      score a saved candidate (the report only)
//
// WHAT IS SOLVED. The field ON SCREEN over light's muted land, as CIELAB (L*, C*, hue), at the Beaufort stops 0, 3, 6, 10, 16, 21 and
// 27 kn; from 33 kn light keeps the rows it draws today. Between the stops the path is laid a row a knot:
//   hue        a straight line between stops (so it can never turn back between two stops that do not), on to today's 33 kn row;
//   lightness  a straight line between stops; the stops never rise, so no knot does;
//   chroma     a straight line between stops.
// Each row is then the tint that lays that colour (mirror-model.mjs stopFor), and the SAME row over the muted water is what the sea draws.
//
// THE BARS (hard: a candidate that breaks one is not a solution; the numbers are the palette checker's own, LESSONS L-V45):
//   floor      every neighbouring pair of Beaufort stops from 3 kn, over land AND water, >= 5.0 dE2000 for protan, deutan and tritan
//              (light-path-lib.mjs: the checker's models, verified against coloraide);
//   hue        within --tol degrees of dark's at every stop from 3 to 21 kn; never turning back from calm to 33 kn;
//   lightness  never rising with speed, over land and over water;
//   room       from 6 kn up the ground over land is --room L* or deeper (white light needs a ground deeper than itself: D-021);
//   edge       no knot steps further than dark's own steepest over land (8.9 dE00 a knot, by the engine's law);
//   colour     C* >= 18 over land and 15 over water at every knot from 3 kn (no grey on the path);
//   calm       a nameable tint (>= 5 dE00 off the bare ground, both grounds), weaker than 3 kn's, and nearer the map than today's.
// THE AIM, in order: the floor (to 5.2, no credit beyond), then the weakest NORMAL-vision neighbour, then a smooth chroma line.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MODEL, groundOf, sample, strength, tintOver, drawnField } from './mirror-model.mjs';
import { lchOf, rgbOfLch, cvdDE, normalDE } from './light-path-lib.mjs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
export const STOPS = [0, 3, 6, 10, 16, 21, 27], LAST = 33;
const LAND = groundOf('light', 'land'), WATER = groundOf('light', 'water');
// DARK BY THE ENGINE'S LAW (found by the session leading this work, 2026-10-12, read from the code; a GPU read is owed there). HEATMAP_FS
// writes dark's field premultiplied, vec4(fieldRgb * alpha, alpha), and the engine blends it with SRC_ALPHA, ONE_MINUS_SRC_ALPHA: on
// screen it is field x alpha SQUARED + map x (1 - alpha). mirror-model.mjs and check.mjs lay it at alpha, twice as strong from 5 kn,
// so dark is NOT read through them here. (Over land the hue moves 2 to 5 degrees; dark's steepest knot reads 8.9 dE00, not 11.0.)
const DARK_F = drawnField('dark'), DARK_LAND = groundOf('dark', 'land'), DM = MODEL.dark;
const darkAlpha = (kn) => { const t = Math.min(1, Math.max(0, kn / DM.end)); return DM.op * (DM.baseA + (1 - DM.baseA) * t * t * (3 - 2 * t)); };
export const darkOn = (kn) => { const a = darkAlpha(kn), F = sample(DARK_F, kn); return F.map((f, c) => f * a * a + DARK_LAND[c] * (1 - a)); };
export const darkAt = (kn) => lchOf(darkOn(kn));
const TODAY = drawnField('light', { __RAW_DISABLE_WIND_LIGHT_PATH__: true });   // what light drew before its path (its calm, 3 kn and 33 kn rows up are kept)
const todayOn = (kn, bm) => tintOver('light', kn, sample(TODAY, kn), bm);
const T33 = lchOf(todayOn(LAST, LAND));
const arc = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
const lerp = (a, b, t) => a + (b - a) * t;
let DARK_STEEPEST = 0; for (let kn = 1; kn <= 60; kn++) DARK_STEEPEST = Math.max(DARK_STEEPEST, normalDE(darkOn(kn - 1), darkOn(kn)));   // dark's own hardest edge over its land

/** The path a candidate draws: a row a knot from calm to 33 kn. cand = { L: [7], C: [7], dh: [7] } at STOPS (dh: hue offset from dark's; at 27 kn the hue itself is cand.h27). */
export function pathOf(cand) {
  const hStop = STOPS.map((s, i) => (s === 27 ? cand.h27 : darkAt(s).h + cand.dh[i])), rows = [];
  for (let kn = 0; kn <= LAST; kn++) {
    let i = 0; while (i < STOPS.length - 1 && STOPS[i + 1] <= kn) i++;
    const a = STOPS[i], b = i + 1 < STOPS.length ? STOPS[i + 1] : LAST, t = (kn - a) / (b - a);
    const Lb = i + 1 < STOPS.length ? cand.L[i + 1] : T33.L, Cb = i + 1 < STOPS.length ? cand.C[i + 1] : T33.C;
    const L = lerp(cand.L[i], Lb, t), C = lerp(cand.C[i], Cb, t);
    let h;
    h = hStop[i] + arc(hStop[i], i + 1 < STOPS.length ? hStop[i + 1] : T33.h) * t;   // a straight line in hue between stops: one way by construction
    const s = strength('light', kn), want = rgbOfLch(L, C, h);
    const raw = kn === LAST || (cand.keepTo !== undefined && kn <= cand.keepTo) ? sample(TODAY, kn) : want.map((w, c) => 1 - (1 - w / LAND[c]) / s);
    const over = Math.max(0, ...raw.map((x) => Math.max(-x, x - 1)));                       // how far outside what a tint can lay
    const row = raw.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000);      // as it is written in the table
    rows.push({ kn, row, over, land: LAND.map((g, c) => g * (1 - s * (1 - row[c]))), water: WATER.map((g, c) => g * (1 - s * (1 - row[c]))) });
  }
  return rows;
}

/** Every bar and aim of a candidate, as numbers. */
export function score(cand, opts) {
  const o = Object.assign({ room: 65.2, room10: 65.2, room16: 99, calmL: 82, cLand: 18, cWater: 15, calmC: 6, h27: 20, normal: 9.0, floor: 5.0, crest: 99, c6: 0, cmid: 0, calmMax: 99, c16: 0, c21: 0 }, opts || {}), P = pathOf(cand), q = { land: P.map((r) => lchOf(r.land)), water: P.map((r) => lchOf(r.water)) };
  const pairs = [3, 6, 10, 16, 21, 27, 33].map((kn, i, a) => (i ? [a[i - 1], kn] : null)).filter(Boolean);
  let floor = { de: Infinity }, normal = { de: Infinity };
  for (const surf of ['land', 'water']) for (const [a, b] of pairs) {
    const c = cvdDE(P[a][surf], P[b][surf]); if (c.de < floor.de) floor = { de: c.de, pair: `${a}-${b}`, surf, kind: c.kind };
    const n = normalDE(P[a][surf], P[b][surf]); if (n < normal.de) normal = { de: n, pair: `${a}-${b}`, surf };
  }
  const bars = {};
  bars.gamut = Math.max(...P.map((r) => r.over));
  bars.rise = Math.max(0, ...['land', 'water'].flatMap((s) => q[s].slice(1).map((c, i) => c.L - q[s][i].L)));
  let turns = 0, back = 0; for (let k = 1; k <= LAST; k++) { const d = arc(q.land[k - 1].h, q.land[k].h); if (d > 0.5) { turns++; back = Math.max(back, d); } }
  bars.hueBack = back; bars.hueTurns = turns;
  bars.hueGap = Math.max(...[3, 6, 10, 16, 21].map((kn) => Math.abs(arc(darkAt(kn).h, q.land[kn].h))));
  bars.hueGapKnot = Math.max(...P.filter((r) => r.kn >= 3 && r.kn <= 21).map((r) => Math.abs(arc(darkAt(r.kn).h, q.land[r.kn].h))));
  bars.room = Math.max(q.land[6].L - o.room, Math.max(...q.land.filter((c, k) => k >= 10 && k < 16).map((c) => c.L)) - o.room10, Math.max(...q.land.filter((c, k) => k >= 16).map((c) => c.L)) - o.room16);   // 6 kn; 10 to 15 kn; from 16 kn up
  let edge = { de: 0 }; for (const surf of ['land', 'water']) for (let k = 1; k <= LAST; k++) { const d = normalDE(P[k - 1][surf], P[k][surf]); if (d > edge.de) edge = { de: d, kn: k, surf }; }
  bars.edge = edge;
  bars.cLand = Math.min(...q.land.filter((c, k) => k >= 3).map((c) => c.C)); bars.cWater = Math.min(...q.water.filter((c, k) => k >= 3).map((c) => c.C));
  const calm = { land: normalDE(P[0].land, LAND), water: normalDE(P[0].water, WATER) }, three = { land: normalDE(P[3].land, LAND), water: normalDE(P[3].water, WATER) };
  bars.calm = calm; bars.three = three; bars.calmL = q.land[0].L;
  // chroma line over land at the stops and 33 kn: the largest peak or dip a stop makes against BOTH neighbours (a stripe, LESSONS L-V15)
  const cs = [...STOPS, LAST].filter((kn) => cand.keepTo === undefined || kn > cand.keepTo).map((kn) => q.land[kn].C); let stripe = 0;
  for (let i = 1; i < cs.length - 1; i++) { const up = Math.min(cs[i] - cs[i - 1], cs[i] - cs[i + 1]), dn = Math.min(cs[i - 1] - cs[i], cs[i + 1] - cs[i]); stripe = Math.max(stripe, up, dn); }
  bars.stripe = stripe;
  // ONE rise and ONE fall: how far the chroma line is from climbing to a single crest and falling from it (0 = it is; the crest itself is no stripe)
  let uni = Infinity;
  for (let p = 0; p < cs.length; p++) { let v = 0; for (let i = 1; i < cs.length; i++) v += Math.max(0, i <= p ? cs[i - 1] - cs[i] : cs[i] - cs[i - 1]); uni = Math.min(uni, v); }
  bars.unimodal = uni; bars.calmC = q.land[0].C;
  bars.h27gap = Math.abs(arc(darkAt(27).h, q.land[27].h));
  // a rise under 0.02 L* is the table's own rounding (3 decimals)
  const viol = Math.max(0, bars.rise - 0.02) * 40 + Math.max(0, back) + Math.max(0, bars.room) * 2 + Math.max(0, edge.de - DARK_STEEPEST) * 2
    + Math.max(0, o.cLand - bars.cLand) + Math.max(0, o.cWater - bars.cWater) + Math.max(0, 5 - calm.land) * 3 + Math.max(0, 5 - calm.water) * 3
    + Math.max(0, calm.land - three.land + 1) + Math.max(0, calm.water - three.water + 1) + Math.max(0, o.calmL - bars.calmL) * 2
    + (o.nouni ? 0 : uni) + Math.max(0, o.c16 - q.land[16].C) + Math.max(0, o.c21 - q.land[21].C) + Math.max(0, stripe - o.crest) + Math.max(0, o.c6 - q.land[6].C) + Math.max(0, o.cmid - Math.min(...[10, 16, 21, 27].map((kn) => q.land[kn].C))) + Math.max(0, bars.calmL - o.calmMax) + Math.max(0, o.calmC - bars.calmC) * 2 + Math.max(0, bars.h27gap - o.h27) + Math.max(0, o.normal - normal.de) * 3 + Math.max(0, o.floor - floor.de) * 6;
  return { floor, normal, bars, viol, P, q };
}
// --deep: with the floor and the normal-vision distance held as BARS, the aim is the deepest field (the white streak needs a ground deeper
// than itself), weighted to the winds a surf map mostly shows (6 and 10 kn twice 16 and 21, 27 kn half). Ties go to the candidate nearest
// dark's hue, with 3 kn midway between calm and 6 kn in lightness and the smoothest chroma line.
const DEPTH = (arg('--depth', '6:2,10:2,16:1,21:1,27:0.5')).split(',').map((x) => x.split(':').map(Number));
function aim(s, o) {
  if (!o.deep) return Math.min(s.floor.de, o.floorCap) * 10 + Math.min(s.normal.de, 14) * (o.wNormal ?? 1) - s.bars.stripe * (o.wStripe ?? 0.15) - s.viol * 40;
  const L = (kn) => s.q.land[kn].L, C = [...STOPS, LAST].map((kn) => s.q.land[kn].C);
  const depth = DEPTH.reduce((a, [kn, w]) => a + L(kn) * w, 0) / DEPTH.reduce((a, d) => a + d[1], 0);
  let bend = 0; for (let i = 1; i < C.length - 1; i++) bend += Math.abs(C[i - 1] - 2 * C[i] + C[i + 1]);
  const off = [3, 6, 10, 16, 21].reduce((a, kn) => a + Math.abs(arc(darkAt(kn).h, s.q.land[kn].h)), 0);
  return -depth * 2 + Math.min(s.floor.de, o.floor + 0.05) * 4 - Math.abs(L(3) - (L(0) + L(6)) / 2) * 0.1 - bend * 0.004 - off * 0.004 - s.viol * 40;
}

// THE TABLES a candidate draws, as they are written in the app (windLightPath.js): the field's rows and the streaks' colour-core rows.
// Rows up to cand.keepTo and from 33 kn are today's, byte for byte; between them a row a knot.
// A streak's core is the field's own hue at full brightness (its strongest channel 1), as colourful as that hue allows while standing
// 14 L* above the field over the land: the rule light's streak row was built by (WindColorRamp.js LIGHT_LOOK_MARKS).
const ALPHA = [[0, 0.72], [3, 0.75], [6, 0.78], [10, 0.80], [16, 0.82], [21, 0.84], [27, 0.86], [33, 0.87]];
const alphaAt = (kn) => { for (let i = 1; i < ALPHA.length; i++) if (kn <= ALPHA[i][0]) return Math.round((ALPHA[i - 1][1] + (ALPHA[i][1] - ALPHA[i - 1][1]) * (kn - ALPHA[i - 1][0]) / (ALPHA[i][0] - ALPHA[i - 1][0])) * 1000) / 1000; return 0.87; };
let EDGE = null;
/** The most colourful full-brightness colour (strongest channel 1) that has CIELAB hue `h` and stands at L* `minL` or lighter: white mixed into the hexcone's edge, searched (mixing white moves a blue's hue, so the hue is matched AFTER the mix). */
function brightOf(h, minL) {
  if (!EDGE) { EDGE = []; for (let x = 0; x < 360; x += 0.25) { const k = (n) => (n + x / 60) % 6, f = (n) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1)); EDGE.push([f(5), f(3), f(1)]); } }
  let best = null;
  for (let w = 0; w <= 0.98; w += 0.01) for (const e of EDGE) {
    const c = e.map((v) => v + (1 - v) * w), q = lchOf(c);
    if (q.L >= minL && Math.abs(arc(q.h, h)) <= 0.8 && (!best || q.C > best.C)) best = { c, C: q.C };
  }
  return best ? best.c : [1, 1, 1];
}
function emit(cand, s) {
  const keep = cand.keepTo === undefined ? -1 : cand.keepTo, field = [], marks = [];
  for (let kn = 0; kn < LAST; kn++) {
    if (kn <= keep && !STOPS.includes(kn)) continue;                                   // today's rows are stops only
    field.push([kn, ...s.P[kn].row, alphaAt(kn)]);
    if (kn <= keep) continue;                                                           // today's streak rows are kept with them
    const q = s.q.land[kn];
    marks.push([kn, ...brightOf(q.h, q.L + 14).map((x) => Math.round(x * 1000) / 1000), alphaAt(kn)]);
  }
  return { keepTo: keep, from: LAST, field, marks, floor: s.floor, normal: s.normal, bars: s.bars, stops: [...STOPS, LAST].map((kn) => ({ kn, land: s.q.land[kn], water: s.q.water[kn], dark: darkAt(kn).h })) };
}

function report(cand, s) {
  const f1 = (x) => x.toFixed(1).padStart(6);
  console.log('   kn | over land: L*    C*   hue | dark hue  gap | over water: L*   C*   hue | row (r, g, b)');
  for (const kn of [...STOPS, LAST]) console.log(`${String(kn).padStart(5)} |          ${f1(s.q.land[kn].L)}${f1(s.q.land[kn].C)}${f1(s.q.land[kn].h)} | ${f1(darkAt(kn).h)} ${f1(arc(darkAt(kn).h, s.q.land[kn].h))} |          ${f1(s.q.water[kn].L)}${f1(s.q.water[kn].C)}${f1(s.q.water[kn].h)} | ${s.P[kn].row.map((x) => x.toFixed(3)).join(', ')}`);
  console.log(`colour-blind floor ${s.floor.de.toFixed(2)} (${s.floor.pair} kn, ${s.floor.kind}, over ${s.floor.surf}); weakest normal-vision neighbour ${s.normal.de.toFixed(1)} (${s.normal.pair} kn over ${s.normal.surf})`);
  const b = s.bars;
  console.log(`bars: gamut ${b.gamut.toFixed(4)} | lightness rise ${b.rise.toFixed(2)} | hue turns back ${b.hueTurns}x (${b.hueBack.toFixed(1)} deg) | hue gap to dark: stops ${b.hueGap.toFixed(1)}, any knot 3-21 ${b.hueGapKnot.toFixed(1)}`
    + ` | room ${b.room.toFixed(1)} | steepest knot ${b.edge.de.toFixed(1)} (${b.edge.kn - 1}-${b.edge.kn} kn, ${b.edge.surf}) | weakest C* land ${b.cLand.toFixed(1)} water ${b.cWater.toFixed(1)}`
    + ` | calm off the map ${b.calm.land.toFixed(1)} / ${b.calm.water.toFixed(1)} (3 kn ${b.three.land.toFixed(1)} / ${b.three.water.toFixed(1)}), calm L* ${b.calmL.toFixed(1)} C* ${b.calmC.toFixed(1)} | chroma: off one-crest ${b.unimodal.toFixed(2)}, crest prominence ${b.stripe.toFixed(1)} | 27 kn hue gap to dark ${b.h27gap.toFixed(1)} | violation ${s.viol.toFixed(3)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = { room: Number(arg('--room', 65.2)), room10: Number(arg('--room10', 65.2)), room16: Number(arg('--room16', arg('--room10', 65.2))), calmL: Number(arg('--calm', 82)), tol: Number(arg('--tol', 6)), floorCap: Number(arg('--cap', 5.2)), wNormal: Number(arg('--wn', 1)), wStripe: Number(arg('--ws', 0.15)),
    cLand: Number(arg('--cland', 18)), cWater: Number(arg('--cwater', 15)), calmC: Number(arg('--calmc', 6)), h27: Number(arg('--h27', 20)), normal: Number(arg('--normal', 9.0)), floor: Number(arg('--floor', 5.0)), crest: Number(arg('--crest', 99)), c6: Number(arg('--c6', 0)), cmid: Number(arg('--cmid', 0)), calmMax: Number(arg('--calmmax', 99)), deep: args.includes('--deep'), nouni: args.includes('--nouni'), c16: Number(arg('--c16', 0)), c21: Number(arg('--c21', 0)) };
  if (arg('--score')) {
    const file = JSON.parse(fs.readFileSync(arg('--score'), 'utf8')), cand = Array.isArray(file) ? file[0].cand : file, s = score(cand, o);
    report(cand, s);
    if (arg('--emit')) fs.writeFileSync(arg('--emit'), JSON.stringify(emit(cand, s), null, 1));
    process.exit(0);
  }
  let seed = Number(arg('--seed', 7)); const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / 0.7071; };
  // A candidate as a vector: L0, six falls (>= 0), seven C, six dh (+-tol) and the 27 kn hue.
  const keepTo = arg('--keep') !== undefined ? Number(arg('--keep')) : undefined, kept = STOPS.filter((kn) => keepTo !== undefined && kn <= keepTo).map((kn) => lchOf(todayOn(kn, LAND)));
  const toCand = (v) => { const c = toCand0(v); if (keepTo === undefined) return c;
    kept.forEach((q, i) => { c.L[i] = q.L; c.C[i] = q.C; c.dh[i] = arc(darkAt(STOPS[i]).h, q.h); });
    for (let i = kept.length; i < 7; i++) c.L[i] = Math.min(c.L[i], c.L[i - 1]);   // never above the last kept stop
    return Object.assign(c, { keepTo }); };
  const toCand0 = (v) => { const L = [v[0]]; for (let i = 1; i < 7; i++) L.push(L[i - 1] - Math.abs(v[i])); return { L, C: v.slice(7, 14).map((c) => Math.max(2, c)), dh: v.slice(14, 21).map((d) => Math.max(-o.tol, Math.min(o.tol, d))), h27: Math.max(T33.h + 2, Math.min(darkAt(21).h + o.tol, v[21])) }; };
  const startFile = arg('--start') ? JSON.parse(fs.readFileSync(arg('--start'), 'utf8')) : null;
  const fromCand = (c) => [c.L[0], ...c.L.slice(1).map((l, i) => c.L[i] - l), ...c.C, ...c.dh, c.h27];
  const fresh = () => { const L0 = 82 + rnd() * 5, room = Math.min(o.room, 74); const L = [L0, lerp(room + 4, L0 - 2, rnd()), room - rnd() * 2]; for (let i = 3; i < 7; i++) L.push(L[i - 1] - rnd() * 3);
    return fromCand({ L, C: [6 + rnd() * 4, 16 + rnd() * 12, 28 + rnd() * 14, 28 + rnd() * 18, 28 + rnd() * 18, 30 + rnd() * 20, 34 + rnd() * 22], dh: STOPS.map(() => (rnd() - 0.5) * 2 * o.tol), h27: 100 + rnd() * 22 }); };
  const seeds = Number(arg('--seeds', 4)), gens = Number(arg('--gens', 1500)), NP = Number(arg('--pop', 66)), found = [];
  const fit = (v) => aim(score(toCand(v), o), o);
  for (let n = 0; n < seeds; n++) {   // differential evolution (rand/1/bin with a pull to the best): it walks ridges a coordinate climb stalls on
    const pop = Array.from({ length: NP }, (_, i) => (i === 0 && startFile ? fromCand(startFile) : fresh())), f = pop.map(fit);
    let bi = f.indexOf(Math.max(...f));
    for (let g = 0; g < gens; g++) {
      for (let i = 0; i < NP; i++) {
        let a, b, c; do a = Math.floor(rnd() * NP); while (a === i); do b = Math.floor(rnd() * NP); while (b === i || b === a); do c = Math.floor(rnd() * NP); while (c === i || c === a || c === b);
        const F = 0.4 + rnd() * 0.5, CR = 0.5 + rnd() * 0.45, jr = Math.floor(rnd() * pop[i].length), toBest = rnd() < 0.3;
        const trial = pop[i].map((x, j) => (rnd() < CR || j === jr ? (toBest ? x + F * (pop[bi][j] - x) + F * (pop[a][j] - pop[b][j]) : pop[a][j] + F * (pop[b][j] - pop[c][j])) : x));
        const ft = fit(trial);
        if (ft >= f[i]) { pop[i] = trial; f[i] = ft; if (ft > f[bi]) bi = i; }
      }
    }
    const cand = toCand(pop[bi]), s = score(cand, o);
    found.push({ cand, aim: f[bi], floor: s.floor.de, normal: s.normal.de, viol: s.viol });
    console.log(`
--- seed ${n}: aim ${f[bi].toFixed(2)}`); report(cand, s);
  }
  found.sort((a, b) => b.aim - a.aim);
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(found, null, 1));
}
