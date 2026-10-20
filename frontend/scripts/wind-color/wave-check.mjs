// WAVE-HEIGHT PALETTE CHECKER: judges the light and beach wave-height wash as the engine DRAWS it (translucent over the basemap
// water, at the wash's alpha for world, regional and coastal zoom), not as bare swatches. The model is wave-lib.mjs.
// Colour blindness: light-path-lib.mjs's port of coloraide here (fast), and coloraide itself in wave_cvd_check.py (the
// authority), called automatically when ./.venv exists.
//
// Usage (from this folder; setup as in README.md):
//   node wave-check.mjs                          # every palette in marineWavePalette.js, both themes
//   node wave-check.mjs --palette A --theme beach
//   node wave-check.mjs --table cand.json        # a solver's candidate ({ heights, cap, over, light, beach }) instead
//   node wave-check.mjs --strict                 # exit 1 on any RED line (here or in the colour-blind authority)
//   node wave-check.mjs --json out.json
//
// Bars (2026-10-20 brief + D-019): lightness falls at every step as height grows (OKLCH L, on the wash AND the composite, with
// the swell lighting off, half and full); no grey (a ramp never runs through grey: wash C* >= 12 and composite C* >= 8 along
// the path); neighbouring legend stops >= 10 dE00 as composited, for normal vision and protan/deutan/tritan. Watch lines (not
// gates): land against sea, a crest's core against its wash, the legend bar on its panel (APCA Lc), the above-cap state, and the
// depth floor under 0.18 m.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { BASEMAP, ALPHAS, DEPTH_FLOOR, loadPalettes, washAt, composite, crestOver, oklab, apcaLc, dE, allDE, chromaStar } from './wave-lib.mjs';
import { de2000, simLab } from './light-path-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BAR = { adj: 10, washC: 12, compC: 8, land: 15, crest: 15, lc: 15, over: 10 };
const mod = loadPalettes();
const palettes = arg('--table') ? { [path.basename(arg('--table'), '.json')]: JSON.parse(fs.readFileSync(arg('--table'), 'utf8')) } : mod.WAVE_PALETTES;
const ids = arg('--palette') ? [arg('--palette')] : Object.keys(palettes);
const themes = arg('--theme') ? [arg('--theme')] : ['light', 'beach'];
const DIRS = [0, 0.5, 1];
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const rgb255 = (c) => c.map((v) => Math.round(v * 255));
let red = 0;
const flag = (bad, watch) => (bad ? (red++, 'RED ') : watch ? 'warn' : ' ok ');
const out = {};

for (const id of ids) {
  const P = palettes[id];
  out[id] = {};
  for (const theme of themes) {
    const H = P.heights, cap = P.cap, water = BASEMAP[theme].water.map((v) => v / 255), land = BASEMAP[theme].land.map((v) => v / 255), panel = BASEMAP[theme].panel.map((v) => v / 255);
    console.log(`\n=== ${theme.toUpperCase()}  palette ${id}  (anchors ${H.join(' ')} m; ${P.over ? `above ${cap} m: its own colour` : `clamped at ${cap} m`}; over the ${theme} water ${BASEMAP[theme].water.join(',')})`);
    // 1. Lightness: the wash, then the composite at each view and lighting. Sampled every 0.02 m from 0.18 m (the depth floor below).
    const anchorsL = H.map((h) => oklab(washAt(P, theme, h)).L);
    // Every 0.02 m step: the smallest fall (negative = a rise), and the total lightness the path climbs back and where.
    const walk = (Lof, from) => { let w = { d: Infinity, h: 0 }, up = 0, lo = null, hi = null; for (let h = from; h + 0.02 <= cap + 1e-9; h += 0.02) { const d = Lof(h) - Lof(Math.min(cap, h + 0.02)); if (d < w.d) w = { d, h }; if (d < 0) { up -= d; lo = lo ?? h; hi = h + 0.02; } } return { ...w, up, lo, hi }; };
    const washW = walk((h) => oklab(washAt(P, theme, h)).L, 0);
    let compW = { d: Infinity, up: 0 };
    for (const [view, a] of Object.entries(ALPHAS)) for (const dir of DIRS) { const w = walk((h) => oklab(composite(P, theme, h, a, dir)).L, 0.18); if (w.up > compW.up || (compW.up === 0 && w.d < compW.d)) compW = { ...w, view, dir }; }
    const mono = washW.up === 0 && compW.up === 0;
    console.log(`[${flag(!mono)}] lightness: wash OKLCH L by anchor ${anchorsL.map((x) => fmt(x, 2)).join(' ')}; ` +
      (mono ? `falls at every 0.02 m step, wash and composite (the composite's smallest fall ${fmt(compW.d * 1000, 2)}e-3 L at ${fmt(compW.h, 2)} m, ${compW.view}, lighting ${compW.dir})`
        : 'CLIMBS BACK ' + [washW.up ? `${fmt(washW.up, 4)} L on the wash (${fmt(washW.lo, 2)}-${fmt(washW.hi, 2)} m)` : '', compW.up ? `${fmt(compW.up, 4)} L composited (${fmt(compW.lo, 2)}-${fmt(compW.hi, 2)} m, ${compW.view}, lighting ${compW.dir})` : ''].filter(Boolean).join(' and ')) + ' (target: falls at every step)');
    // 2. No grey along the path the GPU draws between the anchors.
    let wC = { c: Infinity }, cC = { c: Infinity };
    for (let h = 0; h <= cap + 1e-9; h += 0.02) {
      const c = chromaStar(washAt(P, theme, h)); if (c < wC.c) wC = { c, h };
      if (h >= 0.18) for (const a of Object.values(ALPHAS)) { const k = chromaStar(composite(P, theme, h, a)); if (k < cC.c) cC = { c: k, h, a }; }
    }
    if (P.over) for (const a of Object.values(ALPHAS)) { const k = chromaStar(composite(P, theme, cap + 1, a)); if (k < cC.c) cC = { c: k, h: 'above the cap', a }; }   // the above-cap state is no grey either
    console.log(`[${flag(wC.c < BAR.washC || cC.c < BAR.compC)}] no grey: the wash's weakest colour C* ${fmt(wC.c)} at ${fmt(wC.h, 2)} m; the composite's C* ${fmt(cC.c)} at ${typeof cC.h === 'number' ? fmt(cC.h, 2) + ' m' : cC.h} (bars ${BAR.washC} / ${BAR.compC})`);
    // 3. Neighbouring legend stops (the anchors, and the above-cap state against the cap), as composited at each view.
    const stopH = P.over ? [...H, cap + 1] : H, pairs = [];
    let adjW = { de: Infinity }, adjN = { de: Infinity };
    for (const [view, a] of Object.entries(ALPHAS)) {
      const comps = stopH.map((h) => composite(P, theme, h, a, 0.5, false));   // the stops themselves (the table), not the depth floor
      for (let i = 0; i + 1 < stopH.length; i++) {
        const label = `${H[i]}-${i + 1 < H.length ? H[i + 1] : 'over'} m`, w = allDE(comps[i], comps[i + 1]), n = dE(comps[i], comps[i + 1]);
        pairs.push({ label, view, a: comps[i], b: comps[i + 1] });
        if (w.de < adjW.de) adjW = { ...w, label, view };
        if (n < adjN.de) adjN = { de: n, label, view };
      }
    }
    console.log(`[${flag(adjW.de < BAR.adj, adjN.de < BAR.adj)}] neighbours as composited (world/regional/coastal): weakest ${adjW.label} at ${fmt(adjW.de)} dE00 (${adjW.kind}, ${adjW.view}); normal vision ${fmt(adjN.de)} (${adjN.label}, ${adjN.view}) (target >= ${BAR.adj})`);
    const byView = Object.keys(ALPHAS).map((view) => { const w = pairs.filter((q) => q.view === view).map((q) => ({ ...allDE(q.a, q.b), label: q.label })).reduce((m, x) => (x.de < m.de ? x : m)); return `${view} ${fmt(w.de)} (${w.label}, ${w.kind})`; });
    console.log(`         by view: ${byView.join('; ')}`);
    if (args.includes('--pairs')) for (const p of pairs.filter((q) => q.view === 'world')) {   // every pair at world alpha (the weakest view), by model
      const k = ['normal', 'protan', 'deutan', 'tritan'].map((kind) => (kind === 'normal' ? dE(p.a, p.b) : allDE(p.a, p.b) && de2000(simLab(p.a, kind), simLab(p.b, kind))));
      console.log(`         ${p.label.padEnd(12)} normal ${fmt(k[0])}  protan ${fmt(k[1])}  deutan ${fmt(k[2])}  tritan ${fmt(k[3])}   L ${fmt(oklab(p.a).L, 3)} -> ${fmt(oklab(p.b).L, 3)}`);
    }
    // 4. Land against sea: the land is drawn OVER the wash, so the coast is the land colour against the composite beside it.
    let ls = { de: Infinity };
    for (const [view, a] of Object.entries(ALPHAS)) for (let h = 0; h <= cap + (P.over ? 1 : 0) + 1e-9; h += 0.05) { const d = dE(composite(P, theme, h, a, 0.5, false), land); if (d < ls.de) ls = { de: d, h, view }; }
    console.log(`[${flag(false, ls.de < BAR.land)}] land vs sea: the composite closest to the ${theme} land is ${fmt(ls.h, 2)} m (${ls.view}) at ${fmt(ls.de)} dE00 (watch below ${BAR.land})`);
    // 5. Crests: a crest's core (no whitecap, and a full whitecap) against the wash under it, at every 0.1 m.
    let cr = { de: Infinity }, crC = { de: Infinity }, crLc = { lc: Infinity };
    for (const [view, a] of Object.entries(ALPHAS)) for (const wc of [0, 1]) for (let h = 0.2; h <= Math.min(cap, 16) + 1e-9; h += 0.1) {
      const under = composite(P, theme, h, a), over = crestOver(theme, h, under, wc), n = dE(over, under), w = allDE(over, under), lc = Math.abs(apcaLc(over, under));
      if (n < cr.de) cr = { de: n, h, view, wc }; if (w.de < crC.de) crC = { ...w, h, view, wc }; if (lc < crLc.lc) crLc = { lc, h, view, wc };
    }
    if (args.includes('--pairs')) for (let h = 0.3; h <= cap; h += h < 2 ? 0.3 : 1) { const u = composite(P, theme, h, ALPHAS.world), o = crestOver(theme, h, u, 0); console.log(`         crest at ${fmt(h)} m: ${fmt(dE(o, u))} dE00 normal, ${fmt(allDE(o, u).de)} weakest (${allDE(o, u).kind}); crest L ${fmt(oklab(o).L, 2)} wash L ${fmt(oklab(u).L, 2)}`); }
    console.log(`[${flag(false, cr.de < BAR.crest)}] crests: a crest core vs its wash is weakest at ${fmt(cr.h)} m (${cr.view}${cr.wc ? ', whitecap' : ''}) ${fmt(cr.de)} dE00; colour-blind ${fmt(crC.de)} (${crC.kind} at ${fmt(crC.h)} m); APCA |Lc| ${fmt(crLc.lc)} at ${fmt(crLc.h)} m (watch below ${BAR.crest} dE00)`);
    // 6. The legend bar on its panel (the bar draws the table opaque; APCA Lc of each stop as if it were text on the panel).
    const legendStops = stopH.map((h) => washAt(P, theme, h)), lcs = legendStops.map((c) => apcaLc(c, panel));
    const weakLc = lcs.reduce((w, lc, i) => (Math.abs(lc) < Math.abs(w.lc) ? { lc, i } : w), { lc: Infinity, i: -1 });
    const adjLc = legendStops.slice(1).map((c, i) => Math.abs(apcaLc(c, legendStops[i]))), weakAdjLc = Math.min(...adjLc);
    console.log(`[${flag(false, Math.abs(weakLc.lc) < BAR.lc)}] legend on its panel (${BASEMAP[theme].panel.join(',')}): APCA Lc ${lcs.map((x) => fmt(x, 0)).join(' ')}; weakest the ${stopH[weakLc.i] > cap ? 'above-cap arrow' : stopH[weakLc.i] + ' m stop'} at ${fmt(weakLc.lc)}; neighbours' weakest |Lc| ${fmt(weakAdjLc)} (watch below ${BAR.lc})`);
    // 7. Above the cap.
    if (P.over) {
      let ov = { de: Infinity }; for (const [view, a] of Object.entries(ALPHAS)) { const w = allDE(composite(P, theme, cap + 1, a), composite(P, theme, cap, a)); if (w.de < ov.de) ov = { ...w, view }; }
      const darker = oklab(washAt(P, theme, cap + 1)).L <= oklab(washAt(P, theme, cap)).L;
      console.log(`[${flag(ov.de < BAR.over || !darker)}] above ${cap} m: its own colour ${rgb255(washAt(P, theme, cap + 1)).join(',')}, ${fmt(ov.de)} dE00 off the cap's (${ov.kind}, ${ov.view}); ${darker ? 'no lighter than the cap' : 'LIGHTER than the cap'} (bar >= ${BAR.over})`);
    } else console.log(`[warn] above ${cap} m: no state of its own (the ramp clamps: a ${cap + 2} m storm draws as ${cap} m)`);
    // 8. The depth floor: flat water (< 0.18 m) shows the shader's depth colour, not the table (watch: not the palette's).
    const floorL = oklab(composite(P, theme, 0, ALPHAS.world)).L, calmL = oklab(composite(P, theme, 0.18, ALPHAS.world)).L;
    console.log(`[watch] depth floor: flat water (0-0.18 m) draws the shader's deep-ocean colour ${rgb255(DEPTH_FLOOR[theme]).join(',')} (composite L ${fmt(floorL, 2)}) and reaches the table's calm (L ${fmt(calmL, 2)}) at 0.18 m: ${floorL < calmL ? 'darker than calm' : 'no darker than calm'} (the shader's, not this palette's)`);
    out[id][theme] = { pairs: pairs.map((p) => ({ label: p.label, view: p.view, a: p.a, b: p.b })),
      over: P.over ? Object.entries(ALPHAS).map(([view, a]) => ({ label: 'cap-over', view, a: composite(P, theme, cap, a), b: composite(P, theme, cap + 1, a) })) : [] };
  }
}
const jsonPath = arg('--json') || path.join(os.tmpdir(), 'wave-color-check.json');
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 1));
console.log(`\n${red} red line(s) above.`);
const py = [path.join(HERE, '.venv', 'Scripts', 'python.exe'), path.join(HERE, '.venv', 'bin', 'python')].find((p) => fs.existsSync(p));
let cvdRed = 0;
if (py) {
  console.log('\n=== COLOUR-BLIND, the authority (coloraide: Vienot protan/deutan, Brettel tritan), neighbouring stops as composited');
  cvdRed = spawnSync(py, [path.join(HERE, 'wave_cvd_check.py'), jsonPath, '--strict'], { stdio: 'inherit' }).status || 0;
} else console.log('\n(colour-blind authority skipped: create ./.venv with coloraide, see README.md)');
if (args.includes('--strict') && (red || cvdRed)) process.exit(1);
