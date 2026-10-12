/**
 * Dark's veil under light's and beach's trails (windTrailVeil.js, DECISIONS D-028): ON BY DEFAULT wherever the white streak is
 * laid ground by ground; kill window.__RAW_DISABLE_WIND_TRAIL_VEIL__.
 *
 * What this file holds: under the kill the composite is sent no veil and the shader's line for every other path is untouched, so
 * the old picture is drawn (the bench proves the bytes); the veil draws only where the white streak does, so every older kill and
 * hold still draws exactly its old picture; dark never reads it; and the arithmetic is the one the log states (dark's branch and
 * the glow branch as two members of one family, the veil nothing at a core). The measurement is the bench's
 * (scripts/wind-bench/truth-run.js).
 */
import fs from 'fs';
import path from 'path';
import WebGLWindEngine from './WebGLWindEngine';
import { SCREEN_FS, FADE_FS, DRAW_FS } from './WebGLWindShaders';
import { TRAIL_VEIL, windTrailVeil, trailVeilUniform, trailVeilComposite, GLSL_TRAIL_VEIL } from './windTrailVeil';
import { glowComposite } from './windInk';
import { DARK_RULES_HOLDS, DARK_RULES_STEERS, windWhiteStreakOn, windWhiteStrength } from './WindColorRamp';
import { DARK_WHITE } from './windDarkRules';

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
    // it is on exactly where the white streak is, D-022's kill aside
    for (const theme of ['dark', 'light', 'beach']) for (const w of [{}, { __RAW_DISABLE_WIND_WHITE_STREAK__: true }, { __RAW_WIND_GLOW__: 'beach' }, { __RAW_DISABLE_WIND_FIELD_TINT__: true }]) expect(windTrailVeil(theme, w) > 0).toBe(windWhiteStreakOn(theme, w));
  });
  it('kills that do not touch the trails\' composite leave it standing (the land\'s depth, each theme\'s path, the canvas\'s alpha, the fade)', () => {
    for (const k of ['__RAW_DISABLE_WIND_LAND_DEPTH__', '__RAW_DISABLE_WIND_LIGHT_PATH__', '__RAW_DISABLE_WIND_BEACH_PATH__', '__RAW_DISABLE_WIND_OPAQUE_CANVAS__', '__RAW_DISABLE_WIND_WIDE_TRAILS__']) {
      expect(windTrailVeil('light', { [k]: true })).toBe(1); expect(windTrailVeil('beach', { [k]: true })).toBe(1);
    }
  });
});

describe('the uniform the composite is sent', () => {
  it('dark, the kill, and a theme whose composite is not the glow branch: [0, 1], the glow branch alone', () => {
    for (const glow of [true, false]) expect(trailVeilUniform('dark', glow, 0.505, {})).toEqual([0, 1]);
    for (const theme of ['light', 'beach']) {
      expect(trailVeilUniform(theme, true, 0.505, { [KILL]: true })).toEqual([0, 1]);
      expect(trailVeilUniform(theme, false, 0.505, {})).toEqual([0, 1]);
    }
  });
  it('by default light and beach are sent dark\'s own opacity and the buffer level a streak\'s core is laid at', () => {
    const level = Math.sqrt(DARK_WHITE.light.sea);
    for (const theme of ['light', 'beach']) {
      const u = trailVeilUniform(theme, true, 0.505, {});
      expect(u[0]).toBeCloseTo(0.505, 6); expect(u[1]).toBeCloseTo(1 / level, 6);
    }
    expect(level).toBeCloseTo(0.7416, 4);
    expect(trailVeilUniform('beach', true, 0.48, { [STEER]: 0.5 })[0]).toBeCloseTo(0.24, 6);
    expect(trailVeilUniform('light', true, 0.505 * 0.65, {})[0]).toBeCloseTo(0.32825, 6);   // the close-zoom factor eases it with its streak
  });
  it('the level is the LOWER of the two grounds\' levels: with the land\'s depth killed the land\'s cores are laid higher, and the veil is nothing over the whole range above the sea\'s', () => {
    const w = { __RAW_DISABLE_WIND_LAND_DEPTH__: true }, s = windWhiteStrength('light', w);
    expect(s).toEqual({ land: 1, sea: 0.55 });
    expect(trailVeilUniform('light', true, 0.505, w)[1]).toBeCloseTo(1 / Math.sqrt(0.55), 6);
    const g = [0.3, 0.5, 0.4], inv = 1 / Math.sqrt(0.55);
    for (const b of [0.75, 0.9, 1]) expect(trailVeilComposite(g, [b, b, b], 1, 0.505, inv)).toEqual(trailVeilComposite(g, [b, b, b], 1, 0, inv));
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

describe('the shader: the line every other path draws by is untouched, the veiled composite is one guarded line above it', () => {
  it('SCREEN_FS still ends in the line dark, every older look and the kill draw by', () => {
    expect(SCREEN_FS).toContain('gl_FragColor = u_ink > 0.5 ? vec4(mix(vec3(1.0), color.rgb, u_opacity * inkCapOf(u_screen)), 1.0) : (u_premul > 0.5 ? color * u_opacity : vec4(u_glow > 0.5 ? color.rgb / max(brightness, 0.004) : color.rgb, brightness * (u_glow > 0.5 ? brightness : 1.0) * u_opacity));');
  });
  it('the veiled composite is reached only inside the glow branch and only with a veil over 0, before that line', () => {
    const guard = 'if (u_glow > 0.5 && u_trail_veil.x > 0.0) { gl_FragColor = trailVeilOf(color.rgb, brightness, u_opacity); return; }';
    expect(SCREEN_FS).toContain(guard);
    expect(SCREEN_FS.indexOf(guard)).toBeLessThan(SCREEN_FS.indexOf('gl_FragColor = u_ink > 0.5 ?'));
    expect(SCREEN_FS.indexOf(guard)).toBeGreaterThan(SCREEN_FS.indexOf('float brightness = max(color.r, max(color.g, color.b));'));
    expect(SCREEN_FS).toContain(GLSL_TRAIL_VEIL);
    expect(SCREEN_FS.match(/trailVeilOf\(/g)).toHaveLength(2);                           // its definition and that one call
  });
  it('it is the composite\'s alone: the buffer\'s fade and the marks do not know it', () => {
    for (const src of [FADE_FS, DRAW_FS]) { expect(src).not.toContain('u_trail_veil'); expect(src).not.toContain('trailVeilOf'); }
  });
  it('the GLSL is the mirror\'s arithmetic: the glow branch\'s light, the veil against the core\'s level, the colour scaled so the light added is unchanged', () => {
    expect(GLSL_TRAIL_VEIL).toContain('float bn = min(1.0, b * u_trail_veil.y), light = b * b * op, a = light + u_trail_veil.x * bn * (1.0 - bn);');
    expect(GLSL_TRAIL_VEIL).toContain('return vec4(c / max(b, 0.004) * (light / max(a, 0.0001)), a);');
  });
  it('the engine sends it once a frame, with the composite, from dark\'s own opacity read BEFORE the glow branch takes its own', () => {
    expect(ENGINE).toContain('} var darkOpacity = finalOpacity; if (_ink.glow) finalOpacity = _ink.opacity;');
    expect(ENGINE).toContain("var _veil = trailVeilUniform(effectiveTheme, _ink.glow, darkOpacity * windCloseLandFactor(effectiveTheme, z)); gl.uniform2f(gl.getUniformLocation(this.screenProgram, 'u_trail_veil'), _veil[0], _veil[1]);");
    expect(ENGINE.match(/u_trail_veil/g)).toHaveLength(1);
    expect(ENGINE.indexOf("'u_trail_veil'")).toBeGreaterThan(ENGINE.indexOf('// Step 4: Composite to main framebuffer'));
  });
});

// ── the real engine on a recording GL: what the composite is SENT, on every path a lever or a kill can reach ──────────────────────
function makeGl() {
  const st = { fbo: null, prog: null, sent: [] };
  let id = 0;
  const obj = (kind) => ({ kind, id: ++id });
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
    uniform1f: (loc, a) => { if (loc && (loc.name === 'u_glow' || loc.name === 'u_opacity')) st.sent.push({ name: loc.name, p: loc.p, fbo: st.fbo, v: [a] }); },
    uniform2f: (loc, a, b) => { if (loc && loc.name === 'u_trail_veil') st.sent.push({ name: loc.name, p: loc.p, fbo: st.fbo, v: [a, b] }); },
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
const clearLevers = () => Object.keys(window).filter((k) => k.startsWith('__RAW_') || k.startsWith('__GPU_DEBUG') || k.startsWith('__WIND_')).forEach((k) => { delete window[k]; });

/** Run the real engine for a frame a zoom; return the veil it sent with each composite, and the glow flag and opacity beside it. */
function veils(theme, levers, zooms = [3, 6, 8]) {
  clearLevers(); Object.assign(window, levers);
  const { gl, st } = makeGl(), e = new WebGLWindEngine();
  e.particleRes = 4; e.init(gl);
  e.setWindData(gl, { ...GLOBAL, vectors: vectorsFor(GLOBAL.cols, GLOBAL.rows, 20) });
  const m = new Float32Array([2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]), out = [];
  for (const z of zooms) {
    st.sent.length = 0; st.fbo = null;
    e.render(gl, m, 64, 64, z, theme, null, [-100, 15, -70, 40]);
    const onMap = st.sent.filter((s) => s.fbo === null && s.p === e.screenProgram);
    const last = (name) => onMap.filter((s) => s.name === name).pop();
    out.push({ z, veil: last('u_trail_veil') && last('u_trail_veil').v, glow: last('u_glow') && last('u_glow').v[0], opacity: last('u_opacity') && last('u_opacity').v[0], sends: st.sent.filter((s) => s.name === 'u_trail_veil').length });
  }
  clearLevers();
  return out;
}

describe('the real engine, a recording GL: the veil the composite is sent', () => {
  beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { jest.restoreAllMocks(); });

  const OFF_PATHS = {
    'its kill': { [KILL]: true },
    'its kill, with the steer set': { [KILL]: true, [STEER]: 2 },
    'the steer at false': { [STEER]: false },
    'dark rules killed': { __RAW_DISABLE_WIND_DARK_RULES__: true },
    'white streak killed': { __RAW_DISABLE_WIND_WHITE_STREAK__: true },
    'dark white killed': { __RAW_DISABLE_WIND_DARK_WHITE__: true },
    'field tint killed': { __RAW_DISABLE_WIND_FIELD_TINT__: true },
    'speed premul killed': { __RAW_DISABLE_WIND_SPEED_PREMUL__: true },
    'basemap mute killed': { __RAW_DISABLE_WIND_BASEMAP_MUTE__: true },
    'dark rules + speed premul killed': { __RAW_DISABLE_WIND_DARK_RULES__: true, __RAW_DISABLE_WIND_SPEED_PREMUL__: true },
    'ink lever': { __RAW_WIND_INK__: true },
    'glow lever': { __RAW_WIND_GLOW__: true },
    'v2 theme': { __RAW_WIND_THEME_V2__: true },
    'field tint steered': { __RAW_WIND_FIELD_TINT_THEMES__: 'dark,light,beach' },
  };
  const table = [];
  for (const [name, levers] of Object.entries(OFF_PATHS)) for (const theme of ['dark', 'light', 'beach']) table.push([name, theme, levers]);
  for (const look of ['deep', 'moderate', 'ink']) table.push([`light look ${look}`, 'light', { __RAW_WIND_LIGHT_LOOK__: look }]);   // a light look is light's alone
  it.each(table)('no veil: %s, %s', (name, theme, levers) => {
    for (const f of veils(theme, levers)) { expect(f.veil).toEqual([0, 1]); expect(f.sends).toBe(1); }
  });
  it('dark is never sent one, by default or whatever the steer says', () => {
    for (const levers of [{}, { [STEER]: 0.5 }, { [STEER]: 2 }]) for (const f of veils('dark', levers)) {
      expect(f.veil).toEqual([0, 1]); expect(f.glow).toBe(0); expect([0.48, 0.505, 0.404]).toContain(+f.opacity.toFixed(3));   // dark's own opacity by zoom, eased at close zoom
    }
  });
  it('BY DEFAULT light and beach are sent dark\'s own opacity at that zoom times their close-zoom factor, beside the glow branch and the white streak\'s own opacity', () => {
    for (const theme of ['light', 'beach']) {
      const [z3, z6, z8] = veils(theme, {});
      expect(z3.veil[0]).toBeCloseTo(0.48, 5); expect(z6.veil[0]).toBeCloseTo(0.505, 5); expect(z8.veil[0]).toBeCloseTo(0.505 * 0.65, 5);
      for (const f of [z3, z6, z8]) { expect(f.veil[1]).toBeCloseTo(1 / Math.sqrt(0.55), 5); expect(f.glow).toBe(1); expect(f.sends).toBe(1); }
      expect(z6.opacity).toBeCloseTo(1, 6); expect(z8.opacity).toBeCloseTo(0.65, 6);   // the light it adds is not touched
      expect(veils(theme, { [STEER]: 0.5 })[1].veil[0]).toBeCloseTo(0.2525, 5);
    }
  });
  it('kills of things the veil does not rest on leave it drawn: the land\'s depth, each path, the canvas\'s alpha, the trail anchor', () => {
    for (const k of ['__RAW_DISABLE_WIND_LAND_DEPTH__', '__RAW_DISABLE_WIND_LIGHT_PATH__', '__RAW_DISABLE_WIND_BEACH_PATH__', '__RAW_DISABLE_WIND_OPAQUE_CANVAS__', '__RAW_DISABLE_WIND_TRAIL_ANCHOR__']) {
      for (const theme of ['light', 'beach']) expect(veils(theme, { [k]: true })[1].veil[0]).toBeCloseTo(0.505, 5);
    }
    expect(veils('beach', { __RAW_WIND_LIGHT_LOOK__: 'deep' })[1].veil[0]).toBeCloseTo(0.505, 5);   // a light look is light's alone: beach keeps the white streak and its veil
  });
  it('the kill is read each frame: set and cleared between frames, the next composite follows it', () => {
    clearLevers();
    const { gl, st } = makeGl(), e = new WebGLWindEngine();
    e.particleRes = 4; e.init(gl); e.setWindData(gl, { ...GLOBAL, vectors: vectorsFor(GLOBAL.cols, GLOBAL.rows, 20) });
    const m = new Float32Array([2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]);
    const frame = () => { st.sent.length = 0; st.fbo = null; e.render(gl, m, 64, 64, 6, 'light', null, [-100, 15, -70, 40]); return st.sent.filter((s) => s.name === 'u_trail_veil').pop().v[0]; };
    expect(frame()).toBeCloseTo(0.505, 5);
    window[KILL] = true; expect(frame()).toBe(0);
    delete window[KILL]; expect(frame()).toBeCloseTo(0.505, 5);
    clearLevers();
  });
});
