/**
 * probe_vortex_visual_ab.js — SEE the vortex, at every zoom, with the fix OFF and ON.
 *
 * WHY. The Canaveral "low pressure type wave center" is a MOTION artifact: bilinear filtering
 * rotates the heading between two disagreeing cells, and the crests curl around the seam. No
 * settled-state number proves it gone — `__RAW_GPU__.anim.fineSeamFloor = 0.5` says the guard is
 * ARMED, not that the swirl stopped. The standing zoom-burst mandate (2026-07-19) exists for
 * exactly this: "settled-step ladders structurally cannot see mid-gesture clamping... an
 * average-of-settled-states instrument cannot find a transient failure."
 *
 * So this captures PIXELS: at every zoom rung, a burst of frames (so motion is visible across the
 * burst) plus video, run TWICE — once with __RAW_DISABLE_FINE_SEAM_FLOOR__ = true (the pre-fix
 * behaviour) and once with the fix live. Same camera, same hour, same layer: a true A/B where the
 * only variable is the guard.
 *
 * ⚠️⚠️ PORT 3009 (`frontend-verify`), NEVER 3001 (`frontend-live`) — 3001 is the server the preview
 * pane displays, and driving a headless ladder against it wedged the pane's renderer on
 * 2026-07-31 (javascript_tool timed out, navigate refused, full restart needed).
 *
 * Usage (from frontend/):
 *   node scripts/probe_vortex_visual_ab.js [outdir]
 * Env: VX_BASE (default http://localhost:3009) · VX_LAT/VX_LNG (default the cape) ·
 *      VX_ZOOMS · VX_MODEL/VX_LAYER · VX_BURST (frames per rung, default 4)
 */
const path = require('path');
const fs = require('fs');
let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch (e) {
  ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test')));
}

const BASE = process.env.VX_BASE || 'http://localhost:3009';
const LAT = Number(process.env.VX_LAT || 28.35);
const LNG = Number(process.env.VX_LNG || -80.25);
const ZOOMS = (process.env.VX_ZOOMS || '5,6,7,8,8.2,9,10').split(',').map(Number);
const MODEL = process.env.VX_MODEL || 'GFS';
const LAYER = process.env.VX_LAYER || 'Waves';
const BURST = Number(process.env.VX_BURST || 4);
const BURST_MS = Number(process.env.VX_BURST_MS || 450);
const outdir = process.argv[2] || path.join(__dirname, 'vortex-ab-out');
fs.mkdirSync(outdir, { recursive: true });

const log = (m) => process.stdout.write(m + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runArm(label, disableFix) {
  const dir = path.join(outdir, label);
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 780 },
    recordVideo: { dir, size: { width: 1100, height: 780 } },
  });
  const page = await context.newPage();
  if (disableFix) {
    await page.addInitScript(() => { window.__RAW_DISABLE_FINE_SEAM_FLOOR__ = true; });
  }
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 120000 });
  await sleep(5000);

  // Activate model + layer through the real UI controls.
  for (const t of [MODEL, LAYER]) {
    await page.evaluate((txt) => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => (x.textContent || '').trim() === txt);
      if (b) b.click();
    }, t);
    await sleep(1500);
  }

  const rows = [];
  for (const z of ZOOMS) {
    await page.evaluate(([la, ln, zz]) => window.map.jumpTo({ center: [ln, la], zoom: zz }),
      [LAT, LNG, z]);
    await page.waitForFunction((zz) => Math.abs(window.map.getZoom() - zz) < 0.01, z,
      { timeout: 20000 }).catch(() => {});
    // Let the grid land and the particles reach steady state before the burst.
    await sleep(6000);
    const state = await page.evaluate(() => {
      const G = window.__RAW_GPU__ || {}; const a = G.anim || {};
      const e = window.__MARINE_ENGINE__;
      const wg = e && e._waveData && e._waveData.waveGrid;
      const cellDeg = (wg && wg.cols > 1 && wg.bounds)
        ? +((wg.bounds.east - wg.bounds.west) / (wg.cols - 1)).toFixed(3) : null;
      return {
        zoom: a.zoom, cellDeg, dims: wg ? [wg.cols, wg.rows] : null,
        dirCoherenceMin: a.dirCoherenceMin, fineSeamFloor: a.fineSeamFloor,
        vortexEngaged: (G.vortexGate || {}).engaged,
      };
    });
    // BURST: consecutive frames so the motion (and any curl) is visible across them.
    for (let i = 0; i < BURST; i += 1) {
      const f = path.join(dir, `z${String(z).replace('.', '_')}_f${i}.png`);
      await page.screenshot({ path: f });
      await sleep(BURST_MS);
    }
    rows.push({ zoom: z, ...state });
    log(`  [${label}] z=${String(z).padEnd(5)} cellDeg=${state.cellDeg} `
      + `dims=${state.dims} coh=${state.dirCoherenceMin} seam=${state.fineSeamFloor} `
      + `vortexGate=${state.vortexEngaged}`);
  }

  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(rows, null, 1));
  await context.close();     // flushes the video
  await browser.close();
  return rows;
}

async function main() {
  log(`vortex visual A/B | ${BASE} | (${LAT},${LNG}) | ${MODEL}/${LAYER} | burst ${BURST}`);
  log('\n--- ARM A: fix DISABLED (__RAW_DISABLE_FINE_SEAM_FLOOR__=true) — the reported behaviour');
  const before = await runArm('before-fix-disabled', true);
  log('\n--- ARM B: fix LIVE (default)');
  const after = await runArm('after-fix-live', false);

  log('\n=== A/B STATE (the only variable is the guard) ===');
  log('  zoom  | cellDeg |   OFF: coh/seam    |    ON: coh/seam');
  for (let i = 0; i < before.length; i += 1) {
    const b = before[i]; const a = after[i] || {};
    log(`  ${String(b.zoom).padEnd(5)} | ${String(b.cellDeg).padEnd(7)} | `
      + `${String(b.dirCoherenceMin).padEnd(5)}/${String(b.fineSeamFloor).padEnd(5)}      | `
      + `${String(a.dirCoherenceMin).padEnd(5)}/${String(a.fineSeamFloor).padEnd(5)}`);
  }
  log(`\n  screenshots + video -> ${outdir}`);
  log('  (compare the same zoom across the two folders; video shows the motion)');
}

main().catch((e) => { log('FATAL ' + e.stack); process.exit(2); });
