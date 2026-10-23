// SPECTRUM 4-6 m TUNE (D-037, 2026-10-21): the solved spectrum's violet (4 m) -> magenta (6 m) band climbed back a few thousandths of
// OKLCH L (the sRGB blend dips; swell lighting clips violet's full blue). This searches small changes to the 4 m and 6 m colours (blue
// trimmed, both scaled darker) with blend-only anchors at 4.5, 5 and 5.5 m on the OKLab line between them (L falls linearly there, so the
// band's sRGB blend cannot dip), keeping the ones whose lightness falls at every 0.02 m step
// on the table and as composited (world/regional/coastal x lighting 0/0.5/1: wave-check.mjs's own walk), and ranks them by the weakest
// neighbouring tick as composited (all colour-vision kinds), then by the normal-vision weakest.
// Usage: node spectrum-tune.mjs    (prints the best few; the winner goes into marineWavePalette.js by hand)
import { loadPalettes, composite, washAt, ALPHAS, dE, allDE, oklab } from './wave-lib.mjs';

const { WAVE_PALETTES } = loadPalettes(), BASE = WAVE_PALETTES.spectrum, DIRS = [0, 0.5, 1];
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }, enc = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toOk = (rgb) => { const [r, g, b] = rgb.map(lin); const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b); return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]; };
const fromOk = ([L, A, B]) => { const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3; return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map((v) => Math.round(Math.min(255, Math.max(0, enc(Math.min(1, Math.max(0, v))))))); };
function climbs(P) {
  const walk = (Lof, from) => { let up = 0; for (let h = from; h + 0.02 <= P.cap + 1e-9; h += 0.02) { const d = Lof(h) - Lof(Math.min(P.cap, h + 0.02)); if (d < 0) up -= d; } return up; };
  let worst = walk((h) => oklab(washAt(P, 'light', h)).L, 0);
  for (const a of Object.values(ALPHAS)) for (const dir of DIRS) worst = Math.max(worst, walk((h) => oklab(composite(P, 'light', h, a, dir)).L, 0.18));
  return worst;
}
function neighbours(P) {
  let all = Infinity, normal = Infinity;
  for (const a of Object.values(ALPHAS)) {
    const c = P.ticks.map((h) => composite(P, 'light', h, a, 0.5, false));
    for (let i = 0; i + 1 < c.length; i++) { all = Math.min(all, allDE(c[i], c[i + 1]).de); normal = Math.min(normal, dE(c[i], c[i + 1])); }
  }
  return { all, normal };
}
const I4 = BASE.heights.indexOf(4), I6 = BASE.heights.indexOf(6), v4 = BASE.light[I4], v6 = BASE.light[I6], results = [];
const heights = [...BASE.heights.slice(0, I4 + 1), 4.5, 5, 5.5, ...BASE.heights.slice(I6)];
// violet: blue trimmed (headroom for swell lighting) and red/green lifted (lighter, still well under the 2.5 m blue); magenta scaled darker.
for (const trim of [10, 15, 20, 25]) for (const lift of [0, 8, 16, 24, 32]) for (const k6 of [1, 0.97, 0.94, 0.91, 0.88]) {
  const k4 = lift; const c4 = [v4[0] + lift, v4[1] + lift, v4[2] - trim], c6 = v6.map((v) => Math.round(v * k6));
  const a = toOk(c4), b = toOk(c6), at = (t) => fromOk(a.map((v, i) => v + (b[i] - v) * t)), mid = at(0.5);
  const light = [...BASE.light.slice(0, I4), c4, at(0.25), mid, at(0.75), c6, ...BASE.light.slice(I6 + 1)];
  const P = { ...BASE, heights, light };
  const up = climbs(P); if (up > 1e-6) continue;
  results.push({ trim, k4, k6, c4, mid, c6, light, ...neighbours(P) });
}
results.sort((x, y) => y.all - x.all || y.normal - x.normal);
console.log(`${results.length} variants fall at every step; best by weakest neighbour (all kinds), then normal:`);
results.slice(0, 6).forEach((r) => console.log(`  4 m ${r.c4}  5 m ${r.mid}  6 m ${r.c6}  | weakest ${r.all.toFixed(2)}  normal ${r.normal.toFixed(2)}  (violet blue -${r.trim}, red/green +${r.k4}; magenta x${r.k6})`));
if (results.length) { console.log('heights ' + JSON.stringify(heights)); console.log('light ' + JSON.stringify(results[0].light)); }
