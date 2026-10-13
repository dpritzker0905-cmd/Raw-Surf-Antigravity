/**
 * THE WHITE STREAK: light and beach draw dark's own streak, ON BY DEFAULT (windDarkRules.js WHITE_STREAK; DECISIONS D-021).
 *
 * The owner, 2026-10-11, after watching dark, today's light and beach, and two candidates each side by side in motion: "middle row
 * for both, build it". The middle row was, per theme, ONE existing lever set on dev's own code (86306199):
 *   light  window.__RAW_WIND_LIGHT_LOOK__ = 'deep' with window.__RAW_WIND_GLOW_RING__ = 1   (the deeper field of light's A/B, dark's ring)
 *   beach  window.__RAW_WIND_GLOW_RING__ = 1                                                 (the tables it draws today, dark's ring)
 * This file pins three things:
 *   - THE DEFAULT IS THOSE TWO ARMS, byte for byte: the tables' hashes were captured from the code at 86306199 through those levers,
 *     BEFORE the default moved (LESSONS L-V25), and the mark model is the one those levers gave;
 *   - THE KILL IS EXACT: window.__RAW_DISABLE_WIND_WHITE_STREAK__ = true draws what dev drew at 86306199 (PR #312), byte for byte;
 *   - WHAT THE LOOK IS, read per knot (LESSONS L-V34): the head of every streak is near-white light above a ground deep enough to show
 *     it, and where a ground is NOT deep enough (beach's 26-39 kn over land, which the name guard holds pale) it says so.
 * Dark's rules still decide whether a theme is drawn this way at all: every lever and older kill that stands them down stands this
 * down with them (windDarkRules.test.js sweeps those; that file now reads the rules' own tables under this kill).
 * The GPU bench is the authority for what is drawn (scripts/wind-bench/map-run.js); these are the tables and the model.
 */
import { DARK_RULES, WHITE_STREAK } from './windDarkRules';
import { windWhiteStreakOn, windDarkRulesOn, DARK_RULES_HOLDS, DARK_RULES_STEERS, resolveDrawnField, resolveDrawnMarks, drawnMarkRampData, windLookKey, buildFieldRampTexture,
  huePathStops, sampleRamp } from './WindColorRamp';
import { windInk, glowOf, glowComposite } from './windInk';
import { resolveWindParticlesV2, v2SpeedPremul } from './WebGLWindUtils';
import { muteColor, windBasemapMuteAmount, windBasemapWaterL } from './windBasemapMute';

const V2 = resolveWindParticlesV2({});
const KILL = { __RAW_DISABLE_WIND_WHITE_STREAK__: true };
// LIGHT'S PATH (windLightPath.js, D-024) has since re-ordered light's 1 to 32 kn rows ON TOP of this arm. Its kill draws the arm the owner
// watched here, so light's bytes below are read under it; what light draws with no lever is windLightPath.test.js's.
const NO_PATH = { __RAW_DISABLE_WIND_LIGHT_PATH__: true };
const THEMES = ['light', 'beach'];
const WHITE_MARKS = { mode: 2, on: false, glow: true, purity: 0, density: 1, opacity: 1.0, spine: 1, white: 0 };       // dark's streak method with dark's own ring
const RULES_MARKS = { mode: 2, on: false, glow: true, purity: 0, density: 1, opacity: 1.0, spine: 0.25, white: 0 };   // PR #312's: what the kill restores
const MARKS_OFF = { mode: 0, on: false, glow: false, opacity: 0, spine: 0, purity: 0, density: 1, white: 0 };

const fnv = (a) => { let h = 2166136261; for (const b of a) h = Math.imul(h ^ b, 16777619); return (h >>> 0).toString(16); };
const rampGl = () => { const gl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4, CLAMP_TO_EDGE: 5, LINEAR: 6, TEXTURE_WRAP_S: 7, TEXTURE_WRAP_T: 8, TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10,
  getParameter: () => null, createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {} }; gl.texImage2D = (...a) => { gl.uploaded = a[8]; }; return gl; };
/** [marks row 0 (land), marks row 1 (sea), field] as FNV-1a of the 256-entry RGBA tables the engine uploads. */
const hashes = (theme, w, max) => { const marks = drawnMarkRampData(max, theme, w), gl = rampGl(); buildFieldRampTexture(gl, max, theme, w);
  return [fnv(marks.subarray(0, 1024)), fnv(marks.subarray(1024)), gl.uploaded ? fnv(gl.uploaded) : null]; };

