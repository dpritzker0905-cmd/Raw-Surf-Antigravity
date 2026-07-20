import { resolveWindAnimTuning } from '../components/map/WebGLWindEngine';
import { ADVECT_FS } from '../components/map/WebGLWindShaders';

// 2026-07-06 wind anim tuning: low-band density floor (z3.3-4.69, ~+10% on-screen presence) and
// speed-contrast gamma. Physics stays linearly speed-proportional — gamma 1.0 is an exact no-op
// (pow(x, 0) == 1), and the default 1.15 only damps SLOW particles relative to fast ones.

describe('resolveWindAnimTuning', () => {
  it('defaults: lowBandBias 0.012, speedGamma 1.15', () => {
    expect(resolveWindAnimTuning(null)).toEqual({ lowBandBias: 0.012, speedGamma: 1.15 });
    expect(resolveWindAnimTuning({})).toEqual({ lowBandBias: 0.012, speedGamma: 1.15 });
  });

  it('levers override within clamps', () => {
    expect(resolveWindAnimTuning({ __RAW_WIND_LOWBAND_BIAS__: 0.05, __RAW_WIND_SPEED_GAMMA__: 1.4 }))
      .toEqual({ lowBandBias: 0.05, speedGamma: 1.4 });
    // clamped
    expect(resolveWindAnimTuning({ __RAW_WIND_LOWBAND_BIAS__: 7 }).lowBandBias).toBe(1);
    expect(resolveWindAnimTuning({ __RAW_WIND_LOWBAND_BIAS__: -1 }).lowBandBias).toBe(0);
    expect(resolveWindAnimTuning({ __RAW_WIND_SPEED_GAMMA__: 99 }).speedGamma).toBe(3);
    expect(resolveWindAnimTuning({ __RAW_WIND_SPEED_GAMMA__: 0 }).speedGamma).toBe(0.5);
  });

  it('kill switch __RAW_DISABLE_WIND_SPEED_GAMMA__ restores exact-linear physics (gamma 1.0)', () => {
    expect(resolveWindAnimTuning({ __RAW_DISABLE_WIND_SPEED_GAMMA__: true }).speedGamma).toBe(1.0);
    expect(resolveWindAnimTuning({ __RAW_DISABLE_WIND_SPEED_GAMMA__: true, __RAW_WIND_SPEED_GAMMA__: 2 }).speedGamma).toBe(1.0);
  });

  it('non-numeric / non-finite lever values fall back to defaults', () => {
    expect(resolveWindAnimTuning({ __RAW_WIND_LOWBAND_BIAS__: 'x', __RAW_WIND_SPEED_GAMMA__: NaN }))
      .toEqual({ lowBandBias: 0.012, speedGamma: 1.15 });
  });
});

describe('ADVECT_FS wiring (shader carries the new uniforms and applies them)', () => {
  it('declares the tuning uniforms', () => {
    expect(ADVECT_FS).toContain('uniform float u_lowband_bias;');
    expect(ADVECT_FS).toContain('uniform float u_speed_gamma;');
    expect(ADVECT_FS).toContain('uniform float u_speed_max;');
  });

  it('applies the speed-contrast gamma to the advection offset (R-gate yields to LINEAR inside a vortex)', () => {
    // queue #2 (2026-07-19): gamma is applied through gammaEff = mix(u_speed_gamma, 1.0,
    // vortexGate) — bit-exact pow(speedNorm, u_speed_gamma - 1.0) when the gate is 0 (which is
    // always outside a fine-overlay circulation), LINEAR truth inside one.
    expect(ADVECT_FS).toContain('float gammaEff = mix(u_speed_gamma, 1.0, vortexGate);');
    expect(ADVECT_FS).toContain('pow(speedNorm, gammaEff - 1.0)');
  });

  it('applies the low-band viewport-bias floor over the stock z4-7 ramp', () => {
    expect(ADVECT_FS).toContain('smoothstep(3.1, 3.3, u_zoom)');
    expect(ADVECT_FS).toContain('u_lowband_bias * lowBand');
  });
});
