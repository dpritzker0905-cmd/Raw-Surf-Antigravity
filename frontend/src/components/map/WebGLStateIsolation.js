/**
 * WebGLStateIsolation.js
 * High-fidelity WebGL State Isolation Protocol helper.
 * Captures and restores WebGL context state to prevent state pollution
 * between custom render overlays and MapLibre/Mapbox GL engines.
 */

export function captureWebGLState(gl) {
  if (!gl || gl.isContextLost()) return null;

  const state = {};

  // ⛔ BOOLEAN CAPS USE `isEnabled`, NOT `getParameter`. Measured 2026-08-12 against the live
  // MapLibre context on deploy `286a4e6b` (GATE6_getParameter_microbench.js, median of 3
  // randomised-order passes, agreement control confirming identical return values):
  //     BLEND        getParameter 75.05us  vs  isEnabled 0.10us    750x
  //     SCISSOR_TEST getParameter 68.85us  vs  isEnabled 0.05us   1377x
  //     CULL_FACE    getParameter 65.00us  vs  isEnabled 0.05us   1300x
  // Same answer, three orders of magnitude apart. This function runs once per render PER ENGINE and
  // there are two engines, so at 60 fps these three reads alone cost ~25 ms/s.
  // ★ The cost is per-ENUM, not per-position — SCISSOR_TEST measured 60.9us even when read FIRST,
  //   while DEPTH_TEST held 0.1us at positions 7, 8 and 12. That control is why this is a fix and
  //   not a superstition.
  // Pinned by WebGLStateIsolation.capReads.test.js, which asserts the cheap CALL is the one taken —
  // a behavioural test cannot see this, because both calls return the same value.
  state.prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
  state.prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  state.prevBlend = gl.isEnabled(gl.BLEND);
  state.prevActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE);
  state.prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  state.prevElementArrayBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
  state.prevViewport = gl.getParameter(gl.VIEWPORT);

  state.prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB);
  state.prevBlendDstRGB = gl.getParameter(gl.BLEND_DST_RGB);
  state.prevBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
  state.prevBlendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
  state.prevBlendEqRGB = gl.getParameter(gl.BLEND_EQUATION_RGB);
  state.prevBlendEqAlpha = gl.getParameter(gl.BLEND_EQUATION_ALPHA);

  state.prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  // ⚠️ DEPTH_WRITEMASK and COLOR_WRITEMASK have NO isEnabled equivalent — they are values, not
  // capabilities — so they stay on the expensive path (64.2us and 66.9us). Together with the six
  // BLEND_* value reads that is ~499us per capture still unaddressed. The measured fix for those is
  // MapLibre's own state shadow (`map.painter.context.{colorMask,depthMask,blendFunc,blendEquation}
  // .current`), which was probed on the live context and matched the driver exactly on every one.
  // It needs the map context plumbed into both engines' render paths, so it is deliberately NOT in
  // this change — see GATE6_getParameter_microbench.js.
  state.prevDepthWriteMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  state.prevStencilTest = gl.isEnabled(gl.STENCIL_TEST);
  state.prevScissorTest = gl.isEnabled(gl.SCISSOR_TEST);
  state.prevColorMask = gl.getParameter(gl.COLOR_WRITEMASK);

  // Cull face parameter is used in Marine Engine
  state.prevCullFace = gl.isEnabled(gl.CULL_FACE);
  
  const isWebGL2 = !!gl.bindVertexArray;
  state.isWebGL2 = isWebGL2;

  if (isWebGL2) {
    try {
      state.prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    } catch (e) {
      state.prevVAO = null;
    }
  }

  // Textures state: capture 2D units 0-6 — the marine pass binds 4 (overlay mask), 5 and 6
  // (ring-fill base wave/ocean textures), so the old 0-3 capture left marine textures bound
  // into MapLibre's frame after every pass (R11-10e, 2026-08-09; the "only 0-3" comment had
  // gone stale against the engine's actual footprint).
  state.prevTextures2D = [];
  const maxUnits = 7;
  for (let u = 0; u < maxUnits; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    state.prevTextures2D.push(gl.getParameter(gl.TEXTURE_BINDING_2D));
  }

  // Restore the originally active texture unit so we don't pollute the capture phase
  gl.activeTexture(state.prevActiveTex);

  gl.__activeTextureUnit = state.prevActiveTex;
  gl.__boundTextures2D = [...state.prevTextures2D];

  return state;
}

export function restoreWebGLState(gl, state) {
  if (!gl || gl.isContextLost() || !state) return;

  // Restore vertex buffer binding and element array buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, state.prevArrayBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.prevElementArrayBuffer);

  // Restore WebGL2 Vertex Array Object (restores all attribute pointers and enabled states)
  if (state.isWebGL2 && state.prevVAO !== undefined) {
    try {
      gl.bindVertexArray(state.prevVAO);
    } catch (e) {}
  }

  // Restore Framebuffer, Program, Viewport
  gl.bindFramebuffer(gl.FRAMEBUFFER, state.prevFBO);
  gl.useProgram(state.prevProg);
  if (state.prevViewport) {
    gl.viewport(state.prevViewport[0], state.prevViewport[1], state.prevViewport[2], state.prevViewport[3]);
  }

  // Restore Textures (2D units 0-6 — must mirror the capture range above; R11-10e)
  const maxUnits = Math.min(state.prevTextures2D.length, 7);
  for (let u = 0; u < maxUnits; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    gl.bindTexture(gl.TEXTURE_2D, state.prevTextures2D[u]);
  }

  // Restore active texture unit
  gl.activeTexture(state.prevActiveTex);

  delete gl.__activeTextureUnit;
  delete gl.__boundTextures2D;

  // Restore blending state and equation
  if (state.prevBlend) {
    gl.enable(gl.BLEND);
  } else {
    gl.disable(gl.BLEND);
  }
  gl.blendFuncSeparate(state.prevBlendSrcRGB, state.prevBlendDstRGB, state.prevBlendSrcAlpha, state.prevBlendDstAlpha);
  gl.blendEquationSeparate(state.prevBlendEqRGB, state.prevBlendEqAlpha);

  // Restore depth test state and write mask
  if (state.prevDepthTest) {
    gl.enable(gl.DEPTH_TEST);
  } else {
    gl.disable(gl.DEPTH_TEST);
  }
  gl.depthMask(state.prevDepthWriteMask);

  // Restore stencil, scissor, color mask
  if (state.prevStencilTest) {
    gl.enable(gl.STENCIL_TEST);
  } else {
    gl.disable(gl.STENCIL_TEST);
  }
  if (state.prevScissorTest) {
    gl.enable(gl.SCISSOR_TEST);
  } else {
    gl.disable(gl.SCISSOR_TEST);
  }
  gl.colorMask(state.prevColorMask[0], state.prevColorMask[1], state.prevColorMask[2], state.prevColorMask[3]);

  // Restore cull face state (used in Marine Engine)
  if (state.prevCullFace !== undefined) {
    if (state.prevCullFace) {
      gl.enable(gl.CULL_FACE);
    } else {
      gl.disable(gl.CULL_FACE);
    }
  }
}

