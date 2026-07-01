// marineGridSeries.js
// Option 1 "sync upgrade" — marine time-series client (PAGED).
//
// Fetches a MULTI-HOUR marine grid in ONE request (/api/weather/grid_series) so the
// timeline scrubber can select an hour CLIENT-SIDE (instant) instead of one backend
// fetch per hour. The backend endpoint is additive and reuses the same per-hour grid
// builder /grid uses; the first hour fetches the multi-hour upstream (already returned
// by Open-Meteo/Copernicus), the rest re-slice it.
//
// PAGING (audit Finding 2): the full 0..336h window is 113 3-hourly frames, but the
// backend caps a series at 48 frames. So we split into 3-hourly PAGES of <=48 frames
// (0..141, 144..285, 288..336) and load the page containing the CURRENT hour FIRST, then
// adjacent pages during idle — instead of always starting at hour zero. Cache/in-flight
// are keyed by model+layer+viewport+page so far-hour scrubbing is instant once its page
// is loaded.
//
// SAFETY: this whole path is OFF unless window.__MARINE_SERIES__ === true. When off,
// nothing here runs and the orchestrator behaves exactly as before. When on, a series
// frame is used ONLY as an extra cache source during scrub — it commits through the
// SAME orchestrator path as a normal cached grid (parity/transition gates still apply),
// and anything missing falls back to the existing per-hour fetch.

import { API_BASE } from '../../lib/apiClient';
import { getSurfModeFlag } from './backendWeatherServiceClient';

// pageKey (model_layer_viewportKey_pN) -> { ts, frames: Map<hourOffset, marineData>, hours: number[] }
const _seriesCache = new Map();
const _inFlight = new Map();
const _idleTimers = new Set(); // pending adjacent-page prefetch timers (cleared on reset)
const SERIES_TTL_MS = 5 * 60 * 1000; // mirror backend upstream cache TTL
const SERIES_MAX = 32;              // bounded; ~10 distinct (model,layer,viewport) targets × pages
// Coarse-preview revalidation: a COLD regional viewport gets an instant GLOBAL coarse_preview from the
// backend (SWR — it builds the precise regional grid in the background). Re-fetch the page a few times,
// spaced out, until the backend returns the regional grid — else we'd cache the global frame and the
// heatmap renders coarse/clamped at the viewport forever (the zoom-out clamp). Bounded so a viewport
// that is genuinely global-only can't loop.
const COARSE_REVAL_MAX = 8;
const COARSE_REVAL_INTERVAL_MS = 1200;

// Concurrency gate for grid_series fetches. The backend is 1-CPU: firing N series requests at
// once (rapid model/layer toggling warms GFS+ICON+EURO × every layer × 3 pages) slams the box
// into 503s/timeouts so NOTHING completes — the "bottleneck after scrubbing." Cap concurrent
// fetches so the box serves them ~2 at a time and each finishes fast (no contention). Requests
// queue client-side; a request whose signal aborts while queued is dropped (never hits the box),
// so superseded model/layer warms don't pile up. Tune up once the backend has more CPU.
const MARINE_SERIES_MAX_CONCURRENT = 2;
let _seriesActiveLoads = 0;
const _seriesWaiters = []; // [{ resolve, signal }]

function acquireSeriesSlot(signal) {
  if (_seriesActiveLoads < MARINE_SERIES_MAX_CONCURRENT) { _seriesActiveLoads++; return Promise.resolve(true); }
  return new Promise((resolve) => {
    const entry = { resolve, signal };
    _seriesWaiters.push(entry);
    if (signal) {
      try {
        signal.addEventListener('abort', () => {
          const i = _seriesWaiters.indexOf(entry);
          if (i >= 0) { _seriesWaiters.splice(i, 1); resolve(false); } // dropped while queued; no slot taken
        }, { once: true });
      } catch (e) { /* ignore */ }
    }
  });
}

function releaseSeriesSlot() {
  if (_seriesActiveLoads > 0) _seriesActiveLoads--;
  while (_seriesWaiters.length && _seriesActiveLoads < MARINE_SERIES_MAX_CONCURRENT) {
    const w = _seriesWaiters.shift();
    if (w.signal && w.signal.aborted) { w.resolve(false); continue; } // drop aborted-while-queued
    _seriesActiveLoads++;
    w.resolve(true);
  }
}

// 3-hourly pages of at most 48 frames (the backend series cap). 48 frames × 3h = 144h span.
const PAGE_SPAN_HOURS = 144;
const MARINE_SERIES_MAX_HOURS = 336; // EURO 14-day window ceiling (240 native + 96 estimated)
const LAST_PAGE = Math.floor(MARINE_SERIES_MAX_HOURS / PAGE_SPAN_HOURS); // 2

export function isMarineSeriesEnabled() {
  if (typeof window === 'undefined') return false;
  if (window.__MARINE_SERIES__ === false) return false;
  try {
    if (window.localStorage && window.localStorage.getItem('marine_series') === 'false') {
      return false;
    }
  } catch (e) { /* localStorage blocked */ }
  return true;
}

// The 3-hourly page that contains a given hour offset. Page 0: 0..141, 1: 144..285, 2: 288..336.
export function marineSeriesPageForHour(hourOffset) {
  const h = Math.max(0, Number(hourOffset) || 0);
  return Math.min(LAST_PAGE, Math.floor(h / PAGE_SPAN_HOURS));
}

// The hour offsets a page requests (<=48 frames, 3-hourly, clamped to the 336h ceiling).
function buildPageHours(page) {
  const start = page * PAGE_SPAN_HOURS;
  const end = Math.min(start + PAGE_SPAN_HOURS - 3, MARINE_SERIES_MAX_HOURS);
  const hours = [];
  for (let h = start; h <= end; h += 3) hours.push(h);
  return hours;
}

// Coarse viewport key so small pans reuse the same series.
// Two correctness fixes for GLOBAL-zoom scrub (forensics 2026-06-26: at z2 with a wrapped viewport
// like west=-204, scrubbing was a per-hour fetch storm because the series never HIT):
//  (1) Normalize longitude to [-180,180] — a viewport panned past the antimeridian (west < -180)
//      otherwise yields keys that never match the warmed series.
//  (2) Collapse any WIDE viewport (span > 15° either axis — the backend's is_wide threshold, where it
//      serves ONE global-coarse product for everything) to a single stable 'global' key. Without this,
//      the 0.5° snap on a ~200°-span viewport churns the key on every micro-pan, so the warmed global
//      series is never reused → scrub re-fetches each hour. With it, the global-coarse series warms
//      once on settle and every global scrub hour HITS it (instant, zero-backend).
function viewportKey(bounds) {
  if (!bounds) return 'global';
  const normLng = (lng) => (((lng + 180) % 360) + 360) % 360 - 180; // wrap into [-180,180)
  const w = normLng(bounds.west);
  const e = normLng(bounds.east);
  const spanLng = (e < w) ? (e + 360) - w : e - w;
  const spanLat = Math.abs(bounds.north - bounds.south);
  if (spanLng > 15.0 || spanLat > 15.0) return 'global';
  const r = (v) => (Math.round(v * 2) / 2).toFixed(1); // 0.5° snap
  return `${r(w)}_${r(bounds.south)}_${r(e)}_${r(bounds.north)}`;
}

function pageKey(model, layer, bounds, page) {
  return `${model || 'GFS'}_${layer || 'waves'}_${getSurfModeFlag() ? 'surf' : 'swell'}_${viewportKey(bounds)}_p${page}`;
}

