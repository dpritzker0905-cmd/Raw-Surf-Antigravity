/**
 * INK TRAILS (windInk.js): dark's wind look, mirrored for a light ground. DEFAULT OFF: a lever for the owner's A/B.
 *
 * Dark draws its streaks as LIGHT: a trail buffer that fades to black, a black rim that carves each mark out of its
 * neighbours, a composite that takes alpha from brightness. On screen every mark pixel is lighter than the field under
 * it and keeps the field's hue (wind bench map mode, the style columns). Light and beach cannot use that: a streak
 * lighter than a pale ground has nowhere to go. Their mirror is INK: a buffer that fades to white paper, a white rim that
 * carves, a multiply composite, and the legend's own colour as the ink. These tests pin the lever, the three shader
 * branches, the engine wiring and the two properties the mirror stands on: the fade always reaches clean paper, and a
 * multiply can only darken.
 */
import fs from 'fs';
import path from 'path';
import { windInk, WIND_INK, WIND_GLOW, clearTrails, bindInk, inkFadeStep, inkComposite, inkOf, glowOf, glowComposite, GLSL_INK_MARK } from './windInk';
import { FADE_FS, SCREEN_FS, DRAW_FS } from './WebGLWindShaders';
import { GLSL_TRAIL_UV, windTrailFrame } from './windTrailAnchor';
import { resolveWindParticlesV2, v2SpeedPremul } from './WebGLWindUtils';
import { THEME_RAMPS, resolveFieldRamp } from './WindColorRamp';
import { muteColor, windBasemapMuteAmount, windBasemapWaterL } from './windBasemapMute';

const V2 = resolveWindParticlesV2({});
const ENGINE = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
const fakeGl = () => {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  return { calls, FRAMEBUFFER: 'FB', COLOR_BUFFER_BIT: 'CB', bindFramebuffer: rec('bindFramebuffer'), clearColor: rec('clearColor'), clear: rec('clear'),
    uniform1f: rec('uniform1f'), getUniformLocation: (prog, name) => `${prog}.${name}` };
};

describe('the lever: default off, light and beach only', () => {
  it('is off in every theme until the lever is set', () => {
    for (const theme of ['light', 'beach', 'dark']) expect(windInk(theme, V2, {}).on).toBe(false);
    expect(WIND_INK.themes).toEqual([]);
  });
  it('true turns it on for light and beach, and never for dark (dark is the look being mirrored)', () => {
    const w = { __RAW_WIND_INK__: true };
    expect(windInk('light', V2, w).on).toBe(true);
    expect(windInk('beach', V2, w).on).toBe(true);
    expect(windInk('dark', V2, w).on).toBe(false);
    expect(windInk('dark', V2, { __RAW_WIND_INK__: 'dark,light' }).on).toBe(false);
  });
  it('a theme list picks themes; anything else leaves it off', () => {
    expect(windInk('light', V2, { __RAW_WIND_INK__: 'light' }).on).toBe(true);
    expect(windInk('beach', V2, { __RAW_WIND_INK__: 'light' }).on).toBe(false);
    expect(windInk('beach', V2, { __RAW_WIND_INK__: 'light,beach' }).on).toBe(true);
    for (const v of [1, 'yes', {}, null, false, undefined]) expect(windInk('light', V2, { __RAW_WIND_INK__: v }).on).toBe(false);
  });
  it('the kill switch wins, and the neutral-body theme (v2) owns its own composite', () => {
    expect(windInk('light', V2, { __RAW_WIND_INK__: true, __RAW_DISABLE_WIND_INK__: true }).on).toBe(false);
    expect(windInk('light', { ...V2, theme: true }, { __RAW_WIND_INK__: true }).on).toBe(false);
    expect(windInk('light', null, { __RAW_WIND_INK__: true }).on).toBe(false);
  });
  it('opacity and spine levers are taken only inside their ranges', () => {
    const on = (extra) => windInk('light', V2, { __RAW_WIND_INK__: true, ...extra });
    expect(on({}).opacity).toBe(WIND_INK.opacity.light);
    expect(on({ __RAW_WIND_INK_OPACITY__: 0.5 }).opacity).toBe(0.5);
    for (const bad of [0, 1.5, -1, '0.5', NaN]) expect(on({ __RAW_WIND_INK_OPACITY__: bad }).opacity).toBe(WIND_INK.opacity.light);
    expect(on({}).spine).toBe(WIND_INK.spine);
    expect(on({ __RAW_WIND_INK_SPINE__: 0.4 }).spine).toBe(0.4);
    for (const bad of [-0.1, 1.1, '0.4', NaN]) expect(on({ __RAW_WIND_INK_SPINE__: bad }).spine).toBe(WIND_INK.spine);
    expect(windInk('light', V2, {})).toEqual({ mode: 0, on: false, glow: false, opacity: 0, spine: 0, purity: 0, density: 1, white: 0 });
    expect(windInk('light', V2, { __RAW_WIND_INK__: true }).mode).toBe(1);
  });
  it('purity and density levers are taken only inside their ranges', () => {
    const on = (extra) => windInk('light', V2, { __RAW_WIND_INK__: true, ...extra });
    expect(on({}).purity).toBe(WIND_INK.purity);
    expect(on({}).density).toBe(WIND_INK.density);
    expect(on({ __RAW_WIND_INK_PURITY__: 0.5 }).purity).toBe(0.5);
    expect(on({ __RAW_WIND_INK_DENSITY__: 2 }).density).toBe(2);
    for (const bad of [-0.1, 1.1, '1', NaN]) expect(on({ __RAW_WIND_INK_PURITY__: bad }).purity).toBe(WIND_INK.purity);
    for (const bad of [0.2, 4.5, '2', NaN]) expect(on({ __RAW_WIND_INK_DENSITY__: bad }).density).toBe(WIND_INK.density);
  });
});

