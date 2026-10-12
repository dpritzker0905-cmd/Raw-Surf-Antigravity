#!/usr/bin/env node
/**
 * Wind bench, SWITCH mode: after a THEME CHANGE with the wind on, is the new theme's map restyled (its ground muted, its borders
 * inked)? Every other mode builds a fresh map a theme and cannot see a theme change. This replays the app's own sequence on the
 * real library and the real styles (page/switch-probe.js): setStyle(url, { diff: true }) as react-maplibre calls it, the layer's
 * once('idle') re-sync, its styledata / style.load handler, the map repainting as it does while the wind animates.
 *
 *   node scripts/wind-bench/switch-run.js                                  # light>beach, beach>light, dark>light, light>dark; both orders
 *   node scripts/wind-bench/switch-run.js --wirings dev,app                # the layer's handler before the repair of 2026-10-12, then the app's
 *   node scripts/wind-bench/switch-run.js --pairs "light>beach" --events   # one change, with every event and its time
 *   node scripts/wind-bench/switch-run.js --ref origin/dev --wirings dev   # dev as it was: its module AND its handler (no ink there: `inked` reads -)
 *
 * --orders natural,resync-first (default both): `natural` leaves the re-sync to the map's own idle, so the order is whatever the
 * network gives (a style already in the browser's cache arrives first; one fetched over the network arrives after the re-sync);
 * `resync-first` forces the order a fetched style gives. Both must end restyled.
 *
 * Columns: `style` = diff (the style object survived) or rebuild; `wind layer` kept or re-added; `re-sync` = whether the layer's
 * idle re-sync ran BEFORE the new style arrived; `inked` / `muted` = the border's and the water's paint, as the library holds
 * them once the map has settled, are the new theme's own colours restyled (yes) or left as the style draws them (NO); `read-back`
 * = what window.__WIND_BORDER_INK__ and __WIND_BASEMAP_MUTE__ claim at that moment.
 * Needs REACT_APP_MAPBOX_TOKEN like map-run.js (never written or printed). Exit 1 when a theme that should be restyled is not,
 * under the LAST wiring named; 2 on a crash.
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');

function readToken() {
  if (process.env.REACT_APP_MAPBOX_TOKEN) return process.env.REACT_APP_MAPBOX_TOKEN;
  const env = path.join(FRONTEND, '.env');
  if (!fs.existsSync(env)) return '';
  const line = fs.readFileSync(env, 'utf8').split(/\r?\n/).find((l) => l.startsWith('REACT_APP_MAPBOX_TOKEN='));
  return line ? line.slice('REACT_APP_MAPBOX_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : '';
}

async function main() {
  const argv = process.argv.slice(2), flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const out = path.join(__dirname, 'out'), ref = flag('--ref'), tag = 'switch';
  const pairs = flag('--pairs', 'light>beach,beach>light,dark>light,light>dark').split(',').map((p) => p.split('>'));
  const wirings = flag('--wirings', 'app').split(','), orders = flag('--orders', 'natural,resync-first').split(','), showEvents = argv.includes('--events');
  const token = readToken();
  if (!token) throw new Error('REACT_APP_MAPBOX_TOKEN not found (environment or frontend/.env)');
  const source = engineSource(ref, path.join(out, 'cache'));
  await buildBench({ srcRoot: source.srcRoot, outDir: path.join(out, tag), page: 'map' });
  const server = await serveDir(out, undefined, { land: 'app' });
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: true, args: gpuArgs(flag('--gl', 'gpu')) });
  const rows = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
    await page.addInitScript((t) => { window.__MAPBOX_TOKEN__ = t; }, token);
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${tag}/map.html`);
    await page.waitForFunction(() => window.__MAP_BENCH__ && window.__MAP_BENCH__.ready);
    const fine = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'eye-2026-10-09-gfs-native.json'), 'utf8'));
    await page.evaluate((fx) => window.__MAP_BENCH__.init(fx), { fine, scale: 1, offline: false });
    console.log(`engine: ${source.label}\n\nchange         wiring order        | style    wind layer | re-sync            | inked muted | coastline       | read-back`);
    const yn = (v) => (v == null ? ' -  ' : v ? 'yes ' : 'NO  ');
    for (const wiring of wirings) for (const order of orders) for (const [from, to] of pairs) {
      const r = await page.evaluate((c) => window.__MAP_BENCH__.switchRun(c), { from, to, wiring, order });
      r.order = order;
      rows.push(r);
      const ink = r.readBack.ink, mute = r.readBack.mute;
      console.log(`${`${from} > ${to}`.padEnd(14)} ${wiring.padEnd(6)} ${order.padEnd(12)} | ${(r.loaded ? (r.diffed ? 'diff' : 'rebuild') : 'NO LOAD').padEnd(8)} ${(r.windKept ? 'kept' : 're-added').padEnd(10)} | ${(r.idleFirst == null ? 'never ran' : r.idleFirst ? 'BEFORE the style' : 'after the style').padEnd(18)} | ${yn(r.inked)}  ${yn(r.muted)}  | ${(!r.coast.there ? 'GONE' : r.coast.inked == null ? 'there (own)' : r.coast.inked ? 'there, inked' : 'there, NOT INKED').padEnd(15)} | ink ${ink ? (ink.applied ? `applied ${ink.layers} (${ink.theme})` : `off: ${ink.reason}`) : '-'} · mute ${mute ? `${mute.applied ? 'applied' : 'off'} ${mute.layers} (${mute.theme})` : '-'}`);
      if (showEvents) for (const e of r.events) console.log(`    ${e}`);
    }
    if (flag('--json')) fs.writeFileSync(path.resolve(flag('--json')), JSON.stringify({ engine: source.label, rows }, null, 1));
    const last = wirings[wirings.length - 1];
    return rows.some((r) => r.wiring === last && (r.inked === false || r.muted === false || !r.coast.there || r.coast.inked === false)) ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });
