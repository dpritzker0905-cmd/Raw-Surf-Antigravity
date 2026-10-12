#!/usr/bin/env node
/**
 * Wind bench, ANATOMY mode: what IS a streak at each wind speed, in each theme? Every aspect the eye uses, side by side with dark's
 * (page/anatomy-probe.js): its colour against the field under it (the median mark pixel and the core), its size (the bright body's
 * length along the wind and width across it, the whole mark's length with its tail) and its amount (cover, body share, streaks met
 * along the wind). The owner, 2026-10-12: "lighter moving air/wind in dark mode is almost transparent, or even smaller animations
 * than in beach or light mode. You need to really compare deeply each aspect".
 *
 *   node scripts/wind-bench/ramp-fixture.js scripts/wind-bench/out/ramp-low.json --from 2 --to 30
 *   node scripts/wind-bench/anatomy-run.js --fixture scripts/wind-bench/out/ramp-low.json                       # dark, light, beach at zoom 6
 *   node scripts/wind-bench/anatomy-run.js --fixture <ramp> --themes light --arms '{"now":{},"try":{"__RAW_X__":1}}' --json out/anatomy.json
 *
 * It NEEDS a speed ramp (--fixture): the wind due north, one speed a column, so a streak runs up the picture and a column band is
 * one speed over land and over sea. On the hurricane a band mixes speeds and directions and the size columns mean nothing.
 * One table an aspect; a row a theme (and arm); a column a band, west to east, headed by its served speed (kn). `vs dark` rows give
 * the ratio (or, for chroma, the difference) to dark's same band: the mirror is read there.
 * Needs REACT_APP_MAPBOX_TOKEN like map-run.js (never written or printed); nothing asks the Raw Surf backend. Exit 2 on a crash.
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

// [title, how to read a cell from a band's surface, digits, how the row compares with dark's: 'ratio' | 'diff' | null]
const ASPECTS = [
  ['FIELD under the marks, L*', (s) => s.field.L, 1, null],
  ['FIELD chroma C*', (s) => s.field.C, 1, null],
  ['COVER: share of the surface a mark touches', (s) => s.cover, 2, 'ratio'],
  ['BODY: share of the surface in a streak\'s bright body', (s) => s.body, 3, 'ratio'],
  ['STREAKS met per 1000 CSS px along the wind', (s) => s.per1000, 1, 'ratio'],
  ['MEDIAN mark pixel, L* over the field', (s) => s.mark && s.mark.dL, 1, 'ratio'],
  ['CORE (top tenth), L* over the field', (s) => s.core && s.core.dL, 1, 'ratio'],
  ['CORE chroma minus the field\'s (0 = the colour made lighter; negative = white laid over it)', (s) => s.core && s.core.dC, 1, 'diff'],
  ['BODY length along the wind, CSS px (median)', (s) => s.bodyLen, 1, 'ratio'],
  ['BODY length, 90th percentile', (s) => s.bodyLen90, 1, 'ratio'],
  ['BODY width across the wind, CSS px', (s) => s.width, 2, 'ratio'],
  ['WHOLE mark length with its tail, CSS px (median)', (s) => s.tailLen, 1, 'ratio'],
];

async function main() {
  const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const out = path.join(__dirname, 'out'), ref = flag('--ref'), tag = flag('--tag', 'anatomy').replace(/[^a-z0-9-]/gi, ''), dpr = Number(flag('--dpr', 1.5)), scale = Number(flag('--scale', 1));
  const themes = flag('--themes', 'dark,light,beach').split(','), zooms = flag('--zooms', '6').split(',').map(Number), nBands = Number(flag('--bands', 12));
  const arms = Object.entries(flag('--arms-file') ? JSON.parse(fs.readFileSync(flag('--arms-file'), 'utf8')) : JSON.parse(flag('--arms', '{"now":{}}')));
  const lng = Number(flag('--lng', VIEW.lng)), lat = Number(flag('--lat', VIEW.lat));
  if (!flag('--fixture')) throw new Error('--fixture <a speed ramp from ramp-fixture.js> is required: the size columns need the wind due north and one speed a column');
  const fixture = path.resolve(flag('--fixture')), token = readToken();
  if (!token) throw new Error('REACT_APP_MAPBOX_TOKEN not found (environment or frontend/.env)');
  const source = engineSource(ref, path.join(out, 'cache'));
  await buildBench({ srcRoot: source.srcRoot, outDir: path.join(out, tag), page: 'map' });
  const server = await serveDir(out, undefined, { land: 'app' });
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: true, args: gpuArgs(flag('--gl', 'gpu')) });
  const rows = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: dpr });
    await page.addInitScript((t) => { window.__MAPBOX_TOKEN__ = t; }, token);
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${tag}/map.html`);
    await page.waitForFunction(() => window.__MAP_BENCH__ && window.__MAP_BENCH__.ready);
    const fine = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    await page.evaluate((fx) => window.__MAP_BENCH__.init(fx), { fine, scale, offline: false, pixelRatio: dpr });
    console.log(`engine: ${source.label} · view ${lng},${lat} · map pixel ratio ${dpr} · ${path.basename(fixture)} x${scale} · arms ${arms.map((a) => a[0]).join(', ')}`);
    for (const z of zooms) {
      for (const theme of themes) for (const [arm, levers] of (theme === 'dark' ? [arms[0]] : arms)) {
        const r = await page.evaluate((cfg) => window.__MAP_BENCH__.anatomyRun(cfg), { theme, z, lng, lat, levers, bands: nBands, samples: Number(flag('--samples', 8)), gap: 10, seed: 1 });
        r.arm = theme === 'dark' ? 'dark' : arm; rows.push(r);
        console.error(`  read ${theme} z${z} ${r.arm}${r.glError ? ' GL ERROR ' + r.glError : ''}`);
      }
      const these = rows.filter((r) => r.z === z), dark = these.find((r) => r.theme === 'dark'), speeds = these[0].bands.map((b) => b.speed);
      const cell = (v, d) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d)).padStart(7);
      for (const surf of ['land', 'sea']) {
        console.log(`\n================ zoom ${z} · over the ${surf.toUpperCase()} · served speed (kn) a band ================\n${''.padEnd(22)}${speeds.map((s) => cell(s, 1)).join('')}`);
        for (const [title, get, digits, versus] of ASPECTS) {
          console.log(`\n${title}`);
          for (const r of these) {
            const v = r.bands.map((b) => (b[surf] ? get(b[surf]) : null));
            console.log(`  ${`${r.theme}${r.arm !== r.theme && arms.length > 1 ? ' ' + r.arm : ''}`.padEnd(20)}${v.map((x) => cell(x, digits)).join('')}`);
            if (versus && dark && r !== dark) {
              const dv = dark.bands.map((b) => (b[surf] ? get(b[surf]) : null));
              console.log(`  ${'   vs dark'.padEnd(20)}${v.map((x, i) => (x == null || dv[i] == null ? cell(null) : versus === 'diff' ? cell(x - dv[i], digits) : dv[i] ? cell(x / dv[i], 2) : cell(null))).join('')}`);
            }
          }
        }
      }
    }
    if (flag('--json')) fs.writeFileSync(path.resolve(flag('--json')), JSON.stringify({ engine: source.label, view: { lng, lat }, dpr, fixture: path.basename(fixture), scale, rows }, null, 1));
    return rows.some((r) => r.glError) ? 2 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });
