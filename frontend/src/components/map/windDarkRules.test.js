/**
 * DARK'S RULES ON LIGHT AND BEACH, ON BY DEFAULT (windDarkRules.js, windLandMask.js; DECISIONS D-020).
 *
 * The owner, 2026-10-11: "build the five rules into the app behind a lever, I want to see the changes done, not start with them off,
 * that makes no sense. Do the changes, let me observe them. Then if we dont like them, we turn them off". So the default moved, and
 * this file pins the two things that makes safe:
 *   - THE KILL IS EXACT: with window.__RAW_DISABLE_WIND_DARK_RULES__ = true every theme draws, byte for byte, the tables it drew before
 *     the change (the hashes captured from the code at ca42f552, PR #310's head; windLightLook.test.js holds the same ones);
 *   - THE TABLES AND THE MARK MODEL ALWAYS AGREE: whichever lever is set, a theme draws either dark's rules whole (the dimmed field,
 *     the land and sea streak rows, dark's streak method) or none of it. Never one half on the other's tables.
 * It also pins what the solver promises (the five rules), the land mask, the shader and engine wiring, and it REPORTS the colour-blind
 * floor as it is: the new default sits UNDER the project's bar of 5 on the muted ground (see "the colour-blind floor").
 *
 * The older palette tests (windFieldLut, windPaletteCvd, windLightFastBand, windClearLowBand, windLightLook) read resolveFieldRamp and
 * resolveThemeRamp. Those are now the ROLLBACK tables: what the kill restores. None of their bars moved.
 * The GPU bench is the authority for what is drawn (LESSONS L-V26.3): scripts/wind-bench/map-run.js --offline.
 */
import fs from 'fs';
import path from 'path';
import { DARK_RULES, solveDarkRules, darkRulesGround } from './windDarkRules';
import { windDarkRulesOn, resolveDrawnField, resolveDrawnMarks, drawnMarkRampData, windLookKey, buildFieldRampTexture, resolveFieldRamp, resolveMarkRamp,
  resolveThemeRamp, generateRampData, huePathStops, sampleRamp } from './WindColorRamp';
import { windInk, glowOf, glowComposite } from './windInk';
import { DRAW_FS, DRAW_VS } from './WebGLWindShaders';
import { GLSL_LAND_FS, LAND_MASK_SIZE, mercatorY, rasterizeLand, bindLandMask, landMaskUrl } from './windLandMask';
import { resolveWindParticlesV2, v2SpeedPremul } from './WebGLWindUtils';
import { muteColor, windBasemapMuteAmount, windBasemapWaterL } from './windBasemapMute';

const V2 = resolveWindParticlesV2({});
const ENGINE = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
const KILL = { __RAW_DISABLE_WIND_DARK_RULES__: true };
const THEMES = ['light', 'beach'];
const RULES_MARKS = { mode: 2, on: false, glow: true, purity: 0, density: 1, opacity: 1.0, spine: 0.25, white: 0 };   // dark's streak method, DARK_RULES' strength and ring
const MARKS_OFF = { mode: 0, on: false, glow: false, opacity: 0, spine: 0, purity: 0, density: 1, white: 0 };

// ── colour model: CIELAB D65 and CIEDE2000, as windLightLook.test.js (coloraide 8.13's matrices) ──────────────────────────────────────
const dec = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((Math.abs(c) + 0.055) / 1.055, 2.4));
const enc = (c) => { const x = Math.min(1, Math.max(0, c)); return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const mm = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const RGB2XYZ = [[0.4123907992659595, 0.357584339383878, 0.1804807884018343], [0.21263900587151036, 0.7151686787677559, 0.07219231536073371],
  [0.01933081871559185, 0.11919477979462598, 0.9505321522496606]];
const WHITE = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
const labLin = (lin) => { const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = mm(RGB2XYZ, lin).map((v, i) => f(v / WHITE[i])); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const lab = (rgb) => labLin(rgb.map(dec));
const Lstar = (rgb) => lab(rgb)[0];
const Cstar = (rgb) => { const q = lab(rgb); return Math.hypot(q[1], q[2]); };
const de2000 = ([L1, a1, b1], [L2, a2, b2]) => { const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2), h1p = (Math.atan2(b1, a1p) / rad + 360) % 360, h2p = (Math.atan2(b2, a2p) / rad + 360) % 360;
  let dhp = h2p - h1p; if (C1p * C2p === 0) dhp = 0; else if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2), Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p; if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hbp - 275) / 25) ** 2)) * rad);
  return Math.sqrt(((L2 - L1) / SL) ** 2 + ((C2p - C1p) / SC) ** 2 + (dHp / SH) ** 2 + RT * ((C2p - C1p) / SC) * (dHp / SH)); };
