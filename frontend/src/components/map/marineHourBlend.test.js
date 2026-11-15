/**
 * The hour blend of the marine colour field (marineHourBlend.js). Gate: docs/weather-program/log/2026-11-15-fable-crest-hour-blend.md.
 */
import fs from 'fs';
import path from 'path';
import {
  CREST_BLEND_MS, HOUR_BLEND_UNIT, beforeWaveOverwrite, beforeWaveRealloc, cancelHourBlend, crestBlendEase, crestBlendMs, disposeHourBlend,
  hourBlendPrevMix, hourBlendVerdict, setHourBlendUniforms,
} from './marineHourBlend';
import { HEATMAP_FS } from './WebGLMarineShaders';

jest.mock('./WebGLMarineTextureState', () => ({ createTexture: jest.fn(() => ({ id: 'prev' })) }));
jest.mock('./WebGLWindUtils', () => ({ safeDeleteTexture: jest.fn() }));
const { createTexture } = require('./WebGLMarineTextureState');
const { safeDeleteTexture } = require('./WebGLWindUtils');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
const BOUNDS = { west: -180, south: -80, east: 180, north: 80 };
const grid = (o = {}) => ({ cols: 46, rows: 21, bounds: BOUNDS, __sourceModel: 'GFS', __componentLayer: 'waves', valid_time: '2026-11-15T12:00:00Z', ...o });
const next = (o = {}) => ({ cols: 46, rows: 21, bounds: { ...BOUNDS }, model: 'GFS', layer: 'waves', validTime: '2026-11-15T15:00:00Z', ...o });

function fakeGl({ complete = true, throwOnCopy = false } = {}) {
  const calls = [];
  const gl = {
    FRAMEBUFFER: 1, COLOR_ATTACHMENT0: 2, TEXTURE_2D: 3, FRAMEBUFFER_COMPLETE: 4, FRAMEBUFFER_BINDING: 5, TEXTURE_BINDING_2D: 6, LINEAR: 7,
    getParameter: (p) => (p === 5 ? 'fb-before' : p === 6 ? 'tex-before' : null),
    createFramebuffer: () => 'fbo',
    bindFramebuffer: (t, f) => calls.push(['bindFramebuffer', f]),
    framebufferTexture2D: (t, a, tt, tex) => calls.push(['attach', tex]),
    checkFramebufferStatus: () => (complete ? 4 : 0),
    bindTexture: (t, tex) => calls.push(['bindTexture', tex]),
    copyTexSubImage2D: (...a) => { if (throwOnCopy) throw new Error('lost'); calls.push(['copy', ...a]); },
    uniform1f: (loc, v) => calls.push(['uniform1f', loc, v]),
    uniform1i: (loc, v) => calls.push(['uniform1i', loc, v]),
    uniform2f: (loc, a, b) => calls.push(['uniform2f', loc, a, b]),
    uniform4f: (loc, ...v) => calls.push(['uniform4f', loc, ...v]),
  };
  return { gl, calls };
}
const engineWith = (g = grid(), extra = {}) => { const tex = { id: 'resident' }; return { _residentWaveTex: tex, _waveData: { u_waveTexture: tex, waveGrid: g, ...extra } }; };

beforeEach(() => {
  delete window.__RAW_DISABLE_CREST_HOUR_BLEND__; delete window.__RAW_CREST_BLEND_MS__; delete window.__RAW_CREST_BLEND_HOLD__; delete window.__RAW_CREST_HOUR_BLEND__;
  window.matchMedia = undefined; createTexture.mockReset(); createTexture.mockImplementation(() => ({ id: 'prev' })); safeDeleteTexture.mockReset();   // CRA resets mocks between tests
});

