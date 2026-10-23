/**
 * windFramePrefetch.js — the GFS wind run, fetched from the CDN BEFORE the wind layer is shown (2026-10-22, the wind instant
 * scrub), so a toggle to wind and every scrub step after it are served from bytes already here (windStaticFrames: a frame is a
 * ~1-3 ms parse + build, no network).
 *
 * POLICY (the marine frame store's, #437/#455/#457; marineFramePrefetch.createPrefetcher runs the loop):
 *   - DESKTOP (marineFrameStore.resolveTier 'desktop', no Save-Data, not 2g, a fine pointer, a visible tab; a desktop reading 3g
 *     fills, D-048): once the map has been up IDLE_START_MS (the shown layer's own first frames go first), the whole wind run is
 *     fetched nearest the timeline cursor first, at most CAP_IDLE requests in flight while another layer is shown, CAP_ACTIVE
 *     while wind is. ~51 KB a frame, 113 frames: ~5.8 MB per run (measured on the real 2026-10-22 12Z run).
 *   - PHONES, Save-Data, 2g: nothing while another layer is shown; with wind shown, the +-WINDOW_SLOW frames around the cursor.
 *   - Never an unbuilt frame (`path: null`: /grid serves it) and never a frame the lane check refuses (windStaticFrames.laneVerdict).
 * Kills (read per call): window.__RAW_DISABLE_WIND_PREFETCH__ = true (no prefetch: frames load on demand, one per step), and the
 * static wind kills. Lever: window.__RAW_WIND_PREFETCH_IDLE__ = false fetches nothing until wind is shown (then the desktop policy).
 * Telemetry: window.__RAW_WIND_STATIC__.prefetch.
 */
import { createPrefetcher, nearestFirst, WINDOW_SLOW } from './marineFramePrefetch';
import { resolveTier } from './marineFrameStore';
import { isHandheldDevice, isWeakDevice } from './deviceTier';
import { windLaneDisabled } from './windLane';
import {
  WIND_SET_KEY, fetchWindFrame, hasRaw, laneVerdict, readLanePointer, windIndex, windIndexSync, windStaticEnabled,
} from './windStaticFrames';

export const IDLE_START_MS = 8000;   // after the map is up: the shown layer's first draw and first frames go first
export const CAP_IDLE = 2;           // in flight while another layer is shown
export const CAP_ACTIVE = 4;         // while wind is shown (the marine cap)

const W = () => (typeof window !== 'undefined' ? window : {});
// Not with the HRRR lane switched off for this session (wind_lane=gfs): static wind frames carry the lane and are never served then.
export const windPrefetchOn = () => windStaticEnabled() && W().__RAW_DISABLE_WIND_PREFETCH__ !== true && !windLaneDisabled();

/** Why the whole run may not stream now, or null (marineFrameStoreRuntime.idleFillBlocker's rules). */
export function fillBlocker(facts) {
  const w = W();
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const conn = (facts && facts.connection) || nav.connection || null;
  let handheld = false; let weak = false;
  try { handheld = isHandheldDevice(); weak = isWeakDevice(); } catch (e) { /* defaults */ }
  const tier = resolveTier({ handheld, weak, deviceMemoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    saveData: !!(conn && conn.saveData), effectiveType: (conn && conn.effectiveType) || null }, w);
  if (tier !== 'desktop') return 'tier';
  if (conn && conn.saveData === true) return 'save_data';
  if (conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) return 'slow_link';
  try { if (typeof w.matchMedia === 'function' && w.matchMedia('(pointer: coarse)').matches) return 'coarse_pointer'; } catch (e) { /* none */ }
  if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return 'hidden';
  return null;
}

/** The plan: built, lane-served frames of the run, nearest `cursorIso` first; `radius` frames each side (Infinity = all). */
export function planWind(index, ptr, cursorMs, radius = Infinity, now = Date.now()) {
  if (!index || !Array.isArray(index.frames)) return [];
  const frames = index.frames.filter((f) => f.path && !f.is_estimated).sort((a, b) => Date.parse(a.valid_time) - Date.parse(b.valid_time));
  if (!frames.length) return [];
  let c = 0; let best = Infinity;
  frames.forEach((f, i) => { const d = Math.abs(Date.parse(f.valid_time) - cursorMs); if (d < best) { best = d; c = i; } });
  const out = [];
  for (const i of nearestFirst(frames.length, c, 1, radius)) {
    const f = frames[i];
    if (laneVerdict(index, f, ptr, now).refuse) continue;
    out.push({ key: WIND_SET_KEY, validTime: f.valid_time, path: f.path });
  }
  return out;
}

const rt = { prefetcher: null, entries: new Map(), index: null, timer: null, startedAt: 0, windActive: false, cursorMs: null,
  opened: false, onVis: null };

