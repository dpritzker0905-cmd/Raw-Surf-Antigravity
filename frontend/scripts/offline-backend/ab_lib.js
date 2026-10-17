// Browser harness for the offline backend (serve_synthetic.py): a headless system Chrome on the LOCAL production build.
//
// Network policy (the point of the file): the app's own API host is NEVER reached. `/api/weather/*` is proxied to the local
// synthetic backend on `port`; every other `/api/*` call is answered with an empty stub; writes are swallowed; Supabase,
// push and payment hosts are aborted. The only traffic that still leaves the machine is the map's public basemap tiles and
// fonts (read-only GETs to third-party CDNs), the same ones any visitor's browser makes.
//
// Usage: const { browser, page, log } = await launch({ port: 4100 });  await openMap(page);
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = process.env.AB_BASE || 'http://127.0.0.1:3100';
const API_HOST = /(^|\.)onrender\.com$/;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' };
// The project's own e2e fixture user (a mock profile held in localStorage; it authenticates nothing).
const USER = { id: 'test-surfer-id', email: 'surfer@rawsurf.com', full_name: 'Standard Surfer', username: 'standardsurfer', role: 'user', subscription_tier: 'premium', is_admin: false };
const START = { lat: 16.0, lng: -108.0 };

// WebGL texture-upload spy, injected before any page script: counts uploads by size so a world-mask rebuild (a >= 512 px
// raster) can be told apart from data-texture uploads. Entries carry the page clock so they can be bucketed by event.
const TEX_SPY = () => {
  const spy = (window.__TEX__ = { n: 0, big: 0, log: [] });
  const patch = (proto) => {
    if (!proto || proto.__texSpy) return;
    const orig = proto.texImage2D;
    proto.texImage2D = function (...a) {
      let w; let h;
      if (a.length >= 9) { w = a[3]; h = a[4]; } else { const s = a[5]; w = s && s.width; h = s && s.height; }
      spy.n += 1;
      if (w >= 512 || h >= 512) { spy.big += 1; if (spy.log.length < 400) spy.log.push([Math.round(performance.now()), w, h]); }
      return orig.apply(this, a);
    };
    proto.__texSpy = true;
  };
  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
};

