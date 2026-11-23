/**
 * cacheBudget.js — ONE byte budget across the map client's evictable caches (2026-11-23; the inspection's pass 5,
 * SOTA-GAP-INSPECTION-2026-11-23: the JS heap 106 MB -> 1.8-2.1 GB over a 21-layer scrub cycle, resting at 0.8-1.1 GB).
 *
 * MEASURED (offline replay, scn_heap_cycle.js + heap_census.cjs, dev 70e3efef1): after one cycle 985 MB retained, of which the
 * decoded .om fields on window held 280 MB, the frame store's CPU side 92 MB, the per-hour marine grids 120 MB, the series pages
 * 91 MB, the raster fields 99 MB, the wind grids ~64 MB. Every one was bounded by an entry COUNT (or nothing), never by bytes,
 * and none knew which model or layer was on screen.
 *
 * THE RULE. Each cache registers an adapter: `entries()` lists what it holds as { key, bytes, model, layer, lastUse, pinned, id }
 * (an O(1) size per entry: typed arrays by byteLength, object grids by cells x a per-cell constant; never building a lazy frame),
 * and `drop(key)` removes one synchronously (no insert) and returns the bytes it freed. When the total passes the budget, entries
 * are dropped until the total is under LOW_WATER of it, in this order:
 *   1. OFF-SCREEN: another model or another layer than the active view (useWeatherState: activeModel, activeLayers[0]);
 *   2. then the active view's own entries.
 * Within a class: the adapter's `cost` first, then least recently used. COST = what a revisit pays to rebuild it, per MB held:
 *   0 decoded .om copies (infobox only)  1 raster fields (one CDN frame)  2 series pages, frame-store sets (CDN frames)
 *   3 per-hour /grid grids (a backend build each)  4 wind grids (~1.5 MB each; a cold wind step measured ~7.8 s offline).
 * Never a PINNED entry: an adapter pins the active view's entries at the current hour and its neighbours (the page holding it, the
 * store set being scrubbed), so instant scrub on the active model and layer keeps its working set (review 2026-11-23: SubQ,
 * Reflection and LongCat each replaced a wall-clock guard with explicit pins). An `id` (the shared vectors array, the field) makes an
 * alias held by two keys count once.
 * Enforce runs off the insert path: coalesced into one idle callback (requestIdleCallback, 500 ms timeout; setTimeout elsewhere),
 * never re-entered. Each cache keeps its own count bound as the inner limit; this only removes more.
 * Budgets: 192 MB of cache on a desktop, 128 MB on a handheld (deviceTier.isHandheldDevice, or navigator.deviceMemory <= 4). The
 * offline phone A/B (375 px): 64 MB dropped the active view's own entries (91 per cycle, the pinned set over budget 9 times) and
 * doubled the marine scrub p95; 128 MB dropped none (marine p95 38 ms) and still retained 306-326 MB against 821-910 MB without it.
 * Lever: window.__RAW_CACHE_BUDGET_MB__ = <MB>. Telemetry: window.__RAW_CACHE_BUDGET__.report().
 * Kill: window.__RAW_DISABLE_CACHE_BUDGET__ = true (read on every enforce: nothing is dropped, every cache keeps today's bound).
 */
import { isHandheldDevice } from './deviceTier';
import { windParticlesWanted } from './gustParticles';

export const DESKTOP_BUDGET_MB = 192;
export const HANDHELD_BUDGET_MB = 128;
export const LOW_WATER = 0.8;
const MB = 1048576;
const W = () => (typeof window !== 'undefined' ? window : null);

export const cacheBudgetOn = (win = W()) => !(win && win.__RAW_DISABLE_CACHE_BUDGET__ === true);

/** A handheld, or a device reporting 4 GB of memory or less. */
export function smallDevice() {
  try { return isHandheldDevice() || (typeof navigator !== 'undefined' && Number(navigator.deviceMemory) > 0 && navigator.deviceMemory <= 4); } catch (e) { return false; }
}

