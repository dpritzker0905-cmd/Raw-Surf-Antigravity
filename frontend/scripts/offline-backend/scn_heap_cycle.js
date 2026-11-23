// HEAP CYCLE (2026-11-23, the inspection's pass 5, SOTA-GAP-INSPECTION-2026-11-23: "The JS heap goes from about 106 MB after load
// to 1.8 to 2.1 GB at the end of the first full cycle, and rests at 0.8 to 1.1 GB afterwards"). Offline only (never the live box).
// One cycle = for each model in MODELS, for each layer chip in LAYERS: select it, press PageUp 14 times (day 14, STEP_GAP ms apart),
// press Home. Readings after each cycle (back on the first model and layer, hour 0, after REST ms):
//   usedMB   performance.memory.usedJSHeapSize (what the inspection read: includes garbage not yet collected)
//   gcMB     CDP HeapProfiler.collectGarbage, then Runtime.getHeapUsage().usedSize: the RETAINED heap
//   peakMB   the largest Runtime.getHeapUsage().usedSize sampled every second during the cycle (no GC)
//   backingMB  Runtime.getHeapUsage().backingStorageSize (ArrayBuffer stores, outside the JS heap) when Chrome reports it
//   budget   window.__RAW_CACHE_BUDGET__ (the cache budget's own accounting) when the build has one
// Scrub latency, per PageUp: `ms` (marine only) = from the key to the engine's resident at that hour and layer within STEP_GAP; `trueMs`
// = the TRUE latency from a page-side log of every change, however late (null = never before the layer's next visit): marine = the
// resident at that model, layer and hour; raster = the layer shows the frame it now wants (rasterDrawnFrame, shown == want after want
// moved); wind = the drawn frame's instant within 3 h of the step's. Steps (with long tasks and budget drops in each step's window) and
// p50 / p95 / misses per model x layer are written to OUT. Long tasks per cycle: PerformanceObserver('longtask').
// CDN: CDN_DIR (a local publish of the synthetic store) on CDN_PORT, plus the PUBLIC frame bucket for the raster sets the synthetic
// store has none of (gusts, currents, cloud cover, air temperature): set PROXY_ORIGIN to the public bucket's base URL (no default;
// nothing secret, but nothing is fetched unless asked). latest.json = the local sets + the origin's weather/ and CMEMS sets, read ONCE
// and frozen in PROXY_CACHE (both arms see the same runs). Each proxied object is fetched at most once ever (disk cache) and the
// proxy stops at PROXY_CAP_MB fetched (default 800; then 404) so the public bucket's egress stays bounded.
// Env: AB_BASE (REQUIRED), PORT (4263), CDN_DIR, CDN_PORT (4264), PROXY_ORIGIN, PROXY_CACHE, PROXY_CAP_MB, VIEW (desktop = 1024x768
// at DPR 2 as the inspection | phone = 375x812 at DPR 3, touch, Android UA), MODELS (GFS,EURO,ICON), LAYERS (Waves,Swell,Wind,Gusts,
// Currents,Satellite,Air Temp), CYCLES (2), STEP_GAP (450), REST (6000), ARMS (cur | <name>:<FLAG>+<FLAG>: window flags set true;
// <FLAG>=<number> sets a numeric lever, e.g. b128:__RAW_CACHE_BUDGET_MB__=128),
// SNAPSHOT (<cycle n>: a heap snapshot after that cycle's GC, to $OUT.<arm>.c<n>.heapsnapshot; read it with heap_census.cjs), OUT.
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
process.env.AB_CHROME_ARGS = [process.env.AB_CHROME_ARGS, '--enable-precise-memory-info'].filter(Boolean).join('|');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_heap_cycle is offline only');
if (!process.env.AB_BASE) throw Error('AB_BASE=http://127.0.0.1:<the SPA port serving the build under test> is required');
const PORT = +(process.env.PORT || 4263);
const CDN_DIR = process.env.CDN_DIR; const CDN_PORT = +(process.env.CDN_PORT || 4264);
const ORIGIN = (process.env.PROXY_ORIGIN || '').replace(/\/+$/, '');
const PROXY_CACHE = process.env.PROXY_CACHE || (CDN_DIR && path.join(CDN_DIR, '..', 'cdn-proxy-cache'));
const CAP = +(process.env.PROXY_CAP_MB || 800) * 1048576;
const VIEW = process.env.VIEW || 'desktop';
const VIEWS = {
  desktop: { width: 1024, height: 768, dpr: 2 },
  phone: { width: 375, height: 812, dpr: 3, contextOptions: { isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' } },
};
const MODELS = (process.env.MODELS || 'GFS,EURO,ICON').split(',');
const LAYERS = (process.env.LAYERS || 'Waves,Swell,Wind,Gusts,Currents,Satellite,Air Temp').split(',');
const MARINE = { Waves: 'waves', Swell: 'swell_1' };
const CYCLES = +(process.env.CYCLES || 2); const STEP_GAP = +(process.env.STEP_GAP || 450); const REST = +(process.env.REST || 6000);
const SNAPSHOT = +(process.env.SNAPSHOT || 0);
const ARMS = (process.env.ARMS || 'cur').split(',').map((a) => { const [name, flags] = a.split(':'); return { name, flags: flags ? flags.split('+') : [] }; });
const OUT = process.env.OUT || 'heap-cycle.json';
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!CDN_DIR) throw Error('CDN_DIR=<a local publish of the synthetic store> is required');

// ---- the CDN: local files, the frozen merged latest.json, and the capped proxy ----
const proxy = { fetchedBytes: 0, fetched: 0, hits: 0, refused: 0 };
const getOrigin = (rel) => new Promise((resolve) => {
  https.get(`${ORIGIN}/${rel}`, (res) => {
    if (res.statusCode !== 200) { res.resume(); return resolve(null); }
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
  }).on('error', () => resolve(null));
});
async function proxied(rel) {
  const file = path.join(PROXY_CACHE, rel);
  if (fs.existsSync(file)) { proxy.hits += 1; return fs.readFileSync(file); }
  if (!ORIGIN || proxy.fetchedBytes >= CAP) { proxy.refused += 1; return null; }
  const body = await getOrigin(rel);
  if (!body) return null;
  proxy.fetchedBytes += body.length; proxy.fetched += 1;
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body);
  return body;
}
const isOriginSet = (key) => /\/weather\//.test(key) || /^CMEMS\//.test(key);
async function mergedLatest() {
  const local = JSON.parse(fs.readFileSync(path.join(CDN_DIR, 'v1', 'latest.json'), 'utf8'));
  if (!ORIGIN && !fs.existsSync(path.join(PROXY_CACHE, 'v1', 'latest.origin.json'))) return local;
  const frozen = path.join(PROXY_CACHE, 'v1', 'latest.origin.json');
  let origin;
  if (fs.existsSync(frozen)) origin = JSON.parse(fs.readFileSync(frozen, 'utf8'));
  else { const b = await getOrigin('v1/latest.json'); if (!b) return local; fs.mkdirSync(path.dirname(frozen), { recursive: true }); fs.writeFileSync(frozen, b); origin = JSON.parse(b); }
  const sets = { ...local.sets };
  for (const [k, v] of Object.entries(origin.sets || {})) if (isOriginSet(k)) sets[k] = v;
  return { ...local, sets };
}
let latestBody = null;
const cdn = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const head = { 'access-control-allow-origin': '*' };
  let body = null;
  if (rel === 'v1/latest.json') { body = latestBody; head['cache-control'] = 'no-cache'; }
  else {
    const file = path.join(CDN_DIR, rel);
    if (file.startsWith(path.resolve(CDN_DIR)) && fs.existsSync(file) && fs.statSync(file).isFile()) body = fs.readFileSync(file);
    else if (/^v1\/(gfs|euro|icon)\/weather\//.test(rel) || /^v1\/cmems\//.test(rel)) body = await proxied(rel);
    head['cache-control'] = 'public, max-age=31536000, immutable';
  }
  if (!body) { res.writeHead(404, head); return res.end('{"statusCode":"404"}'); }
  res.writeHead(200, { ...head, 'content-length': body.length }); res.end(body);
});

