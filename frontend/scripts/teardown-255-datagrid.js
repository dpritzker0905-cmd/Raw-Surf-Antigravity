/**
 * teardown-255-datagrid.js — name the suspect the teardown left standing.
 *
 * ESTABLISHED: at 255° the mask reads 255 (full water) on every term through the whole hole, no
 * basemap layer is unique to it, and the pixel is byte-identical to waves-OFF. Mask right, nothing
 * on top, nothing painted ⇒ the field is NEVER DRAWN, and the remaining suspect is the WAVE DATA
 * lookup rather than coastline fidelity.
 *
 * THE PREDICTION THIS TESTS. If the hole is the data grid — land/no-data cells landward bleeding
 * into a bilinear fetch, thresholded to nothing — then the hole should scale with the DATA CELL,
 * not with the mask texel or the screen. Measured hole: 836 m at z9.3, then 98 / 24 / 49 / 67 m from
 * z10.4 up. A single fixed grid cannot produce that, so the prediction is specifically:
 *
 *     the grid feeding z9.3 is COARSER than the one feeding z10.4+, and the hole is a
 *     sub-cell fraction of each.
 *
 * If instead the same grid serves both zooms, the data-grid explanation is refuted too and the cause
 * is a gate/clip uniform in the heatmap pass. Either way this ends with a named next suspect rather
 * than a guess — the point of the teardown.
 *
 * ⚠️ Reads geometry only (bounds + dims + derived cell size). No lever, no mutation.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'teardown-255-datagrid-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[grid] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const PT = { lng: -17.12638, lat: 32.69350 };
const ZOOMS = [9.3, 10.4, 11.4];

const readGrid = ({ pt }) => {
  const eng = window.__MARINE_ENGINE__, m = window.map;
  if (!eng) return { err: 'no engine' };
  const cosLat = Math.cos(pt.lat * Math.PI / 180);
  const cell = (b, w, h) => {
    if (!b || !w || !h) return null;
    const span = (b.east < b.west ? b.east + 360 : b.east) - b.west;
    return { spanDeg: +span.toFixed(4), cols: w, rows: h,
      cellDegLng: +(span / w).toFixed(5),
      cellM: +(span / w * 111320 * cosLat).toFixed(0) };
  };
  const wd = eng._waveData || null;
  const wg = wd && (wd.waveGrid || wd.grid) || null;
  const cb = eng._coarseBaseData || null;
  const dims = (g) => {
    if (!g) return [null, null];
    if (Array.isArray(g) && Array.isArray(g[0])) return [g[0].length, g.length];
    if (g.width && g.height) return [g.width, g.height];
    if (g.cols && g.rows) return [g.cols, g.rows];
    return [null, null];
  };
  const [ww, wh] = dims(wg);
  const [cw, ch] = [cb && cb.__gridCols, cb && cb.__gridRows];
  return {
    zoom: +m.getZoom().toFixed(2),
    overlayMask: (window.__RAW_GPU__ || {}).overlayMask || null,
    waveBounds: wd && wd.bounds ? wd.bounds : null,
    waveGridKeys: wd ? Object.keys(wd).slice(0, 24) : null,
    waveCell: cell(wd && wd.bounds, ww, wh),
    coarseBounds: cb && cb.bounds ? cb.bounds : null,
    coarseKeys: cb ? Object.keys(cb).slice(0, 24) : null,
    coarseCell: cell(cb && cb.bounds, cw, ch),
    mPerCssPx: +(156543.03392 * Math.cos(m.getCenter().lat * Math.PI / 180) / Math.pow(2, m.getZoom()) / 2).toFixed(2),
  };
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.8) f.remove();
    }
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });

  const rows = [];
  for (const z of ZOOMS) {
    await page.evaluate(({ p, zz }) => window.map.jumpTo({ center: [p.lng, p.lat], zoom: zz }), { p: PT, zz: z });
    await page.waitForTimeout(14000);
    const r = await page.evaluate(readGrid, { pt: PT });
    rows.push(r);
    log(`z${z}  overlay=${r.overlayMask && r.overlayMask.reason}  m/cssPx=${r.mPerCssPx}`);
    log(`    waveBounds  ${JSON.stringify(r.waveBounds)}`);
    log(`    waveCell    ${JSON.stringify(r.waveCell)}`);
    log(`    coarseCell  ${JSON.stringify(r.coarseCell)}`);
    if (rows.length === 1) {
      log(`    waveData keys   ${JSON.stringify(r.waveGridKeys)}`);
      log(`    coarseBase keys ${JSON.stringify(r.coarseKeys)}`);
    }
  }
  await ctx.close();
  fs.writeFileSync(path.join(outdir, 'datagrid.json'), JSON.stringify({ base: BASE, pt: PT, rows }, null, 1));
  log('written: ' + path.join(outdir, 'datagrid.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