const okHue = (rgb) => { const [r, g, b] = rgb.map(dec);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return (Math.atan2(0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s) * 180 / Math.PI + 360) % 360; };
const hd = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// ── the composite each theme draws, modelled apart from the solver (check.mjs MODEL; the app's own basemap mute) ───────────────────────
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const MODEL = {
  light: { op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65, surfaces: { water: [168, 214, 222], land: [236, 236, 232] } },
  beach: { op: 0.55, baseA: 0.45, end: 7, k: 0.60 / 0.55, surfaces: { water: [150, 190, 200], land: [222, 208, 180] } },
};
const bare = (theme, surface) => { const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${MODEL[theme].surfaces[surface].join(', ')})`, windBasemapMuteAmount(theme, {}), surface === 'water' ? windBasemapWaterL(theme, {}) : 1));
  return [+m[1], +m[2], +m[3]].map((v) => v / 255); };
const BARE = Object.fromEntries(THEMES.map((t) => [t, { land: bare(t, 'land'), water: bare(t, 'water') }]));
const strength = (theme, kn) => { const m = MODEL[theme]; return Math.min(1, m.op * (m.baseA + (1 - m.baseA) * ss(0, m.end, kn)) * m.k); };
const groundUnder = (theme, surface, kn, field) => BARE[theme][surface].map((v, i) => v * (1 - strength(theme, kn) * (1 - field[i])));
// A mark as the engine lays it: DRAW_FS writes glowOf(colour) x alpha into the trail buffer, SCREEN_FS lays it by dark's streak method.
const laid = (ground, mark) => glowComposite(ground, glowOf(mark.slice(0, 3), DARK_RULES.white).map((v) => v * mark[3]), DARK_RULES.opacity);
const KNOTS = Array.from({ length: 76 }, (_, kn) => kn);
const lumY = (rgb) => mm(RGB2XYZ, rgb.map(dec))[1];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
// The tables as drawn (T), and the grounds under each speed: today's (the rollback field on its hue path) and the drawn one.
const T = Object.fromEntries(THEMES.map((t) => [t, { field: resolveDrawnField(t, {}), ...resolveDrawnMarks(t, {}), today: huePathStops(resolveFieldRamp(t, {}), {}) }]));
const todayGround = (theme, surface, kn) => groundUnder(theme, surface, kn, sampleRamp(T[theme].today, kn).slice(0, 3));
const drawnGround = (theme, surface, kn) => groundUnder(theme, surface, kn, T[theme].field[kn].slice(1, 4));
const solved = (theme, opts) => { const t = solveDarkRules(theme, T[theme].today, resolveThemeRamp('dark'), opts); return (surface, kn) => groundUnder(theme, surface, kn, t.field[kn].slice(1, 4)); };
// The name guard's weight at a speed, from today's ground over land (the solver's own window: OKLCH hue 35-55 up, 116-126 down), and
// whether the guard reaches a speed from one within `ease` knots of it.
const guardW = (theme, kn) => { const h = okHue(todayGround(theme, 'land', kn)); return ss(35, 55, h) * ss(126, 116, h); };
const reached = (theme, kn) => KNOTS.some((k) => Math.abs(k - kn) <= DARK_RULES.ease && guardW(theme, k) > 0.001);
/** The steepest step per knot along a ground, in L*: { l, kn }. */
const steepestL = (G, surface) => KNOTS.slice(0, 75).reduce((w, kn) => { const l = Lstar(G(surface, kn + 1)) - Lstar(G(surface, kn)); return Math.abs(l) > Math.abs(w.l) ? { l, kn } : w; }, { l: 0, kn: -1 });
// Dark's own step at a speed: dark's composite over dark's own veil over dark's own ground (the night palette, basemapFallback.js).
const DARK_BASE = { land: [28, 37, 48].map((c) => c / 255), water: [11, 29, 46].map((c) => c / 255) };
const darkStep = (surface, kn) => { const D = sampleRamp(resolveThemeRamp('dark'), kn), a = 0.48 * (0.44 + 0.56 * ss(0, 5, kn));
  const G = DARK_BASE[surface].map((g, c) => D[c] * a * a + g * (1 - a)), be = D[3] * Math.max(D[0], D[1], D[2]);
  return Lstar(D.slice(0, 3).map((v, c) => v * D[3] * be * 0.505 + G[c] * (1 - be * 0.505))) - Lstar(G); };
// Colour-blind simulations. COLORAIDE: the checker's own (scripts/wind-color/cvd_check.py: Vienot protan/deutan, Brettel tritan), the
// method the project's bar of 5 belongs to. MACHADO 2009 (severity 1, linear RGB): the Ground Truth lab's, for its numbers.
const VIENOT = {
  protan: [[0.11238276122216405, 0.8876172387778362, 0], [0.11238276122216398, 0.8876172387778362, 0], [0.0040057682730469425, -0.004005768273046939, 1]],
  deutan: [[0.2927501142784356, 0.7072498857215644, 0], [0.2927501142784356, 0.7072498857215644, 0], [-0.022336587034129083, 0.022336587034129093, 1]],
};
const LMS = [[0.178824041258, 0.4351609057000001, 0.04119349692], [0.034556423182, 0.27155382458, 0.03867130836], [0.000299565576, 0.0018430896, 0.01467086136]];
const TRITAN = { w1: [[7.392856536180033, -11.148044821248138, 0], [-0.34194012421930653, 3.5501661175064, 0], [-4.2050692716448586, 10.89115898202731, 0]],
  w2: [[8.0643934576311, -12.42414705871019, 0], [-0.9956078228581946, 4.7923119863996835, 0], [-0.2150297288038942, 3.3090019545637928, 0]], sep: [0.344781556122, -0.655178443878, 0] };
const coloraide = (rgb, kind) => { const lin = rgb.map(dec); if (kind !== 'tritan') return labLin(mm(VIENOT[kind], lin));
  const lms = mm(LMS, lin), side = lms[0] * TRITAN.sep[0] + lms[1] * TRITAN.sep[1]; return labLin(mm(side > 0 ? TRITAN.w2 : TRITAN.w1, lms)); };
const MACHADO = { protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]] };
const machado = (rgb, kind) => lab(mm(MACHADO[kind], rgb.map(dec)).map(enc));
const BEAUFORT = [0, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75];
/** The weakest neighbouring pair of Beaufort bands (from `from` kn up) under protan, deutan and tritan simulation: { d, pair, kind }. */
const cvdFloor = (colourAt, simulate, from) => { let min = { d: Infinity };
  for (const kind of ['protan', 'deutan', 'tritan']) for (let i = 1; i < BEAUFORT.length; i++) { if (BEAUFORT[i - 1] < from) continue;
    const d = de2000(simulate(colourAt(BEAUFORT[i - 1]), kind), simulate(colourAt(BEAUFORT[i]), kind)); if (d < min.d) min = { d, pair: `${BEAUFORT[i - 1]}-${BEAUFORT[i]}`, kind }; }
  return min; };

const fnv = (a) => { let h = 2166136261; for (const b of a) h = Math.imul(h ^ b, 16777619); return (h >>> 0).toString(16); };
const rampGl = () => { const gl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4, CLAMP_TO_EDGE: 5, LINEAR: 6, TEXTURE_WRAP_S: 7, TEXTURE_WRAP_T: 8, TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10,
  getParameter: () => null, createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {} }; gl.texImage2D = (...a) => { gl.uploaded = a[8]; }; return gl; };
const fieldBytes = (theme, w, max = 50) => { const gl = rampGl(); return buildFieldRampTexture(gl, max, theme, w) ? gl.uploaded : null; };

describe('the default: dark\'s rules draw light and beach, never dark', () => {
  it('the rule set is the lab\'s defaults, with beach\'s own ceiling and the guard\'s reach along speed', () => {
    expect(DARK_RULES).toEqual({ themes: ['light', 'beach'], ceil: { light: 58, beach: 62 }, guard: 76, ease: 4, cMin: 25, opacity: 1.0, ring: 0.25, white: 0 });
    expect(Object.isFrozen(DARK_RULES)).toBe(true);
  });
  it('is on with no lever set in light and beach, and never in dark whatever is set', () => {
    for (const theme of THEMES) for (const w of [{}, null, undefined]) expect(windDarkRulesOn(theme, w)).toBe(true);
    for (const w of [{}, { __RAW_WIND_DARK_RULES__: true }, { __RAW_WIND_DARK_RULES__: 'dark' }, { __RAW_WIND_DARK_RULES__: 'dark,light,beach' }]) expect(windDarkRulesOn('dark', w)).toBe(false);
    for (const theme of ['', 'sepia', undefined]) expect(windDarkRulesOn(theme, {})).toBe(false);
  });
  it('the marks are dark\'s streak method at the rules\' strength and ring, and the premultiplied composite stands down for them', () => {
    for (const theme of THEMES) {
      expect(windInk(theme, V2, {})).toEqual(RULES_MARKS);
      expect(v2SpeedPremul(V2, theme, {})).toEqual({ on: false, opacity: 0, singleCasing: false });
    }
    expect(windInk('dark', V2, {})).toEqual(MARKS_OFF);
    // the bench tunes them through the glow sub-levers, as it tunes a light look
    expect(windInk('beach', V2, { __RAW_WIND_GLOW_OPACITY__: 0.8, __RAW_WIND_GLOW_RING__: 0.5, __RAW_WIND_GLOW_WHITE__: 0.1 })).toMatchObject({ mode: 2, opacity: 0.8, spine: 0.5, white: 0.1 });
  });
  it('the field and the marks it draws are not the tables it drew before', () => {
    for (const theme of THEMES) {
      expect(resolveDrawnField(theme, {})).not.toEqual(resolveFieldRamp(theme, {}));
      const m = resolveDrawnMarks(theme, {});
      expect(m.land).not.toBeNull(); expect(m.water).not.toEqual(m.land);
      expect(fnv(fieldBytes(theme, {}))).not.toBe(fnv(fieldBytes(theme, KILL)));
    }
    expect(resolveDrawnField('dark', {})).toBeNull();
    expect(resolveDrawnMarks('dark', {})).toEqual({ land: null, water: null });
  });
});

describe('the kill: every theme draws, byte for byte, the tables it drew before the change', () => {
  // FNV-1a of the 256-entry RGBA tables at 50 kn, captured from the running code at ca42f552 (PR #310's head), BEFORE dark's rules
  // or light's look existed (LESSONS L-V25: a "before" comes from the code before the edit, never from this code's own off branch).
  const BEFORE = { light: { particle: 'c1eeccde', field: '9100656a' }, beach: { particle: '570a703a', field: '724eed40' }, dark: { particle: 'c2ebc33e', field: null } };
  const OFFS = [KILL, { __RAW_WIND_DARK_RULES__: false }, { ...KILL, __RAW_WIND_DARK_RULES__: true }, { ...KILL, __RAW_WIND_DARK_RULES__: 'light,beach' }];
  it.each(OFFS)('the DRAWN marks table (both rows) and the DRAWN field table are the ones captured before (%o)', (w) => {
    for (const theme of ['light', 'beach', 'dark']) {
      const marks = drawnMarkRampData(50, theme, w);
      expect(marks).toHaveLength(256 * 2 * 4);
      expect(fnv(marks.subarray(0, 1024))).toBe(BEFORE[theme].particle);      // row 0, over land
      expect(fnv(marks.subarray(1024))).toBe(BEFORE[theme].particle);         // row 1, over sea: the same row, so the land mask changes nothing
      const field = fieldBytes(theme, w);
      expect(field ? fnv(field) : null).toBe(BEFORE[theme].field);
    }
  });
  it('dark draws those tables whether or not the kill is set', () => {
    for (const w of [{}, KILL, { __RAW_WIND_DARK_RULES__: true }]) {
      const marks = drawnMarkRampData(50, 'dark', w);
      expect(fnv(marks.subarray(0, 1024))).toBe(BEFORE.dark.particle);
      expect(fnv(marks.subarray(1024))).toBe(BEFORE.dark.particle);
      expect(fieldBytes('dark', w)).toBeNull();
    }
  });
  it('the marks go back to the premultiplied composite at each theme\'s own strength, and the resolvers read as they did', () => {
    for (const w of OFFS) {
      for (const theme of THEMES) {
        expect(windDarkRulesOn(theme, w)).toBe(false);
        expect(windInk(theme, V2, w)).toEqual(MARKS_OFF);
        expect(resolveDrawnField(theme, w)).toEqual(resolveFieldRamp(theme, w));
        expect(resolveDrawnMarks(theme, w)).toEqual({ land: null, water: null });
      }
      expect(v2SpeedPremul(V2, 'light', w)).toEqual({ on: true, opacity: 1.0, singleCasing: false });
      expect(v2SpeedPremul(V2, 'beach', w)).toEqual({ on: true, opacity: 0.6, singleCasing: false });
    }
  });
  it('only exactly true kills: a truthy value that is not a setting leaves the default on', () => {
    for (const v of [1, 'true', 'yes', {}, null, undefined, false]) for (const theme of THEMES) expect(windDarkRulesOn(theme, { __RAW_DISABLE_WIND_DARK_RULES__: v })).toBe(true);
  });
  it('under the kill the older field kill still returns the field to the particle ramp, as it did', () => {
    expect(fieldBytes('light', { ...KILL, __RAW_DISABLE_WIND_FIELD_RAMP__: true })).toBeNull();
    expect(fieldBytes('light', { __RAW_DISABLE_WIND_FIELD_RAMP__: true })).not.toBeNull();   // dark's rules need their own field, as a light look does
  });
});

describe('the lever narrows the themes; an older lever that draws a theme holds it whole', () => {
  it('__RAW_WIND_DARK_RULES__: true both, false none, a list those themes; anything else is not a setting', () => {
    const on = (lever) => THEMES.map((t) => windDarkRulesOn(t, { __RAW_WIND_DARK_RULES__: lever }));
    expect(on(true)).toEqual([true, true]);
    expect(on(false)).toEqual([false, false]);
    expect(on('light')).toEqual([true, false]);
    expect(on('beach')).toEqual([false, true]);
    expect(on('light,beach')).toEqual([true, true]);
    expect(on('dark')).toEqual([false, false]);
    for (const v of [1, 0, null, undefined, {}, []]) expect(on(v)).toEqual([true, true]);
  });
  it('a narrowed-out theme draws exactly what the kill draws', () => {
    const w = { __RAW_WIND_DARK_RULES__: 'beach' };
    expect(fnv(drawnMarkRampData(50, 'light', w))).toBe(fnv(drawnMarkRampData(50, 'light', KILL)));
    expect(fnv(fieldBytes('light', w))).toBe(fnv(fieldBytes('light', KILL)));
    expect(windInk('light', V2, w)).toEqual(MARKS_OFF);
    expect(windInk('beach', V2, w)).toEqual(RULES_MARKS);
  });
  it.each(['moderate', 'deep', 'ink'])('an explicit light look (%s) holds light: its own field, marks and mark model; beach keeps dark\'s rules', (look) => {
    for (const w of [{ __RAW_WIND_LIGHT_LOOK__: look }, { location: { search: `?windLook=${look}` } }]) {
      expect(windDarkRulesOn('light', w)).toBe(false);
      expect(windDarkRulesOn('beach', w)).toBe(true);
      expect(resolveDrawnField('light', w)).toEqual(resolveFieldRamp('light', w));
      const marks = resolveMarkRamp('light', w);
      expect(resolveDrawnMarks('light', w)).toEqual({ land: marks, water: marks });
      expect(windInk('light', V2, w).mode).toBe(look === 'ink' ? 1 : 2);
      expect(windInk('light', V2, w).opacity).not.toBeUndefined();
      expect(windInk('beach', V2, w)).toEqual(RULES_MARKS);
    }
    const killed = { __RAW_WIND_LIGHT_LOOK__: look, __RAW_DISABLE_WIND_LIGHT_LOOK__: true };   // the look's kill hands light back to the default
    expect(windDarkRulesOn('light', killed)).toBe(true);
    expect(windInk('light', V2, killed)).toEqual(RULES_MARKS);
  });
  // The ink and glow levers were built, measured and A/B'd on the tables before dark's rules. Set for a theme, they draw that theme on
  // those tables (so a bench arm or a session that sets one compares the look it names, not a mix).
  it.each([['__RAW_WIND_INK__', '__RAW_DISABLE_WIND_INK__', 1], ['__RAW_WIND_GLOW__', '__RAW_DISABLE_WIND_GLOW__', 2]])(
    '%s for a theme stands dark\'s rules down there, tables and all; its kill hands the theme back', (lever, kill, mode) => {
      for (const theme of THEMES) {
        const other = theme === 'light' ? 'beach' : 'light';
        for (const w of [{ [lever]: true }, { [lever]: theme }, { [lever]: 'light,beach' }]) {
          expect(windDarkRulesOn(theme, w)).toBe(false);
          expect(windInk(theme, V2, w).mode).toBe(mode);
          expect(fnv(drawnMarkRampData(50, theme, w))).toBe(fnv(drawnMarkRampData(50, theme, KILL)));
          expect(fnv(fieldBytes(theme, w))).toBe(fnv(fieldBytes(theme, KILL)));
        }
        expect(windDarkRulesOn(other, { [lever]: theme })).toBe(true);                 // a lever that names one theme leaves the other alone
        expect(windInk(other, V2, { [lever]: theme })).toEqual(RULES_MARKS);
        for (const w of [{ [lever]: true, [kill]: true }, { [lever]: false }, { [lever]: 1 }, { [lever]: 'dark' }]) {   // dead, off, or not a setting
          expect(windDarkRulesOn(theme, w)).toBe(true);
          expect(windInk(theme, V2, w)).toEqual(RULES_MARKS);
        }
      }
    });
  it('the neutral-body lever (the rejected v2 theme) owns its composite: dark\'s rules stand down with it', () => {
    const w = { __RAW_WIND_THEME_V2__: true }, v2 = resolveWindParticlesV2(w);
    expect(v2.theme).toBe(true);
    for (const theme of THEMES) {
      expect(windInk(theme, v2, w)).toEqual(MARKS_OFF);
      expect(windDarkRulesOn(theme, w)).toBe(false);
      expect(fnv(drawnMarkRampData(50, theme, w))).toBe(fnv(drawnMarkRampData(50, theme, KILL)));
    }
    for (const theme of THEMES) expect(windDarkRulesOn(theme, { __RAW_WIND_THEME_V2__: true, __RAW_DISABLE_WIND_THEME_V2__: true })).toBe(true);
  });
  it('THE TABLES AND THE MARK MODEL AGREE under every combination of the levers: dark\'s rules whole, or not at all', () => {
    const VALUES = {
      __RAW_DISABLE_WIND_DARK_RULES__: [undefined, true], __RAW_WIND_DARK_RULES__: [undefined, true, false, 'light', 'beach'],
      __RAW_WIND_LIGHT_LOOK__: [undefined, 'deep', 'ink'], __RAW_WIND_INK__: [undefined, true, 'beach'], __RAW_DISABLE_WIND_INK__: [undefined, true],
      __RAW_WIND_GLOW__: [undefined, true, 'light', false], __RAW_DISABLE_WIND_GLOW__: [undefined, true], __RAW_WIND_THEME_V2__: [undefined, true],
    };
    let combos = [{}];
    for (const [k, vs] of Object.entries(VALUES)) combos = combos.flatMap((c) => vs.map((v) => (v === undefined ? c : { ...c, [k]: v })));
    expect(combos).toHaveLength(2 * 5 * 3 * 3 * 2 * 4 * 2 * 2);
    let on = 0;
    for (const w of combos) for (const theme of ['light', 'beach', 'dark']) {
      const rules = windDarkRulesOn(theme, w), v2 = resolveWindParticlesV2(w), marks = windInk(theme, v2, w);
      if (rules) { on++; expect(marks).toEqual(RULES_MARKS); }
      else {   // off: the marks are exactly what the kill draws under the same levers, and so are both tables
        expect(marks).toEqual(windInk(theme, v2, { ...w, ...KILL }));
        expect(resolveDrawnField(theme, w)).toEqual(resolveFieldRamp(theme, w));
        const own = resolveMarkRamp(theme, w); expect(resolveDrawnMarks(theme, w)).toEqual({ land: own, water: own });
      }
      expect(windLookKey(theme, w).endsWith('|dark-rules')).toBe(rules);   // and the engine's rebuild key says which
    }
    expect(on).toBeGreaterThan(100);   // the sweep reaches both branches
  });
  it('the engine rebuilds its tables at once when any of them flips (the look key)', () => {
    const base = windLookKey('light', {});
    expect(base).toBe('|dark-rules');
    for (const w of [KILL, { __RAW_WIND_DARK_RULES__: 'beach' }, { __RAW_WIND_LIGHT_LOOK__: 'deep' }, { __RAW_WIND_INK__: true }, { __RAW_WIND_GLOW__: 'light' }, { __RAW_WIND_THEME_V2__: true }]) expect(windLookKey('light', w)).not.toBe(base);
    expect(windLookKey('light', { __RAW_WIND_LIGHT_LOOK__: 'deep' })).not.toBe(windLookKey('light', { __RAW_WIND_LIGHT_LOOK__: 'ink' }));
    expect(windLookKey('dark', {})).toBe('|');
    expect(windLookKey('beach', { __RAW_WIND_LIGHT_LOOK__: 'deep' })).toBe('deep|dark-rules');   // the key carries the look for every theme; beach's tables do not move with it
  });
});

describe('the solved tables: the five rules', () => {
  it('one row a knot from 0 to 75, in gamut; the field keeps its alpha; every streak colour is at full brightness', () => {
    for (const theme of THEMES) for (const rows of [T[theme].field, T[theme].land, T[theme].water]) {
      expect(rows.map((r) => r[0])).toEqual(KNOTS);
      for (const r of rows) for (const c of r.slice(1)) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    }
    for (const theme of THEMES) {
      T[theme].field.forEach((r) => expect(r[4]).toBeCloseTo(sampleRamp(T[theme].today, r[0])[3], 12));
      for (const rows of [T[theme].land, T[theme].water]) rows.forEach((r) => expect(Math.max(r[1], r[2], r[3])).toBeCloseTo(1, 9));   // glowOf leaves it as solved
    }
  });
  it('the grounds it assumes are the app\'s own muted grounds (windBasemapMute.js): a change to the mute re-solves, it does not drift', () => {
    for (const theme of THEMES) for (const surface of ['land', 'water']) {
      darkRulesGround(theme, surface, [1, 1, 1], 0).forEach((v, i) => expect(Math.abs(v - BARE[theme][surface][i])).toBeLessThanOrEqual(0.5 / 255 + 1e-9));
      for (const kn of [0, 6, 27, 75]) { const F = T[theme].field[kn].slice(1, 4); darkRulesGround(theme, surface, F, kn).forEach((v, i) => expect(v).toBeCloseTo(groundUnder(theme, surface, kn, F)[i], 2)); }
    }
  });
  it('RULE 5, the colour floor: every streak keeps C* >= 25 from 3 kn up, over land and over sea', () => {
    for (const theme of THEMES) for (const rows of [T[theme].land, T[theme].water]) for (const r of rows) if (r[0] >= 3) expect(Cstar(r.slice(1, 4))).toBeGreaterThanOrEqual(DARK_RULES.cMin - 0.05);
  });
  it('RULE 1, light only adds: every texel of the drawn tables steps LIGHTER than the ground under it, over land and over sea', () => {
    for (const theme of THEMES) for (const max of [50, 75]) {
      const marks = drawnMarkRampData(max, theme, {}), field = fieldBytes(theme, {}, max);
      for (let i = 0; i < 256; i++) {
        const kn = (i / 255) * max, F = [0, 1, 2].map((c) => field[i * 4 + c] / 255);
        for (const [row, surface] of [[0, 'land'], [1, 'water']]) {
          const o = row * 1024 + i * 4, mark = [0, 1, 2, 3].map((c) => marks[o + c] / 255), G = groundUnder(theme, surface, kn, F);
          expect(Lstar(laid(G, mark)) - Lstar(G)).toBeGreaterThan(1);
        }
      }
    }
  });
  it('the field keeps its colour between its stops: light\'s 10-16 kn walks the hue path, never the grey of a straight sRGB line (D-019)', () => {
    const drawn = huePathStops(T.light.field, {});
    expect(drawn).toBe(T.light.field);                    // a row a knot leaves the path nothing to add, so no kill can change the table
    for (const theme of THEMES) for (const rows of [T[theme].land, T[theme].water]) expect(huePathStops(rows, {})).toBe(rows);
    for (const surface of ['land', 'water']) for (let v = 3; v <= 40; v += 0.25) {
      expect(Cstar(groundUnder('light', surface, v, sampleRamp(drawn, v).slice(0, 3)))).toBeGreaterThanOrEqual(8);   // check.mjs veilC: a grey veil below 8
    }
    // and the streaks ride the same path: each is its own ground's hue (within 21 degrees OKLCH: a blue or violet mixed toward white
    // turns a little toward purple), so over 10-16 kn they walk violet, blue, azure, teal, green with the field
    for (const theme of THEMES) for (const surface of ['land', 'water']) for (let kn = 3; kn <= 75; kn++) {
      expect(hd(okHue(T[theme][surface][kn].slice(1, 4)), okHue(drawnGround(theme, surface, kn)))).toBeLessThanOrEqual(21);
    }
  });
  it('an older field kill changes the hues the rules are solved from, never the path: no kill brings the grey back', () => {
    for (const k of ['__RAW_DISABLE_WIND_HUE_PATH__', '__RAW_DISABLE_WIND_LIGHT_FASTBAND__', '__RAW_DISABLE_WIND_MIDBAND_REFINE__']) {
      const F = resolveDrawnField('light', { [k]: true });
      for (let kn = 10; kn <= 16; kn++) expect(Cstar(groundUnder('light', 'land', kn, F[kn].slice(1, 4)))).toBeGreaterThanOrEqual(8);
    }
  });
  it('the solver is a pure function of its stops: the same tables every call, and the caller cannot reach the cache', () => {
    const a = resolveDrawnField('beach', {}); a[10][1] = 9;
    expect(resolveDrawnField('beach', {})[10][1]).not.toBe(9);
    const dark = resolveThemeRamp('dark'), field = huePathStops(resolveFieldRamp('beach', {}), {});
    expect(solveDarkRules('beach', field, dark)).toEqual(solveDarkRules('beach', field, dark));
  });
  it('reads the same grounds from the tables as from the bytes the engine uploads (the LUT is the tables)', () => {
    for (const theme of THEMES) {
      const field = fieldBytes(theme, {}, 75), want = generateRampData(75, T[theme].field, null, {});
      expect(fnv(field)).toBe(fnv(want));
      const marks = drawnMarkRampData(75, theme, {});
      expect(fnv(marks.subarray(0, 1024))).toBe(fnv(generateRampData(75, T[theme].land, theme, {})));
      expect(fnv(marks.subarray(1024))).toBe(fnv(generateRampData(75, T[theme].water, theme, {})));
      expect(todayGround(theme, 'land', 6)).not.toEqual(drawnGround(theme, 'land', 6));
    }
  });
});

describe('rules 2 and 3 read per knot: the dusk, the name guard, and no hard line between them', () => {
  it('RULE 2, one dusk factor: every speed the guard does not reach is dimmed by the SAME factor in linear light, to the ceiling', () => {
    // light: 0.478 at every free speed. beach: 0.613, and up to 0.638 at 8-14 kn, where its deep jade field is already at the tint's
    // full strength (a channel at 0) and cannot be dimmed further: lighter than asked there, never darker.
    const WANT = { light: [0.4775, 0.4781], beach: [0.6130, 0.6380] };
    for (const theme of THEMES) {
      const free = KNOTS.filter((kn) => kn >= 3 && !reached(theme, kn)), ratio = free.map((kn) => lumY(drawnGround(theme, 'land', kn)) / lumY(todayGround(theme, 'land', kn)));
      expect(free.length).toBeGreaterThanOrEqual(40);   // 3-20 and 49-75 kn in light, 3-16 and 50-75 in beach
      expect(Math.min(...ratio)).toBeGreaterThanOrEqual(WANT[theme][0]); expect(Math.max(...ratio)).toBeLessThanOrEqual(WANT[theme][1]);
      const everyday = free.filter((kn) => kn >= 6 && kn <= 27).map((kn) => Lstar(drawnGround(theme, 'land', kn)));
      expect(Math.max(...everyday)).toBeLessThanOrEqual(DARK_RULES.ceil[theme] + 0.1);
    }
    expect(Lstar(drawnGround('light', 'land', 6))).toBeCloseTo(58.1, 1);     // light's lightest everyday ground sits AT its ceiling
    expect(Lstar(drawnGround('beach', 'land', 6))).toBeCloseTo(56.8, 1);     // beach's ceiling of 62 is set by its 27 kn ground, which the guard's reach now lifts (below)
  });
  it('RULE 3, the name guard: a yellow or orange ground is never dimmed. It is NOT held at 76: today\'s field is already deeper there, and a tint cannot lift a ground', () => {
    const HELD = { light: [27, 42], beach: [29, 38] };   // the speeds whose ground over land is fully inside the guard's hues
    for (const theme of THEMES) {
      const held = KNOTS.filter((kn) => guardW(theme, kn) >= 0.999);
      expect([held[0], held[held.length - 1]]).toEqual(HELD[theme]);
      for (const kn of held) for (const surface of ['land', 'water']) expect(Lstar(drawnGround(theme, surface, kn))).toBeCloseTo(Lstar(todayGround(theme, surface, kn)), 1);
      expect(Math.max(...held.map((kn) => Lstar(todayGround(theme, 'land', kn))))).toBeLessThan(DARK_RULES.guard);   // light 75.3 at 27 kn, beach 72.9 at 29 kn
    }
    expect(Lstar(drawnGround('light', 'land', 33))).toBeCloseTo(68.4, 1);    // still a pale khaki, as the FINDING said: the tint cannot hold it higher
    expect(Lstar(drawnGround('light', 'land', 40))).toBeCloseTo(63.4, 1);
  });
  it('NO HARD LINE at the guard\'s edge (L-V8): the ground never steps more than 4.5 L* in a knot, where the lab\'s hand-over stepped 18.6', () => {
    const NOW = { light: { land: 4.45, water: 3.52 }, beach: { land: 4.34, water: 3.63 } }, TODAY = { light: { land: 2.27, water: 1.78 }, beach: { land: 3.47, water: 2.90 } };
    for (const theme of THEMES) for (const surface of ['land', 'water']) {
      const now = steepestL((s, kn) => drawnGround(theme, s, kn), surface);
      expect(Math.abs(now.l)).toBeCloseTo(NOW[theme][surface], 1);
      expect(Math.abs(now.l)).toBeLessThanOrEqual(4.5);
      expect(Math.abs(steepestL((s, kn) => todayGround(theme, s, kn), surface).l)).toBeCloseTo(TODAY[theme][surface], 1);   // the cost, said plainly: up to twice today's steepest
    }
    // POSITIVE CONTROL: the lab's hand-over (ease 0) is the hard line this instrument was built to see
    const lab = steepestL(solved('light', { ease: 0 }), 'land');
    expect(lab.kn).toBe(25); expect(lab.l).toBeCloseTo(18.57, 1);
    expect(steepestL(solved('light', { ease: 0 }), 'water').l).toBeCloseTo(14.69, 1);
    expect(steepestL(solved('beach', { ease: 0 }), 'land').l).toBeCloseTo(6.13, 1);
  });
  it('the guard reaches OUTWARD only: every Beaufort stop the guard did not touch keeps the lab\'s ground, and no held speed is dimmed for the ease', () => {
    for (const theme of THEMES) {
      const lab = solved(theme, { ease: 0 });
      for (const kn of KNOTS) for (const surface of ['land', 'water']) expect(Lstar(drawnGround(theme, surface, kn))).toBeGreaterThanOrEqual(Lstar(lab(surface, kn)) - 1e-6);   // lighter or equal, never darker
      for (const kn of BEAUFORT) if (!reached(theme, kn)) expect(Lstar(drawnGround(theme, 'land', kn))).toBeCloseTo(Lstar(lab('land', kn)), 6);
    }
    // what the reach costs, said plainly: these speeds sit ABOVE their theme's ceiling, climbing to the held band beside them
    const climb = (theme, from, want) => want.forEach((L, i) => expect(Math.abs(Lstar(drawnGround(theme, 'land', from + i)) - L)).toBeLessThanOrEqual(0.15));
    climb('light', 22, [59.7, 63.8, 67.5, 70.9, 74.2]);                     // against a ceiling of 58
    climb('beach', 24, [59.1, 62.15, 66.4, 70.75, 71.95]);                  // against a ceiling of 62
  });
  it('CALM keeps its tint (D-019): light\'s calm is a dimmed pale rose, not the grey a clamped tint drew', () => {
    expect(Cstar(drawnGround('light', 'land', 0))).toBeCloseTo(5.7, 1); expect(Cstar(drawnGround('light', 'water', 0))).toBeCloseTo(3.8, 1);
    expect(Cstar(drawnGround('beach', 'land', 0))).toBeCloseTo(6.4, 1);
    const clamped = solved('light', { calm: false });                       // POSITIVE CONTROL: dusk's factor laid by a tint too weak to colour it
    expect(Cstar(clamped('land', 0))).toBeLessThan(1); expect(Lstar(drawnGround('light', 'land', 0)) - Lstar(clamped('land', 0))).toBeLessThan(1.5);
    for (const theme of THEMES) for (const surface of ['land', 'water']) {   // calm is weaker than 3 kn and darker than the bare map: one descent into the wind
      const Ls = [0, 1, 2, 3].map((kn) => Lstar(drawnGround(theme, surface, kn)));
      expect(Lstar(BARE[theme][surface])).toBeGreaterThan(Ls[0] + 10);
      for (let i = 1; i < Ls.length; i++) expect(Ls[i]).toBeLessThan(Ls[i - 1]);
    }
    const light = KNOTS.slice(0, 17).map((kn) => Lstar(drawnGround('light', 'land', kn)));   // light is still one lightness descent from calm to 16 kn
    for (let i = 1; i < light.length; i++) expect(light[i]).toBeLessThanOrEqual(light[i - 1] + 0.3);
  });
});

describe('the streaks against dark\'s own step (rules 1, 4 and 5)', () => {
  const step = (theme, surface, rows, kn) => Lstar(laid(drawnGround(theme, surface, kn), rows[kn].slice(1))) - Lstar(drawnGround(theme, surface, kn));
  it('each streak is dark\'s step above its own ground: never more, and short of it only where the colour floor stops it', () => {
    for (const theme of THEMES) for (const surface of ['land', 'water']) for (let kn = 3; kn <= 75; kn++) {
      const d = step(theme, surface, T[theme][surface], kn) - darkStep(surface, kn);
      expect(d).toBeLessThanOrEqual(0.3);                                   // never further than dark steps: no wash
      if (d < -0.3) { expect(Cstar(T[theme][surface][kn].slice(1, 4))).toBeLessThanOrEqual(DARK_RULES.cMin + 1.5); expect(d).toBeGreaterThanOrEqual(-4.5); }
    }
    // where it falls short, said plainly: light's land at 26-29 kn (by 1.4 to 4.0 L*) and beach's at 27-29 kn (about 1 L*): a pale yellow
    // over a held yellow-green ground has no more lightness to give without losing its colour
    const short = (theme) => KNOTS.filter((kn) => kn >= 3 && darkStep('land', kn) - step(theme, 'land', T[theme].land, kn) > 0.3);
    expect(short('light')).toEqual([26, 27, 28, 29]); expect(short('beach')).toEqual([27, 28, 29]);
    for (const theme of THEMES) expect(KNOTS.filter((kn) => kn >= 3 && darkStep('water', kn) - step(theme, 'water', T[theme].water, kn) > 0.3)).toEqual([]);
  });
  it('at the everyday winds the step is dark\'s: about +22 L* at the head of a streak, over land and over sea', () => {
    for (const theme of THEMES) for (const surface of ['land', 'water']) {
      const mine = median(KNOTS.slice(6, 28).map((kn) => step(theme, surface, T[theme][surface], kn))), darks = median(KNOTS.slice(6, 28).map((kn) => darkStep(surface, kn)));
      expect(darks).toBeCloseTo(surface === 'land' ? 21.97 : 22.93, 1);
      expect(Math.abs(mine - darks)).toBeLessThanOrEqual(0.5);
    }
  });
  it('RULE 4, why there are two rows: the land\'s streaks laid over the sea step a third further than dark does (the wash), the sea\'s own do not', () => {
    for (const theme of THEMES) {
      const landOverSea = median(KNOTS.slice(6, 28).map((kn) => step(theme, 'water', T[theme].land, kn))), seaOverSea = median(KNOTS.slice(6, 28).map((kn) => step(theme, 'water', T[theme].water, kn)));
      expect(landOverSea - seaOverSea).toBeGreaterThan(6);                  // light +8.6, beach +6.5 L* too far
      expect(landOverSea).toBeCloseTo(theme === 'light' ? 31.55 : 29.43, 1);
    }
  });
});

describe('the colour-blind floor, reported as it is: the new default is UNDER the project\'s bar of 5', () => {
  // The bar: neighbouring Beaufort bands' grounds from 3 kn up at least 5 dE2000 apart for protan, deutan and tritan viewers, by the
  // checker's method (coloraide). The tables before this change reach it on the muted ground (5.08 to 5.26; windLightFastBand,
  // windPaletteCvd). Dark's rules do not: dusk draws the bands' lightness together. Nothing here lowers that bar or any test that holds
  // it; those tests read the rollback tables. This block states the drawn numbers so nobody reads a green run as "the floor holds".
  const floor = (theme, surface, ground, simulate, from) => cvdFloor((kn) => ground(theme, surface, kn), simulate, from);
  it.each([
    ['light', 'land', 5.26, 4.86, '55-63', 'tritan'], ['light', 'water', 5.22, 3.86, '16-21', 'deutan'],
    ['beach', 'land', 5.20, 3.17, '16-21', 'protan'], ['beach', 'water', 5.08, 3.06, '16-21', 'protan'],
  ])('%s over the muted %s, the checker\'s method: %f before, %f as drawn (weakest %s, %s)', (theme, surface, before, drawn, pair, kind) => {
    const was = floor(theme, surface, todayGround, coloraide, 3), now = floor(theme, surface, drawnGround, coloraide, 3);
    expect(was.d).toBeCloseTo(before, 1); expect(was.d).toBeGreaterThanOrEqual(5);
    expect(now.d).toBeCloseTo(drawn, 1); expect(now.d).toBeLessThan(5);       // UNDER THE BAR. The owner's call (D-020); the kill restores `before`.
    expect([now.pair, now.kind]).toEqual([pair, kind]);
  });
  it.each([['light', 'land', 5.19, 4.96], ['light', 'water', 4.87, 3.80], ['beach', 'land', 3.51, 3.40], ['beach', 'water', 3.50, 3.28]])(
    '%s over the muted %s, the lab\'s method (Machado, every band from calm): %f before, %f as drawn', (theme, surface, before, drawn) => {
      expect(floor(theme, surface, todayGround, machado, 0).d).toBeCloseTo(before, 1);
      expect(floor(theme, surface, drawnGround, machado, 0).d).toBeCloseTo(drawn, 1);
    });
  it('the guard\'s reach along speed did not cost the floor: the lab\'s hand-over reads the same or lower', () => {
    for (const theme of THEMES) for (const surface of ['land', 'water']) {
      const lab = solved(theme, { ease: 0 });
      expect(floor(theme, surface, drawnGround, machado, 0).d).toBeGreaterThanOrEqual(floor(theme, surface, (t, s, kn) => lab(s, kn), machado, 0).d - 0.01);
      expect(floor(theme, surface, drawnGround, coloraide, 3).d).toBeGreaterThanOrEqual(floor(theme, surface, (t, s, kn) => lab(s, kn), coloraide, 3).d - 0.25);
    }
  });
  it('the STREAKS do not separate the bands for a colour-blind viewer, and never did carry them: the field under them does', () => {
    // a streak is its ground's hue near white; neighbouring bands' streaks sit under 1 dE2000 apart for some viewer in both themes.
    // A watch line in the checker, never a gate (cvd_check.py); light's look A pinned its own streaks at 5, which these do not reach.
    for (const theme of THEMES) for (const surface of ['land', 'water']) expect(cvdFloor((kn) => T[theme][surface][kn].slice(1, 4), coloraide, 3).d).toBeLessThan(1);
  });
});

describe('the land mask (rule 4): the mark picks its row by the ground under it', () => {
  const GEO = { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-180, 85.051129], [0, 0], [180, -85.051129], [-180, 85.051129]]] } },
    { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [90, 0], [90, 45], [0, 0]]], [[[10, 10], [20, 10], [20, 20], [10, 10]], [[12, 11], [14, 11], [14, 12], [12, 11]]]] } },
    { type: 'Feature', geometry: null }, { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
  ] };
  const fakeCanvas = (size, paint) => {
    const calls = [], ctx = { calls, fillRect: (...a) => calls.push(['fillRect', ...a]), beginPath: () => calls.push(['beginPath']), moveTo: (x, y) => calls.push(['moveTo', x, y]), lineTo: (x, y) => calls.push(['lineTo', x, y]),
      closePath: () => calls.push(['closePath']), fill: (rule) => calls.push(['fill', rule]), getImageData: (x, y, w, h) => ({ data: paint ? paint(w, h) : new Uint8ClampedArray(w * h * 4) }) };
    return { ctx, width: size, height: size, getContext: (kind) => (kind === '2d' ? ctx : null) };
  };
  const maskGl = () => {
    const gl = { calls: [], uniforms: {}, textures: [], dead: new Set(), lost: false, isTextureCalls: 0, active: 100, units: { 100: 'the-maps-own-texture' },
      TEXTURE_2D: 'T2D', TEXTURE0: 100, TEXTURE_BINDING_2D: 'TB', UNPACK_ALIGNMENT: 'UA', UNPACK_FLIP_Y_WEBGL: 'FY', LUMINANCE: 'LUM', UNSIGNED_BYTE: 'UB',
      TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG', REPEAT: 'REPEAT', CLAMP_TO_EDGE: 'CLAMP', LINEAR: 'LINEAR',
      state: { UA: 4, FY: true } };
    gl.getParameter = (p) => (p === 'TB' ? gl.units[gl.active] : gl.state[p]);
    gl.pixelStorei = (p, v) => { gl.state[p] = v; };
    gl.createTexture = () => { const t = { id: gl.textures.length }; gl.textures.push(t); return t; };
    gl.bindTexture = (target, t) => { gl.units[gl.active] = t; };
    gl.texParameteri = (target, k, v) => { gl.calls.push(['texParameteri', gl.units[gl.active], k, v]); };
    gl.texImage2D = (...a) => { gl.calls.push(['texImage2D', { tex: gl.units[gl.active], format: a[2], w: a[3], h: a[4], bytes: a[8], flipY: gl.state.FY, align: gl.state.UA }]); };
    gl.activeTexture = (u) => { gl.active = u; };
    gl.getUniformLocation = (prog, name) => name;
    gl.uniform1i = (loc, v) => { gl.uniforms[loc] = v; };
    gl.uniform1f = (loc, v) => { gl.uniforms[loc] = v; };
    gl.isContextLost = () => gl.lost;
    gl.isTexture = (t) => { gl.isTextureCalls++; return !gl.dead.has(t); };
    gl.uploads = () => gl.calls.filter((c) => c[0] === 'texImage2D').map((c) => c[1]);
    return gl;
  };
  const page = (response) => ({ location: { origin: 'https://example.test' }, requestIdleCallback: (fn) => fn(),
    fetch: jest.fn(() => (response === undefined ? Promise.resolve({ ok: true, json: () => Promise.resolve(GEO) }) : response())) });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  let createElement;
  beforeEach(() => {
    const real = document.createElement.bind(document);
    createElement = jest.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? fakeCanvas(0) : real(tag)));
  });
  afterEach(() => { createElement.mockRestore(); });

  it('Web Mercator y: the equator at a half, north at 0, clamped at the map\'s edge (DRAW_VS\'s own projection)', () => {
    expect(mercatorY(0)).toBeCloseTo(0.5, 12);
    expect(mercatorY(85.051129)).toBeCloseTo(0, 6);
    expect(mercatorY(-85.051129)).toBeCloseTo(1, 6);
    expect(mercatorY(90)).toBe(mercatorY(85.051129));
    expect(mercatorY(-90)).toBe(mercatorY(-85.051129));
    expect(mercatorY(30.45)).toBeCloseTo(0.5 - Math.log(Math.tan(Math.PI / 4 + (30.45 * Math.PI) / 360)) / (2 * Math.PI), 12);
  });
  it('draws every Polygon and MultiPolygon ring into the mercator square, holes cut by the even-odd rule, and reads one byte a texel', () => {
    const size = 8, canvas = fakeCanvas(size, (w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = i % 251; d[i * 4 + 1] = 7; d[i * 4 + 3] = 255; } return d; });
    const out = rasterizeLand(GEO, size, () => canvas), c = canvas.ctx.calls;
    expect(c[0]).toEqual(['fillRect', 0, 0, size, size]);                                    // sea first
    expect(c.filter((x) => x[0] === 'fill')).toEqual([['fill', 'evenodd'], ['fill', 'evenodd'], ['fill', 'evenodd']]);   // one fill a polygon (1 + 2), nothing for the null or the line
    expect(c.filter((x) => x[0] === 'beginPath')).toHaveLength(3);
    expect(c.filter((x) => x[0] === 'closePath')).toHaveLength(4);                           // four rings: the last polygon carries a hole
    const pts = c.filter((x) => x[0] === 'moveTo' || x[0] === 'lineTo');
    expect(pts[0][0]).toBe('moveTo'); expect(pts[0][1]).toBeCloseTo(0, 9); expect(pts[0][2]).toBeCloseTo(0, 4);            // -180, north edge -> the top-left corner
    expect(pts[1][0]).toBe('lineTo'); expect(pts[1][1]).toBeCloseTo(4, 9); expect(pts[1][2]).toBeCloseTo(4, 9);            // 0, 0 -> the centre
    expect(pts[2][1]).toBeCloseTo(8, 9); expect(pts[2][2]).toBeCloseTo(8, 4);                                              // 180, south edge -> the bottom-right corner
    expect(out).toBeInstanceOf(Uint8Array); expect(out).toHaveLength(size * size);
    out.forEach((v, i) => expect(v).toBe(i % 251));                                           // the red channel, nothing else
    expect(rasterizeLand(null, 2, () => fakeCanvas(2))).toEqual(new Uint8Array(4));           // no land at all: all sea, no throw
  });
  it('fetches the app\'s own land file, from the page\'s origin', () => {
    expect(landMaskUrl({ location: { origin: 'https://rawsurf.example' } })).toBe('https://rawsurf.example/ne_50m_land.json');
    expect(fs.existsSync(path.join(__dirname, '..', '..', '..', 'public', 'ne_50m_land.json'))).toBe(true);
    expect(LAND_MASK_SIZE).toBe(2048);
  });
  it('off: nothing is fetched, a one-texel land stand-in is bound and the shader is told there is no mask', () => {
    const gl = maskGl(), win = page();
    for (let f = 0; f < 3; f++) bindLandMask(gl, 'prog', 5, false, win);
    expect(win.fetch).not.toHaveBeenCalled();
    expect(gl.uniforms).toEqual({ u_land_mask: 5, u_land_on: 0 });
    expect(gl.uploads()).toHaveLength(1);
    expect(gl.uploads()[0]).toMatchObject({ w: 1, h: 1, format: 'LUM' });
    expect(Array.from(gl.uploads()[0].bytes)).toEqual([255]);                                 // land: with no mask every mark draws its land row
    expect(gl.units[105]).toBe(gl.uploads()[0].tex);
  });
  it('on: ONE fetch however many frames ask; land rows until the mask is ready, then the mask on its unit', async () => {
    const gl = maskGl(), win = page();
    for (let f = 0; f < 4; f++) bindLandMask(gl, 'prog', 5, true, win);
    expect(win.fetch).toHaveBeenCalledTimes(1);
    expect(win.fetch).toHaveBeenCalledWith('https://example.test/ne_50m_land.json');
    expect(gl.uniforms.u_land_on).toBe(0);
    await settle();
    bindLandMask(gl, 'prog', 5, true, win);
    expect(gl.uniforms).toEqual({ u_land_mask: 5, u_land_on: 1 });
    const big = gl.uploads().filter((u) => u.w === LAND_MASK_SIZE);
    expect(big).toHaveLength(1);
    expect(big[0]).toMatchObject({ h: LAND_MASK_SIZE, format: 'LUM', align: 1 });
    expect(big[0].bytes).toHaveLength(LAND_MASK_SIZE * LAND_MASK_SIZE);
    expect(gl.units[105]).toBe(big[0].tex);
    expect(gl.calls).toContainEqual(['texParameteri', big[0].tex, 'WS', 'REPEAT']);           // the world wraps east-west
    expect(gl.calls).toContainEqual(['texParameteri', big[0].tex, 'WT', 'CLAMP']);
    bindLandMask(gl, 'prog', 5, false, win);                                                   // the theme turned dark: the stand-in again, the mask kept
    expect(gl.uniforms.u_land_on).toBe(0);
    expect(gl.units[105]).toBe(gl.uploads()[0].tex);
    expect(win.fetch).toHaveBeenCalledTimes(1);
  });
  it('uploads north-up whatever unpack state the page left, and leaves that state and the map\'s binding as it found them', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog', 5, true, win);
    await settle();
    for (const u of gl.uploads()) expect(u.flipY).toBe(false);                                 // a flipped mask would put the Arctic's land rows on the Southern Ocean
    expect(gl.state).toEqual({ UA: 4, FY: true });
    expect(gl.units[100]).toBe('the-maps-own-texture');                                        // the map's binding on the unit it was on
  });
  it('keeps the engine\'s own record of the active unit true (WebGLWindUtils.bindTexture\'s shadow): the next bind lands on the unit it names', () => {
    const gl = maskGl();
    gl.active = 102; gl.units[102] = 'the-colour-ramp'; gl.__activeTextureUnit = 102; gl.__boundTextures2D = [];   // as inside the engine's render, after the colour ramp went to unit 2
    bindLandMask(gl, 'prog', 5, false, page());
    expect(gl.__activeTextureUnit).toBe(gl.active);
    expect(gl.__boundTextures2D[5]).toBe(gl.units[105]);
    expect(gl.units[102]).toBe('the-colour-ramp');                                             // unit 2 holds what it held (the stand-in was made there and put back)
    expect(gl.units[100]).toBe('the-maps-own-texture');                                        // and nothing landed on unit 0
  });
  it('a failed, missing or empty file leaves every mark on its land row, quietly, and is not fetched again', async () => {
    const json = (body) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    // an empty or malformed collection would be an ALL-SEA mask (sea rows on every continent): it is a failure, not a mask
    for (const response of [() => Promise.resolve({ ok: false, status: 404 }), () => Promise.reject(new Error('offline')), json({ features: 'nope' }), json({ type: 'FeatureCollection', features: [] }), json(null),
      () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('not json')) })]) {
      const gl = maskGl(), win = page(response);
      bindLandMask(gl, 'prog', 5, true, win);
      await settle();
      for (let f = 0; f < 3; f++) bindLandMask(gl, 'prog', 5, true, win);
      expect(win.fetch).toHaveBeenCalledTimes(1);
      expect(gl.uniforms.u_land_on).toBe(0);
      expect(gl.uploads().filter((u) => u.w === LAND_MASK_SIZE)).toHaveLength(0);
      expect(gl.units[105]).toBe(gl.uploads()[0].tex);
      expect(win.__WIND_LAND_MASK__.status).toBe('failed');
    }
    const gl = maskGl();
    expect(() => bindLandMask(gl, 'prog', 5, true, { location: { origin: '' } })).not.toThrow();   // no fetch at all (an old webview)
    expect(gl.uniforms.u_land_on).toBe(0);
    expect(() => bindLandMask(null, 'prog', 5, true)).not.toThrow();
  });
  it('a context that was lost and restored starts again: dead textures are never bound, the mask is loaded anew', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog-A', 5, true, win);
    await settle();
    bindLandMask(gl, 'prog-A', 5, true, win);
    expect(gl.uniforms.u_land_on).toBe(1);
    expect(gl.isTextureCalls).toBe(0);                                                        // the same program: no driver round trip a frame
    gl.dead = new Set(gl.textures);                                                           // the context came back: every texture made before is gone
    bindLandMask(gl, 'prog-B', 5, true, win);                                                 // the engine rebuilt its programs
    expect(gl.uniforms.u_land_on).toBe(0);
    expect(gl.dead.has(gl.units[105])).toBe(false);
    expect(win.fetch).toHaveBeenCalledTimes(2);
    await settle();
    bindLandMask(gl, 'prog-B', 5, true, win);
    expect(gl.uniforms.u_land_on).toBe(1);
    expect(gl.dead.has(gl.units[105])).toBe(false);
  });
  it('a rebuilt engine on a live context keeps the mask it has (no second fetch)', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog-A', 5, true, win);
    await settle();
    bindLandMask(gl, 'prog-B', 5, true, win);
    expect(gl.uniforms.u_land_on).toBe(1);
    expect(win.fetch).toHaveBeenCalledTimes(1);
    expect(gl.isTextureCalls).toBe(1);                                                        // asked once, when the program changed
  });
  it('a load that was still in flight when the context came back never uploads into the new one', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog-A', 5, true, win);                                                 // in flight
    gl.dead = new Set(gl.textures);
    bindLandMask(gl, 'prog-B', 5, true, win);                                                 // restored: a second load
    await settle();
    expect(gl.uploads().filter((u) => u.w === LAND_MASK_SIZE)).toHaveLength(1);
  });
  it('publishes its state for the read-back (window.__WIND_LAND_MASK__)', async () => {
    const gl = maskGl(), win = page();
    bindLandMask(gl, 'prog', 5, true, win);
    expect(win.__WIND_LAND_MASK__).toMatchObject({ status: 'loading' });
    await settle();
    expect(win.__WIND_LAND_MASK__).toMatchObject({ status: 'ready', size: LAND_MASK_SIZE });
    const bad = page(() => Promise.resolve({ ok: false, status: 404 }));
    bindLandMask(maskGl(), 'prog', 5, true, bad);
    await settle();
    expect(bad.__WIND_LAND_MASK__).toMatchObject({ status: 'failed' });
    expect(String(bad.__WIND_LAND_MASK__.reason)).toContain('404');
  });
});

describe('the shader and the engine wiring (string pins; the GPU bench is the authority)', () => {
  const live = (src) => src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');   // what the GLSL compiler sees
  it('DRAW_VS hands the mark\'s place on the world to the fragment shader', () => {
    expect(live(DRAW_VS)).toContain('varying vec2 v_world;');
    expect(live(DRAW_VS)).toContain('v_world = vec2(fract(global_pos.x), global_pos.y);');
  });
  it('DRAW_FS declares the mask at the best precision the device has, and mixes the LUT\'s rows by it', () => {
    expect(DRAW_FS).toContain(GLSL_LAND_FS);
    expect(GLSL_LAND_FS).toContain('#ifdef GL_FRAGMENT_PRECISION_HIGH\n#define LAND_HP highp\n#else\n#define LAND_HP mediump\n#endif');
    expect(live(GLSL_LAND_FS)).toContain('uniform sampler2D u_land_mask; uniform float u_land_on; varying LAND_HP vec2 v_world;');
    expect(GLSL_LAND_FS.startsWith('\n#ifdef')).toBe(true);                                   // a preprocessor line must start its own line
    // row 0 (v 0.25) is the land row, row 1 (v 0.75) the sea row; with no mask every mark reads 1.0 = land
    expect(live(DRAW_FS)).toContain('vec4 color = mix(texture2D(u_color_ramp, vec2(normalizedSpeed, 0.75)), texture2D(u_color_ramp, vec2(normalizedSpeed, 0.25)), u_land_on > 0.5 ? texture2D(u_land_mask, v_world).r : 1.0);');
    expect(DRAW_FS.match(/texture2D\(u_color_ramp/g)).toHaveLength(2);
  });
  it('the engine builds a two-row marks table, binds the mask on a unit of its own and rebuilds on the look key', () => {
    expect(ENGINE.match(/drawnMarkRampData\(this\._maxWindSpeed, activeTheme\)/g)).toHaveLength(2);   // render and setTheme
    expect(ENGINE.match(/createTexture\(gl, gl\.LINEAR, rampData, 256, 2\)/g)).toHaveLength(2);
    expect(ENGINE.match(/lookKey !== this\._lookKey/g)).toHaveLength(2);
    expect(ENGINE).toContain('bindLandMask(gl, this.drawProgram, 5, windDarkRulesOn(effectiveTheme));');
    expect(ENGINE).not.toMatch(/bindTexture\(gl, [^)]*, 5\)/);                                 // unit 5 is the mask's alone (0-3 are the engine's; the state isolation restores 0-6)
    expect(ENGINE).not.toContain('resolveMarkRamp');                                           // the engine reads the drawn tables, never the rollback ones
  });
  it('the wind bench can name the kill, and hands the engine the offline basemap\'s own coast', () => {
    const { buildMatrix, ALL_VARIANTS } = require('../../../scripts/wind-bench/matrix');
    const { offlineLand, GULF, ATLANTIC } = require('../../../scripts/wind-bench/page/offline-coast');
    expect(ALL_VARIANTS['before-rules'].levers).toEqual(KILL);                                // `candidate` draws the default; this is the arm to scan it against
    expect(ALL_VARIANTS.candidate.levers).toEqual({});
    expect(buildMatrix({ themes: ['light', 'beach'], variants: ['candidate', 'before-rules'], views: ['world-z4'] })).toHaveLength(4);
    const land = offlineLand();                                                                // the whole map with the two seas cut out by the even-odd rule
    expect(land.features).toHaveLength(1);
    expect(land.features[0].geometry.type).toBe('Polygon');
    expect(land.features[0].geometry.coordinates.slice(1)).toEqual([GULF, ATLANTIC]);
    for (const ring of land.features[0].geometry.coordinates) expect(ring[0]).toEqual(ring[ring.length - 1]);   // closed rings
  });
  it('the table\'s rows are land first, sea second, as the shader reads them', () => {
    const marks = drawnMarkRampData(75, 'light', {}), m = resolveDrawnMarks('light', {});
    expect(Array.from(marks.subarray(0, 1024))).toEqual(Array.from(generateRampData(75, m.land, 'light', {})));
    expect(Array.from(marks.subarray(1024))).toEqual(Array.from(generateRampData(75, m.water, 'light', {})));
    expect(fnv(marks.subarray(0, 1024))).not.toBe(fnv(marks.subarray(1024)));
  });
});
