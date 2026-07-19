/**
 * zoomlab.js — real-gesture marine zoom/pan forensics harness (Playwright/CDP).
 * Trusted wheel/drag input, full-rate rAF, per-frame pixel+flag trace synchronized
 * on map.on('render'), video proof. Usage:
 *   node zoomlab.js <scenario> <outdir>
 * Scenarios: zoomout_ratingoff | zoomout_ratingon | pan_coverage
 */
const path = require('path');
const fs = require('fs');
// Portable resolve (2026-07-18, CI): plain require works when run from frontend/ (or with
// NODE_PATH set); the explicit node_modules fallback covers running from the repo root locally.
let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch (e) {
  ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test')));
}

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

  // ZL_FLAGS: comma-separated window globals set true before app boot (kill-switch A/B runs),
  // e.g. ZL_FLAGS="__RAW_DISABLE_FLAT_HEATMAP_OPACITY__,__RAW_DISABLE_SHARPEN_OPACITY_EASE__".
  if (process.env.ZL_FLAGS) {
    const flags = process.env.ZL_FLAGS.split(',').map((s) => s.trim()).filter(Boolean);
    await page.addInitScript((fl) => { for (const f of fl) window[f] = true; }, flags);
    log('ZL_FLAGS: ' + flags.join(', '));
  }

  // ZL_THEME: boot the app in a specific theme (light|dark|beach) by seeding the ThemeContext
  // localStorage key pre-boot — per-theme battery runs (2026-07-18: light-mode crest report).
  if (process.env.ZL_THEME) {
    const theme = process.env.ZL_THEME.trim();
    await page.addInitScript((t) => { try { localStorage.setItem('raw-surf-theme', t); } catch (e) {} }, theme);
    log('ZL_THEME: ' + theme);
  }

  // ZL_SURF=1: boot with the Surf-Rating flag ON (localStorage __SURF_MODE__, the same key the
  // toggle persists) — rating-flavor battery legs (ARBITER Phase B soak, 2026-07-18 EVE-2).
  if (process.env.ZL_SURF === '1') {
    await page.addInitScript(() => { try { localStorage.setItem('__SURF_MODE__', 'true'); } catch (e) {} });
    log('ZL_SURF: rating flag ON');
  }

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
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400)); });

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

  // ZL_MODEL=EURO|ICON: switch the forecast model post-activation (ARBITER Phase B soak — the
  // non-GFS ladders exercise the model_switch rule + the coarse-only-ceiling guard branches).
  if (process.env.ZL_MODEL && process.env.ZL_MODEL !== 'GFS') {
    const want = process.env.ZL_MODEL.trim().toUpperCase();
    const clicked = await page.evaluate((m) => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => (x.textContent || '').trim() === m);
      if (!b) return 'MODEL BUTTON NOT FOUND';
      b.click(); return 'clicked';
    }, want);
    log(`ZL_MODEL ${want}: ${clicked}`);
    try {
      await page.waitForFunction((m) => {
        const e = window.__MARINE_ENGINE__, wd = e && e._waveData;
        return wd && wd.waveGrid && (wd.waveGrid.__sourceModel || 'GFS') === m;
      }, want, { timeout: 60000 });
      log(`ZL_MODEL ${want}: resident committed`);
    } catch (e) {
      log(`ZL_MODEL ${want}: resident WAIT TIMEOUT (continuing — trace will show the state)`);
    }
    await page.waitForTimeout(4000);
  }

  if (scenario.endsWith('_ratingon')) {
    const rbState = await page.evaluate(() => {
      const rb = Array.from(document.querySelectorAll('button')).find((b) =>
        ((b.getAttribute('aria-label') || '') + (b.title || '')).includes('Surf Rating overlay'));
      if (!rb) return 'BUTTON NOT FOUND';
      const pre = rb.getAttribute('aria-pressed');
      if (pre !== 'true') rb.click();
      return 'pre-click aria-pressed=' + pre;
    });
    log('rating toggle: ' + rbState);
    try {
      await page.waitForFunction(() => {
        const e = window.__MARINE_ENGINE__;
        return e && e._waveData && e._waveData.waveGrid && e._waveData.waveGrid.ratingMode === true;
      }, null, { timeout: 90000 });
    } catch (err) {
      // Diagnose instead of dying blind: engine + flag + fetch-lane state at timeout.
      const diag = await page.evaluate(() => {
        const e = window.__MARINE_ENGINE__, wd = e && e._waveData;
        return JSON.stringify({
          surfFlag: window.__SURF_MODE__,
          rating: !!(wd && wd.waveGrid && wd.waveGrid.ratingMode),
          cols: wd && wd.waveGrid && wd.waveGrid.cols,
          debouncing: window.__MARINE_FETCH_DEBOUNCING__ === true,
          ndLast: window.__MARINE_NO_DOWNGRADE__ && window.__MARINE_NO_DOWNGRADE__.last,
        });
      }).catch((e2) => 'diag failed: ' + e2);
      log('RATING WAIT TIMEOUT — diag: ' + diag);
      log('console errors: ' + JSON.stringify(consoleErrors.slice(0, 8)));
      throw err;
    }
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
    // ANIM-DENSITY COLUMNS (2026-07-18 testing-system upgrade): per-frame 40-column profile of
    // frame-to-frame pixel change — animation coverage as DATA. The verdict engine detects
    // vertical dead bands (the fencepost stripe class) and TRANSIENT bands (the zoom-out flash)
    // that single screenshots and whole-frame luminance both miss.
    let prevD = null;
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
        // 40-column animation profile: mean |Δ| vs the previous sampled frame, per column band.
        const NCOL = 40;
        const animCols = new Array(NCOL).fill(0);
        if (prevD) {
          const colN = new Array(NCOL).fill(0);
          for (let y = 4; y < H - 4; y += 2) {
            for (let x = 4; x < W - 4; x += 2) {
              const i = (y * W + x) * 4;
              const dd = Math.abs(d[i] - prevD[i]) + Math.abs(d[i + 1] - prevD[i + 1]) + Math.abs(d[i + 2] - prevD[i + 2]);
              const cx = Math.min(NCOL - 1, Math.floor(x / W * NCOL));
              animCols[cx] += dd; colN[cx]++;
            }
          }
          for (let c = 0; c < NCOL; c++) animCols[c] = +(animCols[c] / Math.max(1, colN[c])).toFixed(1);
        }
        prevD = d.slice(0);
        const g = window.__RAW_GPU__ || {};
        const wd = eng._waveData;
        const rbf = g.ratingBandFade || {};
        T.frames.push({
          anim: animCols,
          t: Math.round(t), z: +m.getZoom().toFixed(3),
          L: +(sumL / n).toFixed(1), R: +(sumR / n).toFixed(1), G: +(sumG / n).toFixed(1), B: +(sumB / n).toFixed(1),
          spk: +(spk / n * 100).toFixed(2),
          cells: cell.map((c) => (c > 2 ? 1 : 0)).join(''),
          resid: wd && wd.bounds ? `${wd.bounds.west},${wd.bounds.south},${wd.bounds.east},${wd.bounds.north}` : null,
          cols: wd && wd.waveGrid && wd.waveGrid.cols,
          lay: wd && wd.waveGrid && (wd.waveGrid.__componentLayer || 'waves'),
          rating: !!(wd && wd.waveGrid && wd.waveGrid.ratingMode),
          pend: !!eng._pendingDowngrade,
          cf: g.coarseFade, band: rbf.bandMult, wash: rbf.washStrength, span: rbf.span,
          covF: rbf.covFrac, covFd: rbf.covFade,
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
          // ARBITER PHASE B shadow tallies: [decisions, disagreements] — battery-wide agreement data.
          arb: (window.__RAW_ARBITER_SHADOW__)
            ? [window.__RAW_ARBITER_SHADOW__.n, window.__RAW_ARBITER_SHADOW__.disagree] : null,
        });
      } catch (e) { T.frames.push({ err: String(e && e.message).slice(0, 60) }); }
    });

    // WATER-COLUMN GROUND TRUTH (2026-07-18 EVE-2): the DEAD_BAND detectors flagged the FLORIDA
    // PENINSULA as a persistent dead band whenever the staircase settled at mid zoom — land never
    // animates, and the column profile alone cannot tell land from a dead marine band (that false
    // positive spent a whole forensic arc as "wrapped-copy particles" / "gulf-edge ring" before
    // probeMaskGPU exonerated geography). Every 2 s, probe the ENGINE'S OWN mask (base+overlay,
    // the same selection the shader renders) at 5 rows × 40 column centers and record per-column
    // water fraction. zoomlab-verdict excludes mostly-land columns from dead-band claims.
    T.water = [];
    const probeWater = () => {
      try {
        const e2 = window.__MARINE_ENGINE__;
        if (!e2 || typeof e2.probeMaskGPU !== 'function' || !m || !m.unproject) return;
        const NCOL = 40, rows = [0.15, 0.3, 0.5, 0.7, 0.85];
        const cont = m.getContainer();
        const cssW = cont.clientWidth, cssH = cont.clientHeight;
        if (!cssW || !cssH) return;
        const pts = [];
        for (let c = 0; c < NCOL; c++) {
          for (const r of rows) {
            const ll = m.unproject([(c + 0.5) / NCOL * cssW, r * cssH]);
            pts.push({ lng: ll.lng, lat: ll.lat });
          }
        }
        const res = e2.probeMaskGPU(pts);
        if (!res || !Array.isArray(res)) return;
        // Per-column water fraction over the points the engine could actually answer (resident
        // mask, overlay, or the world coarse-base fallback). A column with NO answerable points
        // records -1 = UNKNOWN — the verdict must treat unknown as WATER (a dead band there is
        // still a finding; never exclude on ignorance).
        const water = new Array(NCOL).fill(0), known = new Array(NCOL).fill(0);
        for (let i = 0; i < res.length; i++) {
          const c = Math.floor(i / rows.length);
          const eff = res[i] && res[i].effective;
          if (eff != null) { known[c]++; if (eff >= 128) water[c]++; }
        }
        T.water.push({
          t: Math.round(performance.now() - T.t0),
          z: +m.getZoom().toFixed(3),
          w: water.map((f, c) => known[c] ? +(f / known[c]).toFixed(2) : -1),
        });
      } catch (err) { /* ground truth is best-effort; the verdict falls back to legacy behavior */ }
    };
    setInterval(probeWater, 2000);
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
  } else if (scenario === 'staircase') {
    // Notch-by-notch zoom-out with settles: profiles the SETTLED luminance per zoom step —
    // finds brightness staircases (binary damp verdicts, resident-regime swaps) that continuous
    // gestures smear past. One wheel notch ≈ 0.18 z, 2.5 s settle each, z9 → ~z3.5.
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(2500);
    }
    await page.waitForTimeout(6000);
  } else if (scenario.startsWith('staircase_full')) {
    // FULL-SPAN settled ladder (2026-07-17, user: "heatmap + animations clear/dim at z11.51;
    // the brightness test needs to span every zoom"): notch-by-notch IN z9→~z14 first (the
    // close-zoom band the original staircase never touched, both gesture directions across it),
    // then OUT ~z14→z2. Settled L + spk + full flag row per notch, same trace as staircase.
    for (let i = 0; i < 28; i++) {           // IN: z9 → ~z14
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(2200);
    }
    await page.waitForTimeout(5000);
    log('zoom-in leg done at z=' + (await page.evaluate(() => +window.map.getZoom().toFixed(2))));
    for (let i = 0; i < 68; i++) {           // OUT: ~z14 → ~z2
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(2200);
    }
    await page.waitForTimeout(6000);
  } else if (scenario === 'layers') {
    // LAYER-INTERACTION forensics: cycle the marine component layers like a user exploring, then
    // flip the wind overlay on/off — per-frame trace catches transition clears/steps/blank frames.
    // Note the blend wash requires same-layer base parity, so each switch opens a window with no
    // wash until the new layer's coarse-global commits — measure how it reads.
    await page.evaluate(() => window.map.jumpTo({ center: [-80.2, 28.33], zoom: 7 }));
    await page.waitForTimeout(6000);
    const clickLayer = (name) => page.evaluate((n) => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === n);
      if (b) { b.click(); return true; }
      return false;
    }, name);
    for (const name of ['Swell', 'Swell 2', 'Wind Waves', 'Waves', 'Wind', 'Wind']) {
      const ok = await clickLayer(name);
      log(`toggle ${name}: ${ok}`);
      await page.waitForTimeout(9000);
    }
  } else if (scenario === 'alllayers') {
    // ALL-LAYERS AUDIT (2026-07-16 user: Precip/Satellite/Fog/Pressure/Air Temp/Water Temp not
    // painting): toggle every weather layer; per layer record network activity, pixel change vs
    // the pre-toggle frame, and console errors — classifies dead layers by failure mode.
    await page.evaluate(() => window.map.jumpTo({ center: [-80.2, 28.33], zoom: 7 }));
    await page.waitForTimeout(5000);
    const reqLog = [];
    page.on('request', (r) => { const u = r.url(); if (!/localhost:3009\/static|hot-update|ne_\d+m|fonts|basemaps|\.png$|openfreemap|sentry/i.test(u)) reqLog.push(u.slice(0, 140)); });
    const snapshotL = () => page.evaluate(() => {
      const src = window.map.getCanvas();
      const cv = document.createElement('canvas'); cv.width = 160; cv.height = 100;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      return new Promise((res) => {
        const fn = () => { window.map.off('render', fn); ctx.drawImage(src, 0, 0, 160, 100); const d = ctx.getImageData(0, 0, 160, 100).data; let s = 0; for (let i = 0; i < d.length; i += 16) s += 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; res(+(s / (d.length/16)).toFixed(1)); };
        window.map.on('render', fn); window.map.triggerRepaint();
      });
    });
    const results = {};
    const clickBtn = (n) => page.evaluate((name) => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === name);
      if (b) { b.click(); return true; } return false;
    }, n);
    await clickBtn('Waves'); // marine OFF so other layers read clean
    await page.waitForTimeout(2000);
    for (const name of ['Precip', 'Radar', 'Satellite', 'Fog', 'Pressure', 'Air Temp', 'Water Temp', 'Clouds', 'Wind']) {
      const before = await snapshotL();
      const req0 = reqLog.length;
      const found = await clickBtn(name);
      await page.waitForTimeout(11000);
      const after = await snapshotL();
      const reqs = reqLog.slice(req0);
      results[name] = { found, dL: +(after - before).toFixed(1), nReq: reqs.length, reqSample: reqs.slice(0, 3) };
      await clickBtn(name);   // toggle back off
      await page.waitForTimeout(2500);
    }
    fs.writeFileSync(path.join(outdir, 'alllayers_results.json'), JSON.stringify({ results, consoleErrors: consoleErrors.slice(0, 25) }, null, 1));
    log('alllayers results saved');
  } else if (scenario === 'scrub') {
    // SCRUB BATTERY (ARBITER Phase B soak, 2026-07-18 EVE-2): drive the forecast timeline via
    // the ForecastWheel's KEYBOARD contract (role="slider", arrows ±1 — the a11y house pattern
    // doubling as the test hook). Exercises hour_change commits, scrub-settle verification, and
    // the series lanes at a settled coastal camera. Forward in bursts, settle, then Home back.
    await page.evaluate(() => window.map.jumpTo({ center: [-80.2, 28.33], zoom: 7.2 }));
    await page.waitForTimeout(6000);
    const wheelFocused = await page.evaluate(() => {
      const w = document.querySelector('[role="slider"][aria-label*="Forecast timeline"]');
      if (!w) return false;
      w.focus(); return document.activeElement === w;
    });
    log('scrub wheel focused: ' + wheelFocused);
    if (wheelFocused) {
      for (let burst = 0; burst < 5; burst++) {
        for (let k = 0; k < 6; k++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(160); }
        await page.waitForTimeout(5000);   // settle: scrub-settle verification + series commits
      }
      await page.keyboard.press('Home');   // jump back to now
      await page.waitForTimeout(6000);
    }
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
  // ARBITER Phase B soak: persist the shadow tallies + full divergence events (the forensic ring
  // dies with the browser; the per-frame arb:[n,disagree] locates WHEN, this preserves WHAT).
  const arbShadow = await page.evaluate(() => ({
    tallies: window.__RAW_ARBITER_SHADOW__ || null,
    diverge: window.__RAW_FORENSIC__
      ? window.__RAW_FORENSIC__.dump().events.filter((e) => e.type === 'arb_shadow_diverge') : [],
  }));
  fs.writeFileSync(path.join(outdir, `trace_${scenario}.json`), JSON.stringify({ scenario, zoomNow, consoleErrors: consoleErrors.slice(0, 20), arbShadow, ...trace }));
  log(`trace saved: ${trace.frames.length} frames, final zoom ${zoomNow.toFixed(2)}`);

  await context.close(); // flushes video
  const vids = fs.readdirSync(outdir).filter((f) => f.endsWith('.webm'));
  log('videos: ' + vids.join(', '));
  await browser.close();
}

function log(s) { console.log(`[zoomlab] ${s}`); }
main().catch((e) => { console.error('[zoomlab] FATAL', e); process.exit(1); });
