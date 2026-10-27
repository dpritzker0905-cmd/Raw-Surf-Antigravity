// Does the drawn field JUMP while the camera is still? Real client, REAL backend (AB_LIVE=1 is required: read the README caution first).
// One map load, then three windows with the camera frozen: (A) the load settling, (B) after a one-stop zoom, (C) after a pan. Inside a
// window the screenshots are compared row-profile against row-profile; a field that is redrawn from a thinned world frame to the exact
// grid (or between tiers) in a different place shows up as a vertical shift between consecutive shots. A window in which nothing is
// redrawn reads 0 px (the null control is the settled tail of window A).
//   AB_LIVE=1 AB_BASE=http://127.0.0.1:3103 AB_DIR=<dir> node scn_live_jump.js
const path = require('path');
const fs = require('fs');
const L = require('./ab_lib.js');
const { decodePng } = require(path.join(__dirname, '../../e2e/pngPixels.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (process.env.AB_LIVE !== '1') { console.error('scn_live_jump.js talks to the real backend: set AB_LIVE=1 deliberately'); process.exit(2); }

const heatRows = (png, clip) => {
  const A = decodePng(png); const rows = [];
  for (let y = clip.y0; y < clip.y1; y++) {
    let acc = 0; let n = 0;
    for (let x = clip.x0; x < clip.x1; x += 2) { const p = (y * A.width + x) * A.bpp; acc += 0.2126 * A.data[p] + 0.7152 * A.data[p + 1] + 0.0722 * A.data[p + 2]; n++; }
    rows.push(acc / n);
  }
  return rows;
};
const shiftPx = (a, b, maxShift) => {
  const mean = (v) => v.reduce((x, y) => x + y, 0) / v.length; const ma = mean(a); const mb = mean(b); let best = { s: 0, c: -Infinity };
  for (let s = -maxShift; s <= maxShift; s++) {
    let num = 0; let da = 0; let db = 0;
    for (let y = maxShift; y < a.length - maxShift; y++) { const x = a[y] - ma; const z = b[y - s] - mb; num += x * z; da += x * x; db += z * z; }
    const c = num / Math.sqrt(da * db + 1e-12); if (c > best.c) best = { s, c };
  }
  return best;
};

(async () => {
  const dir = process.env.AB_DIR; if (dir) fs.mkdirSync(dir, { recursive: true });
  const series = [];
  const afterWeather = async (url, resp) => {
    if (!url.pathname.endsWith('/grid_series')) return;
    const j = JSON.parse((await resp.body()).toString('utf8')); const f = (j.frames || [])[0]; if (!f) return;
    let n = -1e9; let s = 1e9; for (const p of f.vectors || []) { if (p.lat > n) n = p.lat; if (p.lat < s) s = p.lat; }
    series.push({ t: Date.now(), hours: (url.searchParams.get('hours') || '').split(',').length, stride: j.decimated_stride || null, cols: f.cols, rows: f.rows, boundsNorth: f.bounds && f.bounds.north, nodeNorth: n, equal: !!f.bounds && f.bounds.north === n && f.bounds.south === s });
  };
  const { browser, page, log } = await L.launch({ port: 0, hooks: { afterWeather } });
  const out = { windows: {}, series, notes: [] };
  const state = () => page.evaluate(() => {
    const m = window.__MAP_INSTANCE__ || window.map; const c = m.getCenter(); const q = window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ || {}; const to = (v) => String(v).split('->').pop().trim();
    return { z: +m.getZoom().toFixed(2), lng: +c.lng.toFixed(3), lat: +c.lat.toFixed(3), hour: to(q.hour), vc: to(q.vectorCount), bounds: to(q.bounds), par: (window.__MARINE_RENDER_HOUR_PARITY__ || {}).parity, up: window.__WEBGL_MARINE_UPLOAD_COUNT__ };
  });
  try {
    await L.openMap(page); await L.jump(page, -30, 52, 3.0); await L.clickText(page, 'Waves');
    const t0 = Date.now(); while (Date.now() - t0 < 75000 && !series.some((s) => s.hours >= 40)) await sleep(500);
    out.notes.push(`first 48-frame page after ${((series.find((s) => s.hours >= 40) || { t: Date.now() }).t - t0) / 1000} s`);
    const info = await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const c = m.getContainer().getBoundingClientRect(); return { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height) }; });
    const clip = { x0: Math.round(info.w * 0.25), x1: Math.round(info.w * 0.75), y0: 120, y1: info.h - 120 };
    const shot = () => page.screenshot({ clip: { x: info.x, y: info.y, width: info.w, height: info.h } });
    const windowRun = async (name, seconds, everyMs, maxShift) => {
      const shots = []; const t1 = Date.now();
      while (Date.now() - t1 < seconds * 1000) {
        const png = await shot(); const st = await state(); const i = shots.length;
        if (dir) fs.writeFileSync(path.join(dir, `${name}_${String(i).padStart(2, '0')}.png`), png);
        shots.push({ t: +((Date.now() - t1) / 1000).toFixed(1), st, rows: heatRows(png, clip) });
        await sleep(everyMs);
      }
      const steps = [];
      for (let i = 1; i < shots.length; i++) { const r = shiftPx(shots[i - 1].rows, shots[i].rows, maxShift); steps.push({ t: shots[i].t, shiftPx: r.s, corr: +r.c.toFixed(3), vc: shots[i].st.vc, hour: shots[i].st.hour, bounds: shots[i].st.bounds, camera: `${shots[i].st.z}@${shots[i].st.lng},${shots[i].st.lat}` }); }
      const moves = steps.filter((s) => s.shiftPx !== 0);
      out.windows[name] = { shots: shots.length, maxAbsShiftPx: steps.reduce((m, s) => Math.max(m, Math.abs(s.shiftPx)), 0), shiftingSteps: moves, redraws: steps.filter((s, i) => i > 0 && (s.vc !== steps[i - 1].vc || s.bounds !== steps[i - 1].bounds)).map((s) => ({ t: s.t, vc: s.vc, bounds: s.bounds })), first: steps[0], last: steps[steps.length - 1] };
    };
    await windowRun('A_settle', 24, 1500, 120);
    await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; m.stop(); m.jumpTo({ center: [-30, 52], zoom: 4.0 }); });
    await sleep(800); await windowRun('B_zoom_in_one_stop', 20, 1500, 150);
    await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; m.stop(); m.jumpTo({ center: [-26, 52], zoom: 4.0 }); });
    await sleep(800); await windowRun('C_pan_4deg_east', 20, 1500, 150);
    out.hosts = log.hosts; out.errors = log.errors.length;
    console.log(JSON.stringify(out));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
