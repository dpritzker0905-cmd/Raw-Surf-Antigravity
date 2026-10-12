/**
 * BEACH'S PATH: beach's wind field with its lightness one way through the green band and its pale gale band under a ceiling, in
 * beach's own colours (windBeachPath.js; DECISIONS D-025).
 *
 * The owner, 2026-10-12: "The light and beach modes need to make sense logically. It could be the way it is, or it could not be. It all
 * has to make sense to match dark mode, but [in] their colors and maps"; of beach: "beach can use improvement, just a little milder";
 * and, after watching dark, beach as it was and two solved fields moving side by side on a speed ramp: "go with F"; then "take the re-solved F".
 * This file pins:
 *   - THE DEFAULT IS THE ARM THAT WAS SHOWN: the field's hashes are the ones read through the lab lever at 584cfa62, the head the lead
 *     session filmed beside F and dark (F re-solved so it also holds the colour-blind bar over the deeper land of PR #320; the owner,
 *     relayed: "take the re-solved F"). LESSONS L-V25: the bytes that were watched;
 *   - THE KILL IS EXACT: window.__RAW_DISABLE_WIND_BEACH_PATH__ = true draws the tables dev drew at ec8f46a2, byte for byte (hashes captured
 *     from that code BEFORE the change, LESSONS L-V25), and every older kill and lever still draws what it drew with or without it;
 *   - ONE VISUAL VARIABLE: beach's FIELD. The streaks' two rows, light and dark do not move;
 *   - WHAT THE PATH IS, read per knot over the muted land and sea, each bar with the table before it as its positive control: lightness
 *     one way, the colour-blind floor at 5, beach's own hues and order, no harder edge, no new stripe;
 *   - WHAT IT COSTS, as numbers: the lighter 10 kn ground, the streak's shorter step there, the pale gale band.
 * The palette checker (scripts/wind-color/check.mjs, coloraide) is the authority for the colour-blind lines; the model here is its port.
 */
import { BEACH_PATH, beachPathRows } from './windBeachPath';
import { windBeachPathOn, windWhiteStreakOn, windDarkRulesOn, DARK_RULES_HOLDS, DARK_RULES_STEERS, resolveDrawnField, resolveDrawnMarks, drawnMarkRampData, windLookKey,
  buildFieldRampTexture, windLegendGradientCSS, resolveThemeRamp, sampleRamp } from './WindColorRamp';
import { WHITE_STREAK } from './windDarkRules';
import { glowOf, glowComposite } from './windInk';
import { muteColor, windBasemapMuteAmount, windBasemapWaterL } from './windBasemapMute';

const KILL = { __RAW_DISABLE_WIND_BEACH_PATH__: true };
const fnv = (a) => { let h = 2166136261; for (const b of a) h = Math.imul(h ^ b, 16777619); return (h >>> 0).toString(16); };
const rampGl = () => { const gl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4, CLAMP_TO_EDGE: 5, LINEAR: 6, TEXTURE_WRAP_S: 7, TEXTURE_WRAP_T: 8, TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10,
  getParameter: () => null, createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {} }; gl.texImage2D = (...a) => { gl.uploaded = a[8]; }; return gl; };
/** [marks row 0 (land), marks row 1 (sea), field] as FNV-1a of the 256-entry RGBA tables the engine uploads. */
const hashes = (theme, w, max) => { const marks = drawnMarkRampData(max, theme, w), gl = rampGl(); buildFieldRampTexture(gl, max, theme, w);
  return [fnv(marks.subarray(0, 1024)), fnv(marks.subarray(1024)), gl.uploaded ? fnv(gl.uploaded) : null]; };
// Captured from the running code at ec8f46a2 (dev, PR #314's merge), 2026-10-12 03:56Z, before this change.
const BEFORE = { beach: { 50: ['6e75db94', '72b4bd7f', '7c248d5f'], 75: ['be558fd8', 'cd4835ed', 'b9db3bb2'] }, light: { 50: ['71ea0097', '71ea0097', 'f73f7078'], 75: ['a49922ce', 'a49922ce', 'f9ffc9c2'] },
  dark: { 50: ['c2ebc33e', 'c2ebc33e', null], 75: ['e4592683', 'e4592683', null] } };
const PATH_FIELD = { 50: 'e434f0bf', 75: 'cbfec18a' };   // option F re-solved for the deeper land, as read through the lab lever at 584cfa62 (the head the lead session filmed) before it became the default

