/**
 * particleState.js: how a particle's position is STORED between frames, and how it is stepped (wind and wave crests).
 *
 * WHY (L4 graphics research, 2026-11-02, measured on the real GPU, d3d11 + SwiftShader): both engines kept each particle in an
 * RGBA8 texel, x = r + g/255 and y = b + a/255, so a position is quantised to q = 1/65025 of the tile. The advect pass reads the
 * texel, adds one frame's step and writes it back, so the step itself is rounded every frame: a per-axis step under 0.5 q NEVER
 * moves (200 frames), 0.5-1 q moves exactly 1 q. Wind at z5 froze at <= 2 kn and at z6 at <= 3 kn; 5-8 kn headings read 11-17 deg
 * off (snapped toward 0/45/90 deg); marine crest drift (0.01-0.27 q per frame at the 3 m cap) was ZERO everywhere.
 *
 * 1. FLOAT STATE. Where the context can render to a 32-bit float texture (WebGL2 + EXT_color_buffer_float; WebGL1 +
 *    OES_texture_float + WEBGL_color_buffer_float), the state is RGBA32F holding (x, y, 0, 1): ~6e-8 of the tile, 250x finer than
 *    q, so a sub-quantum step moves by exactly its size. NOT half float: RG16F at 0.5 has a spacing of 4.9e-4, coarser than q.
 * 2. STOCHASTIC ROUNDING (no float target, or the float FBO comes back incomplete): the RGBA8 path stays, and the position gets
 *    a uniform dither of +-q/2 before it is written. Round-to-nearest of x + U(-q/2, q/2) has the expectation x, so a 0.2 q step
 *    moves 0.2 q per frame on average instead of 0, at a jitter of at most half a quantum (0.5 px for wind at z6, 0.03 px crests).
 *    The shader rounds to the code itself and writes exact k/255 bytes: the driver's float -> unorm8 conversion is not trusted
 *    (measured 2026-11-03 on d3d11: a 0.55 q step still froze, the threshold sits near 0.6 q; SwiftShader rounds at 0.5).
 * 3. RK2 (midpoint) advection, in both engines' ADVECT_FS: Euler spirals outward in a vortex (Rankine core 15 px, 30-frame life:
 *    +11% radius at 20 kn, +33% at 40 kn); the midpoint rule's per-step growth is ~(omega h)^4 / 8, ~0.
 *
 * Kill switches (both restore the previous picture exactly; read every frame, a state-format change reseeds the particles):
 *   window.__RAW_DISABLE_FLOAT_PARTICLE_STATE__ = true  -> RGBA8 state, no dither: the old encode/decode byte for byte
 *   window.__RAW_DISABLE_RK2_ADVECTION__ = true         -> one Euler step per frame, as before
 */
import { uniformLoc } from './glUniformCache';

export const FLOAT_STATE_KILL = '__RAW_DISABLE_FLOAT_PARTICLE_STATE__';
export const RK2_KILL = '__RAW_DISABLE_RK2_ADVECTION__';
export const STATE_QUANTUM = 1 / 65025;   // one RGBA8 step of a tile coordinate: (1/255) * (1/255)

// Set before the map loads, a kill leaves the shader TEXT exactly as before (the splices below are the old lines); set later, the
// uniforms restore the same picture (and the float kill reseeds the particles into RGBA8 textures).
const WIN = typeof window === 'undefined' ? {} : window;
export const FLOAT_STATE_AT_LOAD = WIN[FLOAT_STATE_KILL] !== true;
const winOf = (w) => (w !== undefined ? w : (typeof window !== 'undefined' ? window : null));
export function floatStateWanted(win) { const w = winOf(win); return FLOAT_STATE_AT_LOAD && !(w && w[FLOAT_STATE_KILL] === true); }
export function rk2Advection(win) { const w = winOf(win); return !(w && w[RK2_KILL] === true); }

// One probe per context: a 1x1 float texture on a framebuffer, kept only if it is FRAMEBUFFER_COMPLETE.
const SUPPORT = new WeakMap();
export function floatStateFormat(gl) {
  if (!gl) return null;
  if (SUPPORT.has(gl)) return SUPPORT.get(gl);
  let fmt = null;
  try {
    const gl2 = gl.RGBA32F !== undefined && typeof gl.texStorage2D === 'function';
    if (gl2 ? gl.getExtension('EXT_color_buffer_float') : (gl.getExtension('OES_texture_float') && gl.getExtension('WEBGL_color_buffer_float'))) {
      fmt = { internal: gl2 ? gl.RGBA32F : gl.RGBA, format: gl.RGBA, type: gl.FLOAT };
      const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D), prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const tex = gl.createTexture(), fb = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, 1, 1, 0, fmt.format, fmt.type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) fmt = null;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
    }
  } catch (e) { fmt = null; }   // a probe must never break the map: no float state, the byte path with dither
  SUPPORT.set(gl, fmt);
  return fmt;
}
/** The float target turned out unusable at draw time: every later texture on this context is RGBA8 (with dither). */
export function markFloatStateUnsupported(gl) { if (gl) SUPPORT.set(gl, null); }

