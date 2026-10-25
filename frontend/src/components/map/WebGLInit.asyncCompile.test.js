/**
 * ASYNC SHADER COMPILE, engine and layer level (WebGLProgramBatch.js, 2026-10-20).
 *
 * With KHR_parallel_shader_compile the engines return from init with their shader batch still compiling. These tests
 * drive the REAL marine and wind engines and custom layers over a recording GL and pin the contract:
 *   - init allocates buffers, textures and the framebuffer, but asks no program anything and builds no vertex array;
 *   - render() makes no GL call at all until the batch is ready;
 *   - the poll builds the vertex arrays once, when the batch is ready;
 *   - a link failure found by the poll releases EVERYTHING init allocated and reaches the same hard-error fallback as a
 *     failed init, once;
 *   - dispose while compiling drops the batch; a re-init (style swap, context restore) starts a fresh one;
 *   - the kill switch and a missing extension keep #403's synchronous init (the mutation control for the first two).
 */
import WebGLMarineEngine from './WebGLMarineEngine';
import WebGLWindEngine from './WebGLWindEngine';
import { createCustomLayer as createMarineLayer } from './WebGLMarineCustomLayer';
import { createCustomLayer as createWindLayer } from './WebGLWindLayer';
import { SKIP } from './marineLayerStamp';
import { BATCH } from './WebGLProgramBatch';

const EXT = { COMPLETION_STATUS_KHR: 0x91B1 };
const KINDS = ['Shader', 'Program', 'Buffer', 'Texture', 'Framebuffer', 'VertexArray'];
const PROGRAM_QUERIES = ['getProgramParameter', 'getAttribLocation', 'getUniformLocation', 'useProgram', 'getActiveUniform'];

// A GL that records every call. Enums read as their own names; create* returns a fresh handle tracked in `live` until
// its delete*. Programs report COMPLETION_STATUS_KHR true once st.frame >= st.completeAt, and LINK_STATUS from st.linkOk.
function makeGl({ ext = true } = {}) {
  const calls = [];
  const live = Object.fromEntries(KINDS.map(k => [k, new Set()]));
  const made = Object.fromEntries(KINDS.map(k => [k, []]));
  const st = { frame: 0, completeAt: 1, linkOk: () => true, lost: false };
  const impl = {
    getExtension: name => (ext && name === 'KHR_parallel_shader_compile' ? EXT : null),
    getProgramParameter: (p, pname) => (pname === EXT.COMPLETION_STATUS_KHR ? st.frame >= st.completeAt : st.linkOk(made.Program.indexOf(p))),
    getShaderParameter: () => true,
    getParameter: pname => (pname === 'ALIASED_POINT_SIZE_RANGE' ? [1, 64] : null),
    getAttribLocation: () => 0,
    isContextLost: () => st.lost,
    isProgram: p => live.Program.has(p),
    getAttachedShaders: p => [...(p.attached || [])],
    attachShader: (p, s) => { (p.attached = p.attached || []).push(s); },
    getShaderInfoLog: () => 'synthetic', getProgramInfoLog: () => 'synthetic', getError: () => 0,
  };
  const gl = new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return prop;
      return (...args) => {
        calls.push(prop);
        if (impl[prop]) return impl[prop](...args);
        const c = /^create(Shader|Program|Buffer|Texture|Framebuffer|VertexArray)$/.exec(prop);
        if (c) { const h = { kind: c[1] }; made[c[1]].push(h); live[c[1]].add(h); return h; }
        const d = /^delete(Shader|Program|Buffer|Texture|Framebuffer|VertexArray)$/.exec(prop);
        if (d && args[0]) live[d[1]].delete(args[0]);
        return undefined;
      };
    },
  });
  return { gl, calls, live, made, st };
}
const liveCounts = live => Object.fromEntries(KINDS.map(k => [k, live[k].size]));
const NOTHING_LIVE = Object.fromEntries(KINDS.map(k => [k, 0]));

beforeAll(() => {
  global.WebGLRenderingContext = global.WebGLRenderingContext || class {};
  global.WebGL2RenderingContext = global.WebGL2RenderingContext || class {};
});
beforeEach(() => {
  window.__RAW_GPU__ = {};
  delete window.__MARINE_CHURN__;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  delete window.__RAW_GPU__; delete window.__MARINE_CHURN__;
  delete window.__RAW_DISABLE_ASYNC_SHADER_COMPILE__; delete window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__;
  jest.restoreAllMocks();
});

