/**
 * GUST COLOUR for the wind particle engine (gustParticles.js has the why). With a gust field set, the engine's marks move on
 * the wind exactly as before and take their COLOUR from the gust speed at their own position; the engine's heatmap pass is
 * skipped (the gust raster is the field). No gust field = the Wind layer, byte for byte.
 *
 * GPU: one LUMINANCE byte per cell (WebGL1 and WebGL2 alike, so every phone runs the same path), LINEAR filtered, texture unit 6
 * (units 0-3 are the engine's own, 5 the land mask). Byte 0 = no gust data at that cell: the shader keeps the wind speed there.
 */
import { encodeGustTexture } from './gustParticles';

export const GUST_UNIT = 6;
/** The gust colour ramp's top: the gust heatmap's own LUT spans 0-75 kn (gustPalette.js), so a knot draws one colour in both. */
export const GUST_RAMP_MAX_KN = 75;

/**
 * GUST MODE is keyed on the layer the user PICKED (setGustMode, from WebGLWindLayer's gustColour prop), never on whether a gust
 * texture happens to be loaded (advisor hold on #1079): with Gusts picked and no gust frame resident, the engine draws nothing
 * (gustModeBlank), so wind is never shown under the Gusts label; the gust raster's own status line says loading / unavailable.
 */
export function setGustMode(engine, on) {
  if (engine) engine._gustMode = !!on;
}

/** True while the engine colours by gust: Gusts picked AND a gust texture resident. */
export function gustColourActive(engine) {
  return !!(engine && engine._gustMode && engine._gust && engine._gust.tex);
}

/** Gusts picked but no gust frame resident (loading, or past the gust range): draw no heatmap and no marks. */
export function gustModeBlank(engine) {
  return !!(engine && engine._gustMode) && !(engine._gust && engine._gust.tex);
}

/** The ramp's top speed for this frame: the gust ramp's in gust mode, the wind's own otherwise. */
export function rampMaxFor(engine) {
  return gustColourActive(engine) ? GUST_RAMP_MAX_KN : engine._maxWindSpeed;
}

/** Upload (or clear, with null) the gust field the raster layer has on screen. Re-uses the texture when the size matches. */
export function setGustField(engine, gl, field) {
  if (!engine || !gl) return;
  if (!field) { clearGustField(engine, gl); return; }
  const enc = encodeGustTexture(field, GUST_RAMP_MAX_KN);
  if (!enc) { clearGustField(engine, gl); return; }
  const prev = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const prevAlign = gl.getParameter(gl.UNPACK_ALIGNMENT);
  let g = engine._gust;
  const sameSize = g && g.tex && g.cols === enc.cols && g.rows === enc.rows;
  if (!sameSize) {
    if (g && g.tex) gl.deleteTexture(g.tex);
    g = { tex: gl.createTexture(), cols: enc.cols, rows: enc.rows };
  }
  gl.bindTexture(gl.TEXTURE_2D, g.tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (sameSize) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, enc.cols, enc.rows, gl.LUMINANCE, gl.UNSIGNED_BYTE, enc.bytes);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, enc.cols, enc.rows, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, enc.bytes);
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, prevAlign);
  gl.bindTexture(gl.TEXTURE_2D, prev);
  const b = enc.bounds;
  engine._gust = { ...g, bounds: { west: b.west, south: b.south, east: b.east, north: b.north }, maxKn: enc.maxKn,
    validMs: field.validMs };
}

export function clearGustField(engine, gl) {
  const g = engine && engine._gust;
  if (g && g.tex && gl) { try { gl.deleteTexture(g.tex); } catch (e) { /* context gone */ } }
  if (engine) engine._gust = null;
}

/**
 * Bind the gust uniforms on the particle draw program. Off (u_gust_on = 0) outside gust mode, so the Wind layer's shader path
 * is unchanged. The lattice is cell-centred: texel (0,0) is the SW node, so the shader maps a longitude to
 * (lon - west) / (east - west) * (cols - 1) / cols + 0.5 / cols (and likewise latitude).
 */
export function bindGustColour(gl, program, engine) {
  const on = gustColourActive(engine);
  gl.uniform1f(gl.getUniformLocation(program, 'u_gust_on'), on ? 1 : 0);   // the vertex stage's switch
  gl.uniform1f(gl.getUniformLocation(program, 'u_gust_fs'), on ? 1 : 0);   // the fragment stage's own (gustShaderSplice.js: never shared)
  if (!on) return;
  const g = engine._gust;
  gl.activeTexture(gl.TEXTURE0 + GUST_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, g.tex);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(gl.getUniformLocation(program, 'u_gust'), GUST_UNIT);
  gl.uniform4f(gl.getUniformLocation(program, 'u_gust_box'), g.bounds.west, g.bounds.south, g.bounds.east, g.bounds.north);
  gl.uniform2f(gl.getUniformLocation(program, 'u_gust_size'), g.cols, g.rows);
  gl.uniform1f(gl.getUniformLocation(program, 'u_gust_max'), g.maxKn);
  const fl = gustFlicker();
  gl.uniform4f(gl.getUniformLocation(program, 'u_gust_flick'), fl.on ? 1 : 0, fl.seconds, fl.hz, fl.depth);
}

/**
 * GUST FLICKER: where the gust factor G/W runs high (1.3 -> 2.2), a mark's light pulses on its own random phase, so gusty air
 * reads as restless and steady air as steady WITHOUT relying on colour (ACCESSIBILITY mandate; Reflection Beam's advice). The
 * marks still move on the mean wind. 0.9 Hz (well under the 3 Hz flash limit) and at most 35% dimmer at the trough.
 * Off under prefers-reduced-motion. Kill: window.__RAW_DISABLE_GUST_FLICKER__ = true.
 */
export const GUST_FLICKER_HZ = 0.9;
export const GUST_FLICKER_DEPTH = 0.35;
export function gustFlicker(win = (typeof window !== 'undefined' ? window : null), nowMs = Date.now()) {
  let on = !(win && win.__RAW_DISABLE_GUST_FLICKER__ === true);
  try { if (on && win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches) on = false; } catch (e) { /* no media queries */ }
  // seconds modulo a whole number of periods, so float32 in the shader never loses the phase over a long session
  const period = 1000 / GUST_FLICKER_HZ * 100;
  return { on, seconds: (nowMs % period) / 1000, hz: GUST_FLICKER_HZ, depth: GUST_FLICKER_DEPTH };
}
