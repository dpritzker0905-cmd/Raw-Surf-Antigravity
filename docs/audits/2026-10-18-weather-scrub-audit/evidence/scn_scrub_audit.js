// AUDIT-ONLY scenario (untracked, scratchpad). Offline harness: the production bundle against the real FastAPI app over
// synthetic stored data (frontend/scripts/offline-backend). Nothing reaches the live backend (ab_lib routes /api/weather/* to
// 127.0.0.1:PORT and refuses live mode here).
//
// What it measures, per seek, in the PAGE clock (performance.now / event.timeStamp share a timebase):
//   ctl   : keydown timeStamp -> first rAF where the visible wheel's aria-valuenow equals the target (control feedback proxy)
//   field : keydown -> first rAF where the marine engine's RESIDENT wave grid has hourOffset == target AND the resident wave
//           texture received a NEW typed-byte upload after the input (first correct field, upload-proxy; not presentation proof)
//   mism  : rAF frames inside the window where engine hour != wheel hour (what the user could see mislabelled), split by
//           whether the app's heatmap status admitted it (retained/loading) or not
//   gaps  : rAF deltas > 50 ms / max delta, long tasks (PerformanceObserver longtask) inside the window
// Race block: a rapid key sequence with per-request injected delays (older targets slower), then the final resident
// texture hash compared with a DIRECT seek to the same target in a fresh page (same server, same run).
//
// Env: PORT (4101), LAT_SERIES / LAT_GRID (ms, injected per request), OUT (json path), PHASES (comma list)
const fs = require('fs');
const path = require('path');
const L = require(path.resolve(process.env.HARNESS_DIR || 'frontend/scripts/offline-backend', 'ab_lib.js'));
const PORT = +(process.env.PORT || 4101);
const LAT_SERIES = +(process.env.LAT_SERIES || 0); const LAT_GRID = +(process.env.LAT_GRID || 0);
const PHASES = (process.env.PHASES || 'seeks,warm,race,drag,switch').split(',');
const WIN = +(process.env.WIN || 20000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';

// In-page probe: installed before app scripts. Keeps a per-window record; the driver arms it with a target.
const PROBE = () => {
  const P = (window.__AUDIT__ = { win: null, longtasks: [] });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { /* unsupported */ }
  window.addEventListener('keydown', (e) => { if (P.win) { if (P.win.tIn == null) P.win.tIn = e.timeStamp; P.win.tLast = e.timeStamp; P.win.ctlL = null; P.win.fieldL = null; } }, true);
  window.addEventListener('pointerup', (e) => { if (P.win) P.win.tUp = e.timeStamp; }, true);
  window.addEventListener('pointerdown', (e) => { if (P.win && P.win.tIn == null) P.win.tIn = e.timeStamp; }, true);
  const wheel = () => [...document.querySelectorAll('[role="slider"][aria-label*="Forecast timeline"]')].find((el) => el.offsetParent !== null);
  const engine = () => {
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData;
    const g = d && d.waveGrid;
    const up = d && d.u_waveTexture && window.__TEX__ && window.__TEX__.uploads.get(d.u_waveTexture);
    return { hour: g ? g.hourOffset : null, model: g ? g.__sourceModel : null, prov: g ? g.__gridProvider : null, seq: up ? up.seq : null, hash: up ? up.hash : null };
  };
  let fc = 0; let ui = { sel: null, status: '' };
  const readUi = () => { const b = [...document.querySelectorAll('button[aria-pressed="true"]')].map((x) => (x.textContent || '').trim()).find((t) => /^(GFS|ICON|EURO|ECMWF)/.test(t)); const st = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => (x.textContent || '').trim()).filter(Boolean).join(' | '); ui = { sel: b ? b.split(/\s/)[0] : null, status: st.slice(0, 160) }; };
  P.snap = () => { if ((fc++ % 4) === 0) readUi(); const w = wheel(); const e = engine(); const hs = window.__MARINE_HEATMAP_STATUS__ || {}; const par = window.__MARINE_RENDER_HOUR_PARITY__ || {};
    return { wheel: w ? Number(w.getAttribute('aria-valuenow')) : null, wtext: w ? w.getAttribute('aria-valuetext') : null, ...e, hstatus: hs.status || null, retained: !!hs.retainedPrevious, sel: ui.sel, ustatus: ui.status, preq: par.requestedHour, pren: par.renderedDataHour }; };
  let prev = null;
  const loop = (t) => {
    const W = P.win;
    if (W && !W.done) {
      const s = P.snap();
      if (prev != null) { const dt = t - prev; W.frames += 1; if (dt > 50) W.gaps50 += 1; if (dt > W.maxGap) W.maxGap = dt; }
      if (W.tIn != null && t >= W.tIn) {
        if (W.ctl == null && s.wheel === W.target) W.ctl = t - W.tIn;
        if (W.field == null && s.hour === W.target && s.seq != null && s.seq > W.seq0) { W.field = t - W.tIn; W.fieldSnap = s; }
        if (W.tLast != null) { if (W.ctlL == null && s.wheel === W.target) W.ctlL = t - W.tLast; if (W.fieldL == null && s.hour === W.target && s.seq != null && s.seq > W.seq0) W.fieldL = t - W.tLast; }
        if (s.sel && s.model && s.sel !== s.model) { if (/Verifying|does not match|Loading/i.test(s.ustatus)) W.modelMismAdmitted += 1; else { W.modelMismSilent += 1; if (W.modelSamples.length < 4) W.modelSamples.push({ t: Math.round(t - W.tIn), sel: s.sel, model: s.model, ustatus: s.ustatus }); } }
        if (s.hour != null && s.wheel != null && s.hour !== s.wheel) { if (s.retained || /retain|load|pending|stale/i.test(String(s.hstatus)) || /Verifying|does not match|Loading/i.test(s.ustatus)) W.mismAdmitted += 1; else W.mismSilent += 1; if (W.mismSamples.length < 6) W.mismSamples.push({ t: Math.round(t - W.tIn), wheel: s.wheel, hour: s.hour, hstatus: s.hstatus, ustatus: s.ustatus }); }
        if (s.seq !== W.lastSeq) { W.uploads += 1; W.lastSeq = s.seq; if (W.uploadHours.length < 40) W.uploadHours.push([Math.round(t - W.tIn), s.hour]); }
        if (W.lagTrace && W.lagTrace.length < 4000) W.lagTrace.push([Math.round(t - W.tIn), s.wheel, s.hour]);
      }
    }
    prev = t; requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.arm = (target, opts = {}) => { const s = P.snap(); P.win = { target, seq0: s.seq == null ? -1 : s.seq, lastSeq: s.seq, tIn: null, tLast: null, ctlL: null, fieldL: null, modelMismSilent: 0, modelMismAdmitted: 0, modelSamples: [], ctl: null, field: null, frames: 0, gaps50: 0, maxGap: 0, mismAdmitted: 0, mismSilent: 0, mismSamples: [], uploads: 0, uploadHours: [], lagTrace: opts.lag ? [] : null, lt0: P.longtasks.length, start: s }; };
  P.read = () => { const W = P.win; if (!W) return null; const lt = P.longtasks.slice(W.lt0).filter((x) => W.tIn == null || x[0] >= W.tIn - 5); return { ...W, longtasks: lt.length, longtaskMs: lt.reduce((a, x) => a + x[1], 0), longtaskMax: lt.reduce((a, x) => Math.max(a, x[1]), 0), end: P.snap() }; };
};

async function setup({ delayFn } = {}) {
  const { browser, page, log } = await L.launch({ port: PORT, width: +(process.env.VW || 1280), height: +(process.env.VH || 800), dpr: +(process.env.DPR || 1), hashTextureUploads: true, hooks: { beforeWeather: async (url) => {
    let d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID : 0;
    if (delayFn) d = delayFn(url, d);
    if (d) await sleep(d);
  } } });
  await page.addInitScript(PROBE);
  return { browser, page, log };
}
async function wheelValue(page) { return Number(await page.locator(WHEEL).filter({ visible: true }).first().getAttribute('aria-valuenow')); }
async function keySeek(page, hour, gap = 0) {
  const wheel = page.locator(WHEEL).filter({ visible: true }).first();
  await wheel.focus();
  const cur = Number(await wheel.getAttribute('aria-valuenow'));
  const delta = hour - cur;
  if (hour === 0) { await page.keyboard.press('Home'); return; }
  for (let i = 0; i < Math.floor(Math.abs(delta) / 24); i++) { await page.keyboard.press(delta > 0 ? 'PageUp' : 'PageDown'); if (gap) await sleep(gap); }
  for (let i = 0; i < Math.abs(delta) % 24; i++) { await page.keyboard.press(delta > 0 ? 'ArrowRight' : 'ArrowLeft'); if (gap) await sleep(gap); }
}
async function measuredSeek(page, hour, { win = WIN, lag = false } = {}) {
  await page.evaluate(({ h, lag }) => window.__AUDIT__.arm(h, { lag }), { h: hour, lag });
  const t0 = Date.now();
  await keySeek(page, hour);
  let r;
  do { await sleep(100); r = await page.evaluate(() => window.__AUDIT__.read()); } while (r.fieldL == null && Date.now() - t0 < win);
  await sleep(1200);   // observe the tail (late stale commits after the correct field)
  r = await page.evaluate(() => { const x = window.__AUDIT__.read(); window.__AUDIT__.win.done = true; return x; });
  return { target: hour, ctl: r.ctlL, field: r.fieldL, ctlFirst: r.ctl, fieldFirst: r.field, timedOut: r.fieldL == null, modelMismSilent: r.modelMismSilent, modelMismAdmitted: r.modelMismAdmitted, frames: r.frames, gaps50: r.gaps50, maxGap: Math.round(r.maxGap), mismSilent: r.mismSilent, mismAdmitted: r.mismAdmitted, mismSamples: r.mismSamples, uploads: r.uploads, uploadHours: r.uploadHours, longtasks: r.longtasks, longtaskMs: r.longtaskMs, longtaskMax: r.longtaskMax, endHour: r.end.hour, endWheel: r.end.wheel, endHash: r.end.hash, endModel: r.end.model, endProv: r.end.prov, wtext: r.end.wtext, hstatus: r.end.hstatus, fieldSnap: r.fieldSnap ? { hour: r.fieldSnap.hour, hash: r.fieldSnap.hash } : null };
}
async function activate(page, model) {
  await L.openMap(page);
  await L.jump(page, -108, 16, 3);
  const exp = page.locator('button[aria-label="Expand weather controls"], button[aria-label="Weather layers"]').filter({ visible: true }).first();
  if (await exp.count()) await exp.evaluate((el) => el.click());
  await page.waitForTimeout(800);
  await L.clickText(page, 'Waves');
  if (model && model !== 'GFS') await L.clickText(page, model);
  await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid && d.waveGrid.hourOffset === 0 && window.__TEX__.uploads.has(d.u_waveTexture); }, null, { timeout: 60000 });
  await sleep(4000);
}
const pct = (xs, p) => { const a = xs.filter((x) => x != null).sort((x, y) => x - y); if (!a.length) return null; return Math.round(a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)]); };
const stat = (rows, k) => ({ n: rows.length, ok: rows.filter((r) => r[k] != null).length, p50: pct(rows.map((r) => r[k]), 0.5), p95: pct(rows.map((r) => r[k]), 0.95), max: pct(rows.map((r) => r[k]), 1) });

