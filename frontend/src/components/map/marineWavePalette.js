// Marine HEIGHT wash only (light + beach). Dark, surf quality, crest colours, motion and wind keep their own paths.
// Kills, set before page load, then reload so the GLSL and the legend switch together:
//   window.__RAW_DISABLE_MARINE_WAVE_PALETTE__ = true -> the shader's own ramp (before 2026-10-14)
//   window.__RAW_DISABLE_WAVE_PALETTE_V2__ = true     -> v1, the 2026-10-14 table, exactly
//   window.__RAW_DISABLE_WAVE_HEIGHT_16M__ = true     -> the 10 m encoding and v2 capped there, exactly (#411)
// Checker: frontend/scripts/wind-color/wave-check.mjs (composited over each basemap, colour-blind via coloraide).
import { M_TO_FT } from './heightUnits';

const WIN = typeof window === 'undefined' ? {} : window;
export const MARINE_WAVE_PALETTE_ENABLED = WIN.__RAW_DISABLE_MARINE_WAVE_PALETTE__ !== true;

// The wave texture stores height as floor(min(1, h / scale) * 255) (WebGLMarineTextureEncoder.js), scale per upload: 10 m (the
// legacy ceiling, everywhere but the v2 wash) or v2's cap (marineWaveHeightScale below; marineHeightEncoding.js decodes).
const ENCODED_MAX = 10;
export const WAVE_HEIGHT_16M = WIN.__RAW_DISABLE_WAVE_HEIGHT_16M__ !== true;
export const WAVE_PALETTES = {
  // v1 (2026-10-14/15): anchors to 10 m, clamped there; lightness not monotonic (audit 2026-10-20: light's calm 0 m and 10 m
  // storm 12.6 dE00 apart, beach's 0.6 m and 2.4 m the same grey). Value-linear legend on each scale's own axis.
  v1: {
    heights: [0, 0.6, 1.2, 2.4, 5, 10], cap: 10, over: null,
    beach: [[5, 97, 89], [13, 166, 148], [250, 187, 110], [230, 95, 49], [107, 25, 34], [255, 242, 230]],
    light: [[199, 222, 240], [26, 166, 138], [31, 125, 224], [87, 31, 138], [242, 84, 144], [255, 255, 255]],
  },
  // v2 (owner 2026-10-20, DECISIONS D-033: "Ship light A and beach B"): lightness falls at every step as height grows, on the
  // table and as composited over each theme's water at world/regional/coastal alpha; never through grey; hue is the second cue.
  // Anchors on the legend's ticks (0 2 4 8 12 20 33 ft); the cap is the encoder's 10 m ceiling, and a cell at or above it draws
  // the above-cap colour. Light: candidate A of the A/B (cream -> turquoise -> blue -> indigo; a red flag above the cap). Beach:
  // candidate B (aqua -> cerulean -> orchid -> rose -> brick; a violet flag above the cap). Solved by wave-solve.mjs, finished by
  // wave-polish.mjs, judged by wave-check.mjs and wave-jacobian.mjs (frontend/scripts/wind-color/).
  v2: {
    heights: [0, 0.61, 1.22, 2.44, 3.66, 6.1, 10], cap: 10,
    light: [[228, 230, 144], [165, 227, 185], [29, 222, 224], [78, 166, 206], [82, 113, 187], [74, 68, 158], [66, 25, 132]],
    beach: [[195, 254, 255], [119, 221, 244], [1, 188, 243], [78, 134, 230], [156, 98, 164], [164, 85, 110], [160, 60, 58]],
    over: { light: [105, 9, 0], beach: [120, 26, 174] },   // beach: violet, re-solved 2026-10-20 so it is darker than the cap AS DRAWN (D-033 note)
    // 16 m (the wider encoding, wave-polish.mjs --extend 16): light a deep violet (8.3 dE00 off indigo) under its red flag (12.2);
    // beach a rose-plum (7.9 off brick; its hue turns back toward 6.1 m's rose, darker by 0.09 OKLCH L) under a magenta-violet flag
    // (10.8, darker as drawn): every forward hue (red, orange, maroon) left the flag 7-9 dE00 or less (joint search, 2026-10-20).
    h16: { cap: 16, light: [72, 21, 66], beach: [134, 59, 86], over: { light: [88, 0, 2], beach: [146, 1, 115] } },
  },
};
// The 16 m encoding (2026-10-20): one more anchor at the new ceiling and the above-cap state moved up to it. Every anchor under
// 10 m is the table above, unchanged; only the encoder's 8-bit step widens (10/255 -> 16/255 m). Solved against the fixed ramp by
// wave-polish.mjs --extend 16, judged by wave-check.mjs (v2@16). The kill (window.__RAW_DISABLE_WAVE_HEIGHT_16M__) draws v2 above.
export function widenWavePalette(p) {
  if (!p.h16) return p;
  return { heights: [...p.heights, p.h16.cap], cap: p.h16.cap, light: [...p.light, p.h16.light], beach: [...p.beach, p.h16.beach], over: p.h16.over };
}

export function resolveWavePalette(win = WIN) {
  return win.__RAW_DISABLE_WAVE_PALETTE_V2__ === true ? 'v1' : 'v2';
}
export const MARINE_WAVE_PALETTE_ID = resolveWavePalette();
const P = WAVE_HEIGHT_16M ? widenWavePalette(WAVE_PALETTES[MARINE_WAVE_PALETTE_ID]) : WAVE_PALETTES[MARINE_WAVE_PALETTE_ID];

export function hasMarineWavePalette(theme) {
  return MARINE_WAVE_PALETTE_ENABLED && (theme === 'light' || theme === 'beach');
}

/** The metres the encoder's 255 means for an upload drawn in `theme`: the table's cap where this table draws the wash and reaches
 *  past the legacy ceiling (light/beach, v2, 16 m on), else 10. Dark keeps 10 on purpose: a /16 step moves its calm water ~4.7 dE00. */
export function marineWaveHeightScale(theme) {
  return hasMarineWavePalette(theme) && P.cap > ENCODED_MAX ? P.cap : ENCODED_MAX;
}

/** The table's colour at `height` metres (rounded RGB). Above the cap, the palette's own above-cap colour when it has one. */
export function sampleMarineWavePalette(height, theme, p = P) {
  if (p.over && height >= p.cap) return p.over[theme].slice();
  const colors = p[theme], H = p.heights;
  const h = Math.max(0, Math.min(p.cap, height));
  for (let i = 0; i < H.length - 1; i++) {
    if (h <= H[i + 1]) {
      const t = (h - H[i]) / (H[i + 1] - H[i]);
      return colors[i].map((v, c) => Math.round(v + (colors[i + 1][c] - v) * t));
    }
  }
  return colors[colors.length - 1].slice();
}

// Generate GLSL from the same small table. No texture, uniform, draw or per-frame CPU work added.
const num = x => x.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
const vec = rgb => `vec3(${rgb.map(v => (v / 255).toFixed(9)).join(', ')})`;
const glslRamp = (H, colors) => H.slice(0, -1).map((h, i) =>
  `if (h <= ${num(H[i + 1])}) return mix(${vec(colors[i])}, ${vec(colors[i + 1])}, (h - ${num(h)}) / ${num(H[i + 1] - h)});`
).join('\n');
// Above the cap: a cap at the encoded maximum is only ever read as exactly that maximum (texel 255), so the state starts half a
// texel below it; LINEAR filtering then draws its edge midway between a 254 texel and a 255 one.
// A cap above the legacy 10 m is the encoder's own ceiling for that table (marineWaveHeightScale), so its half texel is cap / 510.
const overGlsl = (p, theme) => (p.over ? `if (height > ${num(p.cap >= ENCODED_MAX ? p.cap - p.cap / 510 : p.cap)}) return ${vec(p.over[theme])}; ` : '');
export const marineWavePaletteGlsl = p => `
vec3 marineWaveHeightColor(float height, float theme) {
  float h = clamp(height, 0.0, ${num(p.cap)});
  if (theme > 1.5) { ${overGlsl(p, 'beach')}${glslRamp(p.heights, p.beach)} }
  else { ${overGlsl(p, 'light')}${glslRamp(p.heights, p.light)} }
  return vec3(1.0);
}
`;
export const MARINE_WAVE_PALETTE_GLSL = MARINE_WAVE_PALETTE_ENABLED ? marineWavePaletteGlsl(P) : '';
export const MARINE_WAVE_PALETTE_CALL_GLSL = MARINE_WAVE_PALETTE_ENABLED
  ? 'if (surfMode < 0.5 && theme > 0.5) return marineWaveHeightColor(h, theme);' : '';

// v1's legend: the same value axis and endpoints as the existing scale; dense colours preserve the 5 m turn.
// Called only for the marine bar: labels/units, raster alphas and every other legend stay intact.
export function marineWaveLegendGradientCSS(scale, theme) {
  if (!hasMarineWavePalette(theme) || scale?.unit !== 'm') return null;
  const lo = scale.breakpoints[0], hi = scale.breakpoints[scale.breakpoints.length - 1];
  const heights = Array.from({ length: 81 }, (_, i) => lo + (hi - lo) * i / 80)
    .concat(P.heights.filter(h => h > lo && h < hi)).sort((a, b) => a - b);
  return `linear-gradient(to right, ${heights.map(h =>
    `rgb(${sampleMarineWavePalette(h, theme).join(',')}) ${((h - lo) / (hi - lo) * 100).toFixed(3)}%`
  ).join(', ')})`;
}

// v2's legend: one bar for the one colour map every height layer draws. Each anchor gets an equal share of the bar, so the CSS
// gradient between two stops is linear in height exactly as the GLSL mix() is (both in encoded sRGB), and every label sits on
// its own colour. The last ARROW_PCT is the above-cap arrow (clip-path), in the above-cap colour.
export const ARROW_PCT = 6;
export function marineWaveLegend(scale, theme, heightUnit) {
  if (!hasMarineWavePalette(theme) || scale?.unit !== 'm') return null;
  if (!P.over) return { gradientCSS: marineWaveLegendGradientCSS(scale, theme) };
  const H = P.heights, end = 100 - ARROW_PCT, at = i => (i / (H.length - 1)) * end;
  const stops = H.map((h, i) => `rgb(${P[theme][i].join(',')}) ${at(i).toFixed(3)}%`);
  const over = `rgb(${P.over[theme].join(',')})`;
  const gradientCSS = `linear-gradient(to right, ${stops.join(', ')}, ${over} ${end}%, ${over} 100%)`;
  const label = h => { const v = heightUnit === 'm' ? h : h * M_TO_FT; return v < 1 ? v.toFixed(1) : `${Math.round(v)}`; };
  const ticks = H.map((h, i) => ({ label: i === H.length - 1 ? `${label(h)}+` : label(h), pct: at(i) }));
  return { gradientCSS, stops: ticks, clipPath: `polygon(0 0, ${end}% 0, 100% 50%, ${end}% 100%, 0 100%)` };
}
