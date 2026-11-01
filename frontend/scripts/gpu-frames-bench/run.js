// GPU FRAMES BENCH driver: starts serve.js, runs bench.html in each installed Chromium-family browser on the real GPU (and a
// SwiftShader software-GPU run as the floor), presses real keys for the scrub-latency phase, and records garbage collection per
// phase and per thread from a CDP trace (DevTools' MinorGC / MajorGC events). Offline only: localhost, no Raw Surf backend.
//   node frontend/scripts/gpu-frames-bench/run.js --frames <series dir> [--out <dir>] [--browsers chrome,msedge,chromium,swiftshader]
//        [--lat 0] [--cpu 1] [--view desktop|phone] [--probe 1]
// Playwright resolves from frontend/node_modules (in a worktree without node_modules: NODE_PATH=<main checkout>/frontend/node_modules).
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt; };
const FRAMES = path.resolve(arg('frames', path.join(__dirname, 'frames')));
const OUT = path.resolve(arg('out', path.join(__dirname, 'out')));
const BROWSERS = arg('browsers', 'chrome,msedge,swiftshader').split(',');
const LAT = +arg('lat', 0);
const CPU = +arg('cpu', 1);
const VIEW = arg('view', 'desktop');
const PROBE = arg('probe', '1');
const PORT = +arg('port', 4290);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gcByPhase(events) {
  const threads = {}; events.filter((e) => e.ph === 'M' && e.name === 'thread_name').forEach((e) => { threads[`${e.pid}:${e.tid}`] = e.args.name; });
  const marks = events.filter((e) => e.cat && e.cat.includes('blink.user_timing') && /^gfb:/.test(e.name)).map((e) => ({ name: e.name.slice(4), ts: e.ts })).sort((a, b) => a.ts - b.ts);
  const phaseOf = (ts) => { let p = 'pre'; for (const m of marks) { if (m.ts <= ts) p = m.name; else break; } return p; };
  const out = {};
  events.filter((e) => (e.name === 'MinorGC' || e.name === 'MajorGC') && e.ph === 'X').forEach((e) => {
    const th = (threads[`${e.pid}:${e.tid}`] || 'other').replace(/DedicatedWorker thread.*/, 'worker');
    const key = `${phaseOf(e.ts)}|${th}`; const o = out[key] || (out[key] = { minor: 0, major: 0, ms: 0, maxMs: 0 });
    o[e.name === 'MinorGC' ? 'minor' : 'major'] += 1; o.ms += e.dur / 1000; o.maxMs = Math.max(o.maxMs, e.dur / 1000);
  });
  Object.values(out).forEach((o) => { o.ms = +o.ms.toFixed(2); o.maxMs = +o.maxMs.toFixed(2); });
  return { marks: marks.map((m) => m.name), gc: out };
}

async function runOne(kind) {
  const args = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader'];
  args.push(kind === 'swiftshader' ? '--use-angle=swiftshader' : '--use-angle=d3d11');
  const channel = kind === 'chrome' ? 'chrome' : kind === 'msedge' ? 'msedge' : undefined;
  const browser = await chromium.launch({ channel, headless: true, args });
  const size = VIEW === 'phone' ? { width: 390, height: 844, dpr: 3 } : { width: 1280, height: 800, dpr: 1 };
  const page = await (await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr })).newPage();
  page.on('console', (m) => { if (/\[gfb\]/.test(m.text())) console.log(kind, m.text().slice(0, 240)); });
  const cdp = await page.context().newCDPSession(page);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const chunks = []; cdp.on('Tracing.dataCollected', (e) => chunks.push(...e.value));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
  const label = `${kind}-${VIEW}-cpu${CPU}-lat${LAT}`;
  const w = size.width - 32;
  await page.goto(`http://127.0.0.1:${PORT}/?auto=1&keys=driver&probe=${PROBE}&lat=${LAT}&label=${label}&w=${w}&h=${Math.round(w * 10 / 16)}&dpr=${size.dpr}`);
  await page.waitForFunction(() => window.__GFB_KEYS_READY__ === true, null, { timeout: 180000 });
  await page.focus('#c');
  for (let i = 0; i < 80; i++) { await page.keyboard.press(Math.random() < 0.15 ? 'PageUp' : 'ArrowRight'); await sleep(25 + Math.random() * 70); }
  await page.evaluate(() => { window.__GFB_KEYS_DONE__ = true; });
  await page.waitForFunction(() => window.__GFB_DONE__ === true, null, { timeout: 300000 });
  const results = await page.evaluate(() => window.__GFB_RESULTS__);
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r)); await cdp.send('Tracing.end'); await Promise.race([done, sleep(20000)]);
  results.trace = gcByPhase(chunks); results.driver = { kind, view: VIEW, cpuThrottle: CPU, lat: LAT };
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(results, null, 1));
  console.log('wrote', path.join(OUT, `${label}.json`));
  return results;
}

(async () => {
  process.argv.push('--frames', FRAMES, '--port', String(PORT), '--out', path.join(OUT, 'posted'));
  const server = require('./serve.js');
  await sleep(300);
  for (const kind of BROWSERS) {
    try { await runOne(kind); } catch (e) { console.error('run failed', kind, e && e.message); }
  }
  server.close();
})();