/** Fresh uniform-random positions, packed for the chosen format (the byte packing is the engines' old one, unchanged). */
export function packParticlePositions(count, float, rnd = Math.random) {
  const data = float ? new Float32Array(count * 4) : new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const x = rnd(), y = rnd();
    if (float) { data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 2] = 0; data[i * 4 + 3] = 1; continue; }
    const xHi = Math.floor(x * 255), xLo = Math.floor(((x * 255) - xHi) * 255);
    const yHi = Math.floor(y * 255), yLo = Math.floor(((y * 255) - yHi) * 255);
    data[i * 4] = xHi; data[i * 4 + 1] = xLo; data[i * 4 + 2] = yHi; data[i * 4 + 3] = yLo;
  }
  return data;
}

/**
 * A particle-state texture for `engine` (sets engine._stateFloat). `createByteTexture(gl, filter, data, w, h)` is the engine's own
 * RGBA8 creator, used as before when the float state is killed or unsupported; a float texture is made from a byte one of the
 * same size (so the engine's texture accounting sees it) and then re-specified as RGBA32F.
 */
export function createParticleStateTexture(gl, res, engine, createByteTexture) {
  const fmt = floatStateWanted() ? floatStateFormat(gl) : null;
  if (engine) engine._stateFloat = !!fmt;
  if (!fmt) return createByteTexture(gl, gl.NEAREST, packParticlePositions(res * res, false), res, res);
  const tex = createByteTexture(gl, gl.NEAREST, null, res, res);
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, res, res, 0, fmt.format, fmt.type, packParticlePositions(res * res, true));
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  return tex;
}
/** In-place reseed of both state textures (the marine engine's grid-swap path), in whichever format they were made. */
export function reseedParticleStateTextures(gl, engine, res) {
  const float = engine._stateFloat === true, fmt = float ? floatStateFormat(gl) : null;
  const data = packParticlePositions(res * res, !!fmt);
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  for (const tex of [engine.particleStateA, engine.particleStateB]) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, res, res, gl.RGBA, fmt ? fmt.type : gl.UNSIGNED_BYTE, data);
  }
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
}

/**
 * Per frame, before the particle textures are read: keep the textures' format in step with the kill switch (a live flip reseeds),
 * and drop to RGBA8 if the float framebuffer was refused (the marine engine marks _fboSupported false, which would otherwise hide
 * every crest). Returns true when it reseeded.
 */
export function syncParticleStateFormat(gl, engine, reseed) {
  if (!engine || !engine.particleStateA || engine._stateFloat === undefined) return false;
  if (engine._stateFloat && engine._fboSupported === false) { markFloatStateUnsupported(gl); engine._fboSupported = true; reseed(); return true; }
  const want = floatStateWanted() && !!floatStateFormat(gl);
  if (want !== engine._stateFloat) { reseed(); return true; }
  return false;
}

/** The three uniforms PARTICLE_STATE_GLSL reads. Under the float kill every one is 0 (the old shader path exactly). */
export function particleStateUniforms(engine, win) {
  const float = !!(engine && engine._stateFloat);
  return { u_floatState: float ? 1 : 0, u_stochRound: !float && floatStateWanted(win) ? 1 : 0, u_rk2: rk2Advection(win) ? 1 : 0 };
}
export function applyParticleStateUniforms(gl, program, engine) {
  const u = particleStateUniforms(engine);
  gl.uniform1f(uniformLoc(gl, program, 'u_floatState'), u.u_floatState);
  gl.uniform1f(uniformLoc(gl, program, 'u_stochRound'), u.u_stochRound);
  gl.uniform1f(uniformLoc(gl, program, 'u_rk2'), u.u_rk2);
}

