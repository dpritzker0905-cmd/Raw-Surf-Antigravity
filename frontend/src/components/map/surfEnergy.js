/**
 * surfEnergy.js — wave energy flux, in the unit it is actually computed in.
 *
 * ⛔ WHY THIS DOES NOT SAY "kJ", WHICH IS WHAT EVERY COMPETITOR SHOWS.
 * Surfline and Magicseaweed both display "wave energy in kilojoules" and NEITHER publishes its
 * constant. Their own published reading scales disagree outright:
 *
 *     Magicseaweed    ~100 surfable     200-1000 punchy      1000-5000+ heavy/dangerous
 *     Surf-Forecast   <100 tiny         100-300 longboard    >300 shortboard, >1000 extreme
 *
 * So there is no single industry "kJ" to be compatible WITH. Printing one would claim agreement
 * with a scale we cannot reproduce — a fabricated provenance claim, which is the exact defect
 * class this arc has been closing (#17's unqualified `Height`, #22's nine more, and an ICON
 * swell_2 blend that rendered as a measurement). So we publish the textbook quantity in its
 * textbook unit and calibrate the words on our own field.
 *
 * THE PHYSICS — deep-water wave energy flux per unit crest length:
 *
 *     P = (rho * g^2 / (64*pi)) * Hs^2 * Te      kW per metre of wave crest
 *
 * This is the same quantity Surfline describes ("height squared multiplied by period and some
 * coefficients, which means height has proportionally more effect than period").
 * ⚠️ It is an OFFSHORE quantity, computed from the layer's own offshore Hs and period — the same
 * numbers the Swell/Period cards already show. It is NOT the breaking-wave power at the bank;
 * `surf_height_m` + the rating own that.
 */

const RHO_SEAWATER = 1025.0;   // kg/m^3
const G = 9.81;                // m/s^2

/** kW/m per (m^2 * s). Derived, never hardcoded — 0.4906 at the constants above. */
export const ENERGY_COEF = (RHO_SEAWATER * G * G) / (64 * Math.PI) / 1000;

/**
 * Energy flux in kW per metre of crest, or null when either input is missing or non-positive.
 * Returns null rather than 0 — "no period" is not "no energy", and a confident 0 is the failure
 * mode this codebase keeps finding (a zeroed period rendering as a real reading).
 */
export function energyFluxKwM(heightM, periodS) {
  if (heightM == null || periodS == null) return null;
  if (!(heightM > 0) || !(periodS > 0)) return null;
  return ENERGY_COEF * heightM * heightM * periodS;
}

/**
 * Band edges CALIBRATED ON OUR OWN FIELD, 2026-08-01, two independent ways that agree:
 *
 *  (a) named exemplars, computed from the formula above
 *        ankle  0.3 m @  6 s ->    0.3      head      1.8 m @ 13 s ->   20.7
 *        waist  0.8 m @  9 s ->    2.8      overhead  2.5 m @ 14 s ->   42.9
 *        chest  1.2 m @ 11 s ->    7.8      double    4.0 m @ 16 s ->  125.6
 *        Mavericks 8 m @ 18 s -> 565.2
 *  (b) the served global field, 35,132 `waves` cells across GFS/ICON/EURO
 *        p50 13.8   p90 95.3   p95 144.0   p99 269.6   p99.9 440.3
 *
 * => most of the ocean is Moderate, the top ~10% Powerful, the top ~1% Heavy. The BAND is the
 * honest resolution of this number: it survives the cross-layer footprint mismatch that the
 * closure guard measures (same-tier <=3%, mixed-tier up to 41% in height, SQUARED here), where a
 * precise figure does not.
 */
export const ENERGY_BANDS = [
  { max: 3, label: 'Weak', hint: 'ankle to waist' },
  { max: 20, label: 'Moderate', hint: 'waist to head' },
  { max: 125, label: 'Powerful', hint: 'head to double overhead' },
  { max: Infinity, label: 'Heavy', hint: 'double overhead and up' },
];

export function energyBand(kwm) {
  if (kwm == null || !(kwm > 0)) return null;
  return ENERGY_BANDS.find((b) => kwm < b.max) || ENERGY_BANDS[ENERGY_BANDS.length - 1];
}

/** Round to `digits` significant figures. 20.7@2 -> 21, 125.6@2 -> 130, 7.8@2 -> 7.8. */
function signif(x, digits) {
  if (x === 0) return 0;
  const mag = Math.ceil(Math.log10(Math.abs(x)));
  const factor = 10 ** (digits - mag);
  return Math.round(x * factor) / factor;
}

/**
 * COARSEN, DON'T HIDE.
 *
 * A layer served from the 10-degree global tier is a spatial average over a block, not a reading
 * at the break, and the closure measurement says the resulting error reaches 41% in height —
 * squared here. Suppressing the card was the obvious response and is the wrong one: EURO is
 * mixed-tier at 59% of sites (GFS 21%, ICON 0%), so suppression would blank this card on most of
 * one model and the feature would read as broken.
 *
 * The uncertainty-communication literature converges on the alternative: round values read as
 * approximations, precise ones overclaim. So a coarse-tier reading loses a significant figure and
 * gains a `~`, and the BAND — which is 4x-6x wide — carries the meaning either way.
 */
export function formatEnergy(kwm, { coarse = false } = {}) {
  if (kwm == null || !(kwm > 0)) return null;
  const band = energyBand(kwm);
  const tilde = coarse ? '~' : '';
  // ⚠️ PRECISION IS BY MAGNITUDE, NOT BY SIGNIFICANT FIGURES. A flat 3-sig-fig rule printed
  // `0.0538 kW/m` on a small day — three figures on a number whose entire band is 0-3, which is
  // the false precision this module exists to avoid. Below 1 kW/m the only honest statement is
  // that there is nothing in it.
  if (kwm < 1) return `<1 kW/m · ${band.label}`;
  if (kwm < 100) {
    return `${tilde}${coarse ? Math.round(kwm) : Math.round(kwm * 10) / 10} kW/m · ${band.label}`;
  }
  return `${tilde}${coarse ? signif(kwm, 2) : Math.round(kwm)} kW/m · ${band.label}`;
}

/**
 * Is this layer's reading a regional tile, or a coarse-tier average?
 * `inside_regional_tile` is the only tier that samples at the break. `inside_global_coarse` and
 * `coarse_gap_direct_point` are both coarse — and measured 2026-08-01, 6 of the 7 adjacent-hour
 * tier flips were BETWEEN those two, so collapsing them into one class is what keeps this marker
 * from flickering on the time scrubber (96.3% stable overall; ~100% under this collapse).
 */
export function isCoarseTier(coverageStatus) {
  return coverageStatus != null && coverageStatus !== 'inside_regional_tile';
}
