// FORENSIC: per-speed contrast of the shipped rim/core vs the field colour it must separate from.
// The aggregate-crop probe averaged over all speeds and therefore could not see a per-speed failure.
const R = { THEME_RAMPS: require('../src/components/map/WindColorRamp').THEME_RAMPS };
const RAMPS = R.THEME_RAMPS;

// APCA/sRGB luminance coefficients (the precise ones, per APCA docs).
const Y = (r, g, b) => 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
// WCAG 2 contrast ratio on linearised luminance (kept for comparison; APCA notes it overstates
// contrast when BOTH colours are dark — precisely the light-theme ramp's situation).
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const Ylin = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const hi = Math.max(a, b) + 0.05, lo = Math.min(a, b) + 0.05; return hi / lo; };

// The SHIPPED rim/core pair (WebGLWindShaders DRAW_FS), as of 86d03cbd.
const SHIPPED = {
  dark:  { rimL: 0.0, coreL: 1.0, rimK: 0.98, coreK: 0.75 },
  light: { rimL: 1.0, coreL: 0.05, rimK: 0.92, coreK: 0.70 },
  beach: { rimL: 0.06, coreL: 1.0, rimK: 0.95, coreK: 0.55 },
};

console.log('Per-speed contrast of the rim against the field colour it must separate from.');
console.log('rimMix = mix(color, vec3(rimL), rimK) — what the rim pixel actually becomes.\n');

for (const theme of ['dark', 'light', 'beach']) {
  const ramp = RAMPS[theme], s = SHIPPED[theme];
  console.log(`=== ${theme.toUpperCase()} (shipped rimL=${s.rimL} coreL=${s.coreL}) ===`);
  console.log('  kn   fieldY   rimY   WCAGratio   APCA-ish dY   verdict');
  let worst = { r: 99, kn: null };
  for (const [kn, r, g, b] of ramp) {
    const fY = Y(r, g, b);
    // rim pixel = mix(color, rimL, rimK)
    const rr = r + (s.rimL - r) * s.rimK, rg = g + (s.rimL - g) * s.rimK, rb = b + (s.rimL - b) * s.rimK;
    const rY = Y(rr, rg, rb);
    const cr = ratio(Ylin(r, g, b), Ylin(rr, rg, rb));
    const dY = Math.abs(fY - rY);
    const verdict = cr < 3.0 ? '  <-- FAILS 3:1 (graphical-object minimum)' : '';
    if (cr < worst.r) worst = { r: cr, kn };
    console.log(`  ${String(kn).padStart(3)}  ${fY.toFixed(3)}   ${rY.toFixed(3)}   ${cr.toFixed(2).padStart(6)}      ${dY.toFixed(3)}   ${verdict}`);
  }
  console.log(`  WORST: ${worst.r.toFixed(2)}:1 at ${worst.kn} kn\n`);
}

// What an ADAPTIVE rule would give: pick the rim pole by the LOCAL field luminance.
console.log('=== ADAPTIVE (rim chosen from the LOCAL field luminance, not the theme) ===');
for (const theme of ['dark', 'light', 'beach']) {
  const ramp = RAMPS[theme];
  let worst = { r: 99, kn: null };
  const rows = [];
  for (const [kn, r, g, b] of ramp) {
    const fY = Y(r, g, b);
    const rimL = fY > 0.36 ? 0.0 : 1.0;          // dark rim on bright field, bright rim on dark field
    const k = 0.95;
    const rr = r + (rimL - r) * k, rg = g + (rimL - g) * k, rb = b + (rimL - b) * k;
    const cr = ratio(Ylin(r, g, b), Ylin(rr, rg, rb));
    if (cr < worst.r) worst = { r: cr, kn };
    rows.push(`${kn}kn:${cr.toFixed(1)}`);
  }
  console.log(`${theme.padEnd(6)} worst ${worst.r.toFixed(2)}:1 at ${worst.kn}kn   [${rows.join('  ')}]`);
}
