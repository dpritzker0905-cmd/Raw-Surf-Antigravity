// #610 (2026-10-27): EURO's 6-hourly WAM band by MODEL STEP. Past model step 144 the stored EURO lattice is 6-hourly, the server
// answers an in-between hour with its nearest authoritative frame (up to 3 h away), and the status line must say so: "Showing X: the
// nearest stored forecast" (state `nearest`), never "Loading X… still showing Y" for good over that correct frame (the lead's live
// read on dcc514bf3: timeline 128 = step 146 stuck "Loading" 20+ s with nothing in flight). Offline only.
//
// One fresh browser per (zoom x arm). EURO Waves at CENTER, the wheel walked to FROM, then ONE ArrowRight per hour to TO. Per hour:
//   exactMs    key -> the engine holds the product /grid serves for (EURO, waves, hour) (by data time), labelled with that hour
//   settledMs  key -> the frame is exact AND the line is right for it: no words when its data time is the selection's instant,
//              `nearest` when it is 1-3 h off (EURO past step 144: drawnFrameReadout.latticeNearestMaxHours)
//   atRead     the line's state/text READ_MS (1000) after the key, the requests in flight then, and the drawn record's runMs
//   stuck      `pending` ("Loading … still showing") at READ_MS while the frame is exact and nothing is in flight
//   silent     frames whose data is > 3 h from the selection with no words
// PASS (per hour in the band 144 < step <= 240): settledMs <= NEAR_MAX_MS (100) and not stuck; 0 blank, 0 silent. Hours outside the
// band are recorded, not judged. ARMS default `cur,kill:__RAW_DISABLE_LATTICE_MODEL_STEP__` (the kill is the positive control: it
// keys the half-step off the timeline hour again, so timeline hours <= 144 whose step is > 144 read stuck "Loading").
//
//   EXPECT_STORE=<store dir> PORT=<backend> CDN_DIR=<frames> CDN_PORT=<free> AB_BASE=http://127.0.0.1:<spa> OUT=x.json \
//     node frontend/scripts/offline-backend/scn_euro_step_610.js
// Env: ZOOMS (4,6), CENTER (-75,30), FROM (126), TO (240), ARMS, THEME (dark), VIEW (desktop | owner 844x390), SETTLE (6000),
// READ_MS (1000), WIN (3000: the longest wait for the exact frame), NEAR_MAX_MS (100), KEY_GAP (0: extra ms after each hour's read).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_euro_step_610 is offline only (never load the live box)');
const PORT = +(process.env.PORT || 0);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 0);
const EXPECT_STORE = process.env.EXPECT_STORE;
if (!process.env.AB_BASE) throw Error('AB_BASE=http://127.0.0.1:<the SPA under test> is required');
if (!PORT || !CDN_DIR || !CDN_PORT || !EXPECT_STORE) throw Error('PORT, CDN_DIR, CDN_PORT and EXPECT_STORE are required');
const ZOOMS = (process.env.ZOOMS || '4,6').split(',').map(Number);
const [CLNG, CLAT] = (process.env.CENTER || '-75,30').split(',').map(Number);
const FROM = +(process.env.FROM || 126);
const TO = +(process.env.TO || 240);
const THEME = process.env.THEME || 'dark';
const VIEW = process.env.VIEW || 'desktop';
const VIEWS = { desktop: { width: 1280, height: 800, dpr: 1 }, owner: { width: 844, height: 390, dpr: 1 } };
const SETTLE = +(process.env.SETTLE || 6000);
const READ_MS = +(process.env.READ_MS || 1000);
const WIN = +(process.env.WIN || 3000);
const NEAR_MAX_MS = +(process.env.NEAR_MAX_MS || 100);
const KEY_GAP = +(process.env.KEY_GAP || 0);
const ARMS = (process.env.ARMS || 'cur,kill:__RAW_DISABLE_LATTICE_MODEL_STEP__').split(',').map((a) => { const [name, flags] = a.split(':'); return { name, flags: flags ? flags.split('+') : [] }; });
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The store's model run, by serve_synthetic.build_store's rule (first valid rounded down to 6 h), from the store we were told to expect.
const meta = JSON.parse(fs.readFileSync(path.join(EXPECT_STORE, 'store_meta.json'), 'utf8'));
const first = Date.parse(meta.first_valid);
const RUN_MS = first - (new Date(first).getUTCHours() % 6) * 3600000;

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length,
    'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(body);
});

