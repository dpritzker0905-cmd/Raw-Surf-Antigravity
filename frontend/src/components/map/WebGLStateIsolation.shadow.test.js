import fs from 'fs';
import path from 'path';
import { captureWebGLState, restoreWebGLState, readShadowedState } from './WebGLStateIsolation';

/**
 * AGREEMENT: the capture taken from MapLibre's state shadow equals the capture taken from the driver.
 *
 * The 2026-10-20 stall profile (PR #400) billed 17% of scrub/switch main-thread stall time to captureWebGLState's synchronous
 * getParameter reads (six BLEND_* values, DEPTH_WRITEMASK, COLOR_WRITEMASK). They now come from
 * `map.painter.context.{blendFunc,blendEquation,colorMask,depthMask}` when that value is clean.
 *
 * The mock GL below keeps real driver state (blendFunc sets RGB and ALPHA, blendFuncSeparate sets them apart, getParameter
 * returns what was set). The shadow is a line-for-line replica of MapLibre 5.24 `src/webgl/value.ts` (BlendFunc, BlendEquation,
 * ColorMask, DepthMask: `set` skips the GL call only when equal AND not dirty) and of the `drawCustom` translucent-pass order
 * (`src/webgl/draw/draw_custom.ts`: setColorMode -> setDepthMode -> render -> setDirty -> setBaseState). The real-GPU half of
 * the agreement is `frontend/scripts/visual-lab/gl_shadow_agreement.js` (window.__RAW_GL_SHADOW_AUDIT__).
 */

const E = {
  ZERO: 0, ONE: 1, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, DST_ALPHA: 0x0304, SRC_COLOR: 0x0300,
  FUNC_ADD: 0x8006, FUNC_SUBTRACT: 0x800a, FUNC_REVERSE_SUBTRACT: 0x800b,
  BLEND: 0x0be2, DEPTH_TEST: 0x0b71, STENCIL_TEST: 0x0b90, SCISSOR_TEST: 0x0c11, CULL_FACE: 0x0b44,
  BLEND_SRC_RGB: 0x80c9, BLEND_DST_RGB: 0x80c8, BLEND_SRC_ALPHA: 0x80cb, BLEND_DST_ALPHA: 0x80ca,
  BLEND_EQUATION_RGB: 0x8009, BLEND_EQUATION_ALPHA: 0x883d, DEPTH_WRITEMASK: 0x0b72, COLOR_WRITEMASK: 0x0c23,
  CURRENT_PROGRAM: 0x8b8d, FRAMEBUFFER_BINDING: 0x8ca6, ACTIVE_TEXTURE: 0x84e0, ARRAY_BUFFER_BINDING: 0x8894,
  ELEMENT_ARRAY_BUFFER_BINDING: 0x8895, VIEWPORT: 0x0ba2, VERTEX_ARRAY_BINDING: 0x85b5, TEXTURE_BINDING_2D: 0x8069,
  TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, FRAMEBUFFER: 0x8d40, ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
};
const SHADOWED_ENUMS = ['BLEND_SRC_RGB', 'BLEND_DST_RGB', 'BLEND_SRC_ALPHA', 'BLEND_DST_ALPHA', 'BLEND_EQUATION_RGB',
  'BLEND_EQUATION_ALPHA', 'DEPTH_WRITEMASK', 'COLOR_WRITEMASK'].map((k) => E[k]);

