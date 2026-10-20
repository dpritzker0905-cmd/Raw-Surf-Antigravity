// Where does the marine draw wait on the GPU, and what does a kill switch change? One build, offline only.
//
// The controlled same-build A/B of PR #402 (docs/weather-program/evidence/main-thread-hotspots-2026-10-20.json, key
// controlled_ab_same_build), as a script: each arm is a fresh browser on the SAME build, with the kill switches named in
// KILLS set before the app boots (arm "off") or not (arm "on"); zoom 3, a 10 s settle, then 40 ArrowRight presses 250 ms
// apart on the forecast wheel (10 s). Every engine.render call is timed with performance.now (in-page wrappers, no app
// edit) and frames are counted with requestAnimationFrame.
//
// GLTIME=1 also wraps every WebGL method and bills its time while the MARINE engine's render is on the stack, per method
// name: which synchronous call absorbs the queued GPU work. The wrappers cost time themselves, so a GLTIME run is for
// finding the call, not for the A/B means (run the A/B with GLTIME unset).
//
// CHECK=1 reads, after every marine render, whether the advection FBO still has a texture attached and whether the render
// raised a GL error (synchronous reads: not for timing). THROW_ONCE=1 (with CHECK=1) makes the advection draw throw once,
// so the render's teardown path runs on the real GPU. ARMS takes "off" (every KILLS switch set) or "on" (none), and
// "k:<switch>" (only that one set).
//
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100
//   AB_BASE=http://127.0.0.1:3100 PORT=<synthetic backend port> LAYER=waves ARMS=off,on,off,on \
//     [KILLS=<comma list>] [GLTIME=1] [CHECK=1 [THROW_ONCE=1]] [OUT=file.json] node frontend/scripts/visual-lab/gpu_sync_ab.js
const fs = require('fs');
const L = require('../offline-backend/ab_lib.js');
if (process.env.AB_LIVE === '1') throw Error('offline only');
const PORT = +(process.env.PORT || 4103);
const LAYER = process.env.LAYER || 'waves';
const ARMS = (process.env.ARMS || 'off,on,off,on').split(',').map((s) => s.trim()).filter(Boolean);
const KILLS = (process.env.KILLS || '__RAW_DISABLE_FBO_STATUS_CACHE__,__RAW_DISABLE_ADV_TEARDOWN_SKIP__').split(',').map((s) => s.trim()).filter(Boolean);
const GLTIME = process.env.GLTIME === '1';
const PRESSES = +(process.env.PRESSES || 40);
const CHECK = process.env.CHECK === '1';
const THROW_ONCE = process.env.THROW_ONCE === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.evaluate((el) => el.click());
}
async function pressed(page, text) {
  return page.evaluate((t) => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => (b.textContent || '').trim() === t), text);
}

const killsFor = (arm) => (arm === 'off' ? KILLS : arm.startsWith('k:') ? [arm.slice(2)] : []);

function stats(a) {
  if (!a.length) return { n: 0, mean: null, p50: null, p95: null, sum: 0 };
  const s = [...a].sort((x, y) => x - y); const sum = a.reduce((x, y) => x + y, 0);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: a.length, mean: +(sum / a.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), sum: Math.round(sum) };
}

