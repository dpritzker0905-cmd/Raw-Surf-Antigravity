import { createHash } from 'crypto';

// The 2026-11-03 motion fixes ship ON, each with a kill switch. Pins:
//  - set before the map loads, the four shader kills draw origin/dev's shaders BYTE FOR BYTE (hashes below, dev 35feaaac6);
//  - each kill stands down only its own splices; the defaults carry the new code;
//  - set later (live), each kill's uniforms / encoder return the old behaviour.
const sha = (s) => createHash('sha256').update(s).digest('hex');
const DEV = {   // origin/dev 35feaaac6, before this change
  marine: {
    ADVECT_FS: '632832e258d1cdbf5f0241ef35d75c6572c9e9ee29c878c36db804e54e725289',
    DRAW_VS: '5bd171fbd5cec5efa14f74d3139f362f69173ab15ee33652c60368e069430cb8',
    DRAW_FS: '5a9f550c4f60aaeb9f776a373ff2458a7c5737f7b5367f94585c207d49abea52',
  },
  wind: {
    ADVECT_FS: '0e1e3183ba260bda8dee7ce393122dd85d847e4ff185c6b2041082c7db2ff90e',
    DRAW_VS: '6d0c09d69b3efabfa8523b5a54de40ee2bcd5b1eec27d1f908c05d441f821221',
    DRAW_FS: '13038573f14ba7117faf25559b5c70e668a9bdfe7fbf322d58702962a6138248',
  },
};
const K = {
  float: '__RAW_DISABLE_FLOAT_PARTICLE_STATE__',
  rk2: '__RAW_DISABLE_RK2_ADVECTION__',
  phase: '__RAW_DISABLE_CREST_LOCAL_PHASE__',
  rank: '__RAW_DISABLE_CREST_TEXEL_RANK__',
  enc: '__RAW_DISABLE_WIND_ENCODER_ROUND__',
};
const ALL = Object.fromEntries(Object.values(K).map((k) => [k, true]));
const load = (levers, mod) => {
  let out;
  jest.isolateModules(() => {
    Object.assign(window, levers);
    try { out = require(mod); } finally { Object.keys(levers).forEach((k) => delete window[k]); }
  });
  return out;
};
const hashes = (levers) => {
  const m = load(levers, './WebGLMarineParticleShaders'), w = load(levers, './WebGLWindShaders');
  return {
    marine: { ADVECT_FS: sha(m.ADVECT_FS), DRAW_VS: sha(m.DRAW_VS), DRAW_FS: sha(m.DRAW_FS) },
    wind: { ADVECT_FS: sha(w.ADVECT_FS), DRAW_VS: sha(w.DRAW_VS), DRAW_FS: sha(w.DRAW_FS) },
  };
};

describe('killed before load: the shaders of origin/dev, byte for byte', () => {
  it('all four shader kills draw dev 35feaaac6 exactly (marine and wind, every pass these fixes touch)', () => {
    expect(hashes(ALL)).toEqual(DEV);
  });

  it('the defaults are not dev (the fixes are ON), and the colour passes are untouched either way', () => {
    const on = hashes({});
    expect(on.marine.ADVECT_FS).not.toBe(DEV.marine.ADVECT_FS);
    expect(on.marine.DRAW_VS).not.toBe(DEV.marine.DRAW_VS);
    expect(on.wind.ADVECT_FS).not.toBe(DEV.wind.ADVECT_FS);
    expect(on.wind.DRAW_VS).not.toBe(DEV.wind.DRAW_VS);
    expect(on.marine.DRAW_FS).toBe(DEV.marine.DRAW_FS);
    expect(on.wind.DRAW_FS).toBe(DEV.wind.DRAW_FS);
  });

  it('each kill stands down only its own splices', () => {
    const m = load({}, './WebGLMarineParticleShaders'), w = load({}, './WebGLWindShaders');
    for (const s of [m.ADVECT_FS, w.ADVECT_FS]) { expect(s).toContain('encodeState(pos, u_rand_seed)'); expect(s).toContain('u_rk2'); }
    expect(m.DRAW_VS).toContain('crestLocalBand(global_pos, dir0, periodVal');
    expect(m.DRAW_VS).toContain('crestRankFade(vec2(col, row), particleHash, densityThreshold)');

    const noFloat = load({ [K.float]: true }, './WebGLMarineParticleShaders');
    expect(noFloat.ADVECT_FS).toContain('gl_FragColor = encodePos(pos);');
    expect(noFloat.ADVECT_FS).not.toContain('u_floatState');
    expect(noFloat.ADVECT_FS).toContain('marineMidOffset');        // RK2 still on
    expect(noFloat.DRAW_VS).toContain('crestLocalBand');            // phase still on

    const noRk2 = load({ [K.rk2]: true }, './WebGLWindShaders');
    expect(noRk2.ADVECT_FS).not.toContain('windMidOffset');
    expect(noRk2.ADVECT_FS).toContain('encodeState(pos, u_rand_seed)');

    const noPhase = load({ [K.phase]: true }, './WebGLMarineParticleShaders');
    expect(noPhase.DRAW_VS).not.toContain('crestLocalBand');
    expect(noPhase.DRAW_VS).toContain('  v_phase = trainPhase;');
    expect(noPhase.DRAW_VS).toContain('crestRankFade');

    const noRank = load({ [K.rank]: true }, './WebGLMarineParticleShaders');
    expect(noRank.DRAW_VS).not.toContain('crestRankFade');
    expect(noRank.DRAW_VS).toContain('  if (!bypassDiscard && particleHash > densityThreshold) {');
    expect(noRank.DRAW_VS).toContain('  v_alpha *= 0.9 + particleHash * 0.2;');
  });
});

describe('killed live (after load): the uniforms and the encoder return the old behaviour', () => {
  afterEach(() => Object.values(K).forEach((k) => delete window[k]));

  it('float state: no float texture, no dither; RK2: u_rk2 0', () => {
    const ps = require('./particleState');
    expect(ps.particleStateUniforms({ _stateFloat: true }, {})).toEqual({ u_floatState: 1, u_stochRound: 0, u_rk2: 1 });
    expect(ps.particleStateUniforms({ _stateFloat: false }, {})).toEqual({ u_floatState: 0, u_stochRound: 1, u_rk2: 1 });
    expect(ps.particleStateUniforms({ _stateFloat: false }, { [K.float]: true, [K.rk2]: true })).toEqual({ u_floatState: 0, u_stochRound: 0, u_rk2: 0 });
    expect(ps.floatStateWanted({ [K.float]: true })).toBe(false);
  });

  it('crest phase and texel rank: their uniforms are 0', () => {
    const cl = require('./crestLocalPhase'), tr = require('./crestTexelRank');
    expect(cl.crestLocalPhaseOn({})).toBe(true);
    expect(cl.crestLocalPhaseOn({ [K.phase]: true })).toBe(false);
    expect(tr.crestTexelRankOn({})).toBe(true);
    expect(tr.crestTexelRankOn({ [K.rank]: true })).toBe(false);
    const set = {};
    const gl = { uniform1f: (loc, v) => { set[loc] = v; }, uniform4f: jest.fn(), uniform1fv: jest.fn(), getUniformLocation: (p, n) => n };
    window[K.phase] = true; window[K.rank] = true;
    expect(cl.applyCrestPhaseUniforms(gl, {}, {}, { time: 1, motionScale: 1, cx: 0.5, cy: 0.5, zoom: 5, tileWidth: 1 })).toBeNull();
    tr.applyCrestRankUniforms(gl, {});
    expect(set).toEqual({ u_crestLocal: 0, u_texelRank: 0 });
  });

  it('wind encoder: floor bytes and the raw range', () => {
    const e = require('./windEncoderRound');
    expect(e.windEncoderRoundOn({ [K.enc]: true })).toBe(false);
    window[K.enc] = true;
    expect(e.windByteRange(-12.3, 17.1)).toEqual({ min: -12.3, max: 17.1 });
    expect(e.windByte(0, -12.3, 17.1)).toBe(Math.floor((12.3 / 29.4) * 255));
  });
});
