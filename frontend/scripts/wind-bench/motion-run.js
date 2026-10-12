#!/usr/bin/env node
/**
 * Wind bench, MOTION mode: watch the wind MOVE. The real engine on the real basemaps, a still camera, every 60 Hz frame kept.
 *
 *   node scripts/wind-bench/motion-run.js --runs runs.json --out out/motion.json [--ref origin/dev] [--dpr 1.5] [--width 1000]
 *   node scripts/wind-bench/motion-run.js --runs runs.json --dpr 1.5 --map-dpr 1.5 --crop 720x480 --at 0.5,0.3   # thin lines, pixel for pixel
 *
 * runs.json: [{ name, theme, z, scale?, levers?, frames?, lng?, lat?, behind?, res? }] (res: the particle pool's side, 384; 2 draws the colour field ALONE). Frames go to out/motion/<name>/fNNN.jpg; a run already in
 * --out is skipped. compose-video.js plays several runs side by side as one WebM, and mirror-run.js reads the same frames.
 * --dpr: the device pixel ratio the page renders at (the owner's laptop is 1.5; the other bench modes run at 1).
 * --fixture <file>: the wind to draw instead of the hurricane (`node scripts/wind-bench/ramp-fixture.js out.json` writes a speed ramp:
 * every speed in one frame over land and sea, LESSONS L-V61). The result's `fixture` field names it.
 * --map-dpr: the MAP's own device pixels a CSS pixel (default: the bench's 2). With it the frames are drawn and kept but the
 * along-the-wind score is not taken (it is built for 2). --crop WxH (device px) keeps a crop of each frame at device resolution
 * instead of the whole canvas scaled to --width, centred at --at fx,fy of the canvas: a 0.5 px border line keeps its pixels
 * (border mode's clips, 2026-10-12).
 * Needs REACT_APP_MAPBOX_TOKEN (the app's public token) in the environment or in frontend/.env; it is passed to the page in memory,
 * never written to disk or printed. Tiles come from Mapbox; nothing asks the Raw Surf backend.
 * --crop-fmt png: the crops lossless (default jpeg).
 * --behind <css colour>: the page behind the map (a run's own `behind` wins). Default: the app's own page for the theme (near white
 * in light, black in dark and beach; page/map-entry.js APP_PAGE). The map's canvas is premultiplied, so a pass that leaves its alpha
 * under 1 shows that page; each run prints the canvas's alpha, and 1 means the page cannot matter (D-027, LESSONS L-V72).
 * --at with SEVERAL centres ("0.14,0.85;0.47,0.85;0.86,0.2", needs --crop): every centre is cropped from the SAME frames, so the same
 * particles are read at each place; each crop is a run of its own, named `<name>@<fx>_<fy>`, for every reader of out/motion/.
 * --trail (needs --crop): beside each frame's crop, the same crop of the engine's own trail buffer (tNNN.png): the ink before it met
 * the map. truth-run.js --law fits the composite's law from the two.
 * A run's `force`: uniforms held at a value for that run ({ "screen.u_glow@map": 0 }; force-uniforms.js): one variable at a time on
 * the real engine. The result keeps it, and how often each fired.
 * First written as a scratch instrument on 2026-10-11 (log 2026-10-11-wind-pale-band, "Dark watched in motion"); committed with D-022.
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND, engineSource, buildBench } = require('./build');
const { serveDir, gpuArgs } = require('./serve');
const { pageOf } = require('./page-colour');
const { partsOf, partOf, sameRun } = require('./crops');
const BENCH = __dirname;
const VIEW = { lng: -88.05, lat: 30.45 };
const flag = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(flag('--out', path.join(BENCH, 'out', 'motion.json'))), REF = flag('--ref', 'tree'), RUNS_FILE = flag('--runs'), DPR = Number(flag('--dpr', 1)), WIDTH = Number(flag('--width', 1000));
const FIXTURE = flag('--fixture') ? path.resolve(flag('--fixture')) : path.join(BENCH, 'fixtures', 'eye-2026-10-09-gfs-native.json');   // --fixture: another wind (ramp-fixture.js writes a speed ramp)
const MAP_DPR = Number(flag('--map-dpr', 0)) || null, CROP = flag('--crop') ? [...flag('--crop').split('x').map(Number), flag('--crop-fmt', 'jpeg')] : null;
const ATS = flag('--at') ? flag('--at').split(';').map((a) => a.split(',').map(Number)) : null, AT = ATS && ATS.length === 1 ? ATS[0] : null, MANY = ATS && ATS.length > 1 ? ATS : null;
const BEHIND = flag('--behind') || null, TRAIL = process.argv.includes('--trail');
function readToken() {
  if (process.env.REACT_APP_MAPBOX_TOKEN) return process.env.REACT_APP_MAPBOX_TOKEN;
  const env = path.join(FRONTEND, '.env');
  if (!fs.existsSync(env)) return '';
  const line = fs.readFileSync(env, 'utf8').split(/\r?\n/).find((l) => l.startsWith('REACT_APP_MAPBOX_TOKEN='));
  return line ? line.slice('REACT_APP_MAPBOX_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : '';
}

(async () => {
  if (!RUNS_FILE) throw new Error('--runs <file.json> is required');
  if ((MANY || TRAIL) && !CROP) throw new Error('several --at centres and --trail need --crop WxH');
  const runs = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8'));
  const token = readToken();
  if (!token) throw new Error('REACT_APP_MAPBOX_TOKEN not in the environment or frontend/.env');
  const outDir = path.join(BENCH, 'out');
  const source = engineSource(REF === 'tree' ? undefined : REF, path.join(outDir, 'cache'));
  const tag = `motion-${REF.replace(/[^a-z0-9]/gi, '').slice(0, 10)}`;
  await buildBench({ srcRoot: source.srcRoot, outDir: path.join(outDir, tag), page: 'map' });
  const server = await serveDir(outDir, undefined, { land: 'app' });
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: true, args: gpuArgs('gpu') });
  const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const fine = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), FIXTURE_ID = `${fine.product_id || 'fixture'}:${path.basename(FIXTURE)}:${fine.provenance || ''}`;
  try {
    let page = null, scaleNow = null, sink = () => {};
    for (const run of runs) {
      const parts = partsOf(run.name, ATS), want = { fixture: FIXTURE_ID, page: pageOf(run.theme, run.behind || BEHIND), levers: run.levers, force: run.force, crop: CROP, trail: TRAIL };
      if (parts.every((q) => sameRun(results[q.name], want) && results[q.name].page === pageOf(run.theme, run.behind || BEHIND))) { console.log(run.name, 'cached'); continue; }   // a run of the same name on another wind, saved over another page, or under other levers or forced uniforms, is not this run (crops.js sameRun)
      const scale = run.scale || 1;
      if (!page || scale !== scaleNow) {   // the grid's strength is set at init: a page per strength
        if (page) await page.close();
        page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: DPR });
        await page.addInitScript((t) => { window.__MAPBOX_TOKEN__ = t; }, token);
        page.on('pageerror', (e) => console.error('page error:', e.message));
        await page.exposeFunction('__benchFrame', (f) => sink(f));   // each frame is written as it is taken: a run of lossless crops does not fit one reply
        await page.goto(`http://127.0.0.1:${server.address().port}/${tag}/map.html`);
        await page.waitForFunction(() => window.__MAP_BENCH__ && window.__MAP_BENCH__.ready);
        await page.evaluate((fx) => window.__MAP_BENCH__.init({ fine: fx.fine, scale: fx.scale, offline: false, pixelRatio: fx.mapDpr }), { fine, scale, mapDpr: MAP_DPR });
        scaleNow = scale;
      }
      const N = run.frames || 90, cam = { lng: run.lng == null ? VIEW.lng : run.lng, lat: run.lat == null ? VIEW.lat : run.lat, z: run.z };
      const t0 = Date.now();
      const dirs = parts.map((q) => path.join(outDir, 'motion', q.name));
      for (const dir of dirs) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }
      const bytes = (url) => Buffer.from(url.split(',')[1], 'base64'), nnn = (i) => String(i).padStart(3, '0');
      sink = (f) => dirs.forEach((dir, k) => {   // the frame's crop (still named .jpg, whatever --crop-fmt: every reader lists fNNN.jpg), and the trail buffer's
        fs.writeFileSync(path.join(dir, `f${nnn(f.i)}.jpg`), bytes(partOf(f.shot, k, !!MANY)));
        if (f.trail) fs.writeFileSync(path.join(dir, `t${nnn(f.i)}.png`), bytes(partOf(f.trail, k, !!MANY)));
      });
      const res = await page.evaluate((c) => window.__MAP_BENCH__.flowRun(c), { theme: run.theme, frames: Array.from({ length: N }, () => cam), samples: Array.from({ length: N }, (_, i) => i),
        res: run.res || 384, seed: 1, levers: run.levers || {}, warm: 180, shots: true, shotWidth: WIDTH, shotCrop: CROP, shotAt: AT, shotAts: MANY, trailShots: TRAIL, sink: '__benchFrame',
        force: run.force || null, page: run.behind || BEHIND });
      const idle = Object.entries(res.forced || {}).filter(([, n]) => !n).map(([k]) => k);
      if (idle.length) {   // its frames are the default's under this run's name: none is left for a reader of out/motion/ to take for the arm
        for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
        throw new Error(`${run.name}: a forced uniform never fired (${idle.join(', ')}): this run measured the default`);
      }
      const flows = res.rows.map((r) => r.flow).filter((v) => v != null), inks = res.rows.map((r) => r.ink);
      const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
      parts.forEach((q) => {
        results[q.name] = { ok: true, ...run, name: q.name, levers: run.levers || {}, force: run.force || null, frames: N, secs: Math.round((Date.now() - t0) / 1000), flow: med(flows), ink: med(inks), blocks: med(res.rows.map((r) => r.blocks)),
          dpr: DPR, mapDpr: MAP_DPR || 2, fixture: FIXTURE_ID, landMask: res.landMask, mute: res.mute, borderInk: res.ink || null, glError: res.glError, dir: `motion/${q.name}`,
          page: res.page, canvasAlpha: res.canvasAlpha };
        if (CROP) Object.assign(results[q.name], { crop: CROP, at: q.at || [0.5, 0.5], trail: TRAIL });
        if (res.forced) results[q.name].forced = res.forced;   // how often each forced uniform replaced a value
      });
      fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
      const first = results[parts[0].name];
      console.log(`${run.name.padEnd(28)} ${N} frames ${first.secs} s · along-the-wind ${first.flow} · ink ${first.ink} · mask ${JSON.stringify(res.landMask)}${res.glError ? ' GL ERROR ' + res.glError : ''}${MANY ? ` · ${parts.length} crops` : ''}${res.forced ? ' · forced ' + JSON.stringify(res.forced) : ''}`);
      console.log(`${''.padEnd(28)} behind the map ${res.page} · canvas alpha min ${res.canvasAlpha ? res.canvasAlpha.min : '-'} mean ${res.canvasAlpha ? res.canvasAlpha.mean : '-'} over ${res.canvasAlpha ? res.canvasAlpha.frames : 0} frames`);
    }
  } finally { await browser.close(); server.close(); }
  console.log('engine:', source.label);
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 2; });