// `live: true` (env AB_LIVE=1) is the ONE exception to the policy above: `/api/weather/*` GETs are sent to the REAL backend (read-only,
// public routes, nothing is written) so a built client can be looked at against production data. Everything else stays stubbed and every
// socket stays closed. It is real load on the 1-CPU box (a map load asks for three 48-frame world pages): one run at a time, /api/health
// probed before and after, never in a loop. `hooks.afterWeather(url, resp)` sees each weather response (resp.body()) before it is delivered.
async function launch({ port, width = 1280, height = 800, dpr = 1, gpu = true, hooks = {}, live = process.env.AB_LIVE === '1' } = {}) {
  if (!port && !live) throw new Error('launch({ port }) needs the synthetic backend port');
  const args = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader'];
  if (gpu) args.push('--use-angle=d3d11');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const log = { requests: [], console: [], errors: [], t0: Date.now(), stubbed: 0, aborted: 0, blockedWs: [], hosts: {} };
  // page.route does NOT see WebSockets: the app opens wss://<api host>/api/ws/... (calls, realtime) and an unrouted socket
  // would reach the real backend. Every non-local socket is closed in the browser before it connects (first harness run
  // 2026-10-16 leaked a handful of rejected handshakes this way; this is the fix).
  await page.routeWebSocket(/.*/, (ws) => {
    const host = new URL(ws.url()).hostname;
    if (host === '127.0.0.1' || host === 'localhost') return ws.connectToServer();
    log.blockedWs.push(host);
    return ws.close({ code: 1008, reason: 'offline harness' });
  });
  page.on('request', (r) => { try { const h = new URL(r.url()).hostname; log.hosts[h] = (log.hosts[h] || 0) + 1; } catch (e) { /* data: urls */ } });

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (API_HOST.test(url.hostname)) {
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (url.pathname.startsWith('/api/weather/client-diagnostics')) return route.fulfill({ status: 204, headers: CORS });
      if (url.pathname.startsWith('/api/weather/') && method === 'GET') {
        const t = Date.now();
        try {
          if (hooks.beforeWeather) await hooks.beforeWeather(url);   // a scenario may hold a request back (e.g. the exact /grid)
          const resp = await route.fetch(live ? {} : { url: `http://127.0.0.1:${port}${url.pathname}${url.search}` });
          if (hooks.afterWeather) { try { await hooks.afterWeather(url, resp); } catch (e) { log.errors.push({ t: Date.now() - log.t0, text: 'afterWeather: ' + String(e).slice(0, 200) }); } }
          const rec = { t: t - log.t0, ms: Date.now() - t, path: url.pathname.replace('/api/weather', ''), q: Object.fromEntries(url.searchParams.entries()), status: resp.status() };
          log.requests.push(rec);
          return route.fulfill({ response: resp, headers: { ...resp.headers(), ...CORS } });
        } catch (e) {
          log.requests.push({ t: t - log.t0, path: url.pathname, error: String(e).slice(0, 100) });
          return route.fulfill({ status: 502, headers: CORS, body: '{}' });
        }
      }
      if (url.pathname.includes('/api/location/ip-geolocation')) {
        return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, latitude: START.lat, longitude: START.lng, city: 'Puerto Vallarta', region: 'Jalisco', country: 'MX', accuracy: 'city', is_coastal: true, coastal_snapped: true }) });
      }
      log.stubbed += 1;
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: method === 'GET' ? '[]' : '{}' });
    }
    if (/supabase\.(co|in)|onesignal|stripe|sentry|posthog|google-analytics|googletagmanager/.test(url.hostname)) { log.aborted += 1; return route.abort(); }
    if (url.hostname === 'unpkg.com') return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    return route.continue();
  });

  if (process.env.AB_DIAG) await page.addInitScript(() => { window.__AB_DIAG__ = true; });
  await page.addInitScript(({ user }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(user));
    localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('__RAW_DIAG__', window.__AB_DIAG__ ? '1' : '0');
    localStorage.setItem('__RAW_TUNER__', '0');
  }, { user: USER });
  await page.addInitScript(TEX_SPY);

  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') log.console.push({ t: Date.now() - log.t0, type: t, text: m.text().slice(0, 240) }); });
  page.on('pageerror', (e) => log.errors.push({ t: Date.now() - log.t0, text: String((e && (e.stack || e.message)) || e).slice(0, 400) }));
  return { browser, ctx, page, log };
}

async function openMap(page, timeout = 90000) {
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__MAP_INSTANCE__ || window.map), null, { timeout });
  await page.waitForTimeout(1500);
}

async function jump(page, lng, lat, zoom) {
  await page.evaluate(({ lng, lat, zoom }) => { const m = window.__MAP_INSTANCE__ || window.map; m.stop(); m.jumpTo({ center: [lng, lat], zoom }); }, { lng, lat, zoom });
}

async function clickText(page, text, { timeout = 15000 } = {}) {
  const loc = page.locator('button').filter({ hasText: text }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout });
  await loc.evaluate((el) => el.click());
}

// What the marine engine currently holds: the resident wave frame's shape, extent and stamp, plus mask-cache facts.
function readEngine() {
  const e = window.__MARINE_ENGINE__;
  if (!e) return null;
  const d = e._waveData || null;
  const g = d && (d.grid || d);
  const out = {
    t: Math.round(performance.now()),
    cols: g && g.cols, rows: g && g.rows,
    bounds: g && g.bounds ? { w: g.bounds.west, s: g.bounds.south, e: g.bounds.east, n: g.bounds.north } : null,
    valid: d && d.truthTag && d.truthTag.valid_time,
    maskMode: e._lastMaskEncodeMode || null,
    maskBounds: e._cachedMaskBounds ? { w: e._cachedMaskBounds.west, s: e._cachedMaskBounds.south, e: e._cachedMaskBounds.east, n: e._cachedMaskBounds.north } : null,
    texBig: window.__TEX__ ? window.__TEX__.big : null,
  };
  return out;
}

module.exports = { launch, openMap, jump, clickText, readEngine, BASE, START, USER, API_HOST };
