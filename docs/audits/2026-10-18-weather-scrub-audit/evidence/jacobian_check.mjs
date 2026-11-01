// Offline numeric check of Raw Surf wind-particle advection (audit lane-science, 2026-10-18).
// Reads the REAL source text from the audit worktree (origin/dev f3ef50fb2) and extracts/evaluates
// the actual functions where they are plain JS; GLSL helpers are transpiled mechanically.
// Usage: node jacobian_check.mjs <repo-root>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2];
const MAP = path.join(ROOT, 'frontend/src/components/map');
const shaders = fs.readFileSync(path.join(MAP, 'WebGLWindShaders.js'), 'utf8');
const utils = fs.readFileSync(path.join(MAP, 'WebGLWindUtils.js'), 'utf8');
const engine = fs.readFileSync(path.join(MAP, 'WebGLWindEngine.js'), 'utf8');
const regSrc = fs.readFileSync(path.join(MAP, 'gridPointRegistration.js'), 'utf8');

let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// ---- 1. Transpile the GLSL Mercator helpers (first occurrence = ADVECT_FS) ----
function glslFn(name) {
  const re = new RegExp(`float ${name}\\(float (\\w+)\\) \\{([\\s\\S]*?)\\n\\}`);
  const m = shaders.match(re);
  if (!m) throw new Error('missing ' + name);
  let body = m[2]
    .replace(/\bfloat\s+/g, 'let ')
    .replace(/\b(exp|log|tan|cos|atan|sin)\(/g, 'Math.$1(')
    .replace(/\bclamp\(([^,]+),\s*([^,]+),\s*([^)]+)\)/g, 'Math.min(Math.max($1,$2),$3)');
  return new Function(m[1], body);
}
const mercatorYToLat = glslFn('mercatorYToLat');
const latToMercatorY = glslFn('latToMercatorY');

// ---- 2. Assert the advection formula text we model is the one in the shader ----
const advectLines = [
  'vec2 windMerc = vec2(wind.x, -wind.y);',
  'float merc_scale = max(0.1, cos(lat_rad));',
  'vec2 offset = (windMerc / merc_scale) * u_speed_scale;',
  'offset *= pow(speedNorm, gammaEff - 1.0);',
  'float speedNorm = clamp(speed / max(u_speed_max, 1.0), 0.02, 1.0);',
];
for (const l of advectLines) check(`shader contains: ${l}`, shaders.includes(l));
// shader model (gamma handled separately)
const shaderOffset = (u, v, latDeg, k) => {
  const ms = Math.max(0.1, Math.cos(latDeg * Math.PI / 180));
  return [u / ms * k, -v / ms * k];
};

// ---- 3. Exact reference: move on the sphere, project with exact spherical Mercator ----
const R = 6378137;
const mercX = lonDeg => (lonDeg + 180) / 360;
const mercY = latDeg => { const p = latDeg * Math.PI / 180; return (1 - Math.log(Math.tan(Math.PI / 4 + p / 2)) / Math.PI) / 2; };
function exactDelta(u, v, latDeg, dt) {
  const p = latDeg * Math.PI / 180;
  const dLon = (u * dt) / (R * Math.cos(p)) * 180 / Math.PI;
  const dLat = (v * dt) / R * 180 / Math.PI;
  // central difference for 2nd-order accuracy
  return [mercX(dLon / 2) - mercX(-dLon / 2), mercY(latDeg + dLat / 2) - mercY(latDeg - dLat / 2)];
}

// round trip of the transpiled helpers vs the exact formula
let maxRT = 0, maxForm = 0;
for (let lat = -85; lat <= 85; lat += 0.5) {
  maxRT = Math.max(maxRT, Math.abs(mercatorYToLat(latToMercatorY(lat)) - lat));
  maxForm = Math.max(maxForm, Math.abs(latToMercatorY(lat) - mercY(lat)));
}
check('GLSL latToMercatorY == exact Mercator y (double)', maxForm < 1e-12, `max |dy| = ${maxForm.toExponential(2)}`);
check('GLSL mercatorYToLat(latToMercatorY(lat)) round trip', maxRT < 1e-9, `max |dlat| = ${maxRT.toExponential(2)} deg`);