/** The budget in bytes for this device (the lever first). */
export function cacheBudgetBytes(win = W()) {
  const lever = win && Number(win.__RAW_CACHE_BUDGET_MB__);
  if (lever > 0) return lever * MB;
  return (smallDevice() ? HANDHELD_BUDGET_MB : DESKTOP_BUDGET_MB) * MB;
}

/**
 * THE DEAR RESERVE (small devices; round-2 review 2026-11-23, SubQ and Reflection agreeing): strict off-screen-first left a phone's
 * wind revisits cold (cycle-2 wind steps p50 7.8 s ON vs 43 ms killed): the other models' wind grids are off-screen while the user is
 * on another layer, so they went before that layer's own non-pinned prefetch. On a small device the most recently used DEAR
 * off-screen entries (cost >= RESERVE_COST: wind grids, ~1.5 MB each, a cold wind step ~7.8 s), up to RESERVE_MB, go AFTER the
 * on-screen ones; the rest keep the strict order, so the reserve can never starve the active view of more than RESERVE_MB.
 * Desktop keeps the strict order (its wind revisits already matched the killed arm). Lever: window.__RAW_CACHE_RESERVE_MB__.
 */
export const RESERVE_COST = 4;
export const RESERVE_MB = 32;
function reservedSet(candidates, win = W()) {
  const lever = win && Number(win.__RAW_CACHE_RESERVE_MB__);
  const cap = (lever >= 0 && win && win.__RAW_CACHE_RESERVE_MB__ !== undefined ? lever : (smallDevice() ? RESERVE_MB : 0)) * MB;
  const out = new Set();
  if (!(cap > 0)) return out;
  let kept = 0;
  for (const e of candidates.filter((x) => x.cost >= RESERVE_COST && !onScreen(x)).sort((a, b) => (b.lastUse || 0) - (a.lastUse || 0))) {
    if (kept + e.bytes > cap) break;
    kept += e.bytes; out.add(e);
  }
  return out;
}

// ---- one vocabulary for model and layer across caches ----
/** GFS / EURO / ICON from any model id a cache keys on (ncep_gfs013, ecmwf_ifs025, dwd_icon, gwam ...); null when none. */
export function normModel(m) {
  const s = String(m || '').toLowerCase();
  if (/^(gfs|ncep|noaa|hrrr)/.test(s)) return 'GFS';   // HRRR is the GFS view's wind lane (D-017)
  if (/^(euro|ecmwf|ifs|wam)/.test(s)) return 'EURO';
  if (/^(icon|dwd|gwam)/.test(s)) return 'ICON';
  return null;   // CMEMS currents and anything unknown: model-agnostic (matched on the layer alone)
}
const LAYERS = {
  waves: 'waves', swell_1: 'swell_1', swell: 'swell_1', swell_2: 'swell_2', wind_waves: 'wind_waves', all: null,
  wind: 'wind', gust: 'gusts', gusts: 'gusts', wind_gusts_10m: 'gusts', currents: 'currents', current: 'currents',
  cloud_cover: 'satellite', satellite: 'satellite', temperature: 'temperature', temperature_2m: 'temperature',
  water_temp: 'water_temp', surface_temperature: 'water_temp', sea_surface_temperature: 'water_temp',
  pressure: 'pressure', pressure_msl: 'pressure', precipitation: 'rain', rain: 'rain', fog: 'fog', visibility: 'fog',
  wave_height: 'waves', swell_wave_height: 'swell_1', secondary_swell_wave_height: 'swell_2', wind_wave_height: 'wind_waves',
};
/** The layer chip id for any layer / variable / set name a cache keys on; null when unknown (then it matches no view). */
export function normLayer(l) {
  const s = String(l || '').toLowerCase().replace(/~surf$/, '');
  return Object.prototype.hasOwnProperty.call(LAYERS, s) ? LAYERS[s] : null;
}

/** A Map whose get() stamps the entry's `__used` (the budget's recency) for a cache that had no LRU of its own. */
export class RecencyMap extends Map {
  get(key) { const v = super.get(key); if (v && typeof v === 'object') v.__used = Date.now(); return v; }
}