describe('crestBlendMs / crestBlendEase', () => {
  test('160 ms by default, the same as the own-frame rasters', () => {
    expect(CREST_BLEND_MS).toBe(160); expect(crestBlendMs()).toBe(160);
    expect(read('ownRasterLayer.js')).toMatch(/export const BLEND_MS = 160;/);
  });
  test('OFF PATH: the kill gives 0; only the literal true kills', () => {
    window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true; expect(crestBlendMs()).toBe(0);
    for (const v of [1, 'true', false, null, undefined]) { window.__RAW_DISABLE_CREST_HOUR_BLEND__ = v; expect(crestBlendMs()).toBe(160); }
  });
  test('prefers-reduced-motion gives 0 (a hard swap, as before)', () => {
    window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q) }); expect(crestBlendMs()).toBe(0);
    window.matchMedia = () => ({ matches: false }); expect(crestBlendMs()).toBe(160);
    window.matchMedia = () => { throw new Error('no'); }; expect(crestBlendMs()).toBe(160);
  });
  test('the lab override sets the duration; junk is ignored', () => {
    window.__RAW_CREST_BLEND_MS__ = 400; expect(crestBlendMs()).toBe(400);
    window.__RAW_CREST_BLEND_MS__ = 0; expect(crestBlendMs()).toBe(0);
    for (const v of ['x', -5, NaN]) { window.__RAW_CREST_BLEND_MS__ = v; expect(crestBlendMs()).toBe(160); }
  });
  test('the ease runs 0 to 1, clamped, and never goes back', () => {
    expect(crestBlendEase(-1)).toBe(0); expect(crestBlendEase(0)).toBe(0); expect(crestBlendEase(0.5)).toBe(0.5); expect(crestBlendEase(1)).toBe(1); expect(crestBlendEase(3)).toBe(1);
    let last = 0; for (let t = 0; t <= 1.0001; t += 0.01) { const v = crestBlendEase(t); expect(v).toBeGreaterThanOrEqual(last); last = v; }
  });
});

describe('hourBlendVerdict: which steps may be blended', () => {
  test('another hour on the same grid, model and layer may', () => { expect(hourBlendVerdict(grid(), next(), false)).toBeNull(); });
  test('another GRID may too (v2), in the same hour or another: size or bounds', () => {
    for (const nx of [next({ cols: 181 }), next({ rows: 81 }), next({ bounds: { ...BOUNDS, west: -170 } }), next({ cols: 181, validTime: '2026-11-15T12:00:00Z' })]) expect(hourBlendVerdict(grid(), nx, false)).toBeNull();
    expect(hourBlendVerdict(grid({ bounds: undefined }), next(), false)).toBe('no_grid');
  });
  test.each([
    ['model_differs', grid(), next({ model: 'EURO' })],
    ['layer_differs', grid(), next({ layer: 'swell_1' })],
    ['rating', grid(), next({ rating: true })],
    ['mask_differs', grid(), next({ maskDiffers: true })],
    ['same_hour', grid(), next({ validTime: '2026-11-15T12:00:00Z' })],
    ['same_hour', grid({ valid_time: undefined }), next()],
    ['no_grid', null, next()],
  ])('%s is a hard swap', (why, old, nx) => { expect(hourBlendVerdict(old, nx, false)).toBe(why); });
  test('ratings on screen are never blended; a missing model or layer reads as GFS waves', () => {
    expect(hourBlendVerdict(grid(), next(), true)).toBe('rating');
    expect(hourBlendVerdict(grid({ __sourceModel: undefined, __componentLayer: undefined }), next({ model: undefined, layer: undefined }), false)).toBeNull();
  });
  test('the hour on screen is its SERVED time when the grid has one', () => {
    expect(hourBlendVerdict(grid({ served_valid_time: '2026-11-15T15:00:00Z' }), next(), false)).toBe('same_hour');
  });
});