// Pad a REGIONAL request bbox outward by ~0.5° so the backend's degree-snapped tile reliably CONTAINS the
// viewport — and any sub-cell pan that maps to the SAME 0.5° viewportKey. Without this, a viewport whose edge
// sits just outside the served tile (live 2026-06-28: viewport south 27.96 vs served tile south 28.0) fails
// getMarineSeriesFrame's strict bboxContains → found:false → the heatmap stays CLAMPED until the 5-min TTL
// expires, because the TTL dedup refuses to re-fetch a tile that would contain it. Proven by curl: the padded
// request returns a tile that contains the unpadded viewport. Only pads comfortably-regional spans so padding
// can never push a near-15° viewport over the backend's wide/global-coarse threshold. Latitude clamped.
export const SERIES_BBOX_PAD_DEG = 0.5;
export function padRegionalBbox(b) {
  if (!b) return b;
  const spanLng = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
  const spanLat = Math.abs(b.north - b.south);
  if (spanLng >= 12 || spanLat >= 12) return b;   // wide/near-wide: leave alone (avoid the 15° threshold)
  const p = SERIES_BBOX_PAD_DEG;
  return {
    west: b.west - p,
    east: b.east + p,
    south: Math.max(-89.5, b.south - p),
    north: Math.min(89.5, b.north + p),
  };
}

// Defer adjacent-page prefetch to idle so it never competes with the current page or a
// scrub. requestIdleCallback when available; otherwise a macrotask (NOT a microtask, so it
// can't fire inside a caller's await — keeps the synchronous "one fetch" test invariant).
function scheduleIdlePrefetch(fn) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => { _idleTimers.delete(id); fn(); }, { timeout: 2500 });
    _idleTimers.add(id);
    return;
  }
  const id = setTimeout(() => { _idleTimers.delete(id); fn(); }, 1500);
  _idleTimers.add(id);
}

// Convert one backend series frame into a marineData object shaped exactly like a normal
// cached grid commit, so the orchestrator's existing commit/parity logic accepts it.
function frameToMarineData(frame, model, layer) {
  const provider = frame.provider || (model === 'EURO' ? 'copernicus' : 'open-meteo');
  const renderable = Array.isArray(frame.vectors) && frame.vectors.length > 0;
  // True data origin for the HUD provenance. `provider` is the deliberate 'open-meteo' contract key (kept
  // byte-identical across the NOAA-direct + open-meteo paths), so without __sourceDataset the HUD mislabels
  // NOAA-direct GFS as "open-meteo". Prefer the backend's per-frame source_dataset; else derive from the model
  // (on the decoupled ingest runner open-meteo is unreachable, so GFS marine is always NOAA-direct ncep_gfswave025,
  // ICON=GWAM/DWD, EURO=Copernicus). The HUD's __basicSourceName maps these → NOAA / DWD / Copernicus.
  const __sourceDataset = frame.source_dataset || (
    model === 'GFS' ? 'ncep_gfswave025' :
    model === 'ICON' ? 'gwam_dwd' :
    model === 'EURO' ? 'copernicus_cmems' : null
  );
  const grid = {
    vectors: frame.vectors,
    cols: frame.cols,
    rows: frame.rows,
    bounds: frame.bounds,
    __renderable: renderable,
    __componentLayer: layer,
    __sourceModel: model,
    __sourceDataset,
    __gridProvider: provider,
    provider,
    hourOffset: frame.hour_offset,
    is_estimated: !!frame.is_estimated,
    is_dynamic_viewport_product: true,
    __fromSeries: true,
    // Carry the surf-RATING signal so the shader paints the rating band on series-committed frames (clamp/scrub
    // commit series frames; without this the rating band never rendered even with surf=1). See _frame_rating_mode.
    ratingMode: !!frame.rating_mode,
  };
  return {
    type: 'FeatureCollection',
    features: [],
    grid,
    __sourceModel: model,
    __provider: provider,
    __renderable: renderable,
    __fromSeries: true,
    hourOffset: frame.hour_offset,
    product_id: `series_${model}_${layer}_h${frame.hour_offset}`,
    region_id: 'series',
    is_dynamic_viewport_product: true,
  };
}

// Load ONE page of the series. Idempotent + TTL'd + deduped (keyed by page). Never throws.
async function loadSeriesPage(model, layer, bounds, page, signal, force = false) {
  if (!isMarineSeriesEnabled() || !bounds || page < 0 || page > LAST_PAGE) return;
  const key = pageKey(model, layer, bounds, page);
  const existing = _seriesCache.get(key);
  if (existing && !force) {
    // A coarse-preview entry is allowed to RE-FETCH (capped + spaced) so the SWR-revalidated regional
    // grid replaces the cold global frame; otherwise honour the normal TTL dedup. `force` bypasses the
    // TTL dedup entirely — used by the clamp backstop (#8) when the engine is HELD on a stale non-covering
    // tile and the cache has no covering frame for the panned viewport: the TTL dedup would otherwise
    // refuse to re-fetch the covering tile the backend readily serves. Still de-duped against `_inFlight`.
    const coarseRetryDue = existing.coarsePreview &&
      (existing.revalCount || 0) < COARSE_REVAL_MAX &&
      Date.now() - existing.ts >= COARSE_REVAL_INTERVAL_MS;
    if (!coarseRetryDue && Date.now() - existing.ts < SERIES_TTL_MS) return;
  }
  if (_inFlight.has(key)) return;

  const hours = buildPageHours(page);
  if (hours.length === 0) return;
  // Request a padded box so the served tile contains the viewport (+small pans) — fixes the degree-boundary
  // clamp. Cache key + coarse-preview detection below still use the UNPADDED `bounds` (the user's viewport).
  const reqBox = padRegionalBbox(bounds);
  const url = `${API_BASE}/weather/grid_series?model=${encodeURIComponent(model || 'GFS')}`
    + `&domain=marine&layer=${encodeURIComponent(layer || 'waves')}`
    + `&bbox=${reqBox.west.toFixed(4)},${reqBox.south.toFixed(4)},${reqBox.east.toFixed(4)},${reqBox.north.toFixed(4)}`
    + `&hours=${hours.join(',')}`
    + (getSurfModeFlag() ? '&surf=1' : '');

  // Local timeout so a slow model (EURO/Copernicus) can't leave the series fetch hanging.
  const localController = new AbortController();
  const timeoutId = setTimeout(() => { try { localController.abort(); } catch (e) { /* ignore */ } }, 45000);
  if (signal) { try { signal.addEventListener('abort', () => localController.abort()); } catch (e) { /* ignore */ } }

  const p = (async () => {
    // Wait for a concurrency slot before hitting the 1-CPU backend. If the signal aborts while
    // we're queued, acquireSeriesSlot resolves false and we never fetch (superseded warm dropped).
    const gotSlot = await acquireSeriesSlot(localController.signal);
    if (!gotSlot || localController.signal.aborted) {
      clearTimeout(timeoutId);
      _inFlight.delete(key);
      return;
    }
    try {
      const res = await fetch(url, { signal: localController.signal });
      if (!res.ok) return;
      const json = await res.json();
      if (!json || !Array.isArray(json.frames) || json.frames.length === 0) return;
      const frames = new Map();
      const hoursList = [];
      for (const f of json.frames) {
        if (typeof f.hour_offset !== 'number' || !f.vectors || f.vectors.length === 0) continue;
        frames.set(f.hour_offset, frameToMarineData(f, model, layer));
        hoursList.push(f.hour_offset);
      }
      if (frames.size === 0) return;
      hoursList.sort((a, b) => a - b);
      // Coarse-preview detection: the backend served a GLOBAL frame for a REGIONAL request (a cold SWR
      // preview while it builds the precise regional grid). Flag it so the dedup above re-fetches until
      // the regional grid lands, instead of caching the coarse/clamped frame.
      const reqW = (bounds.east < bounds.west) ? (bounds.east + 360 - bounds.west) : (bounds.east - bounds.west);
      const reqH = Math.abs(bounds.north - bounds.south);
      const sf = frames.values().next().value;
      const sfb = sf && sf.grid && sf.grid.bounds;
      const frameW = sfb ? ((sfb.east < sfb.west) ? (sfb.east + 360 - sfb.west) : (sfb.east - sfb.west)) : 0;
      const isCoarsePreview = reqW < 15.0 && reqH < 15.0 && frameW >= 340.0;
      const revalCount = isCoarsePreview ? (((existing && existing.revalCount) || 0) + 1) : 0;
      // Store the SERVED frame bounds (sfb), not the requested bbox, so getMarineSeriesFrame's
      // containment matching reflects what the grid ACTUALLY covers. This matters for the 'global'
      // key: the requested bbox is a wrapped wide viewport (e.g. west=-204) but the served global
      // grid is ±180, which contains every viewport — so global scrub HITS regardless of pan. Also
      // strictly improves regional hits (the served tile is ≥ the requested viewport).
      _seriesCache.set(key, { ts: Date.now(), frames, hours: hoursList, bounds: sfb || bounds, model, layer, page, coarsePreview: isCoarsePreview, revalCount });
      // Bound memory.
      if (_seriesCache.size > SERIES_MAX) {
        const oldest = _seriesCache.keys().next().value;
        if (oldest !== undefined && oldest !== key) _seriesCache.delete(oldest);
      }
      // Self-schedule a revalidation re-fetch while still coarse (the backend is building the regional
      // grid in the background). Bounded by COARSE_REVAL_MAX. Aborts with the active signal.
      if (isCoarsePreview && revalCount < COARSE_REVAL_MAX && !localController.signal.aborted) {
        const t = setTimeout(() => { loadSeriesPage(model, layer, bounds, page, signal); }, COARSE_REVAL_INTERVAL_MS);
        _idleTimers.add(t);
      } else if (!isCoarsePreview && typeof window !== 'undefined') {
        // A REGIONAL frame just landed. Notify so a held coarse-global / clamped grid is sharpened
        // IMMEDIATELY (event-driven) instead of waiting on the ~3s render backstop's polling timer.
        // This is the INITIAL-LOAD clamp: the first /grid MISS serves a coarse-global SWR preview, and
        // without this the sharpen waited 3s. After the series is warm, toggles already commit regional
        // instantly (no clamp). checkScrubSettle is a cheap no-op when nothing is actually clamped.
        try { window.dispatchEvent(new Event('marine_series_revalidated')); } catch (e) { /* ignore */ }
      }
      if (typeof window !== 'undefined') {
        window.__MARINE_SERIES_DIAG__ = window.__MARINE_SERIES_DIAG__ || { loads: 0, hits: 0, misses: 0 };
        window.__MARINE_SERIES_DIAG__.loads++;
        window.__MARINE_SERIES_DIAG__.lastKey = key;
        window.__MARINE_SERIES_DIAG__.lastPage = page;
        window.__MARINE_SERIES_DIAG__.lastFrames = hoursList.length;
      }
    } catch (e) {
      // network/abort/timeout — silent, falls back to per-hour path
    } finally {
      releaseSeriesSlot(); // hand the slot to the next queued load
      clearTimeout(timeoutId);
      _inFlight.delete(key);
    }
  })();
  _inFlight.set(key, p);
  // Awaiting here makes the load observable to callers that DO await (and tests); the
  // orchestrator calls this fire-and-forget (no await), so it stays a background load.
  await p;
}