// Captured from the running code at 86306199 (dev, PR #312's merge), before this change, at 50 and 75 kn.
const WATCHED = {   // through the levers of the arm the owner picked
  light: { 50: ['71ea0097', '71ea0097', 'f73f7078'], 75: ['a49922ce', 'a49922ce', 'f9ffc9c2'] },   // __RAW_WIND_LIGHT_LOOK__ = 'deep': one streak row over land and sea
  beach: { 50: ['6e75db94', '72b4bd7f', '7c248d5f'], 75: ['be558fd8', 'cd4835ed', 'b9db3bb2'] },   // no table lever: dark's rules' own tables
};
// SINCE BEACH'S PATH (windBeachPath.js, 2026-10-12) beach's FIELD under the white streak is its own solved table: the arm the owner
// watched is drawn through that change's kill (P), and the default is DRAWN: the same two streak rows, the path's field.
const P = { __RAW_DISABLE_WIND_BEACH_PATH__: true };
const B4 = { ...P, ...NO_PATH };   // each theme before ITS path (each kill is read by its own theme only): the arm the owner watched, in light and in beach
const DRAWN = { light: WATCHED.light /* with light's path killed, as the window block below reads it; light's default is windLightPath.test.js's */, beach: { 50: ['6e75db94', '72b4bd7f', '67bfe560'], 75: ['be558fd8', 'cd4835ed', 'b0931ff3'] } };
const KEY = { light: 'white+path|dark-rules', beach: 'white+path|dark-rules' };   // with no lever: each theme on its path
const BEFORE = {    // with no lever: what dev drew, and what the kill must restore
  light: { 50: ['46e55dbb', '177f0c5b', 'f03b4ab5'], 75: ['6d6d01df', 'f1f3ef88', 'bf0b2134'] },
  beach: WATCHED.beach,
};
const DARK = ['c2ebc33e', 'c2ebc33e', null];

describe('the default: the two arms the owner watched, byte for byte', () => {
  it('the streak is dark\'s method with dark\'s own white ring, at full strength, with no white mixed into its body', () => {
    expect(WHITE_STREAK).toEqual({ opacity: 1.0, ring: 1, white: 0 });
    expect(Object.isFrozen(WHITE_STREAK)).toBe(true);
    for (const theme of THEMES) {
      expect(windWhiteStreakOn(theme, {})).toBe(true);
      expect(windInk(theme, V2, {})).toEqual(WHITE_MARKS);
      expect(v2SpeedPremul(V2, theme, {})).toEqual({ on: false, opacity: 0, singleCasing: false });   // dark's own buffer and fade, not the premultiplied composite
    }
    // and it IS the mark model the watched levers gave on dev
    expect(windInk('light', V2, {})).toEqual(windInk('light', V2, { __RAW_WIND_LIGHT_LOOK__: 'deep', __RAW_WIND_GLOW_RING__: 1 }));
    expect(windInk('beach', V2, {})).toEqual(windInk('beach', V2, { ...KILL, __RAW_WIND_GLOW_RING__: 1 }));
  });
  it.each([50, 75])('light draws its deeper field and that field\'s own streak row; beach keeps the tables it drew (%i kn)', (max) => {
    for (const theme of THEMES) expect(hashes(theme, B4, max)).toEqual(WATCHED[theme][max]);
    expect(hashes('beach', {}, max)).toEqual(DRAWN.beach[max]);                                                // beach's default: the same two streak rows, its path's field (D-025)
    expect(hashes('light', NO_PATH, max)).toEqual(hashes('light', { __RAW_WIND_LIGHT_LOOK__: 'deep' }, max));   // the lever's own path still draws the same bytes
    expect(hashes('light', NO_PATH, max)).not.toEqual(BEFORE.light[max]);
    expect(hashes('light', {}, max)).not.toEqual(WATCHED.light[max]);                                          // and light's default has moved on from this arm (D-024)
    expect(hashes('light', {}, max)[0]).toBe(hashes('light', {}, max)[1]);                                     // still one streak row over land and sea
  });
  it('light has ONE streak row: the same colours over land and over sea (a white streak takes its colour from what is under it)', () => {
    const m = resolveDrawnMarks('light', {});
    expect(m.land).toEqual(m.water);
    m.land[3][1] = 9;                                                                                  // and the caller cannot reach the tables
    expect(resolveDrawnMarks('light', {}).land[3][1]).not.toBe(9);
    const f = resolveDrawnField('light', {}); f[3][1] = 9;
    expect(resolveDrawnField('light', {})[3][1]).not.toBe(9);
  });
  it('dark is not touched: its tables and its marks are what they were, whatever is set', () => {
    for (const w of [{}, KILL, { __RAW_WIND_GLOW_RING__: 1 }]) {
      expect(hashes('dark', w, 50)).toEqual(DARK);
      expect(windInk('dark', V2, w)).toEqual(MARKS_OFF);
      expect(windWhiteStreakOn('dark', w)).toBe(false);
      expect(windLookKey('dark', w)).toBe('|');
    }
  });
});

