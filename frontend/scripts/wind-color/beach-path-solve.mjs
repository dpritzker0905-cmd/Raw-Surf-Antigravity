#!/usr/bin/env node
// BEACH PATH, the solve: beach's wind field with its LIGHTNESS running one way with speed, in beach's own hues, with the colour-blind
// floor as a CONSTRAINT (LESSONS L-V45: a floor read afterwards is a floor lost).
//
//   node beach-path-solve.mjs --audit                         beach as drawn before its path: per knot, per pair, every bar
//   node beach-path-solve.mjs [--mono 0-21,29-75] [--tol 8] [--free 10,16,21,33,55,75] [--ceil 62] [--cgreen 25] [--aim least|colour|deep] [--seeds 4] [--json out.json]
//   node beach-path-solve.mjs --score file.json [--emit rows.json]
// The bands decouple at every kept stop, so the three faults are solved apart and joined: --pairs 27-33,33-40 scores those pairs only,
// --start file --vary 10,16 moves those stops and takes the other --free stops from the file, --lockl 27 holds a stop's lightness.
//
// WHAT IS SOLVED. The field ON SCREEN over beach's muted land, as CIELAB (L*, C*, hue), at the 13 Beaufort stops. A stop that is not
// --free keeps what beach draws today; a span between two kept stops keeps today's rows byte for byte. Every other span is laid a row a
// knot as TODAY'S own colour at that knot moved by what its two stops moved (lightness, chroma and hue, a straight line between the
// stops), so the shape beach draws between its stops is kept and no knot moves further than its stops did. Each row is the tint that
// lays that colour over the land (the same row over the muted water is what the sea draws).
//
// THE BARS (hard; the numbers are the palette checker's own):
//   floor      every neighbouring pair of Beaufort stops from 3 kn, over land AND water, >= --floor (5.0) dE2000 for protan, deutan and
//              tritan (light-path-lib.mjs: the checker's models, verified against coloraide);
//   one way    lightness never rises with speed over each --mono range (calm to 21 kn; 0-21,29-75 adds the storm side), knot by knot,
//              over land and over water;
//   own hues   every stop within --tol degrees (CIELAB hue, over land) of the hue beach draws there today, and beach's ORDER kept: to
//              the aqua at 6 kn, and from there one way round the wheel, never sitting more than --turn degrees behind where a slower
//              knot had reached;
//   gale       --ceilgale: no ground from 22 to 46 kn lighter than that over land (the pale band under a ceiling);
//   room       --ceil: no ground from 6 to 21 kn lighter than that over land (white light needs a ground deeper than itself: D-020's
//              ceiling for beach is L* 62);
//   edge       no knot steps further than dark's own steepest (by the engine's law: its field lands at alpha squared over its map);
//   colour     no changed knot from 3 kn weaker than --cmin C* over land or water (the checker's grey veil is 8), and the chroma line
//              over land no further from one rise and one fall than today's (--stripec; no new chroma stripe);
//              --cgreen: the 10 to 21 kn band keeps at least that much C* over land (deep under a multiply tint means grey);
//   tint       from 6 kn the field sits at least 14 dE00 off the bare ground (the checker's tint line);
//   gamut      every row is a tint the app can lay (0 to 1).
// THE AIM, in order: the floor (to --cap, no credit beyond), then the LEAST change from what beach draws today (the owner: "beach can
// use improvement, just a little milder"), then no new chroma stripe and the weakest normal-vision neighbour.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MODEL, groundOf, groundAt, sample, strength, tintOver, drawnField } from './mirror-model.mjs';
import { lchOf, rgbOfLch, cvdDE, normalDE, de2000, simLab, KINDS } from './light-path-lib.mjs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
export const THEME = 'beach', STOPS = [0, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75], TOP = 75;
// --land-l 0.85: solve and read over a DEEPER land (the land's lightness times that factor in the basemap mute, as PR #320 lays it).
// --ref built: the reference a candidate is held to is what beach draws NOW (its path), not what it drew before it.
export const LAND = arg('--land-l') ? groundAt(THEME, 'land', Number(arg('--land-l'))) : groundOf(THEME, 'land'), WATER = groundOf(THEME, 'water');
/** The reference field: beach BEFORE its path (windDarkRules.js solveDarkRules: the dusk factor and the name guard), or with --ref built, on it. A row a knot, 0 to 75 kn. */
export const TODAY = drawnField(THEME, arg('--ref') === 'built' ? {} : { __RAW_DISABLE_WIND_BEACH_PATH__: true });
const todayRow = (kn) => sample(TODAY, kn);
export const on = (row, kn, bm) => tintOver(THEME, kn, row, bm);
export const TODAY_LCH = STOPS.map((kn) => lchOf(on(todayRow(kn), kn, LAND)));
const TODAY_KNOT = Array.from({ length: TOP + 1 }, (_, kn) => lchOf(on(todayRow(kn), kn, LAND)));
const arc = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
const lerp = (a, b, t) => a + (b - a) * t;
// The spans laid on straight lines between their stops (the band the solve levels: a line between two stops that do not rise cannot rise).
// Every other span that moves keeps today's shape (the eased climb to the gale band, the storm side) and adds what its stops moved.
const STRAIGHT = arg('--straight', '6-10,10-16,16-21').split(',').filter(Boolean);

