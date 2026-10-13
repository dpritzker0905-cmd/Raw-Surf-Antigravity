/**
 * AUDIT 13.1 — JACOBIAN MATRIX + INTERACTION RESIDUALS (v2, resilient)
 * node jac2.js <baseUrl> <outDir> <tag>
 */
const { chromium } = require('C:/Users/dprit/Raw-Surf/frontend/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-13.1/evidence/jacobian-tests';
const TAG = process.argv[4] || 'local';
fs.mkdirSync(OUT, { recursive: true });

const user = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer', username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const L = [];
const say = (s) => { console.log(s); L.push(s); try { fs.writeFileSync(path.join(OUT, `${TAG}-jacobian-log.txt`), L.join('\n')); } catch (e) { } };

const INIT = () => {
  const C = { rafCalls: 0, rafOwners: {}, workerCount: 0, workersEver: 0, glContexts: 0,
    texCreate: 0, texDelete: 0, bufCreate: 0, bufDelete: 0, fbCreate: 0, fbDelete: 0, progCreate: 0,
    intervals: 0, intervalsCleared: 0, fetches: 0, fetchUrls: [] };
  window.__A__ = C;
  const site = () => { const st = (new Error()).stack || ''; for (const l of st.split('\n').slice(2)) { const m = l.match(/(https?:\/\/[^\s)]+)/); if (m) return m[1].replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 110); } return 'unknown'; };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) { C.rafCalls++; const s = site(); C.rafOwners[s] = (C.rafOwners[s] || 0) + 1; return raf(cb); };
  const W = window.Worker;
  if (W) { window.Worker = function (u, o) { C.workerCount++; C.workersEver++; const w = new W(u, o); const t = w.terminate.bind(w); w.terminate = function () { C.workerCount--; return t(); }; return w; }; window.Worker.prototype = W.prototype; }
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) {
    const c = gc.call(this, t, a);
    if (c && /webgl/.test(String(t))) { C.glContexts++;
      for (const [f, k] of [['createTexture','texCreate'],['deleteTexture','texDelete'],['createBuffer','bufCreate'],['deleteBuffer','bufDelete'],['createFramebuffer','fbCreate'],['deleteFramebuffer','fbDelete'],['createProgram','progCreate']]) {
        if (typeof c[f] === 'function') { const o = c[f].bind(c); c[f] = function () { C[k]++; return o.apply(null, arguments); }; } } }
    return c; };
  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function () { C.intervals++; return si.apply(window, arguments); };
  window.clearInterval = function () { C.intervalsCleared++; return ci.apply(window, arguments); };
  const of_ = window.fetch;
  window.fetch = function (u) { C.fetches++; try { C.fetchUrls.push(String(u && u.url ? u.url : u).split('?')[0].slice(0, 130)); } catch (e) { } return of_.apply(window, arguments); };
};

