/**
 * probe_wind_vortex_dump.js — dump the EXACT wind grid the running engine renders (2026-07-19).
 * The backend's /grid resolver serves global_coarse (37x17) to naive bbox requests, which cannot
 * resolve a vortex; the engine, driven by the real app at a Gulf viewport, receives the fine
 * product. So the truthful instrument is the engine's own _windData, not a hand-built API call.
 *
 * Usage: node probe_wind_vortex_dump.js [baseUrl] [outfile]
 *   env: VX_LNG / VX_LAT / VX_ZOOM — viewport to park at (default Gulf of Mexico, z6)
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join('C:/Users/dprit/Raw-Surf/frontend', 'node_modules', '@playwright', 'test'))); }

const BASE = process.argv[2] || 'http://localhost:3011';
const OUT = process.argv[3] || path.join(__dirname, 'wind-vortex-out', 'gulf_grid.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const CENTER = {
  lng: Number(process.env.VX_LNG || -90),
  lat: Number(process.env.VX_LAT || 24),
  // z6.5, not 6: at z6 a 1280px viewport spans ~14 deg > the tier's 13-deg gate, so the fine
  // lane never fires for the parked view and the wait below can only match a STALE box.
  zoom: Number(process.env.VX_ZOOM || 6.5),
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try {
    localStorage.setItem('raw-surf-theme', 'dark');
    localStorage.setItem('__RAW_TUNER__', '0');
    localStorage.setItem('__RAW_DIAG__', '0'); // keep the Diagnostics HUD out of screenshots
  } catch (e) {} });
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!document.querySelector('canvas'), null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
    if (d) d.click();
  }).catch(() => {});
  // Same Wind-chip dance as probe_wind_themes.js (poll — the first fixed-delay version raced).
  await page.waitForFunction(() => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    if (all.some((x) => label(x) === 'Wind')) return true;
    const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || ''))
      && !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
    if (exp) exp.click();
    return false;
  }, null, { timeout: 90000 }).catch(() => {});
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    const b = all.find((x) => label(x) === 'Wind');
    if (b) b.click();
  });
  await page.waitForTimeout(2000);
  await page.evaluate((c) => {
    const m = window.__RAW_MAP__ || window.map;
    if (m && m.jumpTo) m.jumpTo({ center: [c.lng, c.lat], zoom: c.zoom });
  }, CENTER);
  // Wait until the engine holds a grid whose bounds CONTAIN the parked centre — the first fine
  // grid to arrive can belong to the map's INITIAL viewport (the jumpTo-triggered moveend
  // refetch is still in flight), and dumping that one races the refetch (seen live r1: grid
  // origin -85,24 = the default-view box while parked at -89,24).
  // BASE+OVERLAY (queue #9): with the two-texture engine, the fine grid lives in _windFine (the
  // global base stays in _windData). Prefer the fine overlay — it is the grid that can resolve a
  // vortex; fall back to _windData for regional-as-base / legacy states.
  await page.waitForFunction((c) => {
    const e = window.__WIND_ENGINE__ || window.__RAW_WIND__;
    const fg = e && e._windFine && e._windFine.windGrid;
    const g = fg || (e && e._windData && e._windData.windGrid);
    if (!(g && g.vectors && g.vectors.length > 100 && g.bounds)) return false;
    const b = g.bounds;
    const spanOk = (b.east - b.west) < 350; // want the FINE product, not the global base
    // Containment WITH MARGIN (>= 2 deg inside every edge): a stale leftover box from the
    // map's INITIAL viewport can contain the parked centre at its very edge and satisfy a
    // bare containment check (seen live: a 2x2-deg box "containing" -90,24 at its corner).
    const M = 2.0;
    return spanOk && b.west + M <= c.lng && c.lng <= b.east - M
      && b.south + M <= c.lat && c.lat <= b.north - M;
  }, CENTER, { timeout: 150000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const dump = await page.evaluate((c) => {
    const e = window.__WIND_ENGINE__ || window.__RAW_WIND__;
    const fineSet = e && e._windFine && e._windFine.windGrid;
    const holder = fineSet ? e._windFine : (e && e._windData);
    const g = holder && holder.windGrid;
    if (!g || !g.vectors) return { error: 'no windGrid on engine' };
    const b = g.bounds || {};
    // Sub-grid crop around the viewport centre so the dump stays small even for a global product.
    const HALF = 14; // degrees each side
    const west = Math.max(b.west, c.lng - HALF), east = Math.min(b.east, c.lng + HALF);
    const south = Math.max(b.south, c.lat - HALF), north = Math.min(b.north, c.lat + HALF);
    const dlng = (b.east - b.west) / (g.cols - 1);
    const dlat = (b.north - b.south) / (g.rows - 1);
    const c0 = Math.max(0, Math.floor((west - b.west) / dlng));
    const c1 = Math.min(g.cols - 1, Math.ceil((east - b.west) / dlng));
    const r0 = Math.max(0, Math.floor((south - b.south) / dlat));
    const r1 = Math.min(g.rows - 1, Math.ceil((north - b.south) / dlat));
    const cols2 = c1 - c0 + 1, rows2 = r1 - r0 + 1;
    const u = new Array(cols2 * rows2), v = new Array(cols2 * rows2);
    // Row-major with row 0 = index 0 of vectors; vectors[i]: lat/lng included — verify layout from
    // the first vector rather than assuming.
    for (let r = 0; r < rows2; r++) {
      for (let cc = 0; cc < cols2; cc++) {
        const src = (r0 + r) * g.cols + (c0 + cc);
        const vec = g.vectors[src] || {};
        u[r * cols2 + cc] = +(vec.u || 0).toFixed(3);
        v[r * cols2 + cc] = +(vec.v || 0).toFixed(3);
      }
    }
    const v00 = g.vectors[r0 * g.cols + c0] || {};
    return {
      meta: {
        engineCols: g.cols, engineRows: g.rows, engineBounds: b,
        truthTag: g.truthTag || null,
        coverage_scope: g.coverage_scope || null,
        fromFineOverlay: !!fineSet,
        maxWindSpeed: e._maxWindSpeed,
        uMin: holder.uMin, uMax: holder.uMax,
        crop: { c0, r0, cols2, rows2, west: b.west + c0 * dlng, south: b.south + r0 * dlat, dlng, dlat },
        cropOriginVector: { lat: v00.lat, lng: v00.lng },
        viewport: c,
      },
      u, v,
    };
  }, CENTER);

  fs.writeFileSync(OUT, JSON.stringify(dump));
  const m = dump.meta || {};
  console.log('dumped:', OUT);
  console.log('engine grid:', m.engineCols + 'x' + m.engineRows, 'scope:', m.coverage_scope,
    'maxWindSpeed:', m.maxWindSpeed);
  console.log('crop:', m.crop && (m.crop.cols2 + 'x' + m.crop.rows2), 'origin check:', JSON.stringify(m.cropOriginVector),
    'expected origin:', m.crop && (m.crop.south + ',' + m.crop.west));
  if (dump.error) console.log('ERROR:', dump.error);
  await browser.close();
})();
