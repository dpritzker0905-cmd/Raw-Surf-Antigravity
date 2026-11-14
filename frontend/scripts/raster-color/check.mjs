// Raster palette checker (draft, scratch): the air temp, water temp and fog scales AS DRAWN, i.e. alpha-blended over each
// theme's basemap at the layer's own opacity, in normal vision and three colour-blind simulations.
// Run from frontend/:  node <this file> [--json]
import { createRequire } from 'module';
import { differenceCiede2000, converter, filterDeficiencyProt, filterDeficiencyDeuter, filterDeficiencyTrit } from 'culori';
const require = createRequire(process.cwd() + '/');
const lib = require('@openmeteo/weather-map-layer');
const LIB = lib.COLOR_SCALES_WITH_ALIASES || lib.COLOR_SCALES;
const dE = differenceCiede2000(); const lab = converter('lab65');
const VIEWS = { normal: (c) => c, protan: filterDeficiencyProt(1), deutan: filterDeficiencyDeuter(1), tritan: filterDeficiencyTrit(1) };
// Basemap surfaces: light / beach / dark water from scripts/wind-color/check.mjs; dark land sampled from an app screenshot.
export const SURFACES = {
  light: { water: [168, 214, 222], land: [236, 236, 232] }, beach: { water: [150, 190, 200], land: [222, 208, 180] }, dark: { water: [93, 117, 126], land: [66, 77, 92] },
};
// Layer opacity at zoom 5 (MapWebGL.js raster-opacity stops) and which surfaces the layer covers.
export const LAYERS = {
  temperature: { op: 0.44, on: ['water', 'land'], unit: 'C' }, water_temp: { op: 0.52, on: ['water'], unit: 'C' }, fog: { op: 0.52, on: ['water', 'land'], unit: 'm' },
};
const rgb = (c) => ({ mode: 'rgb', r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 });
// AS DRAWN: a 'breakpoint' scale is a STEP table. The tile library colours a value with the last breakpoint at or below it
// (findLastIndexLE), and the own-frames path builds a step lookup from the same breakpoints. No blending between stops.
export function sample(scale, v) {
  const b = scale.breakpoints; const c = scale.colors;
  let i = 0; while (i < b.length - 1 && b[i + 1] <= v) i += 1;
  return c[i];
}
export const over = (base, c, op) => { const a = c[3] * op; return [0, 1, 2].map((k) => base[k] * (1 - a) + c[k] * a); };
export const dist = (a, b, view = 'normal') => dE(VIEWS[view](rgb(a)), VIEWS[view](rgb(b)));
const L = (c) => lab(rgb(c)).l; const chroma = (c) => { const x = lab(rgb(c)); return Math.hypot(x.a, x.b); };

// Metrics for a scale over one surface.
export function metrics(layer, scale, theme, surf, values, step) {
  const base = SURFACES[theme][surf]; const op = LAYERS[layer].op;
  const drawn = values.map((v) => over(base, sample(scale, v), op));
  const out = { minStep: {}, minStepAt: {}, vsBase: {} };
  for (const view of Object.keys(VIEWS)) {
    let m = Infinity; let at = null;
    for (let i = 1; i < drawn.length; i += 1) { const d = dist(drawn[i - 1], drawn[i], view); if (d < m) { m = d; at = values[i - 1]; } }
    out.minStep[view] = +m.toFixed(2); out.minStepAt[view] = at;
  }
  out.lightness = drawn.map((d) => +L(d).toFixed(1)); out.chroma = drawn.map((d) => +chroma(d).toFixed(1));
  out.drawn = drawn.map((d) => d.map(Math.round)); out.step = step;
  return out;
}
const range = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(3)); return o; };

export function report(scales, label) {
  const rows = [];
  for (const theme of Object.keys(SURFACES)) {
    // AIR TEMP: 5 C bands from -30 to 40; the two sides of 0 C; where the palest / least chromatic point sits.
    for (const surf of LAYERS.temperature.on) {
      const vals = range(-30, 40, 5); const m = metrics('temperature', scales.temperature, theme, surf, vals, 5);
      const base = SURFACES[theme][surf]; const at = (v) => over(base, sample(scales.temperature, v), LAYERS.temperature.op);
      const sides = Object.fromEntries(Object.keys(VIEWS).map((v) => [v, +dist(at(-10), at(10), v).toFixed(1)]));
      const fine = range(-15, 15, 1); const ch = fine.map((v) => chroma(sample(scales.temperature, v).slice(0, 3)));
      rows.push({ label, layer: 'temperature', theme, surf, minStep5C: m.minStep, minStepAt: m.minStepAt, minus10VsPlus10: sides, leastChromaAtC: fine[ch.indexOf(Math.min(...ch))],
        freezeEdge: +dist(at(-1), at(1)).toFixed(1) });
    }
    // WATER TEMP: 1 C steps from 4 to 30 C over water; lightness monotonic?
    {
      const vals = range(4, 30, 1); const m = metrics('water_temp', scales.water_temp, theme, 'water', vals, 1);
      const dl = m.lightness.slice(1).map((l, i) => l - m.lightness[i]); const rev = dl.filter((d, i) => i > 0 && Math.sign(d) !== Math.sign(dl[i - 1]) && Math.abs(d) > 0.3).length;
      const mean = vals.slice(1).reduce((s, v, i) => s + dist(m.drawn[i], m.drawn[i + 1]), 0) / (vals.length - 1);
      rows.push({ label, layer: 'water_temp', theme, surf: 'water', minStep1C: m.minStep, minStepAt: m.minStepAt, meanStep1C: +mean.toFixed(2), lightnessReversals: rev,
        lightnessRange: [Math.min(...m.lightness), Math.max(...m.lightness)] });
    }
    // FOG: how far dense fog (200 m), fog (800 m) and mist (3 km) stand from the bare basemap, and from each other.
    for (const surf of LAYERS.fog.on) {
      const base = SURFACES[theme][surf]; const at = (v) => over(base, sample(scales.fog, v), LAYERS.fog.op);
      const vs = (v) => Object.fromEntries(Object.keys(VIEWS).map((k) => [k, +dist(base, at(v), k).toFixed(1)]));
      rows.push({ label, layer: 'fog', theme, surf, dense200mVsMap: vs(200), fog800mVsMap: vs(800), mist3kmVsMap: vs(3000), clear15kmVsMap: vs(15000).normal, dense200Vs800: +dist(at(200), at(800)).toFixed(1) });
    }
  }
  return rows;
}
// The gates of docs/weather-program/log/2026-11-14-fable-raster-palettes.md, applied to report() rows. Returns [{gate, ok, detail}].
export const TODAY_MEAN_1C = { light: 2.60, beach: 2.69, dark: 3.05 };
export function gates(rows, scales, theme) {
  const out = []; const add = (gate, ok, detail) => out.push({ gate, ok, detail });
  const cb = (o) => Math.min(o.protan, o.deutan, o.tritan);
  for (const r of rows.filter((x) => x.layer === 'temperature')) {
    add(`T1 ${r.theme}/${r.surf}`, r.minStep5C.normal >= 4.5 && cb(r.minStep5C) >= 3.0, `normal ${r.minStep5C.normal}, colour-blind min ${cb(r.minStep5C)} (protan ${r.minStep5C.protan} at ${r.minStepAt.protan}, deutan ${r.minStep5C.deutan} at ${r.minStepAt.deutan}, tritan ${r.minStep5C.tritan})`);
    add(`T2 ${r.theme}/${r.surf}`, r.minus10VsPlus10.normal >= 30 && cb(r.minus10VsPlus10) >= 20, `normal ${r.minus10VsPlus10.normal}, colour-blind min ${cb(r.minus10VsPlus10)}`);
    const base = SURFACES[r.theme][r.surf]; const Lat = (v) => lab(rgb(over(base, sample(scales.temperature, v), LAYERS.temperature.op))).l;
    const side = (vals) => { const l = vals.map(Lat); const d = l.slice(1).map((x, i) => x - l[i]); const s0 = Math.sign(d.reduce((a, c) => a + c, 0)); return Math.max(0, ...d.map((x) => -s0 * x)); };
    const rev = Math.max(side([0, -1, -2.5, -5, -10, -15, -20, -25, -30]), side([0, 1, 2.5, 5, 10, 15, 20, 25, 30, 35, 40]));
    add(`T3 ${r.theme}/${r.surf}`, Math.abs(r.leastChromaAtC) <= 1 && rev <= 0.5, `least chroma at ${r.leastChromaAtC} C, worst lightness reversal ${rev.toFixed(2)}`);
    add(`T4 ${r.theme}/${r.surf}`, r.freezeEdge >= 6, `-1 vs +1 = ${r.freezeEdge}`);
  }
  for (const r of rows.filter((x) => x.layer === 'water_temp')) {
    add(`W1 ${r.theme}`, r.lightnessReversals === 0, `${r.lightnessReversals} reversals`);
    add(`W2 ${r.theme}`, r.minStep1C.normal >= 1.5 && cb(r.minStep1C) >= 1.2, `normal ${r.minStep1C.normal}, colour-blind min ${cb(r.minStep1C)} (protan ${r.minStep1C.protan} at ${r.minStepAt.protan}, deutan ${r.minStep1C.deutan} at ${r.minStepAt.deutan}, tritan ${r.minStep1C.tritan} at ${r.minStepAt.tritan})`);
    add(`W3 ${r.theme}`, r.meanStep1C >= TODAY_MEAN_1C[r.theme], `mean ${r.meanStep1C} against today's ${TODAY_MEAN_1C[r.theme]}`);
  }
  for (const r of rows.filter((x) => x.layer === 'fog')) {
    const all = (o) => Math.min(o.normal, o.protan, o.deutan, o.tritan); const mist = r.mist3kmVsMap;
    add(`F1 ${r.theme}/${r.surf}`, all(r.dense200mVsMap) >= 15, `dense vs map min ${all(r.dense200mVsMap)}`);
    add(`F2 ${r.theme}/${r.surf}`, all(r.fog800mVsMap) >= 10 && all(mist) >= 2 && Math.max(mist.normal, mist.protan, mist.deutan, mist.tritan) <= 8 && r.clear15kmVsMap === 0, `800 m ${all(r.fog800mVsMap)}, mist ${mist.normal}, clear ${r.clear15kmVsMap}`);
    add(`F3 ${r.theme}/${r.surf}`, r.dense200Vs800 >= 4, `dense vs 800 m = ${r.dense200Vs800}`);
  }
  // B1 (2026-11-14 03:05): every in-range value stands off the BARE map: >= 5.0 normal, >= 3.0 in each colour-blind view.
  const B1 = { temperature: [-30, -20, -10, -5, -1, 0, 1, 5, 10, 20, 30, 40], water_temp: [4, 8, 12, 16, 20, 24, 28, 30] };
  for (const [layer, values] of Object.entries(B1)) {
    for (const surf of LAYERS[layer].on) {
      const base = SURFACES[theme][surf]; let worstN = { d: Infinity }; let worstC = { d: Infinity };
      for (const v of values) {
        const c = over(base, sample(scales[layer], v), LAYERS[layer].op);
        const n = dist(base, c, 'normal'); if (n < worstN.d) worstN = { d: n, v };
        for (const view of ['protan', 'deutan', 'tritan']) { const d = dist(base, c, view); if (d < worstC.d) worstC = { d, v, view }; }
      }
      add(`B1 ${layer === 'temperature' ? 'air' : 'water'} ${theme}/${surf}`, worstN.d >= 5.0 && worstC.d >= 3.0,
        `vs bare map: normal min ${worstN.d.toFixed(2)} at ${worstN.v} C, colour-blind min ${worstC.d.toFixed(2)} at ${worstC.v} C (${worstC.view})`);
    }
  }
  return out.map((g) => ({ ...g, theme }));
}
export const CURRENT = () => {
  const app = require(process.cwd() + '/scripts/raster-color/current-fog.json');
  return { temperature: LIB.temperature, water_temp: LIB.sea_surface_temperature, fog: app };
};
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('raster-color/check.mjs')) {
  const fog = { breakpoints: [0, 500, 1000, 2000, 5000, 10000], colors: [[240, 240, 240, 0.85], [240, 240, 240, 0.70], [242, 245, 248, 0.45], [242, 245, 248, 0.20], [255, 255, 255, 0.0], [255, 255, 255, 0.0]] };
  const rows = report({ temperature: LIB.temperature, water_temp: LIB.sea_surface_temperature, fog }, 'today');
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
  else for (const r of rows) console.log(JSON.stringify(r));
}
