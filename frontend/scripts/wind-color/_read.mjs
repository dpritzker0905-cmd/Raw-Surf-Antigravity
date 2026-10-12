import { MODEL, groundOf, sample, strength, tintOver, drawnField, ramps, de } from './mirror-model.mjs';
import { lchOf, cvdDE, normalDE } from './light-path-lib.mjs';
const STOPS = [0, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75];
const f1 = (x) => x.toFixed(1).padStart(6);
const F = drawnField('light'), D = drawnField('dark');
const on = (theme, Fld, v, surf) => tintOver(theme, v, sample(Fld, v), groundOf(theme, surf));
console.log('LIGHT as drawn, at the Beaufort stops');
for (const surf of ['land', 'water']) {
  console.log(' ' + surf + ':  kn |   L*    C*   hue | to next: normal dE00, colour-blind dE00 (kind)');
  STOPS.forEach((v, i) => { const c = on('light', F, v, surf), q = lchOf(c); let s = `${String(v).padStart(8)} |${f1(q.L)}${f1(q.C)}${f1(q.h)} |`;
    if (i + 1 < STOPS.length) { const n = on('light', F, STOPS[i + 1], surf), cv = cvdDE(c, n); s += `${f1(normalDE(c, n))} ${f1(cv.de)} (${cv.kind})`; } console.log(s); });
}
const darkLegend = ramps.huePathStops(ramps.THEME_RAMPS.dark, {});
console.log('\nDARK: hue per knot: legend (bare) | field on screen over land | over water;  LIGHT field over land hue, gap to dark land');
let turnsL = 0, turnsD = 0;
for (let v = 0; v <= 33; v++) { const lg = lchOf(sample(darkLegend, v)), dl = lchOf(on('dark', D, v, 'land')), dw = lchOf(on('dark', D, v, 'water')), ll = lchOf(on('light', F, v, 'land'));
  let g = Math.abs(ll.h - dl.h) % 360; g = g > 180 ? 360 - g : g;
  console.log(`${String(v).padStart(4)} | ${f1(lg.h)} | ${f1(dl.h)} L${f1(dl.L)} C${f1(dl.C)} | ${f1(dw.h)} || ${f1(ll.h)} L${f1(ll.L)} C${f1(ll.C)} gap ${f1(g)}`); }
for (const theme of ['dark', 'light']) { const Fl = theme === 'dark' ? D : F; let worst = { d: 0 };
  for (const surf of Object.keys(MODEL[theme].surfaces)) for (let v = 1; v <= 60; v++) { const d = de(on(theme, Fl, v, surf), on(theme, Fl, v - 1, surf)); if (d > worst.d) worst = { d, v, surf }; }
  console.log(`${theme}: steepest step a knot ${worst.d.toFixed(1)} dE00 (${worst.v - 1}-${worst.v} kn over ${worst.surf})`); }
