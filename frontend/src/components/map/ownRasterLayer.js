/**
 * ownRasterLayer.js — a MapLibre custom layer that draws one raster field from our own frames (ownRasterFrames.js), in
 * MapLibre's shared GL context (2026-10-23; phase 1: GFS pressure, dark).
 *
 * HOW IT DRAWS. Each decoded frame is ONE resident R32F texture (720 x 361 x 4 B = 1 MB; at most RESIDENT_MAX). A scrub step
 * only rebinds a different texture: a hard cut on the first frame the wanted field is resident, nothing in between (no
 * cross-fade, no mixed hours, no blank). Until then the shown frame stays (the status line says so). The fragment shader
 * turns each pixel's mercator position into lat/lon, samples the field bilinearly (texelFetch, the 0.5-degree grid wraps at
 * the antimeridian), and looks the value up in a step LUT baked from the SAME colour scale the .om path draws
 * (CUSTOM_COLOR_SCALES.pressure_msl, theme-applied; the tile library's rule: the colour of the largest breakpoint <= value),
 * at the frame's own 0.1 hPa resolution. Opacity follows the slot paint's zoom ramp (MapWebGL).
 * ISOBARS: the .om URL asks for contours, but no app layer draws them (contours land in vector tiles nobody reads), so today's
 * pressure layer has none. They are a lever here, OFF by default (parity): window.__RAW_OWN_RASTER_ISOBARS__ = 4 (hPa).
 *
 * GL STATE. MapLibre 5.24's drawCustom calls context.setDirty() + painter.setBaseState() after prerender AND render, so every
 * value MapLibre tracks (program, VAO, blend, textures, viewport, unpack state, framebuffer) is re-applied after this layer;
 * capturing and restoring them (WebGLStateIsolation, 7+ synchronous reads a frame) would buy nothing. So: NO getParameter or
 * other synchronous read per frame; uniform locations are cached at init; every GL call happens inside prerender/render
 * (never from a promise), so MapLibre's state cache is never wrong. Uploads run in prerender, at most UPLOADS_PER_FRAME.
 * CONTEXT LOSS (marineFrameStoreGpu's lesson: calls on dead objects fail without throwing): the canvas's webglcontextlost
 * event drops every GL object; on webglcontextrestored the program, LUT and resident fields are rebuilt lazily from the
 * CPU-held fields.
 */
export const RESIDENT_MAX = 6;
const UPLOADS_PER_FRAME = 1;

// ── pure helpers (unit-tested) ───────────────────────────────────────────────────────────────────────────────────
/** The tile library's breakpoint colour: colors[largest i with breakpoints[i] <= v], clamped to the first. */
export function colorAtValue(scale, v) {
  const bp = scale.breakpoints;
  let lo = 0; let hi = bp.length - 1; let best = -1;
  while (lo <= hi) { const mid = (lo + hi) >>> 1; if (bp[mid] <= v) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return scale.colors[Math.max(0, best)];
}

export const PRESSURE_LUT = { min: 870, step: 0.1, n: 2200 };   // 870-1090 hPa at the frame's 0.1 hPa codes

/** RGBA8 (straight alpha) LUT: entry k = the colour of value min + k * step. */
export function buildStepLut(scale, { min, step, n } = PRESSURE_LUT) {
  const out = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    const c = colorAtValue(scale, Math.round((min + k * step) * 1e6) / 1e6);
    out[k * 4] = c[0]; out[k * 4 + 1] = c[1]; out[k * 4 + 2] = c[2];
    out[k * 4 + 3] = Math.round(Math.max(0, Math.min(1, c[3] === undefined ? 1 : c[3])) * 255);
  }
  return out;
}

// MapWebGL's pressure slot ramp ('raster-opacity' interpolate linear over zoom; pinned by ownRasterLayer.test.js).
export const PRESSURE_OPACITY_STOPS = [[2, 0.35], [5, 0.42], [8, 0.48], [12, 0.55]];
export function opacityAtZoom(stops, z) {
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, o1] = stops[i];
    if (z <= z1) { const [z0, o0] = stops[i - 1]; return o0 + ((z - z0) / (z1 - z0)) * (o1 - o0); }
  }
  return stops[stops.length - 1][1];
}

/** Is the grid a full circle with no repeated column (so columns wrap)? */
export function wrapsLongitude(field) {
  const { cols, bounds } = field;
  const dLon = (bounds.east - bounds.west) / (cols - 1);
  return Math.abs(cols * dLon - 360) < dLon * 0.01;
}

// ── shaders ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const VS = `#version 300 es
in vec2 a_pos;
uniform mat4 u_matrix;
out vec2 v_merc;
void main() { v_merc = a_pos; gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0); }`;

export const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_merc;
uniform sampler2D u_field;
uniform sampler2D u_lut;
uniform vec4 u_grid;      // west, south, dLon, dLat (cell-centre lattice)
uniform vec3 u_size;      // cols, rows, wraps (1 = columns wrap at the antimeridian)
uniform vec3 u_lutMap;    // min, step, n
uniform float u_opacity;
uniform vec2 u_iso;       // interval (0 = off), line width px
uniform vec4 u_isoColor;  // straight rgba
out vec4 fragColor;
const float PI = 3.141592653589793;
float node(int c, int r) { return texelFetch(u_field, ivec2(c, r), 0).r; }
void main() {
  float lon = fract(v_merc.x) * 360.0 - 180.0;
  float lat = degrees(atan(sinh(PI * (1.0 - 2.0 * v_merc.y))));
  float fx = (lon - u_grid.x) / u_grid.z;
  float fy = clamp((lat - u_grid.y) / u_grid.w, 0.0, u_size.y - 1.0);
  int c0; int c1; float tx;
  if (u_size.z > 0.5) {
    float x0 = floor(fx); tx = fx - x0;
    c0 = int(mod(x0, u_size.x)); c1 = int(mod(x0 + 1.0, u_size.x));
  } else {
    if (fx < 0.0 || fx > u_size.x - 1.0) discard;
    float x0 = min(floor(fx), u_size.x - 2.0); tx = fx - x0;
    c0 = int(x0); c1 = c0 + 1;
  }
  float y0 = min(floor(fy), u_size.y - 2.0); float ty = fy - y0;
  int r0 = int(y0); int r1 = r0 + 1;
  float a = node(c0, r0); float b = node(c1, r0); float c = node(c0, r1); float d = node(c1, r1);
  if (min(min(a, b), min(c, d)) < 0.0) discard;
  float v = mix(mix(a, b, tx), mix(c, d, tx), ty);
  float k = clamp(floor((v - u_lutMap.x) / u_lutMap.y + 1e-3), 0.0, u_lutMap.z - 1.0);
  vec4 col = texelFetch(u_lut, ivec2(int(k), 0), 0);
  float alpha = col.a * u_opacity;
  vec4 outc = vec4(col.rgb * alpha, alpha);
  if (u_iso.x > 0.0) {
    float q = v / u_iso.x;
    float dist = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), 1e-6);
    float la = (1.0 - smoothstep(0.5 * u_iso.y, 0.5 * u_iso.y + 1.0, dist)) * u_isoColor.a;
    outc = vec4(u_isoColor.rgb * la, la) + (1.0 - la) * outc;
  }
  fragColor = outc;
}`;

// ── the layer ────────────────────────────────────────────────────────────────────────────────────────────────────────
function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

/**
 * createOwnRasterLayer({ id, opacityStops, isobarColor(theme) }) -> a MapLibre custom layer with:
 *   setLut(Uint8Array, lutMap), offerField(path, field), want(path), isResident(path), shownPath(), onShown(fn), disposed.
 */