// float32 emulation of mercatorYToLat at mid-latitudes (GPU precision at z<=6, global coords)
const f = Math.fround;
function mercatorYToLat32(y) {
  const a = f(Math.PI * f(1 - f(2 * y)));
  const s = f(f(f(Math.exp(a)) - f(Math.exp(-a))) * 0.5);
  return f(f(Math.atan(s)) * f(180 / Math.PI));
}
let max32 = 0;
for (let lat = -80; lat <= 80; lat += 0.37) max32 = Math.max(max32, Math.abs(mercatorYToLat32(f(mercY(lat))) - lat));
console.log(`INFO  float32 mercatorYToLat max error over +-80 deg = ${max32.toExponential(2)} deg (~${(max32 * 111320).toFixed(1)} m)`);

// Isotropy / Jacobian: ratio shader/exact must be one constant for every lat and direction.
const k = 1e-4, dt = 1.0;
const cases = [];
for (const lat of [0, 30, 45, 60, 75, 84]) for (const [u, v, name] of [[10, 0, 'E'], [0, 10, 'N'], [7.071, 7.071, 'NE'], [-3, 8, 'NNW']]) cases.push({ lat, u, v, name });
const ratios = [];
let maxAngleErr = 0;
for (const c of cases) {
  const s = shaderOffset(c.u, c.v, c.lat, k), e = exactDelta(c.u, c.v, c.lat, dt);
  const rs = Math.hypot(...s), re = Math.hypot(...e);
  ratios.push(rs / re);
  const ang = Math.atan2(s[1], s[0]) - Math.atan2(e[1], e[0]);
  maxAngleErr = Math.max(maxAngleErr, Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) * 180 / Math.PI);
}
const r0 = ratios[0];
const maxRel = Math.max(...ratios.map(r => Math.abs(r / r0 - 1)));
// Tolerance: central differences on a 10 m step have O((step/R)^2) ~ 1e-12 relative error; 1e-6 is generous.
check('screen motion is isotropic sec(lat)-scaled (conformal Jacobian), all lats/directions', maxRel < 1e-6, `max rel spread = ${maxRel.toExponential(2)}`);
check('screen direction == projected geographic direction', maxAngleErr < 1e-4, `max angle err = ${maxAngleErr.toExponential(2)} deg`);
for (const lat of [0, 45, 60]) {
  const s = shaderOffset(10, 0, lat, k);
  console.log(`INFO  10 m/s-units east at lat ${lat}: shader dx = ${s[0].toExponential(4)} (x sec(lat) = ${(1 / Math.cos(lat * Math.PI / 180)).toFixed(4)})`);
}
// Pole clamp: max(0.1, cos) engages above 84.26 deg; MapLibre clamps at 85.05.
const clampLat = Math.acos(0.1) * 180 / Math.PI;
console.log(`INFO  merc_scale clamp engages at |lat| > ${clampLat.toFixed(2)} deg (map limit 85.05): at 85 deg motion under-reads by ${((1 - Math.cos(85 * Math.PI / 180) / 0.1) * 100).toFixed(1)}%`);

// ---- 4. Zoom invariance of screen speed (engine stableSpeedScale) ----
check('engine formula text present', engine.includes('Math.max(2.5e-6, this.speedFactor * Math.pow(0.5, z) * 0.00025)'));
const speedFactor = Number((engine.match(/this\.speedFactor = ([0-9.]+);/) || [])[1]);
console.log(`INFO  speedFactor = ${speedFactor} (WebGLWindEngine.js)`);
const scale = z => (z > 6.0 ? speedFactor * Math.pow(0.5, z) * 0.00025 : Math.max(2.5e-6, speedFactor * Math.pow(0.5, z) * 0.00025));
const rows = [];
for (const z of [0, 2, 4, 5, 5.5, 5.8, 6.0, 6.01, 7, 10]) rows.push(`z${z}: ${(scale(z) * 512 * Math.pow(2, z) * 60).toFixed(3)} px/s per kn @equator`);
console.log('INFO  ' + rows.join(' | '));
const jump = (scale(6.0) * 512 * 64) / (scale(6.0001) * 512 * Math.pow(2, 6.0001));
console.log(`INFO  speed step across z=6 boundary: x${jump.toFixed(3)} (floor 2.5e-6 binds for z > ${Math.log2(speedFactor * 0.00025 / 2.5e-6).toFixed(2)})`);