// GLSL, spliced where each ADVECT_FS had its own decodePos/encodePos (and into both DRAW_VS). With u_floatState = 0 and
// u_stochRound = 0 the two functions are the old ones exactly. The dither hash is Dave Hoskins' hash22 ("hash without sine") on
// the state texel and a per-frame seed: the sine hash collapses onto a few hundred float32 values at these arguments (L4: 821).
export const PARTICLE_DECODE_GLSL = 'uniform float u_floatState; '
  + 'vec2 decodePos(vec4 color) { return u_floatState > 0.5 ? color.rg : vec2(color.r + color.g / 255.0, color.b + color.a / 255.0); }';
export const PARTICLE_STATE_GLSL = `${PARTICLE_DECODE_GLSL} uniform float u_stochRound;
vec2 stateHash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 = p3 + dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec4 encodePos(vec2 pos) {
  vec2 clamped = clamp(pos, 0.0, 1.0);
  if (u_floatState > 0.5) return vec4(clamped, 0.0, 1.0);
  if (u_stochRound > 0.5) { vec2 n = floor(clamped * 65025.0 + 0.5); vec2 hi = floor(n / 255.0); vec2 lo = n - hi * 255.0; return vec4(hi.x / 255.0, lo.x / 255.0, hi.y / 255.0, lo.y / 255.0); }
  float x_hi = floor(clamped.x * 255.0); float x_lo = fract(clamped.x * 255.0);
  float y_hi = floor(clamped.y * 255.0); float y_lo = fract(clamped.y * 255.0);
  return vec4(x_hi / 255.0, x_lo, y_hi / 255.0, y_lo);
}
vec4 encodeState(vec2 pos, float seed) {
  if (u_stochRound > 0.5 && u_floatState < 0.5) pos = pos + (stateHash22(gl_FragCoord.xy + fract(seed * 7.31) * 4096.0) - 0.5) * ${STATE_QUANTUM.toExponential(10)};
  return encodePos(pos);
}`;
// The old text of each splice point, verbatim (the kill-at-load restores it byte for byte).
const LEGACY_DECODE = `vec2 decodePos(vec4 color) {
  return vec2(
    color.r + color.g / 255.0,
    color.b + color.a / 255.0
  );
}`;
const LEGACY_ENCODE = `vec4 encodePos(vec2 pos) {
  vec2 clamped = clamp(pos, 0.0, 1.0);
  float x_hi = floor(clamped.x * 255.0);
  float x_lo = fract(clamped.x * 255.0);
  float y_hi = floor(clamped.y * 255.0);
  float y_lo = fract(clamped.y * 255.0);
  return vec4(x_hi / 255.0, x_lo, y_hi / 255.0, y_lo);
}`;
const NL = '\n';
const STATE_NOTE = '// Position state (RGBA32F, or RGBA8 x = r + g/255 with a stochastic-rounding dither): particleState.js' + NL;
const ON = FLOAT_STATE_AT_LOAD;
/** The splices, by shader. */
export const STATE_SPLICE = {
  windAdvect: ON ? STATE_NOTE + PARTICLE_STATE_GLSL : '// Decode position from 2-channel encoding (16-bit precision per axis)' + NL + LEGACY_DECODE + NL + NL
    + LEGACY_ENCODE.replace('{' + NL, '{' + NL + '  // Encode position into RGBA with sub-pixel precision' + NL),
  marineAdvect: ON ? STATE_NOTE + PARTICLE_STATE_GLSL : LEGACY_DECODE + NL + NL + LEGACY_ENCODE,
  windDrawDecode: ON ? PARTICLE_DECODE_GLSL : LEGACY_DECODE,
  marineDrawDecl: ON ? PARTICLE_DECODE_GLSL : '',
  marineDrawDecode: ON ? '  vec2 pos = decodePos(texture2D(u_particles, p_uv));   // particleState.js' : `  vec4 encodedPos = texture2D(u_particles, p_uv);
  vec2 pos = vec2(
    encodedPos.r + encodedPos.g / 255.0,
    encodedPos.b + encodedPos.a / 255.0
  );`,
  encode: ON ? 'encodeState(pos, u_rand_seed)' : 'encodePos(pos)',
};

/** JS mirrors of what the GPU stores, for the tests and the docs. */
export function byteQuantise(x) {   // write -> read through RGBA8 (the GPU's float -> unorm8 conversion rounds to nearest)
  const c = Math.min(1, Math.max(0, x)), hi = Math.floor(c * 255), lo = Math.round((c * 255 - hi) * 255);
  return hi / 255 + lo / 65025;
}
export function storeState(x, mode, rnd = Math.random) {
  if (mode === 'float') return Math.fround(Math.min(1, Math.max(0, x)));
  if (mode === 'byte-sr') return byteQuantise(x + (rnd() - 0.5) * STATE_QUANTUM);
  return byteQuantise(x);
}
