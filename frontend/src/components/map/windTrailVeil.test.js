/**
 * Dark's veil under light's and beach's trails (windTrailVeil.js, DECISIONS D-028): ON BY DEFAULT wherever the white streak is
 * laid ground by ground; kill window.__RAW_DISABLE_WIND_TRAIL_VEIL__.
 *
 * What this file holds: under the kill the composite is sent no veil and the shader's line for every other path is untouched, so
 * the old picture is drawn (the bench proves the bytes); the veil stands down wherever what it rests on is not drawn, so every
 * older kill and hold still draws its old picture; dark never reads it; and the arithmetic is the one the log states (dark's
 * branch and the glow branch as two members of one family, the veil nothing at a core).
 * The shader's own statements are RUN here, not pinned as text, and the real engine is driven on a recording GL that keeps each
 * program's uniforms AS THEY STAND AT EACH DRAW (the independent review: five mutants survived text pins and a send log).
 * The measurement is the bench's (scripts/wind-bench/truth-run.js --law reads the same law off a GPU).
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import WebGLWindEngine from './WebGLWindEngine';
import { SCREEN_FS, FADE_FS, DRAW_FS } from './WebGLWindShaders';
import { TRAIL_VEIL, windTrailVeil, trailVeilUniform, trailVeilComposite, GLSL_TRAIL_VEIL } from './windTrailVeil';
import { glowComposite } from './windInk';
import { DARK_RULES_HOLDS, DARK_RULES_STEERS, windWhiteStreakOn, windWhiteStrength } from './WindColorRamp';
import { DARK_WHITE } from './windDarkRules';
import { windCloseLandFactor } from './WebGLWindUtils';

const T = require('../../../scripts/wind-bench/truth');
const ENGINE = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
const KILL = '__RAW_DISABLE_WIND_TRAIL_VEIL__', STEER = '__RAW_WIND_TRAIL_VEIL__';

describe('on by default where the white streak is laid ground by ground; one kill; never in dark', () => {
  it('is one kill and one steer, named, at dark\'s own strength', () => {
    expect(TRAIL_VEIL).toEqual({ kill: KILL, steer: STEER, strength: 1, max: 2 });
    expect(Object.isFrozen(TRAIL_VEIL)).toBe(true);
  });
  it('by default light and beach draw it at dark\'s own strength, and dark does not', () => {
    expect(windTrailVeil('light', {})).toBe(1); expect(windTrailVeil('beach', {})).toBe(1);
    expect(windTrailVeil('dark', {})).toBe(0); expect(windTrailVeil('sepia', {})).toBe(0);
    expect(windTrailVeil('dark', null)).toBe(0);
  });
  it('THE KILL: set to true it is off in both themes; anything else is not the kill', () => {
    for (const theme of ['light', 'beach']) {
      expect(windTrailVeil(theme, { [KILL]: true })).toBe(0);
      for (const v of [undefined, null, false, 0, 1, 'true', 'light']) expect(windTrailVeil(theme, { [KILL]: v })).toBe(1);
      expect(windTrailVeil(theme, { [KILL]: true, [STEER]: 2 })).toBe(0);              // the kill wins over the steer
    }
  });
  it('the steer: a number over 0 up to 2 is that multiple of dark\'s strength, false is off for the session, anything else leaves the default', () => {
    for (const theme of ['light', 'beach']) {
      expect(windTrailVeil(theme, { [STEER]: 0.5 })).toBe(0.5); expect(windTrailVeil(theme, { [STEER]: 2 })).toBe(2);
      expect(windTrailVeil(theme, { [STEER]: false })).toBe(0);
      for (const v of [undefined, null, true, 0, -1, 2.01, NaN, Infinity, '0.5', 'light', [], {}]) expect(windTrailVeil(theme, { [STEER]: v })).toBe(1);
    }
    for (const v of [true, 0.5, 2]) expect(windTrailVeil('dark', { [STEER]: v })).toBe(0);   // dark IS the law: it reads neither
  });
  it('EVERY OLDER KILL AND HOLD STILL DRAWS ITS OLD PICTURE: whatever stands dark\'s rules or the white streak down, and D-022\'s own kill, stand the veil down', () => {
    const kills = ['__RAW_DISABLE_WIND_DARK_RULES__', '__RAW_DISABLE_WIND_WHITE_STREAK__', '__RAW_DISABLE_WIND_DARK_WHITE__', ...DARK_RULES_HOLDS];
    expect(kills.length).toBeGreaterThan(20);
    for (const theme of ['light', 'beach']) {
      for (const k of kills) { expect([k, windTrailVeil(theme, { [k]: true })]).toEqual([k, 0]); expect([k, windTrailVeil(theme, { [k]: true, [STEER]: 2 })]).toEqual([k, 0]); }
      for (const k of DARK_RULES_STEERS) expect([k, windTrailVeil(theme, { [k]: 'light' })]).toEqual([k, 0]);
      for (const look of [{ __RAW_WIND_INK__: true }, { __RAW_WIND_GLOW__: true }, { __RAW_WIND_THEME_V2__: true }, { __RAW_WIND_DARK_RULES__: false }]) expect(windTrailVeil(theme, look)).toBe(0);
    }
    expect(windTrailVeil('light', { __RAW_WIND_LIGHT_LOOK__: 'deep' })).toBe(0);     // an explicit light look draws its own marks
    expect(windTrailVeil('beach', { __RAW_WIND_LIGHT_LOOK__: 'deep' })).toBe(1);     // and is light's alone
    expect(windTrailVeil('beach', { __RAW_WIND_DARK_RULES__: 'light' })).toBe(0);    // dark's rules narrowed to light: beach is not drawn by them
    expect(windTrailVeil('light', { __RAW_WIND_DARK_RULES__: 'light' })).toBe(1);
    // it is never on where the white streak is not
    for (const theme of ['dark', 'light', 'beach']) for (const w of [{}, { __RAW_DISABLE_WIND_WHITE_STREAK__: true }, { __RAW_WIND_GLOW__: 'beach' }, { __RAW_DISABLE_WIND_FIELD_TINT__: true }]) expect(windTrailVeil(theme, w) > 0).toBe(windWhiteStreakOn(theme, w));
  });
  it('IT STANDS DOWN WHERE ITS GROUND IS NOT DRAWN: the land\'s depth killed (the land is pale again: a veil takes the ground squared)', () => {
    for (const theme of ['light', 'beach']) {
      expect(windTrailVeil(theme, { __RAW_DISABLE_WIND_LAND_DEPTH__: true })).toBe(0);
      expect(windTrailVeil(theme, { __RAW_DISABLE_WIND_LAND_DEPTH__: true, [STEER]: 2 })).toBe(0);
      expect(windWhiteStrength(theme, { __RAW_DISABLE_WIND_LAND_DEPTH__: true })).toEqual({ land: 1, sea: 0.55 });   // that kill's own picture: the land laid at full strength
    }
    // why: over the pale land that kill restores, the veil's dip is two to three times what it is on the deep ground (levels of 255, white tail)
    const dip = (g) => Math.min(...[0.2, 0.3, 0.4, 0.5].map((t) => { const b = t * Math.sqrt(0.55); return (trailVeilComposite([g, g, g], [b, b, b], 1, 0.505, 1 / Math.sqrt(0.55))[0] - g) * 255; }));
    expect(dip(118 / 255)).toBeGreaterThan(-8); expect(dip(190 / 255)).toBeLessThan(-16);
  });
  it('IT STANDS DOWN WHERE ITS CANVAS IS NOT DRAWN: the opaque canvas killed (the veil\'s alpha would let light\'s page through and LIGHTEN the trail)', () => {
    for (const theme of ['light', 'beach']) {
      expect(windTrailVeil(theme, { __RAW_DISABLE_WIND_OPAQUE_CANVAS__: true })).toBe(0);
      for (const v of [undefined, false, 1, 'true']) expect(windTrailVeil(theme, { __RAW_DISABLE_WIND_OPAQUE_CANVAS__: v })).toBe(1);
    }
    // why, by that kill's own blend (the alpha blended by the colour's factors, the screen showing rgb + (1 - alpha) x page) over light's page
    const page = 250 / 255, g = 118 / 255, shown = (b, veil) => {
      const bn = Math.min(1, b / Math.sqrt(0.55)), light = b * b, a = light + veil * bn * (1 - bn);
      const rgb = light + g * (1 - a), alpha = a * a + 1 - a;          // SRC_ALPHA, ONE_MINUS_SRC_ALPHA on all four channels, a white trail over an opaque map
      return rgb + (1 - alpha) * page;
    };
    for (const b of [0.1, 0.2, 0.3, 0.37]) expect(shown(b, 0.505)).toBeGreaterThan(shown(b, 0));   // the veil LIGHTENS there: so it is not drawn there
  });
  it('kills of things it does not rest on leave it standing (each theme\'s path, the fade, the trail anchor)', () => {
    for (const k of ['__RAW_DISABLE_WIND_LIGHT_PATH__', '__RAW_DISABLE_WIND_BEACH_PATH__', '__RAW_DISABLE_WIND_WIDE_TRAILS__', '__RAW_DISABLE_WIND_TRAIL_ANCHOR__', '__RAW_DISABLE_WIND_CLOSE_LAND__']) {
      expect(windTrailVeil('light', { [k]: true })).toBe(1); expect(windTrailVeil('beach', { [k]: true })).toBe(1);
    }
  });
});

describe('the uniform the composite is sent', () => {
  it('dark, the kill, and a theme whose composite is not the glow branch: [0, 1], the glow branch alone', () => {
    for (const glow of [true, false]) expect(trailVeilUniform('dark', glow, 0.505, 6, {})).toEqual([0, 1]);
    for (const theme of ['light', 'beach']) {
      expect(trailVeilUniform(theme, true, 0.505, 6, { [KILL]: true })).toEqual([0, 1]);
      expect(trailVeilUniform(theme, false, 0.505, 6, {})).toEqual([0, 1]);
    }
  });
  it('by default light and beach are sent dark\'s own opacity and the buffer level a streak\'s core is laid at', () => {
    const level = Math.sqrt(DARK_WHITE.light.sea);
    for (const theme of ['light', 'beach']) {
      const u = trailVeilUniform(theme, true, 0.505, 6, {});
      expect(u[0]).toBeCloseTo(0.505, 6); expect(u[1]).toBeCloseTo(1 / level, 6);
    }
    expect(level).toBeCloseTo(0.7416, 4);
    expect(trailVeilUniform('beach', true, 0.48, 3, { [STEER]: 0.5 })[0]).toBeCloseTo(0.24, 6);
  });
  it('the theme\'s close-zoom factor eases it with the streak it belongs to, and that factor\'s own lever and kill move it too', () => {
    for (const theme of ['light', 'beach']) for (const z of [6, 6.75, 7.5, 9]) expect(trailVeilUniform(theme, true, 0.505, z, {})[0]).toBeCloseTo(0.505 * windCloseLandFactor(theme, z, {}), 9);
    expect(trailVeilUniform('light', true, 0.505, 9, {})[0]).toBeCloseTo(0.505 * 0.65, 6);
    expect(trailVeilUniform('light', true, 0.505, 9, { __RAW_DISABLE_WIND_CLOSE_LAND__: true })[0]).toBeCloseTo(0.505, 6);
    expect(trailVeilUniform('light', true, 0.505, 9, { __RAW_WIND_CLOSE_LAND_OPACITY__: 0.8 })[0]).toBeCloseTo(0.404, 6);
  });
  it('the level is the LOWER of the two grounds\' levels, and the veil is nothing over the whole range above it', () => {
    // The land takes the sea's strength only once the map has DRAWN it deep (the mute's read-back, D-026); until then, and with imagery
    // under the wind, a streak over land is laid at full strength. The veil's level is the sea's in both states.
    const deep = { __WIND_BASEMAP_MUTE__: { applied: true, theme: 'light', landL: 0.8 } };
    expect(windWhiteStrength('light', deep)).toEqual({ land: 0.55, sea: 0.55 });
    expect(windWhiteStrength('light', {})).toEqual({ land: 1, sea: 0.55 });
    for (const w of [deep, {}]) expect(trailVeilUniform('light', true, 0.505, 6, w)[1]).toBeCloseTo(1 / Math.sqrt(0.55), 9);
    const g = [0.3, 0.5, 0.4], inv = 1 / Math.sqrt(0.55);
    for (const b of [0.75, 0.9, 1]) expect(trailVeilComposite(g, [b, b, b], 1, 0.505, inv)).toEqual(trailVeilComposite(g, [b, b, b], 1, 0, inv));   // a land streak's own core, laid higher, carries no veil
  });
});

describe('the arithmetic: the glow branch\'s light plus dark\'s veil', () => {
  const ground = [69 / 255, 118 / 255, 99 / 255], INV = 1 / Math.sqrt(0.55), CORE = Math.sqrt(0.55);
  const close = (a, b, digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
  it('with no veil it is the glow branch, as the app\'s own mirror draws it', () => {
    for (const buf of [[0.74, 0.74, 0.74], [0.4, 0.4, 0.4], [0.1, 0.5, 0.3], [0.02, 0.02, 0.02]]) close(trailVeilComposite(ground, buf, 1, 0, INV), glowComposite(ground, buf, 1));
  });
  it('with the veil at the composite\'s own opacity and level 1 it IS dark\'s branch, for a trail of any colour and strength', () => {
    for (const buf of [[1, 1, 1], [0.6, 0.6, 0.6], [0.2, 0.2, 0.2], [0.03, 0.48, 0.6], [0.9, 0.3, 0.1]]) {
      const b = Math.max(...buf), a = b * 0.505;
      close(trailVeilComposite(ground, buf, 0.505, 0.505, 1), ground.map((g, i) => buf[i] * a + g * (1 - a)));
    }
  });
  it('A CORE KEEPS ITS HEIGHT: at the level a core is laid at, the veil is nothing', () => {
    close(trailVeilComposite(ground, [CORE, CORE, CORE], 1, 0.505, INV), glowComposite(ground, [CORE, CORE, CORE], 1));
    close(trailVeilComposite(ground, [0, 0, 0], 1, 0.505, INV), ground);                 // and an empty texel is the ground
  });
  it('A TAIL COMES BACK TO THE FIELD AND DIPS UNDER IT, as dark\'s does: over while it is strong, under from 0.44 of a core\'s level down, back at nothing', () => {
    const step = (b, veil) => trailVeilComposite(ground, [b, b, b], 1, veil, INV)[1] - ground[1];
    const tail = [1, 0.9, 0.75, 0.6, 0.45, 0.3, 0.15, 0.05].map((t) => t * CORE);
    expect(tail.every((b) => step(b, 0) > 0)).toBe(true);                                // the glow branch: every strength of tail is over the field
    const veiled = tail.map((b) => step(b, 0.505));
    expect(veiled[0]).toBeCloseTo(step(CORE, 0), 9);
    expect(veiled.slice(0, 5).every((x) => x > 0)).toBe(true);
    expect(veiled.slice(5).every((x) => x < 0)).toBe(true);                               // from 0.44 of the core's level down the tail dims the ground
    const g = ground[1], cross = 0.505 * g / (0.55 * (1 - g) + 0.505 * g);                // where light and veil cancel: veil g / (opacity level^2 (1 - g) + veil g)
    expect(cross).toBeCloseTo(0.4416, 3);
    expect(step(cross * CORE, 0.505)).toBeCloseTo(0, 9);
    expect(Math.min(...veiled) * 255).toBeGreaterThan(-12);                               // by a few levels, as dark's branch does over the same ground (its deepest: -7)
    expect(veiled[7] * 255).toBeGreaterThan(-3);                                          // and it is back at the field as it runs out
    for (let i = 0; i < tail.length; i++) expect(step(tail[i], 0.505)).toBeLessThanOrEqual(step(tail[i], 0));   // a veil only ever takes light
  });
  it('the veil takes in proportion to the ground: nothing from black, most from a pale ground (why rule 1 dropped it on the old pale fields)', () => {
    const dip = (g) => Math.min(...[0.1, 0.2, 0.3, 0.4, 0.5].map((t) => trailVeilComposite([g, g, g], [t * CORE, t * CORE, t * CORE], 1, 0.505, INV)[0] - g));
    expect(dip(0)).toBeGreaterThanOrEqual(0);
    expect(dip(0.25)).toBeGreaterThan(dip(0.45)); expect(dip(0.45)).toBeGreaterThan(dip(0.8));
    expect(dip(0.8) * 255).toBeLessThan(-18);                                             // on an L* 82 ground it is a grey ghost; on dark's sea (0.45) a few levels
    expect(dip(0.45) * 255).toBeGreaterThan(-9);
  });
  it('the bench reads this law as the same family (scripts/wind-bench/truth.js composite): p the opacity, q the veil, at the core\'s level', () => {
    const g255 = [69, 118, 99];
    for (const v of [189, 150, 95, 40, 9]) {
      const mine = trailVeilComposite(ground, [v / 255, v / 255, v / 255], 1, 0.505, INV).map((x) => Math.round(x * 255));
      expect(mine).toEqual(T.composite(g255, [v, v, v], 1, 0.505, CORE));
    }
  });
});

/**
 * trailVeilOf, RUN. The GLSL function's own statements are turned to JavaScript a line at a time (float declarations, min and max,
 * the uniform's two components, the returned vec4 a channel at a time), so a statement changed, removed or ADDED changes what this
 * returns. Returns (c: [r, g, b], b, op, U: [strength, 1 / level]) => [[r, g, b], a], the fragment's colour and alpha.
 */
