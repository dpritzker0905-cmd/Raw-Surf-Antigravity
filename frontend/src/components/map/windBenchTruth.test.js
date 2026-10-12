/**
 * The wind bench's TRUTH mode (scripts/wind-bench/truth.js, truth-run.js; LESSONS L-V73, L-V74): what the streaks do to the picture
 * against the same crop drawn with the field alone, and the composite's law fitted from the screen and the trail buffer.
 *
 * The statistics are pure, so they are tested on synthetic frames with a KNOWN answer: a streak that LINGERS over the field and one
 * that comes back and dips UNDER it are the two behaviours the mode was built to tell apart (light's and beach's trails against
 * dark's, log 2026-10-12-wind-trails-linger). The expected numbers are worked here from the CIE definition, not from truth.js.
 * force-uniforms.js (one variable at a time on the real engine) is tested on a recording stand-in for the GL context.
 */
import fs from 'fs';
import path from 'path';
import { glowComposite } from './windInk';

const T = require('../../../scripts/wind-bench/truth');
const { parseForce, forceUniforms } = require('../../../scripts/wind-bench/force-uniforms');
const { cropEdge, cropRect, rowsFromTop, partsOf, partOf, sameRun } = require('../../../scripts/wind-bench/crops');
const BENCH = path.join(__dirname, '..', '..', '..', 'scripts', 'wind-bench');

// CIELAB L* of an sRGB grey byte, from the definition (IEC 61966-2-1 and CIE 15), written out again on purpose.
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = (v) => { const y = lin(v); return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y; };
/** A frame of grey pixels: one byte a pixel. */
const frame = (greys) => { const d = new Uint8ClampedArray(greys.length * 4); greys.forEach((v, k) => { d[k * 4] = v; d[k * 4 + 1] = v; d[k * 4 + 2] = v; d[k * 4 + 3] = 255; }); return d; };
const rgbFrame = (px) => { const d = new Uint8ClampedArray(px.length * 4); px.forEach((c, k) => { d[k * 4] = c[0]; d[k * 4 + 1] = c[1]; d[k * 4 + 2] = c[2]; d[k * 4 + 3] = 255; }); return d; };
const groundOf = (w, h, frames) => { const g = T.ground(w, h); frames.forEach((f) => g.add(f)); return g.done(); };
const watched = (g, frames, opts) => { const w = T.watch(g, opts); frames.forEach((f) => w.add(f)); return w.summary(); };

describe('the colour arithmetic: CIELAB from sRGB bytes', () => {
  it('reads the anchors every table of L* carries: black 0, white 100, mid grey #777 50.03, pure red 53.24', () => {
    expect(T.lab(0, 0, 0)[0]).toBeCloseTo(0, 6);
    expect(T.lab(255, 255, 255)[0]).toBeCloseTo(100, 3);
    expect(T.lab(119, 119, 119)[0]).toBeCloseTo(50.03, 2);
    const red = T.lab(255, 0, 0);
    expect(red[0]).toBeCloseTo(53.24, 1); expect(red[1]).toBeCloseTo(80.09, 0); expect(red[2]).toBeCloseTo(67.2, 0);
    expect(T.lab(119, 119, 119)[0]).toBeCloseTo(L(119), 4);   // and this file's own L agrees with it
  });
});

describe('the true ground: the field alone, the mean in linear light', () => {
  it('a still field is itself; two frames average in LINEAR light, not in bytes', () => {
    const still = groundOf(2, 1, [frame([119, 60]), frame([119, 60])]);
    expect(still.L[0]).toBeCloseTo(L(119), 3); expect(still.L[1]).toBeCloseTo(L(60), 3);
    expect(Array.from(still.byte)).toEqual([119, 119, 119, 60, 60, 60]);
    const mixed = groundOf(1, 1, [frame([0]), frame([255])]);
    expect(mixed.Y[0]).toBeCloseTo(0.5, 6);                    // half of white's light: L* 76.07, where the bytes' mean (127.5) reads 53.4
    expect(mixed.L[0]).toBeCloseTo(76.07, 1);
    expect(mixed.byte[0]).toBeCloseTo(127.5, 6);               // the bytes' mean is kept apart, for the composite's own arithmetic
    expect(mixed.frames).toBe(2);
  });
  it('a flat ground has no texture and no chroma; a ground with none refuses to be read', () => {
    const g = groundOf(2, 2, [frame([119, 119, 119, 119])]);
    expect(g.texture).toBeCloseTo(0, 6); expect(g.chroma).toBeCloseTo(0, 3); expect(g.meanL).toBeCloseTo(50.03, 1); expect(g.meanRGB).toEqual([119, 119, 119]);
    expect(() => T.ground(1, 1).done()).toThrow(/no frame/);
  });
});

