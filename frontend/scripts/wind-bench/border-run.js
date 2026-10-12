#!/usr/bin/env node
/**
 * Wind bench, BORDER mode: can the map's political borders and place names be read under the wind? The owner's REAL basemaps under
 * the REAL engine, the borders found from the style itself and scored alone (page/border-probe.js; map mode's line columns score
 * every edge of the map, and the borders are a few of them). Dark is the bar (owner, 2026-10-12).
 *
 *   node scripts/wind-bench/border-run.js                                  # light, beach, dark at zooms 4, 6, 8; the tree as it is
 *   node scripts/wind-bench/border-run.js --arms '{"before":{"levers":{"__RAW_DISABLE_WIND_BORDER_INK__":true}},"ink":{}}'
 *   node scripts/wind-bench/border-run.js --arms '{"now":{},"try":{"ink":"rgba(27, 31, 45, 0.85)"}}'   # a candidate, before any code draws it
 *   node scripts/wind-bench/border-run.js --inventory                      # also print each style's border and label layers and their paint
 *   node scripts/wind-bench/border-run.js --crop 720x480 --at 0.5,0.3      # device-resolution PNG crops (off | field | full an arm)
 *   node scripts/wind-bench/border-run.js --ref origin/dev --dpr 2 --offline
 *
 * An arm is { levers, paint, ink, windOnTop }: `levers` are window levers set before the app's own sync (windBasemapMute.js) runs; `paint` is a
 * list of { id, prop, value } laid AFTER it, and `ink` is short for one line-color on every border line: the bench's own override,
 * so a candidate is measured before product code exists. `windOnTop` draws the wind above every style layer for that arm (the
 * control for the layer order). Nothing an arm sets outlives it.
 * --dpr: the map's device pixels a CSS pixel (default 1.5, the owner's laptop; a 0.5 px border is 0.75 of a device pixel there).
 * Needs REACT_APP_MAPBOX_TOKEN like map-run.js (environment or frontend/.env; passed to the page in memory, never written or
 * printed). Tiles come from Mapbox; the wind is the served-grid fixture; nothing asks the Raw Surf backend.
 * Columns: page/border-probe.js. The last column is the RESTORE: every paint value of the whole style, read from the library with
 * the wind off before the arms and after each arm (`exact`), and whether the arm had moved any (`nothing moved` when not).
 * Exit 2 on a GL error, a crash, or an arm that did not put the style's paint back exactly.
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');

const VIEW = { lng: -88.05, lat: 30.45 };
const BORDER_LINES = ['admin-1-boundary', 'admin-0-boundary', 'admin-0-boundary-disputed'];

function readToken() {
  if (process.env.REACT_APP_MAPBOX_TOKEN) return process.env.REACT_APP_MAPBOX_TOKEN;
  const env = path.join(FRONTEND, '.env');
  if (!fs.existsSync(env)) return '';
  const line = fs.readFileSync(env, 'utf8').split(/\r?\n/).find((l) => l.startsWith('REACT_APP_MAPBOX_TOKEN='));
  return line ? line.slice('REACT_APP_MAPBOX_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : '';
}

function parseArgs(argv) {
  const opts = { gl: 'gpu', out: path.join(__dirname, 'out'), themes: ['dark', 'light', 'beach'], zooms: [4, 6, 8], frames: 180, samples: 6, gap: 12, seed: 1, scale: 1, dpr: 1.5, tag: 'border', arms: { now: {} } };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => argv[++i];
    if (a === '--ref') opts.ref = val();
    else if (a === '--json') opts.json = path.resolve(val());
    else if (a === '--gl') opts.gl = val();
    else if (a === '--themes') opts.themes = val().split(',');
    else if (a === '--zooms') opts.zooms = val().split(',').map(Number);
    else if (a === '--frames') opts.frames = Number(val());
    else if (a === '--samples') opts.samples = Number(val());
    else if (a === '--seed') opts.seed = Number(val());
    else if (a === '--scale') opts.scale = Number(val());
    else if (a === '--dpr') opts.dpr = Number(val());
    else if (a === '--tag') opts.tag = val().replace(/[^a-z0-9-]/gi, '');
    else if (a === '--arms') opts.arms = JSON.parse(val());
    else if (a === '--arms-file') opts.arms = JSON.parse(fs.readFileSync(val(), 'utf8'));
    else if (a === '--crop') { const [size, fmt] = val().split(':'); opts.crop = [...size.split('x').map(Number), fmt === 'jpeg' ? 'jpeg' : 'png']; }
    else if (a === '--at') opts.at = val().split(',').map(Number);
    else if (a === '--lng') opts.lng = Number(val());
    else if (a === '--lat') opts.lat = Number(val());
    else if (a === '--offline') opts.offline = true;
    else if (a === '--inventory') opts.inventory = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

const cell = (v, w, d = 1) => (v == null ? '-' : (typeof v === 'number' ? v.toFixed(d) : String(v))).padStart(w);
const HEADER = 'theme  z  arm          |    n | dL bare   off field  full   p25 sign | retF   retP  lostP |  weak   3:1 ratio | names moved | solid moved | wind under the lines   | drawn | style paint once the wind is off';

/** What the `drawn` column says: the arm's own override when it laid one (the app's read-back is not the picture then), else the app's. */
function drawnBy(row) {
  if (row.bench) return `the bench's own ${row.bench}`;
  const rb = row.readBack;
  if (!rb) return 'no ink read-back';
  return `ink ${rb.applied ? `${rb.layers} lines ${rb.color || ''}` : `off${rb.reason ? ` (${rb.reason})` : ''}`}`;
}

