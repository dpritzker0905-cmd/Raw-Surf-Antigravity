/**
 * AUDIT 13.1 — BLIND CURRENT-STATE SNAPSHOT + LIFECYCLE INSTRUMENTATION
 * Read-only. Drives real visible controls. Captures console, network, RAF owners,
 * workers, WebGL contexts/textures/buffers, timers, MapLibre layers, heap.
 *
 * node blindsnap.js [baseUrl] [outDir] [tag]
 */
const { chromium } = require('C:/Users/dprit/Raw-Surf/frontend/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-13.1/evidence';
const TAG = process.argv[4] || 'blind';

const SHOT = path.join(OUT, 'screenshots');
const REC = path.join(OUT, 'recordings');
const CONS = path.join(OUT, 'console');
const NET = path.join(OUT, 'network');

const user = {
  id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer',
  username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const say = (s) => { console.log(s); log.push(s); };

// ---- injected before any page script: census hooks ----
const INIT = () => {
  const C = {
    rafCalls: 0, rafOwners: {}, workers: [], workerCount: 0,
    glContexts: 0, texCreate: 0, texDelete: 0, bufCreate: 0, bufDelete: 0,
    fbCreate: 0, fbDelete: 0, progCreate: 0,
    timeouts: 0, intervals: 0, intervalsCleared: 0,
    listeners: {}, ctxLost: 0,
  };
  window.__AUDIT131__ = C;

  const site = (skip) => {
    const st = (new Error()).stack || '';
    const lines = st.split('\n').slice(skip + 1);
    for (const l of lines) {
      const m = l.match(/\(?(https?:\/\/[^\s)]+)\)?/);
      if (m && !/__AUDIT/.test(l)) return m[1].replace(/^https?:\/\/[^/]+/, '').slice(0, 120);
    }
    return 'unknown';
  };

  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    C.rafCalls++;
    const s = site(1);
    C.rafOwners[s] = (C.rafOwners[s] || 0) + 1;
    return raf(cb);
  };

  const W = window.Worker;
  if (W) {
    window.Worker = function (u, o) {
      C.workerCount++;
      try { C.workers.push(String(u).slice(0, 160)); } catch (e) { C.workers.push('blob'); }
      const w = new W(u, o);
      const term = w.terminate.bind(w);
      w.terminate = function () { C.workerCount--; return term(); };
      return w;
    };
    window.Worker.prototype = W.prototype;
  }

  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) {
    const ctx = gc.call(this, t, a);
    if (ctx && /webgl/.test(String(t))) {
      C.glContexts++;
      this.addEventListener('webglcontextlost', () => { C.ctxLost++; });
      for (const [fn, key] of [['createTexture', 'texCreate'], ['deleteTexture', 'texDelete'],
        ['createBuffer', 'bufCreate'], ['deleteBuffer', 'bufDelete'],
        ['createFramebuffer', 'fbCreate'], ['deleteFramebuffer', 'fbDelete'],
        ['createProgram', 'progCreate']]) {
        if (typeof ctx[fn] === 'function') {
          const orig = ctx[fn].bind(ctx);
          ctx[fn] = function () { C[key]++; return orig.apply(null, arguments); };
        }
      }
    }
    return ctx;
  };

  const sto = window.setTimeout, sti = window.setInterval, cli = window.clearInterval;
  window.setTimeout = function () { C.timeouts++; return sto.apply(window, arguments); };
  window.setInterval = function () { C.intervals++; return sti.apply(window, arguments); };
  window.clearInterval = function () { C.intervalsCleared++; return cli.apply(window, arguments); };

  const ael = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t) {
    C.listeners[t] = (C.listeners[t] || 0) + 1;
    return ael.apply(this, arguments);
  };
  const rel = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.removeEventListener = function (t) {
    C.listeners[t] = (C.listeners[t] || 0) - 1;
    return rel.apply(this, arguments);
  };
};

