/**
 * LIGHT FAST-BAND CANDIDATES (2026-10-09): window.__RAW_WIND_LIGHT_FASTBAND__ = 'a' | 'b' | 'c', DEFAULT OFF.
 *
 * The neutral-ground pass (windPaletteCvd.test.js) proved ~2.6 dE2000 is the ceiling for light's field tints under light's
 * rules; the colour-blind floor is 5 (frontend/scripts/wind-color). These three redesigns of the field reach it on the muted
 * ground, water AND land, for protan, deutan and tritan, WITHOUT a lightness or chroma stripe in the fast bands. They are
 * levers for the owner's A/B and change nothing until the flag is set: the default ramp, the legend, beach and dark are
 * pinned unchanged below.
 *
 * Which of the repo's other palette gates each candidate changes is in the log (2026-10-09-light-fastband-cvd), measured by
 * making the candidate the default and running windFieldLut / windParticleContrast / windParticlesV2 / windPaletteCvd /
 * windLegendFromRamp: the dark-parity strength test (27-75 kn re-scoped), the pins that assume the default rows (the
 * "tint clears 2.6" exception, the neutral-CVD and low-band kill controls) and, for candidate b, hue identity at 63 and 75 kn.
 * Everything else holds. The pins below are the candidates' OWN versions of the gates they re-scope.
 */
import { resolveThemeRamp, resolveFieldRamp, lightFastBandId, FIELD_RAMPS, THEME_RAMPS } from './WindColorRamp';
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

// ── the candidates and what each one re-scopes ──────────────────────────────────────────────────────────────────────────
// strengthMax: the strongest 27-75 kn band (bench dE76; dark's own is 24-30.4). hueRescoped: stops whose hue identity is re-scoped.
// floor: the weakest neighbouring tint over the muted water AND land the candidate must keep (dE2000, protan/deutan/tritan).
// lightnessTurns: kn where the tint may turn in lightness on the UNMUTED grounds (today's pin allows 16, 21 and 40; b adds a 6 kn dip and the
// 10 kn peak after it, 1.6-2.6 L* each; a and c keep only the 16 kn dip and make it shallower, 2-3 L* against today's 4.7-5.9).
const CANDIDATES = {
  a: { name: 'steady descent', floor: 5.15, strengthMax: 45, hueRescoped: [], lightnessTurns: [16, 21, 40], minLandL: 57, minWaterL: 43 },
  b: { name: 'blue-violet end', floor: 5.15, strengthMax: 41, hueRescoped: [63, 75], lightnessTurns: [6, 10, 16, 21, 40], minLandL: 60, minWaterL: 46 },
  c: { name: 'gentle', floor: 5.0, strengthMax: 37, hueRescoped: [], lightnessTurns: [16, 21, 40], minLandL: 63, minWaterL: 48 },
};
const live = (id) => resolveFieldRamp('light', id ? { __RAW_WIND_LIGHT_FASTBAND__: id } : {});
const FAST = (field) => field.filter((s) => s[0] >= 21);

describe('the lever is DEFAULT OFF and touches only light\'s field', () => {
  it('unset, blank or unknown: the ramp is today\'s, byte for byte', () => {
    for (const flag of [undefined, '', 'z', 'ab', 1, true, null]) {
      expect(resolveFieldRamp('light', { __RAW_WIND_LIGHT_FASTBAND__: flag })).toEqual(FIELD_RAMPS.light);
      expect(lightFastBandId({ __RAW_WIND_LIGHT_FASTBAND__: flag })).toBeNull();
    }
    expect(resolveFieldRamp('light', {})).toEqual(FIELD_RAMPS.light);
  });
  it.each(Object.keys(CANDIDATES))('candidate %s changes light\'s FIELD stops 6-75 kn only: not 0 or 3 kn, not the legend, beach or dark', (id) => {
    const base = FIELD_RAMPS.light, next = live(id);
    expect(next).toHaveLength(base.length);
    expect(next.map((s) => s[0])).toEqual(base.map((s) => s[0]));
    next.forEach((s, i) => { if (s[0] <= 3) expect(s).toEqual(base[i]); else expect(s.slice(1, 4)).not.toEqual(base[i].slice(1, 4)); expect(s[4]).toBe(base[i][4]); });   // alphas stay the stop's own
    expect(resolveFieldRamp('light', { __RAW_WIND_LIGHT_FASTBAND__: id.toUpperCase() })).toEqual(next);          // case-insensitive
    expect(resolveFieldRamp('beach', { __RAW_WIND_LIGHT_FASTBAND__: id })).toEqual(FIELD_RAMPS.beach);
    expect(resolveFieldRamp('dark', { __RAW_WIND_LIGHT_FASTBAND__: id })).toBeNull();
    expect(resolveThemeRamp('light')).toEqual(THEME_RAMPS.light);                                                // the legend is the particle ramp: never touched
    window.__RAW_WIND_LIGHT_FASTBAND__ = id;
    try { expect(resolveThemeRamp('light')).toEqual(THEME_RAMPS.light); expect(resolveThemeRamp('beach')).toEqual(THEME_RAMPS.beach); } finally { delete window.__RAW_WIND_LIGHT_FASTBAND__; }
    expect(FIELD_RAMPS.light).toEqual(resolveFieldRamp('light', {}));                                           // resolving never mutates the shipped table
  });
  it('the older kill switches stand the lever down and restore the older rows they own', () => {
    for (const kill of ['__RAW_DISABLE_WIND_LIGHT_NEUTRAL_CVD__', '__RAW_DISABLE_WIND_LIGHT_CVD__', '__RAW_DISABLE_WIND_LIGHT_LOWBAND__', '__RAW_DISABLE_WIND_MIDBAND_REFINE__']) {
      for (const id of Object.keys(CANDIDATES)) {
        expect(lightFastBandId({ __RAW_WIND_LIGHT_FASTBAND__: id, [kill]: true })).toBeNull();
        expect(resolveFieldRamp('light', { __RAW_WIND_LIGHT_FASTBAND__: id, [kill]: true })).toEqual(resolveFieldRamp('light', { [kill]: true }));
      }
    }
  });
});

describe('the colour-blind floor on the muted ground (what shows with the wind on)', () => {
  it('POSITIVE CONTROL: today\'s field leaves a neighbouring tint pair under 3 dE2000 for some viewer, on water and on land', () => {
    expect(weakest(pairs(live(), GROUNDS.waterM)).d).toBeLessThan(3);
    expect(weakest(pairs(live(), GROUNDS.landM)).d).toBeLessThan(3);
  });
  it.each(Object.keys(CANDIDATES))('candidate %s: every neighbouring tint over the muted water AND the muted land is >= 5 dE2000 for protan, deutan and tritan', (id) => {
    expect(weakest(pairs(live(id), GROUNDS.waterM)).d).toBeGreaterThanOrEqual(CANDIDATES[id].floor);
    expect(weakest(pairs(live(id), GROUNDS.landM)).d).toBeGreaterThanOrEqual(CANDIDATES[id].floor);
  });
  it.each(Object.keys(CANDIDATES))('candidate %s: the kill-switch picture (unmuted water and land) is not made worse than the default\'s pins', (id) => {
    expect(weakest(pairs(live(id), GROUNDS.water)).d).toBeGreaterThanOrEqual(2.74);   // windPaletteCvd.test.js: the unmuted water, 2.75 today
    expect(weakest(pairs(live(id), GROUNDS.land)).d).toBeGreaterThanOrEqual(2.5);     // ...and the unmuted land, 2.52 today
  });
  it('mutation: reverting ONE fast row of a candidate to today\'s drops it under the pin (the pin has teeth)', () => {
    const next = live('a'), base = FIELD_RAMPS.light;
    for (const kn of [6, 10, 21, 27, 33, 40]) { const i = next.findIndex((s) => s[0] === kn); const broken = next.map((s) => s.slice()); broken[i] = base[i].slice();
      expect(Math.min(weakest(pairs(broken, GROUNDS.waterM)).d, weakest(pairs(broken, GROUNDS.landM)).d)).toBeLessThan(5.15); }
  });
});

