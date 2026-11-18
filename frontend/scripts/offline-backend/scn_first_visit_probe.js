// A PROBE, no gate number: what holds back the fine grid's request on a FIRST visit to an hour?
// Log: docs/weather-program/log/2026-11-16-fable-first-visit-fine.md, section 3 step 1. Offline only.
//
// Per view (a fresh page each), the layer on, then STEPS isolated +3 h steps with REST ms between them (every step is a first
// visit). In the page, recorded with performance.now():
//   - every setTimeout: its delay, the stack that scheduled it, when it fired, and which timer (if any) was running when it was
//     scheduled, so a chain of timers can be walked back to the keydown
//   - every fetch to /api/weather/(grid|grid_series): when it left, its query, the stack, and the timer it left from
//   - the marine engine's grid (size, valid time) sampled every 40 ms
//   - the app's own console lines that name a settle or dispatch decision
// Out: OUT/probe.jsonl (one line per step) and a printed timeline. Stacks are minified positions; resolve them with
// first_visit_probe_report.js, which reads the build's source maps.
//   AB_BASE=http://127.0.0.1:3198 PORT=<backend> RR_DIR=<cache> OUT=<dir> [LAYER=waves] [VIEWS=0,1] [STEPS=4] [REST=6000] node scn_first_visit_probe.js
if (process.env.AB_LIVE === '1') throw Error('scn_first_visit_probe is offline only');
const fs = require('fs'); const path = require('path');
const L = require('./ab_lib.js'); const { RR } = require('../raster-lab/rr.js');
const OUT = process.env.OUT || 'first-visit-probe-out'; const LAYER = process.env.LAYER || 'waves';
const STEPS = +(process.env.STEPS || 4); const REST = +(process.env.REST || 6000);
const VIEWS = [[-158, 21.6, 5], [-9.5, 39, 5], [150, -34, 5], [-123, 37.5, 5], [-5, 50, 4.5], [115, -10, 4]];
const PICK = process.env.VIEWS ? process.env.VIEWS.split(',').map(Number) : VIEWS.map((_, i) => i);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPY = () => {
  const P = (window.__FV__ = { timers: [], fetches: [], grids: [], running: null, on: false, seq: 0 });
  const stack = () => { try { return String(new Error().stack || '').split('\n').slice(3, 11).map((s) => s.trim()); } catch (e) { return []; } };
  const st = window.setTimeout;
  window.setTimeout = function (fn, delay, ...rest) {
    if (!P.on || typeof fn !== 'function') return st.call(this, fn, delay, ...rest);
    const rec = { id: ++P.seq, delay: Number(delay) || 0, t: performance.now(), from: P.running, stack: stack(), fired: null };
    P.timers.push(rec);
    return st.call(this, function (...a) { rec.fired = performance.now(); const prev = P.running; P.running = rec.id; try { return fn.apply(this, a); } finally { P.running = prev; } }, delay, ...rest);
  };
  const f = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (P.on && /\/api\/weather\/(grid_series|grid)\b/.test(url)) {
        const u = new URL(url, location.href);
        P.fetches.push({ t: performance.now(), path: u.pathname.replace(/^.*\/api\/weather\//, ''), q: Object.fromEntries([...u.searchParams].filter(([k]) => /layer|model|valid|hour|bbox|zoom|surf|region|start|count/i.test(k))), from: P.running, stack: stack() });
      }
    } catch (e) { /* never break the app */ }
    return f.apply(this, arguments);
  };
  const sample = () => {
    if (P.on) {
      const e = window.__MARINE_ENGINE__; const g = e && e._waveData && e._waveData.waveGrid;
      const sig = g ? `${g.cols}x${g.rows}@${String(g.served_valid_time || g.valid_time || g.validTime || '').slice(11, 16)}` : 'none';
      if (!P.grids.length || P.grids[P.grids.length - 1].sig !== sig) P.grids.push({ t: performance.now(), sig });
    }
    st.call(window, sample, 40);
  };
  st.call(window, sample, 40);
  P.key = (key, n) => { const el = [...document.querySelectorAll('[role="slider"]')].find((x) => /timeline wheel/.test(x.getAttribute('aria-label') || '') && x.offsetParent !== null);
    if (!el) return null; el.focus(); const t = performance.now(); for (let i = 0; i < n; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return t; };
  P.take = () => { const o = { timers: P.timers, fetches: P.fetches, grids: P.grids }; P.timers = []; P.fetches = []; P.grids = P.grids.slice(-1); return o; };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const outFile = path.join(OUT, 'probe.jsonl'); fs.writeFileSync(outFile, '');
  for (const vi of PICK) {
    const [lng, lat, z] = VIEWS[vi];
    const { browser, page } = await L.launch({ port: +(process.env.PORT || 4198), width: 1280, height: 800, dpr: 1 });
    try {
      const rr = new RR(process.env.RR_DIR, { mode: process.env.RR_MODE || 'auto' }); await rr.install(page);
      await page.addInitScript(SPY);
      await page.addInitScript(() => { try { localStorage.setItem('raw-surf-theme', 'dark'); localStorage.setItem('__RAW_TUNER__', '0'); } catch (e) { /* private mode */ } window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; });
      const logs = []; let t0page = null;
      page.on('console', (m) => { const s = m.text(); if (/SCRUB-SETTLE|settle|dispatch|sharpen|clamp|regional|series|coarse|enqueue/i.test(s)) logs.push({ wall: Date.now(), text: s.slice(0, 220) }); });
      await L.openMap(page);
      await L.jump(page, lng, lat, z); await sleep(2500);
      await page.evaluate((layer) => window.toggleLayer(layer), LAYER); await sleep(9000);
      await page.evaluate(() => { window.__FV__.key('Home', 1); }); await sleep(6000);
      for (let i = 0; i < STEPS; i++) {
        await page.evaluate(() => { const P = window.__FV__; P.take(); P.on = true; });
        const wall0 = Date.now(); const k = await page.evaluate(() => window.__FV__.key('ArrowRight', 3));
        await sleep(REST);
        const got = await page.evaluate(() => { const P = window.__FV__; P.on = false; return P.take(); });
        const rel = (t) => (t == null ? null : Math.round(t - k));
        const timers = got.timers.map((x) => ({ id: x.id, delay: x.delay, set: rel(x.t), fired: rel(x.fired), from: x.from, stack: x.stack }));
        const fetches = got.fetches.map((x) => ({ t: rel(x.t), path: x.path, q: x.q, from: x.from, stack: x.stack }));
        const grids = got.grids.map((x) => ({ t: rel(x.t), sig: x.sig }));
        const lg = logs.filter((x) => x.wall >= wall0 && x.wall < wall0 + REST).map((x) => ({ t: x.wall - wall0, text: x.text }));
        fs.appendFileSync(outFile, JSON.stringify({ view: vi, lng, lat, z, layer: LAYER, step: i, timers, fetches, grids, logs: lg }) + '\n');
        // the chain of timers behind each weather request, walked back to the keydown
        const byId = new Map(timers.map((x) => [x.id, x]));
        const chain = (id) => { const out = []; let c = byId.get(id); let guard = 0; while (c && guard++ < 12) { out.unshift(`${c.delay}ms(set@${c.set},fired@${c.fired})`); c = byId.get(c.from); } return out.join(' -> ') || 'not from a timer'; };
        console.log(`view ${vi} z${z} step ${i}: grid ${grids.map((g) => `${g.sig}@${g.t}`).join(' -> ')}`);
        for (const q of fetches) console.log(`     ${q.path} left @${q.t} ms (${q.q.layer || ''} ${q.q.bbox ? 'bbox' : 'world'}) via ${chain(q.from)}`);
        if (!fetches.length) console.log('     no /grid or /grid_series request left in the window');
      }
    } catch (e) { console.log(`view ${vi}: ERROR ${String((e && e.message) || e).slice(0, 200).replace(/access_token=[^&\s"']+/g, 'access_token=REDACTED')}`); }
    await browser.close().catch(() => {});
  }
})();
