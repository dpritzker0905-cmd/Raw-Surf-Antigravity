// Pairwise read of scn_wave_lakes.js output (2026-10-23, waveLakes.js): for each (theme, model, view) with both a `lakes` and a
// `nolakes` screenshot, the fraction of samples per geographic class (cls-<view>.json: lake / control / land / sea) whose pixel
// differs by more than DIFF (sum of |dR|+|dG|+|dB|). The two arms differ ONLY by __RAW_DISABLE_WAVE_LAKES__, so: a carried lake
// under EURO must differ (the field is drawn there now); under GFS nothing may differ in a lake; control lakes and land must not
// differ under any model; sea differs only by crest animation (two sessions, two animation phases), its rate is the noise floor.
//   node lakes_pairs.js <OUT dir> [DIFF=36]
const fs = require('fs');
const path = require('path');
const { decodePng } = require(path.join(__dirname, '../../e2e/pngPixels.js'));
const dir = process.argv[2];
const DIFF = +(process.argv[3] || 36);
const out = {};
for (const f of fs.readdirSync(dir)) {
  const m = /^(\w+)-(\w+)-lakes-(\w+)\.png$/.exec(f);
  if (!m) continue;
  const [, theme, model, view] = m;
  const other = path.join(dir, `${theme}-${model}-nolakes-${view}.png`);
  const clsFile = path.join(dir, `cls-${view}.json`);
  if (!fs.existsSync(other) || !fs.existsSync(clsFile)) continue;
  const a = decodePng(fs.readFileSync(path.join(dir, f))); const b = decodePng(fs.readFileSync(other));
  const r = {};
  for (const [x, y, k] of JSON.parse(fs.readFileSync(clsFile, 'utf8'))) {
    const i = (y * a.width + x) * a.bpp; const j = (y * b.width + x) * b.bpp;
    const d = Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2]);
    r[k] = r[k] || [0, 0]; r[k][1] += 1; if (d > DIFF) r[k][0] += 1;
  }
  out[`${theme} ${model} ${view}`] = Object.fromEntries(Object.entries(r).map(([k, [h, n]]) => [k, `${(h / n).toFixed(3)} (n=${n})`]));
}
console.log(JSON.stringify(out, null, 1));
