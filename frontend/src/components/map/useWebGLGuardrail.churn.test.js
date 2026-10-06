/**
 * The FPS guardrail's trips and retries are on the churn log, and the continuity gate stops grading the
 * CI runner (2026-09-27).
 *
 * Dev E2E runs 36285144742 and 36290246940 went red on the WebGL -> Canvas2D marine swap (layerCalls 0,
 * engine_dispose x2 + foam_mount) with NO render error, fallback or recovery recorded: #111 had
 * instrumented render errors, init failures and context loss, and the swap came from this hook, whose
 * "< 20 FPS for 12 s" always trips on the runner's ~1 FPS software rasteriser. Now every trip and retry
 * names itself, and the gate disables the guardrail so it measures render continuity, not the runner.
 */
import fs from 'fs';
import path from 'path';
import { renderHook, act } from '@testing-library/react';
import { useWebGLGuardrail, RECOVERY_BACKOFFS_MS } from './useWebGLGuardrail';

function makeMap() {
  const handlers = {};
  return {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    isMoving: () => false,
    isZooming: () => false,
    __fire: (ev) => {
      window.__RAW_GPU__.layer = { n: (window.__RAW_GPU__.layer?.n || 0) + 1, t: Date.now(), skip: null };
      (handlers[ev] || []).forEach((f) => f());
    },
  };
}

const churn = (kind) => ((window.__MARINE_CHURN__ && window.__MARINE_CHURN__.log) || []).filter((e) => e.kind === kind);

beforeEach(() => {
  jest.useFakeTimers();
  window.__MARINE_ENGINE__ = { _initialized: true, _waveData: {} };
  window.__RAW_GPU__ = {};
  delete window.__MARINE_CHURN__;
  delete window.__DISABLE_WEBGL_GUARDRAIL__;
  delete window.__DISABLE_WEBGL_GUARDRAIL_RECOVERY__;
  jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  delete window.location;
  window.location = { hostname: 'dev--rawsurf.netlify.app' };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete window.__MARINE_ENGINE__;
  delete window.__RAW_GPU__;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('a trip records its cause and the FPS, and the timed retry records itself', () => {
  const clock = { t: 0 };
  jest.spyOn(performance, 'now').mockImplementation(() => clock.t);
  const map = makeMap();
  const setMarine = jest.fn();
  const props = { mapInstance: map, activeLayers: ['waves'], setWebglWindFailed: jest.fn(),
    setWebglMarineFailed: setMarine, webglWindFailed: false, webglMarineFailed: false };
  const { rerender } = renderHook((p) => useWebGLGuardrail(p), { initialProps: props });

  for (let i = 0; i < 30; i++) { clock.t += 1000; map.__fire('render'); }    // 1 FPS, as CI renders
  expect(setMarine).toHaveBeenCalledWith(true);
  const trips = churn('marine_webgl_fallback');
  expect(trips).toHaveLength(1);
  expect(trips[0]).toMatchObject({ cause: 'fps_guardrail', fps: 1 });

  rerender({ ...props, webglMarineFailed: true });                          // the flag the trip set
  clock.t += RECOVERY_BACKOFFS_MS[0];
  act(() => { jest.advanceTimersByTime(5000); });
  expect(setMarine).toHaveBeenLastCalledWith(false);
  expect(churn('marine_webgl_recover')).toEqual([expect.objectContaining({ cause: 'guardrail_retry', attempt: 1 })]);
});

it('the kill switch the gate uses leaves nothing to record', () => {
  window.__DISABLE_WEBGL_GUARDRAIL__ = true;
  const clock = { t: 0 };
  jest.spyOn(performance, 'now').mockImplementation(() => clock.t);
  const map = makeMap();
  const setMarine = jest.fn();
  renderHook(() => useWebGLGuardrail({ mapInstance: map, activeLayers: ['waves'], setWebglWindFailed: jest.fn(),
    setWebglMarineFailed: setMarine, webglWindFailed: false, webglMarineFailed: false }));
  for (let i = 0; i < 30; i++) { clock.t += 1000; map.__fire('render'); }
  expect(setMarine).not.toHaveBeenCalled();
  expect(churn('marine_webgl_fallback')).toEqual([]);
});

it('the continuity gate disables the guardrail before any app code runs', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../e2e/marine-render-continuity.spec.js'), 'utf8');
  const init = src.slice(src.indexOf('async function openMapAsSurfer'), src.indexOf('}, E2E_USER);'));
  expect(init).toMatch(/page\.addInitScript\(/);
  expect(init).toMatch(/window\.__DISABLE_WEBGL_GUARDRAIL__ = true;/);
});
