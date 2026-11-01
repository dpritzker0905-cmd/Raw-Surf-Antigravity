// Does decoding two hours at once ever return the wrong hour's data? (The decoder shares ONE file reader across every state;
// setToOmFile disposes and replaces it, and the app lets 3 protocol calls run at once.)
// Session A: the app's own concurrent pattern (toggle, then steps: each step loads the target and the neighbour together).
// Session B: every hour decoded ALONE (window.__FETCH_OM_TILE__, awaited one by one).
// Compares an FNV hash of the decoded values per (variable, model, time index), read from the app's own side channel
// (window.__DECODED_OM_TILES__, written by postReadCallback with the state's own URL). Replay only: no network.
const L = require('../offline-backend/ab_lib.js');
const { RR } = require('./rr.js');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.AB_BASE || 'http://127.0.0.1:3198';
const LAYER = process.env.LAYER || 'rain';
const VAR = { rain: 'precipitation', temperature: 'temperature_2m', satellite: 'cloud_cover' }[LAYER];
const MODEL = process.env.OM_MODEL || 'ncep_gfs013';
const HASHES = () => {
  const out = {};
  for (const [k, v] of window.__DECODED_OM_TILES__ || []) {
    const a = v.values; if (!a) continue;
    let h = 2166136261; const step = Math.max(1, Math.floor(a.length / 200000));
    for (let i = 0; i < a.length; i += step) { const x = Math.round((a[i] || 0) * 1000); h = Math.imul(h ^ (x & 0xffff), 16777619); }
    out[`${v.variable}|${v.model}|${v.timeIndex}`] = (h >>> 0).toString(16) + ':' + a.length;
  }
  return out;
};
async function session(rr, meta, fn) {
  const { browser, page } = await L.launch({ port: 4198 });
  await rr.install(page);
  await page.addInitScript((off) => { const RD = Date; function D(...a) { if (!(this instanceof D)) return new RD(RD.now() + off).toString(); return a.length ? new RD(...a) : new RD(RD.now() + off); } D.prototype = RD.prototype; D.now = () => RD.now() + off; D.parse = RD.parse; D.UTC = RD.UTC; window.Date = D; }, meta.tRec - Date.now());
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__MAP_INSTANCE__, null, { timeout: 90000 });
  await sleep(2000);
  await L.jump(page, -79.8, 28.0, 4);
  await sleep(2000);
  await fn(page);
  const h = await page.evaluate(HASHES);
  await browser.close();
  return h;
}
(async () => {
  const rr = new RR(process.env.RR_DIR, { mode: 'replay', lat: process.env.RR_LAT || '1' });
  const meta = require(path.join(process.env.RR_DIR, 'meta.json'));
  const A = await session(rr, meta, async (page) => {
    await page.evaluate((l) => window.toggleLayer(l), LAYER);
    await sleep(6000);
    for (let h = 1; h <= 10; h++) { await page.evaluate((h) => window.setTimeOffsetHours(h), h); await sleep(+(process.env.DWELL || 1200)); }
    await sleep(6000);
  });
  const idx = [...new Set(Object.keys(A).filter((k) => k.startsWith(`${VAR}|${MODEL}|`)).map((k) => +k.split('|')[2]))].sort((a, b) => a - b);
  const B = await session(rr, meta, async (page) => {
    await page.evaluate((l) => window.toggleLayer(l), LAYER);   // registers the protocol; then each hour alone
    await sleep(6000);
    for (const i of idx) { await page.evaluate(({ v, i, m }) => window.__FETCH_OM_TILE__(v, i, m), { v: VAR, i, m: MODEL }); }
  });
  let same = 0; const diff = [];
  for (const i of idx) {
    const k = `${VAR}|${MODEL}|${i}`;
    if (!B[k]) continue;
    if (A[k] === B[k]) same += 1; else diff.push({ i, concurrent: A[k], alone: B[k], matchesNeighbour: Object.entries(B).filter(([kk, vv]) => vv === A[k]).map(([kk]) => kk) });
  }
  console.log(JSON.stringify({ layer: LAYER, indices: idx, same, diff }, null, 1));
})();
