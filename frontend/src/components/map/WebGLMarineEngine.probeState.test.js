import WebGLMarineEngine from './WebGLMarineEngine';

function fixture(webgl2, failRead) {
  const initialRead = { name: 'basemap-read' }, initialDraw = { name: 'basemap-draw' };
  const state = { read: initialRead, draw: initialDraw };
  const gl = {
    FRAMEBUFFER: 1, FRAMEBUFFER_BINDING: 2, FRAMEBUFFER_COMPLETE: 3,
    ...(webgl2 ? { READ_FRAMEBUFFER: 4, READ_FRAMEBUFFER_BINDING: 5 } : {}),
    getParameter: () => state.read, createFramebuffer: () => ({}),
    bindFramebuffer: (target, value) => {
      state.read = value;
      if (target === 1) state.draw = value;
    },
    framebufferTexture2D: () => {}, checkFramebufferStatus: () => 3,
    readPixels: (_x, _y, _w, _h, _format, _type, bytes) => {
      if (failRead) throw Error('injected read failure');
      bytes[0] = 255;
    },
    deleteFramebuffer: jest.fn(),
  };
  if (!webgl2) state.draw = initialRead;
  const before = { ...state };
  const engine = Object.assign(Object.create(WebGLMarineEngine.prototype), {
    _cachedMaskTex: {}, _cachedMaskTexDims: { w: 64, h: 32 },
    _cachedMaskBounds: { west: -1, east: 1, south: -1, north: 1 },
  });
  return { gl, engine, state, before };
}

test.each([[false, false], [false, true], [true, false], [true, true]])(
  'probe restores framebuffer state and deletes temporary FBO (WebGL2=%s failure=%s)', (webgl2, fails) => {
    const f = fixture(webgl2, fails);
    const run = () => f.engine.probeMaskGPU([{ lng: 0, lat: 0 }], f.gl);
    if (fails) expect(run).toThrow('injected read failure');
    else expect(run()[0].effective).toBe(255);
    expect(f.state.read).toBe(f.before.read);
    expect(f.state.draw).toBe(f.before.draw);
    expect(f.gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
  });
