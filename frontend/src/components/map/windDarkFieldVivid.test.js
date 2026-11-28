import fs from 'fs';
import path from 'path';
import { WIND_DARK_VIVID_KILL, windDarkVividOn, windFieldSrcFactor } from './windDarkFieldVivid';
import { HEATMAP_FS } from './WebGLWindShaders';

const GL = { ONE: 1, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303 };

describe('dark wind field vivid (premultiplied blend)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_DARK_WIND_VIVID__; delete window.__RAW_DARK_WIND_VIVID__; });

  test('production blend is the default for the untinted field', () => {
    expect(windFieldSrcFactor(GL, 'dark', {})).toBe(GL.SRC_ALPHA);
    expect(windFieldSrcFactor(GL, 'light', {})).toBe(GL.SRC_ALPHA);
    expect(windFieldSrcFactor(GL, 'beach', {})).toBe(GL.SRC_ALPHA);
    expect(windDarkVividOn('light', {})).toBe(false);
    expect(windDarkVividOn('beach', {})).toBe(false);
  });

  test('the kill returns dark to SRC_ALPHA (the squared law dev drew), read at each call', () => {
    window.__RAW_DARK_WIND_VIVID__ = true;
    expect(WIND_DARK_VIVID_KILL).toBe('__RAW_DISABLE_DARK_WIND_VIVID__');
    expect(windFieldSrcFactor(GL, 'dark')).toBe(GL.ONE);
    window.__RAW_DISABLE_DARK_WIND_VIVID__ = true;
    expect(windDarkVividOn('dark')).toBe(false);
    expect(windFieldSrcFactor(GL, 'dark')).toBe(GL.SRC_ALPHA);
    delete window.__RAW_DISABLE_DARK_WIND_VIVID__;
    expect(windFieldSrcFactor(GL, 'dark')).toBe(GL.ONE);
    expect(windFieldSrcFactor(GL, 'dark', { __RAW_DARK_WIND_VIVID__: true, [WIND_DARK_VIVID_KILL]: 'yes' })).toBe(GL.ONE);   // only a literal true kills
  });

  test('what it rests on: the shader premultiplies, and the engine routes only the non-tint pass through it', () => {
    expect(HEATMAP_FS).toContain('vec4(fieldRgb * alpha, alpha)');
    const engine = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(engine).toContain("if (_ft > 0) gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); else blendIntoMap(gl, windFieldSrcFactor(gl, effectiveTheme), gl.ONE_MINUS_SRC_ALPHA);");
    expect(engine.match(/windFieldSrcFactor\(/g)).toHaveLength(1);
  });

  test('the composite: ONE lays rgb a (the designed law), SRC_ALPHA rgb a^2', () => {
    // A blend unit: out = src * f_src + dst * (1 - src.a); the shader's src = (c a, a).
    const blend = (c, a, map, f) => c.map((x, i) => (x * a) * (f === GL.ONE ? 1 : a) + map[i] * (1 - a));
    const c = [0.9, 0.3, 0.6], a = 0.48 * 0.44, map = [93 / 255, 117 / 255, 126 / 255];
    blend(c, a, map, windFieldSrcFactor(GL, 'dark', { __RAW_DARK_WIND_VIVID__: true })).forEach((v, i) => expect(v).toBeCloseTo(c[i] * a + map[i] * (1 - a), 12));
    blend(c, a, map, windFieldSrcFactor(GL, 'dark', {})).forEach((v, i) => expect(v).toBeCloseTo(c[i] * a * a + map[i] * (1 - a), 12));
  });
});
