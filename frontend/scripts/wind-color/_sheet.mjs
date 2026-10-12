// Scratch: one sheet for the eye. Each theme's wind FIELD as drawn over its own map, speed by speed (land above, sea below).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { groundOf, sample, tintOver, drawnField } from './mirror-model.mjs';
import { lchOf } from './light-path-lib.mjs';
const require = createRequire(import.meta.url);
const OUT = process.argv[2];
const STOPS = [0, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75];
const hex = (c) => '#' + c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
const ARMS = [
  { label: 'DARK (the model)', theme: 'dark', F: drawnField('dark'), note: 'one way round the wheel: magenta, violet, blue, aqua, green, yellow, orange, red' },
  { label: 'LIGHT today', theme: 'light', F: drawnField('light', { __RAW_DISABLE_WIND_LIGHT_PATH__: true }), flag: { 10: 'orchid: dark’s CALM colour', 21: 'teal, behind 16 kn’s green, and lighter' }, note: 'same order as dark, except 10 kn and 21 kn run backwards' },
  { label: 'LIGHT in dark’s order (candidate)', theme: 'light', F: drawnField('light', {}), note: 'calm, 3 kn and 33 kn up unchanged; 4 to 32 kn re-ordered' },
  { label: 'BEACH today', theme: 'beach', F: drawnField('beach'), flag: { 10: 'its darkest band', 27: 'lighter than calm' }, note: 'order is right (its own sea greens, then dark’s order); its lightness is not: 10 kn darkest, 27 to 40 kn lightest' },
];
let html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font:13px/1.35 system-ui,Segoe UI,Arial;color:#1c1f24;padding:18px 22px;width:1240px}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 14px;color:#444}'
  + '.arm{margin:0 0 16px}.name{font-weight:700;font-size:14px}.note{color:#555;margin-bottom:5px}.row{display:flex;gap:4px}.cell{width:90px}.sw{height:34px}.sw.sea{height:26px}.kn{font-weight:700;text-align:center}.num{font-size:10.5px;color:#555;text-align:center;white-space:nowrap}'
  + '.bad .sw{outline:3px solid #d21f3c;outline-offset:-3px}.why{font-size:10.5px;color:#b3122d;text-align:center;line-height:1.2}</style></head><body>'
  + '<h1>The wind field at each speed, as drawn over each theme’s own map</h1><p>Each tile: over land (top) and over sea (bottom). Under it: lightness L* and hue angle over land. Red outline = where a theme breaks its own order.</p>';
for (const arm of ARMS) {
  html += `<div class="arm"><div class="name">${arm.label}</div><div class="note">${arm.note}</div><div class="row">`;
  for (const kn of STOPS) {
    const land = tintOver(arm.theme, kn, sample(arm.F, kn), groundOf(arm.theme, 'land')), sea = tintOver(arm.theme, kn, sample(arm.F, kn), groundOf(arm.theme, 'water')), q = lchOf(land), why = arm.flag && arm.flag[kn];
    html += `<div class="cell${why ? ' bad' : ''}"><div class="kn">${kn} kn</div><div class="sw" style="background:${hex(land)}"></div><div class="sw sea" style="background:${hex(sea)}"></div><div class="num">L ${q.L.toFixed(0)} · hue ${q.h.toFixed(0)}</div>${why ? `<div class="why">${why}</div>` : ''}</div>`;
  }
  html += '</div></div>';
}
html += '</body></html>';
const file = path.resolve(OUT.replace(/\.png$/, '.html'));
fs.writeFileSync(file, html);
const { chromium } = require(path.resolve('..', '..', 'node_modules', 'playwright'));
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1284, height: 800 }, deviceScaleFactor: 1.5 });
await page.goto('file:///' + file.replace(/\\/g, '/'));
await page.screenshot({ path: path.resolve(OUT), fullPage: true });
await browser.close();
console.log('wrote', OUT);
