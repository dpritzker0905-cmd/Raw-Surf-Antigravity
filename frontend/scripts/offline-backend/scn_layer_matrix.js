// Every marine layer x model, scrubbed the same way, measured the same way (offline only).
//
// The "Jacobian lens" applied to time: for each step of the requested hour, how does the DISPLAYED hour move?
//   J_fast   = (displayed hour 300 ms after the step - displayed hour before) / (requested step)   ideal 1
//   J_settle = the same at settle (field correct or WIN ms)                                          ideal 1
// plus identity: the engine's resident grid must carry the SELECTED layer and model (wrong-layer / wrong-model frames are
// counted per animation frame, split by whether the app's own status line admitted them), and the path it came from
// (series frame vs per-hour grid vs client blend).
//
// Serve the full store first:
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <dir> --port 4101 --thin-bounds 1 \
//     --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3100
//   PORT=4101 OUT=matrix.json node frontend/scripts/offline-backend/scn_layer_matrix.js
// Env: MODELS (GFS,ICON,EURO), LAYERS (waves,swell_1,swell_2,wind_waves), WIN (ms per step, 8000), LAT_SERIES / LAT_GRID.
const fs = require('fs');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_layer_matrix is offline only');
const PORT = +(process.env.PORT || 4101);
const WIN = +(process.env.WIN || 8000);
const MODELS = (process.env.MODELS || 'GFS,ICON,EURO').split(',');
const LAYERS = (process.env.LAYERS || 'waves,swell_1,swell_2,wind_waves').split(',');
const LABEL = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves' };
const LAT_SERIES = +(process.env.LAT_SERIES || 0); const LAT_GRID = +(process.env.LAT_GRID || 0);
// Lattice membership of a target (the stored frames are 3-hourly from FIRST_VALID; the app's hour 0 is now rounded to the hour),
// so runs started in different UTC hours compare like with like. FIRST_VALID: the store's first_valid (serve_synthetic prints it).
const FIRST_VALID = process.env.FIRST_VALID ? Date.parse(process.env.FIRST_VALID) : null;
const onLattice = (target) => (FIRST_VALID == null ? null
  : (((Math.round(Date.now() / 3600000) * 3600000 + target * 3600000 - FIRST_VALID) / 3600000) % 3 + 3) % 3 === 0);
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// [key, expected requested hour after the key] relative walk from Home: 1-h steps (off-lattice), day steps, a burst, Home.
const STEPS = [['Home', 0], ['ArrowRight', 1], ['ArrowRight', 2], ['ArrowRight', 3], ['ArrowRight', 4], ['PageUp', 28], ['PageUp', 52],
  ['BURST', 172], ['PageDown', 148], ['Home', 0]];

const PROBE = () => {
  const P = (window.__MX__ = { w: null, lt: [] });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* none */ }
  window.addEventListener('keydown', (e) => { if (P.w) P.w.tLast = e.timeStamp; }, true);
  window.addEventListener('pointerup', (e) => { if (P.w) P.w.tLast = e.timeStamp; }, true);
  const wheel = () => [...document.querySelectorAll('[role="slider"][aria-label*="Forecast timeline"]')].find((el) => el.offsetParent !== null);
  let fc = 0; let ui = { status: '' };
  P.snap = () => {
    if ((fc++ % 4) === 0) ui = { status: [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 160) };
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    const up = d && d.u_waveTexture && window.__TEX__ && window.__TEX__.uploads.get(d.u_waveTexture);
    const w = wheel();
    return { wheel: w ? Number(w.getAttribute('aria-valuenow')) : null, hour: g ? g.hourOffset : null, layer: g ? g.__componentLayer : null,
      model: g ? g.__sourceModel : null, series: !!(g && g.__fromSeries), prov: g ? g.__gridProvider : null, est: !!(g && (g.is_estimated || g.isEstimated)),
      seq: up ? up.seq : -1, status: ui.status };
  };
  let prev = null;
  const loop = (t) => {
    const W = P.w;
    if (W && !W.done) {
      const s = P.snap();
      if (prev != null) { const dt = t - prev; W.frames++; if (dt > 50) W.gaps++; if (dt > W.maxGap) W.maxGap = dt; }
      if (W.tLast != null && t >= W.tLast) {
        const rel = t - W.tLast;
        if (W.at300 == null && rel >= 300) W.at300 = s.hour;
        const ok = s.hour === W.target && s.layer === W.layer && s.model === W.model && s.seq > W.seq0;
        if (W.field == null && ok) { W.field = rel; W.fieldSeries = s.series; W.fieldProv = s.prov; W.fieldEst = s.est; }
        const admitted = /Verifying|does not match|Loading|pending|nearest|estimated/i.test(s.status);
        if (s.hour != null && s.wheel != null && s.hour !== s.wheel) admitted ? W.hourAdm++ : W.hourSilent++;
        if (s.layer && s.layer !== W.layer) admitted ? W.layerAdm++ : W.layerSilent++;
        if (s.model && s.model !== W.model) admitted ? W.modelAdm++ : W.modelSilent++;
      }
    }
    prev = t; requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.arm = (target, layer, model) => { const s = P.snap(); P.w = { target, layer, model, seq0: s.seq, before: s.hour, tLast: null, at300: null, field: null,
    frames: 0, gaps: 0, maxGap: 0, hourSilent: 0, hourAdm: 0, layerSilent: 0, layerAdm: 0, modelSilent: 0, modelAdm: 0, lt0: P.lt.length }; };
  P.read = () => { const W = P.w; const lt = P.lt.slice(W.lt0); return { ...W, end: P.snap(), ltN: lt.length, ltMax: Math.round(lt.reduce((a, x) => Math.max(a, x[1]), 0)) }; };
};

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate((el) => el.click());
}
async function waitStep(page, { win = WIN } = {}) {
  const t0 = Date.now(); let r;
  do { await sleep(100); r = await page.evaluate(() => window.__MX__.read()); } while (r.field == null && Date.now() - t0 < win);
  await sleep(400);
  r = await page.evaluate(() => { const x = window.__MX__.read(); window.__MX__.w.done = true; return x; });
  return r;
}

