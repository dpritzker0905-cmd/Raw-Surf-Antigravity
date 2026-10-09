/**
 * CLOSE-ZOOM LAND, LIGHT (2026-10-09, owner: "in light mode, really close up ... wind animations are flooding too much just a
 * little bit, where it drowns out the land beneath").
 *
 * Bench (scripts/wind-bench/land-run.js, real engine, a dark line grid on the theme's land colour, view 28-38 kn): the share
 * of land line contrast the particles take beyond the field alone, light z6/7/8/9/10/11 = 0.40/0.58/0.64/0.60/0.53/0.54
 * before; light mark opacity 0.65 gave 0.27/0.38/0.43/0.40/0.35/0.36. The field alone kept ~0.80 at every zoom.
 */
import fs from 'fs';
import path from 'path';
import { windCloseLandFactor, WIND_CLOSE_LAND } from './WebGLWindUtils';

describe('close-zoom land factor (light)', () => {
  it('leaves z<=6 exactly as approved, and dark and beach at every zoom', () => {
    for (const z of [2, 4, 5.5, 6]) expect(windCloseLandFactor('light', z, {})).toBe(1);
    for (const z of [2, 6, 7, 9, 12]) {
      expect(windCloseLandFactor('dark', z, {})).toBe(1);
      expect(windCloseLandFactor('beach', z, {})).toBe(1);
    }
    expect(WIND_CLOSE_LAND.themes).toEqual(['light']);
  });
  it('reaches 0.65 by z7.5 and holds it closer in', () => {
    for (const z of [7.5, 8, 9, 11, 14]) expect(windCloseLandFactor('light', z, {})).toBeCloseTo(0.65, 12);
  });
  it('eases in: continuous at z6, never rising with zoom, no step a zoom gesture would show', () => {
    let prev = 1;
    for (let z = 6; z <= 8; z += 0.05) {
      const f = windCloseLandFactor('light', z, {});
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - f).toBeLessThan(0.02);              // < 2 opacity points per 0.05 zoom
      prev = f;
    }
    expect(windCloseLandFactor('light', 6.001, {})).toBeGreaterThan(0.9999);
  });
  it('lever sets the close-zoom factor (clamped to 0.1-1, ignored otherwise); kill restores 1', () => {
    expect(windCloseLandFactor('light', 9, { __RAW_WIND_CLOSE_LAND_OPACITY__: 0.8 })).toBeCloseTo(0.8, 12);
    expect(windCloseLandFactor('light', 9, { __RAW_WIND_CLOSE_LAND_OPACITY__: 0.05 })).toBeCloseTo(0.65, 12);
    expect(windCloseLandFactor('light', 9, { __RAW_WIND_CLOSE_LAND_OPACITY__: '0.8' })).toBeCloseTo(0.65, 12);
    expect(windCloseLandFactor('light', 9, { __RAW_DISABLE_WIND_CLOSE_LAND__: true })).toBe(1);
  });
});

describe('wiring', () => {
  it('the premultiplied composite opacity carries the factor; the legacy and neutral-body composites do not', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(src).toContain("_v2.theme ? _v2.composite : (_pm.on ? _pm.opacity * windCloseLandFactor(effectiveTheme, z) : finalOpacity)");
    expect(src.match(/windCloseLandFactor\(/g)).toHaveLength(1);
  });
});