describe('GLOW, the second candidate: dark\'s own pipeline on a light ground (default off)', () => {
  it('is off until its lever is set, never on for dark, and ink wins when both are set', () => {
    for (const theme of ['light', 'beach', 'dark']) expect(windInk(theme, V2, {}).glow).toBe(false);
    expect(WIND_GLOW.themes).toEqual([]);
    const g = windInk('light', V2, { __RAW_WIND_GLOW__: true });
    expect(g).toMatchObject({ mode: 2, on: false, glow: true, opacity: WIND_GLOW.opacity.light, white: WIND_GLOW.white });
    expect(windInk('beach', V2, { __RAW_WIND_GLOW__: 'light' }).glow).toBe(false);
    expect(windInk('dark', V2, { __RAW_WIND_GLOW__: true }).glow).toBe(false);
    expect(windInk('light', V2, { __RAW_WIND_GLOW__: true, __RAW_WIND_INK__: true })).toMatchObject({ mode: 1, on: true, glow: false });
    expect(windInk('light', V2, { __RAW_WIND_GLOW__: true, __RAW_DISABLE_WIND_GLOW__: true }).mode).toBe(0);
    expect(windInk('light', { ...V2, theme: true }, { __RAW_WIND_GLOW__: true }).mode).toBe(0);
  });
  it('a tail fades by dark\'s own law: the light a mark adds falls with the SQUARE of the buffer level, so half-faded ink is a quarter as strong', () => {
    const ground = [0.5, 0.5, 0.5], tint = [1, 0.9, 0.6], add = (level) => glowComposite(ground, tint.map((v) => v * level), 1)[0] - ground[0];
    expect(add(0.5) / add(1)).toBeCloseTo(0.25, 6);
    expect(add(0.25) / add(1)).toBeCloseTo(0.0625, 6);
    // dark's own composite over a BLACK ground, for reference: rgb x alpha = (level x colour) x (level x opacity)
    const dark = (level) => (tint[0] * level) * (level * 1);
    expect(dark(0.5) / dark(1)).toBeCloseTo(0.25, 12);
  });
  it('its opacity and white levers are taken only inside their ranges', () => {
    const on = (extra) => windInk('beach', V2, { __RAW_WIND_GLOW__: true, ...extra });
    expect(on({ __RAW_WIND_GLOW_OPACITY__: 0.6 }).opacity).toBe(0.6);
    expect(on({ __RAW_WIND_GLOW_WHITE__: 0.5 }).white).toBe(0.5);
    for (const bad of [0, 1.2, '0.6', NaN]) expect(on({ __RAW_WIND_GLOW_OPACITY__: bad }).opacity).toBe(WIND_GLOW.opacity.beach);
    for (const bad of [-0.1, 1.1, '0.5', NaN]) expect(on({ __RAW_WIND_GLOW_WHITE__: bad }).white).toBe(WIND_GLOW.white);
    expect(on({}).spine).toBe(WIND_GLOW.ring);                       // glow's white inner ring rides the same uniform as ink's spine
    expect(on({ __RAW_WIND_GLOW_RING__: 0.2 }).spine).toBe(0.2);
    for (const bad of [-0.1, 1.1, '0.2', NaN]) expect(on({ __RAW_WIND_GLOW_RING__: bad }).spine).toBe(WIND_GLOW.ring);
  });
  it('stands the premultiplied composite down for its theme, so the engine runs dark\'s path there (and leaves ink and the default alone)', () => {
    expect(v2SpeedPremul(V2, 'light', {}).on).toBe(true);
    expect(v2SpeedPremul(V2, 'light', { __RAW_WIND_GLOW__: true })).toEqual({ on: false, opacity: 0, singleCasing: false });
    expect(v2SpeedPremul(V2, 'beach', { __RAW_WIND_GLOW__: 'light' }).on).toBe(true);
    expect(v2SpeedPremul(V2, 'light', { __RAW_WIND_INK__: true }).on).toBe(true);
    expect(v2SpeedPremul(V2, 'dark', { __RAW_WIND_GLOW__: true })).toEqual(v2SpeedPremul(V2, 'dark', {}));
  });
  it('the mark is the legend colour at full brightness, mixed toward white: its strongest channel is 1, it is never darker than the pure colour', () => {
    for (const c of [[0.804, 0.641, 0.027], [0.395, 0.104, 0.440], [0.415, 0.764, 0.520]]) for (const w of [0, 0.35, 0.8]) {
      const g = glowOf(c, w), pure = glowOf(c, 0);
      expect(Math.max(...g)).toBeCloseTo(1, 12);
      g.forEach((v, i) => { expect(v).toBeGreaterThanOrEqual(pure[i] - 1e-12); expect(v).toBeLessThanOrEqual(1 + 1e-12); });
    }
    expect(glowOf([1, 1, 1], 0.35)).toEqual([1, 1, 1]);
    expect(GLSL_INK_MARK).toContain('return mix(c / max(max(c.r, c.g), max(c.b, 0.001)), vec3(1.0), u_ink_k.z - 1.0);');
    expect(DRAW_FS).toContain('if (u_ink > 0.5) rgb = inkOf(rgb); else if (u_ink_k.z > 0.5) rgb = glowOf(rgb);');
  });
  it('a fading tail keeps the mark\'s colour and loses only strength: over a light ground it never goes darker than the ground', () => {
    const ground = [0.78, 0.78, 0.76], tint = glowOf([0.804, 0.641, 0.027], 0.6);   // a light gold, every channel above the ground's except blue
    const lum = (c) => 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
    for (let level = 1; level <= 255; level++) {
      const buf = tint.map((v) => Math.floor(v * level) / 255);                    // the buffer fades RGB toward black, as dark's does
      const d = lum(glowComposite(ground, buf, 0.9)) - lum(ground);
      expect(d).toBeGreaterThanOrEqual(level >= 32 ? -1e-9 : -0.005);   // below 1/8 strength the 8-bit buffer rounds each channel on its own: a dip of at most 0.5% of luminance
    }
    // POSITIVE CONTROL: dark's own composite (colour NOT renormalised) drags a light ground down while the tail fades: the grey ghost
    const legacy = (g, buf, op) => { const a = Math.max(...buf) * op; return g.map((v, i) => v * (1 - a) + buf[i] * a); };
    const worst = Math.min(...Array.from({ length: 255 }, (_, k) => lum(legacy(ground, tint.map((v) => Math.floor(v * (k + 1)) / 255), 0.9)) - lum(ground)));
    expect(worst).toBeLessThan(-0.03);
    expect(SCREEN_FS).toContain('vec4(u_glow > 0.5 ? color.rgb / max(brightness, 0.004) : color.rgb, brightness * (u_glow > 0.5 ? brightness : 1.0) * u_opacity)');
    expect(SCREEN_FS).toMatch(/uniform float u_premul; uniform float u_glow;/);
  });
});

