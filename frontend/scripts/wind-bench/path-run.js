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
 *   node scripts/wind-bench/path-run.js --bare                            # the basemap alone, without the app's own layers
 *   node scripts/wind-bench/path-run.js --mute-check                      # the mute alone: round trip, then satellite on / off
 *   node scripts/wind-bench/path-run.js --flow                            # do the streaks run along the wind while the camera moves?
 *   node scripts/wind-bench/path-run.js --flow --hash-all --json a.json   # hash the trail buffer at EVERY sample (to compare two engines exactly)
 *
 * Needs REACT_APP_MAPBOX_TOKEN like map-run.js (environment or frontend/.env; passed to the page in memory, never written
 * or printed). Tiles come from Mapbox; the wind comes from the served-grid fixture, so the backend is never called.
 * The map carries THE APP'S STACK around the basemap (its hidden satellite and weather-wash layers under the wind, a
 * radar frame above it: page/map-entry.js addAppStack), because a rule that reads the style must meet the app's style.
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
 *
 * With --flow (flow.js; arms default to `anchored` and `screen`, the trail anchor's kill switch): the share of the wind's
 * ink that varies ACROSS the served wind direction (1 = every streak runs along the wind, 0.5 = no direction), medians
 * over the samples taken at rest, while the camera moves (p10 in brackets) and in the second after it stops. Gated
 * (FLOW_GATE; exit 1): on `pan` the `screen` arm must fall while moving (the positive control: a trail buffer left on
 * the screen smears along the camera's motion) and `anchored` must hold its rest reading; before the camera first moves
 * both arms must lay the SAME ink, trail buffer for trail buffer (the null control: a still camera is the identity);
 * while moving, `anchored` must beat `screen` on every path (no worse on `jitter`).
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');
const { PATH_NAMES, FLOW_PATH_NAMES, pathFrames, sampleIndexes } = require('./paths');
const { pops } = require('./ambiguity');
const { motionOf } = require('./flow');

const FLOW_ARMS = { anchored: {}, screen: { __RAW_DISABLE_WIND_TRAIL_ANCHOR__: true } };

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
    else if (a === '--paths') { opts.paths = val().split(','); opts.pathsGiven = true; }
    else if (a === '--seeds') opts.seeds = val().split(',').map(Number);
    else if (a === '--every') { opts.every = Number(val()); opts.everyGiven = true; }
    else if (a === '--res') opts.res = Number(val());
    else if (a === '--scale') opts.scale = Number(val());
    else if (a === '--tag') opts.tag = val().replace(/[^a-z0-9-]/gi, '');
    else if (a === '--arms') { opts.arms = JSON.parse(val()); opts.armsGiven = true; }
    else if (a === '--sheet') opts.sheet = path.resolve(val());
    else if (a === '--field') opts.field = true;
    else if (a === '--flow') opts.flow = true;
    else if (a === '--hash-all') opts.hashAll = true;
    else if (a === '--bare') opts.bare = true;
    else if (a === '--mute-check') opts.muteCheck = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (opts.flow) { if (!opts.armsGiven) opts.arms = FLOW_ARMS; if (!opts.everyGiven) opts.every = 3; if (!opts.pathsGiven) opts.paths = PATH_NAMES.concat(FLOW_PATH_NAMES); }
  const known = opts.flow ? PATH_NAMES.concat(FLOW_PATH_NAMES) : PATH_NAMES;
  for (const p of opts.paths) if (!known.includes(p)) throw new Error(`unknown path ${p} (${known.join(', ')}${opts.flow ? '' : `; ${FLOW_PATH_NAMES.join(', ')} with --flow`})`);
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

/** One flow run: the share of ink across the wind at rest, while the camera moves, and in the second after it stops. */
function summarizeFlow(rows, kinds) {
  const of = (kind) => rows.filter((r, n) => kinds[n] === kind && r.flow != null).map((r) => r.flow);
  return { rest: q(of('rest'), 0.5), move: q(of('move'), 0.5), move10: q(of('move'), 0.1), settle: q(of('settle'), 0.5), nRest: of('rest').length, nMove: of('move').length,
    blocks: q(rows.map((r) => r.blocks), 0.5), miss: rows.filter((r) => !r.tiles).length };
}

// The gates, set at about a third of what the first full run measured (2026-10-10; README "Flow mode"):
//   smear    the screen arm must fall at least this far below its own rest reading on `pan` (the positive control);
//   gain     the anchored arm must beat the screen arm by this much while moving, on every path but `jitter`;
//   jitter   a 2 Hz zoom across 2.2 levels re-lays the ink every other frame: there the anchored arm must be no worse;
//   hold     on `pan` (one zoom, so the rest reading is the right yardstick) the anchored arm must stay within this of it.
// A zoom path's rest reading is taken at its first zoom only and the reading changes with zoom, so nothing is gated on it.
const FLOW_GATE = { smear: 0.08, gain: 0.05, jitter: -0.01, hold: 0.05 };

/** The checks on one (theme, path, seed) with both arms. `same` / `still`: trail buffers identical before the camera first moves. */
function flowVerdict(pathName, anchored, screen, same, still, gate = FLOW_GATE) {
  const num = (x) => typeof x === 'number';
  const out = { null0: still > 0 && same === still };
  out.better = num(anchored.move) && num(screen.move) && anchored.move >= screen.move + (pathName === 'jitter' ? gate.jitter : gate.gain);
  if (pathName === 'pan') {
    out.seen = num(screen.move) && num(screen.rest) && screen.move <= screen.rest - gate.smear;
    out.held = num(anchored.move) && num(anchored.rest) && anchored.move >= anchored.rest - gate.hold;
  }
  return out;
}

async function flowMode(page, opts, label) {
  const runs = [];
  console.log('\ntheme  path     arm       seed |  rest   move (p10)  settle | blocks miss | what the trail buffer did');
  for (const theme of opts.themes) {
    for (const name of opts.paths) {
      for (const seed of (name === 'erratic' ? opts.seeds : [opts.seeds[0]])) {
        const frames = pathFrames(name, seed), samples = sampleIndexes(frames.length, opts.every), kinds = motionOf(frames, samples);
        for (const [arm, levers] of Object.entries(opts.arms)) {
          const t0 = Date.now();
          const res = await page.evaluate((c) => window.__MAP_BENCH__.flowRun(c), { theme, frames, samples, res: opts.res, seed, levers, warm: 120, shots: true, hashBefore: opts.hashAll ? frames.length : motionOf(frames, frames.map((_, i) => i)).indexOf('move') });
          if (res.glError) throw new Error(`GL error ${res.glError} at ${theme} ${name} ${arm}`);
          const sum = summarizeFlow(res.rows, kinds), modes = res.anchor ? Object.entries(res.anchor.modes).map(([k, v]) => `${k} ${v}`).join(', ') : 'no read-back (an engine without the anchor)';
          console.log(`${theme.padEnd(6)} ${name.padEnd(8)} ${arm.padEnd(9)} ${String(seed).padStart(4)} | ${f3(sum.rest)}  ${f3(sum.move)} (${f3(sum.move10)})  ${f3(sum.settle)} | ${String(sum.blocks).padStart(6)} ${String(sum.miss).padStart(4)} | ${modes}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
          runs.push({ theme, path: name, arm, seed, sum, kinds, rows: res.rows, anchor: res.anchor });
        }
      }
    }
  }
  const bad = [];
  let seenAny = false, pairs = 0, same0 = 0, before0 = 0;
  for (const a of runs.filter((r) => r.arm === 'anchored')) {
    const s = runs.find((r) => r.arm === 'screen' && r.theme === a.theme && r.path === a.path && r.seed === a.seed);
    if (!s) continue;
    pairs++;
    const where = `${a.theme} ${a.path}${a.path === 'erratic' ? ' ' + a.seed : ''}`;
    const firstMove = a.kinds.indexOf('move');
    const before = a.rows.map((r, n) => n).filter((n) => (firstMove < 0 || n < firstMove) && a.rows[n].hash != null && s.rows[n].hash != null);
    const same = before.filter((n) => a.rows[n].hash === s.rows[n].hash).length;
    same0 += same; before0 += before.length;
    const v = flowVerdict(a.path, a.sum, s.sum, same, before.length);
    if (v.seen) seenAny = true;
    if (!v.null0) bad.push(`${where}: before the camera moves the two arms laid different ink on ${before.length - same} of ${before.length} samples (a still camera must be the identity)`);
    if (!v.better) bad.push(`${where}: anchored ${f3(a.sum.move)} against screen ${f3(s.sum.move)} while moving`);
    if (v.seen === false) bad.push(`${where}: the screen arm did not fall while panning (${f3(s.sum.move)} vs ${f3(s.sum.rest)} at rest): the instrument did not see the smear`);
    if (v.held === false) bad.push(`${where}: the anchored trails lost their direction on a steady pan (${f3(a.sum.move)} vs ${f3(a.sum.rest)} at rest)`);
  }
  if (pairs && !seenAny && runs.some((r) => r.path === 'pan')) bad.push('no pan showed the smear on the screen arm (positive control)');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = runs.map((run) => `<h2>${esc(`${run.theme} · ${run.path} · ${run.arm} · seed ${run.seed}`)} — along the wind: at rest ${f3(run.sum.rest)}, moving ${f3(run.sum.move)}</h2><div class="row">`
    + run.rows.map((r, n) => `<figure><img alt="${esc(`${run.theme} ${run.path} ${run.arm} frame ${r.i}`)}" src="${r.shot}"><figcaption>f${r.i} z${r.z.toFixed(1)} · ${run.kinds[n]} · ${f3(r.flow)}</figcaption></figure>`).join('') + '</div>').join('\n');
  const sheetPath = opts.sheet || path.join(opts.out, `${opts.tag}-flow-sheet.html`);
  fs.writeFileSync(sheetPath, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Wind flow bench</title><style>
body{margin:0;background:#111317;color:#dde1e6;font:12px/1.4 system-ui,sans-serif}h1{font-size:15px;margin:12px 16px}h2{font-size:13px;margin:14px 16px 4px}
.row{display:flex;flex-wrap:wrap;gap:4px;margin:0 16px}figure{margin:0}figure img{width:200px;display:block}figcaption{font-size:10px}</style></head><body>
<h1>${esc(`Wind flow bench · ${label} · share of the wind's ink across the served wind direction`)}</h1>${body}</body></html>`);
  console.log(`\ncontact sheet: ${sheetPath}`);
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ engine: label, arms: opts.arms, gate: FLOW_GATE, runs: runs.map((r) => ({ ...r, rows: r.rows.map(({ shot, ...x }) => x) })) }, null, 1));
  console.log(bad.length ? `\nFLOW CHECK FAILED:\n  ${bad.join('\n  ')}` : pairs ? `\nflow check passed on ${pairs} run pair(s): before the camera moves both arms laid the same ink (${same0} of ${before0} trail buffers identical); while it moves the anchored trails keep the wind's direction better than the screen's` : '\n(no anchored/screen pair: nothing gated)');
  return bad.length ? 1 : 0;
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
    await page.evaluate((fx) => window.__MAP_BENCH__.init({ fine: fx.fine, scale: fx.scale, bare: fx.bare }), { fine, scale: opts.scale, bare: !!opts.bare });
    if (opts.muteCheck) {
      // The basemap mute on the real map, no path: mute + restore must give the map back, and a satellite photo shown
      // under the wind must stand the mute down and bring it back when hidden (windBasemapMuteStale, the layer's probe).
      const cam = { lng: -88.05, lat: 30.45, z: 8 }, f = (x) => (x == null ? 'n/a' : typeof x === 'number' ? x.toFixed(3) : String(x));
      const muted = (m) => !!m.applied && m.layers > 0;
      const rb = (m) => (m.applied ? `muted ${m.layers}` : `not muted${m.reason ? ` (${m.reason})` : ''}${m.error ? ` (error: ${m.error})` : ''}`);
      let bad = 0;
      for (const theme of opts.themes) {
        const rt = await page.evaluate((c) => window.__MAP_BENCH__.muteRoundTrip(c), { theme, ...cam });
        console.log(`${theme.padEnd(6)} round trip: ${rb(rt.mute)}; muted map differs on ${(100 * rt.mutedMoved).toFixed(1)}% of pixels; after restore mean dE00 ${f(rt.mean)}, max ${f(rt.max)}`);
        if (opts.bare) continue;
        const im = await page.evaluate((c) => window.__MAP_BENCH__.muteImagery(c), { theme, ...cam });
        console.log(`${''.padEnd(6)} satellite:  wind on ${rb(im.on)} (stale before ${f(im.staleOff)}, after ${f(im.staleOn)}) -> photo shown: stale ${f(im.staleShown)}, ${rb(im.shown)}, max dE00 to the original map ${f(im.shownMaxDE)} -> hidden: stale ${f(im.staleHidden)}, ${rb(im.hidden)}`);
        const expectMute = theme !== 'dark';
        if (rt.max > 1 || muted(rt.mute) !== expectMute || muted(im.on) !== expectMute || muted(im.hidden) !== expectMute || im.shown.applied || im.shownMaxDE > 1 || (expectMute && !(im.staleOff && !im.staleOn && im.staleShown && im.staleHidden))) bad++;
      }
      console.log(bad ? `\nMUTE CHECK FAILED on ${bad} theme(s)` : '\nmute check passed');
      return bad ? 1 : 0;
    }
    if (opts.flow) return await flowMode(page, opts, `${source.label} · Gulf coast · served GFS 2026-10-09 15Z`);
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
            console.log(`${theme.padEnd(6)} ${name.padEnd(8)} ${arm.padEnd(8)} ${String(seed).padStart(4)} | ${line(sum, opts.field)} | ${sum.convSwaps.join(' · ')}  [${((Date.now() - t0) / 1000).toFixed(0)} s${res.mute && res.mute.applied ? `, muted ${res.mute.layers} layers` : ''}${res.mute && res.mute.reason ? `, NOT muted (${res.mute.reason})` : ''}]`);
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

module.exports = { summarize, summarizeFlow, flowVerdict, FLOW_GATE };
