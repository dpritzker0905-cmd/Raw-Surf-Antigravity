// WAVE PALETTE A/B (2026-10-20): the light and beach wave-height wash as the REAL engine draws it, offline, for v1 (the 2026-10-14
// table, what window.__RAW_DISABLE_WAVE_PALETTE_V2__ restores) and v2 (the default; DECISIONS D-033 picked light A + beach B from
// the first run's candidates A/B), at world, regional and coastal zoom, plus frames for a moving clip. One build serves both: the
// kill is set before load. A future candidate is one more entry in LEVERS (and a lever in marineWavePalette.js).
//
//   python serve_synthetic.py --dir <fresh dir> --port 4120 --dynamic 1 --vortex-peak 11   (the eye crosses 10 m: the above-cap state)
//   node serve_spa.js <build dir> 3100
//   PORT=4120 OUT=<dir> node scn_wave_palette_ab.js        then: python compose_wave_ab.py <dir>
// Env: VARIANTS=v1,v2  THEMES=light,beach  VIEWS=world,regional,coastal  CLIP=1 (frames for the clip)  CLIP_FRAMES=40
// Per shot it records what the engine held (grid shape, bounds, valid time, the drawn grid's height range) so the panes can be
// shown to be the same data; and, before Waves is switched on, the bare water's colour (the checker's basemap model).
const fs = require('fs');
const path = require('path');
const L = require('./ab_lib.js');
const { decodePng } = require(path.join(__dirname, '../../e2e/pngPixels.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = +(process.env.PORT || 4120);
const OUT = process.env.OUT || path.join(process.cwd(), 'wave-ab');
const LEVERS = { v1: { __RAW_DISABLE_WAVE_PALETTE_V2__: true }, v2: {} };
// The synthetic storm's eye starts at 14N 106W and drifts north-west (serve_synthetic.py vortex_center); the coast is Jalisco/Colima.
const VIEWS = { world: [-118, 10, 2.2], regional: [-106.5, 15.5, 4.6], coastal: [-105.2, 18.4, 7.4] };
const pick = (env, all) => (process.env[env] ? process.env[env].split(',') : Object.keys(all));
const variants = pick('VARIANTS', LEVERS), themes = process.env.THEMES ? process.env.THEMES.split(',') : ['light', 'beach'], views = pick('VIEWS', VIEWS);
const CLIP_FRAMES = +(process.env.CLIP_FRAMES || 40);

const drawn = () => {   // what the engine holds (not the layer's parity record: see the harness README)
  const e = window.__MARINE_ENGINE__, d = e && e._waveData, g = d && (d.grid || d);
  let lo = Infinity, hi = -Infinity, over10 = 0;
  for (const v of (g && g.vectors) || []) { const s = v.speed; if (typeof s === 'number' && v.is_valid !== false) { if (s < lo) lo = s; if (s > hi) hi = s; if (s >= 10) over10++; } }
  return { cols: g && g.cols, rows: g && g.rows, bounds: g && g.bounds, valid: d && d.truthTag && d.truthTag.valid_time, model: g && g.__sourceModel,
    hMin: lo, hMax: hi, cellsAt10m: over10, palette: window.__RAW_DISABLE_WAVE_PALETTE_V2__ ? 'v1' : 'v2' };
};

async function legendBox(page) {
  return page.evaluate(() => {
    const label = [...document.querySelectorAll('div,span')].find((n) => /^Combined Waves/.test(n.textContent || '') && n.children.length === 0);
    if (!label) return null;
    const r = label.parentElement.getBoundingClientRect();
    return { x: Math.max(0, Math.floor(r.x) - 4), y: Math.max(0, Math.floor(r.y) - 4), width: Math.ceil(r.width) + 8, height: Math.ceil(r.height) + 8 };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const record = { at: new Date().toISOString(), port: PORT, views: VIEWS, shots: [], water: {} };
  for (const theme of themes) {
    for (const v of variants) {
      const { browser, page, log } = await L.launch({ port: PORT });
      try {
        await page.addInitScript(({ theme, levers }) => { localStorage.setItem('raw-surf-theme', theme); Object.assign(window, levers); }, { theme, levers: LEVERS[v] });
        await L.openMap(page);
        // The bare water before Waves is on: the colour the checker composites over (wave-lib.mjs BASEMAP).
        await L.jump(page, ...VIEWS.regional); await sleep(5000);
        const box = await page.evaluate(() => { const r = (window.__MAP_INSTANCE__ || window.map).getContainer().getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
        const bare = decodePng(await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } }));
        const px = (x, y) => { const p = (y * bare.width + x) * bare.bpp; return [bare.data[p], bare.data[p + 1], bare.data[p + 2]]; };
        record.water[`${theme}/${v}`] = [[0.2, 0.75], [0.5, 0.8], [0.3, 0.9]].map(([fx, fy]) => px(Math.round(box.w * fx), Math.round(box.h * fy)));
        await L.clickText(page, 'Waves'); await sleep(9000);
        for (const view of views) {
          await L.jump(page, ...VIEWS[view]); await sleep(view === 'world' ? 9000 : 11000);
          const file = `${theme}-${view}-${v}.png`;
          await page.screenshot({ path: path.join(OUT, file) });
          const lb = await legendBox(page);
          if (lb) await page.screenshot({ path: path.join(OUT, `${theme}-${view}-${v}-legend.png`), clip: lb });
          record.shots.push({ theme, variant: v, view, file, legend: lb ? `${theme}-${view}-${v}-legend.png` : null, engine: await page.evaluate(drawn) });
          console.log(theme, v, view, JSON.stringify(record.shots[record.shots.length - 1].engine));
        }
        if (process.env.CLIP === '1') {   // the moving clip: regional view, the forecast stepped +1 h every 5 frames while the crests run
          await L.jump(page, ...VIEWS.regional); await sleep(9000);
          await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
          const clip = { x: Math.round(box.x + box.w * 0.2), y: Math.round(box.y + box.h * 0.15), width: Math.round(box.w * 0.6), height: Math.round(box.h * 0.7) };
          for (let k = 0; k < CLIP_FRAMES; k++) {
            if (k && k % 5 === 0) await page.keyboard.press('ArrowRight');
            await page.screenshot({ path: path.join(OUT, `clip-${theme}-${v}-${String(k).padStart(3, '0')}.png`), clip });
            await sleep(120);
          }
        }
        record[`log/${theme}/${v}`] = { errors: log.errors.slice(0, 5), blockedWs: log.blockedWs.length, hosts: log.hosts, weatherRequests: log.requests.length };
      } finally { await browser.close(); }
    }
  }
  fs.writeFileSync(path.join(OUT, 'record.json'), JSON.stringify(record, null, 1));
  console.log('wrote', OUT);
})();
