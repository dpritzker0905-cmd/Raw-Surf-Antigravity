// Are two builds' decoded fields identical? Toggle LAYER on each build (AB_A, AB_B), step through hours 1..N, and compare an
// FNV hash of every decoded field the app publishes on its own side channel (window.__DECODED_OM_TILES__, written by
// postReadCallback AFTER the water-temp land fill). Replay only (RR_MODE=replay): no network.
//   AB_A=http://127.0.0.1:3198 AB_B=http://127.0.0.1:3196 LAYER=water_temp RR_DIR=<cache> node probe_field_parity.js
// FLAGS_A / FLAGS_B (JSON): window levers per arm, e.g. the same build with and without a kill switch.
const L = require('../offline-backend/ab_lib.js');
const { RR } = require('./rr.js');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAYER = process.env.LAYER || 'water_temp';
const N = +(process.env.HOURS || 6);
const HASHES = () => {
  const out = {};
  for (const [, v] of window.__DECODED_OM_TILES__ || []) {
    const a = v.values; if (!a) continue;
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
    out[`${v.variable}|${v.model}|${v.timeIndex}`] = (h >>> 0).toString(16) + ':' + a.length;
  }
  return out;
};
async function run(rr, meta, base, flags = {}) {
  const { browser, page } = await L.launch({ port: 4198 });
  await rr.install(page);
  await page.addInitScript((f) => { for (const [k, v] of Object.entries(f)) window[k] = v; }, flags);
  await page.addInitScript((off) => { const RD = Date; function D(...a) { if (!(this instanceof D)) return new RD(RD.now() + off).toString(); return a.length ? new RD(...a) : new RD(RD.now() + off); } D.prototype = RD.prototype; D.now = () => RD.now() + off; D.parse = RD.parse; D.UTC = RD.UTC; window.Date = D; }, meta.tRec - Date.now());
  await page.goto(base + '/map', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__MAP_INSTANCE__, null, { timeout: 90000 });
  await sleep(2000);
  await L.jump(page, -79.8, 28.0, 4);
  await sleep(2000);
  const t0 = Date.now();
  await page.evaluate((l) => window.toggleLayer(l), LAYER);
  await sleep(+(process.env.WAIT || 12000));
  for (let h = 1; h <= N; h++) { await page.evaluate((h) => window.setTimeOffsetHours(h), h); await sleep(+(process.env.WAIT || 12000)); }
  const out = await page.evaluate(HASHES);
  await browser.close();
  return { out, ms: Date.now() - t0 };
}
(async () => {
  const rr = new RR(process.env.RR_DIR, { mode: 'replay', lat: process.env.RR_LAT || '1' });
  const meta = require(path.join(process.env.RR_DIR, 'meta.json'));
  const A = await run(rr, meta, process.env.AB_A, JSON.parse(process.env.FLAGS_A || '{}'));
  const B = await run(rr, meta, process.env.AB_B, JSON.parse(process.env.FLAGS_B || '{}'));
  const keys = [...new Set([...Object.keys(A.out), ...Object.keys(B.out)])].sort();
  const rows = keys.map((k) => ({ k, a: A.out[k] || null, b: B.out[k] || null, same: A.out[k] && A.out[k] === B.out[k] }));
  console.log(JSON.stringify({ layer: LAYER, fields: rows.length, bothDecoded: rows.filter((r) => r.a && r.b).length, identical: rows.filter((r) => r.same).length, rows }, null, 1));
})();
