// Does Chrome honour RequestInit.priority on fetches made from a DEDICATED (Blob) WORKER, as staticFrames.js makes them?
// Method: a Chrome performance trace (the lead's ask). Each ResourceSendRequest event carries the scheduling priority Chrome
// assigned (args.data.priority) and the hint it saw (args.data.fetchPriorityHint), for page AND worker fetches. A slow local
// server also shares bandwidth between concurrent responses, so completion times show whether the hint changes delivery.
// Offline only (127.0.0.1). Usage: node frontend/scripts/offline-backend/probe_fetch_priority.js [chromium|chrome]
// Result 2026-10-23 (Chrome 154): docs/weather-program/evidence/boot-prewarm-2026-10-23.json, worker_priority_trace.
const http = require('http');
const path = require('path');
const { chromium } = require(path.join(process.env.PW_DIR || path.join(__dirname, '..', '..', 'node_modules'), 'playwright'));

const PAGE = '<!doctype html><meta charset=utf-8><title>p</title><script>\n'
  + 'const SRC = "self.onmessage = async (e) => { const out = []; await Promise.all(e.data.map(async (m) => { const t0 = performance.now();'
  + ' const r = await fetch(m.url, Object.assign({ credentials: \'omit\' }, m.priority ? { priority: m.priority } : {})); await r.arrayBuffer();'
  + ' out.push({ url: m.url, ms: Math.round(performance.now() - t0) }); })); self.postMessage(out); };";\n'
  + 'window.runWorker = (list) => new Promise((res) => { const w = new Worker(URL.createObjectURL(new Blob([SRC], { type: "text/javascript" }))); w.onmessage = (e) => res(e.data); w.postMessage(list); });\n'
  + 'window.runMain = async (list) => { const out = []; await Promise.all(list.map(async (m) => { const t0 = performance.now();'
  + ' const r = await fetch(m.url, Object.assign({ credentials: "omit" }, m.priority ? { priority: m.priority } : {})); await r.arrayBuffer();'
  + ' out.push({ url: m.url, ms: Math.round(performance.now() - t0) }); })); return out; };\n'
  + '</script>';

const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  const body = Buffer.alloc(256 * 1024, 7);
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-length': body.length });
  let off = 0;
  const tick = () => { if (off >= body.length) return res.end(); res.write(body.subarray(off, off + 16384)); off += 16384; setTimeout(tick, 15); };
  setTimeout(tick, 50);
});

(async () => {
  await new Promise((r) => server.listen(4195, '127.0.0.1', r));
  const channel = process.argv[2] === 'chrome' ? { channel: 'chrome' } : {};
  const browser = await chromium.launch({ headless: true, ...channel });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4195/');
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.resource', 'loading', '__metadata'] });
  const list = (tag) => [{ url: `http://127.0.0.1:4195/f/${tag}-low-1`, priority: 'low' }, { url: `http://127.0.0.1:4195/f/${tag}-low-2`, priority: 'low' }, { url: `http://127.0.0.1:4195/f/${tag}-low-3`, priority: 'low' },
    { url: `http://127.0.0.1:4195/f/${tag}-none`, priority: null }, { url: `http://127.0.0.1:4195/f/${tag}-high`, priority: 'high' }];
  const mainTimes = await page.evaluate((l) => window.runMain(l), list('main'));
  const workerTimes = await page.evaluate((l) => window.runWorker(l), list('worker'));
  await new Promise((r) => setTimeout(r, 300));
  const tr = JSON.parse((await browser.stopTracing()).toString());
  const events = tr.traceEvents || tr;
  const threads = {};
  for (const e of events) if (e.name === 'thread_name' && e.args) threads[`${e.pid}:${e.tid}`] = e.args.name;
  const rows = events.filter((e) => e.name === 'ResourceSendRequest' && e.args && e.args.data && String(e.args.data.url || '').includes('/f/'))
    .map((e) => ({ url: e.args.data.url.split('/f/')[1], priority: e.args.data.priority, hint: e.args.data.fetchPriorityHint, thread: threads[`${e.pid}:${e.tid}`] || String(e.tid) }));
  console.log(JSON.stringify({ chrome: browser.version(), trace: rows, mainTimes, workerTimes }, null, 1));
  await browser.close(); server.close();
})().catch((e) => { console.error('FAIL', e); process.exitCode = 1; server.close(); });