describe('beforeWaveOverwrite: the hour on screen is copied before it is overwritten', () => {
  test('copies the resident into the earlier-hour texture, starts the blend, and puts the GL bindings back', () => {
    const e = engineWith(); const { gl, calls } = fakeGl();
    expect(beforeWaveOverwrite(e, gl, next())).toBe(true);
    expect(createTexture).toHaveBeenCalledWith(gl, gl.LINEAR, null, 46, 21);
    expect(calls).toContainEqual(['attach', e._residentWaveTex]);
    expect(calls).toContainEqual(['copy', 3, 0, 0, 0, 0, 0, 46, 21]);
    expect(calls.filter((c) => c[0] === 'bindFramebuffer').pop()).toEqual(['bindFramebuffer', 'fb-before']);
    expect(calls.filter((c) => c[0] === 'bindTexture').pop()).toEqual(['bindTexture', 'tex-before']);
    expect(e._hourBlend).toEqual({ t0: 0, ms: 160 });
    expect(window.__RAW_CREST_HOUR_BLEND__.starts).toBe(1);
    expect(e._hourPrev).toMatchObject({ wave: e._hourCopyTex, adopted: false, cols: 46, rows: 21, bounds: BOUNDS, scale: 10 });
  });
  test('the texture is made once and reused', () => {
    const e = engineWith(); const { gl } = fakeGl();
    beforeWaveOverwrite(e, gl, next()); hourBlendPrevMix(e, 1000); hourBlendPrevMix(e, 2000);
    e._waveData.waveGrid = grid({ valid_time: '2026-11-15T15:00:00Z' });
    beforeWaveOverwrite(e, gl, next({ validTime: '2026-11-15T18:00:00Z' }));
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(window.__RAW_CREST_HOUR_BLEND__.starts).toBe(2);
  });
  test('several steps before one drawn frame keep the hour that is ON SCREEN (no second copy)', () => {
    const e = engineWith(); const { gl, calls } = fakeGl();
    beforeWaveOverwrite(e, gl, next());
    e._waveData.waveGrid = grid({ valid_time: '2026-11-15T15:00:00Z' });   // written, never drawn
    expect(beforeWaveOverwrite(e, gl, next({ validTime: '2026-11-15T18:00:00Z' }))).toBe(true);
    expect(calls.filter((c) => c[0] === 'copy')).toHaveLength(1);
    expect(window.__RAW_CREST_HOUR_BLEND__.kept).toBe(1);
  });
  test('a step inside a running blend restarts it from the hour being replaced', () => {
    const e = engineWith(); const { gl, calls } = fakeGl();
    beforeWaveOverwrite(e, gl, next()); expect(hourBlendPrevMix(e, 1000)).toBe(1); expect(hourBlendPrevMix(e, 1080)).toBeCloseTo(0.5, 5);
    e._waveData.waveGrid = grid({ valid_time: '2026-11-15T15:00:00Z' });
    beforeWaveOverwrite(e, gl, next({ validTime: '2026-11-15T18:00:00Z' }));
    expect(calls.filter((c) => c[0] === 'copy')).toHaveLength(2);
    expect(e._hourBlend.t0).toBe(0); expect(window.__RAW_CREST_HOUR_BLEND__.restarts).toBe(1);
  });
  test.each([
    ['off', () => { window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true; return [engineWith(), next()]; }],
    ['no_resident', () => { const e = engineWith(); e._waveData.u_waveTexture = { id: 'standalone' }; return [e, next()]; }],
    ['no_resident', () => [{ _residentWaveTex: null, _waveData: null }, next()]],
    ['model_differs', () => [engineWith(), next({ model: 'ICON' })]],
    ['rating', () => [engineWith(grid(), { u_waveScoreTexture: {} }), next()]],
    ['mask_differs', () => [engineWith(), next({ maskDiffers: true })]],
  ])('OFF PATH %s: no copy, no texture, and a running blend is dropped', (why, make) => {
    const [e, nx] = make(); const { gl, calls } = fakeGl(); e._hourBlend = { t0: 5, ms: 160 };
    expect(beforeWaveOverwrite(e, gl, nx)).toBe(false);
    expect(calls.filter((c) => c[0] === 'copy')).toHaveLength(0); expect(createTexture).not.toHaveBeenCalled();
    expect(e._hourBlend).toBeNull(); expect(window.__RAW_CREST_HOUR_BLEND__.skips[why]).toBe(1);
  });
  test('an incomplete framebuffer or a GL error is a hard swap, never a throw, with the bindings put back', () => {
    const a = engineWith(); const g1 = fakeGl({ complete: false });
    expect(beforeWaveOverwrite(a, g1.gl, next())).toBe(false); expect(a._hourBlend == null).toBe(true);
    expect(window.__RAW_CREST_HOUR_BLEND__.skips.copy_failed).toBe(1);
    const b = engineWith(); const g2 = fakeGl({ throwOnCopy: true });
    expect(() => beforeWaveOverwrite(b, g2.gl, next())).not.toThrow(); expect(b._hourBlend == null).toBe(true);
    expect(g2.calls.filter((c) => c[0] === 'bindFramebuffer').pop()).toEqual(['bindFramebuffer', 'fb-before']);
    expect(window.__RAW_CREST_HOUR_BLEND__.errors).toBe(1);
  });
  test('a resident of another size frees the old earlier-hour texture first', () => {
    const e = engineWith(); const { gl } = fakeGl();
    beforeWaveOverwrite(e, gl, next()); hourBlendPrevMix(e, 0.001); hourBlendPrevMix(e, 5000);
    e._waveData.waveGrid = grid({ cols: 90, rows: 40 }); const first = e._hourCopyTex;
    beforeWaveOverwrite(e, gl, next({ cols: 90, rows: 40 }));
    expect(safeDeleteTexture).toHaveBeenCalledWith(gl, first, null); expect(createTexture).toHaveBeenLastCalledWith(gl, gl.LINEAR, null, 90, 40);
  });
});

