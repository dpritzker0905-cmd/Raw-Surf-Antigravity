import { act, renderHook } from '@testing-library/react';
import { useWebGLGuardrail, RECOVERY_BACKOFFS_MS } from './useWebGLGuardrail';
import { createCustomLayer } from './WebGLMarineCustomLayer';
import WebGLMarineEngine from './WebGLMarineEngine';
import { WeatherTelemetry } from './WeatherTelemetry';

let clock;
function setup() {
  let render;
  const map = { on: jest.fn((event, fn) => { if (event === 'render') render = fn; }), off: jest.fn(), isMoving: () => false, isZooming: () => false };
  const setMarine = jest.fn();
  const props = { mapInstance: map, activeLayers: ['waves'], setWebglWindFailed: jest.fn(), setWebglMarineFailed: setMarine,
    webglWindFailed: false, webglMarineFailed: false };
  const mounted = renderHook(p => useWebGLGuardrail(p), { initialProps: props });
  const drive = (seconds, fresh = true, fps = 1, skip = null) => {
    for (let i = 0; i < Math.ceil(seconds * fps); i++) {
      clock += 1000 / fps;
      if (fresh) window.__RAW_GPU__.layer = { n: (window.__RAW_GPU__.layer?.n || 0) + 1, skip, t: Date.now() };
      render();
    }
  };
  return { ...mounted, drive, setMarine, props };
}

function nativeNoDrawLayer() {
  // Use the real engine's early-return path. Any GL access would fail this fixture;
  // this is evidence of no draw, not a mocked render pretending to do GPU work.
  const engine = Object.create(WebGLMarineEngine.prototype);
  engine._initialized = true;
  engine._waveData = { waveGrid: {} };
  window.__MARINE_ENGINE__ = engine;
  const map = { getCanvas: () => ({ width: 256, height: 128 }), getZoom: () => 9,
    getBounds: () => ({ getWest: () => -90, getEast: () => -80, getSouth: () => 20, getNorth: () => 30 }),
    triggerRepaint: jest.fn() };
  const ref = current => ({ current });
  const layer = createCustomLayer(engine, ref(true), ref(map), ref(null), ref(null), ref(null),
    ref('dark'), ref(null), ref(false), ref(['waves']), ref(0), ref(null), ref('GFS'));
  const gl = new WebGL2RenderingContext();
  const access = jest.fn(() => { throw new Error('A no-matrix frame must not access GL'); });
  const guardedGL = new Proxy(gl, { get: access });
  return { engine, map, layer, guardedGL, access };
}
beforeEach(() => {
  jest.useFakeTimers();
  clock = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  window.__MARINE_ENGINE__ = { _initialized: true, _waveData: { waveGrid: {} } };
  window.__RAW_GPU__ = {};
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  global.WebGLRenderingContext = global.WebGLRenderingContext || class {};
  global.WebGL2RenderingContext = global.WebGL2RenderingContext || class {};
});

test.each([
  ['MapLibre object, absent', undefined, false],
  ['MapLibre object, empty', new Float32Array(0), false],
  ['native context, absent', undefined, true],
  ['native context, empty', new Float32Array(0), true],
])('%s projection never turns a no-draw callback into a GPU fallback', (_name, matrix, native) => {
  const s = setup();
  const { layer, guardedGL, access, map } = nativeNoDrawLayer();
  for (let i = 0; i < 40; i++) {
    if (native) layer.render(guardedGL, matrix);
    else layer.render({ gl: guardedGL, defaultProjectionData: { mainMatrix: matrix } });
    s.drive(1, false);
  }
  expect(access).not.toHaveBeenCalled();
  expect(map.triggerRepaint).toHaveBeenCalledTimes(40);
  expect(s.setMarine).not.toHaveBeenCalled();
  expect(window.__RAW_GPU__.layer).toMatchObject({ n: 40, skip: 'engine_no_matrix' });
});