// ---- the page probe: the marine resident, read by the step timer ----
const marineAt = ({ layer, hour }) => {
  const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
  return !!(g && g.hourOffset === hour && (g.__componentLayer || 'waves') === layer);
};
async function clickChip(page, text) {
  let loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  if (!(await loc.count())) {   // the phone keeps the chips in the weather sheet
    const sheet = page.locator('[aria-label="Weather layers"][aria-expanded="false"], [aria-label="Expand weather controls"]').filter({ visible: true }).first();
    if (await sheet.count()) { await sheet.click({ timeout: 3000 }).catch(() => sheet.evaluate((el) => el.click())); await sleep(400); }
    loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  }
  if (!(await loc.count())) return false;
  // A layer chip TOGGLES: clicking the active one turns the layer off (aria-pressed says which is on). Model chips have no pressed state.
  if ((await loc.getAttribute('aria-pressed')) === 'true') return true;
  await loc.evaluate((el) => el.click());
  return true;
}
async function focusWheel(page) {
  if (!(await page.locator(WHEEL).filter({ visible: true }).count())) {
    const sheet = page.locator('[aria-label="Weather layers"][aria-expanded="false"], [aria-label="Expand weather controls"]').filter({ visible: true }).first();
    if (await sheet.count()) { await sheet.click({ timeout: 3000 }).catch(() => sheet.evaluate((el) => el.click())); await sleep(400); }
  }
  const w = page.locator(WHEEL).filter({ visible: true }).first();
  if (!(await w.count())) return false;
  await w.focus(); return true;
}
const pct = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const MB = (x) => (x == null ? null : +(x / 1048576).toFixed(1));

