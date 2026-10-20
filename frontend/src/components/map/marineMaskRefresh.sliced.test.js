import WebGLMarineEngine from './WebGLMarineEngine';
// Plain counting fakes: CRA's Jest config resets jest.fn implementations before every test.
const calls = { render: 0, paint: 0, snapshot: 0, steps: 0 };
jest.mock('./WebGLMarineMaskRenderer', () => ({
  renderMaskToCanvas: () => { calls.render++; return { width: 128, height: 64, getContext: () => ({ getImageData: () => null }) }; },
  overlayBasemapWaterOnMask: () => { calls.paint++; return { painted: 1, degraded: false }; },
  prepareBasemapWaterOverlay: () => ({ feats: [{}], usedSourceFallback: false, waterSource: 'composite' }),
  isBasemapWaterSourceReady: () => true,
  maskDensityPxPerDeg: () => 0,
}));
jest.mock('./basemapWaterOverlay', () => ({
  snapshotOverlayInputs: () => { calls.snapshot++; return { water: {}, vb: {}, wetland: [[], []] }; },
  overlayBasemapWaterSteps: function* () { calls.steps++; yield 1; yield 'pass'; return { painted: 1, degraded: false }; },
}));
jest.mock('./maskCoastSDF', () => ({ writeCoastDistanceField: () => false }));

function fixture(zoom = 7) {
  const mask = { owner: 'mask' };
  const gl = {
    uploads: 0,
    TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, UNPACK_FLIP_Y_WEBGL: 3,
    getParameter: () => null, bindTexture: () => {}, pixelStorei: () => {},
    createTexture: () => ({ owner: 'overlay' }), texParameteri: () => {}, texImage2D() { gl.uploads++; },
  };
  const engine = Object.create(WebGLMarineEngine.prototype);
  Object.assign(engine, {
    _cachedMaskGeoJSON: { type: 'FeatureCollection', features: [] },
    _cachedMaskBounds: { west: 0, east: 4, south: 0, north: 4 },
    _cachedMaskTex: mask, _waveData: { u_oceanMaskTexture: mask }, _overlayMaskTex: null,
  });
  const map = { getZoom: () => zoom, repaints: 0, triggerRepaint() { map.repaints++; }, querySourceFeatures: () => [], getBounds: () => ({
    getWest: () => 1, getEast: () => 2, getSouth: () => 1, getNorth: () => 2,
  }) };
  return { engine, gl, map };
}