(async () => {
  const { browser, page, log } = await L.launch({ port: PORT, hashTextureUploads: true, hooks: { beforeWeather: async (url) => {
    const d = url.pathname.endsWith('/grid_series') ? LAT_SERIES : url.pathname.endsWith('/grid') ? LAT_GRID : 0; if (d) await sleep(d); } } });
  await page.addInitScript(PROBE);
  const rows = []; const switches = [];
  const out = { env: { PORT, WIN, LAT_SERIES, LAT_GRID, startedUtc: new Date().toISOString() }, rows, switches };
  const save = () => { if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1)); };
  try {
    await L.openMap(page); await L.jump(page, -80, 24, 3.2);
    await clickExact(page, 'Waves');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    await sleep(6000);
    for (const model of MODELS) {
      for (const layer of LAYERS) {
        // switch (model first time per model, then layer), at the CURRENT hour (Home): time to the new identity on screen
        const cur = await page.evaluate(() => window.__MX__.snap());
        await page.evaluate(({ layer, model }) => { window.__MX__.arm(0, layer, model); window.__MX__.w.tLast = performance.now(); }, { layer, model });
        if (cur.model !== model) await clickExact(page, model);
        if (cur.layer !== layer) { await sleep(150); await clickExact(page, LABEL[layer]); }
        await page.evaluate(() => { window.__MX__.w.tLast = performance.now(); });
        const sw = await waitStep(page, { win: WIN * 2 });
        switches.push({ model, layer, ms: sw.field == null ? null : Math.round(sw.field), series: sw.fieldSeries, prov: sw.fieldProv, est: sw.fieldEst,
          layerSilent: sw.layerSilent, modelSilent: sw.modelSilent, hourSilent: sw.hourSilent, end: { h: sw.end.hour, l: sw.end.layer, m: sw.end.model }, ltMax: sw.ltMax });
        console.log('switch', JSON.stringify(switches.at(-1)));
        await sleep(1500);
        let prevReq = 0;
        for (const [key, target] of STEPS) {
          const before = await page.evaluate(() => window.__MX__.snap());
          await page.evaluate(({ t, l, m }) => window.__MX__.arm(t, l, m), { t: target, l: layer, m: model });
          const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
          if (key === 'BURST') { for (let i = 0; i < 5; i++) { await page.keyboard.press('PageUp'); await sleep(60); } } else await page.keyboard.press(key);
          const r = await waitStep(page);
          const dReq = target - prevReq;
          const j = (h) => (h == null || before.hour == null || dReq === 0) ? null : +((h - before.hour) / dReq).toFixed(2);
          rows.push({ model, layer, key, target, lattice: onLattice(target), ms: r.field == null ? null : Math.round(r.field), series: r.fieldSeries, prov: r.fieldProv, est: r.fieldEst,
            Jfast: j(r.at300), Jsettle: j(r.end.hour), endHour: r.end.hour, endLayer: r.end.layer, hourSilent: r.hourSilent, hourAdm: r.hourAdm,
            layerSilent: r.layerSilent, modelSilent: r.modelSilent, gaps: r.gaps, maxGap: Math.round(r.maxGap), ltMax: r.ltMax });
          console.log(JSON.stringify(rows.at(-1)));
          prevReq = target;
        }
        save();
      }
    }
    out.requests = log.requests.length; out.errors = log.errors.slice(0, 20); out.blockedWs = log.blockedWs.length;
  } finally { save(); await browser.close(); }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
