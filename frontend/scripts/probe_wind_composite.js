// FORENSIC composite table for the wind field — models the LIVE shader contract.
// (History: the original 2026-07-18 round-6 version of this probe modelled the then-shipped
// "pole chosen from the ramp" bug and pre-07-19 alphas; it drifted twice and misled reruns —
// this rewrite tracks the v3.22 contract and states its constants' sync sites.)
//
// The particle does NOT sit on the ramp colour: the wind FIELD is semi-transparent, so the real
// background is ramp COMPOSITED OVER THE BASEMAP. Every visibility/contrast question about the
// wind palette must be answered in composite space at the field's REAL alpha.
//
// SYNC (five sites, one constant set — see windFieldLut.test.js source pins):
//   WebGLWindShaders HEATMAP_FS v3.22 + DRAW_FS casing · windParticleContrast.test.js ·
//   windFieldLut.test.js (x2 maps) · this file.
const RAMPS = require('../src/components/map/WindColorRamp').THEME_RAMPS;

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const Ylin = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// LIVE field alpha (v3.22, 2026-07-20 slow-wind visibility raise):
//   u_opacity * (baseAlpha + (1-baseAlpha)*smoothstep(0, rampEnd, speed))
// kill switch __RAW_DISABLE_WIND_CALM_ALPHA_V3__ restores {dark 0.28, light 0.35, beach 0.45, 7kn}.
const HEATMAP_OPACITY = { dark: 0.48, light: 0.65, beach: 0.55 };
const BASE_ALPHA = { dark: 0.44, light: 0.42, beach: 0.45 };
const RAMP_KN = { dark: 5, light: 7, beach: 7 };
// Measured basemap RGB (probe_wind_themes screenshots) + linear luminance (engine _basemapY).
const BASEMAP_RGB = { dark: [93, 117, 126], light: [168, 214, 222], beach: [150, 190, 200] };
const BASEMAP_Y = { dark: 0.020, light: 0.720, beach: 0.300 };

const smoothstep = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const fieldAlpha = (theme, s) =>
  HEATMAP_OPACITY[theme] * (BASE_ALPHA[theme] + (1 - BASE_ALPHA[theme]) * smoothstep(0, RAMP_KN[theme], s));

const rgbToHsl = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
};

// LIVE casing pole choice (DRAW_FS): from the COMPOSITE luminance, gamma-2.2 ramp model.
const rampY22 = (r, g, b) => 0.2126729 * Math.pow(r, 2.2) + 0.7151522 * Math.pow(g, 2.2) + 0.0721750 * Math.pow(b, 2.2);

console.log('LIVE v3.22 composite table: per theme/stop — effective alpha, composite hue/sat,');
console.log('perceptual delta vs bare basemap (visD), casing pole + outer-ring contrast.\n');

for (const theme of ['dark', 'light', 'beach']) {
  console.log(`=== ${theme.toUpperCase()}  (opacity ${HEATMAP_OPACITY[theme]}, baseA ${BASE_ALPHA[theme]}, ramp ${RAMP_KN[theme]}kn, basemap rgb(${BASEMAP_RGB[theme]}) Y ${BASEMAP_Y[theme]}) ===`);
  console.log('   kn  fieldA  compHue  sat%    visD   pole  outer:field');
  const bm = BASEMAP_RGB[theme].map((v) => v / 255);
  let prevHue = null;
  for (const [kn, r, g, b] of RAMPS[theme]) {
    const a = fieldAlpha(theme, kn);
    const c = [bm[0] * (1 - a) + r * a, bm[1] * (1 - a) + g * a, bm[2] * (1 - a) + b * a];
    const { h, s } = rgbToHsl(...c);
    const visD = 255 * Math.sqrt(0.30 * (c[0] - bm[0]) ** 2 + 0.59 * (c[1] - bm[1]) ** 2 + 0.11 * (c[2] - bm[2]) ** 2);
    const bgY = BASEMAP_Y[theme] * (1 - a) + rampY22(r, g, b) * a;
    const pole = bgY >= 0.179 ? 'blk' : 'wht';
    const outerY = pole === 'blk' ? Ylin(0.02, 0.02, 0.02) : Ylin(0.98, 0.98, 0.98);
    const c1 = ratio(bgY, outerY);
    let gap = '';
    if (prevHue !== null && kn <= 21) {
      let d = Math.abs(h - prevHue); if (d > 180) d = 360 - d;
      gap = `  gap ${d.toFixed(1)}`;
    }
    prevHue = h;
    console.log(`  ${String(kn).padStart(3)}  ${a.toFixed(3)}  ${h.toFixed(1).padStart(6)}  ${(s * 100).toFixed(0).padStart(3)}%  ${visD.toFixed(1).padStart(6)}   ${pole}  ${c1.toFixed(2).padStart(6)}:1${gap}`);
  }
  console.log('');
}
