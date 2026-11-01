// LABEL ZOOM LADDER (2026-10-20): at which zoom does each theme's basemap show its STATE names in full, and its CITY names? The
// crest-density change keys its zoom ramps to those (the owner: light "where you can see the entire state name labels", beach "where
// you can see city names", dark two zooms closer than beach). Reads what the real Mapbox styles PLACE (queryRenderedFeatures returns
// only symbols that were drawn), per symbol layer, plus each layer's minzoom and text-field, and saves a screenshot per zoom.
//
//   python serve_synthetic.py --dir <dir> --port 4127   and   node serve_spa.js <build> 3117
//   PORT=4127 AB_BASE=http://127.0.0.1:3117 OUT=<dir> node scn_label_zoom.js      then: python compose_label_zoom.py <dir>
// Env: THEMES=light,beach,dark  ZOOMS=3,3.5,...  CENTER=-120.5,36.3 (central California: states, coastal cities)
const fs = require('fs');
const path = require('path');
const L = require('./ab_lib.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = +(process.env.PORT || 4127);
const OUT = process.env.OUT || path.join(process.cwd(), 'label-zoom');
const themes = (process.env.THEMES || 'light,beach,dark').split(',');
const zooms = (process.env.ZOOMS || '2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,9.5,10,10.5,11').split(',').map(Number);
const [LNG, LAT] = (process.env.CENTER || '-120.5,36.3').split(',').map(Number);
const LABEL_RE = /state|settlement|place|city|town|country|admin/;

async function idle(page, ms = 12000) {
  await page.evaluate((ms) => new Promise((r) => { const m = window.__MAP_INSTANCE__ || window.map; let done = false;
    const fin = () => { if (!done) { done = true; r(); } }; m.once('idle', fin); setTimeout(fin, ms); }), ms);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const record = { at: new Date().toISOString(), center: [LNG, LAT], zooms, themes: {} };
  for (const theme of themes) {
    const { browser, page } = await L.launch({ port: PORT });
    try {
      await page.addInitScript((t) => localStorage.setItem('raw-surf-theme', t), theme);
      await L.openMap(page);
      await sleep(4000);
      const layers = await page.evaluate((reSrc) => {
        const m = window.__MAP_INSTANCE__ || window.map, re = new RegExp(reSrc);
        return m.getStyle().layers.filter((l) => l.type === 'symbol' && re.test(l.id)).map((l) => ({ id: l.id, minzoom: l.minzoom ?? null,
          maxzoom: l.maxzoom ?? null, textField: (l.layout || {})['text-field'] ?? null, visibility: (l.layout || {}).visibility || 'visible', filter: l.filter || null }));
      }, LABEL_RE.source);
      const style = await page.evaluate(() => { const s = (window.__MAP_INSTANCE__ || window.map).getStyle(); return { name: s.name, sprite: s.sprite }; });
      const rows = [];
      for (const z of zooms) {
        await L.jump(page, LNG, LAT, z); await idle(page); await sleep(800);
        const placed = await page.evaluate((ids) => {
          const m = window.__MAP_INSTANCE__ || window.map, out = {};
          for (const id of ids) {
            if (!m.getLayer(id)) continue;
            const f = m.queryRenderedFeatures({ layers: [id] });
            if (!f.length) continue;
            const names = [...new Set(f.map((x) => x.properties.name_en || x.properties.name || ''))];
            const abbr = [...new Set(f.map((x) => x.properties.abbr || '').filter(Boolean))];
            out[id] = { n: f.length, names: names.slice(0, 12), abbr: abbr.slice(0, 12), classes: [...new Set(f.map((x) => x.properties.class || x.properties.type || ''))] };
          }
          return { zoom: m.getZoom(), out };
        }, layers.map((l) => l.id));
        const file = `${theme}-z${String(z).replace('.', '_')}.png`;
        await page.screenshot({ path: path.join(OUT, file) });
        rows.push({ zoom: z, actual: +placed.zoom.toFixed(2), file, placed: placed.out });
        console.log(theme, z, Object.entries(placed.out).map(([k, v]) => `${k}:${v.n}`).join(' '));
      }
      record.themes[theme] = { style, layers, rows };
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'labels.json'), JSON.stringify(record, null, 1));
  console.log('wrote', OUT);
})();
