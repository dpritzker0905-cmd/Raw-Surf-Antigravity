/**
 * GUST HATCH (A/B candidate 'hatch', gustCue in windGustColour.js): a static diagonal hatch over the field where the gust
 * factor G/W >= 1.5, cross-hatched where G/W >= 2.0, so gusty air reads WITHOUT colour (ACCESSIBILITY mandate) and without
 * any motion (it stays under prefers-reduced-motion; nothing pulses, so WCAG 2.3 is moot). The marks still move on the mean
 * wind and nothing here touches them.
 *
 * Drawn by the wind engine in the slot its own heatmap pass leaves free in gust mode (the gust raster is the field), under
 * the particles, from the two textures the engine already holds: the gust byte texture (unit 6) and the wind it advects on
 * (base, plus the fine grid where resident: the same field the marks' G/W reads in gustShaderSplice.js).
 *
 * Geometry: one quad over the gust box per world copy, in Web Mercator; the fragment stage inverts Mercator for latitude,
 * so a quad (not a mesh) is exact. Lines are in DEVICE pixels at a constant CSS spacing (8 px desktop, 12 px on a phone),
 * ANCHORED TO THE MAP: their phase is taken from a fixed Mercator point's screen position, so the hatch pans with the map.
 *
 * Kill: window.__RAW_DISABLE_GUST_HATCH__ = true (gustCue then falls back to no cue).
 */
import { createShader, createProgram, bindTexture, bindWindPointReg } from './WebGLWindUtils';
import { GLSL_PT_REG } from './gridPointRegistration';
import { GUST_UNIT, gustCue } from './windGustColour';
import { blendIntoMap } from './windCanvasAlpha';

export const GUST_HATCH = Object.freeze({
  gusty: 1.5,           // single hatch from here (G/W)
  veryGusty: 2.0,       // cross-hatch from here
  edge: 0.08,           // soft threshold half-width (G/W units)
  lineCss: 1.25,        // line width, CSS px
  spacingCss: 8,        // desktop line spacing, CSS px
  spacingPhoneCss: 12,  // phone (CSS width < 768) line spacing
  // ink per theme (linear-ish sRGB 0..1) and alpha: tuned on the composited raster (audit/gust-cue-ab-2026-11-22)
  ink: { dark: [1, 1, 1], light: [0.04, 0.09, 0.22], beach: [0.16, 0.11, 0.05] },
  alpha: { dark: 0.30, light: 0.34, beach: 0.34 },
});

const VS = `
attribute vec2 a_pos;            // 0..1 across the gust box
uniform mat4 u_matrix;
uniform vec4 u_box;              // west, south, east (unwrapped), north of the gust box, degrees
uniform float u_lng_offset;
uniform vec2 u_screen;           // device px
varying vec2 v_merc; varying vec2 v_px;
void main() {
  float lng = mix(u_box.x, u_box.z, a_pos.x) + u_lng_offset;
  float lat = clamp(mix(u_box.y, u_box.w, a_pos.y), -85.0511, 85.0511);
  float x = (lng + 180.0) / 360.0;
  float y = (1.0 - log(tan(radians(lat)) + 1.0 / cos(radians(lat))) / 3.141592653589793) / 2.0;
  gl_Position = u_matrix * vec4(x, y, 0.0, 1.0);
  v_merc = vec2(x - u_lng_offset / 360.0, y);
  v_px = (gl_Position.xy / gl_Position.w * 0.5 + 0.5) * u_screen;
}`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_merc; varying vec2 v_px;
uniform sampler2D u_gust; uniform vec4 u_gust_box; uniform vec2 u_gust_size; uniform float u_gust_max;
uniform sampler2D u_wind; uniform vec2 u_wind_min; uniform vec2 u_wind_max; uniform vec4 u_wind_box;
uniform sampler2D u_wind_fine; uniform vec2 u_fine_min; uniform vec2 u_fine_max; uniform vec4 u_fine_box; uniform float u_fine_on;
uniform vec4 u_hatch;            // spacing (device px), line width (device px), anchor phase (x+y), anchor phase (x-y)
uniform vec4 u_thresh;           // gusty, very gusty, edge, unused
uniform vec4 u_ink;              // rgb, alpha
uniform vec4 u_base_reg; uniform vec4 u_fine_reg;   // point registration, as the marks sample the wind (gridPointRegistration.js)
${GLSL_PT_REG}
float boxFrac(float lng, float lat, vec4 b, out vec2 f) {
  f = vec2(mod(lng - b.x + 720.0, 360.0) / max(b.z - b.x, 1e-3), (lat - b.y) / max(b.w - b.y, 1e-3));
  return step(0.0, f.x) * step(f.x, 1.0) * step(0.0, f.y) * step(f.y, 1.0);
}
float lineAt(float d, float spacing, float width) {
  float m = abs(fract(d / spacing) - 0.5) * spacing;   // distance (px) to the nearest line centre is spacing/2 - m
  float dist = spacing * 0.5 - m;
  return 1.0 - smoothstep(width * 0.5 - 0.5, width * 0.5 + 0.5, dist);
}
void main() {
  float lng = v_merc.x * 360.0 - 180.0;
  float e = 3.141592653589793 * (1.0 - 2.0 * v_merc.y);
  float lat = degrees(atan(0.5 * (exp(e) - exp(-e))));
  vec2 gf; float inG = boxFrac(lng, lat, u_gust_box, gf);
  if (inG < 0.5) discard;
  float gb = texture2D(u_gust, (clamp(gf, 0.0, 1.0) * (u_gust_size - 1.0) + 0.5) / u_gust_size).r * 255.0;
  if (gb < 1.0) discard;                                // no gust data here
  float gust = (gb - 1.0) / 254.0 * u_gust_max;
  vec2 wf; boxFrac(lng, lat, u_wind_box, wf);
  vec2 wind = mix(u_wind_min, u_wind_max, texture2D(u_wind, ptReg(clamp(wf, 0.0, 1.0), u_base_reg)).rg);
  if (u_fine_on > 0.5) {
    vec2 ff; float inF = boxFrac(lng, lat, u_fine_box, ff);
    if (inF > 0.5) wind = mix(u_fine_min, u_fine_max, texture2D(u_wind_fine, ptReg(ff, u_fine_reg)).rg);
  }
  float gw = gust / max(length(wind), 2.0);             // the marks' own gust factor (gustShaderSplice.js)
  float one = smoothstep(u_thresh.x - u_thresh.z, u_thresh.x + u_thresh.z, gw);
  float two = smoothstep(u_thresh.y - u_thresh.z, u_thresh.y + u_thresh.z, gw);
  if (one <= 0.0) discard;
  float a = lineAt(v_px.x + v_px.y + u_hatch.z, u_hatch.x, u_hatch.y) * one;
  float b = lineAt(v_px.x - v_px.y + u_hatch.w, u_hatch.x, u_hatch.y) * two;
  float cover = max(a, b) * u_ink.a;
  if (cover <= 0.0) discard;
  gl_FragColor = vec4(u_ink.rgb * cover, cover);        // premultiplied
}`;

/** The hatch geometry for this frame (pure; exported for tests): device-px spacing and line width, map-anchored phases. */
export function hatchGeometry(matrix, screenW, screenH, dpr) {
  const d = Math.max(1, Math.min(3, dpr || 1));
  const phone = screenW / d < 768;
  const spacing = (phone ? GUST_HATCH.spacingPhoneCss : GUST_HATCH.spacingCss) * d;
  const width = Math.max(1, GUST_HATCH.lineCss * d);
  // anchor: the screen position (device px) of Mercator (0.5, 0.5), in double precision; the hatch phase follows it
  const m = matrix;
  const cx = m[0] * 0.5 + m[4] * 0.5 + m[12], cy = m[1] * 0.5 + m[5] * 0.5 + m[13], cw = m[3] * 0.5 + m[7] * 0.5 + m[15];
  const ax = (cx / cw * 0.5 + 0.5) * screenW, ay = (cy / cw * 0.5 + 0.5) * screenH;
  const mod = (v) => ((v % spacing) + spacing) % spacing;
  return { spacing, width, phaseSum: mod(-(ax + ay)), phaseDiff: mod(-(ax - ay)), phone };
}

function programFor(engine, gl) {
  if (engine._gustHatch && engine._gustHatch.gl === gl) return engine._gustHatch;
  const vs = createShader(gl, gl.VERTEX_SHADER, VS); const fs = createShader(gl, gl.FRAGMENT_SHADER, FS);
  const prog = vs && fs ? createProgram(gl, vs, fs) : null;
  const buf = gl.createBuffer();
  const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
  engine._gustHatch = { gl, prog, buf };
  return engine._gustHatch;
}

/**
 * Draw the hatch (gust mode only; a no-op unless the 'hatch' cue is picked). ctx: { fbo, matrix, screenW, screenH, dpr, theme, offsets,
 * wind: { texture, uMin, uMax, box, grid }, fine: { texture, uMin, uMax, bounds, windGrid } | null }. Leaves blend on.
 */
export function drawGustHatch(gl, engine, ctx) {
  const g = engine && engine._gust;
  if (!gl || !g || !g.tex || g.sea || !ctx || !ctx.wind || !ctx.wind.texture || gustCue() !== 'hatch') return false;
  const h = programFor(engine, gl);
  if (!h.prog) return false;
  const P = h.prog; const U = (n) => gl.getUniformLocation(P, n);
  if (ctx.fbo !== undefined) { gl.bindFramebuffer(gl.FRAMEBUFFER, ctx.fbo); gl.viewport(0, 0, ctx.screenW, ctx.screenH); }   // the map's own target
  const dpr = ctx.dpr || (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const geo = hatchGeometry(ctx.matrix, ctx.screenW, ctx.screenH, dpr);
  const theme = ctx.theme === 'light' || ctx.theme === 'beach' ? ctx.theme : 'dark';
  gl.useProgram(P);
  if (gl.bindVertexArray) gl.bindVertexArray(null);
  gl.enable(gl.BLEND); blendIntoMap(gl, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied ink; the map canvas's alpha rule
  gl.uniformMatrix4fv(U('u_matrix'), false, ctx.matrix);
  const b = g.bounds; const east = b.east < b.west ? b.east + 360 : b.east;
  gl.uniform4f(U('u_box'), b.west, b.south, east, b.north);
  gl.uniform2f(U('u_screen'), ctx.screenW, ctx.screenH);
  gl.activeTexture(gl.TEXTURE0 + GUST_UNIT); gl.bindTexture(gl.TEXTURE_2D, g.tex); gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(U('u_gust'), GUST_UNIT);
  gl.uniform4f(U('u_gust_box'), b.west, b.south, east, b.north);
  gl.uniform2f(U('u_gust_size'), g.cols, g.rows);
  gl.uniform1f(U('u_gust_max'), g.maxKn);
  bindTexture(gl, ctx.wind.texture, 0); gl.uniform1i(U('u_wind'), 0);
  gl.uniform2f(U('u_wind_min'), ctx.wind.uMin[0], ctx.wind.uMin[1]); gl.uniform2f(U('u_wind_max'), ctx.wind.uMax[0], ctx.wind.uMax[1]);
  const wb = ctx.wind.box; gl.uniform4f(U('u_wind_box'), wb[0], wb[1], wb[2] < wb[0] ? wb[2] + 360 : wb[2], wb[3]);
  const f = ctx.fine;
  gl.uniform1f(U('u_fine_on'), f && f.texture ? 1 : 0);
  if (f && f.texture) {
    bindTexture(gl, f.texture, 2); gl.uniform1i(U('u_wind_fine'), 2);
    gl.uniform2f(U('u_fine_min'), f.uMin[0], f.uMin[1]); gl.uniform2f(U('u_fine_max'), f.uMax[0], f.uMax[1]);
    const fb = f.bounds; gl.uniform4f(U('u_fine_box'), fb.west, fb.south, fb.east < fb.west ? fb.east + 360 : fb.east, fb.north);
  } else {
    gl.uniform1i(U('u_wind_fine'), 0);
  }
  bindWindPointReg(gl, P, ctx.wind.grid, f && f.windGrid);
  gl.uniform4f(U('u_hatch'), geo.spacing, geo.width, geo.phaseSum, geo.phaseDiff);
  gl.uniform4f(U('u_thresh'), GUST_HATCH.gusty, GUST_HATCH.veryGusty, GUST_HATCH.edge, 0);
  const ink = GUST_HATCH.ink[theme];
  gl.uniform4f(U('u_ink'), ink[0], ink[1], ink[2], GUST_HATCH.alpha[theme]);
  const loc = gl.getAttribLocation(P, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, h.buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const offU = U('u_lng_offset');
  for (const off of (ctx.offsets || [0])) { gl.uniform1f(offU, off); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  gl.disableVertexAttribArray(loc);
  return true;
}
