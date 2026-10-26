/**
 * ownRasterLayer.js — a MapLibre custom layer that draws one raster field from our own frames (ownRasterFrames.js), in
 * MapLibre's shared GL context (2026-10-23; phase 1: GFS pressure, dark; 2026-10-24: per-model pressure, GFS air temperature).
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
// Air temperature: the tile library's own 'temperature' breakpoint scale (-80..50 deg C, 46 colours, NOT theme-varied; the .om
// path draws it through the library's getColor, which is exactly colorAtValue: 0 mismatches over -95..60 in 0.01 steps,
// 2026-10-24). Every breakpoint is a multiple of 0.5, so a 0.5 deg C step is exact at every boundary (pinned by a test);
// below -80 clamps to the first colour and above 50 to the last, as the library does.
export const TEMPERATURE_LUT = { min: -80, step: 0.5, n: 261 };
// Cloud cover: the tile library's own 'cloud_cover' breakpoint scale (0..90 % every 10, straight alpha), with a light and a dark
// colour set. Every breakpoint is a multiple of 10, so a 10 % step is exact at each boundary (pinned by a test).
export const CLOUD_LUT = { min: 0, step: 10, n: 10 };

/** The colours the .om path uses for a theme: a scale with light / dark variants resolves as the tile library does
 *  (resolveColorScale), with `dark` = the URL's dark=true, which useOpenMeteoTileUrls sets for the dark AND beach themes. */
export function scaleForTheme(scale, theme) {
  const c = scale && scale.colors;
  if (!c || Array.isArray(c) || !c.dark || !c.light) return scale;
  return { ...scale, colors: (theme === 'dark' || theme === 'beach') ? c.dark : c.light };
}

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
export const TEMPERATURE_OPACITY_STOPS = [[2, 0.38], [5, 0.44], [8, 0.49], [12, 0.53]];
export const SATELLITE_OPACITY_STOPS = [[2, 0.55], [5, 0.60], [8, 0.65], [12, 0.70]];
// The no-data test: ownRasterFrames.MISSING (-9999) is below it, every real value of every layer above (pinned by a test).
export const NO_DATA_BELOW_GLSL = '-9000.0';

// ── the elevation downscale (2026-10-25; the owner: "Go with your recommendation if that is state of the art") ───────────────
// Air temperature is drawn as T + lapse * dz, where dz = real ground (NOAA ETOPO 2022) - the model's 0.5-degree terrain, from a
// static asset of at most DZ_TILES_MAX longitude tiles (backend/services/raster_downscale.py). Against METAR 2 m temperature at
// 31 airports the standard lapse rate cut the mountain MAE from 2.87 to 2.07 C (log 2026-10-25-claude-raster-temp-downscale).
// Each tile carries one overlap column, so linear filtering never seams; codes are uint8 = round(dz / step) + offset.
export const DZ_TILES_MAX = 2;
/** dz (m) at (lon, lat) from a decoded asset, exactly as the shader samples it (bilinear between codes, inside one tile). */
export function downscaleAt(asset, lon, lat) {
  const L = asset.lattice;
  let gx = (lon - L.west) / L.dlon;
  gx = ((gx % L.cols) + L.cols) % L.cols;
  const gy = Math.min(Math.max((lat - L.south) / L.dlat, 0), L.rows - 1);
  const t = asset.tiles.length > 1 && gx >= asset.tiles[1].col0 ? asset.tiles[1] : asset.tiles[0];
  const x = gx - t.col0;
  const x0 = Math.min(Math.floor(x), t.cols - 2); const tx = x - x0;
  const y0 = Math.min(Math.floor(gy), t.rows - 2); const ty = gy - y0;
  const at = (c, r) => t.data[r * t.cols + c];
  const code = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  return (code - asset.offset) * asset.step;
}
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
uniform sampler2D u_dz0;  // the elevation-difference tiles (R8, linear), air temperature only
uniform sampler2D u_dz1;
uniform vec4 u_dzLat;     // south, dlat, rows, on (1 = downscale)
uniform vec4 u_dzLon;     // west, dlon, cols (the whole lattice), the second tile's first column (= cols with one tile)
uniform vec4 u_dzCode;    // offset, step (m), lapse (K/m), the first tile's columns (with its overlap)
uniform float u_dzCols1;  // the second tile's columns (with its overlap)
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
    // INTEGER wrap (2026-10-24, matrix cell 6 at Fiji): float mod(720.0, 720.0) can round to 720, and a texelFetch past the last
    // column reads 0 -> a violet one-cell stripe on the antimeridian. Integer modulo is exact.
    float x0 = floor(fx); tx = fx - x0;
    int n = int(u_size.x);
    c0 = int(x0) % n; if (c0 < 0) c0 += n;
    c1 = c0 + 1; if (c1 >= n) c1 = 0;
  } else {
    if (fx < 0.0 || fx > u_size.x - 1.0) discard;
    float x0 = min(floor(fx), u_size.x - 2.0); tx = fx - x0;
    c0 = int(x0); c1 = c0 + 1;
  }
  float y0 = min(floor(fy), u_size.y - 2.0); float ty = fy - y0;
  int r0 = int(y0); int r1 = r0 + 1;
  float a = node(c0, r0); float b = node(c1, r0); float c = node(c0, r1); float d = node(c1, r1);
  if (min(min(a, b), min(c, d)) < ${NO_DATA_BELOW_GLSL}) discard;
  float v = mix(mix(a, b, tx), mix(c, d, tx), ty);
  if (u_dzLat.w > 0.5) {
    float gx = mod((lon - u_dzLon.x) / u_dzLon.y, u_dzLon.z);
    float gy = clamp((lat - u_dzLat.x) / u_dzLat.y, 0.0, u_dzLat.z - 1.0);
    float code = gx < u_dzLon.w
      ? textureLod(u_dz0, vec2((gx + 0.5) / u_dzCode.w, (gy + 0.5) / u_dzLat.z), 0.0).r
      : textureLod(u_dz1, vec2((gx - u_dzLon.w + 0.5) / u_dzCols1, (gy + 0.5) / u_dzLat.z), 0.0).r;
    v = v + u_dzCode.z * (code * 255.0 - u_dzCode.x) * u_dzCode.y;
  }
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
 * createOwnRasterLayer({ id, opacityStops, lutMap, onFail, shaderIsobars }) -> a MapLibre custom layer with:
 *   setLut(Uint8Array, lutMap), offerField(path, field), want(path), isResident(path), shownPath(), onShown(fn), disposed.
 */
