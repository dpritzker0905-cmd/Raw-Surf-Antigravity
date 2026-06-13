/**
 * WebGLStateIsolation.js
 * High-fidelity WebGL State Isolation Protocol helper.
 * Captures and restores WebGL context state to prevent state pollution
 * between custom render overlays and MapLibre/Mapbox GL engines.
 */

export function captureWebGLState(gl) {
  if (!gl || gl.isContextLost()) return null;

  const state = {};

  state.prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
  state.prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  state.prevBlend = gl.getParameter(gl.BLEND);
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

  state.prevDepthTest = gl.getParameter(gl.DEPTH_TEST);
  state.prevDepthWriteMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  state.prevStencilTest = gl.getParameter(gl.STENCIL_TEST);
  state.prevScissorTest = gl.getParameter(gl.SCISSOR_TEST);
  state.prevColorMask = gl.getParameter(gl.COLOR_WRITEMASK);
  
  // Cull face parameter is used in Marine Engine
  state.prevCullFace = gl.getParameter(gl.CULL_FACE);
  
  // Clear color
  state.prevClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);

  // Attributes enabled state
  state.prevAttribsEnabled = [];
  const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 16;
  for (let i = 0; i < maxAttribs; i++) {
    try {
      const enabled = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED);
      state.prevAttribsEnabled.push(enabled);
    } catch (e) {
      state.prevAttribsEnabled.push(false);
    }
  }

  // WebGL2 Vertex Array Object state
  const isWebGL2 = !!gl.bindVertexArray;
  state.isWebGL2 = isWebGL2;
  if (isWebGL2) {
    try {
      state.prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    } catch (e) {
      state.prevVAO = null;
    }
  }

  // Textures and samplers state
  state.prevTextures2D = [];
  state.prevTexturesCube = [];
  state.prevSamplers = [];
  const maxUnits = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || 8;
  for (let u = 0; u < maxUnits; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    state.prevTextures2D.push(gl.getParameter(gl.TEXTURE_BINDING_2D));
    try {
      state.prevTexturesCube.push(gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP));
    } catch (e) {
      state.prevTexturesCube.push(null);
    }
    if (isWebGL2) {
      try {
        state.prevSamplers.push(gl.getParameter(gl.SAMPLER_BINDING));
      } catch (e) {
        state.prevSamplers.push(null);
      }
    }
  }

  // Restore the originally active texture unit so we don't pollute the capture phase
  gl.activeTexture(state.prevActiveTex);

  return state;
}

export function restoreWebGLState(gl, state) {
  if (!gl || gl.isContextLost() || !state) return;

  // Restore vertex buffer binding and element array buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, state.prevArrayBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.prevElementArrayBuffer);

  // Restore WebGL2 Vertex Array Object
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

  // Restore Textures and Samplers
  const maxUnits = Math.min(state.prevTextures2D.length, gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || 8);
  for (let u = 0; u < maxUnits; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    gl.bindTexture(gl.TEXTURE_2D, state.prevTextures2D[u]);
    if (state.prevTexturesCube[u]) {
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, state.prevTexturesCube[u]);
    }
    if (state.isWebGL2 && state.prevSamplers[u] !== undefined) {
      try {
        gl.bindSampler(u, state.prevSamplers[u]);
      } catch (e) {}
    }
  }

  // Restore attributes state
  for (let i = 0; i < state.prevAttribsEnabled.length; i++) {
    try {
      if (state.prevAttribsEnabled[i]) {
        gl.enableVertexAttribArray(i);
      } else {
        gl.disableVertexAttribArray(i);
      }
    } catch (e) {}
  }

  // Restore active texture unit
  gl.activeTexture(state.prevActiveTex);

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

  // Restore clear color
  if (state.prevClearColor) {
    gl.clearColor(state.prevClearColor[0], state.prevClearColor[1], state.prevClearColor[2], state.prevClearColor[3]);
  }
}