function runTrailVeilOf(src) {
  const m = /vec4 trailVeilOf\(vec3 c, float b, float op\) \{\n([\s\S]*?)\n\}/.exec(src);
  if (!m) throw new Error('trailVeilOf is not where it was');
  const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean), ret = /^return vec4\((.+), (\w+)\);$/.exec(lines[lines.length - 1]);
  if (!ret) throw new Error('trailVeilOf does not end in "return vec4(<a vec3 in c>, <alpha>);"');
  const js = (e) => e.replace(/\b(min|max)\(/g, 'Math.$1(').replace(/u_trail_veil\.x/g, 'U[0]').replace(/u_trail_veil\.y/g, 'U[1]');
  const body = lines.slice(0, -1).map((l) => js(l).replace(/^float /, 'let ')).join('\n');
  const f = vm.runInNewContext(`(function (C, b, op, U) {\n${body}\nreturn [[0, 1, 2].map(function (i) { var c = C[i]; return ${js(ret[1])}; }), ${ret[2]}];\n})`, { Math });
  return (C, b, op, U) => { const r = f(C, b, op, U); return [Array.from(r[0]), r[1]]; };   // arrays of this realm, for the matchers
}

describe('the shader, RUN: its statements do what the mirror says, on every path', () => {
  const glsl = runTrailVeilOf(SCREEN_FS), INV = 1 / Math.sqrt(0.55);
  const drawn = (ground, buf, op, U) => { const b = Math.max(...buf), [rgb, a] = glsl(buf, b, op, U); return ground.map((g, i) => rgb[i] * a + g * (1 - a)); };   // SRC_ALPHA, ONE_MINUS_SRC_ALPHA
  const grounds = [[69 / 255, 118 / 255, 99 / 255], [0.1, 0.1, 0.12], [0.75, 0.7, 0.4]];
  const bufs = [];
  for (let v = 1; v <= 255; v += 7) { bufs.push([v / 255, v / 255, v / 255]); bufs.push([0.1 * v / 255, 0.8 * v / 255, v / 255]); }
  it('the function in SCREEN_FS is the one the module exports, and it is the mirror, to a rounding of floats, over every buffer level, two colours, three grounds and four strengths', () => {
    expect(SCREEN_FS).toContain(GLSL_TRAIL_VEIL);
    for (const ground of grounds) for (const buf of bufs) for (const [op, veil, inv] of [[1, 0.505, INV], [0.65, 0.32825, INV], [1, 1.01, INV], [1, 0.505, 1]]) {
      const got = drawn(ground, buf, op, [veil, inv]), want = trailVeilComposite(ground, buf, op, veil, inv);
      got.forEach((x, i) => expect(Math.abs(x - want[i]) * 255).toBeLessThan(1e-6));
    }
  });
  it('the alpha it lays stays between 0 and 1, an empty texel lays nothing, and at a core the colour and the alpha are the glow branch\'s own', () => {
    for (const buf of bufs) for (const veil of [0.24, 0.505, 1.01]) { const [, a] = glsl(buf, Math.max(...buf), 1, [veil, INV]); expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1); }
    expect(glsl([0, 0, 0], 0, 1, [0.505, INV])).toEqual([[0, 0, 0], 0]);
    const core = Math.sqrt(0.55), [rgb, a] = glsl([core, core, core], core, 1, [0.505, INV]);
    expect(a).toBeCloseTo(0.55, 9); rgb.forEach((x) => expect(x).toBeCloseTo(1, 9));        // white at alpha b^2: the glow branch
  });
  it('POSITIVE CONTROLS: a statement added, the veil\'s sign turned, or the colour left unscaled is seen by this instrument', () => {
    const differs = (src) => { const f = runTrailVeilOf(src), b = 0.3; const [rgb, a] = f([b, b, b], b, 1, [0.505, INV]), [r0, a0] = glsl([b, b, b], b, 1, [0.505, INV]); return Math.abs(a - a0) > 1e-6 || Math.abs(rgb[0] - r0[0]) > 1e-6; };
    expect(differs(GLSL_TRAIL_VEIL)).toBe(false);
    expect(differs(GLSL_TRAIL_VEIL.replace('\n  return vec4(', '\n  a = min(a, 0.0);\n  return vec4('))).toBe(true);
    expect(differs(GLSL_TRAIL_VEIL.replace('a = light + u_trail_veil.x', 'a = light - u_trail_veil.x'))).toBe(true);
    expect(differs(GLSL_TRAIL_VEIL.replace(' * (light / max(a, 0.0001))', ''))).toBe(true);
    expect(differs(GLSL_TRAIL_VEIL.replace('bn * (1.0 - bn)', 'bn * (1.0 - b)'))).toBe(true);
  });
});

describe('the shader, as it is laid out: what a compiler needs and what guards the branch', () => {
  it('SCREEN_FS opens with its precision before any declaration, and declares the veil ONCE as the two floats the engine sends', () => {
    expect(SCREEN_FS.trim().startsWith('precision mediump float;')).toBe(true);
    expect(SCREEN_FS.indexOf('precision mediump float;')).toBeLessThan(SCREEN_FS.indexOf('uniform'));
    expect(SCREEN_FS.match(/uniform\s+\w+\s+u_trail_veil\s*;/g)).toEqual(['uniform vec2 u_trail_veil;']);
    expect([...new Set(SCREEN_FS.match(/u_trail_veil\.\w+/g))].sort()).toEqual(['u_trail_veil.x', 'u_trail_veil.y']);   // only the two components it has
    expect(SCREEN_FS.indexOf('uniform vec2 u_trail_veil;')).toBeLessThan(SCREEN_FS.indexOf('void main()'));
    expect(SCREEN_FS.indexOf('vec4 trailVeilOf(')).toBeLessThan(SCREEN_FS.indexOf('void main()'));
    expect(ENGINE).toContain("gl.uniform2f(gl.getUniformLocation(this.screenProgram, 'u_trail_veil'), _veil[0], _veil[1]);");
  });
  it('SCREEN_FS still ends in the line dark, every older look and the kill draw by', () => {
    expect(SCREEN_FS).toContain('gl_FragColor = u_ink > 0.5 ? vec4(mix(vec3(1.0), color.rgb, u_opacity * inkCapOf(u_screen)), 1.0) : (u_premul > 0.5 ? color * u_opacity : vec4(u_glow > 0.5 ? color.rgb / max(brightness, 0.004) : color.rgb, brightness * (u_glow > 0.5 ? brightness : 1.0) * u_opacity));');
  });
  it('the veiled composite is reached only inside the glow branch and only with a veil over 0, before that line; it is called once', () => {
    const guard = 'if (u_glow > 0.5 && u_trail_veil.x > 0.0) { gl_FragColor = trailVeilOf(color.rgb, brightness, u_opacity); return; }';
    expect(SCREEN_FS).toContain(guard);
    expect(SCREEN_FS.indexOf(guard)).toBeLessThan(SCREEN_FS.indexOf('gl_FragColor = u_ink > 0.5 ?'));
    expect(SCREEN_FS.indexOf(guard)).toBeGreaterThan(SCREEN_FS.indexOf('float brightness = max(color.r, max(color.g, color.b));'));
    expect(SCREEN_FS.match(/trailVeilOf\(/g)).toHaveLength(2);                           // its definition and that one call
    expect(SCREEN_FS.match(/gl_FragColor\s*=/g)).toHaveLength(2);                        // that branch, and the line every other path draws by
  });
  it('it is the composite\'s alone: the buffer\'s fade and the marks do not know it', () => {
    for (const src of [FADE_FS, DRAW_FS]) { expect(src).not.toContain('u_trail_veil'); expect(src).not.toContain('trailVeilOf'); }
  });
  it('the engine reads dark\'s own opacity BEFORE the glow branch takes its own, and names the uniform once', () => {
    expect(ENGINE).toContain('} var darkOpacity = finalOpacity; if (_ink.glow) finalOpacity = _ink.opacity;');
    expect(ENGINE.match(/u_trail_veil/g)).toHaveLength(1);
  });
});

// ── the real engine on a recording GL that keeps every program's uniforms AS THEY STAND AT EACH DRAW ────────────────────
function makeGl() {
  const st = { fbo: null, prog: null, draws: [], sends: 0, uniforms: new Map() };
  let id = 0;
  const obj = (kind) => ({ kind, id: ++id });
  const now = (p) => { if (!st.uniforms.has(p)) st.uniforms.set(p, {}); return st.uniforms.get(p); };
  const draw = () => { st.draws.push({ fbo: st.fbo, prog: st.prog, u: { ...now(st.prog) } }); };
  const special = {
    canvas: { width: 64, height: 64, clientWidth: 64 }, drawingBufferWidth: 64, drawingBufferHeight: 64,
    isContextLost: () => false, getExtension: () => null,
    getShaderParameter: () => true, getProgramParameter: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    createShader: () => obj('shader'), createProgram: () => obj('program'), createTexture: () => obj('texture'),
    createFramebuffer: () => obj('fbo'), createBuffer: () => obj('buffer'), createVertexArray: () => obj('vao'),
    getUniformLocation: (p, name) => ({ p, name }), getAttribLocation: () => 0, getAttachedShaders: () => [],
    isFramebuffer: () => true, checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE', getError: () => 0, getUniform: () => 0,
    bindVertexArray: () => {}, isEnabled: () => true,
    bindFramebuffer: (t, f) => { st.fbo = f; },
    useProgram: (p) => { st.prog = p; },
    uniform1f: (loc, a) => { if (loc) now(loc.p)[loc.name] = [a]; },
    uniform2f: (loc, a, b) => { if (loc) { now(loc.p)[loc.name] = [a, b]; if (loc.name === 'u_trail_veil') st.sends++; } },
    drawArrays: draw, drawElements: draw,
    getParameter: (p) => {
      if (p === 'FRAMEBUFFER_BINDING') return st.fbo;
      if (p === 'VIEWPORT') return [0, 0, 64, 64];
      if (p === 'COLOR_WRITEMASK') return [true, true, true, true];
      if (p === 'BLEND_SRC_RGB' || p === 'BLEND_SRC_ALPHA') return 'ONE';
      if (p === 'BLEND_DST_RGB' || p === 'BLEND_DST_ALPHA') return 'ONE_MINUS_SRC_ALPHA';
      if (p === 'BLEND_EQUATION_RGB' || p === 'BLEND_EQUATION_ALPHA') return 'FUNC_ADD';
      if (p === 'ACTIVE_TEXTURE') return 'TEXTURE0';
      if (p === 'DEPTH_WRITEMASK') return true;
      if (p === 'MAX_TEXTURE_SIZE') return 4096;
      return null;
    },
  };
  const gl = new Proxy({}, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in special) return special[k];
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return k;
      if (k === '__activeTextureUnit' || k === '__boundTextures2D') return undefined;
      return () => undefined;
    },
    set() { return true; }, deleteProperty() { return true; },
    has(_t, k) { return k in special || k === 'bindVertexArray' || k === 'createVertexArray'; },
  });
  return { gl, st };
}
const vectorsFor = (cols, rows, speed) => Array.from({ length: cols * rows }, (_, i) => ({ u: speed * Math.cos(i), v: speed * Math.sin(i), speed }));
const GLOBAL = { bounds: { west: -180, south: -80, east: 180, north: 85 }, coverage_scope: 'global_coarse', source: 'GFS', hourOffset: 0, valid_time: '2026-07-19T12:00:00Z', cols: 37, rows: 17 };
const MATRIX = new Float32Array([2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]);
const clearLevers = () => Object.keys(window).filter((k) => k.startsWith('__RAW_') || k.startsWith('__GPU_DEBUG') || k.startsWith('__WIND_')).forEach((k) => { delete window[k]; });
const engineOn = () => { const { gl, st } = makeGl(), e = new WebGLWindEngine(); e.particleRes = 4; e.init(gl); e.setWindData(gl, { ...GLOBAL, vectors: vectorsFor(GLOBAL.cols, GLOBAL.rows, 20) }); return { gl, st, e }; };

