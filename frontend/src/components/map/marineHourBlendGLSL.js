/**
 * THE HOUR BLEND's shader text (marineHourBlend.js), added to the marine colour shader as a wrapper.
 * The blend is OFF BY DEFAULT (the owner, 2026-11-15: off until the real-frame hidden-hour test and his blinded look): the text
 * is added only when window.__RAW_ENABLE_HOUR_BLEND__ === true BEFORE the shaders load and the kill is not set. Otherwise the
 * colour shader is returned as it came, byte for byte, and marineHourBlend.js never starts a blend. With the text loaded, the
 * kill set later in the console works through the uniform: u_hourPrevMix stays 0 and the earlier field is never read.
 * The composed shader is pinned, string for string, to the one the gate runs measured (marineHourBlend.test.js).
 *
 * Four insertions, each on an anchor that must occur exactly once (a throw at module load otherwise, as withHeightScale does):
 *   1. the uniforms, after the wave texture's own
 *   2. sampleWavePrev(), before mercatorYToLat()
 *   3. the mix, straight after this hour's sample: VALUES are mixed, then coloured by everything below
 *   4. the lab's 'value' debug view (window.__GPU_DEBUG__.mode = 'value'): the height byte as grey, no colour table
 */
const UNIFORMS_AT = 'uniform sampler2D u_waveTexture;\n';
const UNIFORMS = `uniform sampler2D u_wavePrevTexture; // THE HOUR BLEND (marineHourBlend.js): the hour that was on screen before the step
uniform float u_hourPrevMix;         // how much of it to draw: 1 at the step, 0 at rest (then it is not read)
uniform highp vec2 u_prevBounds_min; // the earlier field's OWN bounds [west, south] / [east, north]: it may be another grid
uniform highp vec2 u_prevBounds_max;
uniform GEO_P vec4 u_prev_reg;       // its point registration
uniform GEO_P vec2 u_prevTexel;      // 1/cols, 1/rows when it shares this grid's land flags; 0 = plain fetch
uniform float u_prevHeightRatio;     // its height scale / this grid's: heights are mixed in metres
`;
const FETCH_AT = 'GEO_P float mercatorYToLat(GEO_P float y) {';
const FETCH = `// THE HOUR BLEND's fetch of the earlier field, at ITS OWN place: uv is in the earlier grid's own texture space. On an
// unchanged grid (u_prevTexel > 0) it uses the SAME water-only weights as sampleWaveLandAware above, so the two hours meet
// cell for cell at the coast; a grid that was replaced is fetched plainly (its land flags went with it).
vec4 sampleWavePrev(GEO_P vec2 uv) {
  vec4 plain = texture2D(u_wavePrevTexture, uv);
  if (u_landAwareFetch < 0.5 || u_prevTexel.x <= 0.0 || u_prevTexel.y <= 0.0) return plain;
  GEO_P vec2 tc = uv / u_prevTexel - 0.5;
  vec2 f = fract(tc);
  GEO_P vec2 c0 = (floor(tc) + 0.5) * u_prevTexel;
  vec2 cx = vec2(u_prevTexel.x, 0.0);
  vec2 cy = vec2(0.0, u_prevTexel.y);
  float w00 = (1.0 - f.x) * (1.0 - f.y) * step(0.5, texture2D(u_chlorophyllTexture, c0).a);
  float w10 = f.x * (1.0 - f.y) * step(0.5, texture2D(u_chlorophyllTexture, c0 + cx).a);
  float w01 = (1.0 - f.x) * f.y * step(0.5, texture2D(u_chlorophyllTexture, c0 + cy).a);
  float w11 = f.x * f.y * step(0.5, texture2D(u_chlorophyllTexture, c0 + cx + cy).a);
  float wsum = w00 + w10 + w01 + w11;
  if (wsum < 0.0001) return plain;
  return (texture2D(u_wavePrevTexture, c0) * w00 + texture2D(u_wavePrevTexture, c0 + cx) * w10
        + texture2D(u_wavePrevTexture, c0 + cy) * w01 + texture2D(u_wavePrevTexture, c0 + cx + cy) * w11) / wsum;
}

`;
const MIX_AT = '  vec4 waveData = sampleWaveLandAware(data_uv);\n';
const MIX = `  // THE HOUR BLEND: for a moment after a step, the VALUES of the earlier hour and this one are mixed, then coloured below.
  if (u_hourPrevMix > 0.0) {
    GEO_P float pu = u_prevBounds_min.x > u_prevBounds_max.x
      ? mod(lng - u_prevBounds_min.x, 360.0) / max((u_prevBounds_max.x + 360.0) - u_prevBounds_min.x, 0.0001)
      : (lng - u_prevBounds_min.x) / max(u_prevBounds_max.x - u_prevBounds_min.x, 0.0001);
    GEO_P float pv = (lat - u_prevBounds_min.y) / max(u_prevBounds_max.y - u_prevBounds_min.y, 0.0001);
    if (pu >= 0.0 && pu <= 1.0 && pv >= 0.0 && pv <= 1.0) {   // outside the earlier grid, this field is drawn alone
      vec4 prevData = sampleWavePrev(ptReg(vec2(pu, pv), u_prev_reg));
      prevData.b *= u_prevHeightRatio;
      waveData = mix(waveData, prevData, u_hourPrevMix);
    }
  }
`;
const DEBUG_AT = "  if (u_debug_mode > 0.5) {\n    if (u_debug_mode < 1.5) { // 'uv' -> 1.0\n";
const DEBUG = `  if (u_debug_mode > 0.5) {
    if (u_debug_mode > 5.5) { // 'value' -> 6.0: the height byte as grey, no colour table (after the hour blend's mix)
      gl_FragColor = vec4(vec3(waveData.b), u_opacity);
      return;
    } else if (u_debug_mode < 1.5) { // 'uv' -> 1.0
`;

/** Is the hour blend asked for (the opt-in set to exactly true, the kill not)? Pure. One opt-in name for marine and wind. */
export function hourBlendEnabled(win = (typeof window !== 'undefined' ? window : {})) {
  return !!win && win.__RAW_ENABLE_HOUR_BLEND__ === true && win.__RAW_DISABLE_CREST_HOUR_BLEND__ !== true;
}

let loaded = false;
/** Did the colour shader get the blend's text when it loaded? False by default: then nothing can blend. */
export const hourBlendShaderLoaded = () => loaded;

/** `src` (the marine colour shader) with the hour blend's text when it is enabled at load; else `src` as it came. */
export function withHourBlend(src, win = (typeof window !== 'undefined' ? window : {})) {
  if (!hourBlendEnabled(win)) return src;
  if (typeof window !== 'undefined' && win === window) loaded = true;
  for (const anchor of [UNIFORMS_AT, FETCH_AT, MIX_AT, DEBUG_AT]) {
    if (src.split(anchor).length !== 2) throw new Error(`withHourBlend: expected exactly one "${anchor.trim().slice(0, 48)}"`);
  }
  return src
    .replace(UNIFORMS_AT, UNIFORMS_AT + UNIFORMS)
    .replace(FETCH_AT, FETCH + FETCH_AT)
    .replace(MIX_AT, MIX_AT + MIX)
    .replace(DEBUG_AT, DEBUG);
}