function makeDriverGL() {
  const st = {
    caps: {}, src: [E.ONE, E.ONE], dst: [E.ZERO, E.ZERO], eq: [E.FUNC_ADD, E.FUNC_ADD], colorMask: [true, true, true, true],
    depthMask: true, prog: null, fbo: null, active: E.TEXTURE0, ab: null, eab: null, vao: null, viewport: [0, 0, 800, 600], tex: {},
  };
  const reads = [];
  const gl = {
    ...E,
    isContextLost: () => false,
    getParameter(e) {
      reads.push(e);
      switch (e) {
        case E.BLEND_SRC_RGB: return st.src[0];
        case E.BLEND_SRC_ALPHA: return st.src[1];
        case E.BLEND_DST_RGB: return st.dst[0];
        case E.BLEND_DST_ALPHA: return st.dst[1];
        case E.BLEND_EQUATION_RGB: return st.eq[0];
        case E.BLEND_EQUATION_ALPHA: return st.eq[1];
        case E.COLOR_WRITEMASK: return st.colorMask.slice();
        case E.DEPTH_WRITEMASK: return st.depthMask;
        case E.CURRENT_PROGRAM: return st.prog;
        case E.FRAMEBUFFER_BINDING: return st.fbo;
        case E.ACTIVE_TEXTURE: return st.active;
        case E.ARRAY_BUFFER_BINDING: return st.ab;
        case E.ELEMENT_ARRAY_BUFFER_BINDING: return st.eab;
        case E.VIEWPORT: return st.viewport.slice();
        case E.VERTEX_ARRAY_BINDING: return st.vao;
        case E.TEXTURE_BINDING_2D: return st.tex[st.active] || null;
        default: throw new Error(`unmocked getParameter ${e}`);
      }
    },
    isEnabled: (e) => !!st.caps[e],
    enable: (e) => { st.caps[e] = true; },
    disable: (e) => { st.caps[e] = false; },
    blendFunc: (s, d) => { st.src = [s, s]; st.dst = [d, d]; },
    blendFuncSeparate: (sr, dr, sa, da) => { st.src = [sr, sa]; st.dst = [dr, da]; },
    blendEquation: (m) => { st.eq = [m, m]; },
    blendEquationSeparate: (r, a) => { st.eq = [r, a]; },
    colorMask: (r, g, b, a) => { st.colorMask = [!!r, !!g, !!b, !!a]; },
    depthMask: (f) => { st.depthMask = !!f; },
    activeTexture: (u) => { st.active = u; },
    bindTexture: (t, x) => { st.tex[st.active] = x; },
    bindBuffer: (t, b) => { if (t === E.ARRAY_BUFFER) st.ab = b; else st.eab = b; },
    bindFramebuffer: (t, f) => { st.fbo = f; },
    useProgram: (p) => { st.prog = p; },
    viewport: (x, y, w, h) => { st.viewport = [x, y, w, h]; },
    bindVertexArray: (v) => { st.vao = v; },
  };
  return { gl, st, reads };
}

// Replica of MapLibre 5.24 src/webgl/value.ts (the four values the capture reads) and the Context bits drawCustom uses.
function makeMapLibreContext(gl) {
  const value = (dflt, apply, eq) => ({
    current: dflt, dirty: false,
    set(v) { if (eq(v, this.current) && !this.dirty) return; apply(v); this.current = v; this.dirty = false; },
  });
  const ctx = {
    gl,
    blendFunc: value([gl.ONE, gl.ZERO], (v) => gl.blendFunc(v[0], v[1]), (a, b) => a[0] === b[0] && a[1] === b[1]),
    blendEquation: value(gl.FUNC_ADD, (v) => gl.blendEquation(v), (a, b) => a === b),
    colorMask: value([true, true, true, true], (v) => gl.colorMask(v[0], v[1], v[2], v[3]),
      (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]),
    depthMask: value(true, (v) => gl.depthMask(v), (a, b) => a === b),
    setDirty() { this.blendFunc.dirty = true; this.blendEquation.dirty = true; this.colorMask.dirty = true; this.depthMask.dirty = true; },
  };
  // MapLibre's constructor-time state: the defaults applied to a fresh context.
  gl.blendFunc(gl.ONE, gl.ZERO); gl.blendEquation(gl.FUNC_ADD); gl.colorMask(true, true, true, true); gl.depthMask(true);
  return ctx;
}

// drawCustom's translucent pass up to implementation.render (setColorMode(alphaBlended) + setDepthMode(ReadOnly)), with
// setBaseState's blendEquation from the previous custom layer.
function translucentPassSetup(ctx, gl, { blendFunction = [gl.ONE, gl.ONE_MINUS_SRC_ALPHA], mask = [true, true, true, true], depthMask = false } = {}) {
  ctx.blendEquation.set(gl.FUNC_ADD);
  gl.enable(gl.BLEND);
  ctx.blendFunc.set(blendFunction);
  ctx.colorMask.set(mask);
  ctx.depthMask.set(depthMask);
}

function shadowReadCount(reads) { return reads.filter((e) => SHADOWED_ENUMS.includes(e)).length; }

afterEach(() => {
  delete window.__RAW_DISABLE_GL_STATE_SHADOW__;
  delete window.__RAW_GL_SHADOW_AUDIT__;
  if (window.__RAW_GPU__) delete window.__RAW_GPU__.glShadowAudit;
});

describe('captureWebGLState with MapLibre\'s state shadow', () => {
  it('AGREEMENT: after the translucent-pass setup the shadow capture equals the driver capture, with no shadowed getParameter', () => {
    const { gl, reads } = makeDriverGL();
    const ctx = makeMapLibreContext(gl);
    translucentPassSetup(ctx, gl);
    const fromDriver = captureWebGLState(gl);
    reads.length = 0;
    const fromShadow = captureWebGLState(gl, ctx);
    expect(fromShadow).toEqual(fromDriver);
    expect(shadowReadCount(reads)).toBe(0);
  });

  it('AGREEMENT over 400 random frames: MapLibre sets, custom layers writing raw GL then setDirty, partial re-sets', () => {
    let seed = 20261019;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    const FACTORS = [E.ZERO, E.ONE, E.SRC_ALPHA, E.ONE_MINUS_SRC_ALPHA, E.DST_ALPHA, E.SRC_COLOR];
    const EQS = [E.FUNC_ADD, E.FUNC_SUBTRACT, E.FUNC_REVERSE_SUBTRACT];
    const { gl, reads } = makeDriverGL();
    const ctx = makeMapLibreContext(gl);
    let shadowedFrames = 0;
    for (let f = 0; f < 400; f++) {
      // Some of MapLibre's own setters (any subset, any values).
      if (rnd() < 0.7) ctx.blendFunc.set([pick(FACTORS), pick(FACTORS)]);
      if (rnd() < 0.7) ctx.blendEquation.set(pick(EQS));
      if (rnd() < 0.7) ctx.colorMask.set([rnd() < 0.8, rnd() < 0.8, rnd() < 0.8, rnd() < 0.8]);
      if (rnd() < 0.7) ctx.depthMask.set(rnd() < 0.5);
      // Our capture (an engine render), then the engine scribbles and restores, as the engines do.
      const fromDriver = captureWebGLState(gl);
      reads.length = 0;
      const fromShadow = captureWebGLState(gl, ctx);
      expect(fromShadow).toEqual(fromDriver);
      if (shadowReadCount(reads) < SHADOWED_ENUMS.length) shadowedFrames++;
      gl.blendFuncSeparate(pick(FACTORS), pick(FACTORS), pick(FACTORS), pick(FACTORS));
      gl.blendEquationSeparate(pick(EQS), pick(EQS));
      gl.colorMask(rnd() < 0.5, true, rnd() < 0.5, true);
      gl.depthMask(rnd() < 0.5);
      restoreWebGLState(gl, fromShadow);
      // Another custom layer (or anything else) writes raw GL and MapLibre marks its shadow dirty, as drawCustom does.
      if (rnd() < 0.3) {
        gl.blendFuncSeparate(pick(FACTORS), pick(FACTORS), pick(FACTORS), pick(FACTORS));
        gl.blendEquationSeparate(pick(EQS), pick(EQS));
        gl.colorMask(rnd() < 0.5, rnd() < 0.5, true, true);
        gl.depthMask(rnd() < 0.5);
        ctx.setDirty();
      }
    }
    expect(shadowedFrames).toBeGreaterThan(200);   // the shadow path was actually exercised, not just the fallback
  });

  it('a DIRTY value is read from the driver (a custom layer ran since MapLibre last set it)', () => {
    const { gl, reads } = makeDriverGL();
    const ctx = makeMapLibreContext(gl);
    translucentPassSetup(ctx, gl);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);   // raw write MapLibre does not know about
    gl.colorMask(false, true, true, true);
    ctx.setDirty();
    const fromDriver = captureWebGLState(gl);
    reads.length = 0;
    const s = captureWebGLState(gl, ctx);
    expect(s).toEqual(fromDriver);
    expect(s.prevBlendSrcRGB).toBe(gl.SRC_ALPHA);
    expect(s.prevBlendSrcAlpha).toBe(gl.ZERO);
    expect(s.prevColorMask).toEqual([false, true, true, true]);
    expect(shadowReadCount(reads)).toBe(SHADOWED_ENUMS.length);
  });

  it('KILL SWITCH: window.__RAW_DISABLE_GL_STATE_SHADOW__ = true reads every value from the driver', () => {
    const { gl, reads } = makeDriverGL();
    const ctx = makeMapLibreContext(gl);
    translucentPassSetup(ctx, gl);
    window.__RAW_DISABLE_GL_STATE_SHADOW__ = true;
    reads.length = 0;
    captureWebGLState(gl, ctx);
    expect(shadowReadCount(reads)).toBe(SHADOWED_ENUMS.length);
  });

  it('a context for ANOTHER gl, or none, falls back to the driver', () => {
    const { gl, reads } = makeDriverGL();
    const other = makeDriverGL().gl;
    const ctx = makeMapLibreContext(other);
    captureWebGLState(gl, ctx);
    expect(shadowReadCount(reads)).toBe(SHADOWED_ENUMS.length);
    reads.length = 0;
    captureWebGLState(gl, null);
    expect(shadowReadCount(reads)).toBe(SHADOWED_ENUMS.length);
    expect(readShadowedState(gl, undefined)).toEqual({ blendFunc: undefined, blendEquation: undefined, colorMask: undefined, depthMask: undefined });
  });

  it('a four-entry blendFunc shadow (a future MapLibre with blendFuncSeparate) is taken entry for entry', () => {
    const { gl } = makeDriverGL();
    const ctx = makeMapLibreContext(gl);
    ctx.blendFunc.current = [gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE];
    expect(readShadowedState(gl, ctx).blendFunc).toEqual([gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE]);
    ctx.blendFunc.current = [gl.ONE];   // a shape we do not know: fall back
    expect(readShadowedState(gl, ctx).blendFunc).toBeUndefined();
  });

  it('the capture never aliases the shadow\'s colorMask array (MapLibre may reuse it)', () => {
    const { gl } = makeDriverGL();
    const ctx = makeMapLibreContext(gl);
    translucentPassSetup(ctx, gl);
    const s = captureWebGLState(gl, ctx);
    expect(s.prevColorMask).not.toBe(ctx.colorMask.current);
  });

  it('AUDIT: window.__RAW_GL_SHADOW_AUDIT__ counts agreement against the driver and records a mismatch', () => {
    const { gl } = makeDriverGL();
    const ctx = makeMapLibreContext(gl);
    translucentPassSetup(ctx, gl);
    window.__RAW_GL_SHADOW_AUDIT__ = true;
    captureWebGLState(gl, ctx);
    let a = window.__RAW_GPU__.glShadowAudit;
    expect(a).toMatchObject({ captures: 1, shadowed: 1, checks: 4, mismatches: 0 });
    gl.depthMask(true);   // a raw write that does NOT mark the shadow dirty: exactly the bug the audit exists to catch
    captureWebGLState(gl, ctx);
    a = window.__RAW_GPU__.glShadowAudit;
    expect(a.mismatches).toBe(1);
    expect(a.lastMismatch).toEqual({ value: 'depthMask', shadow: false, driver: true });
  });
});

describe('both engines capture with the map\'s context', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  it.each([
    ['WebGLMarineEngine.js', 'WebGLMarineCustomLayer.js'],
    ['WebGLWindEngine.js', 'WebGLWindLayer.js'],
  ])('%s passes this._mapGLContext and %s sets it from map.painter.context before render', (engineFile, layerFile) => {
    expect(read(engineFile)).toMatch(/captureWebGLState\(gl, this\._mapGLContext\)/);
    expect(read(engineFile)).not.toMatch(/captureWebGLState\(gl\)/);
    // Set in the same try block of render(), before the engine is asked to draw (the marine layer sets it above the
    // stale-hour dim, because its own pins keep `stampSkip(ENGINE_NO_DATA)` immediately before `engine.render(`).
    const src = read(layerFile);
    const set = src.indexOf('engine._mapGLContext = (map.painter && map.painter.context) || null;');
    const draw = src.indexOf('engine.render(_gl,', set);
    expect(set).toBeGreaterThan(-1);
    expect(draw).toBeGreaterThan(set);
    expect(src.slice(set, draw)).not.toMatch(/\}\s*catch\s*\(/);
  });
});