// Dark by the ENGINE's law (WebGLWindShaders.js HEATMAP_FS writes vec4(fieldRgb * alpha, alpha), blended SRC_ALPHA, ONE_MINUS_SRC_ALPHA:
// on screen field x alpha squared + map x (1 - alpha)). mirror-model.mjs lays it at alpha; dark's own steepest knot is read here.
const DARK_F = drawnField('dark'), DM = MODEL.dark;
const darkAlpha = (kn) => { const t = Math.min(1, Math.max(0, kn / DM.end)); return DM.op * (DM.baseA + (1 - DM.baseA) * t * t * (3 - 2 * t)); };
export const darkOn = (kn, surf) => { const a = darkAlpha(kn), F = sample(DARK_F, kn), g = groundOf('dark', surf); return F.map((f, c) => f * a * a + g[c] * (1 - a)); };
export let DARK_STEEPEST = 0; for (const surf of ['land', 'water']) for (let kn = 1; kn <= 60; kn++) DARK_STEEPEST = Math.max(DARK_STEEPEST, normalDE(darkOn(kn - 1, surf), darkOn(kn, surf)));

/** The rows a candidate draws, calm to 75 kn. cand = { free: [stop indices], L: [13], C: [13], h: [13] } (the land's colour at each stop). */
export function pathOf(cand) {
  const isFree = STOPS.map((_, i) => cand.free.includes(i)), rows = [];
  for (let kn = 0; kn <= TOP; kn++) {
    let i = 0; while (i < STOPS.length - 2 && STOPS[i + 1] <= kn) i++;
    const a = STOPS[i], b = STOPS[i + 1], t = (kn - a) / (b - a), at = kn === TOP ? STOPS.length - 1 : (t === 0 ? i : -1);
    const kept = at >= 0 ? !isFree[at] : (!isFree[i] && !isFree[i + 1]);                    // a kept stop, or a knot between two kept stops
    let raw;
    if (kept) raw = todayRow(kn);
    else {   // today's own colour at this knot, moved by what its two stops moved (a straight line between them): the shape between stops is kept
      const j = kn === TOP ? STOPS.length - 1 : i, k = kn === TOP ? STOPS.length - 1 : i + 1, tt = kn === TOP ? 0 : t, was = TODAY_KNOT[kn];
      const dL = lerp(cand.L[j] - TODAY_LCH[j].L, cand.L[k] - TODAY_LCH[k].L, tt), dC = lerp(cand.C[j] - TODAY_LCH[j].C, cand.C[k] - TODAY_LCH[k].C, tt), dh = lerp(arc(TODAY_LCH[j].h, cand.h[j]), arc(TODAY_LCH[k].h, cand.h[k]), tt);
      const line = (cand.straight || STRAIGHT).includes(`${STOPS[j]}-${STOPS[k]}`);   // a candidate file may name its own (cand.straight)
      const want = line ? rgbOfLch(lerp(cand.L[j], cand.L[k], tt), lerp(cand.C[j], cand.C[k], tt), cand.h[j] + arc(cand.h[j], cand.h[k]) * tt) : rgbOfLch(was.L + dL, Math.max(0, was.C + dC), was.h + dh), s = strength(THEME, kn);
      raw = want.map((w, c) => 1 - (1 - w / LAND[c]) / s);
    }
    const over = kept ? 0 : Math.max(0, ...raw.map((x) => Math.max(-x, x - 1)));            // how far outside what a tint can lay
    const row = kept ? raw.slice(0, 3) : raw.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000);   // as it is written in the table
    rows.push({ kn, kept, row, over, land: on(row, kn, LAND), water: on(row, kn, WATER) });
  }
  return rows;
}

const PAIRS = STOPS.slice(2).map((kn, i) => [STOPS[i + 1], kn]);   // 3-6 ... 63-75
/** Every bar and aim of a set of rows (pathOf's, or today's), as numbers. */
export function measure(P, o) {
  const q = { land: P.map((r) => lchOf(r.land)), water: P.map((r) => lchOf(r.water)) }, m = { pairs: [] };
  m.floor = { de: Infinity }; m.normal = { de: Infinity };
  for (const [a, b] of PAIRS) {
    const rec = { pair: `${a}-${b}` };
    for (const surf of ['land', 'water']) {
      const c = cvdDE(P[a][surf], P[b][surf]), n = normalDE(P[a][surf], P[b][surf]);
      rec[surf] = { normal: n, cvd: c.de, kind: c.kind, each: KINDS.map((k) => de2000(simLab(P[a][surf], k), simLab(P[b][surf], k))) };
      if (o.pairs && !o.pairs.includes(rec.pair)) continue;   // --pairs: a sub-problem (the bands decouple at every kept stop)
      if (c.de < m.floor.de) m.floor = { de: c.de, pair: rec.pair, surf, kind: c.kind };
      if (n < m.normal.de) m.normal = { de: n, pair: rec.pair, surf };
    }
    m.pairs.push(rec);
  }
  // ONE WAY, over each range asked (--mono 0-21,29-75): the steepest rise in one knot, and the whole climb back (how far any faster
  // knot sits above the darkest slower one in its range; 0 = one way)
  m.rise = 0; m.riseAt = null; m.climb = 0;
  for (const [from, to] of o.mono) for (const surf of ['land', 'water']) {
    let lo = Infinity;
    for (let k = from; k <= to; k++) {
      if (k > from) { const d = q[surf][k].L - q[surf][k - 1].L; if (d > m.rise) { m.rise = d; m.riseAt = `${k - 1}-${k} kn over ${surf}`; } }
      lo = Math.min(lo, q[surf][k].L); m.climb = Math.max(m.climb, q[surf][k].L - lo);
    }
  }
  // BEACH'S OWN ORDER: its hue runs to the aqua at 6 kn and from there one way round the wheel (dark's order). The WHOLE turn back: how far
  // any knot's hue sits behind the furthest a slower knot had reached (a slow reversal between two stops passes a knot-by-knot bar).
  m.hueBack = 0; m.hueBackAt = null;
  for (const [from, to, sign] of [[0, 6, 1], [6, TOP, -1]]) { let far = 0, run = 0;   // run: the hue's travel from `from`, in the way it should go
    for (let k = from + 1; k <= to; k++) { run += arc(q.land[k - 1].h, q.land[k].h) * sign; far = Math.max(far, run); if (far - run > m.hueBack) { m.hueBack = far - run; m.hueBackAt = `by ${k} kn`; } } }
  m.edge = { de: 0 }; for (const surf of ['land', 'water']) for (let k = 1; k <= TOP; k++) { const d = normalDE(P[k - 1][surf], P[k][surf]); if (d > m.edge.de) m.edge = { de: d, kn: k, surf }; }
  m.gamut = Math.max(...P.map((r) => r.over || 0));
  m.cMin = { land: Infinity, water: Infinity }; for (const surf of ['land', 'water']) for (let k = 3; k <= 40; k++) m.cMin[surf] = Math.min(m.cMin[surf], q[surf][k].C);
  m.tint = { land: Infinity, water: Infinity }; for (const [surf, g] of [['land', LAND], ['water', WATER]]) for (let k = 6; k <= 40; k++) m.tint[surf] = Math.min(m.tint[surf], normalDE(P[k][surf], g));
  // STRIPES at the Beaufort stops over land (LESSONS L-V15). Lightness: how far a stop stands above or below BOTH its neighbours.
  // Chroma: how far the line is from ONE rise to ONE crest and one fall (0 = it is; the crest itself is no stripe).
  const stripe = (v) => { let w = 0, at = null; for (let i = 1; i < v.length - 1; i++) { const p = Math.max(Math.min(v[i] - v[i - 1], v[i] - v[i + 1]), Math.min(v[i - 1] - v[i], v[i + 1] - v[i])); if (p > w) { w = p; at = STOPS[i]; } } return { by: w, at }; };
  const offCrest = (v) => { let best = Infinity; for (let p = 0; p < v.length; p++) { let t = 0; for (let i = 1; i < v.length; i++) t += Math.max(0, i <= p ? v[i - 1] - v[i] : v[i] - v[i - 1]); best = Math.min(best, t); } return best; };
  m.stripeL = stripe(STOPS.map((kn) => q.land[kn].L)); m.stripeC = { by: offCrest(STOPS.map((kn) => q.land[kn].C)), at: null };
  m.q = q;
  return m;
}
const TODAY_P = Array.from({ length: TOP + 1 }, (_, kn) => ({ kn, kept: true, row: todayRow(kn).slice(0, 3), over: 0, land: on(todayRow(kn), kn, LAND), water: on(todayRow(kn), kn, WATER) }));
/** What beach draws today, measured by the same bars (its chroma line's own unevenness is the bar a candidate may not exceed). */
export const TODAY_M = measure(TODAY_P, { mono: [[0, 21]] });

export function score(cand, opts) {
  const o = Object.assign({ mono: [[0, 21]], tol: 8, floor: 5.0, cap: 5.1, cmin: 12, edge: DARK_STEEPEST, stripeC: TODAY_M.stripeC.by + 0.05, ceil: 99, cgreen: 0, aim: 'least', turn: 0.6 }, opts || {}), P = pathOf(cand), m = measure(P, o);
  // how far the candidate moved from today, over land and water, at the stops (the "milder" in the owner's words) and at its worst knot
  let dev = 0, devMax = 0; for (const kn of STOPS) for (const surf of ['land', 'water']) dev += normalDE(P[kn][surf], TODAY_P[kn][surf]);
  for (let kn = 0; kn <= TOP; kn++) devMax = Math.max(devMax, normalDE(P[kn].land, TODAY_P[kn].land));
  const hueOff = Math.max(0, ...cand.free.map((i) => Math.abs(arc(TODAY_LCH[i].h, m.q.land[STOPS[i]].h)))), changed = P.filter((r) => !r.kept && r.kn >= 3 && r.kn <= 40);
  const cLow = changed.length ? Math.min(...changed.map((r) => Math.min(lchOf(r.land).C, lchOf(r.water).C))) : 99;
  const cGreen = Math.min(...m.q.land.slice(10, 22).map((c) => c.C)), top = Math.max(...m.q.land.slice(6, 22).map((c) => c.L));   // the 10-21 kn band's weakest colour; the lightest everyday ground
  // --ceilgale: no ground from 22 to 46 kn lighter than that over land (the pale gale band brought under a ceiling, not to one-way).
  // flat: how far apart the lightest and the deepest ground sit from 6 to 40 kn over land (dark's own, by the engine's law, is 7.4).
  const gale = Math.max(...m.q.land.slice(22, 47).map((c) => c.L)), span = m.q.land.slice(6, 41).map((c) => c.L), flat = Math.max(...span) - Math.min(...span);
  const viol = Math.max(0, m.rise - 0.05) * 6 + m.climb * 2 + Math.max(0, hueOff - o.tol) + Math.max(0, m.hueBack - o.turn) * 2 + Math.max(0, m.edge.de - o.edge) * 2 + Math.max(0, o.cmin - cLow)
    + Math.max(0, 14 - m.tint.land) + Math.max(0, 14 - m.tint.water) + m.gamut * 60 + Math.max(0, o.floor - m.floor.de) * 6 + Math.max(0, m.stripeC.by - o.stripeC) + Math.max(0, top - o.ceil) * 2 + Math.max(0, o.cgreen - cGreen) + Math.max(0, gale - (o.ceilGale || 99)) * 2;
  // THE STREAK'S GROUND: how far the everyday ground (6 to 21 kn, over land) is LIFTED above what beach draws today, at its worst knot.
  // A white streak stands on its ground, so a lifted ground is lift lost (the owner, of light: "give the streaks their ground back").
  let lift = 0; for (let kn = 6; kn <= 21; kn++) lift = Math.max(lift, m.q.land[kn].L - TODAY_KNOT[kn].L);
  // --aim least: the floor, then the least change from today. --aim colour: the floor, then the most colour the 10-21 kn band can keep.
  // --aim deep: the floor, then the least lift of the streak's ground (the frontier against the hue tolerance).
  const aim = Math.min(m.floor.de, o.cap) * 10 - viol * 40 + (o.aim === 'colour' ? cGreen * 0.5 - dev * 0.01 : o.aim === 'deep' ? -lift * 1.2 - dev * 0.01 : -dev * 0.12) + Math.min(m.normal.de, 9) * 0.05;
  return { m, P, dev, devMax, hueOff, viol, cGreen, top, lift, gale, flat, aim };
}

