/**
 * gustPalette.js — the Gusts layer's colours (2026-11-15). ONE palette with the wind layer, never a second one.
 *
 * The owner (2026-11-15): "mirroring the existing wind theme colors for wind gusts, will emphasise how much faster the gusts are
 * because they will show those faster wind colors to the user in the similar reference". So a 40 kn gust takes EXACTLY the
 * colour the wind HEATMAP gives 40 kn in that theme: the wind field's table as drawn (WindColorRamp.resolveDrawnField: dark's
 * rules field, light's and beach's own field ramps and paths), walked on the same hue path the wind field texture is built with
 * (huePathStops). Those tables carry the wind lane's colour-blind passes (windPaletteCvd.test.js, scripts/wind-color/check.mjs),
 * so gusts inherit them. The legend bar is built from the SAME stops, value-proportional, so it cannot disagree with the map.
 *
 * Units: knots, the wind layer's unit ('Wind Speed (kts)'); the frames store knots (frame_set_raster.py `gust*`). Above the
 * table's top (75 kn, hurricane force) the last colour holds, as the wind field does.
 */
import { huePathStops, resolveDrawnField, resolveThemeRamp, sampleRamp, windLegendStops } from './WindColorRamp';
import { WIND_FIELD_OPACITY } from './gustParticles';

export const GUST_LUT = { min: 0, step: 0.5, n: 151 };   // 0..75 kn every 0.5 kn: finer than any colour change of the table

/** The wind heatmap's stops for a theme, as the wind field texture is built from them (a theme with no field table of its
 *  own, dark with its rules off, samples the particle ramp: WindColorRamp.buildFieldRampTexture's null). */
export function gustStops(theme, win) {
  return huePathStops(resolveDrawnField(theme, win) || resolveThemeRamp(theme), win);
}

/**
 * GENTLER FAST BAND, LIGHT ONLY (2026-11-18, David picked "Gentler fast band" after light-mode gusts read "too dark pink in
 * areas"). Light's wind field descends steadily in lightness with speed (#307, "candidate A", D-018: x1.83 dark's strength at
 * 75 kn), tuned on WIND, which rarely passes 40 kn. Gusts routinely run 45-75 kn, so the field's darkest maroon-to-purple band
 * covered whole regions. Above 40 kn the gust field keeps the SAME hues and the same order as the wind field (faster =
 * darker, give or take light's own small rise at 40-45 kn) but descends at HALF its slope: each knot's alpha is scaled so its
 * composite L* (the multiply tint on light's ground model below, at the wind field's alpha law) = L40 + (L - L40) / 2
 * (pinned in gustsLayer.test.js against the table, not as fixed numbers). The browser A/B that found the pink regions were
 * CALM air, not fast, is under WIND_FIELD_ALPHA below.
 * Gusts and Wind differ only above 40 kn and only in light. Kill: window.__RAW_DISABLE_GUST_LIGHT_FASTBAND__ = true.
 */
export const GUST_LIGHT_FASTBAND = Object.freeze({ fromKn: 40, slope: 0.5, ground: [0.86, 0.89, 0.92], tint: 0.70 });
const lstar = (rgb) => {
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return 116 * (Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116) - 16;
};
/** Light's composite L* of a field colour at alpha a (the wind field's multiply law on the model ground). */
export function lightCompositeL(c, a) {
  const { ground, tint } = GUST_LIGHT_FASTBAND;
  const t = Math.min(1, Math.max(0, a * tint));
  return lstar([0, 1, 2].map((i) => ground[i] * (1 - t + t * c[i])));
}
export function gustLightFastbandOn(theme, win = (typeof window !== 'undefined' ? window : null)) {
  return theme === 'light' && !(win && win.__RAW_DISABLE_GUST_LIGHT_FASTBAND__ === true);
}
/**
 * THE WIND FIELD'S ALPHA LAW (2026-11-18, the root of light's "too dark pink"). The wind HEATMAP never reads its ramp's alpha
 * channel: HEATMAP_FS draws alpha = opacity x (base + (1 - base) x smoothstep(0, rampEnd, speed)), so calm air is laid at 42%
 * (light) of full and reaches full by 7 kn. The gust LUT took the ramp's own alpha instead (0.72 at calm, 0.95 at 75 kn), so
 * calm gusts drew ~1.7x the wind's calm, and light's calm colour is a rose-pink: the pink regions (measured: the same frame with
 * and without the gentler fast band read 0.311 / 0.304, i.e. those regions were calm, not fast). On the TINTED themes (light,
 * beach: the gust raster already composites by the wind field's multiply law, gustParticles.gustFieldTint) the gust field now
 * takes this law exactly. Dark takes it too, with its blend, under DARK FIELD PARITY below (2026-11-22). Kill: window.__RAW_DISABLE_GUST_WIND_ALPHA__ = true.
 */
export const WIND_FIELD_ALPHA = Object.freeze({ dark: [0.44, 5], light: [0.42, 7], beach: [0.45, 7] });   // HEATMAP_FS v3.22
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export function gustWindAlphaOn(theme, win = (typeof window !== 'undefined' ? window : null)) {
  return (theme === 'light' || theme === 'beach') && !(win && win.__RAW_DISABLE_GUST_WIND_ALPHA__ === true);
}
/** The field's alpha at `kn` before the fast band: the wind field's law on tinted themes, else the table's own. */
export function gustBaseAlpha(theme, kn, c, win) {
  if (!gustWindAlphaOn(theme, win)) return c[3];
  const [base, rampEnd] = WIND_FIELD_ALPHA[theme];
  return base + (1 - base) * smooth(0, rampEnd, kn);
}

