// Matrix cells 13 and 15 (2026-10-24). Offline only.
//
//   MODE=phone  cell 13: Florida z8 on a PHONE (390 x 844, dpr 3, touch, a handheld UA): N small TOUCH PANS (real touch gestures through CDP
//               Input.dispatchTouchEvent: touchStart, 8 x touchMove, touchEnd; synthesizeScrollGesture did not move the map), 1.2 s apart. Per pan and in total: weather asks started by the pan (by path and layer), the repeat
//               factor of identical asks (path | model | layer | bbox | hours | valid_time), long frames (> 50 ms between animation frames), the
//               frame-store tier the page chose, mask encode mode, GPU memory estimate before and after, and the model chip / drawn model per frame.
//   MODE=net    cell 15: Florida z8 desktop window, a THROTTLED, LOSSY network: every weather ask is held RTT ms (default 400) and fails with p LOSS
//               (default 0.01, a 502 the app sees as a failed request); the static CDN host drops the same share of connections and adds the same RTT.
//               Scenario: load, Waves, 4 wheel steps, click EURO (wait), click GFS (wait). Reported: failed asks, retried asks (an ask repeated after
//               a failure), duplicates (the same key asked again with no failure before it), the distinct status lines seen, frames with the old
//               model drawn after the chip changed WITHOUT a loading line (silent), and the exact-time of the last frame.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS,EURO,ICON --layers waves --regions <...> --dynamic 1 --port 4151
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3105
//   MODE=phone ARM=regional|noregional CDN_DIR=<cdn> PORT=4151 OUT=<json> node frontend/scripts/offline-backend/scn_phone_net.js
// Env: MODE (phone), ARM (regional: the build's default since #552, the old opt-in flag is a no-op; noregional: __RAW_DISABLE_REGIONAL_BUNDLES__), CENTER (-81.8,28.1), ZOOM (8), PANS (12), RTT (400), LOSS (0.01),
// SETTLE (8000), WAIT (15000), CDN_PORT (4361), SEED (7, the loss draws).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_phone_net is offline only');
const MODE = process.env.MODE || 'phone';
const ARM = process.env.ARM || 'noregional';
const PORT = +(process.env.PORT || 4151);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 4361);
const [CLNG, CLAT] = (process.env.CENTER || '-81.8,28.1').split(',').map(Number);
const ZOOM = +(process.env.ZOOM || 8);
const PANS = +(process.env.PANS || 12);
const RTT = +(process.env.RTT || 400);
const LOSS = +(process.env.LOSS || 0.01);
const SETTLE = +(process.env.SETTLE || 8000);
const WAIT = +(process.env.WAIT || 15000);
let seed = +(process.env.SEED || 7);
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };   // a seeded draw: the same run, the same losses
if (!CDN_DIR) throw Error('CDN_DIR=<a local copy of the weather-frames bucket> is required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const cdnStat = { requests: 0, dropped: 0, bytes: 0 };
const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const send = () => {
    if (MODE === 'net' && rnd() < LOSS) { cdnStat.dropped += 1; return req.destroy(); }   // a dropped connection
    if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(400, { 'access-control-allow-origin': '*' }); return res.end('{}'); }
    const body = fs.readFileSync(file); cdnStat.requests += 1; cdnStat.bytes += body.length;
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
      'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  };
  MODE === 'net' ? setTimeout(send, RTT) : send();
});

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  try { await loc.waitFor({ state: 'visible', timeout: 4000 }); await loc.evaluate((el) => el.click()); return; } catch (e) { /* phone: a control in a collapsed sheet */ }
  const ok = await page.waitForFunction((t) => { const b = [...document.querySelectorAll('button,[role="button"]')].find((x) => x.textContent.trim() === t); if (b) b.click(); return !!b; }, text, { timeout: 15000 });
  if (!(await ok.jsonValue())) throw Error(`no ${text} control`);
}

