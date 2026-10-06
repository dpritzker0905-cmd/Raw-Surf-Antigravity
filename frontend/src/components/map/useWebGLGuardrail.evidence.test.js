import { act, renderHook } from '@testing-library/react';
import { useWebGLGuardrail, RECOVERY_BACKOFFS_MS } from './useWebGLGuardrail';

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
});
afterEach(() => {
  ['__MARINE_ENGINE__', '__RAW_GPU__', '__MARINE_FETCH_PENDING__', '__MARINE_FETCH_DEBOUNCING__', '__FORCE_MARINE_FALLBACK__'].forEach(k => delete window[k]);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('sustained slow actual marine animation still trips the protection', () => {
  const s = setup(); s.drive(30);
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
