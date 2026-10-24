// HIDDEN-LAYER SERIES WORK and the SIBLING TOGGLE, offline (2026-10-23, marineSiblingWarm.js). The lead's live read of dev at the
// map's opening view (z9, Florida east coast): after Waves, the client fetched 48-frame /grid_series pages for swell_1 (6.3 s),
// swell_2 (6.6 s) and wind_waves (11.1 s), none of them shown: ~24 s of the 1-CPU box's ~34 s of series work for one map load.
// One fresh browser per (arm, case):
//   load            Waves on, then WATCH ms with no input: every /grid and /grid_series ask (layer, page or mini, start, end).
//   toggle@AT:LAYER Waves on, then AT ms later a click on LAYER's chip: the ms from the click to that layer on the GPU (the engine's
//                   resident grid names it), and whether the switch was the orchestrator's instant cache-hit commit.
//   pans@N          Waves on (and MODEL's chip), then N small pans PAN_GAP ms apart (a drift of 30-120 px offsets, 300 ms each): the
//                   live 2026-10-23 19:44Z pattern (surf ON, ICON, z7-9 Florida: every pan a new surf page on the 1-CPU box).
// SURF=1 starts in surf mode (window.__SURF_MODE__); surf asks cost COST_SURF_PAGE per 16-frame page (pro rata), COST_SURF_MINI,
// COST_SURF_GRID (live: 10-25 s of CPU per 16-frame surf page, the rating chain per node).
// THE BOX. The synthetic backend answers at once, so contention would be invisible. BOX=1 (default) puts every weather ask through
// a 1-CPU processor-sharing model: a 48-frame page costs COST_PAGE ms of CPU (pro rata by hours), a 1-hour mini COST_MINI, a /grid
// COST_GRID, and N asks in flight each progress at 1/N. Its per-layer CPU and its busy time are part of the record. These are
// MODELLED times; the request counts and their order are the app's own.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <store> --models GFS --layers waves,swell_1,swell_2,wind_waves \
//     --regions florida_east_coast --dynamic 1 --port 4130
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3130
//   AB_BASE=http://127.0.0.1:3130 PORT=4130 [CDN_DIR=<cdn>] ARMS=cur,before:__RAW_DISABLE_SIBLING_IDLE_PAGES__ \
//     CASES=load,toggle@3000:wind_waves,toggle@12000:wind_waves OUT=sib.json node frontend/scripts/offline-backend/scn_sibling_toggle.js
// Env: ARMS (name[:FLAG+FLAG]), CASES, WATCH (ms after Waves, 45000), ZOOM (9), CENTER (-80.62,28.05), VIEW (owner = 844 x 390 dpr 2),
// CDN_PORT (4188), BOX (1), COST_PAGE (4000), COST_MINI (300), COST_GRID (400).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_sibling_toggle is offline only');
const PORT = +(process.env.PORT || 4130);
const CDN_DIR = process.env.CDN_DIR || null;
const CDN_PORT = +(process.env.CDN_PORT || 4188);
const WATCH = +(process.env.WATCH || 45000);
const ZOOM = +(process.env.ZOOM || 9);
const [CLNG, CLAT] = (process.env.CENTER || '-80.62,28.05').split(',').map(Number);
const VIEW = process.env.VIEW || 'owner';
const BOX = process.env.BOX !== '0';
const COST = { page: +(process.env.COST_PAGE || 4000), mini: +(process.env.COST_MINI || 300), grid: +(process.env.COST_GRID || 400),
  surfPage: +(process.env.COST_SURF_PAGE || 15000), surfMini: +(process.env.COST_SURF_MINI || 1000), surfGrid: +(process.env.COST_SURF_GRID || 1000) };
