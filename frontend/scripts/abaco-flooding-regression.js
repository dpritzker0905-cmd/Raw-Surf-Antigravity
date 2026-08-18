/**
 * abaco-flooding-regression.js — did lowering the island-reassert gate 1200 -> 400 bring back the
 * flooding the re-assert exists to prevent?
 *
 * THE RISK I MAY HAVE INTRODUCED. `reassertNeLand` exists because the basemap's water polygons DROP
 * small islands, so overlayBasemapWaterOnMask's ocean-white pass floods them with heatmap — the
 * original forensics measured **Abaco 8-17% flooded at a z9 mask of 205 px/deg, re-assert -> 0**.
 * My fix narrows the gate to density < 400. That keeps 205 comfortably inside, ON PAPER. But the
 * density is a property of the resident mask tier at the CAMERA, and at Madeira it measured between
 * 1200 and 100000 rather than the ~850 I predicted. If Abaco's camera also lands on a dense tier,
 * the re-assert is now OFF there and the flooding is back — a regression of my own making.
 *
 * THE METRIC is the flooding itself, not the density, because the density cannot be read on the
 * deployed build (no engine handle) and the outcome is what matters:
 *     flooded % = share of basemap-LAND samples whose pixel looks more like the FIELD than like its
 *                 own bare-basemap colour at the same point.
 * Comparing each land pixel against ITS OWN waves-OFF colour is what makes this immune to the
 * basemap restyle that toggling Waves causes (a landuse reorder changes colour, but not TOWARD the
 * field's palette) — the same rule that found the worst bearings.
 *
 * LEGS (one page load each, lever set before the first frame):
 *   stock         gate 400 — the shipped fix. MUST be ~0% or I have regressed Abaco.
 *   reassert_off  the POSITIVE CONTROL. Must show flooding, or the metric is blind and a 0% from
 *                 the stock leg means nothing.
 *   gate_1200     the pre-fix gate, for reference.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AB_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'abaco-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[abaco] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
// Great Abaco + the cays; z9 is the zoom the original forensics used.
// 2026-08-17 second pass. The z9 cameras returned a NULL: all three legs within 1.8% of each other,
// so the re-assert is inert there even at the PRE-FIX gate — my change cannot have regressed them,
// but the protection was never exercised either. Density = mask_width / span, so the coarse regime
// the 205 px/deg forensics came from needs a WIDER span, i.e. a lower zoom. These add it.
const CAMERAS = [
  { id: 'bahamas_z6.5', center: [-77.40, 25.60], z: 6.5 },
  { id: 'bahamas_z7.5', center: [-77.20, 26.20], z: 7.5 },
  { id: 'abaco_z8.2', center: [-77.10, 26.40], z: 8.2 },
];
const LEGS = [
  { id: 'stock_gate400', flags: {} },
  { id: 'reassert_off_POSCTRL', flags: { __RAW_DISABLE_ISLAND_REASSERT__: true } },
  { id: 'gate_1200_prefix', flags: { __RAW_ISLAND_REASSERT_MAX_DENSITY__: 1200 } },
];

const sampleLand = ({ step }) => {
  const m = window.map;
  return new Promise((resolve) => {
    const fn = () => {
      m.off('render', fn);
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
      const dpr = src.width / rect.width;
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
      const img = c2.getImageData(0, 0, cv.width, cv.height).data;
      const waterIds = (m.getStyle().layers || [])
        .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
        .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
      const px = (cx, cy) => {
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
        const o = (Y * cv.width + X) * 4; return [img[o], img[o + 1], img[o + 2]];
      };
      const land = [], ocean = [];
      for (let x = 200; x <= 780; x += step) {
        for (let y = 120; y <= 720; y += step) {
          if ((document.elementFromPoint(x, y) || {}).tagName !== 'CANVAS') continue;
          let isWater = false;
          try { isWater = m.queryRenderedFeatures([x, y], { layers: waterIds }).length > 0; } catch (e) { continue; }
          const c = px(x, y); if (!c) continue;
          (isWater ? ocean : land).push({ x, y, c });
        }
      }
      resolve({ land, ocean });
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

async function runLeg(browser, leg, cam) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((flags) => {
    window.__DISABLE_WEBGL_GUARDRAIL__ = true;
    Object.assign(window, flags);
  }, leg.flags);
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
  const setWaves = (on) => page.evaluate((want) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && ((b.getAttribute('aria-pressed') === 'true') !== want)) b.click();
  }, on);

  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: cam.center, z: cam.z });
  await page.waitForTimeout(14000);
  const ON = await page.evaluate(sampleLand, { step: 12 });
  await page.screenshot({ path: path.join(outdir, `ABACO_${cam.id}_${leg.id}.png`) });
  const mode = await page.evaluate(() => (window.__RAW_GPU__.overlayMask || {}).reason);
  await setWaves(false); await page.waitForTimeout(7000);
  const OFF = await page.evaluate(sampleLand, { step: 12 });
  await ctx.close();

  const key = (p) => p.x + ',' + p.y;
  const offMap = new Map(OFF.land.map((p) => [key(p), p.c]));
  const d3 = (a, b) => (!a || !b) ? 0 : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  // field reference: open ocean in the ON frame, well away from land
  const oc = ON.ocean.map((p) => p.c);
  if (oc.length < 20) return { leg: leg.id, cam: cam.id, void: 'too few ocean samples', mode };
  const fieldRef = [0, 1, 2].map((k) => Math.round(oc.reduce((s, c) => s + c[k], 0) / oc.length));
  let n = 0, flooded = 0;
  for (const p of ON.land) {
    const base = offMap.get(key(p)); if (!base) continue;
    n++;
    if (d3(p.c, fieldRef) < d3(p.c, base)) flooded++;   // looks more like the field than like itself
  }
  return { leg: leg.id, cam: cam.id, mode, landSamples: n, oceanSamples: oc.length,
    floodedPct: n ? +(100 * flooded / n).toFixed(1) : null, fieldRef };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const rows = [];
  for (const cam of CAMERAS) {
    for (const leg of LEGS) {
      const r = await runLeg(browser, leg, cam);
      rows.push(r);
      log(`${cam.id.padEnd(16)} ${r.leg.padEnd(22)} mode=${String(r.mode).padEnd(16)} `
        + `land=${String(r.landSamples).padStart(4)} FLOODED=${r.floodedPct}%` + (r.void ? '  VOID: ' + r.void : ''));
    }
  }
  log('');
  for (const cam of CAMERAS) {
    const s = rows.find((r) => r.cam === cam.id && r.leg === 'stock_gate400');
    const c = rows.find((r) => r.cam === cam.id && r.leg === 'reassert_off_POSCTRL');
    if (!s || !c || s.floodedPct === null || c.floodedPct === null) { log(`${cam.id}: incomplete`); continue; }
    const controlWorks = c.floodedPct >= s.floodedPct + 3;
    log(`${cam.id}: stock ${s.floodedPct}%  vs  re-assert OFF ${c.floodedPct}%  -> `
      + (!controlWorks
        ? 'CONTROL DID NOT FLOOD — the metric cannot see flooding here, so the stock number proves NOTHING'
        : (s.floodedPct <= 2
          ? 'PROTECTION INTACT — the fix keeps the re-assert engaged here'
          : 'REGRESSION — the fix has disengaged the re-assert at this camera')));
  }
  fs.writeFileSync(path.join(outdir, 'abaco-flooding.json'), JSON.stringify({ base: BASE, cameras: CAMERAS, rows }, null, 1));
  log('written: ' + path.join(outdir, 'abaco-flooding.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
