/**
 * useWebGLGuardrail.test.js
 * Unit tests for map render loop frame rate guardrail hook.
 */
import { renderHook } from '@testing-library/react';
import { useWebGLGuardrail } from '../components/map/useWebGLGuardrail';
import { WeatherTelemetry } from '../components/map/WeatherTelemetry';

jest.mock('../components/map/WeatherTelemetry', () => ({
  WeatherTelemetry: {
    emit: jest.fn(),
  },
}));

describe('useWebGLGuardrail', () => {
  let mapInstance;
  let eventListeners;
  let docEventListeners;
  let originalHidden;
  let mockPerformanceNow;
  let currentTime;

  beforeEach(() => {
    jest.clearAllMocks();
    eventListeners = {};
    docEventListeners = {};
    currentTime = 1000;

    mapInstance = {
      on: jest.fn((event, cb) => {
        eventListeners[event] = cb;
      }),
      off: jest.fn((event, cb) => {
        if (eventListeners[event] === cb) {
          delete eventListeners[event];
        }
      }),
    };

    mockPerformanceNow = jest.spyOn(performance, 'now').mockImplementation(() => currentTime);

    // Mock document event listener
    jest.spyOn(document, 'addEventListener').mockImplementation((event, cb) => {
      docEventListeners[event] = cb;
    });
    jest.spyOn(document, 'removeEventListener').mockImplementation((event, cb) => {
      if (docEventListeners[event] === cb) {
        delete docEventListeners[event];
      }
    });

    // Mock document.hidden getter
    originalHidden = document.hidden;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
  });

  afterEach(() => {
    mockPerformanceNow.mockRestore();
    jest.restoreAllMocks();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: originalHidden,
    });
  });

  it('registers render listener on mapInstance and visibilitychange on document', () => {
    const setWebglWindFailed = jest.fn();
    const setWebglMarineFailed = jest.fn();

    renderHook(() =>
      useWebGLGuardrail({
        mapInstance,
        activeLayers: ['wind'],
        setWebglWindFailed,
        setWebglMarineFailed,
        webglWindFailed: false,
        webglMarineFailed: false,
      })
    );

    expect(mapInstance.on).toHaveBeenCalledWith('render', expect.any(Function));
    expect(document.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('removes listeners on unmount', () => {
    const setWebglWindFailed = jest.fn();
    const setWebglMarineFailed = jest.fn();

    const { unmount } = renderHook(() =>
      useWebGLGuardrail({
        mapInstance,
        activeLayers: ['wind'],
        setWebglWindFailed,
        setWebglMarineFailed,
        webglWindFailed: false,
        webglMarineFailed: false,
      })
    );

    const onRender = mapInstance.on.mock.calls[0][1];
    const handleVisibilityChange = document.addEventListener.mock.calls[0][1];

    unmount();

    expect(mapInstance.off).toHaveBeenCalledWith('render', onRender);
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', handleVisibilityChange);
  });

  it('does not trigger fallback under normal frame rates', () => {
    const setWebglWindFailed = jest.fn();
    const setWebglMarineFailed = jest.fn();

    renderHook(() =>
      useWebGLGuardrail({
        mapInstance,
        activeLayers: ['wind'],
        setWebglWindFailed,
        setWebglMarineFailed,
        webglWindFailed: false,
        webglMarineFailed: false,
      })
    );

    const onRender = eventListeners['render'];
    expect(onRender).toBeDefined();

    // Simulate 60 FPS (approx 16.6ms per frame) for 3 seconds
    // Each second has ~60 frames
    for (let sec = 0; sec < 3; sec++) {
      for (let f = 0; f < 60; f++) {
        currentTime += 16.6;
        onRender();
      }
    }

    expect(setWebglWindFailed).not.toHaveBeenCalled();
    expect(setWebglMarineFailed).not.toHaveBeenCalled();
  });

  it('triggers wind fallback when wind layer FPS is consistently low (< 30) for 3 seconds', () => {
    const setWebglWindFailed = jest.fn();
    const setWebglMarineFailed = jest.fn();

    renderHook(() =>
      useWebGLGuardrail({
        mapInstance,
        activeLayers: ['wind'],
        setWebglWindFailed,
        setWebglMarineFailed,
        webglWindFailed: false,
        webglMarineFailed: false,
      })
    );

    const onRender = eventListeners['render'];

    // Simulate 15 FPS (approx 66.7ms per frame) for 3 seconds
    // Each second has 15 frames
    for (let sec = 0; sec < 3; sec++) {
      // 15 frames per second
      for (let f = 0; f < 15; f++) {
        currentTime += 66.7;
        onRender();
      }
    }

    expect(setWebglWindFailed).toHaveBeenCalledWith(true);
    expect(setWebglMarineFailed).not.toHaveBeenCalled();
    expect(WeatherTelemetry.emit).toHaveBeenCalledWith('FPS_drop_detected', expect.any(Object));
  });

  it('triggers marine fallback when waves layer FPS is consistently low (< 30) for 3 seconds', () => {
    const setWebglWindFailed = jest.fn();
    const setWebglMarineFailed = jest.fn();

    renderHook(() =>
      useWebGLGuardrail({
        mapInstance,
        activeLayers: ['waves'],
        setWebglWindFailed,
        setWebglMarineFailed,
        webglWindFailed: false,
        webglMarineFailed: false,
      })
    );

    const onRender = eventListeners['render'];

    // Simulate 15 FPS (approx 66.7ms per frame) for 3 seconds
    for (let sec = 0; sec < 3; sec++) {
      for (let f = 0; f < 15; f++) {
        currentTime += 66.7;
        onRender();
      }
    }

    expect(setWebglMarineFailed).toHaveBeenCalledWith(true);
    expect(setWebglWindFailed).not.toHaveBeenCalled();
  });

  it('does not trigger fallback if delta is >= 2000ms (delta-time gate)', () => {
    const setWebglWindFailed = jest.fn();
    const setWebglMarineFailed = jest.fn();

    renderHook(() =>
      useWebGLGuardrail({
        mapInstance,
        activeLayers: ['wind'],
        setWebglWindFailed,
        setWebglMarineFailed,
        webglWindFailed: false,
        webglMarineFailed: false,
      })
    );

    const onRender = eventListeners['render'];

    // Simulate 1 frame every 3 seconds (3000ms delta)
    // Even though it is technically < 30 FPS, the delta-time gate of 2000ms
    // should reset the tracking to avoid false performance drop detection
    for (let i = 0; i < 5; i++) {
      currentTime += 3000;
      onRender();
    }

    expect(setWebglWindFailed).not.toHaveBeenCalled();
    expect(setWebglMarineFailed).not.toHaveBeenCalled();
  });

  it('detects low frame rates when delta is < 2000ms but FPS is low (e.g. 1 FPS, delta = 1000ms)', () => {
    const setWebglWindFailed = jest.fn();
    const setWebglMarineFailed = jest.fn();

    renderHook(() =>
      useWebGLGuardrail({
        mapInstance,
        activeLayers: ['wind'],
        setWebglWindFailed,
        setWebglMarineFailed,
        webglWindFailed: false,
        webglMarineFailed: false,
      })
    );

    const onRender = eventListeners['render'];

    // Simulate 1 FPS (1000ms delta) for 3 seconds
    // Since 1000ms < 2000ms, it is not filtered by the delta-time gate.
    for (let sec = 0; sec < 3; sec++) {
      currentTime += 1000;
      onRender();
    }

    expect(setWebglWindFailed).toHaveBeenCalledWith(true);
  });

  it('resets tracking counters on tab visibility change to avoid false drops', () => {
    const setWebglWindFailed = jest.fn();
    const setWebglMarineFailed = jest.fn();

    renderHook(() =>
      useWebGLGuardrail({
        mapInstance,
        activeLayers: ['wind'],
        setWebglWindFailed,
        setWebglMarineFailed,
        webglWindFailed: false,
        webglMarineFailed: false,
      })
    );

    const onRender = eventListeners['render'];
    const handleVisibilityChange = docEventListeners['visibilitychange'];

    // 2 seconds of low FPS
    for (let sec = 0; sec < 2; sec++) {
      for (let f = 0; f < 15; f++) {
        currentTime += 66.7;
        onRender();
      }
    }

    // Now user hides/restores the tab, triggering visibilitychange
    handleVisibilityChange();

    // 1 more second of low FPS
    for (let f = 0; f < 15; f++) {
      currentTime += 66.7;
      onRender();
    }

    // Should NOT have triggered fallback yet because counters were reset
    expect(setWebglWindFailed).not.toHaveBeenCalled();

    // Another 2 seconds of low FPS (total 3 seconds since reset) should trigger it
    for (let sec = 0; sec < 2; sec++) {
      for (let f = 0; f < 15; f++) {
        currentTime += 66.7;
        onRender();
      }
    }

    expect(setWebglWindFailed).toHaveBeenCalledWith(true);
  });

  it('guards against rendering when document is hidden', () => {
    const setWebglWindFailed = jest.fn();
    const setWebglMarineFailed = jest.fn();

    renderHook(() =>
      useWebGLGuardrail({
        mapInstance,
        activeLayers: ['wind'],
        setWebglWindFailed,
        setWebglMarineFailed,
        webglWindFailed: false,
        webglMarineFailed: false,
      })
    );

    const onRender = eventListeners['render'];

    // Mock document.hidden = true
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });

    // Run low FPS frames
    for (let i = 0; i < 45; i++) {
      currentTime += 66.7;
      onRender();
    }

    // Should not trigger fallback since document is hidden
    expect(setWebglWindFailed).not.toHaveBeenCalled();
  });
});