describe('no stripes: the fast bands descend steadily and add no lightness or chroma peak or dip', () => {
  it.each(Object.keys(CANDIDATES))('candidate %s: 21-75 kn tint lightness never rises with speed, and has no L* or C* peak/dip (prominence > 1), on muted water and land', (id) => {
    for (const ground of [GROUNDS.waterM, GROUNDS.landM]) {
      const q = FAST(live(id)).map((s) => lab(tintOn(s, ground))), L = q.map((x) => x[0]), C = q.map(chroma);
      L.forEach((v, i) => { if (i) expect(v).toBeLessThanOrEqual(L[i - 1] + 0.3); });
      expect(peaks(L, 1)).toEqual([]);
      expect(peaks(C, 1)).toEqual([]);
    }
  });
  it.each(Object.keys(CANDIDATES))('candidate %s: on the unmuted water and land the tint turns in lightness only where the pin allows', (id) => {
    for (const ground of [GROUNDS.water, GROUNDS.land]) {
      const F = live(id).filter((s) => s[0] >= 3), L = F.map((s) => lab(tintOn(s, ground))[0]);
      peaks(L, 1).forEach((i) => expect(CANDIDATES[id].lightnessTurns).toContain(F[i][0]));
    }
  });
  it('POSITIVE CONTROL: one pale row among darker neighbours draws a stripe, and the stripe tests see it', () => {
    const f = live('a').map((s) => s.slice()), j = f.findIndex((s) => s[0] === 47);
    f[j] = [f[j][0], ...f[j].slice(1, 4).map((c) => c + (1 - c) * 0.5), f[j][4]];   // 47 kn half-way to white: a pale band between two darker neighbours
    const L = FAST(f).map((s) => lab(tintOn(s, GROUNDS.waterM))[0]);
    expect(peaks(L, 1).length).toBeGreaterThan(0);
    expect(L.filter((v, k) => k && v > L[k - 1] + 0.3).length).toBeGreaterThan(0);
  });
});

describe('the gates a candidate RE-SCOPES, and its own version of each', () => {
  it.each(Object.keys(CANDIDATES))('candidate %s: dark parity holds within 1 dE76 for 6-21 kn; 27-75 kn are never weaker than dark and stay under the cap', (id) => {
    live(id).forEach((s) => { const t = DARK_STRENGTH[s[0]]; if (t === undefined) return;
      if (s[0] <= 21) expect(Math.abs(strength(s) - t)).toBeLessThanOrEqual(1.0);
      else { expect(strength(s)).toBeGreaterThanOrEqual(t - 1.0); expect(strength(s)).toBeLessThanOrEqual(CANDIDATES[id].strengthMax); }
    });
  });
  it.each(Object.keys(CANDIDATES))('candidate %s: hue identity holds (field within 25 deg of the legend stop), except where it is re-scoped', (id) => {
    live(id).forEach((st, i) => { const p = THEME_RAMPS.light[i], sat = (c) => Math.max(...c) - Math.min(...c);
      if (sat(p.slice(1, 4)) < 0.15 || sat(st.slice(1, 4)) < 0.1 || CANDIDATES[id].hueRescoped.includes(st[0])) return;
      let d = Math.abs(hueDeg(st.slice(1, 4)) - hueDeg(p.slice(1, 4))); if (d > 180) d = 360 - d; expect(d).toBeLessThanOrEqual(25); });
  });
  it.each(Object.keys(CANDIDATES))('candidate %s: the land is never blocked and every tint stays visible (>= 14 dE2000 off the ground, 6-40 kn)', (id) => {
    const F = live(id);
    expect(Math.min(...FAST(F).map((s) => lab(tintOn(s, GROUNDS.landM))[0]))).toBeGreaterThanOrEqual(CANDIDATES[id].minLandL);
    expect(Math.min(...FAST(F).map((s) => lab(tintOn(s, GROUNDS.waterM))[0]))).toBeGreaterThanOrEqual(CANDIDATES[id].minWaterL);
    for (const ground of [GROUNDS.waterM, GROUNDS.landM]) F.filter((s) => s[0] >= 6 && s[0] <= 40).forEach((s) => expect(de2000(lab(ground.map((v) => v / 255)), lab(tintOn(s, ground)))).toBeGreaterThanOrEqual(14));
  });
});
