#!/usr/bin/env node
/**
 * Wind bench, MAP mode: the owner's REAL basemaps under the REAL engine, fed a SERVED grid. Answers "how much of the map
 * survives the wind, and how much do the particles themselves show?" per theme and zoom, for one or more lever sets.
 *
 *   node scripts/wind-bench/map-run.js
 *   node scripts/wind-bench/map-run.js --themes dark --zooms 7,9 --arms '{"now":{},"op07":{"__RAW_X__":0.7}}'
 *   node scripts/wind-bench/map-run.js --ref origin/dev --json out/map.json
 *   node scripts/wind-bench/map-run.js --scale 2.3      # storm strength: Mobile Bay median ~30 kn (served: 13)
 *
 * Needs REACT_APP_MAPBOX_TOKEN (the app's public token) in the environment or in frontend/.env. The runner passes it to
 * the page in memory; it is never written to disk or printed. Tiles come from Mapbox (a few hundred requests per run).
 * View: Mobile Bay (the owner's 2026-10-09 report), ~300 km north of the 15Z Gulf eye; the grid is the served GFS
 * native product (fixtures/eye-2026-10-09-gfs-native.json, 0.25 deg, -90..-78 / 25..32) over a 2-deg world base.
 *
 * Columns, land then water, over the basemap's own edge pixels, each scored between its own line and ground pixels:
 *   retF / retP  share of each line's bare-basemap L* contrast kept under the field alone / field + particles;
 *   pLoss        the share of the field-only contrast the particles take: 1 - retP / retF (land-run.js's `parts`);
 *   lostP        share of lines left under half their contrast under field + particles;
 *   3:1F / 3:1P  share of the basemap's >= 3:1 lines still >= 3:1 (WCAG 1.4.11) under the field / field + particles;
 *   gsP          GMSD-style gradient similarity under field + particles (a cross-check blind to whose edge it is);
 *   sal          mean |dL*| the particles add over the field alone (their visual signal).
 * Writes out/map-sheet.html (off | field | full per arm) for the eye.
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');

const VIEW = { lng: -88.05, lat: 30.45 };

function readToken() {
  if (process.env.REACT_APP_MAPBOX_TOKEN) return process.env.REACT_APP_MAPBOX_TOKEN;
  const env = path.join(FRONTEND, '.env');
  if (!fs.existsSync(env)) return '';
  const line = fs.readFileSync(env, 'utf8').split(/\r?\n/).find((l) => l.startsWith('REACT_APP_MAPBOX_TOKEN='));
  return line ? line.slice('REACT_APP_MAPBOX_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : '';
}

function parseArgs(argv) {
  const opts = { gl: 'gpu', out: path.join(__dirname, 'out'), themes: ['light', 'beach', 'dark'], zooms: [6, 7, 8, 9, 10, 11], frames: 180, seed: 1, scale: 1, tag: 'map', arms: { now: {} } };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => argv[++i];
    if (a === '--ref') opts.ref = val();
    else if (a === '--json') opts.json = path.resolve(val());
    else if (a === '--gl') opts.gl = val();
    else if (a === '--headed') opts.headed = true;
    else if (a === '--themes') opts.themes = val().split(',');
    else if (a === '--zooms') opts.zooms = val().split(',').map(Number);
    else if (a === '--frames') opts.frames = Number(val());
    else if (a === '--seed') opts.seed = Number(val());
    else if (a === '--scale') opts.scale = Number(val());
    else if (a === '--tag') opts.tag = val().replace(/[^a-z0-9-]/gi, '');
    else if (a === '--arms') opts.arms = JSON.parse(val());
    else if (a === '--sheet') opts.sheet = path.resolve(val());
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

const f3 = (x) => (x == null ? '  -  ' : x.toFixed(3));
/** Particles' share of the field-only line survival: 1 - full/field (each line's own contrast, and the 3:1 share). */
function row(r) {
  for (const k of ['land', 'water']) {
    const s = r[k];
    s.pLoss = s.field.retain ? +(1 - s.full.retain / s.field.retain).toFixed(4) : null;
    s.pLoss3 = s.field.wcag ? +(1 - s.full.wcag / s.field.wcag).toFixed(4) : null;
  }
  const c = (s) => `${f3(s.field.retain)} ${f3(s.full.retain)} ${f3(s.pLoss)} ${f3(s.full.lost)} ${f3(s.field.wcag)} ${f3(s.full.wcag)} ${f3(s.full.gs)} ${s.sal == null ? '  -  ' : s.sal.toFixed(2).padStart(5)}`;
  return `${c(r.land)} | ${c(r.water)}`;
}

