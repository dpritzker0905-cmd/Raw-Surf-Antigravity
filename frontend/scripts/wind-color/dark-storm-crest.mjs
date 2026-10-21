// DARK STORM CREST CHECKER (2026-10-20): dark's crest core against dark's wave-height wash, AS DRAWN, by height. Dark keeps its own
// palettes (the owner likes dark): this judges the one place the owner flagged, storms of 8 m and up, where the wash runs magenta
// (5 m) to white (10 m+) past the fiery-orange storm crest. Judged APCA |Lc| first (a crest is a moving mark, and motion needs
// luminance contrast: Lindsey & Teller 1990), colour-blind CIEDE2000 second (light-path-lib.mjs's port of coloraide's dichromats).
//
// The model, read from the sources the app ships (it throws if they move):
//  - wash: getThemedWaveColor's dark branch (WebGLMarineShaders.js), non-surf (c0/c1 lifted, getNonlinearT's 0.6/1.2/2.4/5 m knots
//    and 0.20/0.46/0.72/0.94 splits), the depth floor under 0.18 m, + vec3(0.03, 0.05, 0.08) * dir * smoothstep(0.1, 3.0, h)
//    (NOT clamped before the alpha: HEATMAP_FS writes vec4(finalColor * a, a)), premultiplied over dark's basemap water.
//  - alpha: heatmapZoomOpacity(z) (marineEngineDecisions.js): 0.65 at z <= 3, 0.75 at z 8, 0.80 at z 13; and 0.90, above BLEND BOTH's
//    composite (a regional tile over the held coarse base: 1 - (1 - a)(1 - 0.72 a), at most 0.885 at z 8; #425).
//  - water: (93, 117, 126), dark's basemap water as drawn with Waves off (scn_wave_palette_ab.js THEMES=dark, 2026-10-20).
//  - a crest is judged by its strongest part: its core, or, where the self-contrast is on (z 3.5-4.4, or the cased alternative from
//    8 m), its darker rim (ellipse distance 0.7, alpha 0.70) when that stands off the wash more.
//  - crest (DRAW_FS): e = smoothstep(0, 6, h), base = mix(calm, active, 2e) | mix(active, storm, 2e - 1), white mixed in by the
//    whitecap roll * 0.45 (v_whitecap = smoothstep(0.5, 3, h) * (1 + closeup * 0.5): 1, and 1.5 at close zoom), laid at 0.85 (a
//    core's alpha cap). In z 3.5-4.4 u_crestContrast lifts the core: c * 1.30 + 0.18 (the "band" view). calm/active/foam are the
//    shader's dark literals; storm is marineCrestPalette.js DARK_STORM_CRESTS (v1 = today, v2 = cased orange from 8 m, D-039).
//  - the wave texture stores h / 10 in a byte (dark stays /10 with #415's 16 m encoding): nothing above 10 m reaches the GPU.
//
// Usage (from this folder): node dark-storm-crest.mjs [--from 5] [--strict] [--json out.json] [--lut lut.json]
//   --lut writes the wash ramp per harness view (h 0-10 m x swell lighting) for ../offline-backend/crest_by_height.py.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { apcaLc, allDE, dE, ss } from './wave-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP = path.join(HERE, '..', '..', 'src', 'components', 'map');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const read = (f) => fs.readFileSync(path.join(MAP, f), 'utf8');
const vec = (s) => s.split(',').map(Number);
const need = (src, re, what) => { const m = re.exec(src); if (!m) throw new Error(`dark-storm-crest.mjs: ${what} not found; the shader moved, update this model`); return m; };

// --- the wash, from WebGLMarineShaders.js ---
const SH = read('WebGLMarineShaders.js');
const darkBlock = need(SH, /\/\/ Dark Mode: cosmic navy[^\n]*\n([\s\S]*?)\n {2}\}/, 'the dark wave ramp')[1];
const ANCH = [0, 1, 2, 3, 4, 5].map((k) => vec(need(darkBlock, new RegExp(`c${k} = vec3\\(([^)]*)\\)`), `dark c${k}`)[1]));
const lift = need(SH, /c1 = vec3\(([^)]*)\); \/\/ 2ft\/0\.6m - Neon Spring Green[\s\S]*?c0 = vec3\(([^)]*)\); \/\/ 0\.0m - Deep Ocean Blue/, 'the non-surf dark lifts');
ANCH[1] = vec(lift[1]); ANCH[0] = vec(lift[2]);
for (const line of ['return 0.20 + ((h - 0.6) / 0.6) * 0.26;', 'return 0.46 + ((h - 1.2) / 1.2) * 0.26;', 'return 0.72 + ((h - 2.4) / 2.6) * 0.22;',
  'return 0.94 + clamp((h - 5.0) / 5.0, 0.0, 1.0) * 0.06;', 'float b4 = surfMode > 0.5 ? 0.92 : 0.94;', 'float waveBlend = smoothstep(0.0, 0.18, displayHeight);',
  'vec3 directionalSwellLighting = vec3(0.03, 0.05, 0.08) * directional;', 'directional *= smoothstep(0.1, 3.0, displayHeight);',
  'gl_FragColor = vec4(finalColor * alpha, alpha);']) if (!SH.includes(line)) throw new Error(`dark-storm-crest.mjs: "${line}" not in WebGLMarineShaders.js; update this model`);
