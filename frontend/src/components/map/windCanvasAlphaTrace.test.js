/**
 * The wind leaves the map canvas's alpha alone, BY WHAT THE ENGINE DOES (windCanvasAlpha.js, D-027).
 *
 * windCanvasAlpha.test.js pins the two lines that were changed. A pin of text cannot see a third way of lowering the alpha: a draw
 * with blending off, a later blend call, a clear. So this file runs the REAL engine's render() on a recording GL and checks every
 * draw or clear issued while the MAP'S framebuffer is bound: it keeps the canvas's alpha only with blending on and the alpha's
 * factors (ZERO, ONE), or with the alpha channel masked off. It also checks that the kept-alpha factors never reach a pass into the
 * engine's own buffers and that the engine hands MapLibre back the blend it was given.
 * Written by the independent review of #321 as its instrument (31 mutants: the text pins left 11 alive, this kills them) and adopted.
 */
import WebGLWindEngine from './WebGLWindEngine';

const MAP_FBO = null;   // MapLibre's default framebuffer

function makeGl() {
  const st = { fbo: MAP_FBO, blend: true, f: ['ONE', 'ONE_MINUS_SRC_ALPHA', 'ONE', 'ONE_MINUS_SRC_ALPHA'], mask: [true, true, true, true], prog: null, events: [], calls: [] };
  let id = 0;
  const obj = (kind) => ({ kind, id: ++id });
  const special = {
    canvas: { width: 64, height: 64, clientWidth: 64 },
    drawingBufferWidth: 64, drawingBufferHeight: 64,
    isContextLost: () => false,
    getExtension: () => null,
    getShaderParameter: () => true, getProgramParameter: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    createShader: () => obj('shader'), createProgram: () => obj('program'), createTexture: () => obj('texture'),
    createFramebuffer: () => obj('fbo'), createBuffer: () => obj('buffer'), createVertexArray: () => obj('vao'),
    getUniformLocation: (p, name) => ({ p, name }), getAttribLocation: () => 0, getAttachedShaders: () => [],
    isFramebuffer: () => true, checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE', getError: () => 0,
    getUniform: () => 0,
    bindVertexArray: () => {},
    isEnabled: (cap) => (cap === 'BLEND' ? st.blend : false),
    enable: (cap) => { if (cap === 'BLEND') st.blend = true; st.calls.push(['enable', cap]); },
    disable: (cap) => { if (cap === 'BLEND') st.blend = false; st.calls.push(['disable', cap]); },
    blendFunc: (s, d) => { st.f = [s, d, s, d]; st.calls.push(['blendFunc', s, d]); },
    blendFuncSeparate: (a, b, c, d) => { st.f = [a, b, c, d]; st.calls.push(['blendFuncSeparate', a, b, c, d]); },
    blendEquation: () => {}, blendEquationSeparate: () => {},
    colorMask: (r, g, b, a) => { st.mask = [r, g, b, a]; },
    bindFramebuffer: (t, f) => { st.fbo = f; },
    useProgram: (p) => { st.prog = p; },
    clear: () => { st.events.push({ op: 'clear', fbo: st.fbo, blend: st.blend, f: [...st.f], maskA: st.mask[3] }); },
    drawArrays: () => { st.events.push({ op: 'drawArrays', fbo: st.fbo, blend: st.blend, f: [...st.f], maskA: st.mask[3] }); },
    drawElements: () => { st.events.push({ op: 'drawElements', fbo: st.fbo, blend: st.blend, f: [...st.f], maskA: st.mask[3] }); },
    getParameter: (p) => {
      if (p === 'FRAMEBUFFER_BINDING') return st.fbo;
      if (p === 'VIEWPORT') return [0, 0, 64, 64];
      if (p === 'COLOR_WRITEMASK') return [...st.mask];
      if (p === 'BLEND_SRC_RGB') return st.f[0]; if (p === 'BLEND_DST_RGB') return st.f[1];
      if (p === 'BLEND_SRC_ALPHA') return st.f[2]; if (p === 'BLEND_DST_ALPHA') return st.f[3];
      if (p === 'BLEND_EQUATION_RGB' || p === 'BLEND_EQUATION_ALPHA') return 'FUNC_ADD';
      if (p === 'ACTIVE_TEXTURE') return 'TEXTURE0';
      if (p === 'DEPTH_WRITEMASK') return true;
      if (p === 'MAX_TEXTURE_SIZE') return 4096;
      return null;
    },
  };
  const gl = new Proxy({}, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in special) return special[k];
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return k;   // every GL constant is its own name
      if (k === '__activeTextureUnit' || k === '__boundTextures2D') return undefined;
      return () => undefined;                        // every other call: recorded nowhere, returns nothing
    },
    set() { return true; }, deleteProperty() { return true; },
    has(_t, k) { return k in special || k === 'bindVertexArray' || k === 'createVertexArray'; },
  });
  return { gl, st };
}

