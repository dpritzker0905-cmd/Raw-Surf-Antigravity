/**
 * zoomlab.js — real-gesture marine zoom/pan forensics harness (Playwright/CDP).
 * Trusted wheel/drag input, full-rate rAF, per-frame pixel+flag trace synchronized
 * on map.on('render'), video proof. Usage:
 *   node zoomlab.js <scenario> <outdir>
 * Scenarios: zoomout_ratingoff | zoomout_ratingon | pan_coverage
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join('C:', 'Users', 'dprit', 'Raw-Surf', 'frontend', 'node_modules', '@playwright', 'test'));

const BASE = process.env.ZL_BASE || 'http://localhost:3009';
const scenario = process.argv[2] || 'zoomout_ratingoff';
const outdir = process.argv[3] || path.join(__dirname, 'zoomlab-out');
fs.mkdirSync(outdir, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: outdir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();

  // Disable the service worker (E2E house pattern — always test the fresh bundle).
  await page.addInitScript(() => {
    const mockSW = {
      register: () => new Promise(() => {}),
      ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]),
    };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
  });

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });

  log('goto /map');
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 60000 });
  log('map + engine ready');
  // Dismiss the cookie banner like a user would (it overlays the lower map).
  try {
    await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
      if (d) d.click();
    });
  } catch (e) {}

  // Enable the waves layer via its real button.
  const findWaves = () => {
    const all = Array.from(document.querySelectorAll('button'));
    let b = all.find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
    if (!b) {
      // panel may be collapsed — click any expander that mentions weather controls
      const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')) &&
        !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
      if (exp) exp.click();
    }
    return b || null;
  };
  await page.waitForFunction(`(${findWaves.toString()})() !== null`, null, { timeout: 45000 });
  const toggled = await page.evaluate(`(() => {
    const b = (${findWaves.toString()})();
    if (!b) return 'NOT FOUND';
    if (b.getAttribute('aria-pressed') !== 'true') b.click();
    return 'pressed(before-click-state)=' + b.getAttribute('aria-pressed');
  })()`);
  log('waves toggle: ' + toggled);
  // The activation lane alone may not fetch — a camera move triggers the moveend lane.
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.map.jumpTo({ center: [-80.2, 28.33], zoom: 9 }); });
  await page.waitForFunction(() => {
    const e = window.__MARINE_ENGINE__;
    return e && e._waveData && e._waveData.bounds;
  }, null, { timeout: 90000 });
  log('waves resident committed');

  if (scenario === 'zoomout_ratingon') {
    await page.evaluate(() => {
      const rb = Array.from(document.querySelectorAll('button')).find((b) =>
        ((b.getAttribute('aria-label') || '') + (b.title || '')).includes('Surf Rating overlay'));
      if (rb && rb.getAttribute('aria-pressed') !== 'true') rb.click();
    });
    await page.waitForFunction(() => {
      const e = window.__MARINE_ENGINE__;
      return e && e._waveData && e._waveData.waveGrid && e._waveData.waveGrid.ratingMode === true;
    }, null, { timeout: 90000 });
    log('rated resident committed');
  }

  // Camera start: coastal FL at z9 (React-controlled camera applies within a frame at full rAF).
  await page.evaluate(() => { window.map.jumpTo({ center: [-80.2, 28.33], zoom: 9 }); });
  await page.waitForFunction(() => Math.abs(window.map.getZoom() - 9) < 0.01 &&
    Math.abs(window.map.getCenter().lng - (-80.2)) < 0.01, null, { timeout: 20000 });
  // Let a fresh resident commit for this camera (moveend debounce + fetch).
  await page.waitForTimeout(6000);

  // In-page per-frame trace, synchronized on map render events.
  await page.evaluate(() => {
    const m = window.map, eng = window.__MARINE_ENGINE__;
    const src = m.getCanvas();
    const W = 160, H = Math.round(160 * src.height / src.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const T = (window.__ZT__ = { frames: [], W, H, t0: performance.now() });
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    m.on('render', () => {
      try {
        const t = performance.now() - T.t0;
        ctx.drawImage(src, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        let sumL = 0, sumR = 0, sumG = 0, sumB = 0, n = 0, spk = 0;
        // 8x5 coverage cells for the pan scenario
        const cell = new Array(40).fill(0);
        for (let y = 4; y < H - 4; y += 2) {
          for (let x = 4; x < W - 4; x += 2) {
            const i = (y * W + x) * 4;
            const L = lum(d, i);
            sumL += L; sumR += d[i]; sumG += d[i + 1]; sumB += d[i + 2]; n++;
            const nb = (lum(d, i - 16) + lum(d, i + 16) + lum(d, i - 4 * W * 4) + lum(d, i + 4 * W * 4)) / 4;
            if (Math.abs(L - nb) > 12) {
              spk++;
              const cx = Math.min(7, Math.floor(x / W * 8)), cy = Math.min(4, Math.floor(y / H * 5));
              cell[cy * 8 + cx]++;
            }
          }
        }
        const g = window.__RAW_GPU__ || {};
        const wd = eng._waveData;
        const rbf = g.ratingBandFade || {};
        T.frames.push({
          t: Math.round(t), z: +m.getZoom().toFixed(3),
          L: +(sumL / n).toFixed(1), R: +(sumR / n).toFixed(1), G: +(sumG / n).toFixed(1), B: +(sumB / n).toFixed(1),
          spk: +(spk / n * 100).toFixed(2),
          cells: cell.map((c) => (c > 2 ? 1 : 0)).join(''),
          resid: wd && wd.bounds ? `${wd.bounds.west},${wd.bounds.south},${wd.bounds.east},${wd.bounds.north}` : null,
          cols: wd && wd.waveGrid && wd.waveGrid.cols,
          rating: !!(wd && wd.waveGrid && wd.waveGrid.ratingMode),
          pend: !!eng._pendingDowngrade,
          cf: g.coarseFade, band: rbf.bandMult, wash: rbf.washStrength, span: rbf.span,
          noTruth: g.washNoTruthDamp, halo: g.haloDamp, undamp: g.bandWashUndamp,
          rf: g.crestRingFill && g.crestRingFill.enabled,
          blend: g.blendBoth && g.blendBoth.engaged,
          ovl: g.overlayMask && g.overlayMask.reason,
          bridge: (window.__MARINE_ZOOMOUT_BRIDGE__ || {}).count || 0,
          drawCalls: g.drawCallsPerFrame,
          hm: g.opacity && g.opacity.heatmap, mult: g.opacity && g.opacity.mult,
          w0: g.washPreDamp, wE: g.washEff,
          mkC: g.maskId && g.maskId.cachedBound, mkB: g.maskId && g.maskId.mb, mkD: g.maskId && g.maskId.dims,
          realign: g.bridgeMultRealign,
          ndWhy: (window.__MARINE_NO_DOWNGRADE__ && window.__MARINE_NO_DOWNGRADE__.last && window.__MARINE_NO_DOWNGRADE__.last.why) || null,
          ndCount: (window.__MARINE_NO_DOWNGRADE__ && window.__MARINE_NO_DOWNGRADE__.count) || 0,
        });
      } catch (e) { T.frames.push({ err: String(e && e.message).slice(0, 60) }); }
    });
  });
  log('trace installed');

  const cx = 640, cy = 400;
  await page.mouse.move(cx, cy);

  if (scenario.startsWith('zoomout')) {
    // Real wheel zoom-out: z9 -> ~z4 in a continuous stream, like a user rolling the wheel.
    for (let i = 0; i < 42; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(90);
    }
    log('wheel stream done, settling');
    await page.waitForTimeout(9000); // settle + commits + (possible) recovery
  } else if (scenario === 'pan_coverage') {
    // Zoom to mid-level, then drag-pan east repeatedly like a user exploring.
    await page.evaluate(() => window.map.jumpTo({ center: [-80.2, 28.33], zoom: 7 }));
    await page.waitForTimeout(5000);
    for (let p = 0; p < 4; p++) {
      await page.mouse.move(cx + 250, cy);
      await page.mouse.down();
      for (let s = 0; s < 10; s++) { await page.mouse.move(cx + 250 - (s + 1) * 50, cy, { steps: 2 }); await page.waitForTimeout(30); }
      await page.mouse.up();
      await page.waitForTimeout(2500);
    }
    await page.waitForTimeout(6000);
  }

  const trace = await page.evaluate(() => window.__ZT__);
  const zoomNow = await page.evaluate(() => window.map.getZoom());
  fs.writeFileSync(path.join(outdir, `trace_${scenario}.json`), JSON.stringify({ scenario, zoomNow, consoleErrors: consoleErrors.slice(0, 20), ...trace }));
  log(`trace saved: ${trace.frames.length} frames, final zoom ${zoomNow.toFixed(2)}`);

  await context.close(); // flushes video
  const vids = fs.readdirSync(outdir).filter((f) => f.endsWith('.webm'));
  log('videos: ' + vids.join(', '));
  await browser.close();
}

function log(s) { console.log(`[zoomlab] ${s}`); }
main().catch((e) => { console.error('[zoomlab] FATAL', e); process.exit(1); });
