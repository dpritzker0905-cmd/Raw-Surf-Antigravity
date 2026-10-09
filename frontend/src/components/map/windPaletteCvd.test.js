/**
 * WIND PALETTES vs COLOUR BLINDNESS (2026-10-09). The pins behind frontend/scripts/wind-color (#289), which is the authority
 * but does not run in CI: neighbouring LEGEND stops (the particle ramp) and neighbouring TINTS composited over the basemap
 * WATER must stay >= 5 dE2000 apart for a protanope, a deuteranope and a tritanope. The models are coloraide 8.13's, ported
 * here: Vienot 1999 for protan/deutan, Brettel 1997 for tritan (the DaltonLens review's picks), on linear sRGB, with no
 * clipping, then CIEDE2000 in Lab D65. The port is anchored to coloraide's own output below.
 */
import { resolveThemeRamp, resolveFieldRamp } from './WindColorRamp';
import { muteColor, windBasemapMuteAmount, windBasemapWaterL } from './windBasemapMute';

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
// coloraide 8.13 filters/cvd.py
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
const cvd = (a, b) => KINDS.map((k) => de2000(simulate(a, k), simulate(b, k)));
const worstCvd = (a, b) => Math.min(...cvd(a, b));
const lab = (rgb) => labLin(rgb.map(dec));

// The composite the checker scores (check.mjs MODEL = HEATMAP_FS / windFieldLut.test.js): dark draws the field OVER the
// map at its stop alpha; light/beach multiply it in. Water as measured on each basemap.
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const MODEL = {
  dark: { over: true, op: 0.48, baseA: 0.44, end: 5, k: 1, water: [93, 117, 126] },
  beach: { op: 0.55, baseA: 0.45, end: 7, k: 0.60 / 0.55, water: [150, 190, 200], land: [222, 208, 180] },
  light: { op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65, water: [168, 214, 222], land: [236, 236, 232] },
};
const tintOver = (theme, [kn, r, g, b], surface = 'water') => { const m = MODEL[theme], s = Math.min(1, m.op * (m.baseA + (1 - m.baseA) * ss(0, m.end, kn)) * m.k);
  const w = m[surface].map((v) => v / 255); return m.over ? [r, g, b].map((c, i) => c * s + w[i] * (1 - s)) : w.map((v, i) => v * (1 - s * (1 - [r, g, b][i]))); };
const tintOverWater = (theme, stop) => tintOver(theme, stop, 'water');
const neighbours = (stops, colour) => stops.slice(1).map((s, i) => ({ kn: `${stops[i][0]}-${s[0]}`, d: worstCvd(colour(stops[i]), colour(s)) }));
const legendPairs = (ramp) => neighbours(ramp, (s) => s.slice(1, 4));
const waterPairs = (theme, field, surface = 'water') => neighbours(field.filter((s) => s[0] >= 3), (s) => tintOver(theme, s, surface));
const weakest = (pairs) => pairs.reduce((w, p) => (p.d < w.d ? p : w));
// A stop that sits above (or below) BOTH neighbours by more than `tol` is a new band edge: the eye reads it as a stripe.
const peaks = (vals, tol) => vals.slice(1, -1).map((v, i) => [i + 1, Math.min(Math.abs(v - vals[i]), Math.abs(v - vals[i + 2])), (v - vals[i]) * (v - vals[i + 2]) > 0])
  .filter(([, prom, isPeak]) => isPeak && prom > tol).map(([i]) => i);

describe('the colour-blind model is coloraide 8.13 (Vienot protan/deutan, Brettel tritan)', () => {
  it('reproduces coloraide on reference pairs to 0.01 dE2000', () => {
    // coloraide: Color('srgb', a).filter(kind, method).delta_e(Color('srgb', b).filter(kind, method), method='2000')
    const REF = [[[1, 0, 0], [0, 1, 0], [45.821, 19.649, 73.878]], [[0, 0, 1], [1, 1, 0], [103.428, 103.428, 75.239]],
      [[0.38, 0.95, 0.40], [0.62, 0.92, 0.30], [2.371, 3.543, 7.737]]];
    for (const [a, b, want] of REF) cvd(a, b).forEach((d, i) => expect(d).toBeCloseTo(want[i], 2));
  });
});