// ── colour model: CIELAB D65, CIEDE2000 and the checker's colour-blind filters (coloraide 8.13's matrices; windDarkRules.test.js) ──────
const dec = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((Math.abs(c) + 0.055) / 1.055, 2.4));
const mm = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const RGB2XYZ = [[0.4123907992659595, 0.357584339383878, 0.1804807884018343], [0.21263900587151036, 0.7151686787677559, 0.07219231536073371],
  [0.01933081871559185, 0.11919477979462598, 0.9505321522496606]];
const WHITE = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
const labLin = (lin) => { const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = mm(RGB2XYZ, lin).map((v, i) => f(v / WHITE[i])); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const lab = (rgb) => labLin(rgb.map(dec));
const lch = (rgb) => { const q = lab(rgb); return { L: q[0], C: Math.hypot(q[1], q[2]), h: (Math.atan2(q[2], q[1]) * 180 / Math.PI + 360) % 360 }; };
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
const seen = (rgb, kind) => { const lin = rgb.map(dec); if (kind !== 'tritan') return labLin(mm(VIENOT[kind], lin));
  const lms = mm(LMS, lin), side = lms[0] * TRITAN.sep[0] + lms[1] * TRITAN.sep[1]; return labLin(mm(side > 0 ? TRITAN.w2 : TRITAN.w1, lms)); };
const arc = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };

// ── beach's composite, modelled apart from the tables (check.mjs MODEL; the app's own basemap mute) ───────────────────────────────────
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const M = { op: 0.55, baseA: 0.45, end: 7, k: 0.60 / 0.55, surfaces: { water: [150, 190, 200], land: [222, 208, 180] } };
const bare = (surface) => { const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${M.surfaces[surface].join(', ')})`, windBasemapMuteAmount('beach', {}), surface === 'water' ? windBasemapWaterL('beach', {}) : 1));
  return [+m[1], +m[2], +m[3]].map((v) => v / 255); };
const BARE = { land: bare('land'), water: bare('water') }, SURFACES = ['land', 'water'];
const strength = (kn) => Math.min(1, M.op * (M.baseA + (1 - M.baseA) * ss(0, M.end, kn)) * M.k);
const KNOTS = Array.from({ length: 76 }, (_, kn) => kn), BEAUFORT = [0, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75];
const NOW = resolveDrawnField('beach', {}), WAS = resolveDrawnField('beach', KILL);
/** The field's colour on screen at `kn` over a ground, from a field table with a row a knot. */
const on = (field, surface, kn) => BARE[surface].map((v, i) => v * (1 - strength(kn) * (1 - field[kn][i + 1])));
/** The weakest neighbouring pair of Beaufort bands from 3 kn under protan, deutan and tritan simulation: { d, pair, kind }, and every pair under `bar`. */
const floor = (field, surface, bar = 5) => { let min = { d: Infinity }; const under = new Set();
  for (const kind of ['protan', 'deutan', 'tritan']) for (let i = 2; i < BEAUFORT.length; i++) { const pair = `${BEAUFORT[i - 1]}-${BEAUFORT[i]}`;
    const d = de2000(seen(on(field, surface, BEAUFORT[i - 1]), kind), seen(on(field, surface, BEAUFORT[i]), kind)); if (d < bar) under.add(pair); if (d < min.d) min = { d, pair, kind }; }
  return { ...min, under: [...under] }; };
/** How far lightness climbs back over a range of speeds: the most any knot sits above the darkest slower one (0 = one way). */
const climb = (field, surface, from, to) => { let lo = Infinity, worst = 0; for (let kn = from; kn <= to; kn++) { const L = lch(on(field, surface, kn)).L; lo = Math.min(lo, L); worst = Math.max(worst, L - lo); } return worst; };
/** How far the hue turns back against beach's order (to the aqua at 6 kn, then one way round the wheel), over the land. */
const turnBack = (field) => { let worst = 0; for (const [from, to, sign] of [[0, 6, 1], [6, 75, -1]]) { let far = 0, run = 0;
  for (let kn = from + 1; kn <= to; kn++) { run += arc(lch(on(field, 'land', kn - 1)).h, lch(on(field, 'land', kn)).h) * sign; far = Math.max(far, run); worst = Math.max(worst, far - run); } } return worst; };
const steepest = (field) => Math.max(...SURFACES.flatMap((s) => KNOTS.slice(1).map((kn) => de2000(lab(on(field, s, kn - 1)), lab(on(field, s, kn))))));
/** How far a chroma line is from one rise to one crest and one fall (0 = it is). */
const offCrest = (v) => { let best = Infinity; for (let p = 0; p < v.length; p++) { let t = 0; for (let i = 1; i < v.length; i++) t += Math.max(0, i <= p ? v[i - 1] - v[i] : v[i] - v[i - 1]); best = Math.min(best, t); } return best; };

describe('the switch: on wherever the white streak draws in beach, and only there', () => {
  it('is on by default in beach; never in light or dark', () => {
    expect(windBeachPathOn('beach', {})).toBe(true);
    for (const theme of ['light', 'dark', undefined]) expect(windBeachPathOn(theme, {})).toBe(false);
    expect(Object.isFrozen(BEACH_PATH) && Object.isFrozen(BEACH_PATH.field) && BEACH_PATH.field.every(Object.isFrozen)).toBe(true);
  });
  it('only exactly true kills', () => {
    for (const v of [1, 'true', 'yes', {}, null, undefined, false]) expect(windBeachPathOn('beach', { __RAW_DISABLE_WIND_BEACH_PATH__: v })).toBe(true);
    expect(windBeachPathOn('beach', KILL)).toBe(false);
  });
  it('the look key carries it, so the engine rebuilds its tables at once when the kill flips', () => {
    expect(windLookKey('beach', {})).toBe('white+path|dark-rules');
    expect(windLookKey('beach', KILL)).toBe('white|dark-rules');
    expect(windLookKey('beach', { __RAW_DISABLE_WIND_WHITE_STREAK__: true })).toBe('|dark-rules');
    expect(windLookKey('light', {})).toBe('white|dark-rules'); expect(windLookKey('light', KILL)).toBe('white|dark-rules');
    expect(windLookKey('dark', {})).toBe('|');
  });
});

describe('the kill: window.__RAW_DISABLE_WIND_BEACH_PATH__ draws what dev drew at ec8f46a2, byte for byte', () => {
  it.each([50, 75])('beach\'s field and both streak rows are the ones captured before (%i kn)', (max) => {
    expect(hashes('beach', KILL, max)).toEqual(BEFORE.beach[max]);
    expect(windWhiteStreakOn('beach', KILL)).toBe(true); expect(windDarkRulesOn('beach', KILL)).toBe(true);   // it stands nothing else down
  });
  it.each([50, 75])('ONE VISUAL VARIABLE: with it on, only beach\'s field moves; its streak rows, light and dark are byte for byte (%i kn)', (max) => {
    expect(hashes('beach', {}, max)).toEqual([BEFORE.beach[max][0], BEFORE.beach[max][1], PATH_FIELD[max]]);
    expect(hashes('beach', {}, max)[2]).not.toBe(hashes('beach', KILL, max)[2]);                               // positive control: the field DID move
    for (const theme of ['light', 'dark']) for (const w of [{}, KILL]) expect(hashes(theme, w, max)).toEqual(BEFORE[theme][max]);
    expect(resolveDrawnMarks('beach', {})).toEqual(resolveDrawnMarks('beach', KILL));
  });
  it('EVERY OLDER KILL AND LEVER STILL DRAWS WHAT IT DREW: under any of them the path is off, and its own kill changes nothing', () => {
    const olds = [...DARK_RULES_HOLDS.map((k) => ({ [k]: true })), ...DARK_RULES_STEERS.map((k) => ({ [k]: k === '__RAW_WIND_BASEMAP_MUTE__' || k === '__RAW_WIND_BASEMAP_WATER_L__' ? 0.5 : 'beach' })),
      { __RAW_DISABLE_WIND_DARK_RULES__: true }, { __RAW_DISABLE_WIND_WHITE_STREAK__: true }, { __RAW_DISABLE_WIND_DARK_WHITE__: true }, { __RAW_WIND_DARK_RULES__: false }, { __RAW_WIND_DARK_RULES__: 'light' },
      { __RAW_WIND_INK__: true }, { __RAW_WIND_INK__: 'beach' }, { __RAW_WIND_GLOW__: true }, { __RAW_WIND_GLOW__: 'beach' }, { __RAW_WIND_THEME_V2__: true }];
    expect(olds.length).toBeGreaterThan(30);
    for (const w of olds) {
      expect(windBeachPathOn('beach', w)).toBe(false);
      for (const max of [50, 75]) expect(hashes('beach', w, max)).toEqual(hashes('beach', { ...w, ...KILL }, max));
      expect(windLookKey('beach', w)).not.toContain('path');
    }
    // and the levers that leave the white streak drawing leave the path drawing (the control for the sweep above)
    for (const w of [{}, { __RAW_WIND_LIGHT_LOOK__: 'deep' }, { __RAW_WIND_DARK_RULES__: 'beach' }, { __RAW_WIND_GLOW__: 'light' }]) expect(windBeachPathOn('beach', w)).toBe(true);
    // D-022's kill is an older kill too: it is documented to draw PR #313's picture, so it draws PR #313's field (the tables captured before)
    for (const max of [50, 75]) expect(hashes('beach', { __RAW_DISABLE_WIND_DARK_WHITE__: true }, max)).toEqual(BEFORE.beach[max]);
  });
  it('the engine\'s own call shape: the kill is read from the real window, and clearing it flips back', () => {
    const asTheEngineReads = () => { const gl = rampGl(); buildFieldRampTexture(gl, 50, 'beach'); return [windLookKey('beach'), fnv(gl.uploaded)]; };
    try {
      expect(asTheEngineReads()).toEqual(['white+path|dark-rules', PATH_FIELD[50]]);
      window.__RAW_DISABLE_WIND_BEACH_PATH__ = true;
      expect(asTheEngineReads()).toEqual(['white|dark-rules', BEFORE.beach[50][2]]);
    } finally { delete window.__RAW_DISABLE_WIND_BEACH_PATH__; }
    expect(asTheEngineReads()).toEqual(['white+path|dark-rules', PATH_FIELD[50]]);
  });
});

describe('the table: a row a knot, the rows that already followed the logic kept byte for byte', () => {
  it('a row a knot from calm to 75 kn, every channel a tint the app can lay, every alpha the one it had', () => {
    expect(NOW.map((r) => r[0])).toEqual(KNOTS);
    for (const kn of KNOTS) { for (const c of [1, 2, 3]) { expect(NOW[kn][c]).toBeGreaterThanOrEqual(0); expect(NOW[kn][c]).toBeLessThanOrEqual(1); } expect(NOW[kn][4]).toBe(WAS[kn][4]); }
  });
  it('calm to 3 kn, 47 kn and 63 kn are untouched; 70 rows move', () => {
    const moved = KNOTS.filter((kn) => JSON.stringify(NOW[kn]) !== JSON.stringify(WAS[kn]));
    expect(moved).toEqual(BEACH_PATH.field.map((r) => r[0]));
    expect(moved.length).toBe(70);
    expect(KNOTS.filter((kn) => !moved.includes(kn))).toEqual([0, 1, 2, 3, 47, 63]);
  });
  it('beachPathRows lays the rows it is given and nothing else, and hands out a copy', () => {
    const base = [[0, 0.1, 0.2, 0.3, 0.7], [1, 0.4, 0.5, 0.6, 0.8], [2, 0.7, 0.8, 0.9, 0.9]], out = beachPathRows(base, [[1, 0.11, 0.22, 0.33]]);
    expect(out).toEqual([[0, 0.1, 0.2, 0.3, 0.7], [1, 0.11, 0.22, 0.33, 0.8], [2, 0.7, 0.8, 0.9, 0.9]]);
    out[0][1] = 9; expect(base[0][1]).toBe(0.1);
    const f = resolveDrawnField('beach', {}); f[10][1] = 9; expect(resolveDrawnField('beach', {})[10][1]).not.toBe(9);   // the caller cannot reach the cache
  });
  it('the legend bar is not moved; the field stays in the colour family of the legend at every band but ONE: over the sea at 16 kn it sits 31.2 degrees off (the line of the checker is 30)', () => {
    const legend = resolveThemeRamp('beach');
    const bar = windLegendGradientCSS('beach');                                                                 // the bar reads the real window, as the app does
    try { window.__RAW_DISABLE_WIND_BEACH_PATH__ = true; expect(windLegendGradientCSS('beach')).toBe(bar); } finally { delete window.__RAW_DISABLE_WIND_BEACH_PATH__; }
    expect(resolveThemeRamp('beach')).toEqual(legend);
    const off = (field, surface, kn) => Math.abs(arc(lch(sampleRamp(legend, kn).slice(0, 3)).h, lch(on(field, surface, kn)).h));
    for (const kn of BEAUFORT.filter((k) => k >= 3 && k <= 40)) { expect(off(NOW, 'land', kn)).toBeLessThanOrEqual(30); if (kn !== 16) expect(off(NOW, 'water', kn)).toBeLessThanOrEqual(30); }
    // ONE BAND IS PAST THE LINE, said as a number: over the sea at 16 kn the field sits 31.2 degrees off the legend's emerald (13.1
    // before; 23.5 over land). The palette checker prints it as a watch line: 1 kn wide (15.5 to 16 kn), where 2 kn would be red.
    expect(off(NOW, 'water', 16)).toBeCloseTo(31.2, 1); expect(off(NOW, 'land', 16)).toBeCloseTo(23.5, 1);
    expect(off(WAS, 'water', 16)).toBeCloseTo(13.1, 1);
  });
});

describe('what the path is, per knot over the muted land and sea (each bar with the table before as its control)', () => {
  it('LIGHTNESS RUNS ONE WAY through the green band: it never rises from calm to 21 kn, nor from 33 to 75 kn, over land or sea', () => {
    for (const surface of SURFACES) { expect(climb(NOW, surface, 0, 21)).toBeLessThan(0.05); expect(climb(NOW, surface, 33, 75)).toBeLessThan(0.05); }
    // the control: before, a gentle breeze drew DEEPER than a fresh one (10 kn L* 46.7 over land against 54.2 at 21 kn), and 63 to 75 kn rose
    expect(climb(WAS, 'land', 0, 21)).toBeCloseTo(7.5, 1); expect(climb(WAS, 'water', 0, 21)).toBeCloseTo(6.2, 1);
    expect(climb(WAS, 'land', 33, 75)).toBeCloseTo(1.4, 1);
    expect(lch(on(WAS, 'land', 10)).L).toBeCloseTo(46.7, 1); expect(lch(on(WAS, 'land', 21)).L).toBeCloseTo(54.2, 1);
  });
  it('it falls from calm to 16 kn and holds to 21 kn: no band deeper than a faster one beside it', () => {
    const L = (kn) => lch(on(NOW, 'land', kn)).L, C = (kn) => lch(on(NOW, 'land', kn)).C;
    expect([0, 3, 6, 10, 16, 21].map((kn) => +L(kn).toFixed(1))).toEqual([67.4, 63.6, 57.6, 51.5, 44.8, 44.7]);
    expect([10, 16, 21].map((kn) => +C(kn).toFixed(1))).toEqual([15.6, 14.3, 16.7]);
  });
  it('THE GALE BAND UNDER A CEILING: 27 to 40 kn sit level at L* 60 over land (the band peaked at 72.9), and the ground from 6 to 40 kn spans 15.4 L* where it spanned 26.2 (dark by the engine law: 7.4)', () => {
    const L = (field, kn) => lch(on(field, 'land', kn)).L, span = (field, surface) => { const v = KNOTS.filter((kn) => kn >= 6 && kn <= 40).map((kn) => lch(on(field, surface, kn)).L); return Math.max(...v) - Math.min(...v); };
    expect([27, 33, 40].map((kn) => +L(NOW, kn).toFixed(1))).toEqual([60.1, 60.1, 59.9]);
    expect(Math.max(...KNOTS.filter((kn) => kn >= 22).map((kn) => L(NOW, kn)))).toBeLessThanOrEqual(60.15);
    expect(Math.max(...KNOTS.filter((kn) => kn >= 22).map((kn) => L(WAS, kn)))).toBeCloseTo(72.9, 1);                // the control: the pale band as it was
    expect([span(NOW, 'land'), span(NOW, 'water'), span(WAS, 'land'), span(WAS, 'water')].map((v) => +v.toFixed(1))).toEqual([15.4, 12.9, 26.2, 21.7]);
  });
  it.each([['water', 5.05, 3.06], ['land', 5.31, 3.17]])('THE COLOUR-BLIND FLOOR is back above 5 over the muted %s: %f on the table (it drew %f)', (surface, now, was) => {
    const a = floor(NOW, surface), b = floor(WAS, surface);
    expect(a.d).toBeGreaterThanOrEqual(5); expect(a.d).toBeCloseTo(now, 2); expect(a.under).toEqual([]);
    expect(b.d).toBeCloseTo(was, 2); expect([b.pair, b.kind]).toEqual(['16-21', 'protan']);                   // the control: under the bar before
  });
  it('FOUR pairs were under the bar before, not one: the checker prints only the weakest', () => {
    expect(floor(WAS, 'water').under.sort()).toEqual(['16-21', '27-33', '47-55', '63-75']);
    expect(floor(WAS, 'land').under.sort()).toEqual(['16-21', '27-33']);
  });
  it('BEACH\'S OWN HUES: every band within 13.5 degrees of the hue it drew over land, and its order kept (to the aqua at 6 kn, then one way round)', () => {
    const off = BEAUFORT.map((kn) => Math.abs(arc(lch(on(WAS, 'land', kn)).h, lch(on(NOW, 'land', kn)).h)));
    expect(+Math.max(...off).toFixed(1)).toBe(13.5); expect(+off[BEAUFORT.indexOf(10)].toFixed(1)).toBe(12.6);   // 16 and 10 kn; not eight: the looser hue match is what keeps the ground deep
    expect(turnBack(NOW)).toBeLessThanOrEqual(0.7); expect(turnBack(WAS)).toBeLessThanOrEqual(0.7);
    const swapped = NOW.map((r) => r.slice()); [swapped[10], swapped[16]] = [[10, ...NOW[16].slice(1)], [16, ...NOW[10].slice(1)]];
    expect(turnBack(swapped)).toBeGreaterThan(5);                                                              // the control: the bar can fail (10 and 16 kn exchanged)
    // over the SEA the same rows move further: 10 kn by 14.2 degrees and 16 kn by 18.2
    const sea = BEAUFORT.map((kn) => Math.abs(arc(lch(on(WAS, 'water', kn)).h, lch(on(NOW, 'water', kn)).h)));
    expect(+sea[BEAUFORT.indexOf(10)].toFixed(1)).toBe(14.2); expect(+Math.max(...sea).toFixed(1)).toBe(18.2);
  });
  it('NO HARDER EDGE and NO NEW STRIPE: the steepest knot is 3.1 dE00 (3.9 before; dark by the engine law: 8.9), and the chroma line is as even as it was', () => {
    expect(steepest(NOW)).toBeCloseTo(3.1, 1); expect(steepest(WAS)).toBeCloseTo(3.9, 1);
    const line = (field) => offCrest(BEAUFORT.map((kn) => lch(on(field, 'land', kn)).C));
    expect(line(NOW)).toBeLessThanOrEqual(line(WAS) + 0.1);
    for (const surface of SURFACES) expect(Math.min(...KNOTS.filter((kn) => kn >= 3 && kn <= 40).map((kn) => lch(on(NOW, surface, kn)).C))).toBeCloseTo(Math.min(...KNOTS.filter((kn) => kn >= 3 && kn <= 40).map((kn) => lch(on(WAS, surface, kn)).C)), 5);   // no greyer veil than before (its weakest colour is still 3 kn's)
  });
});

describe('over a DEEPER land: the lightness of the land times 0.85, as PR #320 lays it under the wind (the field was re-solved to hold the bar on either land)', () => {
  const deep = (() => { const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${M.surfaces.land.join(', ')})`, windBasemapMuteAmount('beach', {}), 0.85)); return [+m[1], +m[2], +m[3]].map((v) => v / 255); })();
  const onDeep = (field, kn) => deep.map((v, i) => v * (1 - strength(kn) * (1 - field[kn][i + 1])));
  const deepFloor = (field) => { let min = Infinity; for (const kind of ['protan', 'deutan', 'tritan']) for (let i = 2; i < BEAUFORT.length; i++) min = Math.min(min, de2000(seen(onDeep(field, BEAUFORT[i - 1]), kind), seen(onDeep(field, BEAUFORT[i]), kind))); return min; };
  it('the colour-blind floor holds there too (5.0 or more), where the table before read 2.9', () => {
    expect(lch(deep).L).toBeCloseTo(68.9, 1);                                                                   // the land at the sea's depth (the sea is 68.8)
    expect(deepFloor(NOW)).toBeGreaterThanOrEqual(5); expect(deepFloor(NOW)).toBeLessThan(5.1);
    expect(deepFloor(WAS)).toBeCloseTo(2.9, 1);                                                                // the control
    let rise = 0, lo = Infinity; for (let kn = 0; kn <= 21; kn++) { const L = lch(onDeep(NOW, kn)).L; lo = Math.min(lo, L); rise = Math.max(rise, L - lo); }
    expect(rise).toBeLessThan(0.05);                                                                           // and lightness still runs one way through the green band
  });
});