function line(row) {
  const b = row.border, drawn = drawnBy(row);
  return `${row.theme.padEnd(6)} ${String(row.z).padEnd(2)} ${row.arm.padEnd(12)} | ${cell(b.n, 4, 0)} | ${cell(b.bare, 7)} ${cell(b.off, 5)} ${cell(b.field, 5)} ${cell(b.full, 5)} ${cell(b.p25, 5)} ${cell(b.sign, 4)} | ${cell(b.retF, 5, 2)} ${cell(b.retP, 6, 2)} ${cell(b.lostP, 6, 3)} | ${cell(b.weak, 5, 3)} ${cell(b.at3, 5, 3)} ${cell(b.ratio, 5, 2)} | ${cell(row.labels.n, 5, 0)} ${cell(row.labels.moved, 5, 2)} | ${cell(row.solid.n, 5, 0)} ${cell(row.solid.moved, 5, 2)} | ${row.wind ? `${cell(row.wind.med, 4)} [${cell(row.wind.q25, 4)},${cell(row.wind.q75, 5)}] kn` : '   -              '} | mute ${row.synced.layers} · ${drawn} | ${row.restore ? `restore ${row.restore.exact ? 'exact' : 'NOT EXACT'}${row.restore.moved ? '' : ' (nothing moved)'}` : 'restore -'}`;
}

