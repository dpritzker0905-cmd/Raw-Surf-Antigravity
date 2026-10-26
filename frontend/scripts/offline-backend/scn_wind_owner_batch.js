// OWNER MANUAL TEST, 2026-10-25 (dev build d1653d4f; shared notes owner-manual-test-2026-10-25/FINDINGS.md), the two wind items.
// Offline only.
//   1. setWindData delivered 8-10 grids in ONE batch ("delivering 8 grid(s)"), maxWindSpeed flapping 26.43 <-> 27.87 kn and the
//      colour ramp rebuilt on each flap.
//   2. EURO wind at +68 h: "Fetching wind (attempt 1/5, offset: 68h)" + "Backend (Contained) Wind Cache Hit" ~8x within seconds of
//      a model switch, each re-running setWindData.
// One session per arm, the owner's sequence: wind on (GFS, Florida z6), the wheel to +68 h, then EURO. Per phase it counts the console
// lines the owner saw and reads the layer's own delivery log (window.__WIND_LAYER_DELIVERY__: grids drained per effect run) and the
// engine's commit log (window.__WIND_STATE_COMMITS__).
//
//   EXPECT_STORE=<multi-model store with wind> PORT=4202 AB_BASE=http://127.0.0.1:<spa> ARMS=off,on OUT=owner-batch.json node scn_wind_owner_batch.js
// Env: ARMS (comma list; "off" = the build as is, any other name = that arm's window flags from ARM_FLAGS), HOUR (68), CENTER
// (-80,27), ZOOM (6), SETTLE_MS (8000), MODEL (EURO).
const fs = require('fs');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_wind_owner_batch is offline only');
const PORT = +(process.env.PORT || 4100);
const HOUR = +(process.env.HOUR || 68);
const [CLNG, CLAT] = (process.env.CENTER || '-80,27').split(',').map(Number);
const ZOOM = +(process.env.ZOOM || 6);
const SETTLE_MS = +(process.env.SETTLE_MS || 8000);
const MODEL = process.env.MODEL || 'EURO';
const ARMS = (process.env.ARMS || 'off').split(',');
// The fix's kill switches, set in the "off" arm of a fixed build so both arms run the same bundle.
const ARM_FLAGS = { off: { __RAW_DISABLE_WIND_DELIVERY_COALESCE__: true, __RAW_DISABLE_WIND_REASK_DEDUPE__: true }, on: {} };
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PATTERNS = {
  fetching: /Fetching wind \(attempt/,
  cacheHit: /Wind Cache Hit/,
  delivering: /setWindData triggered by effect: delivering (\d+) grid/,
  maxSpeed: /maxWindSpeed updated/,
};

async function session(arm) {
  const { browser, page } = await L.launch({ port: PORT, width: 1280, height: 800 });
  await page.addInitScript((flags) => { for (const [k, v] of Object.entries(flags || {})) window[k] = v; window.__WOB_INIT__ = true; }, ARM_FLAGS[arm] || {});
  let phase = 'load';
  const counts = {};
  const delivered = {};
  const examples = {};
  page.on('console', (m) => {
    const s = m.text();
    for (const [k, re] of Object.entries(PATTERNS)) {
      const hit = re.exec(s);
      if (!hit) continue;
      const c = (counts[phase] = counts[phase] || {}); c[k] = (c[k] || 0) + 1;
      if (k === 'delivering') (delivered[phase] = delivered[phase] || []).push(+hit[1]);
      const ex = (examples[phase] = examples[phase] || {}); if (!ex[k]) ex[k] = s.slice(0, 200);
    }
  });
  const read = () => page.evaluate(() => {
    const d = window.__WIND_LAYER_DELIVERY__ || {};
    const commits = window.__WIND_STATE_COMMITS__ || [];
    const co = window.__WIND_DELIVERY_COALESCE__ || null;    // windDeliveryCoalesce.js: counted in either arm
    return { applied: d.applied || 0, verdicts: d.verdicts || {}, maxDrained: Math.max(0, ...((d.log || []).map((x) => x.drained || 0))),
      commits: commits.length, coalesce: co && { pushes: co.pushes, repeats: co.repeats, queued: co.queued, delivered: co.delivered,
        dupes: co.dupes, stale: co.stale, superseded: co.superseded, maxQueued: co.maxQueued } };
  });
  const out = { arm, phases: {} };
  try {
    await L.openMap(page);
    if (!(await page.evaluate(() => !!window.__WOB_INIT__))) throw Error('the init script did not run: refusing this session');
    await L.jump(page, CLNG, CLAT, ZOOM);
    await sleep(3000);
    phase = 'wind_on';
    await L.clickText(page, 'Wind');
    await sleep(SETTLE_MS);
    out.phases.wind_on = await read();
    phase = 'to_hour';
    const wheel = page.locator(WHEEL).filter({ visible: true }).first(); await wheel.focus();
    for (let i = 0; i < HOUR; i++) { await page.keyboard.press('ArrowRight'); await sleep(30); }
    await sleep(SETTLE_MS);
    out.phases.to_hour = await read();
    phase = 'model_switch';
    await L.clickText(page, MODEL);
    await sleep(SETTLE_MS);
    out.phases.model_switch = await read();
  } finally {
    await browser.close();
  }
  for (const p of Object.keys(out.phases)) Object.assign(out.phases[p], { console: counts[p] || {}, delivered: delivered[p] || [], examples: examples[p] || {} });
  return out;
}

(async () => {
  const want = process.env.EXPECT_STORE;
  if (!want) throw Error('EXPECT_STORE is required');
  const id = await (await fetch(`http://127.0.0.1:${PORT}/__harness/identity`)).json().catch(() => null);
  if (!id || path.resolve(String(id.store)).toLowerCase() !== path.resolve(want).toLowerCase()) throw Error(`port ${PORT} is not our backend`);
  const all = [];
  for (const arm of ARMS) {
    const s = await session(arm);
    all.push(s);
    for (const [p, v] of Object.entries(s.phases)) {
      console.log(arm, p, JSON.stringify({ console: v.console, delivered: v.delivered, maxDrained: v.maxDrained, commits: v.commits, applied: v.applied,
        coalesce: v.coalesce }));
    }
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(all, null, 1));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