const FLOOR = vec(need(SH, /deepNavy = vec3\(([^)]*)\);\s*\/\/ deep space navy/, 'dark deepNavy')[1]);
const tNL = (h) => (h < 0.6 ? (h / 0.6) * 0.20 : h < 1.2 ? 0.20 + ((h - 0.6) / 0.6) * 0.26 : h < 2.4 ? 0.46 + ((h - 1.2) / 1.2) * 0.26
  : h < 5.0 ? 0.72 + ((h - 2.4) / 2.6) * 0.22 : 0.94 + Math.min(1, Math.max(0, (h - 5.0) / 5.0)) * 0.06);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (c) => c.map((v) => Math.min(1, Math.max(0, v)));
export function darkWash(h) {
  const t = tNL(h), B = [0, 0.20, 0.46, 0.72, 0.94, 1];
  for (let k = 0; k < 5; k++) if (t < B[k + 1] || k === 4) return mix(ANCH[k], ANCH[k + 1], Math.min(1, (t - B[k]) / (B[k + 1] - B[k])));
  return ANCH[5];
}
export const WATER = [93, 117, 126];
export const opacityAt = (z) => (z <= 3 ? 0.65 : z <= 8 ? 0.65 + (z - 3) / 5 * 0.10 : z <= 13 ? 0.75 + (z - 8) / 5 * 0.05 : 0.80);
/** One wash pixel on screen: height h (m, as the GPU reads it), alpha a, swell lighting dir 0..1. */
export function washOver(h, a, dir) {
  const W = mix(FLOOR, darkWash(h), ss(0, 0.18, h)), water = WATER.map((v) => v / 255);
  return clamp01(W.map((v, i) => (v + [0.03, 0.05, 0.08][i] * dir * ss(0.1, 3.0, h)) * a + water[i] * (1 - a)));
}

