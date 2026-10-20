// THE FLOAT HEIGHT (2026-10-20): the wash's R16F height texture, its kill, and the byte-identity of everything that must not move.
// Baselines: hashed at dev da40c3c5b (#415's squash 9c6d5ebb0, then #417: beach draws v1 at the /10 byte, D-035) before any file
// here changed; under the 16 m kill too (marineHeightEncoding.test.js pins the 16 m kill against #411).
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const AT_DEV = {
  glsl: {
    HEATMAP_VS: 'dc56341973da27cd818befb2f8069c806e83cec99223f8399991bfc538e40019',
    HEATMAP_FS: 'c8deb3bd58c1beea2aeb29d625b5af9313b6349a2bb0e3c4a12cf0a7271442a8',
    ADVECT_VS: '7d7bfc3037c8394ead29c26358e1563582104feb8be5cc66e90f13480e9c2172',
    ADVECT_FS: '632832e258d1cdbf5f0241ef35d75c6572c9e9ee29c878c36db804e54e725289',
    DRAW_VS: 'a1683763aa85437a8681935b869359904e878d3d4a34b4fbba9da612ac7aec44',
    DRAW_FS: 'a9e8e1026083bc9b9ca950d1e209bb0139a89f1a52ca9ba02306ddbc51d3a0ad',
  },
  HEATMAP_FS_K16: 'c2f972d2b6c62a2bf937783c465a94f745c75a29d4b97511bf22a32dd61eb4bc',   // under the 16 m kill
  // The fixture grid below: the wave texture per theme (dark and beach /10 floor, light /16 round) and the rating score texture.
  wave: { dark: 'a5299dc7eb487086973077d3fc83c8040f1a6e673e3431969a6e5803457aad5d', light: 'e728b47617719559abcbfb30e333a554bdffb3ab1ca1da607fd98c3e6a051365', beach: 'a5299dc7eb487086973077d3fc83c8040f1a6e673e3431969a6e5803457aad5d' },
  ratingWave: 'a5299dc7eb487086973077d3fc83c8040f1a6e673e3431969a6e5803457aad5d',
  score: 'd74ab586063e47c0ba9511d389ddf88bc51da771338aa6d59c36141fb4c350d9',
};
const KILL = { __RAW_DISABLE_WAVE_HEIGHT_FLOAT__: true };
const NAMES = Object.keys(AT_DEV.glsl);