function sheet(results, opts, label) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cells = results.map((r) => `<figure><figcaption>${esc(`${r.theme} z${r.z} · ${r.arm}`)} · land line loss to particles ${f3(r.land.pLoss)} · 3:1 kept ${f3(r.land.full.wcag)} · mark signal ${r.land.sal.toFixed(2)}</figcaption>`
    + ['off', 'field', 'full'].map((k) => `<img alt="${esc(`${r.theme} z${r.z} ${r.arm} ${k}`)}" src="${r.shots[k]}">`).join('') + '</figure>').join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Wind map bench</title><style>
body{margin:0;background:#111317;color:#dde1e6;font:12px/1.4 system-ui,sans-serif}h1{font-size:15px;margin:12px 16px}
figure{margin:0 16px 14px}figure img{width:448px;margin-right:4px}figcaption{margin:2px 0}</style></head><body>
<h1>${esc(label)}</h1>${cells}</body></html>`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = readToken();
  if (!token) throw new Error('REACT_APP_MAPBOX_TOKEN not found (environment or frontend/.env)');
  const source = engineSource(opts.ref, path.join(opts.out, 'cache'));
  const built = await buildBench({ srcRoot: source.srcRoot, outDir: path.join(opts.out, opts.tag), page: 'map' });
  console.log(`engine: ${source.label} · bundle ${(built.bytes / 1024).toFixed(0)} KiB · arms ${Object.keys(opts.arms).join(', ')}`);
  const server = await serveDir(opts.out);
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: !opts.headed, args: gpuArgs(opts.gl) });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
    await page.addInitScript((t) => { window.__MAPBOX_TOKEN__ = t; }, token);
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${opts.tag}/map.html`);
    await page.waitForFunction(() => window.__MAP_BENCH__ && window.__MAP_BENCH__.ready);
    const fine = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'eye-2026-10-09-gfs-native.json'), 'utf8'));
    const info = await page.evaluate((fx) => window.__MAP_BENCH__.init({ fine: fx.fine, scale: fx.scale }), { fine, scale: opts.scale });
    console.log(`maplibre ${await page.evaluate(() => window.__MAP_BENCH__.maplibre)} · served grid ${info.fine} x${opts.scale} · view ${VIEW.lng},${VIEW.lat}\n`);
    console.log('theme  z    arm    | LAND retF  retP  pLoss lostP 3:1F  3:1P  gsP    sal | WATER retF retP  pLoss lostP 3:1F  3:1P  gsP    sal');
    for (const theme of opts.themes) {
      for (const z of opts.zooms) {
        for (const [arm, levers] of Object.entries(opts.arms)) {
          const r = await page.evaluate((c) => window.__MAP_BENCH__.shoot(c), { theme, z, lng: VIEW.lng, lat: VIEW.lat, frames: opts.frames, res: 384, seed: opts.seed, levers });
          if (r.glError) throw new Error(`GL error ${r.glError} at ${theme} z${z} ${arm}`);
          r.arm = arm;
          console.log(`${theme.padEnd(6)} ${String(z).padEnd(4)} ${arm.padEnd(6)} | ${row(r)}`);
          results.push(r);
        }
      }
    }
    const sheetPath = opts.sheet || path.join(opts.out, 'map-sheet.html');
    fs.writeFileSync(sheetPath, sheet(results, opts, `Wind map bench · ${source.label} · Mobile Bay · served GFS 2026-10-09 15Z`));
    console.log(`\ncontact sheet: ${sheetPath}`);
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ engine: source.label, view: VIEW, arms: opts.arms, results: results.map(({ shots, ...r }) => r) }, null, 1));
    return 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });
