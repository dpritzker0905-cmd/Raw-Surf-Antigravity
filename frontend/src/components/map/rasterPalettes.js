/**
 * rasterPalettes.js — the app's own colour tables for AIR TEMPERATURE, WATER TEMPERATURE and FOG (2026-11-14).
 *
 * BEFORE. Air temp and water temp drew the tile library's default table (one rainbow from -80 to 50 C for both, the same in
 * every theme), and fog drew near-white greys. As drawn over the basemap: dense fog over land in the light theme stood 0.9
 * (CIEDE2000) from the bare map, i.e. invisible; air temp's 5 C bands fell to 1.2-1.4 for a red-blind viewer; water temp was
 * not monotone in lightness and its 1 C steps fell to 0.85 for a blue-blind viewer.
 *
 * NOW (built in OKLab by scripts/raster-color/design.mjs, checked AS DRAWN over each theme's water and land, in normal vision
 * and three colour-blind simulations, by scripts/raster-color/check.mjs; gates and numbers in
 * docs/weather-program/log/2026-11-14-fable-raster-palettes.md):
 *   - AIR TEMP diverges around 0 C / 32 F: blue to deep violet below, cream through gold and red to magenta above. The
 *     palest colour is the first above freezing (a pale apricot), and the freezing line is the blue / apricot edge itself
 *     (there is no neutral stop: a near-white one sank into the pale light map); lightness falls one way on each side.
 *   - WATER TEMP is sequential: lightness rises with temperature all the way (deep violet-blue to pale gold), the hue turning
 *     as it goes, so each degree is a visible step.
 *   - FOG is a veil whose colour stands off each theme's map (slate over the pale light and beach maps, near-white over the
 *     dark one) and whose opacity carries the emphasis: full below 300 m, a hint at 3 km, nothing from 10 km.
 * THE TABLES ARE GENERATED: change the anchors in design.mjs, run `node scripts/raster-color/design.mjs` (every gate line must
 * pass), then `--emit`. Do not hand-edit a colour here.
 *
 * NO SERVED NUMBER MOVES: only which colour a value is drawn in. The values, units and readouts are untouched.
 * Kills (each restores what was drawn before; read at the next render, e.g. a layer toggle: rasterPaletteKey):
 *   window.__RAW_DISABLE_TEMP_PALETTE__ / __RAW_DISABLE_WATER_TEMP_PALETTE__ / __RAW_DISABLE_FOG_PALETTE__ = true
 */
import { BASE_CUSTOM_COLOR_SCALES, CUSTOM_COLOR_SCALES, smoothColorScale } from './colorScales';

const W = () => (typeof window !== 'undefined' ? window : {});
const AIR_TEMP = {
  type: 'breakpoint', unit: '°C',
  breakpoints: [-80, -40, -39, -38, -37, -36, -35, -34, -33, -32, -31, -30, -29, -28, -27, -26, -25, -24, -23, -22, -21, -20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 50],
  colors: [
    [12, 1, 10, 1], [12, 1, 10, 1], [13, 1, 12, 1], [15, 1, 14, 1], [17, 1, 16, 1], [18, 1, 18, 1], [20, 1, 21, 1], [22, 2, 23, 1],
    [24, 2, 25, 1], [25, 2, 27, 1], [27, 2, 30, 1], [29, 2, 32, 1], [36, 3, 40, 1], [43, 5, 49, 1], [50, 6, 58, 1], [57, 8, 67, 1],
    [65, 10, 77, 1], [70, 15, 90, 1], [76, 19, 104, 1], [82, 23, 119, 1], [88, 26, 134, 1], [94, 30, 149, 1], [92, 36, 163, 1], [90, 41, 178, 1],
    [88, 45, 193, 1], [85, 49, 208, 1], [81, 53, 224, 1], [78, 66, 225, 1], [74, 77, 227, 1], [69, 87, 228, 1], [63, 97, 229, 1], [56, 106, 231, 1],
    [55, 117, 229, 1], [55, 128, 227, 1], [55, 138, 226, 1], [55, 149, 224, 1], [56, 158, 221, 1], [55, 162, 225, 1], [54, 166, 229, 1], [53, 169, 233, 1],
    [51, 173, 237, 1], [50, 175, 239, 1], [250, 228, 191, 1], [249, 227, 184, 1], [249, 225, 178, 1], [247, 221, 164, 1], [246, 218, 150, 1], [245, 214, 135, 1],
    [243, 211, 119, 1], [245, 206, 105, 1], [247, 202, 90, 1], [249, 197, 72, 1], [251, 192, 49, 1], [252, 188, 0, 1], [247, 184, 21, 1], [242, 181, 32, 1],
    [237, 178, 40, 1], [232, 175, 46, 1], [228, 172, 52, 1], [227, 165, 51, 1], [227, 157, 51, 1], [226, 150, 50, 1], [225, 143, 49, 1], [224, 135, 49, 1],
    [222, 128, 48, 1], [219, 122, 47, 1], [216, 115, 46, 1], [214, 108, 45, 1], [211, 101, 44, 1], [209, 92, 42, 1], [208, 83, 41, 1], [206, 74, 39, 1],
    [204, 63, 38, 1], [202, 52, 36, 1], [194, 49, 46, 1], [187, 46, 53, 1], [179, 43, 59, 1], [172, 40, 64, 1], [164, 37, 69, 1], [156, 35, 71, 1],
    [147, 33, 73, 1], [138, 31, 75, 1], [130, 28, 77, 1], [121, 25, 78, 1], [113, 24, 77, 1], [104, 22, 77, 1], [96, 20, 76, 1], [88, 18, 75, 1],
    [80, 15, 74, 1], [80, 15, 74, 1],
  ],
};

const WATER_TEMP = {
  type: 'breakpoint', unit: '°C',
  breakpoints: [-80, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 50],
  colors: [
    [11, 1, 15, 1], [11, 1, 15, 1], [14, 2, 20, 1], [16, 2, 25, 1], [19, 2, 30, 1], [22, 3, 35, 1], [25, 3, 41, 1], [28, 4, 46, 1],
    [27, 9, 65, 1], [26, 14, 84, 1], [22, 18, 105, 1], [15, 22, 126, 1], [13, 39, 121, 1], [15, 51, 116, 1], [20, 62, 111, 1], [27, 71, 105, 1],
    [31, 80, 108, 1], [34, 89, 110, 1], [39, 98, 112, 1], [43, 107, 114, 1], [44, 118, 112, 1], [46, 128, 110, 1], [47, 138, 107, 1], [49, 149, 104, 1],
    [78, 157, 96, 1], [102, 166, 87, 1], [124, 174, 75, 1], [144, 182, 59, 1], [164, 191, 78, 1], [184, 199, 95, 1], [204, 208, 112, 1], [224, 216, 128, 1],
    [233, 225, 159, 1], [242, 233, 188, 1], [244, 236, 201, 1], [246, 240, 213, 1], [248, 243, 225, 1], [250, 247, 237, 1], [250, 247, 237, 1],
  ],
};

