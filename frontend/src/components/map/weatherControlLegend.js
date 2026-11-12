import { M_TO_FT } from './heightUnits';
import { valueTicks, evenTicks, dropCollisions } from './legendTicks';

/**
 * Build a CSS linear-gradient string from RGBA color array + breakpoints.
 * Colors are positioned proportionally along the gradient.
 */
export function buildGradientCSS(scale) {
  if (!scale?.colors?.length || !scale?.breakpoints?.length) return 'linear-gradient(to right, #888, #888)';
  const colors = scale.colors;
  const bp = scale.breakpoints;
  const maxBp = bp[bp.length - 1];
  const minBp = bp[0];
  const range = maxBp - minBp || 1;

  const stops = colors.map((c, i) => {
    const pct = ((bp[i] - minBp) / range) * 100;
    return `rgba(${c[0]},${c[1]},${c[2]},${Math.min(c[3] + 0.2, 1).toFixed(2)}) ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

// Marine height variables whose breakpoints are stored in METERS (display converts per the
// user's ft/m preference — heightUnits.js is the single source of that preference).
export const HEIGHT_VARIABLES = ['wave_height', 'wave', 'swell_wave_height', 'secondary_swell_wave_height', 'wind_wave_height'];

/**
 * Build legend stops (labels) from breakpoints. Wave variables convert meters → the user's
 * display unit ('ft' default — the pre-toggle live behavior; 'm' keeps meters).
 */
export function buildStops(scale, layerId, heightUnit) {
  // Returns POSITIONED ticks ([{label, pct}]), not bare strings — see legendTicks.js for why
  // (evenly-spaced labels sat up to 47 pp from the colour they name).
  if (!scale?.breakpoints?.length) return [];
  const isHeight = scale.unit === 'm' && HEIGHT_VARIABLES.includes(layerId);
  const toFeet = isHeight && heightUnit !== 'm';
  return dropCollisions(valueTicks(scale.breakpoints, (bp, i, isLast) => {
    const val = toFeet ? bp * M_TO_FT : bp;
    const display = val < 1 ? val.toFixed(1) : Math.round(val);
    return isLast ? `${display}+` : `${display}`;
  }));
}

/** Hand-authored gradients carry no percentages, so CSS spaces their colours evenly and their
 *  labels were always right; normalised so both legend kinds render through one path. */
export const evenStops = (labels) => evenTicks(labels);