describe('read as the engine uploads it, and by a normal eye', () => {
  it('AS UPLOADED (the 256-entry 8-bit texture) the sea has NO margin: 5.01 at a 75 kn maximum and 4.98 at a 50 kn maximum (the table reads 5.05); the land holds 5.2', () => {
    const lutFloor = (max, surface) => { const gl = rampGl(); buildFieldRampTexture(gl, max, 'beach', {});
      const texel = (i) => [0, 1, 2].map((c) => gl.uploaded[i * 4 + c] / 255);
      const lut = KNOTS.map((kn) => { const x = Math.min(255, (kn / max) * 255), i = Math.min(254, Math.floor(x)), t = x - i, a = texel(i), b = texel(i + 1); return kn <= max ? [kn, ...a.map((v, c) => v + (b[c] - v) * t)] : NOW[kn]; });
      return floor(lut, surface); };
    expect(lutFloor(75, 'water').d).toBeCloseTo(5.01, 2); expect(lutFloor(50, 'water').d).toBeCloseTo(4.98, 2);   // UNDER 5 by 0.02 at 50 kn: said, not hidden
    expect([lutFloor(50, 'water').pair, lutFloor(50, 'water').kind]).toEqual(['3-6', 'protan']);
    expect(lutFloor(75, 'land').d).toBeGreaterThan(5.2); expect(lutFloor(50, 'land').d).toBeGreaterThan(5.2);
  });
  it('A NORMAL EYE tells the everyday neighbours apart about half as well: 6-10 kn 6.2 / 5.2 dE00 over land / sea (10.8 / 8.5 before), 10-16 kn 7.0 / 5.3 (10.0 / 8.8)', () => {
    const d = (field, surface, a, b) => +de2000(lab(on(field, surface, a)), lab(on(field, surface, b))).toFixed(1);
    expect([d(NOW, 'land', 6, 10), d(NOW, 'water', 6, 10), d(WAS, 'land', 6, 10), d(WAS, 'water', 6, 10)]).toEqual([6.2, 5.2, 10.8, 8.5]);
    expect([d(NOW, 'land', 10, 16), d(NOW, 'water', 10, 16), d(WAS, 'land', 10, 16), d(WAS, 'water', 10, 16)]).toEqual([7.0, 5.3, 10.0, 8.8]);
  });
  it('the wind bench can name the kill: `before-path` is the arm to scan the default against', () => {
    const { ALL_VARIANTS } = require('../../../scripts/wind-bench/matrix');
    expect(ALL_VARIANTS['before-path'].levers).toEqual(KILL);
    expect(ALL_VARIANTS.candidate.levers).toEqual({});
  });
});

