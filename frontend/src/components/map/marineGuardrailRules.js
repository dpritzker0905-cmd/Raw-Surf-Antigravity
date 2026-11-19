/**
 * marineGuardrailRules.js: what useWebGLGuardrail may count as a slow marine renderer, and when its fallback has anything to draw.
 * Pure helpers (the hook keeps the state). Each rule has its own kill switch, read at call time.
 *
 * THROTTLE CADENCE (2026-10-27, the lead's live tab: rAF 1.1/s, largest interval 1015 ms, visible and focused): a low-FPS window
 * whose every frame interval is >= THROTTLE_CADENCE_MIN_MS (the 2000 ms suspend gate is the hook's) with measured cheap marine draws
 * is the browser pausing us. Kill: window.__RAW_DISABLE_GUARDRAIL_THROTTLE_CADENCE__ = true.
 * MAIN-THREAD LOAD (2026-10-28, the lead's live session: 3,522 long tasks in 54 min, gaps 300-7,000 ms): a low-FPS window with
 * measured cheap marine draws whose main thread spent >= MAIN_THREAD_BUSY_FRACTION of it in long tasks is load the raster fallback
 * does not remove (series decode, land mask). Cheap draws on a quiet main thread still count (a GPU-bound device: the CPU-call
 * histogram cannot see GPU completion). Kill: window.__RAW_DISABLE_GUARDRAIL_MAIN_THREAD__ = true.
 * BLANK GUARD (2026-10-28, the same session's third trip: EURO + Swell, a blank sea; the owner: never a blank frame): the hook does
 * not engage a fallback that has nothing to draw. Then the fallback was Open-Meteo raster tiles and the question was whether that
 * provider's model carried the layer's variable. Since 2026-11-18 (Open-Meteo exit row 12) the fallback paints OUR OWN grid, the
 * one the engine holds, so EURO and ICON swell draw like any other layer and the question is only whether that grid can be painted
 * as height (marineFallbackDrawable). No third party's variable list is consulted. Kill:
 * window.__RAW_DISABLE_GUARDRAIL_BLANK_GUARD__ = true.
 */
import { ownMarineFallbackKilled } from './marineFallbackField';

export const THROTTLE_CADENCE_MIN_MS = 900;
export const MAIN_THREAD_BUSY_FRACTION = 0.5;
const W = () => (typeof window !== 'undefined' ? window : {});
export const ruleKilled = (name) => W()[`__RAW_DISABLE_GUARDRAIL_${name}__`] === true;

/** { calls, slow }: the engine's marine render calls so far and those >= 33.3 ms; null when unreadable. Never throws. */
export function readMarineCallCost(win) {
  try {
    const h = win && win.__RAW_GPU__ && win.__RAW_GPU__.frameTimeHistogram;   // [<8, <16.6, <33.3, <66.6, >=66.6] ms
    if (!Array.isArray(h) || h.length !== 5) return null;
    const calls = h[0] + h[1] + h[2] + h[3] + h[4]; const slow = h[3] + h[4];
    return Number.isFinite(calls) && Number.isFinite(slow) && slow >= 0 && calls >= slow ? { calls, slow } : null;
  } catch (e) { return null; }   // a diagnostic must never break the guard
}

/**
 * Main-thread long tasks, kept for the windows still open. `busyFraction(start, end)`: the share of [start, end] spent in long tasks,
 * or null when the browser has no Long Tasks API (then the window is judged as before). Never throws.
 */
export function createLongTaskMeter(Observer) {
  let observer = null; let entries = [];
  const take = (list) => { for (const e of list || []) if (e && Number.isFinite(e.startTime) && Number.isFinite(e.duration)) entries.push({ s: e.startTime, e: e.startTime + e.duration }); };
  try {
    if (Observer && Array.isArray(Observer.supportedEntryTypes) && Observer.supportedEntryTypes.includes('longtask')) {
      observer = new Observer((list) => { try { take(list.getEntries()); } catch (e) { /* never break the guard */ } });
      observer.observe({ entryTypes: ['longtask'] });
    }
  } catch (e) { observer = null; }
  return {
    busyFraction(start, end) {
      if (!observer || !(end > start)) return null;
      try { take(observer.takeRecords()); } catch (e) { return null; }
      entries = entries.filter((x) => x.e > start - 5000);
      let busy = 0;
      for (const x of entries) busy += Math.max(0, Math.min(x.e, end) - Math.max(x.s, start));
      return Math.min(1, busy / (end - start));
    },
    dispose() { try { if (observer) observer.disconnect(); } catch (e) { /* ignore */ } observer = null; entries = []; },
  };
}

/** Why a closed low-FPS window is not evidence ('throttle' | 'main_thread'), or null when it counts. */
export function lowFpsExemption({ cadence, cheap, busyFraction }) {
  if (!cheap) return null;                                                     // a slow or unmeasured draw: the renderer may be the cost
  if (cadence && !ruleKilled('THROTTLE_CADENCE')) return 'throttle';
  if (Number.isFinite(busyFraction) && busyFraction >= MAIN_THREAD_BUSY_FRACTION && !ruleKilled('MAIN_THREAD')) return 'main_thread';
  return null;
}

/**
 * Can the failed-engine fallback draw the sea NOW? { drawable, why }; drawable null when unknown (the engine holds no grid to
 * judge by). The fallback paints the grid the engine itself holds (marineFallbackField), for any model, layer and hour, so the
 * only things it cannot draw are a surf-rating grid (its height field carries scores) and anything at all under its own kill.
 */
export function marineFallbackDrawable(win = W()) {
  const eng = win.__MARINE_ENGINE__; const grid = eng && eng._waveData && eng._waveData.waveGrid;
  const why = ownMarineFallbackKilled(win) ? 'killed' : (grid && grid.ratingMode ? 'rating_grid' : null);
  return { drawable: why ? false : (grid ? true : null), why };
}
