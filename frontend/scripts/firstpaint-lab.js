/**
 * firstpaint-lab.js — first marine-layer activation forensics (the "wrong-color flash").
 * Cold load -> install per-frame sampler -> click Waves toggle -> capture EVERY frame
 * (color stats + PNG snapshot) until the sharpened regional grid commits, then dump
 * a frame strip + timeline correlating paint commits to visible color.
 * Usage: node firstpaint-lab.js <outdir>   (env: FP_BASE, FP_FLAGS, FP_THEME)
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join('C:', 'Users', 'dprit', 'Raw-Surf', 'frontend', 'node_modules', '@playwright', 'test'));

const BASE = process.env.FP_BASE || 'http://localhost:3009';
const outdir = process.argv[2] || path.join(__dirname, 'firstpaint-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (s) => console.log(`[fp ${new Date().toISOString().slice(11, 19)}] ${s}`);

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  if (process.env.FP_FLAGS) {
    const flags = process.env.FP_FLAGS.split(',').map((s) => s.trim()).filter(Boolean);
    await page.addInitScript((fl) => { for (const f of fl) window[f] = true; }, flags);
    log('FP_FLAGS: ' + flags.join(', '));
  }
  if (process.env.FP_THEME) {
    await page.addInitScript((t) => { try { localStorage.setItem('raw-surf-theme', t); } catch (e) {} }, process.env.FP_THEME.trim());
  }
  // Fresh bundle always (disable SW) + in-page console capture with perf timestamps.
  await page.addInitScript(() => {
    const mockSW = {
      register: () => new Promise(() => {}), ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]),
    };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
    window.__FP_LOGS__ = [];
    const keep = /FORENSIC-ENCODE|SCRUB-SETTLE|FORENSIC-SNAP|Layer activated|cache MISS|Instant cache-hit|No-downgrade|hour-?0|seriesFrameMint|orchestratorCommit|TruthDiff|coarse_global|Render backstop/;
    const orig = console.log.bind(console);
    console.log = (...a) => {
      try {
        const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
        if (keep.test(s)) window.__FP_LOGS__.push({ t: performance.now(), s: s.slice(0, 300) });
      } catch (e) {}
      return orig(...a);
    };
  });

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

  log('goto /map (cold)');
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 60000 });
  log('map + engine ready');
  try {
    await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
      if (d) d.click();
    });
  } catch (e) {}

  // Camera parity with the user's session: coastal FL z9, settled BEFORE the toggle.
  await page.evaluate(() => { window.map.jumpTo({ center: [-80.6, 28.37], zoom: 9 }); });
  await page.waitForTimeout(2500);

  // Install the per-frame sampler + snapshot recorder BEFORE the toggle.
  await page.evaluate(() => {
    const m = window.map, eng = window.__MARINE_ENGINE__;
    const src = m.getCanvas();
    const W = 240, H = Math.round(240 * src.height / src.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const T = (window.__FP__ = { frames: [], snaps: [], W, H, t0: performance.now(), clickT: null, snapping: true });
    m.on('render', () => {
      try {
        const t = performance.now() - T.t0;
        ctx.drawImage(src, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (let y = 2; y < H - 2; y += 2) {
          for (let x = 2; x < W - 2; x += 2) {
            const i = (y * W + x) * 4;
            sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
          }
        }
        const wd = eng._waveData;
        const g = window.__RAW_GPU__ || {};
        T.frames.push({
          t: Math.round(t),
          R: +(sr / n).toFixed(1), G: +(sg / n).toFixed(1), B: +(sb / n).toFixed(1),
          cols: wd && wd.waveGrid && wd.waveGrid.cols,
          rows: wd && wd.waveGrid && wd.waveGrid.rows,
          span: wd && wd.bounds ? +(wd.bounds.east - wd.bounds.west).toFixed(1) : null,
          hm: g.opacity && g.opacity.heatmap, cf: g.coarseFade,
          fade: g.sharpenOpacityEase,
          cv: g.coldVeil === undefined ? 'ABSENT' : (g.coldVeil ? JSON.stringify(g.coldVeil) : 'null'),
        });
        // Snapshot every frame from click until stopped (bounded to 240 snaps).
        if (T.snapping && T.clickT != null && T.snaps.length < 240) {
          T.snaps.push({ t: Math.round(t), png: cv.toDataURL('image/png') });
        }
      } catch (e) { T.frames.push({ err: String(e && e.message).slice(0, 60) }); }
    });
  });
  log('sampler installed');

  // Click the Waves toggle — the real button, real event.
  const findWaves = () => {
    const all = Array.from(document.querySelectorAll('button'));
    let b = all.find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
    if (!b) {
      const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')) &&
        !/collapse/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
      if (exp) exp.click();
    }
    return b || null;
  };
  await page.waitForFunction(`(${findWaves.toString()})() !== null`, null, { timeout: 45000 });
  const clicked = await page.evaluate(`(() => {
    const b = (${findWaves.toString()})();
    if (!b) return 'NOT FOUND';
    window.__FP__.clickT = performance.now() - window.__FP__.t0;
    if (b.getAttribute('aria-pressed') !== 'true') b.click();
    return 'clicked at t=' + Math.round(window.__FP__.clickT);
  })()`);
  log('waves toggle: ' + clicked);

  // Wait for the sharpened regional commit (cols leaves the 36-col global regime), then settle.
  try {
    await page.waitForFunction(() => {
      const e = window.__MARINE_ENGINE__, wd = e && e._waveData;
      return wd && wd.waveGrid && wd.waveGrid.cols && wd.waveGrid.cols < 30;
    }, null, { timeout: 45000 });
    log('regional sharpen committed');
  } catch (e) { log('WARN: regional sharpen never committed within 45s'); }
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__FP__.snapping = false; });

  // Dump.
  const dump = await page.evaluate(() => ({
    frames: window.__FP__.frames, clickT: window.__FP__.clickT,
    logs: window.__FP_LOGS__, nSnaps: window.__FP__.snaps.length,
    W: window.__FP__.W, H: window.__FP__.H,
  }));
  fs.writeFileSync(path.join(outdir, 'trace.json'), JSON.stringify(dump, null, 1));
  const snaps = await page.evaluate(() => window.__FP__.snaps);
  for (const s of snaps) {
    fs.writeFileSync(path.join(outdir, `f${String(s.t).padStart(6, '0')}.png`),
      Buffer.from(s.png.split(',')[1], 'base64'));
  }
  log(`dumped ${dump.frames.length} frames, ${snaps.length} snaps, ${dump.logs.length} logs -> ${outdir}`);

  // Quick verdict: color discontinuities after click.
  const fs2 = dump.frames.filter((f) => f.t >= dump.clickT - 100);
  let prev = null; const jumps = [];
  for (const f of fs2) {
    if (prev && f.R != null) {
      const d = Math.abs(f.R - prev.R) + Math.abs(f.G - prev.G) + Math.abs(f.B - prev.B);
      if (d > 18) jumps.push({ t: f.t, dRGB: +d.toFixed(1), from: `${prev.R},${prev.G},${prev.B}`, to: `${f.R},${f.G},${f.B}`, cols: f.cols, span: f.span, hm: f.hm });
    }
    if (f.R != null) prev = f;
  }
  console.log('CLICK t=' + Math.round(dump.clickT));
  console.log('COLOR JUMPS (dRGB>18):', JSON.stringify(jumps, null, 1));
  console.log('COMMIT LOGS:', JSON.stringify(dump.logs.map((l) => ({ t: Math.round(l.t - dump.clickT), s: l.s.slice(0, 160) })), null, 1));
  console.log('console errors:', JSON.stringify(consoleErrors.slice(0, 5)));

  await browser.close();
}

main().catch((e) => { console.error('FP FAIL', e); process.exit(1); });
