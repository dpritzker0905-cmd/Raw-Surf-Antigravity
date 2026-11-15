/**
 * THE WIND HOUR BLEND's shader text (windHourBlend.js), added to the three wind shaders that read the base field as a wrapper.
 * The blend is OFF BY DEFAULT (the owner, 2026-11-15: off until the real-frame test and his blinded look): the text is added
 * only when window.__RAW_ENABLE_HOUR_BLEND__ === true BEFORE the shaders load and the kill is not set. Otherwise each shader is
 * returned as it came, byte for byte. The plain text is kept either way (windPlainShader): a device below the blend's texture
 * limits, or one whose driver refuses the blended shaders, compiles the plain ones (WebGLWindEngineInit.js).
 * With the text loaded, the kill set later in the console works through the uniform: u_windPrevMix stays 0 and the earlier
 * field is never read.
 *
 * Two insertions per shader, each on an anchor that must occur exactly once (a throw at module load otherwise):
 *   1. the uniforms, after the base field's own range
 *   2. the mix, straight after the base field is decoded: the u/v VECTORS are mixed, each decoded with its own range, and
 *      everything below (the fine overlay, the advection, the colour) reads the mixed vector
 * `uv` names the variable that holds this grid's texture coordinate at that point of the shader.
 */
const DECL = (maxLine) => `${maxLine}uniform sampler2D u_windPrev;     // THE HOUR BLEND (windHourBlend.js): the base field that was on screen before the step
uniform float u_windPrevMix;      // how much of it to draw: 1 at the step, 0 at rest (then it is not read)
uniform vec2 u_windPrev_min;      // its own u,v range
uniform vec2 u_windPrev_max;
uniform vec4 u_windPrevMap;       // this grid's uv -> its uv: scale.xy, offset.zw (it may be another grid)
uniform vec4 u_windPrev_reg;      // its point registration
`;
const MIX = (decodeLine, uv) => `${decodeLine}  // THE HOUR BLEND: for a moment after a step the u/v VECTORS of the earlier field and this one are mixed.
  if (u_windPrevMix > 0.0) {
    vec2 prevUv = u_windPrevMap.zw + ${uv} * u_windPrevMap.xy;
    if (prevUv.x >= 0.0 && prevUv.x <= 1.0 && prevUv.y >= 0.0 && prevUv.y <= 1.0) {   // outside the earlier grid, this field alone
      vec2 prevWind = mix(u_windPrev_min, u_windPrev_max, texture2D(u_windPrev, ptReg(prevUv, u_windPrev_reg)).rg);
      wind = mix(wind, prevWind, u_windPrevMix);
    }
  }
`;

// The lab's value view of the colour field (window.__GPU_DEBUG__.mode = 'value'): the MIXED u, v as red, green, scaled by this
// texture's own range, no colour table. After the mix, so it shows what the blend draws.
const VALUE_VIEW = `  if (u_debug_mode > 9.5) { // 'value' -> 10.0
    gl_FragColor = vec4(clamp((wind - u_wind_min) / max(u_wind_max - u_wind_min, vec2(0.0001)), 0.0, 1.0), 0.0, 1.0);
    return;
  }
`;

const SITES = {
  advect: { max: 'uniform vec2 u_wind_max;          // max u,v values for decoding\n', decode: '  vec2 wind = mix(u_wind_min, u_wind_max, vec2(windData.r, windData.g));\n', uv: 'tex_uv' },
  draw: { max: 'uniform vec2 u_wind_max;\n', decode: '  vec2 wind = mix(u_wind_min, u_wind_max, vec2(windColor.r, windColor.g));\n', uv: 'tex_uv' },
  field: { max: 'uniform vec2 u_wind_max;\n', decode: '  vec2 wind = mix(u_wind_min, u_wind_max, encoded.rg);\n', uv: 'v_uv' },
};

/** Is the hour blend asked for (the opt-in set, the kill not)? Pure. */
export function windHourBlendEnabled(win = (typeof window !== 'undefined' ? window : {})) {
  return !!win && win.__RAW_ENABLE_HOUR_BLEND__ === true && win.__RAW_DISABLE_WIND_HOUR_BLEND__ !== true;
}

const PLAIN = {};
let loaded = false;
/** The shader as it was before the wrapper ('advect' | 'draw' | 'field'). */
export const windPlainShader = (which) => PLAIN[which];
/** Did any wind shader get the blend's text at load? False by default: then nothing can blend. */
export const windBlendShadersLoaded = () => loaded;

/** `src` (one of the wind shaders: 'advect', 'draw' or 'field') with the hour blend's text when it is enabled at load; else as it came. */
export function withWindHourBlend(src, which, win = (typeof window !== 'undefined' ? window : {})) {
  const s = SITES[which];
  if (!s) throw new Error(`withWindHourBlend: unknown shader "${which}"`);
  PLAIN[which] = src;
  if (!windHourBlendEnabled(win)) return src;
  loaded = true;
  for (const anchor of [s.max, s.decode]) {
    if (src.split(anchor).length !== 2) throw new Error(`withWindHourBlend(${which}): expected exactly one "${anchor.trim().slice(0, 56)}"`);
  }
  return src.replace(s.max, DECL(s.max)).replace(s.decode, MIX(s.decode, s.uv) + (which === 'field' ? VALUE_VIEW : ''));
}
