#!/usr/bin/env node
/**
 * Wind bench, GROUND mode: what IS the map the wind is laid on, a theme? Every lane's arithmetic starts from a land colour and a
 * water colour, and on 2026-10-12 the instruments held three different sets of them. This reads them from the style as the
 * library loaded it and from the pixels it then draws (page/ground-probe.js), on the real basemaps.
 *
 *   node scripts/wind-bench/ground-run.js                          # dark, light, beach at zooms 4, 6, 9; the land and the sea as drawn
 *   node scripts/wind-bench/ground-run.js --areas                  # also every area layer under the wind: its paint, own and muted
 *   node scripts/wind-bench/ground-run.js --scale 2.3 --zooms 6    # the ground under a stronger wind (the field deepens it)
 *   node scripts/wind-bench/ground-run.js --json out/ground.json
 *
 * One row a surface: `own` = the style's own map, wind off; `muted` = as the app restyles it under the wind (the basemap mute; the
 * border ink does not colour an area), wind hidden; `field` = that map under the wind's colour field alone (a 2x2 particle pool):
 * the ground a streak is laid on. Each is the median [r, g, b] and L* / C* / hue of the surface in the view; `wind` is the served
 * speed under it (median and quartiles, kn).
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

async function main() {
  const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const out = path.join(__dirname, 'out'), ref = flag('--ref'), tag = 'ground', scale = Number(flag('--scale', 1)), dpr = Number(flag('--dpr', 1.5));
  const themes = flag('--themes', 'dark,light,beach').split(','), zooms = flag('--zooms', '4,6,9').split(',').map(Number), showAreas = argv.includes('--areas');
  const lng = Number(flag('--lng', VIEW.lng)), lat = Number(flag('--lat', VIEW.lat));
  const token = readToken();
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
    const fine = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'eye-2026-10-09-gfs-native.json'), 'utf8'));
    await page.evaluate((fx) => window.__MAP_BENCH__.init(fx), { fine, scale, offline: false, pixelRatio: dpr });
    console.log(`engine: ${source.label} · view ${lng},${lat} · map pixel ratio ${dpr} · wind x${scale}\n`);
    console.log('theme  z  surface | own  [r, g, b]        L*    C*    h | muted [r, g, b]       L*    C*    h | under the field       L*    C*    h | wind kn med [q25, q75] | mute');
    const c = (s) => (s ? `${`[${s.rgb.join(', ')}]`.padEnd(17)} ${String(s.L).padStart(5)} ${String(s.C).padStart(5)} ${String(s.h).padStart(4)}` : '-'.padEnd(34));
    for (const theme of themes) {
      let areas = null;
      for (const z of zooms) {
        const r = await page.evaluate((cfg) => window.__MAP_BENCH__.groundRun(cfg), { theme, z, lng, lat, frames: 120, seed: 1 });
        rows.push(r);
        areas = areas || r;
        for (const k of ['land', 'sea']) {
          const s = r[k], w = r.wind[k];
          console.log(`${theme.padEnd(6)} ${String(z).padEnd(2)} ${k.padEnd(7)} | ${c(s.own)} | ${c(s.muted)} | ${c(s.field)} | ${w ? `${String(w.med).padStart(5)} [${w.q25}, ${w.q75}]`.padEnd(22) : '-'.padEnd(22)} | ${r.mute.layers} layers${r.mute.amount > 0 ? ` at ${r.mute.amount}, water x${r.mute.waterL}` : ' (off)'}`);
        }
      }
      if (showAreas && areas) {
        console.log(`\n  ${theme}: the area layers UNDER the wind, in draw order (${areas.areas.length}); above it: ${areas.areasAbove.length ? areas.areasAbove.map((l) => l.id).join(', ') : 'none'}`);
        for (const l of areas.areas) {
          const zr = `${l.minzoom != null ? ` z>=${l.minzoom}` : ''}${l.maxzoom != null ? ` z<${l.maxzoom}` : ''}${l.visibility !== 'visible' ? ' HIDDEN' : ''}${l.opacity !== undefined ? ` opacity ${JSON.stringify(l.opacity).slice(0, 60)}` : ''}`;
          console.log(`    ${l.id} (${l.type})${zr}`);
          for (const p of l.colours) console.log(`        ${p.prop}: ${JSON.stringify(p.own).slice(0, 150)}\n          ${p.muted !== undefined ? 'muted' : 'a mute would give'}: ${JSON.stringify(p.muted !== undefined ? p.muted : p.wouldMute).slice(0, 150)}`);
        }
        console.log('');
      }
    }
    if (flag('--json')) fs.writeFileSync(path.resolve(flag('--json')), JSON.stringify({ engine: source.label, view: { lng, lat }, dpr, scale, rows }, null, 1));
    return rows.some((r) => r.glError) ? 2 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });
