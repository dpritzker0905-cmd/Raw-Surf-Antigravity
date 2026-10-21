// Marine HEIGHT wash only (light + beach). Dark, surf quality, crest colours, motion and wind keep their own paths.
// Kills, set before page load, then reload so the GLSL and the legend switch together:
//   window.__RAW_DISABLE_MARINE_WAVE_PALETTE__ = true -> the shader's own ramp (before 2026-10-14)
//   window.__RAW_DISABLE_WAVE_PALETTE_V2__ = true     -> v1, the 2026-10-14 table, exactly, in both themes
//   window.__RAW_DISABLE_WAVE_HEIGHT_16M__ = true     -> the 10 m encoding and v2 capped there, exactly (#411)
//   window.__RAW_DISABLE_WAVE_BEACH_V1__ = true       -> beach draws v2 (and its 16 m row when that is on) (D-035's kill)
//   window.__RAW_DISABLE_WAVE_SPECTRUM__ = true       -> light draws v2 at 16 m exactly (D-037's kill: table, shader, legend)
// LIGHT DRAWS THE SPECTRUM (owner 2026-10-21, DECISIONS D-037: "I like the proposed light mode", then "make sure we have the best
// and widest spectrum of color on this scheme"): seven colour steps on the WMO/Douglas sea-state breaks (0.5 1.25 2.5 4 6 9 14 m,
// 1.6 4 8 13 20 30 46 ft), lightness falling at every step AS DRAWN, the widest hue sweep and chroma the map can show (solved over
// light water at world opacity; research report "Wave height heatmap colour spectrum", 2026-10-20). Two shader terms come with it,
// light only (withWaveSpectrum): the wash grows denser with height (opacity 0.65 -> 0.80 at world zoom) and fades into the water
// below 0.5 m instead of blending from the sea floor colour. Dark and beach draw exactly what they drew.
// BEACH DRAWS v1 (owner 2026-10-20, DECISIONS D-035: "I really like v1 color scheme heatmap for Beach mode. How do we stick with
// that?"); light draws v2 (D-033, at 16 m by D-034). Beach's colours are pinned byte for byte in marineWavePalette.test.js: changing
// them needs a new owner decision, whatever another session's palette work proposes. v1 has no 16 m row, so beach keeps the 10 m
// encoding (marineWaveHeightScale reads the theme's own table).
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
  // candidate B (aqua -> cerulean -> orchid -> rose -> brick; a violet flag above the cap): what beach draws only under D-035's kill
  // (beach draws v1, owner 2026-10-20). Solved by wave-solve.mjs, finished by
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
  // The spectrum (D-037), light only: source colours at the sea-state breaks, solved (2026-10-21) so that lightness falls at every step
  // on the table itself AND as drawn over light water (144,223,254) at world, regional and coastal opacity (each rising with log height)
  // under every swell lighting, with the widest hue sweep and chroma the map can show: teal -> azure -> blue -> violet -> magenta ->
  // crimson -> dark brown as drawn. Under 0.5 m the colour holds and the wash fades out; 14 m and above hold the top colour, so 14 m is
  // also the encoder's ceiling for light (finer steps than 16). Linear in encoded sRGB per band, like every table.
  spectrum: {
    // `ticks` are the seven breaks (the legend's, and the checker's neighbours). 4.5, 5 and 5.5 m are blend-only anchors on the OKLab line
    // from violet to magenta: that band turns far in hue for little lightness, and a plain sRGB blend dipped and climbed back (0.013
    // OKLCH L); violet's blue is trimmed so full swell lighting cannot clip it (spectrum-tune.mjs, frontend/scripts/wind-color/).
    heights: [0, 0.5, 1.25, 2.5, 4, 4.5, 5, 5.5, 6, 9, 14], ticks: [0, 0.5, 1.25, 2.5, 4, 6, 9, 14], cap: 14, over: null, spectrum: true,
    light: [[0, 202, 144], [0, 202, 144], [0, 156, 222], [80, 109, 246], [128, 60, 235], [142, 58, 206], [156, 52, 176], [169, 38, 147],
      [181, 0, 118], [164, 0, 26], [90, 20, 0]],
  },
};
// The spectrum's opacity law (the GLSL below mirrors it): from `alpha` (the pass's zoom opacity) toward 1 by SPECTRUM_LIFT of the gap,
// linear in log height from 0.5 to 6 m (0.65 -> 0.80 at world zoom), times a fade to 0 under 0.5 m.
export const SPECTRUM_LIFT = 0.15 / 0.35;
export function spectrumAlpha(alpha, h) {
  const t = Math.min(1, Math.max(0, Math.log(Math.max(h, 0.5) / 0.5) / Math.log(12))), u = Math.min(1, Math.max(0, h / 0.5));
  return (alpha + (1 - alpha) * SPECTRUM_LIFT * t) * u * u * (3 - 2 * u);
}
// The 16 m encoding (2026-10-20): one more anchor at the new ceiling and the above-cap state moved up to it. Every anchor under
// 10 m is the table above, unchanged; only the encoder's 8-bit step widens (10/255 -> 16/255 m). Solved against the fixed ramp by
// wave-polish.mjs --extend 16, judged by wave-check.mjs (v2@16). The kill (window.__RAW_DISABLE_WAVE_HEIGHT_16M__) draws v2 above.
export function widenWavePalette(p) {
  if (!p.h16) return p;
  return { heights: [...p.heights, p.h16.cap], cap: p.h16.cap, light: [...p.light, p.h16.light], beach: [...p.beach, p.h16.beach], over: p.h16.over };
}

/** The table a theme draws: the spectrum in light (D-037; v2 under its kill or the 16 m kill, which is #411 exactly), v1 in beach
 *  (D-035), v1 in both under the V2 kill. */
export function resolveWavePalette(win = WIN, theme = 'light') {
  if (win.__RAW_DISABLE_WAVE_PALETTE_V2__ === true) return 'v1';
  if (theme === 'beach') return win.__RAW_DISABLE_WAVE_BEACH_V1__ !== true ? 'v1' : 'v2';
  return win.__RAW_DISABLE_WAVE_SPECTRUM__ !== true && win.__RAW_DISABLE_WAVE_HEIGHT_16M__ !== true ? 'spectrum' : 'v2';
}
export const MARINE_WAVE_PALETTE_IDS = { light: resolveWavePalette(WIN, 'light'), beach: resolveWavePalette(WIN, 'beach') };
export const MARINE_WAVE_PALETTE_ID = MARINE_WAVE_PALETTE_IDS.light;
const tableOf = id => (WAVE_HEIGHT_16M ? widenWavePalette(WAVE_PALETTES[id]) : WAVE_PALETTES[id]);   // v1 has no 16 m row: unchanged
const PAL = { light: tableOf(MARINE_WAVE_PALETTE_IDS.light), beach: tableOf(MARINE_WAVE_PALETTE_IDS.beach) };
export const paletteFor = theme => PAL[theme] || PAL.light;

export function hasMarineWavePalette(theme) {
  return MARINE_WAVE_PALETTE_ENABLED && (theme === 'light' || theme === 'beach');
}

/** The metres the encoder's 255 means for an upload drawn in `theme`: the table's cap where this table draws the wash and reaches
 *  past the legacy ceiling (light/beach, v2, 16 m on), else 10. Dark keeps 10 on purpose: a /16 step moves its calm water ~4.7 dE00. */
export function marineWaveHeightScale(theme) {
  const p = paletteFor(theme);   // per theme (D-035): beach's v1 stays at 10 m while light's v2 reads to 16 m
  return hasMarineWavePalette(theme) && p.cap > ENCODED_MAX ? p.cap : ENCODED_MAX;
}

/** The table's colour at `height` metres (rounded RGB). Above the cap, the palette's own above-cap colour when it has one. */
export function sampleMarineWavePalette(height, theme, p = paletteFor(theme)) {
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
// Each theme's branch draws its own table (pb: beach, pl: light). With one table, or two with the same cap, the text is exactly the
// one-table text; a branch whose cap is lower than the other's clamps again at its own cap (beach v1 at 10 m beside light at 16 m:
// a frame encoded for light and drawn in beach then reads beach's 10 m colour, never the fall-through white).
const capGlsl = (p, top) => (p.cap < top ? `h = min(h, ${num(p.cap)}); ` : '');
export const marineWavePaletteGlsl = (pl, pb = pl) => `
vec3 marineWaveHeightColor(float height, float theme) {
  float h = clamp(height, 0.0, ${num(Math.max(pl.cap, pb.cap))});
  if (theme > 1.5) { ${capGlsl(pb, Math.max(pl.cap, pb.cap))}${overGlsl(pb, 'beach')}${glslRamp(pb.heights, pb.beach)} }
  else { ${capGlsl(pl, Math.max(pl.cap, pb.cap))}${overGlsl(pl, 'light')}${glslRamp(pl.heights, pl.light)} }
  return vec3(1.0);
}
`;
export const MARINE_WAVE_SPECTRUM = MARINE_WAVE_PALETTE_ENABLED && !!PAL.light.spectrum;
const SPECTRUM_ALPHA_GLSL = `float marineWaveSpectrumAlpha(float alpha, float h, float theme) {
  if (theme < 0.5 || theme > 1.5) return alpha;
  float t = clamp(log(max(h, 0.5) / 0.5) / log(12.0), 0.0, 1.0);
  return (alpha + (1.0 - alpha) * ${num(SPECTRUM_LIFT)} * t) * smoothstep(0.0, 0.5, h);
}
`;
export const MARINE_WAVE_PALETTE_GLSL = MARINE_WAVE_PALETTE_ENABLED
  ? marineWavePaletteGlsl(PAL.light, PAL.beach) + (MARINE_WAVE_SPECTRUM ? SPECTRUM_ALPHA_GLSL : '') : '';
// HEATMAP_FS = withHeightScale(withWaveSpectrum(<template>), ...): with the spectrum on, light's wash skips the sea-floor blend and takes
// the spectrum's opacity; dark and beach evaluate exactly what they did. Under its kill the string comes back as it went in. Throws at
// load if the shader moved (each anchor exactly once), so the rewrite can never half-apply.
const SPECTRUM_FLOOR = '  float waveBlend = smoothstep(0.0, 0.18, displayHeight);\n', SPECTRUM_OPACITY = '  float alpha = u_opacity;\n';
export function withWaveSpectrum(src) {
  if (!MARINE_WAVE_SPECTRUM) return src;
  if (src.split(SPECTRUM_FLOOR).length !== 2 || src.split(SPECTRUM_OPACITY).length !== 2) throw new Error('withWaveSpectrum: expected one floor blend and one opacity line');
  return src.replace(SPECTRUM_FLOOR, '  float waveBlend = (u_theme > 0.5 && u_theme < 1.5) ? 1.0 : smoothstep(0.0, 0.18, displayHeight);   // light spectrum: no sea-floor blend (D-037)\n')
    .replace(SPECTRUM_OPACITY, '  float alpha = marineWaveSpectrumAlpha(u_opacity, displayHeight, u_theme);   // light spectrum: denser with height, faded under 0.5 m\n');
}
export const MARINE_WAVE_PALETTE_CALL_GLSL = MARINE_WAVE_PALETTE_ENABLED
  ? 'if (surfMode < 0.5 && theme > 0.5) return marineWaveHeightColor(h, theme);' : '';

// v1's legend: the same value axis and endpoints as the existing scale; dense colours preserve the 5 m turn.
// Called only for the marine bar: labels/units, raster alphas and every other legend stay intact.
export function marineWaveLegendGradientCSS(scale, theme) {
  if (!hasMarineWavePalette(theme) || scale?.unit !== 'm') return null;
  const lo = scale.breakpoints[0], hi = scale.breakpoints[scale.breakpoints.length - 1];
  const heights = Array.from({ length: 81 }, (_, i) => lo + (hi - lo) * i / 80)
    .concat(paletteFor(theme).heights.filter(h => h > lo && h < hi)).sort((a, b) => a - b);
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
  const P = paletteFor(theme);
  if (P.spectrum) return spectrumLegend(P, theme, heightUnit);
  if (!P.over) return { gradientCSS: marineWaveLegendGradientCSS(scale, theme) };   // v1 (beach): its scale's own axis and ticks
  const H = P.heights, end = 100 - ARROW_PCT, at = i => (i / (H.length - 1)) * end;
  const stops = H.map((h, i) => `rgb(${P[theme][i].join(',')}) ${at(i).toFixed(3)}%`);
  const over = `rgb(${P.over[theme].join(',')})`;
  const gradientCSS = `linear-gradient(to right, ${stops.join(', ')}, ${over} ${end}%, ${over} 100%)`;
  const label = h => { const v = heightUnit === 'm' ? h : h * M_TO_FT; return v < 1 ? v.toFixed(1) : `${Math.round(v)}`; };
  const ticks = H.map((h, i) => ({ label: i === H.length - 1 ? `${label(h)}+` : label(h), pct: at(i) }));
  return { gradientCSS, stops: ticks, clipPath: `polygon(0 0, ${end}% 0, 100% 50%, ${end}% 100%, 0 100%)` };
}

// The spectrum's legend (D-037): a ruler, one equal share per sea-state band with the band's own gradient inside (linear in height, as
// the GLSL mix() is), coloured AS DRAWN: composited over light water at world opacity with the spectrum's opacity law, so the bar shows
// the map's colours rather than opaque swatches (which overstate the separation ~1.15-1.5x). 0 is the faded calm: the water itself.
const SPECTRUM_WATER = [144, 223, 254];
function spectrumLegend(P, theme, heightUnit) {
  const H = P.ticks || P.heights, n = H.length - 1, at = (i) => (i / n) * 100;
  const drawn = (h) => { const c = sampleMarineWavePalette(h, theme, P), a = spectrumAlpha(0.65, h); return c.map((v, k) => Math.round(a * v + (1 - a) * SPECTRUM_WATER[k])); };
  const stops = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < 8; k++) { const u = k / 8, h = H[i] + u * (H[i + 1] - H[i]); stops.push(`rgb(${drawn(h).join(',')}) ${((i + u) / n * 100).toFixed(3)}%`); }
  stops.push(`rgb(${drawn(H[n]).join(',')}) 100%`);
  const label = (h) => { const v = heightUnit === 'm' ? h : h * M_TO_FT; return heightUnit === 'm' ? `${h}` : v < 3 ? `${+v.toFixed(1)}` : `${Math.round(v)}`; };
  return { gradientCSS: `linear-gradient(to right, ${stops.join(', ')})`, stops: H.map((h, i) => ({ label: i === n ? `${label(h)}+` : label(h), pct: at(i) })) };
}