const FOG = {
  light: {
    type: 'breakpoint', unit: 'm',
    breakpoints: [0, 62.5, 125, 187.5, 250, 312.5, 375, 437.5, 500, 562.5, 625, 687.5, 750, 812.5, 875, 937.5, 1000, 1125, 1250, 1375, 1500, 1625, 1750, 1875, 2000, 2125, 2250, 2375, 2500, 2625, 2750, 2875, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000],
    colors: [
      [27, 42, 60, 1], [29, 44, 62, 1], [30, 46, 64, 1], [32, 47, 66, 1], [34, 49, 68, 1], [36, 51, 70, 1], [37, 53, 72, 0.97], [39, 55, 74, 0.95],
      [41, 57, 76, 0.92], [43, 59, 78, 0.9], [44, 61, 80, 0.87], [46, 63, 82, 0.85], [48, 65, 84, 0.82], [50, 67, 87, 0.8], [52, 69, 89, 0.77], [53, 71, 91, 0.75],
      [55, 74, 93, 0.72], [56, 74, 93, 0.69], [56, 75, 94, 0.66], [57, 75, 94, 0.63], [58, 76, 95, 0.59], [58, 76, 95, 0.56], [59, 77, 96, 0.53], [59, 78, 96, 0.5],
      [60, 78, 97, 0.47], [61, 79, 97, 0.44], [61, 79, 98, 0.41], [62, 80, 98, 0.38], [62, 80, 99, 0.34], [63, 81, 99, 0.31], [64, 82, 100, 0.28], [64, 82, 100, 0.25],
      [65, 83, 101, 0.22], [67, 85, 103, 0.2], [70, 87, 105, 0.19], [72, 90, 107, 0.17], [74, 92, 109, 0.16], [77, 94, 111, 0.14], [79, 97, 113, 0.13], [82, 99, 115, 0.11],
      [84, 101, 118, 0.09], [87, 104, 120, 0.08], [89, 106, 122, 0.06], [92, 109, 124, 0.05], [94, 111, 126, 0.03], [97, 113, 128, 0.02], [99, 116, 130, 0],
    ],
  },
  beach: {
    type: 'breakpoint', unit: 'm',
    breakpoints: [0, 62.5, 125, 187.5, 250, 312.5, 375, 437.5, 500, 562.5, 625, 687.5, 750, 812.5, 875, 937.5, 1000, 1125, 1250, 1375, 1500, 1625, 1750, 1875, 2000, 2125, 2250, 2375, 2500, 2625, 2750, 2875, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000],
    colors: [
      [34, 47, 63, 1], [36, 49, 65, 1], [37, 51, 67, 1], [39, 53, 69, 1], [41, 54, 71, 1], [43, 56, 73, 1], [44, 58, 75, 0.97], [46, 60, 77, 0.95],
      [48, 62, 79, 0.92], [50, 64, 81, 0.9], [52, 66, 83, 0.87], [53, 68, 85, 0.85], [55, 71, 87, 0.82], [57, 73, 90, 0.8], [59, 75, 92, 0.77], [61, 77, 94, 0.75],
      [63, 79, 96, 0.72], [63, 79, 96, 0.69], [64, 80, 97, 0.66], [64, 80, 97, 0.63], [65, 81, 98, 0.59], [65, 81, 98, 0.56], [66, 82, 99, 0.53], [66, 82, 99, 0.5],
      [67, 83, 100, 0.47], [67, 83, 100, 0.44], [68, 84, 100, 0.41], [68, 84, 101, 0.38], [69, 85, 101, 0.34], [69, 85, 102, 0.31], [70, 86, 102, 0.28], [70, 86, 103, 0.25],
      [71, 87, 103, 0.22], [73, 89, 105, 0.2], [75, 91, 107, 0.19], [77, 93, 109, 0.17], [79, 95, 111, 0.16], [81, 97, 113, 0.14], [83, 99, 115, 0.13], [85, 101, 117, 0.11],
      [87, 103, 119, 0.09], [89, 105, 121, 0.08], [91, 107, 123, 0.06], [93, 109, 124, 0.05], [95, 112, 126, 0.03], [97, 114, 128, 0.02], [99, 116, 130, 0],
    ],
  },
  dark: {
    type: 'breakpoint', unit: 'm',
    breakpoints: [0, 62.5, 125, 187.5, 250, 312.5, 375, 437.5, 500, 562.5, 625, 687.5, 750, 812.5, 875, 937.5, 1000, 1125, 1250, 1375, 1500, 1625, 1750, 1875, 2000, 2125, 2250, 2375, 2500, 2625, 2750, 2875, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000],
    colors: [
      [239, 246, 251, 1], [238, 245, 251, 1], [237, 245, 250, 1], [236, 244, 249, 1], [235, 243, 249, 1], [234, 242, 248, 1], [233, 241, 247, 0.97], [232, 241, 247, 0.95],
      [231, 240, 246, 0.92], [230, 239, 246, 0.9], [229, 238, 245, 0.87], [228, 237, 244, 0.85], [227, 237, 244, 0.82], [226, 236, 243, 0.8], [225, 235, 242, 0.77], [224, 234, 242, 0.75],
      [223, 233, 241, 0.72], [223, 233, 241, 0.69], [223, 233, 241, 0.66], [223, 233, 241, 0.63], [223, 233, 241, 0.59], [223, 233, 240, 0.56], [223, 233, 240, 0.53], [222, 232, 240, 0.5],
      [222, 232, 240, 0.47], [222, 232, 240, 0.44], [222, 232, 240, 0.41], [222, 232, 240, 0.38], [222, 232, 239, 0.34], [222, 232, 239, 0.31], [221, 232, 239, 0.28], [221, 231, 239, 0.25],
      [221, 231, 239, 0.22], [221, 231, 238, 0.2], [220, 230, 238, 0.19], [220, 230, 237, 0.17], [219, 229, 237, 0.16], [218, 229, 236, 0.14], [218, 228, 236, 0.13], [217, 227, 235, 0.11],
      [217, 227, 234, 0.09], [216, 226, 234, 0.08], [216, 226, 233, 0.06], [215, 225, 233, 0.05], [215, 225, 232, 0.03], [214, 224, 232, 0.02], [214, 224, 231, 0],
    ],
  },
};

