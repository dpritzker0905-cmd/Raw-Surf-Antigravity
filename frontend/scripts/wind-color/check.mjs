// WIND PALETTE CHECKER — judges the wind colours as they are actually COMPOSITED over each basemap, not as bare swatches.
//
// Why a tool of its own (reports/Color and motion tools for Claude.md): light/beach draw the field as a MULTIPLY tint
// (out = map x (1 - s(1 - c)), encoded sRGB) and dark as an alpha-over field; the particles sit on top of that tint. No
// palette plugin or connector models either, and every "blends into the water" report this project had (#285, #288)
// lived in the composite between the stops, not in the swatches. Libraries: culori (CIEDE2000, Lab) here; coloraide
// (Vienot/Brettel colour-blind models) in cvd_check.py, called automatically when ./.venv exists.
//
// Usage (from this folder):  npm i; py -3.12 -m venv .venv; .venv/Scripts/python -m pip install coloraide==8.13
//                            node check.mjs [--theme light|beach|dark] [--json out.json] [--strict]
// Exit code 1 with --strict when any RED line is printed (here or in the colour-blind check).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import os from 'os';
import { differenceCiede2000, converter } from 'culori';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAMP_SRC = path.join(HERE, '..', '..', 'src', 'components', 'map', 'WindColorRamp.js');
const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

// The real ramps, straight from the source the app ships (export keywords stripped; the module has no imports).
const src = fs.readFileSync(RAMP_SRC, 'utf8').replace(/^export /gm, '');
const { THEME_RAMPS, FIELD_RAMPS } = new Function(src + '; return { THEME_RAMPS, FIELD_RAMPS };')();

// Composite model — keep in sync with HEATMAP_FS / DRAW_FS and windFieldLut.test.js (TINT, SURFACES, BASEMAP).
const MODEL = {
  light: { kind: 'multiply', op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65, pop: 1.0, surfaces: { water: [168, 214, 222], land: [236, 236, 232] } },
  beach: { kind: 'multiply', op: 0.55, baseA: 0.45, end: 7, k: 0.60 / 0.55, pop: 0.6, surfaces: { water: [150, 190, 200], land: [222, 208, 180] } },
  dark: { kind: 'over', op: 0.48, baseA: 0.44, end: 5, k: 1, pop: null, surfaces: { water: [93, 117, 126] } },
};
// tintFromKn: 3 kn is the owner's "middle ground" (a deliberately soft tint, ~9-11 dE00), so the tint floor starts at 6 kn.
// blendRedKn: a violet -> green ramp must hand off across a cyan water's hue once; > 2 kn of it is a real blend zone.
const TARGET = { hueGapWatch: 20, blendRedKn: 2, tintDE: 14, tintFromKn: 6, streakDL: 3, adjDE: 9 };

const lab = converter('lab65'), rgb = (a) => ({ mode: 'rgb', r: a[0], g: a[1], b: a[2] });
const de = (a, b) => differenceCiede2000()(rgb(a), rgb(b));
const L = (a) => lab(rgb(a)).l, hue = (a) => { const c = lab(rgb(a)); return (Math.atan2(c.b, c.a) * 180 / Math.PI + 360) % 360; };
const hgap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const sample = (ramp, v) => { if (v <= ramp[0][0]) return ramp[0].slice(1); for (let i = 1; i < ramp.length; i++) if (v <= ramp[i][0]) { const t = (v - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0]); return [1, 2, 3, 4].map((j) => ramp[i - 1][j] + (ramp[i][j] - ramp[i - 1][j]) * t); } return ramp[ramp.length - 1].slice(1); };
const strength = (m, v) => Math.min(1, m.op * (m.baseA + (1 - m.baseA) * ss(0, m.end, v)) * m.k);
const tintOver = (m, v, c, bm) => (m.kind === 'multiply' ? bm.map((x, i) => x * (1 - strength(m, v) * (1 - c[i]))) : bm.map((x, i) => c[i] * strength(m, v) + x * (1 - strength(m, v))));

const out = {}; let red = 0;
const flag = (bad, watch) => (bad ? (red++, 'RED ') : watch ? 'warn' : ' ok ');
for (const theme of (arg('--theme') ? [arg('--theme')] : ['light', 'beach', 'dark'])) {
  const m = MODEL[theme], P = THEME_RAMPS[theme], F = (FIELD_RAMPS && FIELD_RAMPS[theme]) || P, rows = [];
  console.log(`\n=== ${theme.toUpperCase()}  (${m.kind} field; ${Object.keys(m.surfaces).join(' + ')})`);
  // Legend stops: adjacent separation in normal vision (colour-blind separation: cvd_check.py).
  const adj = P.slice(1).map((s, i) => ({ kn: `${P[i][0]}-${s[0]}`, de: de(P[i].slice(1, 4), s.slice(1, 4)) }));
  const worstAdj = adj.reduce((w, x) => (x.de < w.de ? x : w));
  console.log(`[${flag(worstAdj.de < TARGET.adjDE)}] legend: weakest neighbours ${worstAdj.kn} kn at ${worstAdj.de.toFixed(1)} dE00 (target >= ${TARGET.adjDE})`);
  const tintStops = {};
  for (const [surf, bm0] of Object.entries(m.surfaces)) {
    const bm = bm0.map((x) => x / 255), hb = hue(bm), blend = [];
    tintStops[surf] = F.filter((st) => st[0] >= 3).map((st) => ({ kn: st[0], rgb: tintOver(m, st[0], st.slice(1, 4), bm) }));
    for (let v = 1; v <= 40; v += 0.5) {
      const f = sample(F, v), p = sample(P, v), T = tintOver(m, v, f.slice(0, 3), bm);
      const r = { surf, v, tintDE: de(bm, T), hueGap: hgap(hue(T), hb), tintDL: L(T) - L(bm) };
      if (m.pop) { const a = p[3] * m.pop, S = p.slice(0, 3).map((c, j) => c * a + T[j] * (1 - a)); r.streakDL = L(S) - L(T); }
      rows.push(r); if (r.hueGap < TARGET.hueGapWatch && v >= 3) blend.push(v);
    }
    const mine = rows.filter((r) => r.surf === surf && r.v >= TARGET.tintFromKn), wDE = mine.reduce((w, r) => (r.tintDE < w.tintDE ? r : w)), wS = m.pop ? mine.reduce((w, r) => (Math.abs(r.streakDL) < Math.abs(w.streakDL) ? r : w)) : null;
    console.log(`[${flag(wDE.tintDE < TARGET.tintDE * 0.8, wDE.tintDE < TARGET.tintDE)}] ${surf}: tint is weakest at ${wDE.v} kn, ${wDE.tintDE.toFixed(1)} dE00 off the ${surf} (target >= ${TARGET.tintDE})`);
    if (surf === 'water') console.log(`[${flag(blend.length * 0.5 > TARGET.blendRedKn, blend.length > 0)}] ${surf}: speeds where the tint sits < ${TARGET.hueGapWatch} deg off the ${surf} hue (reads as more ${surf}): ${blend.length ? blend[0] + '-' + blend[blend.length - 1] + ' kn (' + blend.length * 0.5 + ' kn)' : 'none'}`);
    // The streak is a white ring around a ~1 px speed-colour core; the ring carries the motion, so a core that matches its
    // tint in lightness is a watch item (the core's colour stops reading), not a failure.
    if (wS) console.log(`[${flag(false, Math.abs(wS.streakDL) < TARGET.streakDL)}] ${surf}: speed-colour core vs its own tint is weakest at ${wS.v} kn, ${wS.streakDL.toFixed(1)} L* (watch below |${TARGET.streakDL}| L*)`);
  }
  out[theme] = { legendAdjacent: adj, rows, tintStops, stops: { particle: P, field: F } };
}
const jsonPath = arg('--json') || path.join(os.tmpdir(), 'wind-color-check.json');
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 1));
console.log(`\n${red} red line(s) above.`);
// Colour-blind check (coloraide), when the venv exists.
const py = [path.join(HERE, '.venv', 'Scripts', 'python.exe'), path.join(HERE, '.venv', 'bin', 'python')].find((p) => fs.existsSync(p));
let cvdRed = 0;
if (py) {
  console.log('\n=== COLOUR-BLIND (coloraide: Vienot protan/deutan, Brettel tritan)');
  cvdRed = spawnSync(py, [path.join(HERE, 'cvd_check.py'), jsonPath, '--strict'], { stdio: 'inherit' }).status || 0;
} else console.log('\n(colour-blind check skipped: create ./.venv with coloraide, see the usage line at the top)');
if (args.includes('--strict') && (red || cvdRed)) process.exit(1);
