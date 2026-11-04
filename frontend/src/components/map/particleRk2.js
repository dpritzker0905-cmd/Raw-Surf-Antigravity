/**
 * particleRk2.js: the MIDPOINT (RK2) step for both advect passes (wind ADVECT_FS, marine ADVECT_FS). ON by default.
 *
 * Each engine moved a particle by one Euler step, p' = p + h v(p). In a rotating field that step points along the tangent, so
 * every frame lands a little outside the circle and the particle spirals out: L4 (2026-11-02, Rankine vortex, core 15 px,
 * 30-frame life) measured +11% radius at 20 kn, +33% at 40 kn, +76% at 40 kn on a 30 Hz screen, +44% for a z2 hurricane.
 * The midpoint rule p' = p + h v(p + h v(p) / 2) cancels the first-order radial growth (per-step growth ~(omega h)^4 / 8), so the
 * circle holds. One extra field lookup per particle per frame; everything else of each pass (drop, respawn, land checks) still
 * reads the field at p, so only the step changes.
 *
 * The midpoint re-reads exactly what the Euler step read, minus the parts that cannot change within half a step:
 *   wind:   base texture, fine overlay (feathered), the speed gamma; the vortex gate (4 curl taps) is the one from p.
 *   marine: resident or ring-fill field, nearest-cell heading, height-capped drift, energy boost, confused-sea damping; a midpoint
 *           off the field (or calm) keeps the Euler step, which the pass then drops exactly as before.
 * Kill: window.__RAW_DISABLE_RK2_ADVECTION__ = true (u_rk2 = 0, particleState.js): the Euler step exactly.
 */
import { WAVE_HEIGHT_16M } from './marineWavePalette';
import { RK2_KILL } from './particleState';

// Set before the map loads, the kill leaves every splice empty (the shader text exactly as before); set later, u_rk2 = 0.
const WIN = typeof window === 'undefined' ? {} : window;
export const RK2_AT_LOAD = WIN[RK2_KILL] !== true;

const lngToTex = (lng, mn, mx) => `((${mn}.x > ${mx}.x) ? mod(${lng} - ${mn}.x, 360.0) / max((${mx}.x + 360.0) - ${mn}.x, 0.0001) `
  + `: (${lng} - ${mn}.x) / max(${mx}.x - ${mn}.x, 0.0001))`;

// Wind: spliced before ADVECT_FS's main(); every uniform it reads is declared above it.
const WIND_MID = `uniform float u_rk2;
vec2 windMidOffset(vec2 gp, float vortexGate) {
  float lng = gp.x * 360.0 - 180.0; float lat = mercatorYToLat(gp.y);
  float tex_u = ${lngToTex('lng', 'u_dataBounds_min', 'u_dataBounds_max')};
  float tex_v = (lat - u_dataBounds_min.y) / (u_dataBounds_max.y - u_dataBounds_min.y);
  vec2 wind = mix(u_wind_min, u_wind_max, texture2D(u_wind, ptReg(vec2(tex_u, tex_v), u_base_reg)).rg);
  if (u_fine_enabled > 0.5) {
    float f_u = ${lngToTex('lng', 'u_fineBounds_min', 'u_fineBounds_max')};
    float f_v = (lat - u_fineBounds_min.y) / (u_fineBounds_max.y - u_fineBounds_min.y);
    if (f_u > 0.0 && f_u < 1.0 && f_v > 0.0 && f_v < 1.0) {
      float fw = smoothstep(0.0, max(u_fine_feather_frac, 0.001), min(min(f_u, 1.0 - f_u), min(f_v, 1.0 - f_v)));
      wind = mix(wind, mix(u_fine_min, u_fine_max, texture2D(u_wind_fine, ptReg(vec2(f_u, f_v), u_fine_reg)).rg), fw);
    }
  }
  vec2 offset = (vec2(wind.x, -wind.y) / max(0.1, cos(lat * 3.141592653589793 / 180.0))) * u_speed_scale;
  float speedNorm = clamp(length(wind) / max(u_speed_max, 1.0), 0.02, 1.0);
  return offset * pow(speedNorm, mix(u_speed_gamma, 1.0, vortexGate) - 1.0);
}`;
export const WIND_RK2_GLSL = RK2_AT_LOAD ? WIND_MID : '';
export const WIND_RK2_STEP = RK2_AT_LOAD ? ' if (u_rk2 > 0.5) offset = windMidOffset(global_pos + 0.5 * offset, vortexGate);   // midpoint step (particleRk2.js)' : '';

// Marine: a prototype before main() and the body after it, so the body can read the height-scale declaration that
// withHeightScale (marineHeightEncoding.js) inserts right before main().
const H = WAVE_HEIGHT_16M ? 'waveHScale(uc ? u_heightScale.y : u_heightScale.x)' : '10.0';
export const MARINE_RK2_PROTO = RK2_AT_LOAD ? 'uniform float u_rk2; vec2 marineMidOffset(vec2 gp, vec2 k1);' : '';
const MARINE_MID = `
vec2 marineMidOffset(vec2 gp, vec2 k1) {
  float lng = ((u_wrapLng > 0.5) ? fract(gp.x) : gp.x) * 360.0 - 180.0; float lat = mercatorYToLat(gp.y);
  float tu = ${lngToTex('lng', 'u_dataBounds_min', 'u_dataBounds_max')};
  float tv = (lat - u_dataBounds_min.y) / max(u_dataBounds_max.y - u_dataBounds_min.y, 0.0001);
  float cu = ${lngToTex('lng', 'u_coarseBounds_min', 'u_coarseBounds_max')};
  float cv = (lat - u_coarseBounds_min.y) / max(u_coarseBounds_max.y - u_coarseBounds_min.y, 0.0001);
  bool inRes = !(tu < 0.0 || tu > 1.0 || tv < 0.0 || tv > 1.0);
  bool uc = (u_ringFillEnabled > 0.5) && !inRes && cu >= 0.0 && cu <= 1.0 && cv >= 0.0 && cv <= 1.0;
  if (!inRes && !uc) return k1;
  vec4 wd = uc ? texture2D(u_coarseWaveTexture, vec2(cu, cv)) : texture2D(u_waveTexture, ptReg(vec2(tu, tv), u_wave_reg));
  vec2 wv = wd.rg * 2.0 - 1.0; float coh = length(wv);
  if (u_coarseNearestDir > 0.5 && !uc) {
    vec2 cell = min(floor(ptReg(vec2(tu, tv), u_wave_reg) * u_waveGridSize), u_waveGridSize - 1.0);
    wv = texture2D(u_waveTexture, (cell + 0.5) / max(u_waveGridSize, vec2(1.0))).rg * 2.0 - 1.0;
  }
  wv.y = -wv.y;
  float h = wd.b * ${H};
  if (h < 0.01 || length(wv) < 0.005) return k1;
  vec2 off = (wv * min(h, u_speedHeightCap) * 0.1 / max(0.1, cos(lat * 3.141592653589793 / 180.0))) * u_speed_scale
    * (1.0 + smoothstep(1.0, 5.0, h) * 0.3);
  if (u_dirCoherenceMin > 0.001) off = off * mix(0.35, 1.0, smoothstep(0.0, u_dirCoherenceMin, coh));
  return off;
}
`;
export const MARINE_RK2_GLSL = RK2_AT_LOAD ? MARINE_MID : '';
export const MARINE_RK2_STEP = RK2_AT_LOAD ? 'if (u_rk2 > 0.5) offset = marineMidOffset(global_pos + 0.5 * offset, offset);   // midpoint step (particleRk2.js)' : '';

/** JS mirror for the tests: one step of either rule through a velocity field v(x, y) -> [vx, vy] (h folded into v). */
export function advectStep(p, v, rk2) {
  const k1 = v(p[0], p[1]);
  if (!rk2) return [p[0] + k1[0], p[1] + k1[1]];
  const k2 = v(p[0] + 0.5 * k1[0], p[1] + 0.5 * k1[1]);
  return [p[0] + k2[0], p[1] + k2[1]];
}