// ---- in-page census read ----
const CENSUS = () => {
  const C = window.__AUDIT131__ || {};
  const m = window.__M__;
  let map = null;
  if (m) {
    try {
      const st = m.getStyle && m.getStyle();
      map = {
        zoom: +m.getZoom().toFixed(3),
        center: m.getCenter ? [+m.getCenter().lng.toFixed(4), +m.getCenter().lat.toFixed(4)] : null,
        bearing: m.getBearing ? +m.getBearing().toFixed(1) : null,
        pitch: m.getPitch ? +m.getPitch().toFixed(1) : null,
        styleLoaded: !!(m.isStyleLoaded && m.isStyleLoaded()),
        layers: st && st.layers ? st.layers.length : null,
        sources: st && st.sources ? Object.keys(st.sources).length : null,
        customLayers: st && st.layers ? st.layers.filter(l => l.type === 'custom').map(l => l.id) : [],
        marineLayers: st && st.layers ? st.layers.filter(l => /marine|wave|swell|wind|ocean|mask|water/i.test(l.id)).map(l => l.id) : [],
      };
    } catch (e) { map = { error: String(e).slice(0, 120) }; }
  }
  const rafTop = Object.entries(C.rafOwners || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const lis = Object.entries(C.listeners || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return {
    rafCalls: C.rafCalls, rafOwnerSites: Object.keys(C.rafOwners || {}).length, rafTop,
    workerCount: C.workerCount, workers: C.workers,
    glContexts: C.glContexts, ctxLost: C.ctxLost,
    tex: { c: C.texCreate, d: C.texDelete, live: C.texCreate - C.texDelete },
    buf: { c: C.bufCreate, d: C.bufDelete, live: C.bufCreate - C.bufDelete },
    fb: { c: C.fbCreate, d: C.fbDelete, live: C.fbCreate - C.fbDelete },
    programs: C.progCreate,
    timeouts: C.timeouts, intervals: C.intervals, intervalsCleared: C.intervalsCleared,
    intervalsLive: C.intervals - C.intervalsCleared,
    listeners: lis,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    map,
    domNodes: document.querySelectorAll('*').length,
    canvases: document.querySelectorAll('canvas').length,
    url: location.pathname,
  };
};

const findMap = () => {
  for (const k of Object.keys(window)) {
    try {
      const v = window[k];
      if (v && typeof v.isStyleLoaded === 'function' && typeof v.getZoom === 'function') { window.__M__ = v; return k; }
    } catch (e) { }
  }
  return null;
};

(async () => {
  for (const d of [SHOT, REC, CONS, NET, OUT]) fs.mkdirSync(d, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    recordVideo: { dir: REC, size: { width: 1280, height: 800 } },
  });
  await ctx.addInitScript(INIT);
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  const page = await ctx.newPage();

  const consoleLog = [], netLog = [], pageErrors = [];
  page.on('console', (m) => consoleLog.push({ t: Date.now(), type: m.type(), text: m.text().slice(0, 400) }));
  page.on('pageerror', (e) => pageErrors.push({ t: Date.now(), msg: String(e).slice(0, 400) }));
  page.on('request', (r) => netLog.push({ t: Date.now(), phase: 'req', method: r.method(), url: r.url().slice(0, 300), rt: r.resourceType() }));
  page.on('response', (r) => netLog.push({ t: Date.now(), phase: 'res', status: r.status(), url: r.url().slice(0, 300) }));
  page.on('requestfailed', (r) => netLog.push({ t: Date.now(), phase: 'fail', url: r.url().slice(0, 300), err: (r.failure() || {}).errorText }));

  const marks = [];
  const mark = async (name, shot) => {
    const c = await page.evaluate(CENSUS).catch((e) => ({ error: String(e).slice(0, 200) }));
    c.__mark = name; c.__t = Date.now();
    c.__consoleErrors = consoleLog.filter(x => x.type === 'error').length;
    c.__consoleWarns = consoleLog.filter(x => x.type === 'warning').length;
    c.__requests = netLog.filter(x => x.phase === 'req').length;
    c.__failed = netLog.filter(x => x.phase === 'fail').length;
    marks.push(c);
    say(`[MARK ${name}] z=${c.map && c.map.zoom} layers=${c.map && c.map.layers} raf=${c.rafCalls} rafSites=${c.rafOwnerSites} workers=${c.workerCount} gl=${c.glContexts} texLive=${c.tex && c.tex.live} bufLive=${c.buf && c.buf.live} intervalsLive=${c.intervalsLive} heap=${c.heapMB}MB reqs=${c.__requests} err=${c.__consoleErrors}`);
    if (shot) await page.screenshot({ path: path.join(SHOT, `${TAG}-${name}.png`) }).catch(() => { });
    return c;
  };

  // ---------- 1. clean load ----------
  say(`=== AUDIT 13.1 BLIND SNAPSHOT — ${BASE} — ${new Date().toISOString()} ===`);
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'dark');
  }, { u: user });

  const t0 = Date.now();
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await sleep(14000);
  const mapKey = await page.evaluate(findMap);
  say(`map handle: ${mapKey}`);
  const tMapReady = Date.now() - t0;
  say(`time to map handle+14s settle: ${tMapReady} ms`);
  await mark('01-clean-load', true);

  // ---------- 2. record initial model/run/hour/layer ----------
  const uiState = await page.evaluate(() => {
    const txt = (sel) => [...document.querySelectorAll(sel)].map(e => (e.textContent || '').trim()).filter(Boolean);
    const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean);
    const aria = [...document.querySelectorAll('[aria-pressed="true"],[aria-selected="true"]')].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim());
    return {
      buttons: btns.slice(0, 80),
      pressed: aria.slice(0, 20),
      sliders: [...document.querySelectorAll('[role="slider"]')].map(e => ({
        label: e.getAttribute('aria-label'), now: e.getAttribute('aria-valuenow'),
        text: e.getAttribute('aria-valuetext'), min: e.getAttribute('aria-valuemin'), max: e.getAttribute('aria-valuemax'),
      })),
      bodyText: (document.body.innerText || '').slice(0, 2500),
    };
  });
  fs.writeFileSync(path.join(OUT, `${TAG}-ui-state-initial.json`), JSON.stringify(uiState, null, 2));
  say(`buttons found: ${uiState.buttons.length}; sliders: ${uiState.sliders.length}`);
  say(`aria-pressed: ${JSON.stringify(uiState.pressed)}`);

  const clickByText = async (label) => {
    const ok = await page.evaluate((l) => {
      const b = [...document.querySelectorAll('button')].find(e => (e.textContent || '').trim() === l);
      if (!b) return false; b.click(); return true;
    }, label);
    say(`  click "${label}": ${ok ? 'OK' : 'NOT FOUND'}`);
    return ok;
  };

  // ---------- 3. activate wind ----------
  await clickByText('Wind');
  await sleep(9000);
  await mark('02-wind-active', true);

  // sample a fixed coordinate BEFORE any movement
  const sampleAt = async (lng, lat, name) => {
    const r = await page.evaluate(async ({ lng, lat }) => {
      const m = window.__M__; if (!m) return null;
      const p = m.project([lng, lat]);
      const el = m.getCanvas();
      const rect = el.getBoundingClientRect();
      const ev = (type) => new MouseEvent(type, { clientX: rect.left + p.x, clientY: rect.top + p.y, bubbles: true });
      el.dispatchEvent(ev('mousemove'));
      await new Promise(r2 => setTimeout(r2, 900));
      const txt = (document.body.innerText || '');
      return { px: [Math.round(p.x), Math.round(p.y)], onScreen: p.x >= 0 && p.y >= 0 && p.x <= rect.width && p.y <= rect.height, body: txt.slice(0, 1800) };
    }, { lng, lat });
    fs.writeFileSync(path.join(OUT, `${TAG}-sample-${name}.json`), JSON.stringify(r, null, 2));
    say(`  sample ${name} @${lng},${lat}: px=${r && r.px} onScreen=${r && r.onScreen}`);
    return r;
  };

  // Cocoa Beach
  await page.evaluate(() => { window.__M__.jumpTo({ center: [-80.607, 28.361], zoom: 8 }); });
  await sleep(7000);
  await mark('03-cocoa-z8', true);
  const s1 = await sampleAt(-80.607, 28.361, 'cocoa-z8-first');

  // ---------- 4. zoom ----------
  await page.evaluate(() => { window.__M__.jumpTo({ center: [-80.607, 28.361], zoom: 11 }); });
  await sleep(6000);
  await mark('04-cocoa-z11', true);
  const s2 = await sampleAt(-80.607, 28.361, 'cocoa-z11');

  // JACOBIAN: zoom -> sampled value at the SAME coordinate
  await page.evaluate(() => { window.__M__.jumpTo({ center: [-80.607, 28.361], zoom: 5 }); });
  await sleep(6000);
  await mark('05-cocoa-z5', true);
  const s3 = await sampleAt(-80.607, 28.361, 'cocoa-z5');

  // ---------- 5. pan ----------
  await page.evaluate(() => { window.__M__.jumpTo({ center: [-78.0, 28.361], zoom: 8 }); });
  await sleep(5000);
  await page.evaluate(() => { window.__M__.jumpTo({ center: [-80.607, 28.361], zoom: 8 }); });
  await sleep(6000);
  await mark('06-pan-return-z8', true);
  const s4 = await sampleAt(-80.607, 28.361, 'cocoa-z8-after-pan');

  // ---------- 6. timeline movement ----------
  const scrub = async (steps, key) => {
    const ok = await page.evaluate((k) => {
      const sl = document.querySelector('[role="slider"]');
      if (!sl) return false; sl.focus(); return true;
    });
    if (!ok) { say('  no [role=slider] found — timeline not driven'); return false; }
    for (let i = 0; i < steps; i++) { await page.keyboard.press(key); await sleep(160); }
    return true;
  };
  const tScrub0 = netLog.filter(x => x.phase === 'req').length;
  const scrubbed = await scrub(6, 'ArrowRight');
  await sleep(6000);
  await mark('07-time-plus6', true);
  const tScrub1 = netLog.filter(x => x.phase === 'req').length;
  say(`  requests generated by +6h scrub: ${tScrub1 - tScrub0}`);
  const s5 = await sampleAt(-80.607, 28.361, 'cocoa-z8-hourplus6');

  if (scrubbed) { await scrub(6, 'ArrowLeft'); await sleep(6000); }
  await mark('08-time-restored', true);
  const s6 = await sampleAt(-80.607, 28.361, 'cocoa-z8-hour-restored');

  // ---------- 7. model switching ----------
  const mSwitch0 = await page.evaluate(CENSUS);
  await clickByText('EURO');
  await sleep(9000);
  await mark('09-model-EURO', true);
  const s7 = await sampleAt(-80.607, 28.361, 'cocoa-EURO');
  await clickByText('GFS');
  await sleep(9000);
  await mark('10-model-GFS-restored', true);
  const s8 = await sampleAt(-80.607, 28.361, 'cocoa-GFS-restored');

  // ---------- 8. weather -> marine layer switching ----------
  await clickByText('Waves');
  await sleep(9000);
  await mark('11-layer-waves', true);
  const s9 = await sampleAt(-80.607, 28.361, 'cocoa-waves');
  await clickByText('Swell');
  await sleep(8000);
  await mark('12-layer-swell1', true);
  await clickByText('Swell 2');
  await sleep(8000);
  await mark('13-layer-swell2', true);
  await clickByText('Water Temp');
  await sleep(8000);
  await mark('14-layer-watertemp', true);
  await clickByText('Wind');
  await sleep(9000);
  await mark('15-layer-wind-restored', true);
  const s10 = await sampleAt(-80.607, 28.361, 'cocoa-wind-restored');

  // ---------- 9. hide and restore (tab visibility) ----------
  const hid0 = await page.evaluate(CENSUS);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(6000);
  const hid1 = await page.evaluate(CENSUS);
  say(`  HIDDEN 6s: raf delta = ${hid1.rafCalls - hid0.rafCalls} (0 would mean animation correctly paused)`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(6000);
  await mark('16-restored-from-hidden', true);

  // ---------- 10. leave and return (route unmount/remount) ----------
  const beforeLeave = await page.evaluate(CENSUS);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  const onHome = await page.evaluate(CENSUS);
  say(`  ON HOME: workers=${onHome.workerCount} intervalsLive=${onHome.intervalsLive} canvases=${onHome.canvases}`);
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await sleep(13000);
  await page.evaluate(findMap);
  await mark('17-return-to-map', true);

  // ---------- 11. LIFECYCLE BURN-IN: 3 remount cycles ----------
  const burn = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(findMap);
    await clickByText('Wind'); await sleep(5000);
    await clickByText('Waves'); await sleep(5000);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }); await sleep(3500);
    await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' }); await sleep(11000);
    await page.evaluate(findMap);
    const c = await mark(`18-burnin-cycle${i + 1}`, i === 2);
    burn.push(c);
  }

  // ---------- 12. RACE / STRESS journey ----------
  say('=== RACE JOURNEY ===');
  const race0 = netLog.filter(x => x.phase === 'req').length;
  await page.evaluate(findMap);
  await clickByText('Wind');
  // do not wait — immediately thrash
  await page.evaluate(() => { window.__M__.jumpTo({ center: [-80.607, 28.361], zoom: 9 }); });
  await clickByText('Waves');
  await page.evaluate(() => { window.__M__.jumpTo({ center: [-9.4, 38.7], zoom: 7 }); });
  await clickByText('EURO');
  await scrub(4, 'ArrowRight');
  await clickByText('Swell');
  await page.evaluate(() => { window.__M__.jumpTo({ center: [-80.607, 28.361], zoom: 6 }); });
  await scrub(4, 'ArrowLeft');
  await clickByText('GFS');
  await clickByText('Wind');
  await sleep(1200);
  const raceMid = await mark('19-race-midflight', true);
  await sleep(14000);
  const raceEnd = await mark('20-race-settled', true);
  say(`  race requests: ${netLog.filter(x => x.phase === 'req').length - race0}`);

  // ---------- 13. PROJECTION TOUR (fixed model+hour) ----------
  say('=== PROJECTION TOUR ===');
  const TOUR = [
    ['florida', -80.607, 28.361, 8], ['newyork', -73.1, 40.6, 8], ['portugal', -9.4, 38.7, 8],
    ['spain', -2.0, 43.4, 8], ['morocco', -9.8, 31.4, 8], ['elsalvador', -89.3, 13.4, 8],
    ['openatlantic', -40.0, 30.0, 5], ['openpacific', -140.0, 10.0, 5],
    ['antimeridian', 179.6, -17.6, 6], ['highlat', -20.0, 66.5, 5],
    ['islandchain-madeira', -16.9, 32.75, 9], ['bay-halfmoon', -122.5, 37.5, 9],
  ];
  const tour = [];
  for (const [name, lng, lat, z] of TOUR) {
    await page.evaluate(({ lng, lat, z }) => { window.__M__.jumpTo({ center: [lng, lat], zoom: z }); }, { lng, lat, z });
    await sleep(6500);
    const c = await page.evaluate(CENSUS);
    // pixel probe: is the marine/weather field actually painting?
    const px = await page.evaluate(() => {
      const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!cv) return null;
      try {
        const g = cv.getContext('webgl2', { preserveDrawingBuffer: true }) || cv.getContext('webgl', { preserveDrawingBuffer: true });
        if (!g) return { note: 'no gl readback' };
        const w = cv.width, h = cv.height;
        const buf = new Uint8Array(4 * 400);
        const xs = [], ys = [];
        for (let i = 0; i < 400; i++) { xs.push(Math.floor(Math.random() * w)); ys.push(Math.floor(Math.random() * h)); }
        let uniq = new Set(); let read = 0;
        for (let i = 0; i < 120; i++) {
          const p = new Uint8Array(4);
          g.readPixels(xs[i], ys[i], 1, 1, g.RGBA, g.UNSIGNED_BYTE, p);
          uniq.add(p.join(',')); read++;
        }
        return { distinctColors: uniq.size, sampled: read };
      } catch (e) { return { err: String(e).slice(0, 100) }; }
    });
    await page.screenshot({ path: path.join(SHOT, `${TAG}-tour-${name}.png`) }).catch(() => { });
    tour.push({ name, lng, lat, z, zoom: c.map && c.map.zoom, layers: c.map && c.map.layers, marineLayers: c.map && c.map.marineLayers, texLive: c.tex.live, bufLive: c.buf.live, heapMB: c.heapMB, px });
    say(`  tour ${name}: z=${c.map && c.map.zoom} layers=${c.map && c.map.layers} texLive=${c.tex.live} px=${JSON.stringify(px)}`);
  }
  fs.writeFileSync(path.join(OUT, `${TAG}-projection-tour.json`), JSON.stringify(tour, null, 2));

  // ---------- 14. final ----------
  const final = await mark('21-final', true);

  fs.writeFileSync(path.join(OUT, `${TAG}-marks.json`), JSON.stringify(marks, null, 2));
  fs.writeFileSync(path.join(CONS, `${TAG}-console.json`), JSON.stringify(consoleLog, null, 2));
  fs.writeFileSync(path.join(CONS, `${TAG}-pageerrors.json`), JSON.stringify(pageErrors, null, 2));
  fs.writeFileSync(path.join(NET, `${TAG}-network.json`), JSON.stringify(netLog, null, 2));
  fs.writeFileSync(path.join(OUT, `${TAG}-log.txt`), log.join('\n'));

  // summary
  const errs = consoleLog.filter(x => x.type === 'error');
  const byErr = {};
  errs.forEach(e => { const k = e.text.slice(0, 110); byErr[k] = (byErr[k] || 0) + 1; });
  const fails = netLog.filter(x => x.phase === 'fail');
  const byFail = {};
  fails.forEach(e => { const k = (e.url || '').split('?')[0].slice(0, 110); byFail[k] = (byFail[k] || 0) + 1; });
  const summary = {
    tag: TAG, base: BASE, when: new Date().toISOString(),
    timeToMapHandle: tMapReady,
    consoleErrors: errs.length, consoleWarns: consoleLog.filter(x => x.type === 'warning').length,
    pageErrors: pageErrors.length,
    topErrors: Object.entries(byErr).sort((a, b) => b[1] - a[1]).slice(0, 15),
    totalRequests: netLog.filter(x => x.phase === 'req').length,
    failedRequests: fails.length,
    topFailed: Object.entries(byFail).sort((a, b) => b[1] - a[1]).slice(0, 15),
    hiddenRafDelta: hid1.rafCalls - hid0.rafCalls,
    marksSummary: marks.map(m => ({
      mark: m.__mark, zoom: m.map && m.map.zoom, layers: m.map && m.map.layers,
      rafSites: m.rafOwnerSites, workers: m.workerCount, gl: m.glContexts,
      texLive: m.tex && m.tex.live, bufLive: m.buf && m.buf.live, fbLive: m.fb && m.fb.live,
      programs: m.programs, intervalsLive: m.intervalsLive, heapMB: m.heapMB,
      canvases: m.canvases, domNodes: m.domNodes, reqs: m.__requests, err: m.__consoleErrors,
    })),
    samples: { s1, s2, s3, s4, s5, s6, s7, s8, s9, s10 },
    tour,
  };
  fs.writeFileSync(path.join(OUT, `${TAG}-summary.json`), JSON.stringify(summary, null, 2));
  say('=== DONE ===');
  say(JSON.stringify(summary.marksSummary, null, 1));

  await ctx.tracing.stop({ path: path.join(OUT, 'playwright-traces', `${TAG}-trace.zip`) }).catch(() => { });
  await ctx.close();
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
