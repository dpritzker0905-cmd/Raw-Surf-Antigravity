import fs from 'fs';
import path from 'path';
import {
  colorAtValue, buildStepLut, opacityAtZoom, PRESSURE_OPACITY_STOPS, PRESSURE_LUT, wrapsLongitude, createOwnRasterLayer, RESIDENT_MAX,
  TEMPERATURE_LUT, TEMPERATURE_OPACITY_STOPS, NO_DATA_BELOW_GLSL, FS, downscaleAt, DZ_TILES_MAX, CLOUD_LUT, SATELLITE_OPACITY_STOPS, scaleForTheme,
} from './ownRasterLayer';
import { MISSING, NO_DATA_BELOW } from './ownRasterFrames';
import { BASE_CUSTOM_COLOR_SCALES, CUSTOM_COLOR_SCALES, applyThemePressureScale } from './colorScales';

// A recording WebGL2 stand-in: every call is logged; creators return fresh objects; the link always succeeds.
function fakeGl() {
  const calls = [];
  const u2 = [];      // uniform2f arguments: [uniform name, x, y]
  const u4 = [];      // uniform4f arguments: [uniform name, x, y, z, w]
  const tex = [];     // texImage2D: [internal format, width, height]
  let n = 0;
  const consts = new Proxy({}, { get: (t, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? `GL_${k}` : undefined) });
  const gl = new Proxy({}, {
    get(t, k) {
      if (k === '__calls') return calls;
      if (k === '__u2') return u2;
      if (k === '__u4') return u4;
      if (k === '__tex') return tex;
      if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return consts[k];
      return (...args) => {
        calls.push(k);
        if (k === 'uniform2f') u2.push([args[0] && args[0].u, args[1], args[2]]);
        if (k === 'uniform4f') u4.push([args[0] && args[0].u, args[1], args[2], args[3], args[4]]);
        if (k === 'texImage2D') tex.push([args[2], args[3], args[4]]);
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

describe('air temperature (2026-10-24): the library scale, its slot ramp, below-zero values', () => {
  // The .om path colours air temperature with the tile library's own 'temperature' scale through its getColor.
  const { defaultOmProtocolSettings, getColor } = require('@openmeteo/weather-map-layer');
  const scale = defaultOmProtocolSettings.colorScales.temperature;
  test('every breakpoint sits on the LUT step and inside its range (so the step LUT is exact at each boundary)', () => {
    const { min, step, n } = TEMPERATURE_LUT;
    for (const b of scale.breakpoints) {
      expect(Math.abs((b - min) / step - Math.round((b - min) / step))).toBeLessThan(1e-9);
      expect(b).toBeGreaterThanOrEqual(min);
      expect(b).toBeLessThanOrEqual(min + (n - 1) * step);
    }
  });
  test("the LUT, read as the shader reads it, is the library's own colour at every 0.05 deg C from -95 to 60", () => {
    const lut = buildStepLut(scale, TEMPERATURE_LUT);
    const { min, step, n } = TEMPERATURE_LUT;
    let checked = 0;
    for (let i = -1900; i <= 1200; i++) {
      const v = i / 20;
      const k = Math.min(n - 1, Math.max(0, Math.floor((v - min) / step + 1e-3)));
      const lib = getColor(scale, v);
      expect(colorAtValue(scale, v)).toBe(lib);
      expect([lut[k * 4], lut[k * 4 + 1], lut[k * 4 + 2], lut[k * 4 + 3]]).toEqual([lib[0], lib[1], lib[2], Math.round(lib[3] * 255)]);
      checked += 1;
    }
    expect(checked).toBe(3101);
  });
  test('pinned to the ramp MapWebGL paints the temperature slots with', () => {
    const src = fs.readFileSync(path.join(__dirname, 'MapWebGL.js'), 'utf8');
    for (const [z, o] of TEMPERATURE_OPACITY_STOPS) {
      expect(src).toMatch(new RegExp(`\\n\\s*${z}, layerKey === 'satellite' .* : layerKey === 'temperature' \\? ${o.toFixed(2)} :`));
    }
  });
  test('no data is the MISSING sentinel only: a below-zero value is drawn', () => {
    expect(Number(NO_DATA_BELOW_GLSL)).toBe(NO_DATA_BELOW);
    expect(MISSING).toBeLessThan(NO_DATA_BELOW);
    expect(FS).toContain(`< ${NO_DATA_BELOW_GLSL}) discard`);
    expect(FS).not.toMatch(/< 0\.0\) discard/);
  });
  test("the shader's isoline lever is pressure's only (shaderIsobars: false keeps it off)", () => {
    window.__RAW_OWN_RASTER_ISOBARS__ = 4;
    try {
      const isoOf = (opts) => {
        const gl = fakeGl(); const L = createOwnRasterLayer({ id: 'x', ...opts });
        L.onAdd(fakeMap(), gl); L.setLut(buildStepLut({ breakpoints: [0], colors: [[1, 2, 3, 1]] }));
        L.offerField('a', field(-12)); L.want('a'); L.prerender(gl, args); L.render(gl, args);
        return gl.__u2.filter((u) => u[0] === 'u_iso').map((u) => u[1]);
      };
      expect(isoOf({})).toEqual([4]);
      expect(isoOf({ lutMap: TEMPERATURE_LUT, opacityStops: TEMPERATURE_OPACITY_STOPS, shaderIsobars: false })).toEqual([0]);
    } finally { delete window.__RAW_OWN_RASTER_ISOBARS__; }
  });
});

test('the antimeridian wrap uses integer columns (a float mod drew a violet stripe at 180, matrix cell 6)', () => {
  const { FS } = require('./ownRasterLayer');
  expect(FS).toMatch(/c0 = int\(x0\) % n; if \(c0 < 0\) c0 \+= n;/);
  expect(FS).toMatch(/c1 = c0 \+ 1; if \(c1 >= n\) c1 = 0;/);
  expect(FS).not.toMatch(/int\(mod\(x0 \+ 1\.0, u_size\.x\)\)/);
});

describe('cloud cover, the satellite layer (2026-10-24): the library scale per theme, its slot ramp', () => {
  const { defaultOmProtocolSettings, getColor, resolveColorScale } = require('@openmeteo/weather-map-layer');
  const scale = defaultOmProtocolSettings.colorScales.cloud_cover;
  test('every breakpoint sits on the LUT step and inside its range', () => {
    const { min, step, n } = CLOUD_LUT;
    for (const b of scale.breakpoints) {
      expect(Math.abs((b - min) / step - Math.round((b - min) / step))).toBeLessThan(1e-9);
      expect(b).toBeLessThanOrEqual(min + (n - 1) * step);
    }
  });
  test.each([['dark', true], ['beach', true], ['light', false]])(
    "%s: the LUT, read as the shader reads it, is the library's own colour (dark=%p) at every 0.05 %% from 0 to 100", (theme, dark) => {
      const lib = resolveColorScale(scale, dark);
      const lut = buildStepLut(scaleForTheme(scale, theme), CLOUD_LUT);
      const { min, step, n } = CLOUD_LUT;
      for (let i = 0; i <= 2000; i++) {
        const v = i / 20;
        const k = Math.min(n - 1, Math.max(0, Math.floor((v - min) / step + 1e-3)));
        const c = getColor(lib, v);
        expect([lut[k * 4], lut[k * 4 + 1], lut[k * 4 + 2], lut[k * 4 + 3]]).toEqual([c[0], c[1], c[2], Math.round(c[3] * 255)]);
      }
    });
  test("dark AND beach take the dark colours: the same rule as the .om URL's dark=true", () => {
    const src = fs.readFileSync(path.join(__dirname, 'useOpenMeteoTileUrls.js'), 'utf8');
    expect(src).toContain("const darkParam = (theme === 'dark' || theme === 'beach') ? '&dark=true' : '';");
    expect(scaleForTheme(scale, 'beach').colors).toBe(scale.colors.dark);
    expect(scaleForTheme(scale, 'light').colors).toBe(scale.colors.light);
    const plain = { breakpoints: [0], colors: [[1, 2, 3, 1]] };
    expect(scaleForTheme(plain, 'dark')).toBe(plain);
  });
  test('pinned to the ramp MapWebGL paints the satellite slots with', () => {
    const src = fs.readFileSync(path.join(__dirname, 'MapWebGL.js'), 'utf8');
    for (const [z, o] of SATELLITE_OPACITY_STOPS) {
      expect(src).toMatch(new RegExp(`\\n\\s*${z}, layerKey === 'satellite' \\? ${o.toFixed(2)} :`));
    }
  });
});


describe('air temperature elevation downscale (2026-10-25): T + lapse * dz from the static asset', () => {
  // A 2-tile asset over a 6 x 4 lattice (dlon 60, dlat 60, from 180W / 90S): tile 0 = columns 0-2 + overlap (3), tile 1 =
  // columns 3-5 + overlap (0, the wrap). Codes: offset 128, 25 m steps.
  const L = { south: -90, west: -180, dlat: 60, dlon: 60, rows: 4, cols: 6 };
  const codes = [[128, 132, 136, 140, 144, 148], [130, 134, 138, 142, 146, 150], [128, 128, 128, 128, 128, 128], [160, 160, 160, 160, 160, 160]];
  const tile = (c0, c1, overlapCol) => ({ col0: c0, cols: c1 - c0 + 1, rows: 4,
    data: Uint8Array.from(codes.flatMap((r) => [...r.slice(c0, c1), r[overlapCol]])) });
  const asset = { lattice: L, offset: 128, step: 25, lapse: -0.0065, tiles: [tile(0, 3, 3), tile(3, 6, 0)] };

  test('downscaleAt: exact at nodes, bilinear between, seamless across the tile edge and the antimeridian', () => {
    expect(downscaleAt(asset, -180, -90)).toBe(0);                          // code 128
    expect(downscaleAt(asset, -120, -90)).toBe(100);                        // code 132 = +4 steps
    expect(downscaleAt(asset, 0, -30)).toBe((142 - 128) * 25);              // column 3 (tile 1's first), row 1
    expect(downscaleAt(asset, -30, -90)).toBeCloseTo(((136 + 140) / 2 - 128) * 25, 9);   // across the tile edge (via the overlap)
    expect(downscaleAt(asset, 150, -90)).toBeCloseTo(((148 + 128) / 2 - 128) * 25, 9);   // across 180 (the wrap overlap)
    expect(downscaleAt(asset, -150, -60)).toBeCloseTo(((128 + 132 + 130 + 134) / 4 - 128) * 25, 9);
  });

  test('the shader adds lapse * dz BEFORE the colour lookup, sampling level 0 of the right tile', () => {
    const i = FS.indexOf('v = v + u_dzCode.z * (code * 255.0 - u_dzCode.x) * u_dzCode.y;');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(FS.indexOf('float k = clamp(floor((v - u_lutMap.x)'));
    expect(FS).toContain('textureLod(u_dz0,');
    expect(FS).toContain('gx < u_dzLon.w');
  });

  test('one tile uploads per frame (R8); the downscale switches on only once every tile is resident; context loss re-uploads', () => {
    const gl = fakeGl(); const map = fakeMap();
    const Lr = createOwnRasterLayer({ id: 't', lutMap: TEMPERATURE_LUT, opacityStops: TEMPERATURE_OPACITY_STOPS, shaderIsobars: false });
    Lr.onAdd(map, gl); Lr.setLut(buildStepLut({ breakpoints: [-80], colors: [[1, 2, 3, 1]] }, TEMPERATURE_LUT));
    Lr.offerField('a', field(5)); Lr.want('a');
    expect(Lr.setDownscale(asset)).toBe(true);
    const on = () => gl.__u4.filter((u) => u[0] === 'u_dzLat').map((u) => u[4]);
    Lr.prerender(gl, args); Lr.render(gl, args);
    expect(gl.__tex.filter((t) => t[0] === 'GL_R8')).toEqual([['GL_R8', 4, 4]]);
    expect(on()).toEqual([0]);                                              // one tile of two: drawn as is
    Lr.prerender(gl, args); Lr.render(gl, args);
    expect(gl.__tex.filter((t) => t[0] === 'GL_R8').length).toBe(2);
    expect(on()).toEqual([0, 1]);
    expect(gl.__u4.filter((u) => u[0] === 'u_dzLon').pop()).toEqual(['u_dzLon', -180, 60, 6, 3]);
    expect(gl.__u4.filter((u) => u[0] === 'u_dzCode').pop()).toEqual(['u_dzCode', 128, 25, -0.0065, 4]);
    expect(Lr.downscaleReady()).toBe(true);
    map.listeners.webglcontextlost({ preventDefault() {} });
    expect(Lr.downscaleReady()).toBe(false);
    map.listeners.webglcontextrestored();
    Lr.prerender(gl, args); Lr.prerender(gl, args);
    expect(Lr.downscaleReady()).toBe(true);
  });

  test('more tiles than the shader takes, or none, is refused: the field draws as is', () => {
    const gl = fakeGl(); const Lr = createOwnRasterLayer({ id: 'x' }); Lr.onAdd(fakeMap(), gl);
    expect(DZ_TILES_MAX).toBe(2);
    expect(Lr.setDownscale({ ...asset, tiles: [asset.tiles[0], asset.tiles[1], asset.tiles[0]] })).toBe(false);
    expect(Lr.setDownscale(null)).toBe(false);
    expect(Lr.downscaleReady()).toBe(false);
  });
});
