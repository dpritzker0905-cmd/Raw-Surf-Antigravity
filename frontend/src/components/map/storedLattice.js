/**
 * storedLattice.js — which stored frame answers a selection, read from the cached products manifest (D8, the lead's offline
 * erratic fuzzer 2026-10-27: 92 overbroad "nearest" claims, one held 22.5 s).
 *
 * The status line calls a drawn frame "the nearest stored forecast" when it is within a half-step of the selection. The half-step
 * was keyed on the model alone: EURO past model step 144 got 3 h for EVERY layer, because ECMWF's wave stream is 6-hourly there.
 * EURO's swells and wind waves (CMEMS) are 3-hourly throughout, and every layer's 14-day tail is 3-hourly, so a frame 2-3 h off
 * was called "nearest" while the server holds one 0-1 h away (swell_2 h287, wind_waves h181 drawing h184, waves h314 drawing h312).
 *
 * The server's own rule picks the frame (grid_resolver_selection.find_candidates + mid_res_tier.pick_mid_item; the CDN frame
 * store's staticFrameCodec.pickIndexFrame): the nearest AUTHORITATIVE frame within 3 h, else the nearest estimate within 3 h,
 * the earlier one on a tie. That frame's distance IS the half-step for this selection: a drawn frame that far is the answer
 * the server gives, anything further is still owed. Kill: window.__RAW_DISABLE_LATTICE_BY_LAYER__ = true (model-only rule).
 */
import { getCachedManifest } from './backendWeatherServiceClientCoverage';

const H = 3600000;
const WINDOW_MS = 3 * H;
export const latticeByLayerOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_LATTICE_BY_LAYER__ === true);

const groupsByManifest = new WeakMap();   // manifest -> Map("MODEL|domain|layer" -> { auth: ms[], est: ms[] })
function groupsOf(manifest) {
  let g = groupsByManifest.get(manifest);
  if (g) return g;
  g = new Map();
  for (const p of manifest.products || []) {
    if (!p || typeof p.model !== 'string' || typeof p.layer !== 'string') continue;
    const ms = Date.parse(p.valid_time_start || '');
    if (!Number.isFinite(ms)) continue;
    const key = `${p.model.toUpperCase()}|${p.domain || 'marine'}|${p.layer}`;
    let e = g.get(key);
    if (!e) { e = { auth: new Set(), est: new Set() }; g.set(key, e); }
    (p.is_estimated ? e.est : e.auth).add(ms);
  }
  for (const [k, e] of g) g.set(k, { auth: [...e.auth].sort((a, b) => a - b), est: [...e.est].sort((a, b) => a - b) });
  groupsByManifest.set(manifest, g);
  return g;
}

/** The nearest time in sorted `arr` within `maxMs` of `t`, the EARLIER one on a tie; null when none. */
function nearestWithin(arr, t, maxMs) {
  let lo = 0; let hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < t) lo = mid + 1; else hi = mid; }
  let best = null;
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= arr.length) continue;
    const d = Math.abs(arr[i] - t);
    if (d <= maxMs && (best === null || d < Math.abs(best - t))) best = arr[i];
  }
  return best;
}

/**
 * The frame the server answers {model, layer} at `selectedMs` with: { pickMs, estimated, nearerEstimate } or null (no manifest,
 * or nothing stored within 3 h). `nearerEstimate`: the pick is authoritative while an estimate lies strictly closer.
 */
export function servedPick(model, layer, selectedMs) {
  const manifest = getCachedManifest();
  if (!manifest || !Array.isArray(manifest.products) || !model || !layer || !Number.isFinite(selectedMs)) return null;
  const domain = layer === 'wind' ? 'wind' : 'marine';
  const e = groupsOf(manifest).get(`${String(model).toUpperCase()}|${domain}|${layer}`);
  if (!e) return null;
  const a = nearestWithin(e.auth, selectedMs, WINDOW_MS);
  if (a !== null) {
    const est = nearestWithin(e.est, selectedMs, Math.abs(a - selectedMs));
    return { pickMs: a, estimated: false, nearerEstimate: est !== null && Math.abs(est - selectedMs) < Math.abs(a - selectedMs) };
  }
  const s = nearestWithin(e.est, selectedMs, WINDOW_MS);
  return s === null ? null : { pickMs: s, estimated: true, nearerEstimate: false };
}

/** Whole hours from the selection to the frame the server answers with (at least 1, the 3-hourly lattice's half-step), or null. */
export function servedPickHalfStep(model, layer, selectedMs) {
  if (!latticeByLayerOn()) return null;
  const p = servedPick(model, layer, selectedMs);
  return p ? Math.max(1, Math.round(Math.abs(p.pickMs - selectedMs) / H)) : null;
}
