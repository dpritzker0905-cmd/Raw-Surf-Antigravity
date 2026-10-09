/**
 * WebGLWindUtils.js
 * standard WebGL utilities for the GPU Wind engine.
 */

export function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  let compiled = false;
  try {
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    compiled = !!gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (compiled) return shader;
    console.error('[WebGLWind] Shader error:', gl.getShaderInfoLog(shader));
  } finally {
    // Successful shaders remain owned by the initialization batch/program until disposal.
    if (!compiled) gl.deleteShader(shader);
  }
  return null;
}

export function createProgram(gl, vs, fs) {
  const prog = gl.createProgram();
  if (!prog) return null;
  let linked = false;
  try {
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    linked = !!gl.getProgramParameter(prog, gl.LINK_STATUS);
    if (linked) return prog;
    console.error('[WebGLWind] Link error:', gl.getProgramInfoLog(prog));
  } finally {
    if (!linked) gl.deleteProgram(prog);
  }
  return null;
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

/**
 * Dimensions of every texture this module's accounting knows about, so a DELETE can subtract
 * exactly what the matching CREATE added. A WeakMap rather than an expando keeps WebGLTexture
 * objects untouched and lets the entry disappear with the texture.
 */
const TEX_DIMS = new WeakMap();

/** Record a texture's size at creation. Called by whoever allocates; safe to call more than once. */
export function noteTextureCreated(tex, width, height) {
  if (!tex) return;
  TEX_DIMS.set(tex, { w: width || 0, h: height || 0 });
}

/**
 * MEASURED 2026-08-04, live on the map: `__RAW_GPU__.textureCount` rose **+2.63 per zoom gesture,
 * linearly, with no plateau** over 32 gestures (11 -> 95), and `gpuMemoryEstimate` with it
 * (+0.88 MB/gesture). That looked exactly like a GPU leak.
 *
 * ⭐⭐ IT WAS NOT A LEAK — IT WAS THE ACCOUNTING. This function deletes the GL object correctly, so
 * no memory is actually lost; it simply never decremented the counters, and there are **18 call
 * sites against 2 manual decrement sites**. The textures were freed and the telemetry never heard.
 *
 * ⛔ WHY THAT IS STILL WORTH FIXING, AND ARGUABLY WORSE THAN A SMALL LEAK: this is the telemetry the
 * OOM forensics read. Drifting upward forever, it cannot distinguish a healthy session from a real
 * leak — so the next genuine one is invisible. This file already carries a comment about the same
 * class ("every rebuild leaked +31.5MB into the estimate, poisoning the very telemetry the OOM
 * forensics rely on"), fixed once at ONE site in 2026-07-05. It recurred because the fix was applied
 * where the bug was, not where the invariant belongs.
 * ⇒ The accounting now lives in the ONE function every deletion passes through, which is the only
 *   arrangement that cannot drift again.
 */
export function safeDeleteTexture(gl, tex, engine) {
  if (!tex || !gl) return;
  if (engine) {
    if (tex === engine.particleStateA || tex === engine.particleStateB) {
      console.warn('[WebGLState] Safeguarded particle state texture from accidental deletion!');
      return;
    }
  }
  gl.deleteTexture(tex);
  // Account for it HERE, once, for every caller. Guarded so a texture this module never saw
  // created (or a double delete) cannot drive the counters negative — an under-count would hide a
  // real leak just as effectively as the over-count did.
  if (typeof window !== 'undefined' && window.__RAW_GPU__ && TEX_DIMS.has(tex)) {
    const { w, h } = TEX_DIMS.get(tex);
    TEX_DIMS.delete(tex);
    const g = window.__RAW_GPU__;
    if (typeof g.textureCount === 'number') g.textureCount = Math.max(0, g.textureCount - 1);
    if (typeof g.gpuMemoryEstimate === 'number') {
      g.gpuMemoryEstimate = Math.max(0, g.gpuMemoryEstimate - (w * h * 4));
    }
  }
}

// ── FRAME-TIME SCALING (audit 15.0, A15-18) ────────────────────────────────────────────────────
// The wind step, trail fade and particle respawn were applied once PER FRAME, so a 120 Hz screen
// ran the field twice as fast, with half-length trails, as a 60 Hz one. Each is now scaled by the
// elapsed time against a 60 Hz reference frame, so per-SECOND behaviour matches the tuned 60 Hz
// look on every display. Clamped so a hidden tab's long pause cannot fling particles on return.
export const REFERENCE_FRAME_MS = 1000 / 60;
export const FRAME_SCALE_MIN = 0.25;
export const FRAME_SCALE_MAX = 3.0;

/** Elapsed time since this engine's previous frame, in 60 Hz frames (1 on the first frame). */
export function frameTimeScale(engine, nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
  const last = engine._lastWindFrameAt;
  engine._lastWindFrameAt = nowMs;
  if (!Number.isFinite(last) || nowMs <= last) return 1;
  return Math.min(FRAME_SCALE_MAX, Math.max(FRAME_SCALE_MIN, (nowMs - last) / REFERENCE_FRAME_MS));
}

/** A per-frame multiplicative fade applied over `scale` reference frames. */
export function perFrameFade(fade, scale) {
  return Math.pow(fade, scale > 0 ? scale : 1);
}

// ── MOTION FLOOR (2026-10-08, the hurricane report) ────────────────────────────────────────────
// ADVECT_FS grows the respawn chance with speed in KNOTS (u_drop_rate + speed * u_drop_rate_bump),
// so at 47 kn a particle lived 2.6 frames (44 ms): too short to be seen moving, and its streak was
// no longer than a breeze's. The cap below bounds the per-60 Hz-frame drop chance to
// 1 / minLifeFrames. Default 6 frames (100 ms) engages above ~20.6 kn only. Full rationale:
// docs/architecture/RATIONALE-WebGLWindEngine.md §Motion floor; tests: windMotionFloor.test.js.
// Lever: window.__RAW_WIND_MIN_LIFE_FRAMES__ (2..60). Kill: __RAW_DISABLE_WIND_MOTION_FLOOR__.
export const MOTION_FLOOR_DEFAULT_FRAMES = 6;

/** The advect shader's drop-rate cap (u_drop_cap) for the given window-like lever bag. */
export function resolveWindMotionFloor(win = (typeof window !== 'undefined' ? window : null)) {
  const w = win || {};
  let minLifeFrames = MOTION_FLOOR_DEFAULT_FRAMES;
  const lever = w.__RAW_WIND_MIN_LIFE_FRAMES__;
  if (typeof lever === 'number' && Number.isFinite(lever)) minLifeFrames = Math.max(2, Math.min(60, lever));
  const dropCap = w.__RAW_DISABLE_WIND_MOTION_FLOOR__ === true ? 1 : 1 / minLifeFrames;
  return { minLifeFrames, dropCap };
}

// ── PARTICLES V2 (2026-10-08 wind zoom audit; windParticlesV2.test.js) ─────────────────────────
// CALIBRATION: density is decoupled from lifetime. Particles respawn only inside the padded viewport
// (and are recycled the moment they leave it), so the on-screen count is pool x screen/box area at
// every zoom; a deterministic draw cull then pins it to one screen density at every zoom. That frees the
// lifetime to follow perception research (~1-2 s, the leaders' range) instead of the 0.1-0.2 s the
// ink budget forced. Marks stretch along the flow by their own per-frame step (no beads), and the
// step uses the owner-approved z6 speed everywhere (the z5.78-6.0 clamp ran 16% fast; it is gone).
// THEME: a premultiplied-alpha trail buffer (dark marks were transparent under the brightness-alpha
// composite) + one neutral body colour per theme over the luminance-adaptive casing; near-opaque
// heads clear 3:1 against the field at every speed in all three themes (modelled in the test).
// Kill: __RAW_DISABLE_WIND_CALIBRATION_V2__ / __RAW_DISABLE_WIND_THEME_V2__. Levers: __RAW_WIND_V2_DENSITY__
// (heads per 100x100 css px), __RAW_WIND_V2_FADE__ (tail), __RAW_WIND_V2_SPEED__ (x nominal), __RAW_WIND_V2_LIFE_S__, __RAW_WIND_V2_OPACITY__.
// Rationale and measurements: docs/architecture/RATIONALE-WebGLWindEngine.md "Particles v2".
// densityPer100 + fade are calibrated TOGETHER for ink parity with the shipped look (GPU A/B, 2026-10-08): long-lived
// heads drag tails, so the shipped head count (~130) carpeted the field (95% coverage); 12 heads + fade 0.93 match it.
export const V2_DEFAULTS = Object.freeze({ densityPer100: 12, fade: 0.93, margin: 0.1, speedMul: 1.16, lifeS: 2.0, bumpAtMax: 0.01, composite: 0.95 });
export const V2_BODY = Object.freeze({ dark: [0.96, 0.98, 1.0], light: [0.05, 0.10, 0.22], beach: [0.08, 0.10, 0.20] });

export function resolveWindParticlesV2(win = (typeof window !== 'undefined' ? window : null)) {
  const w = win || {};
  const num = (k, lo, hi, d) => ((typeof w[k] === 'number' && Number.isFinite(w[k])) ? Math.max(lo, Math.min(hi, w[k])) : d);
  return {
    calib: w.__RAW_DISABLE_WIND_CALIBRATION_V2__ !== true,
    theme: w.__RAW_DISABLE_WIND_THEME_V2__ !== true,
    densityPer100: num('__RAW_WIND_V2_DENSITY__', 5, 1000, V2_DEFAULTS.densityPer100),
    speedMul: num('__RAW_WIND_V2_SPEED__', 0.25, 4, V2_DEFAULTS.speedMul),
    lifeS: num('__RAW_WIND_V2_LIFE_S__', 0.2, 10, V2_DEFAULTS.lifeS),
    composite: num('__RAW_WIND_V2_OPACITY__', 0.2, 1, V2_DEFAULTS.composite),
    fade: num('__RAW_WIND_V2_FADE__', 0.8, 0.995, V2_DEFAULTS.fade),
    margin: V2_DEFAULTS.margin,
  };
}

const mercYOf = (lat) => {
  const r = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

/** Padded viewport in GLOBAL Mercator units [x0, y0, x1, y1] (x may leave [0,1]; y clamped to the drawable band). */
export function v2GlobalBox(vb, margin) {
  let x0 = (vb[0] + 180) / 360, x1 = (vb[2] + 180) / 360;
  if (x1 < x0) x1 += 1;                                      // antimeridian-crossing bounds
  const yN = mercYOf(vb[3]), yS = mercYOf(vb[1]);
  const px = (x1 - x0) * margin, py = (yS - yN) * margin;
  let bx0 = x0 - px, bx1 = x1 + px;
  if (bx1 - bx0 >= 1) { bx0 = 0; bx1 = 1; }                  // a whole world in view: respawn everywhere
  return [bx0, Math.max(mercYOf(85), yN - py), bx1, Math.min(mercYOf(-80), yS + py)];
}

/** The respawn box in the ADVECT position space: global at z<=6, tile-relative [0,1] above. */
export function v2RespawnBox(globalBox, hiZoom, tileOriginX, tileOriginY, tileWidth) {
  if (!hiZoom) return globalBox;
  const [x0, y0, x1, y1] = globalBox;
  const k = Math.round((tileOriginX + tileWidth / 2) - (x0 + x1) / 2);   // same world copy as the tile
  const t = (v, o) => Math.max(0, Math.min(1, (v - o) / tileWidth));
  return [t(x0 + k, tileOriginX), t(y0, tileOriginY), t(x1 + k, tileOriginX), t(y1, tileOriginY)];
}

/** Fraction of particles to draw so the on-screen density is densityPer100 marks per 100x100 css px. */
export function v2KeepRate(densityPer100, cssW, cssH, pool, globalBox, zoom) {
  const world = 512 * Math.pow(2, zoom);
  const boxArea = Math.max(1, (globalBox[2] - globalBox[0]) * world * (globalBox[3] - globalBox[1]) * world);
  const screenArea = Math.max(1, cssW * cssH);
  const inView = pool * Math.min(1, screenArea / boxArea);   // steady state: every live particle is in the box
  return Math.max(0.002, Math.min(1, (densityPer100 * screenArea / 1e4) / Math.max(1, inView)));
}

/** Mean-life drop chance per 60 Hz frame at calm, and the bump at the grid's max speed (upstream webgl-wind shape). */
export function v2DropRule(lifeS) {
  return [1 / (60 * lifeS), V2_DEFAULTS.bumpAtMax];
}

// ── NO-DOWNGRADE (2026-10-08 live test; windTwoTexture.test.js) ────────────────────────────────
/** True when bounds `a` contain bounds `b` (degrees; antimeridian-aware on both). */
export function windBoundsContain(a, b) {
  if (!a || !b) return false;
  const span = (x) => (x.east < x.west ? (x.east + 360) - x.west : x.east - x.west);
  const off = ((((b.west - a.west) % 360) + 360) % 360);
  return off + span(b) <= span(a) + 1e-9 && b.south >= a.south - 1e-9 && b.north <= a.north + 1e-9;
}