describe('the ink colour: the legend colour as a CLEAN ink (a darkened yellow is brown, so the ink never darkens its own pass band)', () => {
  const GOLD = [0.804, 0.641, 0.027], PLUM = [0.395, 0.104, 0.440], WHITE = [1, 1, 1];
  it('purity 0, density 1 is the legend colour itself', () => {
    for (const c of [GOLD, PLUM, WHITE]) inkOf(c, 0, 1).forEach((v, i) => expect(v).toBeCloseTo(c[i], 12));
  });
  it('a pure ink passes its strongest channel untouched at any density, and keeps the order of the channels (the hue family)', () => {
    for (const c of [GOLD, PLUM, [0.415, 0.764, 0.520], [0.752, 0.167, 0.184]]) for (const d of [1, 1.5, 2, 3]) {
      const t = inkOf(c, 1, d), order = (v) => [0, 1, 2].sort((a, b) => v[a] - v[b]).join('');
      expect(Math.max(...t)).toBeCloseTo(1, 12);
      expect(order(t)).toBe(order(c));
      t.forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); });
    }
  });
  it('density deepens only what the ink absorbs: more saturated, never lighter', () => {
    const a = inkOf(GOLD, 1, 1), b = inkOf(GOLD, 1, 2);
    b.forEach((v, i) => expect(v).toBeLessThanOrEqual(a[i] + 1e-12));
    expect(Math.max(...b) - Math.min(...b)).toBeGreaterThanOrEqual(Math.max(...a) - Math.min(...a));
  });
  it('white (calm) stays paper at any purity and density, and black does not divide by zero', () => {
    for (const p of [0, 0.5, 1]) for (const d of [1, 2, 4]) expect(inkOf(WHITE, p, d)).toEqual([1, 1, 1]);
    inkOf([0, 0, 0], 1, 2).forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });
  it('the shader carries the same function and the mark uses it', () => {
    expect(GLSL_INK_MARK).toContain('uniform float u_ink;');
    expect(GLSL_INK_MARK).toContain('uniform vec3 u_ink_k;');
    expect(GLSL_INK_MARK).toContain('return pow(mix(c, c / max(max(c.r, c.g), max(c.b, 0.001)), u_ink_k.x), vec3(u_ink_k.y));');
    expect(DRAW_FS).toContain(GLSL_INK_MARK);
    const live = (src) => src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');   // what the GLSL compiler sees: no line comments
    for (const decl of ['uniform float u_ink;', 'uniform vec3 u_ink_k;', 'vec3 inkOf(vec3 c) {', 'vec3 glowOf(vec3 c) {', 'if (u_ink > 0.5) rgb = inkOf(rgb);', 'fieldIsBright *= 1.0 - u_ink;']) expect(live(DRAW_FS)).toContain(decl);
    for (const src of [FADE_FS, SCREEN_FS]) { expect(live(src)).toContain('uniform float u_ink;'); expect(live(src)).toContain('u_ink > 0.5 ?'); }
    expect(ENGINE).toContain("gl.uniform3f(gl.getUniformLocation(this.drawProgram, 'u_ink_k'), _ink.purity, _ink.density, _ink.glow ? 1 + _ink.white : 0);");
  });
});

