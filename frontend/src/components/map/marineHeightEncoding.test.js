// THE HEIGHT BYTE (2026-10-20): the per-upload scale, its kill, and the byte-identity of everything that must not move.
// Baselines: hashed at #411's head c40cbe67f before any file here changed (dev f550d2502, #411's squash, has the same tree).
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const BEFORE = {
  glsl: {
    HEATMAP_VS: 'dc56341973da27cd818befb2f8069c806e83cec99223f8399991bfc538e40019',
    HEATMAP_FS: '507ceae7ec8264e03433bc2f11bbe6a5fdde7f2b84327cd0821559d63869a972',
    ADVECT_VS: '7d7bfc3037c8394ead29c26358e1563582104feb8be5cc66e90f13480e9c2172',
    ADVECT_FS: 'f5d710e06e246deeb010b35fa9e1f5acfe4abe759ecae9e0a092672d1cc9ada6',
    DRAW_VS: 'd930dc264282b36e95fbf35ee046dd8924e041984e249332d4d351362fc69d20',
    DRAW_FS: 'a9e8e1026083bc9b9ca950d1e209bb0139a89f1a52ca9ba02306ddbc51d3a0ad',
  },
  // The fixture grid below, encoded at #411's head: the wave texture (identical for every theme then) and the rating score texture.
  wave: 'a5299dc7eb487086973077d3fc83c8040f1a6e673e3431969a6e5803457aad5d',
  score: 'd74ab586063e47c0ba9511d389ddf88bc51da771338aa6d59c36141fb4c350d9',
};
// With the float height's kill too: its GLSL rewrite is a lever of its own (marineHeightFloat.js), pinned in marineHeightFloat.test.js
// for 16 m off with float on; here the shader strings must be #411's exactly. The texture bytes do not depend on it.
const NO_FLOAT = { __RAW_DISABLE_WAVE_HEIGHT_FLOAT__: true };
const KILL = { __RAW_DISABLE_WAVE_HEIGHT_16M__: true, ...NO_FLOAT };

