// WAVE PALETTE POLISH: the last step after wave-solve.mjs, on a whole table ({ heights, cap, over, light, beach }).
//  1. ROUNDING RISES. The solver scores rounded tables every 0.05 m; between anchors the GPU's mix() in encoded sRGB can still lift
//     OKLCH L by ~1e-4 over a few hundredths of a metre. Each such segment's lower anchor is darkened by one RGB unit per channel,
//     step by step, until the wash and the composite (every view, lighting 0/0.5/1) fall at every 0.005 m.
//  2. THE ABOVE-CAP COLOUR, re-solved against the fixed ramp: as far from the cap as it can be (normal + three dichromats, every
//     view), no lighter than the cap, its composite no grey (C* >= 14), off the land (>= 15 dE00) and visible on the legend panel
//     (|Lc| >= 15). A dark maroon over light's cyan water had composited to C* 4.9.
// Usage: node wave-polish.mjs in.json out.json [--keep-over] [--over-hue 250,300]
import fs from 'fs';
import { BASEMAP, ALPHAS, washAt, composite, oklab, apcaLc, dE, allDE, chromaStar } from './wave-lib.mjs';
import { rgbOfLch, lchOf } from './light-path-lib.mjs';

const [inp, outp] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--over-hue');
const T = JSON.parse(fs.readFileSync(inp, 'utf8'));
// --over-hue 250,300: keep the above-cap colour in a hue family (CIELAB h), e.g. a red flag after a blue ramp, a blue one after a red.
const HUE = (() => { const i = process.argv.indexOf('--over-hue'); return i > 0 ? process.argv[i + 1].split(',').map(Number) : [0, 360]; })();
let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

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
  const capRGB = T[theme][T[theme].length - 1], capL = lchOf(capRGB.map((v) => v / 255)).L;
  const land = BASEMAP[theme].land.map((v) => v / 255), panel = BASEMAP[theme].panel.map((v) => v / 255);
  let best = { s: -Infinity };
  for (let k = 0; k < 60000; k++) {
    const L = Math.max(8, capL - 16 * rand()), C = 20 + 70 * rand(), h = HUE[0] + (HUE[1] - HUE[0]) * rand();
    const c = rgbOfLch(L, C, h); if (c.some((v) => v < 0 || v > 1)) continue;
    const over = c.map((v) => Math.round(v * 255)), P = { ...T, over: { ...T.over, [theme]: over } };
    if (oklab(over.map((v) => v / 255)).L > oklab(capRGB.map((v) => v / 255)).L) continue;
    let d = Infinity, cc = Infinity, ls = Infinity;
    for (const a of Object.values(ALPHAS)) { const o = composite(P, theme, T.cap + 1, a); d = Math.min(d, allDE(o, composite(P, theme, T.cap, a)).de); cc = Math.min(cc, chromaStar(o)); ls = Math.min(ls, dE(o, land)); }
    const lc = Math.abs(apcaLc(over.map((v) => v / 255), panel));
    const s = d - 3 * Math.max(0, 14 - cc) - 2 * Math.max(0, 15 - ls) - 5 * Math.max(0, 15 - lc);
    if (s > best.s) best = { s, over, d, cc, ls, lc };
  }
  T.over[theme] = best.over;
  console.log(`${theme}: above-cap ${best.over.join(',')}: ${best.d.toFixed(1)} dE00 off the cap (weakest model, every view), composite C* ${best.cc.toFixed(1)}, land ${best.ls.toFixed(1)}, legend |Lc| ${best.lc.toFixed(1)}`);
}
fs.writeFileSync(outp, JSON.stringify(T));
