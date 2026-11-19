/**
 * TWO MORE WAYS THE GUARDRAIL TRADED THE FORECAST FOR NOTHING (2026-10-28, the lead's live session on dev 4bd90d0d9, built-in
 * browser pane, z9 Florida, 22:41-23:35Z on 10-27; this PC loaded by four other agents).
 *
 * 1. BLANK SEA. The third trip (23:23:42Z, fps 4) came with EURO + Swell selected: the ocean went blank under "Simplified wave
 *    layer - reduced graphics mode". The fallback draws Open-Meteo raster tiles, and its EURO model (ecmwf_wam025) carries wave
 *    height only: swell, secondary swell and wind waves are a transparent tile (useOpenMeteoTileUrls: "no cross-model fallback").
 *    ICON's (dwd_gwam) has no secondary swell. A blank sea is worse than slow frames (the owner: never a blank frame), so the hook
 *    does not engage a fallback that has nothing to draw for the selected model, layer and hour.
 * 2. MAIN-THREAD LOAD IS NOT A RENDERER PROBLEM. The trips came with 3,522 long tasks in 54 min (28 over 500 ms, max 7,003 ms) and
 *    irregular frame gaps (300-7,000 ms): not the throttle cadence. Swapping WebGL for raster tiles removes none of that work (series
 *    decode, land mask); it only removes this app's forecast. A low-FPS window whose marine draws were measured and cheap and whose
 *    main thread was mostly in long tasks (>= half the window, PerformanceObserver 'longtask') is not evidence. Cheap draws on a
 *    QUIET main thread still count: that is a GPU-bound device, whose cost the CPU-call histogram cannot see.
 * Kills: window.__RAW_DISABLE_GUARDRAIL_BLANK_GUARD__ = true; window.__RAW_DISABLE_GUARDRAIL_MAIN_THREAD__ = true.
 */
import { renderHook } from '@testing-library/react';
import { useWebGLGuardrail } from './useWebGLGuardrail';
import { marineFallbackDrawable, MAIN_THREAD_BUSY_FRACTION } from './marineGuardrailRules';
import { MODEL_METADATA_CACHE } from './LayerRegistry';

const SLOW = 4; const CHEAP = 0;

function makeMap() {
  const handlers = {};
  return {
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    isMoving: () => false, isZooming: () => false,
    frame(bucket) {
      const gpu = window.__RAW_GPU__;
      if (bucket !== null && gpu.frameTimeHistogram) gpu.frameTimeHistogram[bucket] += 1;
      gpu.layer = { n: (gpu.layer?.n || 0) + 1, t: Date.now(), skip: null };
      (handlers.render || []).forEach((f) => f());
    },
  };
}
const installClock = () => { const c = { t: 0 }; c.spy = jest.spyOn(performance, 'now').mockImplementation(() => c.t); return c; };
// The browser's Long Tasks feed: entries the page's observer receives (takeRecords drains what is not yet delivered).
let longTaskQueue = [];
class FakeObserver {
  static supportedEntryTypes = ['longtask'];
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
  takeRecords() { const out = longTaskQueue; longTaskQueue = []; return out; }
}
/** `seconds` of frames at `intervals` (cycled); `busy` = the fraction of each interval spent in one long task before the frame. */
function drive(map, clock, { intervals, seconds, bucket, busy = 0 }) {
  const end = clock.t + seconds * 1000;
  for (let i = 0; clock.t < end; i++) {
    const gap = intervals[i % intervals.length];
    if (busy > 0) longTaskQueue.push({ entryType: 'longtask', startTime: clock.t + 1, duration: gap * busy });
    clock.t += gap; map.frame(bucket);
  }
}
const props = (map, layer = 'waves') => ({ mapInstance: map, activeLayers: [layer], setWebglWindFailed: jest.fn(), setWebglMarineFailed: jest.fn(),
  webglWindFailed: false, webglMarineFailed: false });
const savedMeta = {};

