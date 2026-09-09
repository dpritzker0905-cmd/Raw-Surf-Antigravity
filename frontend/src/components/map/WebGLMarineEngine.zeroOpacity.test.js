import WebGLMarineEngine from './WebGLMarineEngine';

// Exercise the actual wash submission path. The real-WebGL lab separately proves
// pixel equality and unchanged simulation when resident/crest submissions are culled.
function wash(opacity, mode, disabled = false) {
  const gl = {
    TEXTURE0: 33984, TEXTURE_2D: 3553, TRIANGLES: 4, UNSIGNED_SHORT: 5123,
    useProgram: jest.fn(), uniformMatrix4fv: jest.fn(), uniform1f: jest.fn(),
    uniform2f: jest.fn(), uniform1i: jest.fn(), activeTexture: jest.fn(),
    bindTexture: jest.fn(), bindVertexArray: jest.fn(), drawElements: jest.fn(),
    getUniformLocation: (_, name) => name,
  };
  window.__GPU_DEBUG__ = mode ? { mode } : null;
  window.__RAW_DISABLE_ZERO_OPACITY_SKIP__ = disabled;
  window.__RAW_GPU__ = { drawCallsPerFrame: 0 };
  const engine = new WebGLMarineEngine();
  engine.heatmapVAO = {}; engine.heatmapProgram = {}; engine.numGridIndices = 6;
  engine._coarseBaseData = { u_waveTexture: {}, u_oceanMaskTexture: {},
    bounds: { west: -180, south: -80, east: 180, north: 84 },
    waveGrid: { cols: 181, rows: 83 } };
  engine._drawCoarseBasePass(gl, new Float32Array(16), 1, 100, opacity, null);
  expect(gl.bindVertexArray).toHaveBeenLastCalledWith(null);
  expect(window.__RAW_GPU__.drawCallsPerFrame).toBe(gl.drawElements.mock.calls.length);
  return gl.drawElements.mock.calls.length;
}
afterEach(() => {
  delete window.__GPU_DEBUG__; delete window.__RAW_DISABLE_ZERO_OPACITY_SKIP__;
  delete window.__RAW_GPU__; delete window.__MARINE_ENGINE__;
});

it('submits no fully transparent normal wash and records no phantom draws', () => {
  expect(wash(0)).toBe(0);
});
it('kill switch restores all three wrap-copy submissions', () => {
  expect(wash(0, null, true)).toBe(3);
});
it.each(['uv', 'mask', 'grid', 'mercator'])('keeps visible %s diagnostics even at zero opacity', mode => {
  expect(wash(0, mode)).toBe(3);
});
it.each([Number.MIN_VALUE, 0.00001, 0.5, 1, -0.1, NaN, undefined])('does not suppress opacity %s', opacity => {
  expect(wash(opacity)).toBe(3);
});
