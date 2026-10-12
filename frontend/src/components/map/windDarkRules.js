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
 *      Calm keeps its tint: under 3 kn the ground dims only as far as the weak calm tint can still colour it (D-019).
 *   3. NAMES: an orange or yellow ground (OKLCH h 35-126) is never dimmed below `guard` L*: dimmed on a pale page an orange reads
 *      brown and a yellow olive, while a dim blue is still navy and a dim red still maroon. A tint cannot LIFT a ground, and
 *      today's fields are already deeper than the guard at those hues (light L* 75-63 at 27-42 kn, beach 73-66 at 29-38 kn), so
 *      in practice the guard leaves those speeds as they are drawn today. It reaches `ease` knots outward along speed, so the
 *      ground climbs to a held band over a band's width instead of in one knot (those few speeds sit above `ceil`).
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
  ease: 4,          // knots to each side over which the guard's hand-over is eased (solveDarkRules: no hard line at its edge)
  cMin: 25,
  opacity: 1.0,
  ring: 0.25,
  white: 0,
});

/**
 * THE WHITE STREAK (owner, 2026-10-11; DECISIONS D-021). ON BY DEFAULT wherever dark's rules draw.
 *
 * What a dark streak IS, measured on the deployed engine (log 2026-10-11-wind-pale-band, "Dark watched in motion"): DRAW_FS draws a
 * small colour core under a WHITE inner ring at 92% and a black carving rim, and SCREEN_FS lays the trail at half strength. Read off
 * the screen, a dark streak is exactly its ground's colour (chroma x 1.00, hue within 2 degrees), 13 to 17 L* lighter. Dark has two
 * layers: a colour field that says how fast, and white wisps that say which way. It only LOOKS coloured: the field shows through.
 * Every attempt to copy it gave light's and beach's streaks a colour of their own instead; `ring: 0.25` above cut the white to a
 * quarter and filled the body with the hue's most saturated colour, and the owner took beach for dark and rejected both themes.
 * With dark's own ring the streaks stand off as dark's do (GPU bench, the real basemaps, over land at zooms 4 to 10): +8.5 to +15.5 L*
 * in light and +8.0 to +17.0 in beach, against dark's +9.5 to +14.5; chroma 1.05-1.14 times the field's in beach and 0.67-0.96 in
 * light (dark: 1.02-1.10), where the quarter ring drew 1.3 to 2.2 times.
 *
 * White light shows only on a ground deeper than itself. Beach's field (above) already is. Light draws the deeper field of its A/B
 * with that field's own streak row (WindColorRamp.js LIGHT_LOOK_FIELD.deep / LIGHT_LOOK_MARKS.deep: one row, since a white streak
 * takes its colour from what is under it): the arm the owner watched beside dark and picked ("middle row for both, build it").
 * Kill: window.__RAW_DISABLE_WIND_WHITE_STREAK__ = true draws both themes as PR #312 did (the quarter ring, the solved rows).
 */
export const WHITE_STREAK = Object.freeze({ opacity: 1.0, ring: 1, white: 0 });

/**
 * DARK'S WHITE, GROUND BY GROUND (owner, 2026-10-11; DECISIONS D-022). ON BY DEFAULT wherever the white streak draws.
 *
 * The owner, on the deployed white streak: "I dont see the wind for light mode or beach mode mirroring the dark mode", then, watching
 * the three themes: "close up zoom ... looks somewhat okay ... Its when you start zooming out that the contrast in theme modes
 * happens", and "you should be able to mathmatically determine".
 * Read frame by frame on the owner's screen and on the bench with one probe (scripts/wind-bench/page/mirror-probe.js): how far the
 * streaks LIFT the whole picture above its ground. Dark's map is light's and beach's turned over: dark's land is near black and its
 * sea is slate, theirs a pale land and a deep sea. The white streak was laid at one strength on both. Over the pale land that lifted
 * the picture 0.30 to 0.93 times as far as dark's streaks lift dark's land: no room above. Over the deep sea it lifted it 1.06 to 1.64
 * times as far, and a zoomed-out view is mostly sea: the streaks' cores went paper white and buried the colour field.
 * So the white is laid by the ground under the mark (the land mask, windLandMask.js): at full strength over land, and over the sea
 * at the share of it at which a streak lifts the picture as far as dark's lifts dark's sea (the median over zooms 4, 6 and 9 on the
 * bench, the real basemaps, the owner's pixel ratio). Each number is a STRENGTH: the share of full. The mark carries its square root
 * as its light level, because the screen pass lays a trail at its level squared.
 * Kill: window.__RAW_DISABLE_WIND_DARK_WHITE__ = true (full strength on both grounds, as PR #313 drew, pixel for pixel).
 * No table moves. WindColorRamp.js windWhiteStrength decides; without a land mask every mark is laid as over land (PR #313's look).
 */
export const DARK_WHITE = Object.freeze({ light: Object.freeze({ land: 1, sea: 0.55 }), beach: Object.freeze({ land: 1, sea: 0.77 }) });

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
  const o = Object.assign({ ceil: DARK_RULES.ceil[theme] || 58, guard: DARK_RULES.guard, cMin: DARK_RULES.cMin, op: DARK_RULES.opacity, ease: DARK_RULES.ease, calm: true }, opts || {});
  const base = GROUND[theme].land, out = { field: [], land: [], water: [] }, today = [];
  let yMax = 0;
  for (let kn = 0; kn <= 75; kn++) {   // today's ground under each speed, and how far the name guard holds it
    const F0 = sample(fieldRows, kn), s = fieldS(theme, kn), G0 = tint(base, s, F0), hue = okHue(G0);
    today.push({ F0, s, G0, w: ss(35, 55, hue) * ss(126, 116, hue), kG: o.guard > 0 ? Math.min(1, yOfL(o.guard) / lumY(G0)) : 0 });
    if (kn >= EVERYDAY[0] && kn <= EVERYDAY[1]) yMax = Math.max(yMax, lumY(G0));
  }
  const kU = Math.min(1, yOfL(o.ceil) / yMax);
  // NO HARD LINE AT THE GUARD'S EDGE (LESSONS L-V8). The guard is a rule about HUE, and a ramp crosses a hue in a knot or two: light's
  // field leaves green for yellow-green between 25 and 26 kn, where the lab's hand-over (10 degrees of hue) stepped the ground from
  // L* 55.5 to 74.1 in ONE knot, a contour line on every storm. The guard therefore reaches `ease` knots OUTWARD along the speed axis,
  // falling off in a straight line: a held speed keeps its full guard (no yellow is dimmed for it), and the speeds beside it climb to
  // it over a band's width. Outward only, so the Beaufort stops on both sides keep their grounds and the colour-blind floor keeps its
  // pairs (eased to both sides, light's 27 kn dimmed toward 33 kn and the floor fell from 4.6 to 2.2). 0 = the lab's hand-over.
  const guardAt = (kn) => {
    let w = 0;
    for (let j = -o.ease; j <= o.ease; j++) if (today[kn + j]) w = Math.max(w, today[kn + j].w * (1 - Math.abs(j) / (o.ease + 1)));
    return w;
  };
  for (let kn = 0; kn <= 75; kn++) {
    const { F0, s, G0, kG } = today[kn], D = sample(darkRows, kn), Ad = D[3];
    let k = kU + (Math.max(kU, kG) - kU) * guardAt(kn);                                         // dusk, or the name guard
    const lowest = (kk) => Math.min(...G0.map((g, c) => 1 - (1 - enc(dec(g) * kk) / base[c]) / s));
    // CALM KEEPS ITS TINT (D-019: calm is a pale tint of the theme's first colour, never grey). Under 3 kn the tint is at its weakest
    // (0.29 in light) and cannot both dim the ground by dusk's factor and colour it: clamped, light's calm drew a grey (C* 0.7).
    // There the ground dims only as far as the tint reaches WITH its colour.
    if (o.calm && kn < 3 && lowest(k) < 0) { let lo = k, hi = 1; for (let n = 0; n < 22; n++) { const m = (lo + hi) / 2; if (lowest(m) < 0) lo = m; else hi = m; } k = hi; }
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
