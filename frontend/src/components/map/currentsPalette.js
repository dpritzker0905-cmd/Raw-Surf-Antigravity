/**
 * currentsPalette.js — the Ocean Currents layer's colours and legend (2026-11-15).
 *
 * PALETTE. Viridis (van der Walt & Smith, matplotlib's default): lightness rises monotonically with speed and the hues avoid
 * the red-green axis, so it reads in order under deuteranopia, protanopia and tritanopia and in greyscale (gate log: the CVD
 * check). Speed in knots, the frames' unit; ocean surface currents are 0-3 kn almost everywhere (Gulf Stream / Agulhas cores
 * reach 4-5 kn), so the ramp tops out at 4 kn and holds its last colour above.
 * Per theme, only the ALPHA differs: the slowest water fades toward transparent so the basemap's ocean shows where nothing
 * moves, and dark (whose dark-violet low end sinks into the dark ocean) lifts the low end a little sooner.
 *
 * UNITS. The frames store knots. The legend follows the user's unit preference (useHeightUnit: 'ft' -> knots, 'm' -> m/s),
 * converting only the tick labels; the colours never move.
 */
export const CURRENTS_LUT = { min: 0, step: 0.02, n: 201 };   // 0..4 kn every 0.02 kn (~1 cm/s)
export const MS_PER_KN = 1852 / 3600;

// [kn, r, g, b] (viridis at 0, 0.25, 0.5, 0.75, 1 of the ramp)
const VIRIDIS = [[0, 68, 1, 84], [1, 59, 82, 139], [2, 33, 145, 140], [3, 94, 201, 98], [4, 253, 231, 37]];
// [kn, alpha] per theme. NO VEIL (2026-11-15, the owner: "fix the currents light veil"): most open ocean moves at 0.1-0.4 kn, and
// with 0.25 alpha from 0.1 kn the whole ocean wore a lavender wash in light and beach. Water below 0.25 kn (light, beach) / 0.2 kn
// (dark) is now fully transparent, eddies and boundary currents (0.5 kn and up) carry the colour, and the ramp is fully strong
// from 1 kn.
const ALPHA = {
  light: [[0, 0.0], [0.25, 0.0], [0.5, 0.45], [1, 0.85]],
  beach: [[0, 0.0], [0.25, 0.0], [0.5, 0.45], [1, 0.85]],
  dark: [[0, 0.0], [0.2, 0.0], [0.4, 0.55], [1, 0.9]],
};

const lerpRows = (rows, x, n) => {
  if (x <= rows[0][0]) return rows[0].slice(1, 1 + n);
  for (let i = 1; i < rows.length; i++) {
    if (x <= rows[i][0]) {
      const t = (x - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]);
      return rows[i].slice(1, 1 + n).map((v, k) => rows[i - 1][1 + k] + (v - rows[i - 1][1 + k]) * t);
    }
  }
  return rows[rows.length - 1].slice(1, 1 + n);
};

/** [r, g, b (0-255), alpha (0-1)] at a speed in knots, for a theme. */
export function currentsColor(kn, theme) {
  const rgb = lerpRows(VIRIDIS, kn, 3).map(Math.round);
  return [...rgb, lerpRows(ALPHA[theme] || ALPHA.dark, kn, 1)[0]];
}

/** The breakpoint scale ownRasterLayer.buildStepLut bakes (one breakpoint per LUT step). */
export function currentsScale(theme) {
  const breakpoints = []; const colors = [];
  for (let k = 0; k < CURRENTS_LUT.n; k++) {
    const kn = Math.round((CURRENTS_LUT.min + k * CURRENTS_LUT.step) * 1e6) / 1e6;
    breakpoints.push(kn); colors.push(currentsColor(kn, theme));
  }
  return { breakpoints, colors };
}

/** Legend: the bar from the same colours (value-proportional), ticks in the user's unit. */
export function currentsLegend(theme, heightUnit) {
  const metric = heightUnit === 'm';
  const css = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((kn) => {
    const c = currentsColor(kn, theme);
    return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(c[3], 0.35).toFixed(2)}) ${((kn / 4) * 100).toFixed(1)}%`;   // the bar shows slow water's hue
  });
  const ticks = [0, 1, 2, 3, 4].map((kn, i, a) => {
    const v = metric ? (kn * MS_PER_KN).toFixed(1) : String(kn);
    return i === a.length - 1 ? `${v}+` : v;
  });
  // Speed only (lever A, 2026-11-16: the frames carry no direction until particles bring it back as u / v).
  return { label: `Ocean current speed (${metric ? 'm/s' : 'kts'})`, gradientCSS: `linear-gradient(to right, ${css.join(', ')})`, ticks };
}
