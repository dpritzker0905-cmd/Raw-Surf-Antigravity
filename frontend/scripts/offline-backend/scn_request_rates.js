// Non-weather request rates per page, offline (2026-10-23; the live trace saw 432 /api/stories/feed in ~2 min on /feed,
// doubled unread-count polls on /map, and POST acknowledge-tos / push/subscribe on load).
//
// Every backend call is intercepted by ab_lib (weather to the local synthetic server on PORT, or a fail-closed 502 when
// none runs; everything else stubbed). Nothing reaches the live box. Geolocation is GRANTED (the feed loop needs it).
// Phases, each a fresh page load and a counted window of WINDOW ms:
//   feed        /feed, tab visible
//   map         /map, tab visible
//   map_hidden  /map, tab hidden after a SETTLE ms load (document.visibilityState overridden + visibilitychange)
//   tos         /feed with a token and no cached acceptance, /compliance/tos-status answering "not acknowledged";
//               NO clicks for WINDOW ms (the dialog must stay up and nothing may be POSTed), then the positive
//               control: tick the box and click "I Agree" (exactly one POST).
// Usage: AB_BASE=http://127.0.0.1:3260 PORT=4199 WINDOW=60000 OUT=<file.json> node scn_request_rates.js
const fs = require('fs');
const { launch, BASE, USER, API_HOST } = require('./ab_lib');

const PORT = parseInt(process.env.PORT || '4199', 10);
const WINDOW = parseInt(process.env.WINDOW || '60000', 10);
const SETTLE = parseInt(process.env.SETTLE || '10000', 10);
const PHASES = (process.env.PHASES || 'feed,map,map_hidden,tos').split(',');
const GEO = { latitude: 28.378, longitude: -80.6076 };

const norm = (p) => p.split(USER.id).join('{uid}').replace(/\?.*$/, '');

async function session(phase) {
  const { browser, ctx, page, log } = await launch({ port: PORT, gpu: true });
  await ctx.grantPermissions(['geolocation'], { origin: BASE });
  await ctx.setGeolocation(GEO);
  const calls = [];
  let counting = false;
  const t0 = Date.now();
  page.on('request', (r) => {
    let u; try { u = new URL(r.url()); } catch (e) { return; }
    if (!API_HOST.test(u.hostname) || r.method() === 'OPTIONS') return;
    calls.push({ t: Date.now() - t0, counted: counting, m: r.method(), p: norm(u.pathname) });
  });
  if (phase === 'tos') {
    await page.addInitScript(({ user }) => {
      localStorage.setItem('raw-surf-user', JSON.stringify({ ...user, access_token: 'offline-harness-not-a-token' }));
      localStorage.removeItem(`tos-accepted-${user.id}-1.0`);
    }, { user: USER });
    // Registered after ab_lib's catch-all, so it wins for these paths; everything else falls back to the stub.
    await page.route('**/api/compliance/**', (route) => {
      const u = new URL(route.request().url());
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
      if (u.pathname.includes('/tos-status/')) return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ acknowledged: false }) });
      if (u.pathname.includes('/tos-content/')) return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ sections: [{ title: 'Offline', body: 'Harness terms.' }] }) });
      return route.fulfill({ status: 200, headers: h, body: '{}' });
    });
  }
  const out = { phase, base: BASE, windowMs: WINDOW };
  const path = phase === 'feed' || phase === 'tos' ? '/feed' : '/map';
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  if (phase === 'map_hidden') {
    await page.waitForTimeout(SETTLE);
    await page.evaluate(() => {
      Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return 'hidden'; } });
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return true; } });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  counting = true;
  const tStart = Date.now() - t0;
  await page.waitForTimeout(WINDOW);
  counting = false;
  if (phase === 'tos') {
    out.dialogShown = await page.locator('#tos-gate-title').isVisible().catch(() => false);
    out.postsBeforeClick = calls.filter((c) => c.m === 'POST' && c.p.endsWith('/acknowledge-tos')).length;
    if (out.dialogShown) {
      await page.locator('[data-testid="tos-gate-confirm-checkbox"]').click();
      await page.locator('[data-testid="tos-gate-accept-button"]').click();
      await page.waitForTimeout(2000);
    }
    out.postsAfterClick = calls.filter((c) => c.m === 'POST' && c.p.endsWith('/acknowledge-tos')).length;
    out.dialogAfterClick = await page.locator('#tos-gate-title').isVisible().catch(() => false);
  }
  const counted = calls.filter((c) => c.counted);
  const byPath = {};
  for (const c of counted) {
    const k = `${c.m} ${c.p}`;
    byPath[k] = (byPath[k] || 0) + 1;
  }
  const weather = counted.filter((c) => c.p.startsWith('/api/weather/')).length;
  out.countedFromMs = tStart;
  out.total = counted.length;
  out.nonWeather = counted.length - weather;
  out.nonWeatherPerMin = +(out.nonWeather * 60000 / WINDOW).toFixed(1);
  out.byPath = Object.fromEntries(Object.entries(byPath).sort((a, b) => b[1] - a[1]));
  out.loadCalls = calls.filter((c) => !c.counted && c.t <= tStart).length;
  out.writesAll = calls.filter((c) => c.m !== 'GET').map((c) => `${c.m} ${c.p} @${c.t}ms`);
  out.pageErrors = log.errors.length;
  out.blockedWs = log.blockedWs.length;
  await browser.close();
  return out;
}

(async () => {
  const results = [];
  for (const phase of PHASES) {
    const r = await session(phase);
    results.push(r);
    console.log(JSON.stringify({ phase: r.phase, nonWeather: r.nonWeather, perMin: r.nonWeatherPerMin, top: Object.entries(r.byPath).slice(0, 8), tos: r.phase === 'tos' ? { shown: r.dialogShown, before: r.postsBeforeClick, after: r.postsAfterClick } : undefined }));
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
