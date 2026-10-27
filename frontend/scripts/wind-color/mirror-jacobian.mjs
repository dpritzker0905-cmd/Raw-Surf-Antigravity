#!/usr/bin/env node
// MIRROR JACOBIAN: the whole picture as ONE function, and how each thing we can turn moves each thing the eye gets.
//
//   node mirror-jacobian.mjs                 the tables below
//   node mirror-jacobian.mjs --json out.json
//   node mirror-jacobian.mjs --before-step   (or --before-depth, --before-path: mirror-model.mjs's levers, a kill's picture)
//
// The owner, 2026-10-12: "the map needs to be taken into account... use the jacobian lens to help see everything as a whole. To not
// miss any clues." Three lanes had each tuned ONE input against ONE output at a few scenes, and each found its number did not hold in
// another scene (D-022 land against sea; LESSONS L-V50 a breeze against a storm; D-023 one zoom against another). This prints the
// matrix those were entries of, from the app's own tables and composite laws (mirror-model.mjs; no GPU, no map load):
//
//   OUTPUTS, per theme, ground and knot   G     the ground under the wind: the field over the (muted) map, L*
//                                         step  how far a piled-up white streak stands off that ground, L* (mirror-run.js's `step` column)
//                                         room  100 - G: all a white streak can ever add
//   INPUTS                                w     the white strength laid over that ground, as the app lays it with the map muted and the land step on
//                                               (mirror-model.mjs winOf). Dark's own is 0.505 (zooms 4 to 9; the engine lays 0.48 outside them).
//                                               Below 5.5 kn the app also dims the mark (D-030, windCalmAir.js): `w` at 3 kn is not all that is laid
//                                         op    the field's strength law (how hard the tint is laid on the map)
//                                         map   the basemap ground's own lightness (the style, the mute)
//                                         v     the wind's speed (the scene: nobody turns it, and dark's target moves with it)
//
// DARK IS THE TARGET, AND IT MOVES: dark's step is read at the same knot over the same kind of ground. For each (ground, knot):
//   w*    the white strength at which the theme's step equals dark's (null: no white reaches it, the ground is too pale)
//   G*    where w* is null, how deep the ground would have to be for FULL white to step as far as dark's does: the map's own term
// The model is the pile-up of one white trail (ground mixed `w` of the way to white). It is not the bench's `lift` (which is cover
// times the trail's whole profile, and since D-029 the veil under it): the bench stays the authority for the moving picture
// (scripts/wind-bench: ground-run.js, anatomy-run.js). Read this for the SIGN and the SIZE of each lever, not for a level.
// "THE MODEL'S GROUND AGAINST THE BENCH" at the end says how far each ground here is from the one the GPU drew (LESSONS L-V60 rule 2).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MODEL, groundOf, sample, strength, drawnField, lch, ramps, tintOver, winOf } from './mirror-model.mjs';

const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf(k), v = i >= 0 ? args[i + 1] : null; return v && !v.startsWith('--') ? v : null; };
const DARK_OWN = 0.505, THEMES = ['light', 'beach'], GROUNDS = ['land', 'water'];
// DARK'S LAND IS THE REAL MAP'S, NOT mirror-model.mjs's: MODEL.dark.surfaces.land is the wind bench's OFFLINE land (L* 6), and under the
// wind it reads 11 L* darker than the GPU drew over the real basemap (worst 14.5), which overstates dark's step over land. The basemap's
// own land as drawn at zoom 6 is [58, 71, 79], L* 29 (ground-run.js, 2026-10-12: [54, 68, 74] at zoom 4, [66, 77, 92] at zoom 9). Dark's
// sea in the model is the real one ([93, 117, 126], as read).
const DARK_LAND = [58, 71, 79].map((x) => x / 255);
const mapOf = (theme, surf) => (theme === 'dark' && surf === 'land' ? DARK_LAND : groundOf(theme, surf));
const L = (a) => lch(a).L, wisp = (g, w) => g.map((x) => x + (1 - x) * w), step = (g, w) => L(wisp(g, w)) - L(g);
/** The ground under the wind: the theme's field at `kn` over its map ground, with the field's strength scaled by `opK` and the map's own colour by `mapK`. */
function ground(theme, surf, kn, opK = 1, mapK = 1) {
  const m = MODEL[theme], bm = mapOf(theme, surf).map((x) => Math.min(1, x * mapK)), c = sample(drawnField(theme), kn), s = Math.min(1, strength(theme, kn) * opK);
  // DARK'S LAW IS THE ENGINE'S, NOT mirror-model.mjs's: HEATMAP_FS returns the field premultiplied (rgb * alpha, alpha) and the engine
  // blends it SRC_ALPHA, ONE_MINUS_SRC_ALPHA, so the field lands at alpha SQUARED over a map dimmed by (1 - alpha) (the law of
  // windDarkRules.js darkGround). mirror-model.mjs and check.mjs lay it at alpha (`kind: 'over'`), which reads dark's sea 20 L* too light (LESSONS L-V60).
  return m.kind === 'multiply' ? bm.map((x, i) => x * (1 - s * (1 - c[i]))) : bm.map((x, i) => c[i] * s * s + x * (1 - s));
}
const drawnW = (theme, surf) => (theme === 'dark' ? DARK_OWN : ramps.windWhiteStrength(theme, winOf(theme))[surf === 'water' ? 'sea' : 'land']);
// One ground, two writers: with no lever turned, light's and beach's ground here must be the colour model's own (tintOver), to the last bit.
for (const theme of THEMES) for (const surf of GROUNDS) for (const kn of [3, 16, 47]) { const a = ground(theme, surf, kn), b = tintOver(theme, kn, sample(drawnField(theme), kn), groundOf(theme, surf));
  if (a.some((x, i) => Math.abs(x - b[i]) > 1e-12)) throw new Error(`mirror-jacobian: ${theme} over ${surf} at ${kn} kn is not the colour model's ground`); }
