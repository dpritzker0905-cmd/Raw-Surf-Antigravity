/**
 * marineStaleHourLayer.js — the custom layer's half of the wrong-hour fix (see marineStaleHour.js for the defect and the
 * rules). It reads the selected instant through `displayedForecastTime`, the SAME function the timeline's readout uses, so the
 * dim and the readout can never disagree about which hour is selected. Kept apart from the pure module because that read
 * pulls in the backend client, and the engine (which imports the pure module) must not.
 */
import { displayedForecastTime } from './forecastReadout';
import { getCachedManifest } from './backendWeatherServiceClientCoverage';
import { resolveStaleWorldDim, judgeStaleWorld } from './marineStaleHour';

/** How long a resolved selected instant is reused: the manifest scan behind it is far too heavy to run every frame. */
export const SELECTED_MEMO_MS = 2000;

const _selMemo = { key: '', manifest: null, at: 0, ms: NaN };

/** The selected hour as an instant (the readout's own function), memoised per {hour, layer, model} and manifest. */
export function selectedInstantMs(hour, layer, model, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  let man = null;
  try { man = getCachedManifest(); } catch (e) { man = null; }
  const key = `${hour}|${layer}|${model}`;
  if (_selMemo.key === key && _selMemo.manifest === man && now - _selMemo.at < SELECTED_MEMO_MS) return _selMemo.ms;
  let ms = NaN;
  try { ms = displayedForecastTime(hour, layer, model).ms; } catch (e) { ms = NaN; }
  _selMemo.key = key; _selMemo.manifest = man; _selMemo.at = now; _selMemo.ms = ms;
  return ms;
}

/** Test seam: the memo outlives a Jest module registry reset of its consumers. */
export function _resetSelectedMemoForTest() {
  _selMemo.key = ''; _selMemo.manifest = null; _selMemo.at = 0; _selMemo.ms = NaN;
}

/**
 * The layer's call, once per frame: the multiplier for this frame's opacity (and the telemetry in window.__RAW_GPU__.staleHour). It also
 * leaves the engine the selected instant (`engine.__staleSwapMs`) in the frames where the drawn world frame is for another hour and the
 * hour has held still, and null otherwise: the engine's per-frame zoom-out bridge reads it (marineCommitGate.shouldBridgeToCoarseGlobal)
 * to promote the held base when that is the selected hour. The two consumers have separate kill switches
 * (__RAW_DISABLE_STALE_HOUR_DIM__, __RAW_DISABLE_STALE_RESIDENT_SWAP__). A THIRD reader, the base-aware bridge (audit F-22, 2026-10-02), gets the
 * selected instant EVERY frame as `engine.__selectedMs` (null when unknown, and with both switches on: the readout is then not consulted, and
 * the bridge's new band keeps the old rule, because an unknown hour fails closed there). `layers` is the active layer list. Never throws.
 */
export function staleWorldDimMult(engine, tracker, hour, layers, model, win, nowMs) {
  try {
    const w = win || (typeof window !== 'undefined' ? window : null);
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    const held = tracker.heldMs(hour, now);
    const resident = engine && engine._waveData && engine._waveData.waveGrid;
    if (!resident) { if (engine) { engine.__staleSwapMs = null; engine.__selectedMs = null; } return 1; }
    const layer = (layers || []).find((l) => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
    const bothKilled = !!(w && w.__RAW_DISABLE_STALE_HOUR_DIM__ === true && w.__RAW_DISABLE_STALE_RESIDENT_SWAP__ === true);
    const selectedMs = bothKilled ? NaN : selectedInstantMs(hour, layer, model || 'GFS', now);
    engine.__selectedMs = Number.isFinite(selectedMs) ? selectedMs : null;   // F-22: the bridge's band rule asks whether the held base is THIS hour
    const ctx = { resident, selectedMs, hourHeldMs: held, win: w };
    const r = resolveStaleWorldDim(ctx);
    const swap = judgeStaleWorld(ctx).why === 'stale_world';
    engine.__staleSwapMs = swap ? selectedMs : null;
    if (w && w.__RAW_GPU__) w.__RAW_GPU__.staleHour = { why: r.why, stale: r.stale, mult: r.mult, heldMs: Math.round(held), swap };
    return r.mult;
  } catch (e) {
    return 1;
  }
}
