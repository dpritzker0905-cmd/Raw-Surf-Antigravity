// #752 OFFLINE: the finer-resident hold across two INGEST STAMPS of one model cycle (2026-11-09). Live on dev 59e51fb5 (ICON
// wind_waves, FL east coast, z9) layer activation offered the 181x83 world frame over the drawn 13x17 regional and the hold released it
// with reason "run": run_time was our ingest stamp (world 12:11:11Z, regional 13:23:19Z), both model_run_time 00Z. #752 compares the
// model cycle. The synthetic backend needs `--ingest-stamp-minutes world=731,regional=803` to reproduce that skew (serve_synthetic.py,
// INGEST STAMPS); without it every product has run_time == model_run_time and this scenario reports INCONCLUSIVE.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <fresh store> --port 4142 --models GFS,ICON \
//     --layers waves,wind_waves --regions florida_east_coast --dynamic 1 --horizon 48 --ingest-stamp-minutes world=731,regional=803
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3142
//   AB_BASE=http://127.0.0.1:3142 PORT=4142 OUT=skew.json node frontend/scripts/offline-backend/scn_ingest_skew_hold.js
//
// One browser: z9 at CENTER, ICON chip, then the Wind Waves chip; WATCH ms of a 100 ms sampler on the engine's resident grid
// (_waveData.waveGrid); then Wind Waves off and on again (the live 2026-11-09 re-activation that offered the world frame over the
// resident regional; offline the FIRST activation draws the world frame before the regional clip), then two pans (PAN_WAIT ms each). Verdict, from the app's own telemetry (__MARINE_WORLD_OVER_REGIONAL__,
// __MARINE_FINER_HELD__) and the sampler:
//   skew      the world frame and a regional frame (any non-world grid) carry different run_time, the same cycle (else INCONCLUSIVE)
//   offered   the world frame was offered while the regional was resident (held + released >= 1; else INCONCLUSIVE)
//   held      it was held at least once and its last decision was not a "run" release
//   drawn     after the re-activation no 181x83 frame was drawn while a regional was resident
// Exit 0 PASS, 1 FAIL, 3 INCONCLUSIVE. Offline only: no request leaves the machine but basemap tiles and fonts (ab_lib.js).
const fs = require('fs');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_ingest_skew_hold is offline only');
const PORT = +(process.env.PORT || 4142);
const ZOOM = +(process.env.ZOOM || 9);
const [CLNG, CLAT] = (process.env.CENTER || '-80.45,28.3').split(',').map(Number);
const WATCH = +(process.env.WATCH || 25000);
const PAN_WAIT = +(process.env.PAN_WAIT || 8000);
const OUT = process.env.OUT || null;
const TOGGLE_GAP = +(process.env.TOGGLE_GAP || 1500);
const isWorld = (s) => !!s && s.dims === '181x83';
const isRegional = (s) => !!s && s.dims !== 'none' && !isWorld(s);

// In the page: the engine's resident grid and both frames' stamps, every 100 ms, recorded only on change.
function installSampler() {
  const t0 = performance.now();
  window.__SKEW_T0__ = t0;
  window.__SKEW_SAMPLES__ = [];
  let last = null;
  const stamp = (wd) => {
    const g = wd && wd.waveGrid; const tag = wd && wd.truthTag;
    if (!g) return null;
    return { dims: `${g.cols}x${g.rows}`, run: g.run_time || g.runTime || (tag && tag.run_time) || null,
      cycle: g.model_run_time || g.__readoutModelRun || (tag && tag.model_run_time) || null,
      valid: g.valid_time || g.validTime || (tag && tag.valid_time) || null, lane: g.__commitLane || null };
  };
  window.__SKEW_STAMP__ = stamp;
  window.__SKEW_TIMER__ = setInterval(() => {
    const e = window.__MARINE_ENGINE__;
    const s = e && stamp(e._waveData);
    const sig = s ? `${s.dims}|${s.run}|${s.cycle}|${s.valid}` : 'none';
    if (sig !== last) { last = sig; window.__SKEW_SAMPLES__.push({ t: Math.round(performance.now() - t0), ...(s || { dims: 'none' }) }); }
  }, 100);
}

