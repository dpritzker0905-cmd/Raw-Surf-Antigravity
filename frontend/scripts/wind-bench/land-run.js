#!/usr/bin/env node
/**
 * Wind bench, LAND mode: how much of the land's line work (roads, rivers, coasts) survives the wind
 * layer, per theme and zoom, and how much of the loss is the particles rather than the colour field.
 * Renders the REAL engine over a line grid on the theme's land colour (page: landOne). Offline.
 *
 *   node scripts/wind-bench/land-run.js
 *   node scripts/wind-bench/land-run.js --themes light --zooms 6,9,11 --levers '{"__RAW_X__":1}'
 *   node scripts/wind-bench/land-run.js --ref origin/dev --json out/land.json
 *
 * Columns: field = line contrast kept under the colour field alone (4 particles); full = with the
 * particle pool; parts = the share of the field-only contrast the particles take away (1 - full/field);
 * lost = share of line samples left under half their contrast; sal = mean |dL*| the particles add (their visual signal);
 * cover = share of pixels they move by more than 5 L*. Lines follow each basemap's road polarity (lighter than land in
 * dark). View: 28-38 kn air NE of the bench
 * storm (field.js HURRICANE), where the owner's 2026-10-09 close-zoom report sat (~25-35 kn).
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');

const VIEW = { lng: -88.0, lat: 26.5 };
const POOL = 384;                                     // desktop particle pool (engine default)

function parseArgs(argv) {
  const opts = { gl: 'gpu', out: path.join(__dirname, 'out'), themes: ['light', 'dark', 'beach'], zooms: [6, 7, 8, 9, 10, 11], frames: 180, seeds: [1], levers: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => argv[++i];
    if (a === '--ref') opts.ref = val();
    else if (a === '--json') opts.json = path.resolve(val());
    else if (a === '--gl') opts.gl = val();
    else if (a === '--headed') opts.headed = true;
    else if (a === '--themes') opts.themes = val().split(',');
    else if (a === '--zooms') opts.zooms = val().split(',').map(Number);
    else if (a === '--frames') opts.frames = Number(val());
    else if (a === '--seeds') opts.seeds = Array.from({ length: Number(val()) }, (_, k) => k + 1);
    else if (a === '--levers') opts.levers = JSON.parse(val());
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const source = engineSource(opts.ref, path.join(opts.out, 'cache'));
  const built = await buildBench({ srcRoot: source.srcRoot, outDir: path.join(opts.out, 'bench') });
  console.log(`engine: ${source.label} · bundle ${(built.bytes / 1024).toFixed(0)} KiB · levers ${JSON.stringify(opts.levers)}`);
  const server = await serveDir(opts.out);
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: !opts.headed, args: gpuArgs(opts.gl) });
  const rows = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/bench/index.html`);
    await page.waitForFunction(() => window.__WIND_BENCH__ && window.__WIND_BENCH__.renderer);
    console.log(`renderer: ${await page.evaluate(() => window.__WIND_BENCH__.renderer)}\n`);
    console.log('theme  zoom | field  full   parts  lost   sal    cover');
    for (const theme of opts.themes) {
      for (const z of opts.zooms) {
        const run = async (res) => {
          const rs = [];
          for (const seed of opts.seeds) {
            const cfg = { view: `z${z}`, z, grid: z > 6 ? 'fine' : 'world', lng: VIEW.lng, lat: VIEW.lat, theme, res, frames: opts.frames, seed, levers: opts.levers };
            const r = await page.evaluate((c) => window.__WIND_BENCH__.landOne(c), cfg);
            if (r.glError) throw new Error(`GL error ${r.glError} at ${theme} z${z}`);
            rs.push(r);
          }
          return { retain: mean(rs.map((r) => r.retain)), lost: mean(rs.map((r) => r.lost)), sal: rs[0].sal == null ? null : mean(rs.map((r) => r.sal)), cover: rs[0].cover == null ? null : mean(rs.map((r) => r.cover)) };
        };
        const field = await run(2), full = await run(POOL);
        const row = { theme, z, field: +field.retain.toFixed(3), full: +full.retain.toFixed(3), parts: +(1 - full.retain / field.retain).toFixed(3), lost: +full.lost.toFixed(3), sal: full.sal, cover: full.cover };
        rows.push(row);
        console.log(`${theme.padEnd(6)} ${String(z).padStart(4)} | ${row.field.toFixed(3)}  ${row.full.toFixed(3)}  ${row.parts.toFixed(3)}  ${row.lost.toFixed(3)}  ${row.sal.toFixed(2).padStart(5)}  ${row.cover.toFixed(3)}`);
      }
    }
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ engine: source.label, view: VIEW, levers: opts.levers, rows }, null, 1));
    return 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });
