// LIGHT SPECTRUM, APART FROM DARK (D-037 re-solve, 2026-10-21; owner: "I'm not sold on light modes blue water, it seems too close to the
// same color as dark modes water"; "Resolve it so light improves but isnt too much like dark"). spectrum-solve.mjs with two changes:
//  - hue and lightness windows that keep light's common sea (1-3 m) pale aqua to sky and its big seas deep blue to indigo, crimson and
//    umber, away from dark's cyan -> blue-violet -> magenta;
//  - a hard rule at every 0.1 m from 0.5 to 6 m: light's composite (world opacity, lighting 0.5) is at least as far (CIEDE2000) from
//    dark's (theme-distance.mjs darkWash) as today's light (v2 at 16 m) is, capped at FLOOR_CAP; and from beach's v1 the same way.
// What follows is the original solver's header.
// LIGHT SPECTRUM SOLVER (D-037, 2026-10-21). The owner picked the research's light spine ("I like the proposed light mode") and asked
// "to make sure we have the best and widest spectrum of color on this scheme". This finds the seven break colours (0.5 1.25 2.5 4 6 9
// 14 m) with the WIDEST spectrum the light map can draw, judged by the same model wave-check.mjs uses (wave-lib.mjs composite: the
// spectrum's opacity law read from marineWavePalette.js, swell lighting, light water; colour-blind kinds from allDE):
//  - candidates: per break, a grid of composited CIELAB L* (a window that keeps lightness falling) and hue (a window that keeps the
//    owner's order: teal, azure, blue, violet, magenta, crimson, brown), each at the MAXIMUM chroma whose source colour is displayable
//    at world opacity;
//  - feasibility: between every two breaks, OKLCH L of the table colour AND of the composite at world, regional and coastal opacity
//    under swell lighting 0, 0.5 and 1 must fall at every sample (no climb anywhere, including inside a band);
//  - objective: the weakest adjacent step over all nine views, as min(normal / 10, worst dichromat / 6.5, lightness-only |dL*| / 5),
//    then the widest total normal path at world opacity.
// Usage: node spectrum-solve.mjs            (prints the table and the JSON of source colours for marineWavePalette.js)
import { loadPalettes, composite, ALPHAS, dE, allDE, labOf, oklab } from './wave-lib.mjs';
import { darkWash, beachWash } from './theme-distance.mjs';

const MOD = loadPalettes(), { spectrumAlpha } = MOD, V2 = MOD.widenWavePalette(MOD.WAVE_PALETTES.v2);
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const CMIN_COMMON = arg('--cmin-common', 22), FLOOR_CAP = arg('--cap', 24), BEACH_CAP = arg('--beach-cap', 20), FROM = arg('--from', 1.2), LOW = arg('--low', 10);
// Below FROM (calm coastal water) the floor is LOW: to be as far from dark's 0.5 m green as today's light is, a colour must be lighter
// than light's own water, and the spectrum's calm fade (from the water up to 0.5 m) would then climb in lightness.
const FLOORS = new Map(); for (let k = 5; k <= 60; k++) { const h = k / 10, v2 = composite(V2, 'light', h, ALPHAS.world, 0.5);
  const lo = h < FROM - 1e-9; FLOORS.set(k, { dark: Math.min(lo ? LOW : FLOOR_CAP, dE(v2, darkWash(h))), beach: Math.min(lo ? LOW : BEACH_CAP, dE(v2, beachWash(h))) }); }
const apart = (P, h) => { if (h < 0.5 - 1e-9 || h > 6 + 1e-9) return true; const f = FLOORS.get(Math.round(h * 10)); if (!f) return true;
  const c = composite(P, 'light', h, ALPHAS.world, 0.5); return dE(c, darkWash(h)) >= f.dark - 1e-6 && dE(c, beachWash(h)) >= f.beach - 1e-6; };
const WATER = [144, 223, 254].map((v) => v / 255), LIGHTING = [0.03, 0.05, 0.08], BREAKS = [0.5, 1.25, 2.5, 4, 6, 9, 14];
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function labToRgb([L, a, b]) {   // CIELAB D65 -> encoded sRGB 0-1 (NaN when out of gamut)
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, finv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = finv(fx) * 0.95047, Y = finv(fy), Z = finv(fz) * 1.08883;
  const r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z, bb = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return [r, g, bb].map((v) => (v <= 0 ? (v < -1e-4 ? NaN : 0) : v > 1 + 1e-4 ? NaN : enc(Math.min(1, v))));
}
function sourceFor(comp, h) {   // the source colour that composites to `comp` at world opacity, lighting 0.5
  if (comp.some((v) => Number.isNaN(v))) return null;
  const a = spectrumAlpha(ALPHAS.world, h), lit = LIGHTING.map((v) => v * 0.5 * ss(0.1, 3.0, h));
  const src = comp.map((v, i) => (v - (1 - a) * WATER[i]) / a - lit[i]);
  return src.every((v) => v >= -1e-4 && v <= 1 + 1e-4) ? src.map((v) => Math.min(1, Math.max(0, v))) : null;
}
function maxChroma(L, hue, h) {
  const rad = hue * Math.PI / 180; let lo = 0, hi = 140;
  if (!sourceFor(labToRgb([L, 0, 0]), h)) return null;
  for (let k = 0; k < 28; k++) { const C = (lo + hi) / 2; (sourceFor(labToRgb([L, C * Math.cos(rad), C * Math.sin(rad)]), h) ? (lo = C) : (hi = C)); }
  return lo;
}
const VIEWS = []; for (const a of [ALPHAS.world, ALPHAS.regional, ALPHAS.coastal]) for (const dir of [0, 0.5, 1]) VIEWS.push({ a, dir });
const pal = (h1, h2, c1, c2) => ({ heights: [h1, h2], cap: h2, over: null, spectrum: true, light: [c1.map((v) => v * 255), c2.map((v) => v * 255)] });
const L = (rgb) => oklab(rgb).L;
const LWIN = [[76, 86], [72, 82], [64, 74], [52, 62], [42, 52], [34, 44], [22, 32]];
const HWIN = [[150, 190], [190, 215], [215, 245], [250, 280], [285, 325], [345, 385], [20, 60]];
const cands = BREAKS.map((h, i) => {
  const out = [];
  for (let l = LWIN[i][0]; l <= LWIN[i][1]; l += 2) for (let hue = HWIN[i][0]; hue <= HWIN[i][1]; hue += 5) {
    const Cmax = maxChroma(l, hue % 360, h); if (Cmax === null) continue;
    for (const f of [1, 0.75, 0.55, 0.4]) {   // paler options too: light's own water is a pastel, and full chroma pulls toward dark's
      const C = Cmax * f; if (C < (i >= 5 ? 18 : i === 1 || i === 2 ? CMIN_COMMON : 22)) continue;   // no dull band: C* >= 22 up to 6 m (CMIN_COMMON at 1.25/2.5 m)
      const rad = (hue % 360) * Math.PI / 180, src = sourceFor(labToRgb([l, C * Math.cos(rad), C * Math.sin(rad)]), h);
      if (src && apart(pal(h, h + 1, src, src), h)) out.push({ h, L: l, hue: hue % 360, C, src });
    }
  }
  return out;
});
const SAMPLES = 8;
function edge(p, c) {   // p, c: { h, src }; the water node has h 0 and the next break's colour (the fade)
  const P = pal(p.h, c.h, p.water ? c.src : p.src, c.src);
  let prevW = Infinity; const prevV = VIEWS.map(() => Infinity);
  for (let k = 0; k <= SAMPLES; k++) {   // no lightness climb anywhere along the band, on the table or as drawn in any view
    const h = p.h + (c.h - p.h) * k / SAMPLES, w = L(P.light[0].map((v, i) => (v + (P.light[1][i] - v) * k / SAMPLES) / 255));
    if (!p.water && w > prevW + 1e-4) return null; prevW = w;
    for (let v = 0; v < VIEWS.length; v++) { const lv = L(composite(P, 'light', h, VIEWS[v].a, VIEWS[v].dir)); if (lv > prevV[v] + 1e-4) return null; prevV[v] = lv; }
  }
  for (let x = Math.ceil(p.h * 10 + 1e-9) / 10; x < c.h - 1e-9; x += 0.1) if (!apart(P, x)) return null;
  let score = Infinity, worst = null, n0 = 0;
  for (let v = 0; v < VIEWS.length; v++) {
    const a = composite(P, 'light', p.h, VIEWS[v].a, VIEWS[v].dir), b = composite(P, 'light', c.h, VIEWS[v].a, VIEWS[v].dir);
    const n = dE(a, b), cvd = allDE(a, b), dl = Math.abs(labOf(a)[0] - labOf(b)[0]), sc = Math.min(n / 10, cvd.de / 6.5, dl / 5);
    if (sc < score) { score = sc; worst = { n, cvd: cvd.de, kind: cvd.kind, dl, view: VIEWS[v] }; }
    if (v === 0) n0 = n;
  }
  return { score, n: n0, worst };
}
// the water -> 0.5 m edge is the calm fade (fixed by the water): it must be feasible but does not set the score
const WATER_CVD = arg('--water-cvd', 5);   // the calm fade's own step (water -> 0.5 m) must stay visible to every colour vision
let layer = cands[0].map((c) => { const e = edge({ h: 0, water: true }, c); return e && e.worst.cvd >= WATER_CVD && { c, min: Infinity, sum: 0, prev: null, e }; }).filter(Boolean);
for (let i = 1; i < BREAKS.length; i++) {
  layer = cands[i].map((c) => {
    let best = null;
    for (const p of layer) {
      const e = edge(p.c, c); if (!e) continue;
      const min = Math.min(p.min, e.score), sum = p.sum + e.n;
      if (!best || min > best.min + 1e-9 || (Math.abs(min - best.min) <= 1e-9 && sum > best.sum)) best = { c, min, sum, prev: p, e };
    }
    return best;
  }).filter(Boolean);
  if (!layer.length) { console.log('no feasible path at', BREAKS[i], 'm; candidates there', cands[i].length, 'previous layer', i); process.exit(1); }
  console.error(`layer ${BREAKS[i]} m: ${layer.length} of ${cands[i].length}`);
}
const end = layer.reduce((a, b) => (b.min > a.min + 1e-9 || (Math.abs(b.min - a.min) <= 1e-9 && b.sum > a.sum) ? b : a));
const path = []; for (let s = end; s; s = s.prev) path.unshift(s);
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
console.log(`weakest step over ${VIEWS.length} views: score ${end.min.toFixed(3)} (1 = normal 10, colour-blind 6.5, lightness 5 met); world path ${end.sum.toFixed(1)} dE00`);
path.forEach((s) => console.log(`  ${String(s.c.h).padStart(4)} m  L*${s.c.L} hue ${s.c.hue} C*${s.c.C.toFixed(1)}  src ${hex(s.c.src)}  | weakest: normal ${s.e.worst.n.toFixed(1)}, ${s.e.worst.kind} ${s.e.worst.cvd.toFixed(1)}, dL* ${s.e.worst.dl.toFixed(1)} (alpha ${s.e.worst.view.a}, lighting ${s.e.worst.view.dir})`));
console.log('JSON ' + JSON.stringify(path.map((s) => s.c.src.map((v) => Math.round(v * 255)))));
