#!/usr/bin/env node
/**
 * Wind bench, MIRROR mode: how far is each theme's moving wind picture from dark's? Dark is the model (owner, 2026-10-11).
 *
 *   node scripts/wind-bench/mirror-run.js --motion out/motion.json [--model dark] [--size 420] [--at 0.5,0.5] [--json out/mirror.json]
 *
 * It reads the frames motion-run.js saved (out/motion/<run>/fNNN.jpg) with the SAME probe that reads the deployed app's canvas
 * (page/mirror-probe.js), so a bench number and a number taken on the owner's screen mean the same thing. --at x,y (0..1) places the
 * crop: read the land and the sea apart, they are different grounds (D-022). Runs are grouped by zoom;
 * within a zoom every run is printed beside the model theme's.
 *
 * Columns (each read on a centre crop, per pixel over the run; L* is CIELAB lightness):
 *   ground   the picture with no streak on it (each pixel's darkest moment), median L*
 *   picture  the mean over time, L*; lift = picture - ground: how far the streaks raise the WHOLE picture. Dark's lift is the bar:
 *            a lift far above it is white burying the colour field (D-022: 10 to 27 where dark read 9 to 17).
 *   peak     a streak's core at its lightest, median L*; 100 with `kept` near 0 is paper white
 *   step     peak - ground under the same pixel, median over the pixels a streak reached
 *   kept     streak chroma / ground chroma: 1.0 is "the ground's own colour, made lighter" (dark's relation)
 *   cover    share of the crop lit at one instant; reach = share a streak reached at all in the run
 *   flicker  mean |change in L*| a pixel a frame: the motion the eye is given
 */
const fs = require('fs');
const path = require('path');
const { FRONTEND } = require('./build');
const { serveDir } = require('./serve');
const flag = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BENCH = __dirname, OUT = path.join(BENCH, 'out');
const MOTION = path.resolve(flag('--motion', path.join(OUT, 'motion.json'))), MODEL = flag('--model', 'dark'), SIZE = Number(flag('--size', 420)), JSON_OUT = flag('--json'), AT = flag('--at', '0.5,0.5').split(',').map(Number);

(async () => {
  const runs = Object.values(JSON.parse(fs.readFileSync(MOTION, 'utf8'))).filter((r) => r.ok);
  if (!runs.length) throw new Error('no runs in ' + MOTION);
  fs.writeFileSync(path.join(OUT, 'motion', 'mirror.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  fs.copyFileSync(path.join(BENCH, 'page', 'mirror-probe.js'), path.join(OUT, 'motion', 'mirror-probe.js'));
  const server = await serveDir(OUT, undefined, {});
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: true });
  const results = {};
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/motion/mirror.html`);
    await page.addScriptTag({ url: '/motion/mirror-probe.js' });
    for (const run of runs) {
      const n = fs.readdirSync(path.join(OUT, run.dir)).filter((f) => /^f\d+\.jpg$/.test(f)).length;
      const urls = Array.from({ length: n }, (_, i) => `/${run.dir}/f${String(i).padStart(3, '0')}.jpg`);
      results[run.name] = { ...(await page.evaluate(([u, size, at]) => window.__mirrorProbe.fromImages(u, { size, at }), [urls, SIZE, AT])), theme: run.theme, z: run.z, levers: run.levers || {}, scale: run.scale || 1, dpr: run.dpr };
    }
  } finally { await browser.close(); server.close(); }

  const pad = (v, w) => String(v == null ? '-' : v).padStart(w);
  const zooms = [...new Set(runs.map((r) => `${r.z}|${r.scale || 1}`))];
  for (const zk of zooms) {
    const [z, scale] = zk.split('|').map(Number), rows = runs.filter((r) => r.z === z && (r.scale || 1) === scale).map((r) => [r.name, results[r.name]]);
    const model = rows.find(([, s]) => s.theme === MODEL && !Object.keys(s.levers).length);
    console.log(`\n=== zoom ${z}${scale !== 1 ? `, wind x ${scale}` : ''} (${SIZE} px at ${AT.join(', ')}, dpr ${rows[0][1].dpr || 1})${model ? `; the model: ${model[0]}` : ''}`);
    console.log('run                          ground picture   lift | peak   step   kept | cover  reach flicker | lift against the model');
    for (const [name, s] of rows) {
      const vs = model && model[1] !== s ? `${s.lift - model[1].lift >= 0 ? '+' : ''}${(s.lift - model[1].lift).toFixed(1)} L* (x ${(s.lift / Math.max(0.1, model[1].lift)).toFixed(2)})` : (model ? 'the model' : '');
      console.log(`${name.padEnd(28)} ${pad(s.groundL, 6)} ${pad(s.pictureL, 7)} ${pad(s.lift, 6)} | ${pad(s.peakL, 5)} ${pad(s.step, 6)} ${pad(s.kept, 6)} | ${pad(s.cover, 5)} ${pad(s.reach, 6)} ${pad(s.flicker, 7)} | ${vs}`);
    }
  }
  if (JSON_OUT) fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(results, null, 1));
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 2; });