describe('every pixel and frame against the field alone', () => {
  // Four pixels over a mid-grey field (L* 50.03), four frames:
  //   A LINGERS: a streak passes and its tail stays over the field to the end (light's and beach's behaviour);
  //   B DARKENS: a streak passes, the pixel comes back to the field and dips under it (dark's);
  //   C is never touched; D holds a streak's core for one frame and is back at once.
  const A = [200, 170, 150, 135], B = [200, 119, 105, 119], C = [119, 119, 119, 119], D = [119, 230, 119, 119];
  const frames = [0, 1, 2, 3].map((i) => frame([A[i], B[i], C[i], D[i]]));
  const g = groundOf(4, 1, [frame([119, 119, 119, 119])]);
  const d = (v) => L(v) - L(119);
  const all = [...A, ...B, ...C, ...D].map(d);
  const s = watched(g, frames);

  it('the light added and the light taken are the two halves of the lift, over every pixel-instant', () => {
    const pos = all.filter((x) => x > 0).reduce((a, x) => a + x, 0) / 16, neg = all.filter((x) => x < 0).reduce((a, x) => a + x, 0) / 16;
    expect(s.added).toBeCloseTo(pos, 1); expect(s.taken).toBeCloseTo(neg, 1); expect(s.lift).toBeCloseTo(pos + neg, 1);
    expect(s.taken).toBeLessThan(0);                           // one pixel-instant of sixteen is under the field (B, frame 2: -5.6 L*)
    expect(d(105)).toBeCloseTo(-5.62, 1);
  });
  it('the shares count pixel-instants: 6 of 16 are 3 L* or more over the field, 1 is 1.5 or more under, 9 are back at it', () => {
    expect(s.over3).toBeCloseTo(6 / 16, 2);                    // A's four, B's first, D's core
    expect(s.under15).toBeCloseTo(1 / 16, 2); expect(s.under3).toBeCloseTo(1 / 16, 2);   // shares are kept to three decimals
    expect(s.atField).toBeCloseTo(9 / 16, 2);                  // B twice, C four times, D three times
    expect(s.over10).toBeCloseTo(5 / 16, 2);                   // 200, 170, 150 of A, 200 of B, 230 of D (135 is +6.2)
    expect(d(135)).toBeGreaterThan(6); expect(d(135)).toBeLessThan(10);
  });
  it('a pixel\'s darkest and lightest moment are read against the field: three of four pixels came back, three were reached', () => {
    expect(s.back).toBeCloseTo(3 / 4, 3);                      // every pixel but the one that lingers
    expect(s.reach).toBeCloseTo(3 / 4, 3);                     // every pixel but the untouched one
    expect(s.darkestP10).toBeCloseTo(d(105), 1);               // the deepest pixel is B's dip
    expect(s.darkest).toBeCloseTo(0, 1);                       // the median pixel sat on the field
    expect(s.lightest).toBeCloseTo(d(200), 1);                 // a core: A's and B's first frame
    expect(s.lightestP90).toBeCloseTo(d(230), 1);
  });
  it('THE TWO BEHAVIOURS, EACH ALONE: a streak that lingers never comes back; one that darkens does, and dips', () => {
    const one = (px) => watched(groundOf(1, 1, [frame([119])]), px.map((v) => frame([v])));
    const linger = one(A), darken = one(B);
    expect(linger.darkest).toBeCloseTo(d(135), 1); expect(linger.darkest).toBeGreaterThan(6);   // its darkest moment is 6 L* OVER the field
    expect(linger.back).toBe(0); expect(linger.under15).toBe(0); expect(linger.taken).toBe(0); expect(linger.over3).toBe(1); expect(linger.atField).toBe(0);
    expect(darken.darkest).toBeCloseTo(d(105), 1); expect(darken.darkest).toBeLessThan(-5);     // its darkest moment is 5.6 L* UNDER it
    expect(darken.back).toBe(1); expect(darken.under15).toBe(0.25); expect(darken.taken).toBeLessThan(0); expect(darken.over3).toBe(0.25); expect(darken.atField).toBe(0.5);
    expect(linger.lightest).toBeCloseTo(darken.lightest, 6);  // and the two cores stand at the same height: only the tail differs
  });
  it('flicker is the mean change a pixel a frame; the Weber contrast is a core\'s luminance over the field\'s', () => {
    const steps = [A, B, C, D].map((p) => [1, 2, 3].map((i) => Math.abs(L(p[i]) - L(p[i - 1]))));
    const mean = [0, 1, 2].map((i) => steps.reduce((a, p) => a + p[i], 0) / 4).reduce((a, x) => a + x, 0) / 3;
    expect(s.flicker).toBeCloseTo(mean, 2);
    expect(s.weber).toBeCloseTo(lin(200) / lin(119) - 1, 2);   // the median of the three pixels reached: 200, 200 and 230 over 119
    expect(s.frames).toBe(4); expect(s.size).toEqual([4, 1]); expect(s.groundL).toBeCloseTo(50, 0);
  });
  it('a frame of another size, and a run with no frame, stop it', () => {
    expect(() => T.watch(g).add(frame([1, 2]))).toThrow(/pixels against a ground/);
    expect(() => T.watch(g).summary()).toThrow(/no frame/);
  });
  it('the thresholds are options: a stricter "back at the field" reads fewer pixel-instants as back', () => {
    const strict = watched(groundOf(1, 1, [frame([119])]), [119, 121, 119].map((v) => frame([v])), { near: 0.5 });
    expect(strict.atField).toBeCloseTo(2 / 3, 3);              // 121 is 0.8 L* over the field: back by 1.5, not by 0.5
    expect(watched(groundOf(1, 1, [frame([119])]), [119, 121, 119].map((v) => frame([v]))).atField).toBe(1);
  });
});

describe('two runs frame for frame (the null control\'s gauge), and the old bench\'s clamp', () => {
  it('the same frames are 0 apart; one pixel moved by a known step is that step, shared over the pixels', () => {
    const a = frame([119, 119, 119, 119]), b = frame([119, 119, 119, 147]);
    const same = T.differ(1); same.add(a, a);
    expect(same.summary()).toEqual({ frames: 1, mean: 0, worstFrame: 0, max: 0, over1: 0, over2: 0 });
    const diff = T.differ(1); diff.add(a, a); diff.add(a, b);
    const r = diff.summary(), step = L(147) - L(119);
    expect(r.max).toBeCloseTo(step, 1); expect(r.worstFrame).toBeCloseTo(step / 4, 2); expect(r.mean).toBeCloseTo(step / 8, 2);
    expect(r.over1).toBeCloseTo(1 / 8, 4); expect(r.over2).toBeCloseTo(1 / 8, 4);
    expect(() => T.differ(1).add(a, frame([1]))).toThrow(/different sizes/);
    expect(() => T.differ(1).summary()).toThrow(/no frame pair/);
  });
  it('the clamp: a see-through pixel with a channel at 255 is counted, an opaque frame has none', () => {
    const c = T.clamp();
    c.add(new Uint8ClampedArray([255, 200, 10, 128, 100, 100, 100, 128, 255, 255, 255, 255, 9, 9, 9, 255]));
    expect(c.summary()).toEqual({ frames: 1, alphaMin: 0.502, seeThrough: 0.5, clampedOfAll: 0.25, clampedOfSeeThrough: 0.5 });
    const opaque = T.clamp(); opaque.add(frame([255, 0]));
    expect(opaque.summary().seeThrough).toBe(0); expect(opaque.summary().alphaMin).toBe(1);
  });
});

describe('the composite\'s law: one family, dark\'s branch and the glow branch its two named members', () => {
  const ground = [69, 118, 99];   // dark's sea under a 15 kn field, as the bench read it
  it('p = q = opacity at level 1 IS dark\'s branch of SCREEN_FS: the buffer\'s colour at alpha b x opacity', () => {
    for (const trail of [[255, 255, 255], [128, 128, 128], [40, 40, 40], [8, 122, 153], [0, 0, 0]]) {
      const b = Math.max(...trail) / 255, a = b * 0.505;
      expect(T.composite(ground, trail, 0.505, 0.505, 1)).toEqual(ground.map((g, j) => Math.round(trail[j] * a + g * (1 - a))));
    }
  });
  it('q = 0 IS the glow branch: the colour at full brightness at alpha b^2 x opacity, as the app\'s own mirror of it draws (windInk.js glowComposite)', () => {
    for (const trail of [[189, 189, 189], [128, 128, 128], [40, 40, 40], [90, 160, 60]]) {
      const app = glowComposite(ground.map((v) => v / 255), trail.map((v) => v / 255), 1).map((v) => Math.round(v * 255));
      expect(T.composite(ground, trail, 1, 0, 1)).toEqual(app);
    }
  });
  it('THE DIFFERENCE IN KIND: a fading white tail goes UNDER the ground by dark\'s law and never by the glow law', () => {
    const under = (p, q) => [230, 180, 128, 90, 60, 40, 20, 8].map((v) => T.composite(ground, [v, v, v], p, q, 1)[1] - ground[1]);
    const dark = under(0.505, 0.505), glow = under(1, 0);
    expect(glow.every((x) => x >= 0)).toBe(true);
    expect(dark[0]).toBeGreaterThan(0);                                              // a fresh core adds light
    expect(dark.slice(3).every((x) => x <= 0)).toBe(true);                            // and from b under g on, the tail takes it
    expect(Math.min(...dark)).toBe(-7);                                               // deepest near b = g / 2: -op g^2 / 4 = -0.505 x 0.463^2 / 4 x 255
    expect(Math.round(-0.505 * Math.pow(118 / 255, 2) / 4 * 255)).toBe(-7);
  });
  it('the veil is nothing at an empty texel and nothing at the level a core is laid at: a core keeps its height', () => {
    const level = Math.sqrt(0.55), core = Math.round(level * 255);
    expect(T.composite(ground, [0, 0, 0], 1, 0.505, level)).toEqual(ground);
    expect(T.composite(ground, [core, core, core], 1, 0.505, level)).toEqual(T.composite(ground, [core, core, core], 1, 0, level));
    const half = Math.round(level * 255 / 2);
    expect(T.composite(ground, [half, half, half], 1, 0.505, level)[1]).toBeLessThan(T.composite(ground, [half, half, half], 1, 0, level)[1]);
  });

  // A crop of 400 pixels over a textured ground, six frames of a buffer holding every strength of white and of a colour.
  const W = 20, H = 20, n = W * H;
  const rnd = (() => { let s = 7; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
  const gpx = Array.from({ length: n }, () => [40 + Math.floor(rnd() * 120), 60 + Math.floor(rnd() * 120), 50 + Math.floor(rnd() * 120)]);
  const trails = Array.from({ length: 6 }, () => Array.from({ length: n }, () => { const v = rnd() < 0.2 ? 0 : Math.floor(rnd() * 256); return rnd() < 0.5 ? [v, v, v] : [Math.round(v * 0.1), Math.round(v * 0.8), v]; }));
  const g = groundOf(W, H, [rgbFrame(gpx)]);
  const fitted = (p, q, level, opts, spoil) => {
    const f = T.lawFit(g, opts);
    trails.forEach((t) => f.add(rgbFrame(gpx.map((c, k) => (spoil && spoil(k)) || T.composite(c, t[k], p, q, level))), rgbFrame(t)));
    return f.summary();
  };
  it('a screen drawn by dark\'s branch is read as p = q = its opacity, to a rounding of the bytes; the glow law does not fit it', () => {
    const s = fitted(0.505, 0.505, 1);
    expect(s.p).toBeCloseTo(0.505, 2); expect(s.q).toBeCloseTo(0.505, 2); expect(s.rms).toBeLessThan(0.4);
    expect(s.dark.opacity).toBeCloseTo(0.505, 2); expect(s.dark.rms).toBeLessThan(0.4);
    expect(s.glow.rms).toBeGreaterThan(5);
    expect(s.empty).toBe(0);                                                          // where the buffer is empty the screen is the ground
  });
  it('a screen drawn by the glow branch is read as p = its opacity and q = 0; dark\'s law does not fit it', () => {
    const s = fitted(1, 0, 1);
    expect(s.p).toBeCloseTo(1, 2); expect(Math.abs(s.q)).toBeLessThan(0.005); expect(s.rms).toBeLessThan(0.4);
    expect(s.glow.opacity).toBeCloseTo(1, 2); expect(s.glow.rms).toBeLessThan(0.4);
    expect(s.dark.rms).toBeGreaterThan(5);
  });
  it('a veil laid against a core\'s own level is read with that level, and misread without it', () => {
    const level = Math.sqrt(0.55), cap = Math.round(level * 255);
    const f = T.lawFit(g, { level }), wrong = T.lawFit(g, { level: 1 });
    trails.forEach((t) => {
      const tt = t.map((c) => c.map((v) => Math.round(v * cap / 255)));              // a buffer that never passes the core's level
      const scr = rgbFrame(gpx.map((c, k) => T.composite(c, tt[k], 1, 0.3, level)));
      f.add(scr, rgbFrame(tt)); wrong.add(scr, rgbFrame(tt));
    });
    expect(f.summary().p).toBeCloseTo(1, 2); expect(f.summary().q).toBeCloseTo(0.3, 2); expect(f.summary().rms).toBeLessThan(0.4);
    expect(wrong.summary().rms).toBeGreaterThan(f.summary().rms * 2);
  });
  it('POSITIVE CONTROLS: a buffer one pixel off the screen, and a map line drawn above the wind, are both seen', () => {
    const shifted = T.lawFit(g);
    trails.forEach((t) => shifted.add(rgbFrame(gpx.map((c, k) => T.composite(c, t[k], 0.505, 0.505, 1))), rgbFrame(t.map((_, k) => t[(k + 1) % n]))));
    expect(shifted.summary().rms).toBeGreaterThan(5);                                 // not the same pixels: no law fits
    expect(shifted.summary().empty).toBeGreaterThan(1);                               // and the screen is not the ground where the buffer says nothing is drawn
    const clean = fitted(0.505, 0.505, 1, { check: [0.505, 0.505] });
    expect(clean.obeys).toBe(1);
    const lines = fitted(0.505, 0.505, 1, { check: [0.505, 0.505] }, (k) => (k % 10 === 0 ? gpx[k] : null));   // a tenth of the pixels are a line the wind cannot change
    expect(lines.obeys).toBeGreaterThan(0.85); expect(lines.obeys).toBeLessThan(0.99);
    expect(lines.rms).toBeGreaterThan(clean.rms * 3);                                 // and they pull the fit, which is why the share is printed
  });
  it('crops that are not one crop stop it; a buffer with no ink has nothing to fit', () => {
    expect(() => T.lawFit(g).add(rgbFrame(gpx), rgbFrame(gpx.slice(1)))).toThrow(/not one crop/);
    const none = T.lawFit(g); none.add(rgbFrame(gpx), rgbFrame(gpx.map(() => [0, 0, 0])));
    expect(none.summary()).toMatchObject({ n: 0, p: null, q: null, empty: 0 });
  });
});

describe('one variable at a time: a forced uniform on the real engine (force-uniforms.js)', () => {
  const makeGl = () => {
    const st = { fbo: null, sent: [] };
    const gl = {
      FRAMEBUFFER_BINDING: 'FRAMEBUFFER_BINDING',
      getParameter: (p) => (p === 'FRAMEBUFFER_BINDING' ? st.fbo : null),
      getUniformLocation: (prog, name) => ({ prog, name }),
      uniform1f: (loc, a) => st.sent.push([loc.prog.id, loc.name, a]),
      uniform2f: (loc, a, b) => st.sent.push([loc.prog.id, loc.name, a, b]),
      uniform3f: (loc, a, b, c) => st.sent.push([loc.prog.id, loc.name, a, b, c]),
      uniform4f: (loc, a, b, c, d) => st.sent.push([loc.prog.id, loc.name, a, b, c, d]),
    };
    const engine = { screenProgram: { id: 'screen' }, drawProgram: { id: 'draw' }, fadeProgram: { id: 'fade' }, screenA: { fbo: { id: 'A' } }, screenB: { fbo: { id: 'B' } }, advFBO: { id: 'adv' } };
    return { gl, st, engine };
  };
  it('a key names a program and a uniform, and may name the pass; anything else stops the run', () => {
    expect(parseForce({ 'screen.u_glow@map': 0, 'draw.u_white': [1, 1] })).toEqual([
      { key: 'screen.u_glow@map', program: 'screen', uniform: 'u_glow', when: 'map', value: [0] },
      { key: 'draw.u_white', program: 'draw', uniform: 'u_white', when: 'any', value: [1, 1] }]);
    for (const bad of [{ u_glow: 1 }, { 'screen.u_glow@later': 1 }, { 'screen.u_glow': 'on' }, { 'screen.u_glow': [1, 2, 3, 4, 5] }, { 'screen.u_glow': NaN }]) expect(() => parseForce(bad)).toThrow(/not a forced uniform/);
    expect(parseForce(null)).toEqual([]);
    const { gl, engine } = makeGl();
    expect(() => forceUniforms(gl, engine, { 'heatmap.u_opacity': 1 })).toThrow(/no program "heatmap"/);
  });
  it('the value is replaced on its way to the GPU for that program and uniform alone, and counted', () => {
    const { gl, st, engine } = makeGl(), f = forceUniforms(gl, engine, { 'draw.u_white': [1, 1], 'screen.u_glow': 0 });
    gl.uniform2f(gl.getUniformLocation(engine.drawProgram, 'u_white'), 0.74, 0.74);
    gl.uniform1f(gl.getUniformLocation(engine.screenProgram, 'u_glow'), 1);
    gl.uniform1f(gl.getUniformLocation(engine.screenProgram, 'u_opacity'), 0.5);     // another uniform of the same program
    gl.uniform1f(gl.getUniformLocation(engine.fadeProgram, 'u_glow'), 1);            // the same uniform of another program
    gl.uniform1f(gl.getUniformLocation(engine.drawProgram, 'u_white'), 0.3);         // another arity: not this force's
    expect(st.sent).toEqual([['draw', 'u_white', 1, 1], ['screen', 'u_glow', 0], ['screen', 'u_opacity', 0.5], ['fade', 'u_glow', 1], ['draw', 'u_white', 0.3]]);
    expect(f.hits).toEqual({ 'draw.u_white': 1, 'screen.u_glow': 1 });
  });
  it('@map holds only while the map\'s own framebuffer is bound, @buffer only while one of the engine\'s is: the composite alone, not the buffer\'s copy', () => {
    const { gl, st, engine } = makeGl(), f = forceUniforms(gl, engine, { 'screen.u_glow@map': 0, 'screen.u_opacity@buffer': 0.25 });
    const send = () => { gl.uniform1f(gl.getUniformLocation(engine.screenProgram, 'u_glow'), 1); gl.uniform1f(gl.getUniformLocation(engine.screenProgram, 'u_opacity'), 1); };
    st.fbo = engine.screenA.fbo; send();          // the buffer's copy
    st.fbo = null; send();                        // the composite, into the map's default framebuffer
    st.fbo = { id: 'the map\'s own offscreen target' }; send();
    st.fbo = engine.advFBO; send();
    expect(st.sent.map((x) => x[2])).toEqual([1, 0.25, 0, 1, 0, 1, 1, 0.25]);
    expect(f.hits).toEqual({ 'screen.u_glow@map': 2, 'screen.u_opacity@buffer': 2 });
  });
  it('restore puts the context back as it was, and a force that never fired reads 0', () => {
    const { gl, st, engine } = makeGl(), before = { loc: gl.getUniformLocation, f1: gl.uniform1f, f2: gl.uniform2f };
    const f = forceUniforms(gl, engine, { 'screen.u_glov': 0 });
    expect(gl.uniform1f).not.toBe(before.f1);
    gl.uniform1f(gl.getUniformLocation(engine.screenProgram, 'u_glow'), 1);
    expect(f.hits).toEqual({ 'screen.u_glov': 0 });                                   // a misspelt uniform: motion-run.js stops the run on this
    f.restore();
    expect(gl.getUniformLocation).toBe(before.loc); expect(gl.uniform1f).toBe(before.f1); expect(gl.uniform2f).toBe(before.f2);
    gl.uniform1f(gl.getUniformLocation(engine.screenProgram, 'u_glow'), 1);
    expect(st.sent).toEqual([['screen', 'u_glow', 1], ['screen', 'u_glow', 1]]);
  });
  it('before the trail buffers exist (the first frame) a pass is the map\'s unless the advect buffer is bound', () => {
    const { gl, st, engine } = makeGl();
    delete engine.screenA; delete engine.screenB;
    const f = forceUniforms(gl, engine, { 'screen.u_glow@map': 0, 'screen.u_opacity@buffer': 0.25 });
    const send = () => { gl.uniform1f(gl.getUniformLocation(engine.screenProgram, 'u_glow'), 1); gl.uniform1f(gl.getUniformLocation(engine.screenProgram, 'u_opacity'), 1); };
    st.fbo = null; send(); st.fbo = engine.advFBO; send();
    expect(st.sent.map((x) => x[2])).toEqual([0, 1, 1, 0.25]);
    expect(f.hits).toEqual({ 'screen.u_glow@map': 1, 'screen.u_opacity@buffer': 1 });
  });
  it('the runner stops a run whose forced uniform never fired AND removes its frames, and the page hands every forced run its counts', () => {
    const run = fs.readFileSync(path.join(BENCH, 'motion-run.js'), 'utf8'), page = fs.readFileSync(path.join(BENCH, 'page', 'map-entry.js'), 'utf8');
    const stop = run.indexOf('if (idle.length) {'), thrown = run.indexOf('a forced uniform never fired');
    expect(stop).toBeGreaterThan(0); expect(thrown).toBeGreaterThan(stop);
    expect(run.slice(stop, thrown)).toContain('for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });');   // frames taken under the default must not stay under the arm's name
    expect(page).toContain('forced: forced ? forced.hits : null');
    expect(page).toContain('if (forced) forced.restore();');
  });
});

describe('the bench mode as it is run', () => {
  it('truth-run.js loads the SAME statistics file into its page, and refuses a see-through frame', () => {
    const run = fs.readFileSync(path.join(BENCH, 'truth-run.js'), 'utf8');
    expect(run).toContain('fs.copyFileSync(path.join(BENCH, \'truth.js\'), path.join(OUT, \'motion\', \'truth-stats.js\'));');
    expect(run).toContain('a see-through frame');
  });
  it('a crop is centred where it is asked and kept inside the image; its rows counted from the bottom are the same rows', () => {
    expect(cropEdge(0.5, 1000, 240)).toBe(380); expect(cropEdge(0, 1000, 240)).toBe(0); expect(cropEdge(1, 1000, 240)).toBe(760);
    expect(cropEdge(0.143, 1346, 240)).toBe(72);
    const r = cropRect(1346, 1371, [240, 330, 'png'], [0.475, 0.85]);
    expect(r).toEqual({ x: 519, y: 1000, w: 240, h: 330, glY: 41 });
    expect(r.glY + r.h).toBe(1371 - r.y);                                      // the top row of the crop, from the bottom
    expect(cropRect(100, 80, [240, 330], null)).toEqual({ x: 0, y: 0, w: 100, h: 80, glY: 0 });   // a crop larger than the image is the image
    expect(cropRect(200, 100, [50, 20])).toMatchObject({ x: 75, y: 40 });       // the centre when no place is asked
  });
  it('THE TRAIL BUFFER\'S CROP IS THE SCREEN\'S CROP: read from the bottom as GL reads, its rows are turned to run from the top', () => {
    // A 3 x 4 image whose pixel (x, y from the top) holds [10 x, 20 y, 7]. GL hands its rows over bottom first.
    const W = 3, H = 4, top = (x, y) => [10 * x, 20 * y, 7, 99];
    const gl = new Uint8Array(W * H * 4);
    for (let row = 0; row < H; row++) for (let x = 0; x < W; x++) gl.set(top(x, H - 1 - row), (row * W + x) * 4);
    const out = rowsFromTop(gl, W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) expect(Array.from(out.slice((y * W + x) * 4, (y * W + x) * 4 + 4))).toEqual([10 * x, 20 * y, 7, 255]);   // and opaque
    // and a crop of it: the rectangle the page asks GL for is the rectangle a canvas crop takes
    const r = cropRect(W, H, [2, 2], [1, 0]), read = new Uint8Array(r.w * r.h * 4);
    for (let row = 0; row < r.h; row++) for (let x = 0; x < r.w; x++) read.set(gl.slice(((r.glY + row) * W + r.x + x) * 4, ((r.glY + row) * W + r.x + x) * 4 + 4), (row * r.w + x) * 4);
    const crop = rowsFromTop(read, r.w, r.h);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) expect(Array.from(crop.slice((y * r.w + x) * 4, (y * r.w + x) * 4 + 3))).toEqual([10 * (r.x + x), 20 * (r.y + y), 7]);
    const page = fs.readFileSync(path.join(BENCH, 'page', 'map-entry.js'), 'utf8');
    expect(page).toContain('gl.readPixels(r.x, r.glY, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, px);');
    expect(page).toContain('drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);');
    expect(page.match(/cropRect\(/g)).toHaveLength(2);                           // both crops, one rectangle
  });
  it('several crops of one frame: each is a run of its own, and crop k goes to run k', () => {
    expect(partsOf('low-light', null)).toEqual([{ name: 'low-light', at: null }]);
    expect(partsOf('low-light', [[0.5, 0.3]])).toEqual([{ name: 'low-light', at: [0.5, 0.3] }]);     // one centre: the run keeps its name, as before
    expect(partsOf('low-light', [[0.143, 0.85], [0.475, 0.2]])).toEqual([{ name: 'low-light@0.143_0.85', at: [0.143, 0.85] }, { name: 'low-light@0.475_0.2', at: [0.475, 0.2] }]);
    expect(partOf(['a', 'b', 'c'], 2, true)).toBe('c'); expect(partOf(['a', 'b', 'c'], 0, true)).toBe('a');
    expect(partOf('only', 0, false)).toBe('only');
  });
  it('a saved result is this run only on the same wind, page, levers, forced uniforms and crop, with the trail buffer if it is asked for', () => {
    const want = { fixture: 'ramp', page: '#000000', levers: { __RAW_X__: true }, force: { 'screen.u_glow@map': 0 }, crop: [240, 330, 'png'], trail: true };
    const saved = { ok: true, fixture: 'ramp', page: '#000000', levers: { __RAW_X__: true }, force: { 'screen.u_glow@map': 0 }, crop: [240, 330, 'png'], trail: true };
    expect(sameRun(saved, want)).toBe(true);
    expect(sameRun({ ...saved, trail: false }, { ...want, trail: false })).toBe(true);
    expect(sameRun(saved, { ...want, trail: false })).toBe(true);              // frames saved with the trail buffer serve a run that does not ask for it
    for (const other of [{ ok: false }, { fixture: 'hurricane' }, { page: '#f9fafb' }, { levers: {} }, { levers: { __RAW_X__: false } }, { force: null }, { force: { 'screen.u_glow@map': 1 } }, { crop: [120, 330, 'png'] }, { trail: false }]) expect(sameRun({ ...saved, ...other }, want)).toBe(false);
    expect(sameRun(undefined, want)).toBe(false);
    expect(sameRun({ ok: true, fixture: 'ramp', page: '#000000' }, { fixture: 'ramp', page: '#000000' })).toBe(true);   // a plain run saved before these fields existed
  });
  it('the README says how to run it and what it must be compared against', () => {
    const readme = fs.readFileSync(path.join(BENCH, 'README.md'), 'utf8');
    expect(readme).toContain('## Truth mode');
    expect(readme).toContain('truth-run.js');
    expect(readme).toMatch(/"res": 2/);
    expect(readme).toContain('force-uniforms.js');
  });
});
