import { captureWebGLState, restoreWebGLState } from './WebGLStateIsolation';

/**
 * BOOLEAN CAPABILITY READS MUST USE `gl.isEnabled`, NOT `gl.getParameter`.
 *
 * Measured 2026-08-12 against the live MapLibre context on deploy `286a4e6b`
 * (GATE6_getParameter_microbench.js, median of 3 randomised-order passes):
 *
 *     BLEND          getParameter 75.05us   isEnabled 0.10us    750x
 *     SCISSOR_TEST   getParameter 68.85us   isEnabled 0.05us   1377x
 *     CULL_FACE      getParameter 65.00us   isEnabled 0.05us   1300x
 *
 * Same value, three orders of magnitude apart — an agreement control confirmed all five caps return
 * identical results from both calls. `captureWebGLState` runs once per render PER ENGINE and there
 * are two engines, so at 60 fps these three reads alone cost ~25 ms/s.
 *
 * ★ The expensive set is per-ENUM, not per-position: verified by measuring each enum in three
 *   randomised orders. SCISSOR_TEST cost 60.9us even when measured FIRST; DEPTH_TEST stayed at
 *   0.1us at positions 7, 8 and 12.
 *
 * These tests pin the CALL (that the cheap path is the one taken) and the BEHAVIOUR (that capture →
 * restore still round-trips), because swapping the read would be invisible to a behavioural test
 * alone — both calls return the same thing, which is the entire point.
 */

const CAPS = ['BLEND', 'SCISSOR_TEST', 'CULL_FACE', 'DEPTH_TEST', 'STENCIL_TEST'];

function makeGL(enabled = {}) {
  const getParameterEnums = [];
  const isEnabledEnums = [];
  const E = {};
  let n = 100;
  for (const k of ['CURRENT_PROGRAM', 'FRAMEBUFFER_BINDING', 'BLEND', 'ACTIVE_TEXTURE',
    'ARRAY_BUFFER_BINDING', 'ELEMENT_ARRAY_BUFFER_BINDING', 'VIEWPORT', 'BLEND_SRC_RGB',
    'BLEND_DST_RGB', 'BLEND_SRC_ALPHA', 'BLEND_DST_ALPHA', 'BLEND_EQUATION_RGB',
    'BLEND_EQUATION_ALPHA', 'DEPTH_TEST', 'DEPTH_WRITEMASK', 'STENCIL_TEST', 'SCISSOR_TEST',
    'COLOR_WRITEMASK', 'CULL_FACE', 'VERTEX_ARRAY_BINDING', 'TEXTURE_BINDING_2D', 'TEXTURE0',
    'FRAMEBUFFER', 'ARRAY_BUFFER', 'ELEMENT_ARRAY_BUFFER', 'TEXTURE_2D']) E[k] = k === 'TEXTURE0' ? 33984 : ++n;

  const gl = {
    ...E,
    isContextLost: () => false,
    bindVertexArray: () => {},
    getParameter: (e) => {
      getParameterEnums.push(e);
      if (e === E.VIEWPORT) return [0, 0, 800, 600];
      if (e === E.COLOR_WRITEMASK) return [true, true, true, true];
      if (e === E.ACTIVE_TEXTURE) return 33984;
      if (e === E.TEXTURE_BINDING_2D) return { __tex: 'bound' };
      if (e === E.DEPTH_WRITEMASK) return true;
      return { __obj: e };
    },
    isEnabled: (e) => { isEnabledEnums.push(e); return !!enabled[e]; },
    activeTexture: () => {},
    bindBuffer: () => {}, bindFramebuffer: () => {}, useProgram: () => {}, viewport: () => {},
    bindTexture: () => {}, enable: () => {}, disable: () => {},
    blendFuncSeparate: () => {}, blendEquationSeparate: () => {}, depthMask: () => {}, colorMask: () => {}
  };
  return { gl, E, getParameterEnums, isEnabledEnums };
}

describe('captureWebGLState — boolean caps read via isEnabled', () => {
  it('REGRESSION: the five boolean caps are read with isEnabled', () => {
    const h = makeGL();
    captureWebGLState(h.gl);
    for (const cap of CAPS) {
      expect(h.isEnabledEnums).toContain(h.E[cap]);
    }
  });

  it('REGRESSION: those caps are NOT read with getParameter (the 750-1377x path)', () => {
    const h = makeGL();
    captureWebGLState(h.gl);
    for (const cap of CAPS) {
      expect(h.getParameterEnums).not.toContain(h.E[cap]);
    }
  });

  it('the values captured are the enabled states, both ways round', () => {
    const on = makeGL({ BLEND: 1, CULL_FACE: 1 });
    // enabled is keyed by the numeric enum, so build it from the map
    const h = makeGL();
    const enabled = {}; enabled[h.E.BLEND] = true; enabled[h.E.SCISSOR_TEST] = true;
    const h2 = makeGL(enabled);
    const s = captureWebGLState(h2.gl);
    expect(s.prevBlend).toBe(true);
    expect(s.prevScissorTest).toBe(true);
    expect(s.prevCullFace).toBe(false);
    expect(s.prevDepthTest).toBe(false);
    expect(on).toBeTruthy();
  });

  it('capture -> restore round-trips without throwing, and restores every cap', () => {
    const h = makeGL();
    const enabled = {}; enabled[h.E.BLEND] = true; enabled[h.E.DEPTH_TEST] = true;
    const h2 = makeGL(enabled);
    const enables = []; const disables = [];
    h2.gl.enable = (e) => enables.push(e);
    h2.gl.disable = (e) => disables.push(e);
    const state = captureWebGLState(h2.gl);
    expect(() => restoreWebGLState(h2.gl, state)).not.toThrow();
    expect(enables).toContain(h2.E.BLEND);
    expect(enables).toContain(h2.E.DEPTH_TEST);
    expect(disables).toContain(h2.E.CULL_FACE);
    expect(disables).toContain(h2.E.SCISSOR_TEST);
    expect(disables).toContain(h2.E.STENCIL_TEST);
  });

  it('still returns null on a lost context (guard unchanged)', () => {
    const h = makeGL();
    h.gl.isContextLost = () => true;
    expect(captureWebGLState(h.gl)).toBeNull();
  });

  it('the EXPENSIVE non-cap reads are still made — this change scope is caps only', () => {
    const h = makeGL();
    captureWebGLState(h.gl);
    // No isEnabled equivalent exists for these; they still need the MapLibre-shadow fix.
    for (const e of ['COLOR_WRITEMASK', 'DEPTH_WRITEMASK', 'BLEND_SRC_RGB', 'BLEND_EQUATION_RGB']) {
      expect(h.getParameterEnums).toContain(h.E[e]);
    }
  });
});