// ---- 5. frameTimeScale (extracted from WebGLWindUtils.js and evaluated) ----
const _u = utils.split(String.fromCharCode(13)).join(''); const _i = _u.indexOf('export function frameTimeScale('); const fts = _u.slice(_i, _u.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), _i) + 2).replace('export ', '');
const REFERENCE_FRAME_MS = 1000 / 60, FRAME_SCALE_MIN = Number(utils.match(/FRAME_SCALE_MIN = ([0-9.]+)/)[1]), FRAME_SCALE_MAX = Number(utils.match(/FRAME_SCALE_MAX = ([0-9.]+)/)[1]);
const frameTimeScale = new Function('REFERENCE_FRAME_MS', 'FRAME_SCALE_MIN', 'FRAME_SCALE_MAX', `${fts}; return frameTimeScale;`)(REFERENCE_FRAME_MS, FRAME_SCALE_MIN, FRAME_SCALE_MAX);
const eng = {};
const seq = [0, 16.667, 25, 33.333, 5033.333, 5050];
const out = seq.map(t => frameTimeScale(eng, t).toFixed(3));
console.log(`INFO  frameTimeScale over t=${seq.join(',')} ms -> ${out.join(', ')}`);
check('120 Hz frame -> 0.5 step (per-second invariance)', Math.abs(frameTimeScale({ _lastWindFrameAt: 0 }, 8.333) - 0.5) < 1e-3);
check('5 s hidden-tab gap clamps to 3 frames', frameTimeScale({ _lastWindFrameAt: 0 }, 5000) === 3);

// ---- 6. Grid point registration (copied module text, evaluated) ----
const regMod = regSrc.split(String.fromCharCode(13)).join('').replace(/export /g, '');
const { gridPointReg } = new Function(`${regMod}; return { gridPointReg };`)();
for (const n of [181, 9, 2]) {
  const r = gridPointReg({ cols: n, rows: n }, {});
  const map = uv => uv + uv * r[0] + r[2];
  const t0 = map(0) * n - 0.5, t1 = map(1) * n - 0.5, tm = map(0.5) * n - 0.5;
  check(`ptReg n=${n}: uv 0/0.5/1 -> texel 0/(n-1)/2/(n-1)`, Math.abs(t0) < 1e-12 && Math.abs(t1 - (n - 1)) < 1e-9 && Math.abs(tm - (n - 1) / 2) < 1e-9, `${t0.toFixed(6)}, ${tm.toFixed(6)}, ${t1.toFixed(6)}`);
}

// ---- 7. 8-bit wind texture quantisation (encodeWindTexture uses Math.floor) ----
check('encodeWindTexture floors (not rounds)', utils.includes('data[i * 4 + 0] = Math.floor(nu * 255);'));
const decode = (val, lo, hi) => { const b = Math.floor((val - lo) / (hi - lo) * 255); return lo + (hi - lo) * b / 255; };
for (const [lo, hi] of [[-20, 25], [-45, 55], [-90, 80]]) {
  const lsb = (hi - lo) / 255;
  let sum = 0, n = 0, worst = 0;
  for (let x = lo; x <= hi; x += lsb / 37) { const e = decode(x, lo, hi) - x; sum += e; n++; worst = Math.min(worst, e); }
  const calmU = decode(0, lo, hi), calmV = decode(0, lo, hi);
  console.log(`INFO  range [${lo},${hi}] kn: LSB ${lsb.toFixed(3)} kn, mean bias ${(sum / n).toFixed(3)} kn, worst ${worst.toFixed(3)} kn, calm (0,0) decodes to |w| = ${Math.hypot(calmU, calmV).toFixed(3)} kn`);
}

// ---- 8. Speed gamma: same wind, different grid max -> different screen speed ----
const gamma = Number((engine.match(/let speedGamma = ([0-9.]+);/) || [])[1]);
const motion = (s, smax) => s * Math.pow(Math.min(Math.max(s / Math.max(smax, 1), 0.02), 1), gamma - 1);
console.log(`INFO  speedGamma ${gamma}: 10 kn moves at x${(motion(10, 60) / motion(10, 30)).toFixed(3)} when the grid max goes 30 -> 60 kn; 40 kn vs 10 kn screen-speed ratio = ${(motion(40, 60) / motion(10, 60)).toFixed(3)} (linear = 4)`);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exitCode = fails ? 1 : 0;