const ENGINES = [
  // name, Engine, programs, vertex arrays, data field render() needs past its own gates
  ['marine', WebGLMarineEngine, 3, 3, '_waveData'],
  ['wind', WebGLWindEngine, 5, 5, '_windData'],
];
function makeEngine(Engine) {
  const engine = new Engine();
  engine.particleRes = 4;   // the real pools allocate 87,616 particles; the GL is fake, so keep the arrays small
  return engine;
}

describe.each(ENGINES)('%s engine, async batch', (name, Engine, nPrograms, nVaos, dataField) => {
  test('init allocates buffers and textures but asks no program anything and builds no vertex array', () => {
    const { gl, calls, made } = makeGl();
    const engine = makeEngine(Engine);
    engine.init(gl);
    expect(engine._initialized).toBe(true);
    expect(engine._programBatch).toMatchObject({ mode: 'async', state: BATCH.PENDING });
    expect(made.Program).toHaveLength(nPrograms);
    expect(made.Buffer.length).toBeGreaterThan(0);
    expect(made.Texture.length).toBeGreaterThan(0);
    expect(made.Framebuffer).toHaveLength(1);
    expect(calls.filter(c => PROGRAM_QUERIES.includes(c))).toEqual([]);
    expect(made.VertexArray).toHaveLength(0);
  });

  test.each([['kill switch', true, true], ['no extension (Firefox)', false, false]])('mutation control, %s: init stays synchronous (#403): links read and vertex arrays built inside init', (_label, kill, ext) => {
    if (kill) window.__RAW_DISABLE_ASYNC_SHADER_COMPILE__ = true;
    const { gl, calls, made } = makeGl({ ext });
    const engine = makeEngine(Engine);
    engine.init(gl);
    expect(engine._programBatch).toBeFalsy();
    expect(calls.filter(c => c === 'getProgramParameter')).toHaveLength(nPrograms);   // LINK_STATUS, once each
    expect(made.VertexArray).toHaveLength(nVaos);
    expect(window.__RAW_GPU__.shaderBatch[name]).toMatchObject({ mode: 'deferred', state: BATCH.READY, polls: 0 });
    expect(engine.pollPrograms(gl)).toBe(BATCH.READY);
  });

  test('render makes no GL call while the batch compiles', () => {
    const { gl, calls } = makeGl();
    const engine = makeEngine(Engine);
    engine.init(gl);
    engine[dataField] = { waveGrid: {}, windGrid: {} };   // past the data gate: only the batch gate can stop it
    const before = calls.length;
    engine.render(gl, new Float32Array(16), 800, 600, 3, 'dark', [0], [-180, -85, 180, 85], 1);
    expect(calls.slice(before)).toEqual([]);
  });

  test('the poll builds the vertex arrays once, when every program has completed', () => {
    const { gl, calls, made, st } = makeGl();
    st.completeAt = 2;
    const engine = makeEngine(Engine);
    engine.init(gl);
    st.frame = 1;
    expect(engine.pollPrograms(gl)).toBe(BATCH.PENDING);
    expect(made.VertexArray).toHaveLength(0);
    expect(calls).not.toContain('getAttribLocation');
    st.frame = 2;
    expect(engine.pollPrograms(gl)).toBe(BATCH.READY);
    expect(engine._programBatch).toBeNull();
    expect(made.VertexArray).toHaveLength(nVaos);
    expect(window.__RAW_GPU__.shaderBatch[name]).toMatchObject({ mode: 'async', state: BATCH.READY, polls: 2, timedOut: false });
    st.frame = 3;
    expect(engine.pollPrograms(gl)).toBe(BATCH.READY);
    expect(made.VertexArray).toHaveLength(nVaos);
  });

  test('a link failure found by the poll releases everything init allocated, as a failed init leaves the engine', () => {
    const { gl, live, st } = makeGl();
    st.linkOk = k => k !== nPrograms - 1;
    const engine = makeEngine(Engine);
    engine.init(gl);
    expect(liveCounts(live).Buffer).toBeGreaterThan(0);
    st.frame = 1;
    expect(engine.pollPrograms(gl)).toBe(BATCH.FAILED);
    expect(liveCounts(live)).toEqual(NOTHING_LIVE);
    expect(engine._initialized).toBe(false);
    expect([engine.advectProgram, engine.drawProgram, engine.heatmapProgram]).toEqual([null, null, null]);
    expect(engine.pollPrograms(gl)).toBe(BATCH.READY);   // nothing pending: the failure is reported once
    expect(() => engine.init(gl)).not.toThrow();           // a later remount can init again
  });

  test.each(Array.from({ length: nPrograms }, (_, i) => i))('link failure at program %i: the poll releases every handle init created', index => {
    const { gl, live, made, st } = makeGl();
    st.linkOk = k => k !== index;
    const engine = makeEngine(Engine);
    engine.init(gl);
    st.frame = 1;
    expect(engine.pollPrograms(gl)).toBe(BATCH.FAILED);
    expect(made.Shader).toHaveLength(2 * nPrograms);
    expect(liveCounts(live)).toEqual(NOTHING_LIVE);
    expect(engine._initialized).toBe(false);
  });

  test('dispose while compiling deletes the pending programs and drops the batch; a re-init starts a fresh batch', () => {
    const { gl, live, st } = makeGl();
    const engine = makeEngine(Engine);
    engine.init(gl);
    const first = engine._programBatch;
    engine.dispose(gl);
    expect(engine._programBatch).toBeNull();
    expect(live.Program.size).toBe(0);
    engine.init(gl);
    expect(engine._programBatch).not.toBe(first);
    st.frame = 1;
    expect(engine.pollPrograms(gl)).toBe(BATCH.READY);
    expect(first.polls).toBe(0);
  });
});

