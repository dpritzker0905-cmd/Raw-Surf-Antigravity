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
 * BLANK GUARD (2026-10-28, the same session's third trip: EURO + Swell, a blank sea): the fallback is Open-Meteo raster tiles, and a
 * raster model without the layer's variable draws a transparent tile (useOpenMeteoTileUrls: no cross-model fallback). The variable
 * lists are MODEL_METADATA_CACHE's: the bootstrap lists until live metadata replaces them. Kill:
 * window.__RAW_DISABLE_GUARDRAIL_BLANK_GUARD__ = true.
 */
import { LAYER_REGISTRY, MARINE_MODEL_MAP, MODEL_METADATA_CACHE } from './LayerRegistry';
import { ICON_MARINE_RASTER_CUTOVER_H, EURO_MARINE_RASTER_CUTOVER_H } from './modelHorizons';

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

/** Can the raster fallback draw (model, layer, hour)? { drawable, rasterModel, variable }; drawable null when unknown. */
export function marineFallbackDrawable({ model, layer, hour }) {
  const entry = LAYER_REGISTRY[layer];
  const variable = entry && entry.omVariable;
  let rasterModel = MARINE_MODEL_MAP[model] || 'ncep_gfswave025';
  if (rasterModel === 'dwd_gwam' && hour > ICON_MARINE_RASTER_CUTOVER_H) rasterModel = 'ncep_gfswave025';   // useOpenMeteoTileUrls.resolveModel
  if (rasterModel === 'ecmwf_wam025' && hour > EURO_MARINE_RASTER_CUTOVER_H) rasterModel = 'ncep_gfswave025';
  const vars = MODEL_METADATA_CACHE[rasterModel] && MODEL_METADATA_CACHE[rasterModel].variables;
  return { drawable: variable && Array.isArray(vars) ? vars.includes(variable) : null, rasterModel, variable: variable || null };
}
