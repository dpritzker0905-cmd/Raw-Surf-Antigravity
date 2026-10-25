#!/usr/bin/env node
// light-margin-solve.mjs — light's wind field with its colour-blind line held AS DRAWN, by the smallest move (2026-10-12).
//
// WHY. Over the deeper land that PR #320 lays under the wind (D-026) light's field has no margin: the palette checker reads the
// weakest pair of neighbouring Beaufort stops at 5.0 (5.006) on the TABLE, and through the 256-texel, 8-bit texture the engine
// uploads (`check.mjs --as-uploaded 10-80:0.25`: the GPU's own lookup, 256 t - 0.5) at 4.85 over land and 4.93 over the sea, under
// 5.0 at 123 and 32 of the 281 maxima the engine can pick. The owner took PR #318 as filmed with that pinned, and asked for the
// re-solve next (D-024, amended 2026-10-12 17:43Z; ledger commitment "light's wind field re-solved on PR #320's deeper land").
//
// WHAT IT DOES. It moves the on-screen colour of light's field by a small step at each Beaufort stop from 3 to 63 kn (a step in
// CIELAB over the deeper land, blended linearly along speed between stops, nothing at calm and at 75 kn), writes the rows as the
// app would hold them (3 decimals), and looks for the SMALLEST largest move a knot that
//   (1) holds every bar PR #318 was built on, HARD (each is re-read on the candidate's own rows and printed: LESSONS L-V69), and
//   (2) lifts every pair's colour-blind distance ON THE TABLE to that pair's own target, over the deeper land and over the sea.
// The targets start at --target (5.0 plus the room the 8-bit rounding eats). After each solve the candidate is read AS DRAWN at
// every maximum of the sweep; a pair still under --floor at some maximum has its target raised by what it lacks, and the solve
// runs again from where it stood. It stops when nothing is under the floor as drawn, or after --rounds.
//
//   node light-margin-solve.mjs --audit [--merged | --rows cand.json]   every pair: the table, and as drawn (the least over the maxima, and where);
//                                                                    with no flag, the rows the app draws; --merged, the path as PR #318 merged it
//   node light-margin-solve.mjs --solve [--seed 1] [--out cand.json] [--floor 5.0] [--target 5.12] [--rounds 8] [--sum]
//        --sum     the aim is the least TOTAL move, not the least largest move (what a cap on the largest move buys is the difference)
//        --land-l 0.90   the land the line is held over (the app's lever; default: what the checkout draws). The sea is always held.
//        --maxmove 1.2   never move a knot further than this (dE00 on screen over the land); the solve says so if it cannot hold the floor inside it
//   node light-margin-solve.mjs --bars --rows cand.json             only PR #318's bars, re-read on a candidate
//
// The instruments are the app's own sources (the ramp, the hue path, the texture fill, the basemap mute) and light-path-lib.mjs
// (the checker's colour-blind distance in plain JS). `check.mjs --as-uploaded` stays the authority: every table is run through it.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { labOf, lchOf, rgbOfLab, cvdDE, normalDE, de2000 } from './light-path-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), MAP = path.join(HERE, '..', '..', 'src', 'components', 'map');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] !== undefined && !String(args[i + 1]).startsWith('--') ? args[i + 1] : d; };
const source = (file) => fs.readFileSync(path.join(MAP, file), 'utf8').replace(/^import [^\n]*$/gm, '').replace(/^export /gm, '');
const D = new Function(source('windDarkRules.js') + '; return { DARK_RULES, DARK_WHITE, WHITE_STREAK, solveDarkRules };')();
const M = new Function(fs.readFileSync(path.join(MAP, 'windBasemapMute.js'), 'utf8').replace(/^export /gm, '') + '; return { muteColor, windBasemapMuteAmount, windBasemapWaterL, windBasemapLandL, windLandWhite, setWindLandDepthGate };')();
const LP = new Function(source('windLightPath.js') + '; return { LIGHT_PATH, lightTables };')();
const BP = new Function(source('windBeachPath.js') + '; return { BEACH_PATH, beachPathRows };')();
const R = new Function('DARK_RULES', 'DARK_WHITE', 'WHITE_STREAK', 'solveDarkRules', 'windLandWhite', 'setWindLandDepthGate', 'BEACH_PATH', 'beachPathRows', 'LIGHT_PATH', 'lightTables',
  source('WindColorRamp.js') + '; return { huePathStops, resolveDrawnField, resolveDrawnMarks, resolveLegendRamp, resolveThemeRamp, generateRampData, sampleRamp };')(
  D.DARK_RULES, D.DARK_WHITE, D.WHITE_STREAK, D.solveDarkRules, M.windLandWhite, M.setWindLandDepthGate, BP.BEACH_PATH, BP.beachPathRows, LP.LIGHT_PATH, LP.lightTables);

// ── the picture: light's multiply tint over its muted grounds (check.mjs MODEL.light) ──
const STOPS = [3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75];
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const strength = (kn) => Math.min(1, 0.65 * (0.42 + 0.58 * ss(0, 7, kn)) * (0.70 / 0.65));
const SURF = { land: [236, 236, 232], water: [168, 214, 222] };
const groundOf = (surface, win = {}) => { const c = SURF[surface];
  const m = /rgba\((\d+), (\d+), (\d+)/.exec(M.muteColor(`rgb(${c.join(', ')})`, M.windBasemapMuteAmount('light', win), surface === 'water' ? M.windBasemapWaterL('light', win) : M.windBasemapLandL('light', win)));
  return [+m[1], +m[2], +m[3]].map((v) => v / 255); };
// --land-l X: the land the solve holds the line over, named through the app's own lever (its lightness under the wind is the map lane's: 0.81 with
// PR #320, 0.90 a step above the sea). Without it, whatever the checkout draws by default.
const LAND_WIN = arg('--land-l') ? { __RAW_WIND_BASEMAP_LAND_L__: Number(arg('--land-l')) } : {};
const G = { land: groundOf('land', LAND_WIN), water: groundOf('water'), pale: groundOf('land', { __RAW_DISABLE_WIND_LAND_DEPTH__: true }) };   // pale: the land before PR #320, which PR #318's bars were read on
const tint = (g, F, kn) => { const s = strength(kn); return [g[0] * (1 - s * (1 - F[0])), g[1] * (1 - s * (1 - F[1])), g[2] * (1 - s * (1 - F[2]))]; };
/** The field colour that puts `screen` on the ground `g` at `kn` (the tint, inverted), clamped to what a texture can hold. */
const fieldFor = (g, screen, kn) => { const s = strength(kn); return screen.map((v, c) => Math.min(1, Math.max(0, 1 - (1 - v / g[c]) / s))); };
const r3 = (v) => Math.round(v * 1000) / 1000;

// The rows the margin is moved FROM: light's field as PR #318 merged it (calm, the path's 1 to 32 kn, the rows kept from 33 kn), written
// out of dev f6310516 before the margin became what the app draws (`--dump-merged` wrote the file; its texture hashes are pinned in
// windLightPath.test.js). BUILT is what the checkout draws now.
const BUILT = R.resolveDrawnField('light', {}).map((r) => r.slice());
const MERGED_FILE = path.join(HERE, 'light-path-318.json');
if (args.includes('--dump-merged')) { if (fs.existsSync(MERGED_FILE)) { console.error('refused: ' + MERGED_FILE + ' exists. It holds the field PR #318 merged; this checkout draws the margin, so writing it now would replace the reference with the rows moved from it.'); process.exit(1); }
  fs.writeFileSync(MERGED_FILE, JSON.stringify({ note: 'light\u2019s wind field as PR #318 merged it (dev f6310516, before the margin): rows of [kn, r, g, b, a]', field: BUILT }) + '\n'); console.log('written: ' + MERGED_FILE); process.exit(0); }
const BASE = JSON.parse(fs.readFileSync(MERGED_FILE, 'utf8')).field;
const tableOf = (rows) => { const T = R.huePathStops(rows, {}); return (kn) => R.sampleRamp(T, kn); };
/** As the GPU draws it at `max`: the 8-bit texture generateRampData fills, looked up at 256 t - 0.5 (lut-lookup-gpu.cjs read the law back). */
const drawnOf = (rows, max) => { const d = R.generateRampData(max, rows, null, {});
  return (kn) => { const t0 = Math.min(1, kn / max), x = Math.min(255, Math.max(0, t0 * 256 - 0.5)), i = Math.min(254, Math.floor(x)), t = x - i; return [0, 1, 2].map((c) => (d[i * 4 + c] + (d[(i + 1) * 4 + c] - d[i * 4 + c]) * t) / 255); }; };
const MAXIMA = (() => { const [range, step] = String(arg('--maxima', '10-80:0.25')).split(':'), [a, b] = range.split('-').map(Number), out = []; for (let x = a; x <= b + 1e-9; x += Number(step)) out.push(Math.round(x * 1000) / 1000); return out; })();
const PAIRS = STOPS.slice(1).map((b, i) => [STOPS[i], b]);
const GROUNDS = ['land', 'water'];

/** Every pair over land and sea: its colour-blind distance on the table, and as drawn (the least over the maxima where both stops are drawn). */
function audit(rows, drawn = true) {
  const at = tableOf(rows), out = {};
  for (const surface of GROUNDS) {
    const g = G[surface];
    out[surface] = PAIRS.map(([a, b]) => { const d = cvdDE(tint(g, at(a), a), tint(g, at(b), b)); return { pair: a + '-' + b, a, b, table: d.de, kind: d.kind, drawn: Infinity, at: null, under: 0, n: 0 }; });
  }
  if (drawn) for (const max of MAXIMA) { const up = drawnOf(rows, max);
    for (const surface of GROUNDS) { const g = G[surface], cols = {}; for (const kn of STOPS) if (kn <= max) cols[kn] = tint(g, up(kn), kn);
      for (const p of out[surface]) if (p.b <= max) { const d = cvdDE(cols[p.a], cols[p.b]).de; p.n++; if (d < 5) p.under++; if (d < p.drawn) { p.drawn = d; p.at = max; } } } }
  return out;
}
const lineOf = (au, surface, key) => au[surface].reduce((w, p) => (p[key] < w[key] ? p : w));
const underAt = (rows, floor) => { const n = { land: 0, water: 0 }; for (const max of MAXIMA) { const up = drawnOf(rows, max);
  for (const surface of GROUNDS) { const g = G[surface]; let w = Infinity; for (const [a, b] of PAIRS) if (b <= max) w = Math.min(w, cvdDE(tint(g, up(a), a), tint(g, up(b), b)).de); if (w < floor) n[surface]++; } } return n; };

// ── PR #318's bars, as its tests read them (windLightPath.test.js): the land of those tests is the land before PR #320 ──
const DARK = R.huePathStops(R.resolveThemeRamp('dark'), {}), DARK_LAND = [18, 20, 26].map((v) => v / 255);
const darkOn = (kn) => { const a = 0.48 * (0.44 + 0.56 * ss(0, 5, kn)), F = R.sampleRamp(DARK, kn); return DARK_LAND.map((g, i) => F[i] * a * a + g * (1 - a)); };
const arc = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
const reversals = (colourAt, to = 60) => { let prev = null, dir = 0, turns = 0;
  for (let kn = 0; kn <= to; kn++) { const q = lchOf(colourAt(kn)); if (q.C < 8) continue; if (prev !== null) { const d = arc(prev, q.h), s = Math.abs(d) > 4 ? Math.sign(d) : 0; if (s && dir && s !== dir) turns++; if (s) dir = s; } prev = q.h; }
  return turns; };
const LEGEND = R.huePathStops(R.resolveLegendRamp('light', {}), {});
function bars(rows) {
  const at = tableOf(rows), on = (surface) => (kn) => tint(G[surface], at(kn), kn), b = {};
  b.turnsBack = Math.max(reversals(on('pale')), reversals(on('land')), reversals(on('water')));                                   // 0: the hue runs one way, calm to 60 kn
  b.hueGapToDark = Math.max(...[3, 6, 10, 16, 21].map((kn) => Math.abs(arc(lchOf(darkOn(kn)).h, lchOf(on('pale')(kn)).h))));       // <= 20.2 at the stops 3 to 21 kn
  let rise = -Infinity, edge = 0; for (const s of ['pale', 'land', 'water']) for (let kn = 1; kn <= 60; kn++) { const p = on(s)(kn - 1), q = on(s)(kn);
    if (kn <= 33) rise = Math.max(rise, lchOf(q).L - lchOf(p).L); edge = Math.max(edge, normalDE(p, q)); }
  b.lightnessRise = rise;                                                                                                         // <= 0.05: lightness never rises, calm to 33 kn
  b.hardestEdge = edge;                                                                                                           // <= 7.95 dE00 a knot (dark's own is 8.9)
  const L = (kn) => lchOf(on('pale')(kn)).L;
  b.upper = [Math.min(L(6), L(7), L(8), L(9), L(10)), Math.max(L(6), L(7), L(8), L(9), L(10))];                                    // the upper level: 6 to 10 kn, L* 64.8 to 65.3
  b.lower = [Math.min(...Array.from({ length: 12 }, (_, i) => L(16 + i))), Math.max(...Array.from({ length: 12 }, (_, i) => L(16 + i)))];   // the lower level: 16 to 27 kn, L* 59.9 to 60.3
  b.normal = Math.min(...['pale', 'land', 'water'].map((s) => Math.min(...PAIRS.map(([p, q]) => normalDE(on(s)(p), on(s)(q))))));  // >= 7.9: the weakest normal-vision neighbours
  let cmin = Infinity; for (const s of ['land', 'water']) for (let kn = 3; kn <= 40; kn += 0.5) cmin = Math.min(cmin, lchOf(on(s)(kn)).C);
  b.weakestColour = cmin;                                                                                                         // >= 8 C*: no grey veil from 3 to 40 kn
  let bar = 0; for (const s of ['land', 'water']) for (let kn = 3; kn <= 40; kn += 0.5) { const f = lchOf(on(s)(kn)), l = lchOf(R.sampleRamp(LEGEND, kn).slice(0, 3)); if (f.C >= 8) bar = Math.max(bar, Math.abs(arc(l.h, f.h))); }
  b.offTheLegend = bar;                                                                                                           // <= 30 degrees: the bar (not moved) still names the field
  const marks = R.resolveDrawnMarks('light', {}).land; let core = 0; for (const r of marks) if (r[0] >= 1 && r[0] <= 32) core = Math.max(core, Math.abs(arc(lchOf(on('pale')(r[0])).h, lchOf(r.slice(1, 4)).h)));
  b.coreOffField = core;                                                                                                          // < 3 degrees: each streak's colour core (not moved) still follows the field
  return b;
}
const BARS0 = bars(BASE);
/** How far a candidate is outside PR #318's bars (0 = every bar held). The two levels and the edge are held to what dev draws, not looser. */
const barsBroken = (b) => b.turnsBack * 10 + Math.max(0, b.hueGapToDark - 20.2) + Math.max(0, b.lightnessRise - Math.max(0.05, BARS0.lightnessRise)) * 20 + Math.max(0, b.hardestEdge - 7.95)
  + Math.max(0, 64.8 - b.upper[0]) * 5 + Math.max(0, b.upper[1] - 65.3) * 5 + Math.max(0, 59.9 - b.lower[0]) * 5 + Math.max(0, b.lower[1] - 60.3) * 5
  + Math.max(0, 7.9 - b.normal) * 5 + Math.max(0, 8 - b.weakestColour) + Math.max(0, b.offTheLegend - 30) + Math.max(0, b.coreOffField - 2.95) * 3;
const printBars = (b) => { const f = (v) => (Array.isArray(v) ? v.map((x) => x.toFixed(2)).join(' to ') : (+v).toFixed(2));
  const want = { turnsBack: '0', hueGapToDark: '<= 20.2 deg', lightnessRise: '<= 0.05 L*', hardestEdge: '<= 7.95 dE00', upper: '64.8 to 65.3 (6-10 kn)', lower: '59.9 to 60.3 (16-27 kn)', normal: '>= 7.9 dE00', weakestColour: '>= 8 C*', offTheLegend: '<= 30 deg', coreOffField: '< 3 deg' };
  for (const k of Object.keys(want)) console.log(`   ${k.padEnd(14)} ${f(b[k]).padStart(14)}   on dev ${f(BARS0[k]).padStart(14)}   bar ${want[k]}`); console.log(`   outside the bars by ${barsBroken(b).toFixed(4)}`); };

// ── the candidate: a step in CIELAB on screen over the deeper land at each control stop, blended along speed ──
const CTRL = [3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];
const SCREEN0 = BASE.map((r) => tint(G.land, r.slice(1, 4), r[0])), LAB0 = SCREEN0.map(labOf);
function rowsOf(x) {
  const step = (kn) => { if (kn <= 0 || kn >= 75) return [0, 0, 0]; const pts = [[0, [0, 0, 0]], ...CTRL.map((k, i) => [k, x.slice(i * 3, i * 3 + 3)]), [75, [0, 0, 0]]];
    for (let i = 1; i < pts.length; i++) if (kn <= pts[i][0]) { const t = (kn - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return [0, 1, 2].map((c) => pts[i - 1][1][c] + (pts[i][1][c] - pts[i - 1][1][c]) * t); } return [0, 0, 0]; };
  return BASE.map((r, i) => { const d = step(r[0]); if (!d[0] && !d[1] && !d[2]) return r.slice(); const scr = rgbOfLab(LAB0[i][0] + d[0], LAB0[i][1] + d[1], LAB0[i][2] + d[2]); return [r[0], ...fieldFor(G.land, scr, r[0]).map(r3), r[4]]; });
}
/** How far each row moved on screen (dE00), over land and over sea: the largest and the sum. */
function moved(rows) { let max = 0, where = 0, sum = 0; const per = {};
  rows.forEach((r, i) => { const d = Math.max(normalDE(tint(G.land, r.slice(1, 4), r[0]), SCREEN0[i]), normalDE(tint(G.water, r.slice(1, 4), r[0]), tint(G.water, BASE[i].slice(1, 4), r[0]))); per[r[0]] = d; sum += d; if (d > max) { max = d; where = r[0]; } });
  // over the land and over the sea apart, at every half knot along the drawn path (between the rows too)
  const at = tableOf(rows), was = tableOf(BASE), apart = (g) => { let w = 0, k = 0; for (let kn = 0; kn <= 75; kn += 0.5) { const d = normalDE(tint(g, at(kn), kn), tint(g, was(kn), kn)); if (d > w) { w = d; k = kn; } } return [w, k]; };
  return { max, where, sum, per, land: apart(G.land), sea: apart(G.water) }; }

function solve() {
  const floor = Number(arg('--floor', 5.0)), rounds = Number(arg('--rounds', 8)), SUM = args.includes('--sum'), maxmove = Number(arg('--maxmove', 99));
  let seed = Number(arg('--seed', 1)); const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // Each pair's own target on the table: the floor plus what the 8-bit rounding takes from THAT pair on dev's rows (0.06 to 0.26), so a
  // pair that already clears the floor as drawn may give some of its room up, and none is lifted further than it needs. --target T: one target for all.
  const au0 = audit(BASE), own = (surface) => au0[surface].map((p) => (arg('--target') ? Number(arg('--target')) : floor + (p.table - p.drawn) + 0.005));
  const target = { land: own('land'), water: own('water') };
  const N = CTRL.length * 3, B = Number(arg('--bound', 2.5));
  const score = (x) => { const rows = rowsOf(x), at = tableOf(rows); let short = 0;
    for (const surface of GROUNDS) { const g = G[surface]; PAIRS.forEach(([a, b], i) => { const d = cvdDE(tint(g, at(a), a), tint(g, at(b), b)).de; if (d < target[surface][i]) short += target[surface][i] - d; }); }
    const mv = moved(rows), out = barsBroken(bars(rows)) + Math.max(0, mv.max - maxmove) * 5;
    return { cost: (short + out) * 1000 + (SUM ? mv.sum : mv.max) + (SUM ? mv.max : mv.sum) * 0.002, short, out, mv, rows }; };
  let best = new Array(N).fill(0), bestS = score(best);
  for (let round = 1; round <= rounds; round++) {
    // differential evolution from where the last round stood: a small population around it
    const NP = 60, pop = Array.from({ length: NP }, (_, k) => (k === 0 ? best.slice() : best.map((v) => Math.max(-B, Math.min(B, v + (rnd() - 0.5) * 0.6))))), sc = pop.map(score);
    for (let gen = 0; gen < Number(arg('--gens', 500)); gen++) for (let k = 0; k < NP; k++) {
      let a, b, c; do a = Math.floor(rnd() * NP); while (a === k); do b = Math.floor(rnd() * NP); while (b === k || b === a); do c = Math.floor(rnd() * NP); while (c === k || c === a || c === b);
      const jr = Math.floor(rnd() * N), trial = pop[k].map((v, j) => (rnd() < 0.5 || j === jr ? Math.max(-B, Math.min(B, pop[a][j] + 0.6 * (pop[b][j] - pop[c][j]))) : v)), s = score(trial);
      if (s.cost <= sc[k].cost) { pop[k] = trial; sc[k] = s; } }
    const w = sc.reduce((m, s, k) => (s.cost < sc[m].cost ? k : m), 0); best = pop[w]; bestS = sc[w];
    const au = audit(bestS.rows), low = { land: lineOf(au, 'land', 'drawn'), water: lineOf(au, 'water', 'drawn') };
    console.log(`round ${round}: short of the targets ${bestS.short.toFixed(4)}, outside the bars ${bestS.out.toFixed(4)}; largest move ${bestS.mv.max.toFixed(3)} dE00 at ${bestS.mv.where} kn, total ${bestS.mv.sum.toFixed(2)}; as drawn: land ${low.land.drawn.toFixed(3)} (${low.land.pair} at ${low.land.at}), sea ${low.water.drawn.toFixed(3)} (${low.water.pair} at ${low.water.at})`);
    let raised = 0; for (const surface of GROUNDS) au[surface].forEach((p, i) => { if (p.drawn < floor) { target[surface][i] = Math.max(target[surface][i], p.table) + (floor - p.drawn) + 0.01; raised++; } });
    if (!raised && bestS.short < 1e-9 && bestS.out < 1e-9) break;
  }
  return bestS.rows;
}

const show = (rows, title) => { const au = audit(rows), mv = moved(rows);
  console.log(`\n=== ${title}`);
  for (const surface of GROUNDS) { console.log(` over the ${surface === 'water' ? 'sea' : 'land (as the checkout draws it, or --land-l)'}:   pair      table   as drawn (least; at which maximum; under 5.0 at n maxima)`);
    for (const p of au[surface]) console.log(`    ${p.pair.padEnd(6)} kn  ${p.table.toFixed(3)}   ${p.drawn.toFixed(3)}  at ${String(p.at).padStart(5)} kn   ${String(p.under).padStart(3)} of ${p.n}`); }
  const n = underAt(rows, 5), lt = { land: lineOf(au, 'land', 'table'), water: lineOf(au, 'water', 'table') }, ld = { land: lineOf(au, 'land', 'drawn'), water: lineOf(au, 'water', 'drawn') }, at50 = audit50(rows);
  console.log(` THE LINE   land: table ${lt.land.table.toFixed(3)} (${lt.land.pair}), as drawn ${ld.land.drawn.toFixed(3)} (${ld.land.pair} at ${ld.land.at} kn), at a 50 kn maximum ${at50.land.toFixed(3)}; under 5.0 at ${n.land} of ${MAXIMA.length} maxima`);
  console.log(`            sea:  table ${lt.water.table.toFixed(3)} (${lt.water.pair}), as drawn ${ld.water.drawn.toFixed(3)} (${ld.water.pair} at ${ld.water.at} kn), at a 50 kn maximum ${at50.water.toFixed(3)}; under 5.0 at ${n.water} of ${MAXIMA.length} maxima`);
  for (const [name, win] of [['the sea\'s depth (x 0.81: PR #320, the land step\'s kill)', { __RAW_DISABLE_WIND_LAND_STEP__: true }], ['a step above the sea (x 0.90: the default)', {}], ['the mute\'s own (x 1: before PR #320)', { __RAW_DISABLE_WIND_LAND_DEPTH__: true }]]) {
    const g = groundOf('land', win), at = tableOf(rows); let least = Infinity, under = 0, table = Infinity;
    for (const [a, b] of PAIRS) table = Math.min(table, cvdDE(tint(g, at(a), a), tint(g, at(b), b)).de);
    for (const max of MAXIMA) { const up = drawnOf(rows, max); let w = Infinity; for (const [a, b] of PAIRS) if (b <= max) w = Math.min(w, cvdDE(tint(g, up(a), a), tint(g, up(b), b)).de); if (w < 5) under++; least = Math.min(least, w); }
    console.log(`   the land at ${name}: table ${table.toFixed(3)}, as drawn ${least.toFixed(3)}, under 5.0 at ${under} of ${MAXIMA.length} maxima`); }
  console.log(` moved, between the rows too: over the land ${mv.land[0].toFixed(3)} dE00 at the most (${mv.land[1]} kn), over the sea ${mv.sea[0].toFixed(3)} (${mv.sea[1]} kn)`);
  console.log(` moved: the largest ${mv.max.toFixed(3)} dE00 at ${mv.where} kn; total ${mv.sum.toFixed(2)}; at 6, 10, 16, 21, 27, 33, 40, 55 kn: ${[6, 10, 16, 21, 27, 33, 40, 55].map((k) => (mv.per[k] || 0).toFixed(2)).join(', ')}`);
  const fnv = (d) => { let h = 2166136261; for (const v of d) h = Math.imul(h ^ v, 16777619); return (h >>> 0).toString(16); };
  console.log(` field hashes (FNV-1a of the texture the engine uploads): ${fnv(R.generateRampData(50, rows, null, {}))} at a 50 kn maximum, ${fnv(R.generateRampData(75, rows, null, {}))} at 75 kn`);
  console.log(' PR #318\'s bars, re-read on these rows:'); printBars(bars(rows)); };
function audit50(rows) { const up = drawnOf(rows, 50), out = {}; for (const surface of GROUNDS) { let w = Infinity; for (const [a, b] of PAIRS) if (b <= 50) w = Math.min(w, cvdDE(tint(G[surface], up(a), a), tint(G[surface], up(b), b)).de); out[surface] = w; } return out; }

// --audit reads the rows the app draws (windLightPath.js LIGHT_PATH.field), so what was solved and what is built are read by one instrument;
// --merged reads the path as PR #318 merged it; --rows a candidate file.
const given = arg('--rows') ? JSON.parse(fs.readFileSync(arg('--rows'), 'utf8')).field : (args.includes('--merged') ? BASE : BUILT);
if (args.includes('--solve')) { const rows = solve(); show(rows, 'the candidate'); if (arg('--out')) { fs.writeFileSync(arg('--out'), JSON.stringify({ field: rows }, null, 0)); console.log('\nwritten: ' + arg('--out')); } }
else if (args.includes('--bars')) { console.log('PR #318\'s bars:'); printBars(bars(given)); }
else show(given, arg('--rows') ? 'the candidate in ' + arg('--rows') : (args.includes('--merged') ? 'the path as PR #318 merged it (before the margin)' : 'light as the app draws it (the margin)'));