/**
 * Background-load the marine time-series PAGE containing `hourOffset` (current hour) first,
 * then prefetch adjacent page(s) during idle. Idempotent + TTL'd + deduped. No-op when the
 * flag is off. Never throws. hourOffset defaults to 0 (near page) for legacy callers.
 */
export async function ensureMarineSeries(model, layer, bounds, hourOffset = 0, signal, currentPageOnly = false, force = false) {
  if (!isMarineSeriesEnabled() || !bounds) return;
  const page = marineSeriesPageForHour(hourOffset);
  await loadSeriesPage(model, layer, bounds, page, signal, force);
  // currentPageOnly: load just the page containing hourOffset, no adjacent prefetch. Used by the
  // sibling-layer toggle prewarm — a toggle only needs the CURRENT hour, so fanning out to adjacent
  // pages (future-hour frames, for scrubbing) would be wasted 1-CPU backend load on the siblings.
  if (currentPageOnly) return;
  // Prefetch neighbours during idle so scrubbing into an adjacent page is already warm.
  for (const adj of [page + 1, page - 1]) {
    if (adj < 0 || adj > LAST_PAGE) continue;
    const k = pageKey(model, layer, bounds, adj);
    const cached = _seriesCache.get(k);
    if ((cached && Date.now() - cached.ts < SERIES_TTL_MS) || _inFlight.has(k)) continue;
    scheduleIdlePrefetch(() => { loadSeriesPage(model, layer, bounds, adj, signal); });
  }
}

