/**
 * GATE 6 STALL ATTRIBUTION — name the 1.2 s frame.
 *
 * GATE6_frame_harness.js established that with the Waves layer active the map shows p95 66.6 ms,
 * p99 266.7 ms and a worst frame of 1233.3 ms on an RTX 3060. That says a stall EXISTS; it does not
 * say what it is. This script attributes it.
 *
 * Instrument: `long-animation-frame` (LoAF). It is the right tool because it does not merely time
 * the frame — it decomposes it:
 *     duration                    total frame
 *     blockingDuration            main thread blocked
 *     renderStart / styleAndLayoutStart   where render and layout began within the frame
 *     scripts[]                   per-script invoker, sourceURL, sourceFunctionName, duration,
 *                                 forcedStyleAndLayoutDuration, pauseDuration
 *
 * ★ That decomposition is what makes this attribution rather than another number. If scripts[]
 *   accounts for the stall, a function name is the answer. If scripts[] is small while duration is
 *   huge, the answer is NOT JavaScript — it is render, layout, GPU or paint — and the absence of a
 *   script is itself the finding, not a failed measurement.
 *
 * Usage: HEADED=1 node GATE6_stall_attribution.js [url] [watchSeconds]
 */
const path = require('path');
const { createRequire } = require('module');

function loadPlaywright() {
  try { return require('@playwright/test'); } catch (e) { /* fall through */ }
  const frontend = path.resolve(__dirname, '../../../../frontend/package.json');
  return createRequire(frontend)('@playwright/test');
}
const { chromium } = loadPlaywright();

const TARGET = process.argv[2] || 'https://dev--rawsurf.netlify.app/map';
const WATCH = Number(process.argv[3] || 60);
const LAYER = process.env.LAYER || 'Waves';

(async () => {
  const headless = process.env.HEADED !== '1';
  const browser = await chromium.launch({
    headless,
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Observers must exist BEFORE any app code runs, or the stall during boot/activation is missed.
  await page.addInitScript(() => {
    window.__LOAF__ = [];
    window.__LONGTASK__ = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__LOAF__.push({
            startTime: Math.round(e.startTime),
            duration: Math.round(e.duration),
            blockingDuration: Math.round(e.blockingDuration || 0),
            renderStart: Math.round(e.renderStart || 0),
            styleAndLayoutStart: Math.round(e.styleAndLayoutStart || 0),
            scripts: (e.scripts || []).map((s) => ({
              invoker: s.invoker, invokerType: s.invokerType,
              sourceURL: s.sourceURL, fn: s.sourceFunctionName,
              charPos: s.sourceCharPosition,
              duration: Math.round(s.duration),
              forcedStyleAndLayout: Math.round(s.forcedStyleAndLayoutDuration || 0),
              pause: Math.round(s.pauseDuration || 0)
            }))
          });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch (err) { window.__LOAF_ERR__ = String(err); }
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__LONGTASK__.push({
            startTime: Math.round(e.startTime), duration: Math.round(e.duration),
            attribution: (e.attribution || []).map((a) => `${a.name}:${a.containerType}:${a.containerName || ''}`)
          });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch (err) { window.__LONGTASK_ERR__ = String(err); }
    try {
      localStorage.setItem('raw-surf-user', JSON.stringify({
        id: 'dev-mock-user-id', email: 'dev@rawsurf.com', full_name: 'Dev Mock',
        username: 'devmock', role: 'admin', subscription_tier: 'premium', is_admin: true
      }));
    } catch (e) {}
  });

  const gpu = () => page.evaluate(() => {
    const g = window.__RAW_GPU__ || {};
    const d = window.__WebGLMarineLayer_DIAG__ || {};
    return { textureCount: g.textureCount, textureUploadCount: g.textureUploadCount,
      encodeDupCount: g.encodeDupCount, backendGrid: d.backendGridVectorCount, waveData: d.waveDataPresent };
  });

  console.log(`target: ${TARGET}   layer: ${LAYER}   watch: ${WATCH}s   headless=${headless}`);
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(20000);
  console.log('LoAF supported:', await page.evaluate(() => !window.__LOAF_ERR__), '| pre-activation entries:',
    await page.evaluate(() => window.__LOAF__.length));
  console.log('gpu before activation:', JSON.stringify(await gpu()));

  const mark = await page.evaluate(() => { window.__ACTIVATE_AT__ = performance.now(); return window.__ACTIVATE_AT__; });
  const btn = page.locator('button', { hasText: new RegExp(`^${LAYER}$`) }).first();
  await btn.click();
  console.log(`clicked ${LAYER} at t=${Math.round(mark)}ms, aria-pressed=${await btn.getAttribute('aria-pressed')}`);

  await page.waitForTimeout(WATCH * 1000);
  console.log('gpu after :', JSON.stringify(await gpu()));

  const { loaf, longtask, activateAt } = await page.evaluate(() => ({
    loaf: window.__LOAF__, longtask: window.__LONGTASK__, activateAt: window.__ACTIVATE_AT__
  }));

  const post = loaf.filter((e) => e.startTime >= activateAt - 500);
  post.sort((a, b) => b.duration - a.duration);
  console.log(`\n=== LoAF entries after activation: ${post.length} (of ${loaf.length} total) ===`);
  console.log(`=== longtask entries: ${longtask.filter((t) => t.startTime >= activateAt - 500).length} ===\n`);

  for (const e of post.slice(0, 8)) {
    const rel = Math.round(e.startTime - activateAt);
    const scriptTotal = e.scripts.reduce((s, x) => s + x.duration, 0);
    const renderPhase = e.renderStart ? Math.round(e.startTime + e.duration - e.renderStart) : null;
    console.log(`--- frame ${e.duration}ms  (t+${rel}ms after activation) ---`);
    console.log(`    blocking=${e.blockingDuration}ms  scriptTotal=${scriptTotal}ms  renderPhase=${renderPhase ?? 'n/a'}ms  scripts=${e.scripts.length}`);
    if (!e.scripts.length) {
      console.log('    ⚠️  NO SCRIPT ATTRIBUTED — this frame was not JavaScript. Render/layout/paint/GPU.');
    }
    for (const s of e.scripts.sort((a, b) => b.duration - a.duration).slice(0, 4)) {
      console.log(`      ${String(s.duration).padStart(5)}ms  ${s.invokerType || '?'}  ${s.invoker || ''}`);
      console.log(`             fn=${s.fn || '(anonymous)'}  src=${(s.sourceURL || '').split('/').pop()}@${s.charPos}`
        + (s.forcedStyleAndLayout ? `  forcedStyleAndLayout=${s.forcedStyleAndLayout}ms` : '')
        + (s.pause ? `  pause=${s.pause}ms` : ''));
    }
  }

  // Distribution, so a single outlier is not mistaken for the shape.
  const ds = post.map((e) => e.duration).sort((a, b) => a - b);
  const q = (p) => (ds.length ? ds[Math.floor(p * (ds.length - 1))] : NaN);
  console.log(`\nlong-frame duration distribution (ms): n=${ds.length} p50=${q(0.5)} p90=${q(0.9)} p99=${q(0.99)} max=${q(1)}`);
  const noScript = post.filter((e) => e.scripts.length === 0).length;
  console.log(`frames with NO script attribution: ${noScript}/${post.length}`
    + `  (a high share here means the stall is not JS)`);
  await browser.close();
})().catch((e) => { console.error('ATTRIBUTION ERROR:', e.message); process.exit(1); });
