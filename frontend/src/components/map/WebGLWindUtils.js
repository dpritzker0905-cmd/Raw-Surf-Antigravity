/**
 * WebGLWindUtils.js
 * standard WebGL utilities for the GPU Wind engine.
 */

export function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[WebGLWind] Shader error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createProgram(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[WebGLWind] Link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

export function createTexture(gl, filter, data, width, height) {
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  if (data instanceof Uint8Array) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else if (data == null) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  return tex;
}

export function unbindTexture(gl, tex) {
  if (!tex) return;
  if (gl.__boundTextures2D) {
    for (let u = 0; u < 4; u++) {
      if (gl.__boundTextures2D[u] === tex) {
        bindTexture(gl, null, u);
      }
    }
    return;
  }
  var prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
  var maxUnits = Math.min(16, gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || 8);
  for (var u = 0; u < maxUnits; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    if (gl.getParameter(gl.TEXTURE_BINDING_2D) === tex) {
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }
  gl.activeTexture(prevActive);
}

export function logStepDetails(gl, stepName) {
  var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  var currentFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  var activeTex = gl.getParameter(gl.ACTIVE_TEXTURE);
  var bindings = [];
  for (var u = 0; u < 4; u++) {
    gl.activeTexture(gl.TEXTURE0 + u);
    bindings.push(gl.getParameter(gl.TEXTURE_BINDING_2D));
  }
  gl.activeTexture(activeTex);
  console.log("[WebGLWindEngine-DIAGNOSTIC] " + stepName + ": status=" + status + ", currentFBO=" + (currentFBO ? "yes" : "null") + ", textures=", bindings);
}

export function createFBO(gl, filter, width, height) {
  const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const tex = createTexture(gl, filter, null, width, height);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  return { tex, fbo };
}

export function bindTexture(gl, tex, unit) {
  const targetUnit = gl.TEXTURE0 + unit;
  if (gl.__boundTextures2D) {
    if (gl.__activeTextureUnit !== targetUnit) {
      gl.activeTexture(targetUnit);
      gl.__activeTextureUnit = targetUnit;
    }
    if (gl.__boundTextures2D[unit] !== tex) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.__boundTextures2D[unit] = tex;
    }
    return;
  }
  gl.activeTexture(targetUnit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

export function encodeWindTexture(gl, windGrid) {
  const { vectors, cols, rows, bounds } = windGrid;
  if (!vectors?.length || !cols || !rows) return null;

  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;
  let maxSpeed = 0;

  for (const v of vectors) {
    if (v.u < minU) minU = v.u;
    if (v.u > maxU) maxU = v.u;
    if (v.v < minV) minV = v.v;
    if (v.v > maxV) maxV = v.v;
    if (v.speed > maxSpeed) maxSpeed = v.speed;
  }

  if (maxU === minU) { maxU = minU + 1; }
  if (maxV === minV) { maxV = minV + 1; }
  // Sane floor: avoid division by zero; sane ceiling: keep storm values visible
  const effectiveMaxSpeed = Math.max(5, Math.min(maxSpeed, 120));

  const data = new Uint8Array(cols * rows * 4);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const nu = (v.u - minU) / (maxU - minU);
    const nv = (v.v - minV) / (maxV - minV);
    const speed = Math.min(1.0, v.speed / effectiveMaxSpeed);
    data[i * 4 + 0] = Math.floor(nu * 255);
    data[i * 4 + 1] = Math.floor(nv * 255);
    data[i * 4 + 2] = Math.floor(speed * 255);
    data[i * 4 + 3] = 255;
  }

  const tex = createTexture(gl, gl.LINEAR, data, cols, rows);
  const crosses = bounds ? bounds.west > bounds.east : false;
  const lngSpan = bounds ? (crosses ? (bounds.east + 360.0) - bounds.west : bounds.east - bounds.west) : 0;
  const isGlobal = bounds && ((lngSpan >= 350.0) || windGrid?.coverage_scope === 'global' || windGrid?.coverage_scope === 'global_coarse');

  // ── EURO antimeridian-seam diagnostic (default ON; opt out window.__WIND_SEAM_DIAG__ = false) ──
  // The Pacific seam (~180°E, east of NZ) appears when the longitude-wrap REPEAT is NOT applied
  // (isGlobal false → CLAMP edge) OR when it IS applied but the grid is non-periodic at 180° (the
  // first and last columns differ / the ±180 column is duplicated → REPEAT mis-aligns). Capture the
  // exact inputs so we can tell which, per model, on a visible tab. Cheap (one pass over ~300 vecs).
  try {
    if (typeof window !== 'undefined' && window.__WIND_SEAM_DIAG__ !== false) {
      let fSpd = 0, fN = 0, lSpd = 0, lN = 0;
      for (let i = 0; i < vectors.length; i++) {
        const col = i % cols;
        if (col === 0) { fSpd += vectors[i].speed || 0; fN++; }
        else if (col === cols - 1) { lSpd += vectors[i].speed || 0; lN++; }
      }
      const model = (windGrid && (windGrid.model || windGrid.__sourceModel || windGrid.source))
        || (window.activeModel || window.__ACTIVE_MODEL__ || 'unknown');
      const diag = {
        model,
        cols, rows,
        bounds,
        lngSpan: Math.round(lngSpan * 10) / 10,
        coverage_scope: windGrid?.coverage_scope || null,
        isGlobal: !!isGlobal,
        wrapApplied: !!isGlobal, // REPEAT is only set below when isGlobal
        firstColMeanSpeed: fN ? +(fSpd / fN).toFixed(3) : null,
        lastColMeanSpeed: lN ? +(lSpd / lN).toFixed(3) : null,
        // endpoints inclusive (e.g. west=-180 AND east=180) ⇒ the ±180 column is likely DUPLICATED,
        // which breaks REPEAT periodicity even when isGlobal is true.
        endpointsInclusive180: !!(bounds && Math.abs(Math.abs(bounds.east - bounds.west) - 360) < 0.6),
        ts: Date.now(),
      };
      window.__WIND_SEAM_DIAG__ = diag;
      window.__WIND_SEAM_DIAG_BY_MODEL__ = window.__WIND_SEAM_DIAG_BY_MODEL__ || {};
      window.__WIND_SEAM_DIAG_BY_MODEL__[model] = diag;
    }
  } catch (e) { /* diagnostic must never break rendering */ }

  if (isGlobal) {
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
  }
  return {
    texture: tex,
    uMin: [minU, minV],
    uMax: [maxU, maxV],
    maxSpeed: effectiveMaxSpeed,
    bounds
  };
}

export function initParticleTexture(gl, resolution) {
  const numParticles = resolution * resolution;
  const data = new Uint8Array(numParticles * 4);
  for (let i = 0; i < numParticles; i++) {
    const x = Math.random();
    const y = Math.random();
    const xHi = Math.floor(x * 255);
    const xLo = Math.floor(((x * 255) - xHi) * 255);
    const yHi = Math.floor(y * 255);
    const yLo = Math.floor(((y * 255) - yHi) * 255);
    data[i * 4 + 0] = xHi;
    data[i * 4 + 1] = xLo;
    data[i * 4 + 2] = yHi;
    data[i * 4 + 3] = yLo;
  }
  return createTexture(gl, gl.NEAREST, data, resolution, resolution);
}

export function safeDeleteTexture(gl, tex, engine) {
  if (!tex || !gl) return;
  if (engine) {
    if (tex === engine.particleStateA || tex === engine.particleStateB) {
      console.warn('[WebGLState] Safeguarded particle state texture from accidental deletion!');
      return;
    }
  }
  gl.deleteTexture(tex);
}
