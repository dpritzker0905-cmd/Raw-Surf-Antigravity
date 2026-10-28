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
  it('what the raster fallback can draw (the bootstrap variable lists; a cutover hour hands EURO/ICON to GFS Wave)', () => {
    const d = (model, layer, hour = 100) => marineFallbackDrawable({ model, layer, hour }).drawable;
    expect(['waves', 'swell_1', 'swell_2', 'wind_waves'].map((l) => d('GFS', l))).toEqual([true, true, true, true]);
    expect(['waves', 'swell_1', 'swell_2', 'wind_waves'].map((l) => d('EURO', l))).toEqual([true, false, false, false]);
    expect(['waves', 'swell_1', 'swell_2', 'wind_waves'].map((l) => d('ICON', l))).toEqual([true, true, false, true]);
    expect(d('EURO', 'swell_1', 250)).toBe(true);    // past 240 h the raster is GFS Wave
    expect(d('ICON', 'swell_2', 200)).toBe(true);    // past 168 h the raster is GFS Wave
  });

  it('the live session: EURO + Swell, slow frames: no trip (the sea would be blank), and it says why', () => {
    window.activeModel = 'EURO';
    const map = makeMap(); const p = props(map, 'swell_1'); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [250], seconds: 40, bucket: SLOW });
    expect(p.setWebglMarineFailed).not.toHaveBeenCalled();
    expect(window.__RAW_GUARDRAIL_NO_FALLBACK__).toMatchObject({ model: 'EURO', layer: 'swell_1', rasterModel: 'ecmwf_wam025' });
  });

  it('ICON Swell 2 is the same blank; past 168 h (GFS raster) it trips', () => {
    window.activeModel = 'ICON';
    const map = makeMap(); const p = props(map, 'swell_2'); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [250], seconds: 30, bucket: SLOW });
    expect(p.setWebglMarineFailed).not.toHaveBeenCalled();
    window.activeTimeOffsetHours = 200;
    drive(map, clock, { intervals: [250], seconds: 14, bucket: SLOW });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('CONTROL: EURO Waves and GFS Swell have a raster: slow frames trip as before', () => {
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

  it('live metadata decides when it is there: an ecmwf_wam025 list that carries swell makes EURO Swell drawable', () => {
    MODEL_METADATA_CACHE.ecmwf_wam025 = { ...savedMeta.ecmwf_wam025, variables: ['wave_height', 'swell_wave_height'], sourceMetadata: {} };
    window.activeModel = 'EURO';
    const map = makeMap(); const p = props(map, 'swell_1'); const clock = installClock();
    renderHook(() => useWebGLGuardrail(p));
    drive(map, clock, { intervals: [250], seconds: 30, bucket: SLOW });
    expect(p.setWebglMarineFailed).toHaveBeenCalledWith(true);
  });

  it('POSITIVE CONTROL (the kill): __RAW_DISABLE_GUARDRAIL_BLANK_GUARD__ trips into the blank sea again', () => {
    window.__RAW_DISABLE_GUARDRAIL_BLANK_GUARD__ = true; window.activeModel = 'EURO';
    const map = makeMap(); const p = props(map, 'swell_1'); const clock = installClock();
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