export function createOwnRasterLayer({ id, opacityStops = PRESSURE_OPACITY_STOPS, lutMap = PRESSURE_LUT, onFail = null } = {}) {
  const st = {
    map: null, gl: null, canvas: null, lost: false, ready: false, failed: false,
    prog: null, vao: null, buf: null, loc: null, lutTex: null, lut: null, lutDirty: false, lutMap,
    resident: new Map(),       // path -> { tex, field }
    pending: new Map(),        // path -> field waiting for upload
    wantPath: null, shown: null, onShown: null,
    isoColor: [1, 1, 1, 0.55],
  };

  const dropGl = () => {
    st.ready = false; st.prog = null; st.vao = null; st.buf = null; st.loc = null; st.lutTex = null; st.lutDirty = !!st.lut;
    for (const [p, r] of st.resident) st.pending.set(p, r.field);   // re-upload from the CPU copy after a restore
    st.resident.clear();
  };
  const onLost = (e) => { st.lost = true; dropGl(); if (e && e.preventDefault) e.preventDefault(); };
  const onRestored = () => { st.lost = false; };
  // This device cannot draw it (no WebGL2, a failed compile or link): say so once, so the caller hands the layer back to .om.
  const fail = (why) => {
    if (st.failed) return;
    st.failed = true;
    if (onFail) { try { onFail(why); } catch (e) { /* the caller's */ } }
  };

  function init(gl) {
    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    // One status read at init (never per frame): a failed link means this device cannot draw it; the caller falls back.
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { fail('link'); return false; }
    st.prog = prog;
    st.loc = {};
    for (const u of ['u_matrix', 'u_field', 'u_lut', 'u_grid', 'u_size', 'u_lutMap', 'u_opacity', 'u_iso', 'u_isoColor']) {
      st.loc[u] = gl.getUniformLocation(prog, u);
    }
    st.vao = gl.createVertexArray();
    gl.bindVertexArray(st.vao);
    st.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, st.buf);
    // Mercator x from -2 to 3 covers the world copies a wide low-zoom view shows; y 0..1 is the whole mercator square.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-2, 0, 3, 0, -2, 1, 3, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    st.ready = true;
    return true;
  }

  function uploadLut(gl) {
    if (!st.lutTex) st.lutTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, st.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, st.lutMap.n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, st.lut);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    st.lutDirty = false;
  }

  function uploadField(gl, path, field) {
    const reuse = st.resident.size >= RESIDENT_MAX ? evictOne() : null;
    const tex = reuse || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, field.cols, field.rows, 0, gl.RED, gl.FLOAT, field.values);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    st.resident.set(path, { tex, field });
  }

  // The least useful resident texture: never the shown or the wanted one; the oldest otherwise (Map order = upload order).
  function evictOne() {
    for (const [p, r] of st.resident) {
      if (p === st.shown || p === st.wantPath) continue;
      st.resident.delete(p);
      return r.tex;
    }
    return null;
  }

  const layer = {
    id, type: 'custom', renderingMode: '2d',
    onAdd(map, gl) {
      st.map = map; st.gl = gl;
      st.canvas = map.getCanvas ? map.getCanvas() : null;
      if (!gl || typeof gl.createVertexArray !== 'function' || typeof gl.texStorage2D !== 'function') { fail('webgl1'); return; }
      if (st.canvas) { st.canvas.addEventListener('webglcontextlost', onLost); st.canvas.addEventListener('webglcontextrestored', onRestored); }
    },
    onRemove() {
      if (st.canvas) { st.canvas.removeEventListener('webglcontextlost', onLost); st.canvas.removeEventListener('webglcontextrestored', onRestored); }
      const gl = st.gl;
      if (gl && !st.lost) {
        for (const r of st.resident.values()) gl.deleteTexture(r.tex);
        if (st.lutTex) gl.deleteTexture(st.lutTex);
        if (st.buf) gl.deleteBuffer(st.buf);
        if (st.vao) gl.deleteVertexArray(st.vao);
        if (st.prog) gl.deleteProgram(st.prog);
      }
      st.resident.clear(); st.pending.clear(); st.ready = false; st.map = null; st.gl = null;
      layer.disposed = true;
    },
    prerender(gl) {
      if (st.lost || st.failed) return;
      if (!st.ready) {
        let ok = false;
        try { ok = init(gl); } catch (e) { fail('init_error'); }
        if (!ok) return;
      }
      if (st.lutDirty && st.lut) uploadLut(gl);
      // The wanted frame first, then the rest in offer order.
      let budget = UPLOADS_PER_FRAME;
      const order = st.pending.has(st.wantPath) ? [st.wantPath, ...[...st.pending.keys()].filter((p) => p !== st.wantPath)] : [...st.pending.keys()];
      for (const p of order) {
        if (budget <= 0) break;
        const f = st.pending.get(p);
        st.pending.delete(p);
        if (!st.resident.has(p)) { uploadField(gl, p, f); budget -= 1; }
      }
      if (st.pending.size && st.map) st.map.triggerRepaint();
    },
    render(gl, args) {
      if (st.lost || st.failed || !st.ready || !st.lutTex) return;
      // No stored frame within 3 h of the asked time: draw nothing rather than another hour under this label.
      if (!st.wantPath) return;
      // The hard cut: the wanted frame the moment it is resident; until then the shown one holds.
      if (st.wantPath && st.wantPath !== st.shown && st.resident.has(st.wantPath)) {
        st.shown = st.wantPath;
        if (st.onShown) { try { st.onShown(st.shown, st.resident.get(st.shown).field); } catch (e) { /* telemetry only */ } }
      }
      const r = st.shown && st.resident.get(st.shown);
      if (!r) return;
      const m = (args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix) || (args && args.mainMatrix);
      if (!m) return;
      const f = r.field;
      const dLon = (f.bounds.east - f.bounds.west) / (f.cols - 1);
      const dLat = (f.bounds.north - f.bounds.south) / (f.rows - 1);
      const iso = typeof window !== 'undefined' ? Number(window.__RAW_OWN_RASTER_ISOBARS__) || 0 : 0;
      gl.useProgram(st.prog);
      gl.bindVertexArray(st.vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, st.lutTex);
      gl.uniformMatrix4fv(st.loc.u_matrix, false, m);
      gl.uniform1i(st.loc.u_field, 0);
      gl.uniform1i(st.loc.u_lut, 1);
      gl.uniform4f(st.loc.u_grid, f.bounds.west, f.bounds.south, dLon, dLat);
      gl.uniform3f(st.loc.u_size, f.cols, f.rows, wrapsLongitude(f) ? 1 : 0);
      gl.uniform3f(st.loc.u_lutMap, st.lutMap.min, st.lutMap.step, st.lutMap.n);
      gl.uniform1f(st.loc.u_opacity, opacityAtZoom(opacityStops, st.map ? st.map.getZoom() : 2));
      gl.uniform2f(st.loc.u_iso, iso, 1.2);
      gl.uniform4f(st.loc.u_isoColor, st.isoColor[0], st.isoColor[1], st.isoColor[2], st.isoColor[3]);
      // MapLibre set premultiplied alpha blending for the translucent pass (colorModeForRenderPass); keep it.
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    },

    setLut(lut, map = lutMap) { st.lut = lut; st.lutMap = map; st.lutDirty = true; if (st.map) st.map.triggerRepaint(); },
    setIsobarColor(rgba) { st.isoColor = rgba; if (st.map) st.map.triggerRepaint(); },
    offerField(path, field) {
      if (!path || !field || st.resident.has(path)) return;
      st.pending.set(path, field);
      if (st.map) st.map.triggerRepaint();
    },
    want(path) { st.wantPath = path || null; if (st.map) st.map.triggerRepaint(); },
    isResident(path) { return st.resident.has(path); },
    shownPath() { return st.shown; },
    onShown(fn) { st.onShown = fn; },
    failed() { return st.failed; },
    disposed: false,
  };
  return layer;
}
