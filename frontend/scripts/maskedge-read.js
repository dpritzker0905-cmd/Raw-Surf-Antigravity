/**
 * maskedge-read.js — READ the uniform, do not derive it.
 *
 * The open question: was `_maskEdgeSharp` 1.0 at the island cameras? It decides between two
 * different fixes — "the crisp cut is too soft for this texel" vs "the sharpening never reached
 * this pass". It COULD be inferred from `overlayMask.reason === 'min_combine'`, but a derivation is
 * not a reading, and this session has already had two levers (`u_dataMaskGate`,
 * `__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__`) turn out inert while every upstream signal looked right.
 *
 * Read LOCALLY: `window.__MARINE_ENGINE__` is absent on the deployed build, and the guardrail
 * self-exempts on localhost so the renderer cannot be swapped for raster tiles mid-read. The value
 * is pure code given the same camera and overlay reason — both are recorded here so the local
 * reading can be CHECKED against the deployed regime rather than assumed equal to it.
 *
 * Also returns the texel size in DEVICE PIXELS, which is the quantity the fix has to neutralise:
 * a mask-edge cut expressed in alpha units produces a screen-space ramp proportional to the texel,
 * so the ramp width tracks whichever mask tier happens to be resident.
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.ME_BASE || 'http://localhost:3000';
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const TARGETS = [
  ['grand_bahama', [-78.66, 26.62], 8.85],
  ['nassau', [-77.35, 25.05], 10.17],
  ['florida', [-80.10, 26.60], 10.17],
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
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
  console.log('engine handle present:', await page.evaluate(() => !!window.__MARINE_ENGINE__));

  for (const [name, center, z] of TARGETS) {
    await page.evaluate(({ c, zz }) => window.map.jumpTo({ center: c, zoom: zz }), { c: center, zz: z });
    await page.waitForTimeout(12000);
    const s = await page.evaluate(() => {
      const e = window.__MARINE_ENGINE__, g = window.__RAW_GPU__ || {}, m = window.map;
      const dims = e ? e._cachedMaskTexDims : null;
      const mb = e ? e._cachedMaskBounds : null;
      const span = mb ? ((mb.east < mb.west) ? (mb.east + 360 - mb.west) : (mb.east - mb.west)) : null;
      const c0 = m.getCenter();
      const pA = m.project([c0.lng, c0.lat]), pB = m.project([c0.lng + 1, c0.lat]);
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
      const dpr = src.width / rect.width;
      const devPxPerDeg = Math.abs(pB.x - pA.x) * dpr;
      return {
        z: +m.getZoom().toFixed(2),
        engine: !!e,
        maskEdgeSharp: e ? e._maskEdgeSharp : null,
        maskDims: dims ? `${dims.w}x${dims.h}` : null,
        maskSpanDeg: span ? +span.toFixed(3) : null,
        maskDensityPxPerDeg: (dims && span) ? +(dims.w / span).toFixed(1) : null,
        texelDevicePx: (dims && span) ? +((span / dims.w) * devPxPerDeg).toFixed(2) : null,
        overlayReason: g.overlayMask ? g.overlayMask.reason : null,
        overlayOn: g.overlayMask ? g.overlayMask.on : null,
        coastSDF: g.coastSDF || null,
      };
    });
    console.log(name.padEnd(14), JSON.stringify(s));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
