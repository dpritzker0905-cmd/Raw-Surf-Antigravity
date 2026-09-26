/**
 * A15-13 (audit 15.0): the heatmap fragment shader keeps geography at high precision.
 *
 * mediump's guaranteed minimum is fp16. Emulated at fp16 (audit J-03), the shader's latitude
 * snapped ±0.04° (≈ ±4.3 km at Sebastian Inlet), longitude 0.0625°, and the land-aware sampler's
 * texel-space position a whole texel on the world grid. Compiled and linked on WebGL1 and WebGL2
 * (ANGLE/D3D11) both as written and with GEO_P forced to mediump; these tests pin the source.
 */
import { HEATMAP_FS, HEATMAP_VS } from './WebGLMarineShaders';

const GEO_LOCALS = ['lng', 'lat', 'tex_u', 'span', 'tex_v', 'maskMercMinY', 'maskMercMaxY', 'mask_u',
  'mspan', 'mask_v', 'oMercMinY', 'oMercMaxY', 'o_u', 'o_v', 'mMinY', 'mMaxY', 'su', 'sv',
  'sinhVal', 'latClamped', 'rad'];

test('GEO_P is highp where the fragment stage supports it, mediump otherwise', () => {
  expect(HEATMAP_FS).toMatch(/#ifdef GL_FRAGMENT_PRECISION_HIGH\n#define GEO_P highp\n#else\n#define GEO_P mediump\n#endif/);
  // the default for everything else (colour math) is unchanged
  expect(HEATMAP_FS).toContain('precision mediump float;');
});

test.each(GEO_LOCALS)('no bare mediump declaration of the geographic value %s', (name) => {
  const bare = new RegExp(`^[ \\t]+float ${name}\\b`, 'm');
  const promoted = new RegExp(`^[ \\t]+GEO_P float ${name}\\b`, 'm');
  expect(HEATMAP_FS).not.toMatch(bare);
  expect(HEATMAP_FS).toMatch(promoted);
});

test('the Mercator helpers and the land-aware sampler take and return GEO_P', () => {
  expect(HEATMAP_FS).toContain('GEO_P float mercatorYToLat(GEO_P float y)');
  expect(HEATMAP_FS).toContain('GEO_P float latToMercatorY(GEO_P float lat)');
  expect(HEATMAP_FS).toContain('vec4 sampleWaveLandAware(GEO_P vec2 uv)');
  expect(HEATMAP_FS).toContain('GEO_P vec2 tc = uv / u_waveTexel - 0.5;');
  expect(HEATMAP_FS).toContain('uniform GEO_P vec2 u_waveTexel;');
  expect(HEATMAP_FS).toContain('float oceanAtGeo(GEO_P float slng, GEO_P float slat)');
  expect(HEATMAP_FS).toContain('float coastLandFrac(GEO_P float lng, GEO_P float lat, float dDeg)');
  expect(HEATMAP_FS).toMatch(/GEO_P vec2 grid_uv/);
  expect(HEATMAP_FS).toMatch(/GEO_P vec2 mask_uv/);
});

test('uniforms the vertex shader shares keep one precision in both stages (link-safe)', () => {
  // u_waveTexel is fragment-only, which is why it may change; these may not.
  for (const decl of ['uniform highp vec2 u_dataBounds_min;', 'uniform highp vec2 u_dataBounds_max;']) {
    expect(HEATMAP_VS).toContain(decl);
    expect(HEATMAP_FS).toContain(decl);
  }
  expect(HEATMAP_FS).toContain('uniform highp float u_lng_offset;');
  expect(HEATMAP_VS).not.toContain('u_waveTexel');
  expect(HEATMAP_VS).not.toContain('GEO_P');
});

test('the defect it prevents is real: fp16 moves latitude by kilometres at a surf coast', () => {
  const h16 = (x) => { const e = Math.floor(Math.log2(Math.abs(x))); const ulp = 2 ** (Math.max(e, -14) - 10); return Math.round(x / ulp) * ulp; };
  const y = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
  const lat = (yy) => Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180 / Math.PI;
  let worst = 0;
  for (let d = -0.25; d <= 0.25; d += 0.001) worst = Math.max(worst, Math.abs(lat(h16(y(27.86 + d))) - (27.86 + d)));
  expect(worst * 111.32).toBeGreaterThan(3);      // km — the banding this change removes
});
