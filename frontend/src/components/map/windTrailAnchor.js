/**
 * TRAILS ANCHORED TO THE MAP (2026-10-10; windTrailAnchor.test.js; bench: wind-bench/path-run.js, columns flowRest / flowMove).
 *
 * The wind's trails live in a screen-sized buffer that is dimmed and redrawn every frame. That buffer knew nothing about
 * the map: while the map panned or zoomed, yesterday's ink stayed where the SCREEN had left it, so every trail smeared
 * along the hand's motion (a pan turned the whole field into streaks parallel to the drag, a zoom into rays from the
 * focal point) and the wind's direction was unreadable exactly while the viewer was looking for it.
 *
 * The buffer now keeps a camera of its own, and the ink in it is registered to that camera:
 *   - a pan moves the ink by WHOLE pixels in the fade pass (an exact texel copy, nothing is resampled or softened); the
 *     sub-pixel remainder stays in the buffer's camera, so it never accumulates;
 *   - a zoom is not resampled every frame either (that blurred the trails for as long as the zoom lasted). The composite
 *     looks at the buffer THROUGH the change of scale, one resample at display, and the ink is re-laid only when that
 *     magnification passes `maxMagnify`, when the view starts to outgrow the buffer (zoom-out: the buffer is re-laid
 *     wider and the old ink feathered toward its old edge, so no box shows), or once the scale has come to rest;
 *   - a turn or a tilt of the map re-lays the ink every frame through the exact ground-plane homography;
 *   - at the date line the view centre wraps and the map's matrix jumps one world in a single frame, with the same ink
 *     on screen: the buffer's camera is taken in whichever copy of the world is nearest the view;
 *   - marks are drawn into the buffer with the buffer's camera (the map's matrix with its ground plane swapped).
 * A still camera is the identity in every pass: the legacy fetch, bit for bit.
 *
 * Kill: window.__RAW_DISABLE_WIND_TRAIL_ANCHOR__ (the buffer is the screen again, with the legacy clear on a zoom jump).
 * Read-back: window.__WIND_TRAIL_ANCHOR__ { on, mode, k, modes }.
 */

export const TRAIL_ANCHOR = Object.freeze({
  maxMagnify: 1.2,     // the most the screen may magnify the buffer before the ink is re-laid one to one (= the respawn box's 10% pad)
  widen: 1.15,         // a zoom-out re-lays the ink into a buffer this much wider than the view: short of maxMagnify, so a
                       // small zoom wobble after it (a pinch held still) cannot trip the one-to-one re-lay and widen again
  feather: 0.09,       // share of the old buffer over which old ink thins out when the buffer is re-laid wider
  settleFrames: 12,    // frames at a steady scale before a magnified buffer is re-laid one to one
  snapPx: 0.25,        // a change that moves no screen edge by this much is not a turn, a tilt or a zoom
  jump: 2.2,           // a one-frame change of scale beyond this keeps nothing worth showing: start clean
});

/**
 * The fragment-shader half, shared by FADE_FS and SCREEN_FS. It declares their uv varying. Only the uv arithmetic is high
 * precision (a whole-pixel shift must land on a texel centre); the colour arithmetic keeps each shader's own mediump line,
 * so with the transform at zero the pass does what it did before, operation for operation.
 */
export const GLSL_TRAIL_UV = `#ifdef GL_FRAGMENT_PRECISION_HIGH
#define TRAIL_HP highp
#else
#define TRAIL_HP mediump
#endif
uniform TRAIL_HP mat3 u_trail_d;  // (this pass's uv -> the trail buffer's uv) MINUS identity: all zeros = the plain fetch
uniform float u_trail_feather;    // > 0: old ink thins toward the old buffer's edge
uniform float u_ink;              // 1: the buffer holds ink on white paper (windInk.js), so an empty texel is white; 0: it is nothing
varying TRAIL_HP vec2 v_uv;
vec4 trailTexel(sampler2D tex) {
  TRAIL_HP vec3 q = vec3(v_uv, 1.0) + u_trail_d * vec3(v_uv, 1.0);
  TRAIL_HP vec2 p = q.xy / q.z;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(u_ink);
  vec4 c = texture2D(tex, p);
  return u_trail_feather > 0.0 ? mix(vec4(u_ink), c, smoothstep(0.0, u_trail_feather, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)))) : c;
}`;

