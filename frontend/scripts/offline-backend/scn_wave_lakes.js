// Wave-carrying lakes (2026-10-23, waveLakes.js): does EURO's field show inside the lakes it carries, clipped to the shore, with
// nothing added on land, the Salton Sea still black, GFS showing no lake, and no extra mask paint on the scrub path? Offline only.
//
// Per (theme, model, arm) one fresh browser: Waves OFF, a "bare" screenshot of every view; then Waves ON, the model clicked, and an
// "on" screenshot of every view. A sampled pixel (stride STRIDE) carries heat when bare and on differ by more than DIFF (sum of
// |dR|+|dG|+|dB|). Each sample is classified geographically from its map.unproject position: LAKE (inside a wave_lakes.json g10
// outline), CONTROL (inside a lake the models must NOT light: Salton Sea, Lake Okeechobee, Lago de Nicaragua, Lake Ladoga, from
// the NE 10 m lakes file at SALTON), LAND (inside ne_50m_land and not a lake), SEA (the rest, the Caspian included: NE land holes it).
// The per-session heat (bare vs on) is NOT a lake test (Waves recolours land); the lake test is pairwise: lakes_pairs.js compares
// the lakes and nolakes screenshots of one (theme, model, view) over the saved cls-<view>.json sample classes.
// Reported per view: heat fraction over lake / control / land / sea samples. At the Lake Michigan view the session also scrubs
// (ArrowRight x4, PageUp x2) and reads window.__RAW_GPU__.cpuPhaseTiming maskWaterPaint calls before and after, and (EURO arms)
// clicks GFS and re-reads the lake heat 8 s later (the lake must go dark).
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS,EURO --layers waves --land-mask 1 \
//       --wave-lakes 1 --port 4100
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3100
//   PORT=4100 SALTON=<ne_10m_lakes.json> OUT=<dir> node frontend/scripts/offline-backend/scn_wave_lakes.js
// Env: THEMES (dark), MODELS (EURO,GFS), ARMS (lakes,nolakes), SHOT_THEMES (light,beach: EURO + lakes only, screenshots for the
// owner), STRIDE (4), DIFF (36), SETTLE (5000).
const fs = require('fs');
const path = require('path');
const L = require('./ab_lib.js');
const { decodePng } = require(path.join(__dirname, '../../e2e/pngPixels.js'));

if (process.env.AB_LIVE === '1') throw Error('scn_wave_lakes is offline only');
const PORT = +(process.env.PORT || 4100);
const OUT = process.env.OUT || 'wave-lakes-out';
const STRIDE = +(process.env.STRIDE || 4);
const DIFF = +(process.env.DIFF || 36);
const SETTLE = +(process.env.SETTLE || 5000);
const THEMES = (process.env.THEMES || 'dark').split(',');
const MODELS = (process.env.MODELS || 'EURO,GFS').split(',');
const ARMS = (process.env.ARMS || 'lakes,nolakes').split(',');
const SHOT_THEMES = (process.env.SHOT_THEMES || 'light,beach').split(',').filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = { world: [-90, 45, 3.2], michigan: [-86.9, 44.0, 7], erie: [-81.2, 42.2, 9], winnipeg: [-97.9, 52.2, 7],
  victoria: [33.0, -1.0, 7], salton: [-115.8, 33.3, 8], caspian: [50.5, 42.0, 7], nicaragua: [-85.4, 11.6, 8], okeechobee: [-80.8, 26.95, 9] };
const CONTROL_NAMES = ['Salton Sea', 'Lake Okeechobee', 'Lago de Nicaragua', 'Lake Ladoga'];

// ── geography ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const lakes = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/wave_lakes.json'), 'utf8')).lakes;
const land = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/ne_50m_land.json'), 'utf8')).features;
const controls = [];
if (process.env.SALTON) {
  for (const f of JSON.parse(fs.readFileSync(process.env.SALTON, 'utf8')).features) {
    if (!f.properties || !CONTROL_NAMES.includes(f.properties.name)) continue;
    for (const p of (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)) controls.push(p);
  }
}
const inRing = (x, y, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) c = !c; } return c; };
const inPoly = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));
const landPolys = [];
for (const f of land) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) { const xs = p[0].map((q) => q[0]); const ys = p[0].map((q) => q[1]); landPolys.push({ p, b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }); }
}
function classify(lng, lat) {
  for (const l of lakes) { const [w, s, e, n] = l.bbox; if (lng >= w && lng <= e && lat >= s && lat <= n && inPoly(lng, lat, l.g10)) return 'lake'; }
  if (controls.some((p) => inPoly(lng, lat, p))) return 'control';
  for (const { p, b } of landPolys) if (lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3] && inPoly(lng, lat, p)) return 'land';
  return 'sea';
}

async function shot(page) {
  const box = await page.evaluate(() => { const r = (window.__MAP_INSTANCE__ || window.map).getContainer().getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
  const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  return { box, buf, png: decodePng(buf) };
}
async function samples(page, box) {
  return page.evaluate(({ w, h, stride }) => {
    const m = window.__MAP_INSTANCE__ || window.map; const out = [];
    for (let y = stride / 2; y < h; y += stride) for (let x = stride / 2; x < w; x += stride) { const p = m.unproject([x, y]); out.push([x, y, p.lng, p.lat]); }
    return out;
  }, { w: box.w, h: box.h, stride: STRIDE });
}
function heat(bare, on, pts, cls) {
  const r = { lake: [0, 0], control: [0, 0], land: [0, 0], sea: [0, 0] };
  pts.forEach(([x, y], i) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const a = (yi * bare.width + xi) * bare.bpp; const b = (yi * on.width + xi) * on.bpp;
    const d = Math.abs(bare.data[a] - on.data[b]) + Math.abs(bare.data[a + 1] - on.data[b + 1]) + Math.abs(bare.data[a + 2] - on.data[b + 2]);
    const k = cls[i]; r[k][1] += 1; if (d > DIFF) r[k][0] += 1;
  });
  const frac = (k) => (r[k][1] ? +(r[k][0] / r[k][1]).toFixed(4) : null);
  return { lake: frac('lake'), control: frac('control'), land: frac('land'), sea: frac('sea'), n: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v[1]])) };
}
const paints = (page) => page.evaluate(() => { const t = window.__RAW_GPU__ && window.__RAW_GPU__.cpuPhaseTiming; return t ? t.buckets.maskWaterPaint.calls : 0; });

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate((el) => el.click());
}

async function session(theme, model, arm, views, saveShots) {
  const { browser, page } = await L.launch({ port: PORT });
  const rec = { theme, model, arm, views: {} };
  try {
    await page.addInitScript(({ theme, arm }) => {
      localStorage.setItem('raw-surf-theme', theme);
      window.__RAW_DISABLE_STATIC_FRAMES__ = true;           // no CDN offline: /grid and /grid_series answer (never pre-seed __RAW_GPU__)
      if (arm === 'nolakes') window.__RAW_DISABLE_WAVE_LAKES__ = true;
    }, { theme, arm });
    await L.openMap(page);
    const bare = {};
    for (const v of views) { await L.jump(page, ...VIEWS[v]); await sleep(2500); bare[v] = await shot(page); }
    await clickExact(page, 'Waves');
    if (model !== 'GFS') { await sleep(1500); await clickExact(page, model); }
    await page.waitForFunction((m) => { const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; return g && (g.__sourceModel || 'GFS') === m; }, model, { timeout: 90000 });
    for (const v of views) {
      await L.jump(page, ...VIEWS[v]); await sleep(SETTLE);
      const on = await shot(page);
      const pts = await samples(page, on.box);
      const cls = pts.map(([, , lng, lat]) => classify(lng, lat));
      const clsFile = path.join(OUT, `cls-${v}.json`);
      if (!fs.existsSync(clsFile)) fs.writeFileSync(clsFile, JSON.stringify(pts.map(([x, y], i) => [Math.floor(x), Math.floor(y), cls[i]])));
      rec.views[v] = { heat: heat(bare[v].png, on.png, pts, cls), waveLakes: await page.evaluate(() => window.__RAW_WAVE_LAKES__ || null),
        grid: await page.evaluate(() => { const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid; return g ? { model: g.__sourceModel || null, cols: g.cols, rows: g.rows } : null; }) };
      if (saveShots) {
        fs.writeFileSync(path.join(OUT, `${theme}-${model}-${arm}-${v}.png`), on.buf);
        fs.writeFileSync(path.join(OUT, `${theme}-bare-${v}.png`), bare[v].buf);
      }
      if (v === 'michigan') {
        const p0 = await paints(page);
        const wheel = page.locator('[role="slider"][aria-label*="Forecast timeline"]').filter({ visible: true }).first();
        await wheel.focus();
        for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'PageUp', 'PageUp']) { await page.keyboard.press(k); await sleep(900); }
        await sleep(1500);
        rec.views[v].scrubMaskPaints = (await paints(page)) - p0;
        if (model === 'EURO' && arm === 'lakes') {
          await clickExact(page, 'GFS'); await sleep(8000);
          const after = await shot(page);
          rec.views[v].afterToggleToGFS = heat(bare[v].png, after.png, pts, cls);
          if (saveShots) fs.writeFileSync(path.join(OUT, `${theme}-${model}-${arm}-${v}-thenGFS.png`), after.buf);
          await clickExact(page, model); await sleep(SETTLE);
        }
      }
    }
  } finally { await browser.close(); }
  return rec;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const out = { at: new Date().toISOString(), stride: STRIDE, diff: DIFF, sessions: [] };
  const all = Object.keys(VIEWS);
  for (const theme of THEMES) for (const model of MODELS) for (const arm of ARMS) {
    const r = await session(theme, model, arm, all, true);
    out.sessions.push(r);
    console.log(theme, model, arm, JSON.stringify(Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, { ...v.heat, n: undefined, paints: v.scrubMaskPaints, toGFS: v.afterToggleToGFS && v.afterToggleToGFS.lake }]))));
    fs.writeFileSync(path.join(OUT, 'wave-lakes.json'), JSON.stringify(out, null, 1));
  }
  for (const theme of SHOT_THEMES) {
    const r = await session(theme, 'EURO', 'lakes', ['world', 'michigan', 'victoria'], true);
    out.sessions.push(r);
    console.log(theme, 'EURO lakes', JSON.stringify(Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, v.heat.lake]))));
    fs.writeFileSync(path.join(OUT, 'wave-lakes.json'), JSON.stringify(out, null, 1));
  }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
