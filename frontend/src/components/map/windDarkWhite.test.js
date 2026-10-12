/**
 * DARK'S WHITE, GROUND BY GROUND: light and beach lay the white streak by the ground under the mark (windDarkRules.js DARK_WHITE;
 * DECISIONS D-022). ON BY DEFAULT wherever the white streak draws.
 *
 * The owner, 2026-10-11, on the deployed build of the white streak (D-021): "I dont see the wind for light mode or beach mode
 * mirroring the dark mode"; then, watching the three themes on the deployed app: "light mode and beach mode close up zoom ... looks
 * somewhat okay ... Its when you start zooming out that the contrast in theme modes happens"; "you should be able to mathmatically
 * determine".
 *
 * Measured with one probe on the owner's screen and on the bench (scripts/wind-bench/page/mirror-probe.js, mirror-run.js; log
 * 2026-10-11-wind-dark-white): how far the streaks LIFT the whole picture above its ground, beside dark's. Dark's map is light's and
 * beach's turned over (a near-black land and a slate sea; theirs a pale land and a deep sea), and the white streak was laid at one
 * strength on both grounds. Over land it lifted the picture 0.30 to 0.93 times as far as dark's streaks lift dark's land; over the
 * sea 1.06 to 1.64 times as far, where its cores went paper white and buried the colour field. A zoomed-out view is mostly sea.
 *
 * This file pins: the numbers, and that they are STRENGTHS (the mark carries the square root: the screen pass lays a trail at its
 * level squared); the switch and its kill; the shader and engine lines that carry it; that no table, key or mark model moves; and
 * what the law gives per knot, with full strength as its positive control. The GPU bench is the authority for the picture and for
 * "as far as dark's" (motion-run.js + mirror-run.js --at, land and sea read apart).
 */
import fs from 'fs';
import path from 'path';
import { DARK_WHITE, WHITE_STREAK, darkRulesGround, lstar, chroma } from './windDarkRules';
import { windWhiteStrength, windWhiteStreakOn, resolveDrawnField, drawnMarkRampData, buildFieldRampTexture, windLookKey, huePathStops, sampleRamp,
  DARK_RULES_HOLDS } from './WindColorRamp';
import { windInk, glowComposite } from './windInk';
import { resolveWindParticlesV2 } from './WebGLWindUtils';
import { DRAW_FS, SCREEN_FS } from './WebGLWindShaders';
import { GLSL_LAND_FS } from './windLandMask';

const V2 = resolveWindParticlesV2({});
const KILL = { __RAW_DISABLE_WIND_DARK_WHITE__: true };   // full strength on both grounds, as PR #313 laid it
const NO_PATH = { __RAW_DISABLE_WIND_LIGHT_PATH__: true };   // light's path (windLightPath.js, D-024) re-ordered light's 1 to 32 kn rows since: PR #313's bytes are what light draws under ITS kill
const FULL = { land: 1, sea: 1 };
const THEMES = ['light', 'beach'];
const WHITE_MARKS = { mode: 2, on: false, glow: true, purity: 0, density: 1, opacity: 1.0, spine: 1, white: 0 };   // D-021's mark model: this change leaves it alone

const fnv = (a) => { let h = 2166136261; for (const b of a) h = Math.imul(h ^ b, 16777619); return (h >>> 0).toString(16); };
const rampGl = () => { const gl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4, CLAMP_TO_EDGE: 5, LINEAR: 6, TEXTURE_WRAP_S: 7, TEXTURE_WRAP_T: 8, TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10,
  getParameter: () => null, createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {} }; gl.texImage2D = (...a) => { gl.uploaded = a[8]; }; return gl; };
/** [marks row 0 (land), marks row 1 (sea), field] as FNV-1a of the 256-entry RGBA tables the engine uploads. */
const hashes = (theme, w, max) => { const marks = drawnMarkRampData(max, theme, w), gl = rampGl(); buildFieldRampTexture(gl, max, theme, w);
  return [fnv(marks.subarray(0, 1024)), fnv(marks.subarray(1024)), gl.uploaded ? fnv(gl.uploaded) : null]; };
// What dev drew at 0173f365 (PR #313's merge) with no lever set: windWhiteStreak.test.js WATCHED. This change moves none of them.
const TABLES = {
  light: { 50: ['71ea0097', '71ea0097', 'f73f7078'], 75: ['a49922ce', 'a49922ce', 'f9ffc9c2'] },
  beach: { 50: ['6e75db94', '72b4bd7f', '7c248d5f'], 75: ['be558fd8', 'cd4835ed', 'b9db3bb2'] },
};

const dec = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hue = (rgb) => {   // CIELAB hue angle of an sRGB colour (0-1)
  const r = dec(rgb[0]), g = dec(rgb[1]), b = dec(rgb[2]), f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047), fy = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b), fz = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return (Math.atan2(200 * (fy - fz), 500 * (fx - fy)) * 180 / Math.PI + 360) % 360;
};
const gap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/** The field's colour ON SCREEN over the theme's muted land or sea at `kn` (the solver's own model of the ground). */
const ground = (theme, kn, surface) => darkRulesGround(theme, surface, sampleRamp(huePathStops(resolveDrawnField(theme, {}), {}), kn), kn);
/** Where streaks pile up: the trail buffer holds the white ring at the mark's light level, and the screen pass lays it at level squared. */
const piled = (g, strength) => { const level = Math.sqrt(strength); return glowComposite(g, [level, level, level], WHITE_STREAK.opacity); };

describe('the numbers: a strength for each ground, a theme', () => {
  it('full strength over land; over the sea 0.55 in light and 0.77 in beach (the bench\'s equal-lift strengths)', () => {
    expect(DARK_WHITE).toEqual({ light: { land: 1, sea: 0.55 }, beach: { land: 1, sea: 0.77 } });
    expect(Object.isFrozen(DARK_WHITE)).toBe(true); expect(Object.isFrozen(DARK_WHITE.light)).toBe(true); expect(Object.isFrozen(DARK_WHITE.beach)).toBe(true);
    expect(DARK_WHITE.dark).toBeUndefined();
  });
  it('light and beach read them by default; the kill, dark, and anything that stands the white streak down read full strength on both grounds', () => {
    expect(windWhiteStrength('light', {})).toEqual({ land: 1, sea: 0.55 });
    expect(windWhiteStrength('beach', {})).toEqual({ land: 1, sea: 0.77 });
    for (const theme of [...THEMES, 'dark']) expect(windWhiteStrength(theme, KILL)).toEqual(FULL);
    expect(windWhiteStrength('dark', {})).toEqual(FULL);
    for (const theme of THEMES) {
      expect(windWhiteStreakOn(theme, KILL)).toBe(true);                                  // the kill is the strength alone: the white streak still draws
      for (const off of ['__RAW_DISABLE_WIND_WHITE_STREAK__', '__RAW_DISABLE_WIND_DARK_RULES__', ...DARK_RULES_HOLDS]) expect(windWhiteStrength(theme, { [off]: true })).toEqual(FULL);
    }
    for (const look of ['moderate', 'deep', 'ink']) expect(windWhiteStrength('light', { __RAW_WIND_LIGHT_LOOK__: look })).toEqual(FULL);   // an explicit light look draws its own way
    expect(windWhiteStrength('beach', { __RAW_WIND_LIGHT_LOOK__: 'deep' })).toEqual({ land: 1, sea: 0.77 });                           // and holds light only
    const mine = windWhiteStrength('light', {}); mine.sea = 9;
    expect(windWhiteStrength('light', {}).sea).toBe(0.55);                               // the caller's own copy
  });
  it('the real window is read when no lever object is passed (the engine\'s own call shape), and the kill acts at once', () => {
    try {
      expect(windWhiteStrength('light')).toEqual({ land: 1, sea: 0.55 });
      window.__RAW_DISABLE_WIND_DARK_WHITE__ = true;
      expect(windWhiteStrength('light')).toEqual(FULL); expect(windWhiteStrength('beach')).toEqual(FULL);
    } finally { delete window.__RAW_DISABLE_WIND_DARK_WHITE__; }
    expect(windWhiteStrength('beach')).toEqual({ land: 1, sea: 0.77 });
  });
});

describe('it is the strength alone: no table, no key and no mark model moves', () => {
  it.each([50, 75])('the fields and the streak rows are PR #313\'s, byte for byte, with and without the kill (%i kn)', (max) => {
    for (const theme of THEMES) { const w = theme === 'light' ? NO_PATH : {}; expect(hashes(theme, w, max)).toEqual(TABLES[theme][max]); expect(hashes(theme, { ...w, ...KILL }, max)).toEqual(TABLES[theme][max]); }
    expect(hashes('light', {}, max)).not.toEqual(TABLES.light[max]);                         // light's default has moved on (D-024) ...
    expect(hashes('light', KILL, max)).toEqual(hashes('light', {}, max));                    // ... and the strength's kill moves no table there either
    expect(hashes('dark', {}, max)).toEqual(hashes('dark', KILL, max));
  });
  it('the mark model and the look key are D-021\'s (the strength is a uniform the engine binds every frame)', () => {
    for (const theme of THEMES) for (const w of [{}, KILL]) { expect(windInk(theme, V2, w)).toEqual(WHITE_MARKS); expect(windLookKey(theme, w)).toBe(theme === 'light' ? 'white+path|dark-rules' : 'white|dark-rules'); }
    expect(windInk('dark', V2, {}).mode).toBe(0);
  });
});

describe('how it reaches the pixel: the mark\'s light level, picked by the land mask', () => {
  const ENGINE = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
  it('the mark shader reads the land under the mark once, picks its row by it, and scales its LIGHT by the level for that ground (never its cover)', () => {
    expect(GLSL_LAND_FS).toMatch(/uniform vec2 u_white;/);
    expect(DRAW_FS).toContain('float land = u_land_on > 0.5 ? texture2D(u_land_mask, v_world).r : 1.0; vec4 color = mix(texture2D(u_color_ramp, vec2(normalizedSpeed, 0.75)), texture2D(u_color_ramp, vec2(normalizedSpeed, 0.25)), land);');
    expect(DRAW_FS).toContain('gl_FragColor = vec4(rgb * alpha * (u_white.y + (u_white.x - u_white.y) * land), alpha);');
    expect(DRAW_FS.match(/u_white\.[xy]/g)).toHaveLength(3);                              // read on that one line and nowhere else
    expect(DRAW_FS.match(/texture2D\(u_land_mask/g)).toHaveLength(1);
    // with equal levels the factor is exactly the level whatever the mask says (y + 0 * land): dark, the kill and every hold draw as before, bit for bit
    for (const land of [0, 0.3, 0.7071, 1]) expect(1 + (1 - 1) * land).toBe(1);
  });
  it('the wind bench can name the kill (the scanner\'s own page has no land file, so that arm equals the default there by construction)', () => {
    const { ALL_VARIANTS } = require('../../../scripts/wind-bench/matrix');
    expect(ALL_VARIANTS['full-white'].levers).toEqual(KILL);
    expect(ALL_VARIANTS.candidate.levers).toEqual({});
  });
  it('the screen pass lays a trail at its level SQUARED, which is why a strength is carried as its square root', () => {
    expect(SCREEN_FS).toContain('brightness * (u_glow > 0.5 ? brightness : 1.0) * u_opacity');
    for (const s of [0.55, 0.77, 1]) {                                                    // the model of that line agrees: a white trail at level sqrt(s) is laid at s
      const g = [0.2, 0.4, 0.6], out = piled(g, s);
      out.forEach((c, i) => expect(c).toBeCloseTo(g[i] + (1 - g[i]) * s, 10));
    }
  });
  it('the engine hands the theme\'s strengths to the land mask\'s bind, every frame, on the draw program', () => {
    expect(ENGINE).toContain('bindLandMask(gl, this.drawProgram, 5, windDarkRulesOn(effectiveTheme), null, windWhiteStrength(effectiveTheme));');
    expect(ENGINE).toMatch(/import \{[^}]*windWhiteStrength[^}]*\} from '\.\/WindColorRamp';/);
  });
});

describe('what the law gives, per knot', () => {
  it('OVER THE SEA, where streaks pile up, a streak is its ground\'s colour made lighter; at full strength it was paper white', () => {
    const keeps = { light: 0.35, beach: 0.17 };                                           // of the ground's chroma, read: 0.364 at the least in light (45 kn), 0.183 in beach (47 kn)
    for (const theme of THEMES) for (let kn = 6; kn <= 55; kn++) {
      const g = ground(theme, kn, 'water'), now = piled(g, windWhiteStrength(theme, {}).sea), was = piled(g, windWhiteStrength(theme, KILL).sea);
      expect(chroma(now)).toBeGreaterThan(keeps[theme] * chroma(g));
      if (chroma(g) > 12) expect(gap(hue(now), hue(g))).toBeLessThan(16);
      expect(lstar(now)).toBeLessThan(theme === 'light' ? 79 : 91.5);                       // read: 78.2 at the most in light, 90.9 in beach (its 29 kn band, held pale)
      expect(lstar(now) - lstar(g)).toBeGreaterThan(27);                                  // and it still stands well off its ground (read: 28.1 to 50.4 L*)
      expect(chroma(was)).toBeLessThan(0.5);                                              // the control: no colour left
      expect(lstar(was)).toBeGreaterThan(99.5);
    }
  });
  it('OVER LAND nothing changes: full strength, as before (the pale land has no room above it; even full white lifts it less than dark lifts its land)', () => {
    for (const theme of THEMES) for (let kn = 0; kn <= 55; kn++) {
      const g = ground(theme, kn, 'land');
      expect(piled(g, windWhiteStrength(theme, {}).land)).toEqual(piled(g, windWhiteStrength(theme, KILL).land));
    }
    expect(100 - lstar(ground('light', 0, 'land'))).toBeLessThan(22);                     // calm over light's land: 21.4 L* of room in all
  });
  it('the sea is the deeper ground at every speed, in both themes: that is why one strength could not fit both', () => {
    for (const theme of THEMES) for (let kn = 0; kn <= 55; kn++) expect(lstar(ground(theme, kn, 'land')) - lstar(ground(theme, kn, 'water'))).toBeGreaterThan(8);
  });
});
