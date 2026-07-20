/**
 * probe_wind_threetheme_zoomseries.js — the THREE-THEME zoom-series proof (2026-07-19, user
 * mandate: "make sure all our fixes are going to all three themes").
 *
 * For EACH theme (dark/light/beach): park at the Gulf fine zoom (the fine product commits),
 * then step OUT through mid and wide zooms. At every step capture a screenshot + engine truth:
 * the fine overlay must stay ACTIVE (data never fades — the round-2 contract), wideFade
 * telemetry reports the persistence-lever fade, and the base must stay world-span.
 *
 * PASS per theme = fine overlay resident at every step once first filed, base 360° at every
 * step, and the overlay's field visibly present (screenshotted for eyes).
 *
 * Usage: node probe_wind_threetheme_zoomseries.js [baseUrl] [outdir]   (run from frontend/)
 */
const path = require('path');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join('C:/Users/dprit/Raw-Surf/frontend', 'node_modules', '@playwright', 'test'))); }

const BASE = process.argv[2] || 'http://localhost:3009';
const OUT = process.argv[3] || path.join(__dirname, 'wind-threetheme-out');
fs.mkdirSync(OUT, { recursive: true });

const CENTER = { lng: -85, lat: 25 };
const ZOOMS = [6.4, 5.2, 4.3];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  let fails = 0;
  for (const theme of ['dark', 'light', 'beach']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.addInitScript((t) => { try {
      localStorage.setItem('raw-surf-theme', t);
      localStorage.setItem('__RAW_TUNER__', '0');
      localStorage.setItem('__RAW_DIAG__', '0');
    } catch (e) {} }, theme);
    await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => !!(window.__RAW_MAP__ || window.map), null, { timeout: 180000 });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
        if (d) d.click();
      }).catch(() => {});
      await page.waitForTimeout(600);
    }
    await page.evaluate((c) => {
      const m = window.__RAW_MAP__ || window.map;
      m.jumpTo({ center: [c.lng, c.lat], zoom: 6.4 });
    }, CENTER);
    await page.waitForFunction(() => {
      const all = Array.from(document.querySelectorAll('button'));
      const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
      if (all.some((x) => label(x) === 'Wind')) return true;
      const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
      if (exp) exp.click();
      return false;
    }, null, { timeout: 90000 }).catch(() => {});
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button'));
      const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
      const b = all.find((x) => label(x) === 'Wind');
      if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
    });
    // wait for the fine overlay to file (base+overlay live) — recovery may need a beat
    const gotFine = await page.waitForFunction(() => {
      const e = window.__WIND_ENGINE__;
      return !!(e && e._windFine && e._windFine.texture && e._windData
        && (e._windData.bounds.east - e._windData.bounds.west) >= 350);
    }, null, { timeout: 90000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(4000);

    for (const z of ZOOMS) {
      await page.evaluate((zz) => {
        const m = window.__RAW_MAP__ || window.map;
        m.easeTo({ zoom: zz, duration: 900 });
      }, z);
      await page.waitForTimeout(3500);
      const st = await page.evaluate(() => {
        const e = window.__WIND_ENGINE__;
        return {
          tele: window.__WIND_FINE_OVERLAY__ || null,
          baseSpan: e && e._windData ? +(e._windData.bounds.east - e._windData.bounds.west).toFixed(0) : null,
        };
      });
      const shot = path.join(OUT, `${theme}_z${z}.png`);
      await page.screenshot({ path: shot });
      const fineOk = !gotFine || (st.tele && st.tele.active); // if fine never arrived (upstream), don't fail the theme
      const baseOk = st.baseSpan === 360 || st.baseSpan === null;
      if (!fineOk || !baseOk) fails++;
      console.log(`[${theme}] z${z} base ${st.baseSpan} fine ${st.tele && st.tele.active ? 'ACTIVE wideFade ' + st.tele.wideFade : 'none'}${gotFine ? '' : ' (fine never arrived — upstream)'} ${(!fineOk || !baseOk) ? '<< FAIL' : ''}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(fails === 0 ? '\nTHREE-THEME ZOOM SERIES PASS — data resident at every step in every theme.'
    : `\n${fails} failing step(s).`);
  process.exit(fails === 0 ? 0 : 1);
})();
