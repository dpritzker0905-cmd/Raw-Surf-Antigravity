// WAVE PALETTE POLISH: the last step after wave-solve.mjs, on a whole table ({ heights, cap, over, light, beach }).
//  1. ROUNDING RISES. The solver scores rounded tables every 0.05 m; between anchors the GPU's mix() in encoded sRGB can still lift
//     OKLCH L by ~1e-4 over a few hundredths of a metre. Each such segment's lower anchor is darkened by one RGB unit per channel,
//     step by step, until the wash and the composite (every view, lighting 0/0.5/1) fall at every 0.005 m.
//  2. THE ABOVE-CAP COLOUR, re-solved against the fixed ramp: as far from the cap as it can be (normal + three dichromats, every
//     view), no lighter than the cap, its composite no grey (C* >= 14), off the land (>= 15 dE00) and visible on the legend panel
//     (|Lc| >= 15). A dark maroon over light's cyan water had composited to C* 4.9. As DRAWN it must also be darker than the cap
//     (by 0.02 OKLCH L) and further off the bare water (by 5 dE00) under every lighting: beach's first blue flag was lighter than
//     its brick cap once laid over beach's sky-blue water (Schloss et al. 2019: darker-is-more and opaque-is-more agree on a light ground).
//  0. --extend H (2026-10-20, the wider height encoding): ONE more anchor at H m, searched against the FIXED ramp under it (every
//     anchor up to the old cap stays byte-identical), then the above-cap state moves to H (step 2). The anchor: darker than the old
//     cap's (OKLCH L, rounded table, wash and composite at every view and lighting, every 0.01 m), its hue turning on in the ramp's
//     own direction (5-45 degrees), as far from the old cap as it can be (normal + three dichromats, every view), and scored on the
//     same watch lines as the solver: composite C* >= 14, off the land (>= 15 dE00), a crest's core >= 15 dE00 off it (DRAW_FS's
//     storm colour from 6 m up), the legend stop at |Lc| >= 15 on its panel. Its L* may go under the solver's 22 floor (light's
//     10 m stop is already at 22): what it composites to is printed, so the "hole in the map" risk is read, not assumed.
//     --ext-lmin 14 or light=16,beach=35 (the anchor's lowest L*, per theme) and --ext-turn 5,25 (its hue turn, degrees) leave the above-cap state room: unbounded,
//     light's first 16 m anchor dived to L* 9 and its above-cap colour could get only 3.1 dE00 off it.
//     --ext-joint 24 keeps that many best anchors (the best per L* x 5-degree hue cell) and runs step 2's own flag search (15000 samples) against each, then keeps the
//     anchor with the best min(off the old cap, its flag's score): beach needed it, since under a saturated red 16 m stop the
//     violet flag could get only 7-9 dE00 once it had to be darker as drawn. (A first cut scored a fixed pool of 240 flags and
//     missed the room the full search finds: 0-3 dE00 against 15.7.)
// Usage: node wave-polish.mjs in.json out.json [--keep-over] [--over-hue 250,300] [--extend 16 [--ext-lmin 14 | light=16,beach=35] [--ext-turn 5,25] [--ext-joint 24]]
import fs from 'fs';
import { BASEMAP, ALPHAS, washAt, composite, crestOver, oklab, apcaLc, dE, allDE, chromaStar } from './wave-lib.mjs';
import { rgbOfLch, lchOf } from './light-path-lib.mjs';

const VALUED = ['--over-hue', '--extend', '--ext-lmin', '--ext-turn', '--ext-joint'];
const [inp, outp] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !VALUED.includes(all[i - 1]));
const T = JSON.parse(fs.readFileSync(inp, 'utf8'));
// --over-hue 250,300: keep the above-cap colour in a hue family (CIELAB h), e.g. a red flag after a blue ramp, a blue one after a red.
const HUE = (() => { const i = process.argv.indexOf('--over-hue'); return i > 0 ? process.argv[i + 1].split(',').map(Number) : [0, 360]; })();
let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const EXT = opt('--extend', null) === null ? null : Number(opt('--extend')), EXT_LMIN = ((v) => (v.includes('=') ? { light: 0, beach: 0, ...Object.fromEntries(v.split(',').map((kv) => kv.split('=')).map(([k, n]) => [k, Number(n)])) } : { light: Number(v), beach: Number(v) }))(opt('--ext-lmin', '0')), EXT_TURN = opt('--ext-turn', '5,45').split(',').map(Number);
if (EXT) {
  const oldCap = T.cap, turn = (a, b) => ((a - b + 540) % 360) - 180;
  T.heights = [...T.heights, EXT]; T.cap = EXT;
  for (const theme of ['light', 'beach']) {
    const C = T[theme], q = lchOf(C[C.length - 1].map((v) => v / 255)), dir = Math.sign(turn(q.h, lchOf(C[C.length - 2].map((v) => v / 255)).h)) || 1;
    const land = BASEMAP[theme].land.map((v) => v / 255), panel = BASEMAP[theme].panel.map((v) => v / 255);
    let best = { s: -Infinity };
    const JOINT = Number(opt('--ext-joint', 0)), cells = new Map();   // --ext-joint: the best anchor per L* x 5-degree hue cell
    for (let k = 0; k < 40000; k++) {
      const L = q.L - 2 - 14 * rand(); if (L < EXT_LMIN[theme]) continue;
      const c = rgbOfLch(L, 12 + 78 * rand(), (q.h + dir * (EXT_TURN[0] + (EXT_TURN[1] - EXT_TURN[0]) * rand()) + 360) % 360);
      if (c.some((v) => v < 0 || v > 1)) continue;
      const rgb = c.map((v) => Math.round(v * 255)), P = { heights: T.heights, cap: EXT, over: null, [theme]: [...C, rgb] };
      let rise = false;   // the new segment only: the anchors under it are fixed and already fall
      const falls = (Lof) => { for (let h = oldCap; h + 0.01 <= EXT + 1e-9 && !rise; h += 0.01) if (Lof(h + 0.01) >= Lof(h)) rise = true; };
      falls((h) => oklab(washAt(P, theme, h)).L);
      for (const a of Object.values(ALPHAS)) for (const d of [0, 0.5, 1]) falls((h) => oklab(composite(P, theme, h, a, d)).L);
      if (rise) continue;
      let sep = Infinity, cc = Infinity, ls = Infinity, cr = Infinity;
      for (const a of Object.values(ALPHAS)) {
        sep = Math.min(sep, allDE(composite(P, theme, oldCap, a, 0.5, false), composite(P, theme, EXT, a, 0.5, false)).de);
        for (let h = oldCap; h <= EXT + 1e-9; h += 0.5) { const u = composite(P, theme, h, a); cc = Math.min(cc, chromaStar(u)); ls = Math.min(ls, dE(u, land)); for (const wc of [0, 1]) cr = Math.min(cr, dE(crestOver(theme, h, u, wc), u)); }
      }
      const lc = Math.abs(apcaLc(rgb.map((v) => v / 255), panel));
      const pen = 3 * Math.max(0, 14 - cc) + 2 * Math.max(0, 15 - ls) + 0.7 * Math.max(0, 15 - cr) + 5 * Math.max(0, 15 - lc);
      if (JOINT) { const lq = lchOf(c), key = `${Math.round(lq.L)}|${Math.round(lq.h / 5)}`; if (!cells.has(key) || cells.get(key).s < sep - pen) cells.set(key, { s: sep - pen, rgb, sep, cc, ls, cr, lc }); continue; }
      const s = sep - pen;
      if (s > best.s) best = { s, rgb, sep, cc, ls, cr, lc };
    }
    const top = [...cells.values()].sort((x, y) => y.s - x.s).slice(0, JOINT);
    for (const t of top) {   // --ext-joint: each kept anchor against the flag step 2 would give it
      const f = searchOver({ ...T, [theme]: [...C, t.rgb] }, theme, 15000), s = Math.min(t.s, f.s);
      if (s > best.s) best = { ...t, s, room: f.s, flag: f.over };
    }
    C.push(best.rgb);
    const lq = lchOf(best.rgb.map((v) => v / 255)), compL = Object.entries(ALPHAS).map(([v, a]) => `${v} ${oklab(composite(T, theme, EXT, a)).L.toFixed(2)}`).join(', ');
    console.log(`${theme}: ${EXT} m anchor ${best.rgb.join(',')} (L*/C*/h ${lq.L.toFixed(0)}/${lq.C.toFixed(0)}/${lq.h.toFixed(0)}): ${best.sep.toFixed(1)} dE00 off the ${oldCap} m stop (weakest model, every view), composite C* ${best.cc.toFixed(1)}, land ${best.ls.toFixed(1)}, crest ${best.cr.toFixed(1)}, legend |Lc| ${best.lc.toFixed(1)}; composite OKLCH L ${compL}` +
      (JOINT ? `; its flag search's best ${best.flag.join(',')} scored ${best.room.toFixed(1)} (step 2 re-solves the flag at full size)` : ''));
  }
}

// Step 2, the above-cap search, against table T's cap for `theme` (also run per candidate anchor by --ext-joint).
function searchOver(T, theme, n = 60000) {
  const capRGB = T[theme][T[theme].length - 1], capL = lchOf(capRGB.map((v) => v / 255)).L;
  const land = BASEMAP[theme].land.map((v) => v / 255), panel = BASEMAP[theme].panel.map((v) => v / 255);
  let best = { s: -Infinity };
  for (let k = 0; k < n; k++) {
    const L = Math.max(8, capL - 16 * rand()), C = 20 + 70 * rand(), h = HUE[0] + (HUE[1] - HUE[0]) * rand();
    const c = rgbOfLch(L, C, h); if (c.some((v) => v < 0 || v > 1)) continue;
    const over = c.map((v) => Math.round(v * 255)), P = { ...T, over: { ...T.over, [theme]: over } };
    if (oklab(over.map((v) => v / 255)).L > oklab(capRGB.map((v) => v / 255)).L) continue;
    let d = Infinity, cc = Infinity, ls = Infinity, dL = -Infinity, dOff = Infinity;
    const waterC = BASEMAP[theme].water.map((v) => v / 255);
    for (const a of Object.values(ALPHAS)) {
      const o = composite(P, theme, T.cap + 1, a), c = composite(P, theme, T.cap, a); d = Math.min(d, allDE(o, c).de); cc = Math.min(cc, chromaStar(o)); ls = Math.min(ls, dE(o, land));
      // AS DRAWN (2026-10-20, the lead's Schloss et al. 2019 guard): darker than the cap and further off the bare water, under every lighting.
      for (const dir of [0, 0.5, 1]) { const o2 = composite(P, theme, T.cap + 1, a, dir), c2 = composite(P, theme, T.cap, a, dir); dL = Math.max(dL, oklab(o2).L - oklab(c2).L); dOff = Math.min(dOff, dE(o2, waterC) - dE(c2, waterC)); }
    }
    const lc = Math.abs(apcaLc(over.map((v) => v / 255), panel));
    const s = d - 3 * Math.max(0, 14 - cc) - 2 * Math.max(0, 15 - ls) - 5 * Math.max(0, 15 - lc) - 400 * Math.max(0, dL + 0.02) - 2 * Math.max(0, 5 - dOff);
    if (s > best.s) best = { s, over, d, cc, ls, lc };
  }
  return best;
}

function rises(theme) {
  const out = [];
  const walk = (Lof, from) => { for (let h = from; h + 0.005 <= T.cap + 1e-9; h += 0.005) if (Lof(Math.min(T.cap, h + 0.005)) >= Lof(h)) out.push(h); };   // min(): a float step past the cap would read the above-cap colour
  walk((h) => oklab(washAt(T, theme, h)).L, 0);
  for (const a of Object.values(ALPHAS)) for (const dir of [0, 0.5, 1]) walk((h) => oklab(composite(T, theme, h, a, dir)).L, 0.18);
  return out;
}

for (const theme of ['light', 'beach']) {
  for (let pass = 0; pass < 60; pass++) {
    const r = rises(theme); if (!r.length) break;
    const seg = T.heights.findIndex((x, k) => k && r[0] < x);   // the anchor that ends the segment holding the first rise
    T[theme][seg] = T[theme][seg].map((v) => Math.max(0, v - 1));
    console.log(`${theme}: rise at ${r[0].toFixed(3)} m -> darkened the ${T.heights[seg]} m anchor to ${T[theme][seg].join(',')}`);
  }
  if (rises(theme).length) console.log(`${theme}: STILL RISES at ${rises(theme)[0].toFixed(3)} m`);
  if (process.argv.includes('--keep-over')) continue;
  const best = searchOver(T, theme);
  T.over[theme] = best.over;
  console.log(`${theme}: above-cap ${best.over.join(',')}: ${best.d.toFixed(1)} dE00 off the cap (weakest model, every view), composite C* ${best.cc.toFixed(1)}, land ${best.ls.toFixed(1)}, legend |Lc| ${best.lc.toFixed(1)}`);
}
fs.writeFileSync(outp, JSON.stringify(T));
