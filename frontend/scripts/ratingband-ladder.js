/**
 * ratingband-ladder.js — measure the rating band against the heatmap wash across zoom.
 *
 * OWNER REPORT: "the rating band is being layered underneath the marine heatmap."
 *
 * WHAT THE CODE SAYS (read before measuring, so the measurement can refute it).
 * The band is NOT a separate MapLibre layer stacked under the heatmap — both are passes of the same
 * WebGL engine, and the coarse wash is drawn FIRST (`_drawCoarseBasePass`, WebGLMarineEngine.js:1433)
 * with the rating pass on top (:2135). Draw order is therefore already band-over-wash, and no
 * reordering could change what is seen. What CAN put the wash visually on top is ALPHA:
 *
 *   resolveRatingBandFade (marineEngineDecisions.js:106)
 *     spanFade    = 1 -> 0 by smoothstep between LO (6.0) and HI (9.5) degrees of viewport longitude
 *     bandMult    = washEngaged ? fade : max(0.3, fade)      // band opacity multiplier
 *     washStrength= base + (1-base)*(1-fade)                 // wash goes to FULL as the band leaves
 *
 * So at viewport span >= 9.5 deg the band is multiplied by ZERO while the wash is driven to 1.0.
 * That is a designed cross-fade ("the ribbon trades places"), and it is indistinguishable from
 * "the band is underneath the heatmap" from the outside. The open question this run answers is
 * WHICH regime the owner is in: the designed dead zone above 9.5 deg, or a genuine defect below it
 * where the band should be at full strength and is not.
 *
 * Reported per stop: viewport span, spanFade/covFade/fade, bandMult, washStrength, whether a RATED
 * grid is even resident, and the pixels on a coastal transect. A bandMult of 0 while a rated grid
 * is resident is "a rated grid painted at alpha zero" — the condition df7a3d73 named and left open.
 *
 *   node scripts/ratingband-ladder.js <outdir>
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.RB_BASE || 'https://dev--rawsurf.netlify.app';
const THEME = process.env.RB_THEME || 'beach';
const outdir = process.argv[2] || path.join(__dirname, 'ratingband-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[ratingband] ' + m);

const CENTER = [-79.35, 26.85];
// z10 -> z4 walks viewport longitude span from ~0.7 deg to ~45 deg, straddling LO=6.0 and HI=9.5.
const STOPS = [10.0, 9.0, 8.4, 8.0, 7.5, 7.0, 6.6, 6.2, 6.0, 5.5, 5.0, 4.0];
// a coastal transect (SE Florida) — land -> 25 km offshore, where the ribbon lives
const TRANSECT = { id: 'FL-A', from: [-80.20, 26.60], to: [-79.85, 26.60] };

const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };

const findByText = (labels) => {
  const all = Array.from(document.querySelectorAll('button'));
  for (const want of labels) {
    const b = all.find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === want);
    if (b) return b;
  }
  return null;
};
// The Surf Rating control is a state-labelled chip, and exact-match on its trimmed textContent
// FAILS (measured: the chip reader found "Surf Rating: OFF" by regex in the same frame where exact
// match returned null). Match the stem and read the state off the found element instead.
const findRating = () => Array.from(document.querySelectorAll('button'))
  .find((x) => /Surf Rating:/.test(x.textContent || '')) || null;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(({ u, theme }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', theme);
  }, { u: USER, theme: THEME });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
  const build = await page.evaluate(async () => {
    try { const r = await fetch('/service-worker.js', { cache: 'no-store' }); const t = await r.text();
      const m = t.match(/BUILD_VERSION\s*=\s*'([^']+)'/); return m ? m[1] : 'unknown'; } catch (e) { return '?'; }
  });
  log('build=' + build);

  await page.waitForFunction(`(${findByText.toString()})(['Waves']) !== null`, null, { timeout: 60000 });
  await page.evaluate(`(() => { const b = (${findByText.toString()})(['Waves']); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  log('waves painting');

  // Surf Rating is a labelled toggle whose text carries its own state — click only if OFF, and
  // VERIFY the label flipped rather than trusting the click (a silent no-op is a known failure of
  // this control: 83def648 "the Surf Rating toggle can no longer silently no-op").
  const before = await page.evaluate(`(() => { const b = (${findRating.toString()})(); return b ? b.textContent.trim() : null; })()`);
  await page.evaluate(`(() => { const b = (${findRating.toString()})(); if (b && /OFF/.test(b.textContent)) b.click(); })()`);
  await page.waitForTimeout(12000);
  const after = await page.evaluate(`(() => { const b = (${findRating.toString()})(); return b ? b.textContent.trim() : null; })()`);
  log(`surf rating toggle: "${before}" -> "${after}"`);
  const ratingOn = !!after && /ON/.test(after);
  if (!ratingOn) { log('*** RATING DID NOT ENGAGE — every band number below is VOID ***'); }

  const rows = [];
  for (const z of STOPS) {
    await page.evaluate(({ c, zz }) => window.map.jumpTo({ center: c, zoom: zz }), { c: CENTER, zz: z });
    await page.waitForTimeout(1500);
    try { await page.waitForFunction(() => window.map.isStyleLoaded() && window.map.loaded(), null, { timeout: 25000 }); } catch (e) {}
    await page.waitForTimeout(6500);
    await page.evaluate(() => window.map.triggerRepaint());
    await page.waitForTimeout(1200);

    const st = await page.evaluate(async ({ t }) => {
      const m = window.map, g = window.__RAW_GPU__ || {};
      await new Promise((res) => { const fn = () => { m.off('render', fn); res(); }; m.on('render', fn); m.triggerRepaint(); });
      const b = m.getBounds();
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
      const dpr = src.width / rect.width;
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const c2 = cv.getContext('2d', { willReadFrequently: true });
      c2.drawImage(src, 0, 0);
      const img = c2.getImageData(0, 0, cv.width, cv.height).data;
      const p0 = m.project(t.from), p1 = m.project(t.to);
      const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.max(2, Math.round(Math.hypot(dx, dy) * dpr));
      const rgb = [];
      for (let i = 0; i <= n; i++) {
        const px = Math.round((p0.x + dx * i / n) * dpr), py = Math.round((p0.y + dy * i / n) * dpr);
        if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) { rgb.push(null); continue; }
        const o = (py * cv.width + px) * 4;
        rgb.push([img[o], img[o + 1], img[o + 2]]);
      }
      return {
        z: +m.getZoom().toFixed(2),
        viewSpanLng: +(b.getEast() - b.getWest()).toFixed(3),
        ratingBandFade: g.ratingBandFade || null,
        blendBoth: g.blendBoth ? { engaged: g.blendBoth.engaged, baseModel: g.blendBoth.baseModel } : null,
        ribbon: g.ribbon || null,
        surfMode: g.surfMode || null,
        overlay: g.overlayMask ? { on: g.overlayMask.on, reason: g.overlayMask.reason } : null,
        gridLegend: (() => { const el = [...document.querySelectorAll('*')].find((x) => x.children.length === 0 && /km grid/.test(x.textContent || '')); return el ? el.textContent.trim() : null; })(),
        ratingChip: (() => { const el = [...document.querySelectorAll('button')].find((x) => /Surf Rating:/.test(x.textContent || '')); return el ? el.textContent.trim() : null; })(),
        n, rgb,
      };
    }, { t: TRANSECT });

    await page.screenshot({ path: path.join(outdir, `RB_z${z.toFixed(2)}.png`) });
    rows.push({ targetZ: z, ...st });
    const f = st.ratingBandFade;
    log(`z${z.toFixed(2)} span=${st.viewSpanLng}  ` +
      (f ? `spanFade=${f.spanFade?.toFixed(3)} covFade=${f.covFade?.toFixed(3)} fade=${f.fade?.toFixed(3)} bandMult=${f.bandMult?.toFixed(3)} wash=${f.washStrength === null ? 'null' : f.washStrength.toFixed(3)}`
         : 'ratingBandFade=ABSENT (band code path did not run)') +
      `  chip="${st.ratingChip}"  grid="${st.gridLegend}"`);
  }

  fs.writeFileSync(path.join(outdir, 'ratingband-raw.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, build, theme: THEME,
      center: CENTER, transect: TRANSECT, ratingEngaged: ratingOn, rows }));
  log('written: ' + path.join(outdir, 'ratingband-raw.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