const PROBE = () => {
  const P = (window.__E610__ = { w: null, layerOn: false });
  const stamp = (pid) => { const m = /(\d{8}T\d{6}Z)/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };
  const snap = () => {
    const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = d && d.waveGrid;
    const pid = g ? ((g.__fromFrameStore && g.__servedProductId) || g.__servedProductId || g.productId || null) : null;
    return { has: !!g, hour: g ? g.hourOffset : null, model: g ? (g.__sourceModel || 'GFS') : null, layer: g ? (g.__componentLayer || 'waves') : null,
      stride: g ? (g.__decimatedStride || 0) : 0, store: !!(g && g.__fromFrameStore), series: !!(g && g.__fromSeries), pid, served: g ? (g.served_valid_time || null) : null,
      dims: g ? `${g.cols}x${g.rows}` : null };
  };
  const dataMs = (s, W) => (s.pid ? stamp(s.pid) : (s.served ? Date.parse(s.served) : (s.series && s.hour != null ? W.anchor + s.hour * 3600000 : null)));
  const line = () => {
    const el = [...document.querySelectorAll('[data-drawn-state]')].find((x) => x.offsetParent !== null);
    const all = [...document.querySelectorAll('[role="status"]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 200);
    return { state: el ? el.getAttribute('data-drawn-state') : null, text: el ? el.textContent.trim().slice(0, 160) : '', all };
  };
  P.snap = snap; P.line = line;
  const loop = (t) => {
    const W = P.w;
    if (W && !W.done && W.t0 != null && t >= W.t0) {
      const s = snap(); const ln = line(); const rel = t - W.t0;
      W.frames += 1;
      if (P.layerOn && !s.has) { W.blank += 1; if (W.blankAt == null) W.blankAt = Math.round(rel); }
      const key = `${ln.state}|${ln.text}|${s.dims}|${s.store ? 's' : s.series ? 'q' : 'g'}|${s.hour}`;
      if (key !== W.lastKey && W.timeline.length < 16) { W.timeline.push([Math.round(rel), ln.state, ln.text.slice(0, 100), `${s.dims}${s.store ? 's' : s.series ? 'q' : 'g'}`, s.hour]); }
      W.lastKey = key;
      const dm = s.has ? dataMs(s, W) : null;
      const exact = s.has && s.model === 'EURO' && s.layer === 'waves' && s.hour === W.hour && s.stride === 0 && dm != null && dm === W.expected;
      if (W.exact == null && exact) { W.exact = rel; W.via = s.store ? 'store' : (s.series ? 'series' : 'grid'); }
      // the line is right for the drawn frame: no words when its data time IS the selection's instant, `nearest` within 3 h
      let ok = false;
      if (exact) { const dh = Math.round((dm - W.sel) / 3600000); ok = dh === 0 ? (ln.state == null || ln.state === 'estimated') : (Math.abs(dh) <= 3 && ln.state === 'nearest'); }
      if (W.settled == null && ok) W.settled = rel;
      if (W.settled != null && !ok && W.unsettled == null) W.unsettled = Math.round(rel);
      if (s.has && s.model === 'EURO' && s.hour === W.hour && dm != null && Math.abs(dm - W.sel) > 3 * 3600000 && !ln.state) { W.silent += 1; if (!W.silentEx) W.silentEx = { rel: Math.round(rel), pid: s.pid, served: s.served }; }
      if (W.atRead == null && rel >= W.readMs) {
        const dr = window.__MARINE_DRAWN__ || {};
        W.atRead = { state: ln.state, text: ln.text, exact, dataH: dm == null ? null : +((dm - W.sel) / 3600000).toFixed(2), drawnRunMs: dr.runMs || null, drawnHour: dr.hour, all: ln.all };
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.arm = (w) => { P.w = { ...w, t0: null, frames: 0, blank: 0, blankAt: null, silent: 0, exact: null, via: null, settled: null, unsettled: null, atRead: null, timeline: [], lastKey: '' }; };
  P.go = () => { P.w.t0 = performance.now(); };
  P.read = () => { const { lastKey, ...w } = P.w; return w; };
};

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  if (!(await loc.count())) { const e = page.locator('[aria-label="Expand weather controls"]').filter({ visible: true }).first(); if (await e.count()) { await e.click(); await sleep(500); } }
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate((el) => el.click());
}
const wheelNow = (page) => page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? +w.getAttribute('aria-valuenow') : null; }, WHEEL);
async function focusWheel(page) {
  if (!(await page.locator(WHEEL).filter({ visible: true }).count())) {
    const e = page.locator('[aria-label="Expand weather controls"]').filter({ visible: true }).first(); if (await e.count()) { await e.click(); await sleep(400); }
  }
  await page.locator(WHEEL).filter({ visible: true }).first().focus();
}
function keyRun(from, to) {
  const d = to - from; const keys = [];
  for (let i = 0; i < Math.floor(Math.abs(d) / 24); i++) keys.push(d > 0 ? 'PageUp' : 'PageDown');
  for (let i = 0; i < Math.abs(d) % 24; i++) keys.push(d > 0 ? 'ArrowRight' : 'ArrowLeft');
  return keys;
}

async function session({ zoom, arm }) {
  const v = VIEWS[VIEW];
  let inflight = 0; const asks = [];
  const hooks = { beforeWeather: async (url) => { inflight += 1; asks.push({ t: Date.now(), path: url.pathname.replace('/api/weather', ''), model: url.searchParams.get('model'), vt: url.searchParams.get('valid_time') }); },
    afterWeather: async () => { inflight = Math.max(0, inflight - 1); } };
  const { browser, page, log } = await L.launch({ port: PORT, width: v.width, height: v.height, dpr: v.dpr, hooks });
  await page.addInitScript(({ base, theme, flags }) => {
    localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base;
    localStorage.setItem('raw-surf-theme', theme);
    for (const f of flags) window[f] = true;
  }, { base: `http://127.0.0.1:${CDN_PORT}/`, theme: THEME, flags: arm.flags });
  await page.addInitScript(PROBE);
  const hours = []; let bundle = null;
  try {
    await L.openMap(page); await L.jump(page, CLNG, CLAT, zoom);
    bundle = await page.evaluate(() => { const s = [...document.scripts].map((x) => x.src).find((x) => /\/main\.[0-9a-f]+\.js/.test(x)); return s ? s.split('/').pop() : null; });
    await clickExact(page, 'Waves');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    await page.evaluate(() => { window.__E610__.layerOn = true; });
    await clickExact(page, 'EURO');
    await sleep(SETTLE);
    const idle = await page.evaluate(() => new Promise((resolve) => { const out = []; const one = () => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { out.push(performance.now() - t0); if (out.length < 20) setTimeout(one, 30); else { out.sort((a, b) => a - b); resolve(+out[10].toFixed(1)); } })); }; one(); }));
    await focusWheel(page);
    for (const k of keyRun((await wheelNow(page)) || 0, FROM)) { await page.keyboard.press(k); await sleep(40); }
    await sleep(2500);
    const box = zoom >= 7 ? await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const b = m.getBounds(); return [Math.floor(b.getWest()), Math.floor(b.getSouth()), Math.ceil(b.getEast()), Math.ceil(b.getNorth())].join(','); }) : '-180,-80,180,85';
    const cache = {};
    const expectedAt = async (ms) => {
      if (cache[ms] !== undefined) return cache[ms];
      try { const j = await (await fetch(`http://127.0.0.1:${PORT}/api/weather/grid?model=EURO&domain=marine&layer=waves&valid_time=${encodeURIComponent(new Date(ms).toISOString())}&bbox=${box}`)).json();
        const mm = /(\d{8}T\d{6}Z)/.exec(j.product_id || '');
        cache[ms] = mm ? Date.parse(mm[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : (j.served_valid_time ? Date.parse(j.served_valid_time) : null);
      } catch (e) { cache[ms] = null; }
      return cache[ms];
    };
    await focusWheel(page);
    for (let h = FROM + 1; h <= TO; h++) {
      // the selection's own instant = the app's anchor (ForecastTimeStatus publishes labelMs) + the hour
      const anchor = await page.evaluate(() => { const s = window.__RAW_SELECTED_FRAME__; return s && Number.isFinite(s.labelMs) && Number.isFinite(s.hour) ? s.labelMs - s.hour * 3600000 : Math.round(Date.now() / 3600000) * 3600000; });
      const sel = anchor + h * 3600000;
      const expected = await expectedAt(sel);
      await page.evaluate((w) => window.__E610__.arm(w), { hour: h, anchor, sel, expected, readMs: READ_MS });
      const t0 = Date.now(); const ask0 = asks.length;
      await page.evaluate(() => window.__E610__.go());
      await page.keyboard.press('ArrowRight');
      await page.evaluate(() => { window.__E610__.w.t0 = performance.now(); });
      let r; let inflightAtRead = null;
      do {
        await sleep(25);
        r = await page.evaluate(() => window.__E610__.read());
        if (inflightAtRead == null && r.atRead) inflightAtRead = inflight;
      } while ((r.atRead == null || (r.exact == null && Date.now() - t0 < WIN)) && Date.now() - t0 < WIN + READ_MS);
      r = await page.evaluate(() => { const x = window.__E610__.read(); window.__E610__.w.done = true; return x; });
      const wheel = await wheelNow(page);
      const step = (sel - RUN_MS) / 3600000;
      const inBand = step > 144 && step <= 240;
      const stuck = !!(r.atRead && r.atRead.state === 'pending' && r.atRead.exact && !inflightAtRead);
      const row = { hour: h, wheel, step, inBand, dataH: expected == null ? null : +((expected - sel) / 3600000).toFixed(2), exactMs: r.exact == null ? null : Math.round(r.exact), via: r.via,
        settledMs: r.settled == null ? null : Math.round(r.settled), unsettledAt: r.unsettled, atRead: r.atRead, inflightAtRead, stuck, blank: r.blank, silent: r.silent, silentEx: r.silentEx || undefined,
        asks: asks.slice(ask0).map((a) => `${a.path}${a.model ? ':' + a.model : ''}`), timeline: r.timeline };
      row.pass = !inBand ? null : (row.settledMs != null && row.settledMs <= NEAR_MAX_MS && !stuck && !row.blank && !row.silent);
      hours.push(row);
      if (KEY_GAP) await sleep(KEY_GAP);
    }
    const byPath = {}; for (const q of log.requests) byPath[q.path] = (byPath[q.path] || 0) + 1;
    return { zoom, arm: arm.name, flags: arm.flags, theme: THEME, view: VIEW, bundle, idleTwoRafMedian: idle, runIso: new Date(RUN_MS).toISOString(), hours, backend: byPath, errors: log.errors.slice(0, 5) };
  } finally { await browser.close(); }
}

