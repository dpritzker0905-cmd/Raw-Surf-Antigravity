// THE ICON WIND-WAVE BOUNCE WITH THE HOLDS ON (2026-11-12, offline only). scn_ingest_skew_hold.js showed the bounce (the resident regional
// replaced by an equal-or-coarser grid, then resharpened) only with the finer-resident holds DISABLED. This asks whether any of three live
// conditions the synthetic backend never produced gets a bounce past the holds AS SHIPPED. CASE picks one; HOLDS=off is the null control
// (both kill switches set before the app loads), so each case is a treatment/control pair on one build and one store.
//   a  a WORLD frame without served_valid_time (the engine's no-downgrade guard fails open on it): /__lab/unlabel armed before activation
//   b  pans that leave the resident clip but stay inside the 0.25 deg Florida tile (the hold releases as resident_not_covering by design)
//   c  a model cycle that advances mid-session, the world tier first, then every tier (/__lab/cycle), with a pan after each step
//   c2 the same cycle advance followed by the REFRESH TRIGGER (c alone asked no current-hour page): scrub the forecast wheel a week
//      ahead (PageUp x7) into a series page the client has not cached, so the new-cycle frames are fetched, then back (Home). Needs a
//      store with the full horizon (serve_synthetic --horizon 336; the 48 h store fits in page 1)
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <fresh store> --port 4142 --models GFS,ICON \
//     --layers waves,wind_waves --regions florida_east_coast --dynamic 1 --horizon 48 --ingest-stamp-minutes world=731,regional=803
//   node frontend/scripts/offline-backend/serve_spa.js <build> 3142
//   CASE=a HOLDS=on AB_BASE=http://127.0.0.1:3142 PORT=4142 OUT=a_on.json node frontend/scripts/offline-backend/scn_bounce_holds_on.js
//
// Measure (a 100 ms sampler on the engine's resident grid, _waveData.waveGrid): every change of the drawn grid with its cell size (deg, the
// coarser axis, as gridCellDeg). A DOWNGRADE is a drawn grid whose cell is >= 1.05x the previous one while the live view spans < 15 deg;
// a BOUNCE is a downgrade followed by an upgrade (cell <= 0.95x) within BOUNCE_MS. A RECOMMIT is any other change of the drawn grid
// (dims or bounds) at a regional view that is not meaningfully finer (cell >= 0.95x): no coarse flash, but a texture rebuild and a
// particle reset (the milder form of the same report). Each mark also records how many marine /grid and /grid_series requests the
// backend had seen (GET /__lab/bounce/status `requests`), so a step that asked the backend nothing is told apart from one that was held.
// Exit 0 = no bounce, 1 = at least one, 2 = error.
const fs = require('fs');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_bounce_holds_on is offline only');
const PORT = +(process.env.PORT || 4142);
const CASE = process.env.CASE || 'a';
const HOLDS_ON = (process.env.HOLDS || 'on') !== 'off';
const ZOOM = +(process.env.ZOOM || 9);
const [CLNG, CLAT] = (process.env.CENTER || '-80.45,28.3').split(',').map(Number);
const WATCH = +(process.env.WATCH || 20000);
const PAN_WAIT = +(process.env.PAN_WAIT || 8000);
const BOUNCE_MS = +(process.env.BOUNCE_MS || 15000);
const OUT = process.env.OUT || null;
const API = `http://127.0.0.1:${PORT}`;
if (!['a', 'b', 'c', 'c2'].includes(CASE)) throw Error('CASE must be a, b, c or c2');
const WHEEL = '[role="slider"][aria-label*="Forecast timeline"]';
async function keys(page, key, n) {
  const wheel = page.locator(WHEEL).filter({ visible: true }).first();
  await wheel.focus();
  for (let i = 0; i < n; i++) { await page.keyboard.press(key); await page.waitForTimeout(400); }
}

async function lab(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw Error(`${path}: HTTP ${r.status} (is this serve_synthetic.py with synthetic_bounce_lab?)`);
  return r.json();
}

