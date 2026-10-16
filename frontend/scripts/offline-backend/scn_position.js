// WHERE is the field drawn? Same hour, same camera, rendered twice: as the THINNED world series frame (the exact /grid held back)
// and as the EXACT frame; then the two screenshots are cross-correlated on their heat rows to measure the vertical shift.
//   PORT=4100 (flag off) | PORT=4101 (flag on)   node scn_position.js      (null control: exact vs exact must read 0 px)
// The field is the synthetic climate, whose storm-track bands are broad enough to survive an 8-degree lattice, so a registration
// error shows as a clean shift of the band structure. A small vortex would confound registration with sampling.
const path = require('path');
const L = require('./ab_lib.js');
const { decodePng } = require(path.join(__dirname, '../../e2e/pngPixels.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const heatRows = (png, clip) => {                       // mean luminance per row: monotone in the ramp, the basemap cancels between same-camera shots
  const A = decodePng(png); const rows = [];
  for (let y = clip.y0; y < clip.y1; y++) {
    let acc = 0; let n = 0;
    for (let x = clip.x0; x < clip.x1; x += 2) {
      const p = (y * A.width + x) * A.bpp;
      acc += 0.2126 * A.data[p] + 0.7152 * A.data[p + 1] + 0.0722 * A.data[p + 2]; n++;
    }
    rows.push(acc / n);
  }
  return rows;
};
const shiftPx = (a, b, maxShift = 90) => {            // the shift s (rows) that best maps profile b onto a: a[y] ~ b[y - s]
  const mean = (v) => v.reduce((x, y) => x + y, 0) / v.length;
  const ma = mean(a); const mb = mean(b); let best = { s: 0, c: -Infinity };
  for (let s = -maxShift; s <= maxShift; s++) {
    let num = 0; let da = 0; let db = 0;
    for (let y = maxShift; y < a.length - maxShift; y++) { const x = a[y] - ma; const z = b[y - s] - mb; num += x * z; da += x * x; db += z * z; }
    const c = num / Math.sqrt(da * db + 1e-12);
    if (c > best.c) best = { s, c };
  }
  return best;
};

(async () => {
  const PORT = +(process.env.PORT || 4100);
  const hold = { on: false };
  const series = [];                                        // AB_LIVE=1: what each world /grid_series page's frames claim versus where their cells are
  const afterWeather = async (url, resp) => {
    if (!url.pathname.endsWith('/grid_series')) return;
    const j = JSON.parse((await resp.body()).toString('utf8')); const f = (j.frames || [])[0]; if (!f) return;
    let w = 1e9; let e = -1e9; let s = 1e9; let n = -1e9; for (const p of f.vectors || []) { if (p.lng < w) w = p.lng; if (p.lng > e) e = p.lng; if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; }
    series.push({ bbox: url.searchParams.get('bbox'), hours: (url.searchParams.get('hours') || '').split(',').length, frames: (j.frames || []).length, stride: j.decimated_stride || null, cols: f.cols, rows: f.rows, bounds: f.bounds, nodeExtent: { west: w, south: s, east: e, north: n }, boundsEqualNodeExtent: !!f.bounds && f.bounds.west === w && f.bounds.south === s && f.bounds.east === e && f.bounds.north === n });
  };
  const { browser, page } = await L.launch({ port: PORT, hooks: { afterWeather, beforeWeather: async (url) => { if (hold.on && url.pathname.endsWith('/grid')) { while (hold.on) await sleep(100); } } } });
  const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await page.evaluate(pred); if (v) return v; await sleep(150); } return null; };
  try {
    await L.openMap(page); await L.jump(page, -30, 45, 2.6); await L.clickText(page, 'Waves'); await sleep(12000);
    await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
    const info = await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const c = m.getContainer().getBoundingClientRect(); return { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height), lat0: m.unproject([0, 300]).lat, lat1: m.unproject([0, 301]).lat }; });
    const clip = { x0: Math.round(info.w * 0.25), x1: Math.round(info.w * 0.75), y0: 120, y1: info.h - 120 };
    const dLatPerPx = Math.abs(info.lat0 - info.lat1);
    const shot = async () => { await sleep(1200); return page.screenshot({ clip: { x: info.x, y: info.y, width: info.w, height: info.h } }); };
    const state = () => page.evaluate(() => { const q = window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ || {}; return { par: window.__MARINE_RENDER_HOUR_PARITY__, vc: q.vectorCount, bounds: q.bounds, up: window.__WEBGL_MARINE_UPLOAD_COUNT__ }; });

    hold.on = true;                                           // hold the exact /grid back so the thinned series frame stays resident
    await page.keyboard.press('PageUp');
    const thinnedOk = await waitFor(() => { const q = window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ || {}; const to = (v) => +String(v).split('->').pop(); return to(q.hour) === 24 && to(q.vectorCount) > 0 && to(q.vectorCount) < 3000; }, 20000);
    const thinnedState = await state(); const thinnedPng = thinnedOk ? await shot() : null;
    hold.on = false;                                          // release: the exact frame arrives
    const exactOk = await waitFor(() => { const q = window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ || {}; const to = (v) => +String(v).split('->').pop(); return to(q.hour) === 24 && to(q.vectorCount) > 10000; }, 25000);
    const exactState = await state(); const exactPng = exactOk ? await shot() : null; const exactPng2 = exactOk ? await shot() : null;
    const fs = require('fs'); const dir = process.env.AB_DIR; if (dir) { fs.mkdirSync(dir, { recursive: true }); if (thinnedPng) fs.writeFileSync(path.join(dir, `pos_${PORT}_thinned.png`), thinnedPng); if (exactPng) fs.writeFileSync(path.join(dir, `pos_${PORT}_exact.png`), exactPng); }
    const out = { port: PORT, live: process.env.AB_LIVE === '1', series, clip, thinnedResident: !!thinnedOk, exactResident: !!exactOk, thinnedState, exactState, degPerPx: +dLatPerPx.toFixed(4) };
    if (thinnedPng && exactPng) {
      const ht = heatRows(thinnedPng, clip); const he = heatRows(exactPng, clip); const he2 = heatRows(exactPng2, clip);
      const t = shiftPx(he, ht); const nul = shiftPx(he, he2);
      out.thinnedVsExact = { shiftPx: t.s, corr: +t.c.toFixed(3), shiftDeg: +(t.s * dLatPerPx).toFixed(2), shiftKm: Math.round(t.s * dLatPerPx * 111) };
      out.nullControl = { shiftPx: nul.s, corr: +nul.c.toFixed(3) };
    }
    console.log(JSON.stringify(out));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
