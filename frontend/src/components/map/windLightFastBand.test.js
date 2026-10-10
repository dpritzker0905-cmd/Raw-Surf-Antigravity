/**
 * LIGHT'S FIELD FROM 6 KN UP IS "A, STEADY DESCENT" (owner, 2026-10-10: "I like A too").
 *
 * The neutral-ground pass (windPaletteCvd.test.js) proved ~2.6 dE2000 was the ceiling for light's field tints under light's
 * old rules; the colour-blind floor is 5 (frontend/scripts/wind-color). Three redesigns reached it on the muted ground
 * (log 2026-10-09-light-fastband-cvd); the owner saw them as drawn and picked A. This file pins:
 *   - the default field IS the rows the owner's A/B drew, and the kill switch (window.__RAW_DISABLE_WIND_LIGHT_FASTBAND__)
 *     restores the field before it, byte for byte;
 *   - every older light-field kill still draws exactly what it drew before A (an older kill steps back past A first);
 *   - what A buys (the floor, on muted water AND land, with no lightness or chroma stripe in the fast bands) and what it
 *     costs (27-75 kn are stronger than dark's: the one gate A re-scopes; windFieldLut.test.js pins the strengths).
 * The A/B lever (window.__RAW_WIND_LIGHT_FASTBAND__) and candidates B and C are gone (log 2026-10-10-light-fastband-a-default).
 */
import { resolveThemeRamp, resolveFieldRamp, FIELD_RAMPS, THEME_RAMPS } from './WindColorRamp';
import { muteColor, windBasemapMuteAmount, windBasemapWaterL } from './windBasemapMute';

// ── colour-blind model: coloraide 8.13 (Vienot protan/deutan, Brettel tritan), as windPaletteCvd.test.js ──────────────────
const dec = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((Math.abs(c) + 0.055) / 1.055, 2.4));
const mm = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const RGB2XYZ = [[0.4123907992659595, 0.357584339383878, 0.1804807884018343], [0.21263900587151036, 0.7151686787677559, 0.07219231536073371],
  [0.01933081871559185, 0.11919477979462598, 0.9505321522496606]];
const WHITE = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
const labLin = (lin) => { const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = mm(RGB2XYZ, lin).map((v, i) => f(v / WHITE[i])); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const de2000 = ([L1, a1, b1], [L2, a2, b2]) => { const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2), h1p = (Math.atan2(b1, a1p) / rad + 360) % 360, h2p = (Math.atan2(b2, a2p) / rad + 360) % 360;
  let dhp = h2p - h1p; if (C1p * C2p === 0) dhp = 0; else if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2), Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p; if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hbp - 275) / 25) ** 2)) * rad);
  return Math.sqrt(((L2 - L1) / SL) ** 2 + ((C2p - C1p) / SC) ** 2 + (dHp / SH) ** 2 + RT * ((C2p - C1p) / SC) * (dHp / SH)); };
const VIENOT = {
  protan: [[0.11238276122216405, 0.8876172387778362, 0], [0.11238276122216398, 0.8876172387778362, 0], [0.0040057682730469425, -0.004005768273046939, 1]],
  deutan: [[0.2927501142784356, 0.7072498857215644, 0], [0.2927501142784356, 0.7072498857215644, 0], [-0.022336587034129083, 0.022336587034129093, 1]],
};
const LMS = [[0.178824041258, 0.4351609057000001, 0.04119349692], [0.034556423182, 0.27155382458, 0.03867130836], [0.000299565576, 0.0018430896, 0.01467086136]];
const TRITAN = { w1: [[7.392856536180033, -11.148044821248138, 0], [-0.34194012421930653, 3.5501661175064, 0], [-4.2050692716448586, 10.89115898202731, 0]],
  w2: [[8.0643934576311, -12.42414705871019, 0], [-0.9956078228581946, 4.7923119863996835, 0], [-0.2150297288038942, 3.3090019545637928, 0]], sep: [0.344781556122, -0.655178443878, 0] };
const simulate = (rgb, kind) => { const lin = rgb.map(dec); if (kind !== 'tritan') return labLin(mm(VIENOT[kind], lin));
  const lms = mm(LMS, lin), side = lms[0] * TRITAN.sep[0] + lms[1] * TRITAN.sep[1]; return labLin(mm(side > 0 ? TRITAN.w2 : TRITAN.w1, lms)); };
const KINDS = ['protan', 'deutan', 'tritan'];
const worstCvd = (a, b) => Math.min(...KINDS.map((k) => de2000(simulate(a, k), simulate(b, k))));
const lab = (rgb) => labLin(rgb.map(dec));

// ── the composite the wind draws (windFieldLut.test.js / check.mjs): light multiplies the field into the ground ─────────
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const LIGHT = { op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65 };
const SURFACES = { water: [168, 214, 222], land: [236, 236, 232] };
const mutedOf = (surface) => { const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${SURFACES[surface].join(', ')})`, windBasemapMuteAmount('light', {}), surface === 'water' ? windBasemapWaterL('light', {}) : 1)); return [+m[1], +m[2], +m[3]]; };
const GROUNDS = { waterM: mutedOf('water'), landM: mutedOf('land'), water: SURFACES.water, land: SURFACES.land };
const tintOn = ([kn, r, g, b], ground) => { const s = Math.min(1, LIGHT.op * (LIGHT.baseA + (1 - LIGHT.baseA) * ss(0, LIGHT.end, kn)) * LIGHT.k); return ground.map((v, i) => (v / 255) * (1 - s * (1 - [r, g, b][i]))); };
const tints = (field, ground, from = 3) => field.filter((s) => s[0] >= from).map((s) => ({ kn: s[0], rgb: tintOn(s, ground) }));
const pairs = (field, ground) => { const t = tints(field, ground); return t.slice(1).map((b, i) => ({ kn: `${t[i].kn}-${b.kn}`, d: worstCvd(t[i].rgb, b.rgb) })); };
const weakest = (ps) => ps.reduce((w, p) => (p.d < w.d ? p : w));
const peaks = (vals, tol) => vals.slice(1, -1).map((v, i) => [i + 1, Math.min(Math.abs(v - vals[i]), Math.abs(v - vals[i + 2])), (v - vals[i]) * (v - vals[i + 2]) > 0])
  .filter(([, prom, isPeak]) => isPeak && prom > tol).map(([i]) => i);
const chroma = (q) => Math.hypot(q[1], q[2]);

// ── dark parity, measured the way windFieldLut.test.js does (bench dE76 of the map with vs without the field) ─────────────
const srgbToLab = (rgb) => { const d = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); const [R, G, B] = rgb.map(d);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
const DARK_STRENGTH = { 6: 23.2, 10: 29.5, 16: 32.0, 21: 31.5, 27: 30.4, 33: 28.5, 40: 26.3, 47: 24.7, 55: 24, 63: 24, 75: 24 };
const BENCH = [0.86 * 255, 0.88 * 255, 0.90 * 255];
const strength = (stop) => { const a = srgbToLab(BENCH.map((v) => v / 255)), b = srgbToLab(tintOn(stop, BENCH)); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
const hueDeg = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0; let h;
  if (mx === r) h = ((g - b) / (mx - mn)) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4; return ((h * 60) + 360) % 360; };

// ── A, and the field before it ──────────────────────────────────────────────────────────────────────────────────────────
// Captured from the code as it stood on dev 9eccf149, not typed: A_ROWS is what window.__RAW_WIND_LIGHT_FASTBAND__ = 'a' resolved to
// (the rows the owner's A/B page drew), PRE_A the default field then, OLDER_KILL_PICTURES what each older kill resolved to.
const A_ROWS = [
  [6, 0.711, 0.727, 0.967, 0.78], [10, 0.717, 0.581, 0.819, 0.80], [16, 0.467, 0.622, 0.412, 0.82], [21, 0.450, 0.762, 0.543, 0.84],
  [27, 0.703, 0.717, 0.395, 0.86], [33, 0.625, 0.590, 0.324, 0.87], [40, 0.600, 0.484, 0.332, 0.88], [47, 0.701, 0.443, 0.438, 0.90],
  [55, 0.679, 0.326, 0.414, 0.91], [63, 0.611, 0.348, 0.534, 0.93], [75, 0.562, 0.358, 0.652, 0.95],
];
const PRE_A = [
  [0, 0.942, 0.964, 0.987, 0.72], [3, 0.803, 0.757, 0.982, 0.75], [6, 0.631, 0.705, 0.891, 0.78], [10, 0.710, 0.639, 0.913, 0.80],
  [16, 0.466, 0.625, 0.412, 0.82], [21, 0.462, 0.747, 0.521, 0.84], [27, 0.634, 0.708, 0.432, 0.86], [33, 0.670, 0.618, 0.409, 0.87],
  [40, 0.742, 0.579, 0.462, 0.88], [47, 0.834, 0.599, 0.536, 0.90], [55, 0.783, 0.591, 0.571, 0.91], [63, 0.782, 0.608, 0.683, 0.93],
  [75, 0.736, 0.616, 0.753, 0.95],
];
const OLDER_KILL_PICTURES = {
  __RAW_DISABLE_WIND_LIGHT_NEUTRAL_CVD__: [
    [0, 0.942, 0.964, 0.987, 0.72], [3, 0.803, 0.757, 0.982, 0.75], [6, 0.631, 0.705, 0.891, 0.78], [10, 0.719, 0.640, 0.914, 0.80],
    [16, 0.466, 0.625, 0.412, 0.82], [21, 0.462, 0.759, 0.538, 0.84], [27, 0.631, 0.705, 0.434, 0.86], [33, 0.687, 0.634, 0.429, 0.87],
    [40, 0.751, 0.595, 0.470, 0.88], [47, 0.834, 0.599, 0.536, 0.90], [55, 0.783, 0.591, 0.571, 0.91], [63, 0.782, 0.608, 0.683, 0.93],
    [75, 0.736, 0.616, 0.753, 0.95],
  ],
  __RAW_DISABLE_WIND_LIGHT_CVD__: [
    [0, 0.942, 0.964, 0.987, 0.72], [3, 0.803, 0.757, 0.982, 0.75], [6, 0.628, 0.701, 0.901, 0.78], [10, 0.724, 0.641, 0.912, 0.80],
    [16, 0.466, 0.625, 0.412, 0.82], [21, 0.455, 0.763, 0.543, 0.84], [27, 0.628, 0.692, 0.432, 0.86], [33, 0.740, 0.657, 0.431, 0.87],
    [40, 0.753, 0.588, 0.478, 0.88], [47, 0.824, 0.613, 0.540, 0.90], [55, 0.858, 0.618, 0.596, 0.91], [63, 0.816, 0.601, 0.656, 0.93],
    [75, 0.736, 0.616, 0.753, 0.95],
  ],
  __RAW_DISABLE_WIND_LIGHT_LOWBAND__: [
    [0, 0.942, 0.964, 0.987, 0.72], [3, 0.803, 0.757, 0.982, 0.75], [6, 0.631, 0.705, 0.891, 0.78], [10, 0.289, 0.646, 0.736, 0.80],
    [16, 0.228, 0.803, 0.762, 0.82], [21, 0.462, 0.747, 0.521, 0.84], [27, 0.634, 0.708, 0.432, 0.86], [33, 0.670, 0.618, 0.409, 0.87],
    [40, 0.742, 0.579, 0.462, 0.88], [47, 0.834, 0.599, 0.536, 0.90], [55, 0.783, 0.591, 0.571, 0.91], [63, 0.782, 0.608, 0.683, 0.93],
    [75, 0.736, 0.616, 0.753, 0.95],
  ],
  __RAW_DISABLE_WIND_MIDBAND_REFINE__: [
    [0, 0.942, 0.964, 0.987, 0.72], [3, 0.803, 0.757, 0.982, 0.75], [6, 0.631, 0.705, 0.891, 0.78], [10, 0.276, 0.688, 0.789, 0.80],
    [16, 0.228, 0.803, 0.762, 0.82], [21, 0.462, 0.747, 0.521, 0.84], [27, 0.634, 0.708, 0.432, 0.86], [33, 0.670, 0.618, 0.409, 0.87],
    [40, 0.742, 0.579, 0.462, 0.88], [47, 0.834, 0.599, 0.536, 0.90], [55, 0.783, 0.591, 0.571, 0.91], [63, 0.782, 0.608, 0.683, 0.93],
    [75, 0.736, 0.616, 0.753, 0.95],
  ],
};
const ALL_OLDER_KILLS_PICTURE = [
  [0, 0.942, 0.964, 0.987, 0.72], [3, 0.803, 0.757, 0.982, 0.75], [6, 0.628, 0.701, 0.901, 0.78], [10, 0.276, 0.688, 0.789, 0.80],
  [16, 0.228, 0.803, 0.762, 0.82], [21, 0.455, 0.763, 0.543, 0.84], [27, 0.628, 0.692, 0.432, 0.86], [33, 0.740, 0.657, 0.431, 0.87],
  [40, 0.753, 0.588, 0.478, 0.88], [47, 0.824, 0.613, 0.540, 0.90], [55, 0.858, 0.618, 0.596, 0.91], [63, 0.816, 0.601, 0.656, 0.93],
  [75, 0.736, 0.616, 0.753, 0.95],
];
const KILL = '__RAW_DISABLE_WIND_LIGHT_FASTBAND__';
const live = (w = {}) => resolveFieldRamp('light', w);
const FAST = (field) => field.filter((s) => s[0] >= 21);

describe('A is light\'s default field, with a kill switch back to the field before it', () => {
  it('the default field is A\'s rows from 6 kn up; 0 and 3 kn and every alpha are as they were', () => {
    expect(live().filter((s) => s[0] >= 6)).toEqual(A_ROWS);
    expect(FIELD_RAMPS.light).toEqual(live());
    expect(live().slice(0, 2)).toEqual(PRE_A.slice(0, 2));
    expect(live().map((s) => [s[0], s[4]])).toEqual(PRE_A.map((s) => [s[0], s[4]]));
  });
  it('the kill switch restores the field before A, byte for byte, and only when it is exactly true', () => {
    expect(live({ [KILL]: true })).toEqual(PRE_A);
    for (const v of [undefined, false, 'true', 1, null]) expect(live({ [KILL]: v })).toEqual(live());
    expect(FIELD_RAMPS.light).toEqual(live());   // resolving never mutates the shipped table
  });
  it('light only, field only: beach, dark and the legend do not move, with or without the kill', () => {
    for (const w of [{}, { [KILL]: true }]) {
      expect(resolveFieldRamp('beach', w)).toEqual(FIELD_RAMPS.beach);
      expect(resolveFieldRamp('dark', w)).toBeNull();
    }
    window[KILL] = true;
    try { expect(resolveThemeRamp('light')).toEqual(THEME_RAMPS.light); expect(resolveThemeRamp('beach')).toEqual(THEME_RAMPS.beach); } finally { delete window[KILL]; }
  });
  it('each older kill switch still draws exactly what it drew before A: it steps back past A first, so no kill draws a mix', () => {
    for (const [kill, picture] of Object.entries(OLDER_KILL_PICTURES)) {
      expect(live({ [kill]: true })).toEqual(picture);
      expect(live({ [kill]: true, [KILL]: true })).toEqual(picture);
    }
    expect(live(Object.fromEntries(Object.keys(OLDER_KILL_PICTURES).map((k) => [k, true])))).toEqual(ALL_OLDER_KILLS_PICTURE);
  });
  it('the A/B lever is gone: the old candidate flag changes nothing', () => {
    for (const id of ['a', 'b', 'c', 'B']) expect(live({ __RAW_WIND_LIGHT_FASTBAND__: id })).toEqual(live());
    expect(live({ __RAW_WIND_LIGHT_FASTBAND__: 'c', [KILL]: true })).toEqual(PRE_A);
  });
});

describe('the colour-blind floor on the muted ground (what shows with the wind on)', () => {
  it('every neighbouring tint over the muted water AND the muted land is >= 5.15 dE2000 for protan, deutan and tritan', () => {
    expect(weakest(pairs(live(), GROUNDS.waterM)).d).toBeGreaterThanOrEqual(5.15);   // 5.22 at 40-47 kn
    expect(weakest(pairs(live(), GROUNDS.landM)).d).toBeGreaterThanOrEqual(5.15);    // 5.26 at 16-21 kn
  });
  it('POSITIVE CONTROL + kill: the field before A leaves a neighbouring pair under 3 for some viewer, on water and on land', () => {
    expect(weakest(pairs(live({ [KILL]: true }), GROUNDS.waterM)).d).toBeLessThan(3);   // 2.58 at 6-10 kn
    expect(weakest(pairs(live({ [KILL]: true }), GROUNDS.landM)).d).toBeLessThan(3);    // 2.59 at 55-63 kn
  });
  it('with the basemap mute off (unmuted water and land) the tint is better than it was, never worse', () => {
    expect(weakest(pairs(live(), GROUNDS.water)).d).toBeGreaterThanOrEqual(3.0);    // 3.04; was 2.75
    expect(weakest(pairs(live(), GROUNDS.land)).d).toBeGreaterThanOrEqual(5.15);    // 5.21; was 2.52
  });
  it('mutation: putting ONE row back to the field before A drops it under the pin (the pin has teeth)', () => {
    for (const kn of [6, 10, 21, 27, 33, 40]) { const i = PRE_A.findIndex((s) => s[0] === kn); const broken = live().map((s) => s.slice()); broken[i] = PRE_A[i].slice();
      expect(Math.min(weakest(pairs(broken, GROUNDS.waterM)).d, weakest(pairs(broken, GROUNDS.landM)).d)).toBeLessThan(5.15); }
  });
});

describe('no stripes: the fast bands descend steadily and add no lightness or chroma peak or dip', () => {
  it('21-75 kn tint lightness never rises with speed, and has no L* or C* peak/dip (prominence > 1), on muted water and land', () => {
    for (const ground of [GROUNDS.waterM, GROUNDS.landM]) {
      const q = FAST(live()).map((s) => lab(tintOn(s, ground))), L = q.map((x) => x[0]), C = q.map(chroma);
      L.forEach((v, i) => { if (i) expect(v).toBeLessThanOrEqual(L[i - 1] + 0.3); });
      expect(peaks(L, 1)).toEqual([]);
      expect(peaks(C, 1)).toEqual([]);
    }
  });
  it('on all four grounds the tint turns in lightness once, at the 16 kn dip it always had (shallower now)', () => {
    for (const ground of Object.values(GROUNDS)) {
      const F = live().filter((s) => s[0] >= 3), L = F.map((s) => lab(tintOn(s, ground))[0]);
      expect(peaks(L, 1).map((i) => F[i][0])).toEqual([16]);
    }
  });
  it('POSITIVE CONTROL: one pale row among darker neighbours draws a stripe, and the stripe tests see it', () => {
    const f = live().map((s) => s.slice()), j = f.findIndex((s) => s[0] === 47);
    f[j] = [f[j][0], ...f[j].slice(1, 4).map((c) => c + (1 - c) * 0.5), f[j][4]];   // 47 kn half-way to white: a pale band between two darker neighbours
    const L = FAST(f).map((s) => lab(tintOn(s, GROUNDS.waterM))[0]);
    expect(peaks(L, 1).length).toBeGreaterThan(0);
    expect(L.filter((v, k) => k && v > L[k - 1] + 0.3).length).toBeGreaterThan(0);
  });
});

describe('the one gate A re-scopes (strength against dark), and the gates it keeps', () => {
  it('6-21 kn carry dark\'s strength within 1 dE76; 27-75 kn are stronger than dark, never weaker, and stay under 45 (x1.9 dark at most)', () => {
    live().forEach((s) => { const t = DARK_STRENGTH[s[0]]; if (t === undefined) return;
      if (s[0] <= 21) expect(Math.abs(strength(s) - t)).toBeLessThanOrEqual(1.0);
      else { expect(strength(s)).toBeGreaterThanOrEqual(t + 2); expect(strength(s)).toBeLessThanOrEqual(45); expect(strength(s) / t).toBeLessThanOrEqual(1.9); }
    });
  });
  it('POSITIVE CONTROL + kill: the field before A sat within 1 dE76 of dark from 6 to 75 kn', () => {
    live({ [KILL]: true }).forEach((s) => { const t = DARK_STRENGTH[s[0]]; if (t !== undefined) expect(Math.abs(strength(s) - t)).toBeLessThanOrEqual(1.0); });
  });
  it('hue identity holds at every stop: the field is within 25 deg of the legend stop (no exception)', () => {
    live().forEach((st, i) => { const p = THEME_RAMPS.light[i], sat = (c) => Math.max(...c) - Math.min(...c);
      if (sat(p.slice(1, 4)) < 0.15 || sat(st.slice(1, 4)) < 0.1) return;
      let d = Math.abs(hueDeg(st.slice(1, 4)) - hueDeg(p.slice(1, 4))); if (d > 180) d = 360 - d; expect(d).toBeLessThanOrEqual(25); });
  });
  it('the land is never blocked and every tint stays visible (>= 14 dE2000 off the ground, 6-40 kn)', () => {
    const F = live();
    expect(Math.min(...FAST(F).map((s) => lab(tintOn(s, GROUNDS.landM))[0]))).toBeGreaterThanOrEqual(57);    // 58.5 at 75 kn (was 70)
    expect(Math.min(...FAST(F).map((s) => lab(tintOn(s, GROUNDS.waterM))[0]))).toBeGreaterThanOrEqual(43);   // 44.5
    for (const ground of [GROUNDS.waterM, GROUNDS.landM]) F.filter((s) => s[0] >= 6 && s[0] <= 40).forEach((s) => expect(de2000(lab(ground.map((v) => v / 255)), lab(tintOn(s, ground)))).toBeGreaterThanOrEqual(14));
  });
});
