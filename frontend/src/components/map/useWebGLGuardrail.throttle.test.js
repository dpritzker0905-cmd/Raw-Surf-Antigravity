/**
 * A THROTTLED TAB IS NOT A SLOW DEVICE (2026-10-27, the lead's live read of dev 89a494aca, EURO waves z9).
 *
 * The tab's churn log: `marine_webgl_fallback` (cause fps_guardrail, fps 1) at 13:58:14Z, 5 s before the probe's steps, and
 * `marine_webgl_recover` (attempt 2) only at 14:04:04Z. Measured in the same tab afterwards: requestAnimationFrame at 1.1/s, largest
 * interval 1015 ms, with document.visibilityState 'visible' and hasFocus() true: Chrome throttling the window, not a slow GPU. The
 * hook counted each 1 s window at 1 fps as low-FPS evidence (intervals under its 2000 ms suspend gate), tripped after 12, and swapped
 * the app's forecast for third-party raster tiles: timeline hours 141-155 "never drew" (#615 makes the status line say so).
 *
 * The rule pinned here: a low-FPS window whose every frame interval sits on the browser's ~1 s throttle cadence AND whose marine
 * render calls were all cheap (no call >= 33.3 ms in the engine's own histogram) is the browser pausing us, not evidence. A window
 * with a slow marine call still counts (SwiftShader's 1 fps, the guardrail's founding case), so does any faster-than-cadence slow
 * window (a GPU-bound device at 5 fps), and so does every window when the cost cannot be read (today's behaviour).
 * Kill: window.__RAW_DISABLE_GUARDRAIL_THROTTLE_CADENCE__ = true.
 */
import { renderHook } from '@testing-library/react';
import { useWebGLGuardrail, THROTTLE_CADENCE_MIN_MS } from './useWebGLGuardrail';

const SLOW = 4;     // histogram bucket >= 66.6 ms (WebGLMarineEngine: <8, 8-16.6, 16.6-33.3, 33.3-66.6, >= 66.6)
const CHEAP = 0;    // < 8 ms

function makeMap() {
  const handlers = {};
  return {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    isMoving: () => false, isZooming: () => false,
    // One map frame: the marine layer's render call lands in `bucket` of the engine's histogram, then MapLibre fires 'render'.
    frame(bucket) {
      const gpu = window.__RAW_GPU__;
      if (bucket !== null && gpu.frameTimeHistogram) gpu.frameTimeHistogram[bucket] += 1;
      gpu.layer = { n: (gpu.layer?.n || 0) + 1, t: Date.now(), skip: null };
      (handlers.render || []).forEach((f) => f());
    },
  };
}
const installClock = () => { const c = { t: 0 }; c.spy = jest.spyOn(performance, 'now').mockImplementation(() => c.t); return c; };
/** `seconds` of frames at the given intervals (ms, cycled), each frame's marine call in `bucket`. */
function drive(map, clock, { intervals, seconds, bucket }) {
  const end = clock.t + seconds * 1000;
  for (let i = 0; clock.t < end; i++) { clock.t += intervals[i % intervals.length]; map.frame(bucket); }
}
const props = (map) => ({ mapInstance: map, activeLayers: ['waves'], setWebglWindFailed: jest.fn(), setWebglMarineFailed: jest.fn(),
  webglWindFailed: false, webglMarineFailed: false });

beforeEach(() => {
  window.__MARINE_ENGINE__ = { _initialized: true, _waveData: {} };
  window.__RAW_GPU__ = { frameTimeHistogram: [0, 0, 0, 0, 0] };
  delete window.__DISABLE_WEBGL_GUARDRAIL__;
  delete window.__RAW_DISABLE_GUARDRAIL_THROTTLE_CADENCE__;
  delete window.__RAW_GUARDRAIL_THROTTLED__;
  jest.spyOn(document, 'hasFocus').mockReturnValue(true);              // the live tab: focused and visible
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  delete window.location;
  window.location = { hostname: 'dev--rawsurf.netlify.app' };          // a deployed host: the hook is live
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  delete window.__MARINE_ENGINE__; delete window.__RAW_GPU__;
  delete window.__RAW_DISABLE_GUARDRAIL_THROTTLE_CADENCE__; delete window.__RAW_GUARDRAIL_THROTTLED__;
});

describe('useWebGLGuardrail: the browser\'s ~1 s throttle cadence with cheap frames is not a slow device', () => {
  it('the live tab: 1.1 frames a second (990-1015 ms), cheap marine calls, 70 s: never trips, and says why', () => {
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [990, 1015, 1002], seconds: 70, bucket: CHEAP });
    expect(p.setWebglMarineFailed).not.toHaveBeenCalled();
    expect(window.__RAW_GUARDRAIL_THROTTLED__.windows).toBeGreaterThanOrEqual(12);
  });

  it('CONTROL, SwiftShader (the founding case): the same 1 s cadence with every marine call >= 66 ms trips', () => {
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [1000], seconds: 30, bucket: SLOW });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('CONTROL, a GPU-bound device: 5 fps with cheap CPU calls is under the cadence and trips', () => {
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [200], seconds: 30, bucket: CHEAP });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('throttled windows neither count nor shield: a throttled minute, then 12 s of real slow frames, trips', () => {
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [1000], seconds: 60, bucket: CHEAP });
    expect(p.setWebglMarineFailed).not.toHaveBeenCalled();
    drive(map, clock, { intervals: [250], seconds: 14, bucket: SLOW });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('a cost the hook cannot read keeps today\'s rule: no histogram, the 1 s cadence trips', () => {
    window.__RAW_GPU__ = {};
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [1000], seconds: 30, bucket: null });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('the cadence floor is the throttle\'s, not a slow frame\'s: an interval just under it counts', () => {
    expect(THROTTLE_CADENCE_MIN_MS).toBe(900);
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [THROTTLE_CADENCE_MIN_MS - 50], seconds: 30, bucket: CHEAP });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('POSITIVE CONTROL (the kill): __RAW_DISABLE_GUARDRAIL_THROTTLE_CADENCE__ trips the live tab again', () => {
    window.__RAW_DISABLE_GUARDRAIL_THROTTLE_CADENCE__ = true;
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [990, 1015, 1002], seconds: 30, bucket: CHEAP });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });
});
