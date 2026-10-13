#!/usr/bin/env node
/**
 * Wind bench, EYE mode: does the drawn hurricane eye keep its place and shape when only the
 * regional grid under it changes? Renders the REAL engine (heatmap pass) over a 2-deg world base
 * with each candidate fine grid, at several zooms, and measures the eye's T-kn contour.
 * Offline: the two served grids are fixtures (fixtures/eye-2026-10-09-*.json). See README.md.
 *
 *   node scripts/wind-bench/eye-run.js
 *   node scripts/wind-bench/eye-run.js --ref origin/dev --json out/eye.json
 *
 * Exit: 0 when both controls hold (null: same data in another box draws the same eye; positive:
 * a 2-deg overlay visibly changes it), 2 when a control fails (the instrument proves nothing).
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');
const { gridFromFixture, worldBase, cropGrid, eyeSummary, compareSummaries, sameEye } = require('./eye');

const REF = { lng: -87.6, lat: 27.8 };                // between the two served eyes (2026-10-09 15Z)
const ZOOMS = [5.5, 6, 6.5, 7];                       // "two mid-close zoom levels, one stop apart"
const THRESHOLDS = Array.from({ length: 11 }, (_, i) => 30 + 2 * i); // 30..50 kn: the eye's contour family
const NULL_TOL = { shiftKm: 5, closeKn: 0, areaRatio: 0.1 };          // same data must draw the same eye

function parseArgs(argv) {
  const opts = { gl: 'gpu', out: path.join(__dirname, 'out') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => argv[++i];
    if (a === '--ref') opts.ref = val();
    else if (a === '--json') opts.json = path.resolve(val());
    else if (a === '--gl') opts.gl = val();
    else if (a === '--headed') opts.headed = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

function scenarios() {
  const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
  const A = gridFromFixture(fx('eye-2026-10-09-gfs-native.json'), 'A_gfs_native');
  const B = gridFromFixture(fx('eye-2026-10-09-om-seamless.json'), 'B_om_seamless');
  const C = gridFromFixture(fx('eye-2026-10-09-om-gfs-global.json'), 'C_om_gfs_global');
  const base = worldBase([A, B]);
  const overlap = { west: Math.max(A.bounds.west, B.bounds.west), east: Math.min(A.bounds.east, B.bounds.east), south: 25, north: 32 };
  return {
    base,
    fines: {
      A: { grid: A, label: 'A: GFS native (recovery), -90..-78' },
      B: { grid: B, label: 'B: Open-Meteo gfs_seamless (HRRR), -92..-79' },
      C: { grid: C, label: 'C: Open-Meteo gfs_global (GFS 06Z), -92..-79' },
      B_inA: { grid: cropGrid(B, overlap, 'B_in_A_box'), label: 'null: B data cropped to -90..-79' },
      clip2: { grid: cropGrid(base, A.bounds, 'base_2deg_clip'), label: 'positive: 2-deg clip of the base over A' },
    },
  };
}

const fmtSummary = (s) => (s.centre
  ? `eye ${s.centre.lng.toFixed(2)},${s.centre.lat.toFixed(2)} closed ${s.firstT}..${s.closeT} kn, r${s.at.rKm} km, aspect ${s.at.aspect}`
  : 'no closed eye at 30-50 kn');
const fmtCmp = (c) => (c.shiftKm == null ? `closed ${c.closed.map((x) => (x ? 'y' : 'n')).join('/')}`
  : `${c.shiftKm} km, wall ${c.dCloseKn >= 0 ? '+' : ''}${c.dCloseKn} kn, area x${c.areaRatio}`);

/** How the eye drawn in run `b` differs from run `a`. */
const compare = (a, b) => compareSummaries(a.summary, b.summary, a.eyes, b.eyes);

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
    const { base, fines } = scenarios();
    const results = {};
    for (const [key, f] of Object.entries(fines)) {
      results[key] = {};
      for (const z of ZOOMS) {
        const cfg = { base, fine: f.grid, lng: REF.lng, lat: REF.lat, z, thresholds: THRESHOLDS, ref: REF, theme: 'dark' };
        const r = await page.evaluate((c) => window.__WIND_BENCH__.eyeOne(c), cfg);
        if (r.glError) throw new Error(`GL error ${r.glError} in ${key} z${z}`);
        if (!r.fineActive) throw new Error(`the engine did not file ${key} as the fine overlay (verdict ${r.verdict})`);
        r.summary = eyeSummary(r.eyes, THRESHOLDS);
        results[key][z] = r;
        console.log(`${key.padEnd(6)} z${String(z).padEnd(4)} max ${String(r.maxSpeed).padStart(5)} kn | ${fmtSummary(r.summary)}`);
      }
    }
    const table = { liveAB: {}, gfsAC: {}, nullBox: {}, nullZoom: {}, positive: {} };
    for (const z of ZOOMS) {
      table.liveAB[z] = compare(results.A[z], results.B[z]);          // the owner's case: same hour, other grid
      table.gfsAC[z] = compare(results.A[z], results.C[z]);           // both lanes GFS: what is left
      table.nullBox[z] = compare(results.B_inA[z], results.B[z]);     // same data, other box
      table.nullZoom[z] = compare(results.A[ZOOMS[0]], results.A[z]); // same grid, other zoom
      table.positive[z] = compare(results.A[z], results.clip2[z]);    // a 2-deg overlay must show
    }
    console.log('\nhow the drawn eye differs (centre shift, weakest-wall change, area at the common closing T):');
    for (const [name, rows] of Object.entries(table).filter(([k]) => k !== 'particles')) {
      console.log(`  ${name.padEnd(9)} ` + ZOOMS.map((z) => `z${z}: ${fmtCmp(rows[z])}`).join(' | '));
    }
    // PARTICLES: do the zoom-dependent respawn/density levers reshape the eye with the grid fixed?
    // Trail ink inside the eye (25 km) over ink on its wall (50-90 km), 180 real frames, 2 seeds.
    const particles = {};
    console.log('\nparticle trail ink, eye (<=25 km) / wall (50-90 km), seeds 1-2:');
    for (const key of ['A', 'B']) {
      particles[key] = {};
      for (const z of ZOOMS) {
        const ref = results[key][z].summary.centre;
        const runs = [];
        for (const seed of [1, 2]) {
          runs.push(await page.evaluate((c) => window.__WIND_BENCH__.eyeInk(c),
            { base, fine: fines[key].grid, lng: REF.lng, lat: REF.lat, z, ref, rKm: 25, wallKm: [50, 90], seed }));
        }
        particles[key][z] = { ratio: +((runs[0].ratio + runs[1].ratio) / 2).toFixed(3), seeds: runs.map((r) => r.ratio) };
      }
      console.log(`  ${key}  ` + ZOOMS.map((z) => `z${z}: ${particles[key][z].ratio} (${particles[key][z].seeds.join(', ')})`).join(' | '));
    }
    table.particles = particles;
    const nullOk = ['nullBox', 'nullZoom'].every((k) => ZOOMS.every((z) => sameEye(table[k][z], NULL_TOL)));
    const positiveOk = ZOOMS.every((z) => !sameEye(table.positive[z], NULL_TOL));
    console.log(`\nnull control (same data, other box; same grid, other zoom): ${nullOk ? 'PASS' : 'FAIL'}`);
    console.log(`positive control (2-deg overlay changes the eye): ${positiveOk ? 'PASS' : 'BLIND'}`);
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ engine: source.label, ref: REF, zooms: ZOOMS, thresholds: THRESHOLDS, results, table }, null, 1));
    return nullOk && positiveOk ? 0 : 2;
  } finally {
    await browser.close();
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });
