import WebGLMarineEngine from './WebGLMarineEngine';
const probeMarineMaskGPU = (engine, points, gl) => WebGLMarineEngine.prototype.probeMaskGPU.call(engine, points, gl);
function setup() { return { engine: {}, gl: { getParameter: () => null, createFramebuffer: () => ({}), bindFramebuffer: () => {}, framebufferTexture2D: () => {}, checkFramebufferStatus: () => 1, FRAMEBUFFER_COMPLETE: 1, readPixels: jest.fn(), deleteFramebuffer: () => {} } }; }
describe('overlay span perturbation with a finite water attachment', () => {
  test.each([0.2, 2, 12, 40].flatMap(span => [false, true].map(recorded => [span, recorded])))(
    'span=%s recorded=%s preserves water and stays inside attachment', (span, recorded) => {
    const { engine, gl } = setup();
    Object.assign(engine, { _cachedMaskTex: null, _overlayMaskTex: {},
      _overlayMaskBounds: { west: -span / 2, east: span / 2, south: -1, north: 1 },
      _probeState: { overlayOn: true, replace: true },
      ...(recorded ? { _overlayMaskTexDims: { w: 2048, h: 1024 } } : {}),
    });
    gl.readPixels.mockImplementation((x, y, w, h, format, type, bytes) => {
      // An attachment with finite dimensions: out-of-range reads cannot invent water.
      for (let i = 0; i < w; i++) {
        if (x + i >= 0 && x + i < 2048 && y >= 0 && y < 1024) bytes[i * 4] = 255;
      }
    });
    const result = probeMarineMaskGPU(engine, [{ lng: span * 0.45, lat: -0.9 }], gl);
    expect(result[0].effective).toBe(255);
    for (const [x, y, w] of gl.readPixels.mock.calls) {
      expect(x + w).toBeLessThanOrEqual(2048);
      expect(y).toBeLessThan(1024);
    }
  });
});

