#!/usr/bin/env node
/**
 * Wind bench, LADDER mode: does the drawn hurricane eye keep its place and shape through a whole zoom, z5.5 -> z9 and
 * back, as the grids the map is handed change tier (2-deg clip, 1-deg box, 0.5-deg box, 0.25-deg box)?
 *
 * Same instrument as eye-run.js (the real engine, one heatmap frame per threshold, the eye's T-kn contour read back),
 * replayed stop by stop: at each zoom stop the engine receives, in order, every grid the client would have committed
 * so far (ladder.js mirrors the client's request box and cache rule and the server's tier rule), and the eye is
 * measured against the stop before it and against the truth (the 0.25-deg lattice everywhere). A second readback bins
 * the drawn speed over the whole view, so an option that holds the eye by giving up the rest of the picture shows.
 *
 * Every tier is sampled from ONE field (eye.truthField: the served 0.25-deg tile fixtures/lane-tile025.json, HRRR lane
 * included, inside its box), as the server's tiers are: their lattices nest and agree at shared nodes.
 *
 * Arms (the options compared):
 *   now         dev before this change: a coarser covering box replaces the finer one (kill switch of the mosaic)
 *   keep70      (a) the finest resident overlay is kept while it covers >= 70% of the view; the 2-deg base draws the rest
 *   keepCentre  (a) the same, kept while it holds the view centre
 *   mosaic      (b) the engine as written: the coarser box is filed around the finer nodes (windTierMosaic.js). A third
 *               texture level would draw this same picture
 *   oneLattice  (c) the server answers every box on the 0.25-deg lattice
 *   meanTiers   (d) the server builds the coarser tiers as area means of the finest one
 *
 *   node scripts/wind-bench/ladder-run.js
 *   node scripts/wind-bench/ladder-run.js --fresh --json out/ladder.json --images out/ladder-images
 *
 * Exit: 0 when the nulls hold (same grid at every zoom; the oneLattice arm at every stop; a mosaic whose fine box is
 * away from the storm draws the coarse box's own eye) and the positive control shows (the `now` arm moves the eye on
 * the way out); 2 otherwise.
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');
const { gridFromFixture, worldBase, cropGrid, eyeSummary, compareSummaries, sameEye, truthField, latticeGrid, meanGrid, binDiff } = require('./eye');
const { plan } = require('./ladder');

const REF = { lng: -87.6, lat: 27.8 };
const PANE = { w: 897, h: 914 };                                   // the bench canvas (the owner's map pane, 2026-10-08)
const ZOOMS = [5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9];
const PATH = [...ZOOMS, ...ZOOMS.slice(0, -1).reverse()];          // in, then back out
const THRESHOLDS = Array.from({ length: 20 }, (_, i) => 26 + 2 * i); // 26..64 kn: the eye's contour family
const BIN_KN = 5, BINS = Array.from({ length: 13 }, (_, i) => 10 + BIN_KN * i); // 10..70 kn: the drawn speed, binned
const NULL_TOL = { shiftKm: 5, closeKn: 0, areaRatio: 0.1 };
// The 38-kn contour (r 30-40 km, elongated) does not fit the z9 pane (+-60 km), so z9's grids are drawn through the z8.5
// camera. Both views lie inside every box resident at z9, so the engine composes the same field at either zoom.
const MEASURE_Z_MAX = 8.5;
const MOSAIC_OFF = { __RAW_DISABLE_WIND_TIER_MOSAIC__: true };

const ARMS = {
  now: { label: 'now (dev): the coarser box replaces the finer one', levers: MOSAIC_OFF },
  keep70: { label: '(a) keep the finest while it covers >= 70% of the view', levers: MOSAIC_OFF, keepFinest: { minCover: 0.7 } },
  keepCentre: { label: '(a) keep the finest while it holds the view centre', levers: MOSAIC_OFF, keepFinest: { centre: true } },
  mosaic: { label: '(b) the coarser box filed around the finer nodes', levers: {} },
  oneLattice: { label: '(c) every box served on the 0.25-deg lattice', levers: MOSAIC_OFF, tier: 'fine' },
  meanTiers: { label: '(d) coarser tiers as area means of the finest', levers: MOSAIC_OFF, tier: 'mean' },
};

function parseArgs(argv) {
  const opts = { gl: 'gpu', out: path.join(__dirname, 'out'), arms: Object.keys(ARMS) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => argv[++i];
    if (a === '--ref') opts.ref = val();
    else if (a === '--json') opts.json = path.resolve(val());
    else if (a === '--images') opts.images = path.resolve(val());
    else if (a === '--arms') opts.arms = val().split(',');
    else if (a === '--fresh') opts.fresh = true;
    else if (a === '--gl') opts.gl = val();
    else if (a === '--headed') opts.headed = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
const boxId = (b) => `${b.west}_${b.south}_${b.east}_${b.north}`;

/** The field, the 2-deg world base, and a maker of the grid one served item becomes under an arm's tier rule. */
function world() {
  const tile = gridFromFixture(fx('lane-tile025'), 'lane_tile025');
  const base = worldBase([gridFromFixture(fx('lane-world2'), 'lane_world2')], tile.valid_time);
  const truth = truthField(tile, base), valid = tile.valid_time, made = new Map();
  const grid = (item, tier) => {
    const key = `${item.kind === 'clip' ? 'clip' : 'box'}|${boxId(item.box)}|${item.step}|${item.kind === 'clip' ? '' : tier || ''}`;
    if (!made.has(key)) {
      let g;
      if (item.kind === 'clip') g = cropGrid(base, item.box, `clip_${boxId(item.box)}`);
      else if (tier === 'fine') g = latticeGrid(truth, item.box, 0.25, `box_${boxId(item.box)}_fine`, valid);
      else if (tier === 'mean' && item.step > 0.25) g = meanGrid(truth, item.box, item.step, 0.25, `box_${boxId(item.box)}_mean`, valid);
      else g = latticeGrid(truth, item.box, item.step, `box_${boxId(item.box)}_${item.step}`, valid);
      made.set(key, g);
    }
    return made.get(key);
  };
  return { tile, base, truth, valid, grid };
}