describe('sliced map-event mask refresh (prototype, __RAW_SLICED_LAND_MASK__)', () => {
  beforeEach(() => { jest.useFakeTimers(); window.__RAW_GPU__ = {}; Object.keys(calls).forEach((k) => { calls[k] = 0; }); });
  afterEach(() => { jest.useRealTimers(); delete window.__RAW_GPU__; delete window.__RAW_SLICED_LAND_MASK__; });

  test('flag off: opts.sliced changes nothing — the paint and upload happen inside the call', () => {
    const { engine, gl, map } = fixture();
    expect(engine.refreshMaskWithBasemapWater(gl, map, { sliced: true, rerun: () => {} })).toBe(true);
    expect(calls.paint).toBe(1);
    expect(gl.uploads).toBe(1);
    expect(calls.snapshot).toBe(0);
    expect(engine._maskJob).toBeUndefined();
  });

  test('flag on, no opts (a data-commit re-patch): still synchronous', () => {
    window.__RAW_SLICED_LAND_MASK__ = true;
    const { engine, gl, map } = fixture();
    expect(engine.refreshMaskWithBasemapWater(gl, map)).toBe(true);
    expect(gl.uploads).toBe(1);
    expect(calls.paint).toBe(1);
  });

  test('flag on + sliced: the map is read now, the paint and upload land in later tasks, then a repaint', () => {
    window.__RAW_SLICED_LAND_MASK__ = true;
    const { engine, gl, map } = fixture();
    expect(engine.refreshMaskWithBasemapWater(gl, map, { sliced: true })).toBe(true);
    expect(engine._lastMaskRepatchReason).toBe('sliced');
    expect(calls.snapshot).toBe(1);   // every map read happens inside the event
    expect(calls.render).toBe(0);
    expect(gl.uploads).toBe(0);
    expect(engine._regionalPatchState).toBeUndefined();
    jest.runAllTimers();
    expect(calls.steps).toBe(1);
    expect(calls.paint).toBe(0);
    expect(gl.uploads).toBe(1);
    expect(engine._regionalPatchState).toMatchObject({ box: { west: 1, east: 2 }, degraded: false });
    expect(engine._lastMaskRepatchReason).toBe('applied');
    expect(map.repaints).toBeGreaterThan(0);
    expect(window.__RAW_GPU__.maskSlicing).toMatchObject({ scheduled: 1, committed: 1 });
  });

  test('a synchronous paint of the same texture while a job runs makes the job stale (no older upload after it)', () => {
    window.__RAW_SLICED_LAND_MASK__ = true;
    const { engine, gl, map } = fixture();
    engine.refreshMaskWithBasemapWater(gl, map, { sliced: true });
    engine._regionalPatchState = null;
    engine.refreshMaskWithBasemapWater(gl, map);   // the commit-time re-patch
    expect(gl.uploads).toBe(1);
    jest.runAllTimers();
    expect(gl.uploads).toBe(1);
    expect(window.__RAW_GPU__.maskSlicing).toMatchObject({ committed: 0, stale: 1 });
  });

  test('a new mask texture (data commit) mid-job drops the job', () => {
    window.__RAW_SLICED_LAND_MASK__ = true;
    const { engine, gl, map } = fixture();
    engine.refreshMaskWithBasemapWater(gl, map, { sliced: true });
    const fresh = { owner: 'new-mask' };
    engine._cachedMaskTex = fresh; engine._waveData = { u_oceanMaskTexture: fresh };
    jest.runAllTimers();
    expect(gl.uploads).toBe(0);
    expect(window.__RAW_GPU__.maskSlicing.stale).toBe(1);
  });

  test('requests during a job coalesce into one re-drive', () => {
    window.__RAW_SLICED_LAND_MASK__ = true;
    const { engine, gl, map } = fixture();
    let reruns = 0; const rerun = () => { reruns++; };
    engine.refreshMaskWithBasemapWater(gl, map, { sliced: true, rerun });
    engine._regionalPatchState = null;
    expect(engine.refreshMaskWithBasemapWater(gl, map, { sliced: true, rerun })).toBe(false);
    expect(engine._lastMaskRepatchReason).toBe('job_in_flight');
    jest.runAllTimers();
    expect(reruns).toBe(1);
  });

  test('z >= 8: the nested overlay is requested in the same event (queued), not from the regional commit', () => {
    window.__RAW_SLICED_LAND_MASK__ = true;
    const { engine, gl, map } = fixture(10);
    expect(engine.refreshMaskWithBasemapWater(gl, map, { sliced: true })).toBe(true);
    expect(calls.snapshot).toBe(2);                 // regional AND overlay inputs read inside the event
    expect(engine._maskJobQueue).toHaveLength(1);
    jest.runAllTimers();
    expect(gl.uploads).toBe(2);                     // base, then overlay
    expect(calls.snapshot).toBe(2);                 // nothing read the map again at commit time
    expect(engine._overlayMaskBounds).toBeTruthy();
    expect(window.__RAW_GPU__.maskSlicing).toMatchObject({ scheduled: 2, committed: 2, queued: 1 });
  });

  test('wide grid: the delegated overlay is sliced the same way', () => {
    window.__RAW_SLICED_LAND_MASK__ = true;
    const { engine, gl, map } = fixture(6);
    engine._cachedMaskBounds = { west: -180, east: 180, south: -85, north: 85 };
    expect(engine.refreshMaskWithBasemapWater(gl, map, { sliced: true })).toBe(true);
    expect(gl.uploads).toBe(0);
    jest.runAllTimers();
    expect(gl.uploads).toBe(1);
    expect(engine._overlayMaskBounds).toBeTruthy();
    expect(engine._overlayPaintSeq).toBe(1);
  });
});