describe('the fade: ink thins toward clean paper and gets there', () => {
  const darkStep = (v, fade) => Math.floor(v * fade);   // FADE_FS, dark: light fades to black
  it('is dark\'s fade read in the mirror: ink = 255 - level', () => {
    for (const fade of [0.93, 0.965, 0.985]) for (let c = 0; c <= 255; c++) expect(inkFadeStep(c, fade)).toBe(255 - darkStep(255 - c, fade));
  });
  it('never darkens a pixel, and every level reaches paper (255) in a bounded number of frames: no ghost ink left behind', () => {
    for (const fade of [0.93, 0.965, 0.985]) {
      let worst = 0;
      for (let c = 0; c <= 255; c++) {
        let v = c, n = 0;
        while (v < 255 && n < 2000) { const next = inkFadeStep(v, fade); expect(next).toBeGreaterThan(v); v = next; n++; }
        expect(v).toBe(255);
        worst = Math.max(worst, n);
      }
      expect(worst).toBeLessThan(fade > 0.98 ? 260 : 120);   // 0.985 (wide zoom): about 4 s at 60 Hz; 0.965: under 2 s
    }
  });
  it('the shader carries exactly that formula, ahead of the two older branches', () => {
    expect(FADE_FS).toContain('gl_FragColor = u_ink > 0.5 ? vec4(1.0 - floor((1.0 - color.rgb) * 255.0 * u_fade) / 255.0, 1.0) : (u_premul > 0.5 ? floor(color * 255.0 * u_fade) / 255.0 :');
  });
});