/** One frame of the real engine: the screen program's uniforms as they stood when it drew into the MAP (the composite) and into its own buffer (the copy). */
function frame({ gl, st, e }, theme, z) {
  st.draws.length = 0; st.sends = 0; st.fbo = null;
  e.render(gl, MATRIX, 64, 64, z, theme, null, [-100, 15, -70, 40]);
  const screen = st.draws.filter((d) => d.prog === e.screenProgram);
  return { composite: screen.filter((d) => d.fbo === null), copy: screen.filter((d) => d.fbo !== null), sends: st.sends };
}
/** Run the real engine a frame a zoom under `levers`; return each frame's composite and copy. */
function frames(theme, levers, zooms = [3, 6, 8]) {
  clearLevers(); Object.assign(window, levers);
  const on = engineOn(), out = zooms.map((z) => ({ z, ...frame(on, theme, z) }));
  clearLevers();
  return out;
}

describe('the real engine, a recording GL: the uniforms as they stand at each draw', () => {
  beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { jest.restoreAllMocks(); });

  const OFF_PATHS = {
    'its kill': { [KILL]: true },
    'its kill, with the steer set': { [KILL]: true, [STEER]: 2 },
    'the steer at false': { [STEER]: false },
    'dark rules killed': { __RAW_DISABLE_WIND_DARK_RULES__: true },
    'white streak killed': { __RAW_DISABLE_WIND_WHITE_STREAK__: true },
    'dark white killed': { __RAW_DISABLE_WIND_DARK_WHITE__: true },
    'land depth killed': { __RAW_DISABLE_WIND_LAND_DEPTH__: true },
    'opaque canvas killed': { __RAW_DISABLE_WIND_OPAQUE_CANVAS__: true },
    'field tint killed': { __RAW_DISABLE_WIND_FIELD_TINT__: true },
    'speed premul killed': { __RAW_DISABLE_WIND_SPEED_PREMUL__: true },
    'basemap mute killed': { __RAW_DISABLE_WIND_BASEMAP_MUTE__: true },
    'dark rules + speed premul killed': { __RAW_DISABLE_WIND_DARK_RULES__: true, __RAW_DISABLE_WIND_SPEED_PREMUL__: true },
    'ink lever': { __RAW_WIND_INK__: true },
    'glow lever': { __RAW_WIND_GLOW__: true },
    'v2 theme': { __RAW_WIND_THEME_V2__: true },
    'field tint steered': { __RAW_WIND_FIELD_TINT_THEMES__: 'dark,light,beach' },
    'premul on every theme': { __RAW_WIND_PREMUL_THEMES__: 'dark,light,beach', __RAW_DISABLE_WIND_DARK_RULES__: true },
  };
  const table = [];
  for (const [name, levers] of Object.entries(OFF_PATHS)) for (const theme of ['dark', 'light', 'beach']) table.push([name, theme, levers]);
  for (const look of ['deep', 'moderate', 'ink']) table.push([`light look ${look}`, 'light', { __RAW_WIND_LIGHT_LOOK__: look }]);   // a light look is light's alone
  it.each(table)('no veil at the composite\'s draw: %s, %s', (name, theme, levers) => {
    for (const f of frames(theme, levers)) {
      expect(f.composite).toHaveLength(1);
      expect(f.composite[0].u.u_trail_veil).toEqual([0, 1]); expect(f.sends).toBe(1);
    }
  });
  it('dark is never sent one, by default or whatever the steer says', () => {
    for (const levers of [{}, { [STEER]: 0.5 }, { [STEER]: 2 }]) for (const f of frames('dark', levers)) {
      const u = f.composite[0].u;
      expect(u.u_trail_veil).toEqual([0, 1]); expect(u.u_glow).toEqual([0]); expect([0.48, 0.505, 0.404]).toContain(+u.u_opacity[0].toFixed(3));   // dark's own opacity by zoom, eased at close zoom
    }
  });
  it('BY DEFAULT, when the composite draws, light and beach hold dark\'s own opacity at that zoom times their close-zoom factor, beside the glow branch and the white streak\'s own opacity', () => {
    for (const theme of ['light', 'beach']) {
      const [z3, z6, z8] = frames(theme, {});
      expect(z3.composite[0].u.u_trail_veil[0]).toBeCloseTo(0.48, 5); expect(z6.composite[0].u.u_trail_veil[0]).toBeCloseTo(0.505, 5); expect(z8.composite[0].u.u_trail_veil[0]).toBeCloseTo(0.505 * 0.65, 5);
      for (const f of [z3, z6, z8]) { expect(f.composite).toHaveLength(1); expect(f.composite[0].u.u_trail_veil[1]).toBeCloseTo(1 / Math.sqrt(0.55), 5); expect(f.composite[0].u.u_glow).toEqual([1]); expect(f.sends).toBe(1); }
      expect(z6.composite[0].u.u_opacity[0]).toBeCloseTo(1, 6); expect(z8.composite[0].u.u_opacity[0]).toBeCloseTo(0.65, 6);   // the light it adds is not touched
      expect(frames(theme, { [STEER]: 0.5 })[1].composite[0].u.u_trail_veil[0]).toBeCloseTo(0.2525, 5);
    }
  });
  it('THE BUFFER\'S COPY NEVER RUNS THE VEIL: when the screen program draws into the engine\'s own buffer the glow branch is off, in every theme and with the veil on', () => {
    for (const theme of ['dark', 'light', 'beach']) for (const levers of [{}, { [STEER]: 2 }, { [KILL]: true }, { __RAW_WIND_GLOW__: true }]) for (const f of frames(theme, levers, [3, 6, 6, 8, 8])) {
      expect(f.copy).toHaveLength(1);
      expect(f.copy[0].u.u_glow).toEqual([0]);                                          // the guard reads u_glow first: a veil left in the program from the last composite cannot draw here
      expect(f.copy[0].u.u_opacity).toEqual([1]);
    }
  });
  it('A VEIL OVER 0 IS ONLY EVER HELD BESIDE THE GLOW BRANCH, never the premultiplied or the ink composite, on every lever set of the canvas trace', () => {
    const LEVERS = [{}, { __RAW_DISABLE_WIND_FIELD_TINT__: true }, { __RAW_DISABLE_WIND_DARK_RULES__: true }, { __RAW_DISABLE_WIND_WHITE_STREAK__: true }, { __RAW_DISABLE_WIND_DARK_WHITE__: true },
      { __RAW_DISABLE_WIND_DARK_RULES__: true, __RAW_DISABLE_WIND_SPEED_PREMUL__: true }, { __RAW_WIND_INK__: true }, { __RAW_WIND_GLOW__: true }, { __RAW_WIND_LIGHT_LOOK__: 'deep' }, { __RAW_WIND_LIGHT_LOOK__: 'moderate' },
      { __RAW_WIND_LIGHT_LOOK__: 'ink' }, { __RAW_WIND_THEME_V2__: true }, { __RAW_WIND_MOTION_V2__: true }, { __RAW_DISABLE_WIND_HEATMAP_SINGLEPASS__: true }, { __GPU_DEBUG__: { mode: 'uv' } }, { __GPU_DEBUG__: { mode: 'part_fbo' } },
      { __RAW_DISABLE_WIND_TRAIL_ANCHOR__: true }, { __RAW_WIND_FIELD_TINT_THEMES__: 'dark,light,beach' }, { __RAW_WIND_PREMUL_THEMES__: 'dark,light,beach', __RAW_DISABLE_WIND_DARK_RULES__: true }, { __RAW_DISABLE_WIND_OPAQUE_CANVAS__: true },
      { __RAW_DISABLE_WIND_LAND_DEPTH__: true }, { __RAW_DISABLE_WIND_LIGHT_PATH__: true }, { __RAW_DISABLE_WIND_BEACH_PATH__: true }];
    let on = 0;
    for (const levers of LEVERS) for (const withSteer of [false, true]) for (const theme of ['dark', 'light', 'beach']) for (const f of frames(theme, withSteer ? { ...levers, [STEER]: 2 } : levers, [6])) {
      const u = f.composite[0].u;
      expect(u.u_trail_veil).toBeDefined();                                             // sent before the composite draws, on every path
      if (u.u_trail_veil[0] > 0) { on++; expect(theme).not.toBe('dark'); expect(u.u_glow).toEqual([1]); expect(u.u_premul).toEqual([0]); expect(u.u_ink).toEqual([0]); }
    }
    expect(on).toBeGreaterThanOrEqual(20);                                      // the instrument saw it on: light and beach, with and without the steer, on the paths that keep the white streak
  });
  it('kills of things the veil does not rest on leave it drawn; a light look is light\'s alone', () => {
    for (const k of ['__RAW_DISABLE_WIND_LIGHT_PATH__', '__RAW_DISABLE_WIND_BEACH_PATH__', '__RAW_DISABLE_WIND_TRAIL_ANCHOR__', '__RAW_DISABLE_WIND_WIDE_TRAILS__']) {
      for (const theme of ['light', 'beach']) expect(frames(theme, { [k]: true })[1].composite[0].u.u_trail_veil[0]).toBeCloseTo(0.505, 5);
    }
    expect(frames('beach', { __RAW_WIND_LIGHT_LOOK__: 'deep' })[1].composite[0].u.u_trail_veil[0]).toBeCloseTo(0.505, 5);
  });
  it('the kill is read each frame: set and cleared between frames, the composite\'s very next draw follows it, and so does a theme change', () => {
    clearLevers();
    const on = engineOn(), veil = (theme) => { const f = frame(on, theme, 6); expect(f.composite).toHaveLength(1); return f.composite[0].u.u_trail_veil[0]; };
    expect(veil('light')).toBeCloseTo(0.505, 5);
    window[KILL] = true; expect(veil('light')).toBe(0);
    delete window[KILL]; expect(veil('light')).toBeCloseTo(0.505, 5);
    expect(veil('dark')).toBe(0);                                                       // the same engine, the theme switched: dark's first frame holds no veil
    expect(veil('beach')).toBeCloseTo(0.505, 5);
    clearLevers();
  });
});