beforeEach(() => {
  window.__MARINE_ENGINE__ = { _initialized: true, _waveData: {} };
  window.__RAW_GPU__ = { frameTimeHistogram: [0, 0, 0, 0, 0] };
  window.activeModel = 'GFS'; window.activeTimeOffsetHours = 100;
  longTaskQueue = [];
  ['ecmwf_wam025', 'dwd_gwam', 'ncep_gfswave025'].forEach((m) => { savedMeta[m] = MODEL_METADATA_CACHE[m]; });
  ['__RAW_DISABLE_GUARDRAIL_BLANK_GUARD__', '__RAW_DISABLE_GUARDRAIL_MAIN_THREAD__', '__RAW_GUARDRAIL_NO_FALLBACK__', '__RAW_GUARDRAIL_MAIN_THREAD__',
    '__RAW_GUARDRAIL_THROTTLED__', '__DISABLE_WEBGL_GUARDRAIL__'].forEach((k) => { delete window[k]; });
  jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  delete window.location;
  window.location = { hostname: 'dev--rawsurf.netlify.app' };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  Object.assign(MODEL_METADATA_CACHE, savedMeta);
  delete window.PerformanceObserver; delete window.activeModel; delete window.activeTimeOffsetHours;
  ['__RAW_DISABLE_GUARDRAIL_BLANK_GUARD__', '__RAW_DISABLE_GUARDRAIL_MAIN_THREAD__'].forEach((k) => { delete window[k]; });
});

describe('the fallback is only engaged when it can draw the selected layer', () => {
  // 2026-11-18 (Open-Meteo exit row 12): the fallback paints OUR OWN grid, the one the engine holds, so it can draw every model
  // and layer the engine could. What it cannot draw is a surf-rating grid (scores in the height field) or anything under its
  // own kill. No third party's variable list is consulted any more: the three tests below replace the ones that pinned it.
  it('what the fallback can draw: any grid the engine holds, except a surf-rating grid or under its own kill; unknown with no grid', () => {
    const win = (grid, extra = {}) => ({ __MARINE_ENGINE__: { _waveData: { waveGrid: grid } }, ...extra });
    expect(marineFallbackDrawable(win({ cols: 3, rows: 3 }))).toEqual({ drawable: true, why: null });
    expect(marineFallbackDrawable(win({ cols: 3, rows: 3, ratingMode: true }))).toEqual({ drawable: false, why: 'rating_grid' });
    expect(marineFallbackDrawable(win({ cols: 3, rows: 3 }, { __RAW_DISABLE_OWN_MARINE_FALLBACK__: true }))).toEqual({ drawable: false, why: 'killed' });
    expect(marineFallbackDrawable(win(null))).toEqual({ drawable: null, why: null });
    expect(marineFallbackDrawable({})).toEqual({ drawable: null, why: null });
  });

  it('THE THIRD-PARTY LIST NO LONGER DECIDES: emptying the provider\'s variable lists changes nothing', () => {
    ['ecmwf_wam025', 'dwd_gwam', 'ncep_gfswave025'].forEach((m) => { MODEL_METADATA_CACHE[m] = { variables: [], validTimes: [] }; });
    window.__MARINE_ENGINE__ = { _initialized: true, _waveData: { waveGrid: { cols: 3, rows: 3 } } };
    expect(marineFallbackDrawable().drawable).toBe(true);
  });

  it('the live session again: EURO + Swell, slow frames. Our own grid has the swell, so it TRIPS and there is a sea to draw', () => {
    window.activeModel = 'EURO';
    window.__MARINE_ENGINE__ = { _initialized: true, _waveData: { waveGrid: { cols: 3, rows: 3 } } };
    const map = makeMap(); const p = props(map, 'swell_1'); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [250], seconds: 40, bucket: SLOW });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
    expect(window.__RAW_GUARDRAIL_NO_FALLBACK__).toBeUndefined();
  });

  it('ICON Swell 2, the same: it trips at any hour', () => {
    window.activeModel = 'ICON';
    window.__MARINE_ENGINE__ = { _initialized: true, _waveData: { waveGrid: { cols: 3, rows: 3 } } };
    const map = makeMap(); const p = props(map, 'swell_2'); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [250], seconds: 30, bucket: SLOW });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('A SURF-RATING GRID, slow frames: no trip (the sea would be blank), and it says why', () => {
    window.__MARINE_ENGINE__ = { _initialized: true, _waveData: { waveGrid: { cols: 3, rows: 3, ratingMode: true } } };
    const map = makeMap(); const p = props(map, 'waves'); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [250], seconds: 40, bucket: SLOW });
    expect(p.setWebglMarineFailed).not.toHaveBeenCalled();
    expect(window.__RAW_GUARDRAIL_NO_FALLBACK__).toMatchObject({ model: 'GFS', layer: 'waves', why: 'rating_grid' });
  });

  it('the fallback\'s own kill, slow frames: no trip either (nothing would be drawn), and it says why', () => {
    window.__RAW_DISABLE_OWN_MARINE_FALLBACK__ = true;
    try {
      window.__MARINE_ENGINE__ = { _initialized: true, _waveData: { waveGrid: { cols: 3, rows: 3 } } };
      const map = makeMap(); const p = props(map, 'waves'); const clock = installClock();
      renderHook(() => useWebGLGuardrail(p));
      drive(map, clock, { intervals: [250], seconds: 40, bucket: SLOW });
      expect(p.setWebglMarineFailed).not.toHaveBeenCalled();
      expect(window.__RAW_GUARDRAIL_NO_FALLBACK__).toMatchObject({ why: 'killed' });
    } finally { delete window.__RAW_DISABLE_OWN_MARINE_FALLBACK__; }
  });

  it('CONTROL: EURO Waves and GFS Swell: slow frames trip as before', () => {
    window.activeModel = 'EURO';
    const map = makeMap(); const p = props(map, 'waves'); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [250], seconds: 30, bucket: SLOW });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
    window.activeModel = 'GFS';
    const map2 = makeMap(); const p2 = props(map2, 'swell_1'); const clock2 = { t: clock.t };
    clock.spy.mockImplementation(() => clock2.t);
    renderHook(() => useWebGLGuardrail(p2));
    drive(map2, clock2, { intervals: [250], seconds: 30, bucket: SLOW });
    expect(p2.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('POSITIVE CONTROL (the kill): __RAW_DISABLE_GUARDRAIL_BLANK_GUARD__ trips into the blank sea again', () => {
    window.__RAW_DISABLE_GUARDRAIL_BLANK_GUARD__ = true;
    window.__MARINE_ENGINE__ = { _initialized: true, _waveData: { waveGrid: { cols: 3, rows: 3, ratingMode: true } } };
    const map = makeMap(); const p = props(map, 'waves'); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [250], seconds: 30, bucket: SLOW });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });
});

