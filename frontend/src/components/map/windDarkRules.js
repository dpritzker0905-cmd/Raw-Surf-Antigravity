/**
 * windDarkRules.js — light and beach drawn by dark's rules (owner, 2026-10-11).
 *
 * The owner: "we need the light mode and beach mode's wind animations to follow the same rules as dark mode", then "build the
 * five rules into the app behind a lever, I want to see the changes done, not start with them off ... if we dont like them,
 * we turn them off". So this is ON BY DEFAULT for light and beach (DECISIONS D-020), and `__RAW_DISABLE_WIND_DARK_RULES__ = true`
 * returns both themes to exactly the tables they drew before it.
 *
 * DARK'S RULE: the ground under a streak is the streak's own colour at low light, and the streak is that colour at full light
 * (dark lays its veil and its marks from ONE table, and its composite only adds light). Restated so it holds on any ground
 * (docs/research/FINDING-2026-10-11-dark-s-rules-on-any-ground.md; lab: frontend/scripts/wind-lab/):
 *   1. LIGHT ONLY ADDS, in the ground-independent form: dark's streak method (windInk.js mode 2: the colour at full light,
 *      laid at alpha b^2). Dark's own formula darkens any ground lighter than black.
 *   2. ROOM: the theme's own field colour is dimmed by ONE factor in linear light (dusk), so the everyday-wind ground (6-27 kn,
 *      over land) sits at or under `ceil` L*. One factor keeps the bands' relations; a ceiling per band flattened them.
 *   3. NAMES: an orange or yellow ground (OKLCH h 35-126) is held at or above `guard` L*: dimmed on a pale page an orange reads
 *      brown and a yellow olive, while a dim blue is still navy and a dim red still maroon.
 *   4. THE GROUND UNDER THE MARK: land and sea get their own streak colours, each one dark's step above its own ground (dark's
 *      step over dark's land, and over dark's sea). The marks pick a row by a land mask (windLandMask.js).
 *   5. COLOUR FLOOR: a streak keeps at least `cMin` CIELAB chroma; it never buys lightness with its hue.
 *
 * THE ENGINE'S LAW, which the solver uses: a glow mark is drawn at full brightness (glowOf: its strongest channel 1), so its
 * lightness is set by how far its hue's most saturated colour is mixed toward white (the paint), and laid at w = A^2 x op
 * (A: the table's alpha). A paint that would step too far (a yellow) keeps its full colour and lowers A instead.
 *
 * The grounds are the wind bench's offline basemap colours, muted as windBasemapMute.js mutes the map (light and beach), and the
 * app's own night palette for dark (basemapFallback.js): a model of the map, not a read of it.
 */

export const DARK_RULES = Object.freeze({
  themes: Object.freeze(['light', 'beach']),
  ceil: Object.freeze({ light: 58, beach: 62 }),   // beach's ground is already deeper: it needs less dusk (log 2026-10-10-light-look-ab)
  guard: 76,
  cMin: 25,
  opacity: 1.0,
  ring: 0.25,
  white: 0,
});

const BASE = {
  dark: { land: [28, 37, 48], water: [11, 29, 46] },
  light: { land: [236, 236, 232], water: [168, 214, 222] },
  beach: { land: [222, 208, 180], water: [150, 190, 200] },
};
const FIELD = { light: { op: 0.65, bA: 0.42, end: 7, k: 0.70 / 0.65 }, beach: { op: 0.55, bA: 0.45, end: 7, k: 0.60 / 0.55 } };
const DARK = { op: 0.48, bA: 0.44, end: 5, streak: 0.505 };
const EVERYDAY = [6, 27];   // the everyday winds whose ground over land the dusk factor holds at the ceiling

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const dec = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const enc = (c) => { c = clamp01(c); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
const lumY = (rgb) => { const r = dec(rgb[0]), g = dec(rgb[1]), b = dec(rgb[2]); return 0.2126729 * r + 0.7151522 * g + 0.0721750 * b; };
const yOfL = (L) => (L > 8 ? Math.pow((L + 16) / 116, 3) : L / (24389 / 27));
function lab(rgb) {
  const r = dec(rgb[0]), g = dec(rgb[1]), b = dec(rgb[2]);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047), fy = f(0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
  const fz = f((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export const lstar = (rgb) => lab(rgb)[0];
export const chroma = (rgb) => { const l = lab(rgb); return Math.hypot(l[1], l[2]); };
function okHue(rgb) {
  const r = dec(rgb[0]), g = dec(rgb[1]), b = dec(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360;
}
function mute(rgb255, waterL) {   // windBasemapMute.js: OKLab chroma x (1 - 0.85), lightness kept (water x waterL)
  const lin = rgb255.map((c) => dec(c / 255));
  const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]);
  const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]);
  const s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
  const L = (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s) * waterL;
  const A = (1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s) * 0.15, B = (0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s) * 0.15;
  const l3 = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3), m3 = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s3 = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3);
  return [4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3, -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3].map(enc);
}
const GROUND = {
  dark: { land: BASE.dark.land.map((c) => c / 255), water: BASE.dark.water.map((c) => c / 255) },
  light: { land: mute(BASE.light.land, 1), water: mute(BASE.light.water, 0.9) },
  beach: { land: mute(BASE.beach.land, 1), water: mute(BASE.beach.water, 0.94) },
};

