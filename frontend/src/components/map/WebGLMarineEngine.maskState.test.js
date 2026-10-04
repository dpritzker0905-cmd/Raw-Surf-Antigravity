import WebGLMarineEngine from './WebGLMarineEngine';

jest.mock('./WebGLMarineMaskRenderer', () => ({
  renderMaskToCanvas: () => ({ width: 128, height: 64 }),
  overlayBasemapWaterOnMask: () => ({ applied: true }),
  isBasemapWaterSourceReady: () => true,
}));
jest.mock('./maskCoastSDF', () => ({ writeCoastDistanceField: () => false }));

function fixture(existingOverlay, fails) {
  const foreign = { owner: 'basemap' }, mask = { owner: 'mask' };
  let bound = foreign, flip = false;
  const gl = {
    TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, UNPACK_FLIP_Y_WEBGL: 3,
    getParameter: p => p === 2 ? bound : flip,
    bindTexture: (_target, value) => { bound = value; },
    pixelStorei: (_name, value) => { flip = value; },
    createTexture: () => ({ owner: 'overlay' }), texParameteri: () => {},
    texImage2D: jest.fn(() => { if (fails) throw new RangeError('injected upload failure'); }),
  };
  const engine = Object.create(WebGLMarineEngine.prototype);
  Object.assign(engine, {
    _cachedMaskGeoJSON: { type: 'FeatureCollection', features: [] },
    _cachedMaskBounds: { west: 0, east: 4, south: 0, north: 4 },
    _cachedMaskTex: mask, _waveData: { u_oceanMaskTexture: mask },
    _overlayMaskTex: existingOverlay ? { owner: 'existing-overlay' } : null,
  });
  const map = { getZoom: () => 7, getBounds: () => ({
    getWest: () => 1, getEast: () => 2, getSouth: () => 1, getNorth: () => 2,
  }) };
  return { engine, gl, map, foreign, state: () => ({ bound, flip }) };
}

describe('mask upload preserves the shared basemap texture state', () => {
  beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => jest.restoreAllMocks());
  test.each([
    ['regional success', 'refreshMaskWithBasemapWater', false, false],
    ['regional failure', 'refreshMaskWithBasemapWater', false, true],
    ['new overlay success', 'refreshViewportOverlayMask', false, false],
    ['new overlay failure', 'refreshViewportOverlayMask', false, true],
    ['existing overlay success', 'refreshViewportOverlayMask', true, false],
    ['existing overlay failure', 'refreshViewportOverlayMask', true, true],
  ])('%s', (_name, method, existing, fails) => {
    const f = fixture(existing, fails);
    expect(f.engine[method](f.gl, f.map)).toBe(!fails);
    expect(f.gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(f.state()).toEqual({ bound: f.foreign, flip: false });
    if (!fails && method === 'refreshViewportOverlayMask') {
      expect(f.engine._overlayMaskTexDims).toEqual({ w: 128, h: 64 });
    }
    if (fails) {
      expect(f.engine._regionalPatchState).toBeUndefined();
      expect(f.engine._overlayMaskTruthBox).toBeUndefined();
    }
  });
  test('writer and probe share actual attachment dimensions', () => {
    const f = fixture(false, false);
    expect(f.engine.refreshViewportOverlayMask(f.gl, f.map)).toBe(true);
    Object.assign(f.gl, {
      createFramebuffer: () => ({}), bindFramebuffer: jest.fn(),
      framebufferTexture2D: () => {}, checkFramebufferStatus: () => 1,
      FRAMEBUFFER_COMPLETE: 1, deleteFramebuffer: jest.fn(),
      readPixels: jest.fn((x, y, w, h, format, type, bytes) => {
        expect(x).toBeGreaterThanOrEqual(0); expect(x + w).toBeLessThanOrEqual(128);
        expect(y).toBeGreaterThanOrEqual(0); expect(y + h).toBeLessThanOrEqual(64);
        bytes[0] = 255;
      }),
    });
    f.engine._probeState = { overlayOn: true, replace: true };
    expect(f.engine.probeMaskGPU([{ lng: 1.8, lat: 1.2 }], f.gl)[0].effective).toBe(255);
    expect(f.gl.readPixels).toHaveBeenCalledTimes(1);
  });
});
