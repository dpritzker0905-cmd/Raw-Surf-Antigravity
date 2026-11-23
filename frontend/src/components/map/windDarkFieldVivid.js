/**
 * DARK'S WIND FIELD LANDS AT THE STRENGTH IT WAS DESIGNED AT (2026-11-22, owner David: "Yes, fix it").
 *
 * HEATMAP_FS (WebGLWindShaders.js) writes dark's field PREMULTIPLIED, vec4(fieldRgb * a, a), and the engine blended it with
 * SRC_ALPHA, ONE_MINUS_SRC_ALPHA, which multiplies the colour by a a second time: the screen held c a^2 + map (1 - a), a dim
 * veil (read back on a GPU by scripts/wind-color/dark-field-gpu.mjs, #1196). Every dark target was designed in the alpha-over
 * law c a + map (1 - a): the 7 kn tint off water (14.5 dE00 designed, 9.0 drawn; floor 14), the 0-3 kn hue gap (35 deg vs 4.9;
 * floor 18), calm visibility (26 vs 20; floor 24) and the colour-blind pairs over water (8 of 11 under 5 dE00 drawn).
 *
 * The fix is the blend's source factor alone: a premultiplied colour is blended ONE, ONE_MINUS_SRC_ALPHA, so the screen holds
 * c a + map (1 - a), the law the palette was tuned in. No colour, alpha or opacity changes; dark only (light and beach draw their
 * field as a multiply tint, and any theme without that tint keeps SRC_ALPHA, byte-identical). The canvas's alpha is still the
 * map's own (windCanvasAlpha.blendIntoMap).
 *
 * The Gusts layer in dark matches this field (gustPalette.js DARK FIELD PARITY): its LUT stops pre-scaling the colour by the
 * wind's alpha while this is on, so a gust of N kn still lands as a wind of N kn.
 *
 * Kill: window.__RAW_DISABLE_DARK_WIND_VIVID__ = true (the wind field reads it each frame; the gust LUT when it is built, i.e.
 * a reload or a theme change), which puts back the SRC_ALPHA blend and the squared law exactly.
 */
export const WIND_DARK_VIVID_KILL = '__RAW_DISABLE_DARK_WIND_VIVID__';

/** Whether dark's wind field is laid by the premultiplied (designed) law: dark only, on unless the kill is set to true. */
export function windDarkVividOn(theme, win = (typeof window !== 'undefined' ? window : null)) {
  return theme === 'dark' && !(win && win.__RAW_DISABLE_DARK_WIND_VIVID__ === true);
}

/** The colour source factor for the wind field's non-tint pass: ONE for dark (premultiplied colour), else SRC_ALPHA as before. */
export function windFieldSrcFactor(gl, theme, win = (typeof window !== 'undefined' ? window : null)) {
  return windDarkVividOn(theme, win) ? gl.ONE : gl.SRC_ALPHA;
}