const SURF = process.env.SURF === '1';
const MODEL = process.env.MODEL || 'GFS';
const PAN_GAP = +(process.env.PAN_GAP || 1200);
// DRAIN=<ms>: after WATCH, keep watching until the client has asked nothing new for DRAIN ms and nothing is in flight (the work a
// pan session leaves queued, which a fixed window hides on a saturated box), up to WATCH_MAX ms after Waves.
const DRAIN = +(process.env.DRAIN || 0);
const WATCH_MAX = +(process.env.WATCH_MAX || 900000);
// DIAG=1: once a second, the settle check's own record (__MARINE_SHARPEN_DIAG__), the engine's resident grid and the mismatch counters.
const DIAG = process.env.DIAG === '1';
// STEPS=<n>: after WATCH / DRAIN, Home then n PageUp steps (+24 h each, on the 3-hourly lattice) STEP_GAP ms apart: per step the ms from
// the key to the engine holding the selected hour (|hourOffset - the wheel's value| <= 1.5), and the frames over 50 ms meanwhile.
const STEPS = +(process.env.STEPS || 0);
const STEP_GAP = +(process.env.STEP_GAP || 1500);
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const LABEL = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves' };
const ARMS = (process.env.ARMS || 'cur,before:__RAW_DISABLE_SIBLING_IDLE_PAGES__').split(',').map((a) => {
  const [name, flags] = a.split(':'); return { name, flags: flags ? flags.split('+') : [] };
});
const CASES = (process.env.CASES || 'load,toggle@3000:wind_waves,toggle@12000:wind_waves').split(',').map((c) => {
  const m = c.match(/^toggle@(\d+):(\w+)$/); const p = c.match(/^pans@(\d+)$/);
  if (p) return { kind: 'pans', n: +p[1], name: c };
  return m ? { kind: 'toggle', at: +m[1], layer: m[2], name: c } : { kind: 'load', name: c };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdn = CDN_DIR && http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  const cors = { 'access-control-allow-origin': '*' };
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { ...cors, 'content-type': 'application/json' }); return res.end('{"statusCode":"404","error":"not_found"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { ...cors, 'content-length': body.length, 'content-type': rel.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  return res.end(body);
});

// ---- the 1-CPU box: processor sharing over every weather ask in flight ----
function makeBox() {
  const jobs = new Set(); const st = { busyMs: 0, cpu: {} }; let timer = null; let last = 0;
  const tick = () => {
    const now = Date.now(); const dt = now - last; last = now; const n = jobs.size;
    if (!n) { clearInterval(timer); timer = null; return; }
    st.busyMs += dt;
    for (const j of [...jobs]) { const d = Math.min(j.left, dt / n); j.left -= d; st.cpu[j.tag] = (st.cpu[j.tag] || 0) + d; if (j.left <= 0.01) { jobs.delete(j); j.resolve(); } }
  };
  return {
    st,
    run(cost, tag) {
      if (!BOX || cost <= 0) return Promise.resolve();
      return new Promise((resolve) => {
        jobs.add({ left: cost, tag, resolve });
        if (!timer) { last = Date.now(); timer = setInterval(tick, 10); }
      });
    },
  };
}
function classify(url) {
  const p = url.pathname.replace('/api/weather', '');
  const layer = url.searchParams.get('layer') || (p === '/grid' ? 'waves' : null);
  const surf = url.searchParams.get('surf') === '1';
  const model = url.searchParams.get('model') || 'GFS';
  const bbox = url.searchParams.get('bbox');
  if (p === '/grid_series') {
    const hours = (url.searchParams.get('hours') || '').split(',').filter(Boolean).length;
    if (hours > 1) return { kind: 'page', layer, hours, surf, model, bbox, cost: surf ? COST.surfPage * Math.min(1, hours / 16) : COST.page * Math.min(1, hours / 48) };
    return { kind: 'mini', layer, hours, surf, model, bbox, cost: surf ? COST.surfMini : COST.mini };
  }
  if (p === '/grid' && url.searchParams.get('domain') !== 'wind') return { kind: 'grid', layer, hours: 1, surf, model, bbox, cost: surf ? COST.surfGrid : COST.grid };
  return { kind: 'other', layer, hours: 0, surf, model, bbox, cost: 0 };
}

