// WIND PALETTE CHECKER — judges the wind colours as they are actually COMPOSITED over each basemap, not as bare swatches.
//
// Why a tool of its own (reports/Color and motion tools for Claude.md): light/beach draw the field as a MULTIPLY tint
// (out = map x (1 - s(1 - c)), encoded sRGB) and dark as an alpha-over field; the particles sit on top of that tint. No
// palette plugin or connector models either, and every "blends into the water" report this project had (#285, #288)
// lived in the composite between the stops, not in the swatches. Libraries: culori (CIEDE2000, Lab) here; coloraide
// (Vienot/Brettel colour-blind models) in cvd_check.py, called automatically when ./.venv exists.
//
// Basemap mute (2026-10-09, src/components/map/windBasemapMute.js): while the wind is on, light and beach show their
// ground with most of its chroma removed and the water a little darker. The surfaces below are the basemap's own colours;
// they are muted with the app's own function before compositing (--no-mute models the map as it was before).
// Usage (from this folder):  npm i; py -3.12 -m venv .venv; .venv/Scripts/python -m pip install coloraide==8.13
//                            node check.mjs [--theme light|beach|dark] [--json out.json] [--strict] [--no-mute]
//                            node check.mjs --look moderate|deep|ink   (light's look A/B, window.__RAW_WIND_LIGHT_LOOK__)
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
const { THEME_RAMPS, huePathStops, resolveFieldRamp, resolveMarkRamp } = new Function(src + '; return { THEME_RAMPS, huePathStops, resolveFieldRamp, resolveMarkRamp };')();
// The app's basemap mute, from its source (no imports; export keywords stripped): the ground the wind actually sits on.
const muteSrc = fs.readFileSync(path.join(HERE, '..', '..', 'src', 'components', 'map', 'windBasemapMute.js'), 'utf8').replace(/^export /gm, '');
const { muteColor, windBasemapMuteAmount, windBasemapWaterL } = new Function(muteSrc + '; return { muteColor, windBasemapMuteAmount, windBasemapWaterL };')();
const NO_MUTE = args.includes('--no-mute');
// --mute-amount / --water-l: explore other mute settings (the app's own lever names, passed as levers).
const LEVERS = { ...(arg('--mute-amount') ? { __RAW_WIND_BASEMAP_MUTE__: Number(arg('--mute-amount')) } : {}), ...(arg('--water-l') ? { __RAW_WIND_BASEMAP_WATER_L__: Number(arg('--water-l')) } : {}),
  ...(arg('--look') ? { __RAW_WIND_LIGHT_LOOK__: arg('--look') } : {}) };
