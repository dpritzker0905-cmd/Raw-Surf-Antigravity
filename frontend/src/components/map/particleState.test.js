import {
  STATE_QUANTUM, byteQuantise, storeState, packParticlePositions, floatStateFormat, markFloatStateUnsupported,
  createParticleStateTexture, reseedParticleStateTextures, syncParticleStateFormat, particleStateUniforms, PARTICLE_STATE_GLSL, STATE_SPLICE,
} from './particleState';

// Particle state precision (L4, 2026-11-02): the RGBA8 state rounded each frame's step, so sub-half-quantum motion froze.
// Pins: per-step displacement against an analytic uniform field in each storage mode; the format probe; the textures follow
// the mode; a refused float framebuffer falls back to RGBA8; the byte packing is the engines' old one exactly.
const q = STATE_QUANTUM;
const seeded = (seed = 7) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
// advance a particle `frames` times through a uniform field (constant step v, in tile units) in one storage mode
const run = (x0, v, frames, mode, rnd = seeded()) => { let x = storeState(x0, mode === 'float' ? 'float' : 'byte'); for (let i = 0; i < frames; i++) x = storeState(x + v, mode, rnd); return (x - x0) / frames; };

describe('per-step displacement against an analytic uniform field', () => {
  const x0 = 19500 * q;   // on a code, so the byte runs start exact
  it('RGBA8 (the old state): a step under half a quantum never moves; 0.5-1 q moves a whole quantum', () => {
    for (const s of [0.05, 0.2, 0.45]) expect(run(x0, s * q, 200, 'byte')).toBe(0);
    for (const s of [0.55, 0.7, 0.95]) expect(run(x0, s * q, 200, 'byte') / q).toBeCloseTo(1, 6);
  });
  it('float state: every step moves by its size (to 1e-4 of a quantum over 200 frames)', () => {
    for (const s of [0.01, 0.05, 0.2, 0.45, 0.7, 1.5]) expect(Math.abs(run(x0, s * q, 200, 'float') / q - s)).toBeLessThan(1e-3 + 1e-4 * s * 200);
  });
  it('RGBA8 + stochastic rounding: unbiased, the mean step is the true step (2000 frames, +-0.05 q)', () => {
    for (const s of [0.05, 0.2, 0.45, 0.7]) expect(Math.abs(run(x0, s * q, 2000, 'byte-sr', seeded(11)) / q - s)).toBeLessThan(0.05);
  });
  it('wind at z5 and z6 (q = 0.25 / 0.50 px): 1-3 kn froze in RGBA8, moves at its speed now', () => {
    for (const [pxPerKn, qPx] of [[0.0704, 0.25], [0.082, 0.5]]) for (const kn of [1, 2, 3]) {
      const v = (kn * pxPerKn / qPx) * q;
      if (kn * pxPerKn / qPx < 0.5) expect(run(x0, v, 200, 'byte')).toBe(0);
      expect(run(x0, v, 200, 'float') / v).toBeCloseTo(1, 2);   // float32 at x ~ 0.3: ulp 3e-8, under 0.5% of a 1 kn step
    }
  });
  it('byteQuantise is the GPU read-back of encodePos (x = hi/255 + lo/65025, lo rounded), continuous across a hi carry', () => {
    expect(byteQuantise(0.5)).toBeCloseTo(Math.round(0.5 * 65025) / 65025, 12);
    expect(byteQuantise(10 / 255 - 0.1 * q)).toBeCloseTo(10 / 255, 12);
    expect(byteQuantise(1.2)).toBe(1);
  });
});

