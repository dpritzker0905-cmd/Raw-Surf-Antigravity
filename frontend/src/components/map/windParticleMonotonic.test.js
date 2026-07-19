/**
 * WIND MARK SIZE MONOTONICITY (2026-07-19).
 *
 * User: "The slower wind particles are appearing larger still than some of the faster wind
 * particles." Confirmed by enumeration of the shipped arithmetic — inversions at EVERY zoom:
 *   z6:  1 kn drew 4.0 px vs 8 kn at 3.3 px  (the low-wind floor's slowness ramp, 3.4->4.2)
 *   z11: 2 kn drew 10.4 px vs 8 kn at 7.2 px (the legacy v3.21 close-zoom low-speed boost)
 * and on DPR-3 phones the inversion was STRUCTURAL: sizeBase was DPR-blind (1/3 physical size)
 * while the floor was DPR-correct, so every floored slow mark out-drew every unfloored fast one.
 *
 * Flow-vis practice: speed is read from trail length and motion; the mark may grow with speed or
 * stay constant — never shrink as speed rises. This gate enumerates the whole
 * zoom x DPR x speed space (enumeration has caught what sampling missed four times in this arc).
 *
 * Kill: __RAW_DISABLE_WIND_SIZE_MONOTONIC__ (u_size_monotonic = 0) -> yesterday's exact sizing,
 * inversions and all — asserted below so the switch provably reproduces the old behaviour.
 */
import { DRAW_VS, ADVECT_FS } from './WebGLWindShaders';

const smoothstep = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const sizeBase = (s) => (s < 0.5 ? 0 : 2.5 + 2.5 * smoothstep(1.0, 30.0, s));
const zoomBoostBase = (z) => 1.0 + smoothstep(5.0, 11.0, z) * 1.5;
const speedBoost = (s, z) => (z > 7.0 && s < 8.5 ? smoothstep(8.5, 2.0, s) * smoothstep(7.0, 11.0, z) * 1.5 : 0);
const fzs = (z) => mix(0.62, 1.0, smoothstep(3.0, 7.0, z));

// Full DRAW_VS mirror with the monotonic switch. Monotone mode: whole path DPR-correct, the
// v3.21 additive boost replaced by the s-INDEPENDENT band lift toward the 10 kn size, and the
// calm-marks band (0.3-1.0 kn, 2.2 css px — the dead-zone fix) below it. The lift's lower
// bound is 1.0 so calm marks stay SMALL instead of lifting to the 10 kn size at close zoom.
function devicePx(s, z, dpr, monotonic, calm = true) {
  const d = monotonic ? Math.max(dpr, 1) : 1;
  let p = sizeBase(s) * (zoomBoostBase(z) + (monotonic ? 0 : speedBoost(s, z))) * d;
  if (s >= 1.0 && s < 10.0) {
    const floor = (monotonic ? 3.073 : mix(3.4, 4.2, smoothstep(10.0, 1.0, s))) * fzs(z);
    p = Math.max(p, floor * Math.max(dpr, 1));             // the floor was ALWAYS dpr-correct
  }
  if (calm && s >= 0.3 && s < 1.0) {
    p = Math.max(p, 2.2 * fzs(z) * Math.max(dpr, 1));
  }
  if (monotonic && s >= 1.0 && s < 10.0) {
    const cap10 = 3.073 * zoomBoostBase(z) * Math.max(dpr, 1);
    const lift = smoothstep(7.0, 11.0, z) * 0.85;
    p = Math.min(p, cap10) + (cap10 - Math.min(p, cap10)) * lift;
  }
  return p;
}

const ZOOMS = [3, 4, 5, 5.5, 6, 6.5, 7, 8, 9, 10, 11];
const DPRS = [1, 2, 3];
const SPEEDS = [0.35, 0.6, 1, 2, 3, 4, 6, 8, 9.9, 10.1, 12, 15, 20, 30, 40];

