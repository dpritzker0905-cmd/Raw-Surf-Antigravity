// Marine HEIGHT wash only. Surf quality, crest colours, motion and wind keep their own paths.
// Rollback: set this kill before page load, then reload so GLSL and the legend switch together.
export const MARINE_WAVE_PALETTE_ENABLED = typeof window === 'undefined'
  || window.__RAW_DISABLE_MARINE_WAVE_PALETTE__ !== true;

// Existing height anchors (metres), with more lightness separation within each theme's family.
const HEIGHTS = [0, 0.6, 1.2, 2.4, 5, 10];
const COLORS = {
  beach: [[5, 97, 89], [13, 166, 148], [250, 187, 110], [230, 95, 49], [107, 25, 34], [255, 242, 230]],
  light: [[199, 222, 240], [26, 166, 138], [31, 125, 224], [87, 31, 138], [242, 84, 144], [255, 255, 255]],
};

export function hasMarineWavePalette(theme) {
  return MARINE_WAVE_PALETTE_ENABLED && Object.prototype.hasOwnProperty.call(COLORS, theme);
}

export function sampleMarineWavePalette(height, theme) {
  const colors = COLORS[theme];
  const h = Math.max(0, Math.min(10, height));
  for (let i = 0; i < HEIGHTS.length - 1; i++) {
    if (h <= HEIGHTS[i + 1]) {
      const t = (h - HEIGHTS[i]) / (HEIGHTS[i + 1] - HEIGHTS[i]);
      return colors[i].map((v, c) => Math.round(v + (colors[i + 1][c] - v) * t));
    }
  }
  return colors[colors.length - 1].slice();
}

// Generate GLSL from the same small table. No texture, uniform, draw or per-frame CPU work added.
const vec = rgb => `vec3(${rgb.map(v => (v / 255).toFixed(9)).join(', ')})`;
const glslRamp = colors => HEIGHTS.slice(0, -1).map((h, i) =>
  `if (h <= ${HEIGHTS[i + 1].toFixed(1)}) return mix(${vec(colors[i])}, ${vec(colors[i + 1])}, (h - ${h.toFixed(1)}) / ${(HEIGHTS[i + 1] - h).toFixed(1)});`
).join('\n');
export const MARINE_WAVE_PALETTE_GLSL = MARINE_WAVE_PALETTE_ENABLED ? `
vec3 marineWaveHeightColor(float height, float theme) {
  float h = clamp(height, 0.0, 10.0);
  if (theme > 1.5) { ${glslRamp(COLORS.beach)} }
  else { ${glslRamp(COLORS.light)} }
  return vec3(1.0);
}
` : '';
export const MARINE_WAVE_PALETTE_CALL_GLSL = MARINE_WAVE_PALETTE_ENABLED
  ? 'if (surfMode < 0.5 && theme > 0.5) return marineWaveHeightColor(h, theme);' : '';

// Same value axis and endpoints as the existing scale; dense colours preserve the 5 m turn.
// Called only for the marine bar: labels/units, raster alphas and every other legend stay intact.
export function marineWaveLegendGradientCSS(scale, theme) {
  if (!hasMarineWavePalette(theme) || scale?.unit !== 'm') return null;
  const lo = scale.breakpoints[0], hi = scale.breakpoints[scale.breakpoints.length - 1];
  const heights = Array.from({ length: 81 }, (_, i) => lo + (hi - lo) * i / 80)
    .concat(HEIGHTS.filter(h => h > lo && h < hi)).sort((a, b) => a - b);
  return `linear-gradient(to right, ${heights.map(h =>
    `rgb(${sampleMarineWavePalette(h, theme).join(',')}) ${((h - lo) / (hi - lo) * 100).toFixed(3)}%`
  ).join(', ')})`;
}