const groundOf = (theme, surf, c) => {
  const amount = NO_MUTE ? 0 : windBasemapMuteAmount(theme, LEVERS);
  if (!(amount > 0)) return c;
  const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${c.join(', ')})`, amount, surf === 'water' ? windBasemapWaterL(theme, LEVERS) : 1));
  return [+m[1], +m[2], +m[3]];
};

// Composite model — keep in sync with HEATMAP_FS / DRAW_FS and windFieldLut.test.js (TINT, SURFACES, BASEMAP).
const MODEL = {
  light: { kind: 'multiply', op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65, pop: 1.0, surfaces: { water: [168, 214, 222], land: [236, 236, 232] } },
  beach: { kind: 'multiply', op: 0.55, baseA: 0.45, end: 7, k: 0.60 / 0.55, pop: 0.6, surfaces: { water: [150, 190, 200], land: [222, 208, 180] } },
  dark: { kind: 'over', op: 0.48, baseA: 0.44, end: 5, k: 1, pop: null, surfaces: { water: [93, 117, 126] } },
};
// tintFromKn: 3 kn is the owner's "middle ground" (a deliberately soft tint, ~9-11 dE00), so the tint floor starts at 6 kn.
// blendRedKn: a violet -> green ramp must hand off across a cyan water's hue once; > 2 kn of it is a real blend zone.
// hueHeldKn: speeds (3-40 kn) whose tint over this ground sits > 30 deg off the legend colour's own hue (the ground
// bending the wind into another band's colour); the path bench's hue30 asks the same question of real frames.
// veilC: the weakest colour (CIELAB C*) the field may draw anywhere from 3 to 40 kn. A tint with no colour over a greyed map
// is a grey veil (the owner's "looks like fog"): light drew C* 1.0 at 13 kn, where the straight sRGB line from the 10 kn
// violet to the 16 kn green crossed grey. Checked on the PATH between the stops, where it lived.
// calmDE: calm is either the bare map or a tint the eye can name, never in between: a difference under the threshold of
// seeing, then a steep climb, is the toe that draws an edge round every calm patch (Kovesi 2015). Under the basemap mute the
// bare map is grey, so calm is a pale tint: at least calmDE off the ground, and weaker than the 3 kn tint.
const TARGET = { hueGapWatch: 20, blendRedKn: 2, tintDE: 14, tintFromKn: 6, streakDL: 3, adjDE: 9, hueHeldKn: 2, veilC: 8, calmDE: 5 };

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
  // The field and the marks as the app resolves them (a look lever picks its own; the legend never moves). Without a lever these are
  // FIELD_RAMPS / THEME_RAMPS exactly.
  const m = MODEL[theme], P = THEME_RAMPS[theme], F = resolveFieldRamp(theme, LEVERS) || P, K = resolveMarkRamp(theme, LEVERS), rows = [];
  // How a look's marks are laid (keep in sync with windInk.js WIND_LIGHT_LOOK): ink multiplied into the tint, A's lifted colour laid over it.
  const look = theme === 'light' ? LEVERS.__RAW_WIND_LIGHT_LOOK__ : null, LOOK_OP = { ink: 0.9, moderate: 1.0, deep: 1.0 };
  const markOn = (k, T) => (look === 'ink' ? T.map((x, j) => x * (1 - LOOK_OP.ink * (1 - k[j]))) : k.map((c, j) => c * LOOK_OP[look] + T[j] * (1 - LOOK_OP[look])));
  const muted = !NO_MUTE && windBasemapMuteAmount(theme, LEVERS) > 0;
  console.log(`\n=== ${theme.toUpperCase()}  (${m.kind} field; ${Object.keys(m.surfaces).join(' + ')}${muted ? '; basemap muted under the wind' : ''})`);
  // Legend stops: adjacent separation in normal vision (colour-blind separation: cvd_check.py).
  const adj = P.slice(1).map((s, i) => ({ kn: `${P[i][0]}-${s[0]}`, de: de(P[i].slice(1, 4), s.slice(1, 4)) }));
  const worstAdj = adj.reduce((w, x) => (x.de < w.de ? x : w));
  console.log(`[${flag(worstAdj.de < TARGET.adjDE)}] legend: weakest neighbours ${worstAdj.kn} kn at ${worstAdj.de.toFixed(1)} dE00 (target >= ${TARGET.adjDE})`);
  if (K) {   // a look's own mark colours: a watch line (the streaks' separation has never been a gate; the field and the legend carry the bands)
    const KB = K.filter((k) => F.some((f) => f[0] === k[0]));   // the 13 Beaufort bands (A's 11-15 kn waypoints are a path, not bands)
    const kAdj = KB.slice(1).map((s, i) => ({ kn: `${KB[i][0]}-${s[0]}`, de: de(KB[i].slice(1, 4), s.slice(1, 4)) })).reduce((w, x) => (x.de < w.de ? x : w));
    console.log(`[${flag(false, kAdj.de < TARGET.adjDE)}] marks (the look's own colours): weakest neighbours ${kAdj.kn} kn at ${kAdj.de.toFixed(1)} dE00 (watch below ${TARGET.adjDE})`);
  }
  const tintStops = {};
  for (const [surf, bm0] of Object.entries(m.surfaces)) {
    const bm = groundOf(theme, surf, bm0).map((x) => x / 255), hb = hue(bm), blend = [], bent = [];
    tintStops[surf] = F.filter((st) => st[0] >= 3).map((st) => ({ kn: st[0], rgb: tintOver(m, st[0], st.slice(1, 4), bm) }));
    const Fp = huePathStops(F), Pp = huePathStops(P), Kp = K ? huePathStops(K) : null;   // what the app draws BETWEEN the stops (WindColorRamp.js, HUE PATH)
    if (m.kind === 'multiply') {
      let veil = { c: Infinity, v: 0 };
      for (let v = 3; v <= 40; v += 0.25) { const t = lab(rgb(tintOver(m, v, sample(Fp, v).slice(0, 3), bm))), c = Math.hypot(t.a, t.b); if (c < veil.c) veil = { c, v }; }
      console.log(`[${flag(veil.c < TARGET.veilC)}] ${surf}: the field's weakest colour from 3 to 40 kn is C* ${veil.c.toFixed(1)} at ${veil.v} kn (a grey veil below ${TARGET.veilC})`);
      const calm = de(bm, tintOver(m, 0, sample(Fp, 0).slice(0, 3), bm)), three = de(bm, tintOver(m, 3, sample(Fp, 3).slice(0, 3), bm));
      console.log(`[${flag(calm < TARGET.calmDE || calm >= three)}] ${surf}: calm sits ${calm.toFixed(1)} dE00 off the bare ${surf} (a tint from ${TARGET.calmDE}; weaker than 3 kn's ${three.toFixed(1)})`);
    }
    for (let v = 1; v <= 40; v += 0.5) {
      const f = sample(Fp, v), p = sample(Pp, v), T = tintOver(m, v, f.slice(0, 3), bm);
      const r = { surf, v, tintDE: de(bm, T), hueGap: hgap(hue(T), hb), tintDL: L(T) - L(bm) };
      if (Kp) r.streakDL = L(markOn(sample(Kp, v).slice(0, 3), T)) - L(T);   // a look's own marks, laid its own way
      else if (m.pop) { const a = p[3] * m.pop, S = p.slice(0, 3).map((c, j) => c * a + T[j] * (1 - a)); r.streakDL = L(S) - L(T); }
      rows.push(r); if (r.hueGap < TARGET.hueGapWatch && v >= 3 && !muted) blend.push(v);
      const lc = lab(rgb(p.slice(0, 3))), tc = lab(rgb(T));
      if (v >= 3 && Math.hypot(lc.a, lc.b) >= 10 && Math.hypot(tc.a, tc.b) >= 6 && hgap(hue(T), hue(p.slice(0, 3))) > 30) bent.push(v);
    }
    const mine = rows.filter((r) => r.surf === surf && r.v >= TARGET.tintFromKn), wDE = mine.reduce((w, r) => (r.tintDE < w.tintDE ? r : w)), wS = m.pop ? mine.reduce((w, r) => (Math.abs(r.streakDL) < Math.abs(w.streakDL) ? r : w)) : null;
    console.log(`[${flag(wDE.tintDE < TARGET.tintDE * 0.8, wDE.tintDE < TARGET.tintDE)}] ${surf}: tint is weakest at ${wDE.v} kn, ${wDE.tintDE.toFixed(1)} dE00 off the ${surf} (target >= ${TARGET.tintDE})`);
    if (m.kind === 'multiply') console.log(`[${flag(bent.length * 0.5 > TARGET.hueHeldKn, bent.length > 0)}] ${surf}: speeds whose tint sits > 30 deg off the legend's own hue (the ground bends the wind's colour): ${bent.length ? bent.length * 0.5 + ' kn of 3-40 (' + bent[0] + '-' + bent[bent.length - 1] + ' kn)' : 'none'} (target <= ${TARGET.hueHeldKn} kn)`);
    // A grey ground has no hue for the tint to hide in: the "reads as more water" line only applies to the unmuted map.
    if (surf === 'water' && !muted) console.log(`[${flag(blend.length * 0.5 > TARGET.blendRedKn, blend.length > 0)}] ${surf}: speeds where the tint sits < ${TARGET.hueGapWatch} deg off the ${surf} hue (reads as more ${surf}): ${blend.length ? blend[0] + '-' + blend[blend.length - 1] + ' kn (' + blend.length * 0.5 + ' kn)' : 'none'}`);
    // The streak is a white ring around a ~1 px speed-colour core; the ring carries the motion, so a core that matches its
    // tint in lightness is a watch item (the core's colour stops reading), not a failure.
    if (wS) console.log(`[${flag(false, Math.abs(wS.streakDL) < TARGET.streakDL)}] ${surf}: speed-colour core vs its own tint is weakest at ${wS.v} kn, ${wS.streakDL.toFixed(1)} L* (watch below |${TARGET.streakDL}| L*)`);
  }
  // The marks' colour-blind watch reads them as drawn over the muted water: ink is never seen bare (it multiplies into the tint).
  const wg = groundOf(theme, 'water', m.surfaces.water).map((x) => x / 255);
  const shown = K ? K.filter((k) => F.some((f) => f[0] === k[0])).map((k) => [k[0], ...(look === 'ink' ? markOn(k.slice(1, 4), tintOver(m, k[0], sample(F, k[0]).slice(0, 3), wg)) : k.slice(1, 4)), k[4]]) : null;
  out[theme] = { legendAdjacent: adj, rows, tintStops, stops: { particle: P, field: F, ...(shown ? { marks: shown } : {}) } };
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