function withWindow(levers, fn) {
  let out;
  jest.isolateModules(() => {
    Object.assign(window, levers);
    try { out = fn(); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
  });
  return out;
}

function makeRecordingGL() {
  let handle = 0; let bound = null; let flipY = false;
  const uploads = new Map(), uniforms = [];
  const gl = {
    TEXTURE_2D: 'TEXTURE_2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UNSIGNED_BYTE', LINEAR: 'LINEAR', NEAREST: 'NEAREST',
    CLAMP_TO_EDGE: 'CLAMP_TO_EDGE', TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG',
    TEXTURE_BINDING_2D: 'TEXTURE_BINDING_2D', UNPACK_FLIP_Y_WEBGL: 'UNPACK_FLIP_Y_WEBGL',
    getParameter: (p) => (p === 'TEXTURE_BINDING_2D' ? bound : p === 'UNPACK_FLIP_Y_WEBGL' ? flipY : null),
    createTexture: () => ({ __tex: ++handle }), deleteTexture: () => {}, bindTexture: (_t, tex) => { bound = tex; },
    texParameteri: () => {}, pixelStorei: (p, v) => { if (p === 'UNPACK_FLIP_Y_WEBGL') flipY = v; },
    texImage2D: (...a) => { if (a.length >= 9 && bound) uploads.set(bound, a[8] ? Uint8Array.from(a[8]) : null); },
    texSubImage2D: () => {},
    getUniformLocation: (prog, name) => ({ prog, name }),
    uniform2f: (loc, x, y) => uniforms.push([loc.prog, loc.name, x, y]),
  };
  return { gl, uploads, uniforms };
}

// 9 x 5 cells, heights 0-18 m (past both ceilings), a few land cells; the rating twin carries a score in `speed` and the honest
// height in `phys_speed`, as the backend's rating_transform_grid does.
const H = (i) => (i * 0.41) % 18.5;
function grid(rating) {
  const cols = 9, rows = 5, vectors = [];
  for (let i = 0; i < cols * rows; i++) {
    const h = H(i);
    vectors.push(i % 11 === 7 ? { is_valid: false, u: 0, v: 0, speed: 0, height: 0, period: 0, direction: 0 }
      : rating ? { direction: (i * 37) % 360, speed: ((i * 2.3) % 10), phys_speed: h, period: 6 + (i % 12), is_valid: true }
        : { direction: (i * 37) % 360, speed: h, height: h, period: 6 + (i % 12), is_valid: true });
  }
  return { cols, rows, vectors, __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 3, ratingMode: rating,
    coverage_scope: 'regional', productId: `h16-${rating}`, bounds: { west: -110, east: -100, south: 10, north: 20 } };
}
function encode(theme, rating) {
  window.__WEBGL_MARINE_THEME__ = theme;
  try {
    const { encodeMarineTexture } = require('./WebGLMarineTextureEncoder');
    const { gl, uploads } = makeRecordingGL();
    const out = encodeMarineTexture(gl, grid(rating), null, {}, undefined);
    return { out, wave: uploads.get(out.u_waveTexture), score: out.u_waveScoreTexture ? uploads.get(out.u_waveScoreTexture) : null };
  } finally { delete window.__WEBGL_MARINE_THEME__; }
}
const shaders = () => ({ ...require('./WebGLMarineShaders'), ...require('./WebGLMarineParticleShaders') });
const NAMES = Object.keys(BEFORE.glsl);

describe('the kill (window.__RAW_DISABLE_WAVE_HEIGHT_16M__) restores /10 exactly', () => {
  it('every shader string hashes to #411 head (with the D-035 beach kill: #411 drew beach on v2)', () => {
    // ...and light crest V2's kill: its four DRAW_FS lines are marineCrestPaletteLight.test.js's to pin.
    withWindow({ ...KILL, __RAW_DISABLE_WAVE_BEACH_V1__: true, __RAW_DISABLE_LIGHT_CREST_V2__: true }, () => { const s = shaders(); NAMES.forEach((k) => expect([k, sha(s[k])]).toEqual([k, BEFORE.glsl[k]])); });
  });
  it.each(['dark', 'light', 'beach'])('%s: the wave and score texture bytes hash to #411 head, and the upload says 10', (theme) => {
    withWindow(KILL, () => {
      const honest = encode(theme, false), rated = encode(theme, true);
      expect(sha(Buffer.from(honest.wave))).toBe(BEFORE.wave);
      expect(sha(Buffer.from(rated.wave))).toBe(BEFORE.wave);
      expect(sha(Buffer.from(rated.score))).toBe(BEFORE.score);
      expect(honest.out.u_heightScale).toBe(10);
    });
  });
  it('sets no uniform (the GLSL has none) and every theme encodes /10', () => {
    withWindow(KILL, () => {
      const { setWaveHeightScale, withHeightScale } = require('./marineHeightEncoding');
      const { marineWaveHeightScale } = require('./marineWavePalette');
      const { gl, uniforms } = makeRecordingGL();
      setWaveHeightScale(gl, 'heatmap', { u_heightScale: 16 });
      expect(uniforms).toEqual([]);
      const src = 'precision mediump float;' + String.fromCharCode(10) + 'void main() { float waveHeight = waveData.b * 10.0; }';
      expect(withHeightScale(src, 'u_heightScale.x')).toBe(src);
      ['light', 'beach', 'dark', undefined].forEach((t) => expect(marineWaveHeightScale(t)).toBe(10));
    });
  });
});

describe('16 m on (the default)', () => {
  it('dark: the wave texture bytes are #411 head\'s exactly, and the upload says 10', () => {
    withWindow({}, () => { const r = encode('dark', false); expect(sha(Buffer.from(r.wave))).toBe(BEFORE.wave); expect(r.out.u_heightScale).toBe(10); });
  });
  it.each(['dark', 'light', 'beach'])('%s rating grids: wave AND score bytes are #411 head\'s exactly (the surf path stays /10)', (theme) => {
    withWindow({}, () => {
      const r = encode(theme, true);
      expect(sha(Buffer.from(r.wave))).toBe(BEFORE.wave);
      expect(sha(Buffer.from(r.score))).toBe(BEFORE.score);
      expect(r.out.u_heightScale).toBe(10);
    });
  });
  it('beach (D-035, beach draws v1): the wave texture bytes equal #411 head bytes, and the upload says 10', () => {
    withWindow({}, () => { const r = encode('beach', false); expect(sha(Buffer.from(r.wave))).toBe(BEFORE.wave); expect(r.out.u_heightScale).toBe(10); });
  });
  // Beach packs /16 only under D-035's kill (beach on v2); light by default.
  it.each(['light', 'beach'])('%s: only the B byte changes, packed /16 ROUNDED, and it decodes back within half a 16/255 m step up to 16 m', (theme) => {
    withWindow(theme === 'beach' ? { __RAW_DISABLE_WAVE_BEACH_V1__: true } : {}, () => {
      const { FloatArrayConstructor } = require('./WebGLMarineFieldMath');
      const dark = encode('dark', false).wave, r = encode(theme, false), w = r.wave;
      expect(r.out.u_heightScale).toBe(16);
      let moved = 0;
      for (let i = 0; i < w.length / 4; i++) {
        [0, 1, 3].forEach((c) => expect(w[i * 4 + c]).toBe(dark[i * 4 + c]));
        if (i % 11 === 7) continue;   // land: extrapolated by the encoder, not a height of the fixture
        const h = new FloatArrayConstructor([H(i)])[0];   // the encoder's scratch arrays (Float16Array where the runtime has one)
        expect(w[i * 4 + 2]).toBe(Math.round(Math.min(1, h / 16) * 255));
        expect(Math.abs((w[i * 4 + 2] / 255) * 16 - Math.min(16, h))).toBeLessThanOrEqual(16 / 510 + 1e-9);   // dev's /10 floor: up to 10/255
        if (w[i * 4 + 2] !== dark[i * 4 + 2]) moved++;
      }
      expect(moved).toBeGreaterThan(30);
    });
  });
  it.each([['light', 16, Math.round], ['beach', 10, Math.floor], ['dark', 10, Math.floor]])('%s: the antimeridian seam column of a global grid averages its two edge bytes the same way the cells were packed', (theme, scale, how) => {
    withWindow({}, () => {
      const { FloatArrayConstructor } = require('./WebGLMarineFieldMath');
      const cols = 8, rows = 3, hs = (r, c) => 0.6 + r * 2.1 + c * 0.77;   // all ocean; two rows give odd edge-byte sums at /16 and at /10
      const vectors = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) vectors.push({ direction: 200, speed: hs(r, c), height: hs(r, c), period: 9, is_valid: true });
      window.__WEBGL_MARINE_THEME__ = theme;
      try {
        const { encodeMarineTexture } = require('./WebGLMarineTextureEncoder');
        const { gl, uploads } = makeRecordingGL();
        const out = encodeMarineTexture(gl, { cols, rows, vectors, __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 0,
          coverage_scope: 'global', productId: `seam-${theme}`, bounds: { west: -180, east: 180, south: -60, north: 60 } }, null, {}, undefined);
        const w = uploads.get(out.u_waveTexture), byte = (h) => how(Math.min(1, new FloatArrayConstructor([h])[0] / scale) * 255);
        let odd = 0;
        for (let r = 0; r < rows; r++) {
          const sum = byte(hs(r, 0)) + byte(hs(r, cols - 1)); if (sum % 2) odd++;
          expect(w[(r * cols) * 4 + 2]).toBe(how(sum * 0.5));
          expect(w[(r * cols + cols - 1) * 4 + 2]).toBe(how(sum * 0.5));
          expect(w[(r * cols + 3) * 4 + 2]).toBe(byte(hs(r, 3)));   // an interior cell, untouched by the seam
        }
        expect(odd).toBeGreaterThan(0);   // the test reaches the case where round and floor differ
      } finally { delete window.__WEBGL_MARINE_THEME__; }
    });
  });
  it('picks the scale by theme and by palette: 16 only where the V2 table draws the wash', () => {
    withWindow({}, () => {
      const { marineWaveHeightScale } = require('./marineWavePalette');
      // Beach draws v1 (D-035), which has no 16 m row: its uploads keep the 10 m byte.
      expect([marineWaveHeightScale('light'), marineWaveHeightScale('beach'), marineWaveHeightScale('dark'), marineWaveHeightScale(undefined), marineWaveHeightScale('default')]).toEqual([16, 10, 10, 10, 10]);
    });
    withWindow({ __RAW_DISABLE_WAVE_BEACH_V1__: true }, () => expect(require('./marineWavePalette').marineWaveHeightScale('beach')).toBe(16));   // D-035's kill: beach on v2 at 16 m
    withWindow({ __RAW_DISABLE_WAVE_PALETTE_V2__: true }, () => expect(require('./marineWavePalette').marineWaveHeightScale('light')).toBe(10));   // v1 caps at 10
    withWindow({ __RAW_DISABLE_MARINE_WAVE_PALETTE__: true }, () => expect(require('./marineWavePalette').marineWaveHeightScale('light')).toBe(10));   // the shader's own ramp
  });
  it('every shader differs from #411 head ONLY by the joined declaration and the decode factor', () => {
    // Two later levers sit on top of these strings, each pinned in its own file: the float height's rewrite (marineHeightFloat.test.js)
    // and light crest V2's lines (marineCrestPaletteLight.test.js).
    withWindow({ ...NO_FLOAT, __RAW_DISABLE_LIGHT_CREST_V2__: true }, () => {
      const s = shaders(), { HEIGHT_SCALE_DECL, withHeightScale } = require('./marineHeightEncoding');
      // The heatmap also embeds the palette's GLSL, which the 16 m table changes on purpose (marineWavePalette.test.js pins it).
      const pal = require('./marineWavePalette'), at10 = pal.marineWavePaletteGlsl(pal.WAVE_PALETTES[pal.MARINE_WAVE_PALETTE_ID]);
      expect(pal.MARINE_WAVE_PALETTE_GLSL).not.toBe(at10);
      const NL = String.fromCharCode(10);
      const undo = (x) => x.split(pal.MARINE_WAVE_PALETTE_GLSL).join(at10).split(NL + HEIGHT_SCALE_DECL + NL).join(NL)
        .split('waveHScale(useCoarse ? u_heightScale.y : u_heightScale.x)').join('10.0').split('waveHScale(u_heightScale.x)').join('10.0');
      NAMES.forEach((k) => expect([k, sha(undo(s[k]))]).toEqual([k, BEFORE.glsl[k]]));
      const decl = (x) => x.split('uniform vec2 u_heightScale;').length - 1;
      // Declared once in each program that decodes a wave texture, in the stage that decodes it; never in the other stage (a
      // uniform declared in both stages must match precision, and the heatmap FS is mediump).
      expect([decl(s.HEATMAP_VS), decl(s.HEATMAP_FS), decl(s.ADVECT_VS), decl(s.ADVECT_FS), decl(s.DRAW_VS), decl(s.DRAW_FS)]).toEqual([0, 1, 0, 1, 1, 0]);
      expect(s.HEATMAP_FS).toContain('float waveHeight = waveData.b * waveHScale(u_heightScale.x);');
      [s.ADVECT_FS, s.DRAW_VS].forEach((x) => expect(x).toContain('float waveHeight = waveData.b * waveHScale(useCoarse ? u_heightScale.y : u_heightScale.x);'));
      NAMES.forEach((k) => expect(s[k]).not.toContain('waveData.b * 10.0'));
      expect(s.HEATMAP_FS).toContain('float ratingScore = waveHeight * 10.0;');   // the score texture's own decode, untouched
      expect(HEIGHT_SCALE_DECL).toContain('return s > 0.0 ? s : 10.0;');           // an unset uniform (0) decodes as before
      NAMES.forEach((k) => { if (decl(s[k])) expect(s[k].indexOf(HEIGHT_SCALE_DECL)).toBeLessThan(s[k].indexOf('void main() {')); });
      // A shader that lost its decode (or grew a second) must fail at load, not draw /16 data as /10.
      expect(() => withHeightScale('void main() {}', 'u_heightScale.x')).toThrow(/one height decode/);
    });
  });
});

describe('setWaveHeightScale', () => {
  it('x = the bound wave texture\'s scale, y = the ring-fill base\'s; null or a scale-less upload reads 10', () => {
    withWindow({}, () => {
      const { setWaveHeightScale, heightScaleOf } = require('./marineHeightEncoding');
      const { gl, uniforms } = makeRecordingGL();
      setWaveHeightScale(gl, 'draw', { u_heightScale: 16 }, { u_heightScale: 10 });
      setWaveHeightScale(gl, 'heatmap', null);
      setWaveHeightScale(gl, 'coarse', { u_heightScale: 16 });
      setWaveHeightScale(gl, 'advect', {}, undefined);
      expect(uniforms).toEqual([['draw', 'u_heightScale', 16, 10], ['heatmap', 'u_heightScale', 10, 10], ['coarse', 'u_heightScale', 16, 16], ['advect', 'u_heightScale', 10, 10]]);
      expect([heightScaleOf(null), heightScaleOf({ u_heightScale: 0 }), heightScaleOf({ u_heightScale: 16 })]).toEqual([10, 10, 16]);
    });
  });
  // A wiring pin, not behavioural coverage (the offline A/B's GPU read-back is that): every program that decodes a wave texture
  // sets the uniform, the heatmap's main pass passes null when the score texture is bound, ring-fill passes the base it binds.
  it('is called by all four passes of the engine', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
    expect(src).toContain("setWaveHeightScale(gl, this.heatmapProgram, this._waveData.u_waveScoreTexture ? null : this._waveData);");
    expect(src).toContain('setWaveHeightScale(gl, this.heatmapProgram, base);');
    expect(src).toContain('setWaveHeightScale(gl, this.drawProgram, this._waveData, _rfBase || this._waveData);');
    expect(src).toContain('setWaveHeightScale(gl, this.advectProgram, this._waveData, _rfBase || this._waveData);');
    expect(src).toContain('bindTexture(gl, _rfBase ? _rfBase.u_waveTexture : this._waveData.u_waveTexture, 5);');   // draw's ring-fill unit
    expect(src).toContain('bindTexture(gl, _rfBase ? _rfBase.u_waveTexture : this._waveData.u_waveTexture, 4);');   // advect's
  });
});