// --- the crest, from WebGLMarineParticleShaders.js + marineCrestPalette.js ---
const PS = read('WebGLMarineParticleShaders.js');
const darkCrest = need(PS, /\/\/ Dark Mode\n\s*calmColor = vec3\(([^)]*)\);[^\n]*\n\s*activeColor = vec3\(([^)]*)\);[^\n]*\n\s*stormColor = \$\{DARK_STORM_CREST_GLSL\.storm\}\r?\n\s*foamHighlight = vec3\(([^)]*)\);/, 'DRAW_FS dark crest');
const [CALM, ACTIVE, FOAM] = [darkCrest[1], darkCrest[2], darkCrest[3]].map(vec);
need(PS, /crestContrastEff = max\(u_crestContrast,\s*\$\{DARK_STORM_CREST_GLSL\.casing\}/, 'the self-contrast hook for the cased alternative');
for (const line of ['float energy = smoothstep(0.0, 6.0, v_wave_height);', 'float whiteBlend = whitecapRoll * 0.45;', 'boostedAlpha = min(boostedAlpha, 0.85);',
  'float lum = mix(0.55, 1.30, core);', 'vec3 contrasted = finalColor * lum + foamHighlight * core * 0.18;', 'v_whitecap = smoothstep(0.5, 3.0, waveHeight) * (1.0 + closeup * 0.5);'])
  if (!PS.includes(line)) throw new Error(`dark-storm-crest.mjs: "${line}" not in WebGLMarineParticleShaders.js; update this model`);
// The crest module evaluated with no window (default ids); its imports (the wave palette's ids) are handed in by name.
const CP_SRC = read('marineCrestPalette.js'), CP = CP_SRC.replace(/^import [^\n]*$/gm, '').replace(/^export /gm, '');
const IMPORTED = [...CP_SRC.matchAll(/^import \{([^}]*)\}/gm)].flatMap((m) => m[1].split(',').map((n) => n.trim()).filter(Boolean));
const GIVEN = { MARINE_WAVE_PALETTE_ENABLED: true, MARINE_WAVE_PALETTE_ID: 'v2', MARINE_WAVE_PALETTE_IDS: { light: 'v2', beach: 'v1' }, BEACH_WASH_ID: 'mid' };
export const { DARK_STORM_CRESTS } = new Function(...IMPORTED, `${CP}; return { DARK_STORM_CRESTS };`)(...IMPORTED.map((n) => GIVEN[n]));
/** A dark crest core over `under`: storm table entry `t`, whitecap share wc (0, 1, 1.5), z3.5-4.4 core lift `band` 0..1. */
export function crestOver(h, under, t, wc = 0, band = 0, part = 'core') {
  const up = t.switchHeight !== undefined && h >= t.switchHeight, storm = up && t.storm.above ? t.storm.above : t.storm.rgb, e = ss(0, 6, h);
  let c = e < 0.5 ? mix(CALM, ACTIVE, e * 2) : mix(ACTIVE, storm, (e - 0.5) * 2);
  c = mix(c, FOAM, wc * ss(0.5, 3.0, h) * 0.45);
  const lift = Math.max(band, t.casing && up ? 1 : 0);   // u_crestContrast (z 3.5-4.4), or the cased alternative's 8 m+ term
  // The self-contrast's core (ellipse distance 0: c * 1.30 + 0.18 white) or its rim (distance 0.7: core weight 0.12, c * 0.64, laid at
  // alpha 0.70, the middle of the rim's 0.57-0.85 as baseRipple and foam breakup thin it).
  const k = part === 'rim' ? RIM : { core: 1, alpha: 0.85 };
  if (lift) c = mix(c, c.map((v, i) => v * (0.55 + 0.75 * k.core) + FOAM[i] * k.core * 0.18), lift);
  return clamp01(clamp01(c).map((v, i) => v * k.alpha + under[i] * (1 - k.alpha)));
}
const RIM = { core: 1 - ss(0.15, 0.85, 0.7), alpha: 0.70 };

// --- the check ---
const q8 = (h) => Math.floor(Math.min(1, h / 10) * 255) / 255 * 10;   // the byte the GPU reads (h / 10, floored: WebGLMarineTextureEncoder)
export const VIEWS = [['world', opacityAt(2.2), 0], ['band', opacityAt(4.0), 1], ['regional', opacityAt(5.5), 0], ['coastal', opacityAt(10), 0],
  ['close', opacityAt(13), 0], ['overlay on base', 0.90, 0]];   // [name, wash alpha, u_crestContrast]
