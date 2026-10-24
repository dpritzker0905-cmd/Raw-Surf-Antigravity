import fs from 'fs';
import path from 'path';
import {
  colorAtValue, buildStepLut, opacityAtZoom, PRESSURE_OPACITY_STOPS, PRESSURE_LUT, wrapsLongitude, createOwnRasterLayer, RESIDENT_MAX,
} from './ownRasterLayer';
import { BASE_CUSTOM_COLOR_SCALES, CUSTOM_COLOR_SCALES, applyThemePressureScale } from './colorScales';

// A recording WebGL2 stand-in: every call is logged; creators return fresh objects; the link always succeeds.
function fakeGl() {
  const calls = [];
  let n = 0;
  const consts = new Proxy({}, { get: (t, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? `GL_${k}` : undefined) });
  const gl = new Proxy({}, {
    get(t, k) {
      if (k === '__calls') return calls;
      if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return consts[k];
      return (...args) => {
        calls.push(k);
        if (/^create/.test(k)) { n += 1; return { kind: k, n }; }
        if (k === 'getProgramParameter') return true;
        if (k === 'getUniformLocation') return { u: args[1] };
        if (k === 'isContextLost') return false;
        return undefined;
      };
    },
  });
  return gl;
}
function fakeMap() {
  const listeners = {};
  const canvas = {
    addEventListener: (e, fn) => { listeners[e] = fn; },
    removeEventListener: (e) => { delete listeners[e]; },
  };
  return { canvas, listeners, getCanvas: () => canvas, getZoom: () => 4, triggerRepaint: () => {} };
}
const args = { defaultProjectionData: { mainMatrix: new Float32Array(16) } };
const field = (v) => ({ cols: 720, rows: 361, bounds: { west: -180, south: -90, east: 179.5, north: 90 }, values: new Float32Array(720 * 361).fill(v) });

describe('colour rule = the tile library (largest breakpoint <= value, clamped to the first)', () => {
  const scale = { type: 'breakpoint', breakpoints: [970, 990, 1013], colors: [[1, 0, 0, 1], [0, 1, 0, 0.5], [0, 0, 1, 0]] };
  test.each([[960, 0], [970, 0], [989.99, 0], [990, 1], [1012.9, 1], [1013, 2], [1100, 2]])('%p -> colour %p', (v, i) => {
    expect(colorAtValue(scale, v)).toBe(scale.colors[i]);
  });
  test('the LUT bakes that rule at 0.1 hPa, straight alpha in bytes', () => {
    const lut = buildStepLut(scale, { min: 989.9, step: 0.1, n: 3 });
    expect(Array.from(lut.slice(0, 4))).toEqual([1, 0, 0, 255]);       // 989.9
    expect(Array.from(lut.slice(4, 8))).toEqual([0, 1, 0, 128]);       // 990.0 (0.5 -> 128)
  });
  test('every theme: each LUT entry is the smoothed scale the .om path draws', () => {
    for (const theme of ['dark', 'light', 'beach']) {
      applyThemePressureScale(theme);
      const s = CUSTOM_COLOR_SCALES.pressure_msl;
      const lut = buildStepLut(s);
      for (const k of [0, 500, 1199, 1430, 1431, 1500, 2199]) {
        const c = colorAtValue(s, Math.round((PRESSURE_LUT.min + k * PRESSURE_LUT.step) * 1e6) / 1e6);
        expect(Array.from(lut.slice(k * 4, k * 4 + 3))).toEqual(c.slice(0, 3));
      }
      expect(BASE_CUSTOM_COLOR_SCALES.pressure_msl.breakpoints).toEqual([970, 990, 1005, 1009, 1013, 1018, 1025, 1045]);
    }
    applyThemePressureScale('dark');
  });
});

describe('opacity follows the pressure slot ramp in MapWebGL', () => {
  test('interpolates and clamps', () => {
    expect(opacityAtZoom(PRESSURE_OPACITY_STOPS, 0)).toBe(0.35);
    expect(opacityAtZoom(PRESSURE_OPACITY_STOPS, 3.5)).toBeCloseTo(0.385, 6);
    expect(opacityAtZoom(PRESSURE_OPACITY_STOPS, 20)).toBe(0.55);
  });
  test('pinned to the ramp MapWebGL paints the .om slots with', () => {
    const src = fs.readFileSync(path.join(__dirname, 'MapWebGL.js'), 'utf8');
    for (const [z, o] of PRESSURE_OPACITY_STOPS) {
      expect(src).toMatch(new RegExp(`\\n\\s*${z}, layerKey === 'satellite' \\? [0-9.]+ : layerKey === 'pressure' \\? ${o.toFixed(2)} :`));
    }
  });
});

test('the 0.5-degree global grid wraps; a regional one does not', () => {
  expect(wrapsLongitude(field(1000))).toBe(true);
  expect(wrapsLongitude({ cols: 100, bounds: { west: -100, east: -50.5 } })).toBe(false);
});

describe('the GL layer', () => {
  function setup() {
    const gl = fakeGl(); const map = fakeMap();
    const L = createOwnRasterLayer({ id: 'own-raster-pressure' });
    L.onAdd(map, gl);
    L.setLut(buildStepLut({ breakpoints: [0], colors: [[1, 2, 3, 1]] }));
    return { gl, map, L };
  }
  const frame = (L, gl) => { L.prerender(gl, args); L.render(gl, args); };
  const draws = (gl) => gl.__calls.filter((c) => c === 'drawArrays').length;

  test('no synchronous state reads per frame (one link-status read at init only)', () => {
    const { gl, L } = setup();
    L.offerField('a', field(1000)); L.want('a');
    frame(L, gl);
    const initReads = gl.__calls.filter((c) => /^get(Parameter|ProgramParameter|ShaderParameter|Error)$/.test(c)).length;
    expect(initReads).toBe(1);
    gl.__calls.length = 0;
    for (let i = 0; i < 5; i++) frame(L, gl);
    expect(gl.__calls.filter((c) => /^(get|is|read|finish|flush|checkFramebufferStatus)/.test(c))).toEqual([]);
    expect(draws(gl)).toBe(5);
  });

  test('hard cut: the shown frame holds until the wanted one is resident, then switches in one frame', () => {
    const { gl, L } = setup();
    L.offerField('a', field(1000)); L.want('a'); frame(L, gl);
    expect(L.shownPath()).toBe('a');
    L.want('b'); frame(L, gl);
    expect(L.shownPath()).toBe('a');                     // b not offered yet: a holds (the status line says so)
    L.offerField('b', field(1010)); frame(L, gl);        // uploaded in prerender, shown in the same frame's render
    expect(L.shownPath()).toBe('b');
  });

  test('the wanted frame uploads first; one upload per frame', () => {
    const { gl, L } = setup();
    L.offerField('x', field(1)); L.offerField('y', field(2)); L.offerField('z', field(3));
    L.want('z'); frame(L, gl);
    expect(L.isResident('z')).toBe(true);
    expect(L.isResident('x')).toBe(false);
  });

  test('no frame for the asked hour: nothing is drawn (never another hour under the label)', () => {
    const { gl, L } = setup();
    L.offerField('a', field(1000)); L.want('a'); frame(L, gl);
    gl.__calls.length = 0;
    L.want(null); frame(L, gl);
    expect(draws(gl)).toBe(0);
  });

  test('resident textures are capped, never evicting the shown or wanted frame', () => {
    const { gl, L } = setup();
    L.offerField('p0', field(0)); L.want('p0'); frame(L, gl);
    for (let i = 1; i <= RESIDENT_MAX + 2; i++) { L.offerField(`p${i}`, field(i)); frame(L, gl); }
    expect(L.isResident('p0')).toBe(true);
    const resident = Array.from({ length: RESIDENT_MAX + 3 }, (_, i) => `p${i}`).filter((p) => L.isResident(p));
    expect(resident.length).toBe(RESIDENT_MAX);
  });

  test('context loss: no GL calls while lost; after restore the program and fields are rebuilt', () => {
    const { gl, map, L } = setup();
    L.offerField('a', field(1000)); L.want('a'); frame(L, gl);
    map.listeners.webglcontextlost({ preventDefault() {} });
    gl.__calls.length = 0;
    frame(L, gl);
    expect(gl.__calls).toEqual([]);
    map.listeners.webglcontextrestored();
    frame(L, gl);                                           // init + LUT + re-upload of 'a' + draw
    expect(gl.__calls).toContain('linkProgram');
    expect(L.isResident('a')).toBe(true);
    expect(draws(gl)).toBe(1);
  });
});

test('a device that cannot draw it reports once, so the caller hands the layer back to the .om path', () => {
  const why = [];
  const L = createOwnRasterLayer({ id: 'x', onFail: (w) => why.push(w) });
  const webgl1 = { createTexture() {} };
  L.onAdd(fakeMap(), webgl1);
  L.prerender(webgl1, args); L.render(webgl1, args);
  expect(why).toEqual(['webgl1']);
  expect(L.failed()).toBe(true);
});

test('the antimeridian wrap uses integer columns (a float mod drew a violet stripe at 180, matrix cell 6)', () => {
  const { FS } = require('./ownRasterLayer');
  expect(FS).toMatch(/c0 = int\(x0\) % n; if \(c0 < 0\) c0 \+= n;/);
  expect(FS).toMatch(/c1 = c0 \+ 1; if \(c1 >= n\) c1 = 0;/);
  expect(FS).not.toMatch(/int\(mod\(x0 \+ 1\.0, u_size\.x\)\)/);
});