describe('what it costs, said as numbers', () => {
  const moved = (kn, surface = 'land') => de2000(lab(on(WAS, surface, kn)), lab(on(NOW, surface, kn)));
  const L = (field, kn, surface = 'land') => lch(on(field, surface, kn)).L, C = (field, kn) => lch(on(field, 'land', kn)).C;
  it('THE GREENS GO GREY-GREEN: 16 and 21 kn keep C* 14.3 and 16.7 of 33.6 and 32.7, and sit 8.2 and 9.6 L* deeper over land', () => {
    expect([C(NOW, 16), C(WAS, 16), C(NOW, 21), C(WAS, 21)].map((v) => +v.toFixed(1))).toEqual([14.3, 33.6, 16.7, 32.7]);
    expect(L(WAS, 16) - L(NOW, 16)).toBeCloseTo(8.2, 1); expect(L(WAS, 21) - L(NOW, 21)).toBeCloseTo(9.6, 1);
    expect([16, 21].map((kn) => +moved(kn).toFixed(1))).toEqual([13.1, 12.4]);
  });
  it('the gale band is deeper and less colourful: 27, 33 and 40 kn sit 10.7, 7.4 and 3.2 L* deeper, and 27 kn keeps C* 24.7 of 44.0', () => {
    expect([27, 33, 40].map((kn) => +(L(WAS, kn) - L(NOW, kn)).toFixed(1))).toEqual([10.7, 7.4, 3.2]);
    expect([C(NOW, 27), C(WAS, 27), C(NOW, 33), C(WAS, 33)].map((v) => +v.toFixed(1))).toEqual([24.7, 44.0, 35.2, 44.5]);
    expect([27, 33, 40].map((kn) => +moved(kn).toFixed(1))).toEqual([11.6, 7.0, 3.0]);
  });
  it('THE STREAK\'S GROUND FIRST: no everyday ground (6 to 21 kn) is more than 4.7 L* lighter than it was over land (4.0 over the sea); the worst is 10 kn', () => {
    const lift = (surface) => Math.max(...KNOTS.filter((kn) => kn >= 6 && kn <= 21).map((kn) => L(NOW, kn, surface) - L(WAS, kn, surface)));
    expect(lift('land')).toBeCloseTo(4.7, 1); expect(lift('water')).toBeCloseTo(4.0, 1);
    expect(L(NOW, 10) - L(WAS, 10)).toBeCloseTo(4.7, 1);
  });
  it('the head of a streak (table model): shorter where the ground is lifted (22.4 L* at 10 kn over land, from 24.8), longer where it is deeper (36.8 at 16 kn from 30.9; 32.5 at 27 kn from 23.6)', () => {
    const marks = resolveDrawnMarks('beach', {});
    const step = (field, surface, kn) => { const S = marks[surface][kn].slice(1), G = on(field, surface, kn);
      return lch(glowComposite(G, glowOf(S.slice(0, 3), WHITE_STREAK.white).map((v) => (v + (1 - v) * 0.92 * WHITE_STREAK.ring) * S[3]), WHITE_STREAK.opacity)).L - lch(G).L; };
    const least = (field) => Math.min(...SURFACES.flatMap((s) => KNOTS.filter((kn) => kn >= 6).map((kn) => step(field, s, kn))));
    expect(least(NOW)).toBeCloseTo(18.5, 1); expect(least(WAS)).toBeCloseTo(19.6, 1);                        // the weakest is 8 kn over land, before and now
    expect([10, 16, 27].map((kn) => [+step(NOW, 'land', kn).toFixed(1), +step(WAS, 'land', kn).toFixed(1)])).toEqual([[22.4, 24.8], [36.8, 30.9], [32.5, 23.6]]);
    expect([10, 16, 27].map((kn) => [+step(NOW, 'water', kn).toFixed(1), +step(WAS, 'water', kn).toFixed(1)])).toEqual([[22.9, 24.6], [34.6, 30.4], [35.8, 29.2]]);
    for (const s of SURFACES) { expect(step(NOW, s, 10)).toBeLessThan(step(WAS, s, 10)); for (const kn of [16, 21, 27, 33]) expect(step(NOW, s, kn)).toBeGreaterThan(step(WAS, s, kn)); }
    for (const s of SURFACES) for (const kn of [3, 47, 63]) expect(Math.abs(step(NOW, s, kn) - step(WAS, s, kn))).toBeLessThan(0.05);   // and where the field did not move, neither does it
    // D-021'S PER-KNOT BARS, read on the field beach now draws (windWhiteStreak.test.js holds them on the tables under this kill).
    // Three hold: the head is lighter than its ground at every speed (by more than 8 L*), it is near-white (C* 21.5 or less), and from
    // 6 to 27 kn the ground is more colourful than the head. ONE IS CROSSED: "from a light breeze up the head stands 19.5 L* or more
    // off its ground" reads 18.5 at 8 kn over land, and under 19.5 at 7 and 8 kn on both grounds. Said here so a green run is not read as "held".
    const headOf = (surface, kn) => { const S = marks[surface][kn].slice(1), G = on(NOW, surface, kn);
      return glowComposite(G, glowOf(S.slice(0, 3), WHITE_STREAK.white).map((v) => (v + (1 - v) * 0.92 * WHITE_STREAK.ring) * S[3]), WHITE_STREAK.opacity); };
    for (const s of SURFACES) for (const kn of KNOTS) {
      expect(step(NOW, s, kn)).toBeGreaterThan(8); expect(lch(headOf(s, kn)).C).toBeLessThanOrEqual(21.5);
      if (kn >= 6 && kn <= 27) expect(lch(on(NOW, s, kn)).C).toBeGreaterThan(lch(headOf(s, kn)).C);
    }
    const under = SURFACES.flatMap((s) => KNOTS.filter((kn) => kn >= 6 && step(NOW, s, kn) < 19.5).map((kn) => `${s} ${kn}`));
    expect(under).toEqual(['land 7', 'land 8', 'water 7', 'water 8']);
    expect(SURFACES.flatMap((s) => KNOTS.filter((kn) => kn >= 6 && step(WAS, s, kn) < 19.5))).toEqual([]);         // the control: before, the bar held
  });
});
