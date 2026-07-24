/**
 * rectlab.js — forensics harness for the N-PACIFIC RECTANGLE (marine heatmap + crest particles
 * both blank in a lng/lat half-plane box). 2026-07-23.
 *
 * Method (objective, repeatable, no eyeballing):
 *   1. boot /map, enable Waves + model, jump to the repro camera, settle
 *   2. A/B PAINT MAP: capture the canvas with the marine layer ON, then OFF, then ON again;
 *      the per-pixel |delta| IS the marine paint footprint. Each sample carries its lng/lat
 *      (map.unproject), so the blank box edges are MEASURED, not eyeballed.
 *   3. probeMaskGPU lattice over the blank box + a painted control (mask CONTENT read-back)
 *   4. wave-texture GPU read-back on the same lattice (validity/height the shader actually sees)
 *   5. GL state at marine draw time (scissor / viewport / stencil / blend) + draw-call census
 *
 * Usage:  node rectlab.js <outdir>
 * Env: RL_BASE (default http://localhost:3007), RL_MODEL (EURO), RL_CENTER (-172.75,9.05),
 *      RL_ZOOM (4.67), RL_FLAGS (comma-separated window globals set true pre-boot),
 *      RL_LABEL (tag written into report.json)
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.RL_BASE || 'http://localhost:3007';
const MODEL = (process.env.RL_MODEL || 'EURO').trim().toUpperCase();
const CENTER = (process.env.RL_CENTER || '-172.75,9.05').split(',').map(Number);
const ZOOM = Number(process.env.RL_ZOOM || 4.67);
const LABEL = process.env.RL_LABEL || 'baseline';
const outdir = process.argv[2] || path.join(__dirname, 'rectlab-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => { const s = `[rectlab] ${m}`; console.log(s); fs.appendFileSync(path.join(outdir, 'log.txt'), s + '\n'); };

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  if (process.env.RL_FLAGS) {
    const flags = process.env.RL_FLAGS.split(',').map((s) => s.trim()).filter(Boolean);
    await page.addInitScript((fl) => { for (const f of fl) window[f] = true; }, flags);
    log('RL_FLAGS: ' + flags.join(', '));
  }
  await page.addInitScript(() => {
    const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
  });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

  log('goto /map ' + BASE);
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 60000 });
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Decline');
    if (d) d.click();
  });
  log('map + engine ready');

  // Waves ON
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves'), null, { timeout: 45000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => { const e = window.__MARINE_ENGINE__; return e && e._waveData && e._waveData.bounds; },
    null, { timeout: 90000 });
  log('waves resident committed');

  if (MODEL !== 'GFS') {
    await page.evaluate((m) => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === m);
      if (b) b.click();
    }, MODEL);
    try {
      await page.waitForFunction((m) => { const wd = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData;
        return wd && wd.waveGrid && (wd.waveGrid.__sourceModel || 'GFS') === m; }, MODEL, { timeout: 60000 });
      log(`model ${MODEL} committed`);
    } catch (e) { log(`model ${MODEL} WAIT TIMEOUT (continuing)`); }
    await page.waitForTimeout(3000);
  }

  // Repro camera. easeTo (a real animated move) then settle — jumpTo alone has been seen not to
  // re-drive the fetch lane at wide zoom.
  log(`camera -> zoom ${ZOOM} center ${CENTER}`);
  await page.evaluate(([c, z]) => { window.map.easeTo({ center: c, zoom: z, duration: 900 }); }, [CENTER, ZOOM]);
  await page.waitForTimeout(15000);
  await page.evaluate(([c, z]) => { window.map.jumpTo({ center: c, zoom: z }); }, [CENTER, ZOOM]);
  await page.waitForTimeout(8000);

  await page.screenshot({ path: path.join(outdir, `shot_${LABEL}_on.png`) });

  // ---- in-page instrumentation -------------------------------------------------------------
  const installed = await page.evaluate(() => {
    window.__GRAB__ = (W) => new Promise((res) => {
      const src = window.map.getCanvas(); W = W || 160;
      const H = Math.round(W * src.height / src.width);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      let n = 0;
      const h = () => { n++; if (n < 2) return; ctx.drawImage(src, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data; window.map.off('render', h); res({ W, H, d: Array.from(d) }); };
      window.map.on('render', h); window.map.triggerRepaint();
    });
    return true;
  });
  log('grab installed: ' + installed);

  const grabTwice = async () => {
    // two grabs a beat apart so particle motion shows up as its own signal
    const a = await page.evaluate(() => window.__GRAB__(160));
    await page.waitForTimeout(700);
    const b = await page.evaluate(() => window.__GRAB__(160));
    return [a, b];
  };

  const [onA, onB] = await grabTwice();
  log(`grab ON ${onA.W}x${onA.H}`);

  // toggle the marine layer OFF -> the paint footprint is the A/B delta
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
    if (b && b.getAttribute('aria-pressed') === 'true') b.click();
  });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(outdir, `shot_${LABEL}_off.png`) });
  const [offA] = await grabTwice();
  log('grab OFF');

  // back ON for the texture probes
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForTimeout(9000);

  // ---- paint-footprint map (measured lng/lat per sample) -------------------------------------
  const paint = await page.evaluate(([on1, on2, off1]) => {
    const c = window.map.getCanvas();
    const sx = c.clientWidth / on1.W, sy = c.clientHeight / on1.H;
    const rows = [];
    const cells = [];
    for (let y = 0; y < on1.H; y++) {
      let line = '';
      for (let x = 0; x < on1.W; x++) {
        const i = (y * on1.W + x) * 4;
        const dPaint = Math.abs(on1.d[i] - off1.d[i]) + Math.abs(on1.d[i + 1] - off1.d[i + 1]) + Math.abs(on1.d[i + 2] - off1.d[i + 2]);
        const dAnim = Math.abs(on1.d[i] - on2.d[i]) + Math.abs(on1.d[i + 1] - on2.d[i + 1]) + Math.abs(on1.d[i + 2] - on2.d[i + 2]);
        const painted = dPaint > 18;
        const animated = dAnim > 10;
        line += painted ? (animated ? '#' : 'o') : (animated ? ':' : '.');
        if (x % 4 === 0 && y % 4 === 0) {
          const ll = window.map.unproject([x * sx, y * sy]);
          cells.push({ x, y, lng: +ll.lng.toFixed(2), lat: +ll.lat.toFixed(2), dPaint, dAnim });
        }
      }
      const ll = window.map.unproject([2, y * sy]);
      rows.push({ lat: +ll.lat.toFixed(2), line });
    }
    const lngAt = [];
    for (let x = 0; x < on1.W; x += 8) { const ll = window.map.unproject([x * sx, 4]); lngAt.push({ x, lng: +ll.lng.toFixed(2) }); }
    return { rows, cells, lngAt, W: on1.W, H: on1.H };
  }, [onA, onB, offA]);

  // ---- edge detection: for each row find the first painted x; for each col first painted y ----
  const edges = (() => {
    const colFirstPainted = [];
    for (let x = 0; x < paint.W; x++) {
      let firstY = null;
      for (let y = 0; y < paint.H; y++) { if (paint.rows[y].line[x] !== '.' && paint.rows[y].line[x] !== ':') { firstY = y; break; } }
      colFirstPainted.push(firstY);
    }
    const rowFirstPainted = paint.rows.map((r) => { const i = [...r.line].findIndex((ch) => ch !== '.' && ch !== ':'); return i; });
    return { colFirstPainted, rowFirstPainted };
  })();

  // ---- mask + wave texture GPU read-back on a lattice -----------------------------------------
  const probes = await page.evaluate(() => {
    const eng = window.__MARINE_ENGINE__;
    const pts = [];
    for (let lat = -10; lat <= 30; lat += 5) {
      for (let lng = 160; lng <= 180; lng += 5) pts.push({ lng, lat });
      for (let lng = -180; lng <= -155; lng += 5) pts.push({ lng, lat });
    }
    let mask = null;
    try { mask = eng.probeMaskGPU(pts); } catch (e) { mask = 'ERR ' + e.message; }

    // wave-texture read-back: same FBO trick, against the texture the shaders sample
    const gl = window.map.painter.context.gl;
    const readTex = (tex, dims, u, v) => {
      if (!tex || !dims) return null;
      const fbo = gl.createFramebuffer(); const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      let out = null;
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        const px = new Uint8Array(4);
        const tx = Math.max(0, Math.min(dims.w - 1, Math.round(u * (dims.w - 1))));
        const ty = Math.max(0, Math.min(dims.h - 1, Math.round(v * (dims.h - 1))));
        gl.readPixels(tx, ty, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out = [px[0], px[1], px[2], px[3]];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, prev); gl.deleteFramebuffer(fbo);
      return out;
    };
    const cb = eng._coarseBaseData;
    const wd = eng._waveData;
    const src = (cb && cb.u_waveTexture && cb.waveGrid) ? { tag: 'coarseBase', tex: cb.u_waveTexture, g: cb.waveGrid, b: cb.bounds }
      : (wd && wd.u_waveTexture && wd.waveGrid) ? { tag: 'resident', tex: wd.u_waveTexture, g: wd.waveGrid, b: wd.bounds } : null;
    const wave = [];
    if (src && src.b) {
      const dims = { w: src.g.cols, h: src.g.rows };
      for (const p of pts) {
        const u = (p.lng - src.b.west) / (src.b.east - src.b.west);
        const v = (p.lat - src.b.south) / (src.b.north - src.b.south);
        wave.push({ lng: p.lng, lat: p.lat, u: +u.toFixed(4), v: +v.toFixed(4), px: readTex(src.tex, dims, u, v) });
      }
    }
    return { mask, wave, waveSrc: src ? { tag: src.tag, cols: src.g.cols, rows: src.g.rows, bounds: src.b } : null };
  });

  // ---- GL state + engine telemetry ------------------------------------------------------------
  const state = await page.evaluate(() => {
    const gl = window.map.painter.context.gl;
    const eng = window.__MARINE_ENGINE__;
    const wd = eng && eng._waveData;
    return {
      gl: {
        scissorTest: gl.isEnabled(gl.SCISSOR_TEST),
        scissorBox: Array.from(gl.getParameter(gl.SCISSOR_BOX) || []),
        viewport: Array.from(gl.getParameter(gl.VIEWPORT) || []),
        stencilTest: gl.isEnabled(gl.STENCIL_TEST),
        depthTest: gl.isEnabled(gl.DEPTH_TEST),
        blend: gl.isEnabled(gl.BLEND),
        cullFace: gl.isEnabled(gl.CULL_FACE),
        colorMask: Array.from(gl.getParameter(gl.COLOR_WRITEMASK) || []),
        drawFbo: gl.getParameter(gl.FRAMEBUFFER_BINDING) ? 'bound' : 'default',
      },
      cam: { zoom: +window.map.getZoom().toFixed(3), center: window.map.getCenter(), bounds: window.map.getBounds().toArray() },
      resident: wd && wd.waveGrid ? { cols: wd.waveGrid.cols, rows: wd.waveGrid.rows, model: wd.waveGrid.__sourceModel, layer: wd.waveGrid.__componentLayer, bounds: wd.bounds } : null,
      coarseBase: eng && eng._coarseBaseData ? { bounds: eng._coarseBaseData.bounds, cols: eng._coarseBaseData.waveGrid && eng._coarseBaseData.waveGrid.cols, rows: eng._coarseBaseData.waveGrid && eng._coarseBaseData.waveGrid.rows } : null,
      probeState: eng && eng._probeState,
      maskDims: eng && eng._cachedMaskTexDims, maskBounds: eng && eng._cachedMaskBounds,
      maskRepatch: eng && eng._lastMaskRepatchReason,
      gpu: window.__RAW_GPU__ ? JSON.parse(JSON.stringify(window.__RAW_GPU__)) : null,
    };
  });

  const report = { label: LABEL, at: new Date().toISOString(), base: BASE, model: MODEL, center: CENTER, zoom: ZOOM,
    flags: process.env.RL_FLAGS || '', state, probes, edges, paint: { rows: paint.rows, lngAt: paint.lngAt, W: paint.W, H: paint.H },
    consoleErrors: consoleErrors.slice(0, 20) };
  fs.writeFileSync(path.join(outdir, `report_${LABEL}.json`), JSON.stringify(report, null, 1));

  // human-readable paint map
  const ascii = ['PAINT FOOTPRINT (# painted+animated, o painted-static, : anim-only, . BLANK)',
    'lng@x: ' + paint.lngAt.map((p) => `${p.x}:${p.lng}`).join(' '),
    ...paint.rows.filter((_, i) => i % 2 === 0).map((r) => String(r.lat).padStart(7) + ' ' + r.line)];
  fs.writeFileSync(path.join(outdir, `paint_${LABEL}.txt`), ascii.join('\n'));

  log('report written: ' + path.join(outdir, `report_${LABEL}.json`));
  await context.close(); await browser.close();
}

main().catch((e) => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
