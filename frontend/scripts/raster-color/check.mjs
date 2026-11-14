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
export function sample(scale, v) {
  const b = scale.breakpoints; const c = scale.colors;
  if (v <= b[0]) return c[0]; if (v >= b[b.length - 1]) return c[c.length - 1];
  let i = 0; while (v > b[i + 1]) i += 1;
  const t = (v - b[i]) / (b[i + 1] - b[i]);
  return [0, 1, 2, 3].map((k) => c[i][k] + (c[i + 1][k] - c[i][k]) * t);
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
