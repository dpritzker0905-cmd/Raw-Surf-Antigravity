// land-cache-lab/run.js: cold and warm runs of index.html in system Chrome with the HTTP cache ON (no request routing).
// Reaches only 127.0.0.1 and the public CDN that serves the 10 m land file. Usage (from frontend/): [THROTTLE=4] node scripts/offline-backend/land-cache-lab/run.js "$PWD"
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.argv[2] + '/node_modules/playwright-core');
const DIR = __dirname; const PORT = 4311; const LIB = path.join(process.argv[2], 'node_modules/maplibre-gl/dist/maplibre-gl.js');
const srv = http.createServer((q, s) => { const name = q.url.split('?')[0] === '/' ? 'index.html' : path.basename(q.url.split('?')[0]); const p = name === 'maplibre-gl.js' ? LIB : path.join(DIR, name);
  if (!fs.existsSync(p)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' }); fs.createReadStream(p).pipe(s); });
(async () => {
  await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));
  const throttle = +(process.env.THROTTLE || 1);
  for (const arm of ['url', 'object', 'url', 'object']) {
    const prof = fs.mkdtempSync(path.join(DIR, 'prof-'));
    for (const temp of ['cold', 'warm']) {
      const ctx = await chromium.launchPersistentContext(prof, { channel: 'chrome', headless: true, viewport: { width: 1280, height: 800 } });
      const page = ctx.pages()[0] || await ctx.newPage(); const hosts = new Set(); const land = [];
      page.on('request', (q) => { try { hosts.add(new URL(q.url()).host); } catch (e) { /* data: */ } });
      const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
      const ids = new Map();
      cdp.on('Network.requestWillBeSent', (e) => { if (/ne_10m_land/.test(e.request.url)) ids.set(e.requestId, { type: e.type, cache: false, bytes: null }); });
      cdp.on('Network.requestServedFromCache', (e) => { if (ids.has(e.requestId)) ids.get(e.requestId).cache = true; });
      cdp.on('Network.loadingFinished', (e) => { if (ids.has(e.requestId)) { ids.get(e.requestId).bytes = e.encodedDataLength; land.push(ids.get(e.requestId)); } });
      if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      await page.goto(`http://127.0.0.1:${PORT}/?arm=${arm}`);
      await page.waitForFunction(() => window.__R__, null, { timeout: 180000 });
      const r = await page.evaluate(() => window.__R__);
      console.log(temp, 'x' + throttle, JSON.stringify(r), 'landRequestsSeen', JSON.stringify(land), 'hosts', [...hosts].join(','));
      await ctx.close();
    }
    fs.rmSync(prof, { recursive: true, force: true });
  }
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
