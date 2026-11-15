/**
 * The hour blend of the wind field (windHourBlend.js). Gate: docs/weather-program/log/2026-11-15-fable-wind-hour-blend.md
 * (W11 the off paths, W15 device limits). The blend is OFF BY DEFAULT: it runs only with window.__RAW_ENABLE_HOUR_BLEND__.
 */
import {
  WIND_BLEND_MS, WIND_PREV_UNIT, WIND_BLEND_VERTEX_UNITS, disposeWindBlend, keepOutgoingWindBase, noteWindBlendFallback, setWindBlendUniforms,
  windBlendDeviceVerdict, windBlendEase, windBlendMs, windBlendVerdict, windPrevMix, windPrevUvMap,
} from './windHourBlend';
import { windHourBlendEnabled, withWindHourBlend } from './windHourBlendGLSL';

const BOUNDS = { west: -180, south: -80, east: 180, north: 80 };
const grid = (o = {}) => ({ cols: 181, rows: 83, bounds: BOUNDS, source: 'GFS', valid_time: '2026-11-15T12:00:00Z', ...o });
const KEYS = ['__RAW_ENABLE_HOUR_BLEND__', '__RAW_DISABLE_WIND_HOUR_BLEND__', '__RAW_WIND_BLEND_MS__', '__RAW_WIND_BLEND_HOLD__', '__RAW_WIND_HOUR_BLEND__'];

function fakeGl({ combined = 32, vertex = 16, throwOnLimits = false } = {}) {
  const calls = [];
  const gl = {
    TEXTURE0: 100, TEXTURE_2D: 3, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 'combined', MAX_VERTEX_TEXTURE_IMAGE_UNITS: 'vertex',
    getParameter: (p) => { if (throwOnLimits) throw new Error('lost'); return p === 'combined' ? combined : p === 'vertex' ? vertex : null; },
    getUniformLocation: (prog, name) => name,
    activeTexture: (u) => calls.push(['activeTexture', u]),
    bindTexture: (t, tex) => calls.push(['bindTexture', tex]),
    deleteTexture: (tex) => calls.push(['deleteTexture', tex]),
    uniform1f: (loc, v) => calls.push(['uniform1f', loc, v]),
    uniform1i: (loc, v) => calls.push(['uniform1i', loc, v]),
    uniform2f: (loc, a, b) => calls.push(['uniform2f', loc, a, b]),
    uniform4f: (loc, ...v) => calls.push(['uniform4f', loc, ...v]),
  };
  return { gl, calls };
}
const engineWith = (g = grid(), shaders = true) => ({
  _windBlendShaders: shaders,
  _windData: { texture: { id: 'base' }, uMin: [-30, -25], uMax: [40, 35], bounds: { ...g.bounds }, windGrid: g },
});
const on = () => { window.__RAW_ENABLE_HOUR_BLEND__ = true; };

beforeEach(() => { for (const k of KEYS) delete window[k]; window.matchMedia = undefined; });
afterAll(() => { for (const k of KEYS) delete window[k]; });

describe('off by default; the opt-in, the kill and reduced motion', () => {
  it('is OFF with nothing set: no duration, and nothing is kept', () => {
    expect(windHourBlendEnabled(window)).toBe(false);
    expect(windBlendMs()).toBe(0);
    const { gl, calls } = fakeGl(); const e = engineWith();
    expect(keepOutgoingWindBase(e, gl, grid({ valid_time: '2026-11-15T15:00:00Z' }))).toBe(false);
    expect(e._windPrev).toBeUndefined(); expect(e._windBlend).toBeNull(); expect(calls).toEqual([]);
    expect(window.__RAW_WIND_HOUR_BLEND__.skips.off).toBe(1);
  });
  it('runs for 160 ms with the opt-in set to exactly true', () => {
    on(); expect(windBlendMs()).toBe(WIND_BLEND_MS); expect(WIND_BLEND_MS).toBe(160);
    window.__RAW_ENABLE_HOUR_BLEND__ = 1; expect(windBlendMs()).toBe(0);
    window.__RAW_ENABLE_HOUR_BLEND__ = 'true'; expect(windBlendMs()).toBe(0);
  });
  it('the kill wins over the opt-in', () => {
    on(); window.__RAW_DISABLE_WIND_HOUR_BLEND__ = true;
    expect(windHourBlendEnabled(window)).toBe(false); expect(windBlendMs()).toBe(0);
  });
  it('prefers-reduced-motion gives no blend', () => {
    on(); window.matchMedia = (q) => ({ matches: /reduce/.test(q) });
    expect(windBlendMs()).toBe(0);
  });
  it('the lab override sets the duration only while the blend is enabled', () => {
    window.__RAW_WIND_BLEND_MS__ = 4000; expect(windBlendMs()).toBe(0);
    on(); expect(windBlendMs()).toBe(4000);
    window.__RAW_WIND_BLEND_MS__ = -1; expect(windBlendMs()).toBe(WIND_BLEND_MS);
  });
});

describe('the shader text is added only when enabled at load', () => {
  const SRC = { advect: 'A\nuniform vec2 u_wind_max;          // max u,v values for decoding\nB\n  vec2 wind = mix(u_wind_min, u_wind_max, vec2(windData.r, windData.g));\nC\n',
    draw: 'A\nuniform vec2 u_wind_max;\nB\n  vec2 wind = mix(u_wind_min, u_wind_max, vec2(windColor.r, windColor.g));\nC\n',
    field: 'A\nuniform vec2 u_wind_max;\nB\n  vec2 wind = mix(u_wind_min, u_wind_max, encoded.rg);\nC\n' };
  it.each(['advect', 'draw', 'field'])('%s: unset, or killed, the shader is returned as it came, byte for byte', (which) => {
    expect(withWindHourBlend(SRC[which], which, {})).toBe(SRC[which]);
    expect(withWindHourBlend(SRC[which], which, { __RAW_ENABLE_HOUR_BLEND__: true, __RAW_DISABLE_WIND_HOUR_BLEND__: true })).toBe(SRC[which]);
  });
  it.each(['advect', 'draw', 'field'])('%s: enabled, the uniforms and the vector mix are added and the rest is untouched', (which) => {
    const out = withWindHourBlend(SRC[which], which, { __RAW_ENABLE_HOUR_BLEND__: true });
    expect(out).toContain('uniform sampler2D u_windPrev;');
    expect(out).toContain('wind = mix(wind, prevWind, u_windPrevMix);');
    expect(out).toContain('if (u_windPrevMix > 0.0) {');   // at rest the earlier texture is not read
    expect(out.includes('u_debug_mode > 9.5')).toBe(which === 'field');
    expect(out.startsWith('A\n')).toBe(true); expect(out.endsWith('C\n')).toBe(true);
  });
  it('throws at load when an anchor is missing or doubled (enabled only)', () => {
    expect(() => withWindHourBlend('nothing here', 'advect', { __RAW_ENABLE_HOUR_BLEND__: true })).toThrow(/expected exactly one/);
    expect(() => withWindHourBlend('x', 'nope', {})).toThrow(/unknown shader/);
  });
  it('the real shaders, loaded with nothing set, carry no blend text and equal their plain text', () => {
    jest.isolateModules(() => {
      const sh = require('./WebGLWindShaders'); const g = require('./windHourBlendGLSL');
      expect(g.windBlendShadersLoaded()).toBe(false);
      for (const [which, src] of [['advect', sh.ADVECT_FS], ['draw', sh.DRAW_VS], ['field', sh.HEATMAP_FS]]) {
        expect(src).toBe(g.windPlainShader(which)); expect(src).not.toContain('u_windPrev');
      }
    });
  });
  it('the real shaders, loaded with the opt-in, carry the blend text and keep their plain text beside it', () => {
    on();
    jest.isolateModules(() => {
      const sh = require('./WebGLWindShaders'); const g = require('./windHourBlendGLSL');
      expect(g.windBlendShadersLoaded()).toBe(true);
      for (const [which, src] of [['advect', sh.ADVECT_FS], ['draw', sh.DRAW_VS], ['field', sh.HEATMAP_FS]]) {
        expect(src).toContain('u_windPrevMix'); expect(g.windPlainShader(which)).not.toContain('u_windPrev');
        expect(src.length).toBeGreaterThan(g.windPlainShader(which).length);
      }
    });
  });
});

describe('which steps blend', () => {
  it('needs two grids with bounds', () => {
    expect(windBlendVerdict(null, grid())).toBe('no_grid'); expect(windBlendVerdict(grid(), { cols: 1 })).toBe('no_grid');
  });
  it('never across models, nor when a model is unknown', () => {
    expect(windBlendVerdict(grid(), grid({ source: 'ECMWF', valid_time: 'x' }))).toBe('model_differs');
    expect(windBlendVerdict(grid({ source: null }), grid({ source: null, valid_time: 'x' }))).toBe('model_differs');
    expect(windBlendVerdict(grid({ source: null, truthTag: { model: 'GFS' } }), grid({ valid_time: 'x' }))).toBeNull();
  });
  it('not the same hour on the same grid; another hour, or another grid, does', () => {
    expect(windBlendVerdict(grid(), grid({ bounds: { ...BOUNDS } }))).toBe('same_hour');
    expect(windBlendVerdict(grid(), grid({ valid_time: '2026-11-15T15:00:00Z' }))).toBeNull();
    expect(windBlendVerdict(grid(), grid({ cols: 85, rows: 56, bounds: { west: -170, south: 10, east: -140, north: 30 } }))).toBeNull();
  });
});

describe('keeping the outgoing base', () => {
  const NEXT = grid({ valid_time: '2026-11-15T15:00:00Z' });
  it('keeps the texture with its own range, bounds and time, and starts no clock yet', () => {
    on(); const { gl } = fakeGl(); const e = engineWith(); const tex = e._windData.texture;
    expect(keepOutgoingWindBase(e, gl, NEXT)).toBe(true);
    expect(e._windPrev).toMatchObject({ texture: tex, uMin: [-30, -25], uMax: [40, 35], cols: 181, rows: 83, validTime: '2026-11-15T12:00:00Z' });
    expect(e._windPrev.bounds).toEqual(BOUNDS); expect(e._windPrev.bounds).not.toBe(e._windData.bounds);
    expect(e._windBlend).toEqual({ t0: 0, ms: 160 });
    expect(window.__RAW_WIND_HOUR_BLEND__).toMatchObject({ starts: 1, gridSwaps: 0 });
  });
  it('does not keep it when the PLAIN shaders are compiled (device limits or a refused link)', () => {
    on(); const { gl } = fakeGl(); const e = engineWith(grid(), false);
    expect(keepOutgoingWindBase(e, gl, NEXT)).toBe(false);
    expect(e._windPrev).toBeUndefined(); expect(window.__RAW_WIND_HOUR_BLEND__.skips.no_shaders).toBe(1);
  });
  it('does not keep it across models or with no base', () => {
    on(); const { gl } = fakeGl();
    expect(keepOutgoingWindBase(engineWith(), gl, grid({ source: 'ECMWF', valid_time: 'x' }))).toBe(false);
    expect(keepOutgoingWindBase({ _windBlendShaders: true }, gl, NEXT)).toBe(false);
    expect(window.__RAW_WIND_HOUR_BLEND__.skips).toMatchObject({ model_differs: 1, no_base: 1 });
  });
  it('several commits before one drawn frame keep the field that is ON SCREEN', () => {
    on(); const { gl, calls } = fakeGl(); const e = engineWith(); const first = e._windData.texture;
    keepOutgoingWindBase(e, gl, NEXT);
    e._windData = { ...e._windData, texture: { id: 'never-drawn' }, windGrid: NEXT };
    expect(keepOutgoingWindBase(e, gl, grid({ valid_time: '2026-11-15T18:00:00Z' }))).toBe(false);   // the caller frees the undrawn one
    expect(e._windPrev.texture).toBe(first); expect(calls).toEqual([]); expect(window.__RAW_WIND_HOUR_BLEND__.kept).toBe(1);
  });
  it('a step inside a running blend restarts from the field being replaced and frees the older one', () => {
    on(); const { gl, calls } = fakeGl(); const e = engineWith(); const first = e._windData.texture;
    keepOutgoingWindBase(e, gl, NEXT); windPrevMix(e, 1000);   // drawn once: the clock runs
    const second = { id: 'second' }; e._windData = { ...e._windData, texture: second, windGrid: NEXT };
    expect(keepOutgoingWindBase(e, gl, grid({ valid_time: '2026-11-15T18:00:00Z' }))).toBe(true);
    expect(calls).toContainEqual(['deleteTexture', first]); expect(e._windPrev.texture).toBe(second);
    expect(e._windBlend.t0).toBe(0); expect(window.__RAW_WIND_HOUR_BLEND__.restarts).toBe(1);
  });
  it('never throws: a broken engine is a hard swap, counted', () => {
    on(); const e = engineWith(); Object.defineProperty(e, '_windPrev', { get() { throw new Error('boom'); } });
    expect(keepOutgoingWindBase(e, fakeGl().gl, NEXT)).toBe(false); expect(window.__RAW_WIND_HOUR_BLEND__.errors).toBe(1);
  });
  it('dispose frees the kept texture and ends the blend', () => {
    on(); const { gl, calls } = fakeGl(); const e = engineWith(); const tex = e._windData.texture;
    keepOutgoingWindBase(e, gl, NEXT); disposeWindBlend(e, gl);
    expect(e._windPrev).toBeNull(); expect(e._windBlend).toBeNull(); expect(calls).toContainEqual(['deleteTexture', tex]);
  });
});

describe('the mix over time', () => {
  const NEXT = grid({ valid_time: '2026-11-15T15:00:00Z' });
  const started = () => { on(); const g = fakeGl(); const e = engineWith(); keepOutgoingWindBase(e, g.gl, NEXT); e._windData = { ...e._windData, texture: { id: 'new' }, windGrid: NEXT }; return { e, ...g }; };
  it('smoothstep: 0, a half, 1, clamped', () => {
    expect(windBlendEase(0)).toBe(0); expect(windBlendEase(0.5)).toBe(0.5); expect(windBlendEase(1)).toBe(1);
    expect(windBlendEase(-3)).toBe(0); expect(windBlendEase(9)).toBe(1); expect(windBlendEase(0.25)).toBeCloseTo(0.15625, 10);
  });
  it('is 1 at the first drawn frame, a half half-way, 0 and over at the end', () => {
    const { e } = started();
    expect(windPrevMix(e, 5000)).toBe(1); expect(windPrevMix(e, 5080)).toBeCloseTo(0.5, 10);
    expect(windPrevMix(e, 5160)).toBe(0); expect(e._windBlend).toBeNull(); expect(window.__RAW_WIND_HOUR_BLEND__.ends).toBe(1);
  });
  it('is 0 with no blend, and the kill set mid-blend ends it', () => {
    expect(windPrevMix({}, 1)).toBe(0);
    const { e } = started(); windPrevMix(e, 100); window.__RAW_DISABLE_WIND_HOUR_BLEND__ = true;
    expect(windPrevMix(e, 120)).toBe(0); expect(e._windBlend).toBeNull();
  });
  it('the lab hold pins the mix (hold 0.25 draws 0.75 of the earlier field)', () => {
    const { e } = started(); window.__RAW_WIND_BLEND_HOLD__ = 0.25;
    expect(windPrevMix(e, 1)).toBe(0.75); expect(windPrevMix(e, 99999)).toBe(0.75);
  });
});

describe('where the earlier grid lies', () => {
  it('the same grid maps onto itself', () => { expect(windPrevUvMap(BOUNDS, { ...BOUNDS })).toEqual([1, 1, 0, 0]); });
  it('a regional grid inside a world one: scale and offset in the earlier grid\'s uv', () => {
    const m = windPrevUvMap({ west: -170, south: 10, east: -140, north: 30 }, BOUNDS);
    expect(m[0]).toBeCloseTo(30 / 360, 12); expect(m[1]).toBeCloseTo(20 / 160, 12); expect(m[2]).toBeCloseTo(10 / 360, 12); expect(m[3]).toBeCloseTo(90 / 160, 12);
  });
  it('a grid across the dateline has a positive span; a degenerate one is the identity', () => {
    const m = windPrevUvMap({ west: 170, south: 0, east: -170, north: 10 }, { west: 160, south: 0, east: -160, north: 10 });
    expect(m[0]).toBeCloseTo(0.5, 12); expect(m[2]).toBeCloseTo(0.25, 12);
    expect(windPrevUvMap({ west: 0, south: 0, east: 0, north: 0 }, BOUNDS)).toEqual([1, 1, 0, 0]);
  });
});