const f1 = (x) => x.toFixed(1).padStart(6);
function report(P, m, title) {
  console.log(`\n=== ${title}`);
  console.log('   kn | over land: L*    C*   hue | over water: L*    C*   hue | today, land: L*    C*   hue | moved (dE00, land) | row (r, g, b)');
  for (const kn of STOPS) { const a = m.q.land[kn], w = m.q.water[kn], t = lchOf(TODAY_P[kn].land);
    console.log(`${String(kn).padStart(5)} |          ${f1(a.L)}${f1(a.C)}${f1(a.h)} |           ${f1(w.L)}${f1(w.C)}${f1(w.h)} |            ${f1(t.L)}${f1(t.C)}${f1(t.h)} | ${f1(normalDE(P[kn].land, TODAY_P[kn].land))}${P[kn].kept ? ' kept ' : '      '}      | ${P[kn].row.map((x) => x.toFixed(3)).join(', ')}`); }
  console.log('  pair | land: normal | protan deutan tritan | water: normal | protan deutan tritan');
  for (const r of m.pairs) console.log(`${r.pair.padStart(6)} |       ${f1(r.land.normal)} | ${r.land.each.map(f1).join(' ')} |        ${f1(r.water.normal)} | ${r.water.each.map(f1).join(' ')}${Math.min(r.land.cvd, r.water.cvd) < 5 ? '   <-- under 5' : ''}`);
  console.log(`colour-blind floor ${m.floor.de.toFixed(2)} (${m.floor.pair} kn, ${m.floor.kind}, over ${m.floor.surf}); weakest normal-vision neighbour ${m.normal.de.toFixed(1)} (${m.normal.pair} kn over ${m.normal.surf})`);
  console.log(`lightness: steepest rise in one knot ${m.rise.toFixed(2)}${m.riseAt ? ' (' + m.riseAt + ')' : ''}, whole climb back ${m.climb.toFixed(1)} L* | hue's whole turn back ${m.hueBack.toFixed(1)} deg${m.hueBackAt ? ' (' + m.hueBackAt + ')' : ''} | steepest knot ${m.edge.de.toFixed(1)} dE00 (${m.edge.kn - 1}-${m.edge.kn} kn, ${m.edge.surf}; dark's own ${DARK_STEEPEST.toFixed(1)})`
    + ` | weakest C* 3-40 kn: land ${m.cMin.land.toFixed(1)} water ${m.cMin.water.toFixed(1)} | weakest tint 6-40 kn off the map: land ${m.tint.land.toFixed(1)} water ${m.tint.water.toFixed(1)}`
    + ` | stripes at the stops over land: lightness ${m.stripeL.by.toFixed(1)}${m.stripeL.at !== null ? ' at ' + m.stripeL.at + ' kn' : ''}; chroma off one crest by ${m.stripeC.by.toFixed(1)} (today ${TODAY_M.stripeC.by.toFixed(1)}) | gamut ${m.gamut.toFixed(4)}`);
}
/** The rows a candidate writes into the app (windBeachPath.js): [kn, r, g, b] for every knot it changes. */
export function emit(cand, s) {
  return { free: cand.free.map((i) => STOPS[i]), rows: s.P.filter((r) => !r.kept).map((r) => [r.kn, ...r.row]), floor: s.m.floor, normal: s.m.normal, dev: s.dev, hueOff: s.hueOff,
    stops: STOPS.map((kn) => ({ kn, land: s.m.q.land[kn], water: s.m.q.water[kn], today: lchOf(TODAY_P[kn].land) })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = { mono: arg('--mono', '0-21').split(',').map((r) => r.split('-').map(Number)), tol: Number(arg('--tol', 8)), floor: Number(arg('--floor', 5.0)), cap: Number(arg('--cap', 5.1)), cmin: Number(arg('--cmin', 12)),
    ...(arg('--stripec') !== undefined ? { stripeC: Number(arg('--stripec')) } : {}), ceil: Number(arg('--ceil', 99)), cgreen: Number(arg('--cgreen', 0)), ceilGale: Number(arg('--ceilgale', 99)), aim: arg('--aim', 'least'), turn: Number(arg('--turn', 0.6)), ...(arg('--edge') !== undefined ? { edge: Number(arg('--edge')) } : {}), ...(arg('--pairs') ? { pairs: arg('--pairs').split(',') } : {}) };
  if (args.includes('--audit')) { report(TODAY_P, measure(TODAY_P, o), `BEACH as drawn before its path (one way asked over ${arg('--mono', '0-21')} kn)`); process.exit(0); }
  if (arg('--score')) {
    const file = JSON.parse(fs.readFileSync(arg('--score'), 'utf8')), cand = Array.isArray(file) ? file[0].cand : file, s = score(cand, o);
    report(s.P, s.m, `candidate (free: ${cand.free.map((i) => STOPS[i]).join(', ')} kn) | moved ${s.dev.toFixed(1)} dE00 summed over the stops and both grounds, worst knot ${s.devMax.toFixed(1)}; hue off today's by at most ${s.hueOff.toFixed(1)} deg | 10-21 kn weakest C* ${s.cGreen.toFixed(1)}, lightest 6-21 kn ground L* ${s.top.toFixed(1)}, the 6-21 kn ground lifted by at most ${s.lift.toFixed(1)} L* over today, the 6-40 kn ground spans ${s.flat.toFixed(1)} L* (dark's 7.4) | violation ${s.viol.toFixed(3)}`);
    if (arg('--emit')) fs.writeFileSync(arg('--emit'), JSON.stringify(emit(cand, s), null, 1));
    process.exit(0);
  }
  // --free: the stops that leave today's rows. --vary: the ones the search moves (default: all of them; the rest take --start's values).
  // --lockl: stops whose lightness stays today's (their hue and chroma may move).
  const idx = (list) => list.split(',').map((kn) => STOPS.indexOf(Number(kn))).filter((i) => i >= 0);
  const free = idx(arg('--free', '10,16,21')), vary = arg('--vary') ? idx(arg('--vary')) : free, lockL = arg('--lockl') ? idx(arg('--lockl')) : [];
  let seed = Number(arg('--seed', 7)); const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // A candidate as a vector: (L, C, hue offset from today's) for each free stop.
  const startFile = arg('--start') ? JSON.parse(fs.readFileSync(arg('--start'), 'utf8')) : null, start = startFile ? (Array.isArray(startFile) ? startFile[0].cand : startFile) : null;
  const base = () => ({ free, L: STOPS.map((_, i) => (start && free.includes(i) && start.free.includes(i) ? start.L[i] : TODAY_LCH[i].L)), C: STOPS.map((_, i) => (start && free.includes(i) && start.free.includes(i) ? start.C[i] : TODAY_LCH[i].C)),
    h: STOPS.map((_, i) => (start && free.includes(i) && start.free.includes(i) ? start.h[i] : TODAY_LCH[i].h)) });
  const toCand = (v) => { const c = base();
    vary.forEach((i, n) => { c.L[i] = lockL.includes(i) ? TODAY_LCH[i].L : Math.max(30, Math.min(86, v[n * 3])); c.C[i] = Math.max(2, v[n * 3 + 1]); c.h[i] = TODAY_LCH[i].h + Math.max(-o.tol, Math.min(o.tol, v[n * 3 + 2])); });
    return c; };
  const fromCand = (c) => vary.flatMap((i) => [c.L[i], c.C[i], arc(TODAY_LCH[i].h, c.h[i])]);
  const fresh = () => vary.flatMap((i) => [TODAY_LCH[i].L + (rnd() - 0.5) * 16, Math.max(4, TODAY_LCH[i].C + (rnd() - 0.5) * 16), (rnd() - 0.5) * 2 * o.tol]);
  const seeds = Number(arg('--seeds', 4)), gens = Number(arg('--gens', 1200)), NP = Number(arg('--pop', Math.max(40, vary.length * 12))), found = [];
  const fit = (v) => score(toCand(v), o).aim;
  for (let n = 0; n < seeds; n++) {   // differential evolution (rand/1/bin with a pull to the best): it walks ridges a coordinate climb stalls on
    const pop = Array.from({ length: NP }, (_, i) => (i === 0 && start && vary.every((j) => start.free.includes(j)) ? fromCand(start) : fresh())), f = pop.map(fit);
    let bi = f.indexOf(Math.max(...f));
    for (let g = 0; g < gens; g++) for (let i = 0; i < NP; i++) {
      let a, b, c; do a = Math.floor(rnd() * NP); while (a === i); do b = Math.floor(rnd() * NP); while (b === i || b === a); do c = Math.floor(rnd() * NP); while (c === i || c === a || c === b);
      const F = 0.4 + rnd() * 0.5, CR = 0.5 + rnd() * 0.45, jr = Math.floor(rnd() * pop[i].length), toBest = rnd() < 0.3;
      const trial = pop[i].map((x, j) => (rnd() < CR || j === jr ? (toBest ? x + F * (pop[bi][j] - x) + F * (pop[a][j] - pop[b][j]) : pop[a][j] + F * (pop[b][j] - pop[c][j])) : x));
      const ft = fit(trial);
      if (ft >= f[i]) { pop[i] = trial; f[i] = ft; if (ft > f[bi]) bi = i; }
    }
    const cand = toCand(pop[bi]), s = score(cand, o);
    found.push({ cand, aim: f[bi], floor: s.m.floor.de, normal: s.m.normal.de, dev: s.dev, viol: s.viol, cGreen: s.cGreen, top: s.top, lift: s.lift });
    if (!args.includes('--quiet')) report(s.P, s.m, `seed ${n}: aim ${f[bi].toFixed(2)} | free ${free.map((i) => STOPS[i]).join(', ')} kn | moved ${s.dev.toFixed(1)} (worst knot ${s.devMax.toFixed(1)}), hue off by at most ${s.hueOff.toFixed(1)} deg | violation ${s.viol.toFixed(3)}`);
    else console.log(`seed ${n}: floor ${s.m.floor.de.toFixed(2)} (${s.m.floor.pair} ${s.m.floor.kind} ${s.m.floor.surf}) normal ${s.m.normal.de.toFixed(1)} moved ${s.dev.toFixed(1)} (worst knot ${s.devMax.toFixed(1)}) | 10-21 kn weakest C* ${s.cGreen.toFixed(1)} | lightest 6-21 kn ground ${s.top.toFixed(1)} | ground lifted by at most ${s.lift.toFixed(1)} L* | 6-40 kn ground spans ${s.flat.toFixed(1)} L* | violation ${s.viol.toFixed(3)}`);
  }
  found.sort((a, b) => b.aim - a.aim);
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(found, null, 1));
}