const READ = () => {
  const C = window.__A__ || {};
  let m = window.__M__;
  if (!m || typeof m.getZoom !== 'function') { m = null;
    for (const kk of Object.keys(window)) { try { const v = window[kk];
      if (v && typeof v.isStyleLoaded === 'function' && typeof v.getZoom === 'function' && typeof v.jumpTo === 'function') { window.__M__ = v; m = v; break; } } catch (e) { } } }
  let map = null;
  if (m) { try { const st = m.getStyle && m.getStyle();
    map = { zoom: +m.getZoom().toFixed(3), lng: +m.getCenter().lng.toFixed(4), lat: +m.getCenter().lat.toFixed(4),
      bearing: +m.getBearing().toFixed(1), pitch: +m.getPitch().toFixed(1), styleLoaded: !!m.isStyleLoaded(),
      layers: st && st.layers ? st.layers.length : 0, sources: st && st.sources ? Object.keys(st.sources).length : 0,
      marineLayers: st && st.layers ? st.layers.filter(l => /marine|wave|swell|wind|ocean-mask|water_temp|heatmap|fog|precip|radar/i.test(l.id)).map(l => l.id) : [],
      canvasW: m.getCanvas().width, canvasH: m.getCanvas().height }; } catch (e) { map = { err: String(e).slice(0, 80), layers: 0, sources: 0 }; } }
  const body = document.body.innerText || '';
  const grab = (label) => { const i = body.indexOf(label); if (i < 0) return null;
    const s = body.slice(i + label.length, i + label.length + 160).split('\n').filter(Boolean); return (s[0] || '').trim().slice(0, 60); };
  const hud = { modelLayer: grab('Model / Layer:'), renderMode: grab('Render Mode:'), rasterSource: grab('Raster Source:'),
    provider: grab('Provider:'), klass: grab('Class:'),
    truth: (() => { const i = body.indexOf('TRUTH VIOLATIONS'); return i < 0 ? null : body.slice(i + 16, i + 200).replace(/\s+/g, ' ').trim().slice(0, 160); })() };
  const legend = (() => { const i = body.search(/(Wind Speed \(kts\)|Combined Waves|Primary Swell|Secondary Swell|Wind Waves \(|Water Temp \(|Visibility \/ Fog|Pressure \(hPa\)|Air Temp)/); return i < 0 ? null : body.slice(i, i + 40).split('\n')[0]; })();
  return { rafCalls: C.rafCalls, rafOwnerSites: Object.keys(C.rafOwners || {}).length,
    rafTop: Object.entries(C.rafOwners || {}).sort((a, b) => b[1] - a[1]).slice(0, 6),
    workerCount: C.workerCount, workersEver: C.workersEver, glContexts: C.glContexts,
    texLive: C.texCreate - C.texDelete, texCreate: C.texCreate, bufLive: C.bufCreate - C.bufDelete,
    fbLive: C.fbCreate - C.fbDelete, programs: C.progCreate, intervalsLive: C.intervals - C.intervalsCleared,
    fetches: C.fetches, gridFetches: (C.fetchUrls || []).filter(u => /grid_series|\/weather\/grid/.test(u)).length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null,
    canvases: document.querySelectorAll('canvas').length, domNodes: document.querySelectorAll('*').length,
    map, hud, legend,
    pressed: [...document.querySelectorAll('[aria-pressed="true"]')].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)) };
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const netReq = []; const netFail = []; const consoleErrs = [];
  page.on('request', r => netReq.push(r.url().split('?')[0]));
  page.on('requestfailed', r => netFail.push(r.url().split('?')[0]));
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 220)); });

  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'dark');
  }, { u: user });
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await sleep(10000);

  const ensureMap = async (label) => {
    for (let i = 0; i < 30; i++) {
      const k = await page.evaluate(() => {
        if (window.__M__ && typeof window.__M__.getZoom === 'function') { try { window.__M__.getZoom(); return 'cached'; } catch (e) { } }
        for (const kk of Object.keys(window)) { try { const v = window[kk];
          if (v && typeof v.isStyleLoaded === 'function' && typeof v.getZoom === 'function' && typeof v.jumpTo === 'function') { window.__M__ = v; return kk; } } catch (e) { } }
        return null; });
      if (k) return k;
      await sleep(2000);
    }
    say(`  !! ensureMap FAILED after 60s ${label || ''}`);
    return null;
  };
  const k0 = await ensureMap('initial');
  say(`map handle: ${k0}`);

  const click = async (label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find(e => (e.textContent || '').trim() === l);
    if (!b) return false; b.click(); return true; }, label);
  const jump = async (lng, lat, z) => page.evaluate(({ lng, lat, z }) => {
    if (window.__M__) window.__M__.jumpTo({ center: [lng, lat], zoom: z }); }, { lng, lat, z });

  const HOME = { lng: -80.607, lat: 28.361, z: 8 };
  const toBaseline = async (settle = 7000) => {
    await ensureMap('toBaseline');
    await click('GFS'); await sleep(500);
    await click('Wind'); await sleep(500);
    await page.evaluate(() => { const m = window.__M__; if (m) { try { m.setBearing(0); m.setPitch(0); } catch (e) { } } });
    await jump(HOME.lng, HOME.lat, HOME.z);
    await sleep(settle);
    return page.evaluate(READ);
  };

  // ---------- NOISE ----------
  say('=== NOISE ESTIMATE (4 identical baselines) ===');
  const noise = [];
  for (let i = 0; i < 4; i++) { const b = await toBaseline(7000); noise.push(b);
    say(` noise[${i}] z=${b.map && b.map.zoom} layers=${b.map && b.map.layers} rafSites=${b.rafOwnerSites} tex=${b.texLive} buf=${b.bufLive} workers=${b.workerCount} gl=${b.glContexts} intervals=${b.intervalsLive} hud=${b.hud.modelLayer}|${b.hud.rasterSource}|${b.hud.provider}|${b.hud.klass} legend=${b.legend}`); }
  const band = (k) => { const v = noise.map(n => (typeof n[k] === 'number' ? n[k] : null)).filter(x => x !== null);
    return v.length ? { min: Math.min(...v), max: Math.max(...v), spread: Math.max(...v) - Math.min(...v) } : null; };
  const lv = noise.map(n => (n.map && n.map.layers) || 0);
  const NOISE = { texLive: band('texLive'), bufLive: band('bufLive'), rafOwnerSites: band('rafOwnerSites'),
    workerCount: band('workerCount'), glContexts: band('glContexts'), intervalsLive: band('intervalsLive'),
    canvases: band('canvases'), programs: band('programs'),
    layers: { min: Math.min(...lv), max: Math.max(...lv), spread: Math.max(...lv) - Math.min(...lv) } };
  say('NOISE BAND: ' + JSON.stringify(NOISE));
  fs.writeFileSync(path.join(OUT, `${TAG}-noise-estimate.json`), JSON.stringify({ noise, NOISE }, null, 2));

  // ---------- FIRST ORDER ----------
  const results = [];
  const probe = async (name, input, delta, apply) => {
    const before = await toBaseline(7000);
    const rq0 = netReq.length, rf0 = netFail.length;
    await apply();
    const after = await page.evaluate(READ);
    const g = (o, k) => (o && o.map && typeof o.map[k] === 'number') ? o.map[k] : 0;
    const d = { probe: name, input, delta,
      d_layers: g(after, 'layers') - g(before, 'layers'), d_sources: g(after, 'sources') - g(before, 'sources'),
      d_rafOwnerSites: after.rafOwnerSites - before.rafOwnerSites, d_workerCount: after.workerCount - before.workerCount,
      d_workersEver: after.workersEver - before.workersEver, d_glContexts: after.glContexts - before.glContexts,
      d_texLive: after.texLive - before.texLive, d_texCreate: after.texCreate - before.texCreate,
      d_bufLive: after.bufLive - before.bufLive, d_fbLive: after.fbLive - before.fbLive,
      d_programs: after.programs - before.programs, d_intervalsLive: after.intervalsLive - before.intervalsLive,
      d_canvases: after.canvases - before.canvases,
      d_heapMB: (after.heapMB != null && before.heapMB != null) ? +(after.heapMB - before.heapMB).toFixed(2) : null,
      d_requests: netReq.length - rq0, d_failed: netFail.length - rf0,
      d_gridFetches: after.gridFetches - before.gridFetches,
      canvasWH_before: before.map ? [before.map.canvasW, before.map.canvasH] : null,
      canvasWH_after: after.map ? [after.map.canvasW, after.map.canvasH] : null,
      hud_before: before.hud, hud_after: after.hud, legend_before: before.legend, legend_after: after.legend,
      zoom_before: g(before, 'zoom'), zoom_after: g(after, 'zoom'),
      marineLayers_before: before.map ? (before.map.marineLayers || []).length : 0,
      marineLayers_after: after.map ? (after.map.marineLayers || []).length : 0 };
    results.push(d);
    say(`[J] ${name.padEnd(26)} dLay=${String(d.d_layers).padStart(3)} dRafS=${String(d.d_rafOwnerSites).padStart(3)} dWrk=${String(d.d_workerCount).padStart(3)} dGL=${String(d.d_glContexts).padStart(2)} dTex=${String(d.d_texLive).padStart(5)} dBuf=${String(d.d_bufLive).padStart(5)} dCv=${String(d.d_canvases).padStart(2)} dInt=${String(d.d_intervalsLive).padStart(3)} dReq=${String(d.d_requests).padStart(4)} dFail=${String(d.d_failed).padStart(3)} | ${d.hud_before.modelLayer}->${d.hud_after.modelLayer} | raster ${d.hud_before.rasterSource}->${d.hud_after.rasterSource} | legend ${d.legend_before}->${d.legend_after}`);
    fs.writeFileSync(path.join(OUT, `${TAG}-jacobian-first-order.json`), JSON.stringify(results, null, 2));
    return d;
  };

  say('=== FIRST-ORDER JACOBIAN ===');
  await probe('zoom_+3_(8to11)', 'zoom', '+3', async () => { await jump(HOME.lng, HOME.lat, 11); await sleep(7000); });
  await probe('zoom_-3_(8to5)', 'zoom', '-3', async () => { await jump(HOME.lng, HOME.lat, 5); await sleep(7000); });
  await probe('zoom_+5_(8to13)', 'zoom', '+5', async () => { await jump(HOME.lng, HOME.lat, 13); await sleep(7000); });
  await probe('pan_lon_+2.6deg', 'longitude', '+2.6', async () => { await jump(-78.0, HOME.lat, 8); await sleep(7000); });
  await probe('pan_lat_+12deg', 'latitude', '+12', async () => { await jump(HOME.lng, 40.4, 8); await sleep(7000); });
  await probe('bearing_+45', 'bearing', '+45', async () => { await page.evaluate(() => { if (window.__M__) window.__M__.setBearing(45); }); await sleep(6000); });
  await probe('pitch_+45', 'pitch', '+45', async () => { await page.evaluate(() => { if (window.__M__) window.__M__.setPitch(45); }); await sleep(6000); });
  await probe('antimeridian_179.6', 'longitude', 'to 179.6', async () => { await jump(179.6, -17.6, 6); await sleep(7000); });
  await probe('highlat_66.5', 'latitude', 'to 66.5', async () => { await jump(-20.0, 66.5, 5); await sleep(7000); });
  await probe('model_to_EURO', 'model', 'EURO', async () => { await click('EURO'); await sleep(9000); });
  await probe('model_to_ICON', 'model', 'ICON', async () => { await click('ICON'); await sleep(9000); });
  await probe('layer_to_waves', 'layer', 'waves', async () => { await click('Waves'); await sleep(9000); });
  await probe('layer_to_swell1', 'layer', 'swell_1', async () => { await click('Swell'); await sleep(9000); });
  await probe('layer_to_swell2', 'layer', 'swell_2', async () => { await click('Swell 2'); await sleep(9000); });
  await probe('layer_to_watertemp', 'layer', 'water_temp', async () => { await click('Water Temp'); await sleep(9000); });
  await probe('layer_to_fog', 'layer', 'fog', async () => { await click('Fog'); await sleep(9000); });
  await probe('layer_to_precip', 'layer', 'rain', async () => { await click('Precip'); await sleep(9000); });
  await probe('time_+1h', 'forecast_hour', '+1h', async () => { await click('+1h'); await sleep(8000); });
  await probe('time_+1d', 'forecast_hour', '+1d', async () => { await click('+1d'); await sleep(9000); });
  await probe('time_-1d', 'forecast_hour', '-1d', async () => { await click('−1d'); await sleep(9000); });
  await probe('viewport_800x600', 'viewport', '800x600', async () => { await page.setViewportSize({ width: 800, height: 600 }); await sleep(7000); });
  await page.setViewportSize({ width: 1280, height: 800 }); await sleep(3000);
  await probe('viewport_1920x1080', 'viewport', '1920x1080', async () => { await page.setViewportSize({ width: 1920, height: 1080 }); await sleep(7000); });
  await page.setViewportSize({ width: 1280, height: 800 }); await sleep(3000);
  await probe('tab_hidden_8s', 'visibility', 'hidden', async () => {
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(8000); });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(4000);

  // hidden RAF ownership, tight window (same JS context)
  say('=== RAF OWNERSHIP UNDER HIDDEN ===');
  const h0 = await toBaseline(8000);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(8000);
  const h1 = await page.evaluate(READ);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(8000);
  const h2 = await page.evaluate(READ);
  const hiddenRes = { rafDelta_hidden8s: h1.rafCalls - h0.rafCalls, rafPerSec_hidden: +((h1.rafCalls - h0.rafCalls) / 8).toFixed(1),
    rafDelta_visible8s: h2.rafCalls - h1.rafCalls, rafPerSec_visible: +((h2.rafCalls - h1.rafCalls) / 8).toFixed(1),
    fetchDelta_hidden: h1.fetches - h0.fetches, texDelta_hidden: h1.texLive - h0.texLive };
  say('HIDDEN: ' + JSON.stringify(hiddenRes));
  fs.writeFileSync(path.join(OUT, `${TAG}-hidden-raf.json`), JSON.stringify({ hiddenRes, h0, h1, h2 }, null, 2));

  // ---------- SECOND ORDER ----------
  say('=== SECOND-ORDER INTERACTION RESIDUALS ===');
  const residuals = [];
  const metric = (r) => ({ layers: (r.map && r.map.layers) || 0, texLive: r.texLive, bufLive: r.bufLive,
    rafSites: r.rafOwnerSites, workers: r.workerCount, gl: r.glContexts, canvases: r.canvases,
    intervals: r.intervalsLive, programs: r.programs, marineLayers: (r.map && (r.map.marineLayers || []).length) || 0 });
  const sub = (a, b) => { const o = {}; for (const k of Object.keys(a)) o[k] = +(a[k] - b[k]).toFixed(2); return o; };
  const resid = (dXY, dX, dY) => { const o = {}; for (const k of Object.keys(dXY)) o[k] = +(dXY[k] - dX[k] - dY[k]).toFixed(2); return o; };

  const pair = async (name, labelX, labelY, applyX, applyY) => {
    const f0 = metric(await toBaseline(8000)); await applyX(); const fx = metric(await page.evaluate(READ)); const dX = sub(fx, f0);
    const f0b = metric(await toBaseline(8000)); await applyY(); const fy = metric(await page.evaluate(READ)); const dY = sub(fy, f0b);
    const f0c = metric(await toBaseline(8000)); await applyX(); await applyY(); const fxy = metric(await page.evaluate(READ)); const dXY = sub(fxy, f0c);
    const I = resid(dXY, dX, dY);
    const row = { pair: name, x: labelX, y: labelY, f0, f0b, f0c, fx, fy, fxy, dX, dY, dXY, residual: I };
    residuals.push(row);
    say(`[I] ${name.padEnd(28)} dX=${JSON.stringify(dX)}\n     dY=${JSON.stringify(dY)}\n     dXY=${JSON.stringify(dXY)}\n     RESID=${JSON.stringify(I)}`);
    fs.writeFileSync(path.join(OUT, `${TAG}-interaction-residuals.json`), JSON.stringify(residuals, null, 2));
    return row;
  };

  await pair('zoom x layerSwitch', 'zoom 8->12', 'layer wind->waves',
    async () => { await jump(HOME.lng, HOME.lat, 12); await sleep(7000); },
    async () => { await click('Waves'); await sleep(8000); });
  await pair('modelSwitch x timeScrub', 'GFS->EURO', 'time +1d',
    async () => { await click('EURO'); await sleep(8000); },
    async () => { await click('+1d'); await sleep(8000); });
  await pair('layerSwitch x mapMove', 'wind->waves', 'pan Portugal z9',
    async () => { await click('Waves'); await sleep(8000); },
    async () => { await jump(-9.4, 38.7, 9); await sleep(7000); });
  await pair('resize x zoom', 'resize 1280->1920', 'zoom 8->12',
    async () => { await page.setViewportSize({ width: 1920, height: 1080 }); await sleep(6000); },
    async () => { await jump(HOME.lng, HOME.lat, 12); await sleep(7000); });
  await page.setViewportSize({ width: 1280, height: 800 }); await sleep(3000);
  await pair('antimeridian x zoom', 'to antimeridian', 'zoom to 12',
    async () => { await jump(179.6, -17.6, 6); await sleep(7000); },
    async () => { await page.evaluate(() => { if (window.__M__) window.__M__.zoomTo(12); }); await sleep(7000); });
  await pair('hidden x timeScrub', 'hide+restore', 'time +1d',
    async () => { await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await sleep(6000);
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await sleep(4000); },
    async () => { await click('+1d'); await sleep(8000); });
  await pair('layerSwitch x modelSwitch', 'wind->waves', 'GFS->EURO',
    async () => { await click('Waves'); await sleep(8000); },
    async () => { await click('EURO'); await sleep(8000); });

  fs.writeFileSync(path.join(OUT, `${TAG}-console-errors.json`), JSON.stringify(consoleErrs.slice(0, 500), null, 2));
  fs.writeFileSync(path.join(OUT, `${TAG}-failed-requests.json`), JSON.stringify(
    Object.entries(netFail.reduce((a, u) => { a[u] = (a[u] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 40), null, 2));
  say(`=== DONE === totalRequests=${netReq.length} totalFailed=${netFail.length} consoleErrors=${consoleErrs.length}`);
  await ctx.close(); await browser.close();
})().catch(e => { console.error('FATAL', e); try { fs.writeFileSync(path.join(OUT, `${TAG}-FATAL.txt`), String((e && e.stack) || e) + '\n\n' + L.join('\n')); } catch (x) { } process.exit(1); });
