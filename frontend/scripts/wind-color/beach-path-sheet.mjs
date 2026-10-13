#!/usr/bin/env node
// BEACH PATH, the sheet for the eye: the wind FIELD at each Beaufort speed as drawn over its own map (land above, sea below), for dark
// (the model, by the engine's law), beach before its path, beach on its path, and any other candidate handed in. Under each tile: L*,
// C* and hue over land. Between two tiles: the colour-blind distance of that pair (the weakest of protan, deutan and tritan, land and
// sea); red under the bar of 5. A red outline marks where a row breaks its own order. Then the lightness line, knot by knot.
//
//   node beach-path-sheet.mjs out.png ["label=candidate.json|note" ...]
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { STOPS, TOP, LAND, WATER, TODAY, on, pathOf, darkOn } from './beach-path-solve.mjs';
import { lchOf, cvdDE } from './light-path-lib.mjs';
import { sample, drawnField } from './mirror-model.mjs';

const require = createRequire(import.meta.url);
const [OUT, ...EXTRA] = process.argv.slice(2);
if (!OUT) { console.error('usage: node beach-path-sheet.mjs out.png ["label=candidate.json|note" ...]'); process.exit(2); }
const hex = (c) => '#' + c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
const knots = Array.from({ length: TOP + 1 }, (_, kn) => kn);
const fromField = (F) => knots.map((kn) => ({ land: on(sample(F, kn), kn, LAND), water: on(sample(F, kn), kn, WATER) }));
const arms = [
  { label: 'DARK (the model)', note: 'its hue runs one way round the wheel; its lightness climbs to 10 kn and holds level to 21 kn, then eases back', rows: knots.map((kn) => ({ land: darkOn(kn, 'land'), water: darkOn(kn, 'water') })), dark: true },
  { label: 'BEACH today', note: 'the hue order is right (its own sea greens, then dark\'s order). The lightness is not: 10 kn is its darkest band below 47 kn, deeper than 16 and 21 kn', rows: fromField(TODAY), flag: { 10: 'deeper than 16 and 21 kn' }, line: '#b3122d' },
  { label: 'BEACH on its path (the candidate, built behind a kill)', note: '10 kn lifted level with 16 and 21 kn; every other band within 3.3 dE00 of today; the gale band kept pale', rows: fromField(drawnField('beach', {})), line: '#0a7f3f' },
];
for (const e of EXTRA) {
  const [label, rest] = [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)], [file, note] = rest.split('|');
  const j = JSON.parse(fs.readFileSync(file, 'utf8')), cand = Array.isArray(j) ? j[0].cand : j;
  arms.push({ label, note: note || '', rows: pathOf(cand).map((r) => ({ land: r.land, water: r.water })), line: ['#1f5fbf', '#a86a00', '#00838f', '#8a4fbf'][arms.length - 3] || '#555' });
}
const pair = (rows, a, b) => Math.min(cvdDE(rows[a].land, rows[b].land).de, cvdDE(rows[a].water, rows[b].water).de);

let html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font:13px/1.35 system-ui,Segoe UI,Arial;color:#1c1f24;padding:18px 22px;width:1330px}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#444}'
  + '.arm{margin:0 0 14px}.name{font-weight:700;font-size:14px}.note{color:#555;margin-bottom:5px}.row{display:flex;align-items:flex-start}.cell{width:84px}.sw{height:34px}.sw.sea{height:26px}.kn{font-weight:700;text-align:center}'
  + '.num{font-size:10.5px;color:#555;text-align:center;white-space:nowrap}.gap{width:18px;font-size:9.5px;text-align:center;color:#777;padding-top:38px;line-height:1.1}.gap.bad{color:#d21f3c;font-weight:700}'
  + '.bad .sw{outline:3px solid #d21f3c;outline-offset:-3px}.why{font-size:10px;color:#b3122d;text-align:center;line-height:1.15}.legend span{display:inline-block;margin-right:16px}.sw2{display:inline-block;width:22px;height:3px;vertical-align:middle;margin-right:5px}</style></head><body>'
  + '<h1>Beach\'s wind field at each speed, as drawn over its own map, beside dark\'s</h1><p>Each tile: over land (top) and over sea (bottom). Under it: lightness L*, colour C* and hue over land. '
  + 'Between tiles: how far apart a colour-blind reader sees the two bands (red = under the bar of 5). Red outline = the band that breaks the order.</p>';
