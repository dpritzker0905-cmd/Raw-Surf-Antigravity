import { probeMarineMaskGPU } from './marineMaskProbe';

const bounds = { west: -20, east: 20, south: -20, north: 20 };
function setup(webgl2 = true) {
  const state = { read: { name: 'read-before' }, draw: { name: 'draw-before' }, texture: null };
  const gl = {
    FRAMEBUFFER: 1, FRAMEBUFFER_BINDING: 2, COLOR_ATTACHMENT0: 3, TEXTURE_2D: 4,
    FRAMEBUFFER_COMPLETE: 5, RGBA: 6, UNSIGNED_BYTE: 7,
    ...(webgl2 ? { READ_FRAMEBUFFER: 8, READ_FRAMEBUFFER_BINDING: 9 } : {}),
    getParameter: jest.fn(() => state.read), createFramebuffer: jest.fn(() => ({ name: 'probe' })),
    deleteFramebuffer: jest.fn(),
    bindFramebuffer: jest.fn((target, fbo) => { state.read = fbo; if (target === 1) state.draw = fbo; }),
    framebufferTexture2D: jest.fn((target, attachment, type, tex) => { state.texture = tex; }),
    checkFramebufferStatus: jest.fn(() => 5),
    readPixels: jest.fn((x, y, w, h, format, type, bytes) => {
      for (let i = 0; i < w; i++) {
        bytes[i * 4] = state.texture.r ?? (x + i) % 256;
        bytes[i * 4 + 2] = state.texture.b ?? y % 256;
      }
    }),
  };
  const engine = { _cachedMaskTex: {}, _cachedMaskBounds: bounds, _cachedMaskTexDims: { w: 64, h: 32 } };
  return { gl, state, engine };
}

it('keeps point order, duplicate samples, flipped north/south texels and exact endpoints', () => {
  const { engine, gl } = setup();
  const points = [{ lng: 20, lat: -20 }, { lng: -20, lat: 20 }, { lng: 20, lat: -20 }];
  const samples = probeMarineMaskGPU(engine, points, gl);
  expect(samples.map(s => [s.effective, s.effB])).toEqual([[63, 0], [0, 31], [63, 0]]);
  expect(samples.map(s => [s.lng, s.lat])).toEqual(points.map(p => [p.lng, p.lat]));
  expect(gl.readPixels).toHaveBeenCalledTimes(2);
});

it('answers every one of 200 water probes with five row reads and one attachment check', () => {
  const { engine, gl } = setup();
  const points = Array.from({ length: 200 }, (_, i) => ({ lng: -19 + Math.floor(i / 5) * 38 / 39,
    lat: [-18, -9, 0, 9, 18][i % 5] }));
  const samples = probeMarineMaskGPU(engine, points, gl);
  expect(samples).toHaveLength(200);
  expect(samples.every(s => s.effective != null && s.effB != null)).toBe(true);
  expect(gl.readPixels).toHaveBeenCalledTimes(5);
  expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(1);
});

it.each([
  [false, false, 190, 120, 'base'], [true, false, 40, 120, 'overlay_min'],
  [true, true, 40, 220, 'overlay_replace'],
])('preserves overlay selection and SDF channels (on=%s replace=%s)', (overlayOn, replace, effective, effB, src) => {
  const { engine, gl } = setup();
  Object.assign(engine, { _cachedMaskTex: { r: 190, b: 120 }, _overlayMaskTex: { r: 40, b: 220 },
    _overlayMaskBounds: bounds, _probeState: { overlayOn, replace } });
  expect(probeMarineMaskGPU(engine, [{ lng: 0, lat: 0 }], gl)[0])
    .toMatchObject({ base: 190, overlay: 40, effective, effB, src });
});

it('uses coarse truth only for unanswered points and keeps uncovered points unknown', () => {
  const { engine, gl } = setup();
  engine._coarseBaseData = { u_oceanMaskTexture: { r: 230, b: 170 },
    bounds: { west: -180, east: 180, south: -80, north: 80 }, __maskCanvasDims: { w: 64, h: 32 } };
  const samples = probeMarineMaskGPU(engine, [{ lng: 0, lat: 0 }, { lng: 90, lat: 0 }, { lng: 90, lat: 85 }], gl);
  expect(samples[0].src).toBe('base');
  expect(samples[1]).toMatchObject({ base: null, overlay: null, effective: 230, effB: 170, src: 'coarse_base' });
  expect(samples[2]).toMatchObject({ effective: null, effB: null, src: 'base' });
  expect(gl.readPixels).toHaveBeenCalledTimes(2);
});

it('keeps overlay truth when no base texel covers the point', () => {
  const { engine, gl } = setup();
  Object.assign(engine, { _cachedMaskTex: null, _overlayMaskTex: { r: 40, b: 220 },
    _overlayMaskBounds: bounds, _probeState: { overlayOn: true, replace: false } });
  expect(probeMarineMaskGPU(engine, [{ lng: 0, lat: 0 }], gl)[0])
    .toMatchObject({ base: null, effective: 40, effB: 220, src: 'overlay_min' });
});

it('restores distinct WebGL2 read/draw bindings and deletes the probe FBO even after failure', () => {
  const { engine, gl, state } = setup();
  const before = { ...state };
  gl.readPixels.mockImplementation(() => { throw Error('read failure'); });
  expect(() => probeMarineMaskGPU(engine, [{ lng: 0, lat: 0 }], gl)).toThrow('read failure');
  expect(state.read).toBe(before.read); expect(state.draw).toBe(before.draw);
  expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
});

it('supports the WebGL1 framebuffer binding and cleans it up', () => {
  const { engine, gl, state } = setup(false), before = state.read;
  probeMarineMaskGPU(engine, [{ lng: 0, lat: 0 }], gl);
  expect(state.read).toBe(before);
  expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, before);
});

it('refuses incomplete attachments instead of manufacturing land truth', () => {
  const { engine, gl } = setup();
  gl.checkFramebufferStatus.mockReturnValue(0);
  expect(probeMarineMaskGPU(engine, [{ lng: 0, lat: 0 }], gl)[0].effective).toBeNull();
  expect(gl.readPixels).not.toHaveBeenCalled(); expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
});