function installSampler() {
  const t0 = performance.now();
  window.__BOUNCE_T0__ = t0;
  window.__BOUNCE__ = [];
  let last = null;
  const map = () => window.__MAP_INSTANCE__ || window.map;
  window.__BOUNCE_TIMER__ = setInterval(() => {
    const e = window.__MARINE_ENGINE__;
    const g = e && e._waveData && e._waveData.waveGrid;
    let s = { dims: 'none' };
    if (g && g.bounds && g.cols > 0 && g.rows > 0) {
      const w = g.bounds.east > g.bounds.west ? g.bounds.east - g.bounds.west : g.bounds.east + 360 - g.bounds.west;
      s = { dims: `${g.cols}x${g.rows}`, cell: +Math.max(w / g.cols, (g.bounds.north - g.bounds.south) / g.rows).toFixed(4),
        bounds: [g.bounds.west, g.bounds.south, g.bounds.east, g.bounds.north].map((x) => +(+x).toFixed(2)),
        run: g.run_time || g.runTime || null, cycle: g.model_run_time || g.__readoutModelRun || null,
        served: g.served_valid_time || null, lane: g.__commitLane || null };
    }
    const sig = `${s.dims}|${s.bounds}|${s.run}|${s.cycle}`;
    if (sig !== last) {
      last = sig;
      const b = map().getBounds();
      window.__BOUNCE__.push({ t: Math.round(performance.now() - t0), viewSpan: +Math.max(b.getEast() - b.getWest(), b.getNorth() - b.getSouth()).toFixed(2), ...s,
        held: (window.__MARINE_FINER_HELD__ && window.__MARINE_FINER_HELD__.count) || 0 });
    }
  }, 100);
}

function analyse(samples) {
  const downs = [], bounces = [], recommits = [];
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1], s = samples[i];
    if (!(p.cell > 0) || !(s.cell > 0) || !(s.viewSpan < 15)) continue;
    if (s.cell >= p.cell * 0.95 && s.cell < p.cell * 1.05 && p.dims !== 'none') recommits.push({ t: s.t, from: `${p.dims}@${p.cell}`, to: `${s.dims}@${s.cell}`, lane: s.lane });
    if (s.cell >= p.cell * 1.05) {
      const d = { t: s.t, from: `${p.dims}@${p.cell}`, to: `${s.dims}@${s.cell}`, lane: s.lane, cycleFrom: p.cycle, cycleTo: s.cycle };
      downs.push(d);
      const up = samples.slice(i + 1).find((u) => u.t - s.t <= BOUNCE_MS && u.cell > 0 && u.cell <= s.cell * 0.95);
      if (up) bounces.push({ ...d, backAt: up.t, backTo: `${up.dims}@${up.cell}`, coarseMs: up.t - s.t });
    }
  }
  return { downgrades: downs, bounces, recommits };
}

const pan = (page, dx, dy) => page.evaluate(({ dx, dy }) => (window.__MAP_INSTANCE__ || window.map).panBy([dx, dy], { duration: 300 }), { dx, dy });
const mark = async (page, label) => { const req = (await lab('/__lab/bounce/status')).requests.length;
  await page.evaluate(({ label, req }) => { window.__BOUNCE_MARKS__ = window.__BOUNCE_MARKS__ || []; window.__BOUNCE_MARKS__.push({ label, req, t: Math.round(performance.now() - window.__BOUNCE_T0__) }); }, { label, req }); };