const vectorsFor = (cols, rows, speed) => Array.from({ length: cols * rows }, (_, i) => ({ u: speed * Math.cos(i), v: speed * Math.sin(i), speed }));
const GLOBAL = { bounds: { west: -180, south: -80, east: 180, north: 85 }, coverage_scope: 'global_coarse', source: 'GFS', hourOffset: 0, valid_time: '2026-07-19T12:00:00Z', cols: 37, rows: 17 };
const FINE = { bounds: { west: -90, south: 22, east: -82, north: 30 }, coverage_scope: 'viewport', source: 'GFS', hourOffset: 0, valid_time: '2026-07-19T12:00:00Z', cols: 25, rows: 29 };
const grid = (b, speed) => ({ ...b, vectors: vectorsFor(b.cols, b.rows, speed) });

const clearLevers = () => Object.keys(window).filter((k) => k.startsWith('__RAW_') || k.startsWith('__GPU_DEBUG') || k.startsWith('__WIND_')).forEach((k) => { delete window[k]; });

/** Run the real engine for a few frames; return what each draw/clear on the MAP's framebuffer could do to the canvas's alpha. */
function trace(theme, levers, { fine = true, zooms = [3, 6, 8, 8, 5] } = {}) {
  clearLevers(); Object.assign(window, levers);
  const { gl, st } = makeGl();
  const e = new WebGLWindEngine();
  e.particleRes = 4;
  e.init(gl);
  expect(e._initialized).toBe(true);
  e.setWindData(gl, grid(GLOBAL, 20));
  if (fine) e.setWindData(gl, grid(FINE, 30));
  const m = new Float32Array([2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]);
  st.events.length = 0; st.calls.length = 0;
  const leftover = [];
  for (const z of zooms) {
    // MapLibre's state before a custom layer: blend on, ONE / ONE_MINUS_SRC_ALPHA, the default framebuffer
    st.fbo = MAP_FBO; st.blend = true; st.f = ['ONE', 'ONE_MINUS_SRC_ALPHA', 'ONE', 'ONE_MINUS_SRC_ALPHA']; st.mask = [true, true, true, true];
    e.render(gl, m, 64, 64, z, theme, null, [-100, 15, -70, 40]);
    leftover.push({ fbo: st.fbo, blend: st.blend, f: st.f.join(','), maskA: st.mask[3] });
  }
  const onMap = st.events.filter((ev) => ev.fbo === MAP_FBO);
  const lowers = onMap.filter((ev) => ev.op === 'clear' ? ev.maskA : (ev.maskA && !(ev.blend && ev.f[2] === 'ZERO' && ev.f[3] === 'ONE')));
  clearLevers();
  // the engine's OWN buffers: a blended draw there must carry a blend set for it (ONE / ONE_MINUS_SRC_ALPHA on all four), never the map's kept-alpha factors
  const offMap = st.events.filter((ev) => ev.fbo !== MAP_FBO && ev.op !== 'clear');
  const leaked = offMap.filter((ev) => ev.blend && ev.f.join('/') !== 'ONE/ONE_MINUS_SRC_ALPHA/ONE/ONE_MINUS_SRC_ALPHA');
  return { onMap, lowers, leftover, leaked, offKinds: [...new Set(offMap.map((ev) => `${ev.op}:${ev.blend ? ev.f.join('/') : 'NOBLEND'}`))], all: st.events.length, kinds: [...new Set(onMap.map((ev) => `${ev.op}:${ev.blend ? ev.f.join('/') : 'NOBLEND'}`))] };
}

