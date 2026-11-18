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

export const GUST_LUT = { min: 0, step: 0.5, n: 151 };   // 0..75 kn every 0.5 kn: finer than any colour change of the table

/** The wind heatmap's stops for a theme, as the wind field texture is built from them (a theme with no field table of its
 *  own, dark with its rules off, samples the particle ramp: WindColorRamp.buildFieldRampTexture's null). */
export function gustStops(theme, win) {
  return huePathStops(resolveDrawnField(theme, win) || resolveThemeRamp(theme), win);
}

/** The breakpoint scale ownRasterLayer.buildStepLut bakes: a breakpoint every LUT step, its colour sampled on the wind field. */
export function gustScale(theme, win) {
  const stops = gustStops(theme, win);
  const breakpoints = []; const colors = [];
  for (let k = 0; k < GUST_LUT.n; k++) {
    const kn = GUST_LUT.min + k * GUST_LUT.step;
    const c = sampleRamp(stops, kn);
    breakpoints.push(kn);
    colors.push([Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), c[3]]);
  }
  return { breakpoints, colors };
}

/** The legend bar from the same stops (value-proportional) and the wind legend's own ticks. */
export function gustLegend(theme, win) {
  const stops = gustStops(theme, win);
  const max = stops[stops.length - 1][0] || 1;
  const css = stops.map((s) => `rgba(${Math.round(s[1] * 255)},${Math.round(s[2] * 255)},${Math.round(s[3] * 255)},${s[4]}) ${((s[0] / max) * 100).toFixed(1)}%`);
  return { label: 'Wind Gusts (kts)', gradientCSS: `linear-gradient(to right, ${css.join(', ')})`, ticks: windLegendStops(theme) };
}