/**
 * Eagerly load EVERY page for the active model/layer/viewport (no idle deferral). Called on
 * scrub START so any hour the user jumps to during a fast drag already has a cached frame —
 * idle prefetch (requestIdleCallback) never runs during active scrubbing, which is why far
 * hours otherwise held the previous frame until settle. Fire-and-forget; deduped + TTL'd.
 */
export function prewarmMarineSeries(model, layer, bounds, signal) {
  if (!isMarineSeriesEnabled() || !bounds) return;
  // EURO marine grid_series is backed by per-hour Copernicus fetches (~10s/hr, frequently time
  // out, and OOM the 512MB backend). Eager-loading all its pages is what overloaded Render under
  // scrub+toggle. Skip the eager prewarm for EURO — its lazy current-page load handles it. GFS &
  // ICON just re-slice a cheap cached coarse product, so prewarming all pages is safe + fast.
  if ((model || 'GFS').toUpperCase() === 'EURO') return;
  for (let page = 0; page <= LAST_PAGE; page++) {
    loadSeriesPage(model, layer, bounds, page, signal);
  }
}

// True if `outer` bbox fully contains `inner`. No antimeridian handling — series bboxes don't
// cross it in practice; a wrap case just fails containment and falls through to exact/miss.
function bboxContains(outer, inner) {
  if (!outer || !inner) return false;
  return outer.south <= inner.south && outer.north >= inner.north &&
         outer.west <= inner.west && outer.east >= inner.east;
}

// Nearest frame (within ±1.5h, 3-hourly) for an hour within one cache entry, or null.
function nearestFrameInEntry(entry, hourOffset) {
  let best = null, bestDiff = Infinity;
  for (const h of entry.hours) {
    const d = Math.abs(h - hourOffset);
    if (d < bestDiff) { bestDiff = d; best = entry.frames.get(h) || null; }
  }
  return (best !== null && bestDiff <= 1.5) ? { frame: best, diff: bestDiff } : null;
}

/**
 * Return a ready-to-commit marineData for the requested hour from the cached series, or
 * null if no series / no nearby frame. Searches the page containing the hour plus its
 * neighbours (to cover frames near a page boundary) and snaps to the nearest frame within
 * ±1.5h (frames are 3-hourly), so scrubbing tracks the nearest available hour synchronously.
 */