(async () => {
  await lab('/__lab/unlabel?on=0');
  await lab('/__lab/cycle?hours=0');
  if (CASE === 'a') await lab('/__lab/unlabel?on=1');
  const { browser, page, log } = await L.launch({ port: PORT });
  let out;
  try {
    if (!HOLDS_ON) await page.addInitScript(() => { window.__RAW_DISABLE_FINER_RESIDENT_HOLD__ = true; window.__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__ = true; });
    await L.openMap(page);
    await L.jump(page, CLNG, CLAT, ZOOM);
    await page.waitForTimeout(1500);
    await L.clickText(page, 'ICON');
    await page.waitForTimeout(1500);
    await page.evaluate(installSampler);
    await L.clickText(page, 'Wind Waves');
    await page.waitForTimeout(WATCH);
    if (CASE === 'a') {
      // the live re-activation that offered the world frame over the resident regional, then two ordinary pans
      await mark(page, 'reactivate'); await L.clickText(page, 'Wind Waves'); await page.waitForTimeout(1500); await L.clickText(page, 'Wind Waves');
      await page.waitForTimeout(WATCH);
      for (const [dx, dy] of [[250, 0], [-250, 120]]) { await mark(page, `pan ${dx},${dy}`); await pan(page, dx, dy); await page.waitForTimeout(PAN_WAIT); }
    } else if (CASE === 'b') {
      // ~1.1-1.9 deg per leg at z9: off the resident clip each time, inside florida_east_coast (-85..-79, 24..31) throughout
      for (const [dx, dy] of [[-700, 0], [0, 500], [-400, -300], [600, 200], [300, -400]]) { await mark(page, `pan ${dx},${dy}`); await pan(page, dx, dy); await page.waitForTimeout(PAN_WAIT); }
    } else if (CASE === 'c2') {
      await mark(page, 'cycle world +6h'); await lab('/__lab/cycle?hours=6&scope=world');
      await mark(page, 'scrub +7 days'); await keys(page, 'PageUp', 7); await page.waitForTimeout(WATCH);
      await mark(page, 'cycle all +6h'); await lab('/__lab/cycle?hours=6&scope=any');
      await mark(page, 'scrub -1 day'); await keys(page, 'PageDown', 1); await page.waitForTimeout(WATCH);
      await mark(page, 'pan 250,0'); await pan(page, 250, 0); await page.waitForTimeout(PAN_WAIT);
      await mark(page, 'Home'); await keys(page, 'Home', 1); await page.waitForTimeout(WATCH);
    } else {
      await mark(page, 'cycle world +6h'); await lab('/__lab/cycle?hours=6&scope=world');
      await page.waitForTimeout(PAN_WAIT);
      await mark(page, 'pan 250,0'); await pan(page, 250, 0); await page.waitForTimeout(PAN_WAIT);
      await mark(page, 'cycle all +6h'); await lab('/__lab/cycle?hours=6&scope=any');
      await page.waitForTimeout(PAN_WAIT);
      await mark(page, 'pan -250,120'); await pan(page, -250, 120); await page.waitForTimeout(PAN_WAIT);
      await mark(page, 'reactivate'); await L.clickText(page, 'Wind Waves'); await page.waitForTimeout(1500); await L.clickText(page, 'Wind Waves');
      await page.waitForTimeout(WATCH);
    }
    await mark(page, 'end');
    const o = await page.evaluate(() => { clearInterval(window.__BOUNCE_TIMER__); return { samples: window.__BOUNCE__, marks: window.__BOUNCE_MARKS__ || [],
      held: window.__MARINE_FINER_HELD__ || null, wor: window.__MARINE_WORLD_OVER_REGIONAL__ || null }; });
    const a = analyse(o.samples);
    out = { case: CASE, holds: HOLDS_ON ? 'on' : 'off', port: PORT, center: [CLNG, CLAT], zoom: ZOOM, result: a.bounces.length ? 'BOUNCE' : 'NO_BOUNCE',
      bounces: a.bounces, downgrades: a.downgrades, recommits: a.recommits, finerHeld: o.held, wor: o.wor, marks: o.marks, lab: await lab('/__lab/bounce/status'),
      samples: o.samples, pageErrors: log.errors.slice(0, 10) };
  } finally {
    await browser.close();
    await lab('/__lab/unlabel?on=0').catch(() => {}); await lab('/__lab/cycle?hours=0').catch(() => {});
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ case: out.case, holds: out.holds, result: out.result, bounces: out.bounces, downgrades: out.downgrades.length, recommits: out.recommits.map((r) => `${r.t}:${r.from}->${r.to}`).join(' '),
    finerHeld: out.finerHeld && out.finerHeld.count, wor: out.wor && { held: out.wor.held, released: out.wor.released, last: out.wor.last && out.wor.last.reason },
    rewritten: out.lab.rewritten, marks: out.marks.map((m) => `${m.t}:${m.label}[req ${m.req}]`).join(' '),
    drawn: out.samples.map((s) => `${s.t}:${s.dims}@${s.cell}${s.cycle ? '/' + String(s.cycle).slice(11, 13) : ''}`).join(' ') }));
  process.exit(out.bounces.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
