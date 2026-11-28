#!/usr/bin/env node
// DARK'S WIND FIELD ON A REAL GPU: which law lays it over the map?   node dark-field-gpu.mjs [swiftshader] [--json out.json]
//
// HEATMAP_FS (WebGLWindShaders.js) ends `vec4(fieldRgb * alpha, alpha)`: its colour is PREMULTIPLIED. WebGLWindEngine.js draws dark's
// field (no multiply tint) into the map's own framebuffer with blendIntoMap(gl, SRC_ALPHA, ONE_MINUS_SRC_ALPHA) (windCanvasAlpha.js),
// which multiplies by alpha a second time. So the screen should hold   c a^2 + map (1 - a),   not the alpha-over c a + map (1 - a)
// that check.mjs modelled until 2026-11-22. This reads it back from a GPU instead of arguing it (LESSONS L-V60: check a model against
// a GPU): the REAL HEATMAP_VS / HEATMAP_FS strings, the field LUT the engine uploads for dark (WindColorRamp.js generateRampData of
// resolveDrawnField('dark'), as buildFieldRampTexture fills it), a constant wind of known speed, over a cleared map of known colour.
//
// Per speed: the shader's own output (blending off) gives c and a; then the blend over a BLACK and a WHITE map gives the law with no
// model in it: (white - black) = 1 - a_dst (how much map is left), black = c k (how much colour is laid). Fit k against a and a^2.
// It repeats the read over dark's water and land grounds, and with the canvas-alpha kill (__RAW_DISABLE_WIND_OPAQUE_CANVAS__: one
// blendFunc for colour and alpha) to show that path moves the canvas's ALPHA only, never the colour.
// The opaque pass uses the current engine default. The vivid pass measures the alternate ONE blend.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = path.dirname(fileURLToPath(import.meta.url)), FRONTEND = path.resolve(HERE, '..', '..'), MAPDIR = path.join(FRONTEND, 'src', 'components', 'map');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
const { gpuArgs } = require(path.join(FRONTEND, 'scripts', 'wind-bench', 'serve'));
const args = process.argv.slice(2), jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

// The shaders, from the app's source: imports stubbed (only GLSL_PT_REG reaches HEATMAP_VS/FS; it is read from its own module).
const shaderSrc = fs.readFileSync(path.join(MAPDIR, 'WebGLWindShaders.js'), 'utf8');
const ptReg = /export const GLSL_PT_REG = '([^']*)'/.exec(fs.readFileSync(path.join(MAPDIR, 'gridPointRegistration.js'), 'utf8'))[1];
const imported = [...shaderSrc.matchAll(/import \{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : ''), apply: () => '' });   // '' in any template, as a property or a call
const mod = {};
new Function('mod', ...imported, shaderSrc.replace(/^import [^\n]*$/gm, '').replace(/export const (\w+)/g, 'mod.$1'))(mod, ...imported.map((n) => (n === 'GLSL_PT_REG' ? ptReg : stub)));
const { HEATMAP_VS, HEATMAP_FS } = mod;

// Dark's field LUT, as the engine uploads it (same loaders as check.mjs).
const source = (file) => fs.readFileSync(file, 'utf8').replace(/^import [^\n]*$/gm, '').replace(/^export /gm, '');
const { DARK_RULES, DARK_WHITE, solveDarkRules } = new Function(source(path.join(MAPDIR, 'windDarkRules.js')) + '; return { DARK_RULES, DARK_WHITE, solveDarkRules };')();
const { LIGHT_PATH, lightTables } = new Function(source(path.join(MAPDIR, 'windLightPath.js')) + '; return { LIGHT_PATH, lightTables };')();
const { windLandWhite, setWindLandDepthGate } = new Function(source(path.join(MAPDIR, 'windBasemapMute.js')) + '; return { windLandWhite, setWindLandDepthGate };')();
const { BEACH_PATH, beachPathRows } = new Function(source(path.join(MAPDIR, 'windBeachPath.js')) + '; return { BEACH_PATH, beachPathRows };')();
const { generateRampData, resolveDrawnField } = new Function('DARK_RULES', 'DARK_WHITE', 'solveDarkRules', 'windLandWhite', 'setWindLandDepthGate', 'BEACH_PATH', 'beachPathRows', 'LIGHT_PATH', 'lightTables',
  source(path.join(MAPDIR, 'WindColorRamp.js')) + '; return { generateRampData, resolveDrawnField };')(DARK_RULES, DARK_WHITE, solveDarkRules, windLandWhite, setWindLandDepthGate, BEACH_PATH, beachPathRows, LIGHT_PATH, lightTables);
