/**
 * Gust particles (gustParticles.js, windGustColour.js): Gusts runs the WIND particle engine, moving on the wind and coloured by
 * the gust field on screen. Pins: the layer gating and its kill, the GPU byte encoding, the engine and shader wiring that keeps
 * the Wind layer byte-identical outside gust mode, and the colour parity with the gust heatmap in every theme.
 */
import fs from 'fs';
import path from 'path';
import {
  gustParticlesOn, windParticlesWanted, gustColourMode, encodeGustTexture, decodeGustByte,
  getShownGustField, setShownGustField, subscribeGustField,
} from './gustParticles';
import { GUST_RAMP_MAX_KN, rampMaxFor, gustColourActive, setGustField, clearGustField, gustFlicker, GUST_FLICKER_HZ, GUST_FLICKER_DEPTH } from './windGustColour';
import { DRAW_VS, DRAW_FS } from './WebGLWindShaders';
import { gustScale } from './gustPalette';
import { drawnMarkRampData } from './WindColorRamp';

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

afterEach(() => { delete window.__RAW_DISABLE_GUST_PARTICLES__; setShownGustField(null); });

describe('layer gating', () => {
  test('ships ON: Gusts runs the wind particles; the kill returns it to the heatmap alone', () => {
    expect(gustParticlesOn()).toBe(true);
    expect(windParticlesWanted(['gusts'])).toBe(true);
    expect(gustColourMode(['gusts'])).toBe(true);
    window.__RAW_DISABLE_GUST_PARTICLES__ = true;
    expect(windParticlesWanted(['gusts'])).toBe(false);
    expect(gustColourMode(['gusts'])).toBe(false);
  });

  test('Wind is untouched: particles on, gust colour off, whatever the kill says', () => {
    expect(windParticlesWanted(['wind'])).toBe(true);
    expect(gustColourMode(['wind'])).toBe(false);
    window.__RAW_DISABLE_GUST_PARTICLES__ = true;
    expect(windParticlesWanted(['wind'])).toBe(true);
  });

  test('other layers run no particles', () => {
    for (const l of [[], ['pressure'], ['currents'], ['waves'], null]) {
      expect(windParticlesWanted(l)).toBe(false);
      expect(gustColourMode(l)).toBe(false);
    }
  });

  test('the wind fetch, the particle layer and the colour mode all follow the same gate', () => {
    expect(src('WeatherEngine.js')).toMatch(/isWindActive = useMemo\(\s*\(\) => windParticlesWanted\(activeLayers\)/);
    const m = src('MapWebGL.js');
    expect(m).toContain('active={windParticlesWanted(activeLayers)}');
    expect(m).toContain('gustColour={gustColourMode(activeLayers)}');
  });
});

describe('the gust field hand-off', () => {
  const field = (values, cols = 2, rows = 2) => ({ cols, rows, values: Float32Array.from(values),
    bounds: { west: -180, south: -90, east: 179.75, north: 90 }, validMs: 1 });

  test('subscribers get the field on screen, and null when it leaves', () => {
    const seen = [];
    const off = subscribeGustField((f) => seen.push(f));
    const f = field([1, 2, 3, 4]);
    setShownGustField(f);
    setShownGustField(f);            // same field: no repeat
    setShownGustField(null);
    off();
    setShownGustField(field([5, 6, 7, 8]));
    expect(seen).toEqual([f, null]);
    expect(getShownGustField()).not.toBeNull();
  });

  test('a malformed field is treated as none', () => {
    setShownGustField({ cols: 1, rows: 1, values: [1], bounds: {} });
    expect(getShownGustField()).toBeNull();
  });

  test('the raster layer publishes exactly the gusts field it draws', () => {
    const s = src('useOwnRasterFrames.js');
    expect(s).toContain("if (layer === 'gusts') setShownGustField(field || null);");
    expect(s).toContain("if (layer === 'gusts') setShownGustField(null);");
  });
});

describe('GPU encoding (one byte per cell)', () => {
  test('0 = no data; 1..255 = 0..maxKn; rows kept south-first as decoded', () => {
    const enc = encodeGustTexture({ cols: 3, rows: 2, values: Float32Array.from([0, 37.5, 75, NaN, 100, -1]),
      bounds: { west: 0, south: 0, east: 2, north: 1 } }, 75);
    expect(Array.from(enc.bytes)).toEqual([1, 128, 255, 0, 255, 0]);
    expect([enc.cols, enc.rows, enc.maxKn]).toEqual([3, 2, 75]);
  });

  test('the shader decode reads the knot back within a quarter knot', () => {
    for (let kn = 0; kn <= 75; kn += 0.5) {
      const b = encodeGustTexture({ cols: 1, rows: 1, values: [kn], bounds: {} }, 75).bytes[0];
      expect(Math.abs(decodeGustByte(b, 75) - kn)).toBeLessThanOrEqual(75 / 254 / 2 + 1e-9);
    }
    expect(Number.isNaN(decodeGustByte(0, 75))).toBe(true);
  });
});

describe('engine and shaders', () => {
  const fakeGl = () => {
    const calls = [];
    const gl = new Proxy({}, { get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'getParameter') return () => 4;
      if (k === 'createTexture') return () => ({ id: Math.random() });
      return typeof k === 'string' && k === k.toUpperCase() ? k : (...a) => { calls.push([k, ...a]); };
    } });
    return { gl, calls };
  };

  test('outside gust mode the ramp max is the wind\'s own (the Wind layer exactly)', () => {
    const engine = { _maxWindSpeed: 42, _gust: null };
    expect(gustColourActive(engine)).toBe(false);
    expect(rampMaxFor(engine)).toBe(42);
  });

  test('a gust field switches the ramp to the gust heatmap\'s 75 kn span; null switches back', () => {
    const { gl, calls } = fakeGl();
    const engine = { _maxWindSpeed: 42, _gust: null };
    const f = { cols: 4, rows: 3, values: new Float32Array(12).fill(20), bounds: { west: -180, south: -90, east: 179.75, north: 90 } };
    setGustField(engine, gl, f);
    expect(gustColourActive(engine)).toBe(true);
    expect(rampMaxFor(engine)).toBe(GUST_RAMP_MAX_KN);
    expect(calls.some((c) => c[0] === 'texImage2D' && c[3] === 'LUMINANCE')).toBe(true);
    setGustField(engine, gl, f);   // same size: updated in place
    expect(calls.some((c) => c[0] === 'texSubImage2D')).toBe(true);
    clearGustField(engine, gl);
    expect(rampMaxFor(engine)).toBe(42);
  });

  test('the engine skips its own heatmap in gust mode and binds the gust colour on the particle pass', () => {
    const e = src('WebGLWindEngine.js');
    expect(e).toMatch(/if \(!gustColourActive\(this\)\) \{\s*gl\.bindFramebuffer/);
    expect(e).toContain('}   // end Step 0 (skipped in gust mode)');
    expect(e).toContain('bindGustColour(gl, this.drawProgram, this)');
    expect(e).toContain('if (gustColourActive(this)) bindTexture(gl, null, GUST_UNIT);');
    // setTheme keys the ramp exactly as render() does, so a theme switch in gust mode keeps the gust ramp
    expect((e.match(/var rampMax = rampMaxFor\(this\);/g) || []).length).toBe(2);
  });

  test('colour reads v_cspeed; motion, size, keep and dash stay on the wind\'s v_speed', () => {
    expect(DRAW_VS).toContain('v_cspeed = v_speed;');
    expect(DRAW_VS).toMatch(/if \(u_gust_on > 0\.5\) \{[\s\S]*texture2D\(u_gust, guv\)/);
    expect(DRAW_VS).toContain('if (gb >= 1.0) v_cspeed = (gb - 1.0) / 254.0 * u_gust_max;');
    expect(DRAW_FS).toContain('float normalizedSpeed = clamp(v_cspeed / (u_gust_on > 0.5 ? max(u_ramp_max, 1.0) : u_max_speed), 0.0, 1.0);');
    expect(DRAW_VS).toContain('float sizeBase = v_speed < 0.5 ? 0.0 : 2.5 + 2.5 * smoothstep(1.0, 30.0, v_speed);');
    expect(DRAW_VS).toMatch(/keepRate \*= pow\(min\(1\.0, u_v2_speedkeep\.y \/ \(u_v2_speedkeep\.z \+ v_speed/);
  });
});

describe('the shader splice and its kill', () => {
  const loadShaders = (levers) => {
    let out;
    jest.isolateModules(() => {
      Object.assign(window, levers);
      try { out = require('./WebGLWindShaders'); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
    });
    return out;
  };

  test('killed before load: no gust code in either draw shader (the Wind draw pass exactly)', () => {
    const k = loadShaders({ __RAW_DISABLE_GUST_PARTICLES__: true });
    for (const s of [k.DRAW_VS, k.DRAW_FS]) {
      expect(s).not.toMatch(/u_gust|v_cspeed|v_flick|u_ramp_max/);
    }
    expect(k.DRAW_FS).toContain('float normalizedSpeed = clamp(v_speed / u_max_speed, 0.0, 1.0);');
    expect(k.DRAW_FS).toMatch(/: color\.a\);\n/);
  });

  test('on: the splice is present', () => {
    const s = loadShaders({});
    expect(s.DRAW_VS).toContain('varying float v_cspeed;');
    expect(s.DRAW_FS).toContain('varying float v_flick;');
  });
});

describe('gust flicker (the non-colour gustiness cue)', () => {
  test('the flicker: on by default, off under its kill and under prefers-reduced-motion', () => {
    const win = (reduce) => ({ matchMedia: () => ({ matches: reduce }) });
    expect(gustFlicker(win(false), 0).on).toBe(true);
    expect(gustFlicker(win(true), 0).on).toBe(false);
    expect(gustFlicker({ ...win(false), __RAW_DISABLE_GUST_FLICKER__: true }, 0).on).toBe(false);
  });

  test('flash-safe and gentle: under 3 Hz, never more than 35% dimmer', () => {
    expect(GUST_FLICKER_HZ).toBeLessThan(3);
    expect(GUST_FLICKER_DEPTH).toBeLessThanOrEqual(0.35);
  });

  test('the clock wraps on whole periods, so a long session keeps float32 phase', () => {
    const a = gustFlicker(null, 1e12).seconds;
    expect(a).toBeLessThan(1000 / GUST_FLICKER_HZ * 100 / 1000);
    const phase = (s) => (s * GUST_FLICKER_HZ) % 1;
    expect(phase(gustFlicker(null, 1e12).seconds)).toBeCloseTo(phase(1e12 / 1000), 4);
  });

  test('it only dims (alpha x v_flick), only in gust mode, and only where G/W is high; motion is untouched', () => {
    expect(DRAW_VS).toContain('v_flick = 1.0;');
    expect(DRAW_VS).toMatch(/if \(u_gust_on > 0\.5 && u_gust_flick\.x > 0\.5\)/);
    expect(DRAW_VS).toContain('smoothstep(1.3, 2.2, v_cspeed / max(v_speed, 2.0))');
    expect(DRAW_FS).toMatch(/: color\.a\) \* v_flick;/);
  });
});

describe('colour parity with the gust heatmap, every theme', () => {
  // The gust heatmap's step LUT and the marks' ramp both come from the wind's drawn tables; with the ramp spanning the same
  // 0-75 kn, a gust speed lands on the same hue family in marks and field (the marks keep their own ink/casing on top).
  test.each(['light', 'dark', 'beach'])('%s: the marks ramp is built over the gust span', (theme) => {
    const data = drawnMarkRampData(GUST_RAMP_MAX_KN, theme);
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(256 * 2 * 4);
    const scale = gustScale(theme);
    expect(scale && Array.isArray(scale.breakpoints)).toBe(true);
    expect(Math.max(...scale.breakpoints)).toBeLessThanOrEqual(GUST_RAMP_MAX_KN);
  });
});