export function windTrailAnchorEnabled(win = (typeof window !== 'undefined' ? window : null)) {
  return !(win && win.__RAW_DISABLE_WIND_TRAIL_ANCHOR__ === true);
}

// ── 3x3 algebra on row-major arrays of nine ─────────────────────────────────────────────────────
const mul3 = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

function inv3(m) {
  const a = m[4] * m[8] - m[5] * m[7], b = m[5] * m[6] - m[3] * m[8], c = m[3] * m[7] - m[4] * m[6];
  const det = m[0] * a + m[1] * b + m[2] * c;
  if (!Number.isFinite(det) || det === 0) return null;
  const d = 1 / det;
  return [a * d, (m[2] * m[7] - m[1] * m[8]) * d, (m[1] * m[5] - m[2] * m[4]) * d,
    b * d, (m[0] * m[8] - m[2] * m[6]) * d, (m[2] * m[3] - m[0] * m[5]) * d,
    c * d, (m[1] * m[6] - m[0] * m[7]) * d, (m[0] * m[4] - m[1] * m[3]) * d];
}

/** The map's ground plane out of its 4x4 (column-major): (X, Y, 1) mercator -> (x w, y w, w) clip. */
export function planeOf(m) {
  return [m[0], m[4], m[12], m[1], m[5], m[13], m[3], m[7], m[15]];
}

const ZERO3 = new Float32Array(9);
/** u_trail_d for a pass that reads the buffer one to one. */
export const TRAIL_IDENTITY = ZERO3;

/** A clip -> clip homography as the shader takes it: uv -> uv, MINUS identity, column-major. */
function uvDelta(H) {
  // U = S H S^-1 with S: clip -> uv (x 0.5 + 0.5)
  const r0 = [0.5 * H[0] + 0.5 * H[6], 0.5 * H[1] + 0.5 * H[7], 0.5 * H[2] + 0.5 * H[8]];
  const r1 = [0.5 * H[3] + 0.5 * H[6], 0.5 * H[4] + 0.5 * H[7], 0.5 * H[5] + 0.5 * H[8]];
  const r2 = [H[6], H[7], H[8]];
  const col = (r) => [2 * r[0], 2 * r[1], r[2] - r[0] - r[1]];
  const a = col(r0), b = col(r1), c = col(r2), s = 1 / c[2];
  return new Float32Array([a[0] * s - 1, b[0] * s, c[0] * s, a[1] * s, b[1] * s - 1, c[1] * s, a[2] * s, b[2] * s, 0]);
}

/** The map's matrix aimed at the buffer's camera: its ground plane swapped for `P`, depth flattened (nothing here is depth tested). */
function drawMatrix(matrix, P) {
  const m = new Float32Array(matrix);
  m[0] = P[0]; m[4] = P[1]; m[12] = P[2];
  m[1] = P[3]; m[5] = P[4]; m[13] = P[5];
  m[3] = P[6]; m[7] = P[7]; m[15] = P[8];
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = 0;
  return m;
}

const translated = (P, tx, ty) => [P[0] + tx * P[6], P[1] + tx * P[7], P[2] + tx * P[8], P[3] + ty * P[6], P[4] + ty * P[7], P[5] + ty * P[8], P[6], P[7], P[8]];
const scaled = (P, k) => [P[0] * k, P[1] * k, P[2] * k, P[3] * k, P[4] * k, P[5] * k, P[6], P[7], P[8]];
/** The same camera looking at the copy of the world `s` worlds east (mercator X + s). */
const worldShifted = (P, s) => [P[0], P[1], P[2] + s * P[0], P[3], P[4], P[5] + s * P[3], P[6], P[7], P[8] + s * P[6]];
/** screen clip -> buffer clip, scaled so its last entry is 1 (null when it has none). */
const viewOf = (P, invPn) => { const V = mul3(P, invPn); return Number.isFinite(V[8]) && V[8] !== 0 ? V.map((x) => x / V[8]) : null; };
/** Map scale of a ground plane (clip units per mercator unit at the view centre). */
const scaleOf = (P) => Math.sqrt(Math.abs(P[0] * P[4] - P[1] * P[3])) / Math.abs(P[8] || 1);

const OFF = Object.freeze({ state: null, fade: ZERO3, fadeLinear: false, feather: 0, view: ZERO3, viewLinear: false, draw: null, dk: 0, clear: false, mode: 'off', k: 1 });

/**
 * One frame of the buffer's camera. `state` is what the previous call returned in `.state` (null to start clean);
 * `matrix` is the map's mercator -> clip 4x4; `w`, `h` the buffer in device pixels.
 * Returns { state, fade, fadeLinear, feather, view, viewLinear, draw, dk, clear, mode, k }:
 *   fade / view  uniform u_trail_d for the fade pass (new buffer -> old buffer) and the composite (screen -> buffer);
 *   draw         the matrix to draw marks with (null = the map's own); dk = (buffer px per screen px) - 1 for their size;
 *   clear        the buffers must be cleared before this frame (a jump);
 *   mode         'start' | 'pan' | 'view' | 'relay' | 'turn' | 'jump'; k = buffer px per screen px after this frame.
 */
export function stepTrailAnchor(state, matrix, w, h, cfg = TRAIL_ANCHOR) {
  const Pn = planeOf(matrix), invPn = inv3(Pn);
  if (!invPn || !(w > 0) || !(h > 0)) return OFF;
  const sNow = scaleOf(Pn);
  const fresh = (mode, clear) => ({ ...OFF, state: { P: Pn, scale: sNow, still: 0 }, clear, mode });
  if (!state || !state.P) return fresh('start', false);

  // THE DATE LINE. The world repeats, and the view centre wraps at +-180: the map's matrix then jumps one world in X in a
  // single frame while the same ink is on screen. Read the buffer's camera in whichever copy of the world is nearest.
  let Pb = state.P, V = viewOf(Pb, invPn);           // screen clip -> buffer clip
  if (!V) return fresh('jump', true);
  for (const s of [-1, 1]) {
    const Ps = worldShifted(state.P, s), Vs = viewOf(Ps, invPn);
    if (Vs && Math.abs(Vs[2]) < Math.abs(V[2])) { Pb = Ps; V = Vs; }
  }
  const k = Math.sqrt(Math.abs(V[0] * V[4] - V[1] * V[3]));   // buffer px per screen px
  const still = Math.abs(sNow / state.scale - 1) < 1e-9 ? state.still + 1 : 0;
  if (!(k > 1 / cfg.jump && k < cfg.jump) || Math.abs(V[2]) > 3 || Math.abs(V[5]) > 3) return fresh('jump', true);

  const half = Math.max(w, h) / 2;
  const turned = (Math.abs(V[0] - k) + Math.abs(V[1])) * w / 2 > cfg.snapPx || (Math.abs(V[4] - k) + Math.abs(V[3])) * h / 2 > cfg.snapPx
    || (Math.abs(V[6]) + Math.abs(V[7])) * k * half > cfg.snapPx;
  // Where the ink is re-laid this frame, if it is: a turn or a tilt (every frame), a view outgrowing the buffer (wider,
  // so the zoom-out can grow into it), a magnification past the cap, or a magnified buffer whose scale has come to rest.
  let relay = null, feather = 0, mode = 'relay';
  if (turned) { relay = Pn; mode = 'turn'; }
  else if (k > 1.001) { relay = scaled(Pn, 1 / cfg.widen); feather = cfg.feather; }
  else if (k < 1 / cfg.maxMagnify || (Math.abs(k - 1) >= 1e-6 && still > cfg.settleFrames)) relay = Pn;

  let P, fade, fadeLinear;
  if (relay) {
    const invRelay = inv3(relay);
    if (!invRelay) return fresh('jump', true);
    P = relay; fade = uvDelta(mul3(Pb, invRelay)); fadeLinear = true;
  } else {
    // whole pixels toward the view centre; the remainder (under half a pixel) stays in P
    const nx = Math.round(V[2] * w / 2), ny = Math.round(V[5] * h / 2);
    P = translated(Pb, -2 * nx / w, -2 * ny / h);
    fade = (nx || ny) ? new Float32Array([0, 0, 0, 0, 0, 0, nx / w, ny / h, 0]) : ZERO3;
    fadeLinear = false; mode = Math.abs(k - 1) < 1e-6 ? 'pan' : 'view';
  }
  const kOut = relay ? scaleOf(P) / sNow : k, viewLinear = Math.abs(kOut - 1) >= 1e-6;
  return {
    state: { P, scale: sNow, still }, fade, fadeLinear, feather,
    view: viewLinear ? uvDelta(mul3(P, invPn)) : ZERO3, viewLinear,   // one to one: the remainder is under half a pixel, leave it
    draw: drawMatrix(matrix, P), dk: viewLinear ? kOut - 1 : 0, clear: false, mode, k: viewLinear ? kOut : 1,
  };
}

