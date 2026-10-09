/**
 * POINT REGISTRATION (2026-10-08, owner: "a slight shift in [the] field at closer up zooms ... on small pannings after
 * a pan is done, maybe a second or two later"). The backend serves every grid point-registered (bounds = sample
 * extents); GL treated bounds as cell edges, misplacing each sample by up to half a cell, differently per grid, so each
 * post-pan grid swap slid the field. Live, dev 744a7132, z7 Gulf: a 2-deg regional grid going 8 -> 9 columns 3.0 s
 * after moveend slid the field 28 css px east (frame cross-correlation; null control 0 px), ~24 px predicted.
 * GPU (real wind HEATMAP shader, WebGL1+2, 11x11 grid, hot sample at -4/-6): legacy peak drawn at -3.636/-5.456
 * (this file's legacy model predicts -3.636/-5.455); with the fix at -4.000/-6.001.
 */
import fs from 'fs';
import path from 'path';
import { gridPointReg, setGridPointRegUniform, GRID_REG_OFF, GLSL_PT_REG } from './gridPointRegistration';
import { setLandAwareFetchUniforms } from './marineLandAwareFetch';
import { bindWindPointReg } from './WebGLWindUtils';

const apply = (uv, r) => [uv[0] + uv[0] * r[0] + r[2], uv[1] + uv[1] * r[1] + r[3]];   // the GLSL ptReg, in JS
// Where a sample-space position ends up on the map: GL returns texel k exactly at texture coord (k + 0.5) / n, so the
// geographic uv that samples texel k is the u solving apply(u) = (k + 0.5) / n. Legacy (zeros): u = (k + 0.5) / n.
const drawnLng = (grid, k, r) => {
  const t = (k + 0.5) / grid.cols, u = (t - r[2]) / (1 + r[0]);
  return grid.bounds.west + u * (grid.bounds.east - grid.bounds.west);
};
const g = (west, east, cols, south = 0, north = 10, rows = 6) => ({ bounds: { west, east, south, north }, cols, rows });

describe('the mapping', () => {
  it('puts every sample exactly on its texel centre, endpoints included', () => {
    for (const n of [2, 8, 9, 11, 19, 181, 1441]) {
      const r = gridPointReg({ cols: n, rows: n }, {});
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 17))) {
        const [u, v] = apply([i / (n - 1), i / (n - 1)], r);
        expect(u).toBeCloseTo((i + 0.5) / n, 12);
        expect(v).toBeCloseTo((i + 0.5) / n, 12);
      }
    }
  });
  it('equals (uv (n - 1) + 1/2) / n everywhere', () => {
    const r = gridPointReg({ cols: 37, rows: 23 }, {});
    for (const uv of [[0, 0], [0.13, 0.71], [0.5, 0.5], [0.999, 0.002], [1, 1]]) {
      const [u, v] = apply(uv, r);
      expect(u).toBeCloseTo((uv[0] * 36 + 0.5) / 37, 12);
      expect(v).toBeCloseTo((uv[1] * 22 + 0.5) / 23, 12);
    }
  });
  it('the GPU-measured legacy placement is the model; the fix lands on the true sample', () => {
    const grid = g(-10, 10, 11);
    expect(drawnLng(grid, 3, GRID_REG_OFF)).toBeCloseTo(-3.636, 3);                  // GPU: -3.636
    expect(drawnLng(grid, 3, gridPointReg(grid, {}))).toBeCloseTo(-4, 12);           // GPU: -4.000
  });
});

describe('the owner-visible symptom: a swap no longer moves the field', () => {
  // The live case: a 2-deg regional grid 8 -> 9 columns (-96..-82 -> -96..-80). Sample k = 4 is lng -88 in both.
  const before = g(-96, -82, 8), after = g(-96, -80, 9);
  it('POSITIVE CONTROL: the legacy mapping draws the same sample 0.11 deg apart in the two grids (~20 css px at z7)', () => {
    const shift = drawnLng(after, 4, GRID_REG_OFF) - drawnLng(before, 4, GRID_REG_OFF);
    expect(Math.abs(shift)).toBeGreaterThan(0.1);
    expect(Math.abs(shift) * 512 * 128 / 360).toBeGreaterThan(19);
  });
  it('with the fix both grids draw it at its true longitude, so the swap moves nothing', () => {
    expect(drawnLng(before, 4, gridPointReg(before, {}))).toBeCloseTo(-88, 12);
    expect(drawnLng(after, 4, gridPointReg(after, {}))).toBeCloseTo(-88, 12);
  });
  it('a world grid (181 columns over -180..180) and a regional clip agree on every shared sample', () => {
    const world = g(-180, 180, 181), clip = g(-106, -70, 19);
    for (let k = 0; k < 19; k++) {
      expect(drawnLng(clip, k, gridPointReg(clip, {}))).toBeCloseTo(drawnLng(world, k + 37, gridPointReg(world, {})), 9);
    }
  });
});

describe('fail-safe', () => {
  it('kill switch, missing or malformed grids give the legacy zeros (the identity mapping)', () => {
    expect(gridPointReg({ cols: 11, rows: 11 }, { __RAW_DISABLE_GRID_POINT_REG__: true })).toBe(GRID_REG_OFF);
    [null, undefined, {}, { cols: 1, rows: 9 }, { cols: '9', rows: 9 }, { cols: NaN, rows: 9 }, { cols: 9, rows: Infinity }]
      .forEach((bad) => expect(gridPointReg(bad, {})).toBe(GRID_REG_OFF));
    expect(apply([0.37, 0.81], GRID_REG_OFF)).toEqual([0.37, 0.81]);
  });
  it('an UNSET uniform (GL defaults to zeros) is also the identity, never a field collapsed onto one texel', () => {
    expect(apply([0.2, 0.9], [0, 0, 0, 0])).toEqual([0.2, 0.9]);
  });
});

function fakeGl() {
  const calls = [];
  return { calls, getUniformLocation: (p, n) => ({ p, n }), uniform4f: (l, a, b, c, d) => calls.push([l.n, a, b, c, d]),
    uniform2f: (l) => calls.push([l.n]), uniform1f: (l) => calls.push([l.n]) };
}

describe('wiring', () => {
  it('setGridPointRegUniform binds the vec4 it returns', () => {
    const gl = fakeGl();
    const r = setGridPointRegUniform(gl, {}, 'u_x', { cols: 4, rows: 5 }, {});
    expect(gl.calls).toEqual([['u_x', -1 / 4, -1 / 5, 0.5 / 4, 0.5 / 5]]);
    expect(r).toEqual([-1 / 4, -1 / 5, 0.5 / 4, 0.5 / 5]);
  });
  it('wind: bindWindPointReg sets the base and fine pair', () => {
    const gl = fakeGl();
    bindWindPointReg(gl, {}, { cols: 181, rows: 83 }, null, {});
    expect(gl.calls.map((c) => c[0])).toEqual(['u_base_reg', 'u_fine_reg']);
    expect(gl.calls[1].slice(1)).toEqual([0, 0, 0, 0]);                                // no fine grid -> legacy zeros
  });
  it('marine: the per-pass helper sets u_wave_reg on EVERY pass, even with land-aware fetch off (the default)', () => {
    const gl = fakeGl();
    setLandAwareFetchUniforms(gl, {}, { cols: 1441, rows: 681 });
    const reg = gl.calls.find((c) => c[0] === 'u_wave_reg');
    expect(reg && reg.slice(1)).toEqual([-1 / 1441, -1 / 681, 0.5 / 1441, 0.5 / 681]);
  });
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  it('wind engine binds the correction on the heatmap (base + legacy overlay), advect and draw programs', () => {
    const src = read('WebGLWindEngine.js');
    expect(src).toContain('bindWindPointReg(gl, this.heatmapProgram, this._windData.windGrid, fine && fine.windGrid)');
    expect(src).toContain('bindWindPointReg(gl, this.heatmapProgram, fine.windGrid, fine.windGrid)');
    expect(src).toContain('bindWindPointReg(gl, this.advectProgram, this._windData.windGrid, fine && fine.windGrid)');
    expect(src).toContain('bindWindPointReg(gl, this.drawProgram, this._windData.windGrid, fine && fine.windGrid)');
  });
  it('marine engine binds u_wave_reg on both particle programs', () => {
    const src = read('WebGLMarineEngine.js');
    ['drawProgram', 'advectProgram'].forEach((p) => expect(src).toContain(`setGridPointRegUniform(gl, this.${p}, 'u_wave_reg', this._waveData.waveGrid)`));
  });
});

describe('shader guards: no data-grid lookup bypasses the correction', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  it('every wind texture lookup goes through ptReg', () => {
    const lines = read('WebGLWindShaders.js').split('\n').filter((l) => /texture2D\(u_wind(_fine)?,/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(15);
    lines.forEach((l) => expect(l).toContain('ptReg('));
  });
  it('marine heatmap: wave, bathymetry and chlorophyll read data_uv', () => {
    const src = read('WebGLMarineShaders.js');
    expect(src).toContain('GEO_P vec2 data_uv = ptReg(grid_uv, u_wave_reg);');
    expect(src).toContain('sampleWaveLandAware(data_uv)');
    expect(src).toContain('texture2D(u_bathymetryTexture, data_uv)');
    expect(src).toContain('texture2D(u_chlorophyllTexture, data_uv)');
    expect(src).not.toMatch(/texture2D\(u_(bathymetry|chlorophyll)Texture, grid_uv\)|sampleWaveLandAware\(grid_uv\)/);
  });
  it('marine particles: resident wave/bath lookups and the nearest-cell snap read ptReg(tex_uv)', () => {
    const src = read('WebGLMarineParticleShaders.js');
    expect(src.split('texture2D(u_waveTexture, ptReg(tex_uv, u_wave_reg))').length - 1).toBe(2);
    expect(src.split('floor(ptReg(tex_uv, u_wave_reg) * u_waveGridSize)').length - 1).toBe(2);
    expect(src).toContain('texture2D(u_bathTexture, ptReg(tex_uv, u_wave_reg))');
    expect(src).not.toMatch(/texture2D\(u_(waveTexture|bathTexture), tex_uv\)/);
  });
  it('every shader ptReg is the same arithmetic as the JS mapping', () => {
    expect(GLSL_PT_REG).toContain('return uv + uv * r.xy + r.zw;');
    const marine = read('WebGLMarineShaders.js') + read('WebGLMarineParticleShaders.js');
    expect(marine.split('return uv + uv * r.xy + r.zw;').length - 1).toBe(3);
    expect(read('WebGLWindShaders.js').split('${GLSL_PT_REG}').length - 1).toBe(3);
  });
});