const MAX = 50, LUT = Array.from(generateRampData(MAX, resolveDrawnField('dark', {}), null, {}));
const { windFieldSrcFactor } = new Function(source(path.join(MAPDIR, 'windDarkFieldVivid.js')) + '; return { windFieldSrcFactor };')();
const DEFAULT_SRC = windFieldSrcFactor({ ONE: 'ONE', SRC_ALPHA: 'SRC_ALPHA' }, 'dark', {});   // the factor the engine passes for dark (default)
if (DEFAULT_SRC !== 'SRC_ALPHA') throw new Error(`windFieldSrcFactor('dark') is ${DEFAULT_SRC}, expected production SRC_ALPHA`);
const OPACITY = 0.48;   // WebGLWindEngine.js heatmapOpacity for dark
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lawA = (kn) => OPACITY * (0.44 + 0.56 * ss(0, 5, kn));   // HEATMAP_FS dark: baseAlpha 0.44, rampEnd 5
const SPEEDS = [0, 1, 2, 3, 4, 6, 10, 16, 21, 27, 33, 40, 47];
const GROUNDS = { black: [0, 0, 0], white: [255, 255, 255], water: [93, 117, 126], land: [58, 71, 79] };   // dark's water (check.mjs MODEL) and land under the wind (GUSTS section)

const browser = await chromium.launch({ headless: true, channel: args.includes('--chrome') ? 'chrome' : undefined, args: gpuArgs(args.find((a) => a === 'swiftshader')) });
const page = await browser.newPage();
await page.setContent('<canvas id="c" width="8" height="8"></canvas>');
const out = await page.evaluate(({ HEATMAP_VS, HEATMAP_FS, LUT, MAX, OPACITY, SPEEDS, GROUNDS, DEFAULT_SRC }) => {
  // The map's canvas as MapLibre makes it: premultiplied alpha (the default), kept for readPixels.
  const gl = document.getElementById('c').getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: true, alpha: true });
  const dbg = gl.getExtension('WEBGL_debug_renderer_info'), renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, HEATMAP_VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, HEATMAP_FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const tex = (unit, w, data, filter) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data)); return t; };
  // Wind: every texel r = 255, g = 0, so wind = mix(u_wind_min, u_wind_max, (1, 0)) = (speed, 0) exactly.
  tex(0, 2, [255, 0, 0, 255, 255, 0, 0, 255], gl.NEAREST); gl.uniform1i(U('u_wind'), 0);
  tex(1, 256, LUT, gl.LINEAR); gl.uniform1i(U('u_color_ramp'), 1);
  tex(2, 2, [128, 128, 0, 255, 128, 128, 0, 255], gl.NEAREST); gl.uniform1i(U('u_wind_fine'), 2);
  // Mercator (0..1) onto clip space; the whole world, so the canvas centre is mid-field (no feather: it is off anyway).
  gl.uniformMatrix4fv(U('u_matrix'), false, new Float32Array([2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]));
  gl.uniform2f(U('u_dataBounds_min'), -180, -85); gl.uniform2f(U('u_dataBounds_max'), 180, 85); gl.uniform1f(U('u_lng_offset'), 0);
  gl.uniform4f(U('u_base_reg'), 0, 0, 0, 0); gl.uniform4f(U('u_fine_reg'), 0, 0, 0, 0);
  gl.uniform1f(U('u_opacity'), OPACITY); gl.uniform1f(U('u_theme'), 0); gl.uniform1f(U('u_max_speed'), MAX); gl.uniform1f(U('u_field_lut'), 1); gl.uniform1f(U('u_field_tint'), 0);
  for (const n of ['u_edgeFeatherEnabled', 'u_calm_alpha_kill', 'u_cutout_enabled', 'u_fine_singlepass', 'u_debug_mode']) gl.uniform1f(U(n), 0);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_grid_uv'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const px = new Uint8Array(4);
  const draw = (speed, ground, blend) => {
    gl.uniform2f(U('u_wind_min'), 0, 0); gl.uniform2f(U('u_wind_max'), Math.max(speed, 1e-4), 0);
    gl.disable(gl.BLEND); gl.clearColor(ground[0] / 255, ground[1] / 255, ground[2] / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (blend === 'opaque') { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl[DEFAULT_SRC], gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); }   // blendIntoMap, kill off (the default)
    else if (blend === 'vivid') { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); }   // blendIntoMap(windFieldSrcFactor('dark') = ONE): the fix
    else if (blend === 'kill') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }   // blendIntoMap under __RAW_DISABLE_WIND_OPAQUE_CANVAS__
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px);
  };
  const rows = [];
  for (const speed of SPEEDS) {
    const r = { speed, raw: draw(speed, [0, 0, 0], 'none'), opaque: {}, kill: {}, vivid: {} };
    for (const [g, c] of Object.entries(GROUNDS)) { r.opaque[g] = draw(speed, c, 'opaque'); r.kill[g] = draw(speed, c, 'kill'); r.vivid[g] = draw(speed, c, 'vivid'); }
    rows.push(r);
  }
  return { renderer, rows };
}, { HEATMAP_VS, HEATMAP_FS, LUT, MAX, OPACITY, SPEEDS, GROUNDS, DEFAULT_SRC });
await browser.close();

