/**
 * activationlab.js — decompose marine ACTIVATION latency (2026-07-24).
 *
 * User report: "I just activated the marine euro heatmap and it took like almost 10 seconds for the
 * heatmap to be projected." This times the click -> first-paint path and attributes the wall clock
 * to phases, so the fix targets the phase that actually costs, rather than the first plausible one:
 *
 *   click -> first marine grid request  (app/debounce/gating)
 *   request -> response                 (backend)
 *   response -> _waveData committed     (decode + encode + mask build, main thread)
 *   commit  -> first painted frame      (GPU)
 *
 * Every network request is recorded with size, so a large blocking asset (e.g. the 18.3 MB
 * ne_10m_land.json the repo does NOT ship locally, pulled cross-origin from jsdelivr) shows up as
 * an attributable line item instead of vanishing into "it felt slow".
 *
 * Usage: node activationlab.js <outdir>
 * Env: AC_BASE (default http://localhost:3007), AC_MODEL (EURO), AC_ZOOM (8.5), AC_CENTER, AC_THEME
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AC_BASE || 'http://localhost:3007';
const MODEL = (process.env.AC_MODEL || 'EURO').trim().toUpperCase();
const ZOOM = Number(process.env.AC_ZOOM || 8.5);
const CENTER = (process.env.AC_CENTER || '-80.2,28.4').split(',').map(Number);
const outdir = process.argv[2] || path.join(__dirname, 'activationlab-out');
fs.mkdirSync(outdir, { recursive: true });
const lines = [];
const log = (m) => { console.log(m); lines.push(m); fs.writeFileSync(path.join(outdir, 'report.txt'), lines.join('\n')); };

async function main() {
  const browser = await chromium.launch({ headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  if (process.env.AC_THEME) {
    await page.addInitScript((t) => { try { localStorage.setItem('raw-surf-theme', t); } catch (e) {} }, process.env.AC_THEME.trim());
  }
  // name / name=value, so "set me to false" levers (__MARINE_SIBLING_PREWARM__=false) are A/B-able.
  if (process.env.AC_FLAGS) {
    const flags = process.env.AC_FLAGS.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => { const i = s.indexOf('='); if (i < 0) return [s, true];
        const raw = s.slice(i + 1);
        return [s.slice(0, i), raw === 'true' ? true : raw === 'false' ? false : (isNaN(Number(raw)) ? raw : Number(raw))]; });
    await page.addInitScript((fl) => { for (const [k, v] of fl) window[k] = v; }, flags);
    log('AC_FLAGS: ' + flags.map(([k, v]) => `${k}=${v}`).join(', '));
  }
  await page.addInitScript(() => {
    const mockSW = { register: () => new Promise(() => {}), ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null), getRegistrations: () => Promise.resolve([]) };
    Object.defineProperty(navigator, 'serviceWorker', { get() { return mockSW; }, configurable: true });
  });

  // Network ledger, wall-clock relative to the activation click.
  //
  // ⚠️ RECORD REQUESTS *AND* RESPONSES. The first version of this harness listened only to
  // `response`, so every timestamp was a RESPONSE ARRIVAL — and I misread the first one (3382 ms)
  // as "3.4 s of app-side gating before the first network call". It was nothing of the kind: the
  // request had gone out long before, and the same first response landed at 1609 ms in the other
  // A/B leg with identical client code, i.e. a 1.8 s swing that can only be backend variance.
  // click->first-REQUEST is the number that actually indicts the client, and it was never measured.
  // Keeping both series is what makes "app-side gating" vs "backend latency" separable at all.
  let t0 = null;
  const net = [];
  page.on('request', (q) => {
    try { net.push({ kind: 'req', at: t0 ? Math.round(Date.now() - t0) : null, url: q.url() }); } catch (e) {}
  });
  page.on('response', async (r) => {
    try {
      const len = Number(r.headers()['content-length'] || 0);
      net.push({ kind: 'res', at: t0 ? Math.round(Date.now() - t0) : null, url: r.url(), status: r.status(), bytes: len });
    } catch (e) {}
  });

  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 60000 });
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Decline');
    if (d) d.click();
  });
  await page.evaluate((m) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === m);
    if (b) b.click();
  }, MODEL);
  await page.evaluate(([c, z]) => window.map.jumpTo({ center: c, zoom: z }), [CENTER, ZOOM]);
  await page.waitForTimeout(8000);          // settle the basemap BEFORE the click we are timing

  // in-page paint watcher
  await page.evaluate(() => {
    const src = window.map.getCanvas();
    const W = 48, H = Math.round(48 * src.height / src.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    window.__AC = { t0: null, firstWaveData: null, firstPaint: null, base: null };
    const chroma = () => { ctx.drawImage(src, 0, 0, W, H); const d = ctx.getImageData(0, 0, W, H).data;
      let s = 0; for (let i = 0; i < W * H; i++) { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        s += Math.max(r, g, b) - Math.min(r, g, b); } return s / (W * H); };
    window.map.on('render', () => {
      const A = window.__AC; if (!A.t0) return;
      const now = performance.now();
      if (A.base === null) A.base = chroma();
      const e = window.__MARINE_ENGINE__;
      if (!A.firstWaveData && e && e._waveData) A.firstWaveData = Math.round(now - A.t0);
      if (!A.firstPaint && chroma() > A.base + 12) A.firstPaint = Math.round(now - A.t0);
    });
  });

  net.length = 0;
  t0 = Date.now();
  await page.evaluate(() => {
    window.__AC.base = null;
    window.__AC.t0 = performance.now();
    const b = [...document.querySelectorAll('button')]
      .find((x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim()) === 'Waves');
    b.click();
  });
  await page.waitForTimeout(25000);

  const r = await page.evaluate(() => {
    const e = window.__MARINE_ENGINE__, wd = e && e._waveData;
    return { ...window.__AC, cols: wd && wd.waveGrid && wd.waveGrid.cols,
      rows: wd && wd.waveGrid && wd.waveGrid.rows, bounds: wd && wd.bounds };
  });

  log(`ACTIVATION at z${ZOOM} centre ${CENTER} model ${MODEL}`);
  log(`  click -> _waveData committed : ${r.firstWaveData} ms`);
  log(`  click -> first painted frame : ${r.firstPaint} ms`);
  log(`  resident: ${r.cols}x${r.rows}  bounds ${JSON.stringify(r.bounds)}`);
  log('');
  // THE number that indicts the CLIENT: click -> first marine REQUEST leaving the browser.
  const marineReq = net.filter((n) => n.kind === 'req' && /grid_series|weather\/grid/.test(n.url));
  const marineRes = net.filter((n) => n.kind === 'res' && /grid_series|weather\/grid/.test(n.url));
  log(`  click -> first marine REQUEST  : ${marineReq.length ? marineReq[0].at : 'n/a'} ms   <- app-side gating`);
  log(`  click -> first marine RESPONSE : ${marineRes.length ? marineRes[0].at : 'n/a'} ms   <- gating + backend`);
  log('');
  const big = net.filter((n) => n.kind === 'res' && n.bytes > 200000).sort((a, b) => b.bytes - a.bytes);
  log(`  responses after the click: ${net.filter((n) => n.kind === 'res').length}; over 200 KB: ${big.length}`);
  for (const n of big.slice(0, 12)) {
    log(`    ${String(n.at).padStart(6)} ms  ${String(Math.round(n.bytes / 1024)).padStart(7)} KB  ${n.status}  ${n.url.slice(0, 120)}`);
  }
  log(`  marine grid REQUESTS: ${marineReq.length}`);
  for (const n of marineReq.slice(0, 10)) {
    log(`    req ${String(n.at).padStart(6)} ms  ${n.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 130)}`);
  }
  log(`  marine grid RESPONSES: ${marineRes.length}`);
  for (const n of marineRes.slice(0, 10)) {
    log(`    res ${String(n.at).padStart(6)} ms  ${String(Math.round(n.bytes / 1024)).padStart(7)} KB  ${n.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 130)}`);
  }
  await context.close(); await browser.close();
}
main().catch((e) => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
