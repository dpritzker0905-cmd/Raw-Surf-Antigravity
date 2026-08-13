/**
 * Capture the water_temp zoom-out as FRAMES + per-zoom layer forensics.
 * Throwaway diagnostic for WS-CAN-0061. Auth seeds localStorage exactly as
 * frontend/e2e/weather-simulation.spec.js does — no credentials.
 *
 *   node zoomcap.js
 */
const { chromium } = require('C:/Users/dprit/Raw-Surf/frontend/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'https://dev--rawsurf.netlify.app';
const OUT = 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-12.1/evidence/screenshots';
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
  page.on('console', (m) => {
    const t = m.text();
    if (/WaterTemp|OceanMask|ANCHOR|Re-asserted/.test(t)) console.log('  [page]', t.slice(0, 140));
  });

  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
  }, { u: user });

  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await sleep(12000);

  // find the map handle once
  await page.evaluate(() => {
    for (const k of Object.keys(window)) {
      try { const v = window[k];
        if (v && typeof v.isStyleLoaded === 'function' && typeof v.getZoom === 'function') { window.__M__ = v; return; }
      } catch (e) {}
    }
  });
  const hasMap = await page.evaluate(() => !!window.__M__);
  console.log('map found:', hasMap);
  if (!hasMap) { await ctx.close(); await browser.close(); return; }

  // turn Water Temp on
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === 'Water Temp');
    if (!b) return false;
    if (b.getAttribute('aria-pressed') !== 'true') b.click();
    return true;
  });
  console.log('water temp toggled:', clicked);
  await sleep(9000);

  const report = [];
  for (const z of [8, 7, 6, 5, 4, 3, 2]) {
    await page.evaluate((zz) => window.__M__.jumpTo({ zoom: zz, center: [-70, 30] }), z);
    await sleep(5000);
    const file = path.join(OUT, `WT-z${String(z).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });

    const state = await page.evaluate(() => {
      const m = window.__M__;
      const ids = (m.getStyle().layers || []).map((l) => l.id);
      const c = m.getCanvas();
      // sample an OCEAN pixel (mid-Atlantic-ish, left-of-centre) and a LAND pixel via the mask
      const probe = (x, y) => {
        const hits = m.queryRenderedFeatures([x, y]).map((f) => f.layer && f.layer.id).filter(Boolean);
        return [...new Set(hits)].slice(0, 8);
      };
      const W = c.clientWidth, H = c.clientHeight;
      let ocean = null, land = null;
      for (let q = 1; q < 24 && (!ocean || !land); q++) {
        const x = Math.round(q * W / 24), y = Math.round(H / 2);
        const masked = m.queryRenderedFeatures([x, y], { layers: ['ocean-mask-fill'] }).length > 0;
        if (masked && !land) land = { pt: [x, y], layers: probe(x, y) };
        if (!masked && !ocean) ocean = { pt: [x, y], layers: probe(x, y) };
      }
      return {
        zoom: +m.getZoom().toFixed(2),
        slots: [0, 1, 2].map((s) => ids.indexOf(`water_temp-slot-${s}-layer`)),
        maskFill: ids.indexOf('ocean-mask-fill'),
        water: ids.indexOf('water'), waterShadow: ids.indexOf('water-shadow'),
        oceanPixel: ocean, landPixel: land,
      };
    });
    report.push(state);
    console.log(`z${z}`, JSON.stringify(state));
  }

  fs.writeFileSync(path.join(OUT, 'WT-zoom-forensics.json'), JSON.stringify(report, null, 1));
  await ctx.close();          // flushes the video
  await browser.close();
  console.log('\nframes + video written to', OUT);
})();