const PROBE = () => {
  const P = (window.__SB__ = { sw: null, instant: [], frames: [], swd: [] });
  // where the commit -> GPU time goes: every engine setWaveData (start, end, the grid's layer)
  const wrap = setInterval(() => {
    const e = window.__MARINE_ENGINE__;
    if (!e || e.__sbWrapped || typeof e.setWaveData !== 'function') return;
    const o = e.setWaveData.bind(e); e.__sbWrapped = true;
    e.setWaveData = function (d, ...rest) {
      const t = performance.now(); try { return o(d, ...rest); } finally {
        const g = d && (d.waveGrid || d.grid); P.swd.push([t, performance.now(), g ? g.__componentLayer : null]); if (P.swd.length > 200) P.swd.splice(0, 100);
      }
    };
  }, 25);
  P.stopWrap = () => clearInterval(wrap);
  const orig = console.log;
  console.log = function (...a) { try { const s = String(a[0] || ''); if (s.includes('Instant cache-hit commit for')) P.instant.push([performance.now(), s.slice(-40)]); } catch (e) { /* none */ } return orig.apply(this, a); };
  const loop = (t) => {
    P.frames.push(t); if (P.frames.length > 600) P.frames.splice(0, 300);
    const W = P.sw;
    if (W && W.ms == null) {
      const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
      if (g && g.__componentLayer === W.layer) { W.ms = performance.now() - W.t0; W.series = !!g.__fromSeries; W.hour = g.hourOffset; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.step = null;
  window.addEventListener('keydown', () => { if (P.step && P.step.t0 == null) P.step.t0 = performance.now(); }, true);
  const stepLoop = (t) => {
    const S = P.step;
    if (S && S.t0 != null && S.ms == null) {
      const w = [...document.querySelectorAll('[role="slider"][aria-label*="Forecast timeline"]')].find((x) => x.offsetParent !== null);
      const target = w ? Number(w.getAttribute('aria-valuenow')) : null;
      const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
      if (S.prevT != null && t - S.prevT > 50) S.long++;
      S.prevT = t;
      const hh = g ? g.hourOffset : null;
      if (S.hours && (S.hours.length === 0 || S.hours[S.hours.length - 1][1] !== hh) && S.hours.length < 40) S.hours.push([Math.round(t - S.t0), hh, !!(g && g.__fromSeries)]);
      if (target != null && target !== S.before && g && Math.abs((g.hourOffset ?? -99) - target) <= 1.5) { S.ms = t - S.t0; S.target = target; S.hour = g.hourOffset; S.series = !!g.__fromSeries; }
      else if (target != null && target !== S.before) {
        // the label already says `target` and the field still draws another hour: admitted by a visible status line, or silent
        // (the house rule, scn_layer_matrix.js: Verifying | does not match | Loading | pending | nearest | estimated)
        const status = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ');
        const admitted = /Verifying|does not match|Loading|pending|nearest|estimated/i.test(status);
        if (admitted) { S.staleAdm = (S.staleAdm || 0) + 1; if (S.admAt == null) S.admAt = Math.round(t - S.t0); } else S.staleSilent = (S.staleSilent || 0) + 1;
        S.texts = S.texts || [];
        const st = status.slice(0, 120);
        if (S.texts.length < 4 && !S.texts.some((x) => x[1] === st)) S.texts.push([Math.round(t - S.t0), st]);
      }
    }
    requestAnimationFrame(stepLoop);
  };
  requestAnimationFrame(stepLoop);
  P.toggle = (layer, label) => {
    const b = [...document.querySelectorAll('button,[role="button"]')].find((x) => x.textContent.trim() === label && x.offsetParent !== null);
    if (!b) return false;
    P.sw = { layer, t0: performance.now(), ms: null };
    b.click();
    return true;
  };
};

async function clickExact(page, text) {
  const clicked = await page.waitForFunction((t) => {
    const b = [...document.querySelectorAll('button,[role="button"]')].find((x) => x.textContent.trim() === t && x.offsetParent !== null);
    if (b) b.click();
    return !!b;
  }, text, { timeout: 15000 });
  if (!(await clicked.jsonValue())) throw Error(`no ${text} control`);
}

async function session(arm, kase) {
  const box = makeBox();
  const asks = [];
  const dims = VIEW === 'owner' ? { width: 844, height: 390, dpr: 2 } : {};
  const hooks = {
    beforeWeather: async (url) => {
      const c = classify(url); const rec = { ...c, t0: Date.now() };
      asks.push(rec);
      await box.run(c.cost, `${c.kind}:${c.layer}`);
      rec.t1 = Date.now();
    },
  };
  const { browser, page, log } = await L.launch({ port: PORT, hooks, ...dims });
  await page.addInitScript(({ base, flags, surf }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__');
    if (base) window.__RAW_STATIC_FRAMES_BASE__ = base;
    localStorage.setItem('raw-surf-theme', 'dark');
    for (const f of flags) window[f] = true;
    if (surf) window.__SURF_MODE__ = true;
  }, { base: CDN_DIR ? `http://127.0.0.1:${CDN_PORT}/` : null, flags: arm.flags, surf: SURF });
  await page.addInitScript(PROBE);
  // STEPS: the marine fetcher's own console lines (which dispatch released or superseded which, the commits it skipped), per step.
  const clog = [];
  if (STEPS) page.on('console', (m) => { const s = m.text(); if (/^\[(Abort-Gate|Release|Marine|Series|Settle|Scrub)/.test(s) || /stale|superseded|skipped/i.test(s)) clog.push({ t: Date.now(), s: s.slice(0, 200) }); });
  const out = { arm: arm.name, flags: arm.flags, case: kase.name };
  try {
    await L.openMap(page); await L.jump(page, CLNG, CLAT, ZOOM);
    await sleep(1500);
    const tW = Date.now();
    await clickExact(page, 'Waves');
    await page.waitForFunction(() => { const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid; return g && g.__componentLayer === 'waves'; }, null, { timeout: 60000 });
    out.firstWavesMs = Date.now() - tW;
    if (DIAG) {
      out.diag = [];
      const sample = async () => {
        try {
          const d = await page.evaluate(() => {
            const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
            const m = window.__MAP_INSTANCE__ || window.map; const b = m && m.getBounds();
            return { sharpen: window.__MARINE_SHARPEN_DIAG__ || null, mism: window.__MARINE_GRIDMISMATCH_COUNT__ || 0,
              res: g ? { cols: g.cols, rows: g.rows, b: g.bounds, model: g.__sourceModel, series: !!g.__fromSeries, surf: !!g.ratingMode } : null,
              view: b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => +v.toFixed(2)) : null, z: m ? +m.getZoom().toFixed(2) : null,
              pan: window.__RAW_SERIES_PAN__ || null };
          });
          out.diag.push({ t: Date.now() - tW, ...d });
        } catch (e) { /* page busy */ }
      };
      const iv = setInterval(sample, 1000); out.__stopDiag = () => clearInterval(iv);
    }
    if (MODEL !== 'GFS') {
      await clickExact(page, MODEL);
      await page.waitForFunction((m) => { const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid; return g && g.__sourceModel === m; }, MODEL, { timeout: 60000 }).catch(() => null);
      out.modelMs = Date.now() - tW;
    }
    if (kase.kind === 'pans') {
      await sleep(1500);
      out.pansAt = Date.now() - tW;
      for (let i = 0; i < kase.n; i++) {
        // a drift along the coast (net east and north), each pan ~0.3-0.6 deg at z8: the live boxes moved a little each time
        const off = [[110, 20], [40, 70], [120, -30], [30, 60]][i % 4];
        await page.evaluate((o) => { const m = window.__MAP_INSTANCE__ || window.map; m.panBy(o, { duration: 300 }); }, off);
        await sleep(PAN_GAP);
      }
      out.pansEnd = Date.now() - tW;
    }
    if (kase.kind === 'toggle') {
      await sleep(Math.max(0, kase.at - (Date.now() - tW)));
      out.toggleAt = Date.now() - tW;
      out.warmAtToggle = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RAW_SIBLING_WARM__ || null)));
      const ok = await page.evaluate(({ layer, label }) => window.__SB__.toggle(layer, label), { layer: kase.layer, label: LABEL[kase.layer] });
      if (!ok) throw Error(`no ${LABEL[kase.layer]} chip`);
      await page.waitForFunction(() => window.__SB__.sw && window.__SB__.sw.ms != null, null, { timeout: 30000 }).catch(() => null);
      const sw = await page.evaluate(() => {
        const S = window.__SB__; const t0 = S.sw.t0;
        return { ...S.sw, instant: S.instant.filter((x) => x[0] >= t0 - 5), fps2s: S.frames.filter((f) => f >= t0 - 2000 && f < t0).length / 2,
          swd: S.swd.filter((x) => x[0] >= t0 - 5 && x[0] <= t0 + 2000).map((x) => [Math.round(x[0] - t0), Math.round(x[1] - x[0]), x[2]]) };
      });
      out.toggle = { layer: kase.layer, ms: sw.ms == null ? null : Math.round(sw.ms), series: sw.series, instantCommit: sw.instant.length > 0,
        commitMs: sw.instant.length ? Math.round(sw.instant[0][0] - sw.t0) : null, fpsBefore: sw.fps2s, setWaveData: sw.swd };
    }
    await sleep(Math.max(0, WATCH - (Date.now() - tW)));
    if (DRAIN) {
      for (;;) {
        const live = asks.filter((a) => a.kind !== 'other');
        const last = Math.max(0, ...live.map((a) => a.t0));
        if ((live.every((a) => a.t1 != null) && Date.now() - last >= DRAIN) || Date.now() - tW >= WATCH_MAX) break;
        await sleep(500);
      }
      out.drainedAt = Date.now() - tW;
    }
    out.warm = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RAW_SIBLING_WARM__ || null)));
    out.regional = await page.evaluate(() => JSON.parse(JSON.stringify((window.__RAW_STATIC_REGIONAL__ || window.__RAW_STATIC_FRAMES__ || {}).regional || window.__RAW_STATIC_REGIONAL__ || null)));
    if (STEPS) {
      out.steps = [];
      const wheel = page.locator(WHEEL).filter({ visible: true }).first();
      await wheel.focus(); await page.keyboard.press('Home'); await sleep(STEP_GAP);
      for (let i = 0; i < STEPS; i++) {
        await page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent !== null);
          window.__SB__.step = { t0: null, ms: null, long: 0, before: w ? Number(w.getAttribute('aria-valuenow')) : null, wall: Date.now(), hours: [],
            pan0: { ...(window.__RAW_SERIES_PAN__ || {}) }, h00: (window.__MARINE_SERIES_DIAG__ || {}).h0Loads || 0 }; }, WHEEL);
        await page.keyboard.press('PageUp');
        await sleep(STEP_GAP);
        const st = await page.evaluate((sel) => {
          const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent !== null);
          const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
          const S = window.__SB__.step; const F = window.__RAW_FORENSIC__;
          const ev = F && F.events ? F.events.filter((e) => e.t >= S.wall).slice(0, 60).map((e) => {
            const o = { dt: e.t - S.wall, type: e.type };
            for (const k of ['source', 'reason', 'hour', 'requestedHour', 'renderedHour', 'model', 'layer', 'decision', 'why', 'kind', 'cols', 'rows', 'sig', 'target', 'ageMs', 'panMoved', 'src', 'rule']) if (e[k] !== undefined) o[k] = e[k];
            return o; }) : null;
          // #501's containment answers during the step (contained / containedInFlight) and the hour-0 minis that landed
          const pan1 = window.__RAW_SERIES_PAN__ || {}; const panD = {};
          for (const k of Object.keys(pan1)) if ((pan1[k] || 0) - (S.pan0[k] || 0)) panD[k] = (pan1[k] || 0) - (S.pan0[k] || 0);
          panD.h0Loads = ((window.__MARINE_SERIES_DIAG__ || {}).h0Loads || 0) - S.h00;
          // the fetcher's pipeline events since the key (stale_async_response_rejected, data_committed, duplicate_commit_skipped, ...)
          const pipe = (((window.__MARINE_PIPELINE_TRUTH__ || {}).lastEvents) || []).filter((e) => Date.parse(e.timestamp) >= S.wall)
            .map((e) => ({ dt: Date.parse(e.timestamp) - S.wall, ev: e.event, hour: e.hour, model: e.model }));
          return { ...S, panD, pipe, wheelNow: w ? Number(w.getAttribute('aria-valuenow')) : null,
            engineHour: g ? g.hourOffset : null, dataHour: d ? d.hourOffset : null, ev, sharpen: window.__MARINE_SHARPEN_DIAG__ || null };
        }, WHEEL);
        out.steps.push({ wallSinceWaves: st.wall - tW, target: st.target ?? null, ms: st.ms == null ? null : Math.round(st.ms), long: st.long, series: st.series ?? null,
          before: st.before, wheelNow: st.wheelNow, engineHour: st.engineHour, dataHour: st.dataHour, keySeen: st.t0 != null,
          hours: st.hours, ev: st.ev, sharpen: st.sharpen, staleAdmitted: st.staleAdm || 0, staleSilent: st.staleSilent || 0, admittedAtMs: st.admAt ?? null,
          statusTexts: st.texts || [], panD: st.panD, pipe: st.pipe,
          console: clog.filter((c) => c.t >= st.wall && c.t < st.wall + STEP_GAP).slice(0, 40).map((c) => ({ dt: c.t - st.wall, s: c.s })) });
      }
    }
    if (out.__stopDiag) { out.__stopDiag(); delete out.__stopDiag; }
    out.asks = asks.filter((a) => a.kind !== 'other').map((a) => ({ kind: a.kind, layer: a.layer, hours: a.hours, surf: a.surf, model: a.model, bbox: a.bbox,
      cost: Math.round(a.cost), t0: a.t0 - tW, t1: a.t1 == null ? null : a.t1 - tW }));
    // the harness's own record: when each weather ask STARTED and how long until its response was ready (box model + synthetic build)
    out.req = (log.requests || []).filter((q) => /grid/.test(q.path || '')).map((q) => ({ t: q.t - (tW - log.t0), ms: q.ms, path: q.path,
      hours: q.q && q.q.hours ? String(q.q.hours).split(',').length : null, h0: q.q && q.q.hours ? Number(String(q.q.hours).split(',')[0]) : null,
      model: q.q && q.q.model, bbox: q.q && q.q.bbox, vt: q.q && q.q.valid_time }));
    out.box = { busyMs: Math.round(box.st.busyMs), cpu: Object.fromEntries(Object.entries(box.st.cpu).map(([k, v]) => [k, Math.round(v)])) };
  } catch (e) {
    out.error = String(e && e.message || e).slice(0, 300);
  } finally { await browser.close(); }
  return out;
}