// ---- the layers: wait without drawing, keep frames coming, and send a late link failure to the init-failure fallback ----
const ref = current => ({ current });
const args = gl => ({ gl, defaultProjectionData: { mainMatrix: new Float32Array(16) } });
function makeMap() {
  return {
    getBounds() { throw new Error('no bounds in a unit test'); },
    getCanvas: () => ({ width: 800, height: 600 }), getZoom: () => 3, getCenter: () => ({ lng: 0, lat: 0 }),
    isZooming: () => false, isMoving: () => false, triggerRepaint: jest.fn(),
  };
}
const LAYERS = [
  ['marine', WebGLMarineEngine, (engine, map, onError) => createMarineLayer(engine, ref(true), ref(map), ref(null), ref(null), ref(onError),
    ref('dark'), ref(null), ref(false), ref(['waves']), ref(0), ref(null), ref('GFS'))],
  ['wind', WebGLWindEngine, (engine, map, onError) => createWindLayer(engine, ref(true), ref(map), ref(null), ref(onError), ref('dark'))],
];

describe.each(LAYERS)('%s layer', (name, Engine, create) => {
  test('while compiling it does not ask the engine to draw, and asks for the next frame', () => {
    const { gl, st } = makeGl();
    st.completeAt = 3;
    const engine = makeEngine(Engine);
    const draw = jest.spyOn(engine, 'render');
    const map = makeMap(), onError = jest.fn();
    const layer = create(engine, map, onError);
    layer.onAdd(null, gl);
    for (st.frame = 1; st.frame < 3; st.frame++) layer.render(args(gl));
    expect(draw).not.toHaveBeenCalled();
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2);
    if (name === 'marine') expect(window.__RAW_GPU__.layer.skip).toBe(SKIP.PROGRAMS_PENDING);
    layer.render(args(gl));                                  // frame 3: complete
    expect(draw).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  test('a link failure found after init reaches the init-failure fallback once, with the engine fully released', () => {
    const { gl, live, st } = makeGl();
    st.completeAt = 2;
    st.linkOk = k => k !== 0;
    const engine = makeEngine(Engine);
    const map = makeMap(), onError = jest.fn();
    const layer = create(engine, map, onError);
    layer.onAdd(null, gl);
    expect(onError).not.toHaveBeenCalled();                 // init returned with the batch still compiling
    st.frame = 1; layer.render(args(gl));
    expect(onError).not.toHaveBeenCalled();
    st.frame = 2; layer.render(args(gl));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(liveCounts(live)).toEqual(NOTHING_LIVE);
    if (name === 'marine') {
      expect(window.__RAW_GPU__.layer.skip).toBe(SKIP.PROGRAMS_FAILED);
      const fallbacks = (window.__MARINE_CHURN__.log || []).filter(e => e.kind === 'marine_webgl_fallback');
      expect(fallbacks.map(e => e.cause)).toEqual(['init_failed']);
    }
    for (st.frame = 3; st.frame < 6; st.frame++) layer.render(args(gl));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('mutation control: the same failing link under the kill switch is caught by init, in onAdd', () => {
    window.__RAW_DISABLE_ASYNC_SHADER_COMPILE__ = true;
    const { gl, live, st } = makeGl();
    st.linkOk = k => k !== 0;
    const engine = makeEngine(Engine);
    const onError = jest.fn();
    create(engine, makeMap(), onError).onAdd(null, gl);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(liveCounts(live)).toEqual(NOTHING_LIVE);
  });
});
