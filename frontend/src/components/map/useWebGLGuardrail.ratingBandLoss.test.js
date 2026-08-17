/**
 * THE GUARDRAIL SILENTLY REPLACES THE FORECAST PRODUCT (root-caused 2026-08-16).
 *
 * Owner report: "the rating band is being layered underneath the marine heatmap."
 * Measured on the deployed dev alias, paired A/B at identical cameras, one variable:
 *
 *   guardrail ON  (default) — 6/6 stops REFUSED by the harness's freshness assertion, zero
 *                             `[rating-band]` breadcrumbs, `__RAW_GPU__` frozen at the last frame
 *   guardrail OFF (control) — 6/6 stops FRESH, 6-12 breadcrumbs each, `PAINTING ✓ (band on)` at
 *                             every stop, and the coastal ribbon visible in the capture
 *
 * The chain the band needs is HEALTHY end to end (`surf=1` on the request, the backend returning
 * `diagnostics.surf_transform.value_kind === 'surf_rating'`, `ratingMode` stamped, committed, and
 * `__RAW_GPU__.ratingBand.active === true`). Nothing in it is broken. What happens is that this
 * hook decides the GPU is too slow and sets `webglMarineFailed`, and `useOpenMeteoTileUrls` then
 * serves the marine layer as OPEN-METEO RASTER TILES instead — a third-party wave-HEIGHT product
 * that has no rating band and is not the ONE FORECAST COMPOSITION chain. The legend keeps
 * advertising "Surf Rating (coastal band)". The user sees the band replaced by a heatmap.
 *
 * These tests pin what the hook does TODAY, so the behaviour cannot drift while the product
 * decision (threshold / hysteresis / recovery / disclosure) is the owner's. They are written to
 * FAIL if any exemption silently stops working — the trip test is the non-vacuous control, without
 * which every "did not trip" assertion below would pass on a hook that can never fire at all.
 *
 * ⚠️ Deliberately NOT asserted: that tripping is wrong. It is a legitimate protection. What is
 * asserted is that it fires, that its exemptions are real, and that its kill switch works — the
 * three facts a fix has to preserve.
 */
import { renderHook } from '@testing-library/react';
import { useWebGLGuardrail, shouldAttemptRecovery, isForcedFallback, RECOVERY_BACKOFFS_MS } from './useWebGLGuardrail';

// A minimal map mock: capture the 'render' handler so a test can drive frames deterministically.
function makeMap(overrides = {}) {
  const handlers = {};
  return {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    isMoving: () => false,
    isZooming: () => false,
    __fire: (ev) => (handlers[ev] || []).forEach((f) => f()),
    __handlers: handlers,
    ...overrides,
  };
}

/**
 * A controllable clock. It MUST be installed BEFORE renderHook: the hook captures
 * `mountTime = performance.now()` when its effect runs, and compares `now - mountTime` against the
 * 10 s grace period. Installing the mock afterwards leaves mountTime on the real clock (a large
 * number) while the mocked `now` starts near zero, so the difference is hugely NEGATIVE, the grace
 * check is satisfied forever and the hook can never trip. My first draft did exactly that and the
 * control below caught it — which is the whole reason the control exists.
 */
function installClock(startAt = 0) {
  const clock = { t: startAt };
  clock.spy = jest.spyOn(performance, 'now').mockImplementation(() => clock.t);
  return clock;
}

/** Drive `seconds` of wall clock at `fps`, firing one map render per frame. */
function driveFrames(map, clock, { fps, seconds }) {
  const step = 1000 / fps;
  const frames = Math.ceil(seconds * fps);
  for (let i = 0; i < frames; i++) { clock.t += step; map.__fire('render'); }
}

const GRACE_MS = 10000;     // the hook's own mount grace period
const baseProps = (map, over = {}) => ({
  mapInstance: map,
  activeLayers: ['waves'],
  setWebglWindFailed: jest.fn(),
  setWebglMarineFailed: jest.fn(),
  webglWindFailed: false,
  webglMarineFailed: false,
  ...over,
});

describe('useWebGLGuardrail — the marine rating band is collateral of the FPS fallback', () => {
  let nowSpy;
  beforeEach(() => {
    // deployed-host conditions: the hook self-exempts on localhost, so a test on localhost would
    // pass vacuously. Pin a non-local hostname and a focused, visible tab.
    delete window.__DISABLE_WEBGL_GUARDRAIL__;
    jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    delete window.location;
    window.location = { hostname: 'dev--rawsurf.netlify.app' };
  });
  afterEach(() => { if (nowSpy) nowSpy.mockRestore(); jest.restoreAllMocks(); });

  // ── THE CONTROL. Without this passing, every "does not trip" case below is vacuous. ──
  it('DOES trip at sustained low FPS on a deployed host — the non-vacuous control', () => {
    const map = makeMap();
    const props = baseProps(map);
    const clock = installClock(0); nowSpy = clock.spy;
    renderHook(() => useWebGLGuardrail(props));
    // 1 FPS is what SwiftShader produced live; 30 s clears the 10 s grace and 12 low-FPS windows.
    driveFrames(map, clock, { fps: 1, seconds: 30 });
    expect(props.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('does NOT trip inside the mount grace period, however slow the frames', () => {
    const map = makeMap();
    const props = baseProps(map);
    const clock = installClock(0); nowSpy = clock.spy;
    renderHook(() => useWebGLGuardrail(props));
    driveFrames(map, clock, { fps: 1, seconds: (GRACE_MS / 1000) - 2 });
    expect(props.setWebglMarineFailed).not.toHaveBeenCalled();
  });

  it('does NOT trip while the map is moving or zooming — a pan is expected to be slow', () => {
    const map = makeMap({ isMoving: () => true });
    const props = baseProps(map);
    const clock = installClock(0); nowSpy = clock.spy;
    renderHook(() => useWebGLGuardrail(props));
    driveFrames(map, clock, { fps: 1, seconds: 30 });
    expect(props.setWebglMarineFailed).not.toHaveBeenCalled();
  });

  it('does NOT trip when no marine layer is active — the band cannot be the casualty', () => {
    const map = makeMap();
    const props = baseProps(map, { activeLayers: ['precip'] });
    const clock = installClock(0); nowSpy = clock.spy;
    renderHook(() => useWebGLGuardrail(props));
    driveFrames(map, clock, { fps: 1, seconds: 30 });
    expect(props.setWebglMarineFailed).not.toHaveBeenCalled();
  });

  it('__DISABLE_WEBGL_GUARDRAIL__ suppresses the trip — the lever the A/B relied on', () => {
    window.__DISABLE_WEBGL_GUARDRAIL__ = true;
    const map = makeMap();
    const props = baseProps(map);
    const clock = installClock(0); nowSpy = clock.spy;
    renderHook(() => useWebGLGuardrail(props));
    driveFrames(map, clock, { fps: 1, seconds: 30 });
    expect(props.setWebglMarineFailed).not.toHaveBeenCalled();
  });

});

/**
 * RECOVERY POLICY (shipped 2026-08-16, owner-approved). Pure, so the policy is tested without a map
 * or a clock. The previous revision of this file pinned "no recovery exists" as a known gap; that
 * gap is now closed and these replace it.
 */
describe('shouldAttemptRecovery — bounded retry, and whose trip it is', () => {
  const base = { marineFailed: true, guardrailOwned: true, attempts: 0, trippedAt: 0,
    now: RECOVERY_BACKOFFS_MS[0], forced: false, disabled: false };

  it('attempts once the first backoff has elapsed — the control', () => {
    expect(shouldAttemptRecovery(base)).toBe(true);
  });
  it('waits: one millisecond short of the backoff is not due', () => {
    expect(shouldAttemptRecovery({ ...base, now: RECOVERY_BACKOFFS_MS[0] - 1 })).toBe(false);
  });
  it('each attempt costs a LONGER wait — the flap bound', () => {
    const after1 = { ...base, attempts: 1 };
    expect(shouldAttemptRecovery({ ...after1, now: RECOVERY_BACKOFFS_MS[0] })).toBe(false);
    expect(shouldAttemptRecovery({ ...after1, now: RECOVERY_BACKOFFS_MS[1] })).toBe(true);
  });
  it('stops for good once the budget is spent — a device that truly cannot run it settles', () => {
    expect(shouldAttemptRecovery({ ...base, attempts: RECOVERY_BACKOFFS_MS.length, now: 1e9 })).toBe(false);
  });
  it('never undoes a fallback this hook did not cause (hard WebGL error)', () => {
    expect(shouldAttemptRecovery({ ...base, guardrailOwned: false })).toBe(false);
  });
  it('never undoes a HUMAN-forced fallback — the user asked for it', () => {
    expect(shouldAttemptRecovery({ ...base, forced: true })).toBe(false);
  });
  it('does nothing when the fallback is not engaged', () => {
    expect(shouldAttemptRecovery({ ...base, marineFailed: false })).toBe(false);
  });
  it('__DISABLE_WEBGL_GUARDRAIL_RECOVERY__ suppresses it', () => {
    expect(shouldAttemptRecovery({ ...base, disabled: true })).toBe(false);
  });
});

/**
 * THE WIRING, not the policy. shouldAttemptRecovery being correct proves nothing if the interval
 * never runs it, reads the wrong flag, or fires while the fallback is not engaged — so this drives
 * the real hook: trip it, let the backoff elapse on a fake timer, and require the re-enable.
 */
describe('useWebGLGuardrail — the recovery is actually wired to a timer', () => {
  let nowSpy;
  beforeEach(() => {
    delete window.__DISABLE_WEBGL_GUARDRAIL__;
    delete window.__DISABLE_WEBGL_GUARDRAIL_RECOVERY__;
    delete window.__FORCE_MARINE_FALLBACK__;
    window.localStorage.removeItem('force_marine_fallback');
    jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    delete window.location;
    window.location = { hostname: 'dev--rawsurf.netlify.app' };
    jest.useFakeTimers();
  });
  afterEach(() => { jest.useRealTimers(); if (nowSpy) nowSpy.mockRestore(); jest.restoreAllMocks(); });

  /**
   * Trip the guardrail for real, then hand back the clock so the test can advance past a backoff.
   *
   * ⚠️ The fallback flag must be delivered by a RE-RENDER, not by mutating the props object. The
   * hook reads it through a ref that is synced in an effect keyed on the prop; mutating the object
   * in place leaves that effect unfired, the ref stays false, and recovery correctly declines
   * because as far as the hook can tell the fallback is not engaged. My first draft mutated, and
   * only the two positive tests failed — the four "does NOT recover" cases passed vacuously, which
   * is exactly what a suite without positive controls would have shipped.
   */
  function tripped(over = {}) {
    const map = makeMap();
    const props = baseProps(map, over);
    const clock = installClock(0); nowSpy = clock.spy;
    const { rerender } = renderHook((p) => useWebGLGuardrail(p), { initialProps: props });
    driveFrames(map, clock, { fps: 1, seconds: 30 });
    expect(props.setWebglMarineFailed).toHaveBeenCalledWith(true);
    // the parent would now flip the flag; the hook's main effect is keyed on mapInstance only, so
    // the recovery timer and its closure state survive this re-render.
    rerender({ ...props, webglMarineFailed: true });
    return { map, props, clock, rerender };
  }

  const advance = (clock, ms) => { clock.t += ms; jest.advanceTimersByTime(ms); };

  it('re-enables the WebGL marine layer once the first backoff elapses', () => {
    const { props, clock } = tripped();
    advance(clock, RECOVERY_BACKOFFS_MS[0] + 6000);
    expect(props.setWebglMarineFailed).toHaveBeenCalledWith(false);
  });

  it('does NOT re-enable before the backoff — the wait is real', () => {
    const { props, clock } = tripped();
    advance(clock, RECOVERY_BACKOFFS_MS[0] - 10000);
    expect(props.setWebglMarineFailed).not.toHaveBeenCalledWith(false);
  });

  it('does NOT re-enable into a pan — a remount mid-gesture is the worst moment', () => {
    const map = makeMap();
    let moving = false;
    map.isMoving = () => moving;
    const props = baseProps(map);
    const clock = installClock(0); nowSpy = clock.spy;
    const { rerender } = renderHook((p) => useWebGLGuardrail(p), { initialProps: props });
    driveFrames(map, clock, { fps: 1, seconds: 30 });
    rerender({ ...props, webglMarineFailed: true });
    moving = true;
    advance(clock, RECOVERY_BACKOFFS_MS[0] + 6000);
    expect(props.setWebglMarineFailed).not.toHaveBeenCalledWith(false);
  });

  it('does NOT re-enable a HUMAN-forced fallback', () => {
    window.localStorage.setItem('force_marine_fallback', 'true');
    const { props, clock } = tripped();
    advance(clock, RECOVERY_BACKOFFS_MS[0] + 6000);
    expect(props.setWebglMarineFailed).not.toHaveBeenCalledWith(false);
  });

  it('stops after the budget — bounded flapping, not a loop', () => {
    const { props, clock } = tripped();
    // walk past every backoff plus a wide margin; the re-enable count must equal the budget
    for (const b of RECOVERY_BACKOFFS_MS) advance(clock, b + 10000);
    advance(clock, 3600000);
    const reEnables = props.setWebglMarineFailed.mock.calls.filter(([v]) => v === false).length;
    expect(reEnables).toBe(RECOVERY_BACKOFFS_MS.length);
  });

  it('the recovery kill switch works', () => {
    window.__DISABLE_WEBGL_GUARDRAIL_RECOVERY__ = true;
    const { props, clock } = tripped();
    advance(clock, RECOVERY_BACKOFFS_MS[0] + 6000);
    expect(props.setWebglMarineFailed).not.toHaveBeenCalledWith(false);
  });
});

describe('isForcedFallback', () => {
  const store = (v) => ({ localStorage: { getItem: (k) => (k === 'force_marine_fallback' ? v : null) } });
  it('true on the window override', () => expect(isForcedFallback({ __FORCE_MARINE_FALLBACK__: true })).toBe(true));
  it('true on the persisted preference', () => expect(isForcedFallback(store('true'))).toBe(true));
  it('false otherwise', () => expect(isForcedFallback(store('false'))).toBe(false));
  it('false, never throws, when localStorage is unavailable', () => {
    expect(isForcedFallback({ get localStorage() { throw new Error('blocked'); } })).toBe(false);
  });
});
