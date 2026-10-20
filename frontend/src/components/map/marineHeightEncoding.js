// THE HEIGHT BYTE (2026-10-20): how many metres the main wave texture's 255 means, carried with each upload.
//
// The encoder packs height as floor(min(1, h / scale) * 255) into the B byte (WebGLMarineTextureEncoder.js). Until 2026-10-20
// scale was the constant 10 and every decoder read waveData.b * 10.0, so no sea above 10 m ever reached the GPU (live storms
// reach 12.3 m). Now the scale is chosen PER UPLOAD by marineWaveHeightScale (marineWavePalette.js): the V2 table's cap (16) for
// the light and beach wash, 10 everywhere else. Dark keeps 10 on purpose (a /16 step moves its calm water up to ~4.7 dE00),
// rating grids keep 10 (the encoder forces it: the surf-quality path stays byte-identical), and the separate score texture is
// always /10 (its b is score / 100, decoded ratingScore = waveHeight * 10.0).
//
// The contract, every decoder at once:
//  - the encoder stamps the scale on what it returns (`u_heightScale`), next to the texture it describes, so the resident set and
//    the held coarse base (encoded at different times, possibly under different themes) each carry their own;
//  - every program that decodes a wave texture sets vec2 `u_heightScale` before it draws: x = the texture bound as u_waveTexture,
//    y = the crest ring-fill's u_coarseWaveTexture (the heatmap reads x only). Call sites (WebGLMarineEngine.js): the heatmap's
//    main pass (null when the score texture is bound, so 10), the coarse-base wash pass (its own base), advect and draw (resident,
//    ring-fill base);
//  - an unset uniform reads 0 and the GLSL falls back to 10.0, the legacy decode.
//  - the shader strings carry none of it: withHeightScale (below) rewrites their one decode at module load.
//
// Kill: window.__RAW_DISABLE_WAVE_HEIGHT_16M__ = true before load. Every upload is /10 and every shader string is the
// pre-2026-10-20 text exactly (no declaration, the constant 10.0): sha256-pinned with the texture bytes in
// marineHeightEncoding.test.js.
import { WAVE_HEIGHT_16M } from './marineWavePalette';

export const LEGACY_HEIGHT_SCALE = 10;

/** The scale one encoded upload carries; anything without one (or null: a texture always packed /10) is the legacy 10. */
export const heightScaleOf = (enc) => (enc && enc.u_heightScale > 0 ? enc.u_heightScale : LEGACY_HEIGHT_SCALE);

/** Sets vec2 u_heightScale on `prog` (in use): x = `wave`'s scale, y = `coarse`'s (defaults to `wave`'s). A no-op under the kill. */
export function setWaveHeightScale(gl, prog, wave, coarse = wave) {
  if (!WAVE_HEIGHT_16M || !gl || !prog) return;
  gl.uniform2f(gl.getUniformLocation(prog, 'u_heightScale'), heightScaleOf(wave), heightScaleOf(coarse));
}

// GLSL: the shader modules wrap their source (export const ADVECT_FS = withHeightScale(<template>, pick)), so the shader text itself
// is untouched: with 16 m on, the one decode `waveData.b * 10.0` becomes `waveData.b * waveHScale(pick)` and the declaration goes in
// just before main(); under the kill the string is returned as it came, byte for byte.
export const HEIGHT_SCALE_DECL = 'uniform vec2 u_heightScale; float waveHScale(float s) { return s > 0.0 ? s : 10.0; }';
const DECODE = 'float waveHeight = waveData.b * 10.0;', MAIN = '\nvoid main() {';

/** `src` with its height decode read through u_heightScale (`pick`: a GLSL float expression over it). Throws at module load if the
 *  shader no longer has exactly one decode and one main(): the encoder would then pack /16 for a shader that decodes /10. */
export function withHeightScale(src, pick) {
  if (!WAVE_HEIGHT_16M) return src;
  if (src.split(DECODE).length !== 2 || src.split(MAIN).length !== 2) throw new Error('withHeightScale: expected one height decode and one main()');
  return src.replace(DECODE, `float waveHeight = waveData.b * waveHScale(${pick});`).replace(MAIN, `\n${HEIGHT_SCALE_DECL}${MAIN}`);
}
