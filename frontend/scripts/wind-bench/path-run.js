#!/usr/bin/env node
/**
 * Wind bench, PATH mode: the owner's REAL basemaps under the REAL engine while the camera pans, flings, zooms, pinches,
 * jitters across the close-zoom ramp and wanders erratically (paths.js). Answers "on screen, is this colour wind or map?"
 * per theme, path and lever set, frame by frame (ambiguity.js), and whether the wind flashes or drops out in motion.
 *
 *   node scripts/wind-bench/path-run.js                                   # light + beach + dark, every path
 *   node scripts/wind-bench/path-run.js --themes beach --paths erratic --seeds 1,2,3
 *   node scripts/wind-bench/path-run.js --arms '{"now":{},"mute":{"__RAW_WIND_BASEMAP_MUTE__":0.8}}'
 *   node scripts/wind-bench/path-run.js --ref origin/dev --json out/path-dev.json
 *   node scripts/wind-bench/path-run.js --field --paths erratic,jitter    # the colour field alone: does it stay glued?
 *
 * Needs REACT_APP_MAPBOX_TOKEN like map-run.js (environment or frontend/.env; passed to the page in memory, never written
 * or printed). Tiles come from Mapbox; the wind comes from the served-grid fixture, so the backend is never called.
 *
 * Columns per (theme, path, arm), medians over the samples (p90 in brackets where the tail matters):
 *   conv      wind-touched pixels that now wear another class of the STYLE's own area colours (water, park, wood, sand:
 *             the map's convention), scored against the original colours (lower is better; the owner's "ambiguity");
 *   mapLike   the same against the colours on screen in that frame (lower is better);
 *   windLike  map area in wind colours (lower is better);
 *   hue30     wind-coloured pixels whose hue sits > 30 deg off the legend colour for the true speed there (the map's
 *             hue bending the wind's into another band's colour; lower is better);
 *   coastDE   dE00 between water and land just across each coastline under the wind (higher reads clearer);
 *   keptMap   the original map's colour edges kept in the map as shown (1 unless the basemap is muted);
 *   keptComp  the original map's colour edges kept under the wind;
 *   retL/retW the original map's L* line contrast kept under the wind, land / water (map-run's retain);
 *   cover     pixels the wind visibly changes (it must stay visible); pops = flash/drop-out samples; miss = samples
 *             taken before every tile had loaded (scored anyway: the owner sees them too).
 * With --field (the colour field alone, 2x2 particles): warpW / warpM = mean dE00 between each sample and the previous one
 * warped by the exact camera change, wind on / map alone (p99 and share > 5 dE00 in the JSON). warpW - warpM is the
 * wind's own swimming, popping or drop-out in motion.
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');
const { PATH_NAMES, pathFrames, sampleIndexes } = require('./paths');
const { pops } = require('./ambiguity');

function readToken() {
  if (process.env.REACT_APP_MAPBOX_TOKEN) return process.env.REACT_APP_MAPBOX_TOKEN;
  const env = path.join(FRONTEND, '.env');
  if (!fs.existsSync(env)) return '';
  const line = fs.readFileSync(env, 'utf8').split(/\r?\n/).find((l) => l.startsWith('REACT_APP_MAPBOX_TOKEN='));
  return line ? line.slice('REACT_APP_MAPBOX_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : '';
}

function parseArgs(argv) {
  const opts = { gl: 'gpu', out: path.join(__dirname, 'out'), themes: ['light', 'beach', 'dark'], paths: PATH_NAMES, seeds: [1], every: 6, res: 384, scale: 1, tag: 'path', arms: { now: {} }, field: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => argv[++i];
    if (a === '--ref') opts.ref = val();
    else if (a === '--json') opts.json = path.resolve(val());
    else if (a === '--gl') opts.gl = val();
    else if (a === '--headed') opts.headed = true;
    else if (a === '--themes') opts.themes = val().split(',');
    else if (a === '--paths') opts.paths = val().split(',');
    else if (a === '--seeds') opts.seeds = val().split(',').map(Number);
    else if (a === '--every') opts.every = Number(val());
    else if (a === '--res') opts.res = Number(val());
    else if (a === '--scale') opts.scale = Number(val());
    else if (a === '--tag') opts.tag = val().replace(/[^a-z0-9-]/gi, '');
    else if (a === '--arms') opts.arms = JSON.parse(val());
    else if (a === '--sheet') opts.sheet = path.resolve(val());
    else if (a === '--field') opts.field = true;
    else throw new Error(`unknown option ${a}`);
  }
  for (const p of opts.paths) if (!PATH_NAMES.includes(p)) throw new Error(`unknown path ${p} (${PATH_NAMES.join(', ')})`);
  return opts;
}

const q = (xs, p) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null; };
const f3 = (x) => (x == null ? '  -  ' : x.toFixed(3));

/** One (theme, path, arm, seed) run's summary over its samples. */
function summarize(rows) {
  const col = (k) => rows.map((r) => r[k]);
  const swaps = new Map();
  for (const r of rows) for (const p of r.pairs) swaps.set(p.swap, (swaps.get(p.swap) || 0) + p.share / rows.length);
  const warp = (k) => rows.map((r) => (r.warp ? r.warp[k] : null));
  const convSwaps = new Map();
  for (const r of rows) for (const p of r.convPairs || []) convSwaps.set(p.swap, (convSwaps.get(p.swap) || 0) + p.share / rows.length);
  return {
    n: rows.length, hue30: q(col('hue30'), 0.5), hue30p90: q(col('hue30'), 0.9), hueMed: q(col('hueMed'), 0.5), conv: q(col('mapLikeConv'), 0.5), conv90: q(col('mapLikeConv'), 0.9), coastDE: q(col('coastDE'), 0.5), coastDE0: q(col('coastDE0'), 0.5), coastKept: q(col('coastKept'), 0.5),
    warpW: q(warp('comp'), 0.5), warpW90: q(warp('comp'), 0.9), warpM: q(warp('off'), 0.5), warpM90: q(warp('off'), 0.9), warpW5: q(warp('comp5'), 0.9),
    convSwaps: [...convSwaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${(100 * v).toFixed(1)}%`),
    mapLike: q(col('mapLike'), 0.5), mapLike90: q(col('mapLike'), 0.9), windLike: q(col('windLike'), 0.5),
    keptMap: q(col('keptMap'), 0.5), keptComp: q(col('keptComp'), 0.5), keptComp10: q(col('keptComp'), 0.1),
    retLand: q(col('retLand'), 0.5), retWater: q(col('retWater'), 0.5), cover: q(col('cover'), 0.5), cover10: q(col('cover'), 0.1),
    pops: pops(col('ink')).length, miss: rows.filter((r) => !r.tiles).length,
    swaps: [...swaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${(100 * v).toFixed(1)}%`),
  };
}

