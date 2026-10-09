/**
 * CLOSE-ZOOM LAND (2026-10-09, owner: "in light mode, really close up ... wind animations are flooding too much just a
 * little bit, where it drowns out the land beneath"; then "Dont assume that beach mode and dark mode cannot be improved").
 *
 * Instruments (scripts/wind-bench): land-run.js (a line grid on each theme's land colour, in its road polarity) and
 * map-run.js (the owner's real basemaps, the served 2026-10-09 GFS grid, SSIM contrast-structure + particle signal).
 * Every theme's particle land cost rises from z6 (the approved look) to z7-9; both levers ride one close-zoom ramp so
 * the look eases in rather than stepping at a zoom boundary (L-V13).
 */
import fs from 'fs';
import path from 'path';
import { windCloseLandFactor, windCloseThinFactor, windCloseRamp, WIND_CLOSE_LAND, WIND_CLOSE_THIN } from './WebGLWindUtils';

const THEMES = ['light', 'beach', 'dark'];

describe('the close-zoom ramp', () => {
  it('is 0 through z6, 1 from z7.5, monotone and continuous between (no step a zoom gesture would show)', () => {
    for (const z of [2, 5, 6]) expect(windCloseRamp(z)).toBe(0);
    for (const z of [7.5, 9, 14]) expect(windCloseRamp(z)).toBe(1);
    let prev = 0;
    for (let z = 6; z <= 8; z += 0.05) {
      const r = windCloseRamp(z);
      expect(r).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(r - prev).toBeLessThan(0.06);
      prev = r;
    }
  });
});

describe('close-zoom opacity factor', () => {
  it('leaves every theme exactly as approved at z<=6', () => {
    for (const t of THEMES) for (const z of [2, 4, 6]) expect(windCloseLandFactor(t, z, {})).toBe(1);
  });
  it('reaches each theme\'s table value by z7.5; themes without one stay at 1', () => {
    for (const t of THEMES) {
      const to = WIND_CLOSE_LAND.to[t];
      for (const z of [7.5, 9, 11]) expect(windCloseLandFactor(t, z, {})).toBeCloseTo(typeof to === 'number' ? to : 1, 12);
    }
    expect(WIND_CLOSE_LAND.to.light).toBe(0.65);
  });
  it('never brightens: every table value is in (0, 1]', () => {
    for (const v of Object.values(WIND_CLOSE_LAND.to)) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it('lever sets the close-zoom factor for any theme (0.1-1, numbers only); kill restores 1', () => {
    expect(windCloseLandFactor('dark', 9, { __RAW_WIND_CLOSE_LAND_OPACITY__: 0.8 })).toBeCloseTo(0.8, 12);
    expect(windCloseLandFactor('light', 9, { __RAW_WIND_CLOSE_LAND_OPACITY__: 0.05 })).toBeCloseTo(WIND_CLOSE_LAND.to.light, 12);
    expect(windCloseLandFactor('light', 9, { __RAW_WIND_CLOSE_LAND_OPACITY__: '0.8' })).toBeCloseTo(WIND_CLOSE_LAND.to.light, 12);
    for (const t of THEMES) expect(windCloseLandFactor(t, 9, { __RAW_DISABLE_WIND_CLOSE_LAND__: true })).toBe(1);
  });
});

describe('close-zoom thin marks', () => {
  it('leaves every theme as drawn at z<=6 and reaches its table value (>= 1) by z7.5', () => {
    for (const t of THEMES) {
      for (const z of [3, 6]) expect(windCloseThinFactor(t, z, {})).toBe(1);
      const to = WIND_CLOSE_THIN.to[t];
      expect(windCloseThinFactor(t, 9, {})).toBeCloseTo(typeof to === 'number' ? to : 1, 12);
    }
    for (const v of Object.values(WIND_CLOSE_THIN.to)) expect(v).toBeGreaterThanOrEqual(1);
  });
  it('lever (1-3, numbers only) and kill', () => {
    expect(windCloseThinFactor('dark', 9, { __RAW_WIND_CLOSE_THIN__: 1.6 })).toBeCloseTo(1.6, 12);
    expect(windCloseThinFactor('dark', 9, { __RAW_WIND_CLOSE_THIN__: 0.5 })).toBeCloseTo(WIND_CLOSE_THIN.to.dark || 1, 12);
    for (const t of THEMES) expect(windCloseThinFactor(t, 9, { __RAW_DISABLE_WIND_CLOSE_THIN__: true })).toBe(1);
  });
});

describe('wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
  const shaders = fs.readFileSync(path.join(__dirname, 'WebGLWindShaders.js'), 'utf8');
  it('the composite opacity carries the opacity factor on both the premultiplied and the brightness-alpha paths', () => {
    expect(src).toContain("_v2.theme ? _v2.composite : (_pm.on ? _pm.opacity : finalOpacity) * windCloseLandFactor(effectiveTheme, z))");
    expect(src.match(/windCloseLandFactor\(/g)).toHaveLength(1);
  });
  it('the dash narrows across the wind by the thin factor (DRAW_FS), bound once per frame', () => {
    expect(src).toContain("'u_dash_thin'), windCloseThinFactor(effectiveTheme, z));");
    expect(shaders).toContain('float elong = mix(1.8, 2.6, smoothstep(10.0, 0.5, v_speed)) * max(u_dash_thin, 1.0);');
  });
});