console.log('renderer:', out.renderer);
console.log("DARK'S FIELD (the real HEATMAP shaders, dark's uploaded LUT, max 50 kn), read back. a = the shader's own alpha; c = its colour (raw rgb / a).");
console.log('  kn |  a (GPU)  a (law) | map left (white-black)  1-a | colour laid k = black / c:  k     a^2     a  | fits | water: GPU      c a^2+m(1-a)  c a+m(1-a) | canvas alpha: default  kill');
const fits = [];
let worstSq = 0, worstOver = 0, worstWaterSq = 0, worstWaterOver = 0, killColourMoved = 0;
for (const r of out.rows) {
  const a = r.raw[3] / 255, c = r.raw.slice(0, 3).map((x) => x / 255 / a), law = lawA(r.speed);
  const left = [0, 1, 2].map((i) => (r.opaque.white[i] - r.opaque.black[i]) / 255).reduce((s, x) => s + x, 0) / 3;
  const ks = [0, 1, 2].filter((i) => c[i] > 0.15).map((i) => r.opaque.black[i] / 255 / c[i]), k = ks.reduce((s, x) => s + x, 0) / ks.length;
  const w = GROUNDS.water.map((x) => x / 255), sq = w.map((m, i) => (c[i] * a * a + m * (1 - a)) * 255), over = w.map((m, i) => (c[i] * a + m * (1 - a)) * 255), got = r.opaque.water.slice(0, 3);
  const miss = (p) => Math.max(...p.map((x, i) => Math.abs(x - got[i])));
  worstWaterSq = Math.max(worstWaterSq, miss(sq)); worstWaterOver = Math.max(worstWaterOver, miss(over));
  worstSq = Math.max(worstSq, Math.abs(k - a * a)); worstOver = Math.max(worstOver, Math.abs(k - a));
  for (const g of Object.keys(GROUNDS)) killColourMoved = Math.max(killColourMoved, ...[0, 1, 2].map((i) => Math.abs(r.kill[g][i] - r.opaque[g][i])));
  const verdict = Math.abs(k - a * a) < Math.abs(k - a) ? 'a^2' : 'a';
  fits.push({ speed: r.speed, a, law, left, k, verdict, water: { gpu: got, squared: sq.map(Math.round), over: over.map(Math.round) }, canvasAlpha: { default: r.opaque.water[3], kill: r.kill.water[3] } });
  console.log(`${String(r.speed).padStart(4)} | ${a.toFixed(3).padStart(8)} ${law.toFixed(3).padStart(8)} | ${left.toFixed(3).padStart(22)} ${(1 - a).toFixed(3).padStart(5)} | ${k.toFixed(3).padStart(30)} ${(a * a).toFixed(3).padStart(7)} ${a.toFixed(3).padStart(5)} | ${verdict.padStart(4)} | ${got.join(',').padStart(11)}  ${sq.map(Math.round).join(',').padStart(12)} ${over.map(Math.round).join(',').padStart(11)} | ${String(r.opaque.water[3]).padStart(21)} ${String(r.kill.water[3]).padStart(5)}`);
}
console.log(`largest |k - a^2| ${worstSq.toFixed(3)}; largest |k - a| ${worstOver.toFixed(3)}.  Over dark's water, the GPU vs c a^2 + m(1-a): up to ${worstWaterSq.toFixed(1)}/255; vs c a + m(1-a): up to ${worstWaterOver.toFixed(1)}/255.`);
console.log(`the canvas-alpha kill moved the colour by at most ${killColourMoved}/255 on any ground (its alpha: see the last two columns; default keeps 255).`);
// THE FIX, read back: the default blend (ONE) over every ground against c a + m (1 - a), and its canvas alpha.
let vividWorst = 0, vividVsSq = 0, vividAlpha = 255;
for (const r of out.rows) {
  const a = r.raw[3] / 255, c = r.raw.slice(0, 3).map((x) => x / 255 / a);
  for (const [g, col] of Object.entries(GROUNDS)) {
    const m = col.map((x) => x / 255), got = r.vivid[g].slice(0, 3);
    vividWorst = Math.max(vividWorst, ...m.map((x, i) => Math.abs((c[i] * a + x * (1 - a)) * 255 - got[i])));
    vividVsSq = Math.max(vividVsSq, ...m.map((x, i) => Math.abs((c[i] * a * a + x * (1 - a)) * 255 - got[i])));
    vividAlpha = Math.min(vividAlpha, r.vivid[g][3]);
  }
}
console.log(`Vivid comparison (blend ONE): over black, white, water and land the GPU sits within ${vividWorst.toFixed(1)}/255 of c a + m(1-a) (the designed law) and up to ${vividVsSq.toFixed(1)}/255 off c a^2 + m(1-a); canvas alpha min ${vividAlpha}.`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ renderer: out.renderer, max: MAX, fits, vivid: { worstVsOver: vividWorst, worstVsSquared: vividVsSq, minCanvasAlpha: vividAlpha }, raw: out.rows }, null, 1));
