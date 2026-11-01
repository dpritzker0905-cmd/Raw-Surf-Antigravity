// LIGHT CREST CROSS CHECK (2026-10-22): light crest colour sets that sit between the original (D-041: deep navy -> amber-gold ->
// crimson red) and V2 (#421: deep umber, cream from 2.35 m over the spectrum, gold storms) and stay ONE continuous family (no step at a
// height), measured over light's live wash (#431's spectrum, D-037) as the engine draws it. The owner (2026-10-22): "Light mode I if we
// acn do a cross between no two-tone and v2 , would maybe be best?"; his standing rules: subtle, looks like real waves, no hue flip,
// no two-tone.
// A crest set is DRAW_FS's four light lines: calm / active / storm, mixed by energy e = smoothstep(0, 6, h) (calm -> active at 3 m ->
// storm from 6 m), and the whitecap's foam. Each line is a colour, or { rgb, above, ramp: [h0, h1] } (DRAW_FS: mix(rgb, above,
// smoothstep(h0, h1, v_wave_height))), or { rgb, above, switchHeight } (a step, V2's). The sets read from marineCrestPalette.js
// (LIGHT_CRESTS), plus any --try '<json>' set.
// Per set: the worst APCA |Lc| of the crest's best part (centre, body, edge, as DRAW_FS shades them with the engine's self-contrast)
// against the wash under it, every 0.1 m from 0.1 to 14 m, over swell lighting 0 / 0.5 / 1 and whitecap off / full, in each zoom state
// at the engine's real crest opacity (as light-crest-style.mjs); colour-blind dE00 (best part); and, on the crest colour itself, its
// mean / max CIEDE2000 from the original and from V2 at the same height, and the largest jump between heights 0.1 m apart (V2's step
// is the reference for a visible switch).
// Usage: node light-crest-cross.mjs [--json out.json] [--wash spectrum|v2] [--try '{"name":"x","calm":[..],"active":[..],"storm":[..],"foam":[..]}']
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPalettes, composite, apcaLc, allDE, dE, ss } from './wave-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', '..', 'src', 'components', 'map', 'marineCrestPalette.js'), 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export /gm, '');
const { LIGHT_CRESTS } = new Function('MARINE_WAVE_PALETTE_ENABLED', 'MARINE_WAVE_PALETTE_IDS', `${src}; return { LIGHT_CRESTS };`)(true, { light: 'spectrum', beach: 'v1' });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WASH = arg('--wash', 'spectrum');
const P = loadPalettes().WAVE_PALETTES[WASH];
const SETS = {};
for (const [id, t] of Object.entries(LIGHT_CRESTS)) if (id !== 'v2' || WASH === 'v2') SETS[id] = t;
process.argv.forEach((a, i) => { if (a === '--try') { const t = JSON.parse(process.argv[i + 1]); SETS[t.name || `try${i}`] = t; } });

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (c) => c.map((v) => Math.min(1, Math.max(0, v)));
/** One DRAW_FS light line at height h: a colour, a smooth ramp or a step (the table's forms). */
function lineAt(l, h, sw, ramp) {
  if (Array.isArray(l)) return l;
  if (!l.above) return l.rgb;
  const r = l.ramp || ramp;   // a line's own ramp (--try sets) or the table's (marineCrestPalette.js)
  if (r) return mix(l.rgb, l.above, ss(r[0], r[1], h));
  return h >= (l.switchHeight ?? sw) ? l.above : l.rgb;
}
function base(t, h, wc) {
  const sw = t.switchHeight, r = t.ramp, e = ss(0, 6, h);
  const calm = lineAt(t.calm, h, sw, r), active = lineAt(t.active, h, sw, r), storm = lineAt(t.storm, h, sw, r), foam = lineAt(t.foam, h, sw, r);
  const c = e < 0.5 ? mix(calm, active, e * 2) : mix(active, storm, (e - 0.5) * 2);
  return mix(c, foam, wc * ss(0.5, 3.0, h) * 0.45);
}
const blend = (az, z) => { const we = az * 0.72 * (1 - 0.65 * ss(8, 9.5, z)); return () => 1 - (1 - az) * (1 - we); };
const STATES = [['world z2.2', () => 0.65, 0, 2.2], ['regional z4.6', () => 0.68, 1, 4.6], ['z4.6 tile', blend(0.68, 4.6), 1, 4.6],
  ['coastal z7.4 tile', blend(0.75, 7.4), 0, 7.4], ['close z10 tile', blend(0.78, 10), 0, 10]];
// DRAW_VS crest alpha; a set's `lift` (far) is #431's far-zoom crest lift (marineCrestPalette.js withSpectrumCrestLift: x mix(far / 0.45, 1,
// smoothstep(3, 9, zoom))), which V2 over the spectrum carries.
const crestAlpha = (h, z, shape, far = 0.45) => Math.min(0.85, (0.50 + 0.35 * ss(0, 4, h)) * (0.45 + 0.55 * ss(3, 9, z)) * (1 + (far / 0.45 - 1) * (1 - ss(3, 9, z))) * shape * (1.2 + 0.6 * ss(0, 6, h)));
const ED = [0.05, 0.42, 0.78];
// The far-zoom lift a set gets in the engine: the crosses (`lift: true`) and V2 over the spectrum take #431's 0.80; a number is a --try value.
const farOf = (t) => (typeof t.lift === 'number' ? t.lift : t.lift === true || t === LIGHT_CRESTS.v2s ? 0.80 : 0.45);
const over = (c, a, u) => clamp01(c).map((v, i) => v * a + u[i] * (1 - a));
function parts(t, h, wc, band, z) {
  const c = base(t, h, wc), eff = Math.max(band, 1 - ss(0.75, 1.05, h)), FOAM = lineAt(t.foam, h, t.switchHeight, t.ramp);
  const core = (ed) => 1 - ss(0.15, 0.85, ed), sc = (k) => mix(c, c.map((v, i) => v * (0.55 + 0.75 * k) + FOAM[i] * k * 0.18), eff);
  return ED.map((ed) => [sc(core(ed)), crestAlpha(h, z, 1 - ss(0.55, 1.0, ed), farOf(t))]);
}

const ORIG = LIGHT_CRESTS.v1, V2 = LIGHT_CRESTS[WASH === 'v2' ? 'v2' : 'v2s'];
const HS = []; for (let h = 0.1; h <= 14.0001; h += 0.1) HS.push(+h.toFixed(1));
const out = {};
for (const [id, t] of Object.entries(SETS)) {
  const res = { states: {}, cvdMin: Infinity };
  for (const [name, A, band, z] of STATES) {
    const lc = [];
    for (const h of HS) {
      let vis = Infinity;
      for (const dir of [0, 0.5, 1]) for (const wc of [0, 1]) {
        const u = composite(P, 'light', h, A(h), dir), px = parts(t, h, wc, band, z).map(([c, a]) => over(c, a, u));
        vis = Math.min(vis, Math.max(...px.map((p) => Math.abs(apcaLc(p, u)))));
        res.cvdMin = Math.min(res.cvdMin, Math.max(...px.map((p) => allDE(p, u).de)));
      }
      lc.push({ h, lc: +vis.toFixed(1) });
    }
    res.states[name] = { worst: lc.reduce((m, x) => (x.lc < m.lc ? x : m)), under15: lc.filter((x) => x.lc < 15).map((x) => x.h), under30: lc.filter((x) => x.lc < 30).length, lc };
  }
  const dO = HS.map((h) => dE(clamp01(base(t, h, 0)), clamp01(base(ORIG, h, 0)))), dV = HS.map((h) => dE(clamp01(base(t, h, 0)), clamp01(base(V2, h, 0))));
  const jumps = HS.slice(1).map((h, i) => ({ h, d: dE(clamp01(base(t, h, 0)), clamp01(base(t, HS[i], 0))) }));
  const maxJump = jumps.reduce((m, x) => (x.d > m.d ? x : m));
  res.fromOriginal = { mean: +(dO.reduce((a, b) => a + b, 0) / dO.length).toFixed(1), max: +Math.max(...dO).toFixed(1) };
  res.fromV2 = { mean: +(dV.reduce((a, b) => a + b, 0) / dV.length).toFixed(1), max: +Math.max(...dV).toFixed(1) };
  res.maxJump = { dE00: +maxJump.d.toFixed(1), at: maxJump.h };
  res.worstAll = Math.min(...Object.values(res.states).map((s) => s.worst.lc));
  out[id] = res;
  const u15 = new Set(Object.values(res.states).flatMap((s) => s.under15));
  console.log(`\n=== ${id} (wash ${WASH}): worst |Lc| ${res.worstAll}; colour-blind >= ${res.cvdMin.toFixed(1)} dE00; vs original mean ${res.fromOriginal.mean} / max ${res.fromOriginal.max}; vs V2 mean ${res.fromV2.mean}; biggest 0.1 m jump ${res.maxJump.dE00} at ${res.maxJump.at} m`);
  console.log(`  heights under |Lc| 15 in any state: ${u15.size ? `${Math.min(...u15)}-${Math.max(...u15)} m (${u15.size} bins)` : 'none'}`);
  for (const [name, r] of Object.entries(res.states)) console.log(`  ${name.padEnd(18)} worst ${String(r.worst.lc).padStart(5)} at ${String(r.worst.h).padStart(4)} m; under 15 / 30: ${r.under15.length} / ${r.under30} of ${HS.length}`);
}
const j = process.argv.indexOf('--json');
if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out));