async function session(arm) {
  const v = VIEWS[VIEW];
  const { browser, page, log } = await L.launch({ port: PORT, width: v.width, height: v.height, dpr: v.dpr, contextOptions: v.contextOptions || {} });
  const cdp = await page.context().newCDPSession(page);
  await page.addInitScript(({ base, flags }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base;
    localStorage.setItem('raw-surf-theme', 'dark');
    for (const f of flags) { const [n, v] = f.split('='); window[n] = v === undefined ? true : Number(v); }   // FLAG or FLAG=<number>
    // Every change of what is drawn, with its time: a step's TRUE latency, even past the next key. Marine: the engine's resident
    // (model, layer, hour). Raster: the layer's shown and wanted frame instants (rasterDrawnFrame). Wind: the drawn frame's instant.
    const log = (window.__HC_LOG__ = []); let last = '';
    const rlog = (window.__HC_RLOG__ = []); let lastR = '';
    const wlog = (window.__HC_WLOG__ = []); let lastW = '';
    const tick = () => {
      const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
      const k = g ? `${g.__sourceModel || 'GFS'}|${g.__componentLayer || 'waves'}|${g.hourOffset}` : '';
      if (k !== last) { last = k; if (log.length < 20000) log.push([performance.now(), k]); }
      const rd = window.__RASTER_DRAWN__;
      const s = rd && rd.shown ? rd.shown.dataMs : null; const w = rd && rd.want ? rd.want.dataMs : null;
      const k2 = rd ? `${rd.layer}|${s}|${w}` : '';
      if (k2 !== lastR) { lastR = k2; if (rlog.length < 20000) rlog.push([performance.now(), rd ? rd.layer : null, s, w]); }
      const wd = window.__WIND_DRAWN__;
      const k3 = wd ? `${wd.model}|${wd.dataMs}` : '';
      if (k3 !== lastW) { lastW = k3; if (wlog.length < 20000) wlog.push([performance.now(), wd ? wd.model : null, wd ? wd.dataMs : null]); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // Long tasks (a GC pause or a burst of work shows here), to set beside each step and each budget pass.
    const lt = (window.__HC_LT__ = []);
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (lt.length < 20000) lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* unsupported */ }
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, flags: arm.flags });
  const heap = async (gc) => {
    if (gc) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(300); await cdp.send('HeapProfiler.collectGarbage'); }
    const u = await cdp.send('Runtime.getHeapUsage');
    const used = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null));
    const budget = await page.evaluate(() => { const b = window.__RAW_CACHE_BUDGET__; return b && b.report ? b.report() : null; });
    return { usedMB: MB(used), heapMB: MB(u.usedSize), backingMB: MB(u.backingStorageSize), budget };
  };
  const readings = []; const steps = []; const misses = [];
  let bundle = null; let handheld = null;
  try {
    await L.openMap(page); await L.jump(page, -40, 20, 1.6);
    bundle = await page.evaluate(() => { const s = [...document.scripts].map((x) => x.src).find((x) => /\/main\.[0-9a-f]+\.js/.test(x)); return s ? s.split('/').pop() : null; });
    handheld = await page.evaluate(() => /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 1));
    if (!(await clickChip(page, 'Waves'))) throw Error('no Waves chip');
    await page.waitForFunction(() => window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid, null, { timeout: 60000 });
    await sleep(REST);
    readings.push({ at: 'baseline', ...(await heap(false)), gc: await heap(true) });
    for (let c = 1; c <= CYCLES; c++) {
      let peak = 0; let sampling = true;
      const sampler = (async () => { while (sampling) { try { const u = await cdp.send('Runtime.getHeapUsage'); peak = Math.max(peak, u.usedSize); } catch (e) { /* page busy */ } await sleep(1000); } })();
      const t0 = Date.now();
      for (const model of MODELS) {
        if (!(await clickChip(page, model))) misses.push({ c, model, what: 'model chip' });
        for (const layer of LAYERS) {
          if (!(await clickChip(page, layer))) { misses.push({ c, model, layer, what: 'layer chip' }); continue; }
          await sleep(800);
          if (!(await focusWheel(page))) { misses.push({ c, model, layer, what: 'wheel' }); continue; }
          let hour = 0;
          for (let k = 0; k < 14; k++) {
            hour = Math.min(336, hour + 24);
            const ml = MARINE[layer];
            const tk = Date.now();
            const [pk, anchor] = await page.evaluate(() => [performance.now(), Math.round((window.__MOCK_DATE_NOW__ || Date.now()) / 3600000) * 3600000]);
            await page.keyboard.press('PageUp');
            if (ml) {
              let ms = null;
              try { await page.waitForFunction(marineAt, { layer: ml, hour }, { timeout: STEP_GAP, polling: 'raf' }); ms = Date.now() - tk; } catch (e) { /* not reached */ }
              steps.push({ c, model, layer: ml, kind: 'marine', hour, ms, pk });
              const rest = STEP_GAP - (Date.now() - tk); if (rest > 0) await sleep(rest);
            } else {
              steps.push({ c, model, layer, kind: layer === 'Wind' ? 'wind' : 'raster', hour, ms: null, pk, targetMs: anchor + hour * 3600000 });
              await sleep(STEP_GAP);
            }
          }
          await page.keyboard.press('Home'); await sleep(300);
        }
      }
      await clickChip(page, MODELS[0]); await clickChip(page, LAYERS[0]);
      sampling = false; await sampler; const r0 = {};
      // TRUE latency per marine step of this cycle (the resident log): the first resident at that model, layer and hour after the
      // key, however late; `never` = not before the layer's next visit. `at` on a miss = what the resident was 450 ms after the key.
      const mlog = await page.evaluate(() => window.__HC_LOG__.splice(0));
      const rlog = await page.evaluate(() => window.__HC_RLOG__.splice(0));
      const wlog = await page.evaluate(() => window.__HC_WLOG__.splice(0));
      const lts = await page.evaluate(() => window.__HC_LT__.splice(0));
      const ring = await page.evaluate(() => { const b = window.__RAW_CACHE_BUDGET__; return b && b.report ? b.report().stats.ring : []; });
      for (const s of steps.filter((x) => x.c === c && x.pk != null)) {
        if (s.kind === 'marine') {
          const want = `${s.model}|${s.layer}|${s.hour}`;
          const hit = mlog.find(([t, k]) => t >= s.pk && k === want);
          s.trueMs = hit ? Math.round(hit[0] - s.pk) : null;
          if (s.ms == null) { const at = mlog.filter(([t]) => t <= s.pk + STEP_GAP).pop(); s.at = at ? at[1] : null; }
        } else if (s.kind === 'raster') {
          // Reached = the layer shows the frame it now wants, after the wanted frame moved off the one wanted before the key.
          const before = rlog.filter(([t]) => t < s.pk).pop(); const wantBefore = before ? before[3] : null;
          const hit = rlog.find(([t, , sh, w]) => t >= s.pk && w != null && w !== wantBefore && sh === w);
          s.trueMs = hit ? Math.round(hit[0] - s.pk) : null;
          // GUSTS draws the WIND particles along the wind grids (gustParticles.windParticlesWanted): time them too, as a wind step.
          if (s.layer === 'Gusts') {
            const wh = wlog.find(([t, , d]) => t >= s.pk && d != null && Math.abs(d - s.targetMs) <= 3 * 3600000);
            s.windTrueMs = wh ? Math.round(wh[0] - s.pk) : null;
          }
        } else {
          // Wind: the drawn frame's instant within 3 h of the step's (3-hourly frames; EURO's 6-hourly tail).
          const hit = wlog.find(([t, , d]) => t >= s.pk && d != null && Math.abs(d - s.targetMs) <= 3 * 3600000);
          s.trueMs = hit ? Math.round(hit[0] - s.pk) : null;
        }
        const win = (t, d = 0) => t + d >= s.pk && t <= s.pk + STEP_GAP;
        const mine = lts.filter(([t, d]) => win(t, d));
        s.longMs = mine.reduce((a, [, d]) => a + d, 0); s.longMax = mine.reduce((a, [, d]) => Math.max(a, d), 0);
        s.budgetDrops = ring.filter((r) => win(r.t)).reduce((a, r) => a + r.dropped, 0);
      }
      r0.longTasks = { n: lts.length, totalMs: Math.round(lts.reduce((a, [, d]) => a + d, 0)), maxMs: Math.round(lts.reduce((a, [, d]) => Math.max(a, d), 0)) };
      r0.budgetPasses = ring.length;
      await sleep(REST);
      const r = { at: `cycle${c}`, seconds: Math.round((Date.now() - t0) / 1000), peakMB: MB(peak), ...r0, ...(await heap(false)), gc: await heap(true) };
      if (SNAPSHOT === c) {
        const file = `${OUT}.${arm.name}.c${c}.heapsnapshot`; const ws = fs.createWriteStream(file);
        const onChunk = (p) => ws.write(p.chunk); cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
        await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
        cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk); await new Promise((res) => ws.end(res)); r.snapshot = file;
      }
      readings.push(r);
      console.log(`${arm.name} ${VIEW} ${r.at}: used ${r.usedMB} MB, gc ${r.gc.heapMB} MB, peak ${r.peakMB} MB, backing ${r.gc.backingMB} MB, ${r.seconds} s`);
    }
  } finally { await browser.close(); }
  const scrub = {};
  for (const s of steps) { const k = `${s.model}|${s.layer}`; (scrub[k] = scrub[k] || []).push(s); }
  const sum = (a) => ({ p50: pct(a.map((s) => s.ms), 0.5), p95: pct(a.map((s) => s.ms), 0.95), missed: a.filter((s) => s.ms == null).length,
    trueP50: pct(a.map((s) => s.trueMs), 0.5), trueP95: pct(a.map((s) => s.trueMs), 0.95), never: a.filter((s) => s.trueMs == null).length, n: a.length });
  const scrubSummary = Object.fromEntries(Object.entries(scrub).map(([k, a]) => [k, sum(a)]));
  return { arm: arm.name, view: VIEW, bundle, handheld, readings, scrub: scrubSummary, scrubAll: sum(steps), steps,
    misses, weatherAsks: log.requests.length, errors: log.errors.slice(0, 5) };
}

(async () => {
  latestBody = Buffer.from(JSON.stringify(await mergedLatest()));
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const out = { env: { VIEW, MODELS, LAYERS, CYCLES, STEP_GAP, REST, ARMS, startedUtc: new Date().toISOString() }, sessions: [], proxy };
  try {
    for (const arm of ARMS) {
      let s; try { s = await session(arm); } catch (e) { s = { arm: arm.name, error: String(e && e.stack || e).slice(0, 400) }; }
      out.sessions.push(s);
      console.log(JSON.stringify({ arm: s.arm, view: VIEW, bundle: s.bundle, handheld: s.handheld, scrubAll: s.scrubAll, misses: (s.misses || []).length, error: s.error }));
      fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    }
  } finally {
    out.proxy = { ...proxy, fetchedMB: MB(proxy.fetchedBytes) };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); cdn.close();
    console.log('proxy', JSON.stringify(out.proxy));
  }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
