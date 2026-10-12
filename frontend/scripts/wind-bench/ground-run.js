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
 *   node scripts/wind-bench/ground-run.js --fixture out/ramp-low.json --strips 12 --full 60 --zooms 6      # HOW MUCH OF THE MAP COMES THROUGH
 *   node scripts/wind-bench/ground-run.js --arms '{"now":{},"before":{"__RAW_DISABLE_WIND_LAND_DEPTH__":true}}' --crop 900x640:jpeg
 *
 * One row a surface: `own` = the style's own map, wind off; `muted` = as the app restyles it under the wind (the basemap mute; the
 * border ink does not colour an area), wind hidden; `field` = that map under the wind's colour field alone (a 2x2 particle pool):
 * the ground a streak is laid on. Each is the median [r, g, b] and L* / C* / hue of the surface in the view; `wind` is the served
 * speed under it (median and quartiles, kn).
 * --fixture <file>: the wind to draw instead of the hurricane (ramp-fixture.js: one speed a column, over land and over sea).
 * --strips n: cut the picture into n column bands and read the land against the sea INSIDE each: on a ramp that is the map's own step
 * with the wind's colour held equal. The `equal wind` line gives it as L* and as the share of the own map's land-sea contrast
 * (Michelson, on luminance) still there under the wind: the measure of a layer one sees through (Singh and Anderson 2002). Dark is the bar.
 * --full N: also the picture WITH the streaks, the mean of N frames at 60 Hz in linear light; `adds` is its L* over the field alone.
 * --arms '{"name":{levers}}' (or --arms-file): one row set an arm; a lever is a window.__RAW_...__ name, as in motion-run.js.
 * --crop WxH[:jpeg] (--at fx,fy): device-resolution crops of own | muted | field | full an arm, in out/<tag>-crops (--tag).
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
  const out = path.join(__dirname, 'out'), ref = flag('--ref'), tag = flag('--tag', 'ground').replace(/[^a-z0-9-]/gi, ''), scale = Number(flag('--scale', 1)), dpr = Number(flag('--dpr', 1.5));
  const fixture = flag('--fixture') ? path.resolve(flag('--fixture')) : path.join(__dirname, 'fixtures', 'eye-2026-10-09-gfs-native.json');
  const arms = Object.entries(flag('--arms-file') ? JSON.parse(fs.readFileSync(flag('--arms-file'), 'utf8')) : JSON.parse(flag('--arms', '{"now":{}}')));
  const nStrips = Number(flag('--strips', 0)), nFull = Number(flag('--full', 0)), at = flag('--at') ? flag('--at').split(',').map(Number) : null;
  const crop = flag('--crop') ? (() => { const [size, fmt] = flag('--crop').split(':'); return [...size.split('x').map(Number), fmt === 'jpeg' ? 'jpeg' : 'png']; })() : null;
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
    const fine = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    await page.evaluate((fx) => window.__MAP_BENCH__.init(fx), { fine, scale, offline: false, pixelRatio: dpr });
    console.log(`engine: ${source.label} · view ${lng},${lat} · map pixel ratio ${dpr} · wind x${scale} · ${path.basename(fixture)} · arms ${arms.map((a) => a[0]).join(', ')}\n`);
    console.log(`theme  z  arm        surface | own  [r, g, b]        L*    C*    h | muted [r, g, b]       L*    C*    h | under the field       L*    C*    h |${nFull ? ' streaks L*  adds |' : ''} wind kn med [q25, q75] | mute`);
    const Lof = (Y) => (Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y), mich = (a, b) => (a - b) / (a + b);
    const sg = (x, d = 1) => (x == null || !Number.isFinite(x) ? '-' : `${x >= 0 ? '+' : ''}${x.toFixed(d)}`), fin = (v) => v.filter((x) => x != null && Number.isFinite(x));
    const medOf = (v) => { const q = fin(v).sort((a, b) => a - b); return q.length ? q[q.length >> 1] : null; };
    const c = (s) => (s ? `${`[${s.rgb.join(', ')}]`.padEnd(17)} ${String(s.L).padStart(5)} ${String(s.C).padStart(5)} ${String(s.h).padStart(4)}` : '-'.padEnd(34));
    for (const theme of themes) {
      let areas = null;
      for (const z of zooms) {
        for (const [arm, levers] of arms) {
          const r = await page.evaluate((cfg) => window.__MAP_BENCH__.groundRun(cfg), { theme, z, lng, lat, frames: 120, seed: 1, levers, full: nFull, strips: nStrips, crop, cropAt: at });
          r.arm = arm;
          if (r.crops) {
            const dir = path.join(out, `${tag}-crops`);
            fs.mkdirSync(dir, { recursive: true });
            for (const [kind, url] of Object.entries(r.crops)) if (url) fs.writeFileSync(path.join(dir, `${theme}-z${z}-${arm}-${kind}.${crop[2] === 'jpeg' ? 'jpg' : 'png'}`), Buffer.from(url.split(',')[1], 'base64'));
            delete r.crops;
          }
          rows.push(r);
          areas = areas || r;
          for (const k of ['land', 'sea']) {
            const s = r[k], w = r.wind[k];
            console.log(`${theme.padEnd(6)} ${String(z).padEnd(2)} ${arm.padEnd(10)} ${k.padEnd(7)} | ${c(s.own)} | ${c(s.muted)} | ${c(s.field)} |${nFull ? ` ${(s.full ? String(s.full.L) : '-').padStart(10)} ${(s.full && s.field ? sg(s.full.L - s.field.L) : '-').padStart(5)} |` : ''} ${w ? `${String(w.med).padStart(5)} [${w.q25}, ${w.q75}]`.padEnd(22) : '-'.padEnd(22)} | ${r.mute.layers} layers${r.mute.amount > 0 ? ` at ${r.mute.amount}, water x${r.mute.waterL}, land x${r.mute.landL}` : ' (off)'}`);
          }
          // HOW MUCH OF THE MAP COMES THROUGH: the land against the sea on the own map, as restyled, under the field, under the streaks.
          const step = (kind) => (r.land[kind] && r.sea[kind] ? r.land[kind].L - r.sea[kind].L : null);
          r.through = { own: step('own'), muted: step('muted'), field: step('field'), full: step('full') };
          console.log(`       whole view | land - sea, L*: own ${sg(r.through.own)} · restyled ${sg(r.through.muted)} · under the field ${sg(r.through.field)}${nFull ? ` · with the streaks ${sg(r.through.full)}` : ''}   (the wind differs over the two unless the fixture is a ramp)`);
          if (r.strips) {
            const S = r.strips, per = (kind) => S[kind].map(([l, w]) => (l != null && w != null ? { dL: Lof(l) - Lof(w), m: mich(l, w) } : null));
            const own = per('own'), used = own.map((o, i) => (o && Math.abs(o.m) > 0.01 ? i : -1)).filter((i) => i >= 0);
            r.bands = { used: used.length, speeds: used.map((i) => (S.speed ? S.speed[i] : null)), own: medOf(used.map((i) => own[i].dL)) };
            const cells = [];
            for (const [kind, name] of [['muted', 'restyled'], ['field', 'under the field'], ...(S.full ? [['full', 'with the streaks']] : [])]) {
              const q = per(kind), d = fin(used.map((i) => (q[i] ? q[i].dL : null)));
              r.bands[kind] = { dL: medOf(d), min: d.length ? Math.min(...d) : null, max: d.length ? Math.max(...d) : null, kept: medOf(used.map((i) => (q[i] ? q[i].m / own[i].m : null))) };
              cells.push(`${name} ${sg(r.bands[kind].dL)} [${sg(r.bands[kind].min)}, ${sg(r.bands[kind].max)}] kept ${r.bands[kind].kept == null ? '-' : r.bands[kind].kept.toFixed(2)}`);
            }
            const sp = fin(r.bands.speeds);
            console.log(`       equal wind | ${used.length} of ${S.n} bands${sp.length ? `, ${Math.min(...sp)} to ${Math.max(...sp)} kn` : ''}: own ${sg(r.bands.own)} · ${cells.join(' · ')}   (L* median [least, most]; kept = share of the own map's land-sea contrast)`);
          }
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