export function createOwnRasterLayer({ id, opacityStops = PRESSURE_OPACITY_STOPS, lutMap = PRESSURE_LUT, onFail = null, shaderIsobars = true } = {}) {
  const st = {
    map: null, gl: null, canvas: null, lost: false, ready: false, failed: false,
    prog: null, vao: null, buf: null, loc: null, lutTex: null, lut: null, lutDirty: false, lutMap,
    resident: new Map(),       // path -> { tex, field }
    pending: new Map(),        // path -> field waiting for upload
    wantPath: null, shown: null, onShown: null,
    isoColor: [1, 1, 1, 0.55],
    dz: null, dzTex: [], dzNext: 0,   // the elevation downscale: the decoded asset, its textures, the next tile to upload
  };

  const dropGl = () => {
    st.ready = false; st.prog = null; st.vao = null; st.buf = null; st.loc = null; st.lutTex = null; st.lutDirty = !!st.lut;
    for (const [p, r] of st.resident) st.pending.set(p, r.field);   // re-upload from the CPU copy after a restore
    st.resident.clear();
    st.dzTex = []; st.dzNext = 0;       // the dz tiles re-upload from the CPU copy too
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
    for (const u of ['u_matrix', 'u_field', 'u_lut', 'u_grid', 'u_size', 'u_lutMap', 'u_opacity', 'u_iso', 'u_isoColor',
      'u_dz0', 'u_dz1', 'u_dzLat', 'u_dzLon', 'u_dzCode', 'u_dzCols1']) {
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

  // One dz tile per call (each is up to 4096 x 2701 bytes): R8 with LINEAR filtering, so the GPU blends between codes.
  function uploadDzTile(gl) {
    const t = st.dz.tiles[st.dzNext];
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, t.cols, t.rows, 0, gl.RED, gl.UNSIGNED_BYTE, t.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    st.dzTex[st.dzNext] = tex;
    st.dzNext += 1;
  }
  const dzReady = () => !!(st.dz && st.dzTex.length === st.dz.tiles.length && st.dzTex.every(Boolean));

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
        for (const t of st.dzTex) if (t) gl.deleteTexture(t);
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
      if (st.dz && st.dzNext < st.dz.tiles.length) { uploadDzTile(gl); if (st.map) st.map.triggerRepaint(); }
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
      // The shader's isoline lever is pressure's only (shaderIsobars): it would draw isotherms through air temperature.
      const iso = shaderIsobars && typeof window !== 'undefined' ? Number(window.__RAW_OWN_RASTER_ISOBARS__) || 0 : 0;
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
      // The elevation downscale, once every tile is resident (until then the field draws as is: never half a downscale).
      const dzOn = dzReady();
      if (dzOn) {
        const L = st.dz.lattice; const t0 = st.dz.tiles[0]; const t1 = st.dz.tiles[1];
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, st.dzTex[0]);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, st.dzTex[1] || st.dzTex[0]);
        gl.uniform1i(st.loc.u_dz0, 2); gl.uniform1i(st.loc.u_dz1, 3);
        gl.uniform4f(st.loc.u_dzLat, L.south, L.dlat, L.rows, 1);
        gl.uniform4f(st.loc.u_dzLon, L.west, L.dlon, L.cols, t1 ? t1.col0 : L.cols);
        gl.uniform4f(st.loc.u_dzCode, st.dz.offset, st.dz.step, st.dz.lapse, t0.cols);
        gl.uniform1f(st.loc.u_dzCols1, t1 ? t1.cols : t0.cols);
      } else {
        gl.uniform4f(st.loc.u_dzLat, 0, 1, 1, 0);
      }
      // MapLibre set premultiplied alpha blending for the translucent pass (colorModeForRenderPass); keep it.
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    },

    setLut(lut, map = lutMap) { st.lut = lut; st.lutMap = map; st.lutDirty = true; if (st.map) st.map.triggerRepaint(); },
    setIsobarColor(rgba) { st.isoColor = rgba; if (st.map) st.map.triggerRepaint(); },
    /** The elevation downscale's decoded asset ({ lattice, offset, step, lapse, tiles: [{ col0, cols, rows, data }] }), or null
     *  to draw the field as is. At most DZ_TILES_MAX tiles; anything else is refused (the field draws as is). */
    setDownscale(asset) {
      const gl = st.gl;
      if (gl && !st.lost) for (const t of st.dzTex) if (t) gl.deleteTexture(t);
      st.dzTex = []; st.dzNext = 0;
      st.dz = asset && Array.isArray(asset.tiles) && asset.tiles.length >= 1 && asset.tiles.length <= DZ_TILES_MAX ? asset : null;
      if (st.map) st.map.triggerRepaint();
      return !!st.dz;
    },
    downscaleReady() { return dzReady(); },
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
