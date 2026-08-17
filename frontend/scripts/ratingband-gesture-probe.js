/**
 * ratingband-gesture-probe.js — does jumpTo drive the marine engine, or only a real gesture?
 *
 * The rating ladder read __RAW_GPU__.ratingBandFade.span = 0.742 at all twelve cameras, from a
 * 0.74 deg viewport to a 47 deg one. The telemetry's own span field disagreeing with the live
 * viewport is proof of staleness rather than a guess — but it does not say WHOSE fault it is:
 *
 *   H1  the telemetry is broken (written once, never again)
 *   H2  the marine engine does not re-run on jumpTo, only on a real gesture / idle
 *
 * These have opposite consequences. Under H1 every __RAW_GPU__ reading in this program's audits is
 * suspect. Under H2 the readings are fine and every jumpTo-based harness has been measuring a
 * camera the engine never saw — which includes the ladder above and halo-isolate's zoom legs.
 *
 * Discriminator: same target camera, reached two ways, telemetry read after each.
 *   leg A  jumpTo z10 -> z6           expect stale under H2, stale under H1
 *   leg B  real mouse wheel z10 -> z6 expect LIVE under H2, stale under H1
 * A live reading in leg B refutes H1 and confirms H2. Both stale confirms H1.
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }
const BASE = process.env.RB_BASE || 'https://dev--rawsurf.netlify.app';
const log = (m) => console.log('[gesture] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };
const findWaves = () => Array.from(document.querySelectorAll('button'))
  .find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves') || null;
const findRating = () => Array.from(document.querySelectorAll('button'))
  .find((x) => /Surf Rating:/.test(x.textContent || '')) || null;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
  await page.waitForFunction(`(${findWaves.toString()})() !== null`, null, { timeout: 60000 });
  await page.evaluate(`(() => { const b = (${findWaves.toString()})(); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.ratingBandFade !== undefined
    || (window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask), null, { timeout: 120000 });
  await page.evaluate(`(() => { const b = (${findRating.toString()})(); if (b && /OFF/.test(b.textContent)) b.click(); })()`);
  await page.waitForTimeout(12000);
  log('rating chip: ' + await page.evaluate(`(() => { const b = (${findRating.toString()})(); return b ? b.textContent.trim() : null; })()`));

  // remove any full-viewport dev iframe or the real wheel lands on it, not the map
  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) f.remove();
    }
  });

  const read = async (tag) => {
    const s = await page.evaluate(() => {
      const g = window.__RAW_GPU__ || {}, b = window.map.getBounds();
      const f = g.ratingBandFade || {};
      return { z: +window.map.getZoom().toFixed(2), live: +(b.getEast() - b.getWest()).toFixed(3),
        telemetry: (typeof f.span === 'number') ? +f.span.toFixed(3) : null,
        bandMult: f.bandMult, spanFade: f.spanFade, wash: f.washStrength };
    });
    const stale = s.telemetry === null ? '?' : (Math.abs(s.telemetry - s.live) > 0.05 ? 'STALE' : 'LIVE');
    log(`${tag}: z=${s.z} liveSpan=${s.live} telemetrySpan=${s.telemetry} [${stale}] bandMult=${s.bandMult} spanFade=${s.spanFade} wash=${s.wash}`);
    return s;
  };

  await page.evaluate(() => window.map.jumpTo({ center: [-79.35, 26.85], zoom: 10 }));
  await page.waitForTimeout(9000);
  await read('baseline z10');

  // LEG A — jumpTo straight to z6
  await page.evaluate(() => window.map.jumpTo({ center: [-79.35, 26.85], zoom: 6 }));
  await page.waitForTimeout(10000);
  await page.evaluate(() => window.map.triggerRepaint());
  await page.waitForTimeout(2000);
  await read('leg A jumpTo z6');

  // back to z10 by jumpTo, then LEG B — the same descent by REAL wheel notches
  await page.evaluate(() => window.map.jumpTo({ center: [-79.35, 26.85], zoom: 10 }));
  await page.waitForTimeout(9000);
  await read('reset z10');
  await page.mouse.move(640, 400);
  for (let i = 0; i < 34; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(160); }
  await page.waitForTimeout(10000);
  await read('leg B wheel  ');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
