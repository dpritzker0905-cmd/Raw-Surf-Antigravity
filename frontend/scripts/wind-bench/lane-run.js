#!/usr/bin/env node
/**
 * Wind bench, LANE mode: with the HRRR wind lane (backend wind_lane.py, D-017) does the drawn hurricane eye hold still
 * across every tier, pan offset, upstream and zoom, and what does the HRRR -> GFS hand-off do to it?
 *
 * Same instrument as eye-run.js (the real engine, one heatmap frame per threshold, the eye's T-kn contour read back);
 * the fixtures are the tiers AS /grid SERVES THEM after the lane, built with the production apply_wind_lane by
 * backend/scripts/wind_lane_bench_fixtures.py (NOAA HRRR 12Z f03, NOAA GFS 12Z f003, Open-Meteo gfs_global, 15Z).
 *
 *   node scripts/wind-bench/lane-run.js
 *   node scripts/wind-bench/lane-run.js --images out/lane-images --json out/lane.json
 *
 * Rows (the Jacobian lens, log 2026-10-09-hrrr-wind-lane.md):
 *   null  tier/pan  four 0.5-deg boxes at four pan offsets, two GFS upstreams, vs box B: the same eye (5 km, same T, 10%)
 *   null  zoom      box B at z5.5-7 vs z6
 *   null  upstream  the same box from Open-Meteo gfs_global and from the NOAA native recovery (cache/breaker order)
 *   positive        the OLD mixed pair (NOAA GFS box vs Open-Meteo gfs_seamless = HRRR box) must NOT be the same eye
 *   reported        the 0.25-deg tile vs the 0.5-deg box (a lattice change, not a model change); the taper steps
 * Exit: 0 when every null holds and the positive control fails; 2 otherwise.
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');
const { gridFromFixture, worldBase, eyeSummary, compareSummaries, sameEye } = require('./eye');

const REF = { lng: -87.6, lat: 27.8 };
const ZOOMS = [5.5, 6, 6.5, 7];
const THRESHOLDS = Array.from({ length: 11 }, (_, i) => 30 + 2 * i);
const NULL_TOL = { shiftKm: 5, closeKn: 0, areaRatio: 0.1 };

function parseArgs(argv) {
  const opts = { gl: 'gpu', out: path.join(__dirname, 'out') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => argv[++i];
    if (a === '--ref') opts.ref = val();
    else if (a === '--json') opts.json = path.resolve(val());
    else if (a === '--images') opts.images = path.resolve(val());
    else if (a === '--gl') opts.gl = val();
    else if (a === '--headed') opts.headed = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
const grid = (name) => gridFromFixture(fx(name), name);

function scenarios() {
  const oldA = gridFromFixture(fx('eye-2026-10-09-gfs-native'), 'old_A_noaa');
  const oldB = gridFromFixture(fx('eye-2026-10-09-om-seamless'), 'old_B_om_seamless');
  const lane = {
    B: grid('lane-dynB-om'), A: grid('lane-dynA-om'), recA: grid('lane-recA-noaa'), recC: grid('lane-recC-noaa'),
    recD: grid('lane-recD-noaa'), tile: grid('lane-tile025'),
    w075: grid('lane-dynB-om-w075'), w050: grid('lane-dynB-om-w050'), w025: grid('lane-dynB-om-w025'), w000: grid('gfs-dynB-om'),
  };
  return {
    oldBase: worldBase([oldA, oldB]), oldA, oldB,
    laneBase: worldBase([grid('lane-world2')]), lane,
    coast: { gfs: grid('gfs-florida-tile'), lane: grid('lane-florida-tile') },
  };
}

const fmt = (s) => (s.centre ? `${s.centre.lng.toFixed(2)},${s.centre.lat.toFixed(2)} closed ${s.firstT}..${s.closeT} kn r${s.at.rKm} km` : 'no closed eye');
const fmtCmp = (c) => (c.shiftKm == null ? `closed ${c.closed.map((x) => (x ? 'y' : 'n')).join('/')}`
  : `${c.shiftKm} km, wall ${c.dCloseKn >= 0 ? '+' : ''}${c.dCloseKn} kn, area x${c.areaRatio}`);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const source = engineSource(opts.ref, path.join(opts.out, 'cache'));
  const built = await buildBench({ srcRoot: source.srcRoot, outDir: path.join(opts.out, 'bench') });
  console.log(`engine: ${source.label} · bundle ${(built.bytes / 1024).toFixed(0)} KiB`);
  const server = await serveDir(opts.out);
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: !opts.headed, args: gpuArgs(opts.gl) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/bench/index.html`);
    await page.waitForFunction(() => window.__WIND_BENCH__ && window.__WIND_BENCH__.renderer);
    console.log(`renderer: ${await page.evaluate(() => window.__WIND_BENCH__.renderer)}`);
    const S = scenarios();
    const eye = async (base, fine, z, label) => {
      const r = await page.evaluate((c) => window.__WIND_BENCH__.eyeOne(c),
        { base, fine, lng: REF.lng, lat: REF.lat, z, thresholds: THRESHOLDS, ref: REF, theme: 'dark' });
      if (r.glError) throw new Error(`GL error ${r.glError} in ${label}`);
      if (!r.fineActive) throw new Error(`the engine did not file ${label} as the fine overlay (verdict ${r.verdict})`);
      r.summary = eyeSummary(r.eyes, THRESHOLDS);
      console.log(`${label.padEnd(22)} z${String(z).padEnd(4)} max ${String(r.maxSpeed).padStart(5)} kn | ${fmt(r.summary)}`);
      return r;
    };
    const cmp = (a, b) => compareSummaries(a.summary, b.summary, a.eyes, b.eyes);

    const R = { old: {}, lane: {} };
    R.old.A = await eye(S.oldBase, S.oldA, 6, 'old A (NOAA GFS)');
    R.old.B = await eye(S.oldBase, S.oldB, 6.5, 'old B (OM seamless)');
    for (const k of ['B', 'A', 'recA', 'recC', 'recD']) {
      R.lane[k] = {};
      for (const z of ZOOMS) R.lane[k][z] = await eye(S.laneBase, S.lane[k], z, `lane ${k}`);
    }
    R.lane.tile = {};
    for (const z of ZOOMS) R.lane.tile[z] = await eye(S.laneBase, S.lane.tile, z, 'lane tile 0.25');
    R.taper = {};
    for (const k of ['w075', 'w050', 'w025', 'w000']) R.taper[k] = await eye(S.laneBase, S.lane[k], 6, `taper ${k}`);

    const ref = R.lane.B[6];
    const rows = { nullTier: {}, nullZoom: {}, nullUpstream: {}, resolution: {}, positive: null, taper: {} };
    for (const k of ['A', 'recA', 'recC', 'recD']) rows.nullTier[k] = Object.fromEntries(ZOOMS.map((z) => [z, cmp(ref, R.lane[k][z])]));
    rows.nullZoom = Object.fromEntries(ZOOMS.map((z) => [z, cmp(ref, R.lane.B[z])]));
    rows.nullUpstream = Object.fromEntries(ZOOMS.map((z) => [z, cmp(R.lane.A[z], R.lane.recA[z])]));
    rows.resolution = Object.fromEntries(ZOOMS.map((z) => [z, cmp(R.lane.B[z], R.lane.tile[z])]));
    rows.positive = cmp(R.old.A, R.old.B);
    let prev = ref;
    for (const k of ['w075', 'w050', 'w025', 'w000']) { rows.taper[k] = cmp(prev, R.taper[k]); prev = R.taper[k]; }
    rows.taperTotal = cmp(ref, R.taper.w000);

    console.log('\nhow the drawn eye differs (centre shift, weakest-wall change, area at the common closing T):');
    for (const k of Object.keys(rows.nullTier)) console.log(`  null tier/pan ${k.padEnd(5)} ` + ZOOMS.map((z) => `z${z}: ${fmtCmp(rows.nullTier[k][z])}`).join(' | '));
    console.log('  null zoom (box B)   ' + ZOOMS.map((z) => `z${z}: ${fmtCmp(rows.nullZoom[z])}`).join(' | '));
    console.log('  null upstream (A)   ' + ZOOMS.map((z) => `z${z}: ${fmtCmp(rows.nullUpstream[z])}`).join(' | '));
    console.log('  lattice 0.25 vs 0.5 ' + ZOOMS.map((z) => `z${z}: ${fmtCmp(rows.resolution[z])}`).join(' | '));
    console.log(`  positive (old A z6 -> old B z6.5): ${fmtCmp(rows.positive)}`);
    console.log('  taper steps (z6)    ' + Object.entries(rows.taper).map(([k, c]) => `${k}: ${fmtCmp(c)}`).join(' | '));
    console.log(`  taper total (HRRR -> GFS): ${fmtCmp(rows.taperTotal)}`);

    const nullsOk = [...Object.values(rows.nullTier).flatMap((r) => Object.values(r)), ...Object.values(rows.nullZoom),
      ...Object.values(rows.nullUpstream)].every((c) => sameEye(c, NULL_TOL));
    const positiveFails = !sameEye(rows.positive, NULL_TOL);
    console.log(`\nnull controls (tier, pan, zoom, upstream): ${nullsOk ? 'PASS' : 'FAIL'}`);
    console.log(`positive control (the old mixed pair is NOT the same eye): ${positiveFails ? 'PASS' : 'BLIND'}`);

    if (opts.images) {
      fs.mkdirSync(opts.images, { recursive: true });
      // White line: the 30-kn contour (closed in every eye here) on the storm, the 15-kn contour on the coast.
      const shots = [
        ['before-z6-noaa-gfs', S.oldBase, S.oldA, REF, 6, 30, 'BEFORE z6: NOAA GFS box (native recovery)'],
        ['before-z6.5-om-seamless', S.oldBase, S.oldB, REF, 6.5, 30, 'BEFORE z6.5: Open-Meteo gfs_seamless box (= HRRR)'],
        ['after-z6-lane-boxA', S.laneBase, S.lane.A, REF, 6, 30, 'AFTER z6: box A + lane'],
        ['after-z6.5-lane-boxB', S.laneBase, S.lane.B, REF, 6.5, 30, 'AFTER z6.5: box B + lane'],
        ['coast-florida-gfs', S.oldBase, S.coast.gfs, { lng: -81.3, lat: 28.4 }, 7, 15, 'Florida z7, the florida_east_coast GFS 0.25 tile (no lane)'],
        ['coast-florida-lane', S.laneBase, S.coast.lane, { lng: -81.3, lat: 28.4 }, 7, 15, 'Florida z7, the same tile + the HRRR lane'],
      ];
      const items = [];
      for (const [name, base, fine, at, z, contourKn, caption] of shots) {
        const r = await page.evaluate((c) => window.__WIND_BENCH__.eyeShot(c), { base, fine, lng: at.lng, lat: at.lat, z, theme: 'dark', width: 520, contourKn });
        fs.writeFileSync(path.join(opts.images, `${name}.png`), Buffer.from(r.url.split(',')[1], 'base64'));
        items.push({ name, caption });
      }
      fs.writeFileSync(path.join(opts.images, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Wind lane images</title>
<body style="background:#111;color:#ddd;font:14px system-ui">${items.map((i) => `<figure style="display:inline-block;margin:8px"><img src="${i.name}.png" width="520"><figcaption>${i.caption}</figcaption></figure>`).join('')}</body>`);
      console.log(`images: ${opts.images}`);
    }
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ engine: source.label, ref: REF, zooms: ZOOMS, results: R, rows }, null, 1));
    return nullsOk && positiveFails ? 0 : 2;
  } finally {
    await browser.close();
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });
