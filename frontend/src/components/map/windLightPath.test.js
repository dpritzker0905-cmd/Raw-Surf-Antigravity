/**
 * LIGHT'S PATH: light's wind field, its streak row and its legend bar in dark's hue ORDER (windLightPath.js; DECISIONS D-024).
 * ON BY DEFAULT wherever the white streak draws in light.
 *
 * The owner, 2026-10-12: "you need to double check all this. The light and beach modes need to make sense logically. It could be the
 * way it is, or it could not be. It all has to make sense to match dark mode, but [in] their colors and maps"; then, shown a first
 * candidate moving beside dark with what it cost the streaks over land: "option 2, give the streaks their ground back".
 *
 * What the check found: dark carries speed in the ORDER of its hues, one way round the wheel. Light ran that order except at 10 kn
 * (an orchid, the colour dark gives calm air) and 21 kn (a teal behind 16 kn's green, and lighter than it). This file pins:
 *   - THE SWITCH: on only where the white streak draws in light; the kill restores light's field, streak row and legend bar byte for
 *     byte (the hashes are windWhiteStreak.test.js's WATCHED, captured from the code before this change); beach and dark never move;
 *   - THE ORDER, THE LIGHTNESS, THE EDGE, THE FLOOR, each with the table before it as its positive control (the kill's arm);
 *   - THE LEGEND moved with the field, and the particle ramp NOT moved (every older kill draws its marks from it);
 *   - WHAT IT COSTS, as numbers.
 * Dark is read by the ENGINE's law (its field lands at alpha squared over its map), pinned from the engine's own source below. The
 * palette checker (scripts/wind-color/check.mjs) and the GPU bench are the authorities; these are the tables and the model.
 */
import fs from 'fs';
import path from 'path';
import { LIGHT_PATH, lightPathRows, lightTables } from './windLightPath';
import { windLightPathOn, windWhiteStreakOn, windDarkRulesOn, DARK_RULES_HOLDS, DARK_RULES_STEERS, resolveDrawnField, resolveDrawnMarks, drawnMarkRampData, buildFieldRampTexture,
  windLookKey, resolveThemeRamp, resolveLegendRamp, windLegendGradientCSS, generateRampData, huePathStops, sampleRamp } from './WindColorRamp';
import { windInk } from './windInk';
import { resolveWindParticlesV2 } from './WebGLWindUtils';
import { muteColor, windBasemapMuteAmount, windBasemapWaterL, windBasemapLandL } from './windBasemapMute';

const V2 = resolveWindParticlesV2({});
const KILL = { __RAW_DISABLE_WIND_LIGHT_PATH__: true };
const STEERS = { __RAW_WIND_FIELD_TINT__: 0.9, __RAW_WIND_FIELD_TINT_THEMES__: 'beach', __RAW_WIND_PREMUL_THEMES__: 'light', __RAW_WIND_BASEMAP_MUTE__: 0.5, __RAW_WIND_BASEMAP_WATER_L__: 0.95 };
// Everything that stands the white streak down in light (windDarkRules.test.js and windWhiteStreak.test.js sweep these for the layers under this one).
const STAND_DOWN = [{ __RAW_DISABLE_WIND_WHITE_STREAK__: true }, { __RAW_DISABLE_WIND_DARK_RULES__: true }, { __RAW_WIND_DARK_RULES__: false }, { __RAW_WIND_DARK_RULES__: 'beach' },
  { __RAW_DISABLE_WIND_DARK_WHITE__: true },   // D-022's kill restores D-021's picture: full white over the tables IT was drawn on (an older kill keeps its meaning; independent review, 2026-10-12)
  { __WIND_CANVAS_FALLBACK__: true },          // the Canvas2D fallback is the wind's renderer: it samples the particle ramp, so the bar stays that ramp
  ...DARK_RULES_HOLDS.map((k) => ({ [k]: true })), ...Object.entries(STEERS).map(([k, v]) => ({ [k]: v })),
  { __RAW_WIND_INK__: true }, { __RAW_WIND_GLOW__: true }, { __RAW_WIND_THEME_V2__: true }, { __RAW_WIND_LIGHT_LOOK__: 'moderate' }, { __RAW_WIND_LIGHT_LOOK__: 'deep' }, { __RAW_WIND_LIGHT_LOOK__: 'ink' }];

const fnv = (a) => { let h = 2166136261; for (const b of a) h = Math.imul(h ^ b, 16777619); return (h >>> 0).toString(16); };
const rampGl = () => { const gl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4, CLAMP_TO_EDGE: 5, LINEAR: 6, TEXTURE_WRAP_S: 7, TEXTURE_WRAP_T: 8, TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10,
  getParameter: () => null, createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {} }; gl.texImage2D = (...a) => { gl.uploaded = a[8]; }; return gl; };
/** [marks row 0 (land), marks row 1 (sea), field] as FNV-1a of the 256-entry RGBA tables the engine uploads. */
const hashes = (theme, w, max) => { const marks = drawnMarkRampData(max, theme, w), gl = rampGl(); buildFieldRampTexture(gl, max, theme, w);
  return [fnv(marks.subarray(0, 1024)), fnv(marks.subarray(1024)), gl.uploaded ? fnv(gl.uploaded) : null]; };
// What light, beach and dark drew at ec8f46a2 (dev, PR #314's merge) with no lever: windWhiteStreak.test.js's WATCHED and DARK, captured
// from the running code before D-021 moved the default and verified green on the unedited tree before this change (LESSONS L-V25).
const BEFORE = { light: { 50: ['71ea0097', '71ea0097', 'f73f7078'], 75: ['a49922ce', 'a49922ce', 'f9ffc9c2'] },
  beach: { 50: ['6e75db94', '72b4bd7f', '7c248d5f'], 75: ['be558fd8', 'cd4835ed', 'b9db3bb2'] }, dark: { 50: ['c2ebc33e', 'c2ebc33e', null] } };
// What light draws on its path with no lever: the tables that were filmed beside dark (the wind bench's runs light-2lvl-z4, -z6, -z9 and
// ramp-light-now, 2026-10-12) and the legend bar's CSS. Any edit to LIGHT_PATH moves these: re-film and re-check before re-pinning.
const NOW = { 50: ['b9cf6f25', 'b9cf6f25', '7c17c193'], 75: ['ad6b7fa5', 'ad6b7fa5', 'be9bf367'], bar: '580b7236' };

// ── colour: CIELAB D65 and the checker's colour-blind distance (coloraide 8.13's Vienot protan/deutan and Brettel tritan, as windPaletteCvd.test.js) ──
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
const VIENOT = { protan: [[0.11238276122216405, 0.8876172387778362, 0], [0.11238276122216398, 0.8876172387778362, 0], [0.0040057682730469425, -0.004005768273046939, 1]],
  deutan: [[0.2927501142784356, 0.7072498857215644, 0], [0.2927501142784356, 0.7072498857215644, 0], [-0.022336587034129083, 0.022336587034129093, 1]] };
const LMS = [[0.178824041258, 0.4351609057000001, 0.04119349692], [0.034556423182, 0.27155382458, 0.03867130836], [0.000299565576, 0.0018430896, 0.01467086136]];
const TRITAN = { w1: [[7.392856536180033, -11.148044821248138, 0], [-0.34194012421930653, 3.5501661175064, 0], [-4.2050692716448586, 10.89115898202731, 0]],
  w2: [[8.0643934576311, -12.42414705871019, 0], [-0.9956078228581946, 4.7923119863996835, 0], [-0.2150297288038942, 3.3090019545637928, 0]], sep: [0.344781556122, -0.655178443878, 0] };
const simulate = (rgb, kind) => { const lin = rgb.map(dec); if (kind !== 'tritan') return labLin(mm(VIENOT[kind], lin));
  const lms = mm(LMS, lin), side = lms[0] * TRITAN.sep[0] + lms[1] * TRITAN.sep[1]; return labLin(mm(side > 0 ? TRITAN.w2 : TRITAN.w1, lms)); };
const colourBlind = (a, b) => Math.min(...['protan', 'deutan', 'tritan'].map((k) => de2000(simulate(a, k), simulate(b, k))));
const normal = (a, b) => de2000(lab(a), lab(b));
const arc = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };

// ── the composites: light's multiply tint over its muted land and sea (check.mjs MODEL); dark's field by the engine's law ──
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const bare = (surface) => { const c = surface === 'water' ? [168, 214, 222] : [236, 236, 232];
  const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${c.join(', ')})`, windBasemapMuteAmount('light', {}), surface === 'water' ? windBasemapWaterL('light', {}) : 1)); return [+m[1], +m[2], +m[3]].map((v) => v / 255); };
const BARE = { land: bare('land'), water: bare('water') };
const strength = (kn) => Math.min(1, 0.65 * (0.42 + 0.58 * ss(0, 7, kn)) * (0.70 / 0.65));
const FIELD = { now: huePathStops(resolveDrawnField('light', {}), {}), was: huePathStops(resolveDrawnField('light', KILL), {}) };
/** Light's field ON SCREEN at `kn` over its muted land or sea: `arm` is 'now' (the default) or 'was' (the kill). */
const onScreen = (arm, kn, surface = 'land') => { const F = sampleRamp(FIELD[arm], kn), s = strength(kn); return BARE[surface].map((v, i) => v * (1 - s * (1 - F[i]))); };
const DARK_LEGEND = huePathStops(resolveThemeRamp('dark'), {}), DARK_LAND = [18, 20, 26].map((v) => v / 255);   // the dark style's land (the wind bench's offline colour)
/** Dark's field on screen over its land: field x alpha squared + map x (1 - alpha). */
const darkOn = (kn) => { const a = 0.48 * (0.44 + 0.56 * ss(0, 5, kn)), F = sampleRamp(DARK_LEGEND, kn); return DARK_LAND.map((g, i) => F[i] * a * a + g * (1 - a)); };
const BEAUFORT = [3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75], SURFACES = ['land', 'water'];
/** How many times a hue turns back along speed (steps under 4 degrees and greys do not count). */
const reversals = (colourAt, to = 60) => { let prev = null, dir = 0, turns = 0;
  for (let kn = 0; kn <= to; kn++) { const q = lch(colourAt(kn)); if (q.C < 8) continue; if (prev !== null) { const d = arc(prev, q.h), s = Math.abs(d) > 4 ? Math.sign(d) : 0; if (s && dir && s !== dir) turns++; if (s) dir = s; } prev = q.h; }
  return turns; };
const steepest = (colourAt, to = 60) => { let w = 0; for (let kn = 1; kn <= to; kn++) w = Math.max(w, normal(colourAt(kn - 1), colourAt(kn))); return w; };
const largestRise = (arm, surface, to = 33) => { let w = -Infinity; for (let kn = 1; kn <= to; kn++) w = Math.max(w, lch(onScreen(arm, kn, surface)).L - lch(onScreen(arm, kn - 1, surface)).L); return w; };
const weakest = (dist, arm, surface) => Math.min(...BEAUFORT.slice(1).map((kn, i) => dist(onScreen(arm, BEAUFORT[i], surface), onScreen(arm, kn, surface))));

describe('the switch: on where the white streak draws in light, and the kill restores what light drew, byte for byte', () => {
  it('is on for light with no lever, never for beach or dark, and only an exactly true kill turns it off', () => {
    expect(windLightPathOn('light', {})).toBe(true);
    expect(windLightPathOn('light', KILL)).toBe(false);
    for (const v of [1, 'true', 'yes', {}, null, undefined, false]) expect(windLightPathOn('light', { __RAW_DISABLE_WIND_LIGHT_PATH__: v })).toBe(true);
    for (const theme of ['beach', 'dark', undefined]) for (const w of [{}, KILL]) expect(windLightPathOn(theme, w)).toBe(false);
    expect(windLightPathOn('light', { __RAW_DISABLE_WIND_DARK_WHITE__: true })).toBe(false);  // D-022's kill is D-021's picture, tables and all: it steps back past the path first (LESSONS L-V25)
    expect(hashes('light', { __RAW_DISABLE_WIND_DARK_WHITE__: true }, 50)).toEqual(BEFORE.light[50]);
    expect(windWhiteStreakOn('light', KILL)).toBe(true); expect(windDarkRulesOn('light', KILL)).toBe(true);   // and this kill steps back ONE layer, no further
  });
  it.each([50, 75])('the kill draws the field and the streak row light drew before, byte for byte; the default draws others (%i kn)', (max) => {
    expect(hashes('light', KILL, max)).toEqual(BEFORE.light[max]);
    const now = hashes('light', {}, max);
    expect(now).toEqual(NOW[max]);                                                                   // THE DEFAULT'S OWN BYTES: the tables that were filmed
    expect(now[0]).not.toBe(BEFORE.light[max][0]); expect(now[2]).not.toBe(BEFORE.light[max][2]);   // the positive control: both tables moved
    expect(now[0]).toBe(now[1]);                                                                     // still one streak row over land and sea
  });
  it('beach and dark are not touched: their tables are what they were, with and without the kill', () => {
    const B = { __RAW_DISABLE_WIND_BEACH_PATH__: true };   // beach's own path (windBeachPath.js, D-025) has since moved beach's field: BEFORE.beach is what beach draws under ITS kill
    for (const w of [{}, KILL]) { expect(hashes('beach', { ...w, ...B }, 50)).toEqual(BEFORE.beach[50]); expect(hashes('beach', { ...w, ...B }, 75)).toEqual(BEFORE.beach[75]); expect(hashes('dark', w, 50)).toEqual(BEFORE.dark[50]); }
    for (const max of [50, 75]) expect(hashes('beach', {}, max)).toEqual(hashes('beach', KILL, max));   // and beach on its path does not read this kill
    for (const theme of ['beach', 'dark']) { expect(windLookKey(theme, {})).toBe(windLookKey(theme, KILL)); expect(windLegendGradientCSS(theme, {})).toBe(windLegendGradientCSS(theme, KILL)); expect(windInk(theme, V2, {})).toEqual(windInk(theme, V2, KILL)); }
  });
  it.each(STAND_DOWN.map((w) => [JSON.stringify(w), w]))('whatever stands the white streak down stands this down, and draws exactly what it drew: %s', (_, w) => {
    const v2 = resolveWindParticlesV2(w);
    expect(windLightPathOn('light', w)).toBe(false);
    expect(hashes('light', w, 50)).toEqual(hashes('light', { ...w, ...KILL }, 50));
    expect(windLookKey('light', w)).toBe(windLookKey('light', { ...w, ...KILL }));
    expect(windLegendGradientCSS('light', w)).toBe(windLegendGradientCSS('light', { ...w, ...KILL }));
    expect(windInk('light', v2, w)).toEqual(windInk('light', v2, { ...w, ...KILL }));
  });
  it('the sweep above covers every hold and every steering lever dark\'s rules name', () => {
    expect(Object.keys(STEERS).sort()).toEqual([...DARK_RULES_STEERS].sort());
    expect(STAND_DOWN.length).toBe(6 + DARK_RULES_HOLDS.length + DARK_RULES_STEERS.length + 6);
  });
  it('the look key names the path, so the engine rebuilds its tables the moment the kill is set; the mark model does not move', () => {
    expect(windLookKey('light', {})).toBe('white+path|dark-rules');
    expect(windLookKey('light', KILL)).toBe('white|dark-rules');
    expect(windLookKey('beach', {})).toBe('white+path|dark-rules'); expect(windLookKey('beach', KILL)).toBe('white+path|dark-rules');   // beach's own path names its key (D-025); this kill does not move it
    expect(windLookKey('dark', {})).toBe('|');
    expect(windInk('light', V2, {})).toEqual(windInk('light', V2, KILL));   // the streak is drawn the same way: this change is its tables
    const ENGINE = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(ENGINE.match(/lookKey !== this\._lookKey/g)).toHaveLength(2);    // both of the engine's ramp builds compare the key
  });
  it('only rows 1 to 32 kn are the path\'s: calm and every row from 33 kn are the rows before it, in the field and in the streak row', () => {
    expect([LIGHT_PATH.from, LIGHT_PATH.to]).toEqual([1, 32]);
    expect(Object.isFrozen(LIGHT_PATH)).toBe(true);
    for (const rows of [LIGHT_PATH.field, LIGHT_PATH.marks]) {
      expect(rows.map((r) => r[0])).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
      for (const r of rows) for (const c of r.slice(1)) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    }
    const outside = (rows) => rows.filter((r) => r[0] < 1 || r[0] > 32);
    expect(outside(resolveDrawnField('light', {}))).toEqual(outside(resolveDrawnField('light', KILL)));
    expect(outside(resolveDrawnMarks('light', {}).land)).toEqual(outside(resolveDrawnMarks('light', KILL).land));
    expect(outside(resolveDrawnField('light', {})).map((r) => r[0])).toEqual([0, 33, 40, 47, 55, 63, 75]);
    for (const kn of [0, 33, 40, 55, 75]) for (const surface of SURFACES) expect(onScreen('now', kn, surface)).toEqual(onScreen('was', kn, surface));
    expect(lightPathRows([[0, 9], [3, 9], [16, 9], [33, 9], [75, 9]], [[1, 7], [32, 7]])).toEqual([[0, 9], [1, 7], [32, 7], [33, 9], [75, 9]]);
  });
  it('lightTables: off the path, the tables handed in; on it, their 1 to 32 kn rows replaced, one streak row for land and sea, built once', () => {
    const field = [[0, 9], [3, 9], [33, 9]], marks = [[0, 8], [16, 8], [75, 8]];
    const off = lightTables(false, field, marks);
    expect(off.field).toBe(field); expect(off.land).toBe(marks); expect(off.water).toBe(marks);
    const on = lightTables(true, field, marks), owned = (rows) => rows.filter((r) => r[0] >= LIGHT_PATH.from && r[0] <= LIGHT_PATH.to);
    expect(owned(on.field)).toEqual(LIGHT_PATH.field); expect(owned(on.land)).toEqual(LIGHT_PATH.marks); expect(on.water).toBe(on.land);
    expect(lightTables(true, field, marks)).toBe(on);                                                // built once (the app hands in the same two constants every time)
    expect(lightTables(false, field, marks).field).toBe(field);                                      // and it never leaks into the kill's arm
  });
  it('the tables handed out are the caller\'s own copies', () => {
    const f = resolveDrawnField('light', {}); f[5][1] = 9;
    expect(resolveDrawnField('light', {})[5][1]).not.toBe(9);
    const m = resolveDrawnMarks('light', {}); m.land[5][1] = 9;
    expect(resolveDrawnMarks('light', {}).land[5][1]).not.toBe(9);
    const l = resolveLegendRamp('light', {}); l[2][1] = 9; l[0][1] = 9; l[8][1] = 9;                  // a row the path replaced, and two it kept
    for (const i of [0, 2, 8]) expect(resolveLegendRamp('light', {})[i][1]).not.toBe(9);
    expect(resolveThemeRamp('light')[0][1]).not.toBe(9); expect(resolveThemeRamp('light')[8][1]).not.toBe(9);   // and the particle ramp behind it is not reached
    for (const r of [...LIGHT_PATH.field, ...LIGHT_PATH.marks, ...Object.values(LIGHT_PATH.legend)]) expect(Object.isFrozen(r)).toBe(true);
  });
});

describe('the engine\'s own call shape: no lever object, the kill on the real window', () => {
  const fieldHash = (max) => { const gl = rampGl(); buildFieldRampTexture(gl, max, 'light'); return fnv(gl.uploaded); };
  const asTheEngineReads = (max) => { const marks = drawnMarkRampData(max, 'light'); return [fnv(marks.subarray(0, 1024)), fnv(marks.subarray(1024)), fieldHash(max)]; };
  afterEach(() => { delete window.__RAW_DISABLE_WIND_LIGHT_PATH__; });
  it('with nothing on the window it draws the path; the kill on the window flips the key, the tables and the bar\'s ramp at once, and clearing it flips them back', () => {
    const now = asTheEngineReads(50), bar = windLegendGradientCSS('light');
    expect(windLightPathOn('light')).toBe(true); expect(windLookKey('light')).toBe('white+path|dark-rules');
    expect(now).toEqual(hashes('light', {}, 50)); expect(now).not.toEqual(BEFORE.light[50]);
    window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true;
    expect(windLightPathOn('light')).toBe(false); expect(windLookKey('light')).toBe('white|dark-rules');
    expect(asTheEngineReads(50)).toEqual(BEFORE.light[50]); expect(asTheEngineReads(75)).toEqual(BEFORE.light[75]);
    expect(windLegendGradientCSS('light')).not.toBe(bar);
    delete window.__RAW_DISABLE_WIND_LIGHT_PATH__;
    expect(windLookKey('light')).toBe('white+path|dark-rules'); expect(asTheEngineReads(50)).toEqual(now); expect(windLegendGradientCSS('light')).toBe(bar);
  });
  it('the RENDERED bar follows at its next render: the controls key the legend\'s memo on the look key (it was [theme, heightUnit]: a kill set after first paint left the path\'s bar beside the old field)', () => {
    const CONTROLS = fs.readFileSync(path.join(__dirname, 'MapWeatherControls.js'), 'utf8');
    expect(CONTROLS).toMatch(/\}, \[theme, heightUnit, windLookKey\(theme\)\]\);/);
    expect(windLookKey('light', {})).not.toBe(windLookKey('light', KILL));   // so the key the memo watches does move with the kill
  });
  it('the Canvas2D fallback says it is the wind\'s renderer, and the bar is then the particle ramp its marks sample', () => {
    const OVERLAY = fs.readFileSync(path.join(__dirname, 'WindParticleOverlay.js'), 'utf8');
    expect(OVERLAY).toMatch(/window\.__WIND_CANVAS_FALLBACK__ = true; return function\(\) \{ delete window\.__WIND_CANVAS_FALLBACK__; \}; \}, \[\]\);/);
    expect(OVERLAY).toMatch(/var ramp = THEME_RAMPS\[theme\] \|\| THEME_RAMPS\.dark;/);            // the fallback's marks: the particle ramp
    try {
      window.__WIND_CANVAS_FALLBACK__ = true;
      expect(windLightPathOn('light')).toBe(false);
      expect(resolveLegendRamp('light')).toEqual(resolveThemeRamp('light'));
      expect(windLegendGradientCSS('light')).toBe(windLegendGradientCSS('light', KILL));
    } finally { delete window.__WIND_CANVAS_FALLBACK__; }
    expect(windLightPathOn('light')).toBe(true);
  });
});

describe('the order is dark\'s: the hue runs one way with speed', () => {
  it('dark is read by the engine\'s own law: its field is written premultiplied and blended with SRC_ALPHA, so it lands at alpha squared', () => {
    const SHADERS = fs.readFileSync(path.join(__dirname, 'WebGLWindShaders.js'), 'utf8'), ENGINE = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(SHADERS).toMatch(/: vec4\(fieldRgb \* alpha, alpha\);/);
    expect(ENGINE).toMatch(/else blendIntoMap\(gl, gl\.SRC_ALPHA, gl\.ONE_MINUS_SRC_ALPHA\); \/\/ field tint: multiply/);
    // blendIntoMap (windCanvasAlpha.js, D-027) hands the COLOUR's two factors through in both of its arms; only the canvas's own alpha is kept
    const ALPHA = fs.readFileSync(path.join(__dirname, 'windCanvasAlpha.js'), 'utf8');
    expect(ALPHA).toMatch(/gl\.blendFuncSeparate\(src, dst, gl\.ZERO, gl\.ONE\);/); expect(ALPHA).toMatch(/else gl\.blendFunc\(src, dst\);/);
  });
  it('the hue never turns back from calm to 60 kn; before, it turned back four times; dark, read by the same instrument, never does', () => {
    expect(reversals((kn) => onScreen('now', kn))).toBe(0);
    expect(reversals((kn) => onScreen('now', kn, 'water'))).toBe(0);
    expect(reversals((kn) => onScreen('was', kn))).toBe(4);       // the control: 10 kn an orchid behind 6 kn's periwinkle, 21 kn a teal behind 16 kn's green
    expect(reversals(darkOn)).toBe(0);
  });
  it('at every Beaufort stop from 3 to 21 kn light\'s hue over its land is within 20 degrees of dark\'s over its land; before, 10 kn sat 141 degrees away', () => {
    const gap = (arm, kn) => Math.abs(arc(lch(darkOn(kn)).h, lch(onScreen(arm, kn)).h));
    for (const kn of [3, 6, 10, 16, 21]) expect(gap('now', kn)).toBeLessThanOrEqual(20.2);
    for (let kn = 3; kn <= 21; kn++) expect(gap('now', kn)).toBeLessThanOrEqual(25);             // between stops light's hue moves at an even pace where dark's rushes from 5 to 6 kn
    expect(gap('was', 10)).toBeGreaterThan(135); expect(gap('was', 21)).toBeGreaterThan(25);     // the control: an orchid where dark is aqua, a teal where dark is yellow-green
    expect(Math.round(lch(onScreen('was', 10)).h)).toBe(318); expect(Math.round(lch(onScreen('now', 10)).h)).toBe(197);
  });
  it('no knot draws a harder edge than dark\'s own hardest; before, 11 to 12 kn stepped 16 dE00', () => {
    const dark = steepest(darkOn);
    expect(dark).toBeGreaterThan(8.5); expect(dark).toBeLessThan(9.3);
    for (const surface of SURFACES) expect(steepest((kn) => onScreen('now', kn, surface))).toBeLessThan(8.0);
    expect(steepest((kn) => onScreen('was', kn))).toBeGreaterThan(15.5);
  });
  it('the field keeps its colour at every knot from 3 to 40: no grey on the path, over land or sea', () => {
    for (let kn = 3; kn <= 40; kn++) { expect(lch(onScreen('now', kn)).C).toBeGreaterThan(21); expect(lch(onScreen('now', kn, 'water')).C).toBeGreaterThan(17.5); }
  });
});

describe('the lightness runs one way, on two levels for the white streak', () => {
  it('lightness never rises from calm to 33 kn, over land or sea; before, it rose 4.3 L* from 16 to 21 kn', () => {
    for (const surface of SURFACES) expect(largestRise('now', surface)).toBeLessThan(0.05);
    expect(largestRise('was', 'land')).toBeGreaterThan(0.9);
    expect(lch(onScreen('was', 21)).L - lch(onScreen('was', 16)).L).toBeGreaterThan(4);
    expect(lch(onScreen('now', 21)).L - lch(onScreen('now', 16)).L).toBeLessThan(0.05);
  });
  it('TWO LEVELS: 6 to 10 kn at L* 65, 16 to 27 kn at L* 60 (the ground a white streak stands on); 10 kn is 5.8 lighter than before, 21 kn 1.3 deeper', () => {
    for (let kn = 6; kn <= 10; kn++) { const L = lch(onScreen('now', kn)).L; expect(L).toBeGreaterThan(64.7); expect(L).toBeLessThan(65.3); }
    for (let kn = 16; kn <= 27; kn++) { const L = lch(onScreen('now', kn)).L; expect(L).toBeGreaterThan(59.9); expect(L).toBeLessThan(60.3); }
    expect(lch(onScreen('now', 10)).L - lch(onScreen('was', 10)).L).toBeCloseTo(5.8, 1);
    expect(lch(onScreen('now', 16)).L - lch(onScreen('was', 16)).L).toBeCloseTo(3.0, 1);
    expect(lch(onScreen('now', 21)).L - lch(onScreen('was', 21)).L).toBeCloseTo(-1.3, 1);
    expect(lch(onScreen('now', 0)).L).toBeCloseTo(78.7, 1); expect(lch(onScreen('now', 33)).L).toBeCloseTo(53.6, 1);   // calm and the gold are the rows before
  });
});

describe('the colour-blind floor holds, with the bands in order', () => {
  it('neighbouring Beaufort stops from 3 kn are 5.0 dE2000 or more apart for protan, deutan and tritan, over the sea AND over the land as the mute alone leaves it (the deeper land of PR #320: the pin below)', () => {
    expect(weakest(colourBlind, 'now', 'water')).toBeGreaterThanOrEqual(5.0);   // 5.1: 21-27 kn, protan
    expect(weakest(colourBlind, 'now', 'land')).toBeGreaterThanOrEqual(5.4);
    expect(weakest(colourBlind, 'was', 'water')).toBeGreaterThanOrEqual(5.4);   // what the reversals bought: 5.5 and 5.6
    expect(weakest(colourBlind, 'was', 'land')).toBeGreaterThanOrEqual(5.5);
  });
  // AS UPLOADED. The engine draws the field from a 256-entry, 8-bit texture built for the data's own maximum (held between 10 and 80 kn,
  // WebGLWindEngine.js), not from the table the palette checker reads. The beach lane's read (windBeachPath.test.js), applied to light: a
  // stop at `kn` is read at kn / max * 255, linear between two texels; a pair wholly above the maximum is not drawn and not scored. A
  // model, not a read of the canvas: the shader's own sampling may sit half a texel off, and the framebuffer rounds to 8 bits again.
  const NO_DEPTH = { __RAW_DISABLE_WIND_LAND_DEPTH__: true };   // the land as the mute alone leaves it (PR #320's kill): the land every test above scores
  const groundOf = (surface, win) => { const c = surface === 'water' ? [168, 214, 222] : [236, 236, 232];
    const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${c.join(', ')})`, windBasemapMuteAmount('light', win), surface === 'water' ? windBasemapWaterL('light', win) : windBasemapLandL('light', win)));
    return [+m[1], +m[2], +m[3]].map((v) => v / 255); };
  const tableOf = (win) => { const T = huePathStops(resolveDrawnField('light', win), {}); return (kn) => sampleRamp(T, kn); };
  const uploadedOf = (win, max) => { const gl = rampGl(), tab = tableOf(win); buildFieldRampTexture(gl, max, 'light', win); const texel = (i) => [0, 1, 2].map((c) => gl.uploaded[i * 4 + c] / 255);
    return (kn) => { if (kn > max) return tab(kn); const x = Math.min(255, (kn / max) * 255), i = Math.min(254, Math.floor(x)), t = x - i, a = texel(i), b = texel(i + 1); return a.map((v, c) => v + (b[c] - v) * t); }; };
  const tint = (ground, at, kn) => { const F = at(kn), s = strength(kn); return ground.map((v, c) => v * (1 - s * (1 - F[c]))); };
  /** The weakest pair of neighbouring Beaufort stops for a colour-blind viewer, over `ground`, the field read through `at`. */
  const line = (ground, at, max = Infinity) => { let w = Infinity; for (let i = 1; i < BEAUFORT.length; i++) if (BEAUFORT[i - 1] < max) w = Math.min(w, colourBlind(tint(ground, at, BEAUFORT[i - 1]), tint(ground, at, BEAUFORT[i]))); return w; };
  /** Every maximum the engine can pick, a quarter knot apart: the least the line reads, and at how many of them it is under 5. */
  const sweep = (surface, win) => { const g = groundOf(surface, win); let least = Infinity, under = 0, n = 0;
    for (let max = 10; max <= 80; max += 0.25) { const d = line(g, uploadedOf(win, max), max); n++; if (d < 5) under++; least = Math.min(least, d); }
    return { least, under, n }; };
  const DEEPER = { __RAW_DISABLE_WIND_LAND_STEP__: true };   // the land at the sea's depth, as PR #320 merged it: since the land a step above the sea (D-026 amended, 2026-10-12) it is that step's kill
  it('ON THE DEEPER LAND (PR #320, now the land step\'s kill) THERE IS NO MARGIN, and AS UPLOADED the line dips UNDER 5: the table reads 5.01; the 8-bit texture 5.03 at a 50 kn maximum, 4.99 at 75 kn, 4.86 at the least', () => {
    // The owner, 2026-10-12 17:43Z, shown these numbers and two options: "option 1, merge as shown and add the pin" (DECISIONS D-024, amended).
    // THIS IS A KNOWN SHORTFALL, PINNED SO A GREEN RUN NEVER READS AS "THE FLOOR HOLDS". The bar is still 5.0: light's rows are re-solved on the
    // deeper land next (ledger commitment), and these numbers are re-pinned then.
    const DEEP = groundOf('land', DEEPER), PALE = groundOf('land', NO_DEPTH), SEA = groundOf('water', {});
    expect(windBasemapLandL('light', DEEPER)).toBe(0.81); expect(windBasemapLandL('light', NO_DEPTH)).toBe(1);   // the deeper land: what drew with no lever until the land step
    // the table, as the palette checker reads it (`node check.mjs --strict` prints 5.0 and no red line)
    expect(line(DEEP, tableOf({}))).toBeGreaterThanOrEqual(5.0); expect(line(DEEP, tableOf({}))).toBeCloseTo(5.006, 2);
    expect(line(PALE, tableOf(NO_DEPTH))).toBeCloseTo(5.503, 2); expect(line(SEA, tableOf({}))).toBeCloseTo(5.130, 2);
    // as uploaded
    expect(line(DEEP, uploadedOf({}, 50), 50)).toBeCloseTo(5.033, 2);
    expect(line(DEEP, uploadedOf({}, 75), 75)).toBeCloseTo(4.987, 2);                                                // under the bar
    const deep = sweep('land', DEEPER);
    expect(deep.n).toBe(281); expect(deep.least).toBeCloseTo(4.859, 2); expect(deep.under).toBe(151);                // under 5 at about half of the maxima, by up to 0.14
    const sea = sweep('water', {});
    expect(sea.least).toBeCloseTo(4.960, 2); expect(sea.under).toBe(12);
    // the controls. Light before its path on the same land (dev's own light): the deeper land takes most of the margin, this change the rest.
    const was = sweep('land', { ...KILL, ...DEEPER });
    expect(line(DEEP, tableOf(KILL))).toBeCloseTo(5.053, 2); expect(was.least).toBeCloseTo(4.928, 2); expect(was.under).toBe(21);
    // And the land before PR #320: never under, read either way.
    const pale = sweep('land', NO_DEPTH);
    expect(pale.least).toBeCloseTo(5.364, 2); expect(pale.under).toBe(0);
  });
  it('ON THE LAND AS IT DRAWS NOW (a step above the sea, D-026 amended) the line holds 5.0 over land, read from the table and as uploaded at every maximum', () => {
    // The land took the sea's own factor (0.90) on 2026-10-12 so the map shows through at the far-out zooms; a lighter ground gives the tint more room.
    // The SEA's line is not moved by it and still dips (the pin above): light's re-solve is for the sea.
    const STEP = groundOf('land', {});
    expect(windBasemapLandL('light', {})).toBe(0.9);
    expect(line(STEP, tableOf({}))).toBeGreaterThanOrEqual(5.0);
    const step = sweep('land', {});
    expect(step.n).toBe(281); expect(step.under).toBe(0); expect(step.least).toBeGreaterThanOrEqual(5.0);
    expect(step.least).toBeGreaterThan(sweep('land', DEEPER).least + 0.2);            // and by a margin the deeper land did not have
  });
  it('THE COST, said plainly: the weakest normal-vision neighbours are 8.0 apart (9.0 before), and 6 to 16 kn carry a third less colour', () => {
    expect(weakest(normal, 'now', 'water')).toBeGreaterThanOrEqual(7.9); expect(weakest(normal, 'now', 'water')).toBeLessThan(8.3);
    expect(weakest(normal, 'was', 'water')).toBeGreaterThanOrEqual(8.9);
    for (const kn of [6, 10, 16]) { expect(lch(onScreen('now', kn)).C).toBeLessThan(33); expect(lch(onScreen('was', kn)).C).toBeGreaterThan(44); }
    for (const kn of [6, 10, 16]) expect(lch(onScreen('now', kn)).C).toBeGreaterThan(lch(darkOn(kn)).C);   // still more colour than dark's own field shows there
  });
});