(async () => {
  const out = { env: { PORT, LAT_SERIES, LAT_GRID, startedUtc: new Date().toISOString(), node: process.version }, phases: {} };
  const save = () => { if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1)); };
  // ---- A. cold seeks then warm revisits, one page ----
  if (PHASES.includes('seeks')) {
    const { browser, page, log } = await setup();
    try {
      const tA = Date.now(); await activate(page, 'GFS'); out.phases.activationMs = Date.now() - tA;
      const targets = (process.env.TARGETS || '1,2,3,27,51,50,74,98,122,146,170,169,168,192,216,240,264,288,312,336,335,0').split(',').map(Number);
      const cold = []; for (const h of targets) { const r = await measuredSeek(page, h); cold.push(r); console.log('cold', JSON.stringify({ h, ctl: r.ctl, field: r.field, silent: r.mismSilent, adm: r.mismAdmitted, end: r.endHour, gaps: r.gaps50, maxGap: r.maxGap })); }
      out.phases.cold = { rows: cold, ctl: stat(cold, 'ctl'), field: stat(cold, 'field') };
      if (PHASES.includes('warm')) {
        const warm = []; for (const h of targets) { const r = await measuredSeek(page, h); warm.push(r); console.log('warm', JSON.stringify({ h, ctl: r.ctl, field: r.field, silent: r.mismSilent, end: r.endHour })); }
        out.phases.warm = { rows: warm, ctl: stat(warm, 'ctl'), field: stat(warm, 'field') };
      }
      out.phases.seeksRequests = log.requests.map((r) => ({ t: r.t, ms: r.ms, path: r.path, model: r.q && r.q.model, vt: r.q && r.q.valid_time, nh: r.q && r.q.hours ? r.q.hours.split(',').length : undefined, h0: r.q && r.q.hours ? r.q.hours.split(',')[0] : undefined, status: r.status }));
      out.phases.seeksErrors = log.errors; out.phases.seeksConsole = log.console.slice(0, 40); out.phases.hosts = log.hosts; out.phases.blockedWs = log.blockedWs.length;
    } finally { await browser.close(); save(); }
  }
  // ---- B. race: rapid sequence with skewed latency (older targets slower) vs direct seek ----
  if (PHASES.includes('race')) {
    const seq = [48, 6, 72, 18];
    const order = new Map(); let n = 0;
    // every weather GET gets a delay that SHRINKS with arrival order: the first (oldest) requests return last
    const delayFn = (url, d) => { const k = url.pathname + url.search; if (!order.has(k)) order.set(k, n++); return d + Math.max(0, 4000 - 900 * order.get(k)); };
    const runs = [];
    for (let rep = 0; rep < 3; rep++) {
      order.clear(); n = 0;
      const { browser, page, log } = await setup({ delayFn: (u, d) => (order.armed ? delayFn(u, d) : d) });
      try {
        await activate(page, 'GFS');
        await page.evaluate(() => window.__AUDIT__.arm(18, { lag: true }));
        order.armed = true; order.clear(); n = 0;
        for (const h of seq) { await keySeek(page, h); await sleep(120); }
        const t0 = Date.now(); let r;
        do { await sleep(200); r = await page.evaluate(() => window.__AUDIT__.read()); } while (Date.now() - t0 < 12000);
        r = await page.evaluate(() => window.__AUDIT__.read());
        runs.push({ rep, final: r.end, field: r.field, mismSilent: r.mismSilent, mismAdmitted: r.mismAdmitted, mismSamples: r.mismSamples, uploadHours: r.uploadHours, requests: log.requests.filter((q) => q.t > 0).slice(-30).map((q) => ({ t: q.t, ms: q.ms, path: q.path, vt: q.q && q.q.valid_time, h0: q.q && q.q.hours ? q.q.hours.split(',')[0] : undefined })) });
        console.log('race', rep, JSON.stringify({ end: r.end, field: r.field, silent: r.mismSilent, uploads: r.uploadHours }));
      } finally { await browser.close(); }
    }
    // direct seek oracle (no skew)
    const direct = [];
    for (let rep = 0; rep < 2; rep++) {
      const { browser, page } = await setup();
      try { await activate(page, 'GFS'); const r = await measuredSeek(page, 18); direct.push({ rep, endHash: r.endHash, endHour: r.endHour, field: r.field }); console.log('direct', JSON.stringify(direct.at(-1))); } finally { await browser.close(); }
    }
    out.phases.race = { seq, runs, direct, finalMatchesDirect: runs.map((x) => x.final.hash === direct[0].endHash && x.final.hour === 18) };
    save();
  }
  // ---- C. continuous pointer drag on the wheel: lag between intent and displayed hour, settle after release ----
  if (PHASES.includes('drag')) {
    const { browser, page, log } = await setup();
    try {
      await activate(page, 'GFS');
      const box = await page.locator(WHEEL).filter({ visible: true }).first().boundingBox();
      const y = box.y + box.height / 2; let x = box.x + box.width * 0.8;
      await page.evaluate(() => window.__AUDIT__.arm(-1, { lag: true }));
      await page.mouse.move(x, y); await page.mouse.down();
      const tStart = Date.now();
      for (let i = 0; i < 150; i++) { x -= 3; await page.mouse.move(x, y); await sleep(16); }   // ~2.4 s steady drag leftwards (forward in time)
      await sleep(400);                                    // pause before release -> settle, not coast
      await page.mouse.up();
      const dragMs = Date.now() - tStart;
      const finalWheel = await wheelValue(page);
      const t0 = Date.now(); let r;
      do { await sleep(100); r = await page.evaluate(() => window.__AUDIT__.read()); } while (!(r.end.hour === finalWheel) && Date.now() - t0 < WIN);
      await sleep(800);
      r = await page.evaluate(() => window.__AUDIT__.read());
      const tr = r.lagTrace || [];
      const relT = tr.length ? tr[tr.length - 1][0] : 0;
      // first frame (page clock relative to pointerdown) at which the engine equals the final wheel hour and stays
      let settleAt = null; for (let i = tr.length - 1; i >= 0; i--) { if (tr[i][2] === finalWheel) settleAt = tr[i][0]; else break; }
      const lags = tr.filter((f) => f[1] != null && f[2] != null).map((f) => Math.abs(f[1] - f[2]));
      out.phases.drag = { dragMs, finalWheel, endHour: r.end.hour, settleAtMsFromDown: settleAt, traceMs: relT, lagHoursP50: pct(lags, 0.5), lagHoursP95: pct(lags, 0.95), lagHoursMax: pct(lags, 1), uploads: r.uploads, uploadHours: r.uploadHours, gaps50: r.gaps50, maxGap: Math.round(r.maxGap), longtasks: r.longtasks, longtaskMs: r.longtaskMs, mismSilent: r.mismSilent, mismAdmitted: r.mismAdmitted, requests: log.requests.length, trace: tr.filter((_, i) => i % 3 === 0).slice(0, 600) };
      console.log('drag', JSON.stringify({ ...out.phases.drag, trace: undefined }));
    } finally { await browser.close(); save(); }
  }
  // ---- D. model switch while a future hour is selected and pending ----
  if (PHASES.includes('switch')) {
    const { browser, page, log } = await setup({ delayFn: (u, d) => d + (u.searchParams.get('model') === 'ICON' ? 2500 : 0) });
    try {
      await activate(page, 'GFS');
      const r1 = await measuredSeek(page, 72);
      await page.evaluate(() => window.__AUDIT__.arm(72, {}));
      await L.clickText(page, 'ICON');
      await page.evaluate(() => { if (window.__AUDIT__.win.tIn == null) window.__AUDIT__.win.tIn = performance.now(); });
      const t0 = Date.now(); let r;
      do { await sleep(200); r = await page.evaluate(() => window.__AUDIT__.read()); } while (!(r.end.model === 'ICON' && r.end.hour === 72) && Date.now() - t0 < WIN);
      await sleep(1500);
      r = await page.evaluate(() => window.__AUDIT__.read());
      const snaps = [];
      out.phases.switch = { gfs72: { field: r1.field, hash: r1.endHash }, afterSwitch: { end: r.end, modelMismSilent: r.modelMismSilent, modelMismAdmitted: r.modelMismAdmitted, modelSamples: r.modelSamples, mismSilent: r.mismSilent, mismAdmitted: r.mismAdmitted, uploadHours: r.uploadHours, msToIcon72: r.end.model === 'ICON' && r.end.hour === 72 ? Date.now() - t0 : null } };
      // back to GFS: does the GFS 72 field return identical (cache reuse) and is ICON content ever shown under the GFS label?
      await page.evaluate(() => window.__AUDIT__.arm(72, {}));
      await L.clickText(page, 'GFS');
      await page.evaluate(() => { if (window.__AUDIT__.win.tIn == null) window.__AUDIT__.win.tIn = performance.now(); });
      await sleep(6000);
      r = await page.evaluate(() => window.__AUDIT__.read());
      out.phases.switch.backToGfs = { end: r.end, hashEqualsBefore: r.end.hash === r1.endHash, uploadHours: r.uploadHours };
      console.log('switch', JSON.stringify(out.phases.switch));
    } finally { await browser.close(); save(); }
  }
  save();
  console.log('DONE');
})().catch((e) => { console.error('FAIL', e.stack); process.exit(1); });
