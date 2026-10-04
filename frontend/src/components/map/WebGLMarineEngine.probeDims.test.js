import WebGLMarineEngine from './WebGLMarineEngine';
const probeMarineMaskGPU = (engine, points, gl) => WebGLMarineEngine.prototype.probeMaskGPU.call(engine, points, gl);
function setup() {
  const foreignRead = {}, foreignDraw = {};
  let read = foreignRead, draw = foreignDraw;
  const gl = {
    FRAMEBUFFER: 1, FRAMEBUFFER_BINDING: 2, READ_FRAMEBUFFER: 3, READ_FRAMEBUFFER_BINDING: 4,
    getParameter: parameter => parameter === 4 ? read : draw,
    createFramebuffer: () => ({}),
    bindFramebuffer: (target, value) => {
      if (target === 1 || target === 3) read = value;
      if (target === 1) draw = value;
    },
    framebufferTexture2D: () => {}, checkFramebufferStatus: () => 1,
    FRAMEBUFFER_COMPLETE: 1, readPixels: jest.fn(), deleteFramebuffer: () => {},
  };
  return { engine: {}, gl, state: () => ({ read, draw }), foreignRead, foreignDraw };
}
describe('overlay span perturbation with a finite water attachment', () => {
  test.each([0.2, 2, 12, 40].flatMap(span => [false, true].map(recorded => [span, recorded])))(
    'span=%s recorded=%s preserves water and stays inside attachment', (span, recorded) => {
    const { engine, gl, state, foreignRead, foreignDraw } = setup();
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
    expect(result[0].effective).toBe(recorded ? 255 : null);
    expect(state().read).toBe(foreignRead);
    expect(state().draw).toBe(foreignDraw);
    if (!recorded) expect(gl.readPixels).not.toHaveBeenCalled();
    for (const [x, y, w] of gl.readPixels.mock.calls) {
      expect(x + w).toBeLessThanOrEqual(2048);
      expect(y).toBeLessThan(1024);
    }
  });
});

test.each(['framebufferTexture2D', 'checkFramebufferStatus', 'readPixels'])(
  'probe restores a foreign framebuffer when %s throws', operation => {
    const { engine, gl } = setup();
    const foreign = {}, owned = {};
    gl.getParameter = () => foreign;
    gl.createFramebuffer = () => owned;
    gl.bindFramebuffer = jest.fn();
    gl.deleteFramebuffer = jest.fn();
    gl[operation] = () => { throw new Error('injected GPU failure'); };
    Object.assign(engine, { _overlayMaskTex: {},
      _overlayMaskBounds: { west: -1, east: 1, south: -1, north: 1 },
      _overlayMaskTexDims: { w: 128, h: 64 },
    });
    expect(() => probeMarineMaskGPU(engine, [{ lng: 0, lat: 0 }], gl)).toThrow('injected GPU failure');
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.READ_FRAMEBUFFER, foreign);
    expect(gl.deleteFramebuffer).toHaveBeenCalledWith(owned);
  }
);