describe('the kill: window.__RAW_DISABLE_WIND_WHITE_STREAK__ draws what dev drew at 86306199, byte for byte', () => {
  it.each([50, 75])('both themes\' tables are the ones captured before (%i kn), and dark\'s rules still draw them', (max) => {
    for (const theme of THEMES) {
      expect(hashes(theme, KILL, max)).toEqual(BEFORE[theme][max]);
      expect(windDarkRulesOn(theme, KILL)).toBe(true);
      expect(windWhiteStreakOn(theme, KILL)).toBe(false);
    }
  });
  it('the marks go back to the quarter ring', () => {
    for (const theme of THEMES) expect(windInk(theme, V2, KILL)).toEqual(RULES_MARKS);
    expect(RULES_MARKS.spine).toBe(DARK_RULES.ring);
  });
  it('only exactly true kills', () => {
    for (const v of [1, 'true', 'yes', {}, null, undefined, false]) for (const theme of THEMES) expect(windWhiteStreakOn(theme, { __RAW_DISABLE_WIND_WHITE_STREAK__: v })).toBe(true);
  });
  it('the engine rebuilds its tables at once when it flips: the look key says which, and still ends as dark\'s rules\' does', () => {
    for (const theme of THEMES) {
      expect(windLookKey(theme, {})).toBe(KEY[theme]);
      expect(windLookKey(theme, B4)).toBe('white|dark-rules');
      expect(windLookKey(theme, KILL)).toBe('|dark-rules');
    }
    expect(windLookKey('beach', { __RAW_WIND_LIGHT_LOOK__: 'deep' })).toBe('deep+white+path|dark-rules');   // an explicit light look holds light only; beach still draws the white streak
    expect(windLookKey('light', { __RAW_WIND_LIGHT_LOOK__: 'deep' })).toBe('deep|');
  });
});

describe('the engine\'s own call shape: no lever object, the levers on the real window', () => {
  // WebGLWindEngine calls windLookKey(theme), drawnMarkRampData(max, theme), buildFieldRampTexture(gl, max, theme) and windInk(theme, v2)
  // with no `win`. Every test above hands a lever object in, so a function that read its argument and never the window would pass them
  // all and leave the kill dead in the app (found by an independent review's mutant, 2026-10-11).
  const fieldHash = (theme, max) => { const gl = rampGl(); buildFieldRampTexture(gl, max, theme); return gl.uploaded ? fnv(gl.uploaded) : null; };
  const asTheEngineReads = (theme, max) => { const marks = drawnMarkRampData(max, theme); return [fnv(marks.subarray(0, 1024)), fnv(marks.subarray(1024)), fieldHash(theme, max)]; };
  // Light's path is killed on the window for this block, so both themes read D-021's arm as the engine would (its own window shape: windLightPath.test.js).
  beforeEach(() => { window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true; });
  const WKEY = { ...KEY, light: 'white|dark-rules' };   // this block's window: light's path killed, beach on its path
  afterEach(() => { delete window.__RAW_DISABLE_WIND_WHITE_STREAK__; delete window.__RAW_DISABLE_WIND_DARK_RULES__; delete window.__RAW_DISABLE_WIND_LIGHT_PATH__; });
  it('with nothing set on the window it draws the default', () => {
    for (const theme of THEMES) {
      expect(windWhiteStreakOn(theme)).toBe(true);
      expect(windLookKey(theme)).toBe(WKEY[theme]);
      expect(asTheEngineReads(theme, 50)).toEqual(DRAWN[theme][50]);
      expect(windInk(theme, V2)).toEqual(WHITE_MARKS);
    }
  });
  it('the kill set on the window flips the look key, the tables and the marks at once, and clearing it flips them back', () => {
    window.__RAW_DISABLE_WIND_WHITE_STREAK__ = true;
    for (const theme of THEMES) {
      expect(windWhiteStreakOn(theme)).toBe(false);
      expect(windLookKey(theme)).toBe('|dark-rules');                                                // the engine compares this with the key it built on
      expect(asTheEngineReads(theme, 50)).toEqual(BEFORE[theme][50]);
      expect(asTheEngineReads(theme, 75)).toEqual(BEFORE[theme][75]);
      expect(windInk(theme, V2)).toEqual(RULES_MARKS);
    }
    expect(windLookKey('dark')).toBe('|');
    delete window.__RAW_DISABLE_WIND_WHITE_STREAK__;
    for (const theme of THEMES) { expect(windLookKey(theme)).toBe(WKEY[theme]); expect(asTheEngineReads(theme, 75)).toEqual(DRAWN[theme][75]); }
  });
  it('dark\'s rules\' own kill on the window still wins over it', () => {
    window.__RAW_DISABLE_WIND_DARK_RULES__ = true;
    for (const theme of THEMES) { expect(windWhiteStreakOn(theme)).toBe(false); expect(windLookKey(theme)).toBe('|'); expect(windInk(theme, V2)).toEqual(MARKS_OFF); }
  });
});

describe('dark\'s rules still decide: whatever stands them down stands the white streak down, and draws what it drew', () => {
  const sameWithOrWithoutTheKill = (theme, w) => {
    const v2 = resolveWindParticlesV2(w);
    expect(windWhiteStreakOn(theme, w)).toBe(false);
    expect(hashes(theme, w, 50)).toEqual(hashes(theme, { ...w, ...KILL }, 50));
    expect(windInk(theme, v2, w)).toEqual(windInk(theme, v2, { ...w, ...KILL }));
    expect(windLookKey(theme, w)).toBe(windLookKey(theme, { ...w, ...KILL }));
  };
  it('dark\'s rules\' own kill and its narrowing lever', () => {
    for (const theme of THEMES) for (const w of [{ __RAW_DISABLE_WIND_DARK_RULES__: true }, { __RAW_WIND_DARK_RULES__: false }, { __RAW_WIND_DARK_RULES__: theme === 'light' ? 'beach' : 'light' }]) {
      sameWithOrWithoutTheKill(theme, w);
      expect(windInk(theme, V2, w)).toEqual(MARKS_OFF);
    }
    expect(windWhiteStreakOn('beach', { __RAW_WIND_DARK_RULES__: 'beach' })).toBe(true);
  });
  it.each(DARK_RULES_HOLDS)('the older kill %s', (kill) => { for (const theme of THEMES) sameWithOrWithoutTheKill(theme, { [kill]: true }); });
  const STEERS = { __RAW_WIND_FIELD_TINT__: 0.9, __RAW_WIND_FIELD_TINT_THEMES__: 'beach', __RAW_WIND_PREMUL_THEMES__: 'light', __RAW_WIND_BASEMAP_MUTE__: 0.5, __RAW_WIND_BASEMAP_WATER_L__: 0.95 };
  it('the bench levers that steer what the rules assume, set at all', () => {
    expect(Object.keys(STEERS).sort()).toEqual([...DARK_RULES_STEERS].sort());
    for (const [lever, value] of Object.entries(STEERS)) for (const theme of THEMES) sameWithOrWithoutTheKill(theme, { [lever]: value });
  });
  it.each([{ __RAW_WIND_INK__: true }, { __RAW_WIND_GLOW__: true }, { __RAW_WIND_THEME_V2__: true }])('a lever that draws the marks its own way (%o)', (w) => { for (const theme of THEMES) sameWithOrWithoutTheKill(theme, w); });
  it.each(['moderate', 'deep', 'ink'])('an explicit light look (%s) holds light on its own marks: the A/B\'s quarter ring, not this one', (look) => {
    const w = { __RAW_WIND_LIGHT_LOOK__: look };
    sameWithOrWithoutTheKill('light', w);
    expect(windInk('light', V2, w).spine).toBe(look === 'ink' ? 0 : 0.25);
    expect(windWhiteStreakOn('beach', w)).toBe(true);                                                  // beach is not light's lever's to hold
  });
  it('the bench still tunes the marks through the glow sub-levers', () => {
    expect(windInk('beach', V2, { __RAW_WIND_GLOW_OPACITY__: 0.8, __RAW_WIND_GLOW_RING__: 0.5, __RAW_WIND_GLOW_WHITE__: 0.1 })).toMatchObject({ mode: 2, opacity: 0.8, spine: 0.5, white: 0.1 });
    expect(windInk('light', V2, { __RAW_WIND_GLOW_RING__: 0.25 })).toEqual(RULES_MARKS);
  });
});

// ── what the look IS, per knot ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// CIELAB D65 (coloraide 8.13's matrices, as windDarkRules.test.js) and the composite each theme draws over the app's own muted ground.
const dec = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((Math.abs(c) + 0.055) / 1.055, 2.4));
const mm = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const RGB2XYZ = [[0.4123907992659595, 0.357584339383878, 0.1804807884018343], [0.21263900587151036, 0.7151686787677559, 0.07219231536073371],
  [0.01933081871559185, 0.11919477979462598, 0.9505321522496606]];
const WHITE = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
const lab = (rgb) => { const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = mm(RGB2XYZ, rgb.map(dec)).map((v, i) => f(v / WHITE[i])); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const Lstar = (rgb) => lab(rgb)[0];
const Cstar = (rgb) => { const q = lab(rgb); return Math.hypot(q[1], q[2]); };
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const MODEL = {
  light: { op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65, surfaces: { water: [168, 214, 222], land: [236, 236, 232] } },
  beach: { op: 0.55, baseA: 0.45, end: 7, k: 0.60 / 0.55, surfaces: { water: [150, 190, 200], land: [222, 208, 180] } },
};
const bare = (theme, surface) => { const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${MODEL[theme].surfaces[surface].join(', ')})`, windBasemapMuteAmount(theme, {}), surface === 'water' ? windBasemapWaterL(theme, {}) : 1));
  return [+m[1], +m[2], +m[3]].map((v) => v / 255); };
const BARE = Object.fromEntries(THEMES.map((t) => [t, { land: bare(t, 'land'), water: bare(t, 'water') }]));
const strength = (theme, kn) => { const m = MODEL[theme]; return Math.min(1, m.op * (m.baseA + (1 - m.baseA) * ss(0, m.end, kn)) * m.k); };
const KNOTS = Array.from({ length: 76 }, (_, kn) => kn), SURFACES = ['land', 'water'];
// The tables the white streak was built on, on their hue paths (what generateRampData samples): the default's in light, and in beach
// the field before its path (P). The path's own per-knot numbers (the head's step, the pale band) are windBeachPath.test.js's.
const T = Object.fromEntries(THEMES.map((t) => { const m = resolveDrawnMarks(t, P); return [t, { field: huePathStops(resolveDrawnField(t, P), {}), land: huePathStops(m.land, {}), water: huePathStops(m.water, {}) }]; }));
const ground = (theme, surface, kn) => { const F = sampleRamp(T[theme].field, kn); return BARE[theme][surface].map((v, i) => v * (1 - strength(theme, kn) * (1 - F[i]))); };
// The brightest pixel of a mark, as the engine lays it: DRAW_FS mixes the body (glowOf: the row's colour at full brightness) toward
// white by 0.92 x ring on the inner ring and writes it at the row's alpha; SCREEN_FS lays that by dark's streak method.
const head = (theme, surface, kn, ring) => { const S = sampleRamp(T[theme][surface], kn);
  return glowComposite(ground(theme, surface, kn), glowOf(S.slice(0, 3), WHITE_STREAK.white).map((v) => (v + (1 - v) * 0.92 * ring) * S[3]), WHITE_STREAK.opacity); };
const each = (fn, from = 0) => { for (const theme of THEMES) for (const surface of SURFACES) for (const kn of KNOTS) if (kn >= from) fn(theme, surface, kn); };

describe('what the look is, per knot: white light over a ground deep enough to show it', () => {
  it('the head of every streak is LIGHTER than the ground under it, at every speed, over land and over sea', () => {
    each((theme, surface, kn) => expect(Lstar(head(theme, surface, kn, WHITE_STREAK.ring)) - Lstar(ground(theme, surface, kn))).toBeGreaterThan(8));
    // from a light breeze up it stands 19.5 L* or more off its ground (dark's own head-of-streak step is about 22)
    each((theme, surface, kn) => expect(Lstar(head(theme, surface, kn, WHITE_STREAK.ring)) - Lstar(ground(theme, surface, kn))).toBeGreaterThanOrEqual(19.5), 6);
  });
  it('the head is near-white at every speed (C* 21.5 or less): the FIELD carries the colour, as dark\'s does', () => {
    each((theme, surface, kn) => expect(Cstar(head(theme, surface, kn, WHITE_STREAK.ring))).toBeLessThanOrEqual(21.5));
    // at the everyday winds the ground under a streak is more colourful than the streak's head
    for (const theme of THEMES) for (const surface of SURFACES) for (let kn = 6; kn <= 27; kn++) expect(Cstar(ground(theme, surface, kn))).toBeGreaterThan(Cstar(head(theme, surface, kn, WHITE_STREAK.ring)));
  });
  it('LIGHT\'S GROUND HAS THE ROOM: from 6 kn up it is L* 65.3 or deeper over land and 50.3 or deeper over the sea', () => {
    for (const kn of KNOTS) if (kn >= 6) { expect(Lstar(ground('light', 'land', kn))).toBeLessThanOrEqual(65.3); expect(Lstar(ground('light', 'water', kn))).toBeLessThanOrEqual(50.3); }
    // Since light's path (D-024) the everyday winds sit on TWO levels: 65 from 6 to 10 kn, 60 from 16 to 27 kn. The arm the owner watched
    // here stepped 59, 57, 61 (L* 57.1 to 61.4 from 9 to 27 kn): windLightPath.test.js reads both.
    const everyday = KNOTS.filter((kn) => kn >= 9 && kn <= 27).map((kn) => Lstar(ground('light', 'land', kn)));
    expect(Math.min(...everyday)).toBeCloseTo(60.0, 1); expect(Math.max(...everyday)).toBeCloseTo(65.1, 1);   // 60.1 and 65.0 as the path merged; 60.03 and 65.08 with its margin (D-031)
    // calm keeps a pale tint (D-019): under 6 kn the ground is lighter than that, and a streak there steps less
    expect(Lstar(ground('light', 'land', 0))).toBeCloseTo(78.7, 1); expect(Lstar(ground('light', 'land', 3))).toBeCloseTo(72.0, 1);   // 3 kn: 71.9 as the path merged, 71.98 with its margin (D-031)
  });
  it('THE COST, said plainly: beach\'s ground over land at 26-39 kn is held pale by the name guard (L* 65-73), and a white streak has less to stand on there', () => {
    const pale = KNOTS.filter((kn) => kn >= 6 && Lstar(ground('beach', 'land', kn)) > 65.2);
    expect([pale[0], pale[pale.length - 1], pale.length]).toEqual([26, 39, 14]);
    expect(Math.max(...pale.map((kn) => Lstar(ground('beach', 'land', kn))))).toBeCloseTo(72.9, 1);     // at 29 kn
    expect(KNOTS.filter((kn) => kn >= 6 && Lstar(ground('beach', 'water', kn)) > 65.2)).toEqual([]);    // the sea has the room at every speed
    expect(KNOTS.filter((kn) => kn >= 6 && Lstar(ground('light', 'land', kn)) > 65.2)).toEqual([]);     // and so has light, at the cost of a deeper gold (its 33 kn ground is L* 53.6)
    expect(Lstar(ground('light', 'land', 33))).toBeCloseTo(53.5, 1);   // 53.6 as the path merged; the margin (D-031) moved the gold 0.07 L*
  });
});

describe('the wind bench can name the kill', () => {
  it('`candidate` draws the default; `before-white` is the arm to scan it against', () => {
    const { ALL_VARIANTS } = require('../../../scripts/wind-bench/matrix');
    expect(ALL_VARIANTS['before-white'].levers).toEqual(KILL);
    expect(ALL_VARIANTS.candidate.levers).toEqual({});
  });
});
