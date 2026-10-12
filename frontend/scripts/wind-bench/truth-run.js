#!/usr/bin/env node
/**
 * Wind bench, TRUTH mode: what the streaks do to the picture, against the TRUE ground (the same crop drawn with the field alone).
 *
 *   node scripts/wind-bench/truth-run.js [--json out.json] <label>=<run with streaks>:<run with the field alone> [...]
 *   node scripts/wind-bench/truth-run.js --law [--level 0.742] [--check 0.505,0.505] [--json out.json] <label>=<run with streaks>:<field alone> [...]
 *   node scripts/wind-bench/truth-run.js --diff <run a>:<run b> [...]      two runs frame for frame (CIE76): the null control's gauge
 *   node scripts/wind-bench/truth-run.js --same <run a>:<run b> [...]      the same, by the files' hashes
 *   node scripts/wind-bench/truth-run.js --clamp <run> [...]               the bare canvas's clamp in frames an OLD bench saved (L-V72)
 *
 * A run is a folder of motion-run.js frames (out/motion/<run>/fNNN.jpg). Take them LOSSLESS at device resolution, with the page and
 * the map at the owner's pixel ratio, and the field alone as a run with `"res": 2` taken right after its particle run on the same map:
 *
 *   [ { "name": "sea-dark", "theme": "dark", "z": 6 }, { "name": "sea-dark-field", "theme": "dark", "z": 6, "frames": 12, "res": 2 } ]
 *   node scripts/wind-bench/motion-run.js --runs runs.json --fixture ramp.json --dpr 1.5 --map-dpr 1.5 --crop 240x330 --crop-fmt png --at "0.47,0.85;0.47,0.2"
 *   node scripts/wind-bench/truth-run.js "sea-dark=sea-dark@0.47_0.85:sea-dark-field@0.47_0.85" "land-dark=sea-dark@0.47_0.2:sea-dark-field@0.47_0.2"
 *
 * Columns (truth.js `watch`; every one is against the field alone, in CIELAB L*; a pixel-instant is one pixel in one frame):
 *   field     the true ground's mean L* (and its chroma)
 *   added     the light the streaks add, the mean over every pixel-instant; taken = the light they take (where a pixel is under the field)
 *   over      share of pixel-instants 3 L* or more OVER the field: how much of the picture is lit at an instant
 *   under     share 1.5 L* or more UNDER it
 *   at field  share within 1.5 L* of it; back = share of PIXELS that came back to the field (or under it) at least once in the run
 *   darkest   a pixel's darkest moment against the field, median over pixels (and the deepest tenth): under 0 means the trails dip
 *             under the field between streaks, over 0 means they never come back to it
 *   core      a pixel's lightest moment against it, median (and the highest tenth): the height of a streak's core
 *   weber     (Y at the core - Y of the field) / Y of the field, over the pixels a streak reached: a line's contrast
 *   flicker   mean |change in L*| a pixel a frame
 *
 * --law reads each frame beside the engine's own trail buffer (motion-run.js --trail: tNNN.png) and fits the composite's law
 * (truth.js `lawFit`): screen - field = p x light - q x veil. Dark's branch of SCREEN_FS is p = q = its opacity; the glow branch
 * (light and beach under dark's rules) is q = 0. --level is the buffer level a streak's core is laid at (the veil is nothing at it).
 * --check p,q also prints the share of pixel-channels THAT law explains to within 1.5 levels: over land the map's own lines and names
 * are drawn above the wind and pull a fit, and this says how much of the crop they are.
 * Compare arms at the SAME run position (a theme's first run on a fresh map differs from its second), with a null control.
 * Scratch on 2026-10-12 (log 2026-10-12-wind-canvas-alpha, "After the independent review"); committed with the trails-linger finding.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FRONTEND } = require('./build');
const { serveDir } = require('./serve');
const BENCH = __dirname, OUT = path.join(BENCH, 'out');
const VALUE_FLAGS = ['--json', '--level', '--check'], MODES = ['--law', '--diff', '--same', '--clamp'];
const flag = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const MODE = MODES.find((m) => process.argv.includes(m)) || '--truth', JSON_OUT = flag('--json'), LEVEL = Number(flag('--level', 1)), CHECK = flag('--check') ? flag('--check').split(',').map(Number) : null;
const ARGS = process.argv.slice(2).filter((a, i, all) => !MODES.includes(a) && !VALUE_FLAGS.includes(a) && !VALUE_FLAGS.includes(all[i - 1]));

const framesOf = (run, re) => {
  const dir = path.join(OUT, 'motion', run);
  if (!fs.existsSync(dir)) throw new Error(`no such run: out/motion/${run}`);
  return fs.readdirSync(dir).filter((f) => re.test(f)).sort();
};
const urlsOf = (run, re) => framesOf(run, re).map((f) => `/motion/${run}/${f}`);
const pad = (v, w) => String(v == null ? '-' : v).padStart(w);
const signed = (v) => (v == null ? '-' : (v > 0 ? '+' : '') + v);

/** Frame hashes of two runs: how many of a's frames b holds byte for byte. */
function sameFrames(a, b) {
  const h = (run, f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, 'motion', run, f))).digest('hex');
  const fa = framesOf(a, /^f\d+\.jpg$/), fb = new Set(framesOf(b, /^f\d+\.jpg$/)), diff = [];
  let same = 0;
  for (const f of fa) { if (fb.has(f) && h(a, f) === h(b, f)) same++; else diff.push(f.slice(1, 4)); }
  return { frames: fa.length, same, different: diff };
}

/** The page side: decode saved frames and run truth.js over them. Returns one mode's result for one argument. */
async function inPage([mode, a, b, t, level, check]) {
  const T = window.__windTruth;
  const load = async (u, keepAlpha) => {
    const bmp = await createImageBitmap(await (await fetch(u)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0);
    const im = x.getImageData(0, 0, bmp.width, bmp.height);
    if (!keepAlpha) for (let p = 3; p < im.data.length; p += 4) if (im.data[p] !== 255) throw new Error('a see-through frame (' + u + '): save frames with the corrected bench, laid over the page (--clamp reads an old one)');
    return im;
  };
  if (mode === '--clamp') { const c = T.clamp(); for (const u of a) c.add((await load(u, true)).data); return c.summary(); }
  if (mode === '--diff') { const d = T.differ(1), n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) d.add((await load(a[i])).data, (await load(b[i])).data); return Object.assign(d.summary(), { framesA: a.length, framesB: b.length }); }
  const first = await load(b[0]), g0 = T.ground(first.width, first.height);
  for (let i = 0; i < b.length; i++) g0.add((i ? await load(b[i]) : first).data);
  const g = g0.done();
  if (mode === '--law') {
    if (t.length !== a.length) throw new Error('--law needs the trail buffer beside every frame (motion-run.js --trail)');
    const fit = T.lawFit(g, { level, check });
    for (let i = 0; i < a.length; i++) fit.add((await load(a[i])).data, (await load(t[i])).data);
    return fit.summary();
  }
  const w = T.watch(g);
  for (const u of a) w.add((await load(u)).data);
  return w.summary();
}

(async () => {
  if (!ARGS.length) throw new Error('nothing to read: see the head of this file');
  if (MODE === '--same') {
    for (const pair of ARGS) { const [a, b] = pair.split(':'), r = sameFrames(a, b); console.log(`${a} vs ${b}: identical ${r.same} of ${r.frames}${r.different.length && r.different.length < 30 ? ' (different: ' + r.different.join(' ') + ')' : ''}`); }
    return;
  }
  fs.mkdirSync(path.join(OUT, 'motion'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'motion', 'truth.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  fs.copyFileSync(path.join(BENCH, 'truth.js'), path.join(OUT, 'motion', 'truth-stats.js'));
  const server = await serveDir(OUT, undefined, {});
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: true });
  const results = {};
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/motion/truth.html`);
    await page.addScriptTag({ url: '/motion/truth-stats.js' });
    if (MODE === '--truth') console.log('label                 field L*  C* |  added  taken |  over  under  at field  back | darkest (p10) |   core (p90) | weber | flicker');
    if (MODE === '--law') console.log('label                 light p  veil q  rms | dark\'s law: opacity  rms | the glow law: opacity  rms | empty texels | pixel-channels');
    for (const arg of ARGS) {
      if (MODE === '--clamp') {
        const r = await page.evaluate(inPage, [MODE, urlsOf(arg, /^f\d+\.jpg$/).filter((_, i) => i % 20 === 0)]);
        results[arg] = r; console.log(arg.padEnd(22), JSON.stringify(r));
        continue;
      }
      const eq = arg.indexOf('='), label = MODE === '--diff' ? arg : arg.slice(0, eq), [a, b] = (MODE === '--diff' ? arg : arg.slice(eq + 1)).split(':');
      if (!a || !b || (MODE !== '--diff' && eq < 1)) throw new Error(`not ${MODE === '--diff' ? '<run a>:<run b>' : '<label>=<run with streaks>:<field alone>'}: ${arg}`);
      const s = await page.evaluate(inPage, [MODE, urlsOf(a, /^f\d+\.jpg$/), urlsOf(b, /^f\d+\.jpg$/), MODE === '--law' ? urlsOf(a, /^t\d+\.png$/) : null, LEVEL, CHECK]);
      results[label] = Object.assign({ runs: [a, b] }, s);
      if (MODE === '--diff') console.log(`${(a + ' vs ' + b).padEnd(44)} mean dE76 a pixel ${s.mean} (worst frame ${s.worstFrame}) · share of pixels over 1 dE: ${s.over1}, over 2 dE: ${s.over2} · largest ${s.max} · ${s.frames} frames`);
      else if (MODE === '--law') console.log(`${label.padEnd(22)} ${pad(s.p, 6)} ${pad(s.q, 7)} ${pad(s.rms, 5)} | ${pad(s.dark && s.dark.opacity, 19)} ${pad(s.dark && s.dark.rms, 5)} | ${pad(s.glow && s.glow.opacity, 21)} ${pad(s.glow && s.glow.rms, 5)} | ${pad(s.empty, 12)} | ${s.n}${s.obeys == null ? '' : ` · ${s.obeys} of them obey p ${CHECK[0]}, q ${CHECK[1]} to 1.5 levels`}`);
      else console.log(`${label.padEnd(22)} ${pad(s.groundL, 6)} ${pad(s.groundC, 4)} | ${pad(s.added, 6)} ${pad(s.taken, 6)} | ${pad(s.over3, 5)} ${pad(s.under15, 6)} ${pad(s.atField, 9)} ${pad(s.back, 5)} | ${pad(signed(s.darkest), 6)} (${pad(signed(s.darkestP10), 5)}) | ${pad(signed(s.lightest), 6)} (${pad(signed(s.lightestP90), 5)}) | ${pad(s.weber, 5)} | ${pad(s.flicker, 6)}`);
    }
  } finally { await browser.close(); server.close(); }
  if (JSON_OUT) fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(results, null, 1));
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 2; });