// ── The engine's side ───────────────────────────────────────────────────────────────────────────

/** The pre-anchor rule, kept for the kill switch: clear the trails on a genuine zoom jump (not on pan jitter). */
function legacyZoomClear(engine, zoom) {
  let clear = false;
  if (engine._lastRenderZoom !== undefined) {
    const d = Math.abs(zoom - engine._lastRenderZoom);
    if (d > 0.15) {
      engine._zoomDeltaAccum = (engine._zoomDeltaAccum || 0) + d;
      if (engine._zoomDeltaAccum > 0.25) { clear = true; engine._zoomDeltaAccum = 0; }
    } else {
      engine._zoomDeltaAccum = Math.max(0, (engine._zoomDeltaAccum || 0) - 0.02);
    }
  }
  engine._lastRenderZoom = zoom;
  return clear;
}

/**
 * Once per engine frame, before the passes: this frame's trail uniforms (see stepTrailAnchor), with the buffers cleared
 * when the step asks for it. `matrix` should be the map's own (64-bit) matrix where the caller has it.
 */
export function windTrailFrame(engine, gl, matrix, w, h, zoom, win = (typeof window !== 'undefined' ? window : null)) {
  if (engine._trailHighp === undefined) {
    const f = gl.getShaderPrecisionFormat ? gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT) : null;
    engine._trailHighp = !f || f.precision > 0;      // without highp a texel-exact shift is not guaranteed: stay on the screen
  }
  const on = windTrailAnchorEnabled(win) && engine._trailHighp;
  let step = OFF, clear = false;
  if (on) {
    step = stepTrailAnchor(engine._trail, matrix, w, h);
    clear = step.clear; engine._lastRenderZoom = zoom;
  } else {
    clear = legacyZoomClear(engine, zoom);
  }
  engine._trail = step.state;
  if (clear && engine.screenA && engine.screenB) {
    const k = engine._inkWas === 1 ? 1 : 0;   // an ink buffer (windInk.js, model 1) is cleared to white paper
    for (const s of [engine.screenA, engine.screenB]) { gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo); gl.clearColor(k, k, k, k); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  if (win) {
    const prev = win.__WIND_TRAIL_ANCHOR__, modes = (prev && prev.modes) || {};
    modes[step.mode] = (modes[step.mode] || 0) + 1;
    win.__WIND_TRAIL_ANCHOR__ = { on, mode: step.mode, k: +step.k.toFixed(4), modes };
  }
  return step;
}

/** Bind one pass's trail fetch: its uv transform, the filter of the texture it reads (already bound on the active unit), the feather. */
export function bindTrailUv(gl, prog, delta, linear, feather = 0) {
  gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'u_trail_d'), false, delta);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_trail_feather'), feather);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
}