// ---- the registry ----
const caches = new Map();
const EMPTY = Object.freeze(new Set());
let active = { model: null, layers: EMPTY, layer: null, hour: null };
let pending = false; let enforcing = false;
const stats = { enforces: 0, dropped: { offscreen: 0, active: 0 }, freedMB: 0, byCache: {}, overPinned: 0, last: null, ring: [] };

/** The active view adapters pin against: the model, the SET of layers whose data is on screen, the hour offset. */
export function activeView() { return active; }

/**
 * THE LAYERS ON SCREEN (the advisor's hold on #1247, 2026-11-23): the view is a SET, not activeLayers[0]. Every active layer is on
 * screen, and so is the data another layer DRAWS WITH: the wind particles run for Wind and for Gusts (gustParticles
 * windParticlesWanted: a Gusts view moves its particles along the wind grids), so `wind` is on screen whenever the particles are.
 * Before this, a Gusts view counted its own wind grids off-screen and dropped them first, and a wind overlay beside a marine layer
 * would have too.
 */
export function viewLayers(activeLayers) {
  const raw = Array.isArray(activeLayers) ? activeLayers : (activeLayers ? [activeLayers] : []);
  const set = new Set(raw.map(normLayer).filter(Boolean));
  if (windParticlesWanted(raw)) set.add('wind');
  return set;
}

/** True when an entry belongs to a layer on screen (a model-agnostic entry, model null, matches on its layer alone). */
export function onScreen(e, view = active) {
  const layers = view.layers || (view.layer ? new Set([view.layer]) : EMPTY);
  if (!e.layer || !layers.has(e.layer)) return false;
  return !e.model || !view.model || e.model === view.model;
}

/** From the app's weather state: `layers` = activeLayers (a `layer` alone is accepted too). */
export function noteActiveView({ model, layers, layer, hour } = {}) {
  const set = viewLayers(layers !== undefined ? layers : layer);
  const next = { model: normModel(model), layers: set, layer: set.values().next().value || null, hour: Number.isFinite(Number(hour)) ? Number(hour) : null };
  const moved = next.model !== active.model || next.layers.size !== active.layers.size || [...next.layers].some((l) => !active.layers.has(l));
  active = next;
  if (moved) scheduleCacheBudget('view');
}

/** Register a cache. `cost` 0 = cheapest to lose first. Returns an unregister function. */
export function registerCache(name, { entries, drop, cost = 1 }) {
  caches.set(name, { entries, drop, cost });
  scheduleCacheBudget('register');
  return () => caches.delete(name);
}

/** A cache grew: one enforce is scheduled (coalesced; off the insert path). */
export function noteCacheGrowth() { scheduleCacheBudget('growth'); }

export function scheduleCacheBudget(reason) {
  if (pending || !cacheBudgetOn()) return;
  pending = true;
  const run = () => { pending = false; enforceCacheBudget(reason); };
  const w = W();
  if (w && typeof w.requestIdleCallback === 'function') w.requestIdleCallback(run, { timeout: 500 });
  else setTimeout(run, 50);
}

function collect() {
  const all = [];
  for (const [name, c] of caches) {
    let list = [];
    try { list = [...(c.entries() || [])]; } catch (e) { list = []; }
    for (const e of list) if (e && Number(e.bytes) > 0) all.push({ ...e, cache: name, cost: Number.isFinite(e.cost) ? e.cost : c.cost });
  }
  return all;
}

/** Sum bytes counting every id once (an alias held under two keys, or by two caches). */
function totalOf(list, refs) {
  let total = 0;
  for (const e of list) {
    if (e.id == null) { total += e.bytes; continue; }
    const n = refs.get(e.id) || 0;
    if (n === 0) total += e.bytes;
    refs.set(e.id, n + 1);
  }
  return total;
}

