/**
 * Capture the water_temp TRANSIENT during a continuous wheel zoom-out.
 * WS-CAN-0061. Theme pinned to `beach` to match the owner's session.
 *
 * The prior capture used jumpTo + 5s settles and found the steady state HEALTHY.
 * The reported symptom is mid-gesture, so this drives a real wheel and samples
 * every tick without ever letting the map settle.
 */
const { chromium } = require('C:/Users/dprit/Raw-Surf/frontend/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CAP_BASE || 'https://dev--rawsurf.netlify.app';
const OUT = process.env.CAP_OUT || 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-12.1/evidence/recordings';
const user = {
  id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  const pageLog = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/WaterTemp|OceanMask|ANCHOR|Re-asserted|TRANSITION|RenderContract/.test(t)) {
      pageLog.push({ t: Date.now(), msg: t.slice(0, 160) });
    }
  });

  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'beach');          // PIN THE THEME
  }, { u: user });

  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await sleep(14000);

  await page.evaluate(() => {
    for (const k of Object.keys(window)) {
      try { const v = window[k];
        if (v && typeof v.isStyleLoaded === 'function' && typeof v.getZoom === 'function') { window.__M__ = v; return; }
      } catch (e) {}
    }
  });
  if (!await page.evaluate(() => !!window.__M__)) { console.log('MAP NOT FOUND'); await ctx.close(); await browser.close(); return; }

  console.log('theme:', await page.evaluate(() => document.documentElement.className));

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === 'Water Temp');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  // start well zoomed-in over ocean so there is a healthy field to destroy
  await page.evaluate(() => window.__M__.jumpTo({ zoom: 6, center: [-70, 30] }));
  await sleep(10000);
  console.log('settled at z6, beginning wheel zoom-out');

  const sample = () => page.evaluate(() => {
    const m = window.__M__;
    const ids = (m.getStyle().layers || []).map((l) => l.id);
    const c = m.getCanvas();
    const x = Math.round(c.clientWidth * 0.25), y = Math.round(c.clientHeight * 0.5);
    let at = [];
    try { at = [...new Set(m.queryRenderedFeatures([x, y]).map((f) => f.layer && f.layer.id).filter(Boolean))]; } catch (e) {}
    const slotVis = [0, 1, 2].map((s) => {
      try { return m.getLayoutProperty(`water_temp-slot-${s}-layer`, 'visibility') || 'visible'; } catch (e) { return '?'; }
    });
    const slotOpa = [0, 1, 2].map((s) => {
      try { return m.getPaintProperty(`water_temp-slot-${s}-layer`, 'raster-opacity'); } catch (e) { return null; }
    });
    return {
      z: +m.getZoom().toFixed(3),
      tilesLoaded: m.areTilesLoaded(),
      slots: [0, 1, 2].map((s) => ids.indexOf(`water_temp-slot-${s}-layer`)),
      maskFill: ids.indexOf('ocean-mask-fill'),
      water: ids.indexOf('water'),
      slotVis, slotOpa,
      atOceanPixel: at.slice(0, 6),
      wtVisibleHere: at.some((i) => /water_temp/.test(i)),
      protocolCalls: (window.__TILE_TRUTH__ || {}).protocolCalls,
    };
  });

  const series = [];
  await page.mouse.move(500, 400);
  for (let i = 0; i < 34; i++) {
    await page.mouse.wheel(0, 240);               // zoom OUT, no settle
    await sleep(120);
    const s = await sample();
    s.i = i; s.t = Date.now();
    series.push(s);
    if (i % 3 === 0) {
      await page.screenshot({
        path: path.join(OUT, `TR-${String(i).padStart(2, '0')}-z${s.z.toFixed(2)}.jpg`),
        type: 'jpeg', quality: 55, clip: { x: 200, y: 0, width: 830, height: 800 },
      });
    }
    if (s.z <= 2.02) break;
  }
  await sleep(6000);
  const settled = await sample(); settled.i = 'SETTLED'; series.push(settled);
  await page.screenshot({ path: path.join(OUT, 'TR-99-settled.jpg'), type: 'jpeg', quality: 55,
    clip: { x: 200, y: 0, width: 830, height: 800 } });

  fs.writeFileSync(path.join(OUT, 'TR-transient-series.json'), JSON.stringify({ series, pageLog }, null, 1));
  console.log('\nZ      tiles  wt@px  slots        mask water  vis            atOceanPixel');
  for (const s of series) {
    console.log(`${String(s.z).padEnd(6)} ${String(s.tilesLoaded).padEnd(6)} ${String(s.wtVisibleHere).padEnd(6)} ${JSON.stringify(s.slots).padEnd(12)} ${String(s.maskFill).padEnd(4)} ${String(s.water).padEnd(6)} ${JSON.stringify(s.slotVis).padEnd(14)} ${JSON.stringify(s.atOceanPixel)}`);
  }
  await ctx.close();
  await browser.close();
  console.log('\nwritten to', OUT);
})();
