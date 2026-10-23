/**
 * A commit that keeps the very mask texture that was painted keeps its basemap-water paint record (2026-10-23, maskPatchKeep.js).
 *
 * Live at the z9 opening view (dev 5460d13b, the lead's read): maskWaterPaint ran ~107 ms on most one-hour steps, because
 * setWaveData forgets the paint record on EVERY commit, a REUSED mask included. Runs the REAL refreshMaskWithBasemapWater on a
 * fake engine (the WebGLMarineEngine.maskState.test.js fixture): the painter and GL are stubs, the decision is the engine's.
 */
import fs from 'fs';
import path from 'path';
import WebGLMarineEngine from './WebGLMarineEngine';
import { keepMaskPatch, maskGridKey, stampMaskPatch } from './maskPatchKeep';

jest.mock('./WebGLMarineMaskRenderer', () => ({
  renderMaskToCanvas: () => ({ width: 128, height: 64 }),
  overlayBasemapWaterOnMask: () => ({ applied: true }),
  prepareBasemapWaterOverlay: () => ({ feats: [{}], usedSourceFallback: false }),
  isBasemapWaterSourceReady: () => true,
}));
jest.mock('./maskCoastSDF', () => ({ writeCoastDistanceField: () => false }));

function fixture() {
  const mask = { owner: 'mask' };
  let bound = null;
  const gl = {
    TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, UNPACK_FLIP_Y_WEBGL: 3,
    getParameter: (p) => (p === 2 ? bound : false),
    bindTexture: (_t, v) => { bound = v; }, pixelStorei: () => {}, texParameteri: () => {}, createTexture: () => ({ owner: 'overlay' }),
    texImage2D: jest.fn(),
  };
  const engine = Object.create(WebGLMarineEngine.prototype);
  Object.assign(engine, {
    _cachedMaskGeoJSON: { type: 'FeatureCollection', features: [] },
    _cachedMaskBounds: { west: -82, east: -79, south: 27, north: 29 },
    _cachedMaskTex: mask, _waveData: { u_oceanMaskTexture: mask },
  });
  // z7: below the mid-zoom overlay carve, so a covered view is a plain hysteresis skip
  const map = { getZoom: () => 7, getBounds: () => ({ getWest: () => -81.2, getEast: () => -80.1, getSouth: () => 27.8, getNorth: () => 28.3 }) };
  // what setWaveData does on a commit: forget the record, then (the fix) give it back when the bound mask is the painted texture
  const commit = (waveData = engine._waveData) => { engine._regionalPatchState = null; engine._waveData = waveData; keepMaskPatch(engine, waveData); };
  return { engine, gl, map, mask, commit };
}

describe('maskPatchKeep: the paint record survives a commit that kept the painted texture', () => {
  beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); window.__RAW_GPU__ = {}; });
  afterEach(() => { delete window.__RAW_DISABLE_MASK_PATCH_KEEP__; delete window.__RAW_GPU__; jest.restoreAllMocks(); });

  it('a commit on the REUSED mask (same texture, same bounds, same view) does not repaint', () => {
    const f = fixture();
    expect(f.engine.refreshMaskWithBasemapWater(f.gl, f.map)).toBe(true);     // the first paint
    expect(f.gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(f.mask.__rsPatch).toBe(f.engine._regionalPatchState);
    f.commit();                                                              // a scrub step's commit (encode mode 'reuse')
    expect(f.engine.refreshMaskWithBasemapWater(f.gl, f.map)).toBe(false);
    expect(f.engine._lastMaskRepatchReason).toBe('hysteresis_covered');
    expect(f.gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(window.__RAW_GPU__.maskPatchKept).toBe(1);
  });

  it('positive control: with the keep killed, the same commit repaints (the live 107 ms per step)', () => {
    const f = fixture();
    f.engine.refreshMaskWithBasemapWater(f.gl, f.map);
    window.__RAW_DISABLE_MASK_PATCH_KEEP__ = true;
    f.commit();
    expect(f.engine.refreshMaskWithBasemapWater(f.gl, f.map)).toBe(true);
    expect(f.gl.texImage2D).toHaveBeenCalledTimes(2);
  });

  it('a NEW mask texture (a rebuild: patch-less) carries no record and is painted', () => {
    const f = fixture();
    f.engine.refreshMaskWithBasemapWater(f.gl, f.map);
    const rebuilt = { owner: 'rebuilt' };
    f.engine._cachedMaskTex = rebuilt;
    f.commit({ u_oceanMaskTexture: rebuilt });
    expect(f.engine._regionalPatchState).toBeNull();
    expect(f.engine.refreshMaskWithBasemapWater(f.gl, f.map)).toBe(true);
    expect(f.gl.texImage2D).toHaveBeenCalledTimes(2);
  });

  it('a painted texture filed under OTHER bounds (a stash swap that re-bounded it) is not trusted', () => {
    const f = fixture();
    f.engine.refreshMaskWithBasemapWater(f.gl, f.map);
    f.engine._cachedMaskBounds = { west: -83, east: -79, south: 26, north: 30 };
    f.commit();
    expect(f.engine._regionalPatchState).toBeNull();
  });

  it('a degraded paint record comes back too, and the hysteresis still refuses to skip on it', () => {
    const f = fixture();
    f.engine.refreshMaskWithBasemapWater(f.gl, f.map);
    f.engine._regionalPatchState.degraded = true;
    f.commit();
    expect(f.engine._regionalPatchState.degraded).toBe(true);
    expect(f.engine.refreshMaskWithBasemapWater(f.gl, f.map)).toBe(true);    // a degraded paint never earns the skip
  });

  it('a pan out of the painted box repaints, record or not', () => {
    const f = fixture();
    f.engine.refreshMaskWithBasemapWater(f.gl, f.map);
    f.commit();
    f.map.getBounds = () => ({ getWest: () => -81.6, getEast: () => -80.5, getSouth: () => 27.8, getNorth: () => 28.3 });
    expect(f.engine.refreshMaskWithBasemapWater(f.gl, f.map)).toBe(true);
  });

  it('the helpers: the key is the refresh\'s own gridKey; a stamp is invisible to enumeration; a primitive is left alone', () => {
    expect(maskGridKey({ west: -82, south: 27, east: -79, north: 29 })).toBe('-82_27_-79_29');
    const t = {};
    stampMaskPatch(t, { gridKey: 'k' });
    expect(Object.keys(t)).toEqual([]);
    expect(stampMaskPatch(7, { gridKey: 'k' })).toEqual({ gridKey: 'k' });
    expect(keepMaskPatch(null, null)).toBe(false);
  });

  it('wiring: setWaveData keeps the record right after it installs the commit; the paint stamps its texture', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
    expect(src).toMatch(/this\._regionalPatchState = null;/);                     // the reset stays (a rebuild must repaint)
    expect(src).toMatch(/this\._waveData = newWaveData; keepMaskPatch\(this, newWaveData\);/);
    expect(src).toMatch(/this\._regionalPatchState = stampMaskPatch\(tex, \{ gridKey, box: \{ \.\.\.curView \}, degraded, z: _curZoom \}\);/);
  });
});