describe('the format probe and the textures', () => {
  const mockGl = ({ gl2 = true, ext = true, complete = true } = {}) => {
    const calls = [];
    const gl = {
      RGBA32F: gl2 ? 0x8814 : undefined, texStorage2D: gl2 ? () => {} : undefined, RGBA: 0x1908, FLOAT: 0x1406, UNSIGNED_BYTE: 0x1401, NEAREST: 0x2600,
      TEXTURE_2D: 1, FRAMEBUFFER: 2, COLOR_ATTACHMENT0: 3, TEXTURE_BINDING_2D: 4, FRAMEBUFFER_BINDING: 5, FRAMEBUFFER_COMPLETE: 0x8cd5,
      getExtension: (n) => (ext ? { n } : null), getParameter: (p) => `prev${p}`,
      createTexture: () => ({ t: calls.length }), createFramebuffer: () => ({}), bindTexture: (...a) => calls.push(['bindTexture', ...a]),
      bindFramebuffer: (...a) => calls.push(['bindFramebuffer', ...a]), framebufferTexture2D: () => {}, deleteFramebuffer: () => {}, deleteTexture: () => {},
      checkFramebufferStatus: () => (complete ? 0x8cd5 : 0x8cdd), texImage2D: (...a) => calls.push(['texImage2D', ...a]), texSubImage2D: (...a) => calls.push(['texSubImage2D', ...a]),
    };
    return { gl, calls };
  };
  it('WebGL2 + EXT_color_buffer_float + a complete framebuffer: RGBA32F; anything less: null', () => {
    expect(floatStateFormat(mockGl().gl)).toEqual({ internal: 0x8814, format: 0x1908, type: 0x1406 });
    expect(floatStateFormat(mockGl({ gl2: false }).gl)).toEqual({ internal: 0x1908, format: 0x1908, type: 0x1406 });
    expect(floatStateFormat(mockGl({ ext: false }).gl)).toBeNull();
    expect(floatStateFormat(mockGl({ complete: false }).gl)).toBeNull();
  });
  it('the probe restores the texture and framebuffer bindings it found', () => {
    const { gl, calls } = mockGl(); floatStateFormat(gl);
    expect(calls.filter((c) => c[0] === 'bindTexture').pop()).toEqual(['bindTexture', 1, 'prev4']);
    expect(calls.filter((c) => c[0] === 'bindFramebuffer').pop()).toEqual(['bindFramebuffer', 2, 'prev5']);
  });
  it('createParticleStateTexture: float where supported (engine._stateFloat), the engine creator\'s RGBA8 bytes otherwise', () => {
    const byteCreator = jest.fn(() => ({ byte: true }));
    const a = mockGl(), engA = {};
    createParticleStateTexture(a.gl, 4, engA, byteCreator);
    expect(engA._stateFloat).toBe(true);
    expect(byteCreator).toHaveBeenLastCalledWith(a.gl, a.gl.NEAREST, null, 4, 4);
    const up = a.calls.filter((c) => c[0] === 'texImage2D').pop();
    expect(up[3]).toBe(0x8814); expect(up[8]).toBe(0x1406); expect(up[9]).toBeInstanceOf(Float32Array);
    const b = mockGl({ ext: false }), engB = {};
    createParticleStateTexture(b.gl, 4, engB, byteCreator);
    expect(engB._stateFloat).toBe(false);
    expect(byteCreator.mock.calls.pop()[2]).toBeInstanceOf(Uint8Array);
  });
  it('the in-place reseed uploads in the textures\' own format', () => {
    const a = mockGl(); floatStateFormat(a.gl);
    reseedParticleStateTextures(a.gl, { _stateFloat: true, particleStateA: 'A', particleStateB: 'B' }, 2);
    expect(a.calls.filter((c) => c[0] === 'texSubImage2D').map((c) => [c[8], c[9].constructor.name])).toEqual([[0x1406, 'Float32Array'], [0x1406, 'Float32Array']]);
    const b = mockGl({ ext: false });
    reseedParticleStateTextures(b.gl, { _stateFloat: false, particleStateA: 'A', particleStateB: 'B' }, 2);
    expect(b.calls.filter((c) => c[0] === 'texSubImage2D').map((c) => c[8])).toEqual([0x1401, 0x1401]);
  });
  it('sync: a refused float framebuffer (crests would vanish) falls back to RGBA8 and re-enables the particle pass', () => {
    const { gl } = mockGl(); floatStateFormat(gl);
    const eng = { particleStateA: {}, _stateFloat: true, _fboSupported: false }, reseed = jest.fn();
    expect(syncParticleStateFormat(gl, eng, reseed)).toBe(true);
    expect(reseed).toHaveBeenCalledTimes(1); expect(eng._fboSupported).toBe(true); expect(floatStateFormat(gl)).toBeNull();
    markFloatStateUnsupported(null);   // no-op on a missing context
  });
  it('sync: the live kill reseeds into RGBA8 once, and nothing happens while the format already matches', () => {
    const { gl } = mockGl(); const eng = { particleStateA: {}, _stateFloat: true }, reseed = jest.fn(() => { eng._stateFloat = false; });
    expect(syncParticleStateFormat(gl, eng, reseed)).toBe(false);
    window.__RAW_DISABLE_FLOAT_PARTICLE_STATE__ = true;
    try {
      expect(syncParticleStateFormat(gl, eng, reseed)).toBe(true);
      expect(syncParticleStateFormat(gl, eng, reseed)).toBe(false);
      expect(reseed).toHaveBeenCalledTimes(1);
      expect(particleStateUniforms(eng)).toEqual({ u_floatState: 0, u_stochRound: 0, u_rk2: 1 });
    } finally { delete window.__RAW_DISABLE_FLOAT_PARTICLE_STATE__; }
  });
});

describe('the packing and the GLSL', () => {
  it('byte packing is the engines\' old algorithm exactly (same random draws, same bytes)', () => {
    const r1 = seeded(3), r2 = seeded(3), n = 50, got = packParticlePositions(n, false, r1), want = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = r2(), y = r2(), xHi = Math.floor(x * 255), xLo = Math.floor(((x * 255) - xHi) * 255), yHi = Math.floor(y * 255), yLo = Math.floor(((y * 255) - yHi) * 255);
      want.set([xHi, xLo, yHi, yLo], i * 4);
    }
    expect(got).toEqual(want);
    const f = packParticlePositions(3, true, seeded(3));
    expect(f).toBeInstanceOf(Float32Array); expect([f[2], f[3]]).toEqual([0, 1]);
  });
  it('the shader: float branch stores (x, y, 0, 1); the dither is +-q/2 from a sine-free hash; the byte path rounds to exact codes', () => {
    expect(PARTICLE_STATE_GLSL).toContain('if (u_floatState > 0.5) return vec4(clamped, 0.0, 1.0);');
    expect(PARTICLE_STATE_GLSL).toContain('stateHash22(gl_FragCoord.xy');
    expect(PARTICLE_STATE_GLSL).toContain(`- 0.5) * ${q.toExponential(10)}`);
    expect(PARTICLE_STATE_GLSL).toContain('vec2 n = floor(clamped * 65025.0 + 0.5);');
    expect(PARTICLE_STATE_GLSL).not.toContain('sin(');
    expect(PARTICLE_STATE_GLSL).not.toContain('+=');   // the encodingDebris guard reads "+=" in a string as mojibake
    expect(STATE_SPLICE.encode).toBe('encodeState(pos, u_rand_seed)');
  });
});