function readOutcome() {
  clearInterval(window.__SKEW_TIMER__);
  const e = window.__MARINE_ENGINE__;
  const coarse = e && e._coarseBaseData ? window.__SKEW_STAMP__(e._coarseBaseData) : null;
  return { samples: window.__SKEW_SAMPLES__, wor: window.__MARINE_WORLD_OVER_REGIONAL__ || null,
    held: window.__MARINE_FINER_HELD__ || null, encodeThrow: window.__WEBGL_MARINE_ENCODE_THROW__ || null,
    coarseBase: coarse, resident: e ? window.__SKEW_STAMP__(e._waveData) : null };
}

function verdict(o) {
  const world = [o.coarseBase, ...o.samples].find((s) => s && s.dims === '181x83') || null;
  const regional = [o.resident, ...o.samples].find(isRegional) || null;
  const sameCycle = (a, b) => !!a && !!b && Date.parse(a) === Date.parse(b);
  const checks = {};
  checks.skew = !!(world && regional && world.run && regional.run && world.run !== regional.run && sameCycle(world.cycle, regional.cycle));
  const wor = o.wor || { held: 0, released: 0, last: null };
  checks.offered = (wor.held || 0) + (wor.released || 0) >= 1;
  checks.held = (wor.held || 0) >= 1 && !(wor.last && wor.last.held === false && wor.last.reason === 'run');
  const after = o.samples.filter((s) => s.t >= o.reactivatedAt);
  checks.drawn = isRegional(o.residentAtReactivation) && !after.some(isWorld);
  const inconclusive = !checks.skew || !checks.offered;
  const pass = !inconclusive && checks.held && checks.drawn;
  return { result: inconclusive ? 'INCONCLUSIVE' : pass ? 'PASS' : 'FAIL', checks,
    world: world && { run: world.run, cycle: world.cycle, valid: world.valid },
    regional: regional && { run: regional.run, cycle: regional.cycle, valid: regional.valid } };
}

(async () => {
  const { browser, page, log } = await L.launch({ port: PORT });
  let out;
  try {
    await L.openMap(page);
    await L.jump(page, CLNG, CLAT, ZOOM);
    await page.waitForTimeout(1500);
    await L.clickText(page, 'ICON');
    await page.waitForTimeout(1500);
    await page.evaluate(installSampler);
    await L.clickText(page, 'Wind Waves');
    await page.waitForTimeout(WATCH);
    const before = await page.evaluate(() => ({ t: window.__SKEW_SAMPLES__.length ? window.__SKEW_SAMPLES__[window.__SKEW_SAMPLES__.length - 1].t : 0,
      resident: window.__SKEW_STAMP__(window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData) }));
    await L.clickText(page, 'Wind Waves');
    await page.waitForTimeout(TOGGLE_GAP);
    const reactivatedAt = await page.evaluate(() => Math.round(performance.now()));
    await L.clickText(page, 'Wind Waves');
    await page.waitForTimeout(WATCH);
    for (const [dx, dy] of [[250, 0], [-250, 120]]) {
      await page.evaluate(({ dx, dy }) => (window.__MAP_INSTANCE__ || window.map).panBy([dx, dy], { duration: 300 }), { dx, dy });
      await page.waitForTimeout(PAN_WAIT);
    }
    const o = await page.evaluate(readOutcome);
    o.residentAtReactivation = before.resident;
    o.reactivatedAt = (await page.evaluate((t) => t - Math.round(window.__SKEW_T0__ || 0), reactivatedAt));
    out = { base: L.BASE, port: PORT, center: [CLNG, CLAT], zoom: ZOOM, reactivatedAt: o.reactivatedAt, ...verdict(o), wor: o.wor, finerHeld: o.held,
      encodeThrow: o.encodeThrow, samples: o.samples, pageErrors: log.errors.slice(0, 10) };
  } finally { await browser.close(); }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ result: out.result, checks: out.checks, world: out.world, regional: out.regional,
    reactivatedAt: out.reactivatedAt, wor: out.wor, finerHeld: out.finerHeld && out.finerHeld.count, drawn: out.samples.map((s) => `${s.t}:${s.dims}`).join(' ') }));
  process.exit(out.result === 'PASS' ? 0 : out.result === 'FAIL' ? 1 : 3);
})().catch((e) => { console.error(e); process.exit(2); });
