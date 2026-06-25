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

// Copy the WEST edge column (lng -180) onto the EAST edge column (lng +180) of a GLOBAL wind texture
// when the EAST column is dead while the WEST one carries wind — repairs the EURO antimeridian seam
// (lng -180 ≡ lng +180 = same meridian; GFS already has them equal, EURO ships a near-zero +180
// column → a hard vertical line east of NZ). Pure + in-place on the RGBA byte array. Returns true if
// it repaired. No-op (false) for non-global / single-column / already-healthy grids. Truth-safe
// (periodic identity) and a strict no-op for GFS, so it cannot regress the GFS Pacific-seam wrap fix.
export function repairGlobalWindSeamInPlace(data, cols, rows, isGlobal, firstColMeanSpeed, lastColMeanSpeed) {
  if (!isGlobal || !data || cols < 2 || rows < 1) return false;
  if (!(firstColMeanSpeed > 0.5 && lastColMeanSpeed < 0.25 * firstColMeanSpeed)) return false;
  for (let r = 0; r < rows; r++) {
    const src = (r * cols + 0) * 4;
    const dst = (r * cols + (cols - 1)) * 4;
    data[dst] = data[src];
    data[dst + 1] = data[src + 1];
    data[dst + 2] = data[src + 2];
    data[dst + 3] = data[src + 3];
  }
  return true;
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

  const crosses = bounds ? bounds.west > bounds.east : false;
  const lngSpan = bounds ? (crosses ? (bounds.east + 360.0) - bounds.west : bounds.east - bounds.west) : 0;
  const isGlobal = bounds && ((lngSpan >= 350.0) || windGrid?.coverage_scope === 'global' || windGrid?.coverage_scope === 'global_coarse');

  // WEST (lng -180) vs EAST (lng +180) edge-column mean speed. For a global grid these are the SAME
  // meridian and should match (GFS does); EURO's +180 column is dead → the Pacific seam east of NZ.
  let fSpd = 0, fN = 0, lSpd = 0, lN = 0;
  for (let i = 0; i < vectors.length; i++) {
    const col = i % cols;
    if (col === 0) { fSpd += vectors[i].speed || 0; fN++; }
    else if (col === cols - 1) { lSpd += vectors[i].speed || 0; lN++; }
  }
  const firstColMeanSpeed = fN ? fSpd / fN : 0;
  const lastColMeanSpeed = lN ? lSpd / lN : 0;

  // Repair the seam on the byte array BEFORE the texture is created (copy -180 column → +180 column).
  const seamRepaired = repairGlobalWindSeamInPlace(data, cols, rows, !!isGlobal, firstColMeanSpeed, lastColMeanSpeed);
  if (seamRepaired && typeof window !== 'undefined') window.__WIND_SEAM_REPAIRED__ = (window.__WIND_SEAM_REPAIRED__ || 0) + 1;

  const tex = createTexture(gl, gl.LINEAR, data, cols, rows);

  // ── EURO antimeridian-seam diagnostic (default ON; opt out window.__WIND_SEAM_DIAG__ = false) ──
  try {
    if (typeof window !== 'undefined' && window.__WIND_SEAM_DIAG__ !== false) {
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
        firstColMeanSpeed: fN ? +firstColMeanSpeed.toFixed(3) : null,
        lastColMeanSpeed: lN ? +lastColMeanSpeed.toFixed(3) : null,
        seamRepaired: !!seamRepaired,
        // endpoints inclusive (west=-180 AND east=180) ⇒ the ±180 column is duplicated (same meridian).
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