const fmtEye = (s) => (s.centre ? `${s.centre.lng.toFixed(2)},${s.centre.lat.toFixed(2)} closed ${s.firstT}..${s.closeT} kn r${s.at.rKm} km` : 'no closed eye');
const fmtCmp = (c) => (!c ? '-' : c.shiftKm == null ? `closed ${c.closed.map((x) => (x ? 'y' : 'n')).join('/')}`
  : `${c.shiftKm.toFixed(1)} km ${c.dCloseKn >= 0 ? '+' : ''}${c.dCloseKn} kn x${c.areaRatio}`);
const fmtFine = (f) => (f ? `${f.cell} deg ${f.cols}x${f.rows}${f.mosaic ? ' mosaic' : ''}` : 'none');
const pad = (s, n) => String(s).padEnd(n);

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
    const W = world();
    const eye = async (cfg) => {
      const r = await page.evaluate((c) => window.__WIND_BENCH__.eyeOne(c),
        { base: W.base, lng: REF.lng, lat: REF.lat, thresholds: THRESHOLDS, ref: REF, theme: 'dark', bins: BINS, ...cfg, z: Math.min(cfg.z, MEASURE_Z_MAX) });
      if (r.glError) throw new Error(`GL error ${r.glError}`);
      if (!r.fineActive) throw new Error(`no fine overlay resident (verdicts ${r.verdicts.join(', ')})`);
      r.summary = eyeSummary(r.eyes, THRESHOLDS, { nested: true });
      return r;
    };
    const cmp = (a, b) => compareSummaries(a.summary, b.summary, a.eyes, b.eyes);

    // TRUTH: the 0.25-deg lattice over the widest box, at every zoom of the path (also the zoom null).
    const wide = plan([ZOOMS[0]], REF, PANE)[0].box;
    const truthGrid = latticeGrid(W.truth, wide, 0.25, 'truth_025', W.valid);
    const truth = {};
    for (const z of ZOOMS) {
      truth[z] = await eye({ fine: truthGrid, z, levers: MOSAIC_OFF });
      console.log(`truth 0.25 deg  z${pad(z, 4)} max ${truth[z].maxSpeed} kn | ${fmtEye(truth[z].summary)}`);
    }
    const nullZoom = Object.fromEntries(ZOOMS.map((z) => [z, cmp(truth[7], truth[z])]));

    const runPath = async (reuse) => {
      const stops = plan(PATH, REF, PANE, { reuse });
      const out = {};
      for (const name of opts.arms) {
        const arm = ARMS[name];
        if (!arm) throw new Error(`unknown arm ${name}`);
        console.log(`\n${name}: ${arm.label}${reuse ? '' : ' (every stop its own box)'}`);
        console.log(`  ${pad('stop', 9)}${pad('served here -> verdicts', 46)}${pad('overlay drawn', 26)}${pad('eye vs the stop before', 26)}${pad('eye vs truth', 26)}field vs truth`);
        const rows = [], served = [];
        let prev = null;
        for (let k = 0; k < stops.length; k++) {
          const s = stops[k], n0 = served.length;
          for (const item of s.served) served.push({ grid: W.grid(item, arm.tier), view: s.view });
          const r = await eye({ fine: served[0].grid, after: served.slice(1), z: s.z, levers: arm.levers, keepFinest: arm.keepFinest });
          const row = {
            z: s.z, leg: k < ZOOMS.length ? 'in' : 'out', served: s.served.map((d) => `${d.kind} ${d.step}`), verdicts: r.verdicts.slice(n0),
            fine: r.fineGrid, summary: r.summary, mosaics: r.mosaics,
            step: prev ? cmp(prev, r) : null, truth: cmp(truth[s.z], r), field: binDiff(truth[s.z].bins, r.bins, BIN_KN),
          };
          rows.push(row);
          console.log(`  ${pad(`${row.leg} z${s.z}`, 9)}${pad(row.served.map((d, i) => `${d}->${row.verdicts[i]}`).join(', '), 46)}${pad(fmtFine(row.fine), 26)}`
            + `${pad(fmtCmp(row.step), 26)}${pad(fmtCmp(row.truth), 26)}${row.field.meanKn} kn, ${(row.field.bigShare * 100).toFixed(1)}% >=10 kn`);
          prev = r;
        }
        out[name] = rows;
      }
      return out;
    };
    const paths = { reuse: await runPath(true) };
    if (opts.fresh) paths.fresh = await runPath(false);

    // NULL, the mosaic's resampling: a fine box AWAY from the storm, then the 1-deg box. The eye is drawn from the 1-deg
    // nodes resampled onto the fine lattice, and must be the eye the 1-deg box draws alone.
    const oneDeg = latticeGrid(W.truth, wide, 1, 'null_box_1', W.valid);
    const away = latticeGrid(W.truth, { west: -84, south: 21, east: -80, north: 25 }, 0.25, 'null_away_025', W.valid);
    const plainEye = await eye({ fine: oneDeg, z: 6, levers: MOSAIC_OFF });
    const mosaicEye = await eye({ fine: away, after: [{ grid: oneDeg, view: null }], z: 6, levers: {} });
    const nullMosaic = { cmp: cmp(plainEye, mosaicEye), built: mosaicEye.mosaics, field: binDiff(plainEye.bins, mosaicEye.bins, BIN_KN) };

    const summarise = (rows) => {
      const worst = (leg, key) => rows.filter((r) => r.leg === leg && r[key]).reduce((m, r) => {
        const c = r[key];
        if (c.shiftKm == null) return { ...m, open: m.open + (c.closed[0] !== c.closed[1] ? 1 : 0) };
        return { km: Math.max(m.km, c.shiftKm), kn: Math.max(m.kn, Math.abs(c.dCloseKn)), area: Math.max(m.area, c.areaRatio >= 1 ? c.areaRatio : 1 / c.areaRatio), open: m.open };
      }, { km: 0, kn: 0, area: 1, open: 0 });
      const moved = (leg) => rows.filter((r) => r.leg === leg && r.step && !sameEye(r.step, NULL_TOL)).length;
      const field = (leg) => rows.filter((r) => r.leg === leg).reduce((m, r) => Math.max(m, r.field.meanKn), 0);
      return { in: { ...worst('in', 'step'), moved: moved('in'), field: field('in') }, out: { ...worst('out', 'step'), moved: moved('out'), field: field('out') }, truthOut: worst('out', 'truth') };
    };
    const summary = {};
    for (const [pname, arms] of Object.entries(paths)) {
      summary[pname] = {};
      console.log(`\nsummary, ${pname === 'reuse' ? 'the client cache answers repeat stops' : 'every stop its own box'} (largest change between two neighbouring stops):`);
      console.log(`  ${pad('arm', 12)}${pad('zoom in: stops moved, worst', 44)}${pad('zoom out: stops moved, worst', 44)}${pad('worst vs truth on the way out', 34)}field, worst stop in / out`);
      for (const [name, rows] of Object.entries(arms)) {
        const s = summary[pname][name] = summarise(rows);
        const leg = (l) => `${l.moved} of 7; ${l.km.toFixed(1)} km, ${l.kn} kn, x${l.area.toFixed(2)}${l.open ? `, eye lost ${l.open}x` : ''}`;
        console.log(`  ${pad(name, 12)}${pad(leg(s.in), 44)}${pad(leg(s.out), 44)}${pad(`${s.truthOut.km.toFixed(1)} km, ${s.truthOut.kn} kn, x${s.truthOut.area.toFixed(2)}${s.truthOut.open ? `, lost ${s.truthOut.open}x` : ''}`, 34)}${s.in.field} / ${s.out.field} kn`);
      }
    }

    const R = paths.reuse;
    const nullZoomOk = ZOOMS.every((z) => sameEye(nullZoom[z], NULL_TOL));
    const nullLatticeOk = !R.oneLattice || R.oneLattice.every((r) => sameEye(r.truth, NULL_TOL));
    const nullMosaicOk = nullMosaic.built >= 1 && sameEye(nullMosaic.cmp, NULL_TOL);
    const positiveOk = !R.now || R.now.some((r) => r.leg === 'out' && r.step && !sameEye(r.step, NULL_TOL));
    console.log(`\nnull, same grid at every zoom:            ${nullZoomOk ? 'PASS' : 'FAIL'}  (${ZOOMS.map((z) => `z${z}: ${fmtCmp(nullZoom[z])}`).join(' | ')})`);
    console.log(`null, one lattice at every stop:          ${nullLatticeOk ? 'PASS' : 'FAIL'}`);
    console.log(`null, a mosaic away from the storm:       ${nullMosaicOk ? 'PASS' : 'FAIL'}  (${fmtCmp(nullMosaic.cmp)}; ${nullMosaic.built} built; field ${nullMosaic.field.meanKn} kn)`);
    console.log(`positive, the 'now' arm moves on the way out: ${positiveOk ? 'PASS' : 'BLIND'}`);

    if (opts.images) {
      fs.mkdirSync(opts.images, { recursive: true });
      const stops = plan(PATH, REF, PANE), items = [];
      const shot = async (name, caption, cfg) => {
        const r = await page.evaluate((c) => window.__WIND_BENCH__.eyeShot(c), { base: W.base, lng: REF.lng, lat: REF.lat, theme: 'dark', width: 440, contourKn: 40, ...cfg });
        fs.writeFileSync(path.join(opts.images, `${name}.png`), Buffer.from(r.url.split(',')[1], 'base64'));
        items.push({ name, caption });
      };
      for (const k of [7, 10, 11, 13, 14]) {                           // z9, then z7.5, z7, z6 and z5.5 on the way out
        const s = stops[k];
        await shot(`truth-z${s.z}`, `z${s.z}: truth (0.25 deg everywhere)`, { fine: truthGrid, z: s.z, levers: MOSAIC_OFF });
        for (const name of opts.arms.filter((a) => ['now', 'keepCentre', 'mosaic'].includes(a))) {
          const served = stops.slice(0, k + 1).flatMap((st) => st.served.map((item) => ({ grid: W.grid(item, ARMS[name].tier), view: st.view })));
          await shot(`${name}-out-z${s.z}`, `z${s.z} ${k < ZOOMS.length ? 'in' : 'out'}: ${name}`, { fine: served[0].grid, after: served.slice(1), z: s.z, levers: ARMS[name].levers, keepFinest: ARMS[name].keepFinest });
        }
      }
      fs.writeFileSync(path.join(opts.images, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Wind ladder images</title>
<body style="background:#111;color:#ddd;font:14px system-ui"><p>White line: the 40-kn contour.</p>${items.map((i) => `<figure style="display:inline-block;margin:8px"><img src="${i.name}.png" width="440" alt="${i.caption}"><figcaption>${i.caption}</figcaption></figure>`).join('')}</body>`);
      console.log(`images: ${opts.images}`);
    }
    if (opts.json) {
      const slim = (rows) => rows.map(({ summary: s, ...r }) => ({ ...r, eye: s }));
      fs.writeFileSync(opts.json, JSON.stringify({
        engine: source.label, ref: REF, pane: PANE, path: PATH, thresholds: THRESHOLDS, binKn: BIN_KN,
        truth: Object.fromEntries(ZOOMS.map((z) => [z, truth[z].summary])), nullZoom, nullMosaic,
        paths: Object.fromEntries(Object.entries(paths).map(([p, arms]) => [p, Object.fromEntries(Object.entries(arms).map(([a, rows]) => [a, slim(rows)]))])), summary,
      }, null, 1));
    }
    return nullZoomOk && nullLatticeOk && nullMosaicOk && positiveOk ? 0 : 2;
  } finally {
    await browser.close();
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });
