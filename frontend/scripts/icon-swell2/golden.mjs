// Golden file for the server port of the ICON swell_2 blend (backend/services/weather_pipeline/icon_swell2_blend.py).
// Runs the BROWSER's own blend (src/components/map/iconSwell2Blend.js + marineDirectionBlend.js, copied unchanged into a temp
// dir as .mjs so Node can import them) on edge cases, and writes backend/tests/fixtures/icon_swell2_blend_js_golden.json.
// Usage (from frontend/): node scripts/icon-swell2/golden.mjs [storeDir for an optional lab world-pair check]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const map = path.join(here, '..', '..', 'src', 'components', 'map');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iconsw2-'));
fs.writeFileSync(path.join(tmp, 'marineDirectionBlend.mjs'), fs.readFileSync(path.join(map, 'marineDirectionBlend.js')));
fs.writeFileSync(path.join(tmp, 'iconSwell2Blend.mjs'), fs.readFileSync(path.join(map, 'iconSwell2Blend.js'), 'utf8').replace("from './marineDirectionBlend'", "from './marineDirectionBlend.mjs'"));
const { blendIconSwell2 } = await import(pathToFileURL(path.join(tmp, 'iconSwell2Blend.mjs')).href);
const storeDir = process.argv[2] || null;
const out = path.join(here, '..', '..', '..', 'backend', 'tests', 'fixtures', 'icon_swell2_blend_js_golden.json');
const V = (lat, lng, o) => ({ lat, lng, u: 0, v: 0, ...o });
const dirVec = (lat, lng, h, d, p, extra = {}) => { const r = d * Math.PI / 180; return V(lat, lng, { speed: h, direction: d, u: -h * Math.sin(r), v: -h * Math.cos(r), period: p, is_valid: true, ...extra }); };
const edge = [
  { name: 'both, same cell', g: [dirVec(10, 20, 1.2, 270, 9)], e: [dirVec(10, 20, 0.8, 290, 11)] },
  { name: 'cancelling directions', g: [dirVec(0, 0, 1, 90, 10)], e: [dirVec(0, 0, 1.5, 270, 12)] },
  { name: 'exact cancel 0.6/0.4', g: [dirVec(0, 0, 1, 0, 10)], e: [dirVec(0, 0, 1.5, 180, 12)] },
  { name: 'gfs masked', g: [dirVec(5, 5, 1, 45, 8, { is_valid: false })], e: [dirVec(5, 5, 2, 60, 9)] },
  { name: 'euro land', g: [dirVec(5, 5, 1, 45, 8)], e: [dirVec(5, 5, 2, 60, 9, { isOcean: false })] },
  { name: 'calm gfs', g: [dirVec(5, 5, 0, 45, 8)], e: [dirVec(5, 5, 2, 60, 9)] },
  { name: 'both calm', g: [dirVec(5, 5, 0, 45, 8)], e: [dirVec(5, 5, 0, 60, 9)] },
  { name: 'gfs only', g: [dirVec(1, 1, 1.1, 200, 7), dirVec(1, 3, 0.4, 210, 6)], e: [] },
  { name: 'euro only', g: [], e: [dirVec(1, 1, 1.1, 200, 7)] },
  { name: 'euro fuller anchors', g: [dirVec(1, 1, 1, 10, 7)], e: [dirVec(1, 1, 2, 20, 8), dirVec(1, 1.4, 3, 30, 9)] },
  { name: 'half-degree key rounding', g: [dirVec(10.25, -20.25, 1, 100, 9)], e: [dirVec(10.2, -20.3, 2, 120, 10)] },
  { name: 'half-up key boundary (JS rounds 20.5 up; banker rounding would not)', g: [dirVec(10.2, 0, 1, 100, 9)], e: [dirVec(10.25, 0, 2, 120, 10)] },
  { name: 'negative half key', g: [dirVec(-10.25, -0.25, 1, 100, 9)], e: [dirVec(-10.25, -0.25, 2, 120, 10)] },
  { name: 'missing period', g: [dirVec(2, 2, 1, 100, 0)], e: [dirVec(2, 2, 2, 120, null)] },
  { name: 'u/v without direction', g: [V(3, 3, { speed: 1, u: -1, v: 0, period: 9 })], e: [V(3, 3, { speed: 1, u: 0, v: -1, period: 9 })] },
  { name: 'null u', g: [V(3, 3, { speed: 1, u: null, v: 0, direction: 90, period: 9 })], e: [dirVec(3, 3, 1, 100, 9)] },
  { name: 'wrap 350/10', g: [dirVec(4, 4, 1, 350, 9)], e: [dirVec(4, 4, 1, 10, 9)] },
  { name: 'NaN height', g: [V(4, 4, { speed: NaN, direction: 10, period: 9 })], e: [dirVec(4, 4, 1, 10, 9)] },
];
const res = { edge: edge.map((c) => ({ name: c.name, g: c.g, e: c.e, out: blendIconSwell2({ vectors: c.g, bounds: null }, { vectors: c.e, bounds: null }, 0, null, { quiet: true }).grid })) };
res.world = [];
const files = !storeDir ? [] : fs.readdirSync(storeDir).filter((f) => /^gfs_marine_swell_2_global_mid_\d{8}T\d{6}Z\.json$/.test(f)).sort();
for (const f of files.filter((_, i) => i % 12 === 0).slice(0, 10)) {
  const ef = f.replace(/^gfs_/, 'euro_');
  if (!fs.existsSync(path.join(storeDir, ef))) continue;
  const g = JSON.parse(fs.readFileSync(path.join(storeDir, f))); const e = JSON.parse(fs.readFileSync(path.join(storeDir, ef)));
  const o = blendIconSwell2(g.grid, e.grid, 0, null, { quiet: true }).grid;
  res.world.push({ gfs: f, euro: ef, out: o.vectors, weights: [o.estimate_basis.gfs_weight, o.estimate_basis.euro_weight] });
}

const golden = { generator: 'frontend/scripts/icon-swell2/golden.mjs (runs iconSwell2Blend.js unchanged)',
  edge: res.edge.map((c) => ({ name: c.name, g: c.g, e: c.e, out: c.out.vectors, weights: c.out.estimate_basis ? [c.out.estimate_basis.gfs_weight, c.out.estimate_basis.euro_weight] : null })) };
fs.writeFileSync(out, JSON.stringify(golden, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? { __nonfinite: String(v) } : v), 1));
console.log('edge', res.edge.length, 'world pairs', res.world.length);