function line(s, field) {
  const f2 = (x) => (x == null ? '  -  ' : x.toFixed(2).padStart(5));
  const head = `${f3(s.hue30)} (${f3(s.hue30p90)}) ${f3(s.conv)} ${f3(s.mapLike)} ${f3(s.windLike)} ${f2(s.coastDE)}/${f2(s.coastDE0)} ${f3(s.keptMap)} ${f3(s.keptComp)} ${f3(s.retLand)} ${f3(s.retWater)} ${f3(s.cover)} ${String(s.pops).padStart(4)} ${String(s.miss).padStart(4)}`;
  return field ? `${head} | ${f2(s.warpW)} (${f2(s.warpW90)}) ${f2(s.warpM)} (${f2(s.warpM90)})` : head;
}

function sheet(runs, label) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = runs.map((run) => `<h2>${esc(`${run.theme} · ${run.path} · ${run.arm} · seed ${run.seed}`)} — hue off the legend ${f3(run.sum.hue30)}, convention swaps ${f3(run.sum.conv)}, coast dE ${f3(run.sum.coastDE)}, colour edges kept ${f3(run.sum.keptComp)}</h2><div class="row">`
    + run.rows.map((r) => `<figure><img alt="${esc(`${run.theme} ${run.path} frame ${r.i}`)}" src="${r.shot}"><figcaption>f${r.i} z${r.z.toFixed(1)} · hue30 ${f3(r.hue30)} · coast ${f3(r.coastDE)}${r.tiles ? '' : ' · tiles loading'}</figcaption></figure>`).join('') + '</div>').join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Wind path bench</title><style>
body{margin:0;background:#111317;color:#dde1e6;font:12px/1.4 system-ui,sans-serif}h1{font-size:15px;margin:12px 16px}h2{font-size:13px;margin:14px 16px 4px}
.row{display:flex;flex-wrap:wrap;gap:4px;margin:0 16px}figure{margin:0}figure img{width:200px;display:block}figcaption{font-size:10px}</style></head><body>
<h1>${esc(label)}</h1>${body}</body></html>`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = readToken();
  if (!token) throw new Error('REACT_APP_MAPBOX_TOKEN not found (environment or frontend/.env)');
  const source = engineSource(opts.ref, path.join(opts.out, 'cache'));
  const built = await buildBench({ srcRoot: source.srcRoot, outDir: path.join(opts.out, opts.tag), page: 'map' });
  console.log(`engine: ${source.label} · bundle ${(built.bytes / 1024).toFixed(0)} KiB · arms ${Object.keys(opts.arms).join(', ')} · paths ${opts.paths.join(', ')} · seeds ${opts.seeds.join(',')}`);
  const server = await serveDir(opts.out);
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: !opts.headed, args: gpuArgs(opts.gl) });
  const runs = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
    await page.addInitScript((t) => { window.__MAPBOX_TOKEN__ = t; }, token);
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${opts.tag}/map.html`);
    await page.waitForFunction(() => window.__MAP_BENCH__ && window.__MAP_BENCH__.ready && window.__MAP_BENCH__.pathRun);
    const fine = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'eye-2026-10-09-gfs-native.json'), 'utf8'));
    await page.evaluate((fx) => window.__MAP_BENCH__.init({ fine: fx.fine, scale: fx.scale }), { fine, scale: opts.scale });
    console.log(`\ntheme  path     arm      seed | hue30 (p90)    conv   mapLk  windLk coast/bare    keptMp keptCm retL  retW  cover  pops miss${opts.field ? ' | warpW (p90)   warpM (p90)' : ''} | commonest convention swaps`);
    for (const theme of opts.themes) {
      for (const name of opts.paths) {
        for (const seed of (name === 'erratic' ? opts.seeds : [opts.seeds[0]])) {
          const frames = pathFrames(name, seed), samples = sampleIndexes(frames.length, opts.every);
          for (const [arm, levers] of Object.entries(opts.arms)) {
            const t0 = Date.now();
            const res = await page.evaluate((c) => window.__MAP_BENCH__.pathRun(c), { theme, frames, samples, res: opts.res, seed, levers, warm: 120, shots: true, fieldOnly: opts.field });
            if (res.glError) throw new Error(`GL error ${res.glError} at ${theme} ${name} ${arm}`);
            const sum = summarize(res.rows);
            console.log(`${theme.padEnd(6)} ${name.padEnd(8)} ${arm.padEnd(8)} ${String(seed).padStart(4)} | ${line(sum, opts.field)} | ${sum.convSwaps.join(' · ')}  [${((Date.now() - t0) / 1000).toFixed(0)} s${res.mute && res.mute.applied ? `, muted ${res.mute.layers} layers` : ''}]`);
            runs.push({ theme, path: name, arm, seed, mute: res.mute, sum, rows: res.rows });
          }
        }
      }
    }
    const sheetPath = opts.sheet || path.join(opts.out, `${opts.tag}-sheet.html`);
    fs.writeFileSync(sheetPath, sheet(runs, `Wind path bench · ${source.label} · Gulf coast · served GFS 2026-10-09 15Z`));
    console.log(`\ncontact sheet: ${sheetPath}`);
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ engine: source.label, arms: opts.arms, runs: runs.map((r) => ({ ...r, rows: r.rows.map(({ shot, ...x }) => x) })) }, null, 1));
    return 0;
  } finally {
    await browser.close();
    server.close();
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 2; });

module.exports = { summarize };
