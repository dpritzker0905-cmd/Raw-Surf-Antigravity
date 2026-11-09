// marineUnresolvedDirection.js
// DWD GWAM's undefined wind sea carries a PLACEHOLDER direction, not a measured one: direction exactly 180 with period at the
// 1.0 s floor.
//
// Measured 2026-11-08/09 against the ICON source model (DWD GWAM, read through Open-Meteo's `models=gwam`, the same GRIB), Florida
// east coast, wind-wave partition: at (27.0, -80.25) the model emits height 0.10 m, period 1.00 s, direction 180 deg. Its
// neighbours read 0.12 m / 1.15 s / 129 deg, 0.14 m / 1.2 s / 122 deg, 0.20 m / 1.7 s / 47 deg. At the floor the direction is a
// default (180, and 176 / 170 beside it), not a measurement. The pipeline carries it faithfully (the normalizer keeps a
// null direction invalid; this value is not null), so the cells arrive as u = 0, v = +height, direction 180: due-north
// particles over a field that moves SW. The encoder writes a UNIT direction whatever the height, so a 0.1 m cell steers the
// particles as hard as a 3 m one: the "two fields in opposing directions" look.
//
// The fix is render-only: such a cell contributes NO direction to the texture (u = v = 0), and dilateDirectionField (the same
// pass that serves land) fills the nearest REAL neighbour direction into it. Height, period, mask and every served number
// are untouched; nothing is invented, and a patch with no real neighbour stays motionless. Kill:
// window.__RAW_DISABLE_UNRESOLVED_DIRECTION__ = true.

// Keyed on direction === 180 AND period <= 1.0, not on period alone: other models (meteofrance_wave) carry real sub-second wind
// seas with real headings. (Zero-height GFS fills, H 0 / dir 0, are NOT touched here: the shaders cull height < 0.01 and drift scales with height.)

export const UNRESOLVED_PERIOD_MAX_S = 1.0;
const EPS = 1e-6;

export function isUnresolvedDirection(height, period, direction, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (w && w.__RAW_DISABLE_UNRESOLVED_DIRECTION__ === true) return false;
  return height > 0 && direction === 180 && period > 0 && period <= UNRESOLVED_PERIOD_MAX_S + EPS;
}
