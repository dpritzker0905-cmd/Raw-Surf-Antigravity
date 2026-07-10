/**
 * Audit #23 (2026-07-10, the pan/zoom wind blink): CAMERA-driven particle reseeds (tile drift
 * recenter, zoom-tier crossing) no longer hard-clear the trail FBOs — the field used to blank and
 * rebuild over ~1s on every screen-sized pan. Trails are screen-space and the fade pass ages them
 * out, so keeping them = smooth crossfade (the instant-toggle path's established trade). DATA-driven
 * reseeds (genuine grid-bounds changes) keep the full clear. Kill: __RAW_WIND_TRAIL_CLEAR_LEGACY__.
 */
import { reinitParticles } from '../components/map/WebGLWindEngineInit';
import { initParticleTexture } from '../components/map/WebGLWindUtils';

jest.mock('../components/map/WebGLWindUtils', () => ({
  initParticleTexture: jest.fn(),
  createShader: jest.fn(),
  createProgram: jest.fn(),
  createTexture: jest.fn(),
  unbindTexture: jest.fn(),
  createFBO: jest.fn(),
  bindTexture: jest.fn(),
  encodeWindTexture: jest.fn(),
}));

function makeEngine() {
  return {
    _initialized: true,
    particleRes: 16,
    particleStateA: 'texA',
    particleStateB: 'texB',
    clearBuffers: jest.fn(),
  };
}

const gl = { deleteTexture: jest.fn() };

describe('reinitParticles — keepTrails on camera-driven reseeds', () => {
  beforeEach(() => {
    delete window.__RAW_WIND_TRAIL_CLEAR_LEGACY__;
    initParticleTexture.mockReturnValue('newTex');
  });

  afterEach(() => {
    delete window.__RAW_WIND_TRAIL_CLEAR_LEGACY__;
  });

  it('default (data-driven) reseed clears the trail FBOs — pre-#23 behavior', () => {
    const engine = makeEngine();
    reinitParticles(engine, gl);
    expect(engine.clearBuffers).toHaveBeenCalledWith(gl);
    expect(initParticleTexture).toHaveBeenCalledTimes(2); // state textures always reseed
  });

  it('keepTrails (camera recenter) reseeds particle state WITHOUT clearing the trails', () => {
    const engine = makeEngine();
    reinitParticles(engine, gl, { keepTrails: true });
    expect(engine.clearBuffers).not.toHaveBeenCalled();
    expect(initParticleTexture).toHaveBeenCalledTimes(2);
  });

  it('kill switch __RAW_WIND_TRAIL_CLEAR_LEGACY__ restores the clear even with keepTrails', () => {
    window.__RAW_WIND_TRAIL_CLEAR_LEGACY__ = true;
    const engine = makeEngine();
    reinitParticles(engine, gl, { keepTrails: true });
    expect(engine.clearBuffers).toHaveBeenCalledWith(gl);
  });

  it('no-ops when the engine is not initialized', () => {
    const engine = { ...makeEngine(), _initialized: false };
    reinitParticles(engine, gl, { keepTrails: true });
    expect(engine.clearBuffers).not.toHaveBeenCalled();
    expect(initParticleTexture).not.toHaveBeenCalled();
  });
});
