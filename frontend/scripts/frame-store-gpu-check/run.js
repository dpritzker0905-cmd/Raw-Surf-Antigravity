// FRAME STORE GPU CHECK: runs store-gpu-check.html, which imports the app's own src/components/map/marineFrameStoreGpu.js, in
// headless Chrome / Edge on the real GPU (ANGLE D3D11) and in SwiftShader, and prints the checks. Localhost only; no backend.
//   NODE_PATH=<main checkout>/frontend/node_modules node frontend/scripts/frame-store-gpu-check/run.js [--browsers chrome,msedge,swiftshader] [--out <dir>] [--port 4296]
// Exit code 1 when any browser's copies are not all byte-exact with state restored and no GL error.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
const PORT = +arg('port', 4296);
const OUT = arg('out', null);
const BROWSERS = arg('browsers', 'chrome,msedge,swiftshader').split(',');
const FILES = {
  '/': [path.join(__dirname, 'store-gpu-check.html'), 'text/html; charset=utf-8'],
  '/store-gpu-check.js': [path.join(__dirname, 'store-gpu-check.js'), 'text/javascript; charset=utf-8'],
  '/appsrc/marineFrameStoreGpu.js': [path.join(__dirname, '..', '..', 'src', 'components', 'map', 'marineFrameStoreGpu.js'), 'text/javascript; charset=utf-8'],
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'POST') { req.resume(); req.on('end', () => { res.writeHead(200); res.end('ok'); }); return; }
  const f = FILES[u.pathname];
  if (!f) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(f[0]));
});

async function runOne(kind) {
  const args = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', kind === 'swiftshader' ? '--use-angle=swiftshader' : '--use-angle=d3d11'];
  const channel = kind === 'chrome' ? 'chrome' : kind === 'msedge' ? 'msedge' : undefined;
  const browser = await chromium.launch({ channel, headless: true, args });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/?label=${kind}`);
    await page.waitForFunction(() => window.__GFB_DONE__ === true, null, { timeout: 120000 });
    return await page.evaluate(() => window.__GFB_RESULTS__);
  } finally { await browser.close(); }
}

server.listen(PORT, '127.0.0.1', async () => {
  let bad = 0; const all = {};
  for (const kind of BROWSERS) {
    try {
      const r = await runOne(kind); all[kind] = r;
      const w2 = r.checks && r.checks.webgl2; const w1 = r.checks && r.checks.webgl1;
      const ok = !r.error && w2 && w2.uploaded === 24 && w2.uploadError === 0 && w2.pixelStoreRestored
        && w2.copies.byteExact === 24 && w2.copies.stateRestored === 24 && w2.copies.glErrors === 0
        && w1 && w1.byteExact && w1.stateRestored && w1.glError === 0;
      if (!ok) bad += 1;
      console.log(kind, ok ? 'OK' : 'FAIL', JSON.stringify(r.checks || r.error));
    } catch (e) { bad += 1; console.error(kind, 'run failed', e && e.message); }
  }
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'frame-store-gpu-check.json'), JSON.stringify(all, null, 1)); }
  server.close();
  process.exitCode = bad ? 1 : 0;
});