function withWindow(levers, fn) {
  let out;
  jest.isolateModules(() => {
    Object.assign(window, levers);
    try { out = fn(); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
  });
  return out;
}

// A recording context. webgl2: true adds the WebGL2 enums the float path needs, as numbers like a real context's.
const R16F = 0x822D, RED = 0x1903, FLOAT = 0x1406;
function makeGL({ webgl2 = true, failFloat = false } = {}) {
  let handle = 0; let bound = null; let flipY = false;
  const uploads = new Map(), floats = new Map(), calls = [], deleted = [];
  const gl = {
    TEXTURE_2D: 'TEXTURE_2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UNSIGNED_BYTE', LINEAR: 'LINEAR', NEAREST: 'NEAREST', TEXTURE0: 1000,
    CLAMP_TO_EDGE: 'CLAMP_TO_EDGE', TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT', TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG',
    TEXTURE_BINDING_2D: 'TEXTURE_BINDING_2D', UNPACK_FLIP_Y_WEBGL: 'UNPACK_FLIP_Y_WEBGL',
    ...(webgl2 ? { R16F, RED, FLOAT } : {}),
    getParameter: (p) => (p === 'TEXTURE_BINDING_2D' ? bound : p === 'UNPACK_FLIP_Y_WEBGL' ? flipY : null),
    createTexture: () => ({ __tex: ++handle }), deleteTexture: (t) => deleted.push(t), bindTexture: (_t, tex) => { bound = tex; },
    activeTexture: (u) => calls.push(['activeTexture', u - 1000]),
    texParameteri: () => {}, pixelStorei: (p, v) => { if (p === 'UNPACK_FLIP_Y_WEBGL') flipY = v; },
    texImage2D: (...a) => {
      if (a[2] === R16F) {
        if (failFloat) throw new Error('no R16F here');
        calls.push(['texImage2D', bound, a[3], a[4], a[6], a[7]]); floats.set(bound, Float32Array.from(a[8])); return;
      }
      if (a.length >= 9 && bound) uploads.set(bound, a[8] ? Uint8Array.from(a[8]) : null);
    },
    texSubImage2D: (...a) => { if (a[6] === RED) { calls.push(['texSubImage2D', bound, a[4], a[5], a[7]]); floats.set(bound, Float32Array.from(a[8])); } },
    getUniformLocation: (prog, name) => ({ prog, name }),
    uniform1i: (loc, v) => calls.push(['uniform1i', loc.prog, loc.name, v]),
    uniform1f: (loc, v) => calls.push(['uniform1f', loc.prog, loc.name, v]),
    uniform2f: () => {},
  };
  return { gl, uploads, floats, calls, deleted };
}

// The marineHeightEncoding.test.js fixture: 9 x 5 cells, heights 0-18 m (past both ceilings), a few land cells; the rating twin
// carries a score in `speed` and the honest height in `phys_speed`.
const H = (i) => (i * 0.41) % 18.5;
function grid(rating, { cols = 9, rows = 5, global = false, h = H } = {}) {
  const vectors = [];
  for (let i = 0; i < cols * rows; i++) {
    const v = h(i);
    vectors.push(i % 11 === 7 ? { is_valid: false, u: 0, v: 0, speed: 0, height: 0, period: 0, direction: 0 }
      : rating ? { direction: (i * 37) % 360, speed: ((i * 2.3) % 10), phys_speed: v, period: 6 + (i % 12), is_valid: true }
        : { direction: (i * 37) % 360, speed: v, height: v, period: 6 + (i % 12), is_valid: true });
  }
  return { cols, rows, vectors, __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 3, ratingMode: rating,
    coverage_scope: global ? 'global' : 'regional', productId: `hf-${rating}-${cols}`,
    bounds: global ? { west: -180, east: 180, south: -80, north: 80 } : { west: -110, east: -100, south: 10, north: 20 } };
}
function encode(theme, rating, { glOpts, engine = {}, opts, g } = {}) {
  window.__WEBGL_MARINE_THEME__ = theme;
  try {
    const { encodeMarineTexture } = require('./WebGLMarineTextureEncoder');
    const rec = makeGL(glOpts);
    const out = encodeMarineTexture(rec.gl, g || grid(rating), null, engine, opts);
    return { ...rec, out, wave: rec.uploads.get(out.u_waveTexture), score: out.u_waveScoreTexture ? rec.uploads.get(out.u_waveScoreTexture) : null,
      height: out.u_heightFloatTexture ? rec.floats.get(out.u_heightFloatTexture) : null };
  } finally { delete window.__WEBGL_MARINE_THEME__; }
}
const shaders = () => ({ ...require('./WebGLMarineShaders'), ...require('./WebGLMarineParticleShaders') });
const fp16 = (x) => require('./WebGLMarineFieldMath').FloatArrayConstructor.from([x])[0];   // the encoder's scratch precision

describe('the kill (window.__RAW_DISABLE_WAVE_HEIGHT_FLOAT__) is dev exactly', () => {
  it('every shader string hashes to dev\'s, and with the 16 m kill too', () => {
    withWindow(KILL, () => { const s = shaders(); NAMES.forEach((k) => expect([k, sha(s[k])]).toEqual([k, AT_DEV.glsl[k]])); });
    withWindow({ ...KILL, __RAW_DISABLE_WAVE_HEIGHT_16M__: true }, () => expect(sha(shaders().HEATMAP_FS)).toBe(AT_DEV.HEATMAP_FS_K16));
  });
  it.each(['dark', 'light', 'beach'])('%s on a WebGL2 context: dev\'s wave and score bytes, and no float texture is made', (theme) => {
    withWindow(KILL, () => {
      const honest = encode(theme, false), rated = encode(theme, true);
      expect(sha(Buffer.from(honest.wave))).toBe(AT_DEV.wave[theme]);
      expect(sha(Buffer.from(rated.wave))).toBe(AT_DEV.ratingWave);
      expect(sha(Buffer.from(rated.score))).toBe(AT_DEV.score);
      expect([honest.out.u_heightFloatTexture, honest.floats.size, honest.calls.length]).toEqual([null, 0, 0]);
    });
  });
  it('binds and sets nothing, and returns any shader as it came', () => {
    withWindow(KILL, () => {
      const { bindHeightFloat, withHeightFloat, encodeHeightFloat } = require('./marineHeightFloat');
      const { gl, calls } = makeGL();
      bindHeightFloat(gl, 'heatmap', { u_heightFloatTexture: { __tex: 1 } });
      expect(calls).toEqual([]);
      expect(withHeightFloat('anything')).toBe('anything');
      expect(encodeHeightFloat(gl, {}, false, grid(false), new Float32Array(45), 10, false)).toBeNull();
    });
  });
});

describe('float on (the default)', () => {
  it.each(['dark', 'light', 'beach'])('%s: the RGBA8 wave and score bytes are dev\'s exactly (crests and surf quality keep them)', (theme) => {
    withWindow({}, () => {
      const honest = encode(theme, false), rated = encode(theme, true);
      expect(sha(Buffer.from(honest.wave))).toBe(AT_DEV.wave[theme]);
      expect(sha(Buffer.from(rated.wave))).toBe(AT_DEV.ratingWave);
      expect(sha(Buffer.from(rated.score))).toBe(AT_DEV.score);
    });
  });
  it.each([['dark', 10], ['light', 16], ['beach', 10]])('%s: R16F from FLOAT, the height in metres clamped to the byte\'s own range (%i m)', (theme, scale) => {
    withWindow({}, () => {
      const r = encode(theme, false), h = r.height;
      expect(r.calls.filter((c) => c[0] === 'texImage2D')).toEqual([['texImage2D', r.out.u_heightFloatTexture, 9, 5, RED, FLOAT]]);
      expect(r.out.u_heightScale).toBe(scale);
      const step = r.out.u_heightScale / 255;
      for (let i = 0; i < 45; i++) {
        const byteM = (r.wave[i * 4 + 2] / 255) * scale;
        expect(Math.abs(h[i] - byteM)).toBeLessThanOrEqual(step + 1e-6);   // the same quantity as the byte, without its step
        if (i % 11 === 7) continue;   // land: extrapolated by the encoder, not a height of the fixture
        expect(h[i]).toBe(Math.min(scale, fp16(H(i))));
      }
      expect(Math.max(...h)).toBe(scale);   // the fixture passes 16 m: the float stops where the byte does
    });
  });
  it('rating grids and WebGL1 get no float texture (the byte decodes, unchanged)', () => {
    withWindow({}, () => {
      const rated = encode('light', true), gl1 = encode('light', false, { glOpts: { webgl2: false } });
      expect([rated.out.u_heightFloatTexture, rated.floats.size, gl1.out.u_heightFloatTexture, gl1.floats.size]).toEqual([null, 0, null, 0]);
      expect(sha(Buffer.from(gl1.wave))).toBe(AT_DEV.wave.light);
    });
  });
  it('a failed R16F upload falls back to the byte, with a warning', () => {
    withWindow({}, () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const engine = {}, r = encode('dark', false, { glOpts: { failFloat: true }, engine });
        expect([r.out.u_heightFloatTexture, engine._residentHeightTex || null]).toEqual([null, null]);
        expect(r.deleted.length).toBe(1);   // the texture created for the failed upload is deleted, not leaked
        expect(sha(Buffer.from(r.wave))).toBe(AT_DEV.wave.dark);
        expect(warn.mock.calls.some((c) => /R16F height upload failed/.test(c[0]))).toBe(true);
      } finally { warn.mockRestore(); }
    });
  });
  it('a global grid averages its seam columns, as the byte does', () => {
    withWindow({}, () => {
      const { packHeightFloat } = require('./marineHeightFloat');
      const h = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);   // 4 x 2
      expect(Array.from(packHeightFloat(h, 4, 2, 10, true))).toEqual([2.5, 2, 3, 2.5, 6.5, 6, 7, 6.5]);
      expect(Array.from(packHeightFloat(h, 4, 2, 10, false))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(Array.from(packHeightFloat(Float32Array.from([NaN, -1, 0.05, 12]), 2, 2, 10, false))).toEqual([0, 0, 0.05000000074505806, 10]);
    });
  });
});