for (const arm of arms) {
  html += `<div class="arm"><div class="name">${arm.label}</div><div class="note">${arm.note}</div><div class="row">`;
  STOPS.forEach((kn, i) => {
    if (i > 1) { const d = pair(arm.rows, STOPS[i - 1], kn); html += `<div class="gap${!arm.dark && d < 5 ? ' bad' : ''}">${arm.dark ? '' : d.toFixed(1)}</div>`; } else if (i === 1) html += '<div class="gap"></div>';
    const q = lchOf(arm.rows[kn].land), why = arm.flag && arm.flag[kn];
    html += `<div class="cell${why ? ' bad' : ''}"><div class="kn">${kn} kn</div><div class="sw" style="background:${hex(arm.rows[kn].land)}"></div><div class="sw sea" style="background:${hex(arm.rows[kn].water)}"></div><div class="num">L ${q.L.toFixed(0)} · C ${q.C.toFixed(0)} · h ${q.h.toFixed(0)}</div>${why ? `<div class="why">${why}</div>` : ''}</div>`;
  });
  html += '</div></div>';
}
// the lightness line over land, knot by knot (beach's arms; the speed axis is linear in knots)
const W = 1280, H = 250, X = (kn) => 46 + (kn / TOP) * (W - 60), Y = (L) => 14 + (78 - L) / (78 - 38) * (H - 44);
let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="font:11px system-ui,Segoe UI,Arial">`;
for (const L of [40, 50, 60, 70]) svg += `<line x1="${X(0)}" x2="${X(TOP)}" y1="${Y(L)}" y2="${Y(L)}" stroke="#e3e6ea"/><text x="${X(0) - 8}" y="${Y(L) + 4}" text-anchor="end" fill="#666">L* ${L}</text>`;
for (const kn of STOPS) svg += `<line x1="${X(kn)}" x2="${X(kn)}" y1="${Y(78)}" y2="${Y(38)}" stroke="#f0f1f3"/><text x="${X(kn)}" y="${H - 12}" text-anchor="middle" fill="#666">${kn}</text>`;
svg += `<rect x="${X(0)}" y="${Y(78)}" width="${X(21) - X(0)}" height="${Y(38) - Y(78)}" fill="#0a7f3f" opacity="0.05"/><text x="${X(10.5)}" y="${Y(78) + 12}" text-anchor="middle" fill="#0a7f3f">the green band: calm to 21 kn</text>`;
for (const arm of arms.filter((a) => a.line)) svg += `<polyline fill="none" stroke="${arm.line}" stroke-width="${arm.label.includes('today') ? 2.5 : 2}" ${arm.label.includes('today') ? 'stroke-dasharray="6 4"' : ''} points="${knots.map((kn) => `${X(kn).toFixed(1)},${Y(lchOf(arm.rows[kn].land).L).toFixed(1)}`).join(' ')}"/>`;
svg += '</svg>';
html += `<div class="arm"><div class="name">The lightness of the field over the land, knot by knot (lower = deeper; speed in knots along the bottom)</div><div class="legend note">${arms.filter((a) => a.line).map((a) => `<span><i class="sw2" style="background:${a.line}"></i>${a.label}</span>`).join('')}</div>${svg}</div>`;
html += '</body></html>';
const file = path.resolve(OUT.replace(/\.png$/, '.html'));
fs.writeFileSync(file, html);
const { chromium } = require(path.resolve('..', '..', 'node_modules', 'playwright'));
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1374, height: 800 }, deviceScaleFactor: 1.5 });
await page.goto('file:///' + file.replace(/\\/g, '/'));
await page.screenshot({ path: path.resolve(OUT), fullPage: true });
await browser.close();
console.log('wrote', OUT);