describe('each streak\'s colour core follows the field', () => {
  it('rows 1 to 32 kn: the field\'s own hue over the land (within 3 degrees), at full brightness, 14 L* or more above the field', () => {
    for (const r of LIGHT_PATH.marks) {
      const core = lch(r.slice(1, 4)), field = lch(onScreen('now', r[0]));
      expect(Math.max(...r.slice(1, 4))).toBe(1);
      expect(Math.abs(arc(field.h, core.h))).toBeLessThan(3);
      expect(core.L).toBeGreaterThanOrEqual(field.L + 13.8);
      if (r[0] >= 6) expect(core.C).toBeGreaterThan(30);            // and it keeps its colour: as colourful as its hue allows (a core washed toward white fails here and on the bytes above)
      expect(r[4]).toBe(LIGHT_PATH.field[r[0] - 1][4]);              // and the field's own alpha, knot for knot
    }
    const m = resolveDrawnMarks('light', {}); expect(m.land).toEqual(m.water);
  });
});

describe('the legend bar moves with the field; the particle ramp does not move', () => {
  const bar = (w) => resolveLegendRamp('light', w), particle = resolveThemeRamp('light');
  it('the bar\'s 3 to 27 kn rows are the path\'s; calm, 33 kn up and every alpha are the particle ramp\'s; the kill restores it whole', () => {
    expect(bar(KILL)).toEqual(particle);
    const now = bar({});
    expect(now.map((s) => s[0])).toEqual(particle.map((s) => s[0]));
    now.forEach((s, i) => { expect(s[4]).toBe(particle[i][4]); if (i === 0 || i > 6) expect(s).toEqual(particle[i]); else { expect(s).toEqual(LIGHT_PATH.legend[i]); expect(s).not.toEqual(particle[i]); } });
    expect(Object.keys(LIGHT_PATH.legend)).toEqual(['1', '2', '3', '4', '5', '6']);
    for (const theme of ['beach', 'dark']) expect(resolveLegendRamp(theme, {})).toEqual(resolveThemeRamp(theme));
  });
  it('THE PARTICLE RAMP NEVER MOVES: the marks every older kill draws come from it, whatever the path does', () => {
    for (const max of [50, 75]) expect(Array.from(generateRampData(max, null, 'light', {}))).toEqual(Array.from(generateRampData(max, null, 'light', KILL)));
    try { window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true; expect(resolveThemeRamp('light')).toEqual(particle); } finally { delete window.__RAW_DISABLE_WIND_LIGHT_PATH__; }
    const marks = drawnMarkRampData(75, 'light', { __RAW_DISABLE_WIND_DARK_RULES__: true });   // the tables before dark's rules: the particle ramp's own LUT, as on dev
    expect(Array.from(marks.subarray(0, 1024))).toEqual(Array.from(generateRampData(75, null, 'light', { __RAW_DISABLE_WIND_DARK_RULES__: true })));
  });
  it('each row is the hue the field draws at that stop (within 6.5 degrees), and the bar stays within 30 degrees of the field at every half knot from 3 to 40', () => {
    const now = huePathStops(bar({}), {}), was = huePathStops(particle, {});
    for (const i of [1, 2, 3, 4, 5, 6]) expect(Math.abs(arc(lch(onScreen('now', bar({})[i][0])).h, lch(bar({})[i].slice(1, 4)).h))).toBeLessThan(6.5);
    const off = (legend, surface) => { let worst = 0; for (let kn = 3; kn <= 40; kn += 0.5) { const p = lch(sampleRamp(legend, kn).slice(0, 3)), t = lch(onScreen('now', kn, surface)); if (p.C >= 10 && t.C >= 6) worst = Math.max(worst, Math.abs(arc(t.h, p.h))); } return worst; };
    for (const surface of SURFACES) { expect(off(now, surface)).toBeLessThan(18); expect(off(was, surface)).toBeGreaterThan(100); }   // the control: the bar before, beside the field now (the checker's red line)
  });
  it('neighbouring rows from calm to 33 kn: 12 dE2000 or more in normal vision, 5.3 or more for protan, deutan and tritan; the whole bar 5.2', () => {
    const rows = bar({}).map((s) => s.slice(1, 4)), pairs = (dist, n) => Math.min(...rows.slice(1, n).map((c, i) => dist(rows[i], c)));
    expect(pairs(normal, 8)).toBeGreaterThanOrEqual(11.9); expect(pairs(colourBlind, 8)).toBeGreaterThanOrEqual(5.3);
    expect(pairs(normal, rows.length)).toBeGreaterThanOrEqual(11.5); expect(pairs(colourBlind, rows.length)).toBeGreaterThanOrEqual(5.2);
  });
  it('lightness never rises along the bar from calm to 33 kn; before, it turned back at 10 kn and at 21 kn', () => {
    const rises = (ramp) => ramp.slice(1, 8).map((s, i) => lch(s.slice(1, 4)).L - lch(ramp[i].slice(1, 4)).L).filter((d) => d > 0.05);
    expect(rises(bar({}))).toEqual([]);
    expect(rises(particle)).toHaveLength(2);
  });
  it('the bar in the UI is this ramp: 13 stops, none walked (no pair of its rows runs through grey); under the kill, the particle ramp\'s 18', () => {
    const stops = (css) => css.split('rgba(').length - 1;
    expect(stops(windLegendGradientCSS('light', {}))).toBe(13);
    expect(fnv(Array.from(windLegendGradientCSS('light', {})).map((c) => c.charCodeAt(0)))).toBe(NOW.bar);   // the bar's own bytes
    expect(stops(windLegendGradientCSS('light', KILL))).toBe(18);
    expect(windLegendGradientCSS('light', {})).toContain('rgba(1,189,196,0.8) 13.3%');   // 10 kn: a cyan where the bar before drew a light violet
    expect(windLegendGradientCSS('light', KILL)).toContain('rgba(190,166,254,0.8) 13.3%');
    expect(fs.readFileSync(path.join(__dirname, 'MapWeatherControls.js'), 'utf8')).toMatch(/gradientCSS: windLegendGradientCSS\(theme\),/);   // every layout draws the one derived bar
  });
});

describe('the wind bench can name the kill', () => {
  it('`candidate` draws the default; `before-path` is the arm to film it against', () => {
    const { ALL_VARIANTS } = require('../../../scripts/wind-bench/matrix');
    expect(ALL_VARIANTS['before-path'].levers).toMatchObject(KILL);   // the variant also holds beach's path's kill, which light does not read
    expect(ALL_VARIANTS.candidate.levers).toEqual({});
  });
});