describe('the uniforms each pass sets', () => {
  const NEXT = grid({ valid_time: '2026-11-15T15:00:00Z' });
  const started = () => { on(); const g = fakeGl(); const e = engineWith(); const old = e._windData.texture; keepOutgoingWindBase(e, g.gl, NEXT); e._windData = { ...e._windData, texture: { id: 'new' }, windGrid: NEXT }; return { e, old, ...g }; };
  it('with the PLAIN shaders compiled it makes no GL call at all', () => {
    const { gl, calls } = fakeGl(); setWindBlendUniforms(gl, engineWith(grid(), false), 'prog'); expect(calls).toEqual([]);
  });
  it('at rest: the mix is 0 and the earlier texture unit is not touched', () => {
    on(); const { gl, calls } = fakeGl(); setWindBlendUniforms(gl, engineWith(), 'prog');
    expect(calls).toEqual([['uniform1f', 'u_windPrevMix', 0]]);
  });
  it('during a blend: the earlier field on its own unit, with its own range, place and registration', () => {
    const { e, old, gl, calls } = started(); setWindBlendUniforms(gl, e, 'prog');
    expect(calls).toContainEqual(['uniform1f', 'u_windPrevMix', 1]);
    expect(calls).toContainEqual(['activeTexture', 100 + WIND_PREV_UNIT]); expect(calls).toContainEqual(['bindTexture', old]);
    expect(calls).toContainEqual(['uniform1i', 'u_windPrev', WIND_PREV_UNIT]);
    expect(calls).toContainEqual(['uniform2f', 'u_windPrev_min', -30, -25]); expect(calls).toContainEqual(['uniform2f', 'u_windPrev_max', 40, 35]);
    expect(calls).toContainEqual(['uniform4f', 'u_windPrevMap', 1, 1, 0, 0]);
    expect(calls.some((c) => c[0] === 'uniform4f' && c[1] === 'u_windPrev_reg' && c.length === 6)).toBe(true);
  });
  it('a forced 0 (the fine overlay\'s own pass) neither reads nor frees the earlier field', () => {
    const { e, gl, calls } = started(); setWindBlendUniforms(gl, e, 'prog', 0);
    expect(calls).toEqual([['uniform1f', 'u_windPrevMix', 0]]); expect(e._windPrev).not.toBeNull();
  });
  it('once the blend is over the kept texture is freed and the mix is 0', () => {
    const { e, old, gl, calls } = started(); windPrevMix(e, 1000); windPrevMix(e, 1161);
    setWindBlendUniforms(gl, e, 'prog');
    expect(calls).toContainEqual(['uniform1f', 'u_windPrevMix', 0]); expect(calls).toContainEqual(['deleteTexture', old]); expect(e._windPrev).toBeNull();
  });
});

describe('W15: device limits', () => {
  it('needs the earlier field\'s unit and four vertex texture units', () => {
    expect(WIND_PREV_UNIT).toBe(7); expect(WIND_BLEND_VERTEX_UNITS).toBe(4);
    expect(windBlendDeviceVerdict(fakeGl({ combined: 8, vertex: 4 }).gl)).toBeNull();
    expect(windBlendDeviceVerdict(fakeGl({ combined: 7, vertex: 16 }).gl)).toBe('combined_units');
    expect(windBlendDeviceVerdict(fakeGl({ combined: 32, vertex: 3 }).gl)).toBe('vertex_units');
    expect(windBlendDeviceVerdict(fakeGl({ combined: 32, vertex: 0 }).gl)).toBe('vertex_units');
    expect(windBlendDeviceVerdict(fakeGl({ throwOnLimits: true }).gl)).toBe('limits_unreadable');
    expect(windBlendDeviceVerdict(fakeGl({ combined: null, vertex: 16 }).gl)).toBe('combined_units');
  });
  it('a fallback is counted with its reason', () => {
    noteWindBlendFallback('vertex_units'); noteWindBlendFallback('link_failed');
    expect(window.__RAW_WIND_HOUR_BLEND__).toMatchObject({ fallbacks: 2, fallbackWhy: 'link_failed' });
  });
});

describe('W15: which shader set the engine compiles', () => {
  // Each case loads the modules afresh, so "loaded with the opt-in" is a real module-load state.
  const load = (startImpl) => {
    let out;
    jest.isolateModules(() => {
      jest.doMock('./WebGLProgramBatch', () => ({ ...jest.requireActual('./WebGLProgramBatch'), startProgramBatch: jest.fn(startImpl) }));
      const init = require('./WebGLWindEngineInit'); const batchMod = require('./WebGLProgramBatch'); const g = require('./windHourBlendGLSL');
      out = { init, start: batchMod.startProgramBatch, BATCH: batchMod.BATCH, g };
    });
    jest.dontMock('./WebGLProgramBatch');
    return out;
  };
  const blended = (sources) => sources[0][1].includes('u_windPrev') && sources[1][0].includes('u_windPrev') && sources[4][1].includes('u_windPrev');
  const plain = (sources) => !sources.some((p) => p.some((s) => s.includes('u_windPrev')));
  const okBatch = () => ({ programs: [1, 2, 3, 4, 5], state: 'ready', poll: () => 'ready' });

  it('nothing set: the plain set, no fallback counted', () => {
    const { init, start } = load(okBatch);
    const r = init.startWindPrograms(fakeGl().gl);
    expect(r.blend).toBe(false); expect(start).toHaveBeenCalledTimes(1); expect(plain(start.mock.calls[0][1])).toBe(true);
    expect(window.__RAW_WIND_HOUR_BLEND__).toBeUndefined();
  });
  it('the opt-in on a capable device: the blended set', () => {
    on(); const { init, start } = load(okBatch);
    const r = init.startWindPrograms(fakeGl().gl);
    expect(r.blend).toBe(true); expect(start).toHaveBeenCalledTimes(1); expect(blended(start.mock.calls[0][1])).toBe(true);
  });
  it('the opt-in on a device below the limits: the plain set, counted with the reason', () => {
    on(); const { init, start } = load(okBatch);
    const r = init.startWindPrograms(fakeGl({ vertex: 0 }).gl);
    expect(r.blend).toBe(false); expect(start).toHaveBeenCalledTimes(1); expect(plain(start.mock.calls[0][1])).toBe(true);
    expect(window.__RAW_WIND_HOUR_BLEND__).toMatchObject({ fallbacks: 1, fallbackWhy: 'vertex_units' });
  });
  it('the blended set refused at once: the plain set is compiled instead, counted', () => {
    on(); let n = 0; const { init, start } = load(() => (n++ === 0 ? null : okBatch()));
    const r = init.startWindPrograms(fakeGl().gl);
    expect(r.blend).toBe(false); expect(r.batch).not.toBeNull(); expect(start).toHaveBeenCalledTimes(2);
    expect(blended(start.mock.calls[0][1])).toBe(true); expect(plain(start.mock.calls[1][1])).toBe(true);
    expect(window.__RAW_WIND_HOUR_BLEND__).toMatchObject({ fallbacks: 1, fallbackWhy: 'link_failed' });
  });
  it('the blended set failing LATER (the async link): the plain set replaces it and the layer keeps waiting, not failing', () => {
    on(); const { init, start, BATCH } = load(() => ({ programs: ['a', 'b', 'c', 'd', 'e'], state: 'pending', poll: () => 'pending' }));
    const engine = { _windBlendShaders: true, _programBatch: { poll: () => BATCH.FAILED, mode: 'async', state: BATCH.FAILED, polls: 3, timedOut: false, ms: 1 } };
    expect(init.pollPrograms(engine, fakeGl().gl)).toBe(BATCH.PENDING);
    expect(engine._windBlendShaders).toBe(false); expect(start).toHaveBeenCalledTimes(1); expect(plain(start.mock.calls[0][1])).toBe(true);
    expect(engine.advectProgram).toBe('a'); expect(engine.heatmapProgram).toBe('e'); expect(engine._programBatch.state).toBe('pending');
    expect(window.__RAW_WIND_HOUR_BLEND__).toMatchObject({ fallbacks: 1, fallbackWhy: 'link_failed' });
  });
});