describe('wind mark size is monotone in speed — slower never larger than faster', () => {
  it('MONOTONE at every zoom x DPR (the user-reported inversion, fixed)', () => {
    const inversions = [];
    for (const z of ZOOMS) for (const dpr of DPRS) {
      for (let i = 0; i < SPEEDS.length - 1; i++) {
        const a = devicePx(SPEEDS[i], z, dpr, true);
        const b = devicePx(SPEEDS[i + 1], z, dpr, true);
        if (a > b + 1e-6) inversions.push(`z${z} dpr${dpr}: ${SPEEDS[i]}kn=${a.toFixed(2)} > ${SPEEDS[i + 1]}kn=${b.toFixed(2)}`);
      }
    }
    // eslint-disable-next-line no-console
    if (inversions.length) console.log('INVERSIONS:', inversions.slice(0, 10).join(' | '));
    expect(inversions).toEqual([]);
  });

  it('PHYSICAL (css) size parity across device classes for every speed — the mobile half', () => {
    for (const z of ZOOMS) for (const s of SPEEDS) {
      const ref = devicePx(s, z, 1, true) / 1;
      for (const dpr of DPRS) {
        expect(Math.abs(devicePx(s, z, dpr, true) / dpr - ref)).toBeLessThan(1e-6);
      }
    }
  });

  it('the floor meets the base curve continuously at the band edge (no size pop at 10 kn)', () => {
    for (const z of ZOOMS) {
      const below = devicePx(9.99, z, 1, true);
      const above = devicePx(10.01, z, 1, true);
      expect(Math.abs(below - above)).toBeLessThan(0.25);
    }
  });

  it('slow marks keep their close-zoom visibility — capped AT the 10 kn size, not removed', () => {
    // The v3.21 intent (slow marks readable when zoomed in) survives: at z11 a 2 kn mark still
    // draws at the full 10 kn size (7.7 px), it just never EXCEEDS it any more.
    const slow = devicePx(2, 11, 1, true);
    const at10 = devicePx(10.1, 11, 1, true);
    expect(slow).toBeGreaterThan(7.0);
    expect(slow).toBeLessThanOrEqual(at10 + 1e-6);
  });

  it('the kill switch reproduces YESTERDAYexact curve — inversions and all', () => {
    // Documents the bug it replaces: with the switch off, the enumeration must FIND inversions
    // (if it stops finding them, the legacy branch has drifted and the switch is lying).
    let found = 0;
    for (const z of ZOOMS) for (let i = 0; i < SPEEDS.length - 1; i++) {
      if (devicePx(SPEEDS[i], z, 1, false) > devicePx(SPEEDS[i + 1], z, 1, false) + 1e-6) found++;
    }
    expect(found).toBeGreaterThan(10);
  });

  it('shader source carries the switch in BOTH stages with the same flat constant', () => {
    expect(DRAW_VS).toMatch(/uniform\s+float\s+u_size_monotonic\s*;/);
    expect(ADVECT_FS).toMatch(/uniform\s+float\s+u_size_monotonic\s*;/);
    expect(DRAW_VS).toMatch(/u_size_monotonic\s*>\s*0\.5\s*\?\s*3\.073/);
    expect(ADVECT_FS).toMatch(/u_size_monotonic\s*>\s*0\.5\s*\?\s*3\.073/);
    // the monotone cap/lift exists and uses the same constant
    expect(DRAW_VS).toMatch(/cap10\s*=\s*3\.073/);
    expect(DRAW_VS).toMatch(/lift\s*=\s*smoothstep\(7\.0,\s*11\.0,\s*u_zoom\)\s*\*\s*0\.85/);
    // the lift must EXCLUDE the calm band (lower bound 1.0) or calm air lifts to the 10kn size
    expect(DRAW_VS).toMatch(/u_size_monotonic\s*>\s*0\.5\s*&&\s*v_speed\s*<\s*10\.0\s*&&\s*v_speed\s*>=\s*1\.0/);
    // calm-marks band present in BOTH stages with the same constant and band
    expect(DRAW_VS).toMatch(/u_calm_marks\s*>\s*0\.5\s*&&\s*v_speed\s*>=\s*0\.3\s*&&\s*v_speed\s*<\s*1\.0/);
    expect(ADVECT_FS).toMatch(/u_calm_marks\s*>\s*0\.5\s*&&\s*speed\s*>=\s*0\.3\s*&&\s*speed\s*<\s*1\.0/);
    expect(DRAW_VS).toMatch(/2\.2\s*\*\s*calmZoomScale/);
    expect(ADVECT_FS).toMatch(/2\.2\s*\*\s*floorZoomScale/);
    // the calm LIFETIME floor (dead zones read as flicker without it) — never-hoard preserved
    expect(ADVECT_FS).toMatch(/u_calm_marks\s*>\s*0\.5\s*&&\s*speed\s*<\s*4\.75/);
    expect(ADVECT_FS).toMatch(/max\(legacyDrop,\s*min\(dropRate,\s*0\.04\)\)/);
    // full-path DPR correctness is gated on the same switch
    expect(DRAW_VS).toMatch(/dprAll\s*=\s*\(u_size_monotonic\s*>\s*0\.5\)\s*\?\s*max\(u_dpr,\s*1\.0\)\s*:\s*1\.0/);
  });
});