function printInventory(theme, inv) {
  const j = (v) => JSON.stringify(v);
  console.log(`\n  ${theme}: ${inv.symbolsBelowWind} symbol layers below the wind (road arrows and the like; none names a place)`);
  for (const [kind, rows] of [['border line', inv.borders], ['casing', inv.casings], ['place label', inv.labels]]) {
    for (const l of rows) console.log(`    ${kind.padEnd(11)} ${l.id.padEnd(30)} ${l.aboveWind ? 'ABOVE the wind' : 'BELOW the wind'}${l.minzoom != null ? ` · minzoom ${l.minzoom}` : ''}${l.maxzoom != null ? ` · maxzoom ${l.maxzoom}` : ''}\n${Object.entries(l.paint).map(([p, v]) => `        ${p}: ${j(v)}`).join('\n')}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = opts.offline ? '' : readToken();
  if (!token && !opts.offline) throw new Error('REACT_APP_MAPBOX_TOKEN not found (environment or frontend/.env); --offline runs on a synthetic basemap');
  const source = engineSource(opts.ref, path.join(opts.out, 'cache'));
  const built = await buildBench({ srcRoot: source.srcRoot, outDir: path.join(opts.out, opts.tag), page: 'map' });
  const arms = Object.entries(opts.arms).map(([name, a]) => ({ name, levers: a.levers || {}, windOnTop: a.windOnTop === true, paint: [...(a.paint || []), ...(a.ink ? BORDER_LINES.map((id) => ({ id, prop: 'line-color', value: a.ink })) : [])] }));
  console.log(`engine: ${source.label} · bundle ${(built.bytes / 1024).toFixed(0)} KiB · arms ${arms.map((a) => a.name).join(', ')}`);
  const server = await serveDir(opts.out, undefined, { land: opts.offline ? 'offline' : 'app' });
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: true, args: gpuArgs(opts.gl) });
  const results = [], notRestored = [];
  let glError = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: opts.dpr });
    await page.addInitScript((t) => { window.__MAPBOX_TOKEN__ = t; }, token);
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${opts.tag}/map.html`);
    await page.waitForFunction(() => window.__MAP_BENCH__ && window.__MAP_BENCH__.ready);
    const fine = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'eye-2026-10-09-gfs-native.json'), 'utf8'));
    await page.evaluate((fx) => window.__MAP_BENCH__.init(fx), { fine, scale: opts.scale, offline: !!opts.offline, pixelRatio: opts.dpr });
    const lng = opts.lng == null ? VIEW.lng : opts.lng, lat = opts.lat == null ? VIEW.lat : opts.lat;
    console.log(`view ${lng},${lat} · map pixel ratio ${opts.dpr} · wind x${opts.scale}${opts.offline ? ' · OFFLINE synthetic basemap' : ''}\n\n${HEADER}`);
    for (const theme of opts.themes) {
      let inv = null;
      for (const z of opts.zooms) {
        const res = await page.evaluate((c) => window.__MAP_BENCH__.borderRun(c), { theme, z, lng, lat, frames: opts.frames, samples: opts.samples, gap: opts.gap, res: 384, seed: opts.seed, arms, crop: opts.crop, cropAt: opts.at });
        inv = inv || res.inventory;
        if (res.masksExact === false) notRestored.push(`${theme} z${z} (the probe's own masks)`);
        const dir = path.join(opts.out, `${opts.tag}-crops`), save = (name, url) => { if (!url) return; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${name}.${opts.crop[2] === 'jpeg' ? 'jpg' : 'png'}`), Buffer.from(url.split(',')[1], 'base64')); };
        save(`${theme}-z${z}-bare`, res.bareCrop);
        for (const row of res.rows) {
          const arm = arms.find((a) => a.name === row.arm);
          if (arm && arm.paint.length) row.bench = opts.arms[arm.name].ink ? `ink ${opts.arms[arm.name].ink}` : `paint (${arm.paint.length} values)`;
          if (row.glError) glError = row.glError;
          if (row.restore && !row.restore.exact) notRestored.push(`${theme} z${z} ${row.arm}`);
          for (const [kind, url] of Object.entries(row.crops || {})) save(`${theme}-z${z}-${row.arm}-${kind}`, url);
          delete row.crops;
          console.log(line(row));
          results.push(row);
        }
      }
      if (opts.inventory && inv) printInventory(theme, inv);
      if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ engine: source.label, view: { lng, lat }, dpr: opts.dpr, arms, results }, null, 1));
    }
    if (notRestored.length) console.log(`\nNOT RESTORED (the style's paint differs from before the arm): ${notRestored.join('; ')}`);
    return glError || notRestored.length ? 2 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });
