/**
 * TRAILS ANCHORED TO THE MAP: the trail buffer's own camera (windTrailAnchor.js).
 *
 * The property under test is geometric: a point of the map must sit at the same place in the trail buffer's ink before
 * and after every camera move, so each pass's uv transform is checked by carrying real map points through it. The
 * matrices are built the way the map builds them (mercator -> clip, column-major), with turns and a tilt.
 */
import fs from 'fs';
import path from 'path';
import { stepTrailAnchor, planeOf, windTrailFrame, bindTrailUv, windTrailAnchorEnabled, TRAIL_ANCHOR, TRAIL_IDENTITY, GLSL_TRAIL_UV } from './windTrailAnchor';
import { FADE_FS, SCREEN_FS, DRAW_VS } from './WebGLWindShaders';

const W = 1794, H = 1828;                 // the bench pane at DPR 2, device px
const TILE = 512 * 2;                     // device px per world at z0

/** The map's mercator -> clip matrix for a camera (centre in mercator units, zoom, bearing in degrees, a tilt term). */
function camMatrix({ cx, cy, z, bearing = 0, tilt = 0 }) {
  const ws = TILE * Math.pow(2, z), b = bearing * Math.PI / 180, c = Math.cos(b), s = Math.sin(b);
  const ax = [ws * c * 2 / W, -ws * s * 2 / W], ay = [-ws * s * 2 / H, -ws * c * 2 / H];
  const tx = -(ax[0] * cx + ax[1] * cy), ty = -(ay[0] * cx + ay[1] * cy);
  const m = new Float64Array(16);
  m[0] = ax[0]; m[4] = ax[1]; m[12] = tx;
  m[1] = ay[0]; m[5] = ay[1]; m[13] = ty;
  m[3] = tilt * ay[0]; m[7] = tilt * ay[1]; m[15] = 1 + tilt * ty;      // farther up the screen = farther away
  m[10] = 1;
  return m;
}
const perPx = (z) => 1 / (TILE * Math.pow(2, z));

/** Where a map point lands, as uv in [0, 1], under a ground plane (row-major 3x3). */
function uvOf(P, X, Y) {
  const w = P[6] * X + P[7] * Y + P[8];
  return [((P[0] * X + P[1] * Y + P[2]) / w) * 0.5 + 0.5, ((P[3] * X + P[4] * Y + P[5]) / w) * 0.5 + 0.5];
}
/** The shader's trailTexel address: uv + u_trail_d * uv, perspective-divided (u_trail_d is column-major, minus identity). */
function through(d, uv) {
  const x = uv[0] + d[0] * uv[0] + d[3] * uv[1] + d[6], y = uv[1] + d[1] * uv[0] + d[4] * uv[1] + d[7], q = 1 + d[2] * uv[0] + d[5] * uv[1] + d[8];
  return [x / q, y / q];
}
const POINTS = [[0.2551, 0.4204], [0.2557, 0.4211], [0.2549, 0.4216], [0.25555, 0.42075]];   // around the Gulf view below
const START = { cx: 0.2553, cy: 0.4209, z: 8 };
const px = (uvA, uvB) => Math.hypot((uvA[0] - uvB[0]) * W, (uvA[1] - uvB[1]) * H);

/** Fly a list of cameras; at every frame check both transforms against real map points. Returns the steps. */
function fly(cams, { tolPan = 0.5 + 1e-6 } = {}) {
  let state = null, prevP = null;
  const steps = [];
  for (const cam of cams) {
    const m = camMatrix(cam), step = stepTrailAnchor(state, m, W, H), Pn = planeOf(m);
    if (prevP && !step.clear && step.mode !== 'start') {
      for (const [X, Y] of POINTS) {
        // fade pass: this frame's buffer pixel of a map point -> last frame's buffer pixel of the same point
        expect(px(through(step.fade, uvOf(step.state.P, X, Y)), uvOf(prevP, X, Y))).toBeLessThan(1e-3);
        // composite: the screen's pixel of a map point -> the buffer's pixel of it (to the carried remainder when one to one)
        expect(px(through(step.view, uvOf(Pn, X, Y)), uvOf(step.state.P, X, Y))).toBeLessThan(step.viewLinear ? 1e-3 : tolPan * Math.SQRT2);
      }
      // marks are drawn with the buffer's camera
      expect(Array.from(planeOf(step.draw))).toEqual(step.state.P.map((x) => Math.fround(x)));
      expect([step.draw[2], step.draw[6], step.draw[10], step.draw[14]]).toEqual([0, 0, 0, 0]);   // depth flattened: nothing here is depth tested
    }
    state = step.state; prevP = step.state.P;
    steps.push(step);
  }
  return steps;
}

describe('a still camera', () => {
  test('is the identity in every pass, frame after frame', () => {
    const steps = fly(Array.from({ length: 30 }, () => START));
    expect(steps[0].mode).toBe('start');
    for (const s of steps.slice(1)) {
      expect(s.mode).toBe('pan');
      expect(Array.from(s.fade)).toEqual(Array.from(TRAIL_IDENTITY));
      expect(Array.from(s.view)).toEqual(Array.from(TRAIL_IDENTITY));
      expect([s.fadeLinear, s.viewLinear, s.dk, s.feather, s.clear]).toEqual([false, false, 0, 0, false]);
    }
  });

  test('the zero transform leaves every uv exactly where it is (the arithmetic; the GPU side is the bench, --hash-all)', () => {
    for (const uv of [[0.5 / W, 0.5 / H], [0.3333333, 0.7777777], [(W - 0.5) / W, (H - 0.5) / H]]) expect(through(TRAIL_IDENTITY, uv)).toEqual(uv);
  });
});

describe('a pan', () => {
  test('moves the ink by whole pixels and never lets the remainder grow', () => {
    const cams = [START];
    for (let i = 1; i <= 120; i++) cams.push({ ...START, cx: START.cx + i * 3.4 * perPx(8), cy: START.cy - i * 1.7 * perPx(8) });
    const steps = fly(cams);
    let sumX = 0, sumY = 0;
    for (const s of steps.slice(1)) {
      expect(s.mode).toBe('pan');
      expect([s.fadeLinear, s.viewLinear, s.dk]).toEqual([false, false, 0]);
      const nx = s.fade[6] * W, ny = s.fade[7] * H;
      expect(Math.abs(nx - Math.round(nx))).toBeLessThan(1e-3);
      expect(Math.abs(ny - Math.round(ny))).toBeLessThan(1e-3);
      expect([s.fade[0], s.fade[1], s.fade[2], s.fade[3], s.fade[4], s.fade[5], s.fade[8]]).toEqual([0, 0, 0, 0, 0, 0, 0]);
      sumX += Math.round(nx); sumY += Math.round(ny);
    }
    // 120 frames of 3.4 px east and 1.7 px north (mercator y falls): the whole-pixel shifts add up to the true move
    expect(Math.abs(sumX - 120 * 3.4)).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(Math.abs(sumY - 120 * 1.7)).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  test('a flick of several hundred pixels in one frame is still one exact shift', () => {
    const steps = fly([START, { ...START, cx: START.cx + 431.3 * perPx(8) }]);
    expect(steps[1].mode).toBe('pan');
    expect(Math.round(steps[1].fade[6] * W)).toBe(431);
  });
});

describe('a zoom in', () => {
  const cams = [START];
  for (let i = 1; i <= 40; i++) cams.push({ ...START, z: 8 + i * 0.03 });
  for (let i = 0; i < 30; i++) cams.push({ ...START, z: 9.2 });

  test('is looked at through the buffer, and the ink is re-laid only past the cap and at rest', () => {
    const steps = fly(cams), modes = steps.map((s) => s.mode);
    const moving = steps.slice(1, 41);
    expect(moving.filter((s) => s.mode === 'relay').length).toBe(Math.floor((40 * 0.03) / Math.log2(TRAIL_ANCHOR.maxMagnify)));   // 4 re-lays in 1.2 levels, not 40
    for (const s of moving) {
      expect(['view', 'relay']).toContain(s.mode);
      expect(s.k).toBeGreaterThanOrEqual(1 / TRAIL_ANCHOR.maxMagnify - 1e-9);   // the screen never magnifies the buffer past the cap
      expect(s.k).toBeLessThanOrEqual(1 + 1e-9);
      if (s.mode === 'view') { expect(s.viewLinear).toBe(true); expect(s.fadeLinear).toBe(false); expect(s.dk).toBeCloseTo(s.k - 1, 9); }
      expect(s.feather).toBe(0);
    }
    // at rest: within settleFrames the ink is re-laid one to one, and every later frame is the identity
    const rest = modes.slice(41);
    expect(rest.indexOf('relay')).toBeGreaterThanOrEqual(0);
    expect(rest.indexOf('relay')).toBeLessThanOrEqual(TRAIL_ANCHOR.settleFrames + 1);
    const last = steps[steps.length - 1];
    expect([last.mode, last.k, last.viewLinear, last.dk]).toEqual(['pan', 1, false, 0]);
    expect(Array.from(last.view)).toEqual(Array.from(TRAIL_IDENTITY));
  });
});

describe('a zoom out', () => {
  test('re-lays the ink into a wider buffer first, so the screen is always covered, and feathers the old edge', () => {
    const cams = [START];
    for (let i = 1; i <= 40; i++) cams.push({ ...START, z: 8 - i * 0.03 });
    const steps = fly(cams);
    expect([steps[1].mode, steps[1].fadeLinear]).toEqual(['relay', true]);
    expect(steps[1].feather).toBe(TRAIL_ANCHOR.feather);
    expect(steps[1].k).toBeCloseTo(1 / TRAIL_ANCHOR.widen, 9);
    let state = null;
    for (const cam of cams) {
      const m = camMatrix(cam), s = stepTrailAnchor(state, m, W, H);
      // every screen corner falls inside the buffer (to a thousandth of it)
      for (const uv of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (const v of through(s.view, uv)) { expect(v).toBeGreaterThan(-1e-3); expect(v).toBeLessThan(1 + 1e-3); }
      state = s.state;
    }
    expect(steps.slice(1).filter((s) => s.mode === 'relay').length).toBeLessThanOrEqual(7);   // 1.2 levels at 0.2 a re-lay, not 40
  });

  test('a zoom wobble does not re-lay the ink every frame (the wider buffer stops short of the one-to-one cap)', () => {
    expect(TRAIL_ANCHOR.widen).toBeLessThan(TRAIL_ANCHOR.maxMagnify);
    for (const amp of [0.0015, 0.005, 0.02]) {             // a pinch held still: finger noise of 0.3 to 4 px on a 300 px spread
      const cams = [START];
      for (let i = 1; i <= 90; i++) cams.push({ ...START, z: 8 + (i % 2 ? -amp : amp) });
      const relays = fly(cams).slice(1).filter((s) => s.mode === 'relay');
      expect(relays.length).toBeLessThanOrEqual(1);
    }
  });

  test('a pan during a zoom keeps the buffer centred on the view by whole pixels', () => {
    const cams = [START];
    for (let i = 1; i <= 30; i++) cams.push({ cx: START.cx + i * 5.3 * perPx(8), cy: START.cy + i * 2.1 * perPx(8), z: 8 + i * 0.02 });
    const steps = fly(cams);
    for (const s of steps.slice(1).filter((x) => x.mode === 'view')) {
      const c = through(s.view, [0.5, 0.5]);   // the view centre sits within a pixel of the buffer's
      expect(Math.abs(c[0] - 0.5) * W).toBeLessThanOrEqual(0.5 / s.k + 1e-3);
      expect(Math.abs(c[1] - 0.5) * H).toBeLessThanOrEqual(0.5 / s.k + 1e-3);
    }
  });
});

describe('the date line', () => {
  // The view centre wraps at +-180 (MapLibre, renderWorldCopies): the matrix jumps one world in X in one frame.
  const wrap = (cx) => cx - Math.floor(cx);

  test.each([3, 5, 8])('a drag across it at z%i is still a whole-pixel pan: nothing is cleared, nothing is lost', (z) => {
    const cams = [];
    for (let i = -20; i <= 20; i++) cams.push({ cx: wrap(1 + i * 3.4 * perPx(z)), cy: 0.42, z });   // east across lng 180
    let state = null;
    for (const [n, cam] of cams.entries()) {
      const s = stepTrailAnchor(state, camMatrix(cam), W, H);
      if (n > 0) {
        expect([s.mode, s.clear]).toEqual(['pan', false]);
        expect(Math.abs(s.fade[6] * W - 3.4)).toBeLessThanOrEqual(1);          // 3 or 4 px, never a world
        expect(s.fade[7]).toBe(0);
      }
      state = s.state;
    }
  });

  test('the other way, and during a zoom', () => {
    const cams = [];
    for (let i = -15; i <= 15; i++) cams.push({ cx: wrap(1 - i * 5.1 * perPx(5)), cy: 0.42, z: 5 + (i + 15) * 0.01 });
    let state = null;
    for (const [n, cam] of cams.entries()) {
      const s = stepTrailAnchor(state, camMatrix(cam), W, H);
      if (n > 0) { expect(s.clear).toBe(false); expect(['view', 'relay']).toContain(s.mode); }
      state = s.state;
    }
  });

  test('a real jump of half a world is still a jump', () => {
    const a = stepTrailAnchor(null, camMatrix({ cx: 0.25, cy: 0.42, z: 5 }), W, H);
    expect(stepTrailAnchor(a.state, camMatrix({ cx: 0.75, cy: 0.42, z: 5 }), W, H).mode).toBe('jump');
  });
});

describe('a turn, a tilt, a jump', () => {
  test('a turning map re-lays the ink every frame through the exact transform', () => {
    const cams = Array.from({ length: 20 }, (_, i) => ({ ...START, bearing: i * 1.5 }));
    const steps = fly(cams);
    for (const s of steps.slice(1)) { expect(s.mode).toBe('turn'); expect(s.fadeLinear).toBe(true); expect(s.k).toBeCloseTo(1, 9); }
  });

  test('a turned map that only pans is a pan again', () => {
    const cams = Array.from({ length: 20 }, (_, i) => ({ ...START, bearing: 37, cx: START.cx + i * 2.6 * perPx(8) }));
    for (const s of fly(cams).slice(1)) expect(s.mode).toBe('pan');
  });

  test('a tilted map carries its ink through the ground-plane homography', () => {
    const cams = Array.from({ length: 20 }, (_, i) => ({ ...START, tilt: 0.35, cx: START.cx + i * 4.2 * perPx(8), cy: START.cy + i * 1.1 * perPx(8) }));
    const steps = fly(cams);
    for (const s of steps.slice(1)) expect(s.mode).toBe('turn');
    expect(steps[5].fade[2] !== 0 || steps[5].fade[5] !== 0).toBe(true);   // a perspective term: not an affine shift
  });

  test('a tilted map at rest is the identity', () => {
    const steps = fly(Array.from({ length: 5 }, () => ({ ...START, tilt: 0.35, bearing: 12 })));
    for (const s of steps.slice(1)) { expect(s.mode).toBe('pan'); expect(Array.from(s.fade)).toEqual(Array.from(TRAIL_IDENTITY)); }
  });

  test('a jump keeps nothing: the buffers are cleared and the buffer is the screen again', () => {
    for (const far of [{ ...START, z: 8 + 1.3 }, { ...START, z: 8 - 1.3 }, { ...START, cx: START.cx + 4 * W * perPx(8) }]) {
      const a = stepTrailAnchor(null, camMatrix(START), W, H), b = stepTrailAnchor(a.state, camMatrix(far), W, H);
      expect([b.mode, b.clear, b.k]).toEqual(['jump', true, 1]);
      expect(Array.from(b.state.P)).toEqual(Array.from(planeOf(camMatrix(far))));
    }
  });

  test('a matrix that cannot be inverted, or an empty buffer, stands the anchor down for the frame', () => {
    expect(stepTrailAnchor(null, new Float64Array(16), W, H).mode).toBe('off');
    expect(stepTrailAnchor(null, camMatrix(START), 0, H).mode).toBe('off');
  });
});

// ── the engine's side ───────────────────────────────────────────────────────────────────────────

function fakeGl({ highp = true } = {}) {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  return {
    calls, FRAGMENT_SHADER: 1, HIGH_FLOAT: 2, FRAMEBUFFER: 3, COLOR_BUFFER_BIT: 4, TEXTURE_2D: 5, TEXTURE_MIN_FILTER: 6, TEXTURE_MAG_FILTER: 7, LINEAR: 8, NEAREST: 9,
    getShaderPrecisionFormat: () => ({ precision: highp ? 23 : 0 }),
    bindFramebuffer: rec('bindFramebuffer'), clearColor: rec('clearColor'), clear: rec('clear'),
    getUniformLocation: (_p, n) => n, uniformMatrix3fv: rec('uniformMatrix3fv'), uniform1f: rec('uniform1f'), texParameteri: rec('texParameteri'),
  };
}
const newEngine = () => ({ screenA: { fbo: 'A' }, screenB: { fbo: 'B' } });

describe('windTrailFrame', () => {
  test('anchors by default, counts what it did, and clears both buffers on a jump', () => {
    const gl = fakeGl(), engine = newEngine(), win = {};
    expect(windTrailFrame(engine, gl, camMatrix(START), W, H, 8, win).mode).toBe('start');
    expect(windTrailFrame(engine, gl, camMatrix({ ...START, cx: START.cx + 7 * perPx(8) }), W, H, 8, win).mode).toBe('pan');
    expect(gl.calls.filter((c) => c[0] === 'clear').length).toBe(0);
    expect(windTrailFrame(engine, gl, camMatrix({ ...START, z: 10 }), W, H, 10, win).mode).toBe('jump');
    expect(gl.calls.filter((c) => c[0] === 'bindFramebuffer').map((c) => c[2])).toEqual(['A', 'B', null]);
    expect(gl.calls.filter((c) => c[0] === 'clear').length).toBe(2);
    expect(win.__WIND_TRAIL_ANCHOR__).toEqual({ on: true, mode: 'jump', k: 1, modes: { start: 1, pan: 1, jump: 1 } });
  });

  test('the kill switch gives the legacy buffer back: the identity, and a clear only on a genuine zoom jump', () => {
    const gl = fakeGl(), engine = newEngine(), win = { __RAW_DISABLE_WIND_TRAIL_ANCHOR__: true };
    expect(windTrailAnchorEnabled(win)).toBe(false);
    const zooms = [8, 8.05, 8.1, 8.3, 8.31, 8.6];           // +0.2 then +0.29: the old accumulator passes 0.25 on the second
    const cleared = zooms.map((z) => {
      const before = gl.calls.filter((c) => c[0] === 'clear').length;
      const s = windTrailFrame(engine, gl, camMatrix({ ...START, z }), W, H, z, win);
      expect([s.mode, s.draw, s.dk, s.fadeLinear, s.viewLinear]).toEqual(['off', null, 0, false, false]);
      expect(Array.from(s.fade).concat(Array.from(s.view)).every((x) => x === 0)).toBe(true);
      return gl.calls.filter((c) => c[0] === 'clear').length - before;
    });
    expect(cleared).toEqual([0, 0, 0, 0, 0, 2]);
    expect(engine._trail).toBe(null);
    expect(win.__WIND_TRAIL_ANCHOR__.on).toBe(false);
  });

  test('without high-precision fragment floats the anchor stays off (a texel-exact shift is not guaranteed)', () => {
    const gl = fakeGl({ highp: false }), engine = newEngine(), win = {};
    windTrailFrame(engine, gl, camMatrix(START), W, H, 8, win);
    expect(windTrailFrame(engine, gl, camMatrix({ ...START, cx: START.cx + 9 * perPx(8) }), W, H, 8, win).mode).toBe('off');
    expect(win.__WIND_TRAIL_ANCHOR__.on).toBe(false);
  });

  test('bindTrailUv sets the transform, the feather and the filter of the texture the pass reads', () => {
    const gl = fakeGl(), d = new Float32Array(9);
    bindTrailUv(gl, 'prog', d, true, 0.09);
    expect(gl.calls).toEqual([['uniformMatrix3fv', 'u_trail_d', false, d], ['uniform1f', 'u_trail_feather', 0.09],
      ['texParameteri', 5, 6, 8], ['texParameteri', 5, 7, 8]]);
    gl.calls.length = 0;
    bindTrailUv(gl, 'prog', d, false);
    expect(gl.calls.slice(1)).toEqual([['uniform1f', 'u_trail_feather', 0], ['texParameteri', 5, 6, 9], ['texParameteri', 5, 7, 9]]);
  });
});

describe('wiring', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

  test('both trail passes fetch through the buffer camera, and carry the high-precision line', () => {
    for (const src of [FADE_FS, SCREEN_FS]) {
      expect(src).toContain(GLSL_TRAIL_UV);
      expect(src).toContain('vec4 color = trailTexel(u_screen);');
      expect(src).not.toMatch(/texture2D\(u_screen/);
      expect(src.match(/precision \w+ float;/g)).toEqual(['precision mediump float;']);   // the colour arithmetic is what it was
      expect(src.match(/varying [^;]*v_uv;/g)).toEqual(['varying TRAIL_HP vec2 v_uv;']);   // declared once, by the shared block
      expect(src.indexOf('precision mediump float;')).toBeLessThan(src.indexOf('#ifdef GL_FRAGMENT_PRECISION_HIGH'));
    }
    expect(GLSL_TRAIL_UV).toContain('TRAIL_HP vec3 q = vec3(v_uv, 1.0) + u_trail_d * vec3(v_uv, 1.0);');   // zeros = the plain fetch
    expect(GLSL_TRAIL_UV).toContain('uniform TRAIL_HP mat3 u_trail_d;');
  });

  test('marks take the buffer scale last, after the dash geometry is settled', () => {
    expect(DRAW_VS).toContain('uniform float u_trail_dk;');
    expect(DRAW_VS.indexOf('gl_PointSize *= 1.0 + u_trail_dk;')).toBeGreaterThan(DRAW_VS.indexOf('v_stretch = (gl_PointSize + stepPx) / gl_PointSize;'));
  });

  test('the engine asks once per frame and binds all four sites; the layer hands over the whole matrix', () => {
    const engine = read('WebGLWindEngine.js'), layer = read('WebGLWindLayer.js');
    expect(engine.match(/windTrailFrame\(/g).length).toBe(1);
    expect(engine).toContain("windTrailFrame(this, gl, this._trailMatrix || matrix, screenWidth, screenHeight,");
    // each site: the pass's program is in use, the texture it reads is bound on the active unit, THEN the transform, THEN the draw
    const site = (line, use) => {
      const at = engine.indexOf(line), used = engine.lastIndexOf('gl.useProgram(', at), drawn = engine.indexOf('gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);', at);
      expect(at).toBeGreaterThan(0);
      expect(engine.slice(used, used + use.length)).toBe(use);
      expect(drawn).toBeGreaterThan(at);
      expect(engine.slice(at + line.length, drawn)).not.toMatch(/gl\.useProgram\(|bindTexture\(gl, [^)]*, 0\)|bindTrailUv\(/);   // nothing rebinds before the draw
    };
    site('bindTexture(gl, this.screenA.tex, 0); bindTrailUv(gl, this.fadeProgram, _trail.fade, _trail.fadeLinear, _trail.feather);', 'gl.useProgram(this.fadeProgram);');
    site('bindTexture(gl, this.screenB.tex, 0); bindTrailUv(gl, this.screenProgram, TRAIL_IDENTITY, false);', 'gl.useProgram(this.screenProgram);');
    site('bindTexture(gl, this.screenB.tex, 0); bindTrailUv(gl, this.screenProgram, _trail.view, _trail.viewLinear);', 'gl.useProgram(this.screenProgram);');
    expect(engine.match(/bindTrailUv\(/g).length).toBe(3);
    expect(engine.indexOf('const _trail = windTrailFrame(')).toBeLessThan(engine.indexOf('gl.useProgram(this.fadeProgram);'));
    expect(engine).toContain("'u_matrix'), false, _trail.draw || mat4); gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_trail_dk'), _trail.dk);");
    expect(engine).toContain('bindTrailUv(gl, this.screenProgram, TRAIL_IDENTITY, false);');
    expect(engine).toContain('bindTrailUv(gl, this.screenProgram, _trail.view, _trail.viewLinear);');
    expect(engine).toContain('this._screenW = screenWidth; this._screenH = screenHeight; this._trail = null;');   // a new buffer starts clean
    expect(engine).not.toContain('_zoomDeltaAccum');                                                                // the legacy clear lives behind the kill switch now
    expect(layer).toContain('engine._trailMatrix = _matrix64 || _matrix;');
    expect(layer.indexOf('var _matrix64 = _matrix;')).toBeLessThan(layer.indexOf('_matrix = new Float32Array(_matrix);'));
  });
});
