// THE FLOAT HEIGHT (2026-10-20): the wave-height WASH reads metres from an R16F texture instead of the 8-bit height byte.
//
// Why. The main wave texture packs height into its B byte (marineHeightEncoding.js): 10/255 m per step, floored (dark, rating,
// and the light/beach wash under the 16 m kill), or 16/255 m rounded (light/beach v2, #415). At calm water the heatmap's
// depth-floor blend smoothstep(0, 0.18, h) is steep, so one texel's step moves the drawn colour a lot: priced as the wash draws
// it (frontend/scripts/wind-color/wave-quant.mjs) the /10 floor's worst texel is ~15 dE00 and the /16 round's ~12, in calm water
// 0.08-0.13 m. Half floats keep 11 significant bits at EVERY magnitude, so the same texel is ~0.01 dE00 off.
//
// What. One more texture next to the RGBA8 wave texture: R16F, uploaded from FLOAT data (WebGL2 core: R16F is texture-filterable
// and accepts RED/FLOAT), holding the height the byte holds, unquantized: min(max(h, 0), the upload's scale), with the same
// global seam average. The SAME range as the byte (dark stops at 10 m, light/beach v2 at 16), so precision is the only variable.
// HEATMAP_FS's main and coarse-base passes read it, including the land-aware 4-tap fetch (each tap takes its B from the float
// texture, so the weights apply to metres). The crests (advect, draw) and the surf-quality score texture stay on the bytes: a
// second visual variable otherwise. Rating grids get no float texture (their heatmap path is the score).
//
// Lifecycle (WebGLMarineTextureEncoder.js calls encodeHeightFloat after its upload transaction succeeded):
//  - resident (an engine commit): engine._residentHeightTex, re-uploaded in place while the dims hold, freed and recreated when
//    they change, freed when a commit needs none (rating grid, kill, no WebGL2); freed at dispose (WebGLMarineEngineInit.js);
//  - standalone (the BLEND BOTH coarse base): a fresh texture owned by that base, freed with it (engine._freeCoarseBase).
// Binding: bindHeightFloat at the heatmap's two draw sites, next to setWaveHeightScale; texture unit 6 (inside the 0-6 range
// captureWebGLState saves and restores; draw's ring-fill rebinds 6 before it draws). u_heightFloat = 0 (score texture bound, a
// set without one, WebGL1) leaves the byte decode as it is.
//
// Fallback: WebGL1 (no R16F) or a failed upload -> no float texture -> the byte, exactly as before.
// Kill: window.__RAW_DISABLE_WAVE_HEIGHT_FLOAT__ = true before load: no texture, no uniform, and HEATMAP_FS is #415's string
// byte for byte (sha256-pinned with the wave texture bytes in marineHeightFloat.test.js).
import { bindTexture, noteTextureCreated, safeDeleteTexture } from './WebGLWindUtils';

const WIN = typeof window === 'undefined' ? {} : window;
export const WAVE_HEIGHT_FLOAT = WIN.__RAW_DISABLE_WAVE_HEIGHT_FLOAT__ !== true;
export const HEIGHT_FLOAT_UNIT = 6;

/** WebGL2 (R16F and RED exist only there): the float path's one capability test. */
export const supportsHeightFloat = (gl) => !!gl && typeof gl.R16F === 'number' && typeof gl.RED === 'number';

/** The float twin of the height byte: metres clamped to [0, scale] (NaN -> 0, as the byte), the global seam averaged as the byte is.
 *  `out` (optional, length cols * rows): where to write, so a scrub's commits reuse one buffer (WebGL copies on upload). */
export function packHeightFloat(h, cols, rows, scale, isGlobal, out = new Float32Array(cols * rows)) {
  for (let i = 0; i < out.length; i++) { const v = h[i]; out[i] = v > 0 ? (v < scale ? v : scale) : 0; }
  if (isGlobal) for (let r = 0; r < rows; r++) { const a = r * cols, b = a + cols - 1; out[a] = out[b] = (out[a] + out[b]) * 0.5; }
  return out;
}

function upload(gl, tex, data, cols, rows, fresh) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (fresh) {
    [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]
      .forEach(([k, v]) => gl.texParameteri(gl.TEXTURE_2D, k, v));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, cols, rows, 0, gl.RED, gl.FLOAT, data);
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RED, gl.FLOAT, data);
  }
  const g = typeof window !== 'undefined' && window.__RAW_GPU__;
  if (g) {
    g.textureUploadCount = (g.textureUploadCount || 0) + 1;
    if (fresh) { g.textureCount = (g.textureCount || 0) + 1; g.gpuMemoryEstimate = (g.gpuMemoryEstimate || 0) + cols * rows * 2; }
  }
  if (fresh) noteTextureCreated(tex, cols, rows, 2);   // R16F: 2 bytes a texel, subtracted exactly by safeDeleteTexture
}

/** Frees the engine's resident float height texture (dispose, a commit that needs none, a failed upload). */
export function releaseResidentHeightFloat(gl, engine) {
  if (!engine || !engine._residentHeightTex) return;
  safeDeleteTexture(gl, engine._residentHeightTex, null);
  engine._residentHeightTex = null;
  engine._residentHeightDims = null;
  engine._heightFloatScratch = null;
}

// The pack buffer, held on the engine like the encoder's own scratch arrays (getEncoderScratchBuffers): a 1440 x 721 world grid
// would otherwise allocate 4 MB per commit while scrubbing. Grows, never shrinks; dropped with the resident texture.
function scratchFor(engine, n) {
  if (!engine) return new Float32Array(n);
  if (!engine._heightFloatScratch || engine._heightFloatScratch.length < n) engine._heightFloatScratch = new Float32Array(n);
  return engine._heightFloatScratch.subarray(0, n);
}

/** Called once per encode, after the byte textures are in: the float height texture for this set, or null (the byte decodes). */
export function encodeHeightFloat(gl, engine, standalone, waveGrid, h, scale, isGlobal) {
  const resident = !standalone && !!engine;
  if (!WAVE_HEIGHT_FLOAT) return null;
  if (waveGrid.ratingMode || !supportsHeightFloat(gl)) { if (resident) releaseResidentHeightFloat(gl, engine); return null; }
  const { cols, rows } = waveGrid, dims = `${cols}x${rows}`;
  let fresh = null;
  try {
    const data = packHeightFloat(h, cols, rows, scale, isGlobal, scratchFor(engine, cols * rows));
    if (resident && engine._residentHeightTex && engine._residentHeightDims === dims) {
      upload(gl, engine._residentHeightTex, data, cols, rows, false);
      return engine._residentHeightTex;
    }
    if (resident) releaseResidentHeightFloat(gl, engine);
    fresh = gl.createTexture();
    if (!fresh) return null;
    upload(gl, fresh, data, cols, rows, true);
    if (resident) { engine._residentHeightTex = fresh; engine._residentHeightDims = dims; }
    return fresh;
  } catch (e) {
    console.warn('[marineHeightFloat] R16F height upload failed; the wash keeps the height byte:', e && e.message);
    if (resident) releaseResidentHeightFloat(gl, engine);
    if (fresh) gl.deleteTexture(fresh);   // created but its upload threw (so never counted): delete it, do not leak it
    return null;
  }
}

/** Frees a STANDALONE set's float texture (the coarse base owns its own; the resident one belongs to the engine). */
export function freeHeightFloat(gl, set, engine) {
  if (set && set.u_heightFloatTexture && set.u_heightFloatTexture !== (engine && engine._residentHeightTex)) {
    safeDeleteTexture(gl, set.u_heightFloatTexture, engine);
  }
}

/** At a heatmap draw site (program in use): u_heightFloat = 1 and the set's texture on unit 6 when it has one, else 0 (the byte).
 *  `set` null = the score texture is bound (surf quality stays on its byte). A no-op under the kill (the GLSL has no such uniform). */
export function bindHeightFloat(gl, prog, set) {
  if (!WAVE_HEIGHT_FLOAT || !gl || !prog) return;
  const tex = (set && set.u_heightFloatTexture) || null;
  if (tex) bindTexture(gl, tex, HEIGHT_FLOAT_UNIT);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_waveHeightTexture'), HEIGHT_FLOAT_UNIT);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_heightFloat'), tex ? 1.0 : 0.0);
}

// GLSL. HEATMAP_FS = withHeightFloat(withHeightScale(<template>, ...)): every u_waveTexture fetch (the plain one and the four taps of
// sampleWaveLandAware) goes through waveTapF, which swaps B for the float height when one is bound; the decode reads it as metres.
// The sampler is mediump: a fragment shader's samplers default to lowp, whose range (+-2) and step (1/256) would undo the point.
export const HEIGHT_FLOAT_DECL = 'uniform mediump sampler2D u_waveHeightTexture;\nuniform float u_heightFloat;\n' +
  'vec4 waveTapF(GEO_P vec2 uv) { vec4 s = texture2D(u_waveTexture, uv); if (u_heightFloat > 0.5) s.b = texture2D(u_waveHeightTexture, uv).r; return s; }\n';
const FETCH = 'texture2D(u_waveTexture, ', SAMPLER = 'vec4 sampleWaveLandAware(', DECODE = 'float waveHeight = waveData.b * ';

/** `src` with its wave fetches and its height decode read through the float texture. Throws at module load if the shader's shape
 *  moved (five fetches, all inside the one land-aware sampler, and one decode): a fetch left on the byte would mix the two. */
export function withHeightFloat(src) {
  if (!WAVE_HEIGHT_FLOAT) return src;
  const at = src.indexOf(SAMPLER), fetches = src.split(FETCH).length - 1, end = src.indexOf('\n}\n', at);
  if (src.split(SAMPLER).length !== 2 || src.split(DECODE).length !== 2 || fetches !== 5 || src.slice(at, end).split(FETCH).length - 1 !== 5) {
    throw new Error('withHeightFloat: expected five u_waveTexture fetches inside sampleWaveLandAware and one height decode');
  }
  return src.slice(0, at) + HEIGHT_FLOAT_DECL + src.slice(at).split(FETCH).join('waveTapF(')
    .replace(DECODE, 'float waveHeight = u_heightFloat > 0.5 ? waveData.b : waveData.b * ');
}