describe('hourBlendPrevMix: how much of the earlier hour is drawn', () => {
  const started = () => { const e = engineWith(); beforeWaveOverwrite(e, fakeGl().gl, next()); return e; };
  test('0 with no blend: the path drawn before this change', () => { expect(hourBlendPrevMix(engineWith(), 1000)).toBe(0); expect(hourBlendPrevMix(null, 1000)).toBe(0); });
  test('1 on the first frame after the step, falling to 0, then the blend is over', () => {
    const e = started();
    expect(hourBlendPrevMix(e, 1000)).toBe(1);
    const mid = hourBlendPrevMix(e, 1040); expect(mid).toBeLessThan(1); expect(mid).toBeGreaterThan(0.5);
    expect(hourBlendPrevMix(e, 1080)).toBeCloseTo(0.5, 5);
    expect(hourBlendPrevMix(e, 1159)).toBeLessThan(0.01);
    expect(hourBlendPrevMix(e, 1160)).toBe(0); expect(e._hourBlend).toBeNull();
    expect(window.__RAW_CREST_HOUR_BLEND__.ends).toBe(1); expect(window.__RAW_CREST_HOUR_BLEND__.mix).toBe(0);
    expect(hourBlendPrevMix(e, 1200)).toBe(0);
  });
  test('the clock starts at the first DRAWN frame, not at the upload', () => {
    const e = started(); expect(e._hourBlend.t0).toBe(0);
    expect(hourBlendPrevMix(e, 90000)).toBe(1); expect(e._hourBlend.t0).toBe(90000);
  });
  test('OFF PATH: the kill set while a blend runs ends it on the next frame', () => {
    const e = started(); hourBlendPrevMix(e, 1000);
    window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true;
    expect(hourBlendPrevMix(e, 1010)).toBe(0); expect(e._hourBlend).toBeNull();
  });
  test('the lab hold keeps a started blend at one progress; clearing it lets the blend run', () => {
    const e = started(); window.__RAW_CREST_BLEND_HOLD__ = 0.5;
    expect(hourBlendPrevMix(e, 1000)).toBe(0.5); expect(hourBlendPrevMix(e, 99000)).toBe(0.5); expect(e._hourBlend.t0).toBe(0);
    window.__RAW_CREST_BLEND_HOLD__ = null;
    expect(hourBlendPrevMix(e, 100000)).toBe(1); expect(hourBlendPrevMix(e, 100160)).toBe(0);
  });
  test('cancel and dispose drop the blend; dispose frees the texture', () => {
    const e = started(); cancelHourBlend(e); expect(e._hourBlend).toBeNull(); expect(e._hourCopyTex).toBeTruthy();
    const tex = e._hourCopyTex; disposeHourBlend(e, {}); expect(safeDeleteTexture).toHaveBeenCalledWith({}, tex, null); expect(e._hourCopyTex).toBeNull(); expect(e._hourPrev).toBeNull();
    expect(() => disposeHourBlend(null, {})).not.toThrow();
  });
});

