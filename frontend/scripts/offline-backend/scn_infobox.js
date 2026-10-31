// INFOBOX vs HEAT MAP (2026-10-27, the owner: "Display correct data on heat map and in infobox"). Offline only.
//
// One fresh browser per (model x point). Waves on, the model picked, the map at the point, then a long-press point placed through
// the app's own setter (window.setLongPressLocation, MapPage.js) so the point card (MapForecastOverlay) opens. For each hour in
// HOURS the wheel moves there (a key run, timed from its last key) and the probe waits for the card to settle, then records:
//   settleMs     last key -> the card describes this hour (the app's __MARINE_DIAG__.timeOffsetHours) with a value, stable for STABLE ms
//   appParity    the app's OWN heat-map/infobox check (window.__MARINE_SOURCE_PARITY__: MATCH / MISMATCH / UNSAMPLED + reasons)
//   shown        the card's wave height (the "Waves" row, and __MARINE_DIAG__.displayedValues.waveHeight in ft)
//   point        the /point answer the app used for this hour (captured from the wire): product, valid time, wave height (m)
//   drawn        the heat map's drawn frame (window.__MARINE_DRAWN__): model, hour, data time
//   grid         this backend's /grid answer for the same (model, hour) near the point: product, valid time, nearest node height (m)
// Checks per hour: TIME (the card's point product time == the drawn frame's data time: card and heat map show the same forecast
// time), VALUE (the card's height == the /point height, and within max(0.15 m, 10 %) of /grid's nearest node of the same product),
// PARITY (the app's own status is not MISMATCH). Hours whose /point never answered are recorded as `noPoint`.
//
//   EXPECT_STORE=<store> PORT=<backend> CDN_DIR=<frames> CDN_PORT=<free> AB_BASE=http://127.0.0.1:<spa> OUT=x.json node scn_infobox.js
// Env: MODELS (GFS,EURO,ICON), POINTS (lat:lng;..., default 30:-70 open ocean; 21.5:-118 and 15.5:-108.5 on the synthetic vortex's track, so values change by hour), ZOOM (4.6), HOURS (0,1,3,24,72,141,142,144,147,150,200,250,300),
// THEME (dark), SETTLE (6000), WIN (12000), STABLE (1000).
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_infobox is offline only (never load the live box)');
const PORT = +(process.env.PORT || 0);
const CDN_DIR = process.env.CDN_DIR;
const CDN_PORT = +(process.env.CDN_PORT || 0);
const EXPECT_STORE = process.env.EXPECT_STORE;
if (!process.env.AB_BASE || !PORT || !CDN_DIR || !CDN_PORT || !EXPECT_STORE) throw Error('AB_BASE, PORT, CDN_DIR, CDN_PORT and EXPECT_STORE are required');
const MODELS = (process.env.MODELS || 'GFS,EURO,ICON').split(',');
const POINTS = (process.env.POINTS || '30:-70;21.5:-118;15.5:-108.5').split(';').map((p) => { const [lat, lng] = p.split(':').map(Number); return { lat, lng }; });
const ZOOM = +(process.env.ZOOM || 4.6);
const HOURS = (process.env.HOURS || '0,1,3,24,72,141,142,144,147,150,200,250,300').split(',').map(Number);
const THEME = process.env.THEME || 'dark';
const SETTLE = +(process.env.SETTLE || 6000);
const WIN = +(process.env.WIN || 12000);
const STABLE = +(process.env.STABLE || 1000);
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stampMs = (pid) => { const m = /(\d{8}T\d{6}Z)/.exec(pid || ''); return m ? Date.parse(m[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : null; };

const cdn = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(CDN_DIR, rel);
  if (!file.startsWith(path.resolve(CDN_DIR)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(400, { 'access-control-allow-origin': '*', 'content-type': 'application/json' }); return res.end('{"statusCode":"404"}');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': body.length, 'cache-control': rel.endsWith('latest.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(body);
});

// What the page knows, read in one evaluate.
const READ = () => {
  const d = window.__MARINE_DIAG__ || null; const p = window.__MARINE_SOURCE_PARITY__ || null; const dr = window.__MARINE_DRAWN__ || null;
  const ov = document.querySelector('[data-testid="forecast-overlay"]');
  const rows = ov ? [...ov.querySelectorAll('[role="listitem"]')].map((x) => x.getAttribute('aria-label') || x.textContent.trim()) : [];
  const status = [...document.querySelectorAll('[data-drawn-state]')].filter((x) => x.offsetParent !== null).map((x) => x.textContent.trim()).join(' | ').slice(0, 140);
  const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
  return {
    overlay: !!ov, loading: !!(ov && /Loading/.test(ov.textContent || '') && !rows.length), rows,
    diag: d ? { hour: d.timeOffsetHours, model: d.activeModel, layer: d.activeLayer, status: d.exactPointStatus, valid: d.exactPointValid, src: d.source,
      pointPid: d.pointProductId, gridPid: d.gridProductId, shownFt: d.displayedValues ? d.displayedValues.waveHeight : null,
      exactM: d.exactPointValues ? d.exactPointValues.wave_height : null, snapped: d.snappedPoint, requested: d.requestedPoint } : null,
    parity: p ? { status: p.status, mismatch: p.mismatchReasons, unsampled: p.unsampledReasons, infoboxTs: p.infobox && p.infobox.timestamp, hour: p.timeOffsetHours } : null,
    drawn: dr ? { model: dr.model, hour: dr.hour, dataMs: dr.dataMs, store: dr.store, estimated: dr.estimated } : null,
    engine: g ? { hour: g.hourOffset, model: g.__sourceModel || 'GFS', pid: g.__servedProductId || g.productId || null, served: g.served_valid_time || null, dims: `${g.cols}x${g.rows}` } : null,
    status,
    anchor: (() => { const s = window.__RAW_SELECTED_FRAME__; return s && Number.isFinite(s.labelMs) && Number.isFinite(s.hour) ? s.labelMs - s.hour * 3600000 : Math.round(Date.now() / 3600000) * 3600000; })(),
  };
};

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate((el) => el.click());
}
const wheelNow = (page) => page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? +w.getAttribute('aria-valuenow') : 0; }, WHEEL);
function keyRun(from, to) {
  if (to === 0) return ['Home'];
  const d = to - from; const keys = [];
  for (let i = 0; i < Math.floor(Math.abs(d) / 24); i++) keys.push(d > 0 ? 'PageUp' : 'PageDown');
  for (let i = 0; i < Math.abs(d) % 24; i++) keys.push(d > 0 ? 'ArrowRight' : 'ArrowLeft');
  return keys;
}