/** The strength at which a white streak steps `target` L* off `g` (bisection; null when even full white falls short). */
function solveW(g, target) { if (step(g, 1) < target) return null; let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (step(g, mid) < target) lo = mid; else hi = mid; } return (lo + hi) / 2; }
/** How deep the ground must go (its own colour scaled toward black) for FULL white to step `target` off it: the L* it would have. */
function solveGround(g, target) { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (step(g.map((x) => x * mid), 1) > target) lo = mid; else hi = mid; } return L(g.map((x) => x * ((lo + hi) / 2))); }

const KNOTS = [3, 6, 8, 10, 13, 16, 21, 27, 30, 33, 40, 47, 55, 63];
const rows = [];
for (const surf of GROUNDS) for (const kn of KNOTS) {
  const gd = ground('dark', surf, kn), dStep = step(gd, DARK_OWN), row = { surf, kn, dark: { G: L(gd), step: dStep } };
  for (const theme of THEMES) {
    const g = ground(theme, surf, kn), w = drawnW(theme, surf);
    row[theme] = {
      G: L(g), room: 100 - L(g), w, step: step(g, w), ratio: step(g, w) / dStep, wStar: solveW(g, dStep), gStar: step(g, 1) < dStep ? solveGround(g, dStep) : null,
      // the Jacobian's row for `step`, in L*. The white and the field's strength: a 10% turn, central (0.95 to 1.05 of today's), or from
      // 0.90 up to today's where the white is already full and cannot be turned up (--before-depth's land).
      dW: w * 1.05 > 1 ? step(g, w) - step(g, w * 0.9) : step(g, w * 1.05) - step(g, w * 0.95),
      dOp: (step(ground(theme, surf, kn, 1.05), w) - step(ground(theme, surf, kn, 0.95), w)),
      dMap: step(ground(theme, surf, kn, 1, 0.9), w) - step(ground(theme, surf, kn, 1, 1), w),                   // the map's colour 10% darker (one-sided: the lever asked about is a deeper map)
      dV: (step(ground(theme, surf, kn + 1), w) - step(ground(theme, surf, Math.max(0, kn - 1)), w)) / 2,       // per knot
    };
  }
  row.dark.dV = (step(ground('dark', surf, kn + 1), DARK_OWN) - step(ground('dark', surf, Math.max(0, kn - 1)), DARK_OWN)) / 2;
  row.dark.dG = (L(ground('dark', surf, kn + 1)) - L(ground('dark', surf, Math.max(0, kn - 1)))) / 2;
  for (const theme of THEMES) row[theme].dG = (L(ground(theme, surf, kn + 1)) - L(ground(theme, surf, Math.max(0, kn - 1)))) / 2;
  rows.push(row);
}

// THE MODEL'S GROUND AGAINST THE BENCH (LESSONS L-V60: a model is read against the GPU before anything is solved on it). The field alone
// over the real basemaps, zoom 6, L* by speed, [land, sea], as ground-run.js read it on a speed ramp (--strips 12). Dark: 2026-10-12, pixel
// ratio 1.5. Light and beach: dev f6310516 (the land step on), 2026-10-13, 390 x 844 at pixel ratio 3. They are reads of ONE place and day:
// re-read them (ground-run.js --fixture <ramp> --strips 12 --zooms 6 --json) when a map colour, the mute or a field table moves.
const BENCH = {
  dark: { kn: [3.2, 5.5, 7.8, 10.2, 12.5, 14.8, 17.2, 19.5, 21.8, 24.2, 26.5, 28.8],
    land: [20.6, 29.3, 32.7, 34.8, 35.7, 36.4, 37.0, 37.2, 37.2, 36.6, 36.2, 35.2], water: [32.1, 37.7, 41.9, 44.2, 45.1, 46.1, 46.5, 46.6, 46.6, 46.0, 45.4, 44.5] },
  light: { kn: [10.4, 11.4, 12.4, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.6, 20.6, 21.6],
    land: [59.8, 59.0, 58.3, 57.2, 56.5, 55.8, 55.2, 55.3, 55.4, 55.5, 55.5, 55.5], water: [51.3, 50.5, 49.7, 49.3, 48.6, 47.9, 47.5, 47.5, 47.3, 47.4, 47.2, 47.4] },
  beach: { kn: [10.4, 11.4, 12.4, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.6, 20.6, 21.6],
    land: [52.4, 51.2, 50.1, 48.8, 47.7, 46.5, 45.7, 45.6, 45.6, 45.6, 45.5, 46.8], water: [44.6, 43.5, 42.7, 41.5, 40.3, 39.5, 38.7, 38.7, 38.5, 38.6, 38.5, 39.4] },
};
const against = (theme, surf) => { const b = BENCH[theme], d = b.kn.map((kn, i) => L(ground(theme, surf, kn)) - b[surf][i]);
  return { mean: d.reduce((a, x) => a + x, 0) / d.length, worst: d.reduce((a, x) => (Math.abs(x) > Math.abs(a) ? x : a), 0), from: b.kn[0], to: b.kn[b.kn.length - 1] }; };
const KILLED = args.some((a) => a.startsWith('--before-'));

const f = (x, n = 1, w = 6) => (x == null ? '—' : x.toFixed(n)).padStart(w);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const surf of GROUNDS) {
    console.log(`\n=== OVER ${surf === 'water' ? 'THE SEA' : 'LAND'}: the ground under the wind, a streak's step off it, and what would equal dark's`);
    console.log('  kn | DARK  G   step |' + THEMES.map((t) => ` ${t.toUpperCase().padEnd(5)} G   room  w    step  /dark   w*     G* |`).join(''));
    for (const r of rows.filter((x) => x.surf === surf)) {
      console.log(`${String(r.kn).padStart(4)} |${f(r.dark.G)} ${f(r.dark.step)} |` + THEMES.map((t) => { const x = r[t];
        return `${f(x.G, 1, 7)} ${f(x.room)} ${f(x.w, 2, 4)} ${f(x.step)} ${f(x.ratio, 2)} ${f(x.wStar, 2)} ${f(x.gStar)} |`; }).join(''));
    }
  }
  console.log('\n=== THE SIGN THAT MAKES A BREEZE AND A STORM DISAGREE: how the ground\'s lightness moves per knot (L* a knot)');
  console.log('  kn |      land: dark  light  beach |       sea: dark  light  beach');
  for (const kn of KNOTS) { const a = rows.find((r) => r.surf === 'land' && r.kn === kn), b = rows.find((r) => r.surf === 'water' && r.kn === kn);
    console.log(`${String(kn).padStart(4)} |           ${f(a.dark.dG, 2)} ${f(a.light.dG, 2)} ${f(a.beach.dG, 2)} |           ${f(b.dark.dG, 2)} ${f(b.light.dG, 2)} ${f(b.beach.dG, 2)}`); }
  console.log('\n=== THE JACOBIAN\'S ROW FOR A STREAK\'S STEP (L* moved by a 10% turn of each input; the speed column is per knot)');
  console.log('  theme ground  kn |  white w   field op   map 10% darker   speed (a knot) | dark\'s own step moves (a knot)');
  for (const theme of THEMES) for (const surf of GROUNDS) for (const kn of [8, 16, 30, 47]) { const r = rows.find((x) => x.surf === surf && x.kn === kn), x = r[theme];
    console.log(`  ${theme.padEnd(5)} ${(surf === 'water' ? 'sea' : 'land').padEnd(5)} ${String(kn).padStart(3)} | ${f(x.dW, 2, 8)} ${f(x.dOp, 2, 10)} ${f(x.dMap, 2, 16)} ${f(x.dV, 2, 16)} | ${f(r.dark.dV, 2, 10)}`); }
  console.log('\n=== THE MODEL\'S GROUND AGAINST THE BENCH (the field alone over the real maps, zoom 6; model minus bench, L*: mean, worst)');
  for (const theme of ['dark', ...(KILLED ? [] : THEMES)]) { const a = against(theme, 'land'), b = against(theme, 'water');
    console.log(`  ${theme.padEnd(5)} ${String(a.from).padStart(4)} to ${a.to} kn | land ${f(a.mean, 2)} ${f(a.worst, 2)} | sea ${f(b.mean, 2)} ${f(b.worst, 2)}`); }
  console.log(KILLED ? '  (light and beach: not shown under a --before lever; the bench read them with every default on)' : '  A ground the model has too DARK overstates that theme\'s step: read the tables above with these in hand.');
  if (arg('--json')) fs.writeFileSync(path.resolve(arg('--json')), JSON.stringify(rows, null, 1));
}
export { rows, ground, step, solveW, solveGround, against };
