// ═══════════════════════════════════════════════════════════════════════
// THE ENGINE'S PIPELINE, IN MINIATURE — point-sprite marks with the engine's casing,
// an 8-bit trail that fades by floor(c·255·f)/255, and each theme's composite.
// One trail serves all three grounds: a mark carries its speed, the ground decides its colour.
// ═══════════════════════════════════════════════════════════════════════

const GLSL_SS = 'float ss(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }\n';

const QUAD_VS = 'attribute vec2 a_q; void main(){ gl_Position = vec4(a_q, 0.0, 1.0); }';

const FADE_FS = `precision highp float;
uniform sampler2D u_src; uniform vec2 u_res; uniform float u_fade;
void main(){ vec4 c = texture2D(u_src, gl_FragCoord.xy / u_res); gl_FragColor = floor(c * 255.0 * u_fade) / 255.0; }`;

// Marks: size, stretch and casing from DRAW_FS / the size rules (zoom 5, so close-zoom terms are idle).
const MARK_VS = `precision highp float;
attribute vec2 a_pos; attribute float a_kn; attribute vec2 a_dir; attribute float a_alpha;
uniform vec2 u_res; uniform float u_dpr; uniform float u_zs; uniform vec3 u_ringK;
varying float v_kn; varying float v_elong; varying float v_a; varying float v_ring; varying vec2 v_dir;
${GLSL_SS}
void main(){
  float v = a_kn;
  float size = v < 0.5 ? 0.0 : 2.5 + 2.5 * ss(1.0, 30.0, v);
  if (v >= 1.0 && v < 10.0) size = min(max(size, 3.073 * u_zs), 3.073);
  else if (v >= 0.3 && v < 1.0) size = max(size, 2.2 * u_zs);
  if (v < 0.3) size = 0.0;
  gl_PointSize = size * u_dpr;
  v_elong = mix(1.8, 2.6, ss(10.0, 0.5, v));
  v_kn = clamp(v / 75.0, 0.0, 1.0); v_dir = a_dir; v_a = a_alpha;
  float tx = a_pos.x / u_res.x;
  v_ring = tx < 1.0 / 3.0 ? u_ringK.x : (tx < 2.0 / 3.0 ? u_ringK.y : u_ringK.z);
  gl_Position = vec4(a_pos.x / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0, 0.0, 1.0);
}`;

const MARK_FS = `precision highp float;
uniform float u_pass;
varying float v_kn; varying float v_elong; varying float v_a; varying float v_ring; varying vec2 v_dir;
${GLSL_SS}
void main(){
  vec2 p = gl_PointCoord - 0.5;
  vec2 d = normalize(v_dir + vec2(1e-6, 0.0)); vec2 n = vec2(-d.y, d.x);
  float dist = length(vec2(dot(p, d), dot(p, n) * v_elong));
  if (dist > 0.5) discard;
  float soft = ss(0.5, 0.2, dist);
  float inner = ss(0.38, 0.26, dist) * ss(0.10, 0.20, dist);   // the white inner ring
  float outer = ss(0.38, 0.50, dist);                           // the black outer rim
  float a = soft * v_a, rimA = a * outer * 0.98, bodyA = a - rimA;
  // body buffer: speed and ring ride premultiplied, so a fading trail keeps its speed (r/a) and its ring (g/a)
  if (u_pass < 0.5) gl_FragColor = vec4(v_kn * bodyA, inner * 0.92 * v_ring * bodyA, 0.0, bodyA);
  else gl_FragColor = vec4(rimA);
}`;

