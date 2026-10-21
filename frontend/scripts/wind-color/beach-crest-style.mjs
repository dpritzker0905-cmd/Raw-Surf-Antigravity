// BEACH CREST STYLE CHECK (2026-10-21): how visible beach's crests are on the v1 sea (D-035) as the engine draws it, today and under
// each luminance-only style in src/components/map/marineBeachCrestStyle.js (read from that module). Wash alpha per zoom state is
// PR #425's measured law: no regional tile: world 0.65, z4.6 0.68; with one (BLEND BOTH): a(h) = 1 - (1 - a_z ss(0.05,1.4,h))
// (1 - washEff), washEff = a_z 0.72 (1 - 0.65 ss(8,9.5,z)), a_z fitted to the measured rows (z4.6 0.68, z7.4 0.75, z10 0.78).
// A crest is sampled at its centre (ellipseDist 0.05), body (0.42) and edge (0.78/0.80) as DRAW_FS shades them, laid at the alpha
// DRAW_FS gives each (premultiplied, cap 0.85); visibility = the best of the three, APCA |Lc|, worst over swell lighting 0/0.5/1 and
// whitecap off/full, every 0.2 m from 0.2 to 10 m. Colour-blind: coloraide's dichromats (light-path-lib port), best part.
// Usage: node beach-crest-style.mjs [--json out.json]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPalettes, composite, apcaLc, allDE, ss } from './wave-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', '..', 'src', 'components', 'map', 'marineBeachCrestStyle.js'), 'utf8').replace(/^export /gm, '');
const { BEACH_CREST_STYLES } = new Function(`${src}; return { BEACH_CREST_STYLES };`)();
const P = loadPalettes().WAVE_PALETTES.v1;
const CALM = [1.0, 0.45, 0.65], ACTIVE = [0.0, 0.92, 0.85], STORM = [0.8, 0.2, 0.9], FOAM = [0.95, 0.95, 1.0];   // DRAW_FS beach
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const base = (h, wc) => { const e = ss(0, 6, h); const c = e < 0.5 ? mix(CALM, ACTIVE, e * 2) : mix(ACTIVE, STORM, (e - 0.5) * 2); return mix(c, FOAM, wc * ss(0.5, 3.0, h) * 0.45); };
const over = (c, a, u) => c.map((v, i) => Math.min(1, Math.max(0, v)) * a + u[i] * (1 - a));
const blend = (az, z) => { const we = az * 0.72 * (1 - 0.65 * ss(8, 9.5, z)); return (h) => 1 - (1 - az * ss(0.05, 1.4, h)) * (1 - we); };
const STATES = [['world z2.2', () => 0.65, 0], ['regional z4.6', () => 0.68, 1], ['z4.6 tile', blend(0.68, 4.6), 1], ['coastal z7.4 tile', blend(0.75, 7.4), 0], ['close z10 tile', blend(0.78, 10), 0]];
const shapeAt = (ed, edge) => 1 - ss(edge, 1.0, ed), BOOST = (h) => 1.2 + 0.6 * ss(0, 6, h);
const selfContrast = (h, band) => Math.max(band, 1 - ss(0.75, 1.05, h));   // u_crestContrast (zoom band) / u_lowHCrestContrast
const ED = [0.05, 0.42, 0.78];

/** The crest's centre, body and edge [colour, alpha] under a style ('today' = DRAW_FS as it ships). */
function parts(style, h, wc, band) {
  const c = base(h, wc), t = BEACH_CREST_STYLES[style];
  if (t && t.rim !== undefined) {   // two-tone: dark rim on the outer band, light centre line, ribbon opaque to 0.80
    const col = (ed) => mix(mix(c, c.map((v) => v * t.rim), ss(0.55, 0.72, ed)), [1, 1, 1], t.centre * (1 - ss(0.12, 0.32, ed)));
    return ED.map((ed) => [col(ed), Math.min(0.85, BOOST(h) * shapeAt(ed === 0.78 ? 0.80 : ed, 0.80))]);
  }
  const eff = style === 'cased' ? 1 : selfContrast(h, band);
  const core = (ed) => 1 - ss(0.15, 0.85, ed), sc = (k) => mix(c, c.map((v, i) => v * (0.55 + 0.75 * k) + FOAM[i] * k * 0.18), eff);
  return ED.map((ed) => [sc(core(ed)), Math.min(0.85, BOOST(h) * shapeAt(ed, 0.55))]);
}

const out = {};
for (const style of ['today', ...Object.keys(BEACH_CREST_STYLES)]) {
  const res = { states: {}, cvdMin: Infinity };
  for (const [name, A, band] of STATES) {
    const lc = [];
    for (let h = 0.2; h <= 10.0001; h += 0.2) {
      let vis = Infinity;
      for (const dir of [0, 0.5, 1]) for (const wc of [0, 1]) {
        const u = composite(P, 'beach', h, A(h), dir), px = parts(style, h, wc, band).map(([c, a]) => over(c, a, u));
        vis = Math.min(vis, Math.max(...px.map((p) => Math.abs(apcaLc(p, u)))));
        res.cvdMin = Math.min(res.cvdMin, Math.max(...px.map((p) => allDE(p, u).de)));
      }
      lc.push({ h: +h.toFixed(1), lc: +vis.toFixed(1) });
    }
    const under = lc.filter((x) => x.lc < 30);
    res.states[name] = { worst: lc.reduce((m, x) => (x.lc < m.lc ? x : m)), under: under.map((x) => x.h), lc };
  }
  out[style] = res;
  console.log(`\n=== ${style}: worst-case colour-blind (best part) ${res.cvdMin.toFixed(1)} dE00`);
  for (const [name, r] of Object.entries(res.states)) console.log(`  ${name.padEnd(18)} worst |Lc| ${String(r.worst.lc).padStart(5)} at ${r.worst.h} m; under 30 at ${r.under.length}/50${r.under.length ? `: ${r.under.join(' ')}` : ''}`);
}
const j = process.argv.indexOf('--json');
if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out));