export function getMarineSeriesFrame(model, layer, bounds, hourOffset) {
  if (!isMarineSeriesEnabled() || !bounds) return null;
  const page = marineSeriesPageForHour(hourOffset);
  const now = Date.now();
  // Width of the requested viewport (deg, antimeridian-safe). A GLOBAL-width cached frame must NEVER be
  // served to a regional (zoomed-in) viewport — that IS the coarse-global clamp.
  const vWid = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
  const isRegionalViewport = vWid < 60;
  let best = null;
  let bestDiff = Infinity;
  for (const cand of [page, page + 1, page - 1]) {
    if (cand < 0 || cand > LAST_PAGE) continue;
    const entry = _seriesCache.get(pageKey(model, layer, bounds, cand));
    if (!entry || now - entry.ts >= SERIES_TTL_MS) continue;
    // The 0.5° viewportKey snap can match an entry whose grid is slightly SMALLER than (or offset
    // from) the current viewport — serving it renders a clamped sub-rectangle. Only take the exact-key
    // frame if its grid actually COVERS the viewport; else fall through to the containment fallback
    // (which finds a wider warmed frame, e.g. the zoom-out pre-warm) or misses into a fresh fetch.
    if (!bboxContains(entry.bounds, bounds)) continue;
    // A GLOBAL-width entry stored under the exact viewport key (a cold-viewport coarse SWR preview — the
    // backend served global-coarse while building the regional grid) must NOT be accepted here for a
    // REGIONAL viewport: doing so sets `best` with diff 0 and short-circuits the containment fallback below,
    // which would otherwise serve a SMALLER, already-warmed REGIONAL frame that also covers. That short
    // circuit is why a zoomed-in heatmap renders coarse/clamped (fw=360, willSharpen:false) even though a
    // covering regional tile is cached (organic repro 2026-06-28). Defer global to the last-resort fallback.
    const _eb = entry.bounds;
    const _eWid = (_eb.east < _eb.west) ? (_eb.east + 360 - _eb.west) : (_eb.east - _eb.west);
    if (isRegionalViewport && _eWid >= 340) continue;
    for (const h of entry.hours) {
      const d = Math.abs(h - hourOffset);
      if (d < bestDiff) { bestDiff = d; best = entry.frames.get(h) || null; }
    }
  }
  // Containment fallback: the exact viewport key missed (e.g. just zoomed in / panned a bit), but
  // a WIDER already-warmed series (same model/layer, page-proximate) whose bbox CONTAINS this
  // viewport can serve it NOW — instant + zero backend while the exact view re-warms, instead of
  // missing into a per-hour fetch. The grid covers the viewport so it's render-safe; pick the
  // SMALLEST containing bbox so the served frame is the highest resolution available.
  if (best === null || bestDiff > 1.5) {
    let smallestArea = Infinity;
    let globalFallbackFrame = null;   // a GLOBAL-width frame — used ONLY if no regional frame contains the viewport
    let globalFallbackDiff = Infinity;
    for (const entry of _seriesCache.values()) {
      if (now - entry.ts >= SERIES_TTL_MS) continue;
      if (entry.model !== model || entry.layer !== layer) continue;
      if (entry.page != null && Math.abs(entry.page - page) > 1) continue;
      if (!bboxContains(entry.bounds, bounds)) continue;
      const nf = nearestFrameInEntry(entry, hourOffset);
      if (!nf) continue;
      const b = entry.bounds;
      // A GLOBAL-width frame renders coarse-clamped for a regional viewport, so DON'T prefer it. But in the
      // decoupled/serve-only world a region may have ONLY the global-coarse product (the regional grid_series
      // returns 0 frames / times out). Keep it as a LAST RESORT so scrubbing + layer/model switches still
      // render and track per hour instead of freezing on a stale frame. (Regression guard: returning null
      // here froze the heatmap whenever no regional frame existed — was 7db0a655.) The clamp-resharpen path
      // still attempts to upgrade to the regional tile once one is available; (near-)global viewports keep
      // accepting it directly below, so global scrub is unaffected.
      const eWid = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
      if (isRegionalViewport && eWid >= 340) {
        if (nf.diff < globalFallbackDiff) { globalFallbackDiff = nf.diff; globalFallbackFrame = nf.frame; }
        continue;
      }
      const area = Math.max(1e-4, b.east - b.west) * Math.max(1e-4, b.north - b.south);
      if (area < smallestArea) { smallestArea = area; best = nf.frame; bestDiff = nf.diff; }
    }
    // No regional frame contained the viewport — serve the global-coarse as a last resort (better than a
    // frozen/blank scrub). Still subject to the ±1.5h nearest-frame gate below.
    if ((best === null || bestDiff > 1.5) && globalFallbackFrame !== null) {
      best = globalFallbackFrame; bestDiff = globalFallbackDiff;
    }
  }
  if (best === null || bestDiff > 1.5) {
    if (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) window.__MARINE_SERIES_DIAG__.misses++;
    return null;
  }
  if (typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) window.__MARINE_SERIES_DIAG__.hits++;
  return best;
}

export function _resetMarineSeriesForTest() {
  _seriesCache.clear();
  _inFlight.clear();
  for (const id of _idleTimers) {
    try { clearTimeout(id); if (typeof window !== 'undefined' && window.cancelIdleCallback) window.cancelIdleCallback(id); } catch (e) { /* ignore */ }
  }
  _idleTimers.clear();
  _seriesActiveLoads = 0;
  _seriesWaiters.length = 0;
}