// The key each layer's scale is looked up under by the tile library (variable prefix), and its kill.
export const RASTER_PALETTE_LAYERS = {
  temperature: { key: 'temperature', kill: '__RAW_DISABLE_TEMP_PALETTE__' },
  water_temp: { key: 'surface_temperature', kill: '__RAW_DISABLE_WATER_TEMP_PALETTE__' },
  fog: { key: 'visibility', kill: '__RAW_DISABLE_FOG_PALETTE__' },
};
const themeOf = (theme) => (theme === 'light' || theme === 'beach' ? theme : 'dark');

export const rasterPaletteOn = (layerId) => !!RASTER_PALETTE_LAYERS[layerId] && W()[RASTER_PALETTE_LAYERS[layerId].kill] !== true;

/**
 * The state of the four kills as one string. Put it in the dependencies of everything that reads them (the effect that
 * registers the tables, the legend's memo), so the map and its bar change on the SAME render when a kill is set or cleared:
 * found by the red team 2026-11-14, a kill set in the console moved one and not the other until the theme changed.
 */
/**
 * A tag for a layer's TILE URL, so a tile coloured with one table is never reused under another. The tile library colours a
 * tile when it decodes it and the map keeps the coloured tile by URL: registering a different table does not repaint what is
 * already there (seen 2026-11-14: a kill set in the console put the old bar back while the map kept the new colours). The tag
 * says which table the tile was coloured with: 'p' (the generated palette) or 'o' (what was drawn before), and for fog the
 * theme, because fog's colour is per theme while the URL's own `dark=true` is the same for dark and beach.
 * `variable` is the tile variable; '' for any variable that is not one of the three.
 */
const VARIABLE_LAYER = { temperature_2m: 'temperature', surface_temperature: 'water_temp', visibility: 'fog' };
export function rasterPaletteUrlTag(variable, theme) {
  const layerId = VARIABLE_LAYER[variable];
  if (!layerId) return '';
  const on = rasterPaletteOn(layerId);
  return `&rp=${on ? 'p' : 'o'}${on && layerId === 'fog' ? themeOf(theme)[0] : ''}`;
}

export const rasterPaletteKey = () => ['temperature', 'water_temp', 'fog'].map((id) => (rasterPaletteOn(id) ? '1' : '0')).join('')
  + (W().__RAW_DISABLE_RASTER_LEGENDS__ === true ? 'L0' : 'L1') + (rasterLegendSwatchOn() ? 'S1' : 'S0');

/** The table drawn for a layer in a theme when its palette is on (the generated one). */
export function rasterPalette(layerId, theme) {
  if (layerId === 'temperature') return AIR_TEMP;
  if (layerId === 'water_temp') return WATER_TEMP;
  if (layerId === 'fog') return FOG[themeOf(theme)];
  return null;
}

// What the tile library (or the app, for fog) drew before, kept so a kill can put it back.
const before = {};
/** Call once with the library's default scales, BEFORE the app's custom scales are merged into them. */
export function rememberLibraryRasterScales(libraryScales) {
  if (!libraryScales) return;
  if (!before.temperature && libraryScales.temperature) before.temperature = libraryScales.temperature;
  if (!before.surface_temperature) before.surface_temperature = libraryScales.surface_temperature || libraryScales.sea_surface_temperature || null;
}
const fogBefore = () => smoothColorScale(BASE_CUSTOM_COLOR_SCALES.visibility, 80);

/**
 * PURE: the table a layer draws in a theme right now: the generated one, or, under the layer's kill, what was drawn before
 * (fog: the app's grey table; air / water temp: the tile library's own, once remembered; null before that).
 * Reads no registry and no effect's result, so a caller that has the theme (the own-frames hook) gets the right table whatever
 * order the theme effects run in. `layerId` is 'temperature' | 'water_temp' | 'fog'.
 */
export function rasterScaleFor(layerId, theme) {
  const layer = RASTER_PALETTE_LAYERS[layerId];
  if (!layer) return null;
  if (rasterPaletteOn(layerId)) return rasterPalette(layerId, theme);
  return layerId === 'fog' ? fogBefore() : (before[layer.key] || null);
}

/**
 * Put each layer's scale for this theme where the tile library and the own-frames path read it: CUSTOM_COLOR_SCALES and,
 * when the protocol is registered, its live settings. A layer under its kill gets back what was drawn before.
 * Returns { layerId: 'palette' | 'before' | 'library-untouched' } (telemetry: window.__RAW_RASTER_PALETTES__).
 */
export function applyThemeRasterScales(theme) {
  const live = W().__OM_PROTOCOL_SETTINGS__ && W().__OM_PROTOCOL_SETTINGS__.colorScales;
  const state = {};
  for (const [layerId, { key }] of Object.entries(RASTER_PALETTE_LAYERS)) {
    const scale = rasterScaleFor(layerId, theme);
    const how = rasterPaletteOn(layerId) ? 'palette' : (scale ? 'before' : 'library-untouched');
    if (scale) { CUSTOM_COLOR_SCALES[key] = scale; if (live) live[key] = scale; }
    else delete CUSTOM_COLOR_SCALES[key];           // nothing remembered yet: leave the library's own in place
    state[layerId] = how;
  }
  W().__RAW_RASTER_PALETTES__ = { theme: themeOf(theme), ...state };
  return state;
}

// ── LEGENDS: computed from the table that is drawn, so the bar cannot disagree with the map. ───────────────────────────────
// THE SWATCH (2026-11-14). A bar is the table's colours at the table's own alpha. On the weather panel that hid the fog bar
// in the beach theme: slate fading to clear on a near-black panel. So each bar is drawn over a swatch of the MAP'S OWN water
// colour in that theme, as a second, solid background layer under the gradient: the bar then shows what the layer looks like
// on the map. Water, not land: it is the surface a surf map always shows, and the light theme's land is white on a white
// panel. The colours were sampled from the bare basemap in the app (the most common pixel over open ocean, 96-97% of the
// patch; docs/weather-program/log/2026-11-14-fable-raster-legend-swatch.md). They are NOT the wind check's colours, which
// describe the map as muted under the wind layer.
// Kill: window.__RAW_DISABLE_RASTER_LEGEND_SWATCH__ = true (the bar straight on the panel, as before).
export const MAP_WATER = { light: [144, 223, 254], beach: [117, 207, 240], dark: [93, 117, 126] };
export const rasterLegendSwatchOn = () => W().__RAW_DISABLE_RASTER_LEGEND_SWATCH__ !== true;
const cToF = (c) => c * 9 / 5 + 32;
const fToC = (f) => (f - 32) * 5 / 9;
function sampleScale(scale, v) {
  const b = scale.breakpoints; const c = scale.colors;
  if (v <= b[0]) return c[0];
  if (v >= b[b.length - 1]) return c[c.length - 1];
  let i = 0; while (v > b[i + 1]) i += 1;
  const t = (v - b[i]) / (b[i + 1] - b[i]);
  return [0, 1, 2, 3].map((k) => (k < 3 ? Math.round(c[i][k] + (c[i + 1][k] - c[i][k]) * t) : +(c[i][k] + (c[i + 1][k] - c[i][k]) * t).toFixed(3)));
}
// What each legend bar spans and the values it names. Fog runs from dense to clear; its bar is spaced by the LOG of visibility
// so the range that matters (under 1 km) gets half the bar.
export const RASTER_LEGEND_SPEC = {
  temperature: { from: fToC(-10), to: fToC(110), ticksF: [-10, 10, 32, 50, 70, 90, 110], samples: 48 },
  water_temp: { from: fToC(35), to: fToC(90), ticksF: [35, 45, 55, 65, 75, 85], samples: 48 },
  fog: { from: 100, to: 10000, ticksM: [[100, '<100 m'], [300, '300 m'], [1000, '1 km'], [3000, '3 km'], [10000, 'Clear']], samples: 32, log: true },
};

/**
 * { gradientCSS, stops: [{ label, pct }], unit } for a layer's legend bar in a theme, from the table that is drawn; null when
 * the layer's palette is off (the caller keeps its own bar, which is the bar of the table then drawn), the legend kill
 * window.__RAW_DISABLE_RASTER_LEGENDS__ is set, or the layer is not one of the three.
 * `tempUnit` 'F' (default, as the app labels its temperature legends) or 'C'.
 */
export function rasterLegend(layerId, theme, tempUnit = 'F') {
  const spec = RASTER_LEGEND_SPEC[layerId];
  if (!spec || !rasterPaletteOn(layerId) || W().__RAW_DISABLE_RASTER_LEGENDS__ === true) return null;
  const scale = rasterPalette(layerId, theme);
  const pos = (v) => (spec.log ? (Math.log(v) - Math.log(spec.from)) / (Math.log(spec.to) - Math.log(spec.from)) : (v - spec.from) / (spec.to - spec.from));
  const val = (t) => (spec.log ? Math.exp(Math.log(spec.from) + t * (Math.log(spec.to) - Math.log(spec.from))) : spec.from + t * (spec.to - spec.from));
  const parts = [];
  for (let i = 0; i <= spec.samples; i += 1) {
    const t = i / spec.samples; const c = sampleScale(scale, val(t));
    parts.push(`rgba(${c[0]},${c[1]},${c[2]},${c[3]}) ${(t * 100).toFixed(1)}%`);
  }
  const stops = layerId === 'fog'
    ? spec.ticksM.map(([m, label]) => ({ label, pct: +(pos(m) * 100).toFixed(2) }))
    : spec.ticksF.map((f, i, all) => {
      const shown = tempUnit === 'C' ? Math.round(fToC(f)) : f;
      return { label: `${shown}°${i === all.length - 1 ? '+' : ''}`, pct: +(pos(fToC(f)) * 100).toFixed(2) };
    });
  const swatch = rasterLegendSwatchOn() ? MAP_WATER[themeOf(theme)] : null;
  // two background layers in one value: the gradient, and under it the solid swatch (a colour is allowed as the last layer)
  const gradientCSS = `linear-gradient(to right, ${parts.join(', ')})${swatch ? `, rgb(${swatch.join(', ')})` : ''}`;
  return { gradientCSS, stops, unit: layerId === 'fog' ? 'm' : `°${tempUnit === 'C' ? 'C' : 'F'}`, swatch };
}
export const __test = { AIR_TEMP, WATER_TEMP, FOG, sampleScale, cToF, fToC };