// In-page probe: long frames, the drawn model and the chip, the status line, per animation frame.
const PROBE = () => {
  const P = (window.__PN__ = { frames: 0, long: 0, maxGap: 0, last: 0, chipNew: [], silent: 0, statuses: {}, drawn: {} });
  const chip = () => { const b = [...document.querySelectorAll('button[aria-pressed="true"]')].filter((x) => x.offsetParent !== null && ['GFS', 'EURO', 'ICON'].includes(x.textContent.trim())); return b.length ? b[0].textContent.trim() : null; };
  let status = ''; let fc = 0;
  const loop = (t) => {
    if (P.last) { const g = t - P.last; if (g > 50) P.long += 1; if (g > P.maxGap) P.maxGap = g; }
    P.last = t; P.frames += 1;
    fc++; { status = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 160); }   // every frame: a status refreshed every 2nd frame made the frame after a chip click look silent (the toggle probe's old artifact)
    const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid; const m = g ? (g.__sourceModel || 'GFS') : null; const c = chip();
    if (m) P.drawn[m] = (P.drawn[m] || 0) + 1;
    if (m && c && m !== c && P.armed) { if (!/Loading|Verifying|does not match|pending|nearest|estimated/i.test(status)) P.silent += 1; }
    if (status) P.statuses[status] = (P.statuses[status] || 0) + 1;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

// A normalised ask key (path + sorted params) so a failed ask and its later retry compare equal whatever the encoding.
const norm = (pathname, params) => pathname + '?' + [...new URLSearchParams(params)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([a, b]) => `${a}=${b}`).join('&');
const keyOf = (q) => [q.path, q.q && q.q.model, q.q && q.q.layer, q.q && q.q.bbox, q.q && (q.q.hours || ''), q.q && (q.q.valid_time || '')].join('|');
function analyse(reqs) {
  const ok = reqs.filter((q) => !q.error); const failed = reqs.filter((q) => q.error);
  const by = {}; for (const q of ok) { const k = keyOf(q); (by[k] = by[k] || []).push(q); }
  const dups = Object.entries(by).filter(([, v]) => v.length > 1).map(([k, v]) => ({ k: k.slice(0, 120), n: v.length }));
  const perLayer = {}; for (const q of ok) { const l = (q.q && q.q.layer) || '?'; perLayer[l] = (perLayer[l] || 0) + 1; }
  return { asks: reqs.length, ok: ok.length, failed: failed.length, distinct: Object.keys(by).length, maxRepeat: Math.max(0, ...Object.values(by).map((v) => v.length)), repeated: dups.sort((a, b) => b.n - a.n).slice(0, 5), perLayer, byPath: ok.reduce((a, q) => { a[q.path] = (a[q.path] || 0) + 1; return a; }, {}) };
}

async function session() {
  const phone = MODE === 'phone';
  const failedKeys = new Set(); const log0 = [];
  const hooks = MODE === 'net' ? { beforeWeather: async (url) => {
    await sleep(RTT);
    if (rnd() < LOSS) { failedKeys.add(norm(url.pathname, url.searchParams)); throw Error('simulated loss'); }
  } } : {};
  const dims = phone ? { width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true, userAgent: PHONE_UA } } : { width: 844, height: 390, dpr: 2 };
  const { browser, page, log } = await L.launch({ port: PORT, hooks, ...dims });
  // The bundle client is the build's default since #552: only the kill is an arm.
  await page.addInitScript(({ base, arm }) => { localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base; if (arm === 'noregional') window.__RAW_DISABLE_REGIONAL_BUNDLES__ = true; }, { base: `http://127.0.0.1:${CDN_PORT}/`, arm: ARM });
  await page.addInitScript(PROBE);
  const out = { mode: MODE, arm: ARM, view: phone ? 'phone 390x844 dpr3 touch' : 'owner 844x390 dpr2', center: [CLNG, CLAT], zoom: ZOOM, rtt: MODE === 'net' ? RTT : 0, loss: MODE === 'net' ? LOSS : 0 };
  try {
    await L.openMap(page); await L.jump(page, CLNG, CLAT, ZOOM);
    await clickExact(page, 'Waves');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 90000 });
    await sleep(SETTLE);
    const state = () => page.evaluate(() => { const g = window.__RAW_GPU__ || {}; const f = window.__RAW_FRAME_STORE__; const e = window.__MARINE_ENGINE__; const t = g.cpuPhaseTiming && g.cpuPhaseTiming.buckets;
      return { gpuMemMB: g.gpuMemoryEstimate != null ? Math.round(g.gpuMemoryEstimate / 1048576) : null, textures: g.textureCount, tier: f ? f.tier : null, maskMode: e && e._lastMaskEncodeMode,
        maskPaints: t && t.maskWaterPaint ? t.maskWaterPaint.calls : null, stash: window.__RAW_MASK_STASH_SWAP__ || 0, regional: window.__RAW_STATIC_REGIONAL__ ? { hits: window.__RAW_STATIC_REGIONAL__.hits, series: window.__RAW_STATIC_REGIONAL__.series } : null }; });
    out.before = await state();
    await page.evaluate(() => { window.__PN__.armed = true; window.__PN__.long = 0; window.__PN__.maxGap = 0; window.__PN__.frames = 0; });
    const r0 = log.requests.length;
    if (phone) {
      const cdp = await page.context().newCDPSession(page);
      const pans = [];
      for (let i = 0; i < PANS; i++) {
        const dx = Math.round((rnd() - 0.5) * 120); const dy = Math.round((rnd() - 0.5) * 120);
        const a = log.requests.length; const t0 = Date.now();
        // A real touch drag on the map canvas: touchStart, small touchMove steps, touchEnd (MapLibre's own touch handling pans the map).
        const x0 = 195; const y0 = 420; const steps = 8;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
        for (let k = 1; k <= steps; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x0 + (dx * k) / steps), y: Math.round(y0 + (dy * k) / steps) }] }); await sleep(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(1200);
        const mid = await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const c = m.getCenter(); return [+c.lng.toFixed(3), +c.lat.toFixed(3)]; });
        const q = log.requests.slice(a); pans.push({ i, dx, dy, center: mid, asks: q.length, paths: q.map((x) => x.path.replace('/grid_series', '/gs')).join(',') });
      }
      out.pans = pans; out.moved = pans.filter((p, i) => i > 0 && (p.center[0] !== pans[i - 1].center[0] || p.center[1] !== pans[i - 1].center[1])).length;   // pans that moved the map
    } else {
      const wheel = page.locator(WHEEL).filter({ visible: true }).first();
      try { await wheel.focus(); for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await sleep(900); } } catch (e) { /* phone-style layouts: skip */ }
      await sleep(WAIT / 3);
      await clickExact(page, 'EURO'); await sleep(WAIT);
      await clickExact(page, 'GFS'); await sleep(WAIT);
    }
    await sleep(2500);
    const reqs = log.requests.slice(r0);
    out.requests = analyse(reqs);
    if (MODE === 'net') {
      // a retry = an ask whose key failed earlier and was asked again afterwards; a duplicate = asked again with no failure before it
      const seen = new Set(); let retried = 0; let dupNoFail = 0; const failedSoFar = new Set();
      for (const q of reqs) {
        if (q.error) { failedSoFar.add(norm(q.path, [])); continue; }   // an error record carries only the path: counted below via failedKeys
        const kk = norm('/api/weather' + q.path, q.q || {});
        if (seen.has(kk)) { if (failedKeys.has(kk)) retried += 1; else dupNoFail += 1; }
        seen.add(kk);
      }
      out.net = { failedAsks: reqs.filter((q) => q.error).length, failedKeys: failedKeys.size, retried, duplicatesWithoutAFailure: dupNoFail, cdn: { ...cdnStat } };
    }
    out.after = await state();
    out.probe = await page.evaluate(() => { const p = window.__PN__; const st = Object.entries(p.statuses).sort((a, b) => b[1] - a[1]).slice(0, 8); return { frames: p.frames, longFrames: p.long, maxGapMs: Math.round(p.maxGap), drawn: p.drawn, silentWrongModelFrames: p.silent, statuses: st }; });
    out.errors = log.errors.slice(0, 4); out.pageErrors = log.console.filter((c) => /error/i.test(c.type || '') ).length;
  } finally { await browser.close(); }
  return out;
}

(async () => {
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  let res;
  try { res = await session(); } catch (e) { res = { mode: MODE, arm: ARM, error: String(e && e.stack || e).slice(0, 800) }; }
  console.log(JSON.stringify(res, null, 1));
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
  cdn.close();
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