// Composite: ground (basemap + field), then the streak by the theme's rule, then the coastline above the wind.
const COMP_FS = `precision highp float;
uniform sampler2D u_geo, u_lut, u_body, u_rim; uniform vec2 u_res;
uniform vec3 u_landD, u_waterD, u_landB, u_waterB, u_landL, u_waterL;
uniform float u_opB, u_opL, u_brightB, u_brightL, u_solvedB, u_solvedL, u_groundOnly, u_cvd;
${GLSL_SS}
vec4 lut(float row, float kn){ return texture2D(u_lut, vec2((clamp(kn / 75.0, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (row + 0.5) / 8.0)); }
vec3 dec(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 enc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 cvd(vec3 c){
  if (u_cvd < 0.5) return c;
  vec3 l = dec(c); mat3 M;
  if (u_cvd < 1.5) M = mat3(0.152286, 0.114503, -0.003882, 1.052583, 0.786281, -0.048116, -0.204868, 0.099216, 1.051998);
  else if (u_cvd < 2.5) M = mat3(0.367322, 0.280085, -0.011820, 0.860646, 0.672501, 0.042940, -0.227968, 0.047413, 0.968881);
  else M = mat3(1.255528, -0.078411, 0.004733, -0.076749, 0.930809, 0.691367, -0.178779, 0.147602, 0.303900);
  return enc(M * l);
}
void main(){
  vec2 sc = gl_FragCoord.xy / u_res, uv = vec2(sc.x, 1.0 - sc.y);
  vec4 g = texture2D(u_geo, uv);
  float kn = g.r * 75.0, land = g.g, coast = g.b;
  float t = sc.x < 1.0 / 3.0 ? 0.0 : (sc.x < 2.0 / 3.0 ? 1.0 : 2.0);
  vec3 G; float op, bright, rowS;
  if (t < 0.5) {
    vec3 base = mix(u_waterD, u_landD, land);
    vec3 F = lut(0.0, kn).rgb; float a = 0.48 * (0.44 + 0.56 * ss(0.0, 5.0, kn));
    G = F * a * a + base * (1.0 - a);                      // dark: alpha-over veil, premultiplied output blended SRC_ALPHA
    op = 0.505; bright = 1.0; rowS = 0.0;
  } else {
    bool isB = t < 1.5;
    vec3 base = isB ? mix(u_waterB, u_landB, land) : mix(u_waterL, u_landL, land);
    vec4 F = lut(isB ? 1.0 : 3.0, kn);
    float s;
    if ((isB ? u_solvedB : u_solvedL) > 0.5) s = F.a;     // dark's rules: the solved tint strength rides in alpha
    else { float a = isB ? 0.55 * (0.45 + 0.55 * ss(0.0, 7.0, kn)) : 0.65 * (0.42 + 0.58 * ss(0.0, 7.0, kn));
           s = clamp(a * (isB ? 0.60 / 0.55 : 0.70 / 0.65), 0.0, 1.0); }
    G = base * (1.0 - s * (1.0 - F.rgb));                  // multiply tint
    op = isB ? u_opB : u_opL; bright = isB ? u_brightB : u_brightL; rowS = isB ? 2.0 : 4.0;
  }
  vec3 o = G;
  if (u_groundOnly < 0.5) {
    vec4 B = texture2D(u_body, sc);
    if (B.a > 0.0) {
      float km = clamp(B.r / B.a, 0.0, 1.0) * 75.0, ring = clamp(B.g / B.a, 0.0, 1.0);
      vec3 S0 = t < 0.5 ? lut(rowS, km).rgb : mix(lut(rowS + 3.0, km).rgb, lut(rowS, km).rgb, land);   // light and beach: water rows sit 3 below
      vec3 S = mix(S0, vec3(1.0), ring);
      float m = max(S.r, max(S.g, S.b)), be = B.a * m;
      if (t < 0.5) o = S * B.a * be * op + G * (1.0 - be * op);                         // dark, exactly as drawn
      else if (bright > 0.5) { float w = be * be * op; o = (S / m) * w + G * (1.0 - w); }    // dark's rule, ground-independent
      else o = S * B.a * op + G * (1.0 - B.a * op);                                                              // premultiplied
    }
    if (bright < 0.5) o *= 1.0 - texture2D(u_rim, sc).a * op;   // the black rim shows only where the composite is premultiplied
  }
  vec3 cc = t < 0.5 ? vec3(200.0, 214.0, 228.0) / 255.0 : vec3(45.0, 58.0, 72.0) / 255.0;
  o = mix(o, cc, coast * (t < 0.5 ? 0.45 : (t < 1.5 ? 0.28 : 0.42)));
  gl_FragColor = vec4(cvd(o), 1.0);
}`;

function makeEngine(W, H) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const compile = (vs, fs) => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  };
  const fade = compile(QUAD_VS, FADE_FS), mark = compile(MARK_VS, MARK_FS), comp = compile(QUAD_VS, COMP_FS);
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const pts = gl.createBuffer();
  const tex = (w, h, data, filter) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const target = () => { const t = tex(W, H, null, gl.NEAREST), f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f }; };
  const E = { canvas, gl, W, H, body: [target(), target()], rim: [target(), target()], measure: target(), cur: 0, geo: null, lut: null, n: 0 };

  E.clear = () => { for (const b of [...E.body, ...E.rim]) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } };
  E.setGeo = (w, h, rgba) => { E.geo = tex(w, h, rgba, gl.LINEAR); };
  E.setLut = (rgba) => { if (E.lut) gl.deleteTexture(E.lut); E.lut = tex(256, 8, rgba, gl.NEAREST); };
  const drawQuad = (prog) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); const loc = gl.getAttribLocation(prog.p, 'a_q');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.disableVertexAttribArray(loc);
  };
  const bindTex = (prog, name, t, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.u[name], unit); };

  // One frame of the trail: fade the old buffer into the next, then stamp this frame's marks.
  E.step = (data, count, fadeF, dpr, zs, ringK) => {
    const nx = 1 - E.cur;
    gl.viewport(0, 0, W, H); gl.disable(gl.BLEND);
    gl.useProgram(fade.p); gl.uniform2f(fade.u.u_res, W, H); gl.uniform1f(fade.u.u_fade, fadeF);
    for (const buf of [E.body, E.rim]) { gl.bindFramebuffer(gl.FRAMEBUFFER, buf[nx].f); bindTex(fade, 'u_src', buf[E.cur].t, 0); drawQuad(fade); }
    gl.useProgram(mark.p);
    gl.uniform2f(mark.u.u_res, W, H); gl.uniform1f(mark.u.u_dpr, dpr); gl.uniform1f(mark.u.u_zs, zs); gl.uniform3f(mark.u.u_ringK, ...ringK);
    gl.bindBuffer(gl.ARRAY_BUFFER, pts); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 6), gl.DYNAMIC_DRAW);
    const attrs = [['a_pos', 2, 0], ['a_kn', 1, 2], ['a_dir', 2, 3], ['a_alpha', 1, 5]].map(([nm, sz, off]) => {
      const loc = gl.getAttribLocation(mark.p, nm); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, 24, off * 4); return loc; });
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const [buf, pass] of [[E.body, 0], [E.rim, 1]]) { gl.bindFramebuffer(gl.FRAMEBUFFER, buf[nx].f); gl.uniform1f(mark.u.u_pass, pass); gl.drawArrays(gl.POINTS, 0, count); }
    attrs.forEach((l) => gl.disableVertexAttribArray(l)); gl.disable(gl.BLEND);
    E.cur = nx;
  };

  // Composite to the screen, or into the measuring target with the streaks left off.
  E.composite = (U, opts) => {
    const { groundOnly = 0, cvd = 0, toMeasure = false } = opts || {};
    gl.bindFramebuffer(gl.FRAMEBUFFER, toMeasure ? E.measure.f : null); gl.viewport(0, 0, W, H); gl.disable(gl.BLEND);
    gl.useProgram(comp.p);
    bindTex(comp, 'u_geo', E.geo, 0); bindTex(comp, 'u_lut', E.lut, 1); bindTex(comp, 'u_body', E.body[E.cur].t, 2); bindTex(comp, 'u_rim', E.rim[E.cur].t, 3);
    gl.uniform2f(comp.u.u_res, W, H);
    for (const k of ['u_landD', 'u_waterD', 'u_landB', 'u_waterB', 'u_landL', 'u_waterL']) gl.uniform3f(comp.u[k], ...U[k]);
    for (const k of ['u_opB', 'u_opL', 'u_brightB', 'u_brightL', 'u_solvedB', 'u_solvedL']) gl.uniform1f(comp.u[k], U[k]);
    gl.uniform1f(comp.u.u_groundOnly, groundOnly); gl.uniform1f(comp.u.u_cvd, cvd);
    drawQuad(comp);
  };
  E.read = (which) => {
    const px = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, which === 'body' ? E.body[E.cur].f : which === 'measure' ? E.measure.f : null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;                                              // rows bottom-up
  };
  return E;
}
