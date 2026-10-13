import { renderHook } from '@testing-library/react';
import { useWebGLGuardrail } from './useWebGLGuardrail';
import { WeatherTelemetry } from './WeatherTelemetry';

let clock, observers, originalObserver;
class Observer {
  static supportedEntryTypes = ['longtask', 'long-animation-frame'];
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe = jest.fn();
  disconnect = jest.fn();
  takeRecords = jest.fn(() => []);
  send(entries) { this.callback({ getEntries: () => entries }); }
}
function mount() {
  let callback;
  const map = { on: (_event, fn) => { callback = fn; }, off: jest.fn(), isMoving: () => false };
  const setMarine = jest.fn();
  const mounted = renderHook(() => useWebGLGuardrail({ mapInstance: map, activeLayers: ['waves'],
    setWebglMarineFailed: setMarine, webglMarineFailed: false }));
  return { ...mounted, setMarine, drive(count, fps = 1) {
    for (let i = 0; i < count; i++) {
      clock += 1000 / fps;
      window.__RAW_GPU__.layer = { n: (window.__RAW_GPU__.layer?.n || 0) + 1, t: Date.now(), skip: null };
      callback();
    }
  } };
}
const evidence = () => WeatherTelemetry.emit.mock.calls.find(([type]) => type === 'webgl_marine_fallback_evidence')?.[1];
beforeEach(() => {
  clock = 0; observers = []; originalObserver = window.PerformanceObserver;
  window.PerformanceObserver = Observer;
  jest.useFakeTimers();
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  window.__MARINE_ENGINE__ = { _initialized: true, _waveData: {} }; window.__RAW_GPU__ = {};
  jest.spyOn(WeatherTelemetry, 'emit').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  window.PerformanceObserver = originalObserver;
  ['__MARINE_ENGINE__', '__RAW_GPU__', '__MARINE_FETCH_PENDING__', '__RAW_DISABLE_MAIN_THREAD_TIMING__'].forEach(k => delete window[k]);
  jest.useRealTimers(); jest.restoreAllMocks();
});
test('pairs the trip interval with delivered main-thread work outside the native draw', () => {
  const s = mount(); s.drive(10); // grace ends, first low window ends at 10s
  expect(observers).toHaveLength(1);
  observers[0].send([{ entryType: 'longtask', startTime: 10500, duration: 800 }]);
  observers[0].takeRecords.mockReturnValue([{ entryType: 'long-animation-frame', startTime: 20000, duration: 600, blockingDuration: 550 }]);
  s.drive(11);
  expect(evidence()).toMatchObject({ observedIntervalMs: 11000, mainThreadTiming: {
    longTasks: { count: 1, totalDurationMs: 800 },
    longAnimationFrames: { count: 1, totalBlockingDurationMs: 550 },
  } });
  expect(s.setMarine).toHaveBeenCalledWith(true);
  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
});
test('loading discards old tasks and starts a fresh observer for the next streak', () => {
  const s = mount(); s.drive(15);
  expect(observers).toHaveLength(1);
  observers[0].send([{ entryType: 'longtask', startTime: 11000, duration: 1000 }]);
  window.__MARINE_FETCH_PENDING__ = true; s.drive(1);
  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  delete window.__MARINE_FETCH_PENDING__; s.drive(12);
  expect(observers).toHaveLength(2);
  expect(evidence().mainThreadTiming.longTasks.count).toBe(0);
});
test.each(['focus', 'healthy', 'unmount'])('%s releases the observer before late delivery', reason => {
  const s = mount(); s.drive(10);
  expect(observers).toHaveLength(1);
  if (reason === 'focus') window.dispatchEvent(new Event('blur'));
  if (reason === 'healthy') s.drive(30, 30);
  if (reason === 'unmount') s.unmount();
  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  observers[0].send([{ entryType: 'longtask', startTime: 10500, duration: 1000 }]);
  expect(s.setMarine).not.toHaveBeenCalled();
});
test.each(['unsupported', 'throws', 'disabled'])('%s timing cannot block a real fallback', mode => {
  if (mode === 'unsupported') window.PerformanceObserver = undefined;
  if (mode === 'throws') window.PerformanceObserver = class extends Observer {
    constructor(callback) { super(callback); this.observe = () => { throw new Error('unavailable'); }; }
  };
  if (mode === 'disabled') window.__RAW_DISABLE_MAIN_THREAD_TIMING__ = true;
  const s = mount(); s.drive(21);
  expect(s.setMarine).toHaveBeenCalledWith(true);
  expect(evidence().mainThreadTiming?.longTasks ?? null).toBeNull();
});
