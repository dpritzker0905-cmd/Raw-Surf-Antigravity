/**
 * ray-profile-diag.js — LOOK AT THE ACTUAL PIXELS before tuning another threshold.
 *
 * island-reassert-ab.js refused 20 of 24 rays with `no_field` (255 - R_far < 50, i.e. the far pixel
 * is BRIGHT). That contradicts the expectation that the marine field darkens forced-red water, so
 * the threshold is not obviously the thing that is wrong — the assumption behind it might be. House
 * rule: inspect one instance of the data before parsing the set.
 *
 * Dumps, for every bearing at the stock camera: the detected coast index, and the raw RGB at a
 * ladder of distances, with and without the forced red. No verdict, no gate, no metric — just the
 * numbers, so the next instrument is designed against reality rather than against my guess.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'ray-profile-diag-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[diag] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const TARGET = { center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };
const LADDER = [0, 1, 2, 4, 8, 16, 32, 64, 128, 200, 300, 380];

const probe = ({ center, rayDeg, ladder }) => new Promise((resolve) => {
  const m = window.map;
  const fn = () => {
    m.off('render', fn);
    const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
    const dpr = src.width / rect.width;
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
    const img = c2.getImageData(0, 0, cv.width, cv.height).data;
    const waterIds = (() => {
      try {
        const ids = (m.getStyle().layers || []).filter((l) => l['source-layer'] === 'water' || l.id === 'water')
          .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
        return ids.length ? ids : ['water'];
      } catch (e) { return ['water']; }
    })();
    const out = [];
    for (let b = 0; b < 24; b++) {
      const th = (b / 24) * 2 * Math.PI;
      const dest = [center[0] + rayDeg * Math.sin(th) / Math.cos(center[1] * Math.PI / 180),
        center[1] + rayDeg * Math.cos(th)];
      const p0 = m.project(center), p1 = m.project(dest);
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const nDev = Math.max(8, Math.round(Math.hypot(dx, dy) * dpr));
      const at = (i) => ({ cx: p0.x + dx * i / nDev, cy: p0.y + dy * i / nDev });
      const okv = (cx, cy) => cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
        && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
      const water = [];
      const isWater = (i) => {
        if (water[i] !== undefined) return water[i];
        const { cx, cy } = at(i);
        if (!okv(cx, cy)) { water[i] = null; return null; }
        let w = null;
        try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {}
        water[i] = w; return w;
      };
      let coast = -1;
      for (let i = 1; i + 8 <= nDev; i++) {
        if (isWater(i) !== true) continue;
        let ok = true;
        for (let k = 1; k < 8; k++) if (isWater(i + k) !== true) { ok = false; break; }
        if (ok) { coast = i; break; }
      }
      const px = (i) => {
        const { cx, cy } = at(i);
        if (!okv(cx, cy)) return null;
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
        const o = (Y * cv.width + X) * 4;
        return [img[o], img[o + 1], img[o + 2]];
      };
      out.push({ b, coast, nDev,
        onLand: coast > 0 ? px(Math.max(1, Math.floor(coast / 2))) : null,
        prof: coast > 0 ? ladder.map((d) => px(coast + d)) : null });
    }
    resolve({ rays: out, zoom: +m.getZoom().toFixed(2), dpr,
      dataBoundsNote: (window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask) ? window.__RAW_GPU__.overlayMask.reason : null });
  };
  m.on('render', fn); m.triggerRepaint();
});

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
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
  await page.waitForTimeout(15000);

  const natural = await page.evaluate(probe, { center: TARGET.center, rayDeg: TARGET.rayDeg, ladder: LADDER });
  await page.evaluate((col) => {
    const m = window.map;
    const done = [];
    for (const l of (m.getStyle().layers || [])) {
      if (l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id)) {
        try { m.setPaintProperty(l.id, 'fill-color', col); done.push(l.id); } catch (e) {}
      }
    }
    window.__DIAG_WATER_LAYERS__ = done;
  }, '#ff0000');
  await page.waitForTimeout(3000);
  const reddened = await page.evaluate(probe, { center: TARGET.center, rayDeg: TARGET.rayDeg, ladder: LADDER });
  const waterLayers = await page.evaluate(() => window.__DIAG_WATER_LAYERS__ || []);
  await ctx.close(); await browser.close();

  log(`water layers repainted: ${JSON.stringify(waterLayers)}`);
  log(`ladder (device px from coast): ${LADDER.join(' ')}`);
  for (const which of [['NATURAL', natural], ['REDDENED', reddened]]) {
    log('');
    log(`===== ${which[0]}  (zoom ${which[1].zoom}, dpr ${which[1].dpr}) =====`);
    log('  b  coast   onLand        ' + LADDER.map((d) => ('d' + d).padStart(13)).join(''));
    for (const r of which[1].rays) {
      const fmt = (c) => (c ? `${c[0]},${c[1]},${c[2]}`.padStart(13) : '         null');
      log(`  ${String(r.b).padStart(2)} ${String(r.coast).padStart(5)}  ${r.onLand ? fmt(r.onLand).trim().padStart(11) : '       null'}  `
        + (r.prof ? r.prof.map(fmt).join('') : '  (no coast)'));
    }
  }
  fs.writeFileSync(path.join(outdir, 'ray-profile-diag.json'),
    JSON.stringify({ ladder: LADDER, waterLayers, natural, reddened }, null, 1));
  log('');
  log('written: ' + path.join(outdir, 'ray-profile-diag.json'));
})().catch((e) => { console.error(e); process.exit(1); });
