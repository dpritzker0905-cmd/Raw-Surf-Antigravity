/**
 * The marine layer says WHY it did not draw (2026-09-26, the desktop-Safari continuity gap).
 *
 * `__RAW_GPU__.opacity.n` only advances on a real heatmap draw, so the continuity gate could see a
 * stall but not its cause. Every render() call now stamps `__RAW_GPU__.layer` ({n, t, skip}); these
 * tests drive the real layer through the exits reachable without a full map, and pin in source that
 * no exit can be added to render() without naming itself.
 */
import fs from 'fs';
import path from 'path';
import { createCustomLayer } from './WebGLMarineCustomLayer';
import { SKIP, stampLayerCall, stampSkip } from './marineLayerStamp';

const ref = (current) => ({ current });

function makeLayer({ active = true, map = null } = {}) {
  const engine = { clearBuffers: jest.fn(), render: jest.fn() };
  const layer = createCustomLayer(engine, ref(active), ref(map), ref(null), ref(null), ref(null),
    ref('dark'), ref(null), ref(false), ref(['waves']), ref(0), ref(null), ref('GFS'));
  return { layer, engine };
}

const call = (layer) => layer.render({ gl: {}, defaultProjectionData: { mainMatrix: new Float32Array(16) } });

beforeAll(() => {
  global.WebGLRenderingContext = global.WebGLRenderingContext || class {};
  global.WebGL2RenderingContext = global.WebGL2RenderingContext || class {};
});

beforeEach(() => {
  window.__RAW_GPU__ = {};
  delete window.__MARINE_TRANSITIONING__;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.__MARINE_FETCH_DEBOUNCING__;
  window.__RAW_MARINE_XFAM_HOLD_DISABLED__ = true;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  delete window.__RAW_GPU__;
  delete window.__RAW_MARINE_XFAM_HOLD_DISABLED__;
  jest.restoreAllMocks();
});

describe('marineLayerStamp', () => {
  it('advances n on every call and starts each call as a draw', () => {
    const a = stampLayerCall(window);
    stampSkip(a, SKIP.NO_MAP);
    const b = stampLayerCall(window);
    expect([a.n, b.n, b.skip, window.__RAW_GPU__.layer]).toEqual([1, 2, null, b]);
  });

  it('is inert when the GPU telemetry object is absent', () => {
    delete window.__RAW_GPU__;
    const s = stampLayerCall(window);
    expect(s).toBeNull();
    expect(() => stampSkip(s, SKIP.NO_MAP)).not.toThrow();
  });
});

describe('the layer names the exit it took instead of drawing', () => {
  it('inactive: a real deactivation', () => {
    const { layer } = makeLayer({ active: false });
    call(layer);
    expect(window.__RAW_GPU__.layer).toMatchObject({ n: 1, skip: SKIP.INACTIVE });
  });

  it('inactive_held: active blinked false during a switch and the textures are held', () => {
    const { layer, engine } = makeLayer({ active: false });
    layer._wasActive = true;
    window.__MARINE_TRANSITIONING__ = true;
    call(layer);
    expect(window.__RAW_GPU__.layer.skip).toBe(SKIP.INACTIVE_HELD);
    expect(engine.clearBuffers).not.toHaveBeenCalled();
  });

  it('inactive after being active, with no hold: the clear runs and the stamp says inactive', () => {
    const { layer, engine } = makeLayer({ active: false });
    layer._wasActive = true;
    call(layer);
    expect(engine.clearBuffers).toHaveBeenCalled();
    expect(window.__RAW_GPU__.layer.skip).toBe(SKIP.INACTIVE);
  });

  it('no_map: active but the map ref is empty', () => {
    const { layer, engine } = makeLayer({ active: true, map: null });
    call(layer);
    call(layer);
    expect(window.__RAW_GPU__.layer).toMatchObject({ n: 2, skip: SKIP.NO_MAP });
    expect(engine.render).not.toHaveBeenCalled();
  });
});

describe('no exit can be added to render() without naming itself', () => {
  const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineCustomLayer.js'), 'utf8');
  const start = src.indexOf('    render(glOrArgs, matrixArg) {');
  const end = src.indexOf('    onRemove(', start);
  const body = src.slice(start, end);

  it('every return in render() is stamped with a skip reason first', () => {
    const lines = body.split(/\r?\n/);
    const returns = lines.map((l, i) => [l, i]).filter(([l]) => /\breturn\b/.test(l) && !/^\s*\/\//.test(l));
    expect(returns.length).toBeGreaterThanOrEqual(4);
    for (const [line, i] of returns) {
      const context = `${lines[i - 1] || ''}\n${line}`;
      expect(context).toMatch(/stampSkip\(_stamp, /);
    }
  });

  it('the engine-has-no-data case is stamped where the engine is asked to draw', () => {
    expect(body).toMatch(/stampSkip\(_stamp, SKIP\.ENGINE_NO_DATA\);\s*\r?\n\s*engine\.render\(/);
  });
});