const THEMES = ['dark', 'light', 'beach'];
const LEVERS = {
  'default': {},
  'field tint killed': { __RAW_DISABLE_WIND_FIELD_TINT__: true },
  'dark rules killed': { __RAW_DISABLE_WIND_DARK_RULES__: true },
  'white streak killed': { __RAW_DISABLE_WIND_WHITE_STREAK__: true },
  'dark white killed': { __RAW_DISABLE_WIND_DARK_WHITE__: true },
  'dark rules + speed premul killed': { __RAW_DISABLE_WIND_DARK_RULES__: true, __RAW_DISABLE_WIND_SPEED_PREMUL__: true },
  'ink lever': { __RAW_WIND_INK__: true },
  'glow lever': { __RAW_WIND_GLOW__: true },
  'light look deep': { __RAW_WIND_LIGHT_LOOK__: 'deep' },
  'light look moderate': { __RAW_WIND_LIGHT_LOOK__: 'moderate' },
  'light look ink': { __RAW_WIND_LIGHT_LOOK__: 'ink' },
  'v2 theme': { __RAW_WIND_THEME_V2__: true },
  'v2 motion': { __RAW_WIND_MOTION_V2__: true },
  'legacy two-pass field': { __RAW_DISABLE_WIND_HEATMAP_SINGLEPASS__: true },
  'debug uv': { __GPU_DEBUG__: { mode: 'uv' } },
  'debug vortex': { __GPU_DEBUG__: { mode: 'vortex' } },
  'debug part_fbo': { __GPU_DEBUG__: { mode: 'part_fbo' } },
  'trail anchor killed': { __RAW_DISABLE_WIND_TRAIL_ANCHOR__: true },
  'field tint on every theme': { __RAW_WIND_FIELD_TINT_THEMES__: 'dark,light,beach' },
  'premul on every theme': { __RAW_WIND_PREMUL_THEMES__: 'dark,light,beach', __RAW_DISABLE_WIND_DARK_RULES__: true },
};

describe('every draw into the map keeps the canvas alpha, on every path a lever can reach', () => {
  beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { jest.restoreAllMocks(); });

  const table = [];
  for (const [name, levers] of Object.entries(LEVERS)) for (const theme of THEMES) for (const fine of [true, false]) table.push([name, theme, fine, levers]);

  it.each(table)('%s, %s, fine grid %s', (name, theme, fine, levers) => {
    const r = trace(theme, levers, { fine });
    expect(r.onMap.length).toBeGreaterThanOrEqual(2 * 5);          // the instrument saw the field and the composite on each of 5 frames
    expect(r.lowers).toEqual([]);
    expect(r.leaked).toEqual([]);                                  // the kept-alpha factors never reach a pass into the engine's own buffers
    expect(r.offKinds.length).toBeGreaterThan(0);
    // and the engine hands MapLibre back the blend it was given
    for (const l of r.leftover) expect(l).toEqual({ fbo: MAP_FBO, blend: true, f: 'ONE,ONE_MINUS_SRC_ALPHA,ONE,ONE_MINUS_SRC_ALPHA', maskA: true });
  });

  it('positive control: under the kill, the same instrument reports the passes that lower the alpha, in every theme', () => {
    for (const theme of THEMES) {
      const r = trace(theme, { __RAW_DISABLE_WIND_OPAQUE_CANVAS__: true });
      expect(r.lowers.length).toBeGreaterThan(0);
      expect(r.leaked).toEqual([]);
    }
  });

  it('the instrument saw both passes in every default theme: the field and the composite, five frames each', () => {
    for (const theme of THEMES) {
      const r = trace(theme, {});
      expect(r.onMap.filter((ev) => ev.op === 'drawElements' || ev.op === 'drawArrays').length).toBeGreaterThanOrEqual(10);
      expect(r.kinds.length).toBeGreaterThanOrEqual(1);
      for (const k of r.kinds) expect(k).toMatch(/:(DST_COLOR|SRC_ALPHA|ONE)\/[A-Z_]+\/ZERO\/ONE$/);   // every kind of draw into the map: blended, the alpha kept
    }
  });
});