function sample(rows, kn) {   // linear in sRGB between stops (generateRampData's sampling)
  if (kn <= rows[0][0]) return rows[0].slice(1);
  for (let i = 1; i < rows.length; i++) if (kn <= rows[i][0]) {
    const a = rows[i - 1], b = rows[i], t = (kn - a[0]) / (b[0] - a[0]);
    return [1, 2, 3, 4].map((c) => a[c] + (b[c] - a[c]) * t);
  }
  return rows[rows.length - 1].slice(1);
}
const fieldS = (t, kn) => { const f = FIELD[t]; return clamp01(f.op * (f.bA + (1 - f.bA) * ss(0, f.end, kn)) * f.k); };
const tint = (base, s, F) => base.map((b, c) => b * (1 - s * (1 - F[c])));
function darkGround(surface, F, kn) {
  const a = DARK.op * (DARK.bA + (1 - DARK.bA) * ss(0, DARK.end, kn));
  return GROUND.dark[surface].map((g, c) => F[c] * a * a + g * (1 - a));
}
function darkStep(surface, S, A, kn) {   // dark's composite (SCREEN_FS's brightness branch) over dark's own ground, in L*
  const G = darkGround(surface, S, kn), be = A * Math.max(S[0], S[1], S[2]);
  return lstar(S.map((v, c) => v * A * be * DARK.streak + G[c] * (1 - be * DARK.streak))) - lstar(G);
}
// The most saturated full-brightness sRGB colour of each OKLCH hue, once (the hexcone's edge, 0.25 degree steps).
let CUSPS = null;
function cusp(h) {
  if (!CUSPS) {
    CUSPS = [];
    for (let x = 0; x < 360; x += 0.25) {
      const k = (n) => (n + x / 60) % 6, f = (n) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1)), c = [f(5), f(3), f(1)];
      CUSPS.push([okHue(c), c]);
    }
  }
  let best = CUSPS[0][1], bd = 1e9;
  for (const [hh, c] of CUSPS) { let d = Math.abs(hh - h); d = Math.min(d, 360 - d); if (d < bd) { bd = d; best = c; } }
  return best;
}

/**
 * The tables dark's rules draw for `theme`: { field, land, water } as [kn, r, g, b, a] rows at every knot 0-75.
 * fieldRows: the theme's own field stops (its hues); darkRows: dark's particle stops (dark's steps).
 */
export function solveDarkRules(theme, fieldRows, darkRows, opts) {
  const o = Object.assign({ ceil: DARK_RULES.ceil[theme] || 58, guard: DARK_RULES.guard, cMin: DARK_RULES.cMin, op: DARK_RULES.opacity }, opts || {});
  const base = GROUND[theme].land, out = { field: [], land: [], water: [] };
  let yMax = 0;
  for (let kn = EVERYDAY[0]; kn <= EVERYDAY[1]; kn++) yMax = Math.max(yMax, lumY(tint(base, fieldS(theme, kn), sample(fieldRows, kn))));
  const kU = Math.min(1, yOfL(o.ceil) / yMax);
  for (let kn = 0; kn <= 75; kn++) {
    const F0 = sample(fieldRows, kn), s = fieldS(theme, kn), G0 = tint(base, s, F0), hue = okHue(G0), D = sample(darkRows, kn), Ad = D[3];
    const w = ss(35, 55, hue) * ss(126, 116, hue), kG = o.guard > 0 ? Math.min(1, yOfL(o.guard) / lumY(G0)) : 0;
    const k = kU + (Math.max(kU, kG) - kU) * w;                                                 // dusk, or the name guard
    const F = G0.map((g, c) => clamp01(1 - (1 - enc(dec(g) * k) / base[c]) / s));               // the tint that lays it
    out.field.push([kn, F[0], F[1], F[2], F0[3]]);
    for (const surface of ['land', 'water']) {
      const G = tint(GROUND[theme][surface], s, F), P = cusp(okHue(G)), target = darkStep(surface, D.slice(0, 3), Ad, kn);
      const paint = (x) => P.map((c) => c + (1 - c) * x);                                          // toward white, as glowOf mixes
      const stepAt = (x, A) => { const wt = A * A * o.op; return lstar(paint(x).map((v, c) => v * wt + G[c] * (1 - wt))) - lstar(G); };
      let tMax = 0;
      while (tMax < 0.99 && chroma(paint(tMax + 0.01)) >= o.cMin) tMax += 0.01;
      let x = 0, A = Ad;
      if (stepAt(0, Ad) >= target) {                                                              // its full colour steps far enough: ease A
        let lo = 0.05, hi = Ad;
        for (let n = 0; n < 22; n++) { const m = (lo + hi) / 2; if (stepAt(0, m) > target) hi = m; else lo = m; }
        A = lo;
      } else if (stepAt(tMax, Ad) < target) x = tMax;                                             // the colour floor stops it short
      else {
        let lo = 0, hi = tMax;
        for (let n = 0; n < 22; n++) { const m = (lo + hi) / 2; if (stepAt(m, Ad) < target) lo = m; else hi = m; }
        x = hi;
      }
      const S = paint(x);
      out[surface].push([kn, S[0], S[1], S[2], A]);
    }
  }
  return out;
}
/** The grounds the solver assumes (for the tests and the checker). */
export function darkRulesGround(theme, surface, fieldRow, kn) {
  return tint(GROUND[theme][surface], fieldS(theme, kn), fieldRow);
}