describe('setHourBlendUniforms: the colour pass', () => {
  const loc = (gl, p, name) => name; let bind;
  beforeEach(() => { bind = jest.fn(); });
  test('at rest the mix is 0 and the earlier hour is NOT bound', () => {
    const { gl, calls } = fakeGl(); setHourBlendUniforms(gl, engineWith(), 'prog', loc, bind);
    expect(calls).toEqual([['uniform1f', 'u_hourPrevMix', 0]]); expect(bind).not.toHaveBeenCalled();
  });
  test('while a step blends, the earlier hour is bound on its own unit', () => {
    const e = engineWith(); beforeWaveOverwrite(e, fakeGl().gl, next());
    const { gl, calls } = fakeGl(); setHourBlendUniforms(gl, e, 'prog', loc, bind);
    expect(calls).toContainEqual(['uniform1f', 'u_hourPrevMix', 1]); expect(calls).toContainEqual(['uniform1i', 'u_wavePrevTexture', HOUR_BLEND_UNIT]);
    expect(bind).toHaveBeenCalledWith(gl, e._hourPrev.wave, HOUR_BLEND_UNIT);
    expect(calls).toContainEqual(['uniform2f', 'u_prevBounds_min', -180, -80]); expect(calls).toContainEqual(['uniform2f', 'u_prevBounds_max', 180, 80]);
    expect(calls).toContainEqual(['uniform2f', 'u_prevTexel', 0, 0]);                 // land-aware fetch is off by default: plain fetch
    expect(calls).toContainEqual(['uniform1f', 'u_prevHeightRatio', 1]);
  });
  test('ratings: the score texture is drawn and never blended', () => {
    const e = engineWith(); beforeWaveOverwrite(e, fakeGl().gl, next()); e._waveData.u_waveScoreTexture = {};
    const { gl, calls } = fakeGl(); setHourBlendUniforms(gl, e, 'prog', loc, bind);
    expect(calls).toEqual([['uniform1f', 'u_hourPrevMix', 0]]); expect(bind).not.toHaveBeenCalled();
  });
});

describe('the shader and the call sites', () => {
  test('the colour shader mixes VALUES before colouring, and reads the earlier field only when the mix is above 0', () => {
    for (const u of ['uniform sampler2D u_wavePrevTexture;', 'uniform float u_hourPrevMix;', 'uniform highp vec2 u_prevBounds_min;', 'uniform highp vec2 u_prevBounds_max;', 'uniform GEO_P vec4 u_prev_reg;', 'uniform GEO_P vec2 u_prevTexel;', 'uniform float u_prevHeightRatio;']) expect(HEATMAP_FS).toContain(u);
    const at = HEATMAP_FS.indexOf('vec4 waveData = sampleWaveLandAware(data_uv);'); const open = HEATMAP_FS.indexOf('  if (u_hourPrevMix > 0.0) {', at);
    expect(open).toBeGreaterThan(at); expect(HEATMAP_FS.slice(at, open).split('\n').length).toBe(3);    // the very next statement (one comment line between)
    const block = HEATMAP_FS.slice(open, HEATMAP_FS.indexOf('float depthFactor', open));
    expect(block).toContain('if (pu >= 0.0 && pu <= 1.0 && pv >= 0.0 && pv <= 1.0) {');                 // outside the earlier grid, this field alone
    expect(block).toContain('vec4 prevData = sampleWavePrev(ptReg(vec2(pu, pv), u_prev_reg));');        // at ITS OWN place
    expect(block).toContain('prevData.b *= u_prevHeightRatio;');                                        // heights in metres
    expect(block).toContain('waveData = mix(waveData, prevData, u_hourPrevMix);');
    expect(HEATMAP_FS.split('sampleWavePrev(').length - 1).toBe(2);                                     // its definition and this one call
    expect(HEATMAP_FS.indexOf('float waveHeight = waveData.b')).toBeGreaterThan(open);                  // the height is read after the mix
    const body = HEATMAP_FS.slice(HEATMAP_FS.indexOf('vec4 sampleWavePrev('), HEATMAP_FS.indexOf('GEO_P float mercatorYToLat('));
    expect(HEATMAP_FS.split('texture2D(u_wavePrevTexture').length - 1).toBe(body.split('texture2D(u_wavePrevTexture').length - 1);   // read nowhere else
  });
  test('on an unchanged grid the earlier hour is fetched with the same water-only weights as this hour', () => {
    const cur = HEATMAP_FS.slice(HEATMAP_FS.indexOf('vec4 sampleWaveLandAware('), HEATMAP_FS.indexOf('vec4 sampleWavePrev('));
    const prev = HEATMAP_FS.slice(HEATMAP_FS.indexOf('vec4 sampleWavePrev('), HEATMAP_FS.indexOf('GEO_P float mercatorYToLat('));
    for (const s2 of ['u_landAwareFetch < 0.5', 'wsum < 0.0001']) { expect(cur).toContain(s2); expect(prev).toContain(s2); }
    expect(prev).toContain('uv / u_prevTexel - 0.5'); expect(prev.split('texture2D(u_chlorophyllTexture').length - 1).toBe(4);
  });
  test('both upload paths keep the hour on screen BEFORE they overwrite it', () => {
    const enc = read('WebGLMarineTextureEncoder.js');
    const a = enc.indexOf('beforeWaveOverwrite(engine, gl, {'); const b = enc.indexOf('updateTexture(gl, waveTex, dataWave, cols, rows);');
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); expect(enc.slice(a, b)).toContain('rating: !!dataWaveScore');
    const r = enc.indexOf('beforeWaveRealloc(engine, gl, {'); expect(r).toBeGreaterThan(0);
    expect(enc.indexOf('safeDeleteTexture(gl, engine._residentWaveTex, engine);')).toBeGreaterThan(r);              // kept BEFORE the old grid is freed
    expect(read('WebGLWindUtils.js')).toContain('if (engine._hourPrev && engine._hourPrev.adopted && tex === engine._hourPrev.wave) return;');
    const rt = read('marineFrameStoreRuntime.js');
    const c = rt.indexOf('beforeWaveOverwrite(engine, gl, {'); const d = rt.indexOf('ok = rt.pool.copyToTexture(info.key, e.layer, tex);');
    expect(c).toBeGreaterThan(0); expect(d).toBeGreaterThan(c); expect(rt.slice(c, d)).toContain('maskDiffers: !!aux || maskCells > 0');
    expect(rt).toContain("if (!ok) { cancelHourBlend(engine); if (aux) rt.resident = null; return miss('copy_failed'); }");
  });
  test('the colour pass sets the mix every frame; the wash is never blended; teardown frees the texture', () => {
    const eng = read('WebGLMarineEngine.js');
    expect(eng).toContain('setHourBlendUniforms(gl, this, this.heatmapProgram, uniformLoc, bindTexture);');
    expect(eng).toContain("gl.uniform1f(uniformLoc(gl, this.heatmapProgram, 'u_hourPrevMix'), 0.0);");
    expect(read('WebGLMarineEngineInit.js')).toContain('disposeHourBlend(engine, gl);');
  });
  test('the particle shaders are not touched by the blend', () => {
    expect(read('WebGLMarineParticleShaders.js')).not.toMatch(/u_hourPrevMix|u_wavePrevTexture/);
  });
});

describe('beforeWaveRealloc (v2): a grid of another size is KEPT, not freed, and drawn at its own place', () => {
  test('the outgoing texture is adopted with its own bounds, size and height scale; nothing is copied', () => {
    const e = engineWith(grid({ cols: 181, rows: 83 })); const old = e._residentWaveTex; const { gl, calls } = fakeGl();
    expect(beforeWaveRealloc(e, gl, next())).toBe(true);
    expect(e._hourPrev).toMatchObject({ wave: old, adopted: true, cols: 181, rows: 83, bounds: BOUNDS, landAware: false });
    expect(calls.filter((c) => c[0] === 'copy')).toHaveLength(0); expect(createTexture).not.toHaveBeenCalled();
    expect(window.__RAW_CREST_HOUR_BLEND__.gridSwaps).toBe(1); expect(e._hourBlend).toEqual({ t0: 0, ms: 160 });
  });
  test('a swap inside ONE hour (the finer grid arriving) blends too', () => {
    const e = engineWith(); expect(beforeWaveRealloc(e, fakeGl().gl, next({ cols: 181, rows: 83, validTime: '2026-11-15T12:00:00Z' }))).toBe(true);
  });
  test('the kept texture is freed when the blend ends', () => {
    const e = engineWith(grid({ cols: 181, rows: 83 })); const old = e._residentWaveTex; const { gl } = fakeGl();
    beforeWaveRealloc(e, gl, next()); e._residentWaveTex = { id: 'new' }; e._waveData = { u_waveTexture: e._residentWaveTex, waveGrid: grid({ valid_time: '2026-11-15T15:00:00Z' }) };
    hourBlendPrevMix(e, 1000); hourBlendPrevMix(e, 2000);                 // the blend is over
    setHourBlendUniforms(gl, e, 'prog', (g, p2, n) => n, jest.fn());
    expect(safeDeleteTexture).toHaveBeenCalledWith(gl, old, null); expect(e._hourPrev).toBeNull();
  });
  test('OFF PATH: the kill, ratings or another model keep nothing', () => {
    const makes = [() => { window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true; return [engineWith(), next()]; }, () => [engineWith(grid(), { u_waveScoreTexture: {} }), next()], () => [engineWith(), next({ model: 'EURO' })]];
    for (const make of makes) { const [e, nx] = make(); expect(beforeWaveRealloc(e, fakeGl().gl, nx)).toBe(false); expect(e._hourPrev == null).toBe(true); delete window.__RAW_DISABLE_CREST_HOUR_BLEND__; }
  });
  test('heights are mixed in metres: the earlier grid scale over this one', () => {
    const e = engineWith(grid({ cols: 181, rows: 83 }), { u_heightScale: 16 }); const { gl } = fakeGl();
    beforeWaveRealloc(e, gl, next()); e._residentWaveTex = { id: 'new' }; e._waveData = { u_waveTexture: e._residentWaveTex, waveGrid: grid({ valid_time: '2026-11-15T15:00:00Z' }) };
    const g2 = fakeGl(); setHourBlendUniforms(g2.gl, e, 'prog', (g, p2, n) => n, jest.fn());
    expect(g2.calls).toContainEqual(['uniform1f', 'u_prevHeightRatio', 1.6]);
  });
});

describe('withHourBlend: the shader text is a wrapper, and the kill at load takes all of it away', () => {
  const { withHourBlend } = require('./marineHourBlendGLSL');
  const BARE = (() => { let out; jest.isolateModules(() => { window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true; try { out = require('./WebGLMarineShaders').HEATMAP_FS; } finally { delete window.__RAW_DISABLE_CREST_HOUR_BLEND__; } }); return out; })();
  test('OFF PATH: with the kill set before the shaders load, the colour shader has none of the blend', () => {
    expect(BARE).not.toMatch(/u_hourPrevMix|u_wavePrevTexture|sampleWavePrev|u_prevBounds|u_prev_reg|u_prevTexel|u_prevHeightRatio|'value' -> 6\.0/);
    expect(BARE.length).toBeLessThan(HEATMAP_FS.length);
  });
  test('the blend\'s shader is the bare shader plus the four insertions, and nothing else', () => {
    expect(withHourBlend(BARE, {})).toBe(HEATMAP_FS);
    expect(withHourBlend(BARE, { __RAW_DISABLE_CREST_HOUR_BLEND__: true })).toBe(BARE);
    for (const v of [1, 'true', false, null]) expect(withHourBlend(BARE, { __RAW_DISABLE_CREST_HOUR_BLEND__: v })).toBe(HEATMAP_FS);
  });
  test('a shader that lost an anchor throws at load instead of drawing without the mix', () => {
    expect(() => withHourBlend(BARE.replace('  vec4 waveData = sampleWaveLandAware(data_uv);\n', ''), {})).toThrow(/withHourBlend/);
    expect(() => withHourBlend(BARE + BARE, {})).toThrow(/withHourBlend/);
  });
  test('the suites that pin an older shader stand the blend down first', () => {
    for (const f of ['marineWaveSpectrum.test.js', 'marineHeightEncoding.test.js']) expect(read(f).split('\n')[0]).toContain("import './marineHourBlendKill.testsupport';");
    expect(HEATMAP_FS).toContain("if (u_debug_mode > 5.5) { // 'value' -> 6.0");
    expect(read('WebGLMarineEngine.js')).toContain("else if (mode === 'value') debugModeVal = 6.0;");
  });
});