describe('DARK passes the colour-blind floor (legend and tint over water)', () => {
  const live = () => resolveThemeRamp('dark');
  it('every neighbouring legend stop and every neighbouring tint over water is >= 5 dE2000 for all three dichromacies', () => {
    expect(weakest(legendPairs(live())).d).toBeGreaterThanOrEqual(5);
    expect(weakest(waterPairs('dark', live())).d).toBeGreaterThanOrEqual(5);
  });
  it('without false bands: the 10-55 kn legend is one lightness arc (up to 21 kn, down to 55 kn) and adds no peak or dip', () => {
    const L = live().map((s) => lab(s.slice(1, 4))[0]);
    for (let i = 4; i <= 5; i++) expect(L[i]).toBeGreaterThan(L[i - 1]);    // 10 -> 16 -> 21 kn brighten
    for (let i = 6; i <= 10; i++) expect(L[i]).toBeLessThan(L[i - 1]);      // 21 -> 55 kn darken
    const C = live().map((s) => { const q = lab(s.slice(1, 4)); return Math.hypot(q[1], q[2]); });
    // only turns the shipped legend already had: lightness dips at 3 and 55 kn; chroma turns at 3, 6, 16 and 47 kn
    peaks(L, 1).forEach((i) => expect([1, 10]).toContain(i));
    peaks(C, 1).forEach((i) => expect([1, 2, 4, 9]).toContain(i));
    // ...and the tint over water adds none either (shipped: the 55 kn dip)
    peaks(live().filter((s) => s[0] >= 3).map((s) => lab(tintOverWater('dark', s))[0]), 1).forEach((i) => expect(i).toBe(9));
  });
  it('POSITIVE CONTROL + kill: __RAW_DISABLE_WIND_DARK_CVD__ restores the shipped greens, which collapse for red/green blindness', () => {
    window.__RAW_DISABLE_WIND_DARK_CVD__ = true;
    try {
      const old = live();
      expect(old[4]).toEqual([16, 0.38, 0.95, 0.40, 0.88]);
      expect(old[5]).toEqual([21, 0.62, 0.92, 0.30, 0.89]);
      expect(old[11]).toEqual(live()[11]);
      const legend = legendPairs(old).find((p) => p.kn === '16-21'), tint = waterPairs('dark', old).find((p) => p.kn === '21-27');
      expect(legend.d).toBeLessThan(3);   // coloraide: protan 2.4
      expect(tint.d).toBeLessThan(3);     // coloraide: protan 2.1
      expect(resolveThemeRamp('light')).toEqual(resolveThemeRamp('light'));
    } finally {
      delete window.__RAW_DISABLE_WIND_DARK_CVD__;
    }
    expect(live()[4]).not.toEqual([16, 0.38, 0.95, 0.40, 0.88]);
  });
});

describe('BEACH passes the colour-blind floor (legend, tint over water AND over land)', () => {
  const live = () => [resolveThemeRamp('beach'), resolveFieldRamp('beach', window)];
  it('every neighbouring legend stop and every neighbouring tint, on water and on land, is >= 5 dE2000 for all three', () => {
    const [P, F] = live();
    expect(weakest(legendPairs(P)).d).toBeGreaterThanOrEqual(5);
    expect(weakest(waterPairs('beach', F)).d).toBeGreaterThanOrEqual(5);
    expect(weakest(waterPairs('beach', F, 'land')).d).toBeGreaterThanOrEqual(5);
  });
  it('without false bands: the tint turns in lightness only at 10 kn (shipped) and where the legend turns (21 kn dip, 27-33 kn jump)', () => {
    const F = live()[1].filter((s) => s[0] >= 3), at = (i) => F[i][0];
    for (const surface of ['water', 'land']) {
      const L = F.map((s) => lab(tintOver('beach', s, surface))[0]), C = F.map((s) => { const q = lab(tintOver('beach', s, surface)); return Math.hypot(q[1], q[2]); });
      peaks(L, 1).forEach((i) => expect([10, 21, 27, 33]).toContain(at(i)));
      expect(peaks(C, 1)).toEqual([]);
    }
    const P = live()[0], LP = P.map((s) => lab(s.slice(1, 4))[0]);
    peaks(LP, 1).forEach((i) => expect(P[i][0]).toBe(21));   // the legend keeps its one turn: the deep palm-frond 21 kn
  });
  it('POSITIVE CONTROL + kill: __RAW_DISABLE_WIND_BEACH_CVD__ restores the shipped rows, where gold and yellow-green collapse', () => {
    window.__RAW_DISABLE_WIND_BEACH_CVD__ = true;
    try {
      const [P, F] = live();
      expect(P[3]).toEqual([10, 0.244, 0.631, 0.479, 0.83]);
      expect(F[6]).toEqual([27, 0.618, 0.702, 0.000, 0.88]);
      expect(F[3]).toEqual(live()[1][3]);   // rows the pass never touched stay the live palette
      expect(waterPairs('beach', F).find((p) => p.kn === '27-33').d).toBeLessThan(1);   // coloraide: deutan 0.4
      expect(legendPairs(P).find((p) => p.kn === '10-16').d).toBeLessThan(2.5);          // coloraide: tritan 1.9
      expect(resolveThemeRamp('dark')[4]).not.toEqual([16, 0.38, 0.95, 0.40, 0.88]);   // beach only
    } finally {
      delete window.__RAW_DISABLE_WIND_BEACH_CVD__;
    }
    expect(live()[1][6]).not.toEqual([27, 0.618, 0.702, 0.000, 0.88]);
  });
});

describe('LIGHT: the legend passes; the tint over water is raised but stays a documented exception', () => {
  const live = () => [resolveThemeRamp('light'), resolveFieldRamp('light', window)];
  it('every neighbouring legend stop is >= 5 dE2000 for all three dichromacies', () => {
    expect(weakest(legendPairs(live()[0])).d).toBeGreaterThanOrEqual(5);
  });
  it('EXCEPTION (owner to accept): the tint over water clears 2.6, not 5 -- dark parity leaves the 40-75 kn tints near-grey there', () => {
    // At 24-26 dE76 (dark's strength), light's pale warm 40-75 kn fields cancel the cyan water: C* 2-16 at L* 61-64. The best
    // smooth solve under every gate reached 5 over water once in 11 runs, by redesigning the field (not shipped). Raise this
    // pin if the tint improves; never lower it.
    const pairs = waterPairs('light', live()[1]);
    expect(weakest(pairs).d).toBeGreaterThanOrEqual(2.6);
    expect(pairs.filter((p) => p.d < 5).map((p) => p.kn)).toEqual(expect.arrayContaining(['47-55']));
  });
  it('without false bands: the tint turns in lightness only where the shipped one did (16 kn dip, 21 kn peak; 40 kn on land)', () => {
    const F = live()[1].filter((s) => s[0] >= 3), at = (i) => F[i][0];
    for (const surface of ['water', 'land']) {
      const L = F.map((s) => lab(tintOver('light', s, surface))[0]);
      peaks(L, 1).forEach((i) => expect([16, 21, 40]).toContain(at(i)));
    }
  });
  it('POSITIVE CONTROL + kill: __RAW_DISABLE_WIND_LIGHT_CVD__ restores the shipped rows, where gold meets yellow-green', () => {
    window.__RAW_DISABLE_WIND_LIGHT_CVD__ = true;
    try {
      const [P, F] = live();
      expect(P[7]).toEqual([33, 0.802, 0.643, 0.099, 0.87]);
      expect(F[10]).toEqual([55, 0.858, 0.618, 0.596, 0.91]);
      expect(F[4]).toEqual(live()[1][4]);   // 16 kn: never touched by the pass
      expect(legendPairs(P).find((p) => p.kn === '27-33').d).toBeLessThan(4.5);         // coloraide: protan 3.9
      expect(waterPairs('light', F).find((p) => p.kn === '27-33').d).toBeLessThan(0.5);  // coloraide: deutan 0.3
    } finally {
      delete window.__RAW_DISABLE_WIND_LIGHT_CVD__;
    }
    expect(live()[0][7]).not.toEqual([33, 0.802, 0.643, 0.099, 0.87]);
  });
});

// THE MUTED GROUND (2026-10-09, windBasemapMute.js). While the wind is on, light and beach show their basemap with 85% of
// its chroma removed and the water a little darker, so the tint the eye sees sits on THAT ground, not on the cyan water.
describe('the tint over the ground the wind actually sits on (basemap muted under the wind)', () => {
  const groundOf = (theme, surface) => {
    const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${MODEL[theme][surface].join(', ')})`, windBasemapMuteAmount(theme, {}), surface === 'water' ? windBasemapWaterL(theme, {}) : 1));
    return [+m[1], +m[2], +m[3]];
  };
  const tintOn = (theme, [kn, r, g, b], ground) => { const m = MODEL[theme], s = Math.min(1, m.op * (m.baseA + (1 - m.baseA) * ss(0, m.end, kn)) * m.k);
    return ground.map((v, i) => (v / 255) * (1 - s * (1 - [r, g, b][i]))); };
  const pairsOn = (theme, field, ground) => neighbours(field.filter((s) => s[0] >= 3), (s) => tintOn(theme, s, ground));
  it('BEACH: every neighbouring tint over the muted water and the muted land stays >= 5 dE2000 for all three', () => {
    const F = resolveFieldRamp('beach', window);
    expect(weakest(pairsOn('beach', F, groundOf('beach', 'water'))).d).toBeGreaterThanOrEqual(5);   // 5.08 at water x0.94
    expect(weakest(pairsOn('beach', F, groundOf('beach', 'land'))).d).toBeGreaterThanOrEqual(5);
  });
  it('LIGHT (known gap): over a neutral ground the field\'s 27-33 kn pair collapses for a deuteranope; muted water now behaves as light\'s own land always has', () => {
    // Light's land is near-grey (236,236,232), and its tint there was already at 1.8 for 27-33 kn (deutan) before the mute;
    // the cyan water used to split that pair (2.8). Muted, the water reads like the land (1.9). Fixing it is a light FIELD
    // colour-blind pass on a neutral ground (8 pairs under 5): a separate palette change for the owner's A/B. Never lower.
    const F = resolveFieldRamp('light', window), land = pairsOn('light', F, groundOf('light', 'land')), water = pairsOn('light', F, groundOf('light', 'water'));
    expect(weakest(water).d).toBeGreaterThanOrEqual(1.85);
    expect(weakest(land).d).toBeGreaterThanOrEqual(1.8);
    expect(weakest(water).kn).toBe('27-33');
    expect(weakest(waterPairs('light', F, 'land')).d).toBeLessThan(2);    // the same gap on the unmuted land, today
  });
});