async function runArm(arm) {
  const { browser, page, log } = await L.launch({ port: PORT });
  await page.addInitScript(({ kills, glTime, check, throwOnce }) => {
    for (const k of kills) window[k] = true;
    const R = (window.__GSA__ = { rec: false, marine: [], wind: [], map: [], frames: 0, t0: 0, t1: 0, gl: {}, inMarine: 0,
      check: { renders: 0, attachedAfter: 0, glErrors: 0, errorCodes: {}, thrown: 0, throwRenders: [] } });
    const wrap = (name, key) => {
      const e = window[name];
      if (!e || e.__gsaWrapped) return;
      const orig = e.render;
      e.render = function (...args) {
        const gl = args[0]; let restoreDraw = null;
        // CHECK=1: the invariant on the real GPU, read with SYNCHRONOUS queries (so not for timing runs): after every
        // marine render the advection FBO has nothing attached and the render raised no GL error.
        if (check && key === 'marine' && R.rec && gl && gl.getError) {
          while (gl.getError() !== gl.NO_ERROR) { /* drain errors raised before this render */ }
          // THROW_ONCE=1: one exception between the attach and the detach (the advection draw), to exercise the teardown.
          if (throwOnce && R.check.thrown === 0 && this.advFBO) {
            const draw = gl.drawArrays; const self = this;
            gl.drawArrays = function (...a) {
              if (R.check.thrown === 0 && gl.getParameter(gl.FRAMEBUFFER_BINDING) === self.advFBO) { R.check.thrown++; throw new Error('gpu_sync_ab THROW_ONCE'); }
              return draw.apply(gl, a);
            };
            restoreDraw = () => { gl.drawArrays = draw; };
          }
        }
        const t = performance.now(); if (key === 'marine') R.inMarine++;
        try { return orig.apply(this, args); } finally {
          if (key === 'marine') R.inMarine--;
          if (R.rec) R[key].push(performance.now() - t);
          if (restoreDraw) { restoreDraw(); if (R.check.thrown === 1 && !R.check.throwRenders.length) R.check.throwRenders.push(R.check.renders); }
          if (check && key === 'marine' && R.rec && gl && gl.getError && this.advFBO) {
            R.check.renders++;
            const err = gl.getError(); if (err !== gl.NO_ERROR) { R.check.glErrors++; R.check.errorCodes[err] = (R.check.errorCodes[err] || 0) + 1; }
            const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
            const type = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
            gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
            if (type !== gl.NONE) R.check.attachedAfter++;
          }
        }
      };
      e.__gsaWrapped = true;
    };
    // The whole map frame (MapLibre's _render: its own draw plus both custom layers): if a removed sync only moves the
    // wait to a later synchronous call elsewhere in the frame, this does not fall.
    const wrapMap = () => {
      const m = window.__MAP_INSTANCE__ || window.map;
      if (!m || m.__gsaWrapped || typeof m._render !== 'function') return;
      const orig = m._render;
      m._render = function (...args) { const t = performance.now(); try { return orig.apply(this, args); } finally { if (R.rec) R.map.push(performance.now() - t); } };
      m.__gsaWrapped = true;
    };
    setInterval(() => { wrap('__MARINE_ENGINE__', 'marine'); wrap('__WIND_ENGINE__', 'wind'); wrapMap(); }, 200);
    const tick = () => { if (R.rec) R.frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    if (glTime) {
      const patch = (proto) => {
        if (!proto) return;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const d = Object.getOwnPropertyDescriptor(proto, name);
          if (!d || typeof d.value !== 'function' || name === 'constructor') continue;
          const orig = d.value;
          proto[name] = function (...args) {
            if (!(R.rec && R.inMarine > 0)) return orig.apply(this, args);
            const t = performance.now();
            try { return orig.apply(this, args); } finally {
              const dt = performance.now() - t; const g = R.gl[name] || (R.gl[name] = { n: 0, sum: 0, max: 0, over1: 0, over4: 0 });
              g.n++; g.sum += dt; if (dt > g.max) g.max = dt; if (dt > 1) g.over1++; if (dt > 4) g.over4++;
            }
          };
        }
      };
      patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
      patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    }
  }, { kills: killsFor(arm), glTime: GLTIME, check: CHECK, throwOnce: THROW_ONCE });
  const out = { arm, kills: killsFor(arm), layer: LAYER };
  try {
    await L.openMap(page); await L.jump(page, -75, 30, 3);
    if (LAYER === 'wind') { if (!(await pressed(page, 'Wind'))) await clickExact(page, 'Wind'); }
    else if (!(await pressed(page, 'Waves'))) await clickExact(page, 'Waves');
    await sleep(10000);
    const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
    await page.evaluate(() => { const R = window.__GSA__; R.marine = []; R.wind = []; R.map = []; R.frames = 0; R.gl = {}; R.t0 = performance.now(); R.rec = true; });
    for (let i = 0; i < PRESSES; i++) { await page.keyboard.press('ArrowRight'); await sleep(250); }
    const r = await page.evaluate(() => { const R = window.__GSA__; R.rec = false; R.t1 = performance.now();
      return { marine: R.marine, wind: R.wind, map: R.map, frames: R.frames, ms: R.t1 - R.t0, gl: R.gl,
        fboCache: (window.__RAW_GPU__ && window.__RAW_GPU__.fboStatusCache) ? JSON.parse(JSON.stringify(window.__RAW_GPU__.fboStatusCache)) : null,
        teardown: (window.__RAW_GPU__ && window.__RAW_GPU__.advTeardown) ? JSON.parse(JSON.stringify(window.__RAW_GPU__.advTeardown)) : null,
        check: R.check,
        advFboStatus: window.__RAW_GPU__ ? window.__RAW_GPU__.advFboStatus : null }; });
    out.seconds = +(r.ms / 1000).toFixed(1); out.fps = +(r.frames / (r.ms / 1000)).toFixed(1);
    out.marine = stats(r.marine); out.wind = stats(r.wind); out.mapFrame = stats(r.map);
    out.advFboStatus = r.advFboStatus; out.fboCache = r.fboCache; out.teardown = r.teardown;
    if (CHECK) out.check = r.check;
    if (GLTIME) {
      out.gl = Object.entries(r.gl).map(([k, g]) => ({ name: k, n: g.n, sum: +g.sum.toFixed(1), mean: +(g.sum / g.n).toFixed(3), max: +g.max.toFixed(2), over1: g.over1, over4: g.over4 }))
        .sort((a, b) => b.sum - a.sum).slice(0, 25);
    }
  } finally {
    out.pageErrors = log.errors.slice(0, 5);
    await browser.close();
  }
  return out;
}

(async () => {
  const res = { env: { PORT, BASE: L.BASE, LAYER, ARMS, KILLS, GLTIME, CHECK, THROW_ONCE, PRESSES, startedUtc: new Date().toISOString() }, rows: [] };
  for (const arm of ARMS) {
    const row = await runArm(arm); res.rows.push(row);
    console.log(`${LAYER} ${arm.padEnd(3)} ${row.seconds}s fps ${row.fps}  marine n ${row.marine.n} mean ${row.marine.mean} p50 ${row.marine.p50} p95 ${row.marine.p95} sum ${row.marine.sum}`
      + `  wind n ${row.wind.n} mean ${row.wind.mean} p95 ${row.wind.p95}  mapFrame n ${row.mapFrame.n} mean ${row.mapFrame.mean} p95 ${row.mapFrame.p95}  adv ${row.advFboStatus}  cache ${JSON.stringify(row.fboCache)}  teardown ${JSON.stringify(row.teardown)}`);
    if (row.check) console.log('   check', JSON.stringify(row.check));
    if (row.gl) for (const g of row.gl.slice(0, 12)) console.log(`   ${g.name.padEnd(28)} n ${String(g.n).padStart(6)} sum ${String(g.sum).padStart(8)} ms  mean ${g.mean}  max ${g.max}  >1ms ${g.over1}  >4ms ${g.over4}`);
    if (row.pageErrors.length) console.log('   page errors', JSON.stringify(row.pageErrors).slice(0, 300));
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 2));
})();