function summary(s) {
  const shown = new Set(['waves', s.toggle && s.toggle.layer].filter(Boolean));
  const ser = (s.asks || []).filter((a) => a.kind === 'page' || a.kind === 'mini');
  const hidden = ser.filter((a) => !shown.has(a.layer));
  const wavesPages = ser.filter((a) => a.layer === 'waves' && a.kind === 'page');
  const firstHiddenPage = hidden.filter((a) => a.kind === 'page').map((a) => a.t0).sort((a, b) => a - b)[0];
  const lastWavesPage = Math.max(...wavesPages.map((a) => a.t1 || 0), 0);
  const hiddenCpu = Object.entries((s.box && s.box.cpu) || {}).filter(([k]) => !shown.has(k.split(':')[1]) && /^(page|mini)/.test(k)).reduce((x, [, v]) => x + v, 0);
  const byLayer = {}; for (const a of ser) { const k = `${a.model}:${a.layer}:${a.kind}`; byLayer[k] = (byLayer[k] || 0) + 1; }
  const visiblePageBoxes = new Set(ser.filter((a) => a.kind === 'page' && shown.has(a.layer)).map((a) => a.bbox)).size;
  const seriesCpu = ser.reduce((x, a) => x + (a.cost || 0), 0);
  return {
    byLayer, visiblePageBoxes, seriesCpuMs: Math.round(seriesCpu), gridAsks: (s.asks || []).filter((a) => a.kind === 'grid').length,
    series: ser.length, pages: ser.filter((a) => a.kind === 'page').length, minis: ser.filter((a) => a.kind === 'mini').length,
    hiddenPages: hidden.filter((a) => a.kind === 'page').length, hiddenMinis: hidden.filter((a) => a.kind === 'mini').length,
    hiddenCpuMs: Math.round(hiddenCpu), wavesPagesDoneMs: lastWavesPage, firstHiddenPageMs: firstHiddenPage == null ? null : firstHiddenPage,
  };
}

