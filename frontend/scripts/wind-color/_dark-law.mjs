// Scratch: dark's field by the ENGINE's law, beside mirror-model.mjs's, and what it moves in light's candidate.
// HEATMAP_FS writes dark's field premultiplied, vec4(fieldRgb * alpha, alpha) (WebGLWindShaders.js), and WebGLWindEngine.js blends it
// with gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA): on screen = F * a * a + map * (1 - a). mirror-model.mjs and check.mjs lay it as
// F * a + map * (1 - a). (Found by the session leading this work, 2026-10-12; mirror-model.mjs and check.mjs are NOT changed here.)
import fs from 'fs';
import { MODEL, groundOf, sample, tintOver, drawnField } from './mirror-model.mjs';
import { lchOf, cvdDE, normalDE } from './light-path-lib.mjs';
const OUT = process.argv[2];
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const DARK_F = drawnField('dark'), D = MODEL.dark;
const aDark = (kn) => D.op * (D.baseA + (1 - D.baseA) * ss(0, D.end, kn));
const GROUNDS = { style: { land: [18, 20, 26], water: [93, 117, 126] }, fallback: { land: [28, 37, 48], water: [11, 29, 46] } };   // mirror-model / check.mjs; windDarkRules.js BASE.dark
export const darkEngine = (kn, surf, set = 'style') => { const a = aDark(kn), F = sample(DARK_F, kn), g = GROUNDS[set][surf].map((x) => x / 255); return F.map((f, c) => f * a * a + g[c] * (1 - a)); };
const darkModel = (kn, surf) => tintOver('dark', kn, sample(DARK_F, kn), groundOf('dark', surf));
const TODAY = drawnField('light', { __RAW_DISABLE_WIND_LIGHT_PATH__: true }), NOW = drawnField('light', {});
const light = (F, kn, surf) => tintOver('light', kn, sample(F, kn), groundOf('light', surf));
const arc = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
const f1 = (x) => x.toFixed(1), STOPS = [0, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75];

console.log('DARK at the Beaufort stops: mirror-model law | ENGINE law, style grounds | engine law, fallback grounds   (L* / C* / hue)');
for (const surf of ['land', 'water']) { console.log(' over ' + surf);
  for (const kn of STOPS) { const m = lchOf(darkModel(kn, surf)), e = lchOf(darkEngine(kn, surf)), fb = lchOf(darkEngine(kn, surf, 'fallback'));
    console.log(`  ${String(kn).padStart(2)} kn | ${f1(m.L).padStart(5)} ${f1(m.C).padStart(5)} ${f1(m.h).padStart(6)} | ${f1(e.L).padStart(5)} ${f1(e.C).padStart(5)} ${f1(e.h).padStart(6)} | ${f1(fb.L).padStart(5)} ${f1(fb.C).padStart(5)} ${f1(fb.h).padStart(6)}`); } }
for (const [name, fn] of [['mirror-model law', (kn, s) => darkModel(kn, s)], ['ENGINE law, style grounds', (kn, s) => darkEngine(kn, s)], ['engine law, fallback grounds', (kn, s) => darkEngine(kn, s, 'fallback')]]) {
  let line = `dark, ${name}:`;
  for (const surf of ['land', 'water']) {
    let edge = { d: 0 }; for (let k = 1; k <= 60; k++) { const d = normalDE(fn(k - 1, surf), fn(k, surf)); if (d > edge.d) edge = { d, k }; }
    let floor = { de: 99 }, normal = { de: 99 }; for (let i = 2; i < STOPS.length; i++) { const a = fn(STOPS[i - 1], surf), b = fn(STOPS[i], surf), c = cvdDE(a, b), n = normalDE(a, b); if (c.de < floor.de) floor = { ...c, p: `${STOPS[i - 1]}-${STOPS[i]}` }; if (n < normal.de) normal = { de: n, p: `${STOPS[i - 1]}-${STOPS[i]}` }; }
    let turns = 0, prev = null, dir = 0; for (let k = 0; k <= 60; k++) { const q = lchOf(fn(k, surf)); if (q.C < 8) continue; if (prev !== null) { const d = arc(prev, q.h), s = Math.abs(d) > 4 ? Math.sign(d) : 0; if (s && dir && s !== dir) turns++; if (s) dir = s; } prev = q.h; }
    const Ls = []; for (let k = 6; k <= 40; k++) Ls.push(lchOf(fn(k, surf)).L);
    line += ` | ${surf}: steepest knot ${f1(edge.d)} (${edge.k - 1}-${edge.k} kn), hue turns ${turns}, colour-blind ${f1(floor.de)} (${floor.p} ${floor.kind}), normal ${f1(normal.de)} (${normal.p}), L* 6-40 kn ${f1(Math.min(...Ls))}-${f1(Math.max(...Ls))}`;
  }
  console.log(line);
}
console.log('\nLIGHT against dark by the ENGINE law (style grounds): hue gap over land at the stops, and the largest at any knot 3-21');
for (const [name, F] of [['today', TODAY], ['candidate', NOW]]) {
  const gaps = [3, 6, 10, 16, 21, 27, 33].map((kn) => `${kn} kn ${f1(arc(lchOf(darkEngine(kn, 'land')).h, lchOf(light(F, kn, 'land')).h))}`);
  let worst = 0; for (let k = 3; k <= 21; k++) worst = Math.max(worst, Math.abs(arc(lchOf(darkEngine(k, 'land')).h, lchOf(light(F, k, 'land')).h)));
  let edge = { d: 0 }; for (const surf of ['land', 'water']) for (let k = 1; k <= 60; k++) { const d = normalDE(light(F, k - 1, surf), light(F, k, surf)); if (d > edge.d) edge = { d, k, surf }; }
  const flat = ['land', 'water'].map((surf) => { const Ls = []; for (let k = 6; k <= 40; k++) Ls.push(lchOf(light(F, k, surf)).L); return `${surf} ${f1(Math.min(...Ls))}-${f1(Math.max(...Ls))} (span ${f1(Math.max(...Ls) - Math.min(...Ls))})`; });
  console.log(`  ${name}: ${gaps.join(', ')} | any knot ${f1(worst)} | steepest knot ${f1(edge.d)} (${edge.k - 1}-${edge.k} kn, ${edge.surf}) | L* 6-40 kn: ${flat.join('; ')}`);
}
if (OUT) {
  let md = '# The ground the wind field lays, knot by knot (L* / C* / hue)\n\nDark by the ENGINE\'s law (field x alpha squared + map x (1 - alpha); style grounds: land [18, 20, 26], sea [93, 117, 126]).\nLight by its multiply tint over its muted land and sea (mirror-model.mjs). "today" = `__RAW_DISABLE_WIND_LIGHT_PATH__`; "candidate" = `windLightPath.js` (branch claude/wind-light-path, 7b647d8f).\n\n| kn | dark land | dark sea | light today land | light today sea | candidate land | candidate sea |\n|---|---|---|---|---|---|---|\n';
  const cell = (c) => { const q = lchOf(c); return `${f1(q.L)} / ${f1(q.C)} / ${q.h.toFixed(0)}`; };
  for (let kn = 0; kn <= 60; kn++) md += `| ${kn} | ${cell(darkEngine(kn, 'land'))} | ${cell(darkEngine(kn, 'water'))} | ${cell(light(TODAY, kn, 'land'))} | ${cell(light(TODAY, kn, 'water'))} | ${cell(light(NOW, kn, 'land'))} | ${cell(light(NOW, kn, 'water'))} |\n`;
  fs.writeFileSync(OUT, md); console.log('\nwrote', OUT);
}