/** Drop entries until the total is under LOW_WATER x budget (only when over budget). Synchronous; returns what it did. */
export function enforceCacheBudget(reason = 'manual') {
  if (!cacheBudgetOn() || enforcing) return null;
  enforcing = true;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const budget = cacheBudgetBytes();
    const list = collect(); const refs = new Map();
    let total = totalOf(list, refs);
    const out = { reason, budgetMB: +(budget / MB).toFixed(1), beforeMB: +(total / MB).toFixed(1), dropped: 0 };
    stats.enforces += 1;
    if (total > budget) {
      const target = budget * LOW_WATER;
      const candidates = list.filter((e) => !e.pinned);
      const reserve = reservedSet(candidates);
      // rank: 0 off-screen, 1 on-screen (not pinned), 2 the small device's dear reserve (off-screen, but after the on-screen ones)
      const order = candidates.map((e) => ({ e, off: onScreen(e) ? 1 : 0, rank: reserve.has(e) ? 2 : (onScreen(e) ? 1 : 0) }))
        .sort((a, b) => (a.rank - b.rank) || (a.e.cost - b.e.cost) || ((a.e.lastUse || 0) - (b.e.lastUse || 0)));
      for (const { e, off } of order) {
        if (total <= target) break;
        const c = caches.get(e.cache);
        let freed = 0;
        try { freed = c ? c.drop(e.key) : 0; } catch (err) { freed = 0; }
        if (freed === null) continue;   // already gone
        if (e.id != null) {
          const n = (refs.get(e.id) || 1) - 1; refs.set(e.id, n);
          if (n === 0) total -= e.bytes;
        } else total -= e.bytes;
        out.dropped += 1; stats.dropped[off ? 'active' : 'offscreen'] += 1;
        const bc = (stats.byCache[e.cache] = stats.byCache[e.cache] || { dropped: 0, freedMB: 0 });
        bc.dropped += 1; bc.freedMB = +(bc.freedMB + e.bytes / MB).toFixed(1);
        stats.freedMB = +(stats.freedMB + e.bytes / MB).toFixed(1);
      }
      if (total > budget) stats.overPinned += 1;   // what is left is pinned (the active view's working set): logged, never dropped
    }
    out.afterMB = +(total / MB).toFixed(1);
    out.ms = +((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(1);
    stats.last = out;
    if (out.dropped) { stats.ring.push({ t: Math.round(t0), ...out }); if (stats.ring.length > 400) stats.ring.shift(); }
    return out;
  } finally { enforcing = false; }
}

/** Bytes and entries per cache (pinned apart), the total, the budget, the active view and what was dropped. */
export function cacheBudgetReport() {
  const list = collect(); const per = {};
  for (const e of list) {
    const p = (per[e.cache] = per[e.cache] || { entries: 0, mb: 0, pinnedMB: 0, onScreenMB: 0 });
    p.entries += 1; p.mb += e.bytes / MB; if (e.pinned) p.pinnedMB += e.bytes / MB; if (onScreen(e)) p.onScreenMB += e.bytes / MB;
  }
  for (const p of Object.values(per)) { p.mb = +p.mb.toFixed(1); p.pinnedMB = +p.pinnedMB.toFixed(1); p.onScreenMB = +p.onScreenMB.toFixed(1); }
  return { on: cacheBudgetOn(), budgetMB: +(cacheBudgetBytes() / MB).toFixed(1), totalMB: +(totalOf(list, new Map()) / MB).toFixed(1),
    active: { model: active.model, layers: [...active.layers], hour: active.hour }, caches: per, stats: JSON.parse(JSON.stringify(stats)) };
}

if (typeof window !== 'undefined' && !window.__RAW_CACHE_BUDGET__) {
  Object.defineProperty(window, '__RAW_CACHE_BUDGET__', { configurable: true, value: { report: cacheBudgetReport, enforce: () => enforceCacheBudget('manual') } });
}

export function _resetCacheBudgetForTest() {
  caches.clear(); active = { model: null, layers: EMPTY, layer: null, hour: null }; pending = false; enforcing = false;
  Object.assign(stats, { enforces: 0, dropped: { offscreen: 0, active: 0 }, freedMB: 0, byCache: {}, overPinned: 0, last: null, ring: [] });
}