(async () => {
  const id = await (await fetch(`http://127.0.0.1:${PORT}/__harness/identity`)).json();
  if (path.resolve(id.store) !== path.resolve(EXPECT_STORE)) throw Error(`port ${PORT} serves ${id.store}, not EXPECT_STORE ${EXPECT_STORE}`);
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const out = { env: { ZOOMS, CENTER: [CLNG, CLAT], FROM, TO, ARMS, THEME, VIEW, SETTLE, READ_MS, WIN, NEAR_MAX_MS, base: process.env.AB_BASE, store: id.store, runIso: new Date(RUN_MS).toISOString(), startedUtc: new Date().toISOString() }, sessions: [], summary: {} };
  let fail = false;
  try {
    for (const arm of ARMS) for (const zoom of ZOOMS) {
      let s;
      try { s = await session({ zoom, arm }); } catch (e) { s = { zoom, arm: arm.name, error: String(e && e.message || e).slice(0, 300), hours: [] }; }
      out.sessions.push(s);
      const band = s.hours.filter((x) => x.inBand);
      const sm = { bundle: s.bundle, idle: s.idleTwoRafMedian, band: band.length, pass: band.filter((x) => x.pass).length,
        stuck: band.filter((x) => x.stuck).map((x) => x.hour), slow: band.filter((x) => !x.stuck && (x.settledMs == null || x.settledMs > NEAR_MAX_MS)).map((x) => [x.hour, x.settledMs, x.via]),
        states: band.reduce((a, x) => { const k = (x.atRead && x.atRead.state) || 'none'; a[k] = (a[k] || 0) + 1; return a; }, {}),
        via: band.reduce((a, x) => { a[x.via || 'none'] = (a[x.via || 'none'] || 0) + 1; return a; }, {}),
        settled_p50: null, settled_p95: null, blank: s.hours.reduce((a, x) => a + x.blank, 0), silent: s.hours.reduce((a, x) => a + x.silent, 0), error: s.error };
      const st = band.map((x) => x.settledMs).filter((x) => x != null).sort((a, b) => a - b);
      if (st.length) { sm.settled_p50 = st[Math.ceil(0.5 * st.length) - 1]; sm.settled_p95 = st[Math.ceil(0.95 * st.length) - 1]; }
      sm.verdict = !s.error && sm.band > 0 && sm.pass === sm.band && !sm.blank && !sm.silent ? 'PASS' : 'FAIL';
      out.summary[`${arm.name}|z${zoom}`] = sm;
      if (arm.name === 'cur' && sm.verdict !== 'PASS') fail = true;
      console.log(`${arm.name} z${zoom} [${s.bundle} idle ${s.idleTwoRafMedian}] ${sm.verdict}: band ${sm.pass}/${sm.band} stuck=${JSON.stringify(sm.stuck)} slow=${JSON.stringify(sm.slow.slice(0, 12))} states=${JSON.stringify(sm.states)} via=${JSON.stringify(sm.via)} p50/p95=${sm.settled_p50}/${sm.settled_p95} blank=${sm.blank} silent=${sm.silent} ${s.error || ''}`);
      if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    }
  } finally {
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    cdn.close();
  }
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