(async () => {
  if (cdn) await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const results = [];
  try {
    for (const kase of CASES) {
      for (const arm of ARMS) {
        const s = await session(arm, kase);
        s.summary = summary(s);
        results.push(s);
        const t = s.toggle ? ` | toggle ${s.toggle.layer} at ${s.toggleAt} ms: ${s.toggle.ms} ms (instant commit ${s.toggle.instantCommit} at ${s.toggle.commitMs} ms, series ${s.toggle.series}, ${s.toggle.fpsBefore} fps before; setWaveData [at, ms, layer] ${JSON.stringify(s.toggle.setWaveData)})` : '';
        console.log(`== ${kase.name} / ${arm.name}${s.error ? ' ERROR ' + s.error : ''} | first Waves ${s.firstWavesMs} ms${t}`);
        console.log(`   /grid_series ${s.summary.series} (pages ${s.summary.pages}, minis ${s.summary.minis}); hidden layers: pages ${s.summary.hiddenPages}, minis ${s.summary.hiddenMinis}, box CPU ${s.summary.hiddenCpuMs} ms; waves pages done ${s.summary.wavesPagesDoneMs} ms, first hidden page ${s.summary.firstHiddenPageMs} ms; box busy ${s.box && s.box.busyMs} ms`);
        if (s.drainedAt != null) console.log(`   drained at ${s.drainedAt} ms after Waves`);
        if (s.steps) console.log(`   steps (PageUp, ms to the hour on the GPU / frames >50 ms): ${s.steps.map((x) => `${x.ms}/${x.long}`).join(' ')}`);
        console.log(`   by model:layer:kind ${JSON.stringify(s.summary.byLayer)} | visible page boxes ${s.summary.visiblePageBoxes} | series CPU asked ${s.summary.seriesCpuMs} ms | /grid ${s.summary.gridAsks}`);
        console.log(`   warm ${JSON.stringify(s.warm)}`);
      }
    }
  } finally { if (cdn) cdn.close(); }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ env: { ZOOM, CLNG, CLAT, VIEW, BOX, COST, WATCH, CDN: !!CDN_DIR, SURF, MODEL, PAN_GAP, DRAIN, WATCH_MAX, STEPS, STEP_GAP }, results }, null, 1));
})();