/** The alpha a gust field colour at `kn` draws with: the base alpha, and above 40 kn in light the gentler band's. */
export function gustAlpha(theme, stops, kn, c, win) {
  const { fromKn, slope } = GUST_LIGHT_FASTBAND;
  const a0 = gustBaseAlpha(theme, kn, c, win);
  if (!gustLightFastbandOn(theme, win) || kn <= fromKn) return a0;
  const c40 = sampleRamp(stops, fromKn);
  const L40 = lightCompositeL(c40, gustBaseAlpha(theme, fromKn, c40, win));
  const want = L40 + (lightCompositeL(c, a0) - L40) * slope;
  let lo = 0; let hi = a0;                          // composite L* falls as alpha rises: bisect on alpha
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (lightCompositeL(c, mid) > want) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/**
 * DARK FIELD PARITY (2026-11-22, David: the gust animation's colours do not match Wind's look across the themes). Light and beach
 * already lay the gust field exactly as the wind field (the tint and the alpha law above). Dark did not, for two reasons:
 *  1. The wind HEATMAP writes PREMULTIPLIED colour (rgb x a, a) and blends it with SRC_ALPHA, ONE_MINUS_SRC_ALPHA
 *     (WebGLWindEngine render, HEATMAP_FS's last line), so dark's wind field lands as rgb x a^2 + map x (1 - a): a dim veil
 *     that darkens the map and carries its colour at a squared strength. The gust raster lands through MapLibre's premultiplied
 *     blend as rgb x a + map x (1 - a): about twice the wind's colour at speed (0.48 vs 0.23) and ten times at calm.
 *  2. Its alpha was the table's own (0.72-0.95) x GUST_OPACITY_STOPS (0.50-0.62), not the wind's 0.48 x (0.44 -> 1 by 5 kn):
 *     calm gusts drew 0.42-0.48 against the wind's 0.21, and dark's calm colour is a vivid magenta.
 * With it on, the dark gust LUT holds rgb x a_wind with alpha = the wind's law, and the layer draws at the wind field's own
 * opacity (0.48, gustFieldOpacity) at every zoom: alpha = a_wind and colour = rgb x a_wind^2, the wind field's composite to the
 * byte (pinned in gustsLayer.test.js). The legend bar is unchanged (it shows the colours, as the wind legend does).
 * Kill: window.__RAW_DISABLE_GUST_DARK_FIELD__ = true (read when the gust LUT is built: a reload or a theme change).
 */
export function gustDarkFieldOn(theme, win = (typeof window !== 'undefined' ? window : null)) {
  return theme === 'dark' && !(win && win.__RAW_DISABLE_GUST_DARK_FIELD__ === true);
}
/** The wind field's dark alpha at `kn` (HEATMAP_FS: opacity x (base + (1 - base) x smoothstep(0, rampEnd, kn))). */
export function windDarkFieldAlpha(kn) {
  const [base, rampEnd] = WIND_FIELD_ALPHA.dark;
  return WIND_FIELD_OPACITY.dark * (base + (1 - base) * smooth(0, rampEnd, kn));
}
/** The gust layer's opacity at `zoom`: the wind field's own in dark (with the parity on), else the layer's stops. */
export function gustFieldOpacity(theme, zoom, gustOpacityAt, win) {
  return gustDarkFieldOn(theme, win) ? WIND_FIELD_OPACITY.dark : gustOpacityAt(zoom);
}

/** The breakpoint scale ownRasterLayer.buildStepLut bakes: a breakpoint every LUT step, its colour sampled on the wind field. */
export function gustScale(theme, win) {
  const stops = gustStops(theme, win);
  const dark = gustDarkFieldOn(theme, win);
  const breakpoints = []; const colors = [];
  for (let k = 0; k < GUST_LUT.n; k++) {
    const kn = GUST_LUT.min + k * GUST_LUT.step;
    const c = sampleRamp(stops, kn);
    breakpoints.push(kn);
    if (dark) {   // DARK FIELD PARITY: colour pre-scaled by the wind's alpha, alpha = the wind's law (the layer draws at 0.48)
      const aw = windDarkFieldAlpha(kn);
      colors.push([Math.round(c[0] * aw * 255), Math.round(c[1] * aw * 255), Math.round(c[2] * aw * 255), aw / WIND_FIELD_OPACITY.dark]);
    } else {
      colors.push([Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), gustAlpha(theme, stops, kn, c, win)]);
    }
  }
  return { breakpoints, colors };
}

/** The legend bar from the same stops (value-proportional) and the wind legend's own ticks. */
export function gustLegend(theme, win) {
  const stops = gustStops(theme, win);
  const max = stops[stops.length - 1][0] || 1;
  const css = stops.map((s) => `rgba(${Math.round(s[1] * 255)},${Math.round(s[2] * 255)},${Math.round(s[3] * 255)},${gustAlpha(theme, stops, s[0], [s[1], s[2], s[3], s[4]], win)}) ${((s[0] / max) * 100).toFixed(1)}%`);
  return { label: 'Wind Gusts (kts)', gradientCSS: `linear-gradient(to right, ${css.join(', ')})`, ticks: windLegendStops(theme) };
}
