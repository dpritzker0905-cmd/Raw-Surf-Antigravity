#!/usr/bin/env node
// Which position does the GPU read in a 256-texel LINEAR, CLAMP_TO_EDGE texture at coordinate t?   node lut-lookup-gpu.cjs [swiftshader]
// The wind's colour textures are filled by index (WindColorRamp.js generateRampData: texel i holds the table at i / 255 x the maximum)
// and read by the shader at t = speed / max. This reads a real GPU back, so `check.mjs --as-uploaded` and `beach-path-solve.mjs
// --uploaded` can model the lookup the engine draws by (LESSONS L-V60: check a model against a GPU). The same shader lines as the engine's.
// The texture: green = the texel's index, red = 255 on odd texels and 0 on even ones. Read back at t: green/red give the position
// between texels to 1/255 of a texel. Compared with the two candidate laws: 256 t - 0.5 (texel centres at half-integers, the GL
// rule) and 255 t (the table's own index, what generateRampData fills by).
const path = require('path');
const FRONTEND = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
const { gpuArgs } = require(path.join(FRONTEND, 'scripts', 'wind-bench', 'serve'));

(async () => {
  const browser = await chromium.launch({ headless: true, args: gpuArgs(process.argv[2]) });
  const page = await browser.newPage();
  await page.setContent('<canvas id="c" width="4" height="4"></canvas>');
  const out = await page.evaluate(() => {
    const gl = document.getElementById('c').getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    const dbg = gl.getExtension('WEBGL_debug_renderer_info'), renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { data[i * 4] = i % 2 ? 255 : 0; data[i * 4 + 1] = i; data[i * 4 + 2] = 0; data[i * 4 + 3] = 255; }
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision highp float; uniform sampler2D u_ramp; uniform float u_speed; uniform float u_max; void main() { float t = clamp(u_speed / max(u_max, 1.0), 0.0, 1.0); gl_FragColor = texture2D(u_ramp, vec2(t, 0.5)); }'));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const rows = [], px = new Uint8Array(4);
    for (const [speed, max] of [[3, 80], [6, 80], [3, 50], [6, 50], [10, 50], [16, 50], [21, 50], [27, 50], [33, 75], [40, 75], [47, 80], [55, 80], [63, 80], [75, 80], [0.2, 80], [79.9, 80]]) {
      gl.uniform1f(gl.getUniformLocation(prog, 'u_speed'), speed); gl.uniform1f(gl.getUniformLocation(prog, 'u_max'), max);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      rows.push({ speed, max, red: px[0], green: px[1] });
    }
    return { renderer, rows };
  });
  await browser.close();
  console.log('renderer:', out.renderer);
  console.log(' speed  max |  read back: green   red | the GL rule 256t-0.5: green   red | the index 255t: green   red');
  const model = (p) => { const x = Math.min(255, Math.max(0, p)), i = Math.min(254, Math.floor(x)), f = x - i; return { green: i + f, red: (i % 2 ? 255 * (1 - f) : 255 * f) }; };
  let errRule = 0, errIndex = 0;
  for (const r of out.rows) {
    const t = Math.min(1, r.speed / r.max), a = model(t * 256 - 0.5), b = model(t * 255);
    errRule = Math.max(errRule, Math.abs(a.red - r.red)); errIndex = Math.max(errIndex, Math.abs(b.red - r.red));
    console.log(`${String(r.speed).padStart(6)} ${String(r.max).padStart(4)} |             ${String(r.green).padStart(5)} ${String(r.red).padStart(5)} |                 ${a.green.toFixed(2).padStart(7)} ${a.red.toFixed(1).padStart(5)} |          ${b.green.toFixed(2).padStart(7)} ${b.red.toFixed(1).padStart(5)}`);
  }
  console.log(`largest miss in red (of 255): the GL rule ${errRule.toFixed(1)}, the index ${errIndex.toFixed(1)}`);
})().catch((e) => { console.error(e); process.exit(1); });
