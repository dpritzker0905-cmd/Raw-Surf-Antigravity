/**
 * reassert-gate-blank-ab.js — did the shipped gate change (1200 -> 400) blank the marine field?
 *
 * WHY THIS RUNS AHEAD OF THE RESIDUAL WORK. On the CURRENT deployed build (`7f2c6f22`, which
 * contains the gate-400 fix) the marine field does not paint at Madeira z9.30: six basemap-confirmed
 * water points, G=0, across four page loads and repeated camera nudges, in `midcarve_replace`.
 * Earlier today, on the PRE-fix build, the identical harness returned 48/48 rays twice. A blank field
 * on a just-shipped, already-deployed change outranks a 10-bearing shoreline residual.
 *
 * WHY THE GATE IS A PLAUSIBLE CAUSE. `94072098` states coverage-REPLACE is "SAFE only with the
 * re-assert keeping islands masked". The fix disables the re-assert at exactly the viewport-overlay
 * density (~850 px/deg) where `midcarve_replace` / coverage-REPLACE operate. The concurrent session
 * verified the ABACO FLOODING direction survives (9.4% -> 0%) — a blank field is the OPPOSITE
 * failure and that check cannot see it.
 *
 * THE LEVER IS THE GATE ITSELF, so this is one variable:
 *   gate_400_shipped  : no flags        -> re-assert OFF at 850 (today's shipped behaviour)
 *   gate_1200_prefix  : MAX_DENSITY 1200 -> re-assert ON at 850 (the pre-fix behaviour)
 * If the field paints under 1200 and not under 400, the gate change caused the blank. If it is blank
 * under BOTH, this is a transient (fresh-deploy cache purge, or the known coverage-arrival race) and
 * is NOT attributable to the fix — which is the outcome that protects the shipped change from a
 * false accusation.
 *
 * METRIC — deliberately NOT coast-detection based. Sample a grid of screen points across the
 * viewport, keep only those the BASEMAP calls water, and report the fraction carrying field
 * (G >= 40) plus mean G. Over forced-red water G is 0 without field and rises with it. This asks
 * only "is the field painting", which is the question, and cannot be voided by a coast detector.
 *
 * CONTROLS:
 *   1. LEVER TOOK: islandReassert.applied must be FALSE under 400 and TRUE under 1200 (at ~850).
 *      If both legs report the same state the lever did nothing and the run is VOID, not negative.
 *   2. WATER POINTS: every leg must find water points to sample, or the metric is meaningless.
 *   3. REPLICATES: 3 per leg, because the blank has been intermittent across the session.
 *   4. Both legs get the SAME nudge sequence, so neither is given more chance to settle.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'reassert-gate-blank-ab-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[gate] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const TARGET = { center: [-16.92, 32.74], z: 9.30 };
const FORCED_WATER = '#ff0000';
const REPLICATES = 3;
const LEGS = [
  { id: 'gate_400_shipped', flags: {} },
  { id: 'gate_1200_prefix', flags: { __RAW_ISLAND_REASSERT_MAX_DENSITY__: 1200 } },
];

// Viewport field coverage: fraction of BASEMAP-water sample points carrying field.
const fieldCoverage = () => {
  const m = window.map;
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
  let water = 0, withField = 0, sumG = 0, maxG = 0;
  for (let ix = 1; ix < 13; ix++) {
    for (let iy = 1; iy < 9; iy++) {
      const cx = rect.width * ix / 13, cy = rect.height * iy / 9;
      if ((document.elementFromPoint(cx, cy) || {}).tagName !== 'CANVAS') continue;
      let isW = false;
      try { isW = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {}
      if (!isW) continue;
      water++;
      const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
      if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) continue;
      const g = img[(Y * cv.width + X) * 4 + 1];
      sumG += g; if (g > maxG) maxG = g;
      if (g >= 40) withField++;
    }
  }
  const gpu = window.__RAW_GPU__ || {};
  return {
    waterPoints: water,
    fieldFrac: water ? +(withField / water).toFixed(3) : null,
    meanG: water ? +(sumG / water).toFixed(1) : null,
    maxG,
    reason: gpu.overlayMask ? gpu.overlayMask.reason : null,
    islandReassert: gpu.islandReassert || null,
    maskDelivered: gpu.maskDelivered || null,
    zoom: +m.getZoom().toFixed(2),
  };
};

async function runLeg(browser, leg, rep) {
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
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
  await page.waitForTimeout(15000);
  await page.evaluate((col) => {
    const m = window.map;
    for (const l of (m.getStyle().layers || [])) {
      if (l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id)) {
        try { m.setPaintProperty(l.id, 'fill-color', col); } catch (e) {}
      }
    }
  }, FORCED_WATER);
  await page.waitForTimeout(3000);
  const first = await page.evaluate(fieldCoverage);
  // IDENTICAL nudge sequence for both legs — neither is given more chance to settle.
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: [c[0] + 0.05, c[1]], zoom: z + 0.15 }), { c: TARGET.center, z: TARGET.z });
  await page.waitForTimeout(4000);
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
  await page.waitForTimeout(9000);
  const after = await page.evaluate(fieldCoverage);
  await ctx.close();
  return { leg: leg.id, rep, first, after };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const all = [];
  for (const leg of LEGS) {
    for (let rep = 1; rep <= REPLICATES; rep++) {
      const r = await runLeg(browser, leg, rep);
      all.push(r);
      const a = r.after, ir = a.islandReassert || {};
      log(`${leg.id.padEnd(17)} rep${rep}  reassert.applied=${String(ir.applied).padEnd(5)} dens=${ir.densityPxDeg}`
        + `  regime=${a.reason}  water=${a.waterPoints}  fieldFrac=${a.fieldFrac}  meanG=${a.meanG}  maxG=${a.maxG}`
        + `   (pre-nudge fieldFrac=${r.first.fieldFrac})`);
    }
  }
  await browser.close();

  const of = (id) => all.filter((r) => r.leg === id);
  const avg = (a) => (a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3) : null);
  const frac = (id) => avg(of(id).map((r) => r.after.fieldFrac).filter((x) => x !== null));
  const applied = (id) => [...new Set(of(id).map((r) => (r.after.islandReassert || {}).applied))];
  const waterOk = all.every((r) => r.after.waterPoints > 0);
  const leverTook = JSON.stringify(applied('gate_400_shipped')) !== JSON.stringify(applied('gate_1200_prefix'));

  log('');
  log('CONTROLS');
  log(`  1 lever took (applied differs)   : ${leverTook}   400 -> ${JSON.stringify(applied('gate_400_shipped'))}`
    + `   1200 -> ${JSON.stringify(applied('gate_1200_prefix'))}`);
  log(`  2 water points found in every leg: ${waterOk}  (${all.map((r) => r.after.waterPoints).join(',')})`);
  log('');
  log('RESULT — fraction of viewport water carrying field');
  log(`  gate 400 (shipped) : ${frac('gate_400_shipped')}   reps ${of('gate_400_shipped').map((r) => r.after.fieldFrac).join(', ')}`);
  log(`  gate 1200 (pre-fix): ${frac('gate_1200_prefix')}   reps ${of('gate_1200_prefix').map((r) => r.after.fieldFrac).join(', ')}`);
  log('');
  const f400 = frac('gate_400_shipped'), f1200 = frac('gate_1200_prefix');
  if (!waterOk) log('=> VOID: a leg found no water to sample.');
  else if (!leverTook) log('=> VOID: the gate lever did not change islandReassert.applied. Not a negative result.');
  else if (f400 === null || f1200 === null) log('=> incomplete');
  else if (f400 < 0.2 && f1200 > 0.6) {
    log('=> ⛔ REGRESSION ATTRIBUTED: the field paints under the PRE-FIX gate and is blank under the');
    log('   SHIPPED gate. The 1200 -> 400 change blanks the marine field at this camera. This needs to');
    log('   reach whoever shipped it before it goes further.');
  } else if (f400 < 0.2 && f1200 < 0.2) {
    log('=> NOT THE GATE: the field is blank under BOTH gates, so the shipped change is EXONERATED.');
    log('   The blank is environmental (fresh-deploy cache purge, or the coverage-arrival race).');
  } else if (f400 > 0.6 && f1200 > 0.6) {
    log('=> NO BLANK REPRODUCED: the field paints under both. The earlier blank was transient.');
  } else log('=> MIXED — read the per-replicate values above.');
  fs.writeFileSync(path.join(outdir, 'reassert-gate-blank-ab.json'), JSON.stringify({ base: BASE, all }, null, 1));
  log('written: ' + path.join(outdir, 'reassert-gate-blank-ab.json'));
})().catch((e) => { console.error(e); process.exit(1); });