const DIRS = [0, 0.5, 1];
export function judgeAt(h, t) {
  const g = q8(h), r = { body: Infinity, core: Infinity, rim: Infinity, front: Infinity, closeFront: Infinity, cvd: { de: Infinity }, normal: Infinity, signed: null };
  const lifted = (band) => band || (t.casing && g >= t.switchHeight);
  for (const [view, a, band] of VIEWS) for (const dir of DIRS) {
    const u = washOver(g, a, dir), c0 = crestOver(g, u, t, 0, band);
    // A crest is seen by its strongest part: its core, or (when the self-contrast is on) its darker rim.
    const parts = [c0, ...(lifted(band) ? [crestOver(g, u, t, 0, band, 'rim')] : [])];
    const lcs = parts.map((c) => apcaLc(c, u)), best = lcs.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
    r.core = Math.min(r.core, Math.abs(lcs[0])); if (parts.length > 1) r.rim = Math.min(r.rim, Math.abs(lcs[1]));
    if (Math.abs(best) < r.body) { r.body = Math.abs(best); r.signed = best; r.where = `${view}, lighting ${dir}`; }
    const cvs = parts.map((c) => allDE(c, u)), cv = cvs.reduce((m, v) => (v.de > m.de ? v : m));
    if (cv.de < r.cvd.de) r.cvd = cv;
    r.normal = Math.min(r.normal, Math.max(...parts.map((c) => dE(c, u))));
    if (!band) { r.front = Math.min(r.front, Math.abs(apcaLc(crestOver(g, u, t, 1), u))); r.closeFront = Math.min(r.closeFront, Math.abs(apcaLc(crestOver(g, u, t, 1.5), u))); }
  }
  return r;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const FROM = Number(arg('--from', 5)), ids = Object.keys(DARK_STORM_CRESTS), out = { water: WATER, views: VIEWS, rows: [] };
  const f = (x) => x.toFixed(1).padStart(5);
  console.log(`Dark crest core vs dark wash (water ${WATER}), worst over ${VIEWS.map((v) => v[0]).join('/')} x lighting ${DIRS.join('/')}.`);
  console.log(`cells: body APCA |Lc| (sign: + crest darker) / whitecap front / close-zoom front | colour-blind dE00 (kind) | normal dE00`);
  console.log(`   h    | ${ids.map((id) => `${id} (${DARK_STORM_CRESTS[id].storm.name})`.padEnd(54)).join('| ')}`);
  const heights = []; for (let k = Math.round(FROM * 10); k <= 100; k++) heights.push(k / 10); heights.push('10+');
  const worst = Object.fromEntries(ids.map((id) => [id, { body: Infinity, front: Infinity, cvd: Infinity, below: true }]));
  for (const H of heights) {
    const h = H === '10+' ? 11 : H, cells = [];
    for (const id of ids) {
      const r = judgeAt(h, DARK_STORM_CRESTS[id]);
      cells.push(`${f(r.signed)} /${f(r.front)} /${f(r.closeFront)} | ${f(r.cvd.de)} ${(r.cvd.kind || '').padEnd(7)}| ${f(r.normal)}  `);
      out.rows.push({ h: H, id, body: r.body, core: r.core, rim: r.rim === Infinity ? null : r.rim, signedLc: r.signed, front: r.front, closeFront: r.closeFront, cvd: r.cvd.de, cvdKind: r.cvd.kind, normal: r.normal, worstView: r.where });
      if (h >= 8) { const w = worst[id]; w.body = Math.min(w.body, r.body); w.front = Math.min(w.front, r.front); w.cvd = Math.min(w.cvd, r.cvd.de); }
    }
    if (typeof H === 'string' || H >= 7.5 || Math.round(H * 10) % 5 === 0) console.log(`${String(H).padStart(5)} m | ${cells.join('| ')}`);
  }
  // Below the switch every candidate must draw today's crest exactly (the change is 8 m+ only).
  let same = true; for (let h = 0; h < 8; h += 0.01) for (const id of ids) { const u = washOver(h, 0.7, 0.5); if (crestOver(h, u, DARK_STORM_CRESTS[id]).some((v, i) => v !== crestOver(h, u, DARK_STORM_CRESTS.v1)[i])) same = false; }
  console.log(`\n[${same ? 'ok' : 'RED'}] below 8 m every candidate draws today's crest (0-8 m every 0.01 m)`);
  let red = !same;
  // The bar D-039 accepted (the owner picked the cased orange on its measured numbers): from 8 m a crest stands off the wash at
  // |Lc| >= 20 everywhere, never below today's at any height, and loses no colour-blind contrast against today.
  const at = (id, H) => out.rows.find((r) => r.id === id && r.h === H);
  for (const id of ids) {
    const w = worst[id], notWorse = heights.every((H) => (H === '10+' || H >= 8 ? at(id, H).body >= at('v1', H).body - 1e-9 : true));
    const ok = w.body >= 20 && notWorse && w.cvd >= worst.v1.cvd;
    if (id !== 'v1' && !ok) red = true;
    console.log(`[${id === 'v1' ? 'today' : ok ? 'ok' : 'RED'}] ${id}: 8 m and up, worst body |Lc| ${f(w.body)}, whitecap front ${f(w.front)}, colour-blind ${f(w.cvd)} dE00 (bar: |Lc| >= 20, never below today's, colour-blind >= today's)`);
  }
  out.worst8 = worst;
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(out, null, 1));
  if (arg('--lut')) {   // the wash ramp per harness view (scn_wave_palette_ab.js VIEWS zooms) for crest_by_height.py
    const views = { world: 2.2, regional: 4.6, eye: 6.0, coastal: 7.4 }, lut = { water: WATER, views: {} };
    for (const [v, z] of Object.entries(views)) {
      const rows = []; for (let k = 0; k <= 400; k++) for (const dir of [0, 0.25, 0.5, 0.75, 1]) { const h = k / 40; rows.push([h, dir, ...washOver(h, opacityAt(z), dir)]); }
      lut.views[v] = { zoom: z, alpha: opacityAt(z), rows };
    }
    fs.writeFileSync(arg('--lut'), JSON.stringify(lut));
    console.log(`wrote ${arg('--lut')}`);
  }
  if (args.includes('--strict') && red) process.exit(1);
}
