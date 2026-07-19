// FORENSIC: the particle does NOT sit on the ramp colour. The wind FIELD is semi-transparent, so
// the real background is  ramp COMPOSITED OVER THE BASEMAP. Every contrast number this arc has
// produced compared the particle to the ramp alone — which is the wrong background.
const RAMPS = require('../src/components/map/WindColorRamp').THEME_RAMPS;

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const Ylin = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Shipped field alpha:  u_opacity * (baseAlpha + (1-baseAlpha)*smoothstep(0,10,speed))
const HEATMAP_OPACITY = { dark: 0.48, light: 0.65, beach: 0.55 };
const BASE_ALPHA = { dark: 0.20, light: 0.35, beach: 0.45 };
// Approximate BASEMAP luminance behind the field, per theme (linear).
const BASEMAP_Y = { dark: 0.020, light: 0.720, beach: 0.300 };

const smoothstep = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const fieldAlpha = (theme, s) =>
  HEATMAP_OPACITY[theme] * (BASE_ALPHA[theme] + (1 - BASE_ALPHA[theme]) * smoothstep(0, 10, s));

// What the shipped shader does: pole chosen from the RAMP colour only.
const poleFromRamp = (r, g, b) => (Ylin(r, g, b) >= 0.179 ? 0.0 : 1.0);

console.log('For each theme/speed: the pole the SHIPPED shader picks, vs the contrast it actually');
console.log('achieves against the COMPOSITED background, vs the pole that was correct.\n');

for (const theme of ['light', 'dark', 'beach']) {
  console.log(`=== ${theme.toUpperCase()}  (basemapY=${BASEMAP_Y[theme]}) ===`);
  console.log('  kn   fieldA   rampY   bgY(real)   pole   ACTUAL   best   loss');
  let worst = { c: 99 };
  for (const [kn, r, g, b] of RAMPS[theme]) {
    const a = fieldAlpha(theme, kn);
    const rampY = Ylin(r, g, b);
    const bgY = a * rampY + (1 - a) * BASEMAP_Y[theme];        // composited background
    const pole = poleFromRamp(r, g, b);
    const poleY = pole === 0 ? 0.0 : 1.0;
    const actual = ratio(bgY, poleY);
    const best = Math.max(ratio(bgY, 0.0), ratio(bgY, 1.0));
    if (actual < worst.c) worst = { c: actual, kn, pole, best };
    const flag = actual < 3.0 ? '  <-- FAILS' : (best / actual > 1.6 ? '  <-- wrong pole' : '');
    console.log(`  ${String(kn).padStart(3)}  ${a.toFixed(2)}   ${rampY.toFixed(3)}   ${bgY.toFixed(3)}      ${pole === 0 ? 'blk' : 'wht'}   ${actual.toFixed(2).padStart(5)}   ${best.toFixed(2).padStart(5)}${flag}`);
  }
  console.log(`  WORST ${worst.c.toFixed(2)}:1 at ${worst.kn}kn (best available there: ${worst.best.toFixed(2)}:1)\n`);
}