describe('lifecycle', () => {
  it('the resident texture is re-uploaded in place, recreated on new dims, and freed by a commit that needs none', () => {
    withWindow({}, () => {
      const { encodeHeightFloat } = require('./marineHeightFloat');
      const { gl, calls, deleted } = makeGL(), engine = {}, h = new Float32Array(100).fill(0.1);
      const a = encodeHeightFloat(gl, engine, false, grid(false), h, 10, false);
      const b = encodeHeightFloat(gl, engine, false, grid(false), h, 10, false);
      expect(b).toBe(a);
      expect(calls.map((c) => c[0])).toEqual(['texImage2D', 'texSubImage2D']);
      const c = encodeHeightFloat(gl, engine, false, grid(false, { cols: 10, rows: 10 }), h, 10, false);
      expect(c).not.toBe(a);
      expect(deleted).toEqual([a]);
      expect([engine._residentHeightTex, engine._residentHeightDims]).toEqual([c, '10x10']);
      expect(encodeHeightFloat(gl, engine, false, grid(true), h, 10, false)).toBeNull();   // a rating commit
      expect(deleted).toEqual([a, c]);
      expect(engine._residentHeightTex).toBeNull();
    });
  });
  it('a standalone (coarse base) texture is its own: fresh each time, never the engine\'s, freed by freeHeightFloat', () => {
    withWindow({}, () => {
      const { encodeHeightFloat, freeHeightFloat, releaseResidentHeightFloat } = require('./marineHeightFloat');
      const { gl, deleted } = makeGL(), engine = {}, h = new Float32Array(45).fill(0.1);
      const resident = encodeHeightFloat(gl, engine, false, grid(false), h, 10, false);
      const s1 = encodeHeightFloat(gl, engine, true, grid(false), h, 10, false);
      const s2 = encodeHeightFloat(gl, engine, true, grid(false), h, 10, false);
      expect(new Set([resident, s1, s2]).size).toBe(3);
      expect(engine._residentHeightTex).toBe(resident);
      freeHeightFloat(gl, { u_heightFloatTexture: s1 }, engine);
      freeHeightFloat(gl, { u_heightFloatTexture: resident }, engine);   // a set holding the resident never frees it
      freeHeightFloat(gl, { u_heightFloatTexture: null }, engine);
      expect(deleted).toEqual([s1]);
      releaseResidentHeightFloat(gl, engine);
      expect(deleted).toEqual([s1, resident]);
      expect(engine._residentHeightTex).toBeNull();
    });
  });
  it('the GPU estimate counts 2 bytes a texel and gives them back on delete', () => {
    withWindow({}, () => {
      window.__RAW_GPU__ = { textureCount: 0, textureUploadCount: 0, gpuMemoryEstimate: 0 };
      try {
        const { encodeHeightFloat, releaseResidentHeightFloat } = require('./marineHeightFloat');
        const { gl } = makeGL(), engine = {};
        encodeHeightFloat(gl, engine, false, grid(false), new Float32Array(45), 10, false);
        expect([window.__RAW_GPU__.textureCount, window.__RAW_GPU__.gpuMemoryEstimate]).toEqual([1, 9 * 5 * 2]);
        releaseResidentHeightFloat(gl, engine);
        expect([window.__RAW_GPU__.textureCount, window.__RAW_GPU__.gpuMemoryEstimate]).toEqual([0, 0]);
      } finally { delete window.__RAW_GPU__; }
    });
  });
});

describe('the heatmap GLSL', () => {
  const NL = String.fromCharCode(10);
  it('differs from dev ONLY by the declaration, the five fetches through waveTapF and the decode\'s float branch', () => {
    withWindow({}, () => {
      const s = shaders(), { HEIGHT_FLOAT_DECL } = require('./marineHeightFloat');
      const undo = (x) => x.split(HEIGHT_FLOAT_DECL).join('').split('waveTapF(').join('texture2D(u_waveTexture, ')
        .split('float waveHeight = u_heightFloat > 0.5 ? waveData.b : waveData.b * ').join('float waveHeight = waveData.b * ');
      expect(sha(undo(s.HEATMAP_FS))).toBe(AT_DEV.glsl.HEATMAP_FS);
      NAMES.filter((k) => k !== 'HEATMAP_FS').forEach((k) => expect([k, sha(s[k])]).toEqual([k, AT_DEV.glsl[k]]));   // crests: the byte
      const fs16 = s.HEATMAP_FS;
      expect(fs16.split('uniform mediump sampler2D u_waveHeightTexture;').length - 1).toBe(1);   // mediump: lowp would undo it
      expect(fs16.split('texture2D(u_waveTexture, ').length - 1).toBe(1);                        // only inside waveTapF
      expect(fs16.split('waveTapF(').length - 1).toBe(6);                                        // its declaration + five taps
      expect(fs16.indexOf(HEIGHT_FLOAT_DECL)).toBeLessThan(fs16.indexOf('vec4 sampleWaveLandAware('));
      expect(fs16.indexOf('#define GEO_P')).toBeLessThan(fs16.indexOf(HEIGHT_FLOAT_DECL));      // waveTapF takes a GEO_P uv
      expect(fs16).toContain('float waveHeight = u_heightFloat > 0.5 ? waveData.b : waveData.b * waveHScale(u_heightScale.x);');
      expect(fs16).toContain('float ratingScore = waveHeight * 10.0;');   // u_heightFloat is 0 whenever the score texture is bound
      expect(s.HEATMAP_FS.split(NL + 'void main() {').length).toBe(2);
    });
  });
  it('under the 16 m kill it rewrites that string the same way (the two levers are independent)', () => {
    withWindow({ __RAW_DISABLE_WAVE_HEIGHT_16M__: true }, () => {
      const s = shaders(), { HEIGHT_FLOAT_DECL } = require('./marineHeightFloat');
      expect(s.HEATMAP_FS).toContain('float waveHeight = u_heightFloat > 0.5 ? waveData.b : waveData.b * 10.0;');
      const undo = s.HEATMAP_FS.split(HEIGHT_FLOAT_DECL).join('').split('waveTapF(').join('texture2D(u_waveTexture, ')
        .split('u_heightFloat > 0.5 ? waveData.b : ').join('');
      expect(sha(undo)).toBe(AT_DEV.HEATMAP_FS_K16);
    });
  });
  it('throws at load if the shader moved (a fetch outside the land-aware sampler would mix byte and float)', () => {
    withWindow({}, () => {
      const { withHeightFloat } = require('./marineHeightFloat');
      const ok = (extra = '') => `vec4 sampleWaveLandAware(GEO_P vec2 uv) {${NL}${'  texture2D(u_waveTexture, uv);'.repeat(5)}${NL}}${NL}${extra}void main() { float waveHeight = waveData.b * 10.0; }`;
      expect(() => withHeightFloat(ok())).not.toThrow();
      expect(() => withHeightFloat(ok('vec4 x = texture2D(u_waveTexture, uv);'))).toThrow(/five u_waveTexture fetches/);
      expect(() => withHeightFloat(ok().replace('waveData.b * 10.0', 'waveData.b'))).toThrow(/one height decode/);
    });
  });
});

describe('bindHeightFloat', () => {
  it('binds the set\'s texture on unit 6 and sets u_heightFloat 1; a set without one (or the score texture: null) sets 0', () => {
    withWindow({}, () => {
      const { bindHeightFloat } = require('./marineHeightFloat');
      const { gl, calls } = makeGL(), tex = { __tex: 42 };
      bindHeightFloat(gl, 'heatmap', { u_heightFloatTexture: tex });
      bindHeightFloat(gl, 'heatmap', null);
      bindHeightFloat(gl, 'heatmap', { u_heightFloatTexture: null });
      expect(calls).toEqual([
        ['activeTexture', 6], ['uniform1i', 'heatmap', 'u_waveHeightTexture', 6], ['uniform1f', 'heatmap', 'u_heightFloat', 1],
        ['uniform1i', 'heatmap', 'u_waveHeightTexture', 6], ['uniform1f', 'heatmap', 'u_heightFloat', 0],
        ['uniform1i', 'heatmap', 'u_waveHeightTexture', 6], ['uniform1f', 'heatmap', 'u_heightFloat', 0],
      ]);
    });
  });
  // A wiring pin, not behavioural coverage (the offline A/B's GPU read is that).
  it('is wired at both heatmap draws, the coarse base frees its own, dispose frees the resident, the encoder makes it last', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    const engine = read('WebGLMarineEngine.js');
    expect(engine).toContain('bindHeightFloat(gl, this.heatmapProgram, this._waveData.u_waveScoreTexture ? null : this._waveData);');
    expect(engine).toContain('setWaveHeightScale(gl, this.heatmapProgram, base); bindHeightFloat(gl, this.heatmapProgram, base);');
    expect(engine).toContain('if (b.u_waveTexture) safeDeleteTexture(gl, b.u_waveTexture, this); freeHeightFloat(gl, b, this);');
    expect(engine.split('bindHeightFloat(').length - 1).toBe(2);
    expect(read('WebGLMarineEngineInit.js')).toContain('releaseResidentHeightFloat(gl, engine);');
    const enc = read('WebGLMarineTextureEncoder.js');
    expect(enc).toContain('u_heightFloatTexture: encodeHeightFloat(gl, engine, standalone, waveGrid, hArr, hScale, isGlobal),');
    expect(enc.indexOf('encodeHeightFloat(gl,')).toBeGreaterThan(enc.lastIndexOf('throw err;'));   // after the upload transaction
  });
});