describe('the composite: a multiply can only darken, and shows the legend\'s own colour', () => {
  const dec = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lab = (rgb) => { const [R, G, B] = rgb.map(dec), f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
    const fx = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), fy = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B), fz = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
  const hue = (q) => (Math.atan2(q[2], q[1]) * 180 / Math.PI + 360) % 360, chroma = (q) => Math.hypot(q[1], q[2]);
  const hueGap = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return d > 180 ? 360 - d : d; };
  const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const FIELD = { light: { op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65 }, beach: { op: 0.55, baseA: 0.45, end: 7, k: 0.60 / 0.55 } };
  const SURFACES = { light: { water: [168, 214, 222], land: [236, 236, 232] }, beach: { water: [115, 182, 230], land: [223, 215, 195] } };
  const muted = (theme, surface) => { const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${SURFACES[theme][surface].join(', ')})`, windBasemapMuteAmount(theme, {}), surface === 'water' ? windBasemapWaterL(theme, {}) : 1));
    return [+m[1] / 255, +m[2] / 255, +m[3] / 255]; };
  const tinted = (theme, ground, [kn, r, g, b]) => { const m = FIELD[theme], s = Math.min(1, m.op * (m.baseA + (1 - m.baseA) * ss(0, m.end, kn)) * m.k); return ground.map((v, i) => v * (1 - s * (1 - [r, g, b][i]))); };

  it('never lightens any ground with any ink at any opacity, and paper (white) changes nothing', () => {
    for (const g of [[0.9, 0.9, 0.88], [0.5, 0.6, 0.7], [0.1, 0.1, 0.1]]) for (const t of [[1, 1, 1], [0.4, 0.1, 0.44], [0.8, 0.64, 0.03], [0, 0, 0]]) for (const op of [0.25, 0.9, 1]) {
      inkComposite(g, t, op).forEach((v, i) => expect(v).toBeLessThanOrEqual(g[i] + 1e-12));
    }
    expect(inkComposite([0.9, 0.8, 0.7], [1, 1, 1], 1)).toEqual([0.9, 0.8, 0.7]);
    expect(SCREEN_FS).toContain('gl_FragColor = u_ink > 0.5 ? vec4(mix(vec3(1.0), color.rgb, u_opacity), 1.0) : (u_premul > 0.5 ? color * u_opacity :');
  });
  it.each(['light', 'beach'])('%s: from 10 kn up a full ink mark is darker than the tinted ground and at least as colourful, on the muted water and land', (theme) => {
    const legend = THEME_RAMPS[theme], field = resolveFieldRamp(theme, {});
    for (const surface of ['water', 'land']) {
      const ground = muted(theme, surface);
      legend.forEach((stop, i) => {
        if (stop[0] < 10) return;
        const under = tinted(theme, ground, field[i]), mark = inkComposite(under, stop.slice(1, 4), WIND_INK.opacity[theme]);
        const a = lab(under), b = lab(mark);
        expect(b[0]).toBeLessThanOrEqual(a[0] - 12);                      // darker: one polarity, with room to spare (-13 to -39 L*)
        expect(chroma(b)).toBeGreaterThanOrEqual(0.9 * chroma(a));        // it carries colour instead of washing it out...
        expect(chroma(b) / b[0]).toBeGreaterThan(1.5 * chroma(a) / a[0]);  // ...and is at least half again as saturated as the ground it rides on
        if (chroma(lab(stop.slice(1, 4))) > 25 && chroma(b) > 15) expect(hueGap(b, lab(stop.slice(1, 4)))).toBeLessThanOrEqual(25);   // and it is the legend's hue
      });
    }
  });
  it('calm stays clean: the 0 kn ink is nearly paper in both themes', () => {
    for (const theme of ['light', 'beach']) { const g = muted(theme, 'land'), m = inkComposite(g, THEME_RAMPS[theme][0].slice(1, 4), WIND_INK.opacity[theme]); expect(lab(g)[0] - lab(m)[0]).toBeLessThan(5); }
  });
});

describe('the mark and the trail buffer', () => {
  it('the rim is white (it carves ink away, as dark\'s black rim carves light away) and the fixed-pole line is kept', () => {
    expect(DRAW_FS).toContain('float fieldIsBright = (u_casing_fixed > 0.5) ? 1.0 : step(0.179, fieldY); fieldIsBright *= 1.0 - u_ink;');
  });
  it('an empty trail texel is paper when ink is on and nothing when it is off: one uniform, zero = the fetch as it was', () => {
    expect(GLSL_TRAIL_UV).toContain('uniform float u_ink;');
    expect(GLSL_TRAIL_UV).toContain('return vec4(u_ink);');
    expect(GLSL_TRAIL_UV).toContain('mix(vec4(u_ink), c, smoothstep(');
    expect(GLSL_TRAIL_UV).not.toContain('return vec4(0.0);');
  });
  it('clearTrails clears both buffers to paper for ink and to nothing otherwise', () => {
    const engine = { screenA: { fbo: 'A' }, screenB: { fbo: 'B' } };
    for (const [ink, k] of [[true, 1], [false, 0]]) {
      const gl = fakeGl();
      clearTrails(gl, engine, ink);
      expect(gl.calls.filter((c) => c[0] === 'clearColor')).toEqual([['clearColor', k, k, k, k], ['clearColor', k, k, k, k]]);
      expect(gl.calls.filter((c) => c[0] === 'bindFramebuffer').map((c) => c[2])).toEqual(['A', 'B']);
      expect(gl.calls.filter((c) => c[0] === 'clear')).toHaveLength(2);
    }
    expect(() => clearTrails(fakeGl(), {}, true)).not.toThrow();
  });
  it('bindInk tells a program which model its buffer is in', () => {
    const gl = fakeGl();
    bindInk(gl, 'fade', 1); bindInk(gl, 'screen', 2); bindInk(gl, 'draw', 0);
    expect(gl.calls).toEqual([['uniform1f', 'fade.u_ink', 1], ['uniform1f', 'fade.u_glow', 0], ['uniform1f', 'screen.u_ink', 0], ['uniform1f', 'screen.u_glow', 1],
      ['uniform1f', 'draw.u_ink', 0], ['uniform1f', 'draw.u_glow', 0]]);
  });
  it('a camera jump clears to paper too (the trail anchor asks the engine which model is live)', () => {
    for (const [ink, k] of [[1, 1], [0, 0], [2, 0]]) {   // 1 = ink: paper; 0 = none and 2 = glow: nothing
      const gl = fakeGl(), engine = { screenA: { fbo: 'A' }, screenB: { fbo: 'B' }, _lastRenderZoom: 5, _inkWas: ink };
      windTrailFrame(engine, gl, new Float64Array(16), 800, 600, 7, { __RAW_DISABLE_WIND_TRAIL_ANCHOR__: true });   // the legacy rule: a 2-level zoom jump clears
      expect(gl.calls.filter((c) => c[0] === 'clearColor')).toEqual([['clearColor', k, k, k, k], ['clearColor', k, k, k, k]]);
    }
  });
});

describe('the artifact scanner can scan both candidates', () => {
  const { buildMatrix, VARIANTS, ALL_VARIANTS } = require('../../../scripts/wind-bench/matrix');
  it('names glow and ink as variants with exactly their lever, outside the default matrix', () => {
    expect(ALL_VARIANTS.glow.levers).toEqual({ __RAW_WIND_GLOW__: true });
    expect(ALL_VARIANTS.ink.levers).toEqual({ __RAW_WIND_INK__: true });
    expect(Object.keys(VARIANTS)).toEqual(['shipped', 'candidate']);                       // the default run is unchanged
    const named = buildMatrix({ themes: ['light'], variants: ['candidate', 'glow', 'ink'] });
    expect([...new Set(named.map((c) => c.variant))]).toEqual(['candidate', 'glow', 'ink']);
    expect([...new Set(buildMatrix({ themes: ['light'] }).map((c) => c.variant))]).toEqual(['shipped', 'candidate']);
  });
});

describe('the engine wiring', () => {
  it('resolves the lever once per frame and tells all three programs', () => {
    expect(ENGINE).toContain(', _ink = windInk(effectiveTheme, _v2)');
    expect(ENGINE).toContain('bindInk(gl, this.fadeProgram, _ink.mode);');
    expect(ENGINE).toContain('bindInk(gl, this.screenProgram, _ink.mode);');
    expect(ENGINE).toContain('bindInk(gl, this.drawProgram, _ink.mode);');
  });
  it('re-clears to the right "nothing" when the model changes, AFTER the older premultiplied re-clear, and whenever the buffers are new', () => {
    const premul = ENGINE.indexOf('if (this._v2Premul !== _premul) { this._v2Premul = _premul;'), ink = ENGINE.indexOf('if (this._inkWas !== _ink.mode) { this._inkWas = _ink.mode; clearTrails(gl, this, _ink.on); }');
    expect(premul).toBeGreaterThan(0);
    expect(ink).toBeGreaterThan(premul);
    expect(ENGINE.indexOf('gl.useProgram(this.fadeProgram);')).toBeGreaterThan(ink);   // before anything reads the buffers this frame
    expect(ENGINE).toContain('this._screenW = screenWidth; this._screenH = screenHeight; this._trail = null; this._inkWas = null;');   // new buffers are zeros: black ink
    expect(ENGINE.slice(ENGINE.indexOf('WebGLWindEngine.prototype.clearBuffers'))).toContain('this._inkWas = null;');                     // so is a layer switch's clear
  });
  it('composites by multiply, after the older blend line it overrides, at the ink opacity and the close-zoom land factor', () => {
    const older = "gl.blendFunc(_premul ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_premul'), _premul ? 1 : 0);";
    const at = ENGINE.indexOf(older);
    expect(at).toBeGreaterThan(0);
    expect(ENGINE.slice(at + older.length, at + older.length + 120)).toContain('if (_ink.on) gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);');
    // ONE opacity site (windCloseLand.test.js): ink arrives through the premultiplied opacity, glow through the brightness-alpha one
    expect(v2SpeedPremul(V2, 'light', { __RAW_WIND_INK__: true })).toEqual({ on: true, opacity: WIND_INK.opacity.light, singleCasing: false });
    expect(v2SpeedPremul(V2, 'beach', { __RAW_WIND_INK__: true, __RAW_WIND_INK_OPACITY__: 0.5 }).opacity).toBe(0.5);
    expect(ENGINE).toContain('if (_ink.glow) finalOpacity = _ink.opacity;');
    expect(ENGINE.indexOf('if (_ink.glow) finalOpacity = _ink.opacity;')).toBeLessThan(ENGINE.indexOf("_v2.theme ? _v2.composite : (_pm.on ? _pm.opacity : finalOpacity) * windCloseLandFactor(effectiveTheme, z))"));
    expect(ENGINE.match(/windCloseLandFactor\(/g)).toHaveLength(1);
  });
  it('the buffer-to-buffer copy is a plain copy in every model: the renormalising glow branch belongs to the map composite only', () => {
    // Found on the bench: with u_glow left on from the last frame's composite, the copy rewrote every texel at full brightness each
    // frame, so nothing ever faded and the map whited out (marks on 93-99% of the pixels).
    const copy = ENGINE.indexOf('// Copy screenB screenA'), composite = ENGINE.indexOf('// Step 4: Composite to main framebuffer');
    expect(copy).toBeGreaterThan(0); expect(composite).toBeGreaterThan(copy);
    expect(ENGINE.slice(copy, composite)).toContain("gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_opacity'), 1.0); gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_glow'), 0);");
    expect(ENGINE.slice(composite)).toContain('bindInk(gl, this.screenProgram, _ink.mode);');
  });
  it('drops the white inner ring for ink marks (a spine lever can bring a darker core back)', () => {
    expect(ENGINE).toContain("if (_ink.mode) gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_single_casing'), 1 - _ink.spine);");
  });
});