test('no-matrix callbacks break consecutive low-FPS evidence; later slow drawing still trips', () => {
  const s = setup();
  s.drive(19);
  const { layer, guardedGL } = nativeNoDrawLayer();
  for (let i = 0; i < 10; i++) {
    layer.render({ gl: guardedGL });
    s.drive(1, false);
  }
  s.drive(11);
  expect(s.setMarine).not.toHaveBeenCalled();
  s.drive(2);
  expect(s.setMarine).toHaveBeenCalledWith(true);
});

test('a valid next projection is forwarded and clears the no-matrix stamp without remounting', () => {
  const { layer, engine, map, guardedGL } = nativeNoDrawLayer();
  layer.render({ gl: guardedGL });
  expect(window.__RAW_GPU__.layer.skip).toBe('engine_no_matrix');
  // This control checks forwarding only; native GPU performance is not measured here.
  const render = jest.spyOn(engine, 'render').mockImplementation(() => {});
  const matrix = new Float32Array(16);
  layer.render({ gl: guardedGL, defaultProjectionData: { mainMatrix: matrix } });
  expect(render).toHaveBeenCalledTimes(1);
  expect(render.mock.calls[0][0]).toBe(guardedGL);
  expect(render.mock.calls[0].slice(1)).toEqual([matrix, 256, 128, 9, 'dark', [-90, 20, -80, 30], 1]);
  expect(window.__RAW_GPU__.layer).toMatchObject({ n: 2, skip: null });
  expect(map.triggerRepaint).toHaveBeenCalledTimes(2);
});
afterEach(() => {
  ['__MARINE_ENGINE__', '__RAW_GPU__', '__MARINE_FETCH_PENDING__', '__MARINE_FETCH_DEBOUNCING__', '__FORCE_MARINE_FALLBACK__',
    '__RAW_DISABLE_GUARDRAIL_FETCH_STAMP__'].forEach(k => delete window[k]);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('sustained slow actual marine animation still trips the protection', () => {
  const s = setup(); s.drive(30);
  expect(s.setMarine).toHaveBeenCalledWith(true);
});

test('a telemetry exception cannot suppress a genuine sustained rendering fallback', () => {
  jest.spyOn(WeatherTelemetry, 'emit').mockImplementation(() => { throw new Error('diagnostic sink unavailable'); });
  const s = setup();
  expect(() => s.drive(30)).not.toThrow();
  expect(s.setMarine).toHaveBeenCalledWith(true);
});

test('a trip publishes bounded native timing evidence before the resident is unmounted', () => {
  const emit = jest.spyOn(WeatherTelemetry, 'emit').mockImplementation(() => {});
  window.__RAW_GPU__.frameTimeHistogram = [100, 2, 1, 0, 0];
  window.__RAW_GPU__.textureUploadCount = 19;
  window.__RAW_GPU__.droppedFrameCounter = 1;
  const s = setup();
  s.drive(22);
  const calls = emit.mock.calls.filter(([type]) => type === 'webgl_marine_fallback_evidence');
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toMatchObject({ version: 1, lowFpsWindows: 12,
    observedIntervalMs: 11000, fps: { first: 1, last: 1, min: 1, max: 1 },
    deltas: { nativeCallbacks: 11, textureUploads: 0, slowCpuCalls: 0, cpuCallHistogram: [0, 0, 0, 0, 0] },
    timingKind: 'cpu_call_duration_including_driver_wait', gpuCompletionMeasured: false });
  expect(s.setMarine).toHaveBeenCalledWith(true);
});

test('a loading gap discards the old receipt as well as the consecutive low-FPS count', () => {
  const emit = jest.spyOn(WeatherTelemetry, 'emit').mockImplementation(() => {});
  window.__RAW_GPU__.textureUploadCount = 1;
  const s = setup(); s.drive(19);
  window.__MARINE_FETCH_PENDING__ = true; s.drive(4);
  window.__RAW_GPU__.textureUploadCount = 100;
  delete window.__MARINE_FETCH_PENDING__;
  s.drive(12);
  const calls = emit.mock.calls.filter(([type]) => type === 'webgl_marine_fallback_evidence');
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toMatchObject({ lowFpsWindows: 12, observedIntervalMs: 11000,
    deltas: { nativeCallbacks: 11, textureUploads: 0 } });
});

test('an inaccessible native diagnostic still permits the sustained fallback', () => {
  const s = setup();
  Object.defineProperty(window.__RAW_GPU__, 'frameTimeHistogram', { get: () => { throw new Error('diagnostic unavailable'); } });
  expect(() => s.drive(30)).not.toThrow();
  expect(s.setMarine).toHaveBeenCalledWith(true);
});
test.each(['inactive', 'engine_no_data', 'zoomed_out_idle', 'no_map'])('%s frames do not count as slow animated marine rendering', skip => {
  const s = setup(); s.drive(40, true, 1, skip);
  expect(s.setMarine).not.toHaveBeenCalled();
});
test('idle map events with an unchanged native frame do not trip', () => {
  const s = setup(); s.drive(1); s.drive(40, false);
  expect(s.setMarine).not.toHaveBeenCalled();
});
test('missing/disposed engine is not GPU performance evidence', () => {
  delete window.__MARINE_ENGINE__;
  const s = setup(); s.drive(40);
  expect(s.setMarine).not.toHaveBeenCalled();
});
test.each(['__MARINE_FETCH_PENDING__', '__MARINE_FETCH_DEBOUNCING__'])('%s excludes loading windows', flag => {
  window[flag] = true;
  const s = setup(); s.drive(40, true, 15);
  expect(s.setMarine).not.toHaveBeenCalled();
});
test('loading breaks consecutive low-FPS evidence instead of adding to it', () => {
  const s = setup(); s.drive(19);
  window.__MARINE_FETCH_PENDING__ = true; s.drive(10);
  delete window.__MARINE_FETCH_PENDING__; s.drive(11);
  expect(s.setMarine).not.toHaveBeenCalled();
  s.drive(2);
  expect(s.setMarine).toHaveBeenCalledWith(true);
});
test('the producer pending object excludes loading and resets the consecutive evidence window', () => {
  const s = setup(); s.drive(19);
  window.__MARINE_FETCH_PENDING__ = { model: 'GFS', layer: 'waves', hour: 0, timestamp: new Date().toISOString() };
  s.drive(30);
  expect(s.setMarine).not.toHaveBeenCalled();
  window.__MARINE_FETCH_PENDING__ = null;
  s.drive(11);
  expect(s.setMarine).not.toHaveBeenCalled();
  s.drive(2);
  expect(s.setMarine).toHaveBeenCalledWith(true);
});
test('the pending-stamp kill switch restores the old comparison for a positive control', () => {
  window.__RAW_DISABLE_GUARDRAIL_FETCH_STAMP__ = true;
  window.__MARINE_FETCH_PENDING__ = { model: 'GFS', layer: 'waves', hour: 0, timestamp: new Date().toISOString() };
  const s = setup(); s.drive(40);
  expect(s.setMarine).toHaveBeenCalledWith(true);
});
test('healthy actual animation is not a fallback', () => {
  const s = setup(); s.drive(40, true, 25);
  expect(s.setMarine).not.toHaveBeenCalled();
});
test('a completed owned retry cannot undo a later fallback from a different writer', () => {
  const s = setup(); s.drive(30);
  s.rerender({ ...s.props, webglMarineFailed: true });
  clock += RECOVERY_BACKOFFS_MS[0];
  act(() => jest.advanceTimersByTime(5000));
  expect(s.setMarine).toHaveBeenLastCalledWith(false);
  s.rerender(s.props);
  s.drive(15, true, 25);
  s.setMarine.mockClear();
  s.rerender({ ...s.props, webglMarineFailed: true });
  clock += RECOVERY_BACKOFFS_MS[1];
  act(() => jest.advanceTimersByTime(5000));
  expect(s.setMarine).not.toHaveBeenCalled();
});
