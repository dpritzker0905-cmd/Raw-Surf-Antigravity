/**
 * LIGHT / BEACH COLOURS (2026-10-09, owner: "light mode needs color corrections, and possibly beach mode does" and "be
 * careful not to completely block land mass underneath ... be innovative").
 *
 * Measured on the real-engine bench (WebGL2, synthetic climatology + hurricane, a basemap line grid under the layer):
 *   - particle salience (CIE dL* of the frame with particles vs the field alone), z3/z7: dark 1.4/2.5 (approved);
 *     light today 0.5/0.9 (pale cream streaks: the brightness-alpha composite hides dark speed colours);
 *     light with speed-coloured premultiplied marks at 0.9 + double casing 1.5/2.5; beach at 0.6: 1.5/2.6.
 *   - basemap line contrast retained through field + particles: dark 0.50; light 0.40 -> 0.65; beach 0.47 -> 0.85,
 *     because the field now TINTS (multiply) instead of covering (the legacy pass blended premultiplied colour with
 *     SRC_ALPHA: colour x a^2 over basemap x (1 - a), a muddy veil — light field L* 49 on a ~94 basemap).
 */
import fs from 'fs';
import path from 'path';
import { v2SpeedPremul, V2_SPEED_PREMUL, v2FieldTint, V2_FIELD_TINT, resolveWindParticlesV2 } from './WebGLWindUtils';
import { DRAW_FS, HEATMAP_FS } from './WebGLWindShaders';

const v2 = resolveWindParticlesV2({});
// These are the marks BEFORE glow (windInk.js). Glow is the default in light and beach since 2026-10-10 (D-019) and stands this
// composite down, so the tests of it run with glow's kill switch set.
const NO_GLOW = { __RAW_DISABLE_WIND_GLOW__: true };

describe('speed-coloured premultiplied marks', () => {
  it('light 1.0 and beach 0.6 with the double casing; dark untouched', () => {
    expect(v2SpeedPremul(v2, 'light', NO_GLOW)).toEqual({ on: true, opacity: 1.0, singleCasing: false });
    expect(v2SpeedPremul(v2, 'beach', NO_GLOW)).toEqual({ on: true, opacity: 0.6, singleCasing: false });
    expect(v2SpeedPremul(v2, 'beach', {})).toEqual({ on: false, opacity: 0, singleCasing: false });   // glow owns beach's marks
    expect(v2SpeedPremul(v2, 'light', {})).toEqual({ on: true, opacity: 1.0, singleCasing: false });  // light came off glow (it washed out live)
    expect(v2SpeedPremul(v2, 'dark', {})).toEqual({ on: false, opacity: 0, singleCasing: false });
    expect(V2_SPEED_PREMUL.themes).toEqual(['light', 'beach']);
  });
  it('the neutral-body v2 theme owns the premul path when opted in; the kill restores the legacy composite', () => {
    expect(v2SpeedPremul(resolveWindParticlesV2({ __RAW_WIND_THEME_V2__: true }), 'light', {}).on).toBe(false);
    expect(v2SpeedPremul(v2, 'light', { __RAW_DISABLE_WIND_SPEED_PREMUL__: true }).on).toBe(false);
  });
  it('bench levers: theme list, opacity (clamped), single casing', () => {
    expect(v2SpeedPremul(v2, 'dark', { __RAW_WIND_PREMUL_THEMES__: 'dark' }).on).toBe(true);
    expect(v2SpeedPremul(v2, 'light', { ...NO_GLOW, __RAW_WIND_PREMUL_OPACITY__: 0.5 }).opacity).toBe(0.5);
    expect(v2SpeedPremul(v2, 'light', { ...NO_GLOW, __RAW_WIND_PREMUL_OPACITY__: 7 }).opacity).toBe(1.0);
    expect(v2SpeedPremul(v2, 'light', { ...NO_GLOW, __RAW_WIND_SINGLE_CASING__: true }).singleCasing).toBe(true);
  });
});

describe('field tint, not cover: the basemap stays legible', () => {
  it('light and beach tint (5 points more solid than the legacy opacity, owner); dark keeps the approved alpha-over field', () => {
    expect(0.65 * v2FieldTint('light', {})).toBeCloseTo(0.70, 12);
    expect(0.55 * v2FieldTint('beach', {})).toBeCloseTo(0.60, 12);
    expect(v2FieldTint('dark', {})).toBe(0);
    expect(V2_FIELD_TINT.themes).toEqual(['light', 'beach']);
    expect(v2FieldTint('light', { __RAW_DISABLE_WIND_FIELD_TINT__: true })).toBe(0);
    expect(v2FieldTint('light', { __RAW_WIND_FIELD_TINT__: 1.3 })).toBe(1.3);
  });
  // A dark coastline (Y 0.12) on the light basemap (Y 0.70) under a mid field colour (Y 0.25) at the light field alpha.
  const Yl = 0.12, Yb = 0.70, c = 0.25, a = 0.65, weber = (line, bg) => (bg - line) / bg;
  it('POSITIVE CONTROL: the legacy double-alpha field cuts the coastline Weber contrast by ~30%', () => {
    const over = (y) => c * a * a + y * (1 - a);
    expect(weber(over(Yl), over(Yb)) / weber(Yl, Yb)).toBeLessThan(0.75);   // 0.70 for these values
  });
  it('the multiply tint preserves it exactly (line and background are scaled alike)', () => {
    const tint = 1 - a * (1 - c), mult = (y) => y * tint;
    expect(weber(mult(Yl), mult(Yb))).toBeCloseTo(weber(Yl, Yb), 12);
  });
  it('over plain white the tint is the same colour the legacy cover aimed for (1 - s + s*colour)', () => {
    const s = 0.65, col = 0.4;
    expect(1 * (1 - s * (1 - col))).toBeCloseTo(1 - s + s * col, 12);
  });
});

describe('wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
  it('HEATMAP_FS emits a tint when u_field_tint > 0, the legacy premultiplied colour otherwise', () => {
    expect(HEATMAP_FS).toContain('gl_FragColor = u_field_tint > 0.0 ? vec4(mix(vec3(1.0), fieldRgb, clamp(alpha * u_field_tint, 0.0, 1.0)), 1.0) : vec4(fieldRgb * alpha, alpha);');
  });
  it('the field pass multiplies (keeping the destination alpha) only when tinting', () => {
    expect(src).toContain('if (_ft > 0) gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);');
    expect(src).toContain("gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_field_tint'), _ft);");
  });
  it('every premultiplied site follows _premul (the fade, the composite blend, the clean-buffer flip), never _v2.theme alone', () => {
    expect(src).toContain('if (this._v2Premul !== _premul) { this._v2Premul = _premul;');
    expect(src).toContain("gl.uniform1f(gl.getUniformLocation(this.fadeProgram, 'u_premul'), _premul ? 1 : 0)");
    expect(src).toContain("gl.blendFunc(_premul ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(gl.getUniformLocation(this.screenProgram, 'u_premul'), _premul ? 1 : 0);");
    expect(src).toContain("_v2.theme ? _v2.composite : (_pm.on ? _pm.opacity : finalOpacity) * windCloseLandFactor(effectiveTheme, z))");
    expect(src).not.toMatch(/u_premul'\), _v2\.theme \?/);
  });
  it('DRAW_FS drops the inner ring under the single-casing option, as the neutral theme always did', () => {
    expect(DRAW_FS).toContain('rgb = mix(rgb, vec3(innerL), inner * 0.92 * (1.0 - max(u_v2_theme, u_single_casing)));');
    expect(src).toContain("'u_single_casing'), _pm.singleCasing ? 1 : 0)");
  });
});