describe('a busy main thread with cheap marine draws is not a renderer problem', () => {
  // The live session's irregular gaps under the throttle floor (900-2000 ms gaps with cheap draws are already the cadence rule's,
  // and 2000 ms or more the suspend gate's).
  const LIVE_GAPS = [300, 650, 420, 800, 380, 550, 700];

  it('the live session: irregular gaps, cheap draws, long tasks filling 70% of each gap: no trip, and it says why', () => {
    window.PerformanceObserver = FakeObserver;
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: LIVE_GAPS, seconds: 60, bucket: CHEAP, busy: 0.7 });
    expect(p.setWebglMarineFailed).not.toHaveBeenCalled();
    expect(window.__RAW_GUARDRAIL_MAIN_THREAD__.windows).toBeGreaterThanOrEqual(12);
    expect(MAIN_THREAD_BUSY_FRACTION).toBe(0.5);
  });

  it('CONTROL: the same load with slow marine draws trips (the renderer is the cost)', () => {
    window.PerformanceObserver = FakeObserver;
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: LIVE_GAPS, seconds: 30, bucket: SLOW, busy: 0.7 });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('CONTROL: cheap draws on a quiet main thread (a GPU-bound device) trip', () => {
    window.PerformanceObserver = FakeObserver;
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [200], seconds: 30, bucket: CHEAP, busy: 0 });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('CONTROL: long tasks under half the window still count as evidence', () => {
    window.PerformanceObserver = FakeObserver;
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [200], seconds: 30, bucket: CHEAP, busy: 0.3 });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('no Long Tasks API (Safari): today\'s rule, the same load trips', () => {
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: LIVE_GAPS, seconds: 30, bucket: CHEAP, busy: 0.7 });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('POSITIVE CONTROL (the kill): __RAW_DISABLE_GUARDRAIL_MAIN_THREAD__ trips the live session again', () => {
    window.PerformanceObserver = FakeObserver; window.__RAW_DISABLE_GUARDRAIL_MAIN_THREAD__ = true;
    const map = makeMap(); const p = props(map); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: LIVE_GAPS, seconds: 30, bucket: CHEAP, busy: 0.7 });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });
});