function entryStore() {
  const get = (vt) => rt.entries.get(vt) || null;
  return {
    entry: (key, vt) => get(vt),
    markInflight: (key, vt) => { const e = get(vt); if (!e || e.state !== 'absent') return false; e.state = 'inflight'; return true; },
    markAbsent: (key, vt) => { const e = get(vt); if (e && e.state === 'inflight') e.state = 'absent'; },
    putPacked: (key, vt) => { const e = get(vt); if (!e) return false; e.state = 'done'; return true; },
    markUnpackable: (key, vt) => { const e = get(vt); if (e) e.state = 'done'; },
  };
}

function telemetry() {
  const w = W();
  const t = (w.__RAW_WIND_STATIC__ = w.__RAW_WIND_STATIC__ || { misses: {} });
  t.prefetch = { ...(rt.prefetcher ? rt.prefetcher.telemetry() : {}), opened: rt.opened, windActive: rt.windActive,
    blocked: fillBlocker(), done: [...rt.entries.values()].filter((e) => e.state === 'done').length, planned: rt.entries.size,
    sinceStartMs: rt.startedAt ? Date.now() - rt.startedAt : null };
  return t.prefetch;
}

function replan() {
  if (!rt.prefetcher || !windPrefetchOn()) return;
  const index = windIndexSync();
  if (!index) return;
  if (index !== rt.index) {                   // a new run: forget the old run's entries (its bytes go with the pin)
    rt.index = index;
    rt.entries.clear();
    for (const f of index.frames) if (f.path) rt.entries.set(f.valid_time, { path: f.path, state: hasRaw(f.path) ? 'done' : 'absent' });
  }
  for (const e of rt.entries.values()) if (e.state === 'absent' && hasRaw(e.path)) e.state = 'done';   // landed on demand meanwhile
  const blocked = fillBlocker();
  const idleOk = W().__RAW_WIND_PREFETCH_IDLE__ !== false;
  let radius;
  if (rt.windActive) radius = blocked ? WINDOW_SLOW : Infinity;
  else radius = (!blocked && idleOk) ? Infinity : -1;
  const plan = radius < 0 ? [] : planWind(index, laneOf(), rt.cursorMs == null ? Date.now() : rt.cursorMs, radius);
  rt.prefetcher.replan(plan, rt.windActive ? WIND_SET_KEY : null, { slow: !rt.windActive });
  if (!rt.opened && (rt.windActive || Date.now() - rt.startedAt >= IDLE_START_MS)) { rt.opened = true; rt.prefetcher.open(); }
  telemetry();
}

let _laneRef = null;
function laneOf() { return _laneRef; }

/**
 * Start the runtime for a map session. `getCursorMs()` returns the timeline's selected valid time (ms). Returns a stop function.
 * The caller tells it about the wind layer and the cursor through noteWind().
 */
export function startWindPrefetch() {
  if (rt.prefetcher || !windPrefetchOn()) return () => {};
  rt.startedAt = Date.now();
  rt.prefetcher = createPrefetcher({ store: entryStore(), fetchFrame: fetchWindFrame, decodeAndPack: () => ({ ok: true }),
    onStale: () => { /* a 404/400: staticFrames re-pins on its next load */ }, cap: CAP_ACTIVE });
  const kick = async () => {
    try {
      const [, ptr] = await Promise.all([windIndex(), readLanePointer(false)]);
      _laneRef = ptr;
    } catch (e) { /* replan with what we have */ }
    replan();
  };
  rt.timer = setInterval(kick, 30000);        // the pin and the lane pointer move on their own clocks (re-checked, CDN only)
  // Pin the run early (one small index read), then open exactly at IDLE_START_MS: an open check that fires before the gate (it was
  // 7 s against 8 s) waited for the 30 s re-check, so the run arrived only after the toggle (measured 2026-10-22: 140 ms vs 7 ms).
  setTimeout(kick, Math.max(0, IDLE_START_MS - 2000));
  setTimeout(kick, IDLE_START_MS);
  if (typeof document !== 'undefined') {
    rt.onVis = () => replan();
    document.addEventListener('visibilitychange', rt.onVis);
  }
  return stopWindPrefetch;
}

export function stopWindPrefetch() {
  if (rt.timer) clearInterval(rt.timer);
  if (rt.onVis && typeof document !== 'undefined') document.removeEventListener('visibilitychange', rt.onVis);
  rt.prefetcher = null; rt.timer = null; rt.onVis = null; rt.opened = false; rt.entries.clear(); rt.index = null;
}

/** The wind layer was shown / hidden, or the timeline moved: re-plan (cheap; nothing starts before the run is pinned). */
export function noteWind({ windActive, cursorMs } = {}) {
  if (typeof windActive === 'boolean' && windActive !== rt.windActive) {
    rt.windActive = windActive;
    if (windActive) {
      Promise.all([windIndex(), readLanePointer(false)]).then(([, ptr]) => { _laneRef = ptr; replan(); }).catch(() => replan());
    }
  }
  if (Number.isFinite(cursorMs)) rt.cursorMs = cursorMs;
  replan();
}

export function _resetWindPrefetchForTest() { stopWindPrefetch(); rt.windActive = false; rt.cursorMs = null; rt.startedAt = 0; _laneRef = null; }