async function gridNear(model, validMs, pt, gridBbox) {
  // the SAME box the app's point request carried (grid_bbox), so /grid answers with the product the point sampled; else the world box
  const bbox = gridBbox || '-180,-80,180,85';
  try {
    const j = await (await fetch(`http://127.0.0.1:${PORT}/api/weather/grid?model=${model}&domain=marine&layer=waves&valid_time=${encodeURIComponent(new Date(validMs).toISOString())}&bbox=${bbox}`)).json();
    const vs = (j.grid && j.grid.vectors) || [];
    let best = null; let bd = Infinity; const at = new Map();
    for (const v of vs) { if (v.is_valid === false || v.speed == null) continue; at.set(`${+v.lat.toFixed(4)},${+v.lng.toFixed(4)}`, v.speed); const dd = (v.lat - pt.lat) ** 2 + (v.lng - pt.lng) ** 2; if (dd < bd) { bd = dd; best = v; } }
    // BILINEAR on the product's own lattice (what /point reports doing): the four nodes around the point, else the nearest node.
    const lats = [...new Set(vs.map((v) => +v.lat.toFixed(4)))].sort((a, b) => a - b); const lngs = [...new Set(vs.map((v) => +v.lng.toFixed(4)))].sort((a, b) => a - b);
    let bil = null;
    const la0 = lats.filter((x) => x <= pt.lat).pop(); const la1 = lats.find((x) => x >= pt.lat); const lo0 = lngs.filter((x) => x <= pt.lng).pop(); const lo1 = lngs.find((x) => x >= pt.lng);
    if ([la0, la1, lo0, lo1].every((x) => x != null)) {
      const q = (a, b) => at.get(`${a},${b}`);
      const c = [q(la0, lo0), q(la0, lo1), q(la1, lo0), q(la1, lo1)];
      if (c.every((x) => x != null)) {
        const ty = la1 === la0 ? 0 : (pt.lat - la0) / (la1 - la0); const tx = lo1 === lo0 ? 0 : (pt.lng - lo0) / (lo1 - lo0);
        bil = +((c[0] * (1 - tx) + c[1] * tx) * (1 - ty) + (c[2] * (1 - tx) + c[3] * tx) * ty).toFixed(4);
      }
    }
    return { pid: j.product_id || null, dataMs: stampMs(j.product_id) || (j.served_valid_time ? Date.parse(j.served_valid_time) : null), bilinearM: bil, nearestM: best ? best.speed : null, nodeDistDeg: best ? +Math.sqrt(bd).toFixed(3) : null, nodes: vs.length };
  } catch (e) { return { error: String(e).slice(0, 100) }; }
}

async function session(model, pt) {
  const points = [];   // every /point answer the app received: { t, q, body }
  const hooks = { afterWeather: async (url, resp) => {
    if (!/\/point$/.test(url.pathname)) return;
    let body = null; try { body = JSON.parse((await resp.body()).toString('utf8')); } catch (e) { body = null; }
    points.push({ t: Date.now(), q: Object.fromEntries(url.searchParams.entries()), status: resp.status(), body });
  } };
  const { browser, page, log } = await L.launch({ port: PORT, width: 1280, height: 800, hooks });
  await page.addInitScript(({ base, theme }) => { localStorage.removeItem('__RAW_STATIC_FRAMES__'); window.__RAW_STATIC_FRAMES_BASE__ = base; localStorage.setItem('raw-surf-theme', theme); }, { base: `http://127.0.0.1:${CDN_PORT}/`, theme: THEME });
  const rows = []; let bundle = null;
  try {
    await L.openMap(page); await L.jump(page, pt.lng, pt.lat, ZOOM);
    bundle = await page.evaluate(() => { const s = [...document.scripts].map((x) => x.src).find((x) => /\/main\.[0-9a-f]+\.js/.test(x)); return s ? s.split('/').pop() : null; });
    await clickExact(page, 'Waves');
    await page.waitForFunction(() => { const d = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; return d && d.waveGrid; }, null, { timeout: 60000 });
    if (model !== 'GFS') await clickExact(page, model);
    await sleep(SETTLE);
    await page.evaluate((p) => { if (typeof window.setLongPressLocation === 'function') window.setLongPressLocation({ lat: p.lat, lng: p.lng }); }, pt);
    await page.waitForSelector('[data-testid="forecast-overlay"]', { timeout: 15000 }).catch(() => null);
    await sleep(2500);
    for (const h of HOURS) {
      const from = await wheelNow(page);
      await page.locator(WHEEL).filter({ visible: true }).first().focus();
      const keys = from === h ? [] : keyRun(from, h);
      for (const k of keys) { await page.keyboard.press(k); await sleep(40); }
      const t0 = Date.now(); const p0 = points.length;
      let last = null; let lastKey = ''; let since = t0; let settled = null;
      while (Date.now() - t0 < WIN) {
        await sleep(100);
        const s = await page.evaluate(READ);
        // settled = the card describes this hour with the EXACT point resolved (not the map estimate's interim 'refining' value)
        const ok = s.overlay && s.diag && s.diag.hour === h && s.diag.shownFt != null && !/loading/i.test(s.diag.status || '') && !s.rows.some((x) => /refining|Loading/.test(x));
        const key = JSON.stringify([ok, s.diag && s.diag.shownFt, s.diag && s.diag.pointPid, s.drawn && s.drawn.dataMs, s.parity && s.parity.status]);
        if (key !== lastKey) { lastKey = key; since = Date.now(); }
        last = s;
        if (ok && Date.now() - since >= STABLE) { settled = since - t0; break; }
      }
      const s = last || {};
      const sel = (s.anchor || 0) + h * 3600000;
      // the point product the CARD shows is the app's own record (diag.pointPid); the wire answer gives its value when it is this hour's
      const pointPid = (s.diag && s.diag.pointPid) || null;
      const used = points.slice(p0).filter((x) => x.body && x.q && String(x.q.model || '').toUpperCase() === model && (x.body.product_id === pointPid || x.body.served_valid_time)).pop() || null;
      const pb = used && used.body;
      const pointMs = stampMs(pointPid) || (pb && pb.served_valid_time ? Date.parse(pb.served_valid_time) : null);
      const pointM = pb ? ((pb.point && pb.point.speed) ?? (pb.hourly && pb.hourly.wave_height && pb.hourly.wave_height[0]) ?? null) : null;
      const drawnMs = s.drawn ? s.drawn.dataMs || stampMs(s.engine && s.engine.pid) : null;
      const vpBox = /_(-?\d+\.\d+)_(-?\d+\.\d+)_(-?\d+\.\d+)_(-?\d+\.\d+)\.json$/.exec(pointPid || '');   // a viewport point product names its box
      const grid = await gridNear(model, sel, pt, used && used.q && used.q.grid_bbox ? used.q.grid_bbox.split(',').map((x) => +(+x).toFixed(4)).join(',') : (vpBox ? vpBox.slice(1, 5).join(',') : null));
      const shownM = s.diag && s.diag.shownFt != null ? +(s.diag.shownFt / 3.28084).toFixed(3) : null;
      const valueRef = s.diag && s.diag.exactM != null ? s.diag.exactM : pointM;
      const row = { hour: h, settleMs: settled, keys: keys.length, selIso: new Date(sel).toISOString(), card: s.rows, status: s.status,
        appParity: s.parity, diag: s.diag, drawn: s.drawn ? { ...s.drawn, dataIso: drawnMs ? new Date(drawnMs).toISOString() : null } : null, engine: s.engine,
        point: { asks: points.slice(p0).length, pid: pointPid, dataIso: pointMs ? new Date(pointMs).toISOString() : null, m: pointM, q: used && used.q },
        grid: { ...grid, dataIso: grid.dataMs ? new Date(grid.dataMs).toISOString() : null } };
      row.checks = {
        time: pointMs == null || drawnMs == null ? null : pointMs === drawnMs,
        timeVsGrid: pointMs == null || grid.dataMs == null ? null : pointMs === grid.dataMs,
        shownVsPoint: shownM == null || valueRef == null ? null : Math.abs(shownM - valueRef) <= 0.05 + 0.02 * Math.abs(valueRef),
        pointVsGrid: valueRef == null || (grid.bilinearM ?? grid.nearestM) == null ? null : Math.abs(valueRef - (grid.bilinearM ?? grid.nearestM)) <= Math.max(0.15, 0.1 * Math.abs(grid.bilinearM ?? grid.nearestM)),
        parity: s.parity ? s.parity.status !== 'MISMATCH' : null,
      };
      row.noPoint = !pointPid;
      row.fail = Object.entries(row.checks).filter(([, v]) => v === false).map(([k]) => k);
      if (settled == null) row.fail.push('unsettled');
      rows.push(row);
    }
    const byPath = {}; for (const q of log.requests) byPath[q.path] = (byPath[q.path] || 0) + 1;
    return { model, point: pt, zoom: ZOOM, bundle, rows, backend: byPath, errors: log.errors.slice(0, 5) };
  } finally { await browser.close(); }
}

(async () => {
  const id = await (await fetch(`http://127.0.0.1:${PORT}/__harness/identity`)).json();
  if (path.resolve(id.store) !== path.resolve(EXPECT_STORE)) throw Error(`port ${PORT} serves ${id.store}, not EXPECT_STORE`);
  await new Promise((r) => cdn.listen(CDN_PORT, '127.0.0.1', r));
  const out = { env: { MODELS, POINTS, ZOOM, HOURS, THEME, SETTLE, WIN, STABLE, base: process.env.AB_BASE, store: id.store, startedUtc: new Date().toISOString() }, sessions: [], summary: {} };
  let fail = false;
  try {
    for (const pt of POINTS) for (const model of MODELS) {
      let s;
      try { s = await session(model, pt); } catch (e) { s = { model, point: pt, error: String(e && e.message || e).slice(0, 300), rows: [] }; }
      out.sessions.push(s);
      const k = `${model}@${pt.lat},${pt.lng}`;
      const fails = s.rows.filter((r) => r.fail.length);
      const st = s.rows.map((r) => r.settleMs).filter((x) => x != null).sort((a, b) => a - b);
      out.summary[k] = { bundle: s.bundle, hours: s.rows.length, failHours: fails.map((r) => [r.hour, r.fail.join('+')]), noPoint: s.rows.filter((r) => r.noPoint).map((r) => r.hour),
        appParity: s.rows.reduce((a, r) => { const x = (r.appParity && r.appParity.status) || 'none'; a[x] = (a[x] || 0) + 1; return a; }, {}),
        settle_p50: st.length ? st[Math.ceil(0.5 * st.length) - 1] : null, settle_max: st.length ? st[st.length - 1] : null, error: s.error };
      if (fails.length || s.error) fail = true;
      console.log(k, JSON.stringify(out.summary[k]));
      if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    }
  } finally {
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
    cdn.close();
  }
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
